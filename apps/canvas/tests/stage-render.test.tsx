// @vitest-environment jsdom
/**
 * MindmapStage 整体渲染回归保护（2026-09-03 重新启用）
 *
 * 历史：本文件曾 `describe.skip`，理由是「jsdom 下整体渲染会 SIGTERM，无法在 CI 运行」。
 *      那条结论产生于**并行 worker 时代** —— 而进程挂起的根因正是 Windows 下
 *      worker + jsdom 的句柄不释放（见 `b42b34d`）。改为单进程（fileParallelism: false）
 *      后实测：**挂载耗时约 200ms，正常退出**。
 *
 * 于是这个盲区可以补上了 —— `MindmapStage.tsx` 是全项目最大的文件（2,066 行，
 * 占 canvas 源码约 42%），此前零整体渲染保护，每次改动都只能靠其他包的测试间接兜底。
 *
 * 本文件覆盖的是「整体能起来」这条地板；面板区的细粒度行为仍走：
 *   ① 抽出的 hook 单独测（tests/useDocumentActions.test.tsx 模式）
 *   ② 单个面板组件在 packages/react 里测
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import MindmapStage from '../src/MindmapStage';

describe('MindmapStage 整体渲染', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('挂载后产出 SVG 画布（不抛错）', () => {
    localStorage.clear(); // 无最近文档 → 直接进画布，不走启动页
    const { container } = render(<MindmapStage />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('节点被渲染出来（内置示例可见）', () => {
    localStorage.clear();
    const { container } = render(<MindmapStage />);
    // NodeG 给每个节点打了 data-node-id —— 比断言具体文案稳
    expect(container.querySelectorAll('[data-node-id]').length).toBeGreaterThan(0);
  });

  it('顶栏渲染出文档名与操作按钮', () => {
    localStorage.clear();
    const { container } = render(<MindmapStage />);
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('卸载不抛错（清理干净，不残留定时器/监听）', () => {
    localStorage.clear();
    const { unmount } = render(<MindmapStage />);
    expect(() => unmount()).not.toThrow();
  });
});

/**
 * ── P0-FIX-R1 R1-3：Ctrl+S 必须走**实时**的 handleSave（键位闭包陈旧回归）──
 *
 * **缺陷**（真机 F1F2 实测定性）：键位 effect 的 deps 只有 `[controller]`，
 * 而 `handleSave` 是随 `doc` 换身份的 `useCallback`。键位处理器一旦直接闭包捕获它，
 * 就永久定格在**首版**（打开示例文档时那份 `doc.source`）。
 *
 * 后果：Ctrl+S 触发的 S2G 守卫用 `syncedSourceRef`（**实时** ref）去比一个**陈旧**
 * 的 `doc.source` → 恒不等 → 每一次保存都被拦，保存态永远停在「未保存」
 * （F1F2 连跑 5 次全拦、`writes=[]`）。修复 = 经 `handleSaveRef.current` 调用。
 *
 * 判别方式：真实组件 + 真实 Ctrl+S。断言「按下后**没有**出现『已阻止保存』」。
 * 若把调用改回闭包直呼，本用例立即转红（首版 handleSave 的 source ≠ 当前文档）。
 */
describe('R1-3：Ctrl+S 不得被陈旧闭包拦下', () => {
  // 换文档会触发动画调度（FrameScheduler 缺省读 rAF）；jsdom 无 rAF，按本仓既有口径打桩
  beforeEach(() => {
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
    vi.unstubAllGlobals();
  });

  /** 派发一个真实键盘事件（键位监听挂在 window 上） */
  const key = (k: string) =>
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true, cancelable: true }),
    );

  it('Ctrl+N 换文档后 Ctrl+S → 不出现「已阻止保存」（守卫读实时 source）', async () => {
    localStorage.clear();
    const { container } = render(<MindmapStage />);
    expect(container.querySelectorAll('[data-node-id]').length).toBeGreaterThan(0);

    // 关键前置：**替换文档**（Ctrl+N 新建）—— 使「首版 handleSave 的 doc.source」
    // 与「当前文档 source」不再相同。陈旧闭包自此开始每次 Ctrl+S 都误拦。
    act(() => {
      key('n');
    });
    await new Promise((r) => setTimeout(r, 0));

    // 现在按 Ctrl+S
    act(() => {
      key('s');
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(container.textContent ?? '').not.toContain('已阻止保存');
  });

  it('对照：不换文档直接 Ctrl+S 也不得出现拦截（同源，守卫应放行）', async () => {
    localStorage.clear();
    const { container } = render(<MindmapStage />);
    act(() => {
      key('s');
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent ?? '').not.toContain('已阻止保存');
  });
});
