// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { astToEditable, layoutMindmap, makeTextNode, type LayoutNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView } from '../src/render/MapView.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

function renderMap(props: {
  forceBackend?: 'svg' | 'canvas';
  onNodeClick?: (n: LayoutNode) => void;
}) {
  const root = astToEditable(makeTextNode('根', [makeTextNode('A'), makeTextNode('B')]))!;
  const layout = layoutMindmap(root, createNodeMeasure(char, new Map()), new Set());
  return {
    layout,
    ...render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} {...props} />
      </ThemeProvider>,
    ),
  };
}

function surface(container: HTMLElement): HTMLElement {
  return container.querySelector('div[style*="touch-action"]') as HTMLElement;
}

describe('MapView canvas 模式（C2：T8 L3 主循环接入）', () => {
  it('forceBackend=canvas → canvas 元素渲染、SVG 层让位', () => {
    const { container } = renderMap({ forceBackend: 'canvas' });
    expect(container.querySelector('canvas')).not.toBeNull();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('缺省 svg 后端 → 无 canvas（回归）', () => {
    const { container } = renderMap({});
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('canvas 模式交互：pointer 命中节点 → onNodeClick（坐标命中，不依赖 DOM 元素）', () => {
    const onNodeClick = vi.fn();
    const { container, layout } = renderMap({ forceBackend: 'canvas', onNodeClick });
    const el = surface(container);
    // 找一个可见节点的屏幕位置（初始 transform ≈ 单位阵；节点盒 + 内部偏移）
    const ln = layout.nodes.find((n) => n.depth === 1)!;
    const sx = ln.box.x + 10;
    const sy = ln.box.y + ln.box.h / 2;
    fireEvent.pointerDown(el, { pointerId: 1, clientX: sx, clientY: sy, button: 0 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: sx, clientY: sy });
    expect(onNodeClick).toHaveBeenCalledTimes(1);
    expect(onNodeClick.mock.calls[0]![0].node.id).toBe(ln.node.id);
  });

  it('canvas 模式：pointer 点击空白不触发 onNodeClick', () => {
    const onNodeClick = vi.fn();
    const { container, layout } = renderMap({ forceBackend: 'canvas', onNodeClick });
    const el = surface(container);
    const minX = Math.min(...layout.nodes.map((n) => n.box.x)) - 500;
    fireEvent.pointerDown(el, { pointerId: 1, clientX: minX, clientY: -400, button: 0 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: minX, clientY: -400 });
    expect(onNodeClick).not.toHaveBeenCalled();
  });
});
