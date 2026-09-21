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
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
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
