import { describe, expect, it } from 'vitest';
import { History } from '../src/tree/history.js';
import { applyOp, invertOp, OpHistory, type TreeOp } from '../src/tree/tree-op.js';
import { makeTextNode, type EditableNode } from '../src/tree/treeOps.js';

/** 固定树：root → [a, b → [b1]] */
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

describe('applyOp 纯函数', () => {
  it('add-child：追加子节点', () => {
    const next = applyOp(root(), { type: 'add-child', parentId: 'a', child: makeTextNode('C') });
    expect(next.children[0].children.map((n) => n.text)).toEqual(['C']);
  });

  it('remove-node：删除节点及其子树', () => {
    const next = applyOp(root(), { type: 'remove-node', id: 'b' });
    expect(next.children.map((n) => n.text)).toEqual(['A']);
  });

  it('move-node：移动到新父', () => {
    const next = applyOp(root(), { type: 'move-node', id: 'b1', targetParentId: 'a', index: 0 });
    expect(next.children[0].children.map((n) => n.text)).toEqual(['B1']);
  });

  it('update-node：更新文本', () => {
    const next = applyOp(root(), { type: 'update-node', id: 'a', patch: { text: 'A2' } });
    expect(next.children[0].text).toBe('A2');
  });

  it('非法操作原样返回（不抛异常）', () => {
    expect(applyOp(root(), { type: 'remove-node', id: 'root' })).toEqual(root());
    expect(
      applyOp(root(), { type: 'move-node', id: 'nope', targetParentId: 'a', index: 0 }),
    ).toEqual(root());
  });
});

describe('invertOp 逆操作', () => {
  it('apply 后 apply inverse → 结构还原（四类操作各验证）', () => {
    const ops: TreeOp[] = [
      { type: 'add-child', parentId: 'a', child: makeTextNode('C') },
      { type: 'remove-node', id: 'b' },
      { type: 'move-node', id: 'b1', targetParentId: 'a', index: 0 },
      { type: 'update-node', id: 'a', patch: { text: 'A2' } },
    ];
    for (const op of ops) {
      const r0 = root();
      const r1 = applyOp(r0, op);
      const inverse = invertOp(r0, op);
      expect(inverse, `${op.type} 逆操作应为非 null`).not.toBeNull();
      expect(applyOp(r1, inverse!), `${op.type} 逆操作应还原`).toEqual(r0);
    }
  });

  it('根删除不可逆（返回 null）', () => {
    expect(invertOp(root(), { type: 'remove-node', id: 'root' })).toBeNull();
  });
});

describe('OpHistory：op 序列 + 逆操作 undo/redo', () => {
  it('apply → undo → redo 还原', () => {
    const h = new OpHistory(root());
    const r1 = h.apply({ type: 'update-node', id: 'a', patch: { text: 'A2' } });
    expect(h.canUndo()).toBe(true);
    const r2 = h.undo();
    expect(r2).toEqual(root());
    expect(h.canRedo()).toBe(true);
    const r3 = h.redo();
    expect(r3).toEqual(r1);
  });

  it('redo 分支截断：新 apply 后 redo 失效', () => {
    const h = new OpHistory(root());
    h.apply({ type: 'update-node', id: 'a', patch: { text: 'A2' } });
    h.undo();
    h.apply({ type: 'update-node', id: 'b', patch: { text: 'B2' } });
    expect(h.canRedo()).toBe(false);
  });

  it('op 序列可重放：initial + ops 序列重放 = apply 累计结果（CRDT 留缝）', () => {
    const ops: TreeOp[] = [
      { type: 'add-child', parentId: 'root', child: makeTextNode('C') },
      { type: 'update-node', id: 'a', patch: { text: 'A2' } },
      { type: 'remove-node', id: 'b' },
    ];
    const initial = root();
    const h = new OpHistory(initial);
    let cur = initial;
    for (const op of ops) cur = h.apply(op);
    let replayed = initial;
    for (const op of ops) replayed = applyOp(replayed, op);
    expect(replayed).toEqual(cur);
  });

  it('非法 op 不改变状态且不进入历史', () => {
    const h = new OpHistory(root());
    const r = h.apply({ type: 'remove-node', id: 'root' });
    expect(r).toEqual(root());
    expect(h.canUndo()).toBe(false);
  });
});

describe('History 快照式（移植自参考源，两机制并存验证）', () => {
  it('push/undo/redo/reset 行为', () => {
    const h = new History<number>(0);
    h.push(1);
    h.push(2);
    expect(h.current).toBe(2);
    expect(h.undo()).toBe(1);
    expect(h.redo()).toBe(2);
    h.reset(9);
    expect(h.current).toBe(9);
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
  });
});
describe('update-node 逆操作（M1：type 参与 undo）', () => {
  it('type 补丁的逆操作恢复原 type（实体↔文本互转可撤销）', () => {
    const before = root();
    const id = 'a';
    const op: TreeOp = {
      type: 'update-node',
      id,
      patch: { type: 'entity', ref: { kind: 'issue', id: '1' } },
    };
    const after = applyOp(before, op);
    expect(after.children[0]!.type).toBe('entity');
    // 逆操作（在应用前的树上求逆 → 恢复 text/undefined ref）
    const inv = invertOp(before, op)!;
    const back = applyOp(after, inv);
    expect(back.children[0]!.type).toBe('text');
    expect(back.children[0]!.ref).toBeUndefined();
  });
});
