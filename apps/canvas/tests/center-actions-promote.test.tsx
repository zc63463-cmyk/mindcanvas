// @vitest-environment jsdom
/**
 * C1：升格写路径统一 —— 菜单/环 onPromote 经 planPromoteCenter（唯一写路径）。
 *
 * 背景（计划 §1.1）：原 onPromote 走 `upsertCenter + updateNote` 的「双轨」——
 * 不分配 cid、不做单批 undo、失败无通道。判别断言（TDD 先红后绿）：
 * - 无 cid 节点升格 → centers 条目与节点 note **同源 cid**（next_cid 同步 bump）；
 * - 一次 undo → 节点 note 与 root.note **同时**回滚（单批 ops）；
 * - 已有 cid 节点再升格 → 沿用不 bump、不重写节点 note（ops 只含 root 一条）；
 * - center_pos 历史坐标 → 升格吸附回原位（回归：统一后语义保持）；
 * - at 不可解析（空文本节点）→ `cid:` 兜底（口径变更：原「不动作」→ 现「照常升格」）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { astToEditable, makeTextNode, type EditableNode } from '@mindcanvas/kernel';
import { collectCenters, EditorController } from '@mindcanvas/react';
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

type LayoutPosFn = (id: string) => { x: number; y: number } | undefined;

function makeActions(
  controller: EditorController,
  onAttachError = vi.fn(),
  layoutPosOf?: LayoutPosFn,
) {
  return {
    actions: makeCenterActions(controller, 't.mm.md', {
      setDescEditingId: vi.fn(),
      setPinnedNotePath: vi.fn(),
      onAttachError,
      ...(layoutPosOf !== undefined ? { layoutPosOf } : {}),
    }),
    onAttachError,
  };
}

describe('C1 升格写路径统一（菜单/环 onPromote → planPromoteCenter）', () => {
  beforeEach(() => {
    // canvas 套件统一 pretendToBeVisual:false（无 rAF）——controller 构造的调度需补桩
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      window.setTimeout(() => cb(0), 16),
    );
    vi.stubGlobal('cancelAnimationFrame', (h: number) => window.clearTimeout(h));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('无 cid 节点升格 → centers 条目与节点 note 同源 cid（next_cid bump）', () => {
    const controller = new EditorController(buildRoot());
    const { actions } = makeActions(controller);
    const task = childAt(controller.root, 0);

    actions.onPromote(task.id, 'left');

    const raw = controller.root.note?.centers;
    expect(Array.isArray(raw)).toBe(true);
    if (!Array.isArray(raw)) throw new Error('red: centers 缺失');
    expect(raw).toHaveLength(1);
    expect(raw[0]).toMatchObject({ at: 'node:根/任务', dir: 'left', cid: 'c1' });
    // 节点 note 写入同源 cid；next_cid 单调 bump
    expect(childAt(controller.root, 0).note?.cid).toBe('c1');
    expect(controller.root.note?.next_cid).toBe(2);
  });

  it('一次 undo → 节点 note 与 root.note 同时回滚（单批 ops）', () => {
    const controller = new EditorController(buildRoot());
    const { actions } = makeActions(controller);
    const task = childAt(controller.root, 0);
    actions.onPromote(task.id, 'left');

    expect(controller.undo()).toBe(true);
    expect(controller.root.note?.centers).toBeUndefined();
    expect(controller.root.note?.next_cid).toBeUndefined();
    expect(childAt(controller.root, 0).note?.cid).toBeUndefined();
  });

  it('已有 cid 节点再升格 → 沿用不 bump、不重写节点 note（ops 只含 root 一条）', () => {
    const root = buildRoot();
    root.note = { next_cid: 7 };
    const task = childAt(root, 0);
    task.note = { cid: 'c3' };
    const controller = new EditorController(root);
    const { actions } = makeActions(controller);
    const spy = vi.spyOn(controller, 'applyTransaction');

    actions.onPromote(childAt(controller.root, 0).id, 'down');

    const raw = controller.root.note?.centers;
    if (!Array.isArray(raw)) throw new Error('red: centers 缺失');
    expect(raw[0]).toMatchObject({ cid: 'c3', dir: 'down' });
    expect(controller.root.note?.next_cid).toBe(7);
    expect(childAt(controller.root, 0).note?.cid).toBe('c3');
    // 单批事务：仅 root 一条 update-node（节点 note 不重写）
    expect(spy).toHaveBeenCalledTimes(1);
    const ops = spy.mock.calls[0]?.[0];
    expect(ops).toHaveLength(1);
    expect(ops?.[0]).toMatchObject({ type: 'update-node', id: controller.root.id });
  });

  it('center_pos 历史坐标 → 升格吸附回原位（回归保持）', () => {
    const root = buildRoot();
    root.note = { center_pos: [{ at: 'node:根/任务', x: 250, y: 100 }] };
    const controller = new EditorController(root);
    const { actions } = makeActions(controller);
    const task = childAt(controller.root, 0);

    actions.onPromote(task.id, 'right');

    const centers = collectCenters(controller.root);
    expect(centers).toHaveLength(1);
    expect(centers[0]?.pos).toEqual({ x: 250, y: 100 });
  });

  it('注入 layoutPosOf → 升格写布局盒中心（PROMOTE-SEED-1 可见落点）', () => {
    const controller = new EditorController(buildRoot());
    const { actions } = makeActions(controller, vi.fn(), () => ({ x: 111, y: 222 }));
    const task = childAt(controller.root, 0);

    actions.onPromote(task.id, 'left');

    const centers = collectCenters(controller.root);
    expect(centers).toHaveLength(1);
    expect(centers[0]?.pos).toEqual({ x: 111, y: 222 });
    // 成对写入（协议口径：x/y 必须成对）
    const raw = controller.root.note?.centers;
    if (!Array.isArray(raw)) throw new Error('red: centers 缺失');
    expect(raw[0]).toMatchObject({ x: 111, y: 222 });
  });

  it('layoutPosOf 与 center_pos 历史并存 → 可见位置优先（覆盖历史吸附）', () => {
    const root = buildRoot();
    root.note = { center_pos: [{ at: 'node:根/任务', x: 250, y: 100 }] };
    const controller = new EditorController(root);
    const { actions } = makeActions(controller, vi.fn(), () => ({ x: -30, y: 45 }));
    const task = childAt(controller.root, 0);

    actions.onPromote(task.id, 'right');

    const centers = collectCenters(controller.root);
    expect(centers[0]?.pos).toEqual({ x: -30, y: 45 });
  });

  it('layoutPosOf 未命中（undefined）→ 不传 pos：不写坐标（禁止 (0,0)）', () => {
    const controller = new EditorController(buildRoot());
    const { actions } = makeActions(controller, vi.fn(), () => undefined);
    const task = childAt(controller.root, 0);

    actions.onPromote(task.id, 'right');

    const centers = collectCenters(controller.root);
    expect(centers).toHaveLength(1);
    expect(centers[0]?.pos).toBeNull();
    const raw = controller.root.note?.centers;
    if (!Array.isArray(raw)) throw new Error('red: centers 缺失');
    expect(raw[0]).not.toHaveProperty('x');
    expect(raw[0]).not.toHaveProperty('y');
  });

  it('at 不可解析（空文本节点）→ cid: 兜底升格（口径变更：原不动作）', () => {
    const root = astToEditable(
      makeTextNode('根', [makeTextNode('任务', [makeTextNode('')])]),
    );
    if (root === null) throw new Error('fixture broken: astToEditable returned null');
    const controller = new EditorController(root);
    const { actions, onAttachError } = makeActions(controller);
    const empty = childAt(childAt(controller.root, 0), 0);

    actions.onPromote(empty.id, 'left');

    const centers = collectCenters(controller.root);
    expect(centers).toHaveLength(1);
    expect(centers[0]?.cid).toBe('c1');
    expect(centers[0]?.at).toBe('cid:c1');
    expect(centers[0]?.nodeId).toBe(empty.id);
    expect(onAttachError).not.toHaveBeenCalled();
  });
});
