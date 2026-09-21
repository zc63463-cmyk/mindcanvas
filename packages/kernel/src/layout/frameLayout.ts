/**
 * 框布局岛（FO-B1 · 设计 §5.1「布局与挂点」）：
 *
 * 1. **大纲区**：`d ∈ [0, depth]` 的行按前序纵向堆叠（缩进随相对深度）；
 * 2. **挂点**：仅 `d === depth` 的行在**子侧**有逻辑锚点（非协议节点）；
 * 3. **空间层**：`d > depth` 的子树从对应挂点起，交给**现有**单子树布局继续排——
 *    本模块**不重写**布局算法：每个挂出子树作为一个中心喂给 `layoutForest`
 *    （`pos` = 挂点值），由其完成「局部布局 → 平移 → 岛内连线重建」。
 *
 * 为什么相对深度自算而不调 `relativeDepth` 逐节点：与 `partitionFrameSubtree` **同一次 DFS**
 * 同判据（框根 d=0、`d === depth` 即挂点行）——两者必须逐项一致（盒键序 = `outlineIds`，
 * 单测锁死）；分成两趟反而制造分叉机会。`depth` 收敛式与 partition 同款。
 *
 * 与「升格岛」（islands.ts）的分工：升格 = 把子树**提出来**成独立中心（G1 语义）；
 * 框岛 = 同一棵树里的**局部可写大纲 + 挂载层**，不改拓扑、不动 `projectIslands` 语义。
 *
 * ── 编排与守卫（本文件下半部） ─────────────────────────────────────────────
 * `expandFrameIslands`：基座布局（框内子树已剪枝，见 `framePrunedCollapsed`）→ 岛展开。
 * `frameLayerOf` / `crossesFrameDepthBoundary`：跨 depth 边界改层级的一期守卫（设计 §5.2），
 * 层级口径与岛布局同源（最近成框祖先 + 相对深度），供编辑侧（controller）在 move-node 处拦截。
 */
import { frameOf } from '../protocol/frame.js';
import type { EditableNode } from '../tree/treeOps.js';
import { linkGeometry } from './branching.js';
import { FRAME_ROW_INDENT, frameRowMetrics } from './frameMeasure.js';
import { partitionFrameSubtree, type FrameHangRoot } from './framePartition.js';
import { layoutForest, type CenterSpec } from './forest.js';
import type { CharMeasure } from './measure.js';
import {
  H_GAP,
  V_GAP,
  isGrowDir,
  layoutBounds,
  type Box,
  type GrowDir,
  type LayoutCache,
  type LayoutNode,
  type LayoutResult,
  type LinkGeometry,
  type MeasureFn,
} from './mindmap.js';

/** 大纲行缩进（每级相对深度，px）——行几何常量的事实源在 `frameMeasure.ts`，此处转出保持既有导入点 */
export { FRAME_ROW_INDENT };
/** 相邻大纲行间距（px） */
export const FRAME_ROW_GAP = 4;
/**
 * 挂点到**框壳外缘**的距离（沿子侧方向量取，px）——FO-FIX1 起相对壳缘、不再相对行缘。
 *
 * 为什么不能相对行缘量（原实现）：行有缩进（`rel × FRAME_ROW_INDENT`），左侧挂点会被
 * 缩进吃掉净空——rel=1 时净空只剩 `48 − FRAME_SHELL_PAD − 18 = 18px`，rel≥3 时挂点
 * 直接落进壳内（用户实测「挂出支贴住/压进框壳右缘」）。相对壳缘后四个方向净空恒为本值。
 */
export const FRAME_HANG_GAP = 48;
/**
 * 同一挂点行下**相邻空间子树**之间的间隙（沿跨轴，px）——FO-FIX3 的扇出间距。
 * 取经典布局的纵向同级间隙 {@link V_GAP}：让挂出组看起来与画布上的普通同级同档。
 */
export const FRAME_HANG_SIBLING_GAP = V_GAP;
/**
 * 框壳内边距（世界 px）：**壳 AABB = 大纲行包围盒 + 2×本值**。
 *
 * FO-C2 起这个壳是**布局体积**（不只是画出来的边框）：`createFrameShellMeasure` 让成框根
 * 在基座布局里就占住壳尺寸，于是邻节点/邻岛不压框、框内换行撑高会推动邻居重排。
 * 渲染侧 `FrameOutline` 的壳算式必须与本值同源（同一常量，不允许各写一份）。
 */
export const FRAME_SHELL_PAD = 12;

/** 行度量相关选项（岛布局与壳度量**必须传同一份**，否则壳尺寸与画出来的壳不一致） */
export interface FrameRowOptions {
  /** 字符度量（框内 text 行折行；缺省 → 内核估算，见 `frameMeasure.frameRowMetrics`） */
  textMeasure?: CharMeasure;
  /**
   * 行附属区高度（幕布注释 / 固定笔记 / 快速注释等）：叠在紧凑正文行**之上**。
   * 内核不认识这些宿主侧字段（高度估算住在 react 层），故由宿主注入；缺省 0。
   * 不注入的后果：附属区浮层与行盒错位（正文行按紧凑高排，注释却按旧卡高定位）。
   */
  rowAuxH?: (node: EditableNode) => number;
}

export interface FrameIslandArgs extends FrameRowOptions {
  /** 框根（`d = 0` = 框头行） */
  frameRoot: EditableNode;
  /** 进大纲的相对深度上限（`d ≤ depth`；正常由 `clampFrameDepth` 产出） */
  depth: number;
  measure: MeasureFn;
  /** 框头行盒**左上角**的落点（FO-C2 起由基座给出壳盒 → 编排层传 `壳左上角 + FRAME_SHELL_PAD`） */
  origin: { x: number; y: number };
  /** 挂点朝向 = 子侧方向（right/left 走行右/左缘，down/up 走行下/上缘） */
  direction: GrowDir;
}

export interface FrameIslandLayout {
  /** 大纲层（`d ∈ [0, depth]`）全部节点的盒；**键序 = `partitionFrameSubtree.outlineIds`** */
  boxes: Map<string, Box>;
  /** 大纲区总高（`origin.y` → 最深行底边） */
  outlineHeight: number;
  /**
   * **描边壳** AABB（世界坐标 = 大纲行包围盒 + 2×{@link FRAME_SHELL_PAD}）——`FrameOutline`
   * 画出来的那个灰框；不含挂出子树。
   */
  shell: Box;
  /**
   * **占位壳** AABB（FO-C2.1）= 描边壳 ∪ **挂出外包络**（含 `FRAME_HANG_GAP`、跨轴扇出/推挤后的
   * 堆叠）——基座布局给成框根的体积（`createFrameShellMeasure` 同源），恒 ⊇ `shell`。
   * 不变量：**占位 ≥ 描边**（描边仍贴大纲，不把挂出画进灰框）。
   */
  place: Box;
  /** 挂点：key = `spatialRoot.id`；值 = 空间子树**根中心**（与 `CenterSpec.pos` 同口径） */
  hangOrigins: Map<string, { x: number; y: number }>;
}

/** 相对深度收敛（与 `framePartition` 同款：非有限 → 0；负数/小数 → ≥0 整数） */
function islandDepth(depth: number): number {
  return Number.isFinite(depth) ? Math.max(0, Math.floor(depth)) : 0;
}

/**
 * 布局单个框岛（纯函数、零副作用、不搬家）：只产出**几何**——
 * 大纲行盒 + 挂点；空间层由调用方交给现有布局（`expandFrameIslands` 即该编排）。
 */
export function layoutFrameIsland(args: FrameIslandArgs): FrameIslandLayout {
  const { frameRoot, measure, origin, direction, textMeasure, rowAuxH } = args;
  const local = layoutIslandLocal(frameRoot, args.depth, measure, direction, {
    textMeasure,
    rowAuxH,
  });
  const dx = origin.x;
  const dy = origin.y;
  const boxes = new Map<string, Box>();
  for (const [id, b] of local.boxes) boxes.set(id, { ...b, x: b.x + dx, y: b.y + dy });
  const hangOrigins = new Map<string, { x: number; y: number }>();
  for (const [id, p] of local.hangOrigins) hangOrigins.set(id, { x: p.x + dx, y: p.y + dy });
  return {
    boxes,
    outlineHeight: local.outlineHeight,
    shell: { ...local.outline, x: local.outline.x + dx, y: local.outline.y + dy },
    place: { ...local.place, x: local.place.x + dx, y: local.place.y + dy },
    hangOrigins,
  };
}

/** 岛几何（**局部坐标**：大纲行从 (0,0) 起排）——描边壳 / 占位壳 / 挂点的唯一算式 */
interface IslandLocal {
  boxes: Map<string, Box>;
  outlineHeight: number;
  /** 描边壳（行包围盒 + pad） */
  outline: Box;
  /** 占位壳 = 描边壳 ∪ 挂出外包络（FO-C2.1） */
  place: Box;
  hangOrigins: Map<string, { x: number; y: number }>;
}

/**
 * 算一份局部岛几何（零副作用、与落点无关）。
 *
 * 为什么局部：FO-C2.1 的占位壳要含**挂出外包络**，而挂出的绝对坐标又依赖基座给出的壳落点
 * （鸡生蛋）—— 故一切先按「大纲行从 (0,0) 起排」的局部坐标算，再由调用方平移到落点。
 */
function layoutIslandLocal(
  frameRoot: EditableNode,
  depthArg: number,
  measure: MeasureFn,
  direction: GrowDir,
  opts: FrameRowOptions,
): IslandLocal {
  const depth = islandDepth(depthArg);
  const part = partitionFrameSubtree(frameRoot, depth);
  const { textMeasure, rowAuxH } = opts;

  const boxes = new Map<string, Box>();
  let cursorY = 0;
  const walk = (node: EditableNode, d: number): void => {
    // 框内每一行（含框头 d=0）都用**紧凑行度量**：FO-C1 起行盒 = 固定内容列宽折行 +
    // 宿主附属区高度，不再取画布节点卡 measure。框头行曾经保持「基座盒」，是因为上游父子边
    // 端点按基座盒预计算；FO-C2 把基座盒改成**壳盒**（见 createFrameShellMeasure）后，
    // 这条例外随之消失：壳 = 行包围盒 + padding，行全部坐在壳内，上游边端点落在壳缘。
    const m = frameRowMetrics(node, d, textMeasure);
    const auxH = rowAuxH === undefined ? 0 : Math.max(0, rowAuxH(node));
    boxes.set(node.id, { x: d * FRAME_ROW_INDENT, y: cursorY, w: m.w, h: m.h + auxH });
    cursorY += m.h + auxH + FRAME_ROW_GAP;
    if (d === depth) return; // 挂点行：孩子整棵属空间层（不下行，与 partition 同判据）
    for (const child of node.children) walk(child, d + 1);
  };
  walk(frameRoot, 0);
  const outlineHeight = Math.max(0, cursorY - FRAME_ROW_GAP);
  const outline = shellOfRows(boxes, { x: 0, y: 0 });

  // 挂点（FO-FIX3）：同一挂点行下可能有 **≥2 个**空间根（对该行多次 Enter 建同级）。
  // 主侧距离仍相对壳缘（FO-FIX1 净空）；**跨轴**（right/left → Y；up/down → X）按各子树
  // 展开度 + FRAME_HANG_SIBLING_GAP 分组错开，整组对齐该行中线 —— 否则多个中心会拿到
  // 同一个世界点，`layoutForest` 对有 pos 的中心「原样使用」→ 多岛叠画（用户所见「发厚」）。
  // n=1 时组宽 = 自身、中心 = 行中线 → 与挂点单点口径逐值一致（既有几何零回归）。
  const crossCenters = fanOutHangCrossCenters(part, boxes, measure, direction);
  const hangOrigins = new Map<string, { x: number; y: number }>();
  const vertical = isCrossVertical(direction);
  for (let i = 0; i < part.hangRoots.length; i += 1) {
    const hang = part.hangRoots[i];
    if (hang === undefined) continue; // noUncheckedIndexedAccess 收窄
    const row = boxes.get(hang.outlineNodeId);
    if (row === undefined) continue; // 防御：与 partition 同源，理论不可达
    const base = hangOriginOf(outline, row, measure(hang.spatialRoot), direction);
    const cross = crossCenters[i] ?? 0;
    hangOrigins.set(
      hang.spatialRoot.id,
      vertical ? { x: base.x, y: cross } : { x: cross, y: base.y },
    );
  }

  // FO-C2.1：占位壳 = 描边壳 ∪ 挂出外包络（无挂出 → 逐值等于描边壳）
  const envelope = hangEnvelopeLocal(part, measure, direction, crossCenters, outline);
  const place = envelope === null ? outline : unionBox(outline, envelope);
  return { boxes, outlineHeight, outline, place, hangOrigins };
}

/**
 * 挂点跨轴扇出中心（FO-FIX3，按 `hangRoots` 顺序）：按其挂点行分组，组内以
 * 子树跨轴展开度 + {@link FRAME_HANG_SIBLING_GAP} 居中于该行中线。n=1 时 = 行中线。
 *
 * 抽成公共函数供**两处**使用：真实挂点（`layoutIslandLocal`）与 FO-C2.1 的外包络估算——
 * 两边必须是同一套公式，否则占位会漏掉/多算挂出。
 */
function fanOutHangCrossCenters(
  part: { hangRoots: readonly FrameHangRoot[] },
  boxes: ReadonlyMap<string, Box>,
  measure: MeasureFn,
  direction: GrowDir,
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
      return h === undefined ? 0 : subtreeCrossExtent(h.spatialRoot, measure, vertical);
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
function hangEnvelopeLocal(
  part: { hangRoots: readonly FrameHangRoot[] },
  measure: MeasureFn,
  direction: GrowDir,
  crossCenters: readonly number[],
  outline: Box,
): Box | null {
  if (part.hangRoots.length === 0) return null;
  const vertical = isCrossVertical(direction);
  let mainMax = 0;
  const spans = part.hangRoots.map((h, i) => {
    const cross = subtreeCrossExtent(h.spatialRoot, measure, vertical);
    const main = FRAME_HANG_GAP + subtreeMainExtent(h.spatialRoot, measure, vertical);
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

/** 两盒并集（轴对齐） */
function unionBox(a: Box, b: Box): Box {
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
function subtreeMainExtent(node: EditableNode, measure: MeasureFn, vertical: boolean): number {
  const m = measure(node);
  const own = vertical ? m.w : m.h; // 主侧：right/left → 宽；up/down → 高
  if (node.children.length === 0) return own;
  const gap = vertical ? H_GAP : V_GAP;
  let deepest = 0;
  for (const c of node.children) {
    const d = subtreeMainExtent(c, measure, vertical);
    if (d > deepest) deepest = d;
  }
  return own + gap + deepest;
}

/** 挂点扇出/推挤的**跨轴**：right/left → 纵向（Y）；up/down → 横向（X） */
function isCrossVertical(direction: GrowDir): boolean {
  return direction === 'right' || direction === 'left';
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
function deOverlapHangCenters(
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

/**
 * 跨轴推挤的**唯一算法**（FO-FIX4 实排与 FO-C2.1 外包络估算共用）：
 * 按给定顺序扫一遍，若区间贴上前序占用区（`< 占用上界 + FRAME_HANG_SIBLING_GAP`），
 * 把它沿跨轴正方向推到紧贴占用区 + 间隙；只推不拉（保序、无振荡）、且绝不回退。
 *
 * @returns 调整后的中心 + 全部区间的跨轴并集范围
 */
function sweepCrossSpans(
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
function islandCrossSpan(
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
 * 子树的**跨轴展开度**（挂点组错开用）：与经典单侧布局的堆叠公式同源 ——
 * `max(自身跨轴尺寸, Σ 孩子展开度 + 间隙)`（对照 `mindmap.ts` 的 `subtreeHeightCached`）。
 * 与真实布局取同一规则，故同向子树的分带不会互相咬进；异构方向/带 dir 声明的子树是近似
 * （偏保守：自身插槽不小于实际），只会多留白、不会重叠。
 */
function subtreeCrossExtent(node: EditableNode, measure: MeasureFn, vertical: boolean): number {
  const m = measure(node);
  const own = vertical ? m.h : m.w;
  if (node.children.length === 0) return own;
  const gap = vertical ? V_GAP : H_GAP;
  let sum = 0;
  for (const c of node.children) sum += subtreeCrossExtent(c, measure, vertical) + gap;
  return Math.max(own, sum - gap);
}

/** 大纲行包围盒 + 2×{@link FRAME_SHELL_PAD}（壳 AABB 的唯一算式；`boxes` 为空时退化为 origin 点） */
function shellOfRows(boxes: ReadonlyMap<string, Box>, origin: { x: number; y: number }): Box {
  let x0 = origin.x;
  let y0 = origin.y;
  let x1 = origin.x;
  let y1 = origin.y;
  let any = false;
  for (const b of boxes.values()) {
    if (!any) {
      x0 = b.x;
      y0 = b.y;
      x1 = b.x + b.w;
      y1 = b.y + b.h;
      any = true;
      continue;
    }
    if (b.x < x0) x0 = b.x;
    if (b.y < y0) y0 = b.y;
    if (b.x + b.w > x1) x1 = b.x + b.w;
    if (b.y + b.h > y1) y1 = b.y + b.h;
  }
  return {
    x: x0 - FRAME_SHELL_PAD,
    y: y0 - FRAME_SHELL_PAD,
    w: x1 - x0 + FRAME_SHELL_PAD * 2,
    h: y1 - y0 + FRAME_SHELL_PAD * 2,
  };
}

/**
 * 框壳几何（FO-C2.1，**局部坐标**：大纲行从 (0,0) 起排）——描边壳 / 占位壳 / 落点偏移。
 *
 * 落点偏移 `(dx, dy)` = 行起点相对**占位盒左上角**的位移（= `-place.x/y`）：
 * 占位盒含挂出外包络后可能向左/上扩（例如挂出组很高、跨轴扇出越过大纲壳上缘），
 * 此时行要相应下移/右移，才能让「基座盒 = 占位壳」与真实几何对齐。
 * 无挂出时 `place === outline` ⇒ `(dx,dy) = (PAD,PAD)`（= FO-C2 逐值行为）。
 */
export interface FrameShellGeometry {
  /** 描边壳（`FrameOutline` 画出来的框） */
  outline: Box;
  /** 占位壳（= outline ∪ 挂出外包络；恒 ⊇ outline） */
  place: Box;
  /** 行起点相对占位盒左上角的偏移 */
  dx: number;
  dy: number;
}

/** 算一份局部框壳几何（与 `layoutFrameIsland` 同一套行度量 + 同一份挂出估算） */
export function frameShellGeometry(
  frameRoot: EditableNode,
  depth: number,
  measure: MeasureFn,
  opts: FrameRowOptions & { direction?: GrowDir } = {},
): FrameShellGeometry {
  const { direction, ...rowOpts } = opts;
  const local = layoutIslandLocal(
    frameRoot,
    depth,
    measure,
    direction ?? islandDirOf(frameRoot),
    rowOpts,
  );
  return {
    outline: local.outline,
    place: local.place,
    dx: -local.place.x,
    dy: -local.place.y,
  };
}

/**
 * 占位壳**尺寸**（世界 px）：与 `layoutFrameIsland` 同一套行度量算出来的占位 AABB 宽高。
 *
 * FO-C2.1 起 = **大纲壳 ∪ 挂出外包络**（含 `FRAME_HANG_GAP` + 跨轴扇出/推挤）；无挂出时
 * 逐值等于「仅大纲壳」（FO-C2 行为不变）。描边壳（画出来的灰框）仍是 `island.shell`。
 */
export function frameShellSize(
  frameRoot: EditableNode,
  depth: number,
  measure: MeasureFn,
  opts: FrameRowOptions & { direction?: GrowDir } = {},
): { w: number; h: number } {
  const g = frameShellGeometry(frameRoot, depth, measure, opts);
  return { w: g.place.w, h: g.place.h };
}

/**
 * **框壳度量**（FO-C2）：基座布局用的 `MeasureFn` —— 成框根返回**壳尺寸**（占位体积），
 * 其余节点原样透传 `base`。
 *
 * 为什么在基座 measure 上解决，而不是布局后 `separateTree`：
 *  - 分离发生在基座布局内部（`layoutMindmapBranched` ④），布局产出的**已带壳体积**，
 *    邻居在第一帧就被摆在外面 —— 不需要「展开后再分离 + 重建被移动节点的连线」
 *    （`separateTree` 只挪盒，旧 `path` 会悬空，重建要走各自的线型变体，风险更大）；
 *  - 壳尺寸是**纯函数**（行度量 + 固定列宽 + 宿主附属区），布局前就能算准，故不是「预估」；
 *  - 无 dir 声明的文档走 `layoutMindmap` 回退路径：那里没有 `separateTree`，但兄弟按
 *    **子树高度分带**，壳高度直接决定分带 —— 同样成立（FRAME-C2 单测两侧都覆盖）。
 *
 * 递归：嵌套成框（空间挂载层）以自身壳尺寸入账（`shellMeasure` 自引用，深度有限）。
 * 成本：每个成框根每次度量算一遍岛行（O(行数)，行数 = 框内节点数）——框规模有限，
 * 且基座布局对摆过的工作有缓存（`LayoutCache` 按节点身份命中）。
 */
export function createFrameShellMeasure(base: MeasureFn, opts: FrameRowOptions = {}): MeasureFn {
  const shellMeasure: MeasureFn = (node) => {
    const spec = frameOf(node.note);
    if (spec === undefined) return base(node);
    // 挂出方向同样取 note.dir（与 expandOne 的 islandDirOf 同源）——外包络长在哪一侧由此决定
    const size = frameShellSize(node, spec.depth, shellMeasure, {
      ...opts,
      direction: islandDirOf(node),
    });
    return { w: size.w, h: size.h };
  };
  return shellMeasure;
}

/** 壳 AABB + 行盒 + 空间根度量 → 挂点（空间根**中心**落点；子侧由 `direction` 决定） */
function hangOriginOf(
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

// ── 编排：基座剪枝 → 岛展开 ─────────────────────────────────────────────────

/** 树内全部成框节点（前序；含根自身与嵌套框；只认合法 `frameOf` 形态） */
export function collectFrameRoots(root: EditableNode): EditableNode[] {
  const out: EditableNode[] = [];
  const walk = (node: EditableNode): void => {
    if (frameOf(node.note) !== undefined) out.push(node);
    for (const child of node.children) walk(child);
  };
  walk(root);
  return out;
}

/**
 * 基座布局用的剪枝集 = 用户折叠 ∪ 全部框根（框内子树由岛接管，**不得**同时被常规布局摆放）。
 *
 * 记忆化（键 = 折叠集**对象身份** + 框根 id 序列）：必须返回**同一对象**——内核布局函数按
 * `cache.collapsedKey === collapsedIds`（身份比较）判缓存有效性，逐次新建 Set 会让
 * `LayoutCache` 每次失效（编辑一次全量重排）。身份纪律与 `controller.collapsed` 的
 * 「toggle 产出新引用」一致：成员变化 ⇒ 身份变化 ⇒ 缓存作废，正确。
 */
export function framePrunedCollapsed(
  collapsedIds: Set<string>,
  frameRoots: readonly EditableNode[],
): Set<string> {
  if (frameRoots.length === 0) return collapsedIds;
  const frameKey = frameRoots.map((n) => n.id).join(',');
  const hit = pruneCache.get(collapsedIds);
  if (hit !== undefined && hit.frameKey === frameKey) return hit.set;
  const set = new Set(collapsedIds);
  for (const n of frameRoots) set.add(n.id);
  pruneCache.set(collapsedIds, { frameKey, set });
  return set;
}

const pruneCache = new WeakMap<Set<string>, { frameKey: string; set: Set<string> }>();

export interface FrameIslandOptions extends FrameRowOptions {
  /** 空间层自动排布间距（透传 `layoutForest`） */
  gap?: number;
  /** 增量缓存（透传——挂出子树身份稳定时可命中岛级缓存） */
  cache?: LayoutCache;
  measureKey?: string;
}

/**
 * 岛展开：把基座布局里「只剩框头」的成框节点换成一整座岛。
 *
 * 前置契约（编排层负责，见 `layoutDemo`）：基座布局的 `collapsedIds` 必须是
 * `framePrunedCollapsed(collapsedIds, collectFrameRoots(root))`——否则框内子树已被
 * 常规布局摆过一次，展开会重复摆放。
 *
 * 产出口径：
 *  - 基座盒 = **壳盒**（FO-C2：`createFrameShellMeasure` 在基座前注入）⇒ 上游父子边端点
 *    落在壳缘、不动基座 links；岛内行盒从 `壳左上角 + FRAME_SHELL_PAD` 起排；
 *  - 岛内新节点前序紧随其框头（维持 `nodes` 前序契约）；
 *  - `links` = 基座 links（原样）+ 岛内 links（挂点连线 + 空间子树内部连线）；
 *  - `bounds` 全量重算（fit / cull 用）。
 *
 * 折叠交互（设计 §5.2）：框根在**用户折叠集**中 → 整岛隐藏（不展开）。
 * ⚠️ 剪枝集里恒含全部框根，故**不能**拿剪枝集当隐藏判据——本函数以传入的
 * `collapsedIds`（= 用户折叠）判定，剪枝集在内部按需重算（同一记忆化对象，缓存键不抖动）。
 */
export function expandFrameIslands(
  base: LayoutResult,
  root: EditableNode,
  measure: MeasureFn,
  collapsedIds: Set<string>,
  opts: FrameIslandOptions = {},
): LayoutResult {
  const frames = base.nodes.filter(
    (ln) => frameOf(ln.node.note) !== undefined && !collapsedIds.has(ln.node.id),
  );
  if (frames.length === 0) return base; // 无框 / 全部隐藏 → 引用复用（零行为变更）

  const ctx: ExpandCtx = {
    measure,
    collapsed: collapsedIds,
    prune: framePrunedCollapsed(collapsedIds, collectFrameRoots(root)),
    opts,
    links: [],
    dropped: new Set<string>(),
    spatialDropped: new Set<string>(),
  };
  const replaced = new Map<string, LayoutNode>();
  for (const ln of frames) replaced.set(ln.node.id, expandOne(ln, ctx, 0));

  const nodes: LayoutNode[] = [];
  for (const ln of base.nodes) {
    const repl = replaced.get(ln.node.id);
    if (repl === undefined) {
      // 岛内节点由岛重建（`expandOne` 已把它们登记进 dropped）——
      // 基座里若仍持有旧副本（布局根不入折叠判定，见 ExpandCtx.dropped 注释），此处丢弃。
      if (!ctx.dropped.has(ln.node.id)) nodes.push(ln);
      continue;
    }
    pushPreorder(repl, nodes);
  }
  // 基座连线先按 dropped 过滤，再并入岛内连线（岛内节点 id 同在 dropped 中，顺序不可颠倒）
  const keptBaseLinks = base.links.filter(
    (l) => !ctx.dropped.has(l.fromId) && !ctx.dropped.has(l.toId),
  );
  return { nodes, links: [...keptBaseLinks, ...ctx.links], bounds: layoutBounds(nodes) };
}

interface ExpandCtx {
  measure: MeasureFn;
  /** 用户折叠集（隐藏判据；设计 §5.2） */
  collapsed: Set<string>;
  /** 基座/空间层共用的剪枝集（含全部框根） */
  prune: Set<string>;
  opts: FrameIslandOptions;
  /** 岛内连线收集口（挂点连线 + 空间子树内部连线） */
  links: LinkGeometry[];
  /**
   * 岛内节点 id（不含框根）：一律以岛的产出为准。
   * 为什么不能假设基座一定剪过：`layoutMindmap`（无 dir 声明的回退）与
   * `layoutMindmapBranched` 的骨架对**布局根自身**不做折叠判定——框根正好是
   * 布局根时（文档根成框 / 框根同时是中心），其子树已被无条件展开过一次；
   * 这些旧副本必须丢弃（否则同 id 双份：渲染取盒错位、连线重复）。
   */
  dropped: Set<string>;
  /**
   * **空间层内**被嵌套岛替换掉的子树 id（FO-FIX1）。
   *
   * 与 `dropped` 的区别：`dropped` 含**本框根自己的整棵后代**（那是剪枝语义，不是替换），
   * 拿它过滤空间层树边会把该层全部合法连线一起丢掉。本集合只装「空间层里另有岛接管」的
   * 子树——只有这些节点的空间层旧树边才是陈旧边（新边由递归 `expandOne` 权威产出）。
   */
  spatialDropped: Set<string>;
}

/**
 * 展开一个成框节点（可嵌套：空间挂载层上的框根由 `spliceSpatial` 递归进来）。
 *
 * @param ln            该框根的 LayoutNode（盒已定：基座或空间层布局给出）
 * @param depthOffset   该盒所属布局的深度基准（嵌套时为外层已累计的偏移）
 */
function expandOne(ln: LayoutNode, ctx: ExpandCtx, depthOffset: number): LayoutNode {
  const spec = frameOf(ln.node.note);
  if (spec === undefined) return ln; // 防御：调用方已过滤
  const dir = islandDirOf(ln.node);
  // FO-C2.1：基座给成框根定出的盒是**占位壳盒**（`createFrameShellMeasure` = 描边壳 ∪ 挂出
  // 外包络）。行起点 = 占位盒左上角 + (dx,dy)：无挂出时 (dx,dy) = (PAD,PAD)（= C2 逐值），
  // 有挂出且外包络向壳左/上扩时行会相应内移，使「基座盒 = 占位壳」与真实几何对齐。
  const shellGeom = frameShellGeometry(ln.node, spec.depth, ctx.measure, {
    direction: dir,
    textMeasure: ctx.opts.textMeasure,
    rowAuxH: ctx.opts.rowAuxH,
  });
  const island = layoutFrameIsland({
    frameRoot: ln.node,
    depth: spec.depth,
    measure: ctx.measure,
    origin: { x: ln.box.x + shellGeom.dx, y: ln.box.y + shellGeom.dy },
    direction: dir,
    textMeasure: ctx.opts.textMeasure,
    rowAuxH: ctx.opts.rowAuxH,
  });
  const part = partitionFrameSubtree(ln.node, spec.depth);
  markSubtreeIds(ln.node, ctx.dropped); // 岛内节点以岛产出为准（见 ExpandCtx.dropped）

  // ① 空间层：挂出子树各作一个中心，pos = 挂点 → 复用 layoutForest 的局部布局/平移/连线
  const centers: CenterSpec[] = [];
  for (const hang of part.hangRoots) {
    const pos = island.hangOrigins.get(hang.spatialRoot.id);
    if (pos === undefined) continue;
    centers.push({ node: hang.spatialRoot, dir, pos });
  }
  const forestOpts = {
    gap: ctx.opts.gap,
    cache: ctx.opts.cache,
    measureKey: ctx.opts.measureKey,
  };
  // FO-FIX4：**不同挂点行**的挂出岛各自锚在行中线上，而行距（≈22 + FRAME_ROW_GAP）远小于
  // 子树跨轴展开度 → 两岛的父子会在跨轴压叠（用户截图：两父亲的下一层孩子在右侧叠画）。
  // 先跑一遍 forest 量出各岛 AABB，再按 hangRoots 顺序做跨轴推挤（只动跨轴，主侧壳缘净空
  // 见 FO-FIX1，不回退）；有调整时用新 pos 重跑 forest —— 岛内连线由 `shiftIsland` 按**世界
  // 坐标重建**，故不必手工平移/重算 path，也不碰岛级缓存持有的对象。
  // 同挂点行内已由 FIX3 扇出（间距 = FRAME_HANG_SIBLING_GAP），此处不会再动它们。
  const firstPass = layoutForest(centers, ctx.measure, ctx.prune, forestOpts);
  const placed = deOverlapHangCenters(centers, firstPass, isCrossVertical(dir));
  const spatial =
    placed === centers
      ? firstPass
      : layoutForest(placed, ctx.measure, ctx.prune, forestOpts);
  const spatialById = new Map<string, LayoutNode>();
  for (const n of spatial.nodes) spatialById.set(n.node.id, n);

  // ② 行节点树：行盒 = island.boxes；d===depth 行的孩子 = 空间根（已由 forest 落位）
  const depthAbs = ln.depth + depthOffset;
  const rowById = new Map<string, LayoutNode>();
  const hangChildById = new Map<string, LayoutNode>();
  const buildRows = (node: EditableNode, rel: number, parentId: string | null): LayoutNode => {
    const row: LayoutNode = {
      node,
      box: island.boxes.get(node.id) ?? ln.box,
      side: ln.side,
      depth: depthAbs + rel,
      parentId,
      children: [],
    };
    rowById.set(node.id, row);
    if (rel === spec.depth) {
      for (const child of node.children) {
        const s = spatialById.get(child.id);
        if (s === undefined) continue;
        const spliced = spliceSpatial(s, node.id, depthAbs + rel + 1, ctx);
        hangChildById.set(child.id, spliced);
        row.children.push(spliced);
      }
      return row;
    }
    for (const child of node.children) row.children.push(buildRows(child, rel + 1, node.id));
    return row;
  };
  const frameRow = buildRows(ln.node, 0, ln.parentId);

  // ②′ 空间层**内部连线**并入岛产出（FO-FIX1 根因 A）：
  //     挂出子树的树边由 `layoutForest` 产出（`shiftIsland` 已按世界坐标重建 path，**勿二次平移**），
  //     原实现只推了「挂点行 → 空间根」一条边，导致挂出子孙**漂浮无连线**（MapView 只画 layout.links）。
  //     过滤条件与基座 links 同款（见 `expandFrameIslands` 的 `keptBaseLinks`）：嵌套框根被就地
  //     展开时，其在空间层里的旧子树节点已登记进 `ctx.dropped`，那些**陈旧树边**必须丢弃——
  //     嵌套岛自己的连线由递归的 `expandOne` 直接推入 `ctx.links`（权威且唯一）。
  for (const l of spatial.links) {
    if (ctx.spatialDropped.has(l.fromId) || ctx.spatialDropped.has(l.toId)) continue;
    ctx.links.push(l);
  }

  // ③ 挂点连线：大纲行（d=depth）→ 空间根（真实父子边；线型按岛方向选，与岛内同族）
  const dirOf = new Map<string, GrowDir>();
  for (const id of rowById.keys()) dirOf.set(id, dir);
  for (const id of hangChildById.keys()) dirOf.set(id, dir);
  for (const hang of part.hangRoots) {
    const parent = rowById.get(hang.outlineNodeId);
    const child = hangChildById.get(hang.spatialRoot.id);
    if (parent === undefined || child === undefined) continue;
    ctx.links.push({
      path: linkGeometry(parent, child, dir, dirOf).path,
      depth: parent.depth,
      fromId: parent.node.id,
      toId: child.node.id,
    });
  }
  return frameRow;
}

/**
 * 把空间层布局产物接回挂点行：拷贝式改写（`parentId` / `depth` 基准 / 递归）——
 * 对 `layoutForest` 的输出**零写入**（其对象被岛级缓存持有，原地改写会污染缓存）。
 * 空间挂载层上的嵌套框根就地展开（设计 §3.3：挂载层允许成框）。
 */
function spliceSpatial(
  ln: LayoutNode,
  parentId: string | null,
  depthOffset: number,
  ctx: ExpandCtx,
): LayoutNode {
  if (frameOf(ln.node.note) !== undefined && !ctx.collapsed.has(ln.node.id)) {
    // 空间层里这棵子树将由**嵌套岛**接管：其空间层旧树边作废（新边由递归 expandOne 推入）
    markSubtreeIds(ln.node, ctx.spatialDropped);
    const nested = expandOne(ln, ctx, depthOffset);
    return { ...nested, parentId, depth: ln.depth + depthOffset };
  }
  return {
    ...ln,
    parentId,
    depth: ln.depth + depthOffset,
    children: ln.children.map((c) => spliceSpatial(c, ln.node.id, depthOffset, ctx)),
  };
}

/** 挂点朝向（一期写死一条，规格 §11 开放项）：框根声明的 `note.dir`；无声明 → right */
function islandDirOf(node: EditableNode): GrowDir {
  const raw = node.note?.dir;
  return isGrowDir(raw) ? raw : 'right';
}

/** 前序收集（原地追加；保持 layout.nodes 的前序契约） */
function pushPreorder(ln: LayoutNode, out: LayoutNode[]): void {
  out.push(ln);
  for (const c of ln.children) pushPreorder(c, out);
}

/** 子树上全部节点 id 入集（不含 `node` 自身——框根由其自身 LayoutNode 承载） */
function markSubtreeIds(node: EditableNode, out: Set<string>): void {
  for (const child of node.children) {
    out.add(child.id);
    markSubtreeIds(child, out);
  }
}

// ── 跨 depth 边界守卫（设计 §5.2 一期：禁止跨 depth 拖拽改层级） ─────────────

/** 框内层级归属：最近成框祖先 + 相对深度落在大纲层还是空间挂载层 */
export interface FrameLayer {
  frameId: string;
  layer: 'outline' | 'spatial';
}

/** 节点相对最近成框祖先的层级归属；不属于任何框 / 不在树内 → null */
export function frameLayerOf(root: EditableNode, nodeId: string): FrameLayer | null {
  const chain = chainToNode(root, nodeId);
  if (chain === null) return null;
  return layerFromChain(chain, 0);
}

/**
 * 把 `nodeId` 改挂到 `targetParentId` 之下是否会**跨 depth 边界**（进/出大纲层）——一期 no-op 判据。
 *
 * 层级口径（与岛布局同源，一律相对框根）：
 *  - 源 = 节点自身相对最近成框祖先的层级；
 *  - 目标 = 该节点**作为目标父节点的新孩子**时的层级（相对深度 +1）。
 * 判定：两侧「大纲层归属键」不同即跨边界（框外键 = null）——
 * 出/进大纲层、大纲↔空间层 都拦；**大纲层内重排**与**空间层内排序**放行；
 * 「框外 ↔ 空间层」「空间层 ↔ 框外」不过 depth 线（设计 §5.2 原文只禁「进/出大纲层」），亦放行。
 *
 * 节点缺失（树快照过期）→ 放行：交给 op 层既有校验（`moveNode` 的环/深度检查），
 * 守卫只负责「框语义」，不越权做通用校验。
 */
export function crossesFrameDepthBoundary(
  root: EditableNode,
  nodeId: string,
  targetParentId: string,
): boolean {
  const srcChain = chainToNode(root, nodeId);
  const dstChain = chainToNode(root, targetParentId);
  if (srcChain === null || dstChain === null) return false;
  return outlineKey(layerFromChain(srcChain, 0)) !== outlineKey(layerFromChain(dstChain, 1));
}

/**
 * 链上**最近**成框祖先决定的层级（设计 §3.3 同款「以最近成框祖先为准」）。
 *
 * @param selfOffset 0 = 判定链末节点自身；1 = 判定「挂在链末节点之下的新孩子」。
 *   链末自身即框根时（`d === 0`）不受自己管辖 —— 跳过并继续向更远祖先找。
 */
function layerFromChain(chain: readonly EditableNode[], selfOffset: number): FrameLayer | null {
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const anc = chain[i];
    if (anc === undefined) continue; // noUncheckedIndexedAccess 收窄（i 恒在界内）
    const spec = frameOf(anc.note);
    if (spec === undefined) continue;
    const d = chain.length - 1 - i + selfOffset;
    if (d === 0) continue;
    return { frameId: anc.id, layer: d <= spec.depth ? 'outline' : 'spatial' };
  }
  return null;
}

/** 大纲层归属键（仅大纲层参与边界判定）——两侧键不同 ⇔ 跨 depth 边界 */
function outlineKey(layer: FrameLayer | null): string | null {
  return layer !== null && layer.layer === 'outline' ? layer.frameId : null;
}

/** `root` → `nodeId` 的节点链（含两端）；不在树内 → null */
function chainToNode(root: EditableNode, nodeId: string): EditableNode[] | null {
  if (root.id === nodeId) return [root];
  for (const child of root.children) {
    const sub = chainToNode(child, nodeId);
    if (sub !== null) return [root, ...sub];
  }
  return null;
}
