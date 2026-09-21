/**
 * cid 序列化 round-trip（C1 协议无损验证探针）。
 *
 * 验证：node.note.cid 标量、root.note.centers[].cid 键、root.note.next_cid 计数器
 * 经 serializeMm → parseMm 往返无损（与 verifyRoundTrip 安全闸一致）。
 * 全为字符串字面量（.mm.md 往返后标量本就是字符串），避免 number/string 差异。
 */
import { describe, expect, it } from 'vitest';
import { parseMm } from '../src/protocol/parser.js';
import { serializeMm, verifyRoundTrip } from '../src/protocol/serializer.js';
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
  return {
    id: 'root',
    type: 'text',
    text: '总览',
    note: {
      next_cid: '8',
      centers: [{ cid: 'c7', at: 'node:总览/工作', dir: 'right', x: '400', y: '120' }],
    },
    children: [work, node('l', '生活')],
  };
}

describe('cid 序列化 round-trip', () => {
  it('★ verifyRoundTrip 安全闸通过（含 cid/next_cid/centers.cid）', () => {
    expect(verifyRoundTrip(tree())).toBe(true);
  });

  it('节点 note.cid 标量往返无损', () => {
    const text = serializeMm(tree());
    const parsed = parseMm(text).root!;
    const work = parsed.children.find((c) => c.text === '工作')!;
    expect(work.note?.cid).toBe('c7');
  });

  it('root.note.next_cid 与 centers[].cid 往返无损', () => {
    const text = serializeMm(tree());
    const parsed = parseMm(text).root!;
    expect(parsed.note?.next_cid).toBe('8');
    const centers = parsed.note?.centers as Array<Record<string, unknown>>;
    expect(centers[0]!.cid).toBe('c7');
    expect(centers[0]!.at).toBe('node:总览/工作');
  });

  it('手写 cid 写入为 cid: c7 标量', () => {
    const text = serializeMm(tree());
    expect(text).toContain('cid: c7');
    expect(text).toContain('next_cid: 8');
  });
});
