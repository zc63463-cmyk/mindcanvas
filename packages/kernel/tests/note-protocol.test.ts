/**
 * 节点注释（note）协议测试（v1.4.0）
 *
 * 协议形态（两个平级键，同一浮窗的两个区域）：
 *   note: [条目...]        序列区域
 *   note_text: "一整段"    纯文本区域（`\n` 转义多行）
 *
 * 另测 `qa` → `note` 的读取回退（旧文件兼容）。
 */
import { describe, expect, it } from 'vitest';
import { hasNote, noteOf } from '../src/protocol/note.js';
import { parseMm } from '../src/protocol/parser.js';
import type { MindNode } from '../src/protocol/types.js';
import { serializeMm } from '../src/protocol/serializer.js';

// 测试夹具都有根节点，root 必然非空 —— 这里的 `!` 是合理的断言语义
function rootOf(text: string): MindNode {
  return parseMm(text).root!;
}

describe('node 注释：解析', () => {
  it('note（序列区域）解析为字符串数组', () => {
    const r = rootOf('<!--\nnote:\n  - 条目一\n  - 条目二\n-->\n# 根');
    const { seq, text } = noteOf(r);
    expect(seq).toEqual(['条目一', '条目二']);
    expect(text).toBe('');
  });

  it('note_text（纯文本区域）解析为带换行的整段', () => {
    const r = rootOf('<!--\nnote_text: "第一行\\n第二行"\n-->\n# 根');
    const { seq, text } = noteOf(r);
    expect(seq).toEqual([]);
    expect(text).toBe('第一行\n第二行');
  });

  it('两个区域可同时存在', () => {
    const r = rootOf('<!--\nnote:\n  - 条目一\nnote_text: 正文\n-->\n# 根');
    const { seq, text } = noteOf(r);
    expect(seq).toEqual(['条目一']);
    expect(text).toBe('正文');
  });

  it('qa 回退：旧文件的快速注释读作序列区域', () => {
    const r = rootOf('<!--\nqa:\n  - 老问题一\n  - 老问题二\n-->\n# 根');
    const { seq } = noteOf(r);
    expect(seq).toEqual(['老问题一', '老问题二']);
  });

  it('note 优先于 qa（两者都在时取新字段）', () => {
    const r = rootOf('<!--\nnote:\n  - 新条目\nqa:\n  - 老条目\n-->\n# 根');
    expect(noteOf(r).seq).toEqual(['新条目']);
  });

  it('空注释：hasNote 为假', () => {
    const r = rootOf('# 根');
    expect(hasNote(r)).toBe(false);
    expect(noteOf(r)).toEqual({ seq: [], text: '' });
  });

  it('有任一区域即 hasNote 为真', () => {
    expect(hasNote(rootOf('<!--\nnote:\n  - x\n-->\n# 根'))).toBe(true);
    expect(hasNote(rootOf('<!--\nnote_text: x\n-->\n# 根'))).toBe(true);
  });
});

describe('node 注释：往返无损', () => {
  const cases: Array<[string, string]> = [
    ['序列', '<!--\nnote:\n  - 条目一\n  - 条目二\n-->\n# 根'],
    ['纯文本多行', '<!--\nnote_text: "第一行\\n第二行"\n-->\n# 根'],
    ['两区域共存', '<!--\nnote:\n  - 条目一\nnote_text: 正文\n-->\n# 根'],
  ];

  for (const [name, src] of cases) {
    it(`${name}：parse → serialize → parse 数据不变`, () => {
      const p1 = parseMm(src);
      const p2 = parseMm(serializeMm(p1.root!));
      expect(JSON.stringify(noteOf(p2.root))).toBe(JSON.stringify(noteOf(p1.root)));
    });
  }

  it('序列化幂等（serialize 两次结果一致）', () => {
    const src = '<!--\nnote:\n  - 条目一\nnote_text: 正文\n-->\n# 根';
    const s1 = serializeMm(parseMm(src).root!);
    const s2 = serializeMm(parseMm(s1).root!);
    expect(s2).toBe(s1);
  });
});
