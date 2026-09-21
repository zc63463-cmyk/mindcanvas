// @vitest-environment jsdom
/**
 * C2：中心写动作直测（onDemote / onToggleParentLink；计划 §1.3 空白补齐）。
 *
 * - onDemote：清空后**连键一起删**（centers/center_pos 不留空数组）、坐标进历史、cid 保留；
 *   多中心时仅删被降条目（数组形态保留）；非中心 → no-op。
 * - onToggleParentLink：show 写入并回读；hide 为缺省语义（不落字段、回读 hide）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { astToEditable, makeTextNode, type EditableNode } from '@mindcanvas/kernel';
import { EditorController } from '@mindcanvas/react';
import { makeCenterActions } from '../src/nodeMenuBags.js';

function buildRoot() {
  const root = astToEditable(makeTextNode('根', [makeTextNode('任务', [makeTextNode('K3')])]));
  if (root === null) throw new Error('fixture broken: astToEditable returned null');
  return root;
}

/** 子节点读取（零 `!` 纪律：越界即抛） */
function childAt(node: EditableNode, index: number): EditableNode {
  const child = node.children[index];
  if (child === undefined) throw new Error(`fixture broken: child #${index} missing`);
  return child;
}

function makeActions(controller: EditorController) {
  return makeCenterActions(controller, 't.mm.md', {
    setDescEditingId: vi.fn(),
    setPinnedNotePath: vi.fn(),
  });
}

describe('C2 写动作直测：onDemote', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      window.setTimeout(() => cb(0), 16),
    );
    vi.stubGlobal('cancelAnimationFrame', (h: number) => window.clearTimeout(h));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('唯一中心降格 → centers 连键一起删（不留空数组）、坐标进历史、cid 保留', () => {
    const root = buildRoot();
    root.note = {
      next_cid: 3,
      centers: [{ at: 'node:根/任务', dir: 'right', cid: 'c1', x: 120, y: 60 }],
    };
    const task0 = childAt(root, 0);
    task0.note = { cid: 'c1' };
    const controller = new EditorController(root);
    const actions = makeActions(controller);

    actions.onDemote(childAt(controller.root, 0).id);

    const note = controller.root.note ?? {};
    expect('centers' in note).toBe(false);
    expect(note.center_pos).toMatchObject([{ at: 'node:根/任务', x: 120, y: 60 }]);
    expect(childAt(controller.root, 0).note?.cid).toBe('c1');
  });

  it('多中心降格其一 → 数组形态保留、仅删被降条目（坐标进历史）', () => {
    const root = buildRoot();
    root.note = {
      next_cid: 3,
      centers: [
        { at: 'node:根/任务', dir: 'right', cid: 'c1', x: 120, y: 60 },
        { at: 'node:根/任务/K3', dir: 'left', cid: 'c2', x: -200, y: 30 },
      ],
    };
    const task0 = childAt(root, 0);
    const k3 = childAt(task0, 0);
    task0.note = { cid: 'c1' };
    k3.note = { cid: 'c2' };
    const controller = new EditorController(root);
    const actions = makeActions(controller);

    actions.onDemote(childAt(controller.root, 0).id);

    const raw = controller.root.note?.centers;
    if (!Array.isArray(raw)) throw new Error('red: centers 不是数组');
    expect(raw).toHaveLength(1);
    expect(raw[0]).toMatchObject({ at: 'node:根/任务/K3', cid: 'c2' });
    expect(controller.root.note?.center_pos).toMatchObject([
      { at: 'node:根/任务', x: 120, y: 60 },
    ]);
  });

  it('非中心节点降格 → no-op（root.note 原样）', () => {
    const controller = new EditorController(buildRoot());
    const actions = makeActions(controller);

    actions.onDemote(childAt(controller.root, 0).id);

    expect(controller.root.note).toBeUndefined();
  });
});

describe('C2 写动作直测：onToggleParentLink', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      window.setTimeout(() => cb(0), 16),
    );
    vi.stubGlobal('cancelAnimationFrame', (h: number) => window.clearTimeout(h));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('show → 写入 parent_link 并回读；hide → 删键回读 hide（缺省语义）', () => {
    const root = buildRoot();
    root.note = { next_cid: 2, centers: [{ at: 'node:根/任务', dir: 'right', cid: 'c1' }] };
    const task0 = childAt(root, 0);
    task0.note = { cid: 'c1' };
    const controller = new EditorController(root);
    const actions = makeActions(controller);
    const id = childAt(controller.root, 0).id;

    actions.onToggleParentLink(id, 'show');
    const shown = controller.root.note?.centers;
    if (!Array.isArray(shown)) throw new Error('red: centers 不是数组');
    expect(shown[0]).toMatchObject({ cid: 'c1', parent_link: 'show' });
    expect(actions.parentLinkOf(id)).toBe('show');

    actions.onToggleParentLink(id, 'hide');
    const hidden = controller.root.note?.centers;
    if (!Array.isArray(hidden)) throw new Error('red: centers 不是数组');
    expect(hidden[0]).not.toHaveProperty('parent_link');
    expect(actions.parentLinkOf(id)).toBe('hide');
  });
});
