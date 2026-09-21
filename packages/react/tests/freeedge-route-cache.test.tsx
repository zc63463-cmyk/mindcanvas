// @vitest-environment jsdom
/**
 * G-P6 机制判别：路由结果缓存命中场景 ——「成员变化但端点盒未变」的平移。
 *
 * G-P5 复测结论（perf-baseline.md §8）：E=100×10K 单次全量重算 1331ms ≫ 16ms，
 * 且 pan 每 256px 成员变化时仍触发整表重算。方案 A 缓存对症：成员退出后，
 * 存活边的路由 key（edge.key + 端点盒 + collapsed 解析输出 + manual + routingSide + stagger）
 * 不变 → 命中 LRU 复用上次 RouteResult → routeAesthetic 重算次数从 E 降到 0。
 *
 * 开关 `FREEEDGE_ROUTE_CACHE` 默认关：两态均有用例（开 = 命中 0 重算；关 = 重算 ≥1，
 * 后者同时是「开关真的在起作用」的对照）。缓存只复用 RouteResult，跨边累积
 * routedPolylines 仍按边序推进（命中项也 push points）→ 不改跨边协调语义。
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { layoutMindmap, makeTextNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';
import { MapView } from '../src/render/MapView.js';
import { routeCacheConfig } from '../src/render/routeCache.js';

/** routeAesthetic 调用计数（vi.mock 包装计数） */
let routeCalls = 0;

vi.mock('../src/render/edgeRouting.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/edgeRouting.js')>();
  return {
    ...actual,
    routeAesthetic: (...args: Parameters<typeof actual.routeAesthetic>) => {
      routeCalls++;
      return actual.routeAesthetic(...args);
    },
  };
});

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

function mount() {
  const root = makeTextNode('根', [
    makeTextNode('分支 A', [makeTextNode('叶 1'), makeTextNode('叶 2')]),
    makeTextNode('分支 B'),
  ]);
  root.note = {
    edges: [
      { from: 'node:根/分支 A', to: 'node:根/分支 B', rel: 'blocks' },
      { from: 'node:根/分支 A/叶 1', to: 'node:根/分支 A/叶 2', rel: 'relates-to' },
    ],
  };
  const layout = layoutMindmap(root, createNodeMeasure(char, new Map()), new Set());
  const { container } = render(
    <ThemeProvider>
      <MapView layout={layout} entities={new Map()} char={char} />
    </ThemeProvider>,
  );
  const wheel = container.querySelector('div[style*="touch-action"]') as HTMLElement;
  return { container, wheel };
}

/** 纯平移一步（起点远离节点盒 → 走 pan 分支） */
function panStep(wheel: HTMLElement, dx: number, dy: number): void {
  const x = -4000;
  const y = -4000;
  fireEvent.pointerDown(wheel, { clientX: x, clientY: y, pointerId: 1, bubbles: true });
  fireEvent.pointerMove(wheel, { clientX: x + dx, clientY: y + dy, pointerId: 1, bubbles: true });
  fireEvent.pointerUp(wheel, { clientX: x + dx, clientY: y + dy, pointerId: 1, bubbles: true });
}

const flushFrames = (): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 80));
  });

/** 某条自由边当前渲染的全部 path d（命中区与可见线共用同一 d） */
const edgeDs = (c: HTMLElement, key: string): string =>
  [...(c.querySelector(`[data-free-edge="${key}"]`)?.querySelectorAll('path') ?? [])]
    .map((p) => p.getAttribute('d') ?? '')
    .join('|');

beforeEach(() => {
  routeCalls = 0;
  routeCacheConfig.enabled = false;
});

afterEach(() => {
  routeCacheConfig.enabled = false;
});

/**
 * 成员退出平移：右移 4×60=240 世界 px（k=1）。jsdom 有效窗口极小（viewW=1 + 边距 + 量化），
 * e1（叶1→叶2，span x≈214..263）在 tx≥129 出窗 → 成员 2→1，存活边 e0 端点盒未变。
 */
async function panMemberExit(wheel: HTMLElement): Promise<void> {
  for (let i = 0; i < 4; i++) {
    panStep(wheel, 60, 0);
    await flushFrames();
  }
}

it('缓存开（开关显式打开）：成员退出、端点盒未变 → 存活边命中缓存，路由重算 0 次', async () => {
  routeCacheConfig.enabled = true;
  const { container, wheel } = mount();
  await flushFrames();
  // 夹具有效性：两条边完成路由（首帧整表重算 2 次）
  expect(container.querySelectorAll('[data-free-edge]').length).toBe(2);
  expect(routeCalls).toBe(2);
  const d0 = edgeDs(container, 'e0');

  routeCalls = 0;
  await panMemberExit(wheel);

  // 命中场景成立：成员确实变化（2 → 1），存活边 e0 端点盒未变
  expect(container.querySelectorAll('[data-free-edge]').length).toBe(1);
  expect(container.querySelector('[data-free-edge="e0"]')).not.toBeNull();
  // 判别指标：存活边命中缓存 → 0 次 routeAesthetic（关开关时为 ≥1，见下例）
  expect(routeCalls, `成员退出后仍重算 ${routeCalls} 次——缓存未命中`).toBe(0);
  // 等价性：命中复用的 RouteResult 与缓存写入时逐位相同（渲染 d 不变）
  expect(edgeDs(container, 'e0')).toBe(d0);
});

it('缓存关（默认态）：同场景存活边重算 ≥1 次——对照证明开关在起作用', async () => {
  const { container, wheel } = mount();
  await flushFrames();
  expect(container.querySelectorAll('[data-free-edge]').length).toBe(2);

  routeCalls = 0;
  await panMemberExit(wheel);

  expect(container.querySelectorAll('[data-free-edge]').length).toBe(1);
  expect(routeCalls, '默认关：成员退出触发的整表重算应仍在（对照位）').toBeGreaterThan(0);
});
