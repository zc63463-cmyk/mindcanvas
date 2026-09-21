// @vitest-environment jsdom
/**
 * FO-B3 · 子树框编辑端到端（真 `MindmapStage` 全链）。
 *
 * 规格：`docs/specs/2026-09-15-subtree-frame-outline-design.md` §9（验收直觉五条）；
 * 计划：`docs/superpowers/plans/2026-09-15-subtree-frame-outline.md` Task 6。
 *
 * 链路一律走**真实 UI**：启动页 →「最近」打开文档 → 节点右键菜单（成框 / 改框深度 / 拆框）
 * → 框内大纲行双击编辑 → 文档栏「保存」→ 库 source 回读（`parseMm` 复核）→ 切文档往返重载。
 *
 * 设施比照 `note-back-edit.test.tsx` / `note-flip-host.test.tsx`：
 * jsdom 无尺寸（世界变换≈恒等，工具已做变换感知）；canvas 套件 `pretendToBeVisual:false`
 * （无 rAF）→ 需补桩。
 * 「改框深度…」自 FO-UI1 起走画布内数值步进气泡（`data-frame-depth-input`），
 * **不再走原生 `prompt`**——本文件把 prompt 换成会抛错的 spy，防生产路径回潮。
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { astToEditable, frameOf, parseMm, type EditableNode } from '@mindcanvas/kernel';
import MindmapStage from '../src/MindmapStage';

const LIB_KEY = 'mindcanvas.library.v1';
const DOC_ID = 'e2e-frame';
const DOC_NAME = 'e2e-frame.mm.md';
const OTHER_ID = 'e2e-frame-other';
const OTHER_NAME = 'e2e-frame-other.mm.md';

/**
 * 夹具文档：根 → A → A1 → A2 → A2a；A 上带**幕布注释** `desc`（拆框不得动它）。
 * note 块绑定「其后第一个结构节点」= A（沿用 note-flip / note-back 夹具口径）。
 * A2 带子节点（A2a）——「成框编辑…」菜单对有后代者才给（叶子成框退化，A3 口径），
 * §9.4 的挂载层孙成框用例需要它非叶。
 */
const DOC_SOURCE = [
  '# 根',
  '',
  '<!--',
  'desc: 幕布说明',
  '-->',
  '',
  '## A',
  '',
  '### A1',
  '',
  '#### A2',
  '',
  '##### A2a',
  '',
].join('\n');

const OTHER_SOURCE = '# 别的\n\n- 乙\n';

const tick = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 尺寸桩：jsdom 无布局引擎（容器恒 0×0）→ 真实 `ResizeObserver` 缺席 → viewport 落到
 * 最小缩放（实测 k=0.15）→ **LOD 省文本** + 视口裁剪几乎全裁。
 * 补一个「观察即报一次尺寸」的桩，让 fit 拿到接近真实的视口（本用例须按文本找节点、
 * 按世界盒换算屏幕点击）。
 */
class FakeResizeObserver {
  private readonly cb: (entries: Array<{ contentRect: { width: number; height: number } }>) => void;
  constructor(cb: (entries: Array<{ contentRect: { width: number; height: number } }>) => void) {
    this.cb = cb;
  }
  observe(): void {
    this.cb([{ contentRect: { width: 960, height: 720 } }]);
  }
  unobserve(): void {}
  disconnect(): void {}
}

/** 取值守卫（缺即抛；新测试不写非空断言——lint 计数不得抬升） */
function must<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`缺少：${what}`);
  return v;
}

function nodeIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('g[data-node-id]')).map(
    (g) => g.getAttribute('data-node-id') ?? '',
  );
}

/** 按**精确文本**找画布节点卡 id */
function nodeIdOfText(container: HTMLElement, text: string): string | null {
  for (const id of nodeIds(container)) {
    const g = container.querySelector(`g[data-node-id="${id}"]`);
    if ((g?.textContent ?? '') === text) return id;
  }
  return null;
}

/** 节点 g 的**世界**中心（transform 的 translate + 首个 rect 的宽高） */
function centerOf(container: HTMLElement, id: string): { cx: number; cy: number } | null {
  const g = container.querySelector(`g[data-node-id="${id}"]`);
  if (!g) return null;
  const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(g.getAttribute('transform') ?? '');
  const r = g.querySelector('rect');
  if (!m || !r) return null;
  return {
    cx: Number(m[1]) + Number(r.getAttribute('width') ?? 0) / 2,
    cy: Number(m[2]) + Number(r.getAttribute('height') ?? 0) / 2,
  };
}

/** 世界→屏幕变换：读世界组 `translate(x y) scale(k)`（fit/缩放后非恒等；缺省按恒等） */
function worldTransformOf(container: HTMLElement): { tx: number; ty: number; k: number } {
  const svg = container.querySelector('g[data-node-id]')?.closest('svg') ?? null;
  const g = svg === null ? null : (Array.from(svg.children).find((el) => el.tagName === 'g') ?? null);
  const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\)\s*scale\(\s*(-?[\d.]+)/.exec(
    g?.getAttribute('transform') ?? '',
  );
  if (m === null) return { tx: 0, ty: 0, k: 1 };
  return { tx: Number(m[1]), ty: Number(m[2]), k: Number(m[3]) };
}

/** 手势层（画布事件入口） */
function wheelOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector('div[style*="touch-action"]');
  if (!(el instanceof HTMLElement)) throw new Error('缺少：画布手势层');
  return el;
}

const px = (v: string): number => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/** 世界点 → 屏幕（client）坐标：world × k + t（jsdom 容器 bounding rect 全零，client 与容器同系） */
function toClient(container: HTMLElement, world: { cx: number; cy: number }): {
  sx: number;
  sy: number;
} {
  const { tx, ty, k } = worldTransformOf(container);
  return { sx: world.cx * k + tx, sy: world.cy * k + ty };
}

/** 画布节点卡：右键（世界盒中心 → 屏幕） */
function rightClickVia(container: HTMLElement, at: { sx: number; sy: number }): void {
  fireEvent.contextMenu(wheelOf(container), { clientX: at.sx, clientY: at.sy, bubbles: true });
}

function rightClickNode(container: HTMLElement, id: string): void {
  rightClickVia(container, toClient(container, must(centerOf(container, id), `节点 ${id} 位置`)));
}

/** 框内大纲行（B2 组件产物） */
function frameRowOf(container: HTMLElement, id: string): HTMLElement {
  const el = container.querySelector(`[data-frame-row][data-frame-node="${id}"]`);
  if (!(el instanceof HTMLElement)) throw new Error(`缺少：框内大纲行 ${id}`);
  return el;
}

/** 框内大纲行 id（按精确文本） */
function frameRowIdOfText(container: HTMLElement, text: string): string | null {
  for (const el of container.querySelectorAll('[data-frame-row]')) {
    const label = el.querySelector('[data-frame-row-text]')?.textContent ?? '';
    if (label === text) {
      const id = el.getAttribute('data-frame-node');
      if (id !== null) return id;
    }
  }
  return null;
}

/** 大纲行的屏幕中心：自身 inline 几何 + 框壳偏移（行盒由 B1 岛产出 → 与画布同系） */
function frameRowClient(container: HTMLElement, id: string): { sx: number; sy: number } {
  const row = frameRowOf(container, id);
  const shell = row.closest('[data-frame-shell]');
  if (!(shell instanceof HTMLElement)) throw new Error('缺少：框壳');
  return {
    sx: px(shell.style.left) + px(row.style.left) + px(row.style.width) / 2,
    sy: px(shell.style.top) + px(row.style.top) + px(row.style.height) / 2,
  };
}

/** 菜单项（按标签精确匹配；缺 → 抛，便于诊断） */
function menuItem(container: HTMLElement, label: string): HTMLElement {
  for (const el of container.querySelectorAll('[data-menu-item]')) {
    if ((el.textContent ?? '').trim() === label) {
      if (!(el instanceof HTMLElement)) throw new Error(`菜单项「${label}」非 HTMLElement`);
      return el;
    }
  }
  throw new Error(`缺少菜单项：「${label}」`);
}

/** 菜单项是否存在（用于「入口应缺席」的断言） */
function hasMenuItem(container: HTMLElement, label: string): boolean {
  return Array.from(container.querySelectorAll('[data-menu-item]')).some(
    (el) => (el.textContent ?? '').trim() === label,
  );
}

/** 关闭当前上下文菜单 */
function closeMenu(container: HTMLElement): void {
  const backdrop = container.querySelector('[data-menu-backdrop]');
  if (backdrop !== null) fireEvent.pointerDown(backdrop);
}

/** 轮询等待断言成立（controller.notify → rAF 桩 → 帧） */
async function waitFor(assertFn: () => void, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      assertFn();
      return;
    } catch (e) {
      lastErr = e;
    }
    await tick(25);
  }
  throw lastErr ?? new Error('waitFor timeout');
}

/** 启动页 →「最近」菜单打开指定文档（走 applyDoc → useDocumentSwitch reset 路径） */
async function openDoc(container: HTMLElement, name: string): Promise<void> {
  const sample = Array.from(container.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '') === '看内置示例',
  );
  if (sample !== undefined) {
    fireEvent.click(sample);
    await waitFor(() => expect(container.querySelector('[data-doc-name]')).not.toBeNull());
  }
  const recentBtn = Array.from(container.querySelectorAll('span')).find(
    (s) => (s.textContent ?? '') === '最近',
  );
  if (recentBtn === undefined) throw new Error('文档栏「最近」按钮缺失');
  fireEvent.click(recentBtn);
  await waitFor(() => expect(container.querySelector('[data-recent-menu]')).not.toBeNull());
  const docItem = Array.from(container.querySelectorAll('[data-recent-doc]')).find((el) =>
    (el.textContent ?? '').includes(name),
  );
  if (docItem === undefined) throw new Error(`「最近」菜单未列出 ${name}`);
  fireEvent.click(docItem);
  await waitFor(() =>
    expect(container.querySelector('[data-doc-name]')?.textContent).toContain(name),
  );
}

/** 等某节点卡（按精确文本）出现，返回其 id */
async function waitForNode(container: HTMLElement, text: string): Promise<string> {
  let id: string | null = null;
  for (let i = 0; i < 60 && id === null; i++) {
    id = nodeIdOfText(container, text);
    if (id === null) await tick(50);
  }
  if (id === null) {
    const dump = nodeIds(container).map(
      (n) => `${n}:${container.querySelector(`g[data-node-id="${n}"]`)?.textContent ?? ''}`,
    );
    throw new Error(`节点「${text}」缺失；节点=${JSON.stringify(dump)}`);
  }
  return id;
}

/** 等大纲行出现，返回其 id */
async function waitForRow(container: HTMLElement, text: string): Promise<string> {
  let id: string | null = null;
  for (let i = 0; i < 60 && id === null; i++) {
    id = frameRowIdOfText(container, text);
    if (id === null) await tick(50);
  }
  if (id === null) {
    const dump = Array.from(container.querySelectorAll('[data-frame-row]')).map((el) =>
      el.querySelector('[data-frame-row-text]')?.textContent,
    );
    throw new Error(`大纲行「${text}」缺失；行=${JSON.stringify(dump)}`);
  }
  return id;
}

/** 文档栏「保存」→ 等一拍 */
async function saveDoc(container: HTMLElement): Promise<void> {
  const saveBtn = Array.from(container.querySelectorAll('span')).find(
    (s) => (s.textContent ?? '') === '保存',
  );
  if (saveBtn === undefined) throw new Error('文档栏「保存」按钮缺失');
  fireEvent.click(saveBtn);
  await tick(80);
}

/** 库中该文档的 source（严格提取；JSON 解析结果不可信，不写裸断言） */
function libSourceOf(id: string): string {
  const parsed: unknown = JSON.parse(localStorage.getItem(LIB_KEY) ?? '[]');
  if (!Array.isArray(parsed)) return '';
  for (const e of parsed) {
    const holder = Object(e);
    if (Reflect.get(holder, 'id') === id) {
      const s: unknown = Reflect.get(holder, 'source');
      return typeof s === 'string' ? s : '';
    }
  }
  return '';
}

/** source → 可编辑树（重解析：等价于「重开文档」的数据侧） */
function editableOf(source: string): EditableNode {
  const ast = parseMm(source).root;
  if (ast === null) throw new Error('夹具错误：source 解析失败');
  const editable = astToEditable(ast);
  if (editable === null) throw new Error('夹具错误：AST → 可编辑树失败');
  return editable;
}

function findNodeWithText(root: EditableNode, text: string): EditableNode | null {
  if ((root.text ?? '') === text) return root;
  for (const c of root.children) {
    const hit = findNodeWithText(c, text);
    if (hit !== null) return hit;
  }
  return null;
}

/** 树内按精确文本找节点（缺 → 抛） */
function nodeWithText(root: EditableNode, text: string): EditableNode {
  return must(findNodeWithText(root, text), `树内节点「${text}」`);
}

/** 打开夹具文档并等根 / A 出现 */
async function openFixture(container: HTMLElement): Promise<{ rootId: string; aId: string }> {
  await openDoc(container, DOC_NAME);
  const rootId = await waitForNode(container, '根');
  const aId = await waitForNode(container, 'A');
  return { rootId, aId };
}

/** 走右键菜单成框（一期菜单固定默认深度 2） */
async function frameViaMenu(container: HTMLElement, id: string): Promise<void> {
  rightClickNode(container, id);
  await waitFor(() => expect(container.querySelector('[data-context-menu]')).not.toBeNull());
  fireEvent.click(menuItem(container, '成框编辑…'));
  await waitFor(() => expect(container.querySelector('[data-frame-shell]')).not.toBeNull());
}

/** 右键打开菜单（等菜单渲染） */
async function openMenuAt(container: HTMLElement, at: { sx: number; sy: number }): Promise<void> {
  closeMenu(container);
  await tick(30);
  rightClickVia(container, at);
  await waitFor(() => expect(container.querySelector('[data-context-menu]')).not.toBeNull());
}

/**
 * 成框后该节点**不再有画布节点卡**（行由 FrameOutline 承载）→ 其右键菜单改从**表头行**进。
 * 行是 HTML 浮层，按自身 inline 几何换算屏幕坐标（非世界盒）。
 */
async function openFrameRootMenu(container: HTMLElement, label: string): Promise<void> {
  const rowId = await waitForRow(container, label);
  await openMenuAt(container, frameRowClient(container, rowId));
}

describe('FO-B3 子树框编辑端到端', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      setTimeout(() => cb(0), 16) as unknown as number,
    );
    vi.stubGlobal('cancelAnimationFrame', (h: number) => {
      clearTimeout(h);
    });
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    localStorage.setItem(
      LIB_KEY,
      JSON.stringify([
        { id: DOC_ID, name: DOC_NAME, source: DOC_SOURCE, ts: Date.now(), tags: [] },
        { id: OTHER_ID, name: OTHER_NAME, source: OTHER_SOURCE, ts: Date.now(), tags: [] },
      ]),
    );
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks(); // FO-UI1：§9.4 的 prompt spy（unstubAllGlobals 不管 spyOn）
  });

  it('§9.1 成框 → 保存源含 frame/depth → 切文档往返（重解析）仍在且框壳可见', async () => {
    const { container } = render(<MindmapStage />);
    const { aId } = await openFixture(container);

    await frameViaMenu(container, aId);
    // 默认深度 2 → 整棵（A / A1 / A2）进大纲 = 3 行
    expect(container.querySelectorAll('[data-frame-row]').length).toBe(3);

    await saveDoc(container);
    await waitFor(() => expect(libSourceOf(DOC_ID)).toContain('frame'));
    const saved = editableOf(libSourceOf(DOC_ID));
    expect(frameOf(nodeWithText(saved, 'A').note)).toEqual({ version: 1, depth: 2 });

    // 切走再切回：文档经 parseMm 重解析、Stage 重挂 → 框仍在（§9.1 全链）
    await openDoc(container, OTHER_NAME);
    await waitFor(() => expect(container.querySelector('[data-frame-shell]')).toBeNull());
    await openFixture(container);
    await waitFor(() => expect(container.querySelector('[data-frame-shell]')).not.toBeNull());
    expect(await waitForRow(container, 'A2')).not.toBe('');
  });

  it('§9.2 拆框 → frame 键删除；幕布字段（desc）仍在', async () => {
    const { container } = render(<MindmapStage />);
    const { aId } = await openFixture(container);
    await frameViaMenu(container, aId);

    await saveDoc(container);
    await waitFor(() =>
      expect(frameOf(nodeWithText(editableOf(libSourceOf(DOC_ID)), 'A').note)).toBeDefined(),
    );

    // 已成框 → 菜单出现「拆框」入口（A3 三态）；成框后该节点无节点卡 → 从表头行进菜单
    await openFrameRootMenu(container, 'A');
    expect(hasMenuItem(container, '拆框')).toBe(true);
    fireEvent.click(menuItem(container, '拆框'));
    await waitFor(() => expect(container.querySelector('[data-frame-shell]')).toBeNull());

    await saveDoc(container);
    await waitFor(() => expect(libSourceOf(DOC_ID)).not.toContain('frame'));
    const saved = nodeWithText(editableOf(libSourceOf(DOC_ID)), 'A');
    expect(frameOf(saved.note)).toBeUndefined();
    expect(saved.note?.desc).toBe('幕布说明'); // 拆框只删 frame 键（§4.2）
  });

  it('§9.4 祖先 depth=1：大纲层子节点无成框入口；挂载层孙可成框且落盘', async () => {
    // FO-UI1：「改框深度…」走画布内数值步进气泡（原生 prompt 已退役——webview 静默吞掉；
    // 这里把 prompt 换成会抛错的 spy，生产路径只要碰它就失败）
    const promptSpy = vi.spyOn(window, 'prompt').mockImplementation(() => {
      throw new Error('native prompt() 被调用');
    });
    const { container } = render(<MindmapStage />);
    const { aId } = await openFixture(container);
    await frameViaMenu(container, aId);

    await openFrameRootMenu(container, 'A');
    fireEvent.click(menuItem(container, '改框深度…'));
    await waitFor(() => expect(container.querySelector('[data-frame-depth-input]')).not.toBeNull());
    const depthInput = container.querySelector('[data-frame-depth-input]') as HTMLInputElement;
    expect(promptSpy).not.toHaveBeenCalled();
    fireEvent.change(depthInput, { target: { value: '1' } });
    fireEvent.keyDown(depthInput, { key: 'Enter' });
    await tick(80);
    // 深度 1 → A1 留在大纲（行），A2 起回画布（挂载层）
    const a1Row = await waitForRow(container, 'A1');
    const a2Id = await waitForNode(container, 'A2');

    // 大纲层内（A1）→ 无「成框编辑…」入口（设计 §3.3 一期拒绝）
    await openMenuAt(container, frameRowClient(container, a1Row));
    expect(hasMenuItem(container, '成框编辑…')).toBe(false);
    closeMenu(container);
    await tick(40);

    // 挂载层（A2，相对 A 深度 2 > 1）→ 有入口且成功
    await openMenuAt(container, toClient(container, must(centerOf(container, a2Id), 'A2 位置')));
    expect(hasMenuItem(container, '成框编辑…')).toBe(true);
    fireEvent.click(menuItem(container, '成框编辑…'));
    await tick(80);

    await saveDoc(container);
    await waitFor(() => expect(libSourceOf(DOC_ID)).toContain('frame'));
    const saved = editableOf(libSourceOf(DOC_ID));
    expect(frameOf(nodeWithText(saved, 'A').note)).toEqual({ version: 1, depth: 1 });
    expect(frameOf(nodeWithText(saved, 'A2').note)).toEqual({ version: 1, depth: 1 }); // 钳到子树高度 1
    expect(frameOf(nodeWithText(saved, 'A1').note)).toBeUndefined();
  });

  it('FO-UI1 气泡提交进同一撤销栈：Ctrl+Z 回旧深度（框内大纲随之回退）', async () => {
    const { container } = render(<MindmapStage />);
    const { aId } = await openFixture(container);
    await frameViaMenu(container, aId); // 默认 depth 2 → A / A1 / A2 三行
    expect(container.querySelectorAll('[data-frame-row]').length).toBe(3);

    // 气泡把 depth 改到 1 → A2 出大纲（回画布层）
    await openFrameRootMenu(container, 'A');
    fireEvent.click(menuItem(container, '改框深度…'));
    await waitFor(() => expect(container.querySelector('[data-frame-depth-input]')).not.toBeNull());
    const input = container.querySelector('[data-frame-depth-input]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await tick(80);
    expect(container.querySelectorAll('[data-frame-row]').length).toBe(2); // A / A1

    // 与节点编辑同一 Ctrl+Z（全局键位 → controller.undo）→ 回 depth 2
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await tick(80);
    expect(container.querySelectorAll('[data-frame-row]').length).toBe(3);
  });

  it('FO-UI1 气泡消费键盘：焦点不在输入框时 Enter 也提交（不建同级）；关闭后画布键位恢复', async () => {
    const { container } = render(<MindmapStage />);
    const { aId } = await openFixture(container);
    await frameViaMenu(container, aId); // depth 2 → A/A1/A2 三行

    // ① 打开气泡后**不点输入框**（焦点掉回画布 = 右键菜单卸载后的实测现场）直接 Enter
    await openFrameRootMenu(container, 'A');
    fireEvent.click(menuItem(container, '改框深度…'));
    await waitFor(() => expect(container.querySelector('[data-frame-depth-input]')).not.toBeNull());
    const input = container.querySelector('[data-frame-depth-input]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1' } });
    input.blur();
    fireEvent.keyDown(window, { key: 'Enter' });
    await tick(80);
    expect(container.querySelectorAll('[data-frame-row]').length).toBe(2); // depth=1 已落盘：A/A1
    expect(container.querySelector('[data-frame-depth-bubble]')).toBeNull(); // 气泡已关

    // 落盘证据走源文（画布 `g[data-node-id]` 会被渲染层重复输出，计数不可靠）
    await saveDoc(container);
    const afterCommit = editableOf(libSourceOf(DOC_ID));
    expect(frameOf(nodeWithText(afterCommit, 'A').note)).toEqual({ version: 1, depth: 1 });
    expect(nodeWithText(afterCommit, '根').children.length).toBe(1); // 画布 Enter=建同级**没**被触发

    // ② 关闭后画布键位恢复：右键 A2（depth=1 后已回画布层）→ 选中 → 关菜单 → Enter 建同级
    const a2Id = await waitForNode(container, 'A2');
    rightClickNode(container, a2Id);
    await waitFor(() => expect(container.querySelector('[data-context-menu]')).not.toBeNull());
    closeMenu(container);
    await tick(40);
    fireEvent.keyDown(window, { key: 'Enter' });
    await tick(80);
    await saveDoc(container);
    // A2 的父是 A1：多出一个同级 → capture 监听随气泡卸载解除，不是全局禁令
    expect(nodeWithText(editableOf(libSourceOf(DOC_ID)), 'A1').children.length).toBe(2);
  });

  it('§9.3 大纲行双击改 text → 拆框后节点 text 保留（同一棵 children 树）', async () => {
    const { container } = render(<MindmapStage />);
    const { aId } = await openFixture(container);
    await frameViaMenu(container, aId);

    const a1Id = await waitForRow(container, 'A1');
    // 双击行 → 既有内联编辑入口（B2 接线：onEditStart → controller.startEdit）
    fireEvent.doubleClick(frameRowOf(container, a1Id));
    const input = await waitForInlineEditor(container, 'A1');
    fireEvent.change(input, { target: { value: 'A1 改' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(frameRowOf(container, a1Id).querySelector('[data-frame-row-text]')?.textContent).toBe(
        'A1 改',
      ),
    );
    await saveDoc(container);
    await waitFor(() => expect(libSourceOf(DOC_ID)).toContain('A1 改'));

    // 拆框 → 节点回画布卡；text 保留（全保真：编辑器改的就是同一批 EditableNode）
    await openFrameRootMenu(container, 'A');
    fireEvent.click(menuItem(container, '拆框'));
    await tick(80);
    await saveDoc(container);
    await waitFor(() => expect(libSourceOf(DOC_ID)).not.toContain('frame'));
    const saved = editableOf(libSourceOf(DOC_ID));
    expect(nodeWithText(saved, 'A1 改').text).toBe('A1 改');
    expect(frameOf(nodeWithText(saved, 'A').note)).toBeUndefined();
    expect(nodeWithText(saved, 'A').note?.desc).toBe('幕布说明');
  });
});

/**
 * 等内联编辑控件（初值 = 节点文本；OverlayEditor 无专属 data 属性，按 value 认领）。
 *
 * FO-C1 起**框内大纲行**用换行 `<textarea data-overlay-editor="wrap">`（宽度 = 行盒宽、
 * 高度随内容），画布节点卡仍是单行 `<input>` —— 两者都认，避免把「换行编辑」误判成
 * 「编辑未进入」（本 helper 只按 value 找，不看控件类型）。
 */
async function waitForInlineEditor(
  container: HTMLElement,
  initial: string,
): Promise<HTMLInputElement | HTMLTextAreaElement> {
  let hit: HTMLInputElement | HTMLTextAreaElement | null = null;
  for (let i = 0; i < 60 && hit === null; i++) {
    for (const el of container.querySelectorAll('input, textarea')) {
      const value =
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : null;
      if (value === initial) {
        hit = el as HTMLInputElement | HTMLTextAreaElement;
        break;
      }
    }
    if (hit === null) await tick(30);
  }
  if (hit === null) {
    const values = Array.from(container.querySelectorAll('input, textarea')).map(
      (el) => (el as HTMLInputElement | HTMLTextAreaElement).value,
    );
    throw new Error(
      `内联编辑控件未出现（期望初值「${initial}」）；现有=${JSON.stringify(values)}`,
    );
  }
  return hit;
}
