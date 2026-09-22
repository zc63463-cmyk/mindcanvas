// @vitest-environment jsdom
/**
 * S2 · 摘要两跳 **真实挂载**端到端（R3-(b)：这一份才是「生产接线」的证据）。
 *
 * 与 `summary-two-hop.test.tsx` 的分工（任务书明确要求区分）：
 * - `summary-two-hop.test.tsx` = **辅助模型证据**：驱动生产与测试共同消费的
 *   `useSummaryHop`，覆盖状态机矩阵；它**不挂载 `MindmapStage`**。
 * - 本文件 = **生产组件证据**：`render(<MindmapStage />)` 真挂载，链路全部走真实 UI 与
 *   真实命中/派发 —— 启动页 →「最近」打开文档 → **真实画布节点卡右键 →「创建摘要…」**
 *   → **真实指针点击（pointerdown/up）命中末成员** → 树里真的多出摘要节点。
 *
 * 为什么必须真挂载：此前那份测试自述「驱动与 `MindmapStage` 逐字同序的首判链」——
 * 是**复制体**。生产端把首判删掉 / 顺序挪动，复制体一律照绿。本文件里 `onNodeClick`
 * 的首判、菜单装配（`makeSummaryActions`）、草稿闸门、创建后的 `controller.select`、
 * 文档替换令牌全部是**被挂载组件自己的代码路径**。
 *
 * 为什么要渲染期观测口（`window.__mindcanvasSummaryHost`）：真实渲染的节点 id 由
 * `astToEditable` 每次解析重新生成（见 `MindmapStage.tsx` 的 `pinnedNotePaths` 注释），
 * 测试无法预知；节点卡的文本是唯一稳定的输入，id 必须从**已挂载实例**读回来。
 * 观测口只暴露同一批对象引用，不改变任何生产行为（见 `MindmapStage.tsx` 该处注释）。
 *
 * 设施比照 `frame-outline-host.test.tsx`：jsdom 无尺寸（世界变换≈恒等，工具已做变换
 * 感知）；canvas 套件 `pretendToBeVisual:false`（无 rAF）→ 需补桩；另补 ResizeObserver
 * 尺寸桩（视口过小会让 LOD 省文本 + 裁剪掉节点）。
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveSummaries, summaryOf, type EditableNode } from '@mindcanvas/kernel';
import type { MindDoc } from '@mindcanvas/react';
import MindmapStage from '../src/MindmapStage';

const LIB_KEY = 'mindcanvas.library.v1';
const DOC_ID = 'e2e-summary';
const DOC_NAME = 'e2e-summary.mm.md';
const OTHER_ID = 'e2e-summary-other';
const OTHER_NAME = 'e2e-summary-other.mm.md';

/** 夹具文档：根 → A B C D（摘要范围的自然候选）；A 下有 F（跨父用） */
const DOC_SOURCE = ['# 根', '', '## A', '', '### F', '', '## B', '', '## C', '', '## D', ''].join(
  '\n',
);

/** 另一份文档：**同内容**（R2 的「同内容替换也要失效」判据需要它） */
const SAME_SOURCE = DOC_SOURCE;

/** 待替换到的第三份文档：更小，节点文本不同 */
const THIRD_ID = 'e2e-summary-third';
const THIRD_NAME = 'e2e-summary-third.mm.md';
const THIRD_SOURCE = ['# 根', '', '## 甲', '', '## 乙', ''].join('\n');

const tick = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 渲染期观测口（`MindmapStage.tsx` 内写入；类型见 `src/vite-env.d.ts` 的全局声明）。
 *
 * 句柄按**只读观测 / 操作入口**分两类（`observe` / `actions`）。测试侧用下面两个
 * 取用器摊平，少写前缀；摊平不改变两类语义——`o.*` 是纯读，`a.*` 会改文档状态，
 * 但走的仍是真实生产路径（`applyDoc` / `controller.undo|redo`），不是旁路。
 */
type SummaryHost = NonNullable<Window['__mindcanvasSummaryHost']>;

function host(): SummaryHost | null {
  return window.__mindcanvasSummaryHost ?? null;
}

function mustHost(): SummaryHost {
  const h = host();
  if (h === null) throw new Error('摘要观测口缺失：MindmapStage 未挂载到可渲染态');
  return h;
}

/** 只读观测视图（纯快照与只读事实） */
function o(): SummaryHost['observe'] {
  return mustHost().observe;
}

/** 操作入口视图（改状态，但走真实生产路径） */
function a(): SummaryHost['actions'] {
  return mustHost().actions;
}

/** 尺寸桩：jsdom 无布局引擎（容器恒 0×0）→ 补「观察即报尺寸」，让 LOD 与裁剪接近真实 */
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

function nodeIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('g[data-node-id]')).map(
    (g) => g.getAttribute('data-node-id') ?? '',
  );
}

/** 按**精确文本**找画布节点卡 id（文本是夹具里唯一稳定的输入） */
function nodeIdOfText(container: HTMLElement, text: string): string | null {
  for (const id of nodeIds(container)) {
    const g = container.querySelector(`g[data-node-id="${id}"]`);
    if ((g?.textContent ?? '') === text) return id;
  }
  return null;
}

/** 节点 g 的**世界**中心 */
function centerOf(container: HTMLElement, id: string): { cx: number; cy: number } {
  const g = container.querySelector(`g[data-node-id="${id}"]`);
  if (!g) throw new Error(`缺少节点卡：${id}`);
  const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(g.getAttribute('transform') ?? '');
  const r = g.querySelector('rect');
  if (!m || !r) throw new Error(`节点 ${id} 无盒（transform/rect 缺失）`);
  return {
    cx: Number(m[1]) + Number(r.getAttribute('width') ?? 0) / 2,
    cy: Number(m[2]) + Number(r.getAttribute('height') ?? 0) / 2,
  };
}

/** 世界→屏幕变换（fit/缩放后非恒等；缺省按恒等） */
function worldTransformOf(container: HTMLElement): { tx: number; ty: number; k: number } {
  const svg = container.querySelector('g[data-node-id]')?.closest('svg') ?? null;
  const g = svg === null ? null : (Array.from(svg.children).find((el) => el.tagName === 'g') ?? null);
  const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\)\s*scale\(\s*(-?[\d.]+)/.exec(
    g?.getAttribute('transform') ?? '',
  );
  if (m === null) return { tx: 0, ty: 0, k: 1 };
  return { tx: Number(m[1]), ty: Number(m[2]), k: Number(m[3]) };
}

/** 画布手势层（事件入口，真实 MapView 的 `touch-action: none` div） */
function wheelOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector('div[style*="touch-action"]');
  if (!(el instanceof HTMLElement)) throw new Error('缺少：画布手势层');
  return el;
}

/** 世界点 → 屏幕坐标 */
function toClient(container: HTMLElement, world: { cx: number; cy: number }): {
  sx: number;
  sy: number;
} {
  const { tx, ty, k } = worldTransformOf(container);
  return { sx: world.cx * k + tx, sy: world.cy * k + ty };
}

/** 真实点击派发：pointerdown + pointerup（MapView 的点击分支在 pointerup） */
function pointerClickAt(container: HTMLElement, at: { sx: number; sy: number }): void {
  const wheel = wheelOf(container);
  fireEvent.pointerDown(wheel, { clientX: at.sx, clientY: at.sy, pointerId: 1, bubbles: true });
  fireEvent.pointerUp(wheel, { clientX: at.sx, clientY: at.sy, pointerId: 1, bubbles: true });
}

/** 真实点击画布节点卡（按 id） */
function clickNodeById(container: HTMLElement, id: string): void {
  pointerClickAt(container, toClient(container, centerOf(container, id)));
}

/** 真实右键画布节点卡（MapView 的 onContextMenu → 命中检测） */
function rightClickNodeById(container: HTMLElement, id: string): void {
  const at = toClient(container, centerOf(container, id));
  fireEvent.contextMenu(wheelOf(container), { clientX: at.sx, clientY: at.sy, bubbles: true });
}

/**
 * 菜单项标签：`textContent` 会带上 hint（如 `编辑F2`）/ 子页箭头（`…›`）后缀，
 * 故按「前缀匹配 + 剩余部分只含 hint」判定，而不是整串相等。
 */
function labelOf(el: Element): string {
  return (el.textContent ?? '').trim();
}

function menuItem(container: HTMLElement, label: string): HTMLElement {
  for (const el of container.querySelectorAll('[data-menu-item]')) {
    if (labelOf(el).startsWith(label)) {
      if (!(el instanceof HTMLElement)) throw new Error(`菜单项「${label}」非 HTMLElement`);
      return el;
    }
  }
  const labels = Array.from(container.querySelectorAll('[data-menu-item]')).map(labelOf);
  throw new Error(`缺少菜单项：「${label}」；现有=${JSON.stringify(labels)}`);
}

function hasMenuItem(container: HTMLElement, label: string): boolean {
  return Array.from(container.querySelectorAll('[data-menu-item]')).some((el) =>
    labelOf(el).startsWith(label),
  );
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

/** 等某文本的节点卡出现，返回其 id */
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

/** 启动页 →「看内置示例」进入应用；再经「最近」菜单打开指定文档（走 applyDoc + reset） */
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

/** 打开菜单 → 点「创建摘要…」（第一跳，走真实 bag 闭包） */
async function startSummaryViaMenu(container: HTMLElement, nodeId: string): Promise<void> {
  rightClickNodeById(container, nodeId);
  await waitFor(() => expect(container.querySelector('[data-context-menu]')).not.toBeNull());
  expect(hasMenuItem(container, '创建摘要…')).toBe(true);
  fireEvent.click(menuItem(container, '创建摘要…'));
  await tick(60); // 菜单卸载一帧
}

/** 真实画布：无摘要节点时为零 */
function summaryCount(): number {
  return resolveSummaries(o().root).length;
}

/** 打开夹具文档并等根 / A 出现，返回节点 id 表 */
interface FixtureIds {
  rootId: string;
  aId: string;
  bId: string;
  cId: string;
}

async function openFixture(container: HTMLElement, name = DOC_NAME): Promise<FixtureIds> {
  await openDoc(container, name);
  return {
    rootId: await waitForNode(container, '根'),
    aId: await waitForNode(container, 'A'),
    bId: await waitForNode(container, 'B'),
    cId: await waitForNode(container, 'C'),
  };
}

describe('S2 摘要两跳 · 真实挂载 MindmapStage 端到端', () => {
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
        { id: OTHER_ID, name: OTHER_NAME, source: SAME_SOURCE, ts: Date.now(), tags: [] },
        { id: THIRD_ID, name: THIRD_NAME, source: THIRD_SOURCE, ts: Date.now() - 1000, tags: [] },
      ]),
    );
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    // 观测口必须在每次渲染后清干净（否则下一条用例读到上一条的 controller）
    delete window.__mindcanvasSummaryHost;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('① 真实右键入口 → 第二跳点末成员 → 建摘要并选中新摘要节点', async () => {
    const { container } = render(<MindmapStage />);
    const ids = await openFixture(container);

    await startSummaryViaMenu(container, ids.aId);
    // 第一跳后草稿已登记（真实 hook 状态）
    expect(o().hasDraft()).toBe(true);

    // 第二跳：真实指针点击末成员 C
    clickNodeById(container, ids.cId);
    await tick(60);

    const controller = { root: o().root, selectedId: o().selectedId };
    const resolved = resolveSummaries(controller.root);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.state).toBe('well-formed');
    // 成员 = A B C（真实创建结果）
    const texts = (resolved[0]?.memberIds ?? []).map((id) => textOf(controller.root, id));
    expect(texts).toEqual(['A', 'B', 'C']);
    // 选中新摘要节点（生产 onNodeClick 首判里的 controller.select(res.summaryId)）
    expect(controller.selectedId).toBe(resolved[0]?.summaryNodeId);
    // 草稿已消费
    expect(o().hasDraft()).toBe(false);
    // 摘要节点真实渲染进画布
    await waitFor(() =>
      expect(nodeIdOfText(container, '摘要')).toBe(resolved[0]?.summaryNodeId ?? null),
    );
  });

  /**
   * 产品语义校正（R2/R3 本轮）：点回起点 = **单成员摘要**（设计稿 §4.5 合法）。
   *
   * 走**真实挂载**路径：同一张节点卡点两次（第二次即第二跳），必须真的建出
   * 一条 well-formed、成员恰为该节点的摘要，且选中它。
   * 此前 S2 的「始终拒绝」是新增限制，会把 R1 的数据层缺陷用 UI 拒绝掩盖。
   */
  it('①b 点回起点 → 建单成员摘要（真实挂载；well-formed，成员恰为该节点）', async () => {
    const { container } = render(<MindmapStage />);
    const ids = await openFixture(container);

    await startSummaryViaMenu(container, ids.bId);
    expect(o().hasDraft()).toBe(true);

    // 第二跳 = 点回**起点自己**（同一张卡）
    clickNodeById(container, ids.bId);
    await tick(60);

    const controller = { root: o().root, selectedId: o().selectedId };
    const resolved = resolveSummaries(controller.root);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.state).toBe('well-formed');
    expect(resolved[0]?.memberIds).toEqual([ids.bId]);
    expect(controller.selectedId).toBe(resolved[0]?.summaryNodeId);
    expect(o().hasDraft()).toBe(false);
    // 摘要节点真实渲染进画布
    await waitFor(() =>
      expect(nodeIdOfText(container, '摘要')).toBe(resolved[0]?.summaryNodeId ?? null),
    );
  });

  it('② 同 tick 重复点击只创建一次（真实派发的两次点击）', async () => {
    const { container } = render(<MindmapStage />);
    const ids = await openFixture(container);
    await startSummaryViaMenu(container, ids.aId);

    // 两次 pointerup 紧邻（同一事件循环批次）：闸门必须是**同步**真理源
    const at = toClient(container, centerOf(container, ids.bId));
    pointerClickAt(container, at);
    pointerClickAt(container, at);
    await tick(60);

    expect(summaryCount()).toBe(1);
  });

  it('③ 非法第二跳（跨父）保留草稿并给提示；随后合法点击仍能完成', async () => {
    const { container } = render(<MindmapStage />);
    const ids = await openFixture(container);
    const fId = await waitForNode(container, 'F'); // A 的子节点 → 与 A 不同父

    await startSummaryViaMenu(container, ids.aId);
    clickNodeById(container, fId); // 跨父 → 拒绝
    await tick(60);

    expect(summaryCount()).toBe(0);
    expect(o().hasDraft()).toBe(true); // 草稿保留
    expect(noticeText(container)).toContain('创建摘要未完成');

    // 草稿还在 → 合法点击仍能完成
    clickNodeById(container, ids.cId);
    await tick(60);
    expect(summaryCount()).toBe(1);
    expect(o().hasDraft()).toBe(false);
  });

  it('④ Esc 清草稿：之后点击退化为普通选择，不建摘要', async () => {
    const { container } = render(<MindmapStage />);
    const ids = await openFixture(container);
    await startSummaryViaMenu(container, ids.aId);
    expect(o().hasDraft()).toBe(true);

    fireEvent.keyDown(window, { key: 'Escape' });
    await tick(40);
    expect(o().hasDraft()).toBe(false);

    clickNodeById(container, ids.cId);
    await tick(60);
    expect(summaryCount()).toBe(0);
    expect(o().selectedId).toBe(ids.cId); // 点击正常选择
  });

  it('⑤ 点空白清草稿：之后点击退化为普通选择，不建摘要', async () => {
    const { container } = render(<MindmapStage />);
    const ids = await openFixture(container);
    await startSummaryViaMenu(container, ids.aId);
    expect(o().hasDraft()).toBe(true);

    // 真实空白点击：世界坐标远在节点之外（手势层的命中检测自然落空）
    pointerClickAt(container, { sx: 4000, sy: 4000 });
    await tick(40);
    expect(o().hasDraft()).toBe(false);
    expect(o().selectedId).toBeNull();

    clickNodeById(container, ids.cId);
    await tick(60);
    expect(summaryCount()).toBe(0);
    expect(o().selectedId).toBe(ids.cId);
  });

  it('⑥ 文档替换清草稿：B 的第一次点击正常选择，不建摘要（R2 判别）', async () => {
    const { container } = render(<MindmapStage />);
    const ids = await openFixture(container);

    await startSummaryViaMenu(container, ids.aId);
    expect(o().hasDraft()).toBe(true);

    // 真实文档替换（「最近」→ 另一份文档：走 applyDoc → useDocumentSwitch reset）
    await openDoc(container, THIRD_NAME);
    await waitForNode(container, '甲');
    expect(o().hasDraft()).toBe(false); // 草稿随替换失效

    const jiaId = await waitForNode(container, '甲');
    clickNodeById(container, jiaId);
    await tick(60);
    // 第一次点击正常选择（旧实现下被旧草稿吞掉）
    expect(o().selectedId).toBe(jiaId);
    expect(summaryCount()).toBe(0);
  });

  it('⑦ 同内容文档替换也清草稿（不得靠内容比较）', async () => {
    const { container } = render(<MindmapStage />);
    const ids = await openFixture(container);
    await startSummaryViaMenu(container, ids.aId);
    expect(o().hasDraft()).toBe(true);
    const tokenBefore = o().documentToken;

    // **同内容替换**：新文档的 source 与当前文档逐字相同（重开同一文件的形态）。
    // 若判据是「内容比较」（source / 树快照），这次替换会被漏掉。
    const sameContent: MindDoc = {
      id: 'e2e-summary-reopen',
      name: 'e2e-summary-reopen.mm.md',
      source: DOC_SOURCE,
      saved: true,
      ts: Date.now(),
    };
    await a().replaceDoc(sameContent);
    // 文档身份确实换了（文件名变了）——这是「替换」而不是「保存回填」
    await waitFor(() =>
      expect(container.querySelector('[data-doc-name]')?.textContent).toContain('e2e-summary-reopen'),
    );

    // 判据是「替换事件」而不是内容
    expect(o().documentToken).not.toBe(tokenBefore);
    expect(o().hasDraft()).toBe(false);

    const reopenedC = await waitForNode(container, 'C');
    clickNodeById(container, reopenedC);
    await tick(60);
    expect(o().selectedId).toBe(reopenedC);
    expect(summaryCount()).toBe(0);
  });

  it('⑧ 普通编辑 / 保存 / 另存为不得被误判为文档替换', async () => {
    // 另存为必须**实际执行**（选择器替身 + 真实写入路径），不能只看令牌：
    // 此前本用例名带「另存为」但正文只驱动了编辑与保存，是名实不符（复核指出）。
    const picker = installSavePicker();
    const { container } = render(<MindmapStage />);
    const ids = await openFixture(container);
    const tokenAtOpen = o().documentToken;

    // 编辑：菜单「编辑」（真实进入内联编辑态；本用例只关心令牌不推进）
    rightClickNodeById(container, ids.bId);
    await waitFor(() => expect(container.querySelector('[data-context-menu]')).not.toBeNull());
    fireEvent.click(menuItem(container, '编辑'));
    await tick(80);
    expect(o().documentToken).toBe(tokenAtOpen);

    // 保存：文档栏「保存」（真实 session.submit 路径）。
    // 该文档无 handle → 按 `LocalDocHost.save` 的既有语义也走选择器（先选路径再写盘）。
    const callsBeforeSave = picker.calls;
    fireEvent.click(docBarBtn(container, '保存'));
    await tick(150);
    expect(picker.calls).toBe(callsBeforeSave + 1); // 保存确实完成了写盘链路
    expect(o().documentToken).toBe(tokenAtOpen); // 保存不推进令牌

    // 另存为：文档栏「另存为」→ 选择器替身 → 真实写入（换目的地，但**不换文档身份**）
    const callsBeforeSaveAs = picker.calls;
    const writtenBeforeSaveAs = picker.written.length;
    fireEvent.click(docBarBtn(container, '另存为'));
    await tick(200);
    expect(picker.calls).toBe(callsBeforeSaveAs + 1); // 另存为确实唤起选择器
    expect(picker.written.length).toBe(writtenBeforeSaveAs + 1); // 且确实走过写入
    expect(picker.written[picker.written.length - 1]).toContain('# 根'); // 写的是当前树
    expect(o().documentToken).toBe(tokenAtOpen); // 另存为不推进令牌

    // 草稿跨越三种动作**仍然有效**（没有被误清）
    await startSummaryViaMenu(container, ids.aId);
    expect(o().hasDraft()).toBe(true);
    expect(o().documentToken).toBe(tokenAtOpen);
    clickNodeById(container, ids.cId);
    await tick(60);
    expect(summaryCount()).toBe(1);
  });

  it('⑨ 无草稿时既有 Shift 连线路径不受影响（真实节点点击）', async () => {
    const { container } = render(<MindmapStage />);
    const ids = await openFixture(container);

    // 先选中 A（真实点击）
    clickNodeById(container, ids.aId);
    await tick(50);
    expect(o().selectedId).toBe(ids.aId);

    // Shift+点 B：无草稿 → 走既有路径（此处只断言「没有变成摘要」＋「选中跟随」，
    // 连边本身需关系模式，属既有 E8 契约、不在本用例范围）
    const at = toClient(container, centerOf(container, ids.bId));
    const wheel = wheelOf(container);
    fireEvent.pointerDown(wheel, { clientX: at.sx, clientY: at.sy, pointerId: 1, shiftKey: true, bubbles: true });
    fireEvent.pointerUp(wheel, { clientX: at.sx, clientY: at.sy, pointerId: 1, shiftKey: true, bubbles: true });
    await tick(60);

    expect(summaryCount()).toBe(0);
    expect(o().selectedId).toBe(ids.bId);
  });

  it('⑩ 真实 UI 路径的一次 Undo 撤销完整创建（树 + cid 逐位回原）', async () => {
    const { container } = render(<MindmapStage />);
    const ids = await openFixture(container);

    const before = serializeSnapshot(o().root);
    await startSummaryViaMenu(container, ids.aId);
    clickNodeById(container, ids.cId);
    await tick(60);
    expect(summaryCount()).toBe(1);
    const afterCreate = serializeSnapshot(o().root);
    expect(afterCreate).not.toBe(before);

    // 真实键位 Ctrl+Z → 全局键位处理 → controller.undo
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await tick(80);
    expect(summaryCount()).toBe(0);
    expect(serializeSnapshot(o().root)).toBe(before);
    // 撤销后重做仍回到创建态（同一事务）
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
    await tick(80);
    expect(serializeSnapshot(o().root)).toBe(afterCreate);
  });
/* ───────── R2 收口：草稿跨「编辑 / 保存 / 另存为」必须存活 ───────── */

/**
 * 保存 / 另存为**必须实际跑通**（任务书要求），不能只看令牌或读源码。
 *
 * 另存为会唤起选择器：这里装一个 `showSaveFilePicker` 替身（返回一个**真的**可写
 * 句柄），并记录写盘内容 —— 于是「另存为确实执行了」有写入路径证据，
 * 而不是"函数被调用过"这种自证。
 */
interface PickerStub {
  /** 每次另存为的写入内容（按调用顺序） */
  written: string[];
  /** 选择器被调用次数 */
  calls: number;
}

function installSavePicker(): PickerStub {
  const stub: PickerStub = { written: [], calls: 0 };
  vi.stubGlobal('showSaveFilePicker', async (opts?: { suggestedName?: string }) => {
    stub.calls += 1;
    const name = opts?.suggestedName ?? 'untitled.mm.md';
    return {
      name,
      kind: 'file',
      createWritable: async () => ({
        write: async (text: string) => {
          stub.written.push(text);
        },
        close: async () => undefined,
      }),
      getFile: async () => new File([], name),
    };
  });
  return stub;
}

/** 文档栏按钮（`DocBtn` 渲染为 span） */
function docBarBtn(container: HTMLElement, label: string): HTMLElement {
  const el = Array.from(container.querySelectorAll('span')).find(
    (sp) => (sp.textContent ?? '').trim() === label,
  );
  if (!(el instanceof HTMLElement)) {
    const labels = Array.from(container.querySelectorAll('span'))
      .map((sp) => (sp.textContent ?? '').trim())
      .filter((t) => t.length > 0 && t.length < 8);
    throw new Error(`缺少文档栏按钮「${label}」；现有=${JSON.stringify(labels.slice(0, 20))}`);
  }
  return el;
}

describe('R2 收口 · 草稿跨保存存活（真实宿主动作）', () => {
  it('⑪ 编辑 + 保存：令牌不推进、草稿仍有效、第二跳能完成原范围', async () => {
    const { container } = render(<MindmapStage />);
    const ids = await openFixture(container);
    const tokenAtOpen = o().documentToken;

    // 先起摘要草稿（范围 A..C）
    await startSummaryViaMenu(container, ids.aId);
    expect(o().hasDraft()).toBe(true);

    // 真实编辑：右键「编辑」进入内联编辑态（生产写路径）
    rightClickNodeById(container, ids.bId);
    await waitFor(() => expect(container.querySelector('[data-context-menu]')).not.toBeNull());
    fireEvent.click(menuItem(container, '编辑'));
    await tick(80);
    expect(o().documentToken).toBe(tokenAtOpen); // 编辑不推进
    expect(o().hasDraft()).toBe(true); // 草稿仍在

    // 真实保存：文档栏「保存」
    fireEvent.click(docBarBtn(container, '保存'));
    await tick(150);
    expect(o().documentToken).toBe(tokenAtOpen); // 保存不推进
    expect(o().hasDraft()).toBe(true); // 草稿仍在

    // 第二跳仍能完成**原范围**摘要
    clickNodeById(container, ids.cId);
    await tick(80);
    expect(summaryCount()).toBe(1);
    expect(o().hasDraft()).toBe(false);
    const members = memberTexts();
    expect(members).toEqual(['A', 'B', 'C']);
  });

  it('⑫ 另存为：选择器被真实唤起、写入内容含当前树，令牌不推进且草稿存活', async () => {
    const picker = installSavePicker();
    const { container } = render(<MindmapStage />);
    const ids = await openFixture(container);
    const tokenAtOpen = o().documentToken;

    await startSummaryViaMenu(container, ids.aId);
    expect(o().hasDraft()).toBe(true);

    // 真实另存为：文档栏「另存为」→ 选择器替身 → 写入路径
    fireEvent.click(docBarBtn(container, '另存为'));
    await tick(200);

    // 写盘证据：确实调用过选择器，且写入内容是一次真实序列化快照
    expect(picker.calls).toBe(1);
    expect(picker.written).toHaveLength(1);
    expect(picker.written[0]).toContain('# 根');
    expect(picker.written[0]).toContain('## A');

    // 令牌不推进（另存为不是文档替换）；草稿仍有效
    expect(o().documentToken).toBe(tokenAtOpen);
    expect(o().hasDraft()).toBe(true);

    // 第二跳仍能完成原范围
    clickNodeById(container, ids.cId);
    await tick(80);
    expect(summaryCount()).toBe(1);
    expect(memberTexts()).toEqual(['A', 'B', 'C']);
  });
});

/* ───────── 关系模式 Shift 连线回归：必须真的生成预期边 ───────── */

describe('Shift 连线回归（无草稿时真实生成边，而非只证未建摘要）', () => {
  it('⑬ 无草稿 + 关系模式 + Shift 点击 → 真的新增一条自由边', async () => {
    const { container } = render(<MindmapStage />);
    const ids = await openFixture(container);

    // 切到关系模式（E8：仅关系模式下 Shift+点才建边）
    if (!toggleRelationMode(container)) {
      // 关系模式入口在真实 UI 上找不到时，本用例必须**失败**而不是静默跳过
      throw new Error('缺少关系模式入口（无法构造 Shift 连线前置）');
    }
    const edgesBefore = freeEdgeCount(container);

    // 真实 Shift 点击：先普通点击选中源节点，再 Shift 点击目标
    clickNodeById(container, ids.aId);
    await tick(60);
    expect(o().selectedId).toBe(ids.aId);

    shiftClickNodeById(container, ids.bId);
    await tick(120);

    // 目标 = 真的多出一条边（不是"没建摘要"这种弱断言）
    expect(freeEdgeCount(container)).toBe(edgesBefore + 1);
    // 且没有误建摘要
    expect(summaryCount()).toBe(0);
  });
});
});

/* ─────────────────── helpers ─────────────────── */

function textOf(root: EditableNode, id: string): string {
  let out = '';
  const walk = (n: EditableNode): void => {
    if (n.id === id) out = n.text ?? '';
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

/** 命令告警条文本（A5 通道） */
function noticeText(container: HTMLElement): string {
  for (const el of container.querySelectorAll('div')) {
    const t = (el.textContent ?? '').trim();
    if (t.startsWith('⚠ ')) return t;
  }
  return '';
}

/** 当前摘要的范围成员文本（按 resolveSummaries 的顺序） */
function memberTexts(): string[] {
  const resolved = resolveSummaries(o().root);
  const first = resolved[0];
  if (first === undefined) return [];
  return (first.memberIds ?? []).map((id) => textOf(o().root, id));
}

/**
 * 切换关系模式（E8）。返回是否找到入口。
 *
 * 生产接线是 `data-relation-mode` 的 button —— 不是靠文本找（文本会变），
 * 也不在测试里直接改 React state（那就不是真实路径了）。
 */
function toggleRelationMode(container: HTMLElement): boolean {
  const btn = container.querySelector('[data-relation-mode]');
  if (!(btn instanceof HTMLElement)) return false;
  fireEvent.click(btn);
  return true;
}

/**
 * 画布上**已渲染**的自由边数量。
 *
 * 数真实渲染出来的 `data-free-edge` 分组 —— 比读内部数组更接近用户所见：
 * 边数据存在但没画出来（或反之）都会被这个断言抓到。
 */
function freeEdgeCount(container: HTMLElement): number {
  return container.querySelectorAll('[data-free-edge]').length;
}

/** 真实 Shift+点击画布节点卡（E7 两跳连线的第二跳） */
function shiftClickNodeById(container: HTMLElement, id: string): void {
  const at = toClient(container, centerOf(container, id));
  const wheel = wheelOf(container);
  fireEvent.pointerDown(wheel, {
    clientX: at.sx,
    clientY: at.sy,
    pointerId: 1,
    shiftKey: true,
    bubbles: true,
  });
  fireEvent.pointerUp(wheel, {
    clientX: at.sx,
    clientY: at.sy,
    pointerId: 1,
    shiftKey: true,
    bubbles: true,
  });
}

/** 树快照（结构 + note 全量；用于 Undo 逐位回原断言） */
function serializeSnapshot(root: EditableNode): string {
  const walk = (n: EditableNode): unknown => ({
    id: n.id,
    text: n.text,
    note: n.note ?? null,
    summaryOf: summaryOf(n.note) ?? null,
    children: n.children.map(walk),
  });
  // id 每次解析重新生成，但同一会话内不变 → 快照比较有效
  return JSON.stringify(walk(root));
}
