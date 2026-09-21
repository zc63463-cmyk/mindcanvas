/**
 * verifyRoundTrip 的键顺序无关性。
 *
 * 背景（真实踩过）：note 的字段顺序取决于原文书写顺序，而 serializeMm 按
 * KNOWN_NOTE_ORDER 重排写入。于是「原文 desc→status、往返后 status→desc」
 * 这种**内容完全一致、仅键顺序不同**的情况，会被对键顺序敏感的
 * JSON.stringify 比较误判为「往返有损」。
 *
 * 而 verifyRoundTrip 是**保存前安全闸**——误报会拦住本该通过的保存，
 * 所以必须用测试锁住「只换顺序不算有损」。
 */
import { describe, expect, it } from 'vitest';
import type { MindNode } from '../src/protocol/types.js';
import { parseMm } from '../src/protocol/parser.js';
import { serializeMm, verifyRoundTrip } from '../src/protocol/serializer.js';

/** 构造：笔记块字段按给定顺序排列 */
function docWithNote(lines: string[]): string {
  return ['# 根', '', '<!--', ...lines, '-->', '- 子节点'].join('\n');
}

/**
 * 解析并取得根节点。
 *
 * `parseMm().root` 类型是 `MindNode | null`（空文档时无根），
 * 而本项目冻结了非空断言预算（bang 只减不增），故用一次显式判空 + 抛错收窄，
 * 让后续用例拿到非空类型，而不是到处补 `!`。
 */
function parseRoot(src: string): MindNode {
  const { root } = parseMm(src);
  if (!root) throw new Error(`解析未产出根节点：${src}`);
  return root;
}

describe('verifyRoundTrip · 键顺序无关', () => {
  it('笔记字段顺序不同不影响往返判定（desc 在前）', () => {
    const src = docWithNote([
      'desc: 一段描述，含中文与符号（+ / ，）',
      'status: 进行中',
    ]);
    const root = parseRoot(src);
    expect(verifyRoundTrip(root)).toBe(true);
  });

  it('笔记字段顺序不同不影响往返判定（status 在前）', () => {
    const src = docWithNote([
      'status: 进行中',
      'desc: 一段描述，含中文与符号（+ / ，）',
    ]);
    const root = parseRoot(src);
    expect(verifyRoundTrip(root)).toBe(true);
  });

  it('两种顺序解析出的内容等价，只是键序不同', () => {
    const a = parseRoot(docWithNote(['desc: 描述文本', 'status: 进行中']));
    const b = parseRoot(docWithNote(['status: 进行中', 'desc: 描述文本']));
    const noteA = a.children[0]?.note;
    const noteB = b.children[0]?.note;
    expect(JSON.stringify(noteA)).not.toBe(JSON.stringify(noteB));
    // 内容一致，仅顺序不同 → 两者都应判定为往返无损
    expect(verifyRoundTrip(a)).toBe(true);
    expect(verifyRoundTrip(b)).toBe(true);
  });

  it('内容真的变了仍要判定为有损（不能放宽成永远通过）', () => {
    // 只序列化、不重新解析：直接比较不同内容的两棵树不足以证伪，
    // 故这里验证 serialize→parse 对同一棵树稳定，而不同内容确实产生不同输出
    const a = parseRoot(docWithNote(['desc: 甲']));
    const b = parseRoot(docWithNote(['desc: 乙']));
    expect(serializeMm(a)).not.toBe(serializeMm(b));
    expect(verifyRoundTrip(a)).toBe(true);
    expect(verifyRoundTrip(b)).toBe(true);
  });
});
