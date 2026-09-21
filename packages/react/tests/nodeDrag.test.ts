import { describe, expect, it } from 'vitest';
import { astToEditable, layoutMindmap, makeTextNode } from '@mindcanvas/kernel';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';
import { dragExcludedIds, dropModeFor, isDescendantOf, planDrop } from '../src/render/nodeDrag.js';

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

/** 根 → A(叶a1, 叶a2) / B(叶b) */
function layout() {
  const root = astToEditable(
    makeTextNode('根', [
      makeTextNode('A', [makeTextNode('叶a1'), makeTextNode('叶a2')]),
      makeTextNode('B', [makeTextNode('叶b')]),
    ]),
  )!;
  return layoutMindmap(root, createNodeMeasure(char, new Map()), new Set());
}

function nodeIdOf(l: ReturnType<typeof layout>, text: string): string {
  return l.nodes.find((n) => n.node.text === text)!.node.id;
}

describe('节点拖拽规划器（M5-T5：move-node op 生成 + 环拒绝）', () => {
  it('dropModeFor：顶 25% before / 底 25% after / 中段 child', () => {
    const box = { x: 0, y: 0, w: 100, h: 100 };
    expect(dropModeFor(box, { x: 50, y: 10 })).toBe('before');
    expect(dropModeFor(box, { x: 50, y: 90 })).toBe('after');
    expect(dropModeFor(box, { x: 50, y: 50 })).toBe('child');
  });

  it('child 模式：目标为父，index = 目标现有子数（追加）', () => {
    const l = layout();
    const a = nodeIdOf(l, 'A');
    const b = nodeIdOf(l, 'B');
    const plan = planDrop(l, b, a, 'child');
    expect(plan.valid).toBe(true);
    expect(plan.op).toEqual({ type: 'move-node', id: b, targetParentId: a, index: 2 });
  });

  it('before/after 模式：目标父为落点父，index 取目标位（before）/ +1（after）', () => {
    const l = layout();
    const rootId = nodeIdOf(l, '根');
    const a = nodeIdOf(l, 'A');
    const b = nodeIdOf(l, 'B');
    // B before A → 落 root，index = A 的位置(0)
    const before = planDrop(l, b, a, 'before');
    expect(before.valid).toBe(true);
    expect(before.op).toEqual({ type: 'move-node', id: b, targetParentId: rootId, index: 0 });
    // A after B → 落 root，index = B 的位置(1)+1
    const after = planDrop(l, a, b, 'after');
    expect(after.valid).toBe(true);
    expect(after.op).toEqual({ type: 'move-node', id: a, targetParentId: rootId, index: 2 });
  });

  it('自拖 → 非法（无 op）', () => {
    const l = layout();
    const a = nodeIdOf(l, 'A');
    const plan = planDrop(l, a, a, 'child');
    expect(plan.valid).toBe(false);
    expect(plan.op).toBeNull();
  });

  it('落到自身子树（产生环）→ 非法', () => {
    const l = layout();
    const a = nodeIdOf(l, 'A');
    const leafA1 = nodeIdOf(l, '叶a1');
    const plan = planDrop(l, a, leafA1, 'child');
    expect(plan.valid).toBe(false);
    expect(plan.op).toBeNull();
    // 深层子孙同样拒绝
    const leafA2 = nodeIdOf(l, '叶a2');
    expect(planDrop(l, a, leafA2, 'before').valid).toBe(false);
  });

  it('根节点：不能作为 before/after 目标（无兄弟位），可作 child 目标', () => {
    const l = layout();
    const rootId = nodeIdOf(l, '根');
    const a = nodeIdOf(l, 'A');
    expect(planDrop(l, a, rootId, 'before').valid).toBe(false);
    expect(planDrop(l, a, rootId, 'after').valid).toBe(false);
    const plan = planDrop(l, a, rootId, 'child');
    expect(plan.valid).toBe(true);
    expect(plan.op).toEqual({ type: 'move-node', id: a, targetParentId: rootId, index: 2 });
  });

  it('isDescendantOf / dragExcludedIds：子树判定正确', () => {
    const l = layout();
    const a = nodeIdOf(l, 'A');
    const leafA1 = nodeIdOf(l, '叶a1');
    const b = nodeIdOf(l, 'B');
    expect(isDescendantOf(l, a, leafA1)).toBe(true);
    expect(isDescendantOf(l, a, b)).toBe(false);
    const excluded = dragExcludedIds(l, a);
    expect(excluded.has(a)).toBe(true);
    expect(excluded.has(leafA1)).toBe(true);
    expect(excluded.has(nodeIdOf(l, '叶a2'))).toBe(true);
    expect(excluded.has(b)).toBe(false);
  });
});
