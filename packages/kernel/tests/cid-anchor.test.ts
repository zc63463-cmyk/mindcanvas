/**
 * cid 一等锚方案（C2 内核侧）。
 *
 * 覆盖：parseLinkAnchor 识别 cid: 前缀；buildCidIndex 扫描节点 note.cid；
 * resolveLinkAnchor 对 cid 锚按索引定位 nodeId（与 node:/@kind:id 并列）。
 */
import { describe, expect, it } from 'vitest';
import {
  buildCidIndex,
  parseLinkAnchor,
  resolveLinkAnchor,
} from '../src/registry/note-anchor.js';
import type { EditableNode } from '../src/tree/treeOps.js';

function node(id: string, text: string, children: EditableNode[] = []): EditableNode {
  return { id, type: 'text', text, children };
}

function tree(): EditableNode {
  const work: EditableNode = {
    id: 'w',
    type: 'text',
    text: '工作',
    note: { cid: 'c7' },
    children: [node('a', '项目A')],
  };
  const life: EditableNode = { id: 'l', type: 'text', text: '生活', note: { cid: 'c8' }, children: [] };
  return node('root', '总览', [work, life]);
}

describe('cid 锚 parseLinkAnchor', () => {
  it('识别 cid: 前缀为 cid 锚', () => {
    expect(parseLinkAnchor('cid:c7')).toEqual({ kind: 'cid', target: 'c7' });
  });
  it('空 cid 目标 → null', () => {
    expect(parseLinkAnchor('cid:')).toBeNull();
  });
  it('node:/@kind:id 解析不受影响', () => {
    expect(parseLinkAnchor('node:总览/工作')).toEqual({ kind: 'node', target: '总览/工作' });
    expect(parseLinkAnchor('issue:8')).toEqual({ kind: 'entity', target: 'issue:8' });
  });
});

describe('buildCidIndex', () => {
  it('扫描全树 node.note.cid → cid→nodeId', () => {
    const idx = buildCidIndex(tree());
    expect(idx.get('c7')).toBe('w');
    expect(idx.get('c8')).toBe('l');
    expect(idx.size).toBe(2);
  });
});

describe('resolveLinkAnchor cid 分支', () => {
  it('cid 命中 → well-formed + nodeId', () => {
    const r = tree();
    const res = resolveLinkAnchor(r, { kind: 'cid', target: 'c7' });
    expect(res).toEqual({ state: 'well-formed', nodeId: 'w' });
  });
  it('cid 缺失 → dangling（cid-not-found）', () => {
    const res = resolveLinkAnchor(tree(), { kind: 'cid', target: 'c99' });
    expect(res.state).toBe('dangling');
    expect(res.reason).toBe('cid-not-found');
  });
  it('接受调用方注入的索引（与自建一致）', () => {
    const idx = new Map<string, string>([['c7', 'w']]);
    const res = resolveLinkAnchor(tree(), { kind: 'cid', target: 'c7' }, idx);
    expect(res).toEqual({ state: 'well-formed', nodeId: 'w' });
  });
});
