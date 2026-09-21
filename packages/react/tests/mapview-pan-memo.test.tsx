// @vitest-environment jsdom
/**
 * B-P2：pan 期**节点组件不再重渲染**（机制指标；批次 B）
 *
 * 判别指标 = `NodeG` 的渲染次数（模块级计数包装）：
 *   基线（NodeG 无 memo / props 引用不稳定）→ 每次纯平移每个可见节点各渲染一次（**先红**）；
 *   P2 后（NodeG 包 memo + style/回调引用稳定）→ 纯平移 **0 次**（绿）。
 *
 * 为什么不用 DOM 变更数当判别指标：P0 真浏览器实测（docs/preview/perf-baseline.md §6.1）
 * 基线 `nodeMutations` 已为 0 —— React 结构复用本就避免节点 DOM 重挂，
 * DOM 指标只能当**非回归守卫**（本文件同时保留 MutationObserver 断言）。
 *
 * 平移用真实指针路径驱动（pointerDown/Move/Up on 手势层），起点取远离所有节点盒的空白处。
 */
import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { astToEditable, layoutMindmap, makeTextNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';
import { MapView } from '../src/render/MapView.js';

/** NodeG 渲染计数（vi.mock 工厂 hoist 前声明，用 var 提升语义） */
let nodeRenders = 0;

vi.mock('../src/render/NodeG.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/NodeG.js')>();
  const { memo } = await import('react');
  const Counted = (props: Parameters<typeof actual.NodeG>[0]) => {
    nodeRenders++;
    return <actual.NodeG {...props} />;
  };
  // 外层再包 memo：与生产同构（memo 命中 → Counted 不执行 → 计数不增）
  return { ...actual, NodeG: memo(Counted) };
});

function mount() {
  const root = makeTextNode('根', [
    makeTextNode('分支 A', [makeTextNode('叶 1'), makeTextNode('叶 2')]),
    makeTextNode('分支 B'),
  ]);
  const editable = astToEditable(root)!;
  const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
  const layout = layoutMindmap(editable, createNodeMeasure(char, new Map()), new Set());
  const { container } = render(
    <ThemeProvider>
      <MapView layout={layout} entities={new Map()} char={char} />
    </ThemeProvider>,
  );
  const wheel = container.querySelector('div[style*="touch-action"]') as HTMLElement;
  return { container, wheel };
}

/** 投影 g 的 transform（平移是否生效的证据位） */
const projectionTransform = (c: HTMLElement): string | null =>
  c.querySelector('svg > g')?.getAttribute('transform') ?? null;

/** 纯平移一步（起点远离节点盒 → 走 pan 分支；单步位移 > 3px 阈值） */
function panStep(wheel: HTMLElement, dx: number, dy: number): void {
  const x = -4000;
  const y = -4000;
  fireEvent.pointerDown(wheel, { clientX: x, clientY: y, pointerId: 1, bubbles: true });
  fireEvent.pointerMove(wheel, { clientX: x + dx, clientY: y + dy, pointerId: 1, bubbles: true });
  fireEvent.pointerUp(wheel, { clientX: x + dx, clientY: y + dy, pointerId: 1, bubbles: true });
}

/** 挂在容器上的节点 DOM 变更计数（非回归守卫：任何情况下都应为 0） */
function observeNodeMutations(container: HTMLElement): () => number {
  let count = 0;
  const isNodeG = (el: Node): boolean =>
    el.nodeType === 1 &&
    (el as Element).tagName === 'g' &&
    (el as Element).hasAttribute('data-node-id');
  const insideNodeG = (el: Node | null): boolean => {
    let p: Node | null = el;
    while (p) {
      if (isNodeG(p)) return true;
      p = p.parentNode;
    }
    return false;
  };
  const obs = new MutationObserver((records) => {
    for (const rec of records) {
      if (insideNodeG(rec.target)) count++;
      else if (Array.from(rec.addedNodes).some(isNodeG) || Array.from(rec.removedNodes).some(isNodeG))
        count++;
    }
  });
  obs.observe(container, { subtree: true, childList: true, attributes: true });
  return () => {
    obs.disconnect();
    return count;
  };
}

/** 等若干帧（MapView 经 rAF 帧调度重渲染；jsdom 下须异步等帧） */
const flushFrames = (): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 80));
  });

beforeEach(() => {
  nodeRenders = 0;
});

it('纯平移不重渲染任何节点组件（NodeG 渲染次数 = 0）', async () => {
  const { container, wheel } = mount();
  await flushFrames(); // 首帧渲染 + 稳定
  const t0 = projectionTransform(container);
  expect(nodeRenders).toBeGreaterThan(0); // 首帧确实渲染过节点（计数器有效）

  nodeRenders = 0; // 清零点：只看「纯平移」这一段
  const stop = observeNodeMutations(container);
  panStep(wheel, 40, 25);
  await flushFrames();
  panStep(wheel, -15, 60);
  await flushFrames();
  const domMutations = stop();

  // 平移确实生效（否则本用例是空转）
  expect(projectionTransform(container)).not.toBe(t0);
  // 判别指标：纯平移 0 次节点组件渲染（基线会 > 0）
  expect(nodeRenders, 'pan 期节点组件被重渲染了——memo/稳定 props 未生效').toBe(0);
  // 非回归守卫：节点 DOM 零变更（P0 基线亦为 0）
  expect(domMutations).toBe(0);
});

it('平移后节点盒位置仍随投影更新（无 memo 漏更新）', async () => {
  const { container, wheel } = mount();
  await flushFrames();
  const nodeId = container.querySelector('g[data-node-id]')?.getAttribute('data-node-id') ?? '';
  expect(nodeId).not.toBe('');
  const before = projectionTransform(container);
  panStep(wheel, 30, 30);
  await flushFrames();
  expect(projectionTransform(container)).not.toBe(before);
  expect(projectionTransform(container)).toContain('translate(');
});
