/**
 * MODE-GUARD · 自由画布替换入口与 beforeunload（Task 2/3）
 *
 * 判别核心：
 * - 新建 / 打开 / 最近 / 演示 四个替换入口**都必须**经注入的离开决策器
 *   （决策器拒绝时模型与标题不变；放行后才替换）；
 * - 文件解析失败不改动当前模型，也不进入离开决策（用户没有被问「要不要放弃」）；
 * - beforeunload 在 dirty / 写入中 / 有未提交草稿时拦截（原生能力，不弹自定义模态）；
 * - Stage 登记的 leave port 方法读实时状态，卸载后注销。
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createEmptyDocument, serializeCanvasDocument } from '@mindcanvas/free-canvas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANVAS_RECENT_KEY } from '../src/canvasDocHost';
import type { DocumentLeavePort, RequestLeave } from '../src/documentLifecycle';
import { FreeCanvasStage } from '../src/FreeCanvasStage';

const must = (c: HTMLElement, sel: string): HTMLElement => {
  const el = c.querySelector(sel);
  if (el === null) throw new Error(`missing: ${sel}`);
  return el as HTMLElement;
};

const click = (c: HTMLElement, sel: string): void => {
  fireEvent.click(must(c, sel));
};

const titleOf = (c: HTMLElement): string => must(c, '[data-fc-title]').textContent ?? '';
const cardCount = (c: HTMLElement): number => c.querySelectorAll('[data-fc-card]').length;

/** 拒绝型决策器：不执行目标（等价用户「取消」） */
const refuse = (): RequestLeave =>
  vi.fn(async () => false) as unknown as RequestLeave;

/** 放行型决策器：立即执行目标（等价「放弃/保存后继续」） */
const allow = (): RequestLeave =>
  vi.fn(async (perform: () => void | Promise<void>) => {
    await perform();
    return true;
  }) as unknown as RequestLeave;

/** 打开选择器替身：返回带句柄的合法画布文件 */
function stubOpenPicker(source: string, name = 'opened.mc.canvas.json'): void {
  const handle = {
    name,
    getFile: async () => ({
      name,
      text: async () => source,
    }),
    createWritable: async () => ({
      write: async () => undefined,
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

describe('MODE-GUARD · 自由画布替换入口全部经决策器', () => {
  it('新建：决策器拒绝 → 标题与内容不变；放行 → 换成未命名画布', () => {
    const requestLeave = refuse();
    const { container } = render(
      <FreeCanvasStage onExit={vi.fn()} requestLeave={requestLeave} />,
    );
    // 先建立「当前有内容」的现场
    click(container, '[data-fc-tool="sticky"]');
    fireEvent.click(must(container, '[data-fc-host]'), { clientX: 100, clientY: 100 });
    expect(cardCount(container)).toBe(1);

    click(container, '[data-fc-new]');
    expect(requestLeave).toHaveBeenCalledTimes(1);
    expect(cardCount(container)).toBe(1); // 决策器未放行 → 模型不变

    cleanup();
    const requestLeave2 = allow();
    const second = render(<FreeCanvasStage onExit={vi.fn()} requestLeave={requestLeave2} />);
    click(second.container, '[data-fc-tool="sticky"]');
    fireEvent.click(must(second.container, '[data-fc-host]'), { clientX: 100, clientY: 100 });
    click(second.container, '[data-fc-new]');
    expect(requestLeave2).toHaveBeenCalledTimes(1);
    expect(cardCount(second.container)).toBe(0); // 放行后才是新画布
    expect(titleOf(second.container)).toContain('未命名');
  });

  it('打开：决策器拒绝时不替换；放行后载入所选文件（标题与模型同步）', async () => {
    const source = serializeCanvasDocument(createEmptyDocument('打开的画布'));
    stubOpenPicker(source);

    const requestLeave = refuse();
    const { container } = render(
      <FreeCanvasStage onExit={vi.fn()} requestLeave={requestLeave} />,
    );
    await act(async () => {
      click(container, '[data-fc-open]');
      await new Promise<void>((r) => {
        setTimeout(r, 0);
      });
    });

    expect(requestLeave).toHaveBeenCalledTimes(1);
    expect(titleOf(container)).toContain('未命名'); // 用户取消 → 当前文档不变

    cleanup();
    const requestLeave2 = allow();
    const second = render(<FreeCanvasStage onExit={vi.fn()} requestLeave={requestLeave2} />);
    await act(async () => {
      click(second.container, '[data-fc-open]');
      await new Promise<void>((r) => {
        setTimeout(r, 0);
      });
    });
    expect(titleOf(second.container)).toContain('opened.mc.canvas.json');
  });

  it('演示：经决策器；放行后载入 2 张便签', () => {
    const requestLeave = allow();
    const { container } = render(
      <FreeCanvasStage onExit={vi.fn()} requestLeave={requestLeave} />,
    );

    click(container, '[data-fc-demo]');

    expect(requestLeave).toHaveBeenCalledTimes(1);
    expect(cardCount(container)).toBe(2);
    expect(titleOf(container)).toContain('demo-free.mc.canvas.json');
  });

  it('最近：经决策器；放行后载入最近记录', () => {
    const source = serializeCanvasDocument(createEmptyDocument('最近画布'));
    localStorage.setItem(
      CANVAS_RECENT_KEY,
      JSON.stringify([{ id: 'recent.mc.canvas.json', name: 'recent.mc.canvas.json', source, ts: 1 }]),
    );
    const requestLeave = allow();
    const { container } = render(
      <FreeCanvasStage onExit={vi.fn()} requestLeave={requestLeave} />,
    );

    click(container, '[data-fc-recent-toggle]');
    click(container, '[data-fc-recent-item]');

    expect(requestLeave).toHaveBeenCalledTimes(1);
    expect(titleOf(container)).toContain('recent.mc.canvas.json');
  });

  it('打开的文件不是合法画布 → 不改动当前模型，也不进入决策（不误问「放弃」）', async () => {
    stubOpenPicker('{ 这不是合法画布 }');
    const requestLeave = allow();
    const { container } = render(
      <FreeCanvasStage onExit={vi.fn()} requestLeave={requestLeave} />,
    );

    await act(async () => {
      click(container, '[data-fc-open]');
      await new Promise<void>((r) => {
        setTimeout(r, 0);
      });
    });

    expect(requestLeave).not.toHaveBeenCalled();
    expect(titleOf(container)).toContain('未命名');
    expect(container.textContent).toContain('打开失败');
  });
});

describe('MODE-GUARD · 自由画布 beforeunload 与端口登记', () => {
  it('dirty → beforeunload 被拦截；保存成功后不再拦截', async () => {
    const ports: DocumentLeavePort[] = [];
    const registerLeavePort = (port: DocumentLeavePort | null): (() => void) => {
      if (port !== null) ports.push(port);
      return () => undefined;
    };
    const { container } = render(
      <FreeCanvasStage onExit={vi.fn()} registerLeavePort={registerLeavePort} />,
    );

    const cleanEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false); // 干净文档不拦

    click(container, '[data-fc-tool="sticky"]');
    fireEvent.click(must(container, '[data-fc-host]'), { clientX: 100, clientY: 100 });

    const dirtyEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);

    // 端口方法读实时状态
    const port = ports[0];
    expect(port).toBeDefined();
    expect(port?.isDirty()).toBe(true);
    expect(port?.isSaving()).toBe(false);

    // 保存成功（fs 不可用 → 下载兜底）后 dirty 清除 → 不再拦截
    vi.stubGlobal('URL', {
      createObjectURL: () => 'blob:stub',
      revokeObjectURL: () => undefined,
    });
    await act(async () => {
      await port?.save();
    });
    expect(port?.isDirty()).toBe(false);
    const afterSave = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(afterSave);
    expect(afterSave.defaultPrevented).toBe(false);
  });

  it('卸载后注销端口（App 不会拿到失效 Stage 的端口）', () => {
    const registered: Array<DocumentLeavePort | null> = [];
    const registerLeavePort = (port: DocumentLeavePort | null): (() => void) => {
      registered.push(port);
      return () => registered.push(null);
    };
    const view = render(<FreeCanvasStage onExit={vi.fn()} registerLeavePort={registerLeavePort} />);
    expect(registered).toHaveLength(1);
    expect(registered[0]).not.toBeNull();

    view.unmount();
    expect(registered[registered.length - 1]).toBeNull();
  });
});
