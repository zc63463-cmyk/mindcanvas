// @vitest-environment jsdom
/**
 * MODE-GUARD 离开保护 · 背面 Markdown 编辑链路（App 层回归，MG-R4 / MG-R1-B）
 *
 * 真 App（`<App />` = App 离开决策器 + 真 MindmapStage + 真 NotePopover/NoteBackEditor）：
 * 打开含 `note.md` 的文档 → 点节点固定面板 → 翻面 → 「编辑背面」→ 改源文 → **切预览**
 * （textarea 卸载，草稿只活在组件状态里）→ 请求切模式：
 *   ① `beforeunload` 必须拦截（草稿未被提交）；
 *   ② 离开决策必须先 flush 草稿（内容进模型，不静默丢）；
 *   ③ 「取消」后草稿内容仍在（没有被丢弃）；
 *   ④ 「保存并继续」写出的文件里是**最后确认的 Markdown**（文件级证据，不是只看提示）。
 * 另附组合输入断言：组合未结束时切模式，候选串不得进模型/文件（真焦点链路）。
 *
 * 边界（如实）：输入法用合成 `CompositionEvent`，不覆盖 OS 级候选框；
 * 文件写入用内存句柄（不触碰真实磁盘文件）。
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';

const LIB_KEY = 'mindcanvas.library.v1';
const DOC_ID = 'e2e-back-leave';
const DOC_NAME = 'e2e-back-leave.mm.md';
const ORIGINAL_MD = '## 背面标题';
const EDITED_MD = '## 改后的背面';
const CANDIDATE_MD = '## 尚未确认的背面候选';

const DOC_SOURCE = [
  '# 根',
  '',
  '<!--',
  'note:',
  '  - 条目一',
  `md: "${ORIGINAL_MD}"`,
  '-->',
  '',
  '## 甲',
  '',
].join('\n');

const tick = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms));

function must<E extends Element>(el: E | null, what: string): E {
  if (el === null) throw new Error(`缺少元素：${what}`);
  return el;
}

function nodeIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('g[data-node-id]')).map(
    (g) => g.getAttribute('data-node-id') ?? '',
  );
}

function centerOf(container: HTMLElement, id: string): { cx: number; cy: number } | null {
  const g = container.querySelector(`g[data-node-id="${id}"]`);
  if (g === null) return null;
  const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(g.getAttribute('transform') ?? '');
  const r = g.querySelector('rect');
  if (m === null || r === null) return null;
  return {
    cx: Number(m[1]) + Number(r.getAttribute('width') ?? '0') / 2,
    cy: Number(m[2]) + Number(r.getAttribute('height') ?? '0') / 2,
  };
}

function worldTransformOf(container: HTMLElement): { tx: number; ty: number; k: number } {
  const svg = container.querySelector('g[data-node-id]')?.closest('svg') ?? null;
  const g = svg === null ? null : (Array.from(svg.children).find((el) => el.tagName === 'g') ?? null);
  const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\)\s*scale\(\s*(-?[\d.]+)/.exec(
    g?.getAttribute('transform') ?? '',
  );
  if (m === null) return { tx: 0, ty: 0, k: 1 };
  return { tx: Number(m[1]), ty: Number(m[2]), k: Number(m[3]) };
}

async function waitFor(assertFn: () => void, timeoutMs = 3000): Promise<void> {
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

function backTransform(container: HTMLElement): string {
  const back = container.querySelector('[data-note-back-scroll]');
  const el = back?.parentElement;
  if (el === null || el === undefined) throw new Error('背面 face 缺失');
  return el.style.transform;
}

/** 启动页 →「最近」菜单打开本用例文档 */
async function openDoc(container: HTMLElement): Promise<void> {
  const sample = Array.from(container.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '') === '看内置示例',
  );
  if (sample === undefined) throw new Error('启动页「看内置示例」按钮缺失');
  fireEvent.click(sample);
  await waitFor(() => expect(container.querySelector('[data-doc-name]')).not.toBeNull());

  const recentBtn = Array.from(container.querySelectorAll('span')).find(
    (s) => (s.textContent ?? '') === '最近',
  );
  if (recentBtn === undefined) throw new Error('文档栏「最近」按钮缺失');
  fireEvent.click(recentBtn);
  await waitFor(() => expect(container.querySelector('[data-recent-menu]')).not.toBeNull());
  const item = Array.from(container.querySelectorAll('[data-recent-doc]')).find((el) =>
    (el.textContent ?? '').includes(DOC_NAME),
  );
  if (item === undefined) throw new Error(`「最近」菜单未列出 ${DOC_NAME}`);
  fireEvent.click(item);
}

async function waitForJia(container: HTMLElement): Promise<string> {
  const findTarget = (): string | undefined =>
    nodeIds(container).find((id) =>
      (container.querySelector(`g[data-node-id="${id}"]`)?.textContent ?? '').includes('甲'),
    );
  let target = findTarget();
  for (let i = 0; i < 40 && target === undefined; i++) {
    await tick(50);
    target = findTarget();
  }
  if (target === undefined) throw new Error('节点「甲」缺失');
  return target;
}

/** 面板固定卡仅在 k ≥ 0.65 档位渲染：先经滚轮升档 */
async function ensurePanelZoom(container: HTMLElement): Promise<void> {
  const wheelEl = container.querySelector('div[style*="touch-action"]') as HTMLElement | null;
  for (let i = 0; i < 8 && worldTransformOf(container).k < 0.65; i++) {
    wheelEl?.dispatchEvent(
      new WheelEvent('wheel', { deltaY: -500, clientX: 60, clientY: 60, bubbles: true }),
    );
    await tick(60);
  }
  if (worldTransformOf(container).k < 0.65) throw new Error('缩放未达面板档位');
}

/** 隔帧点击节点（贴近真实指针时序） */
async function clickNodeFlushed(container: HTMLElement, id: string): Promise<void> {
  const wheel = container.querySelector('div[style*="touch-action"]') as HTMLElement | null;
  const at = centerOf(container, id);
  if (wheel === null || at === null) throw new Error('手势层或节点缺失');
  const { tx, ty, k } = worldTransformOf(container);
  const sx = at.cx * k + tx;
  const sy = at.cy * k + ty;
  fireEvent.pointerDown(wheel, { clientX: sx, clientY: sy, pointerId: 1, bubbles: true });
  await tick(30);
  fireEvent.pointerUp(wheel, { clientX: sx, clientY: sy, pointerId: 1, bubbles: true });
}

/** 点面板头「翻转」并等背面朝前 */
async function flipBack(container: HTMLElement): Promise<void> {
  fireEvent.click(must(container.querySelector('[data-note-flip]'), '翻面按钮'));
  await waitFor(() => expect(backTransform(container)).toBe('rotateY(0deg)'));
}

/** 进入背面编辑器 */
async function enterMdEdit(container: HTMLElement): Promise<HTMLTextAreaElement> {
  fireEvent.click(must(container.querySelector('[data-note-md-edit]'), '编辑背面按钮'));
  await waitFor(() => expect(container.querySelector('[data-note-md-editor]')).not.toBeNull());
  return must<HTMLTextAreaElement>(container.querySelector('[data-note-md-input]'), '源文 textarea');
}

/** fs 保存替身：内存句柄 + 记录写出的源文（文件级证据） */
function stubFsSave(sink: string[]): void {
  const handle = {
    name: DOC_NAME,
    createWritable: async () => ({
      write: async (data: string | Blob) => {
        sink.push(typeof data === 'string' ? data : '[blob]');
      },
      close: async () => undefined,
    }),
  };
  vi.stubGlobal(
    'showSaveFilePicker',
    vi.fn(async () => handle),
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 16) as unknown as number,
  );
  vi.stubGlobal('cancelAnimationFrame', (h: number) => {
    clearTimeout(h);
  });
  localStorage.setItem(
    LIB_KEY,
    JSON.stringify([{ id: DOC_ID, name: DOC_NAME, source: DOC_SOURCE, ts: Date.now(), tags: [] }]),
  );
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** 打开文档 → 固定面板 → 翻面 → 进入背面编辑 */
async function openBackEditor(container: HTMLElement): Promise<HTMLTextAreaElement> {
  await openDoc(container);
  const target = await waitForJia(container);
  await ensurePanelZoom(container);
  await clickNodeFlushed(container, target);
  await waitFor(() => expect(container.querySelector('[data-note-flip]')).not.toBeNull());
  await flipBack(container);
  return await enterMdEdit(container);
}

describe('MODE-GUARD · 背面预览态草稿（MG-R4，App 层）', () => {
  it('预览态草稿：beforeunload 拦截 → 取消保留草稿 → 保存并继续写出最后 Markdown', async () => {
    const written: string[] = [];
    stubFsSave(written);
    const { container } = render(<App />);
    const ta = await openBackEditor(container);

    // 改源文 → 切预览（textarea 卸载，草稿只在组件状态里）
    fireEvent.change(ta, { target: { value: EDITED_MD } });
    fireEvent.click(must(container.querySelector('[data-note-md-toggle]'), '预览按钮'));
    expect(container.querySelector('[data-note-md-input]')).toBeNull();
    expect(container.textContent).not.toContain(EDITED_MD); // 预览渲染的是草稿，模型还是旧文本

    // ① beforeunload：草稿未提交 → 必须拦截
    const unloadEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unloadEvent);
    expect(unloadEvent.defaultPrevented).toBe(true);

    // ② 切模式 → 离开决策先 flush 草稿（进模型）→ 因为变脏而弹确认
    fireEvent.click(must(container.querySelector('[data-app-freecanvas]'), '自由画布入口'));
    await waitFor(() => expect(container.querySelector('[data-unsaved-prompt]')).not.toBeNull());
    expect(container.querySelector('[data-fc-stage]')).toBeNull();

    // ③ 取消：仍在导图，草稿内容保留（模型里已是新 md）
    fireEvent.click(must(container.querySelector('[data-unsaved-cancel]'), '取消按钮'));
    expect(container.querySelector('[data-unsaved-prompt]')).toBeNull();
    expect(container.querySelector('[data-fc-stage]')).toBeNull();
    await waitFor(() => expect(container.textContent).toContain('改后的背面'));

    // ④ 再离开 → 保存并继续 → 写出的文件里是最后确认的 Markdown，且才进入自由画布
    fireEvent.click(must(container.querySelector('[data-app-freecanvas]'), '自由画布入口'));
    await waitFor(() => expect(container.querySelector('[data-unsaved-prompt]')).not.toBeNull());
    fireEvent.click(must(container.querySelector('[data-unsaved-save]'), '保存并继续'));
    await waitFor(() => expect(container.querySelector('[data-fc-stage]')).not.toBeNull());
    expect(written.join('\n')).toContain('改后的背面');
    expect(written.join('\n')).not.toContain(ORIGINAL_MD);
  }, 20000);

  it('背面编辑器组合输入中切模式：候选串不进模型/文件，确认后写出确认文字', async () => {
    const written: string[] = [];
    stubFsSave(written);
    const { container } = render(<App />);
    const ta = await openBackEditor(container);

    // 组合中：框里是未确认候选串；点入口（真实浏览器里这一步会让编辑框失焦）
    fireEvent.compositionStart(ta);
    fireEvent.change(ta, { target: { value: CANDIDATE_MD } });
    fireEvent.click(must(container.querySelector('[data-app-freecanvas]'), '自由画布入口'));
    await tick(120);

    // 不弹模态（组合未结束 → 非模态提示 + 暂缓），不给候选串任何提交机会
    expect(container.querySelector('[data-unsaved-prompt]')).toBeNull();
    expect(container.querySelector('[data-unsaved-blocked]')).not.toBeNull();
    expect(container.querySelector('[data-fc-stage]')).toBeNull();

    // 组合结束（确认文字）→ 自动续跑 → 模态 → 保存并继续
    fireEvent.change(ta, { target: { value: EDITED_MD } });
    fireEvent.compositionEnd(ta, { data: EDITED_MD });
    await waitFor(() => expect(container.querySelector('[data-unsaved-prompt]')).not.toBeNull());
    fireEvent.click(must(container.querySelector('[data-unsaved-save]'), '保存并继续'));
    await waitFor(() => expect(container.querySelector('[data-fc-stage]')).not.toBeNull());

    expect(written.join('\n')).toContain('改后的背面');
    expect(written.join('\n')).not.toContain('尚未确认的背面候选');
  }, 20000);
});
