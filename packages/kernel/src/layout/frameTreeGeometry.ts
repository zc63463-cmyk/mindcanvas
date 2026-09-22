/**
 * 框的树级工具与层级口径（自 `frameLayout.ts` 按职责抽出；实现逐字保留、导出面向后兼容）。
 *
 * 管什么：
 * - **框根收集与基座剪枝**（`collectFrameRoots` / `framePrunedCollapsed`，含身份记忆化）；
 * - **树遍历小工具**（前序收集、子树 id 入集、挂点朝向 `islandDirOf`）；
 * - **跨 depth 边界的层级口径**（`FrameLayer` / `frameLayerOf` 的链式判定基础：
 *   `chainToNode` / `layerFromChain` / `outlineKey` / `crossesFrameDepthBoundary`）。
 *
 * 为什么单列：这些是「树与框语义」的读侧工具，与岛几何/挂出几何无关；
 * `frameLayout.ts` 超 600 行预算（拆分前 983），按职责拆开后编排层更容易读。
 *
 * 兼容：`frameLayout.ts` 原样再导出本模块的公开符号（`collectFrameRoots` /
 * `framePrunedCollapsed` / `crossesFrameDepthBoundary` / `FrameLayer`）。
 */
import { frameOf } from '../protocol/frame.js';
import type { EditableNode } from '../tree/treeOps.js';
import { isGrowDir, type GrowDir, type LayoutNode } from './mindmap.js';

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

/** 挂点朝向（一期写死一条，规格 §11 开放项）：框根声明的 `note.dir`；无声明 → right */
export function islandDirOf(node: EditableNode): GrowDir {
  const raw = node.note?.dir;
  return isGrowDir(raw) ? raw : 'right';
}

/** 前序收集（原地追加；保持 layout.nodes 的前序契约） */
export function pushPreorder(ln: LayoutNode, out: LayoutNode[]): void {
  out.push(ln);
  for (const c of ln.children) pushPreorder(c, out);
}

/** 子树上全部节点 id 入集（不含 `node` 自身——框根由其自身 LayoutNode 承载） */
export function markSubtreeIds(node: EditableNode, out: Set<string>): void {
  for (const child of node.children) {
    out.add(child.id);
    markSubtreeIds(child, out);
  }
}

/** 框内层级归属：最近成框祖先 + 相对深度落在大纲层还是空间挂载层 */
export interface FrameLayer {
  frameId: string;
  layer: 'outline' | 'spatial';
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
export function layerFromChain(
  chain: readonly EditableNode[],
  selfOffset: number,
): FrameLayer | null {
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
export function outlineKey(layer: FrameLayer | null): string | null {
  return layer !== null && layer.layer === 'outline' ? layer.frameId : null;
}

/** `root` → `nodeId` 的节点链（含两端）；不在树内 → null */
export function chainToNode(root: EditableNode, nodeId: string): EditableNode[] | null {
  if (root.id === nodeId) return [root];
  for (const child of root.children) {
    const sub = chainToNode(child, nodeId);
    if (sub !== null) return [root, ...sub];
  }
  return null;
}
