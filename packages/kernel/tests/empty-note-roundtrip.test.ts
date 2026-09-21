/**
 * 空 note 往返（v1.7.1）。
 *
 * 背景（真实踩过）：把节点 note 的字段全部清空后，内存里留下 `note = {}`；
 * 历史写端 `if (node.note)` 对 `{}` 判真，写出空块
 *
 * <!--
 * -->
 *
 * 重解析时 `parseNoteYaml('') → null` → 判 E-INVALID-NOTE-YAML「笔记丢弃」——
 * 往返自伤：保存干净的文档反而报「非法 YAML」。
 *
 * 三处同判据修复（空 note ≡ 无 note）：
 * 1. serializer：空 note（{} / 全 undefined / 空数组）不落块；
 * 2. parser：空块（全空白）静默容忍为「无笔记」，不出诊断；
 * 3. strip（保存前安全闸）：与写端同判据（noteToLines 空 = 无 note），
 *    否则内存里的 {} 会在往返比较中被误判「有损」而拦住保存。
 */
import { describe, expect, it } from 'vitest';
import { parseMm } from '../src/protocol/parser.js';
import { serializeMm, verifyRoundTrip } from '../src/protocol/serializer.js';
import type { MindNode } from '../src/protocol/types.js';
import type { EditableNode } from '../src/tree/treeOps.js';

/** 解析并取根（无根即断言失败——测试输入都是自造的合法文档） */
function rootOf(src: string): MindNode {
  const root = parseMm(src).root;
  if (root === null) throw new Error('解析无根');
  return root;
}

function node(id: string, text: string, children: EditableNode[] = []): EditableNode {
  return { id, type: 'text', text, children };
}

describe('空 note 往返（v1.7.1）', () => {
  it('空块（<!-- --> 全空白）解析为零诊断、无 note', () => {
    const r = parseMm('# 根\n\n<!--\n-->\n- 子\n');
    expect(r.diagnostics).toEqual([]);
    expect(r.root?.children[0]?.note).toBeUndefined();
  });

  it('note = {} 不落空块，且保存前安全闸通过', () => {
    const root = node('r', '根', [{ ...node('c', '子'), note: {} }]);
    expect(serializeMm(root)).not.toContain('<!--');
    expect(verifyRoundTrip(root)).toBe(true);
  });

  it('含空块的旧文件：往返后空块消失、二次序列化字节幂等', () => {
    const first = rootOf('# 根\n\n<!--\n-->\n- 子\n');
    const s1 = serializeMm(first);
    const s2 = serializeMm(rootOf(s1));
    expect(s1).not.toContain('<!--');
    expect(s2).toBe(s1);
  });

  it('真非法笔记体（无冒号行）仍报 E-INVALID-NOTE-YAML（不误放行）', () => {
    const r = parseMm('# 根\n\n<!--\n这行没有冒号所以不是合法键值\n-->\n- 子\n');
    expect(r.diagnostics.some((d) => d.code === 'E-INVALID-NOTE-YAML')).toBe(true);
  });

  it('合法笔记字段不受影响（往返无损）', () => {
    const src = '# 根\n\n<!--\ndir: right\nlens: "{\\"up\\":60}"\n-->\n- 子\n';
    expect(parseMm(src).diagnostics).toEqual([]);
    const root = rootOf(src);
    expect(verifyRoundTrip(root)).toBe(true);
    expect(serializeMm(root)).toContain('dir: right');
  });
});
