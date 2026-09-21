// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { astToEditable, layoutMindmap, makeTextNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView } from '../src/render/MapView.js';
import type { MapViewApi } from '../src/render/MapView.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

/** 小型树 → 布局（比 fixture 更快更稳；实体/多级场景在 demo 呈现） */
function smallLayout() {
  const root = makeTextNode('根', [
    makeTextNode('分支 A', [makeTextNode('叶 1'), makeTextNode('叶 2')]),
    makeTextNode('分支 B'),
  ]);
  const editable = astToEditable(root)!;
  const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
  return {
    layout: layoutMindmap(editable, createNodeMeasure(char, new Map()), new Set()),
    char,
  };
}

/** 轮询等待断言成立（治并行负载下固定 sleep 的时序 flaky） */
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
    await new Promise((r) => setTimeout(r, 25));
  }
  throw lastErr ?? new Error('waitFor timeout');
}

describe('MapView：渲染核心冒烟（dirty-flag + 裁剪 + LOD）', () => {
  it('渲染可见节点与连线（SVG rect/path 存在）', () => {
    const { layout, char } = smallLayout();
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} />
      </ThemeProvider>,
    );
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    // 视口尚未获得尺寸（jsdom 无 ResizeObserver）→ 仍渲染数据元素
    expect(container.querySelectorAll('rect').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('path').length).toBeGreaterThan(0);
  });

  it('stats 上报总节点数（渲染统计供性能面板）', () => {
    const { layout, char } = smallLayout();
    const stats: Array<{ totalNodes: number }> = [];
    render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} onStats={(s) => stats.push(s)} />
      </ThemeProvider>,
    );
    expect(stats.length).toBeGreaterThan(0);
    expect(stats[stats.length - 1]!.totalNodes).toBe(5);
  });

  it('尺寸就绪后自动适配（fit 触发——防 "fit 被永久跳过" 回归）', async () => {
    // jsdom 无 ResizeObserver：注入 fake，observe 即回调 800×600 尺寸
    class FakeRO implements ResizeObserver {
      observe(): void {
        queueMicrotask(() =>
          this.cb([{ contentRect: { width: 800, height: 600 } }] as never, this as never),
        );
      }
      unobserve(): void {}
      disconnect(): void {}
      constructor(private cb: ResizeObserverCallback) {}
    }
    const w = globalThis as unknown as { ResizeObserver: typeof ResizeObserver };
    const prev = w.ResizeObserver;
    w.ResizeObserver = FakeRO;
    try {
      const { layout, char } = smallLayout();
      const { container } = render(
        <ThemeProvider>
          <MapView layout={layout} entities={new Map()} char={char} />
        </ThemeProvider>,
      );
      const g = container.querySelector('svg g')!;
      // fit 后 transform 非恒等（此前 bug：effect 只在挂载时跑，viewW=1 跳过 → 永不 fit）
      await waitFor(() => {
        expect(g.getAttribute('transform')).not.toBe('translate(0 0) scale(1)');
        expect(g.getAttribute('transform')).toContain('scale');
      });
    } finally {
      w.ResizeObserver = prev;
    }
  });

  it('resetZoom：k=1 居中于原点（Ctrl+0）', async () => {
    class FakeRO implements ResizeObserver {
      observe(): void {
        queueMicrotask(() =>
          this.cb([{ contentRect: { width: 800, height: 600 } }] as never, this as never),
        );
      }
      unobserve(): void {}
      disconnect(): void {}
      constructor(private cb: ResizeObserverCallback) {}
    }
    const w = globalThis as unknown as { ResizeObserver: typeof ResizeObserver };
    const prev = w.ResizeObserver;
    w.ResizeObserver = FakeRO;
    try {
      const { layout, char } = smallLayout();
      const apiRef: { current: MapViewApi | null } = { current: null };
      const { container } = render(
        <ThemeProvider>
          <MapView layout={layout} entities={new Map()} char={char} apiRef={apiRef} />
        </ThemeProvider>,
      );
      await new Promise((r) => setTimeout(r, 80));
      expect(apiRef.current).not.toBeNull();
      // 先做非默认变换，再 resetZoom → 平滑动画到 k=1 居中（viewport 800×600 → 中心 400,300）
      apiRef.current!.zoomBy(1.5);
      apiRef.current!.resetZoom();
      const g = container.querySelector('svg g')!;
      // 等动画完成 + rAF 广播（轮询治并行 flaky）
      await waitFor(() => {
        expect(g.getAttribute('transform')).toBe('translate(400 300) scale(1)');
      });
    } finally {
      w.ResizeObserver = prev;
    }
  });

  it('右键节点 → onNodeContext 命中回调（含屏幕坐标）', () => {
    const { layout, char } = smallLayout();
    const ctx = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} onNodeContext={ctx} />
      </ThemeProvider>,
    );
    // jsdom 无尺寸 → transform 恒等（k=1,x=0,y=0），世界坐标 = 屏幕坐标
    const root = layout.nodes.find((n) => n.depth === 0)!;
    const wheel = container.querySelector('div[style*="touch-action"]') as HTMLElement;
    fireEvent.contextMenu(wheel, {
      clientX: root.box.x + root.box.w / 2,
      clientY: root.box.y + root.box.h / 2,
      bubbles: true,
      cancelable: true,
    });
    expect(ctx).toHaveBeenCalledTimes(1);
    expect(ctx.mock.calls[0]![0]?.node.text).toBe('根'); // 命中根节点
    expect(typeof ctx.mock.calls[0]![1]).toBe('number'); // 屏幕坐标
  });
});
it('折叠后仍可展开：折叠节点的折叠指示器保留（回归：ln.children 置空导致指示器消失）', () => {
  // 前提验证：布局引擎对折叠节点 children 置空（bug 触发的数据形态）
  const raw = astToEditable(
    makeTextNode('根', [
      makeTextNode('分支 A', [makeTextNode('叶 1'), makeTextNode('叶 2')]),
      makeTextNode('分支 B'),
    ]),
  )!;
  const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
  const id = raw.children![0]!.id;
  const collapsed = new Set([id]);
  const collapsedLayout = layoutMindmap(raw, createNodeMeasure(char, new Map()), collapsed);
  const a = collapsedLayout.nodes.find((n) => n.node.id === id)!;
  expect(a.children.length).toBe(0); // 折叠后布局 children 为空

  const toggle = vi.fn();
  const { container } = render(
    <ThemeProvider>
      <MapView
        layout={collapsedLayout}
        entities={new Map()}
        char={char}
        collapsedIds={collapsed}
        onToggleCollapse={toggle}
      />
    </ThemeProvider>,
  );
  // 折叠指示器 g 以 cursor:pointer 标记（根节点/无子节点不渲染）——存在即证明指示器未随折叠消失
  const indicator = container.querySelector('g[style*="pointer"]');
  expect(indicator).not.toBeNull();
  fireEvent.click(indicator!);
  expect(toggle).toHaveBeenCalledWith(id);
});
