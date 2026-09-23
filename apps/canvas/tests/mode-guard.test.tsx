/**
 * MODE-GUARD · App 双向模式切换（真实 App：导图 ⇄ 自由画布）
 *
 * 判别核心（审计 P0-B 复现改成**正确期望**）：
 * - 有未保存内容时切模式必须出现确认框；取消 = 内容与当前模式都保留；
 * - 「保存并继续」只有 `saved,current=true` 且复核通过才离开；`downloaded` 不自动离开；
 * - 「放弃修改」是显式选择（离开后内容才会消失）；
 * - 冷启动无编辑可直接切换；重复点击不产生第二个请求；输入法组合未结束不离开。
 *
 * 走真实调用链：App → 离开决策器 → Stage 端口 → 包 1 会话协调器。
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createEmptyDocument, serializeCanvasDocument } from '@mindcanvas/free-canvas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { LEAVE_DOWNLOAD_NOTICE } from '../src/hooks/useUnsavedTransition';

const must = (c: HTMLElement, sel: string): HTMLElement => {
  const el = c.querySelector(sel);
  if (el === null) throw new Error(`missing: ${sel}`);
  return el as HTMLElement;
};

const click = (c: HTMLElement, sel: string): void => {
  fireEvent.click(must(c, sel));
};

const promptOpen = (c: HTMLElement): boolean => c.querySelector('[data-unsaved-prompt]') !== null;
/** MG-R1：组合未结束时的**非模态**提示（不弹模态、不抢焦点） */
const blockedNoticeOpen = (c: HTMLElement): boolean =>
  c.querySelector('[data-unsaved-blocked]') !== null;
const fcCards = (c: HTMLElement): number => c.querySelectorAll('[data-fc-card]').length;
const inFreeCanvas = (c: HTMLElement): boolean => c.querySelector('[data-fc-stage]') !== null;
const saveState = (c: HTMLElement): string =>
  c.querySelector('[data-save-state]')?.textContent ?? '';

/**
 * 冲刷微任务 + 定时器（保存链路异步；用 act 包住避免状态更新落在 act 之外）。
 *
 * **为什么等到 20ms 而不是 0**：本文件的 `requestAnimationFrame` 桩按
 * `setTimeout(cb, 16)` 调度（见 `beforeEach`；canvas 套件 `pretendToBeVisual:false`，
 * 没有真实 rAF）。只等一个 0ms tick 时，「编辑 → dirty」要经过的那次 rAF 回调
 * **是否已经跑过**取决于事件循环里还排着多少别的定时器 —— 单文件跑时够用，
 * 同批多一个稍慢的文件就不够。
 *
 * 实测（P0-B 施工时定位）：`mode-guard` + 任意一个约 1.5s 的空转文件即转红
 * `expected '✓ 已保存' to contain '未保存'`；**同一现象在 P0-B 之前的基线上同样复现**
 * （`git stash` 后加一个 `setTimeout(1500)` 空转文件即可重现），因此是本文件既有的
 * 调度脆弱性，不是某次改动引入的回归。
 *
 * 等到 20ms（> 16ms 的 rAF 桩）让一次 rAF 回调必然有机会执行 ——
 * **断言一字未改**，只把「等多久」从与调度细节耦合改成确定够用。
 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });
  });
}

/** 节点 g 的世界中心（transform 的 translate + 首个 rect 的宽高） */
function centerOf(container: HTMLElement, id: string): { cx: number; cy: number } | null {
  const g = container.querySelector(`g[data-node-id="${id}"]`);
  if (g === null) return null;
  const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(g.getAttribute('transform') ?? '');
  const r = g.querySelector('rect');
  if (m === null || r === null) return null;
  return {
    cx: Number(m[1]) + Number(r.getAttribute('width') ?? 0) / 2,
    cy: Number(m[2]) + Number(r.getAttribute('height') ?? 0) / 2,
  };
}

/** 世界→屏幕变换（读世界组 translate/scale；缺省按恒等） */
function worldTransformOf(container: HTMLElement): { tx: number; ty: number; k: number } {
  const svg = container.querySelector('g[data-node-id]')?.closest('svg') ?? null;
  const g = svg === null ? null : Array.from(svg.children).find((el) => el.tagName === 'g') ?? null;
  const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\)\s*scale\(\s*(-?[\d.]+)/.exec(
    g?.getAttribute('transform') ?? '',
  );
  if (m === null) return { tx: 0, ty: 0, k: 1 };
  return { tx: Number(m[1]), ty: Number(m[2]), k: Number(m[3]) };
}

function firstNodeId(container: HTMLElement): string {
  const g = container.querySelector('g[data-node-id]');
  const id = g?.getAttribute('data-node-id');
  if (id === null || id === undefined) throw new Error('画布节点缺失');
  return id;
}

/** 在画布手势层上双击节点（命中测试按世界→屏幕换算坐标，与真实点击同路径） */
function doubleClickNode(container: HTMLElement, id: string): void {
  const wheel = container.querySelector('div[style*="touch-action"]') as HTMLElement | null;
  const at = centerOf(container, id);
  if (wheel === null || at === null) throw new Error('手势层或节点缺失');
  const { tx, ty, k } = worldTransformOf(container);
  fireEvent.doubleClick(wheel, { clientX: at.cx * k + tx, clientY: at.cy * k + ty });
}

/** 导图：进入内联编辑 → 改文本 → Enter（模型变脏） */
async function editFirstNode(container: HTMLElement, text: string): Promise<void> {
  doubleClickNode(container, firstNodeId(container));
  await flush();
  const input = must(container, '[data-overlay-editor]') as HTMLInputElement;
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await flush();
}

/** 自由画布：落一张便签（标题出现 dirty 圆点） */
function createSticky(c: HTMLElement): void {
  click(c, '[data-fc-tool="sticky"]');
  fireEvent.click(must(c, '[data-fc-host]'), { clientX: 120, clientY: 120 });
}

/** 画布模型的可读快照（各卡正面文本；未提交的编辑态不出现在这里），用于「候选串未进模型」断言 */
function modelText(c: HTMLElement): string {
  return Array.from(c.querySelectorAll('[data-fc-front]'))
    .map((el) => el.textContent ?? '')
    .join('\n');
}

/** fs 写盘替身：返回内存句柄 → saved/current=true */
function stubFsSave(): void {
  const handle = {
    name: 'mode-guard.mm.md',
    createWritable: async () => ({
      write: async () => undefined,
      close: async () => undefined,
    }),
  };
  vi.stubGlobal(
    'showSaveFilePicker',
    vi.fn(async () => handle),
  );
}

/** 下载兜底替身（jsdom 无 URL.createObjectURL）→ downloaded 分支 */
function stubDownload(): void {
  vi.stubGlobal('URL', {
    createObjectURL: () => 'blob:stub',
    revokeObjectURL: () => undefined,
  });
}

/**
 * 自由画布「打开」替身：返回带句柄的合法画布文件。
 * 为什么需要：`LocalCanvasDocHost.save` 只在**已有句柄**时走 fs 写回，否则一律下载兜底
 * （它不像导图保存那样唤起 showSaveFilePicker）。
 */
function stubOpenPicker(sink?: string[]): void {
  const name = 'opened.mc.canvas.json';
  const source = serializeCanvasDocument(createEmptyDocument('打开的画布'));
  const handle = {
    name,
    getFile: async () => ({ name, text: async () => source }),
    createWritable: async () => ({
      write: async (data: string | Blob) => {
        sink?.push(typeof data === 'string' ? data : '[blob]');
      },
      close: async () => undefined,
    }),
  };
  vi.stubGlobal(
    'showOpenFilePicker',
    vi.fn(async () => [handle]),
  );
}

beforeEach(() => {
  localStorage.clear();
  // canvas 套件 pretendToBeVisual:false（无 rAF）——真实 controller 需要调度桩
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 16) as unknown as number,
  );
  vi.stubGlobal('cancelAnimationFrame', (h: number) => {
    clearTimeout(h);
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MODE-GUARD · 冷启动与干净路径', () => {
  it('冷启动无编辑：点击浮标直接进入自由画布（不弹模态）', () => {
    const { container } = render(<App />);
    expect(promptOpen(container)).toBe(false);

    click(container, '[data-app-freecanvas]');

    expect(inFreeCanvas(container)).toBe(true);
    expect(promptOpen(container)).toBe(false);
  });

  it('自由画布无编辑：返回导图直接切换', () => {
    const { container } = render(<App />);
    click(container, '[data-app-freecanvas]');

    click(container, '[data-fc-exit]');

    expect(inFreeCanvas(container)).toBe(false);
    expect(promptOpen(container)).toBe(false);
    expect(container.querySelector('[data-app-freecanvas]')).not.toBeNull();
  });
});

describe('MODE-GUARD · 自由画布离开保护（P0-B 正确期望）', () => {
  it('有未保存便签 → 切模式出现确认；取消保留便签与当前模式；放弃才离开', () => {
    const { container } = render(<App />);
    click(container, '[data-app-freecanvas]');
    createSticky(container);
    expect(fcCards(container)).toBe(1);
    expect(must(container, '[data-fc-title]').textContent).toContain('●');

    // 点「← 导图」→ 必须出现确认框（修复前是静默丢弃）
    click(container, '[data-fc-exit]');
    expect(promptOpen(container)).toBe(true);
    expect(inFreeCanvas(container)).toBe(true);

    // 取消 → 便签仍在、仍在自由画布
    click(container, '[data-unsaved-cancel]');
    expect(promptOpen(container)).toBe(false);
    expect(fcCards(container)).toBe(1);
    expect(inFreeCanvas(container)).toBe(true);

    // 再请求 → 显式放弃 → 才离开（内容消失是用户选择的结果）
    click(container, '[data-fc-exit]');
    click(container, '[data-unsaved-discard]');
    expect(inFreeCanvas(container)).toBe(false);

    // 再次进入自由画布：空 Stage（放弃已生效，不是恢复缺陷）
    click(container, '[data-app-freecanvas]');
    expect(fcCards(container)).toBe(0);
  });

  it('保存并继续 → 下载兜底不自动离开；显式放弃后才离开', async () => {
    stubDownload();
    const { container } = render(<App />);
    click(container, '[data-app-freecanvas]');
    createSticky(container);

    click(container, '[data-fc-exit]');
    click(container, '[data-unsaved-save]');
    await flush();

    // downloaded 只表示已触发下载 → 必须留在当前模式并给出准确提示
    expect(inFreeCanvas(container)).toBe(true);
    expect(must(container, '[data-unsaved-notice]').textContent).toBe(LEAVE_DOWNLOAD_NOTICE);
    expect(promptOpen(container)).toBe(true);

    click(container, '[data-unsaved-discard]');
    expect(inFreeCanvas(container)).toBe(false);
  });

  it('保存并继续 → fs 写盘成功且复核通过 → 才离开', async () => {
    stubOpenPicker(); // 打开带句柄的画布 → 后续保存走句柄写回（fs）
    const { container } = render(<App />);
    click(container, '[data-app-freecanvas]');

    // 干净状态下「打开」不弹确认；打开后文档带句柄
    click(container, '[data-fc-open]');
    await flush();
    expect(must(container, '[data-fc-title]').textContent).toContain('opened.mc.canvas.json');

    createSticky(container);
    expect(fcCards(container)).toBe(1);

    click(container, '[data-fc-exit]');
    click(container, '[data-unsaved-save]');
    await flush();

    expect(inFreeCanvas(container)).toBe(false);
    expect(promptOpen(container)).toBe(false);
  });

  it('自由画布 dirty 时「打开」也经确认：取消不替换当前画布', async () => {
    stubOpenPicker();
    const { container } = render(<App />);
    click(container, '[data-app-freecanvas]');
    createSticky(container);

    click(container, '[data-fc-open]');
    await flush();
    expect(promptOpen(container)).toBe(true);

    click(container, '[data-unsaved-cancel]');
    expect(promptOpen(container)).toBe(false);
    expect(fcCards(container)).toBe(1); // 当前画布未被替换
    expect(must(container, '[data-fc-title]').textContent).toContain('未命名');
  });

  it('组合输入中点入口：候选文字不进模型/不写盘；结束后最后确认文字准确保存', async () => {
    const written: string[] = [];
    stubOpenPicker(written);
    const { container } = render(<App />);
    click(container, '[data-app-freecanvas]');
    click(container, '[data-fc-open]'); // 拿到句柄 → 保存走句柄写回（可断言写出文本）
    await flush();

    createSticky(container);
    // 编辑态会把该卡的 `[data-fc-front]` 换成编辑框 → 计数少 1 就是「未回写模型」的投影证据
    const frontsBeforeEdit = container.querySelectorAll('[data-fc-front]').length;
    fireEvent.doubleClick(must(container, '[data-fc-card]'));
    const editor = must(container, '[data-fc-editor]') as HTMLTextAreaElement;
    expect(container.querySelectorAll('[data-fc-front]').length).toBe(frontsBeforeEdit - 1);

    // 组合输入中：框里是未确认的候选串
    fireEvent.compositionStart(editor);
    fireEvent.change(editor, { target: { value: '尚未确认的候选文字' } });

    click(container, '[data-fc-exit]');
    // 编辑器必须还在（不得被失焦提交关闭）、候选串不得进模型、不弹模态、不离开
    expect(container.contains(editor)).toBe(true);
    expect(container.querySelectorAll('[data-fc-front]').length).toBe(frontsBeforeEdit - 1);
    expect(modelText(container)).not.toContain('尚未确认的候选文字');
    expect(promptOpen(container)).toBe(false);
    expect(blockedNoticeOpen(container)).toBe(true);
    expect(inFreeCanvas(container)).toBe(true);
    expect(written.join('\n')).not.toContain('尚未确认的候选文字');

    // 完成组合（最后确认文字）→ 请求自动续跑 → 模态 → 保存并继续 → 写出的是确认后的文字
    fireEvent.change(editor, { target: { value: '已确认的文字' } });
    fireEvent.compositionEnd(editor);
    await flush();
    expect(promptOpen(container)).toBe(true);

    click(container, '[data-unsaved-save]');
    await flush();
    expect(inFreeCanvas(container)).toBe(false);
    expect(written.join('\n')).toContain('已确认的文字');
    expect(written.join('\n')).not.toContain('尚未确认的候选文字');
  });
});

describe('MODE-GUARD · 导图离开保护', () => {
  it('导图有未保存编辑 → 进入自由画布前必须确认；取消保留编辑与画布', async () => {
    const { container } = render(<App />);
    await editFirstNode(container, '改动后的节点');
    expect(saveState(container)).toContain('未保存');

    click(container, '[data-app-freecanvas]');
    expect(promptOpen(container)).toBe(true);
    expect(inFreeCanvas(container)).toBe(false);

    click(container, '[data-unsaved-cancel]');
    expect(promptOpen(container)).toBe(false);
    expect(inFreeCanvas(container)).toBe(false);
    // 内容仍在画布上（没有被静默丢弃、也没有被切换文档）
    expect(container.textContent).toContain('改动后的节点');
    expect(saveState(container)).toContain('未保存');
  });

  it('导图 dirty → 保存并继续（fs 成功）→ 进入自由画布', async () => {
    stubFsSave();
    const { container } = render(<App />);
    await editFirstNode(container, '待保存节点');

    click(container, '[data-app-freecanvas]');
    click(container, '[data-unsaved-save]');
    await flush();

    expect(inFreeCanvas(container)).toBe(true);
  });

  it('组合输入未结束 → 不弹模态（不抢焦点）只有非模态提示且不离开；结束后自动续跑', async () => {
    stubFsSave();
    const { container } = render(<App />);
    await editFirstNode(container, '组合输入节点');

    // 模拟输入法组合中：再次进入编辑态（控件聚焦）并派发 compositionstart
    doubleClickNode(container, firstNodeId(container));
    await flush();
    document.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));

    click(container, '[data-app-freecanvas]');
    // 不弹模态：模态聚焦会让编辑器失焦 → 把未确认候选串当正文提交（MG-R1）
    expect(promptOpen(container)).toBe(false);
    expect(blockedNoticeOpen(container)).toBe(true);
    expect(inFreeCanvas(container)).toBe(false);

    // 组合结束 → 请求自动续跑（此时 dirty → 出现模态等决策）→ 保存并离开
    document.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    await flush();
    expect(promptOpen(container)).toBe(true);
    expect(blockedNoticeOpen(container)).toBe(false);

    click(container, '[data-unsaved-save]');
    await flush();
    expect(inFreeCanvas(container)).toBe(true);
  });
});

describe('MODE-GUARD · 重复触发', () => {
  it('连续点击入口：只有一个确认框，取消只结算一次且内容不丢', () => {
    const { container } = render(<App />);
    click(container, '[data-app-freecanvas]');
    createSticky(container);

    // 连续两次请求离开：第二次被单请求保护拒绝（不覆盖目标、不悬挂）
    click(container, '[data-fc-exit]');
    click(container, '[data-fc-exit]');
    expect(container.querySelectorAll('[data-unsaved-prompt]').length).toBe(1);

    click(container, '[data-unsaved-cancel]');
    expect(fcCards(container)).toBe(1);
    expect(inFreeCanvas(container)).toBe(true);
    expect(promptOpen(container)).toBe(false);
  });
});
