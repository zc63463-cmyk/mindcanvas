import { describe, expect, it } from 'vitest';
import {
  editableToAst,
  layoutMindmap,
  makeTextNode,
  serializeMm,
  type EditableNode,
} from '@mindcanvas/kernel';
import { EditorController } from '../src/edit/controller.js';
import { FrameScheduler } from '../src/render/scheduler.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

/** 生成 8 枝 × 4 层 × 4 宽 ≈ 680 节点平衡树 */
function genTree(depth: number, width: number, prefix = 'n'): EditableNode {
  const node = makeTextNode(prefix, []);
  if (depth > 1) {
    for (let i = 0; i < width; i++) node.children.push(genTree(depth - 1, width, `${prefix}.${i}`));
  }
  return node;
}

function buildRoot(): EditableNode {
  const root = makeTextNode('root', []);
  for (let i = 0; i < 8; i++) root.children.push(genTree(4, 4, `b${i}`));
  return root;
}

/** node 环境同步调度 */
function syncFrame(): FrameScheduler {
  return new FrameScheduler({ raf: (cb) => cb() as unknown as number, rafCancel: () => undefined });
}

function median(s: number[]): number {
  const sorted = [...s].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

describe('T6 性能：681 节点编辑操作响应（目标 < 100ms，单帧预算）', () => {
  it('增删改 + 折叠 + undo/redo 单操作耗时（含 relayout）< 100ms', () => {
    const c = new EditorController(buildRoot(), {}, syncFrame());
    const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
    const measure = createNodeMeasure(char, new Map());

    const samples: number[] = [];
    let node = c.root;
    // 选中第一个分支
    const branch = c.root.children[0]!;
    c.select(branch.id);

    // 循环编辑操作，每次测量「op apply + relayout」耗时（真实渲染链路重排成本）
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      switch (i % 4) {
        case 0: {
          const id = c.addChild(branch.id, `新子 ${i}`);
          node = c.root;
          layoutMindmap(node, measure, c.collapsed);
          c.removeNode(id);
          break;
        }
        case 1:
          c.updateText(branch.children[0]!.id, `改名 ${i}`);
          node = c.root;
          layoutMindmap(node, measure, c.collapsed);
          break;
        case 2:
          c.toggleCollapse(branch.id);
          node = c.root;
          layoutMindmap(node, measure, c.collapsed);
          break;
        case 3:
          c.undo();
          node = c.root;
          layoutMindmap(node, measure, c.collapsed);
          break;
      }
      samples.push(performance.now() - t0);
    }

    const ms = median(samples);
    console.log(`[T6] 681 节点编辑+relayout 中位数=${ms.toFixed(2)}ms（目标 <100ms）`);
    expect(ms).toBeLessThan(100);
  });

  it('undo/redo 树状态序列对比（快照序列逐步还原/重放）', () => {
    const c = new EditorController(buildRoot(), {}, syncFrame());
    const branch = c.root.children[0]!;

    const snap = (): string => serializeMm(editableToAst(c.root));
    const s0 = snap();

    const id = c.addChild(branch.id, 'A');
    const s1 = snap();
    c.updateText(id, 'B');
    const s2 = snap();
    c.addSibling(branch.children[0]!.id, 'C');
    const s3 = snap();

    // 逐步 undo → 序列逆推（s3→s2→s1→s0）
    expect(c.undo()).toBe(true);
    expect(snap()).toBe(s2);
    expect(c.undo()).toBe(true);
    expect(snap()).toBe(s1);
    expect(c.undo()).toBe(true);
    expect(snap()).toBe(s0);
    expect(c.undo()).toBe(false);

    // 逐步 redo → 序列重放（s0→s1→s2→s3）
    expect(c.redo()).toBe(true);
    expect(snap()).toBe(s1);
    expect(c.redo()).toBe(true);
    expect(snap()).toBe(s2);
    expect(c.redo()).toBe(true);
    expect(snap()).toBe(s3);
    expect(c.redo()).toBe(false);
  });

  it('undo 后新编辑截断 redo 分支（新分支替换）', () => {
    const c = new EditorController(buildRoot(), {}, syncFrame());
    const branch = c.root.children[0]!;
    c.addChild(branch.id, 'X');
    c.undo();
    expect(c.canRedo).toBe(true);
    // 新编辑 → redo 分支截断
    c.addChild(branch.id, 'Y');
    expect(c.canRedo).toBe(false);
  });
});
