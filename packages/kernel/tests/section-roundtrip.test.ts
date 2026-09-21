/**
 * T1 · sections 协议 round-trip 锁定（v1.5.0 Phase 1）。
 *
 * 断言核心：parser/serializer **零改动** 即可承载 sections（sequence-of-mappings），
 * 且与既有五键（centers/center_pos/edges/links/groups）共存同一 note 互不干扰。
 * 本文件故意不经任何 sections 专用写入路径——若未来 parser/serializer 行为退化
 * （如对象项判定收紧、未知键丢弃），这里会先红。
 */
import { describe, expect, it } from 'vitest';
import { parseMm } from '../src/protocol/parser.js';
import { serializeMm } from '../src/protocol/serializer.js';
import {
  makeSectionId,
  removeSection,
  sectionColorOf,
  sectionsOf,
  upsertSection,
} from '../src/protocol/section.js';
import type { Note } from '../src/protocol/types.js';

const DOC = [
  '<!--',
  'centers:',
  '- at: "根/分支A"',
  '  dir: right',
  '  cid: c1',
  'sections:',
  '- id: sec_9f3a',
  '  title: 摩擦分析',
  '  color: blue',
  '  root: cid:c1',
  '- id: sec_b204',
  '  color: amber',
  '  root: "node:根/分支B"',
  'edges:',
  '- from: "根/分支A"',
  '  to: "根/分支B"',
  '-->',
  '# 根',
  '',
  '## 分支A',
  '',
  '### 甲',
  '',
  '## 分支B',
  '',
].join('\n');

function roundTripTwice(text: string) {
  const p1 = parseMm(text);
  expect(p1.root).not.toBeNull();
  const out1 = serializeMm(p1.root!);
  const p2 = parseMm(out1);
  const out2 = serializeMm(p2.root!);
  return { p1, p2, out1, out2 };
}

describe('T1 · sections 协议 round-trip', () => {
  it('含 sections 的 note：parse → serialize → parse 幂等（二次序列化字节一致）', () => {
    const { p1, p2, out1, out2 } = roundTripTwice(DOC);
    expect(out2).toBe(out1);
    // 结构等价（键序无关由稳定比较保证——此处直接 toEqual 因 canonical 重排后键序一致）
    expect(p2.root).toEqual(p1.root);
    // 诊断零噪声（sections 是合法形态，不得产生 E-INVALID-NOTE-YAML）
    expect(p1.diagnostics).toEqual([]);
  });

  it('sectionsOf：两个条目完整读取（id/title/color/root），与 centers/edges 共存不串扰', () => {
    const p = parseMm(DOC);
    const secs = sectionsOf(p.root!.note);
    expect(secs).toHaveLength(2);
    expect(secs[0]).toEqual({ id: 'sec_9f3a', title: '摩擦分析', color: 'blue', root: 'cid:c1' });
    expect(secs[1]).toEqual({ id: 'sec_b204', color: 'amber', root: 'node:根/分支B' });
    // 既有键原样在位
    expect(Array.isArray(p.root!.note?.centers)).toBe(true);
    expect(Array.isArray(p.root!.note?.edges)).toBe(true);
  });

  it('缺省字段省略：无 title/color 的条目序列化不产出空字段', () => {
    const p = parseMm(DOC);
    const out = serializeMm(p.root!);
    // sec_b204 无 title → 序列化产物中不得出现 "title:" 挂在该条目下
    const secB204Block = out.slice(out.indexOf('sec_b204'));
    expect(secB204Block).not.toMatch(/title:/);
  });

  it('未知 color token：解析透传不丢，渲染侧回退 slate', () => {
    const doc = DOC.replace('color: blue', 'color: neon-future');
    const { p1, out1 } = roundTripTwice(doc);
    const secs = sectionsOf(p1.root!.note);
    // 原值透传（前向兼容：未来新 token 的存量文件不丢数据）
    expect(secs[0]!.color).toBe('neon-future');
    expect(out1).toContain('neon-future');
    // 渲染侧归一化
    expect(sectionColorOf(secs[0]!)).toBe('slate');
    expect(sectionColorOf(secs[1]!)).toBe('amber');
  });

  it('容错：缺 id/root 的畸形条目跳过读取但原值保留（重新序列化不丢）', () => {
    const doc = DOC.replace(
      '- id: sec_b204',
      '- title: 无身份条目\n- id: sec_b204',
    );
    const p = parseMm(doc);
    const secs = sectionsOf(p.root!.note);
    expect(secs.map((s) => s.id)).toEqual(['sec_9f3a', 'sec_b204']);
    // 原值保留：note.sections 仍是 3 项
    const rawSections: unknown = p.root!.note?.sections;
    expect(Array.isArray(rawSections) && rawSections.length === 3).toBe(true);
    const out = serializeMm(p.root!);
    expect(out).toContain('无身份条目');
  });

  it('Phase 2 预留字段 members/collapsed：读取保留，未实现语义不产生行为', () => {
    const doc = DOC.replace(
      '  root: cid:c1',
      '  root: cid:c1\n  members: "cid:c2|cid:c3"\n  collapsed: true',
    );
    const p = parseMm(doc);
    const secs = sectionsOf(p.root!.note);
    expect(secs[0]!.members).toBe('cid:c2|cid:c3');
    expect(secs[0]!.collapsed).toBe(true);
    const out = serializeMm(p.root!);
    expect(out).toContain('members:');
    expect(out).toContain('collapsed:');
  });
});

/**
 * T4 · 写入路径（upsertSection / removeSection / makeSectionId）。
 *
 * 与读侧同一纪律：写入也**不改动传入值**（不可变），且不因一次写入丢弃畸形原值。
 * 关键约束是「写入 → 序列化 → 解析」后仍能被 sectionsOf 读回（写读闭环）。
 */
describe('T4 · Section 写入路径', () => {
  it('upsertSection：新条目追加，写入产物可 round-trip 读回', () => {
    const note: Note = {};
    const next = upsertSection(note, {
      id: 'sec_new',
      root: 'cid:c9',
      color: 'violet',
      title: '新分区',
    });
    // 不可变：原 note 未被改动
    expect(note.sections).toBeUndefined();
    expect(next.sections).toHaveLength(1);
    expect(sectionsOf(next)).toEqual([
      { id: 'sec_new', title: '新分区', color: 'violet', root: 'cid:c9' },
    ]);
  });

  it('upsertSection：按 id 匹配就地更新（不追加重复条目）', () => {
    const note: Note = {
      sections: [{ id: 'sec_x', root: 'cid:c1' }],
    };
    const next = upsertSection(note, { id: 'sec_x', root: 'cid:c2', color: 'rose' });
    const secs = sectionsOf(next);
    expect(secs).toHaveLength(1);
    expect(secs[0]!.root).toBe('cid:c2');
    expect(secs[0]!.color).toBe('rose');
  });

  it('upsertSection：缺省字段不落键（协议面最小）', () => {
    const next = upsertSection({}, { id: 'sec_min', root: 'cid:c1' });
    const raw: unknown = next.sections?.[0];
    expect(raw).toEqual({ id: 'sec_min', root: 'cid:c1' });
  });

  it('upsertSection：写入不丢弃畸形原值（透传纪律）', () => {
    const note = {
      sections: [
        { title: '无身份条目' },
        { id: 'sec_ok', root: 'cid:c1' },
      ],
    } as unknown as Note;
    const next = upsertSection(note, { id: 'sec_added', root: 'cid:c2' });
    const raw: unknown = next.sections;
    // 畸形项仍在地盘上（读侧跳过 ≠ 写侧删除）
    expect(Array.isArray(raw) && raw.length === 3).toBe(true);
  });

  it('removeSection：按 id 删除；清空后连键一起删（不留 sections: []）', () => {
    const note: Note = {
      sections: [
        { id: 'sec_a', root: 'cid:c1' },
        { id: 'sec_b', root: 'cid:c2' },
      ],
    };
    const one = removeSection(note, 'sec_a');
    expect(sectionsOf(one).map((s) => s.id)).toEqual(['sec_b']);
    const none = removeSection(one, 'sec_b');
    expect(none.sections).toBeUndefined();
    // 未命中：原样返回（引用不变，供调用方零成本判等）
    expect(removeSection(note, 'sec_missing')).toBe(note);
  });

  it('写入 → 序列化 → 解析：sections 完整往返（写读闭环）', () => {
    const p = parseMm(DOC);
    const nextNote = upsertSection(p.root!.note, {
      id: 'sec_t4',
      root: 'cid:c7',
      color: 'green',
      title: '拖拽验证',
    });
    const out = serializeMm({ ...p.root!, note: nextNote });
    const back = parseMm(out);
    const secs = sectionsOf(back.root!.note);
    expect(secs).toHaveLength(3);
    expect(secs.find((s) => s.id === 'sec_t4')).toEqual({
      id: 'sec_t4',
      title: '拖拽验证',
      color: 'green',
      root: 'cid:c7',
    });
    // 既有条目不受影响
    expect(secs.map((s) => s.id)).toContain('sec_9f3a');
  });

  it('makeSectionId：稳定前缀 + 多次调用不碰撞', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 200; i++) ids.add(makeSectionId());
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id.startsWith('sec_')).toBe(true);
  });
});
