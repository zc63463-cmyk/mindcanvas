/**
 * 框挂出几何（自 `frameLayout.ts` 按职责抽出；实现逐字保留、导出面向后兼容）。
 *
 * 管什么：挂点跨轴扇出（FO-FIX3）、挂出外包络估算（FO-C2.1）、跨轴推挤的唯一算法（FO-FIX4）、
 * 子树主侧/跨轴展开度、挂点落点（相对壳缘，FO-FIX1）。这些是**纯几何**：只吃盒与度量，
 * 不碰树结构、不碰缓存、不碰岛布局编排。
 *
 * 为什么单列：`frameLayout.ts` 长期超 600 行预算（拆分前 983），而本组函数与
 * 「岛布局编排 / 基座剪枝 / 跨 depth 守卫」没有耦合，单独放一处也让「实排与估算共用
 * 同一套公式」这条不变量更醒目（fanOut / sweep 被实排与外包络两处调用）。
 *
 * 兼容：`frameLayout.ts` 原样再导出本模块的公开符号（含 `FRAME_HANG_GAP` /
 * `FRAME_HANG_SIBLING_GAP` 两个既有常量）；既有 `from './frameLayout.js'` 的引用零改造。
 */
import type { EditableNode } from '../tree/treeOps.js';
import type { CenterSpec } from './forest.js';
import type { FrameHangRoot } from './framePartition.js';
import {
  H_GAP,
  V_GAP,
  type Box,
  type GrowDir,
  type LayoutNode,
  type LayoutResult,
  type MeasureFn,
} from './mindmap.js';

/** 挂点到**框壳外缘**的距离（沿子侧方向量取，px）——FO-FIX1 起相对壳缘、不再相对行缘。 */
export const FRAME_HANG_GAP = 48;
/**
 * 同一挂点行下**相邻空间子树**之间的间隙（沿跨轴，px）——FO-FIX3 的扇出间距。
 * 取经典布局的纵向同级间隙 {@link V_GAP}：让挂出组看起来与画布上的普通同级同档。
 */
export const FRAME_HANG_SIBLING_GAP = V_GAP;

/** 挂点扇出/推挤的**跨轴**：right/left → 纵向（Y）；up/down → 横向（X） */
export function isCrossVertical(direction: GrowDir): boolean {
  return direction === 'right' || direction === 'left';
}

/** 两盒并集（轴对齐） */
export function unionBox(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const r = Math.max(a.x + a.w, b.x + b.w);
  const btm = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: r - x, h: btm - y };
}

/**
 * 子树沿**主侧**（生长向）的展开度：节点近缘 → 子树最远点。
 * 与经典单侧布局同源：孩子排在父的远缘外 `gap`（横向 H_GAP / 纵向 V_GAP），取最深一支。
 */
export function subtreeMainExtent(
  node: EditableNode,
  measure: MeasureFn,
  vertical: boolean,
  /** 该节点的绝对深度（MEASURE-RANK：盒尺寸随视觉档分档，须逐层 +1） */
  depth = 0,
): number {
  const m = measure(node, depth);
  const own = vertical ? m.w : m.h; // 主侧：right/left → 宽；up/down → 高
  if (node.children.length === 0) return own;
  const gap = vertical ? H_GAP : V_GAP;
  let deepest = 0;
  for (const c of node.children) {
    const d = subtreeMainExtent(c, measure, vertical, depth + 1);
    if (d > deepest) deepest = d;
  }
  return own + gap + deepest;
}

/**
 * 子树的**跨轴展开度**（挂点组错开用）：与经典单侧布局的堆叠公式同源 ——
 * `max(自身跨轴尺寸, Σ 孩子展开度 + 间隙)`（对照 `mindmap.ts` 的 `subtreeHeightCached`）。
 * 与真实布局取同一规则，故同向子树的分带不会互相咬进；异构方向/带 dir 声明的子树是近似
 * （偏保守：自身插槽不小于实际），只会多留白、不会重叠。
 */
export function subtreeCrossExtent(
  node: EditableNode,
  measure: MeasureFn,
  vertical: boolean,
  /** 该节点的绝对深度（MEASURE-RANK：盒尺寸随视觉档分档，须逐层 +1） */
  depth = 0,
): number {
  const m = measure(node, depth);
  const own = vertical ? m.h : m.w;
  if (node.children.length === 0) return own;
  const gap = vertical ? V_GAP : H_GAP;
  let sum = 0;
  for (const c of node.children) sum += subtreeCrossExtent(c, measure, vertical, depth + 1) + gap;
  return Math.max(own, sum - gap);
}

/**
 * 挂点跨轴扇出中心（FO-FIX3，按 `hangRoots` 顺序）：按其挂点行分组，组内以
 * 子树跨轴展开度 + {@link FRAME_HANG_SIBLING_GAP} 居中于该行中线。n=1 时 = 行中线。
 *
 * 抽成公共函数供**两处**使用：真实挂点（`layoutIslandLocal`）与 FO-C2.1 的外包络估算——
 * 两边必须是同一套公式，否则占位会漏掉/多算挂出。
 */
export function fanOutHangCrossCenters(
  part: { hangRoots: readonly FrameHangRoot[] },
  boxes: ReadonlyMap<string, Box>,
  measure: MeasureFn,
  direction: GrowDir,
  /** 挂出子树根的绝对深度（MEASURE-RANK；缺省 0 = 旧行为） */
  hangBase = 0,
): number[] {
  const vertical = isCrossVertical(direction);
  const groups = new Map<string, number[]>();
  for (let i = 0; i < part.hangRoots.length; i += 1) {
    const hang = part.hangRoots[i];
    if (hang === undefined) continue;
    const list = groups.get(hang.outlineNodeId);
    if (list === undefined) groups.set(hang.outlineNodeId, [i]);
    else list.push(i);
  }
  const out: number[] = part.hangRoots.map(() => 0);
  for (const [rowId, indices] of groups) {
    const row = boxes.get(rowId);
    if (row === undefined) continue; // 防御：与 partition 同源，理论不可达
    const sizes = indices.map((i) => {
      const h = part.hangRoots[i];
      return h === undefined ? 0 : subtreeCrossExtent(h.spatialRoot, measure, vertical, hangBase);
    });
    let total = FRAME_HANG_SIBLING_GAP * (indices.length - 1);
    for (const s of sizes) total += s;
    let cursor = (vertical ? row.y + row.h / 2 : row.x + row.w / 2) - total / 2;
    for (let k = 0; k < indices.length; k += 1) {
      const size = sizes[k] ?? 0;
      const at = indices[k];
      if (at !== undefined) out[at] = cursor + size / 2;
      cursor += size + FRAME_HANG_SIBLING_GAP;
    }
  }
  return out;
}

/**
 * **挂出外包络**（FO-C2.1，局部坐标）：把 `hangRoots` 各岛的估算 AABB 并起来。
 *
 * - 跨轴：从 {@link fanOutHangCrossCenters}（= FIX3 实排输入）出发，用同一份跨轴展开度
 *   （{@link subtreeCrossExtent}）做与 FO-FIX4 **同一套**推挤（{@link sweepCrossSpans}）——
 *   故估算恒 ≥ 实排（FIX4 只把岛往下推，不会低于估算）。
 * - 主侧：壳缘外扩 `FRAME_HANG_GAP + subtreeMainExtent`（与 `hangOriginOf` 的中心口径对齐：
 *   中心 = 壳缘 + gap + 根主侧半宽 ⇒ 远端 = 壳缘 + gap + 子树主侧展开度）。
 * - 无挂出 → null（占位退化为描边壳，FO-C2 行为逐值不变）。
 */
export function hangEnvelopeLocal(
  part: { hangRoots: readonly FrameHangRoot[] },
  measure: MeasureFn,
  direction: GrowDir,
  crossCenters: readonly number[],
  outline: Box,
  /** 挂出子树根的绝对深度（MEASURE-RANK；缺省 0 = 旧行为） */
  hangBase = 0,
): Box | null {
  if (part.hangRoots.length === 0) return null;
  const vertical = isCrossVertical(direction);
  let mainMax = 0;
  const spans = part.hangRoots.map((h, i) => {
    const cross = subtreeCrossExtent(h.spatialRoot, measure, vertical, hangBase);
    const main = FRAME_HANG_GAP + subtreeMainExtent(h.spatialRoot, measure, vertical, hangBase);
    if (main > mainMax) mainMax = main;
    return { center: crossCenters[i] ?? 0, min: -cross / 2, max: cross / 2 };
  });
  const swept = sweepCrossSpans(spans);
  const near = swept.span.min;
  const far = swept.span.max;
  const crossSize = far - near;
  if (!Number.isFinite(crossSize) || crossSize <= 0) return null; // 防御：退化输入
  if (direction === 'left') return { x: outline.x - mainMax, y: near, w: mainMax, h: crossSize };
  if (direction === 'down') return { x: near, y: outline.y + outline.h, w: crossSize, h: mainMax };
  if (direction === 'up') return { x: near, y: outline.y - mainMax, w: crossSize, h: mainMax };
  return { x: outline.x + outline.w, y: near, w: mainMax, h: crossSize };
}

/**
 * 跨轴推挤的**唯一算法**（FO-FIX4 实排与 FO-C2.1 外包络估算共用）：
 * 按给定顺序扫一遍，若区间贴上前序占用区（`< 占用上界 + FRAME_HANG_SIBLING_GAP`），
 * 把它沿跨轴正方向推到紧贴占用区 + 间隙；只推不拉（保序、无振荡）、且绝不回退。
 *
 * @returns 调整后的中心 + 全部区间的跨轴并集范围
 */
export function sweepCrossSpans(
  items: ReadonlyArray<{ center: number; min: number; max: number; movable?: boolean }>,
): { centers: number[]; span: { min: number; max: number } } {
  let occupiedMax: number | null = null;
  const centers: number[] = [];
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const it of items) {
    const movable = it.movable ?? true;
    let center = it.center;
    if (movable && occupiedMax !== null && center + it.min < occupiedMax + FRAME_HANG_SIBLING_GAP) {
      center = occupiedMax + FRAME_HANG_SIBLING_GAP - it.min;
    }
    const max = center + it.max;
    occupiedMax = occupiedMax === null ? max : Math.max(occupiedMax, max);
    centers.push(center);
    if (center + it.min < lo) lo = center + it.min;
    if (max > hi) hi = max;
  }
  return { centers, span: { min: lo, max: hi } };
}

/** 岛（挂出子树整棵：根 + 全部后代）沿跨轴相对**岛根中心**的区间；缺盒/无 pos → null */
export function islandCrossSpan(
  spatial: LayoutResult,
  rootId: string,
  pos: { x: number; y: number } | undefined,
  vertical: boolean,
): { min: number; max: number } | null {
  if (pos === undefined) return null;
  const root = spatial.nodes.find((n) => n.node.id === rootId);
  if (root === undefined) return null;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const walk = (ln: LayoutNode): void => {
    const lo = vertical ? ln.box.y : ln.box.x;
    const hi = vertical ? ln.box.y + ln.box.h : ln.box.x + ln.box.w;
    if (lo < min) min = lo;
    if (hi > max) max = hi;
    for (const c of ln.children) walk(c);
  };
  walk(root);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  const center = vertical ? pos.y : pos.x;
  return { min: min - center, max: max - center };
}

/**
 * 跨挂点行的**挂出岛推挤**（FO-FIX4）：按 hangRoots 顺序扫一遍，若某岛的跨轴区间贴上了
 * 已占用区间（`< 占用上界 + FRAME_HANG_SIBLING_GAP`），就把它沿跨轴（正方向）整体推到
 * 紧贴占用区 + 间隙。跨轴 = right/left → Y、up/down → X；**主侧坐标一律不动**
 * （壳缘净空属 FO-FIX1，本函数只做跨轴推挤）。
 *
 * 只改 `pos`（中心）→ 由 `layoutForest` 重排该岛 ⇒ 岛内盒与连线自动按新坐标生成
 * （`shiftIsland` 平移副本 + 重建 links），不手工动 path、不写被缓存持有的对象。
 *
 * `n < 2` 或无 pos 的中心（forest 自动排布）原样返回（零成本、零行为变更）。
 */
export function deOverlapHangCenters(
  centers: readonly CenterSpec[],
  spatial: LayoutResult,
  vertical: boolean,
): readonly CenterSpec[] {
  if (centers.length < 2) return centers;
  const spans = centers.map((c) => islandCrossSpan(spatial, c.node.id, c.pos, vertical));
  if (spans.some((s) => s === null)) return centers; // 防御：量不到岛 AABB 就宁叠不崩
  let moved = false;
  const sequenced = sweepCrossSpans(
    centers.map((c, i) => {
      const span = spans[i];
      const pos = c.pos;
      return {
        center: pos === undefined ? 0 : vertical ? pos.y : pos.x,
        min: span?.min ?? 0,
        max: span?.max ?? 0,
        movable: pos !== undefined && span !== null,
      };
    }),
  );
  const out = centers.map((c, i) => {
    const before = c.pos;
    const after = sequenced.centers[i];
    if (before === undefined || after === undefined) return c;
    const current = vertical ? before.y : before.x;
    if (after === current) return c;
    moved = true;
    return vertical
      ? { ...c, pos: { x: before.x, y: after } }
      : { ...c, pos: { x: after, y: before.y } };
  });
  return moved ? out : centers;
}

/** 壳 AABB + 行盒 + 空间根度量 → 挂点（空间根**中心**落点；子侧由 `direction` 决定） */
export function hangOriginOf(
  shell: Box,
  row: Box,
  m: { w: number; h: number },
  direction: GrowDir,
): { x: number; y: number } {
  // 子侧距离从**壳缘**起算（FO-FIX1）；跨轴仍取挂点行的中线（挂点语义不变：挂在那一行上）
  const cx = row.x + row.w / 2;
  const cy = row.y + row.h / 2;
  if (direction === 'left') return { x: shell.x - FRAME_HANG_GAP - m.w / 2, y: cy };
  if (direction === 'down') return { x: cx, y: shell.y + shell.h + FRAME_HANG_GAP + m.h / 2 };
  if (direction === 'up') return { x: cx, y: shell.y - FRAME_HANG_GAP - m.h / 2 };
  return { x: shell.x + shell.w + FRAME_HANG_GAP + m.w / 2, y: cy };
}
