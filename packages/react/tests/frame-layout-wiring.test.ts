/**
 * FO-B1 · react 侧接线：真实管线（`layoutDemo`）的框岛产出 + 跨 depth 边界守卫单点收口。
 *
 * 规格：`docs/specs/2026-09-15-subtree-frame-outline-design.md` §5.1 / §5.2；
 * 计划 Task 4 Step 3/4（「接线」与「跨 depth 拖拽 no-op」）。
 *
 * 两处接线（回执钉名）：
 *  - `src/demo/pipeline.ts`（布局编排：剪枝 → 基座 → 岛展开）；
 *  - `src/edit/controller.ts`（`apply` 对 move-node 一处拦截：拖拽落点 / indent / outdent 共用）。
 */
import { describe, expect, it } from 'vitest';
import {
  filterVisibleLinks,
  getNode,
  makeTextNode,
  setFrame,
  type EditableNode,
} from '@mindcanvas/kernel';
import { buildEditable, layoutDemo } from '../src/demo/pipeline.js';
import { EditorController } from '../src/edit/controller.js';
import { FrameScheduler } from '../src/render/scheduler.js';

/** 真实控制器（与 frame-commands.test.ts 同款夹具） */
function controllerOf(root: EditableNode): EditorController {
  const frame = new FrameScheduler({
    raf: (cb) => {
      cb();
      return 1;
    },
    rafCancel: () => undefined,
  });
  return new EditorController(root, {}, frame);
}

/** 给节点打框（不可变） */
function framed(node: EditableNode, depth: number): EditableNode {
  return { ...node, note: setFrame(node.note, depth) };
}

/** 取第 i 个孩子（夹具错误显式抛出，避免非空断言） */
function child(node: EditableNode, i: number): EditableNode {
  const c = node.children[i];
  if (c === undefined) throw new Error(`夹具错误：children[${i}] 越界`);
  return c;
}

/** 布局结果里某节点的盒（缺 → 夹具错误） */
function boxOf(layout: { nodes: readonly { node: { id: string }; box: { x: number; w: number } }[] }, id: string): { x: number; w: number } {
  const n = layout.nodes.find((x) => x.node.id === id);
  if (!n) throw new Error(`夹具错误：布局缺节点 ${id}`);
  return n.box;
}

/** 布局结果里某节点的完整盒（缺 → 夹具错误） */
function fullBoxOf(
  layout: { nodes: readonly { node: { id: string }; box: { x: number; y: number; w: number; h: number } }[] },
  id: string,
): { x: number; y: number; w: number; h: number } {
  const n = layout.nodes.find((x) => x.node.id === id);
  if (n === undefined) throw new Error(`夹具错误：布局缺盒 ${id}`);
  return n.box;
}

/** 轴对齐相交（贴合不算）——框岛碰撞断言用 */
function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return (
    Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0 &&
    Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0
  );
}

/** .mm.md 文本 → 可编辑树 */
function editableOf(mm: string): EditableNode {
  const { editable } = buildEditable(mm);
  if (editable === null) throw new Error('夹具错误：AST → 可编辑树失败');
  return editable;
}

describe('框岛接线：layoutDemo（真实编排）', () => {
  it('成框节点收成岛：大纲行保留在框内，挂出子树排到挂点右侧，节点不双份', () => {
    // 根 → A → A1 → A2；A 成框 depth=1 → 大纲 {A, A1}，空间层 {A2}
    const root = editableOf('# 根\n\n- A\n  - A1\n    - A2\n');
    const a = child(root, 0);
    const a1 = child(a, 0);
    const a2 = child(a1, 0);
    const framedRoot: EditableNode = {
      ...root,
      children: [framed(a, 1)],
    };
    const { layout } = layoutDemo(framedRoot, new Map(), (s) => s.length * 10);
    const ids = layout.nodes.map((n) => n.node.id);
    expect(ids).toContain(a1.id); // 大纲行（d=1 ≤ depth）
    expect(ids).toContain(a2.id); // 空间层（d=2 > depth）→ 仍以节点盒回到布局
    expect(new Set(ids).size).toBe(ids.length); // 无重复摆放
    // 挂出子树在挂点行（A1，d=depth）右侧
    expect(boxOf(layout, a2.id).x).toBeGreaterThan(boxOf(layout, a1.id).x + boxOf(layout, a1.id).w);
    expect(layout.links.some((l) => l.fromId === a1.id && l.toId === a2.id)).toBe(true);
  });

  it('框根 = 文档根：基线布局不剪根的子层，也只得一份（旧副本被岛替换）', () => {
    const root = editableOf('# 根\n\n- A\n  - A1\n    - A2\n');
    const a = child(root, 0);
    const a1 = child(a, 0);
    const a2 = child(a1, 0);
    const framedRoot = framed(root, 1); // 文档根成框
    const { layout } = layoutDemo(framedRoot, new Map(), (s) => s.length * 10);
    const ids = layout.nodes.map((n) => n.node.id);
    expect(ids.sort()).toEqual([root.id, a.id, a1.id, a2.id].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('FO-FIX1：挂出子树内部边随 layout.links 交付（MapView 无需从 children 补线）', () => {
    // 根 → A → A1 → A2 → A3；A 成框 depth=1 → 大纲 {A, A1}，空间层 = {A2, A3}
    const root = editableOf('# 根\n\n- A\n  - A1\n    - A2\n      - A3\n');
    const a = child(root, 0);
    const a1 = child(a, 0);
    const a2 = child(a1, 0);
    const a3 = child(a2, 0);
    const framedRoot: EditableNode = { ...root, children: [framed(a, 1)] };
    const { layout } = layoutDemo(framedRoot, new Map(), (s) => s.length * 10);
    const edges = layout.links.map((l) => `${l.fromId}→${l.toId}`);
    expect(edges).toContain(`${a1.id}→${a2.id}`); // 挂点边（B1）
    expect(edges).toContain(`${a2.id}→${a3.id}`); // ★ 挂出子树内部边（FO-FIX1 根因 A）
    // MapView 树边渲染走 filterVisibleLinks(layout.links, …)：视口包住整图时不得丢
    const boxes = new Map(layout.nodes.map((n) => [n.node.id, n.box]));
    const visible = filterVisibleLinks(layout.links, boxes, {
      x: -100000,
      y: -100000,
      w: 200000,
      h: 200000,
    }, 128);
    expect(visible.some((l) => l.fromId === a2.id && l.toId === a3.id)).toBe(true);
  });

  it('FO-FIX3：同挂点行下两个空间同级经真管线错开（盒不相交），挂点边各一条', () => {
    // 根 → A → A1 → [S1, S2]；A 成框 depth=1 → 挂点行 = A1，其两个子同属空间层
    const root = editableOf('# 根\n\n- A\n  - A1\n    - S1\n    - S2\n');
    const a = child(root, 0);
    const a1 = child(a, 0);
    const s1 = child(a1, 0);
    const s2 = child(a1, 1);
    const framedRoot: EditableNode = { ...root, children: [framed(a, 1)] };
    const { layout } = layoutDemo(framedRoot, new Map(), (s) => s.length * 10);
    // 轴对齐相交（贴合不算）：修前两盒同点重合 → 红
    expect(overlaps(fullBoxOf(layout, s1.id), fullBoxOf(layout, s2.id))).toBe(false);
    const edges = layout.links.map((l) => `${l.fromId}→${l.toId}`);
    expect(edges).toContain(`${a1.id}→${s1.id}`);
    expect(edges).toContain(`${a1.id}→${s2.id}`);
  });

  it('FO-FIX4：不同挂点行的两个挂出岛经真管线推挤（各节点两两不相交，边不丢）', () => {
    // 根 → A → [H1 → P1 → [C1a, C1b], H2 → P2 → [C2a, C2b]]；A 成框 depth=1
    // → 大纲 {A, H1, H2}（两挂点行相邻），空间层 = 两岛 {P1 系, P2 系}
    const root = editableOf(
      '# 根\n\n- A\n  - H1\n    - P1\n      - C1a\n      - C1b\n  - H2\n    - P2\n      - C2a\n      - C2b\n',
    );
    const a = child(root, 0);
    const h1 = child(a, 0);
    const h2 = child(a, 1);
    const p1 = child(h1, 0);
    const p2 = child(h2, 0);
    const c1a = child(p1, 0);
    const c1b = child(p1, 1);
    const c2a = child(p2, 0);
    const c2b = child(p2, 1);
    const framedRoot: EditableNode = { ...root, children: [framed(a, 1)] };
    const { layout } = layoutDemo(framedRoot, new Map(), (s) => s.length * 10);
    const islandA = [p1, c1a, c1b].map((n) => fullBoxOf(layout, n.id));
    const islandB = [p2, c2a, c2b].map((n) => fullBoxOf(layout, n.id));
    for (const x of islandA) for (const y of islandB) expect(overlaps(x, y)).toBe(false);
    const edges = layout.links.map((l) => `${l.fromId}→${l.toId}`);
    for (const [from, to] of [
      [h1.id, p1.id],
      [h2.id, p2.id],
      [p1.id, c1a.id],
      [p1.id, c1b.id],
      [p2.id, c2a.id],
      [p2.id, c2b.id],
    ] as const) {
      expect(edges).toContain(`${from}→${to}`);
    }
  });

  it('无成框节点：布局与常规路径一致（框机制不泄漏）', () => {
    const root = editableOf('# 根\n\n- A\n  - A1\n');
    const { layout } = layoutDemo(root, new Map(), (s) => s.length * 10);
    expect(layout.nodes.map((n) => n.node.id).sort()).toEqual(
      [root.id, child(root, 0).id, child(child(root, 0), 0).id].sort(),
    );
  });
});

describe('跨 depth 边界守卫：controller.apply 单点收口', () => {
  /** doc → [f(frame, depth=2), z]；f → [c1, c2]，c1 → g → gg（大纲 {f,c1,c2,g}，空间层 {gg}） */
  function fixture(): {
    ctrl: EditorController;
    f: EditableNode;
    c1: EditableNode;
    c2: EditableNode;
    g: EditableNode;
    gg: EditableNode;
  } {
    const gg = makeTextNode('gg');
    const g = makeTextNode('g', [gg]);
    const c1 = makeTextNode('c1', [g]);
    const c2 = makeTextNode('c2');
    const f = framed(makeTextNode('f', [c1, c2]), 2);
    const doc = makeTextNode('doc', [f, makeTextNode('z')]);
    return { ctrl: controllerOf(doc), f, c1, c2, g, gg };
  }

  it('DnD 落点跨边界（大纲行 → 挂到空间层节点之下）→ no-op，不进历史', () => {
    const { ctrl, g, gg } = fixture();
    const before = ctrl.root;
    ctrl.apply({ type: 'move-node', id: g.id, targetParentId: gg.id, index: 0 });
    expect(ctrl.root).toBe(before);
    expect(ctrl.canUndo).toBe(false);
  });

  it('缩进跨边界（空间层 → 挂回大纲层）→ outdent no-op，不进历史', () => {
    const { ctrl, c1, g, gg } = fixture();
    const before = ctrl.root;
    // gg 在空间层（相对深度 3 > depth=2）；outdent 会把它上移成 c1 的孩子（相对深度 2 → 大纲层）→ 拦
    expect(ctrl.outdent(gg.id)).toBe(false);
    expect(ctrl.root).toBe(before);
    expect(ctrl.canUndo).toBe(false); // 被拒的层级调整不产历史条目
    expect(getNode(ctrl.root, g.id)?.children[0]?.id).toBe(gg.id); // 结构未动
    expect(getNode(ctrl.root, c1.id)?.children.map((n) => n.id)).toEqual([g.id]);
  });

  it('同层改层级仍放行（大纲层内缩进：c2 → c1 之下，相对深度 2 ≤ depth）', () => {
    const { ctrl, c1, c2, g } = fixture();
    const before = ctrl.root;
    expect(ctrl.indent(c2.id)).toBe(true);
    expect(ctrl.root).not.toBe(before);
    expect(getNode(ctrl.root, c1.id)?.children.map((n) => n.id)).toEqual([g.id, c2.id]);
  });

  it('无框文档：守卫不影响既有拖拽/缩进（走原路）', () => {
    const a = makeTextNode('a');
    const b = makeTextNode('b');
    const doc = makeTextNode('doc', [a, b]);
    const ctrl = controllerOf(doc);
    expect(ctrl.indent(b.id)).toBe(true); // 无框 → 原语义
    expect(getNode(ctrl.root, a.id)?.children.map((n) => n.id)).toEqual([b.id]);
  });
});
