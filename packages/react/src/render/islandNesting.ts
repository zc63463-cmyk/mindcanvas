/**
 * 嵌套升格岛 · 内容树祖先关系（Section 框内包容 + 父岛拖动跟移）。
 *
 * 投影层仍把升格子树从父岛剔除（独立布局岛）；本模块只回答：
 * 「在文档内容树上，哪些升格中心是某中心的真子孙」。
 *
 * `detached`：切断岛不挂到切断点之上的祖先（相对上级独立）；
 * 其自身仍可包容自己的非切断子孙。
 */
import type { EditableNode } from '@mindcanvas/kernel';

/**
 * @returns Map&lt;祖先中心 nodeId, 其内容树子孙升格中心 nodeId[]（先序）&gt;
 *          每个 well-formed 中心都有键（无子孙则为 []）。
 */
export function buildNestedCenterIdsByRoot(
  documentRoot: EditableNode,
  centerIds: ReadonlySet<string>,
  detachedIds: ReadonlySet<string> = new Set(),
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const id of centerIds) out.set(id, []);

  const walk = (node: EditableNode, ancestors: readonly string[]): void => {
    const isCenter = centerIds.has(node.id);
    const isDetached = detachedIds.has(node.id);
    let childAncestors = ancestors;
    if (isCenter) {
      if (isDetached) {
        // 切断：不登记到上级祖先；下级只认本岛为祖先链起点
        childAncestors = [node.id];
      } else {
        for (const a of ancestors) {
          const list = out.get(a);
          if (list) list.push(node.id);
        }
        childAncestors = [...ancestors, node.id];
      }
    }
    for (const child of node.children) walk(child, childAncestors);
  };
  walk(documentRoot, []);
  return out;
}

/** Section / 拖动预览：本岛成员 ∪ 各包容子孙岛成员（去重、本岛在前） */
export function containedMemberIds(
  rootId: string,
  membersByRoot: ReadonlyMap<string, readonly string[]>,
  nestedCenterIdsByRoot: ReadonlyMap<string, readonly string[]>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const pushAll = (ids: readonly string[] | undefined): void => {
    if (!ids) return;
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  };
  pushAll(membersByRoot.get(rootId));
  for (const nested of nestedCenterIdsByRoot.get(rootId) ?? []) {
    pushAll(membersByRoot.get(nested));
  }
  return out;
}
