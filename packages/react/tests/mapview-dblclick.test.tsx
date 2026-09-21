// @vitest-environment jsdom
/**
 * MapView 双击交互：双击 text 节点 → 请求进入编辑；双击空白 / entity 节点 → **无操作**。
 *
 * 背景（两段）：
 * - K4 后补：此前双击一律 fitBounds，用户双击节点期望编辑却触发视图缩放 → 感知"无法编辑"；
 * - v1.8.10 用户裁决 B：空白分支的 fitBoundsAnimated 也摘掉 ——「随手在空白双击就把视图
 *   重置」是编辑流里的干扰源。适配视图的显式入口仍在：工具栏「适配视图」/ Ctrl+0。
 */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { astToEditable, layoutMindmap, makeEntityNode, makeTextNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView } from '../src/render/MapView.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

/** 混合布局：text 分支 + entity 节点（测双击分派到 text / 跳过 entity） */
function mixedLayout() {
  const root = makeTextNode('根', [
    makeTextNode('分支 A'),
    makeEntityNode({ kind: 'issue', id: '1' }),
  ]);
  const editable = astToEditable(root)!;
  const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
  return {
    layout: layoutMindmap(editable, createNodeMeasure(char, new Map()), new Set()),
    char,
  };
}

function centerOf(box: { x: number; y: number; w: number; h: number }) {
  return { clientX: box.x + box.w / 2, clientY: box.y + box.h / 2 };
}

/** 找一个不在任何节点盒内的世界坐标点（50px 网格扫描） */
function blankPoint(layout: {
  nodes: Array<{ box: { x: number; y: number; w: number; h: number } }>;
}) {
  for (let y = 0; y < 2000; y += 50) {
    for (let x = 0; x < 2000; x += 50) {
      const hit = layout.nodes.some(
        (n) => n.box.x <= x && x <= n.box.x + n.box.w && n.box.y <= y && y <= n.box.y + n.box.h,
      );
      if (!hit) return { clientX: x, clientY: y };
    }
  }
  return { clientX: 9999, clientY: 9999 };
}

describe('MapView：双击编辑（双击 text 节点进编辑；空白与 entity 为无操作）', () => {
  it('双击 text 节点 → onEditStart 命中回调该节点 id', () => {
    const { layout, char } = mixedLayout();
    const start = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} onEditStart={start} />
      </ThemeProvider>,
    );
    const wheel = container.querySelector('div[style*="touch-action"]') as HTMLElement;
    const root = layout.nodes.find((n) => n.depth === 0)!;
    // jsdom 无尺寸 → transform 恒等（k=1,x=0,y=0），世界坐标 = 屏幕坐标
    fireEvent.dblClick(wheel, { ...centerOf(root.box), bubbles: true, cancelable: true });
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]![0]).toBe(root.node.id);
  });

  it('双击空白（未命中节点）→ 不进入编辑', () => {
    const { layout, char } = mixedLayout();
    const start = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} onEditStart={start} />
      </ThemeProvider>,
    );
    const wheel = container.querySelector('div[style*="touch-action"]') as HTMLElement;
    // 远离所有节点的空白点（网格扫描）
    fireEvent.dblClick(wheel, { ...blankPoint(layout), bubbles: true, cancelable: true });
    expect(start).not.toHaveBeenCalled();
  });

  it('双击空白 → **视口变换不变**（v1.8.10 裁决 B；旧实现会 fit 到全图 → 本用例红）', async () => {
    const { layout, char } = mixedLayout();
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} />
      </ThemeProvider>,
    );
    const content = () => container.querySelector('svg > g[transform]')?.getAttribute('transform');
    const before = content();
    expect(before).not.toBeUndefined();
    const wheel = container.querySelector('div[style*="touch-action"]') as HTMLElement;
    fireEvent.dblClick(wheel, { ...blankPoint(layout), bubbles: true, cancelable: true });
    // ⚠️「什么都不该发生」类断言**不能只用 waitFor**：它首次轮询（此时 rAF 动画还没跑）
    // 就会成功 → 假绿（阴性对照实测踩过）。正确口径：先把视口动画窗口跑完，再断言恒等。
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(content()).toBe(before);
  });

  it('双击 entity 节点 → 不进编辑（实体文本由实体源驱动，不自由改写）', () => {
    const { layout, char } = mixedLayout();
    const start = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} onEditStart={start} />
      </ThemeProvider>,
    );
    const wheel = container.querySelector('div[style*="touch-action"]') as HTMLElement;
    const entity = layout.nodes.find((n) => n.node.type === 'entity')!;
    fireEvent.dblClick(wheel, { ...centerOf(entity.box), bubbles: true, cancelable: true });
    expect(start).not.toHaveBeenCalled();
  });
});
