/**
 * edgeHealthOf：边健康度纯函数（R0 观测先行）。
 *
 * 立足点（派遣计划 §1.2）：collectFreeEdges 对畸形项静默丢弃、对坏边只给三态——
 * 「边坏了但不可见」。edgeHealthOf 独立扫描原始数组 + 复用 collectFreeEdges 的
 * 三态产物，产出可计数（EdgeHealth）与可定位（problems 明细）的病例清单。
 *
 * 覆盖 8 类病例：正常 / dangling / stale / invalid / malformed（非对象、from 非
 * string）/ selfAnchor / duplicate / unknownRel。
 */
import { describe, expect, it } from 'vitest';
import { makeEntityNode, makeTextNode, type EditableNode } from '@mindcanvas/kernel';
import { edgeHealthOf, healthBreakdown } from '../src/render/edgeHealth.js';

/** 组合夹具：9 条原始边覆盖 8 类病例（下标 0 是唯一健康边） */
function fixture(): EditableNode {
  const root = makeTextNode('根', [
    makeTextNode('A'),
    makeTextNode('B'),
    makeTextNode('分支', [
      makeEntityNode({ kind: 'issue', id: '8' }),
      makeEntityNode({ kind: 'issue', id: '8' }),
    ]),
  ]);
  root.note = {
    edges: [
      { from: 'node:根/A', to: 'node:根/B', rel: 'relates-to' }, // 0 正常
      { from: 'node:根/A', to: 'node:根/不存在', rel: 'relates-to' }, // 1 dangling
      { from: 'node:根/A', to: '@issue:8', rel: 'relates-to' }, // 2 stale（同名实体歧义）
      {
        from: 'node:根/A',
        to: 'node:根/B',
        rel: 'blocks',
        invalidAt: '2026-01-01T00:00:00.000Z',
      }, // 3 invalid
      'oops', // 4 malformed：非对象
      { from: 42, to: 'node:根/A', rel: 'x' }, // 5 malformed：from 非 string
      { from: 'node:根/A', to: 'node:根/A', rel: 'relates-to' }, // 6 selfAnchor
      { from: 'node:根/A', to: 'node:根/B', rel: 'relates-to' }, // 7 duplicate of 0
      { from: 'node:根/A', to: 'node:根/B', rel: 'no-such-rel-xyz' }, // 8 unknownRel
    ],
  };
  return root;
}

describe('edgeHealthOf：计数', () => {
  it('8 类病例组合：total/renderable/byState/各病理计数逐字段正确', () => {
    const h = edgeHealthOf(fixture());
    expect(h.total).toBe(9);
    // 数据层 renderable：源端可解析且非自关联 → 0,1,2,3,7,8 共 6 条
    // （1/2 靶端 dangling/stale → 画布幽灵锚仍绘制；6 自关联 → 画布不画）
    expect(h.renderable).toBe(6);
    expect(h.byState).toEqual({ wellFormed: 5, dangling: 1, stale: 1 });
    expect(h.invalid).toBe(1);
    expect(h.malformed).toBe(2);
    expect(h.selfAnchor).toBe(1);
    expect(h.noBox).toBe(2);
    expect(h.unknownRel).toBe(1);
    expect(h.duplicates).toBe(1);
  });

  it('全健康：problems 为空、病理计数全 0', () => {
    const root = makeTextNode('根', [makeTextNode('A'), makeTextNode('B')]);
    root.note = { edges: [{ from: 'node:根/A', to: 'node:根/B', rel: 'relates-to' }] };
    const h = edgeHealthOf(root);
    expect(h.total).toBe(1);
    expect(h.renderable).toBe(1);
    expect(h.byState).toEqual({ wellFormed: 1, dangling: 0, stale: 0 });
    expect(h.invalid).toBe(0);
    expect(h.malformed).toBe(0);
    expect(h.selfAnchor).toBe(0);
    expect(h.noBox).toBe(0);
    expect(h.unknownRel).toBe(0);
    expect(h.duplicates).toBe(0);
    expect(h.problems).toEqual([]);
  });

  it('无边数据：note 缺失 / edges 非数组 / 空数组 → 零值健康', () => {
    const bare = makeTextNode('根');
    expect(edgeHealthOf(bare)).toMatchObject({ total: 0, renderable: 0, problems: [] });
    const notArray = makeTextNode('根');
    notArray.note = { edges: 'nope' };
    expect(edgeHealthOf(notArray)).toMatchObject({ total: 0, renderable: 0, problems: [] });
    const empty = makeTextNode('根');
    empty.note = { edges: [] };
    expect(edgeHealthOf(empty)).toMatchObject({ total: 0, renderable: 0, problems: [] });
  });

  it('rel 缺省 → 按 collectFreeEdges 同款空串口径 → unknownRel', () => {
    const root = makeTextNode('根', [makeTextNode('A'), makeTextNode('B')]);
    root.note = { edges: [{ from: 'node:根/A', to: 'node:根/B' }] };
    const h = edgeHealthOf(root);
    expect(h.total).toBe(1);
    expect(h.unknownRel).toBe(1);
    expect(h.problems[0]).toMatchObject({ index: 0, state: 'well-formed', unknownRel: true });
  });

  it('三连同文边：后两条 duplicateOf 都指向首个下标（findDuplicateEdge 口径）', () => {
    const root = makeTextNode('根', [makeTextNode('A'), makeTextNode('B')]);
    const d = { from: 'node:根/A', to: 'node:根/B', rel: 'relates-to' };
    root.note = { edges: [d, { ...d }, { ...d }] };
    const h = edgeHealthOf(root);
    expect(h.duplicates).toBe(2);
    const dups = h.problems.filter((p) => p.duplicateOf !== undefined);
    expect(dups).toHaveLength(2);
    expect(dups[0]).toMatchObject({ index: 1, duplicateOf: 0 });
    expect(dups[1]).toMatchObject({ index: 2, duplicateOf: 0 });
  });
});

describe('edgeHealthOf：problems 明细（可定位）', () => {
  it('健康边不进 problems；每个病例项带 index + 原始锚文本 + 逐项标记', () => {
    const h = edgeHealthOf(fixture());
    // 下标 0 是唯一健康边 → 不进列表；其余 8 条全部进列表
    expect(h.problems.map((p) => p.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    const byIndex = new Map(h.problems.map((p) => [p.index, p]));
    // dangling：路径失效
    expect(byIndex.get(1)).toMatchObject({
      index: 1,
      from: 'node:根/A',
      to: 'node:根/不存在',
      state: 'dangling',
      invalid: false,
      noBox: true,
    });
    // stale：同名实体歧义
    expect(byIndex.get(2)).toMatchObject({
      index: 2,
      to: '@issue:8',
      state: 'stale',
      noBox: true,
    });
    // invalid：invalidAt 存在（软失效，非锚问题）
    expect(byIndex.get(3)).toMatchObject({
      index: 3,
      state: 'well-formed',
      invalid: true,
    });
    // malformed：非对象 → 锚文本缺失（''）
    expect(byIndex.get(4)).toMatchObject({
      index: 4,
      from: '',
      to: '',
      state: 'stale',
      invalid: false,
      malformed: true,
    });
    // malformed：from 非 string
    expect(byIndex.get(5)).toMatchObject({ index: 5, from: '', malformed: true });
    // selfAnchor：from === to
    expect(byIndex.get(6)).toMatchObject({
      index: 6,
      from: 'node:根/A',
      to: 'node:根/A',
      state: 'well-formed',
      selfAnchor: true,
    });
    // duplicate：指向首个同 from+to+rel 下标
    expect(byIndex.get(7)).toMatchObject({
      index: 7,
      state: 'well-formed',
      duplicateOf: 0,
    });
    // unknownRel：rel 不在 schema
    expect(byIndex.get(8)).toMatchObject({
      index: 8,
      state: 'well-formed',
      unknownRel: true,
    });
  });

  it('malformed 项不计入 byState（byState 只统计 collectFreeEdges 实际处理的项）', () => {
    const h = edgeHealthOf(fixture());
    const sum = h.byState.wellFormed + h.byState.dangling + h.byState.stale;
    expect(sum).toBe(h.total - h.malformed);
    expect(sum + h.malformed).toBe(h.total);
  });
});

describe('healthBreakdown（R6-S1a：互斥主分类——总数 = 各项之和）', () => {
  /** 7 类病理计数 + healthy 的和（验收判据左式） */
  function problemsSum(b: ReturnType<typeof healthBreakdown>): number {
    return (
      b.malformed + b.invalid + b.dangling + b.stale + b.selfAnchor + b.duplicate + b.unknownRel
    );
  }

  it('组合夹具（8 类病例）：每项恰归一档；7 分类之和 === problems.length，+healthy === total', () => {
    const h = edgeHealthOf(fixture());
    const b = healthBreakdown(h);
    expect(b).toEqual({
      malformed: 2, // 非对象 + from 非 string
      invalid: 1,
      dangling: 1,
      stale: 1,
      selfAnchor: 1,
      duplicate: 1,
      unknownRel: 1,
      healthy: 1, // 下标 0 是唯一健康边
    });
    expect(problemsSum(b)).toBe(h.problems.length);
    expect(problemsSum(b) + b.healthy).toBe(h.total);
  });

  it('多标记项只归一档：主分类优先级 malformed > invalid > dangling > stale > selfAnchor > duplicate > unknownRel', () => {
    const root = makeTextNode('根', [
      makeTextNode('A'),
      makeTextNode('分支', [
        makeEntityNode({ kind: 'issue', id: '8' }),
        makeEntityNode({ kind: 'issue', id: '8' }),
      ]),
    ]);
    root.note = {
      edges: [
        // 0：dangling + 软失效 → 归 invalid（优先级高于 dangling）
        {
          from: 'node:根/不存在',
          to: 'node:根/A',
          rel: 'relates-to',
          invalidAt: '2026-01-01T00:00:00.000Z',
        },
        // 1：stale（同名实体歧义）+ 未知关系 → 归 stale（优先级高于 unknownRel）
        { from: 'node:根/A', to: '@issue:8', rel: 'no-such-rel' },
        // 2、3：同键自关联 → 均归 selfAnchor（3 的重复标记被 selfAnchor 覆盖）
        { from: 'node:根/A', to: 'node:根/A', rel: 'relates-to' },
        { from: 'node:根/A', to: 'node:根/A', rel: 'relates-to' },
      ],
    };
    const h = edgeHealthOf(root);
    const b = healthBreakdown(h);
    expect(b).toEqual({
      malformed: 0,
      invalid: 1,
      dangling: 0,
      stale: 1,
      selfAnchor: 2,
      duplicate: 0,
      unknownRel: 0,
      healthy: 0,
    });
    expect(problemsSum(b)).toBe(h.problems.length);
  });

  it('全健康 / 无边：分类全零 + healthy 对账', () => {
    const root = makeTextNode('根', [makeTextNode('A'), makeTextNode('B')]);
    root.note = { edges: [{ from: 'node:根/A', to: 'node:根/B', rel: 'relates-to' }] };
    const b = healthBreakdown(edgeHealthOf(root));
    expect(b).toEqual({
      malformed: 0,
      invalid: 0,
      dangling: 0,
      stale: 0,
      selfAnchor: 0,
      duplicate: 0,
      unknownRel: 0,
      healthy: 1,
    });
    expect(healthBreakdown(edgeHealthOf(makeTextNode('根'))).healthy).toBe(0);
  });
});
