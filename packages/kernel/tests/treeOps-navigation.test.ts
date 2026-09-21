import { describe, expect, it } from 'vitest';
import type { EditableNode } from '../src/tree/treeOps.js';
import { firstChildId, nextSiblingId, parentIdOf, prevSiblingId } from '../src/tree/treeOps.js';

/**
 * 树形导航（方向键移动选中用；fixture 直接构树以便使用固定 id）：
 *   r
 *   ├─ a
 *   │  ├─ a1
 *   │  └─ a2
 *   └─ b
 */
function t(id: string, children: EditableNode[] = []): EditableNode {
  return { id, type: 'text', text: id, children };
}

function fixture(): EditableNode {
  return t('r', [t('a', [t('a1'), t('a2')]), t('b')]);
}

describe('treeOps：树形导航（方向键选区移动）', () => {
  it('firstChildId：有子返回首子 id，叶子返回 null', () => {
    const root = fixture();
    expect(firstChildId(root, root.id)).toBe('a');
    expect(firstChildId(root, 'a')).toBe('a1');
    expect(firstChildId(root, 'a2')).toBe(null);
  });

  it('nextSiblingId / prevSiblingId：按兄弟顺序往返移动，越界返回 null', () => {
    const root = fixture();
    expect(nextSiblingId(root, 'a')).toBe('b');
    expect(nextSiblingId(root, 'b')).toBe(null);
    expect(prevSiblingId(root, 'b')).toBe('a');
    expect(prevSiblingId(root, 'a')).toBe(null);
    // 叶子节点也可相对其父的兄弟列表导航
    expect(nextSiblingId(root, 'a1')).toBe('a2');
    expect(prevSiblingId(root, 'a2')).toBe('a1');
  });

  it('parentIdOf：返回父 id；根与不存在的节点返回 null', () => {
    const root = fixture();
    expect(parentIdOf(root, 'a1')).toBe('a');
    expect(parentIdOf(root, 'a')).toBe(root.id);
    expect(parentIdOf(root, root.id)).toBe(null);
    expect(parentIdOf(root, 'ghost')).toBe(null);
  });
});
