import { describe, expect, it } from 'vitest';
import type { EditableNode } from '../src/tree/treeOps.js';
import { collapseFromLevel, descendantCount } from '../src/tree/treeOps.js';

/**
 * 折叠增强 fixture：
 *   r
 *   ├─ a
 *   │  ├─ a1
 *   │  │  └─ a11
 *   │  └─ a2
 *   └─ b
 */
function t(id: string, children: EditableNode[] = []): EditableNode {
  return { id, type: 'text', text: id, children };
}

function fixture(): EditableNode {
  return t('r', [t('a', [t('a1', [t('a11')]), t('a2')]), t('b')]);
}

describe('treeOps：折叠增强', () => {
  it('descendantCount：折叠点隐藏的后代总节点数（不含自身；叶子为 0）', () => {
    const root = fixture();
    expect(descendantCount(root, root.id)).toBe(5); // a,a1,a11,a2,b
    expect(descendantCount(root, 'a')).toBe(3); // a1,a11,a2
    expect(descendantCount(root, 'a1')).toBe(1); // a11
    expect(descendantCount(root, 'a2')).toBe(0);
    expect(descendantCount(root, 'ghost')).toBe(0);
  });

  it('collapseFromLevel：返回需折叠的节点 id（depth>=level 且有子、不含根）', () => {
    const root = fixture();
    // 全部折叠 = level 1：a,b? b 无子 → 仅 a 折叠
    expect(collapseFromLevel(root, 1)).toEqual(['a']);
    // 展开两级 = level 2：a1 折叠（a 保持展开）
    expect(collapseFromLevel(root, 2)).toEqual(['a1']);
    // 更下层 → 空集
    expect(collapseFromLevel(root, 4)).toEqual([]);
  });
});
