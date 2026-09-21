/**
 * L1-4：文本区域链接的协议往返保真钉（派遣计划 §1.4「`[…]` 开头的文本往返安全」的测试化）。
 *
 * 行为链（已逐行核过，本测试钉死防回归）：
 *  ① serialize：yamlScalar 对 `[` 起始值自动加双引号并转义（含 `:` 的形态命中多条引号规则）；
 *  ② parse：stripQuotes 先还原引号与转义；scalarValue 对 `[` 起始尝试 JSON.parse——
 *     链接原文不是合法 JSON → catch 回原字符串；
 *  ③ 列表项判别：isObjItem 对引号开头项直接判字符串，不会被误读为对象项。
 *
 * 核心断言：desc / note[2] / note_text 各含一条链接 → parse → serialize → parse，
 * **三字段逐字相同**；且 serialize 输出幂等（canonical）。
 */
import { describe, expect, it } from 'vitest';
import type { MindNode } from '../src/protocol/types.js';
import { parseMm } from '../src/protocol/parser.js';
import { serializeMm } from '../src/protocol/serializer.js';

const LINK_DESC = '[名A](node:根/任务A)';
const LINK_NOTE = '[名C](cid:c7)';
const LINK_TEXT = '[名B](node:根/B)';

/** 手写源：desc 裸写、note[2] 带引号写（两种书写形态都覆盖） */
const SRC = [
  '<!--',
  `desc: ${LINK_DESC}`,
  'note:',
  '  - 普通条目',
  '  - 另一条',
  `  - "${LINK_NOTE}"`,
  `note_text: ${LINK_TEXT}`,
  '-->',
  '# 根',
  '',
  '- 任务A',
  '- B',
  '',
].join('\n');

function rootOf(src: string): MindNode {
  const root = parseMm(src).root;
  if (!root) throw new Error('夹具解析失败：root 为空');
  return root;
}

function fields(src: string): { desc: unknown; note: readonly string[] | undefined; text: unknown } {
  const root = rootOf(src);
  return { desc: root.note?.desc, note: root.note?.note, text: root.note?.note_text };
}

describe('L1-4 · 链接文本的 mm.md 往返保真', () => {
  it('parse → serialize → parse：desc / note[2] / note_text 三字段逐字相同', () => {
    const first = fields(SRC);
    expect(first.desc).toBe(LINK_DESC);
    expect(first.note?.[2]).toBe(LINK_NOTE);
    expect(first.text).toBe(LINK_TEXT);

    const s1 = serializeMm(rootOf(SRC));
    const second = fields(s1);
    expect(second.desc).toBe(LINK_DESC);
    expect(second.note?.[2]).toBe(LINK_NOTE);
    expect(second.text).toBe(LINK_TEXT);

    // canonical 幂等：二次序列化与一次逐字相同
    const s2 = serializeMm(rootOf(s1));
    expect(s2).toBe(s1);
  });

  it('回归：note 条目首尾带空格的原样往返（QaEditor.trim 之外的存储行为不变）', () => {
    const src = '<!--\nnote:\n  - "  [名](node:根/A)  "\n-->\n# 根';
    expect(rootOf(src).note?.note?.[0]).toBe('  [名](node:根/A)  ');
    const s1 = serializeMm(rootOf(src));
    expect(rootOf(s1).note?.note?.[0]).toBe('  [名](node:根/A)  ');
  });

  it('回归：普通文本（无链接）三字段往返不变（本批不改变既有协议行为）', () => {
    const src = '<!--\ndesc: 普通描述\nnote:\n  - 条目\nnote_text: 正文\n-->\n# 根';
    const s1 = serializeMm(rootOf(src));
    const f = fields(s1);
    expect(f.desc).toBe('普通描述');
    expect(f.note?.[0]).toBe('条目');
    expect(f.text).toBe('正文');
  });
});
