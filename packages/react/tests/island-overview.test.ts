/**
 * IO-1 · 岛级远观总览纯函数测试（node 环境，零 DOM）。
 *
 * 锁住的语义（设计 §3 D1–D6、§6 测试计划）：
 * - 触发：`k < K_OVERVIEW(0.35)` 且有中心岛；无岛 / 脏 k → inactive；
 * - 「有岛」口径唯一：centerIds 非空（空岛表 + 空 centerIds 不得进入总览）；
 * - 标题优先级：Section.title ＞ 中心文本（titleOf）；
 * - 计数：memberCount = 本岛 ∪ 包容子孙岛（containedMemberIds）；nestedCount = 子孙中心数；
 * - 子孙岛**不出**独立卡（只并入祖先卡的 bounds 与计数）；
 * - 卡 bounds = 成员盒并集 + Section 同款外扩（直接罩住 nested 成员盒）。
 */
import { describe, expect, it } from 'vitest';
import type { Box } from '@mindcanvas/kernel';
import {
  buildIslandOverviewCards,
  clampBoundsInside,
  estimateTextWidth,
  hasOverviewIslands,
  islandOverviewMemberIdsOf,
  K_OVERVIEW,
  OVERVIEW_TOP_PAD,
  overviewActive,
  overviewBoundsOf,
  screenStableSize,
  truncateWithEllipsis,
} from '../src/render/islandOverview.js';
import { SECTION_PADDING } from '../src/render/sectionFrames.js';

const PAD = SECTION_PADDING;
const TOP = OVERVIEW_TOP_PAD;

describe('IO-1 触发阈值（D1 / D2）', () => {
  it('K_OVERVIEW = 0.35（与 note badge 档同带）；k<0.35 且有岛 → active', () => {
    expect(K_OVERVIEW).toBe(0.35);
    expect(overviewActive(0.34, true)).toBe(true);
    expect(overviewActive(0.2, true)).toBe(true);
    expect(overviewActive(0.35, true)).toBe(false);
    expect(overviewActive(1, true)).toBe(false);
  });

  it('无岛 → inactive（即使 k 极低，保持既有 skeleton 渲染）', () => {
    expect(overviewActive(0.05, false)).toBe(false);
    expect(overviewActive(0.34, false)).toBe(false);
  });

  it('脏 k（NaN / ≤0：初始化瞬间）→ inactive，不闪总览层', () => {
    expect(overviewActive(Number.NaN, true)).toBe(false);
    expect(overviewActive(0, true)).toBe(false);
    expect(overviewActive(-1, true)).toBe(false);
  });

  it('「有岛」口径 = centerIds 非空（唯一判定点，D2）', () => {
    expect(hasOverviewIslands(new Set(['c1']))).toBe(true);
    expect(hasOverviewIslands(new Set())).toBe(false);
    expect(hasOverviewIslands(undefined)).toBe(false);
    expect(hasOverviewIslands(null)).toBe(false);
    // 产品壳无中心文档形态：空 centerIds + 空岛表 → 绝不进入总览
    expect(overviewActive(0.2, hasOverviewIslands(new Set()))).toBe(false);
  });
});

const BOXES: Record<string, Box> = {
  // 根岛：R + other
  R: { x: 0, y: 0, w: 100, h: 40 },
  other: { x: 160, y: 0, w: 80, h: 40 },
  // 中心岛 P：P + p1（内容树上包容子孙中心 C）
  P: { x: 0, y: 200, w: 120, h: 40 },
  p1: { x: 180, y: 200, w: 90, h: 40 },
  // 子孙岛 C：C + c1（D6：不出独立卡）
  C: { x: 400, y: 260, w: 100, h: 40 },
  c1: { x: 540, y: 260, w: 80, h: 40 },
};

const MEMBERS = new Map<string, readonly string[]>([
  ['R', ['R', 'other']],
  ['P', ['P', 'p1']],
  ['C', ['C', 'c1']],
]);
const NESTED = new Map<string, readonly string[]>([
  ['P', ['C']],
  ['C', []],
]);

function build(over: Partial<Parameters<typeof buildIslandOverviewCards>[0]> = {}) {
  return buildIslandOverviewCards({
    centerIds: new Set(['P', 'C']),
    membersByRoot: MEMBERS,
    nestedCenterIdsByRoot: NESTED,
    sectionByRootId: new Map([['P', { title: '摩擦分析', color: 'blue' }]]),
    titleOf: (id) => `节点:${id}`,
    boxOf: (id) => BOXES[id],
    ...over,
  });
}

describe('IO-1 卡 VM（D3 / D4 / D6）', () => {
  it('一岛一卡：centerIds 先序 + 岛表补齐；子孙岛不出卡（D6）', () => {
    const cards = build();
    expect(cards.map((c) => c.rootId)).toEqual(['P', 'R']);
  });

  it('标题优先级：Section.title ＞ 中心文本；空标题回退中心文本', () => {
    const cards = build();
    expect(cards.find((c) => c.rootId === 'P')?.title).toBe('摩擦分析');
    expect(cards.find((c) => c.rootId === 'P')?.color).toBe('blue');
    // R 无 Section → titleOf
    expect(cards.find((c) => c.rootId === 'R')?.title).toBe('节点:R');
    // Section 标题为空串 → 回退中心文本（不是空标题卡）
    const blank = build({
      sectionByRootId: new Map([['P', { title: '' }]]),
    });
    expect(blank.find((c) => c.rootId === 'P')?.title).toBe('节点:P');
    expect(blank.find((c) => c.rootId === 'P')?.color).toBeUndefined();
  });

  it('计数：memberCount = 本岛 ∪ 包容子孙岛（去重）；nestedCount = 子孙中心数', () => {
    const cards = build();
    const p = cards.find((c) => c.rootId === 'P')!;
    expect(p.memberCount).toBe(4); // P + p1 + C + c1
    expect(p.nestedCount).toBe(1);
    const r = cards.find((c) => c.rootId === 'R')!;
    expect(r.memberCount).toBe(2);
    expect(r.nestedCount).toBe(0);
  });

  it('bounds = 成员盒并集 + Section 同款外扩，且罩住 nested 成员盒（nest-contain）', () => {
    const cards = build();
    const p = cards.find((c) => c.rootId === 'P')!;
    // 并集 x[0,620] y[200,300]；外扩 = 左右下 PAD、上侧 TOP(标题栏)
    expect(p.bounds).toEqual({
      x: 0 - PAD,
      y: 200 - TOP,
      w: 620 + PAD * 2,
      h: 100 + TOP + PAD,
    });
    for (const id of ['P', 'p1', 'C', 'c1']) {
      const b = BOXES[id]!;
      expect(p.bounds.x).toBeLessThanOrEqual(b.x);
      expect(p.bounds.y).toBeLessThanOrEqual(b.y);
      expect(p.bounds.x + p.bounds.w).toBeGreaterThanOrEqual(b.x + b.w);
      expect(p.bounds.y + p.bounds.h).toBeGreaterThanOrEqual(b.y + b.h);
    }
  });

  it('成员盒缺失：缺盒者跳过并集；全成员无盒 → 不产卡（不画空卡）', () => {
    const partial = build({ boxOf: (id) => (id === 'other' ? BOXES['other'] : undefined) });
    const r = partial.find((c) => c.rootId === 'R')!;
    expect(r.bounds).toEqual({
      x: 160 - PAD,
      y: 0 - TOP,
      w: 80 + PAD * 2,
      h: 40 + TOP + PAD,
    });
    const none = build({ boxOf: () => undefined });
    expect(none).toEqual([]);
  });

  it('无嵌套表（未注入）→ 子孙各出卡、计数互不并入（退化语义明确）', () => {
    const cards = build({ nestedCenterIdsByRoot: undefined });
    expect(cards.map((c) => c.rootId)).toEqual(['P', 'C', 'R']);
    expect(cards.find((c) => c.rootId === 'P')?.memberCount).toBe(2);
    expect(cards.find((c) => c.rootId === 'P')?.nestedCount).toBe(0);
  });

  it('order 稳定：同输入两次 → 同序同值（可直接进 memo 依赖）', () => {
    expect(build()).toEqual(build());
  });
});

describe('IO-1 成员解算与屏稳尺寸', () => {
  it('islandOverviewMemberIdsOf：有岛表 → contained 并集；无登记 → 回退本体（防无卡空洞）', () => {
    expect(islandOverviewMemberIdsOf('P', MEMBERS, NESTED)).toEqual(['P', 'p1', 'C', 'c1']);
    expect(islandOverviewMemberIdsOf('C', MEMBERS, NESTED)).toEqual(['C', 'c1']);
    expect(islandOverviewMemberIdsOf('ghost', MEMBERS, NESTED)).toEqual(['ghost']);
  });

  it('overviewBoundsOf：成员盒并集 + 外扩；空清单 → undefined', () => {
    expect(overviewBoundsOf([], (id) => BOXES[id])).toBeUndefined();
    expect(overviewBoundsOf(['R'], (id) => BOXES[id])).toEqual({
      x: -PAD,
      y: -TOP,
      w: 100 + PAD * 2,
      h: 40 + TOP + PAD,
    });
  });

  it('screenStableSize：屏幕 px / k（脏 k 兜 1），世界值钳制', () => {
    expect(screenStableSize(13, 0.2)).toBeCloseTo(65);
    expect(screenStableSize(13, 0)).toBe(13); // 脏值 → 按 k=1
    expect(screenStableSize(13, Number.NaN)).toBe(13);
    expect(screenStableSize(13, 0.2, 0, 40)).toBe(40); // 世界值上限钳制
  });
});

describe('IO-2 迷你子卡（设计 §9 N1–N4）', () => {
  it('顶层仍无子孙大卡（N2）：C 只作为 P 的 nestedCards 出现', () => {
    const cards = build();
    expect(cards.map((c) => c.rootId)).toEqual(['P', 'R']);
    const p = cards.find((c) => c.rootId === 'P')!;
    expect(p.nestedCards?.map((m) => m.rootId)).toEqual(['C']);
    expect(p.nestedCount).toBe(1); // N6：父卡 ⊞ 角标保留
    // 根岛 R 无嵌套 → 不带该字段（迷你只在有子孙时产生）
    expect(cards.find((c) => c.rootId === 'R')?.nestedCards).toBeUndefined();
  });

  it('迷你标题/色/计数同顶层规则；自身 nestedCards 恒不填（N1 不递归）', () => {
    const cards = build({
      sectionByRootId: new Map([
        ['P', { title: '摩擦分析', color: 'blue' }],
        ['C', { title: '子岛区', color: 'rose' }],
      ]),
    });
    const mini = cards.find((c) => c.rootId === 'P')!.nestedCards![0]!;
    expect(mini.rootId).toBe('C');
    expect(mini.title).toBe('子岛区');
    expect(mini.color).toBe('rose');
    expect(mini.memberCount).toBe(2); // C ∪ c1（不含父岛成员）
    expect(mini.nestedCount).toBe(0);
    expect(mini.nestedCards).toBeUndefined();
    // 无 Section 的子中心 → 中心文本（titleOf）
    const noSection = build({ sectionByRootId: new Map([['P', { title: '摩擦分析' }]]) });
    expect(noSection.find((c) => c.rootId === 'P')!.nestedCards![0]!.title).toBe('节点:C');
  });

  it('迷你 bounds = 子岛自身成员并集外扩（不含父岛成员）', () => {
    const mini = build().find((c) => c.rootId === 'P')!.nestedCards![0]!;
    // C(400,260,100,40) ∪ c1(540,260,80,40) → x[400,620] y[260,300]
    expect(mini.bounds).toEqual({
      x: 400 - PAD,
      y: 260 - TOP,
      w: 220 + PAD * 2,
      h: 40 + TOP + PAD,
    });
  });

  it('缺盒子孙跳过迷你：nestedCards.length ≤ nestedCount（⊞ 角标仍计全量）', () => {
    const cards = build({ boxOf: (id) => (id === 'P' || id === 'p1' ? BOXES[id] : undefined) });
    const p = cards.find((c) => c.rootId === 'P')!;
    expect(p.nestedCards).toBeUndefined(); // C/c1 全无盒 → 不出迷你
    expect(p.nestedCount).toBe(1); // 角标仍计全量（N6）
  });

  it('更深嵌套（P→C→D）：C 迷你只带 nestedCount（⊞），不递归出 D 迷你、无顶层 D（N1）', () => {
    const boxes: Record<string, Box> = {
      P: { x: 0, y: 0, w: 100, h: 40 },
      C: { x: 0, y: 100, w: 100, h: 40 },
      D: { x: 0, y: 200, w: 100, h: 40 },
    };
    const cards = buildIslandOverviewCards({
      centerIds: new Set(['P']),
      membersByRoot: new Map([
        ['P', ['P']],
        ['C', ['C']],
        ['D', ['D']],
      ]),
      nestedCenterIdsByRoot: new Map([
        ['P', ['C']],
        ['C', ['D']],
        ['D', []],
      ]),
      titleOf: (id) => id,
      boxOf: (id) => boxes[id],
    });
    expect(cards.map((c) => c.rootId)).toEqual(['P']);
    expect(cards[0]!.nestedCount).toBe(1);
    const miniC = cards[0]!.nestedCards![0]!;
    expect(miniC.rootId).toBe('C');
    expect(miniC.nestedCount).toBe(1); // 更深 → ⊞ 1
    expect(miniC.nestedCards).toBeUndefined(); // 不递归（D 无迷你）
    // 计数/盒沿 nest-contain：C 迷你含其包容的 D（N3「自身 islandOverviewMemberIdsOf」）
    expect(miniC.memberCount).toBe(2);
  });
});

describe('IO-2 迷你钳制 clampBoundsInside（N3）', () => {
  const parent: Box = { x: 0, y: 0, w: 100, h: 100 };

  it('越界 → 平移贴边（尺寸不变）', () => {
    expect(clampBoundsInside(parent, { x: 90, y: 90, w: 30, h: 30 })).toEqual({
      x: 70,
      y: 70,
      w: 30,
      h: 30,
    });
    expect(clampBoundsInside(parent, { x: -50, y: -50, w: 30, h: 30 })).toEqual({
      x: 0,
      y: 0,
      w: 30,
      h: 30,
    });
  });

  it('屏稳撑大 → 缩身到可用区（禁止画出父卡外）', () => {
    expect(clampBoundsInside(parent, { x: -20, y: -20, w: 200, h: 150 })).toEqual({
      x: 0,
      y: 0,
      w: 100,
      h: 100,
    });
  });

  it('inset：内缩边界生效（迷你落父卡内边距内）', () => {
    const r = clampBoundsInside(parent, { x: 0, y: 0, w: 10, h: 10 }, 8);
    expect(r).toEqual({ x: 8, y: 8, w: 10, h: 10 });
    const big = clampBoundsInside(parent, { x: 0, y: 0, w: 500, h: 500 }, 8);
    expect(big).toEqual({ x: 8, y: 8, w: 84, h: 84 });
  });

  it('钳制结果恒落在 region 内（含 inset；property 式抽样）', () => {
    const boxes: Box[] = [
      { x: -80, y: 40, w: 300, h: 20 },
      { x: 95, y: -95, w: 240, h: 240 },
      { x: 50, y: 50, w: 0, h: 0 },
      { x: 10, y: 10, w: 40, h: 40 },
    ];
    for (const b of boxes) {
      const r = clampBoundsInside(parent, b, 5);
      expect(r.x).toBeGreaterThanOrEqual(parent.x + 5);
      expect(r.y).toBeGreaterThanOrEqual(parent.y + 5);
      expect(r.x + r.w).toBeLessThanOrEqual(parent.x + parent.w - 5);
      expect(r.y + r.h).toBeLessThanOrEqual(parent.y + parent.h - 5);
    }
  });
});

describe('IO-UX2 标题截断（estimateTextWidth / truncateWithEllipsis）', () => {
  it('宽度估算：CJK = 1em、拉丁 ≈ 0.56em（逐字累加，混排正确）', () => {
    expect(estimateTextWidth('规划中', 10)).toBeCloseTo(30);
    expect(estimateTextWidth('abcd', 10)).toBeCloseTo(22.4);
    expect(estimateTextWidth('Agent契约', 10)).toBeCloseTo(5 * 5.6 + 2 * 10);
  });

  it('可容纳 → 原文返回（含恰好等宽），绝不追加省略号', () => {
    expect(truncateWithEllipsis('规划中', 100, 10)).toBe('规划中');
    expect(truncateWithEllipsis('规划中', 30, 10)).toBe('规划中');
    expect(truncateWithEllipsis('', 10, 10)).toBe('');
  });

  it('超宽 → 「…」收尾，且结果的估算宽度不超上限（不半字悬空）', () => {
    const title = '这是一个非常长的章节标题用于验证截断';
    const out = truncateWithEllipsis(title, 40, 10);
    expect(out).not.toBe(title);
    expect(out.endsWith('…')).toBe(true);
    expect(estimateTextWidth(out, 10)).toBeLessThanOrEqual(40);
    // 贪心：能放几个放几个（3 个 CJK = 30，+「…」5.6 ≤ 40；第 4 个 30+10+5.6 > 40 放不下）
    expect(out).toBe('这是一…');
  });

  it('退化：一字放不下 → 恰为「…」；零/负宽 → 空串（不画半个字，也不硬塞省略号）', () => {
    expect(truncateWithEllipsis('规划中', 5, 10)).toBe('…');
    expect(truncateWithEllipsis('规划中', 0, 10)).toBe('');
    expect(truncateWithEllipsis('规划中', -3, 10)).toBe('');
  });
});
