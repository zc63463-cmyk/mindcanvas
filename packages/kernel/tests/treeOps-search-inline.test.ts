import { describe, expect, it } from 'vitest';
import type { EditableNode } from '../src/tree/treeOps.js';
import { searchNodes } from '../src/tree/treeOps.js';

function t(id: string, text: string, children: EditableNode[] = []): EditableNode {
  return { id, type: 'text', text, children };
}

describe('treeOps：富文本感知搜索（忽略行内标记）', () => {
  it('按 **加粗** 内容可命中', () => {
    const root = t('r', '总纲', [t('a', '这是 **重点** 内容'), t('b', '普通内容')]);
    expect(searchNodes(root, '重点')).toEqual(['a']);
  });

  it('按 `code` 与 [链接](url) 可见文本可命中', () => {
    const root = t('r', '总纲', [t('a', '执行 `npm test`'), t('b', '见 [文档](http://a.b)')]);
    expect(searchNodes(root, 'npm test')).toEqual(['a']);
    expect(searchNodes(root, '文档')).toEqual(['b']);
  });

  it('标记符号本身不参与匹配（"**" 不命中富文本节点）', () => {
    const root = t('r', '总纲', [t('a', '普通 **加粗**')]);
    expect(searchNodes(root, '**')).toEqual([]);
  });
});
