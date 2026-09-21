/**
 * 富文本搜索：匹配标题 + 笔记字段（one_liner/status/next/reminder/decisions/qa）。
 * 纯函数；返回 { node, pathLabel }。
 */
import { describe, expect, it } from 'vitest';
import { makeTextNode } from '@mindcanvas/kernel';
import type { EditableNode, Note } from '@mindcanvas/kernel';
import { searchMind } from '../src/search/search.js';

/** 便捷构造：text + children + note */
function n(text: string, children: EditableNode[] = [], note?: Note): EditableNode {
  const node = makeTextNode(text, children);
  if (note) node.note = note;
  return node;
}

describe('searchMind：富文本搜索', () => {
  const root = n('根', [
    n('文档架构', [
      n('实体引用协议'),
      n('知识画布与约定', [], { one_liner: '画布规则：约定优先，支持折叠与笔记' }),
    ]),
    n('门户显示优化', [], { status: 'open', decisions: ['先收口 K4', '节点向下生长'] }),
    n('解析链路验证', [], { next: '验证 qa 批注回放', qa: ['路径要可观察'] }),
  ]);

  it('大小写不敏感匹配标题', () => {
    expect(searchMind(root, '门户').map((r) => r.node.text)).toEqual(['门户显示优化']);
  });

  it('匹配笔记字段（decisions/one_liner）', () => {
    expect(searchMind(root, '向下生长').map((x) => x.node.text)).toEqual(['门户显示优化']);
    expect(searchMind(root, '折叠与笔记').map((x) => x.node.text)).toEqual(['知识画布与约定']);
  });

  it('匹配 qa 批注', () => {
    expect(searchMind(root, '可观察').map((x) => x.node.text)).toEqual(['解析链路验证']);
  });

  it('搜索结果含路径标签（祖先链）', () => {
    const r = searchMind(root, 'qa 批注');
    expect(r).toHaveLength(1);
    expect(r[0]!.pathLabel).toContain('根');
    expect(r[0]!.pathLabel).toContain('解析链路验证');
  });

  it('空查询 → 空结果', () => {
    expect(searchMind(root, '   ')).toEqual([]);
    expect(searchMind(root, '')).toEqual([]);
  });

  it('无匹配 → 空结果', () => {
    expect(searchMind(root, '不存在的关键词xyz')).toEqual([]);
  });
});
