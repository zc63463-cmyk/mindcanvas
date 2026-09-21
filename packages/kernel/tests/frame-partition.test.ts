/**
 * FO-A3 · `partitionFrameSubtree`：框子树按 depth 切分大纲层 / 空间挂载层。
 *
 * 规格：`docs/specs/2026-09-15-subtree-frame-outline-design.md` §5.1（布局岛：大纲区 + 挂点 + 空间层）
 * 计划：`docs/superpowers/plans/2026-09-15-subtree-frame-outline.md` Task 3
 *
 * 契约（B1 布局岛的输入）：
 *  - `outlineIds` = 相对框根 `d ∈ [0, depth]` 的节点，**前序（DFS）顺序** = 大纲显示顺序；
 *  - 对每个 `d === depth` 的节点，其**每个**孩子各产生一条 `hangRoots`（`d === depth + 1` 起整棵属空间层）；
 *  - **纯函数、不搬家**：`spatialRoot` 是原树里的同一对象引用（不重建 AST、不改 children）。
 */
import { describe, expect, it } from 'vitest';
import { partitionFrameSubtree } from '../src/layout/framePartition.js';
import { makeTextNode } from '../src/tree/treeOps.js';

describe('partitionFrameSubtree', () => {
  it('计划夹具 depth=1：孩子成挂点，孙仍挂在该挂点下（不进大纲）', () => {
    const g = makeTextNode('g');
    const c = makeTextNode('c', [g]);
    const root = makeTextNode('r', [c]);
    const p = partitionFrameSubtree(root, 1);
    expect([...p.outlineIds].sort()).toEqual([root.id, c.id].sort());
    expect(p.hangRoots).toHaveLength(1);
    const hang = p.hangRoots[0];
    expect(hang?.outlineNodeId).toBe(c.id);
    expect(hang?.spatialRoot.id).toBe(g.id);
  });

  it('计划夹具 depth=2：孙进大纲；孙无孩子 → 无挂点', () => {
    const g = makeTextNode('g');
    const c = makeTextNode('c', [g]);
    const root = makeTextNode('r', [c]);
    const p = partitionFrameSubtree(root, 2);
    expect(p.outlineIds).toContain(g.id);
    expect(p.hangRoots).toHaveLength(0);
  });

  it('分支树 depth=1：前序顺序；同一大纲行多个孩子各一条挂点', () => {
    const a1 = makeTextNode('a1');
    const a2 = makeTextNode('a2');
    const a = makeTextNode('a', [a1, a2]);
    const b = makeTextNode('b');
    const root = makeTextNode('r', [a, b]);
    const p = partitionFrameSubtree(root, 1);
    expect(p.outlineIds).toEqual([root.id, a.id, b.id]); // DFS 前序 = 大纲显示顺序
    expect(p.hangRoots.map((h) => h.outlineNodeId)).toEqual([a.id, a.id]);
    expect(p.hangRoots.map((h) => h.spatialRoot.id)).toEqual([a1.id, a2.id]);
  });

  it('depth=2：d=2 行成挂点行，d=3 起整棵留在空间层（不进 outlineIds）', () => {
    const deep = makeTextNode('deep');
    const a1 = makeTextNode('a1', [deep]);
    const a = makeTextNode('a', [a1]);
    const root = makeTextNode('r', [a]);
    const p = partitionFrameSubtree(root, 2);
    expect(p.outlineIds).toEqual([root.id, a.id, a1.id]);
    expect(p.outlineIds).not.toContain(deep.id);
    const hang = p.hangRoots[0];
    expect(hang?.outlineNodeId).toBe(a1.id);
    expect(hang?.spatialRoot.id).toBe(deep.id);
  });

  it('depth=0（边界）：仅框头进大纲，直接孩子全部挂出', () => {
    const c1 = makeTextNode('c1');
    const c2 = makeTextNode('c2');
    const root = makeTextNode('r', [c1, c2]);
    const p = partitionFrameSubtree(root, 0);
    expect(p.outlineIds).toEqual([root.id]);
    expect(p.hangRoots.map((h) => h.spatialRoot.id)).toEqual([c1.id, c2.id]);
  });

  it('depth 超过实际高度：整棵进大纲，无挂点', () => {
    const c = makeTextNode('c');
    const root = makeTextNode('r', [c]);
    const p = partitionFrameSubtree(root, 9);
    expect([...p.outlineIds].sort()).toEqual([root.id, c.id].sort());
    expect(p.hangRoots).toHaveLength(0);
  });

  it('不搬家：挂点引用原对象（同一引用），原树 children 零改动', () => {
    const g = makeTextNode('g');
    const c = makeTextNode('c', [g]);
    const root = makeTextNode('r', [c]);
    const p = partitionFrameSubtree(root, 1);
    expect(p.hangRoots[0]?.spatialRoot).toBe(g); // 引用相等，非副本
    expect(root.children[0]).toBe(c);
    expect(c.children[0]).toBe(g);
    expect(g.children).toHaveLength(0);
  });
});
