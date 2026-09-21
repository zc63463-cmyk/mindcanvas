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
import {
  layoutFrameIsland,
  layoutIslandLocal,
  type FrameRowOptions,
} from './frameIslandGeometry.js';
import { deOverlapHangCenters, isCrossVertical } from './frameHangGeometry.js';
import { FRAME_ROW_INDENT } from './frameMeasure.js';
import { partitionFrameSubtree } from './framePartition.js';
import {
  chainToNode,
  collectFrameRoots,
  framePrunedCollapsed,
  islandDirOf,
  layerFromChain,
  markSubtreeIds,
  pushPreorder,
  type FrameLayer,
} from './frameTreeGeometry.js';
import { layoutForest, type CenterSpec } from './forest.js';
import {
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

// 岛几何 / 挂出几何 / 树级工具已按职责抽到同目录三个模块（守本文件 600 行线；实现逐字保留）。
// 这里**原样再导出**，既有 `from './frameLayout.js'` 的引用零改造。
export {
  FRAME_ROW_GAP,
  FRAME_SHELL_PAD,
  layoutFrameIsland,
  layoutIslandLocal,
} from './frameIslandGeometry.js';
export type {
  FrameIslandArgs,
  FrameIslandLayout,
  FrameRowOptions,
} from './frameIslandGeometry.js';
export { FRAME_HANG_GAP, FRAME_HANG_SIBLING_GAP } from './frameHangGeometry.js';
export {
  collectFrameRoots,
  crossesFrameDepthBoundary,
  framePrunedCollapsed,
} from './frameTreeGeometry.js';
export type { FrameLayer } from './frameTreeGeometry.js';
// 常量与类型（FRAME_HANG_GAP / FRAME_HANG_SIBLING_GAP / FRAME_SHELL_PAD / FrameRowOptions /
// FrameIslandArgs / FrameIslandLayout）已随职责抽到 frameIslandGeometry / frameHangGeometry，
// 见上方再导出。

// 挂出几何（扇出 / 外包络 / 推挤 / 展开度）与壳算式（shellOfRows）已抽到
// frameHangGeometry / frameIslandGeometry，见上方再导出。

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
  opts: FrameRowOptions & { direction?: GrowDir; baseDepth?: number } = {},
): FrameShellGeometry {
  const { direction, baseDepth, ...rowOpts } = opts;
  const local = layoutIslandLocal(
    frameRoot,
    depth,
    measure,
    direction ?? islandDirOf(frameRoot),
    rowOpts,
    baseDepth ?? 0,
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
  opts: FrameRowOptions & { direction?: GrowDir; baseDepth?: number } = {},
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
  // MEASURE-RANK：depth 必须**穿透**包装层（否则壳内的视觉档度量拿到 undefined → 退回单档）。
  // 非框节点原样透传；框根把自身深度作为岛内基准（行 d / 挂出子树绝对深度由此推出）。
  const shellMeasure: MeasureFn = (node, depth) => {
    const spec = frameOf(node.note);
    if (spec === undefined) return base(node, depth);
    // 挂出方向同样取 note.dir（与 expandOne 的 islandDirOf 同源）——外包络长在哪一侧由此决定
    const size = frameShellSize(node, spec.depth, shellMeasure, {
      ...opts,
      direction: islandDirOf(node),
      baseDepth: depth ?? 0,
    });
    return { w: size.w, h: size.h };
  };
  return shellMeasure;
}

// ── 编排：基座剪枝 → 岛展开 ─────────────────────────────────────────────────
// 框根收集 / 基座剪枝（collectFrameRoots / framePrunedCollapsed）与挂点算式
// （hangOriginOf）已抽到 frameTreeGeometry / frameHangGeometry，见上方再导出。

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
  // MEASURE-RANK：框根在所属布局域里的深度（嵌套时为外层已累计的偏移）——
  // 岛内行 / 挂出子树的绝对深度都以它为基准，与下面 buildRows 写进 LayoutNode.depth 的口径同源
  const depthAbs = ln.depth + depthOffset;
  // FO-C2.1：基座给成框根定出的盒是**占位壳盒**（`createFrameShellMeasure` = 描边壳 ∪ 挂出
  // 外包络）。行起点 = 占位盒左上角 + (dx,dy)：无挂出时 (dx,dy) = (PAD,PAD)（= C2 逐值），
  // 有挂出且外包络向壳左/上扩时行会相应内移，使「基座盒 = 占位壳」与真实几何对齐。
  const shellGeom = frameShellGeometry(ln.node, spec.depth, ctx.measure, {
    direction: dir,
    textMeasure: ctx.opts.textMeasure,
    rowAuxH: ctx.opts.rowAuxH,
    baseDepth: depthAbs,
  });
  const island = layoutFrameIsland({
    frameRoot: ln.node,
    depth: spec.depth,
    measure: ctx.measure,
    origin: { x: ln.box.x + shellGeom.dx, y: ln.box.y + shellGeom.dy },
    direction: dir,
    textMeasure: ctx.opts.textMeasure,
    rowAuxH: ctx.opts.rowAuxH,
    baseDepth: depthAbs,
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
    // MEASURE-RANK：挂出岛以**文档绝对深度**参与视觉档度量——岛内局部深度 + 本基准；
    // 与 buildRows 的 spliceSpatial（同样 depthAbs + rel + 1）同口径，盒与渲染字号不再分叉
    measureDepthBase: depthAbs + spec.depth + 1,
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
  // （depthAbs 已在函数头算好 —— 岛几何/挂出岛度量与这里的 depth 口径必须同源）
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

// ── 跨 depth 边界守卫（设计 §5.2 一期：禁止跨 depth 拖拽改层级） ─────────────
// 层级链工具（FrameLayer / crossesFrameDepthBoundary / layerFromChain / outlineKey /
// chainToNode）与树遍历小工具（islandDirOf / pushPreorder / markSubtreeIds）
// 已抽到 frameTreeGeometry，见上方再导出。

/** 节点相对最近成框祖先的层级归属；不属于任何框 / 不在树内 → null */
export function frameLayerOf(root: EditableNode, nodeId: string): FrameLayer | null {
  const chain = chainToNode(root, nodeId);
  if (chain === null) return null;
  return layerFromChain(chain, 0);
}

// 层级链工具（crossesFrameDepthBoundary / layerFromChain / outlineKey / chainToNode）
// 已抽到 frameTreeGeometry，见上方再导出。
