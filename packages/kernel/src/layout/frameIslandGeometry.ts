/**
 * 框岛几何（自 `frameLayout.ts` 按职责抽出；实现逐字保留、导出面向后兼容）。
 *
 * 管什么：单个框岛在**局部坐标**下的几何 —— 大纲行盒、描边壳、占位壳、挂点；
 * 以及壳的「行包围盒 + pad」唯一算式与相对深度收敛。不碰基座布局、不碰岛展开编排、
 * 不碰跨 depth 守卫（那些仍在 `frameLayout.ts`）。
 *
 * 为什么单列：`frameLayout.ts` 长期超 600 行预算（拆分前 983），而岛几何与编排是两件事：
 * 前者是纯函数（给定度量与落点即可算），后者管「剪枝 → 展开 → 拼接」的时序。
 *
 * 兼容：`frameLayout.ts` 原样再导出本模块的全部公开符号
 * （`FrameRowOptions` / `FrameIslandArgs` / `FrameIslandLayout` / `layoutFrameIsland` /
 * `FRAME_SHELL_PAD` / `FRAME_ROW_GAP`）；既有 `from './frameLayout.js'` 的引用零改造。
 */
import type { EditableNode } from '../tree/treeOps.js';
import { FRAME_ROW_INDENT, frameRowMetrics } from './frameMeasure.js';
import { fanOutHangCrossCenters, hangEnvelopeLocal, hangOriginOf, isCrossVertical, unionBox } from './frameHangGeometry.js';
import { partitionFrameSubtree } from './framePartition.js';
import type { Box, GrowDir, MeasureFn } from './mindmap.js';
import type { CharMeasure } from './measure.js';

/** 相邻大纲行间距（px） */
export const FRAME_ROW_GAP = 4;
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
  /**
   * 度量深度基准（MEASURE-RANK 可选）：框根在**所属布局域**里的深度。
   * 岛内第 `d` 行的绝对深度 = `baseDepth + d`，挂出子树根 = `baseDepth + depth + 1`。
   * 缺省 0 = 顶层框（框根即布局根）逐像素维持旧行为。
   */
  baseDepth?: number;
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
 * 布局单个框岛（纯函数、零副作用、不搬家）：只产出**几何**——
 * 大纲行盒 + 挂点；空间层由调用方交给现有布局（`expandFrameIslands` 即该编排）。
 */
export function layoutFrameIsland(args: FrameIslandArgs): FrameIslandLayout {
  const { frameRoot, measure, origin, direction, textMeasure, rowAuxH } = args;
  const local = layoutIslandLocal(
    frameRoot,
    args.depth,
    measure,
    direction,
    {
      textMeasure,
      rowAuxH,
    },
    args.baseDepth ?? 0,
  );
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
export function layoutIslandLocal(
  frameRoot: EditableNode,
  depthArg: number,
  measure: MeasureFn,
  direction: GrowDir,
  opts: FrameRowOptions,
  /** 度量深度基准（MEASURE-RANK）：岛内局部深度 + 本值 = 文档绝对深度；缺省 0 = 旧行为 */
  baseDepth = 0,
): IslandLocal {
  const depth = islandDepth(depthArg);
  // 挂出子树的绝对深度基准（挂点行 d = depth 的孩子）：与 expandOne 的 spliceSpatial 同口径
  const hangBase = baseDepth + depth + 1;
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
  const crossCenters = fanOutHangCrossCenters(part, boxes, measure, direction, hangBase);
  const hangOrigins = new Map<string, { x: number; y: number }>();
  const vertical = isCrossVertical(direction);
  for (let i = 0; i < part.hangRoots.length; i += 1) {
    const hang = part.hangRoots[i];
    if (hang === undefined) continue; // noUncheckedIndexedAccess 收窄
    const row = boxes.get(hang.outlineNodeId);
    if (row === undefined) continue; // 防御：与 partition 同源，理论不可达
    const base = hangOriginOf(outline, row, measure(hang.spatialRoot, hangBase), direction);
    const cross = crossCenters[i] ?? 0;
    hangOrigins.set(
      hang.spatialRoot.id,
      vertical ? { x: base.x, y: cross } : { x: cross, y: base.y },
    );
  }

  // FO-C2.1：占位壳 = 描边壳 ∪ 挂出外包络（无挂出 → 逐值等于描边壳）
  const envelope = hangEnvelopeLocal(part, measure, direction, crossCenters, outline, hangBase);
  const place = envelope === null ? outline : unionBox(outline, envelope);
  return { boxes, outlineHeight, outline, place, hangOrigins };
}
