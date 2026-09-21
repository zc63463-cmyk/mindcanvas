/**
 * 摘要卫星（S3）：把 well-formed 的摘要节点从布局树中**摘除**，改为成员带外侧的卫星。
 *
 * ## 语义
 *
 * 摘要 S 覆盖「同一父 P 下的连续兄弟区间 [成员A … 成员C]」。布局上：
 *
 * ```
 *   P ──┬── 成员A            ┌── S ── 摘要子
 *       ├── 成员B            │
 *       └── 成员C ───────────┘
 *       ↑ 成员带（band）          ↑ 卫星（satellite）
 * ```
 *
 * - **摘除边界（S-A8）**：只从「布局树」摘除。raw 事实树 / 编辑树 / 搜索 / 路径 /
 *   迁移一律不动——摘要节点在事实源里仍是 P 的普通子节点，因此天然可搜可导航。
 * - **链接**：普通布局链接不得产生 P→S（S 已不在布局树内，`collectCached` 天然不产出）；
 *   摘要子树内部必须保留 S→子链接（卫星自身是一棵正常布局的子树）。
 * - **不承诺卫星的路径**：`layoutOrg`（down/up 岛）、显式 `note.dir` 分叉路径、
 *   框内路径。这些路径**不注入本钩子**，摘要节点留在普通流内可见——
 *   宁可无括线，也不让节点消失（本批最严重的失败形态）。
 *
 * ## 成员带与几何（右向；左向镜像）
 *
 * - 带（band）= 成员子树包围盒的并集；
 * - `bracketX = band.maxX + SUMMARY_BRACKET_GAP`（右向）/ `band.minX − GAP`（左向）；
 * - `S.left = bracketX + SUMMARY_STEM_GAP`（左向取 S 右缘 `− STEM_GAP`）；
 * - `topS = bandCenterY − subtreeHeight(S) / 2`（卫星子树垂直居中于带）；
 * - 放置交既有 `placeSubtreeIncremental(S, side, topS, xEdge, cache)`，
 *   其内部按 `side` 取 `x = side > 0 ? xEdge + H_GAP : xEdge − H_GAP − w`，
 *   故左右两条公式互为反射。
 *
 * ## 嵌套摘要（`memberIds` 含另一个摘要节点）
 *
 * `resolveSummaries` 按结构解析，**不排除**成员区间里含另一个摘要节点的情况。
 * 本批明确不实现嵌套摘要 UI，但也**不允许节点消失或产生无效几何**。处置：
 * 该摘要**不摘除**，留在普通流内可见——与降级域同一出口（`nestedSkip` 记录原因）。
 *
 * ## 依赖方向（depcruise no-circular 约束）
 *
 * `satellite.ts → mindmap.ts` **单向**：本文件消费 mindmap 的放置/收集/构建原语，
 * 并通过 `SatelliteHook` 反向注册给布局主体（调用方注入，不是 import）。
 * 本文件**不得** import `layouts.ts`（那会形成
 * `mindmap → satellite → layouts → mindmap` 循环，实测被 depcruise 拦截）——
 * 故 `subtreeBBox` 在此自持一份（纯几何算式与 layouts 逐字相同，由测试钉一致性）。
 */

import type { EditableNode } from '../tree/treeOps.js';
import { resolveSummaries } from '../registry/summary-anchor.js';
import {
  H_GAP,
  NO_SATELLITE_HOOK,
  placeSubtreeIncremental,
  subtreeHeightCached,
  collectCached,
  type LayoutCache,
  type LayoutNode,
  type LayoutOptions,
  type LinkGeometry,
  type MeasureFn,
  type SatelliteHook,
} from './mindmap.js';

/** 成员带外沿 → 括线的水平间距（S4 复用；唯一口径） */
export const SUMMARY_BRACKET_GAP = 12;
/** 括线 → 摘要节点外缘的横向间距（S4 复用；唯一口径） */
export const SUMMARY_STEM_GAP = 10;

/** 一条可摘除摘要的规格（布局层消费；`memberIds` 为同父连续区间） */
export interface SatelliteSpec {
  /** 成员与摘要节点的共同父节点 id */
  parentId: string;
  /** 摘要节点 id */
  summaryNodeId: string;
  /** 成员 id（同父连续区间，含两端，按兄弟顺序） */
  memberIds: readonly string[];
  /** 摘要节点本体（构建卫星子树用） */
  summaryNode: EditableNode;
}

/** 摘要卫星规划的产物 */
export interface SatellitePlan {
  /** 要从布局树中摘除的摘要节点 id 集（**只含可安全摘除者**） */
  skip: ReadonlySet<string>;
  /** 可摘除的摘要规格（按树序） */
  specs: readonly SatelliteSpec[];
  /**
   * 因嵌套（成员区间含另一摘要节点）而**不摘除**的摘要节点 id。
   * 它们留在普通流内可见——本批不实现嵌套摘要 UI，但不得让节点消失。
   */
  nestedSkip: ReadonlySet<string>;
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

/** 空计划（无摘要 / 全部降级；共享同一常量，零分配） */
export const EMPTY_PLAN: SatellitePlan = {
  skip: EMPTY_SET,
  specs: [],
  nestedSkip: EMPTY_SET,
};

/**
 * 构建摘要卫星规划（纯函数；单一事实源 = `resolveSummaries`）。
 *
 * 只收 `well-formed`；`dangling`/`stale` 一律留在普通流内（与降级域同一出口：
 * 宁可无括线也不消失）。嵌套摘要（成员区间含另一摘要节点）同样留流内。
 */
export function buildSatellitePlan(root: EditableNode): SatellitePlan {
  const resolved = resolveSummaries(root);
  if (resolved.length === 0) return EMPTY_PLAN;
  const wellFormed = resolved.filter(
    (r): r is (typeof resolved)[number] & { memberIds: string[]; parentId: string } =>
      r.state === 'well-formed' && r.memberIds !== undefined && r.parentId !== undefined,
  );
  if (wellFormed.length === 0) return EMPTY_PLAN;
  // 全部摘要节点 id（含非 well-formed）：判定「成员区间含另一摘要节点」（嵌套）
  const allSummaryIds = new Set(resolved.map((r) => r.summaryNodeId));
  const skip = new Set<string>();
  const nestedSkip = new Set<string>();
  const specs: SatelliteSpec[] = [];
  const byId = new Map<string, EditableNode>();
  indexById(root, byId);

  for (const r of wellFormed) {
    // 嵌套：成员区间含任一摘要节点 → 不摘除（本批不实现嵌套 UI，但不得消失）
    if (r.memberIds.some((id) => allSummaryIds.has(id))) {
      nestedSkip.add(r.summaryNodeId);
      continue;
    }
    const summaryNode = byId.get(r.summaryNodeId);
    if (!summaryNode) continue; // 防御：resolveSummaries 的命中必来自本树
    skip.add(r.summaryNodeId);
    specs.push({
      parentId: r.parentId,
      summaryNodeId: r.summaryNodeId,
      memberIds: r.memberIds,
      summaryNode,
    });
  }
  if (skip.size === 0) return { skip, specs: [], nestedSkip };
  return { skip, specs, nestedSkip };
}

function indexById(node: EditableNode, out: Map<string, EditableNode>): void {
  out.set(node.id, node);
  for (const c of node.children) indexById(c, out);
}

/**
 * 卫星子树构建（折叠剪枝 + cache.nodes 复用，判据与主路径同款三元组）。
 *
 * `depth` 沿用**事实树层位**（父深度 + 1），使卫星的视觉档与它流内时一致——
 * 摘除不得改变字号（否则同一节点在有无摘要时大小不同，是可见回归）。
 */
function buildSatelliteTree(
  node: EditableNode,
  measure: MeasureFn,
  collapsedIds: Set<string>,
  cache: LayoutCache | undefined,
  side: -1 | 1,
  depth: number,
  parentId: string | null,
): LayoutNode {
  if (cache) {
    const cached = cache.nodes.get(node);
    if (cached && cached.side === side && cached.depth === depth && cached.parentId === parentId) {
      return cached;
    }
  }
  const m = measure(node, depth);
  const children: LayoutNode[] = !collapsedIds.has(node.id)
    ? node.children.map((c) =>
        buildSatelliteTree(c, measure, collapsedIds, cache, side, depth + 1, node.id),
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
  if (cache) cache.nodes.set(node, ln);
  return ln;
}

interface Band {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * 成员子树包围盒（含自身盒）。
 *
 * **本文件自持一份**，不从 `layouts.ts` 取 `subtreeBBox`——那会形成
 * `mindmap → satellite → layouts → mindmap` 循环（depcruise no-circular 实测拦截）。
 * 算式与 `layouts.ts:subtreeBBox` 逐字相同（纯几何、无状态），一致性由
 * `summary-satellite.test.ts` 的「带外沿口径」用例钉住。
 */
function subtreeBBox(ln: LayoutNode): Band {
  const b: Band = {
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

/** 成员带 = 成员子树包围盒并集（成员盒缺失 → null，不产出卫星） */
function bandOfMembers(
  memberIds: readonly string[],
  boxOf: (nodeId: string) => LayoutNode | undefined,
): Band | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hit = 0;
  for (const id of memberIds) {
    const ln = boxOf(id);
    if (!ln) continue;
    const b = subtreeBBox(ln);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
    hit += 1;
  }
  return hit === 0 ? null : { minX, minY, maxX, maxY };
}

/** 单个摘要的卫星落位（返回卫星子树根；成员盒缺失 → null） */
function placeOne(
  spec: SatelliteSpec,
  parentDepth: number,
  side: -1 | 1,
  band: Band,
  measure: MeasureFn,
  collapsedIds: Set<string>,
  cache: LayoutCache | undefined,
): LayoutNode | null {
  const sTree = buildSatelliteTree(
    spec.summaryNode,
    measure,
    collapsedIds,
    cache,
    side,
    parentDepth + 1,
    spec.parentId,
  );
  const top = (band.minY + band.maxY) / 2 - subtreeHeightCached(sTree) / 2;
  // 期望落点（左右镜像）：
  //   右向：S.left  = band.maxX + BRACKET_GAP + STEM_GAP
  //   左向：S.right = band.minX − BRACKET_GAP − STEM_GAP
  // `placeSubtreeIncremental` 的公式是 `x = side > 0 ? xEdge + H_GAP : xEdge − H_GAP − w`，
  // 反解 xEdge：
  //   右向：xEdge = S.left − H_GAP        = band.maxX + BRACKET + STEM − H_GAP
  //   左向：xEdge = S.right + H_GAP       = band.minX − BRACKET − STEM + H_GAP
  //        （`x` 由 `placeSubtreeIncremental` 再减 H_GAP 与自身 w 得出，这里**不再加 w**）
  const edge = side > 0 ? band.maxX : band.minX;
  const mirror = side > 0 ? SUMMARY_BRACKET_GAP + SUMMARY_STEM_GAP : -SUMMARY_BRACKET_GAP - SUMMARY_STEM_GAP;
  const xEdge = edge + mirror + (side > 0 ? -H_GAP : H_GAP);
  placeSubtreeIncremental(sTree, side, top, xEdge, cache);
  return sTree;
}

/**
 * 卫星钩子实现（注入给 `layoutMindmap` / `layoutLogic`）。
 *
 * `skipIds` 每次调用重建（`resolveSummaries` 已按需短路：无 summary_of 文档
 * 在收集阶段就返回空数组，不建 cid 索引）。memo 视压测结论决定是否追加。
 */
export const satelliteHook: SatelliteHook = {
  skipIds: (root) => buildSatellitePlan(root).skip,
  merge: ({ root, layoutRoot, nodes, links, bounds, measure, collapsedIds, cache }) => {
    const plan = buildSatellitePlan(root);
    if (plan.specs.length === 0) return { nodes, links, bounds };
    const byId = new Map<string, LayoutNode>();
    indexLayout(layoutRoot, byId);
    const satRoots: LayoutNode[] = [];
    const extraNodes: LayoutNode[] = [];
    const extraLinks: LinkGeometry[] = [];
    for (const spec of plan.specs) {
      const band = bandOfMembers(spec.memberIds, (id) => byId.get(id));
      if (!band) continue; // 成员盒缺失 → 不产出卫星（节点仍在树内，不消失）
      // 侧向：取首个成员的侧（同父连续区间的成员必同侧——共享父的出边方向）
      const first = byId.get(spec.memberIds[0] ?? '');
      const side: -1 | 1 = first ? (first.side === -1 ? -1 : 1) : 1;
      const parentDepth = byId.get(spec.parentId)?.depth ?? 0;
      const sat = placeOne(spec, parentDepth, side, band, measure, collapsedIds, cache);
      if (!sat) continue;
      satRoots.push(sat);
      const collected = collectCached(sat, cache);
      for (const n of collected.nodes) extraNodes.push(n);
      for (const l of collected.links) extraLinks.push(l);
    }
    if (satRoots.length === 0) return { nodes, links, bounds };
    const outNodes = [...nodes];
    const outLinks = [...links];
    let { minX, minY, maxX, maxY } = bounds;
    for (const n of extraNodes) {
      outNodes.push(n);
      if (n.box.x < minX) minX = n.box.x;
      if (n.box.y < minY) minY = n.box.y;
      if (n.box.x + n.box.w > maxX) maxX = n.box.x + n.box.w;
      if (n.box.y + n.box.h > maxY) maxY = n.box.y + n.box.h;
    }
    for (const l of extraLinks) outLinks.push(l);
    return {
      nodes: outNodes,
      links: outLinks,
      bounds: { minX, minY, maxX, maxY },
      satellites: satRoots,
    };
  },
};

function indexLayout(ln: LayoutNode, out: Map<string, LayoutNode>): void {
  out.set(ln.node.id, ln);
  for (const c of ln.children) indexLayout(c, out);
}

/** 卫星规格之外的空钩子（`layoutOrg` 等不承诺路径用；导出供调用方显式表达意图） */
export { NO_SATELLITE_HOOK };
export type { LayoutOptions };
