// @vitest-environment jsdom
/**
 * G-P0：自由边路由重算治理 —— pan 期「路由整表重算」机制判别用例（先红）
 *
 * 判别指标 = `routeAesthetic` 的调用次数（vi.mock 包装计数）：
 *   基线（`visibleFreeEdges` 每帧产出新数组 → FreeEdgeLayer 路由 memo 击穿）
 *     → 每次平移每个可见边 ≥ 1 次调用（**先红**）；
 *   G-P1（内容键 identity 稳定化）后 → 纯平移（成员不变）**0 次**（绿）。
 *
 * 为什么用 routeAesthetic 调用次数：它直接对应「重算一次整表」的原子成本
 * （每边一次；跨边协调与跳线都在其外层，随整表重算一并发生）。
 *
 * 场景：5 节点树（LOD 阈值内）+ 2 条自由边（root.note.edges）。
 * 平移用真实指针路径驱动（pointerDown/Move/Up 于手势层，起点远离节点盒），
 * 与 `mapview-pan-memo.test.tsx` 同款——保证「平移确实生效」的证据位可断言。
 */
import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { layoutMindmap, makeTextNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';
import { MapView } from '../src/render/MapView.js';

/** routeAesthetic 调用计数（vi.mock 工厂内闭包引用，调用时求值——无 TDZ 问题） */
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

/** 裁剪 memo 重算计数（stableByKeys 每次 memo 重跑调用一次 = 裁剪窗口变化频率的机制指标） */
let stableCalls = 0;

vi.mock('../src/render/stableArray.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/stableArray.js')>();
  return {
    ...actual,
    stableByKeys: (...args: Parameters<typeof actual.stableByKeys>) => {
      stableCalls++;
      return actual.stableByKeys(...args);
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

/** 等若干帧（MapView 经 rAF 帧调度重渲染；jsdom 下须异步等帧） */
const flushFrames = (): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 80));
  });

beforeEach(() => {
  routeCalls = 0;
  stableCalls = 0;
});

/** 投影 transform 解析（Δ 世界 px 的证据位：translate 差值 ÷ scale） */
function parseTransform(t: string | null): { tx: number; ty: number; k: number } {
  const m = /translate\(([-\d.e]+) ([-\d.e]+)\)(?: scale\(([-\d.e]+)\))?/.exec(t ?? '');
  const num = (s: string | undefined, d: number): number => (s === undefined ? d : Number(s));
  return { tx: num(m?.[1], NaN), ty: num(m?.[2], NaN), k: num(m?.[3], 1) };
}

/** 长距稳态平移：steps 步 × stepPx + 3 步 1px 刹车（速度窗最后 3 采样 < 0.8px/ms 阈值 → 无惯性） */
async function panLongSteady(wheel: HTMLElement, steps: number, stepPx: number): Promise<void> {
  const x = -4000;
  const y = -4000;
  fireEvent.pointerDown(wheel, { clientX: x, clientY: y, pointerId: 1, bubbles: true });
  for (let i = 1; i <= steps; i++) {
    fireEvent.pointerMove(wheel, { clientX: x + i * stepPx, clientY: y, pointerId: 1, bubbles: true });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  }
  const end = x + steps * stepPx;
  for (let b = 1; b <= 3; b++) {
    fireEvent.pointerMove(wheel, { clientX: end + b, clientY: y, pointerId: 1, bubbles: true });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
  }
  fireEvent.pointerUp(wheel, { clientX: end + 3, clientY: y, pointerId: 1, bubbles: true });
}

it('长距平移（G-P2）：裁剪 memo 重算 ≤ ⌈Δ/256⌉+2 次 —— 窗口量化后每 256px 至多一次', async () => {
  const { container, wheel } = mount();
  await flushFrames();
  expect(container.querySelectorAll('[data-free-edge]').length).toBe(2);
  expect(routeCalls).toBeGreaterThan(0);

  routeCalls = 0;
  stableCalls = 0;
  const t0 = parseTransform(projectionTransform(container));
  await panLongSteady(wheel, 12, 40); // Δ ≈ 480 世界 px
  await flushFrames();
  const t1 = parseTransform(projectionTransform(container));

  // 平移生效（非空转）
  expect(t1.tx).not.toBe(t0.tx);
  const deltaWorld = Math.abs(t1.tx - t0.tx) / (t1.k || 1);
  const boundEvents = Math.ceil(deltaWorld / 256) + 2;

  // 机制指标（G-P2）：裁剪窗口变化频率 —— 量化前逐帧（≈ 每步一次，15 次），量化后 ≤ 上界
  expect(
    stableCalls,
    `长距平移（Δ=${deltaWorld} 世界px）裁剪 memo 重算 ${stableCalls} 次，上界 ${boundEvents}`,
  ).toBeLessThanOrEqual(boundEvents);
  // 路由重算上界（每次事件对每条可见边一次 routeAesthetic，夹具 E=2；G-P1 后通常为 0）
  expect(
    routeCalls,
    `长距平移（Δ=${deltaWorld} 世界px）路由重算 ${routeCalls} 次调用，上界 ${boundEvents * 2}`,
  ).toBeLessThanOrEqual(boundEvents * 2);
});

it('纯平移（可见集成员不变）不重算任何路由（routeAesthetic 调用次数 = 0）', async () => {
  const { container, wheel } = mount();
  await flushFrames(); // 首帧渲染 + 稳定

  // 夹具有效性：两条自由边都完成路由（否则本用例是空转）
  expect(container.querySelectorAll('[data-free-edge]').length).toBe(2);
  // 计数器有效性：首帧确实调用过 routeAesthetic（mock 包装命中）
  expect(routeCalls, '首帧未发生任何 routeAesthetic 调用——mock 包装未生效?').toBeGreaterThan(0);

  routeCalls = 0; // 清零点：只看「纯平移」这一段
  const t0 = projectionTransform(container);
  panStep(wheel, 40, 25);
  await flushFrames();
  panStep(wheel, -15, 60);
  await flushFrames();

  // 平移确实生效（否则本用例是空转）
  expect(projectionTransform(container)).not.toBe(t0);
  // 判别指标：纯平移 0 次路由重算（基线会 ≥ 2：每次平移 × 每条可见边）
  expect(routeCalls, `pan 期整表重算了 ${routeCalls} 次 routeAesthetic——identity 未稳定`).toBe(0);
});

it('G-P9 判别守卫：跨量化边界的小步纯平移（成员不变）→ 裁剪 memo 重算 ≥1 次且零路由重算', async () => {
  // 复核实验（G-P9 缺口）：出厂 CULL_QUANT=256 下，小步平移（Δ<256）根本不跨量化边界，
  // 量化自身就能兜住「绕过 stableByKeys 接线」的回归（上一例 6/6 仍绿）——G-P1 在出厂配置下
  // 无判别力。本用例把平距拉到 Δ≈280 世界 px（仍为 ≤40px 小步）：必跨 ≥1 个 256 边界，
  // 裁剪 memo 必产出新数组 identity → 只有 stableByKeys 拦得住 → routeCalls 恒 0。
  const { container, wheel } = mount();
  await flushFrames();
  // 夹具有效性：两条自由边在场
  expect(container.querySelectorAll('[data-free-edge]').length).toBe(2);

  routeCalls = 0;
  stableCalls = 0;
  const t0 = parseTransform(projectionTransform(container));
  // 方向取左移：jsdom 无 ResizeObserver → viewW=viewH=1，有效窗口 ≈ 1×1 + CULL_MARGIN + 量化超集
  // （≈512 宽带）；右移 Δ≥129 即掉 e1（成员变化，用例失真）。左移 Δ=280 两成员全程可见，
  // 且 freeView 从 [-256..256] 跨到 [0..512]——恰 1 次量化边界穿越。
  for (let i = 0; i < 7; i++) {
    panStep(wheel, -40, 0); // 7 步 × 40px = Δ≈280 世界 px（k=1），跨 ≥1 个 256 量化边界
    await flushFrames();
  }
  const t1 = parseTransform(projectionTransform(container));

  // ① 平移生效（非空转）；且世界位移确实 ≥ 256（否则没跨边界，用例退化）
  expect(t1.tx).not.toBe(t0.tx);
  const deltaWorld = Math.abs(t1.tx - t0.tx) / (t1.k || 1);
  expect(deltaWorld, `世界位移 ${deltaWorld} < 256，未跨任何量化边界`).toBeGreaterThanOrEqual(256);
  // ② 非空转证据位：确实跨了边界（裁剪 memo 至少重算一次、产出过新数组 identity）
  expect(
    stableCalls,
    `stableCalls=${stableCalls}——未跨任何 256 量化边界，本用例空转`,
  ).toBeGreaterThanOrEqual(1);
  // ③ 成员不变：两条自由边全程可见（Δ=280 不出裁剪窗口）
  expect(container.querySelectorAll('[data-free-edge]').length).toBe(2);
  // ④ 判别指标：跨边界重跑裁剪 memo 的新数组必须被 stableByKeys 拦下 → 零路由重算。
  //   阴性对照（绕过接线 return next）：routeCalls = stableCalls×E = stableCalls×2 ≥ 2 → 本断言红。
  expect(
    routeCalls,
    `跨量化边界后整表重算 ${routeCalls} 次 routeAesthetic——G-P1 接线失效`,
  ).toBe(0);
});
