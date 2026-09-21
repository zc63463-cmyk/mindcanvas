/**
 * 结构布局注册表（v1）：组织架构(org) / 横向时间轴(timeline) / 鱼骨(fishbone)。
 * 共享工具来自 mindmap.ts（buildLayoutTree/annotateTree/collectLayout/layoutBounds）。
 * 布局类型经根节点 note.layout 持久化（正文单一事实源；旧文件缺省回退 mindmap）。
 */
import type { EditableNode } from '../tree/treeOps.js';
import type { GrowDir } from './mindmap.js'; // 复审修复：取型自基座，打破 forest↔layouts 循环
import {
  annotateTree,
  bezierLink,
  buildLayoutTree,
  collectCached,
  collectLayout,
  H_GAP,
  isGrowDir,
  layoutMindmap,
  layoutBounds,
  NO_SATELLITE_HOOK,
  orgBeamLink,
  orgBeamLinkUp,
  placeSubtreeIncremental,
  subtreeHeightCached,
  V_GAP,
  type LayoutCache,
  type LayoutNode,
  type LayoutResult,
  type LinkBuilder,
  type MeasureFn,
  type SatelliteHook,
} from './mindmap.js';
// 仅取型：separate.ts / linkClear.ts 只依赖 mindmap（基座），不会与 layouts 形成循环
import type { SeparateOptions } from './separate.js';
import type { LinkClearOptions } from './linkClear.js';

export type LayoutKind =
  | 'mindmap'
  | 'org'
  /** 组织架构向上生长（G6′ 四向：与 org 镜像） */
  | 'org-up'
  | 'timeline'
  | 'fishbone'
  | 'logic-right'
  | 'logic-left';

export type LayoutFunc = (
  root: EditableNode,
  measure: MeasureFn,
  collapsedIds: Set<string>,
) => LayoutResult;

export const SUB_GAP = 28;

/** S3 空摘除集（共享常量；不注入钩子时用——保证旧行为逐位等价） */
const EMPTY_SKIP: ReadonlySet<string> = new Set<string>();

// ---------- org：自顶向下行式（同层同行、子行下沉） ----------
function subtreeWidth(ln: LayoutNode): number {
  if (ln.children.length === 0) return ln.box.w;
  const cw =
    ln.children.reduce((s, c) => s + subtreeWidth(c), 0) + SUB_GAP * (ln.children.length - 1);
  return Math.max(ln.box.w, cw);
}

/**
 * 增量放置（F3）：放置参数 (dir, cx, y) 与上次一致 → 跳过整棵（坐标是参数的确定性
 * 函数）；否则重放并失效该子树的 collects/bounds。首次全 miss 时与 placeOrg 逐式
 * 相同（输出逐位一致）。
 *
 * stamps 借位（{side, top, xEdge} = {dir, cx, y}）：org 树对象（构建 side=0）与
 * logic/mindmap 族（side=±1）在 cache.nodes 上因 side 不匹配而互不命中——
 * stamps 槽、collects 槽天然按对象隔离，不存在跨族混读。
 */
function placeOrgIncremental(
  ln: LayoutNode,
  cx: number,
  y: number,
  dir: 1 | -1,
  cache: LayoutCache | undefined,
): void {
  const prev = cache?.stamps.get(ln);
  if (prev && prev.side === dir && prev.top === cx && prev.xEdge === y) return;
  // 实际重放 → 该子树收集/包围盒缓存失效（盒坐标变了）
  cache?.collects.delete(ln);
  cache?.bounds.delete(ln);
  ln.box.x = cx - ln.box.w / 2;
  ln.box.y = y;
  if (ln.children.length > 0) {
    const total =
      ln.children.reduce((s, c) => s + subtreeWidth(c), 0) + SUB_GAP * (ln.children.length - 1);
    // dir=1 子行下沉（自顶向下）；dir=-1 子行上浮（自底向上）
    const childY = y + dir * (ln.box.h + V_GAP);
    let x = cx - total / 2;
    for (const c of ln.children) {
      placeOrgIncremental(c, x + subtreeWidth(c) / 2, childY, dir, cache);
      x += subtreeWidth(c) + SUB_GAP;
    }
  }
  cache?.stamps.set(ln, { side: dir, top: cx, xEdge: y });
}

/**
 * 组织架构布局（G6′：支持 direction，1 = 自顶向下 / -1 = 自底向上）。
 * 缺省 1，与既有行为逐位一致。
 *
 * F3：接 LayoutCache 增量原语（编辑局部化——未受影响子树不 measure/不重放/links 复用）。
 */
export function layoutOrg(
  root: EditableNode,
  measure: MeasureFn,
  collapsedIds: Set<string>,
  direction: 1 | -1 = 1,
  opts: { cache?: LayoutCache; measureKey?: string } = {},
): LayoutResult {
  const cache = opts.cache;
  const tree = buildSkeletonCached(root, measure, collapsedIds, cache, 0, 0, null, false);
  placeOrgIncremental(tree, 0, 0, direction, cache);
  const link: LinkBuilder =
    direction > 0
      ? (p, c) =>
          orgBeamLink(
            p,
            c,
            (p.box.y + p.box.h + Math.min(...p.children.map((k) => k.box.y))) / 2,
          )
      : (p, c) =>
          orgBeamLinkUp(
            p,
            c,
            (p.box.y + Math.max(...p.children.map((k) => k.box.y + k.box.h))) / 2,
          );
  const { nodes, links } = collectCached(tree, cache, link);
  return { nodes, links, bounds: layoutBounds(nodes) };
}

// ---------- timeline：横向时间轴（深度列向右展开，列内垂直堆叠） ----------

export function layoutTimeline(
  root: EditableNode,
  measure: MeasureFn,
  collapsedIds: Set<string>,
): LayoutResult {
  const tree = annotateTree(buildLayoutTree(root, measure, collapsedIds), 0, null);
  const byDepth = new Map<number, LayoutNode[]>();
  const walk = (ln: LayoutNode): void => {
    const list = byDepth.get(ln.depth) ?? [];
    list.push(ln);
    byDepth.set(ln.depth, list);
    for (const c of ln.children) walk(c);
  };
  walk(tree);
  const colX = new Map<number, number>();
  let cursorX = 0;
  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  for (const d of depths) {
    colX.set(d, cursorX);
    const maxW = byDepth.get(d)?.reduce((m, n) => Math.max(m, n.box.w), 0) ?? 0;
    cursorX += maxW + H_GAP;
  }
  for (const d of depths) {
    let y = 0;
    for (const n of byDepth.get(d) ?? []) {
      n.box.x = colX.get(d) ?? 0;
      n.box.y = y;
      y += n.box.h + V_GAP;
    }
  }
  const { nodes, links } = collectLayout(tree);
  return { nodes, links, bounds: layoutBounds(nodes) };
}

// ---------- fishbone：根左侧，一级分支上下交错（+1/-1），后代同侧延续 ----------

function placeFishbone(
  ln: LayoutNode,
  cursor: { up: number; down: number },
  columnX: number,
): void {
  const side = ln.side;
  ln.box.x = columnX;
  if (side > 0) {
    ln.box.y = cursor.up - ln.box.h;
    cursor.up -= ln.box.h + V_GAP;
  } else {
    ln.box.y = cursor.down;
    cursor.down += ln.box.h + V_GAP;
  }
  const childCol = columnX + ln.box.w + H_GAP;
  for (const c of ln.children) placeFishbone(c, cursor, childCol);
}

export function layoutFishbone(
  root: EditableNode,
  measure: MeasureFn,
  collapsedIds: Set<string>,
): LayoutResult {
  const tree = annotateTree(buildLayoutTree(root, measure, collapsedIds), 0, null);
  tree.box.x = 0;
  tree.box.y = 0;
  // 一级分支按文档序 +1/-1 交替，后代继承侧向
  const assignSides = (ln: LayoutNode, side: -1 | 0 | 1): void => {
    ln.side = side;
    for (const c of ln.children) assignSides(c, side);
  };
  let next: -1 | 1 = 1;
  for (const c of tree.children) {
    assignSides(c, next);
    next = next === 1 ? -1 : 1;
  }
  placeFishbone(tree, { up: 0, down: 0 }, 0);
  const { nodes, links } = collectLayout(tree);
  return { nodes, links, bounds: layoutBounds(nodes) };
}

// ---------- logic：单侧逻辑图（全部同侧延伸；direction=1 右 / -1 左） ----------

/**
 * 缓存感知的骨架构建（F3）：与 buildLayoutTree 同形，但按 `side/depth/parentId`
 * 命中复用 cache.nodes（子树未变 → 整棵复用：跳过 measure 与递归）。
 * 直接用最终语义的 depth/parentId 构建（logic/org 不再需要 annotateTree 二次重建）。
 *
 * - 根由调用方直接构建（useCache=false：side=0 的根侧向与「根文本」必测，每次新建；
 *   其子层起走本函数并做命中检查）——与 layoutMindmap「rootNode 不入缓存」惯例一致。
 * - 域隔离：logic 构建 side=±1（direction）、org 构建 side=0——同一 EditableNode 的
 *   cache.nodes 槽位被异族写入时因 side 不匹配而重建（miss 安全，见 F3 报告）。
 */
function buildSkeletonCached(
  node: EditableNode,
  measure: MeasureFn,
  collapsedIds: Set<string>,
  cache: LayoutCache | undefined,
  side: -1 | 0 | 1,
  depth: number,
  parentId: string | null,
  /** 是否查/写缓存（根 = false；子树 = true） */
  useCache: boolean,
  /**
   * S3 摘要卫星摘除集（缺省空集 = 旧行为逐位等价）。
   * 与 `layoutMindmap` 的 `skip` 同源同判据——摘除必须一致，否则几何错位。
   */
  skip: ReadonlySet<string> = EMPTY_SKIP,
): LayoutNode {
  if (useCache && cache) {
    const cached = cache.nodes.get(node);
    if (cached && cached.side === side && cached.depth === depth && cached.parentId === parentId) {
      return cached;
    }
  }
  // MEASURE-RANK：depth 已是最终语义（logic/org 不再 annotate 重建），直接交给度量
  const m = measure(node, depth);
  const children: LayoutNode[] = !collapsedIds.has(node.id)
    ? node.children
        // S3：摘除摘要节点（改为成员带外侧卫星，post-pass 放置）
        .filter((c) => !skip.has(c.id))
        .map((c) =>
          buildSkeletonCached(c, measure, collapsedIds, cache, side, depth + 1, node.id, useCache, skip),
        )
    : [];
  const ln: LayoutNode = {
    node,
    box: { x: 0, y: 0, w: m.w, h: m.h },
    side,
    depth,
    parentId,
    children,
  };
  if (useCache && cache) cache.nodes.set(node, ln);
  return ln;
}

/**
 * 单侧逻辑图（全部同侧延伸；direction=1 右 / -1 左）。
 *
 * F3：接 LayoutCache 增量原语——根每次新建（side=0，与旧输出逐位一致）、
 * 子树层按方向命中复用（未变分支零 measure）；放置走 placeSubtreeIncremental
 * （参数不变子树整棵跳过）、收集走 collectCached（links 复用）。
 */
export function layoutLogic(
  root: EditableNode,
  measure: MeasureFn,
  collapsedIds: Set<string>,
  direction: 1 | -1,
  opts: { cache?: LayoutCache; measureKey?: string; satellite?: SatelliteHook } = {},
): LayoutResult {
  const cache = opts.cache;
  // S3 摘要卫星钩子（缺省 NO_SATELLITE_HOOK → 旧行为逐位等价）
  const hook = opts.satellite ?? NO_SATELLITE_HOOK;
  const skip = hook.skipIds(root);
  // 根：手工构建（side=0、居中定位——与旧路径逐位一致）；不查/不写缓存
  const rootM = measure(root, 0);
  const tree: LayoutNode = {
    node: root,
    box: { x: -rootM.w / 2, y: -rootM.h / 2, w: rootM.w, h: rootM.h },
    side: 0,
    depth: 0,
    parentId: null,
    children: !collapsedIds.has(root.id)
      ? root.children
          // S3：摘除摘要节点（改为成员带外侧卫星，post-pass 放置）
          .filter((c) => !skip.has(c.id))
          .map((c) =>
            buildSkeletonCached(
              c,
              measure,
              collapsedIds,
              cache,
              direction,
              1,
              root.id,
              true,
              skip,
            ),
          )
      : [],
  };
  const total =
    tree.children.reduce((s, c) => s + subtreeHeightCached(c), 0) +
    V_GAP * Math.max(0, tree.children.length - 1);
  let cursor = -total / 2;
  for (const child of tree.children) {
    placeSubtreeIncremental(
      child,
      direction,
      cursor,
      direction > 0 ? tree.box.x + tree.box.w : tree.box.x,
      cache,
    );
    cursor += subtreeHeightCached(child) + V_GAP;
  }
  const { nodes, links } = collectCached(tree, cache);
  // S3 post-pass：成员已落位 → 钩子按成员实际盒算带、放置卫星子树。
  // 无摘要时钩子原样返回 → 输出与基线逐位等价。
  return hook.merge({
    root,
    layoutRoot: tree,
    nodes,
    links,
    bounds: layoutBounds(nodes),
    measure,
    collapsedIds,
    cache,
  });
}

// ---------- 注册表 ----------

const REGISTRY: Record<LayoutKind, LayoutFunc> = {
  mindmap: layoutMindmap,
  org: layoutOrg,
  'org-up': (r, m, c) => layoutOrg(r, m, c, -1),
  timeline: layoutTimeline,
  fishbone: layoutFishbone,
  'logic-right': (r, m, c) => layoutLogic(r, m, c, 1),
  'logic-left': (r, m, c) => layoutLogic(r, m, c, -1),
};

export function getLayout(kind: LayoutKind): LayoutFunc {
  return REGISTRY[kind] ?? layoutMindmap;
}

export function isLayoutKind(value: string | undefined): value is LayoutKind {
  return typeof value === 'string' && value in REGISTRY;
}

// ============================================================================
// D2′ 节点级生长方向（思想分叉）布局分组调度
//
// 设计（设计文档 §5 D2′）：
// - 每节点把子节点按**有效 dir** 分 right/left/up/down 四组，每组递归布局，
//   各组挂对应侧——天然实现「同节点多向分叉」
// - 碰撞消解：分组挂位后由 separate.ts 做**自底向上的子树刚性分离**（相邻/对角/
//   左右全对比真实节点盒，迭代至零重叠；参考 PG resolveSubtreeOverlaps 的迭代思路，
//   但改用「最小位移 + 方向偏好」而非固定优先级）
// - 缺省 = 继承（最近显式 dir 祖先 → islandDir）；非法值由读侧（growDir.ts）过滤，
//   本层只消费合法 GrowDir
// - 无 dir 声明（或 dir 映射为空/全树无命中）→ 逐像素回退经典 layoutMindmap
//   （保证旧文件布局零变更）
// - kernel 零 DOM：dir 信息经 opts.explicitDirByNodeId 注入，不读取任何 note
// ============================================================================

/** 布局入参：节点级有效方向信息（由 pipeline 解析 note.dir 后注入；本模块纯消费） */
export interface BranchLayoutOptions {
  /**
   * 显式 dir 声明：nodeId → GrowDir（来自 note.dir，已通过读侧校验）。
   * 缺失 = 继承（取父节点的有效 dir；根取 islandDir）。
   */
  explicitDirByNodeId?: Map<string, GrowDir>;
  /** 岛/根缺省方向（无显式 dir 时的归宿）。缺省 'right'（与 forest.DEFAULT_ROOT_DIR 一致） */
  islandDir?: GrowDir;
  /**
   * 无 dir 声明时的回退布局。缺省 layoutMindmap（经典左右平衡，管线无岛路径用）。
   * 岛内必须传 LAYOUT_BY_DIR[dir]——岛内原语义是「整棵朝该方向生长」，
   * 与经典 mindmap 的左右平衡不同（接线实测：直接回退 layoutMindmap 会破坏
   * forest 四向生长测试）。
   *
   * F3：第 4 参透传缓存选项——岛内经典布局（layoutLogic/layoutOrg）接
   * LayoutCache 增量原语（编辑局部化）；实现为加法参数，旧调用方零改动。
   */
  fallback?: (
    r: EditableNode,
    m: MeasureFn,
    c: Set<string>,
    opts?: { cache?: LayoutCache; measureKey?: string },
  ) => LayoutResult;
  /** 增量缓存（F3：透传回退路径/基准；分支路径自身步骤仍为全量） */
  cache?: LayoutCache;
  /** 度量语义键（透传回退路径/基准） */
  measureKey?: string;
  /**
   * 碰撞消解参数（缺省启用默认值）。传 `false` 关闭——仅供对照测试
   * （验证「不消解会重叠、消解后零重叠」），生产路径不要关。
   */
  separate?: SeparateOptions | false;
  /**
   * 连线避让参数（缺省启用默认值）。传 `false` 关闭——仅供对照测试
   * （验证「只消解盒重叠时连线仍会穿盒」）。与 `separate` 交替执行。
   */
  linkClear?: LinkClearOptions | false;
  /**
   * 有效方向回填（可选出参）：nodeId → 该节点相对**父级**的有效生长方向
   * （显式声明 → 跟随显式父 → 基线落位反推，即布局落位期真正用的那份结论）。
   *
   * 供森林布局平移岛屿后**重建连线**用：按有效方向 + hub 选线型，与岛外同一族；
   * 没有它只能按岛方向一刀切（右岛里 up/down 共享梁与 hub 共享竖梁全退化为贝塞尔，
   * 与渲染端不一致）。回退路径（全树无显式 dir）不产出 → 调用方回落岛方向。
   */
  dirSink?: Map<string, GrowDir>;
}

export type BBox = { minX: number; minY: number; maxX: number; maxY: number };

/** 子树局部包围盒（含 node 自身盒） */
export function subtreeBBox(ln: LayoutNode): BBox {
  const b: BBox = {
    minX: ln.box.x,
    minY: ln.box.y,
    maxX: ln.box.x + ln.box.w,
    maxY: ln.box.y + ln.box.h,
  };
  for (const c of ln.children) {
    const cb = subtreeBBox(c);
    if (cb.minX < b.minX) b.minX = cb.minX;
    if (cb.minY < b.minY) b.minY = cb.minY;
    if (cb.maxX > b.maxX) b.maxX = cb.maxX;
    if (cb.maxY > b.maxY) b.maxY = cb.maxY;
  }
  return b;
}

/** 平移整棵子树（盒 + 后代盒） */
export function translateSubtree(ln: LayoutNode, dx: number, dy: number): void {
  ln.box.x += dx;
  ln.box.y += dy;
  for (const c of ln.children) translateSubtree(c, dx, dy);
}
