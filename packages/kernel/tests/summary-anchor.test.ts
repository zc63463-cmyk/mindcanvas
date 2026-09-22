/**
 * S1 · summary_of 锚解析三态 + W_SUMMARY_DANGLING 诊断。
 *
 * 语义（设计稿 §4.2）：摘要是「同一父节点下的一段连续兄弟」，因此 well-formed 需要
 * 四条同时成立：① 两端锚可解析；② 两端都命中；③ 两端与摘要节点**同父**；
 * ④ 顺序合法（from.index ≤ to.index）且**摘要节点自身不在范围内**（不许自己括自己）。
 *
 *  - 锚不可解析（手写坏值）        → state: stale
 *  - 端点被删 / 移出同父 / 倒序 / S 在范围内 → state: dangling
 *  - 全部成立                      → state: well-formed（并给出连续区间 memberIds）
 *
 * 中间成员被增删**不**触发 dangling：范围按位置自然伸缩（XMind 同款语义，
 * 与 from/to 端点失效是两件事）。
 *
 * dangling/stale 一律只产出诊断、**绝不静默删除元数据**（与 W-SECTION-DANGLING 同哲学）。
 */
import { describe, expect, it } from 'vitest';
import {
  W_SUMMARY_DANGLING,
  collectSummaryDiagnostics,
  resolveSummaries,
} from '../src/registry/summary-anchor.js';
import type { Note } from '../src/protocol/types.js';
import type { EditableNode } from '../src/tree/treeOps.js';

function text(id: string, t: string, children: EditableNode[] = [], note?: EditableNode['note']): EditableNode {
  return { id, type: 'text', text: t, ...(note ? { note } : {}), children };
}

/**
 * 把「手写 / 外部文件」的任意 `summary_of` 原值塞进 note。
 *
 * 走 Note 的索引签名（键用非字面量 string）以避开静态收窄——这正是解析层真正面对的
 * 输入形态，而本组用例要断言的是「读侧如何容错」，不是「类型允许写什么」。
 * 零断言、零 any（asCast 债务预算只减不增）。
 */
function withRawSummary(raw: unknown): Note {
  const note: Note = {};
  const key: string = 'summary_of';
  note[key] = raw;
  return note;
}

/**
 * 固定树：总览 → [成员A(ca), 成员B(cb)[成员B子(cx)], 成员C(cc), 摘要1(cs1), 成员D(cd)]
 * 摘要1 的锚 = ca … cc（合法连续区间，且不含自身）。
 */
function makeTree(): EditableNode {
  return text('root', '总览', [
    text('m1', '成员A', [], { cid: 'ca' }),
    text('m2', '成员B', [text('m2c', '成员B子', [], { cid: 'cx' })], { cid: 'cb' }),
    text('m3', '成员C', [], { cid: 'cc' }),
    text('s1', '摘要1', [], { cid: 'cs1', summary_of: { from: 'cid:ca', to: 'cid:cc' } }),
    text('m4', '成员D', [], { cid: 'cd' }),
  ]);
}

/** 改摘要1 的锚（返回新树，不改原树） */
function withAnchor(root: EditableNode, from: string, to: string): EditableNode {
  const children = root.children.map((c) =>
    c.id === 's1' ? { ...c, note: { ...c.note, summary_of: { from, to } } } : c,
  );
  return { ...root, children };
}

/** 取数组第 i 项：显式检查替代非空断言（失败信息比静默 undefined 更可读） */
function at<T>(list: readonly T[], i: number, what = `list[${i}]`): T {
  const v = list[i];
  if (v === undefined) throw new Error(`fixture broken: ${what} 缺失`);
  return v;
}

/** 取子节点（按 id） */
function childById(node: EditableNode, id: string): EditableNode {
  const found = node.children.find((c) => c.id === id);
  if (!found) throw new Error(`fixture broken: 子节点 ${id} 缺失`);
  return found;
}

/** 取唯一一条解析结果的便捷读法 */
function only(root: EditableNode) {
  const rs = resolveSummaries(root);
  expect(rs).toHaveLength(1);
  return at(rs, 0, 'resolveSummaries 结果');
}

describe('S1 · resolveSummaries 三态', () => {
  it('合法：同父 + 顺序 + S 不在范围内 → well-formed，memberIds 为连续区间（含两端）', () => {
    expect(only(makeTree())).toEqual({
      summaryNodeId: 's1',
      state: 'well-formed',
      memberIds: ['m1', 'm2', 'm3'],
      parentId: 'root',
      label: '摘要1',
    });
  });

  it('单成员（from == to）合法：memberIds 长度 1', () => {
    expect(only(withAnchor(makeTree(), 'cid:cb', 'cid:cb'))).toMatchObject({
      state: 'well-formed',
      memberIds: ['m2'],
    });
  });

  it('S 位于范围之后：区间可跨到 4 个成员', () => {
    const root = text('root', '总览', [
      text('m1', '成员A', [], { cid: 'ca' }),
      text('m2', '成员B', [], { cid: 'cb' }),
      text('m3', '成员C', [], { cid: 'cc' }),
      text('m4', '成员D', [], { cid: 'cd' }),
      text('s1', '摘要1', [], { cid: 'cs1', summary_of: { from: 'cid:ca', to: 'cid:cd' } }),
    ]);
    expect(only(root)).toMatchObject({ state: 'well-formed', memberIds: ['m1', 'm2', 'm3', 'm4'] });
  });

  it('from 端点被删 → dangling(from-not-found)，memberIds 不产出', () => {
    const r = only(withAnchor(makeTree(), 'cid:ghost', 'cid:cc'));
    expect(r).toMatchObject({ summaryNodeId: 's1', state: 'dangling', reason: 'from-not-found' });
    expect(r.memberIds).toBeUndefined();
  });

  it('to 端点被删 → dangling(to-not-found)', () => {
    expect(only(withAnchor(makeTree(), 'cid:ca', 'cid:ghost'))).toMatchObject({
      state: 'dangling',
      reason: 'to-not-found',
    });
  });

  it('倒序（from.index > to.index）→ dangling(order-inverted)', () => {
    expect(only(withAnchor(makeTree(), 'cid:cc', 'cid:ca'))).toMatchObject({
      state: 'dangling',
      reason: 'order-inverted',
    });
  });

  it('端点移出同父（指向成员B的子节点）→ dangling(from-not-same-parent)', () => {
    expect(only(withAnchor(makeTree(), 'cid:cx', 'cid:cc'))).toMatchObject({
      state: 'dangling',
      reason: 'from-not-same-parent',
    });
  });

  it('摘要节点自身换了父级 → dangling(summary-not-same-parent)', () => {
    const base = makeTree();
    const s1 = childById(base, 's1');
    const m1 = childById(base, 'm1');
    const root: EditableNode = {
      ...base,
      children: base.children
        .filter((c) => c.id !== 's1')
        .map((c) => (c.id === 'm1' ? { ...m1, children: [...m1.children, s1] } : c)),
    };
    expect(only(root)).toMatchObject({
      state: 'dangling',
      reason: 'summary-not-same-parent',
    });
  });

  it('摘要节点落在自己的范围内 → dangling(summary-in-range)：不许自己括自己', () => {
    // from=ca to=cs1（S 自己就是末成员）
    expect(only(withAnchor(makeTree(), 'cid:ca', 'cid:cs1'))).toMatchObject({
      state: 'dangling',
      reason: 'summary-in-range',
    });
    // from=ca to=cd（范围跨过 S）
    expect(only(withAnchor(makeTree(), 'cid:ca', 'cid:cd'))).toMatchObject({
      state: 'dangling',
      reason: 'summary-in-range',
    });
  });

  it('摘要节点自身是文档根 → dangling(summary-is-root)（根没有兄弟）', () => {
    const root = text('root', '总览', [], { cid: 'cr', summary_of: { from: 'cid:cr', to: 'cid:cr' } });
    const tree: EditableNode = { ...root, children: [text('m1', '成员A', [], { cid: 'ca' })] };
    expect(only(tree)).toMatchObject({ state: 'dangling', reason: 'summary-is-root' });
  });

  it('端点指向文档根自身 → dangling(from-not-same-parent)（根无兄弟，不能当成员）', () => {
    const tree = text('root', '总览', [
      text('s1', '摘要1', [], { summary_of: { from: 'cid:cr', to: 'cid:cr' } }),
    ]);
    tree.note = { cid: 'cr' };
    expect(only(tree)).toMatchObject({ state: 'dangling', reason: 'from-not-same-parent' });
  });

  it('终点移出同父（指向成员B的子节点）→ dangling(to-not-same-parent)', () => {
    expect(only(withAnchor(makeTree(), 'cid:ca', 'cid:cx'))).toMatchObject({
      state: 'dangling',
      reason: 'to-not-same-parent',
    });
  });

  it('坏值：不可解析的锚 → stale（from / to 分别标注原因）', () => {
    expect(only(withAnchor(makeTree(), '没有冒号的锚', 'cid:cc'))).toMatchObject({
      state: 'stale',
      reason: 'unparsable-from',
    });
    expect(only(withAnchor(makeTree(), 'cid:ca', 'cid:'))).toMatchObject({
      state: 'stale',
      reason: 'unparsable-to',
    });
  });

  it('中间成员被删除 → 范围自然伸缩，仍 well-formed（不是 dangling）', () => {
    const base = makeTree();
    const root: EditableNode = { ...base, children: base.children.filter((c) => c.id !== 'm2') };
    expect(only(root)).toMatchObject({ state: 'well-formed', memberIds: ['m1', 'm3'] });
  });

  it('中间插入新成员 → 自动纳入范围', () => {
    const base = makeTree();
    const root: EditableNode = {
      ...base,
      children: [
        at(base.children, 0, 'm1'),
        text('m15', '成员A2', [], { cid: 'ce' }),
        ...base.children.slice(1),
      ],
    };
    expect(only(root)).toMatchObject({ state: 'well-formed', memberIds: ['m1', 'm15', 'm2', 'm3'] });
  });

  it('无 summary_of → 空清单（零开销短路）；多摘要按树序返回', () => {
    expect(resolveSummaries(text('r', '孤根'))).toEqual([]);
    const base = makeTree();
    const multi: EditableNode = {
      ...base,
      children: [
        ...base.children,
        text('s2', '摘要2', [], { cid: 'cs2', summary_of: { from: 'cid:cd', to: 'cid:cd' } }),
      ],
    };
    const rs = resolveSummaries(multi);
    expect(rs.map((r) => r.summaryNodeId)).toEqual(['s1', 's2']);
    expect(rs[1]).toMatchObject({ state: 'well-formed', memberIds: ['m4'] });
  });

  it('两条锚指向同一范围互不干扰（各自独立解析）', () => {
    const base = makeTree();
    const multi: EditableNode = {
      ...base,
      children: [
        ...base.children,
        text('s2', '摘要2', [], { cid: 'cs2', summary_of: { from: 'cid:ca', to: 'cid:cb' } }),
      ],
    };
    const rs = resolveSummaries(multi);
    expect(rs.map((r) => r.memberIds)).toEqual([['m1', 'm2', 'm3'], ['m1', 'm2']]);
  });

  it('形态非法的 summary_of（缺字段）不参与解析，也不产出条目', () => {
    const root = text('root', '总览', [
      text('m1', '成员A', [], { cid: 'ca' }),
      text('s1', '摘要1', [], withRawSummary({ from: 'cid:ca' })),
      text('s2', '摘要2', [], withRawSummary('坏值')),
    ]);
    expect(resolveSummaries(root)).toEqual([]);
  });
});

describe('S1 · W_SUMMARY_DANGLING 诊断', () => {
  it('非 well-formed 逐条产出诊断；措辞区分 dangling / stale', () => {
    const tree = makeTree();
    const root: EditableNode = {
      ...tree,
      children: [
        ...tree.children.map((c) =>
          c.id === 's1'
            ? { ...c, note: { ...c.note, summary_of: { from: 'cid:cc', to: 'cid:ca' } } }
            : c,
        ),
        text('s2', '摘要2', [], { cid: 'cs2', summary_of: { from: '坏锚', to: 'cid:ca' } }),
        text('s3', '摘要3', [], { cid: 'cs3', summary_of: { from: 'cid:ghost', to: 'cid:ca' } }),
      ],
    };
    const diags = collectSummaryDiagnostics(resolveSummaries(root));
    expect(diags).toHaveLength(3);
    expect(diags.every((d) => d.code === W_SUMMARY_DANGLING)).toBe(true);
    expect(diags.map((d) => d.summaryNodeId)).toEqual(['s1', 's2', 's3']);
    expect(at(diags, 0, '诊断1').message).toContain('顺序');
    expect(at(diags, 1, '诊断2').message).toContain('非法');
    expect(at(diags, 2, '诊断3').message).toContain('失效');
  });

  it('全部 well-formed → 零诊断', () => {
    expect(collectSummaryDiagnostics(resolveSummaries(makeTree()))).toEqual([]);
  });

  it('诊断包含摘要节点标题（可解释性）与原因', () => {
    const diags = collectSummaryDiagnostics(resolveSummaries(withAnchor(makeTree(), 'cid:ghost', 'cid:cc')));
    expect(diags).toHaveLength(1);
    expect(at(diags, 0, '诊断').message).toContain('摘要1');
    expect(at(diags, 0, '诊断').message).toContain('from-not-found');
  });
});
