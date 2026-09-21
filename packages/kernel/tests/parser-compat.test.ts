import { describe, expect, it } from 'vitest';
import { parseMm } from '../src/protocol/parser.js';
import { serializeMm } from '../src/protocol/serializer.js';

/**
 * 协议扩展兼容性预留：为未来「标签(::tag)/概要(summary)/富文本」预留能力，
 * 固化为协议保证——未知行内记号一律按普通文本，note 未知键透传，不产生诊断。
 */

const ok = (text: string): void => {
  const r = parseMm(text);
  expect(r.diagnostics).toEqual([]);
  expect(r.root).not.toBeNull();
};

describe('protocol：未知行内记号宽容（前向兼容）', () => {
  it('行内 ::tag 候选记号 → 普通文本，无诊断', () => {
    const r = parseMm('# t\n- 重点 :: 待办');
    expect(r.diagnostics).toEqual([]);
    expect(r.root!.children?.[0]?.text).toBe('重点 :: 待办');
  });

  it('富文本记号（加粗/代码/链接）在文本节点原样保留，无诊断', () => {
    ok('# t\n- 执行 `npm test` 可过 **校验**，见 [手册](http://a.b)');
    const r = parseMm('# t\n- 执行 **A** 与 [B](u)');
    expect(r.root!.children?.[0]?.text).toContain('**A**');
    expect(r.root!.children?.[0]?.text).toContain('[B](u)');
  });

  it('未来可能引入的标记形态（#tag / :: / summary 顶层键) 不触发诊断', () => {
    ok('# t\n- #杂项\n- 待办 :: high\n- 全文 :: 摘要');
  });

  it('@ 无冒号（如 @abc）→ 普通文本而非引用意图', () => {
    const r = parseMm('# t\n- 提到 @abc 而已');
    expect(r.diagnostics).toEqual([]);
    expect(r.root!.children?.[0]?.text).toContain('@abc');
  });

  it('note 块未知键（summary:/tags:）透传保留，round-trip 不回丢', () => {
    // 笔记绑定其后第一个结构节点：注释块置于列表项之前
    const text = '# t\n  <!--\n  summary: 一句话概述\n  tags:\n  - 待办\n  -->\n- 节点';
    const r = parseMm(text);
    expect(r.diagnostics).toEqual([]);
    const note = r.root!.children?.[0]?.note;
    expect(note?.summary).toBe('一句话概述');
    expect(Array.isArray(note?.tags)).toBe(true);
    const out = serializeMm(r.root!);
    expect(out).toContain('summary:');
    expect(out).toContain('tags:');
  });

  it('note rel 键（关系边目标引用）保留，round-trip 不回丢', () => {
    const text = '# t\n  <!--\n  rel: @idea:forge-inbox:5\n  -->\n- 关联到灵感';
    const r = parseMm(text);
    expect(r.diagnostics).toEqual([]);
    expect(r.root!.children?.[0]?.note?.rel).toBe('@idea:forge-inbox:5');
    expect(serializeMm(r.root!)).toContain('rel:');
  });

  it('note layout 键（结构布局持久化）经根节点笔记 round-trip 不回丢', () => {
    // MapView 布局切换写入 root.note.layout；序列化器把 note 块置于根 H1 之前，
    // 重解析时由根节点接收（bindNote 于根创建时刻）→ 全链路保留
    const text = '<!--\nlayout: org\n-->\n# 根\n## 分支\n- 甲';
    const r = parseMm(text);
    expect(r.diagnostics).toEqual([]);
    expect(r.root!.note?.layout).toBe('org');
    const p2 = parseMm(serializeMm(r.root!));
    expect(p2.root).toEqual(r.root);
    expect(p2.root!.note?.layout).toBe('org');
    expect(p2.diagnostics).toEqual([]);
  });
});
