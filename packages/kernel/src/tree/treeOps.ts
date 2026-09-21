/**
 * 编辑树操作：不可变更新（clone-on-write 全路径重建，树规模小无性能问题）。
 * EditableNode = MindNode + 稳定 id（React key / 拖拽 / 选中等运行时标识）。
 * id 不进入序列化（editableToAst 剥离）。
 */

import type { EntityRef, MindNode, Note } from '../protocol/types.js';
import { stripInline } from '../layout/inline.js';

export interface EditableNode {
  id: string;
  type: 'text' | 'image' | 'entity';
  text?: string;
  url?: string;
  ref?: EntityRef;
  note?: Note;
  children: EditableNode[];
}

let seq = 0;
export function newId(): string {
  seq += 1;
  return `nd${Date.now().toString(36)}${seq.toString(36)}`;
}

export function makeTextNode(text: string, children: EditableNode[] = []): EditableNode {
  return { id: newId(), type: 'text', text, children };
}

export function makeEntityNode(ref: EntityRef, children: EditableNode[] = []): EditableNode {
  return { id: newId(), type: 'entity', ref: { ...ref }, children };
}

export function makeImageNode(url: string, children: EditableNode[] = []): EditableNode {
  return { id: newId(), type: 'image', url, children };
}

/** AST → 可编辑树（赋 id） */
export function astToEditable(node: MindNode | null): EditableNode | null {
  if (node === null) return null;
  const out: EditableNode = { id: newId(), type: node.type, children: [] };
  if (node.type === 'text' && node.text !== undefined) out.text = node.text;
  if (node.type === 'image' && node.url !== undefined) out.url = node.url;
  if (node.type === 'entity' && node.ref !== undefined) out.ref = { ...node.ref };
  if (node.note !== undefined) out.note = { ...node.note };
  out.children = node.children.map((c) => astToEditable(c) as EditableNode);
  return out;
}

/** 可编辑树 → AST（剥离 id） */
export function editableToAst(node: EditableNode): MindNode {
  const out: MindNode = { type: node.type, children: [] };
  if (node.type === 'text' && node.text !== undefined) out.text = node.text;
  if (node.type === 'image' && node.url !== undefined) out.url = node.url;
  if (node.type === 'entity' && node.ref !== undefined) out.ref = { ...node.ref };
  if (node.note !== undefined) out.note = node.note;
  out.children = node.children.map(editableToAst);
  return out;
}

// ---------- 查询 ----------

export interface NodeLocation {
  parent: EditableNode;
  index: number;
  node: EditableNode;
}

export function findNode(root: EditableNode, id: string): NodeLocation | null {
  for (let i = 0; i < root.children.length; i++) {
    const c = root.children[i];
    if (c.id === id) return { parent: root, index: i, node: c };
    const found = findNode(c, id);
    if (found) return found;
  }
  return null;
}

export function getNode(root: EditableNode, id: string): EditableNode | null {
  if (root.id === id) return root;
  return findNode(root, id)?.node ?? null;
}

/** 节点到根的路径（子索引链）；root → []；不存在 → null */
export function pathOf(root: EditableNode, id: string): number[] | null {
  if (root.id === id) return [];
  const walk = (n: EditableNode, trail: number[]): number[] | null => {
    for (let i = 0; i < n.children.length; i++) {
      const c = n.children[i]!;
      const t = [...trail, i];
      if (c.id === id) return t;
      const found = walk(c, t);
      if (found) return found;
    }
    return null;
  };
  return walk(root, []);
}

/** 按路径取节点（越界/负索引/深层缺失 → null） */
export function nodeByPath(root: EditableNode, path: number[]): EditableNode | null {
  let cur: EditableNode = root;
  for (const i of path) {
    if (i < 0 || i >= cur.children.length) return null;
    cur = cur.children[i]!;
  }
  return cur;
}

/** nodeId 是否位于 ancestorId 的子树内（不含 ancestor 自身） */
export function isInSubtree(root: EditableNode, ancestorId: string, nodeId: string): boolean {
  const anc = getNode(root, ancestorId);
  if (!anc) return false;
  return findNode(anc, nodeId) !== null;
}

/** 前序遍历收集实体引用（保留重复） */
export function collectRefs(root: EditableNode): EntityRef[] {
  const refs: EntityRef[] = [];
  const walk = (n: EditableNode): void => {
    if (n.type === 'entity' && n.ref) refs.push(n.ref);
    n.children.forEach(walk);
  };
  walk(root);
  return refs;
}

/** 前序遍历所有节点 */
export function walkNodes(root: EditableNode, fn: (n: EditableNode, depth: number) => void): void {
  const walk = (n: EditableNode, depth: number): void => {
    fn(n, depth);
    n.children.forEach((c) => walk(c, depth + 1));
  };
  walk(root, 0);
}

/** 深度（root=1）——供 move 后的深度上限校验 */
export function depthOf(root: EditableNode, id: string): number {
  let depth = -1;
  const walk = (n: EditableNode, d: number): boolean => {
    if (n.id === id) {
      depth = d;
      return true;
    }
    return n.children.some((c) => walk(c, d + 1));
  };
  walk(root, 1);
  return depth;
}

export const MAX_TREE_DEPTH = 16;

// ---------- 不可变操作（均返回新根；找不到目标或非法操作时原样返回） ----------

/** 添加子节点（index 缺省 = 末尾）；未变子树保持对象引用（结构共享——增量布局依赖） */
export function addChild(
  root: EditableNode,
  parentId: string,
  child: EditableNode,
  index?: number,
): EditableNode {
  const walk = (n: EditableNode): EditableNode => {
    if (n.id === parentId) {
      const children = [...n.children];
      children.splice(index ?? children.length, 0, child);
      return { ...n, children };
    }
    if (n.children.length === 0) return n;
    const children = n.children.map(walk);
    // 无变化：保持引用（避免全树克隆——语义不变，仅对象身份优化）
    let identical = true;
    for (let i = 0; i < children.length; i++) {
      if (children[i] !== n.children[i]) {
        identical = false;
        break;
      }
    }
    return identical ? n : { ...n, children };
  };
  return walk(root);
}

/** 删除节点（根不可删）；返回 { root, removed } */
export function removeNode(
  root: EditableNode,
  id: string,
): { root: EditableNode; removed: boolean } {
  if (root.id === id) return { root, removed: false };
  let removed = false;
  const walk = (n: EditableNode): EditableNode => {
    const children: EditableNode[] = [];
    let changed = false;
    for (const c of n.children) {
      if (c.id === id) {
        removed = true;
        changed = true;
        continue;
      }
      children.push(walk(c));
    }
    if (!changed && children.length === n.children.length) {
      // 无变化：保持引用，避免无谓克隆
      let identical = true;
      for (let i = 0; i < children.length; i++) {
        if (children[i] !== n.children[i]) {
          identical = false;
          break;
        }
      }
      if (identical) return n;
    }
    return { ...n, children };
  };
  return { root: walk(root), removed };
}

/** 更新节点字段（text/url/ref/note/type）；未变子树保持对象引用（结构共享——增量布局依赖） */
export function updateNode(
  root: EditableNode,
  id: string,
  patch: Partial<Pick<EditableNode, 'text' | 'url' | 'ref' | 'note' | 'type'>>,
): EditableNode {
  const walk = (n: EditableNode): EditableNode => {
    if (n.id === id) {
      const next: EditableNode = { ...n, ...patch };
      // 显式字段删除语义（T15 修复）：patch 置 undefined 的字段从节点上删除属性。
      // 此前纯 spread 会残留 `note: undefined` 属性——undo「无 note → 写 note」时
      // `'note' in n` 为 true，与初始「无 note」的可观察行为不一致（结构共享与序列化
      // 不受影响：editableToAst 本就以 `!== undefined` 判定；此修复仅消除属性残留）。
      if (next.text === undefined) delete next.text;
      if (next.url === undefined) delete next.url;
      if (next.ref === undefined) delete next.ref;
      if (next.note === undefined) delete next.note;
      return next;
    }
    if (n.children.length === 0) return n;
    const children = n.children.map(walk);
    // 无变化：保持引用（避免全树克隆——语义不变，仅对象身份优化）
    let identical = true;
    for (let i = 0; i < children.length; i++) {
      if (children[i] !== n.children[i]) {
        identical = false;
        break;
      }
    }
    return identical ? n : { ...n, children };
  };
  return walk(root);
}

/**
 * 移动节点（拖拽重排统一入口）。
 * 拒绝：根移动 / 目标为自身 / 目标在自身子树内 / 深度超限。
 */
export function moveNode(
  root: EditableNode,
  id: string,
  targetParentId: string,
  index: number,
): { root: EditableNode; moved: boolean; reason?: string } {
  if (id === root.id) return { root, moved: false, reason: '根节点不可移动' };
  if (id === targetParentId) return { root, moved: false, reason: '不能移动到自身' };
  if (isInSubtree(root, id, targetParentId)) {
    return { root, moved: false, reason: '不能移动到自己的子树' };
  }
  const node = getNode(root, id);
  const target = getNode(root, targetParentId);
  if (!node || !target) return { root, moved: false, reason: '节点不存在' };
  // 深度校验：node 子树整体下移后最深路径 = target 深度 + node 子树高度
  const subtreeHeight = (n: EditableNode): number =>
    1 + (n.children.length ? Math.max(...n.children.map(subtreeHeight)) : 0);
  const targetDepth = depthOf(root, targetParentId);
  if (targetDepth + subtreeHeight(node) > MAX_TREE_DEPTH) {
    return { root, moved: false, reason: `深度将超过 ${MAX_TREE_DEPTH}` };
  }
  const detached = removeNode(root, id).root;
  // removeNode 后目标索引可能收缩：clamp
  const targetAfter = getNode(detached, targetParentId);
  if (!targetAfter) return { root, moved: false, reason: '目标丢失' };
  const idx = Math.max(0, Math.min(index, targetAfter.children.length));
  const next = addChild(detached, targetParentId, node, idx);
  return { root: next, moved: true };
}

/**
 * 按可见文本/实体引用子串（忽略大小写）搜索节点，返回匹配节点 id（前序遍历顺序）。
 * 文本节点先剥离行内标记（粗体/代码/链接）——搜索命中用户看见的内容。
 * 空查询 → 空数组。
 */
export function searchNodes(root: EditableNode, query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: string[] = [];
  const walk = (n: EditableNode): void => {
    if (
      n.type === 'text' &&
      stripInline(n.text ?? '')
        .toLowerCase()
        .includes(q)
    )
      out.push(n.id);
    else if (n.type === 'entity' && n.ref && `${n.ref.kind}:${n.ref.id}`.toLowerCase().includes(q))
      out.push(n.id);
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

/** 深拷贝子树（全部换新 id） */
function cloneSubtree(node: EditableNode): EditableNode {
  const out: EditableNode = { id: newId(), type: node.type, children: [] };
  if (node.type === 'text' && node.text !== undefined) out.text = node.text;
  if (node.type === 'image' && node.url !== undefined) out.url = node.url;
  if (node.type === 'entity' && node.ref !== undefined) out.ref = { ...node.ref };
  if (node.note !== undefined) out.note = { ...node.note };
  out.children = node.children.map(cloneSubtree);
  return out;
}

/**
 * 复制节点：连同子树/笔记/实体引用整体拷贝（全部新 id），插入为原节点的后一兄弟。
 * 根不可复制 / 节点不存在 → insertedId = null（root 原样返回）。
 */
export function duplicateNode(
  root: EditableNode,
  id: string,
): { root: EditableNode; insertedId: string | null } {
  if (id === root.id) return { root, insertedId: null };
  const loc = findNode(root, id);
  if (!loc) return { root, insertedId: null };
  const copy = cloneSubtree(loc.node);
  return { root: addChild(root, loc.parent.id, copy, loc.index + 1), insertedId: copy.id };
}

// ---------- 树形导航（方向键移动选中；叶子/越界/不存在 → null） ----------

/** 首个子节点 id；叶子或不存在 → null */
export function firstChildId(root: EditableNode, id: string): string | null {
  const n = id === root.id ? root : findNode(root, id)?.node;
  if (!n || n.children.length === 0) return null;
  return n.children[0]!.id;
}

/** 下一个兄弟 id；末位/根/不存在 → null */
export function nextSiblingId(root: EditableNode, id: string): string | null {
  const loc = findNode(root, id);
  if (!loc) return null;
  return loc.parent.children[loc.index + 1]?.id ?? null;
}

/** 上一个兄弟 id；首位/根/不存在 → null */
export function prevSiblingId(root: EditableNode, id: string): string | null {
  const loc = findNode(root, id);
  if (!loc || loc.index === 0) return null;
  return loc.parent.children[loc.index - 1]!.id;
}

/** 父节点 id；根或不存在 → null */
export function parentIdOf(root: EditableNode, id: string): string | null {
  if (id === root.id) return null;
  return findNode(root, id)?.parent.id ?? null;
}

// ---------- 折叠增强（隐藏子树计数 / 批量折叠集） ----------

/** 后代节点总数（不含自身）；节点不存在 → 0 */
export function descendantCount(root: EditableNode, id: string): number {
  const n = id === root.id ? root : findNode(root, id)?.node;
  if (!n) return 0;
  let sum = 0;
  const walk = (node: EditableNode): void => {
    for (const c of node.children) {
      sum += 1;
      walk(c);
    }
  };
  walk(n);
  return sum;
}

/** 返回需折叠的节点 id（depth === level 且有子节点；根不折叠）：level=1 全部折叠（只保留根），level=2 保留两级 */
export function collapseFromLevel(root: EditableNode, level: number): string[] {
  const out: string[] = [];
  const walk = (n: EditableNode, depth: number): void => {
    if (depth > 0 && depth === level && n.children.length > 0) out.push(n.id);
    for (const c of n.children) walk(c, depth + 1);
  };
  walk(root, 0);
  return out;
}
