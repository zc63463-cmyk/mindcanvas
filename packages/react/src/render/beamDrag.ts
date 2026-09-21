/**
 * 共享梁拖拽（v1.7.0 · Phase 3；v1.11.0 双把手）：hub 出线的共享梁 = 该方向组
 * 「层距 + 梁比例位」的直接操纵把手。
 *
 * 纯逻辑模块（可测）：把手构建（hub 连线按「父 + 方向」分组 → 梁线段范围、当前层距、
 * 父出边 / 最近子入边、比例位）、命中分裂（trunk = 父出边 → 梁交点的干线带 /
 * rail = 共享梁中段，交汇垫优先 trunk）、拖拽映射（lens：行程轴位移 → 新层距，下限 14；
 * bias：指针在空隙轴上的位置 → 新比例位，gap 不变）、预览梁坐标与徽标文案。
 *
 * 交互契约（与 center 拖拽同款）：拖拽中只更新状态与预览叠层（梁线随指针移动 +
 * 像素徽标），**节点不动**；松手一次性提交（`onBeamChange`，单条 undo）——
 * lens 写 `lens[dir]`（布局权威重排子组）、bias 写 `beamAt[dir]`（短桩伸缩，子盒不动）。
 * 一次拖拽只写一个字段（互不串写）。
 */
import { BEAM_AT_DEFAULT, beamRailBetween, clampBeamAt } from '@mindcanvas/kernel';
import type { Box, GrowDir } from '@mindcanvas/kernel';
import type { LinkGeom } from './geometry.js';

export type BeamDir = 'up' | 'down' | 'left' | 'right';

/** 把手模式：lens = 整段层距（梁中段）；bias = 梁比例位（主干） */
export type BeamDragMode = 'lens' | 'bias';

/** 最小层距（与内核 SEPARATE_MARGIN 同值；react 不引内核私有常量，注释锚定） */
export const BEAM_MIN_LEN = 14;
/** 最大层距（与内核 BEAM_MAX_LEN 同值）：出线是相邻层距，超过即无意义且会把布局撑炸 */
export const BEAM_MAX_LEN = 600;
/** 梁命中容差（世界坐标 px）：梁是线段，命中区须是带状 */
export const BEAM_HIT_TOLERANCE = 8;
/**
 * 交汇垫半径（世界坐标 px）：主干与梁的 T 字交汇附近**优先判主干**。
 *
 * 用户摩擦入口在主干（「拖梁为什么子节点跟着跑」）——交汇处若判成 rail，
 * 改的是层距（子组外推），与意图相反；垫归 trunk，rail 命中区扣除本垫。
 */
export const BEAM_JUNCTION_PAD = 12;

/** 可拖拽的共享梁把手（一个 hub 节点的一个方向组 = 一根梁） */
export interface BeamHandle {
  fromId: string;
  dir: BeamDir;
  /** 梁坐标：up/down 为 y（横梁），left/right 为 x（竖梁） */
  rail: number;
  /** 梁线段在组轴上的范围（成员子节点中线 ∪ 父中线的最小/最大值） */
  lo: number;
  hi: number;
  /**
   * 起始组层距 = **真空隙** `|childEdge − parentEdge|`——lens 映射起点。
   *
   * 中点时代 `|rail − 父边| × 2` 与 gap 等值，但 `beamAt ≠ 0.5` 后 rail 偏离中点、
   * 该式恒虚高（主干拖过之后拖中段会让层距「弹开一截」）；故一律取真 gap。
   */
  startLen: number;
  /** 父出边坐标（沿空隙轴）——bias 映射起点 / trunk 带的一端 */
  parentEdge: number;
  /** 最近子入边坐标（沿空隙轴）——bias 映射终点 */
  childEdge: number;
  /** 主干在梁轴上的坐标（父盒中线）——trunk 带的轴；交汇垫以它为心 */
  parentCenter: number;
  /** 当前梁比例位（缺省 0.5）——bias 拖拽起点；lens 拖拽期间保持不变 */
  at: number;
}

/** 命中结果：把手 + 拖拽模式（trunk → bias / rail → lens） */
export interface BeamHit {
  handle: BeamHandle;
  mode: BeamDragMode;
}

/** 拖拽中的状态（MapView useState；结构供渲染叠层与提交） */
export interface BeamDragState {
  handle: BeamHandle;
  mode: BeamDragMode;
  pointerId: number;
  /** 按下时的世界坐标 */
  startW: { x: number; y: number };
  /** lens 模式：预览层距（随移动更新；bias 模式保持起始值） */
  len: number;
  /** bias 模式：预览比例位（随移动更新；lens 模式保持起始值） */
  at: number;
  /** 是否已越过拖拽阈值（未越过 = 点击，不提交） */
  moved: boolean;
  /** 最近世界坐标（徽标定位） */
  curW: { x: number; y: number };
}

/** 松手提交（单条 undo）：一次拖拽只写一个字段（lens 或 beamAt） */
export type BeamCommit =
  | { kind: 'lens'; dir: BeamDir; len: number }
  | { kind: 'bias'; dir: BeamDir; at: number };

/** 连线几何 + 声明方向（MapView 的 visibleLinkGeoms 子集；dir 缺省不入组） */
export type BeamLinkGeom = LinkGeom & { dir?: GrowDir };

/** 沿空隙轴（= trunk 方向）的坐标：up/down 看 y，left/right 看 x */
function acrossOf(dir: BeamDir, w: { x: number; y: number }): number {
  return dir === 'up' || dir === 'down' ? w.y : w.x;
}

/** 沿梁轴的坐标：up/down 看 x，left/right 看 y */
function alongOf(dir: BeamDir, w: { x: number; y: number }): number {
  return dir === 'up' || dir === 'down' ? w.x : w.y;
}

/**
 * 方向组的「父出边 / 最近子入边」（与内核 beamYUp/beamYDown/beamXLeft/beamXRight 同判据）：
 * up → 父顶边 / 最高子底缘；down → 父底边 / 最上子顶缘；right → 父右边 / 最左子左缘；
 * left → 父左边 / 最右子右缘。空组回退父边自比（gap = 0 → 比例位无意义）。
 */
function edgesOf(
  dir: BeamDir,
  from: Box,
  tos: readonly Box[],
): { parentEdge: number; childEdge: number } {
  const parentEdge =
    dir === 'up'
      ? from.y
      : dir === 'down'
        ? from.y + from.h
        : dir === 'right'
          ? from.x + from.w
          : from.x;
  const nearest = tos.map((b) =>
    dir === 'up' ? b.y + b.h : dir === 'down' ? b.y : dir === 'right' ? b.x : b.x + b.w,
  );
  const pick = dir === 'up' || dir === 'left' ? Math.max : Math.min;
  return { parentEdge, childEdge: nearest.length > 0 ? pick(...nearest) : parentEdge };
}

/**
 * 把 hub 连线按「父 + 方向」分组成梁把手。
 *
 * `railOf` 返回该连线的共享梁坐标（MapView 的 linkBeamYs/linkBeamXs 产出；组内成员同值，
 * 取首个命中即可），已吃 `beamAt` → 把手与屏幕上画出来的梁同源。
 * `atOf` 返回该组当前比例位（MapView 经 kernel `readBeamAt` 读父节点 note；缺省 0.5）。
 */
export function buildBeamHandles<L extends BeamLinkGeom>(
  links: readonly L[],
  railOf: (l: L) => number | undefined,
  atOf?: (fromId: string, dir: BeamDir, gap: number) => number,
): BeamHandle[] {
  const groups = new Map<
    string,
    { dir: BeamDir; rail: number; from: Box; tos: Box[]; fromId: string }
  >();
  for (const l of links) {
    const dir = l.dir;
    const rail = railOf(l);
    if (dir !== 'up' && dir !== 'down' && dir !== 'left' && dir !== 'right') continue;
    if (rail === undefined) continue;
    const key = `${l.fromId}|${dir}`;
    let g = groups.get(key);
    if (!g) {
      g = { dir, rail, from: l.from, tos: [], fromId: l.fromId };
      groups.set(key, g);
    }
    g.tos.push(l.to);
  }
  const out: BeamHandle[] = [];
  for (const g of groups.values()) {
    const vertical = g.dir === 'up' || g.dir === 'down';
    const { parentEdge, childEdge } = edgesOf(g.dir, g.from, g.tos);
    const gap = Math.abs(childEdge - parentEdge);
    const at = clampBeamAt(atOf?.(g.fromId, g.dir, gap) ?? BEAM_AT_DEFAULT, gap);
    // 梁线段范围：成员子节点中线 ∪ 父中线（沿组轴）
    const centers = g.tos.map((b) => (vertical ? b.x + b.w / 2 : b.y + b.h / 2));
    const parentCenter = vertical ? g.from.x + g.from.w / 2 : g.from.y + g.from.h / 2;
    centers.push(parentCenter);
    // lens 映射起点 = 真空隙（非 rail 派生：beamAt ≠ 0.5 时 rail 不在中点，派生式会虚高）
    const startLen = Math.max(BEAM_MIN_LEN, Math.round(gap));
    const lo = Math.min(...centers);
    const hi = Math.max(...centers);
    // 有限性护栏：动画插值帧的盒可能短暂含 NaN——NaN 把手不可拖（拖了会把 NaN 写进文档）
    const finite = [g.rail, startLen, lo, hi, parentEdge, childEdge, parentCenter, at].every(
      (v) => Number.isFinite(v),
    );
    if (!finite) continue;
    out.push({
      fromId: g.fromId,
      dir: g.dir,
      rail: g.rail,
      lo,
      hi,
      startLen,
      parentEdge,
      childEdge,
      parentCenter,
      at,
    });
  }
  return out;
}

/**
 * 命中分裂：先主干后梁中段。
 *
 * - **trunk**（bias）：|沿梁轴 − 父中线| ≤ {@link BEAM_JUNCTION_PAD}，且横跨落在
 *   父出边 ↔ 当前梁之间（含 ±{@link BEAM_HIT_TOLERANCE} 容差）——含交汇垫。
 * - **rail**（lens）：横跨距梁 ≤ 容差，沿梁轴落在梁段（±容差）内，且**在交汇垫之外**。
 * - 交汇垫优先 trunk（摩擦入口）；无命中 → null。
 */
export function hitBeamTarget(
  handles: readonly BeamHandle[],
  w: { x: number; y: number },
): BeamHit | null {
  for (const h of handles) {
    const along = alongOf(h.dir, w);
    const across = acrossOf(h.dir, w);
    const gapLo = Math.min(h.parentEdge, h.rail) - BEAM_HIT_TOLERANCE;
    const gapHi = Math.max(h.parentEdge, h.rail) + BEAM_HIT_TOLERANCE;
    if (
      Math.abs(along - h.parentCenter) <= BEAM_JUNCTION_PAD &&
      across >= gapLo &&
      across <= gapHi
    ) {
      return { handle: h, mode: 'bias' };
    }
    const onRail = Math.abs(across - h.rail) <= BEAM_HIT_TOLERANCE;
    const withinSpan = along >= h.lo - BEAM_HIT_TOLERANCE && along <= h.hi + BEAM_HIT_TOLERANCE;
    const outsidePad = Math.abs(along - h.parentCenter) > BEAM_JUNCTION_PAD;
    if (onRail && withinSpan && outsidePad) {
      return { handle: h, mode: 'lens' };
    }
  }
  return null;
}

/** 命中测试（旧调用面）：只关心「命中哪根梁」的悬停路径（光标按 dir 切换） */
export function hitBeamAt(
  handles: readonly BeamHandle[],
  w: { x: number; y: number },
): BeamHandle | null {
  return hitBeamTarget(handles, w)?.handle ?? null;
}

/**
 * bias 映射：指针在空隙轴上的位置 → 新比例位（gap 不变），PAD 钳制（trunk/stub ≥ 6px）。
 * 非法/零空隙 → 保持原比例位（不落 NaN）。
 */
export function beamAtAfterDrag(h: BeamHandle, cur: { x: number; y: number }): number {
  const across = acrossOf(h.dir, cur);
  const gap = h.childEdge - h.parentEdge;
  if (!Number.isFinite(across) || !Number.isFinite(gap) || gap === 0) return h.at;
  return clampBeamAt((across - h.parentEdge) / gap, Math.abs(gap));
}

/** 拖拽映射（lens）：沿行程轴的世界位移 → 新层距（up/left 拖负向 = 拉长；下限钳 14） */
export function beamLenAfterDrag(
  h: BeamHandle,
  start: { x: number; y: number },
  cur: { x: number; y: number },
): number {
  const delta =
    h.dir === 'up'
      ? start.y - cur.y
      : h.dir === 'down'
        ? cur.y - start.y
        : h.dir === 'right'
          ? cur.x - start.x
          : start.x - cur.x;
  const next = Math.min(
    BEAM_MAX_LEN,
    Math.max(BEAM_MIN_LEN, Math.round(h.startLen + delta)),
  );
  return Number.isFinite(next) ? next : h.startLen;
}

/**
 * 拖拽移动的纯状态转移（useMapGestures 与测试共用同一口径）：
 * bias → 只更新 `at`（`len` 原样）；lens → 只更新 `len`（`at` 原样）。
 */
export function beamDragMove(state: BeamDragState, w: { x: number; y: number }): BeamDragState {
  if (state.mode === 'bias') {
    const at = beamAtAfterDrag(state.handle, w);
    return { ...state, at, moved: state.moved || at !== state.at, curW: w };
  }
  const len = beamLenAfterDrag(state.handle, state.startW, w);
  return { ...state, len, moved: state.moved || len !== state.handle.startLen, curW: w };
}

/** 松手提交：未越过阈值 → null（点击取消）；否则按模式产出单字段提交 */
export function beamDragCommit(state: BeamDragState): BeamCommit | null {
  if (!state.moved) return null;
  return state.mode === 'bias'
    ? { kind: 'bias', dir: state.handle.dir, at: state.at }
    : { kind: 'lens', dir: state.handle.dir, len: state.len };
}

/** 比例位 → 梁坐标（bias 预览：节点不动，梁在父/子两边之间移动） */
export function beamRailAtRatio(h: BeamHandle, at: number): number {
  const rail = beamRailBetween(h.parentEdge, h.childEdge, at);
  return Number.isFinite(rail) ? rail : h.rail;
}

/** 拖拽预览时梁的瞬时坐标（lens = 梁跟手；bias = 比例位映射） */
export function beamRailDuringDrag(h: BeamHandle, len: number): number {
  if (!Number.isFinite(len)) return h.rail;
  const d = len - h.startLen;
  const rail =
    h.dir === 'up'
      ? h.rail - d
      : h.dir === 'down'
        ? h.rail + d
        : h.dir === 'right'
          ? h.rail + d
          : h.rail - d;
  return Number.isFinite(rail) ? rail : h.rail;
}

/** 拖拽预览梁坐标（按模式分派；MapView 叠层只消费这一个函数） */
export function beamDragRail(state: BeamDragState): number {
  return state.mode === 'bias'
    ? beamRailAtRatio(state.handle, state.at)
    : beamRailDuringDrag(state.handle, state.len);
}

/** 主干长度（px）= gap × at（PAD 钳制后取整）——bias 徽标的数字 */
export function beamTrunkLen(h: BeamHandle, at: number): number {
  const gap = Math.abs(h.childEdge - h.parentEdge);
  return Math.round(gap * clampBeamAt(at, gap));
}

/** 拖拽徽标文案：lens → 「层距 Npx」（整段）；bias → 「主干 Npx」（父→梁） */
export function beamDragBadge(state: BeamDragState): string {
  return state.mode === 'bias'
    ? `主干 ${beamTrunkLen(state.handle, state.at)}px`
    : `层距 ${state.len}px`;
}
