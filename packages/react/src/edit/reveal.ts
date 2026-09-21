/**
 * 折叠定位展开（GH-T2：F1 已知边界修复）：
 * 目标节点位于折叠子树内时，focusNode 找不到布局节点（no-op）——定位前先展开祖先折叠。
 */
import type { EditableNode } from '@mindcanvas/kernel';

/** 目标节点的「折叠中的祖先」id 列表（自外向内；无 → 空数组） */
export function collapsedAncestors(
  root: EditableNode,
  collapsed: ReadonlySet<string>,
  id: string,
): string[] {
  if (id === root.id) return [];
  const ancestors: string[] = [];
  const walk = (n: EditableNode, acc: string[]): boolean => {
    if (n.id === id) {
      ancestors.push(...acc);
      return true;
    }
    for (const c of n.children) {
      if (walk(c, [...acc, n.id])) return true;
    }
    return false;
  };
  walk(root, []);
  return ancestors.filter((a) => collapsed.has(a));
}
