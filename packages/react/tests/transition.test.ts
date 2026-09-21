import { describe, expect, it } from 'vitest';
import { addChild, astToEditable, layoutMindmap, makeTextNode } from '@mindcanvas/kernel';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';
import { lerpNodeFrame, toNodeFrame, type NodeFrame } from '../src/render/transition.js';

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

/** 2 分支树（id 随机，作为唯一基准） */
function baseTree() {
  return astToEditable(
    makeTextNode('根', [
      makeTextNode('分支 0', [makeTextNode('叶 0')]),
      makeTextNode('分支 1', [makeTextNode('叶 1')]),
    ]),
  )!;
}

/** 同树增一分支（共享 id 演变）→ 可编辑树 */
function grownTree(base: ReturnType<typeof baseTree>) {
  return addChild(base, base.id, makeTextNode('分支 2', [makeTextNode('叶 2')]));
}

/** 同树删一分支（共享 id 收缩）→ 可编辑树 */
function shrunkTree(grown: ReturnType<typeof grownTree>) {
  const removedId = grown.children[2]!.id;
  return { ...grown, children: grown.children.filter((c) => c.id !== removedId) } as typeof grown;
}

function layoutOf(editable: ReturnType<typeof baseTree>) {
  return layoutMindmap(editable, createNodeMeasure(char, new Map()), new Set());
}

function boxOf(frame: NodeFrame, id: string) {
  const b = frame.boxes.get(id);
  if (!b) throw new Error(`missing box: ${id}`);
  return b;
}

describe('节点位置过渡计划器（M5-T2：快照配对插值 + 淡入淡出）', () => {
  it('toNodeFrame：终态帧全部原位、不透明、不缩放、无 ghost', () => {
    const layout = layoutOf(grownTree(baseTree()));
    const frame = toNodeFrame(layout.nodes);
    expect(frame.nodes.length).toBe(layout.nodes.length);
    expect(frame.ghosts).toEqual([]);
    for (const n of layout.nodes) {
      const b = boxOf(frame, n.node.id);
      expect(b).toEqual({ x: n.box.x, y: n.box.y, w: n.box.w, h: n.box.h, opacity: 1, scale: 1 });
    }
  });

  it('幸存节点：x/y 从旧坐标插值到新坐标，w/h 取目标；新增节点淡入', () => {
    const base = baseTree();
    const grown = grownTree(base);
    const from = toNodeFrame(layoutOf(grown).nodes); // 3 分支终态（作为"旧"）
    const to = toNodeFrame(layoutOf(shrunkTree(grown)).nodes); // 2 分支（新）——共享 2 分支的 id
    const mid = lerpNodeFrame(from, to, 0.5);
    let survived = 0;
    for (const [id, tb] of to.boxes) {
      const fb = from.boxes.get(id);
      if (!fb) continue;
      survived += 1;
      const b = boxOf(mid, id);
      expect(b.x).toBeCloseTo((fb.x + tb.x) / 2, 6);
      expect(b.y).toBeCloseTo((fb.y + tb.y) / 2, 6);
      expect(b.w).toBe(tb.w);
      expect(b.h).toBe(tb.h);
      expect(b.opacity).toBe(1);
      expect(b.scale).toBe(1);
    }
    expect(survived).toBeGreaterThan(0);
  });

  it('新增节点：从目标位淡入（opacity 0→1，scale 0.8→1）', () => {
    const base = baseTree();
    const grown = grownTree(base);
    const from = toNodeFrame(layoutOf(shrunkTree(grown)).nodes); // 2 分支
    const to = toNodeFrame(layoutOf(grown).nodes); // 3 分支——新增 1 个分支 + 1 个叶
    const newIds = [...to.boxes.keys()].filter((id) => !from.boxes.has(id));
    expect(newIds.length).toBe(2);
    for (const id of newIds) {
      const tb = to.boxes.get(id)!;
      const b = boxOf(lerpNodeFrame(from, to, 0), id);
      expect(b.x).toBe(tb.x);
      expect(b.y).toBe(tb.y);
      expect(b.opacity).toBe(0); // t=0 完全透明
      expect(b.scale).toBeCloseTo(0.8, 6);
      const end = boxOf(lerpNodeFrame(from, to, 1), id);
      expect(end.opacity).toBe(1);
      expect(end.scale).toBe(1);
    }
  });

  it('删除节点：留在旧坐标淡出并进入 ghosts（t=1 时 opacity=0）', () => {
    const base = baseTree();
    const grown = grownTree(base);
    const from = toNodeFrame(layoutOf(grown).nodes); // 3 分支
    const to = toNodeFrame(layoutOf(shrunkTree(grown)).nodes); // 2 分支——删除 1 分支 + 1 叶
    const removedIds = [...from.boxes.keys()].filter((id) => !to.boxes.has(id));
    expect(removedIds.length).toBe(2);
    const mid = lerpNodeFrame(from, to, 0.5);
    // ghost 列表 = 被删节点（旧 LayoutNode 携带渲染信息）
    expect(mid.ghosts.map((g) => g.node.id).sort()).toEqual([...removedIds].sort());
    for (const id of removedIds) {
      const fb = from.boxes.get(id)!;
      const b = boxOf(mid, id);
      expect(b.x).toBe(fb.x); // 留在旧坐标
      expect(b.y).toBe(fb.y);
      expect(b.w).toBe(fb.w);
      expect(b.opacity).toBeCloseTo(0.5, 6); // 淡出中
      const end = boxOf(lerpNodeFrame(from, to, 1), id);
      expect(end.opacity).toBe(0);
    }
  });

  it('打断续接：从中间帧继续，ghost 携带不丢失', () => {
    const base = baseTree();
    const grown = grownTree(base);
    const f1 = toNodeFrame(layoutOf(grown).nodes); // 3 分支
    const f2 = toNodeFrame(layoutOf(shrunkTree(grown)).nodes); // 2 分支
    // 动画进行到 t=0.4（f1 → f2）
    const current = lerpNodeFrame(f1, f2, 0.4);
    expect(current.ghosts.length).toBe(2);
    // 打断：新目标 = 同 2 分支但换序（坐标不同、被删节点仍缺失）——from 必须是当前中间帧
    const shrunk = shrunkTree(grown);
    const swapped = { ...shrunk, children: [...shrunk.children].reverse() };
    const f3 = toNodeFrame(layoutOf(swapped).nodes);
    const resumed = lerpNodeFrame(current, f3, 0);
    // t=0：位置从当前插值处继续（不是目标位——证明未跳回起点）
    for (const [id, cb] of current.boxes) {
      const rb = boxOf(resumed, id);
      expect(rb.x).toBe(cb.x);
      expect(rb.y).toBe(cb.y);
    }
    // 被删节点仍在淡出中（ghost 携带），未因打断而复活
    expect(resumed.ghosts.length).toBe(2);
    const finish = lerpNodeFrame(current, f3, 1);
    expect(finish.ghosts).toEqual([]); // 最终落位：ghost 全部退场
    for (const [id, tb] of f3.boxes) {
      expect(finish.boxes.get(id)!.opacity).toBe(1);
    }
  });
});
