/**
 * FO-A3 · 框编辑命令（成框 / 拆框 / 改深度）与右键「结构」入口。
 *
 * Batch A 口径：**数据与菜单可测**，不含框视觉布局（B1）与 FrameOutline（B2）。
 * 规格：`docs/specs/2026-09-15-subtree-frame-outline-design.md` §4.1（成框）/ §4.2（框上操作）
 * / §4.5（同一撤销栈）；计划：`docs/superpowers/plans/2026-09-15-subtree-frame-outline.md` Task 3。
 *
 * 覆盖：成框写 `note.frame` 且可 undo/redo / 大纲层拒绝**不写盘** / depth 钳到子树高度与上限 8 /
 * 改深度 / 拆框删键保留其它 note 字段 / 菜单三态入口（默认 depth 2）。
 *
 * FO-UI1（本批）：菜单「改框深度…」不再走原生 `prompt`，改为**请求宿主数值气泡**
 * （`onRequestFrameDepth`，缺省不注入 → 不出现该项）；范围由 `frameDepthRange` 提供
 * （与 `clampFrameDepth` 同源：1…min(8, 子树最大相对深度)）。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  astToEditable,
  frameOf,
  getNode,
  makeTextNode,
  parseMm,
  type EditableNode,
} from '@mindcanvas/kernel';
import { contextMenuItemsFor } from '../src/edit/contextMenuItems.js';
import { EditorController } from '../src/edit/controller.js';
import {
  createFrame,
  frameDepthRange,
  removeFrame,
  setFrameDepth,
} from '../src/edit/frameCommands.js';
import { FrameScheduler } from '../src/render/scheduler.js';

/** 只注入 frameActions 的菜单构造（其余动作袋缺省） */
function menuWith(
  c: EditorController,
  id: string,
  frameActions?: { onRequestFrameDepth: (id: string, current: number, max: number) => void },
) {
  return contextMenuItemsFor(
    c,
    id,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    frameActions,
  );
}

/** 真实控制器（与 growdir-growth.test.ts / context-menu-items.test.ts 同款夹具） */
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

/** 从 .mm.md 建控制器 */
function build(mm: string): EditorController {
  const ast = parseMm(mm).root;
  if (ast === null) throw new Error('夹具错误：解析失败');
  const editable = astToEditable(ast);
  if (editable === null) throw new Error('夹具错误：AST → 可编辑树失败');
  return controllerOf(editable);
}

/** 夹具取下标（避免测试里散落非空断言） */
function at<T>(list: readonly T[], i: number): T {
  const v = list[i];
  if (v === undefined) throw new Error(`夹具错误：下标 ${i} 越界`);
  return v;
}

/** 造 n 层链（返回链头）——「子树高度 vs 设计上限 8」夹具 */
function chain(n: number): EditableNode {
  let node = makeTextNode(`n${n}`);
  for (let i = n - 1; i >= 1; i -= 1) node = makeTextNode(`n${i}`, [node]);
  return node;
}

/** 根 → A → A1 → A2（A 的子树高度 = 2） */
const MM3 = '# 根\n\n- A\n  - A1\n    - A2\n';
/** 根 → A → A1、A2；B */
const MM = '# 根\n\n- A\n  - A1\n  - A2\n- B\n';
/** 根 → A → A1 → A2 → A3（用于「大纲层 vs 挂载层」的菜单可见性：两层节点都需有后代） */
const MM4 = '# 根\n\n- A\n  - A1\n    - A2\n      - A3\n';

describe('createFrame / removeFrame / setFrameDepth', () => {
  it('成框：写 note.frame（version 1 + clamp 后 depth）', () => {
    const c = build(MM3);
    const a = at(c.root.children, 0);
    expect(createFrame(c, a.id, 2)).toBe(true);
    expect(frameOf(getNode(c.root, a.id)?.note)).toEqual({ version: 1, depth: 2 });
  });

  it('depth 钳到子树高度；上限 8（9 层链请求 99 → 8）', () => {
    const c = build(MM3);
    const a = at(c.root.children, 0);
    expect(createFrame(c, a.id, 9)).toBe(true); // A 子树高度 2
    expect(frameOf(getNode(c.root, a.id)?.note)).toEqual({ version: 1, depth: 2 });

    const deep = controllerOf(makeTextNode('根', [chain(9)]));
    expect(createFrame(deep, deep.root.id, 99)).toBe(true);
    expect(frameOf(getNode(deep.root, deep.root.id)?.note)).toEqual({ version: 1, depth: 8 });
  });

  it('祖先大纲层内成框 → 拒绝，且 note 里没有 frame 键（不写盘）', () => {
    const c = build(MM3);
    const a = at(c.root.children, 0);
    expect(createFrame(c, a.id, 1)).toBe(true); // A 成框 depth=1 → A1 在大纲层
    const a1 = at(a.children, 0);
    expect(createFrame(c, a1.id, 1)).toBe(false);
    expect(getNode(c.root, a1.id)?.note?.frame).toBeUndefined();
    // 拒绝未污染历史：一次 undo 回退的是 A 的成框
    expect(c.undo()).toBe(true);
    expect(frameOf(getNode(c.root, a.id)?.note)).toBeUndefined();
    expect(frameOf(getNode(c.root, a1.id)?.note)).toBeUndefined();
  });

  it('挂载层节点可再成框（设计 §3.3 N3）', () => {
    const c = build(MM3);
    const a = at(c.root.children, 0);
    expect(createFrame(c, a.id, 1)).toBe(true);
    const a2 = at(at(a.children, 0).children, 0); // A2：相对 A d=2 > 1 → 挂载层
    expect(createFrame(c, a2.id, 1)).toBe(true);
    expect(frameOf(getNode(c.root, a2.id)?.note)).toEqual({ version: 1, depth: 1 });
  });

  it('成框进同一撤销栈：undo / redo（单条 op）', () => {
    const c = build(MM);
    const b = at(c.root.children, 1);
    expect(createFrame(c, b.id, 1)).toBe(true);
    expect(c.undo()).toBe(true);
    expect(frameOf(getNode(c.root, b.id)?.note)).toBeUndefined();
    expect(c.redo()).toBe(true);
    expect(frameOf(getNode(c.root, b.id)?.note)).toEqual({ version: 1, depth: 1 });
  });

  it('拆框：删 frame 键、其它 note 字段不动；已非框 → false', () => {
    const c = build(MM3);
    const a = at(c.root.children, 0);
    c.updateNote(a.id, { desc: 'keep', status: 'wip' });
    expect(createFrame(c, a.id, 2)).toBe(true);
    expect(removeFrame(c, a.id)).toBe(true);
    const note = getNode(c.root, a.id)?.note;
    expect(note?.frame).toBeUndefined();
    expect(note?.desc).toBe('keep');
    expect(note?.status).toBe('wip');
    expect(removeFrame(c, a.id)).toBe(false);
    expect(c.undo()).toBe(true); // 拆框也可撤销
    expect(frameOf(getNode(c.root, a.id)?.note)).toEqual({ version: 1, depth: 2 });
  });

  it('改深度：只改 depth（钳到子树高度），不动 children 拓扑，undo 回旧值；非框 → false', () => {
    const c = build(MM3);
    const a = at(c.root.children, 0);
    const a1 = at(a.children, 0);
    expect(setFrameDepth(c, a.id, 1)).toBe(false); // 未成框
    expect(createFrame(c, a.id, 2)).toBe(true);
    expect(setFrameDepth(c, a.id, 1)).toBe(true);
    expect(frameOf(getNode(c.root, a.id)?.note)).toEqual({ version: 1, depth: 1 });
    expect(setFrameDepth(c, a.id, 99)).toBe(true); // 钳回子树高度 2
    expect(frameOf(getNode(c.root, a.id)?.note)).toEqual({ version: 1, depth: 2 });
    // 只重排不改拓扑（设计 §5.3）：children 引用与顺序零改动
    expect(getNode(c.root, a.id)?.children[0]).toBe(a1);
    expect(getNode(c.root, a.id)?.children).toHaveLength(1);
    expect(c.undo()).toBe(true);
    expect(frameOf(getNode(c.root, a.id)?.note)).toEqual({ version: 1, depth: 1 });
  });

  it('frameDepthRange：当前值 + 合法上界 = min(8, 子树最大相对深度)；非框 → null', () => {
    const c = build(MM3);
    const a = at(c.root.children, 0);
    expect(frameDepthRange(c, a.id)).toBeNull(); // 未成框
    expect(createFrame(c, a.id, 2)).toBe(true);
    expect(frameDepthRange(c, a.id)).toEqual({ current: 2, max: 2 }); // A 子树深度 2
    expect(setFrameDepth(c, a.id, 1)).toBe(true);
    expect(frameDepthRange(c, a.id)).toEqual({ current: 1, max: 2 });

    // 9 层链：上界钳到设计上限 8（与 clampFrameDepth 同源，不另写常量）
    const deep = controllerOf(makeTextNode('根', [chain(9)]));
    expect(createFrame(deep, deep.root.id, 1)).toBe(true);
    expect(frameDepthRange(deep, deep.root.id)).toEqual({ current: 1, max: 8 });
  });
});

describe('右键「结构」入口（默认 depth 2）', () => {
  it('无框且可成框 → 「成框编辑…」在结构分区；点击即成框 depth 2', () => {
    const c = build(MM3);
    const a = at(c.root.children, 0);
    const item = contextMenuItemsFor(c, a.id).find((i) => i.label === '成框编辑…');
    expect(item?.section).toBe('结构');
    item?.onSelect?.();
    expect(frameOf(getNode(c.root, a.id)?.note)).toEqual({ version: 1, depth: 2 });
  });

  it('已有框 → 「改框深度…」+「拆框」，无「成框编辑…」；拆框入口真拆', () => {
    const c = build(MM3);
    const a = at(c.root.children, 0);
    expect(createFrame(c, a.id, 2)).toBe(true);
    const items = menuWith(c, a.id, { onRequestFrameDepth: () => undefined });
    const labels = items.map((i) => i.label);
    expect(labels).toContain('改框深度…');
    expect(labels).toContain('拆框');
    expect(labels).not.toContain('成框编辑…');
    expect(items.find((i) => i.label === '拆框')?.section).toBe('结构');
    items.find((i) => i.label === '拆框')?.onSelect?.();
    expect(frameOf(getNode(c.root, a.id)?.note)).toBeUndefined();
  });

  it('祖先大纲层内 → 该节点无「成框编辑…」；挂载层后代 → 仍有', () => {
    const c = build(MM4);
    const a = at(c.root.children, 0);
    expect(createFrame(c, a.id, 1)).toBe(true);
    const a1 = at(a.children, 0); // d=1 → 大纲层（自身有后代，排除「叶子不给入口」的干扰）
    const a2 = at(a1.children, 0); // d=2 → 挂载层
    expect(contextMenuItemsFor(c, a1.id).map((i) => i.label)).not.toContain('成框编辑…');
    expect(contextMenuItemsFor(c, a2.id).map((i) => i.label)).toContain('成框编辑…');
  });

  it('叶子（无后代）不成框入口：守 T6 首屏 12 行预算；数据层仍可成框且拆框可达', () => {
    const c = build(MM3);
    const a = at(c.root.children, 0);
    const a2 = at(at(a.children, 0).children, 0); // A2 无后代
    expect(contextMenuItemsFor(c, a2.id).map((i) => i.label)).not.toContain('成框编辑…');
    expect(createFrame(c, a2.id, 1)).toBe(true); // 命令层宽松（深度钳到子树高度 0 → 1）
    expect(frameOf(getNode(c.root, a2.id)?.note)).toEqual({ version: 1, depth: 1 });
    const labels = menuWith(c, a2.id, { onRequestFrameDepth: () => undefined }).map((i) => i.label);
    expect(labels).toContain('拆框'); // 已成框 → 出口必须可达
    expect(labels).toContain('改框深度…');
  });

  it('未注入 frameActions（无宿主浮层）→ 不出现「改框深度…」（原生 prompt 路径已退役）', () => {
    const c = build(MM3);
    const a = at(c.root.children, 0);
    expect(createFrame(c, a.id, 2)).toBe(true);
    const labels = contextMenuItemsFor(c, a.id).map((i) => i.label);
    expect(labels).not.toContain('改框深度…');
    expect(labels).toContain('拆框'); // 其余框动作不受影响
  });

  it('★ 点「改框深度…」只请求宿主气泡（带当前值/上界）：不写盘、不碰原生 prompt', () => {
    const c = build(MM3);
    const a = at(c.root.children, 0);
    expect(createFrame(c, a.id, 2)).toBe(true);
    const onRequestFrameDepth = vi.fn();
    const promptSpy = vi.fn(() => '1');
    vi.stubGlobal('prompt', promptSpy);
    menuWith(c, a.id, { onRequestFrameDepth })
      .find((i) => i.label === '改框深度…')
      ?.onSelect?.();
    vi.unstubAllGlobals();

    expect(onRequestFrameDepth).toHaveBeenCalledWith(a.id, 2, 2); // 坐标由调用方（菜单）补
    expect(promptSpy).not.toHaveBeenCalled();
    // 菜单只请求气泡，落盘由宿主 commit → 此处数据不动（同一条 undo 仍只有成框那一笔）
    expect(frameOf(getNode(c.root, a.id)?.note)).toEqual({ version: 1, depth: 2 });
    expect(c.undo()).toBe(true);
    expect(frameOf(getNode(c.root, a.id)?.note)).toBeUndefined();
  });
});
