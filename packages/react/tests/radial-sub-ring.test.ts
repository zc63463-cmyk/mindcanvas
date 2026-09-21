/**
 * ② 二级环 · 纯逻辑测试（v1.8.2 沙盒）
 * ══════════════════════════════════════════════════════════════════════
 * 锁定五组不变量：
 * 1. 下钻：启用二级时一级「更多」提交 = 下钻（无 commit、origin 保留、parentSlot=left）；
 * 2. **零影响**：不传 `ctx.sub` 时行为与既有版本逐字节一致（commit more）；
 * 3. 席位裁剪：N=4/5/6（「打开完整菜单」恒为末席）；
 * 4. 选择：→/↓ 顺时针、←/↑ 逆时针（含环绕与空高亮起步）；悬停只在外环带命中（缺口带/内圈/界外 → null）；
 * 5. 提交与降级：Enter/松 Alt/点击外圈 = 提交席位；点内圈 = 降级回一级；Esc/界外 = 收起。
 */
import { describe, expect, it } from 'vitest';
import {
  RADIAL_GEOMETRY_DEFAULTS,
  RADIAL_IDLE,
  RADIAL_ITEMS_V1,
  radialGeometryFor,
  radialReduce,
  radialSubItemsFor,
  subRingOf,
  subSeatCenterDeg,
  type RadialEffect,
  type RadialEvent,
  type RadialReduceCtx,
  type RadialState,
} from '../src/edit/radialActions.js';

const ORIGIN = { nodeId: 'n1', cx: 0, cy: 0 };
/** 沙盒典型配置：5 席 */
const SUB: RadialReduceCtx = { sub: { seats: 5 } };

/** 依序驱动状态机，返回终态与最后一个效果 */
function drive(
  events: RadialEvent[],
  ctx: RadialReduceCtx = {},
): { state: RadialState; effect: RadialEffect } {
  let state: RadialState = RADIAL_IDLE;
  let effect: RadialEffect = { kind: 'none' };
  for (const ev of events) {
    const step = radialReduce(state, ev, RADIAL_ITEMS_V1, ctx);
    state = step.state;
    effect = step.effect;
  }
  return { state, effect };
}

/** 出环（慢按通道） */
const OPEN: RadialEvent[] = [
  { t: 'alt-down', now: 0, origin: ORIGIN },
  { t: 'tick', now: 300 },
];

/** 驱动到「二级已展开」：出环 → 高亮「更多」→ 确认（下钻） */
const TO_L2: RadialEvent[] = [...OPEN, { t: 'arrow', key: 'ArrowLeft' }, { t: 'confirm' }];

/** 极坐标取点（度；0°=右，顺时针为正） */
function at(deg: number, r: number): { x: number; y: number } {
  const a = (deg * Math.PI) / 180;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

const MID_MAIN = (RADIAL_GEOMETRY_DEFAULTS.innerR + RADIAL_GEOMETRY_DEFAULTS.outerR) / 2;

describe('② 二级环 · 下钻与零影响', () => {
  it('启用二级：一级「更多」提交 → 下钻（无 commit、origin 保留、parentSlot=left）', () => {
    const { state, effect } = drive(TO_L2, SUB);
    expect(effect).toEqual({ kind: 'none' });
    expect(state.phase).toBe('ring');
    expect(state.level).toBe(2);
    expect(state.parentSlot).toBe('left');
    expect(state.origin?.cx).toBe(0); // 两环同场景渲染的前提
    expect(state.highlight).toBe('left'); // 父扇区保持高亮（一级降透明，层关系可见）
  });

  it('未启用二级（缺省 ctx）：行为与既有完全一致 —— commit more', () => {
    const { state, effect } = drive(TO_L2);
    expect(effect).toEqual({ kind: 'commit', itemId: 'more', slot: 'left' });
    expect(state.phase).toBe('idle');
    expect(state.level ?? 1).toBe(1);
  });

  it('席位裁剪：N=4/5/6（「打开完整菜单」恒为末席）', () => {
    expect(radialSubItemsFor(4).map((i) => i.id)).toEqual([
      'sub:edit-desc',
      'sub:edit-note',
      'sub:hub',
      'sub:more-menu',
    ]);
    expect(radialSubItemsFor(5)).toHaveLength(5);
    expect(radialSubItemsFor(6)).toHaveLength(6);
    for (const n of [4, 5, 6]) {
      expect(radialSubItemsFor(n)[n - 1]?.id).toBe('sub:more-menu');
    }
  });
});

describe('② 二级环 · 席位选择与提交', () => {
  it('方向键轮转（←/↑ 逆、→/↓ 顺；空高亮起步 + 环绕）', () => {
    let s = drive(TO_L2, SUB).state;
    expect(s.subIndex ?? null).toBeNull();
    s = radialReduce(s, { t: 'arrow', key: 'ArrowRight' }, RADIAL_ITEMS_V1, SUB).state;
    expect(s.subIndex).toBe(0);
    s = radialReduce(s, { t: 'arrow', key: 'ArrowLeft' }, RADIAL_ITEMS_V1, SUB).state;
    expect(s.subIndex).toBe(4); // 环绕到末席
    s = radialReduce(s, { t: 'arrow', key: 'ArrowDown' }, RADIAL_ITEMS_V1, SUB).state;
    expect(s.subIndex).toBe(0);
    s = radialReduce(s, { t: 'arrow', key: 'ArrowUp' }, RADIAL_ITEMS_V1, SUB).state;
    expect(s.subIndex).toBe(4);
  });

  it('悬停只在外环带命中：席位中心 ✓；缺口带 / 内圈 / 界外 ✗', () => {
    const s2 = drive(TO_L2, SUB).state;
    const sub = subRingOf(radialGeometryFor(0, 0), 5);
    const mid = (sub.innerR + sub.outerR) / 2;
    const seat2 = at(subSeatCenterDeg(sub, 2), mid);
    expect(radialReduce(s2, { t: 'hover', x: seat2.x, y: seat2.y }, RADIAL_ITEMS_V1, SUB).state.subIndex).toBe(2);
    const gap = at(RADIAL_GEOMETRY_DEFAULTS.gapCenterDeg, mid);
    expect(radialReduce(s2, { t: 'hover', x: gap.x, y: gap.y }, RADIAL_ITEMS_V1, SUB).state.subIndex).toBeNull();
    const inner = at(270, MID_MAIN);
    expect(radialReduce(s2, { t: 'hover', x: inner.x, y: inner.y }, RADIAL_ITEMS_V1, SUB).state.subIndex).toBeNull();
    const far = at(270, sub.outerR + 40);
    expect(radialReduce(s2, { t: 'hover', x: far.x, y: far.y }, RADIAL_ITEMS_V1, SUB).state.subIndex).toBeNull();
  });

  it('Enter / 松 Alt → 提交高亮席位（effect = sub:*，slot = 父槽位）', () => {
    const enter = drive([...TO_L2, { t: 'arrow', key: 'ArrowRight' }, { t: 'confirm' }], SUB);
    expect(enter.effect).toEqual({ kind: 'commit', itemId: 'sub:edit-desc', slot: 'left' });
    expect(enter.state.phase).toBe('idle');
    const up = drive([...TO_L2, { t: 'arrow', key: 'ArrowLeft' }, { t: 'alt-up' }], SUB);
    expect(up.effect).toEqual({ kind: 'commit', itemId: 'sub:more-menu', slot: 'left' });
    expect(up.state.phase).toBe('idle');
  });

  it('二级无高亮：松 Alt → 收起（close）；Enter → 原地不动（不误提交）', () => {
    const up = drive([...TO_L2, { t: 'alt-up' }], SUB);
    expect(up.effect).toEqual({ kind: 'close' });
    expect(up.state.phase).toBe('idle');
    const enter = drive([...TO_L2, { t: 'confirm' }], SUB);
    expect(enter.effect).toEqual({ kind: 'none' });
    expect(enter.state.level).toBe(2);
  });

  it('点外圈席位 → 直接提交', () => {
    const s2 = drive(TO_L2, SUB).state;
    const sub = subRingOf(radialGeometryFor(0, 0), 5);
    const p = at(subSeatCenterDeg(sub, 3), (sub.innerR + sub.outerR) / 2);
    const step = radialReduce(s2, { t: 'click', x: p.x, y: p.y }, RADIAL_ITEMS_V1, SUB);
    expect(step.effect).toEqual({ kind: 'commit', itemId: radialSubItemsFor(5)[3]?.id, slot: 'left' });
  });
});

describe('② 二级环 · 灰显席（条件不满足不抽席）', () => {
  const CTX: RadialReduceCtx = {
    sub: {
      seats: 4,
      pages: [
        [
          { id: 'sub:a', label: 'A', icon: [] },
          { id: 'sub:b', label: 'B', icon: [], disabled: true },
          { id: 'sub:c', label: 'C', icon: [] },
          { id: 'sub:menu', label: '菜单', icon: [] },
        ],
      ],
    },
  };
  const subGeo = () => subRingOf(radialGeometryFor(0, 0), 4);
  const seatAt = (i: number): { x: number; y: number } => {
    const g = subGeo();
    return at(subSeatCenterDeg(g, i), (g.innerR + g.outerR) / 2);
  };

  it('悬停灰显席 → 不可高亮', () => {
    const s2 = drive(TO_L2, CTX).state;
    const p = seatAt(1);
    expect(radialReduce(s2, { t: 'hover', x: p.x, y: p.y }, RADIAL_ITEMS_V1, CTX).state.subIndex).toBeNull();
  });

  it('轮转跳过灰显席（0 → 跨过 1 → 2；反向同理）', () => {
    let s = drive(TO_L2, CTX).state;
    s = radialReduce(s, { t: 'arrow', key: 'ArrowRight' }, RADIAL_ITEMS_V1, CTX).state;
    expect(s.subIndex).toBe(0);
    s = radialReduce(s, { t: 'arrow', key: 'ArrowRight' }, RADIAL_ITEMS_V1, CTX).state;
    expect(s.subIndex).toBe(2); // 跳过下标 1（灰显）
    s = radialReduce(s, { t: 'arrow', key: 'ArrowLeft' }, RADIAL_ITEMS_V1, CTX).state;
    expect(s.subIndex).toBe(0);
  });

  it('点击灰显席 → 无效（停留 level 2、无效果）', () => {
    const s2 = drive(TO_L2, CTX).state;
    const p = seatAt(1);
    const step = radialReduce(s2, { t: 'click', x: p.x, y: p.y }, RADIAL_ITEMS_V1, CTX);
    expect(step.effect).toEqual({ kind: 'none' });
    expect(step.state.level).toBe(2);
  });
});

describe('② 二级环 · 翻页（方向型动作 = 同一外圈换页）', () => {
  const PAGES_CTX: RadialReduceCtx = {
    sub: {
      seats: 3,
      pages: [
        [
          { id: 'sub:center', label: '升为中心', icon: [], opensPage: 1 },
          { id: 'sub:hub', label: '枢纽', icon: [] },
          { id: 'sub:menu', label: '菜单', icon: [] },
        ],
        [
          { id: 'sub:center-right', label: '靠右', icon: [] },
          { id: 'sub:center-left', label: '靠左', icon: [] },
          { id: 'sub:back', label: '返回', icon: [], opensPage: 0 },
        ],
      ],
    },
  };
  const seatAt = (count: number, i: number): { x: number; y: number } => {
    const g = subRingOf(radialGeometryFor(0, 0), count);
    return at(subSeatCenterDeg(g, i), (g.innerR + g.outerR) / 2);
  };
  /** 驱动到「页 1（方向页）」 */
  const toPage1 = (): RadialState => {
    let s = drive(TO_L2, PAGES_CTX).state;
    s = radialReduce(s, { t: 'arrow', key: 'ArrowRight' }, RADIAL_ITEMS_V1, PAGES_CTX).state; // 0 = 升为中心
    return radialReduce(s, { t: 'confirm' }, RADIAL_ITEMS_V1, PAGES_CTX).state;
  };

  it('在「升为中心」按 Enter → 进页 1（清号位、无效果、仍是 level 2）', () => {
    const s = toPage1();
    expect(s.subPage).toBe(1);
    expect(s.subIndex ?? null).toBeNull();
    expect(s.level).toBe(2);
  });

  it('子页内轮转并提交（靠右 → commit sub:center-right）', () => {
    let s = toPage1();
    s = radialReduce(s, { t: 'arrow', key: 'ArrowRight' }, RADIAL_ITEMS_V1, PAGES_CTX).state;
    const step = radialReduce(s, { t: 'confirm' }, RADIAL_ITEMS_V1, PAGES_CTX);
    expect(step.effect).toEqual({ kind: 'commit', itemId: 'sub:center-right', slot: 'left' });
  });

  it('子页末席「返回」→ 回主页（subPage 0）', () => {
    let s = toPage1();
    s = radialReduce(s, { t: 'arrow', key: 'ArrowLeft' }, RADIAL_ITEMS_V1, PAGES_CTX).state; // 逆时针 → 末席
    expect(s.subIndex).toBe(2);
    const step = radialReduce(s, { t: 'confirm' }, RADIAL_ITEMS_V1, PAGES_CTX);
    expect(step.effect).toEqual({ kind: 'none' });
    expect(step.state.subPage).toBe(0);
    expect(step.state.level).toBe(2);
  });

  it('内圈：子页 → 回上一页；主页 → 降级回一级', () => {
    const inner = at(270, MID_MAIN);
    const back = radialReduce(toPage1(), { t: 'click', x: inner.x, y: inner.y }, RADIAL_ITEMS_V1, PAGES_CTX);
    expect(back.state.subPage).toBe(0);
    expect(back.state.level).toBe(2);
    const demote = radialReduce(back.state, { t: 'click', x: inner.x, y: inner.y }, RADIAL_ITEMS_V1, PAGES_CTX);
    expect(demote.state.level).toBe(1);
    expect(demote.state.subPage ?? 0).toBe(0);
  });

  it('翻页席上松键 → 直接收起（不进入也不悬空）', () => {
    let s = drive(TO_L2, PAGES_CTX).state;
    const p = seatAt(3, 0);
    s = radialReduce(s, { t: 'hover', x: p.x, y: p.y }, RADIAL_ITEMS_V1, PAGES_CTX).state;
    expect(s.subIndex).toBe(0);
    const step = radialReduce(s, { t: 'alt-up' }, RADIAL_ITEMS_V1, PAGES_CTX);
    expect(step.effect).toEqual({ kind: 'close' });
    expect(step.state.phase).toBe('idle');
  });
});

describe('② 二级环 · 降级返回', () => {
  it('点内圈（主环带）→ 降级回一级（环保持、无效果）', () => {
    const s2 = drive(TO_L2, SUB).state;
    const p = at(270, MID_MAIN);
    const step = radialReduce(s2, { t: 'click', x: p.x, y: p.y }, RADIAL_ITEMS_V1, SUB);
    expect(step.effect).toEqual({ kind: 'none' });
    expect(step.state.level).toBe(1);
    expect(step.state.parentSlot ?? null).toBeNull();
    expect(step.state.subIndex ?? null).toBeNull();
    expect(step.state.phase).toBe('ring');
  });

  it('二级 Esc（cancel）→ 直接收起（B1 更新：Alt+Esc 被系统占用；降级走内圈或松开重进）', () => {
    const step = radialReduce(drive(TO_L2, SUB).state, { t: 'cancel' }, RADIAL_ITEMS_V1, SUB);
    expect(step.effect).toEqual({ kind: 'close' });
    expect(step.state.phase).toBe('idle');
  });

  it('二级点击界外 → 收起', () => {
    const s2 = drive(TO_L2, SUB).state;
    const p = at(270, subRingOf(radialGeometryFor(0, 0), 5).outerR + 60);
    const step = radialReduce(s2, { t: 'click', x: p.x, y: p.y }, RADIAL_ITEMS_V1, SUB);
    expect(step.effect).toEqual({ kind: 'close' });
  });
});
