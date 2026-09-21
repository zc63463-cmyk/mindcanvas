import { describe, expect, it } from 'vitest';
import { OpHistory, type TreeOp } from '../src/tree/tree-op.js';
import { getNode, type EditableNode } from '../src/tree/treeOps.js';

/** 固定树：root → [a, b → [b1]]（与 tree-op.test.ts 同构） */
function root(): EditableNode {
  return {
    id: 'root',
    type: 'text',
    text: '根',
    children: [
      { id: 'a', type: 'text', text: 'A', children: [] },
      {
        id: 'b',
        type: 'text',
        text: 'B',
        children: [{ id: 'b1', type: 'text', text: 'B1', children: [] }],
      },
    ],
  };
}

describe('T15：无 note 节点 update-node 写 note → undo 恢复「无 note」', () => {
  it('undo 后节点上 note 的可观察行为与初始一致（无 spread 残留属性）', () => {
    const h = new OpHistory(root());
    h.apply({ type: 'update-node', id: 'a', patch: { note: { one_liner: 'x' } } });
    expect(getNode(h.current, 'a')?.note).toBeDefined();
    const after = h.undo();
    expect(after).not.toBeNull();
    const a = getNode(after!, 'a');
    expect(a).not.toBeNull();
    // 可观察行为一：note 值为 undefined（既有行为，修复前后均应通过）
    expect(a!.note).toBeUndefined();
    // 可观察行为二：note 属性不存在（显式字段删除语义；spread 残留 note:undefined 时此断言红）
    expect('note' in a!).toBe(false);
    expect(Object.keys(a!)).not.toContain('note');
    // 与初始结构严格相等（toStrictEqual 区分 undefined 属性残留）
    expect(a!).toStrictEqual(root().children[0]);
  });
});

describe('applyTransaction：事务原子性（design §6）', () => {
  it('T16a：中间 op 非法（目标不存在）→ 整批拒绝，树/history/redo 全不变', () => {
    const h = new OpHistory(root());
    h.apply({ type: 'update-node', id: 'a', patch: { text: 'A2' } });
    h.undo(); // 制造 redo 分支
    expect(h.canRedo()).toBe(true);
    const r = h.applyTransaction([
      { type: 'update-node', id: 'b', patch: { text: 'B2' } },
      { type: 'remove-node', id: 'ghost' },
      { type: 'update-node', id: 'b1', patch: { text: 'X' } },
    ]);
    expect(r).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'target-missing', step: 1 }),
    });
    // 树零副作用（strictEqual：连 spread 残留都不允许）
    expect(h.current).toStrictEqual(root());
    // history 零副作用
    expect(h.canUndo()).toBe(false);
    // redo 分支未被清空
    expect(h.canRedo()).toBe(true);
    const back = h.redo();
    expect(back).not.toBeNull();
    expect(getNode(back!, 'a')?.text).toBe('A2');
  });

  it('T16b：零位移 move → 整批拒绝（no-op-move），树/history/redo 全不变', () => {
    const h = new OpHistory(root());
    h.apply({ type: 'update-node', id: 'a', patch: { text: 'A2' } });
    h.undo();
    const r = h.applyTransaction([
      { type: 'move-node', id: 'b1', targetParentId: 'b', index: 0 },
      { type: 'update-node', id: 'a', patch: { text: 'A3' } },
    ]);
    expect(r).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'no-op-move', step: 0 }),
    });
    expect(h.current).toStrictEqual(root());
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(true);
  });

  it('T16c：根删除 → 整批拒绝（root-protected）', () => {
    const h = new OpHistory(root());
    const r = h.applyTransaction([{ type: 'remove-node', id: 'root' }]);
    expect(r).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'root-protected', step: 0 }),
    });
    expect(h.current).toStrictEqual(root());
    expect(h.canUndo()).toBe(false);
  });

  it('T16d：移动到自身子树 → 整批拒绝（move-rejected）', () => {
    const h = new OpHistory(root());
    const r = h.applyTransaction([
      { type: 'move-node', id: 'b', targetParentId: 'b1', index: 0 },
    ]);
    expect(r).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'move-rejected', step: 0 }),
    });
    expect(h.current).toStrictEqual(root());
  });

  it('成功事务：applied 数正确、一次入史（单次 undo 整批恢复）、清空 redo', () => {
    const h = new OpHistory(root());
    h.apply({ type: 'update-node', id: 'b', patch: { text: 'B2' } });
    h.undo();
    expect(h.canRedo()).toBe(true);
    const r = h.applyTransaction([
      { type: 'update-node', id: 'a', patch: { text: 'A2' } },
      { type: 'update-node', id: 'b', patch: { text: 'B3' } },
    ]);
    expect(r).toEqual({ ok: true, applied: 2 });
    expect(getNode(h.current, 'a')?.text).toBe('A2');
    expect(getNode(h.current, 'b')?.text).toBe('B3');
    expect(h.canUndo()).toBe(true);
    // 成功事务清空 redo 分支
    expect(h.canRedo()).toBe(false);
    // 一次 history 记录：单次 undo 撤销整批（若拆成两条记录，此断言红）
    const back = h.undo();
    expect(back).not.toBeNull();
    expect(back!).toStrictEqual(root());
    // 重做整批
    const fwd = h.redo();
    expect(fwd).not.toBeNull();
    expect(getNode(fwd!, 'a')?.text).toBe('A2');
    expect(getNode(fwd!, 'b')?.text).toBe('B3');
  });

  it('批次 undo 逆序验证：交叉增删移改后单次 undo 完全还原（顺序敏感）', () => {
    const h = new OpHistory(root());
    const ops: TreeOp[] = [
      { type: 'update-node', id: 'a', patch: { text: 'A2' } },
      { type: 'add-child', parentId: 'root', child: { id: 'c', type: 'text', text: 'C', children: [] } },
      { type: 'move-node', id: 'b1', targetParentId: 'a', index: 0 },
      { type: 'remove-node', id: 'b' },
    ];
    const r = h.applyTransaction(ops);
    expect(r).toEqual({ ok: true, applied: 4 });
    // 提交后形态：root → [a(b1, ), c]，b 已删、b1 移入 a
    expect(getNode(h.current, 'a')?.children.map((n) => n.text)).toEqual(['B1']);
    expect(getNode(h.current, 'b')).toBeNull();
    // 单次 undo：若逆序应用错误（如先恢复 b 的 add-child 再移 b1），中间态目标缺失 → 还原失败
    const back = h.undo();
    expect(back).not.toBeNull();
    expect(back!).toStrictEqual(root());
    // redo 重放整批
    const fwd = h.redo();
    expect(fwd).not.toBeNull();
    expect(getNode(fwd!, 'b')).toBeNull();
    expect(getNode(fwd!, 'a')?.children.map((n) => n.text)).toEqual(['B1']);
    expect(getNode(fwd!, 'c')?.text).toBe('C');
  });

  it('空批次：ok + applied 0，不入历史、不清空 redo', () => {
    const h = new OpHistory(root());
    h.apply({ type: 'update-node', id: 'a', patch: { text: 'A2' } });
    h.undo();
    expect(h.canRedo()).toBe(true);
    const r = h.applyTransaction([]);
    expect(r).toEqual({ ok: true, applied: 0 });
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(true);
  });

  it('事务与单 op apply 混用：既有 apply(op) 行为不变', () => {
    const h = new OpHistory(root());
    const t = h.applyTransaction([{ type: 'update-node', id: 'a', patch: { text: 'A2' } }]);
    expect(t).toEqual({ ok: true, applied: 1 });
    const r1 = h.apply({ type: 'update-node', id: 'b', patch: { text: 'B2' } });
    expect(getNode(r1, 'b')?.text).toBe('B2');
    // undo 逆序：先撤单 op，再撤事务
    h.undo();
    expect(getNode(h.current, 'b')?.text).toBe('B');
    expect(getNode(h.current, 'a')?.text).toBe('A2');
    h.undo();
    expect(h.current).toStrictEqual(root());
    // redo 逆序重放：先事务，再单 op
    h.redo();
    h.redo();
    expect(getNode(h.current, 'a')?.text).toBe('A2');
    expect(getNode(h.current, 'b')?.text).toBe('B2');
  });
});
