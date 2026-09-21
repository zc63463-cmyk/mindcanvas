import { describe, expect, it } from 'vitest';
import { collapsedAncestors } from '../src/edit/reveal.js';
import type { EditableNode } from '@mindcanvas/kernel';

function node(id: string, children: EditableNode[] = []): EditableNode {
  return { id, type: 'text', text: id, children } as EditableNode;
}

const tree: EditableNode = node('root', [
  node('a', [node('a1', [node('a1x')])]),
  node('b', [node('b1')]),
]);

describe('折叠定位展开（GH-T2：F1 边界修复）', () => {
  it('目标在折叠祖先下 → 返回自外向内待展开祖先（仅折叠中的）', () => {
    expect(collapsedAncestors(tree, new Set(['a', 'a1']), 'a1x')).toEqual(['a', 'a1']);
    expect(collapsedAncestors(tree, new Set(['a']), 'a1x')).toEqual(['a']);
  });

  it('祖先未折叠 / 目标可见 → 空数组', () => {
    expect(collapsedAncestors(tree, new Set(), 'a1x')).toEqual([]);
    expect(collapsedAncestors(tree, new Set(['a']), 'b1')).toEqual([]); // b 未折叠
    expect(collapsedAncestors(tree, new Set(['a']), 'a1')).toEqual(['a']); // a 折叠 → 定位 a1 需展开 a
  });

  it('目标不存在 / 根自身 → 空数组', () => {
    expect(collapsedAncestors(tree, new Set(['a']), 'missing')).toEqual([]);
    expect(collapsedAncestors(tree, new Set(['a']), 'root')).toEqual([]);
  });
});
