/**
 * S1 · summary_of 协议 round-trip 锁定（摘要节点 = XMind 式概要）。
 *
 * 断言核心：parser/serializer **零改动**即可承载 `summary_of`，且两种书写形态
 * 都能读回同一对象：
 *  - 块形态（v1.7.0 一层嵌套 mapping）：`summary_of:` + 缩进 `from:` / `to:`
 *  - 内联 JSON：`summary_of: {"from":"…","to":"…"}`（对象值写端形态）
 *
 * 本文件故意不经任何 summary 专用写入路径——若未来 parser/serializer 行为退化
 * （如嵌套 mapping 判定收紧、对象标量 JSON 分支丢失、未知键丢弃），这里会先红。
 *
 * 数据无损纪律（与 section.ts / frame.ts 一致）：读侧只做形态收窄，
 * **不认 ≠ 丢弃**——坏形态原值仍在 note 中，重新序列化原样写回。
 */
import { describe, expect, it } from 'vitest';
import { parseMm } from '../src/protocol/parser.js';
import { serializeMm } from '../src/protocol/serializer.js';
import { removeSummaryOf, summaryOf, upsertSummaryOf } from '../src/protocol/summary.js';
import type { MindNode, Note } from '../src/protocol/types.js';

/** 块形态：summary_of = 一层嵌套 mapping */
const DOC_BLOCK = [
  '<!--',
  'summary_of:',
  '  from: cid:c7',
  '  to: cid:c9',
  '-->',
  '# 根',
  '',
  '## 成员A',
  '',
  '## 成员B',
  '',
  '## 成员C',
  '',
].join('\n');

/** 内联 JSON 形态（写端产出的对象标量） */
const DOC_JSON = DOC_BLOCK.replace(
  'summary_of:\n  from: cid:c7\n  to: cid:c9',
  'summary_of: {"from":"cid:c7","to":"cid:c9"}',
);

/** parseMm 的根：显式检查替代非空断言（fixture broken 时报得比静默 null 清楚） */
function rootOf(text: string): MindNode {
  const p = parseMm(text);
  if (p.root === null) throw new Error('fixture broken: parseMm 未产出根');
  return p.root;
}

function roundTripTwice(text: string) {
  const p1 = parseMm(text);
  const r1 = p1.root;
  if (r1 === null) throw new Error('fixture broken: parseMm 未产出根');
  const out1 = serializeMm(r1);
  const p2 = parseMm(out1);
  const r2 = p2.root;
  if (r2 === null) throw new Error('fixture broken: 往返后无根');
  const out2 = serializeMm(r2);
  return { p1, p2, r1, r2, out1, out2 };
}

describe('S1 · summary_of 协议 round-trip', () => {
  it('块形态：parse → serialize → parse 幂等（二次序列化字节一致）+ 零诊断噪声', () => {
    const { p1, p2, out1, out2 } = roundTripTwice(DOC_BLOCK);
    expect(out2).toBe(out1);
    expect(p2.root).toEqual(p1.root);
    expect(p1.diagnostics).toEqual([]);
  });

  it('内联 JSON 形态：同样往返幂等 + 零诊断噪声', () => {
    const { p1, p2, out1, out2 } = roundTripTwice(DOC_JSON);
    expect(out2).toBe(out1);
    expect(p2.root).toEqual(p1.root);
    expect(p1.diagnostics).toEqual([]);
  });

  it('两种形态读回同一锚对象（形态无关的读侧归一）', () => {
    const viaBlock = summaryOf(rootOf(DOC_BLOCK).note);
    const viaJson = summaryOf(rootOf(DOC_JSON).note);
    expect(viaBlock).toEqual({ from: 'cid:c7', to: 'cid:c9' });
    expect(viaJson).toEqual(viaBlock);
  });

  it('canonical：写端把块形态归一为内联 JSON（与 frame/links 同口径），再解析仍是同一对象', () => {
    const out1 = serializeMm(rootOf(DOC_BLOCK));
    // 对象值 → 内联 JSON 作为带引号标量（yamlScalar 对 `{` 起始自动加引号并转义内部引号）
    expect(out1).toMatch(/summary_of: "\{/);
    expect(out1).toContain('from');
    expect(out1).toContain('cid:c7');
    expect(summaryOf(rootOf(out1).note)).toEqual({ from: 'cid:c7', to: 'cid:c9' });
  });
});

describe('S1 · summary_of 坏形态：读侧不认但不丢', () => {
  it('summary_of 是裸标量 → summaryOf 返回 undefined，原值保留且重新序列化仍在', () => {
    const doc = DOC_BLOCK.replace('summary_of:\n  from: cid:c7\n  to: cid:c9', 'summary_of: 手写坏了');
    const root = rootOf(doc);
    expect(summaryOf(root.note)).toBeUndefined();
    expect(root.note?.summary_of).toBe('手写坏了');
    expect(serializeMm(root)).toContain('summary_of:');
  });

  it('块形态缺 to → undefined；原值 {from} 仍在地盘上（不被删除）', () => {
    const doc = DOC_BLOCK.replace('  to: cid:c9', '');
    const root = rootOf(doc);
    expect(summaryOf(root.note)).toBeUndefined();
    expect(root.note?.summary_of).toEqual({ from: 'cid:c7' });
  });

  it('from 为空串 → undefined（严格收窄：两字段皆须非空字符串）', () => {
    const doc = DOC_BLOCK.replace('  from: cid:c7', '  from: ""');
    const root = rootOf(doc);
    expect(summaryOf(root.note)).toBeUndefined();
    expect(serializeMm(root)).toContain('summary_of:');
  });

  it('from/to 为数字（JSON 形态）→ undefined，原值 JSON 保留', () => {
    const doc = DOC_JSON.replace('"from":"cid:c7"', '"from":7');
    const root = rootOf(doc);
    expect(summaryOf(root.note)).toBeUndefined();
    expect(root.note?.summary_of).toEqual({ from: 7, to: 'cid:c9' });
  });

  it('未知字段透传：summary_of 内的额外键原样保留（前向兼容）', () => {
    const doc = DOC_BLOCK.replace('  to: cid:c9', '  to: cid:c9\n  label: 第2章');
    const root = rootOf(doc);
    expect(root.note?.summary_of).toMatchObject({ from: 'cid:c7', to: 'cid:c9', label: '第2章' });
    const out = serializeMm(root);
    expect(out).toContain('第2章'); // 未知字段不因一次往返丢失
    expect(summaryOf(rootOf(out).note)).toEqual({ from: 'cid:c7', to: 'cid:c9' });
  });

  it('无 note / note 无 summary_of → undefined（零开销短路）', () => {
    expect(summaryOf(rootOf('# 孤根\n').note)).toBeUndefined();
    expect(summaryOf(undefined)).toBeUndefined();
    expect(summaryOf(null)).toBeUndefined();
  });
});

describe('S1 · summary_of 写入路径（不可变）', () => {
  it('upsertSummaryOf：不可变写入 + 写入产物可 round-trip 读回（写读闭环）', () => {
    const note: Note = { status: 'draft' };
    const next = upsertSummaryOf(note, { from: 'cid:ca', to: 'cid:cc' });
    // 不可变：原 note 未被改动
    expect(note.summary_of).toBeUndefined();
    expect(next.summary_of).toEqual({ from: 'cid:ca', to: 'cid:cc' });
    // 其它键不受影响
    expect(next.status).toBe('draft');

    const out = serializeMm({ ...rootOf('# 根\n'), note: next });
    expect(summaryOf(rootOf(out).note)).toEqual({ from: 'cid:ca', to: 'cid:cc' });
  });

  it('upsertSummaryOf：覆盖既有锚（不追加第二个键）', () => {
    const note: Note = { summary_of: { from: 'cid:1', to: 'cid:2' } };
    const next = upsertSummaryOf(note, { from: 'cid:3', to: 'cid:4' });
    expect(next.summary_of).toEqual({ from: 'cid:3', to: 'cid:4' });
    expect(Object.keys(next).filter((k) => k === 'summary_of')).toHaveLength(1);
  });

  it('removeSummaryOf：删键；未命中返回原引用（供调用方零成本判等）', () => {
    const note: Note = { summary_of: { from: 'cid:1', to: 'cid:2' }, status: 'ok' };
    const next = removeSummaryOf(note);
    expect(next.summary_of).toBeUndefined();
    expect(next.status).toBe('ok');
    expect(removeSummaryOf(next)).toBe(next);
  });
});
