/**
 * 共享梁双把手（B2 · 纯逻辑）：一根梁、两个把手。
 *
 * 契约（设计 docs/specs/2026-09-17-beam-dual-handle-design.md §4）：
 * - **命中分裂**：父出边 → 梁交点的干线（trunk，含交汇垫 ±JUNCTION_PAD）→ `bias`；
 *   共享梁中段（扣除交汇垫）→ `lens`；交汇垫优先 trunk（摩擦入口）。
 * - **拖拽映射**：`lens` 改层距（梁跟手），`bias` 只改比例位（gap 不变、节点不动）。
 * - **互不串写**：一次拖拽只动一个字段；预览梁/徽标由纯函数产出（MapView 不胀大）。
 */
import { describe, expect, it } from 'vitest';
import { BEAM_AT_PAD } from '@mindcanvas/kernel';
import {
  BEAM_HIT_TOLERANCE,
  BEAM_JUNCTION_PAD,
  beamAtAfterDrag,
  beamDragBadge,
  beamDragCommit,
  beamDragMove,
  beamDragRail,
  beamRailAtRatio,
  beamTrunkLen,
  buildBeamHandles,
  hitBeamAt,
  hitBeamTarget,
  type BeamDragState,
  type BeamHandle,
  type BeamLinkGeom,
} from '../src/render/beamDrag.js';
import { beamYForGroup, verticalBeamMap } from '../src/render/geometry.js';

/** 上向共享梁夹具：父 (0,100,200,40)；两子上缘同高，底缘 = 4；空隙 gap = 96 */
const PARENT = { x: 0, y: 100, w: 200, h: 40 };
const KID_BOTTOM = 4;

function upLinks(): BeamLinkGeom[] {
  const kid = (x: number) => ({ x, y: KID_BOTTOM - 30, w: 60, h: 30 });
  return [
    { fromId: 'p', from: PARENT, to: kid(20), dir: 'up' },
    { fromId: 'p', from: PARENT, to: kid(120), dir: 'up' },
  ];
}

/** 比例位注入（模拟 MapView 经 kernel readBeamAt 读父节点 note） */
const atOfUp = (id: string, dir: string): number => (id === 'p' && dir === 'up' ? 0.75 : 0.5);

/** 双把手全链：render 梁映射（吃 atOf）→ buildBeamHandles */
function handlesWith(atOf?: (id: string, dir: string, gap: number) => number): BeamHandle[] {
  const links = upLinks();
  const beamYs = verticalBeamMap(links, (l) => l.dir, atOf);
  return buildBeamHandles(links, (l) => beamYs.get(l), atOf);
}

/** 取唯一把手（缺即抛；新测试不写非空断言） */
function soleHandle(atOf?: (id: string, dir: string, gap: number) => number): BeamHandle {
  const hs = handlesWith(atOf);
  const h = hs[0];
  if (hs.length !== 1 || h === undefined) throw new Error(`期望 1 个把手，实得 ${hs.length}`);
  return h;
}

/** 拖拽状态（缺省：无比例位 → at 0.5 / rail 52 / startLen 96） */
function dragState(
  atOf?: (id: string, dir: string, gap: number) => number,
  over: Partial<BeamDragState> = {},
): BeamDragState {
  const handle = soleHandle(atOf);
  return {
    handle,
    mode: 'bias',
    pointerId: 1,
    startW: { x: handle.parentCenter, y: handle.rail },
    len: handle.startLen,
    at: handle.at,
    moved: false,
    curW: { x: handle.parentCenter, y: handle.rail },
    ...over,
  };
}

describe('buildBeamHandles：双把手几何（父边 / 子边 / 比例位）', () => {
  it('缺省（无 atOf）→ at = 0.5、rail = 中点（旧行为逐值不变）', () => {
    const h = soleHandle();
    expect(h.at).toBe(0.5);
    expect(h.parentEdge).toBe(100);
    expect(h.childEdge).toBe(KID_BOTTOM);
    expect(h.rail).toBe(52); // (100 + 4) / 2
    expect(h.startLen).toBe(96); // 真 gap（缺省 0.5 时与旧「中点 ×2」同值）
    expect(h.parentCenter).toBe(100); // 父盒中线（trunk 轴）
    expect(h.lo).toBe(50); // 子中线 20+30 / 120+30 ∪ 父中线 100
    expect(h.hi).toBe(150);
  });

  it('★ atOf = 0.75 → handle.at / rail 同步；startLen = 真 gap（不是虚高的 2×trunk）', () => {
    const h = soleHandle(atOfUp);
    expect(h.at).toBe(0.75);
    expect(h.rail).toBe(28); // 100 + (4 − 100) × 0.75
    // 修前：|rail − 父边| × 2 = 144（中点时代的等价式在 beamAt ≠ 0.5 后恒假）→ 提交层距虚高
    expect(h.startLen).toBe(96); // 真 gap = |childEdge − parentEdge|
    expect(h.startLen).not.toBe(144);
  });
});

describe('命中分裂：trunk → bias / rail → lens（交汇垫优先 trunk）', () => {
  const h = soleHandle(atOfUp);

  it('★ trunk 带（父出边 → 梁交点）→ bias', () => {
    const hit = hitBeamTarget([h], { x: h.parentCenter + 3, y: 60 });
    expect(hit?.mode).toBe('bias');
    expect(hit?.handle.fromId).toBe('p');
  });

  it('★ rail 中段（扣除交汇垫）→ lens', () => {
    const hit = hitBeamTarget([h], { x: 60, y: h.rail + 2 }); // 离父中线 40px > 12
    expect(hit?.mode).toBe('lens');
  });

  it('★ 交汇垫（|沿轴 − 父中线| ≤ JUNCTION_PAD）→ bias（即使落在梁带上）', () => {
    const hit = hitBeamTarget([h], { x: h.parentCenter + BEAM_JUNCTION_PAD - 1, y: h.rail });
    expect(hit?.mode).toBe('bias');
    // 恰在 trunk 带宽之外、交汇垫之内：仍判 bias（垫优先）
    const pad = hitBeamTarget([h], { x: h.parentCenter + BEAM_HIT_TOLERANCE + 1, y: h.rail });
    expect(pad?.mode).toBe('bias');
    // 越过交汇垫 → 回到 rail（lens）
    const beyond = hitBeamTarget([h], { x: h.parentCenter + BEAM_JUNCTION_PAD + 1, y: h.rail });
    expect(beyond?.mode).toBe('lens');
  });

  it('带外 → null；hitBeamAt 兼容旧调用（只取把手）', () => {
    expect(hitBeamTarget([h], { x: h.parentCenter + 200, y: h.rail + 40 })).toBeNull();
    expect(hitBeamAt([h], { x: 60, y: h.rail })?.fromId).toBe('p');
    expect(hitBeamAt([h], { x: h.parentCenter, y: 400 })).toBeNull();
  });
});

describe('拖拽映射：bias 只改比例位 / lens 只改层距', () => {
  it('★ bias：指针沿空隙轴 → beamAt 随指针变；gap 与 len 输出不变', () => {
    const h = soleHandle(atOfUp);
    const gap = Math.abs(h.childEdge - h.parentEdge);
    // 指针落在子入边 / 父出边 → 1 / 0，均被 PAD 钳回
    expect(beamAtAfterDrag(h, { x: 0, y: h.childEdge })).toBeCloseTo(1 - BEAM_AT_PAD / gap, 10);
    expect(beamAtAfterDrag(h, { x: 0, y: h.parentEdge })).toBeCloseTo(BEAM_AT_PAD / gap, 10);
    // 指针落在 0.75 位 → 0.75（gap 不变：与 h.childEdge / h.parentEdge 无关地固定）
    const at75 = h.parentEdge + (h.childEdge - h.parentEdge) * 0.75;
    expect(beamAtAfterDrag(h, { x: 0, y: at75 })).toBeCloseTo(0.75, 10);
    expect(h.at).toBe(0.75); // 纯函数：入参把手不被改写
  });

  it('★ bias 拖：状态里 len 不变、at 变；lens 拖：len 变、at 保留', () => {
    const st = dragState(); // at 0.5 / rail 52
    const biasNext = beamDragMove(st, { x: st.handle.parentCenter + 2, y: 28 });
    expect(biasNext.mode).toBe('bias');
    expect(biasNext.at).toBeCloseTo(0.75, 6); // (28 − 100) / (4 − 100)
    expect(biasNext.len).toBe(st.len); // 层距原样（gap 不变）
    expect(biasNext.moved).toBe(true);

    const lensNext = beamDragMove({ ...st, mode: 'lens' }, { x: st.handle.parentCenter, y: 12 });
    expect(lensNext.len).toBe(st.handle.startLen + 40); // 梁跟手（96 + 40）
    expect(lensNext.at).toBe(st.at); // 比例位保留
    expect(lensNext.moved).toBe(true);
  });

  it('未越过移动阈值 → moved 保持 false；提交返回 null（点击取消）', () => {
    const st = dragState();
    const same = beamDragMove(st, { x: st.handle.parentCenter, y: st.handle.rail });
    expect(same.moved).toBe(false);
    expect(beamDragCommit(same)).toBeNull();
  });

  it('★ at ≠ 0.5 起 lens 微拖：提交 = gap + Δ（不做 2×trunk 虚高跳变）', () => {
    // 用户序列：先拖主干抬梁（beamAt.up = 0.75 → rail 28），再拖梁中段微调层距
    const st = dragState(atOfUp, { mode: 'lens' });
    expect(st.len).toBe(96); // 出发点 = 真 gap
    const next = beamDragMove(st, { x: st.handle.parentCenter, y: st.startW.y - 10 });
    expect(next.len).toBe(106); // 修前：startLen 144 → 154（一拖就「弹开一截」）
    expect(beamDragCommit(next)).toEqual({ kind: 'lens', dir: 'up', len: 106 });
  });

  it('★ 提交互斥：bias 松手只提交 beamAt；lens 松手只提交 lens（单字段）', () => {
    const st = dragState(); // at 0.5
    const biasCommit = beamDragCommit(beamDragMove(st, { x: st.handle.parentCenter, y: 28 }));
    expect(biasCommit).toEqual({ kind: 'bias', dir: 'up', at: 0.75 });

    const lensCommit = beamDragCommit(
      beamDragMove({ ...st, mode: 'lens' }, { x: st.handle.parentCenter, y: 12 }),
    );
    expect(lensCommit).toEqual({ kind: 'lens', dir: 'up', len: st.handle.startLen + 40 });
  });
});

describe('预览：梁坐标与徽标文案（lens = 层距 / bias = 主干）', () => {
  it('★ bias 预览梁 = 比例位映射；徽标「主干 Npx」= round(gap × at)', () => {
    const st = dragState();
    const next = beamDragMove(st, { x: st.handle.parentCenter, y: 28 });
    expect(beamDragRail(next)).toBeCloseTo(28, 10);
    expect(beamRailAtRatio(next.handle, next.at)).toBeCloseTo(28, 10);
    expect(beamTrunkLen(next.handle, next.at)).toBe(72); // 96 × 0.75
    expect(beamDragBadge(next)).toBe('主干 72px');
  });

  it('★ lens 预览梁 = 梁跟手；徽标「层距 Npx」', () => {
    const st: BeamDragState = { ...dragState(), mode: 'lens', len: 136 };
    expect(beamDragRail(st)).toBe(12); // 起点 rail 52 − (136 − 96)
    expect(beamDragBadge(st)).toBe('层距 136px');
  });
});

describe('geometry 对齐：beamYForGroup / verticalBeamMap 吃比例位', () => {
  it('beamYForGroup 带 at：父→子按比例插值；缺省仍为旧中点', () => {
    const kids = upLinks().map((l) => l.to);
    expect(beamYForGroup(PARENT, kids, 'up')).toBe(52); // 旧公式逐值不变
    expect(beamYForGroup(PARENT, kids, 'up', 0.75)).toBeCloseTo(28, 10);
    expect(beamYForGroup(PARENT, kids, 'up', 0.25)).toBeCloseTo(76, 10);
  });

  it('★ verticalBeamMap 的 atOf 按「父 + 方向」取（缺省 = 中点）', () => {
    const links = upLinks();
    const first = links[0];
    if (first === undefined) throw new Error('夹具缺失连线');
    expect(verticalBeamMap(links, (l) => l.dir).get(first)).toBe(52);
    expect(verticalBeamMap(links, (l) => l.dir, atOfUp).get(first)).toBeCloseTo(28, 10);
  });
});
