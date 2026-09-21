/**
 * 应用层冒烟测试（apps/canvas 首个测试文件）
 *
 * 背景：测试此前全在 packages，**apps 层零测试**。
 * 而 `StageContent` 单函数 1,781 行（MindmapStage.tsx:351-2131）是全项目最大的组件 —— 没有任何回归保护。
 *
 * 本文件先建立「环境可用 + 模块可加载」的地板，后续拆分 StageContent 时逐步加行为断言。
 */
import { describe, expect, it } from 'vitest';
import MindmapStage from '../src/MindmapStage';
// PerfPanel 是具名导出（符合 CONTRIBUTING「一律具名导出，default 仅限入口组件」）
import { PerfPanel } from '../src/PerfPanel';
import App from '../src/App';

describe('应用层模块可加载', () => {
  it('MindmapStage 是组件（default 导出，应用入口）', () => {
    expect(typeof MindmapStage).toBe('function');
  });

  it('PerfPanel 是组件（具名导出）', () => {
    expect(typeof PerfPanel).toBe('function');
  });

  it('App 是组件', () => {
    expect(App).toBeTruthy();
  });
});

describe('vitest 环境自检', () => {
  it('jsdom 环境生效', () => {
    expect(typeof document).toBe('object');
    expect(typeof window).toBe('object');
  });

  it('@mindcanvas/* alias 指向源码而非 dist', async () => {
    // 能 import 到 react 包入口即证明 alias 生效；
    // 若解析到 dist 且 dist 陈旧，这里会拿到旧符号而报错。
    const mod = await import('@mindcanvas/react');
    expect(mod.MapView).toBeTruthy();
    expect(typeof mod.buildEditable).toBe('function');
  });
});
