import { describe, expect, it } from 'vitest';
import { parseMm } from '../src/protocol/parser.js';
import { serializeMm } from '../src/protocol/serializer.js';

/**
 * 透传铁律（K1 固化）：未知值永不丢失。
 * 三个场景全部围绕「未知值 round-trip 原样保留、不报错丢弃」—— 扩展缝矩阵的底座原则
 * （spec §4.5「数据永不丢失，渲染尽力而为」），与 W-UNKNOWN-KIND / 未知 note 键透传行为对齐。
 */

describe('透传铁律：未知值永不丢失', () => {
  it('未知 kind：@futurekind:xyz 解析保留实体节点 + W-UNKNOWN-KIND，round-trip 原样保留', () => {
    const text = '# 根\n- @futurekind:xyz';
    const p1 = parseMm(text);
    expect(p1.diagnostics.map((d) => d.code)).toEqual(['W-UNKNOWN-KIND']);
    expect(p1.root?.children?.[0]).toEqual({
      type: 'entity',
      ref: { kind: 'futurekind', id: 'xyz' },
      children: [],
    });
    const p2 = parseMm(serializeMm(p1.root!));
    expect(p2.root).toEqual(p1.root);
    expect(p2.diagnostics.map((d) => d.code)).toEqual(['W-UNKNOWN-KIND']);
  });

  it('未知 note 键：ai_role / rel 列表 / 任意自定义键 round-trip 不丢不改', () => {
    const text = [
      '# 根',
      '<!--',
      'ai_role: task',
      'rel:',
      '  - @idea:forge-inbox:5',
      '自定义键: 透传值',
      '-->',
      '## 分支',
    ].join('\n');
    const p1 = parseMm(text);
    expect(p1.diagnostics).toEqual([]);
    const note = p1.root?.children?.[0]?.note;
    expect(note?.ai_role).toBe('task');
    expect(Array.isArray(note?.rel)).toBe(true);
    expect(note?.rel).toEqual(['@idea:forge-inbox:5']);
    expect(note?.['自定义键']).toBe('透传值');
    const p2 = parseMm(serializeMm(p1.root!));
    expect(p2.root).toEqual(p1.root);
    expect(p2.diagnostics).toEqual([]);
  });

  it('混合场景：未知 kind + 未知 note 键 + 已知 kind 共存 → 全量保留', () => {
    const text = [
      '# Agent Gateway',
      '<!--',
      'ai_role: task',
      '-->',
      '## 落地任务',
      '- @issue:48',
      '- @futurekind:xyz',
      '<!--',
      '自定义键: 保留',
      '-->',
      '- 文本节点',
    ].join('\n');
    const p1 = parseMm(text);
    // 仅未知 kind 产生诊断；已知 kind 与未知键零诊断
    expect(p1.diagnostics.map((d) => d.code)).toEqual(['W-UNKNOWN-KIND']);
    // 已知 kind 保留为实体节点
    expect(p1.root?.children?.[0]?.children?.[0]).toEqual({
      type: 'entity',
      ref: { kind: 'issue', id: '48' },
      children: [],
    });
    // 未知 kind 保留为实体节点
    expect(p1.root?.children?.[0]?.children?.[1]).toEqual({
      type: 'entity',
      ref: { kind: 'futurekind', id: 'xyz' },
      children: [],
    });
    // 未知 note 键保留（分支级 + 列表项级）
    expect(p1.root?.children?.[0]?.note?.ai_role).toBe('task');
    expect(p1.root?.children?.[0]?.children?.[2]?.note?.['自定义键']).toBe('保留');
    // round-trip 全量保留
    const p2 = parseMm(serializeMm(p1.root!));
    expect(p2.root).toEqual(p1.root);
    expect(p2.diagnostics.map((d) => d.code)).toEqual(['W-UNKNOWN-KIND']);
  });

  it('edges 数组内嵌 attrs：parse → serialize → parse 原样保留、二次序列化字节稳定（R6-S2c-4）', () => {
    // E1 已覆盖 note.links 面（link-edge-schema.test.ts：dir/label/note/attrs 透传）；
    // 本钉补 **edges 面**一例——attrs 是内联 JSON 标量（serializer.ts:50），嵌套对象值
    // 经 canonical 序列化后必须逐值相等（R6 边 attrs 链路透传的协议侧底座）。
    // 块位置与 section-roundtrip 同款（文件顶部 → 绑定根节点 note）。
    const text = [
      '<!--',
      'edges:',
      '- from: node:根/A',
      '  to: node:根/B',
      '  rel: blocks',
      '  attrs: {"severity": "high", "w": 3}',
      '- from: node:根/A',
      '  to: node:根/C',
      '  rel: relates-to',
      '-->',
      '# 根',
      '## A',
      '## B',
      '## C',
    ].join('\n');
    const p1 = parseMm(text);
    expect(p1.diagnostics).toEqual([]);
    expect(p1.root?.note?.edges).toEqual([
      { from: 'node:根/A', to: 'node:根/B', rel: 'blocks', attrs: { severity: 'high', w: 3 } },
      { from: 'node:根/A', to: 'node:根/C', rel: 'relates-to' },
    ]);
    // parse → serialize → parse：结构逐值相等 + 二次序列化字节稳定（幂等）
    const root1 = p1.root;
    if (root1 === null) throw new Error('parse 失败');
    const out1 = serializeMm(root1);
    const p2 = parseMm(out1);
    expect(p2.root).toEqual(root1);
    const root2 = p2.root;
    if (root2 === null) throw new Error('二次 parse 失败');
    expect(serializeMm(root2)).toBe(out1);
  });
});
