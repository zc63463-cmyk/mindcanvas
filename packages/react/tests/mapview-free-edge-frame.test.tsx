// @vitest-environment jsdom
/**
 * FE-FRAME-1 集成：MapView 接线后自由边端点真的贴框 / 贴卡（设计 §7 集成行 + §9 成功标准）。
 *
 * 夹具 A（近景）：双岛 + 双 Section。
 * - e0 跨岛（other ∈ 根区 → C 岛 ∈ C 区）→ 两端分别落在**各自 Section 框缘**；
 * - e1 同 Section（根 → other，均属根区）→ **不提升**（端点不在任何框缘上）。
 *
 * 夹具 B（远观）：三岛，其中 D 岛**无 Section**（升格中心）——
 * - 近景：D 无框 → e0 端点仍在 D 节点盒缘（基线）；
 * - 缩到 k < K_OVERVIEW：D 岛出总览卡 → e0 端点改贴**卡缘**（卡 bounds = 成员 AABB 外扩，
 *   到节点盒边界有明显距离 = padding，故两态互斥可判别）。
 *
 * 断言手段 = DOM 几何：解析 path 的 `d`（M 起点 / 末点）与 Section 矩形 / 复算卡 bounds
 * 的边界距离（0 = 贴缘）。卡 bounds 用 buildIslandOverviewCards 同源公式（overviewBoundsOf）
 * 复算——图层不放大 x/y，仅屏稳放大 w/h，故复算值与锚点盒一致。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { layoutForest, makeTextNode, type EditableNode, type LayoutResult } from '@mindcanvas/kernel';
import type { Box } from '@mindcanvas/kernel';
import type { ComponentProps, RefObject } from 'react';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView, type MapViewApi } from '../src/render/MapView.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';
import { buildIslandOverviewCards, K_OVERVIEW, overviewBoundsOf } from '../src/render/islandOverview.js';

afterEach(() => cleanup());

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

type Fixture = { layout: LayoutResult; root: EditableNode };

/** jsdom 尺寸就绪模拟（island-overview 测试同款；仅远观用例需要真实视口宽高） */
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

/** 尺寸就绪模拟（jsdom 无 ResizeObserver）：仅聚焦用例需要真实视口宽高 */
function mount<F extends Fixture>(
  f: F,
  over: Partial<ComponentProps<typeof MapView>> = {},
  opts: { sized?: boolean } = {},
) {
  const apiRef: RefObject<MapViewApi | null> = { current: null };
  const w = globalThis as unknown as { ResizeObserver: typeof ResizeObserver };
  const prev = w.ResizeObserver;
  if (opts.sized) w.ResizeObserver = FakeRO;
  try {
    const { container } = render(
      <ThemeProvider>
        <MapView
          layout={f.layout}
          documentRoot={f.root}
          entities={new Map()}
          char={char}
          apiRef={apiRef}
          {...over}
        />
      </ThemeProvider>,
    );
    return { container, apiRef, ...f };
  } finally {
    if (opts.sized) w.ResizeObserver = prev;
  }
}

/** 等若干帧（MapView 经 rAF 帧调度重渲染） */
const flushFrames = (): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 80));
  });

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

// ---------------- 夹具 A：双岛 + 双 Section ----------------

function sectionFixture() {
  const c1 = makeTextNode('c1');
  const c: EditableNode = { ...makeTextNode('C 岛', [c1]), note: { cid: 'c7' } };
  const other = makeTextNode('other');
  const root: EditableNode = {
    ...makeTextNode('根', [c, other]),
    note: {
      sections: [
        { id: 'sec_root', title: '根区', root: 'node:根', color: 'blue' },
        { id: 'sec_c', title: 'C 区', root: 'cid:c7', color: 'rose' },
      ],
      centers: [{ at: 'node:R/C', cid: 'c7', dir: 'right', x: 0, y: 90 }],
      edges: [
        // e0：跨 Section（根区成员 other → C 区成员 C 本体）
        { from: 'node:根/other', to: 'cid:c7', rel: 'relates-to' },
        // e1：同 Section（根 → other，均属根区）→ 不提升对照
        { from: 'node:根', to: 'node:根/other', rel: 'blocks' },
      ],
    },
  };
  const layoutRoot: EditableNode = { ...root, children: [other] };
  const layout = layoutForest(
    [
      { node: layoutRoot, dir: 'right', pos: { x: 0, y: 0 } },
      { node: c, dir: 'right', pos: { x: 0, y: 90 } },
    ],
    createNodeMeasure(char, new Map()),
    new Set(),
  );
  return { layout, root, c, c1Id: c1.id, otherId: other.id };
}

function mountSectioned() {
  const f = sectionFixture();
  return mount(f, {
    centerIds: new Set([f.c.id]),
    islandMembers: new Map<string, string[]>([
      [f.root.id, [f.root.id, f.otherId]],
      [f.c.id, [f.c.id, f.c1Id]],
    ]),
  });
}

// ---------------- 夹具 B：三岛（D 无 Section） ----------------

function trioFixture() {
  const other = makeTextNode('other');
  const d: EditableNode = { ...makeTextNode('D 岛'), note: { cid: 'cd' } };
  const root: EditableNode = {
    ...makeTextNode('根', [d, other]),
    note: {
      sections: [{ id: 'sec_root', title: '根区', root: 'node:根', color: 'blue' }],
      centers: [{ at: 'node:R/D', cid: 'cd', dir: 'right', x: 0, y: 140 }],
      edges: [{ from: 'node:根/D 岛', to: 'node:根/other', rel: 'x' }],
    },
  };
  const layoutRoot: EditableNode = { ...root, children: [other] };
  const layout = layoutForest(
    [
      { node: layoutRoot, dir: 'right', pos: { x: 0, y: 0 } },
      { node: d, dir: 'right', pos: { x: 0, y: 140 } },
    ],
    createNodeMeasure(char, new Map()),
    new Set(),
  );
  return { layout, root, d, otherId: other.id };
}

function mountTrio() {
  const f = trioFixture();
  return mount(
    f,
    {
      centerIds: new Set([f.d.id]),
      islandMembers: new Map<string, string[]>([
        [f.root.id, [f.root.id, f.otherId]],
        [f.d.id, [f.d.id]],
      ]),
    },
    { sized: true },
  );
}

// ---------------- 夹具 C：父岛（Section）+ 嵌套迷你 + 外部岛（FE-FRAME-1.1） ----------------

/**
 * 三岛 + 卫星成员：R ── P（含 p1、C）── C（含 c1）；D 独立。
 * P / C / D 均升格中心（nested 表 P→[C]）；P / C 各挂 Section。
 *
 * 卫星 sT / sB / sR 是 P 的岛表成员（无内容树语义，仅为几何服务）——把父卡 AABB 从
 * **四向**撑到迷你框之外，使「贴迷你 ≠ 贴父卡」的判别在任一端点侧都有 > 5 的余量。
 *
 * 自由边 e0：c1（C 侧成员，cid:c9）↔ D（cid:cd）。
 * - 近景：c1 同属父/子两条 Section 成员清单 → F3 取面积最小者（sec_c）→ 贴子框缘；
 * - 总览：迷你卡（C）在父卡（P）之前注册 → F5 迷你优先 → 该端贴**迷你 VM bounds**
 *   （不是父卡 bounds；图层 placed 屏稳放大不在锚点口径内，见 IO-2 已知边界）。
 */
function miniFixture() {
  const c1: EditableNode = { ...makeTextNode('c1'), note: { cid: 'c9' } };
  const c: EditableNode = { ...makeTextNode('C 岛', [c1]), note: { cid: 'c8' } };
  const p1 = makeTextNode('p1');
  const p: EditableNode = { ...makeTextNode('P 岛', [p1, c]), note: { cid: 'c7' } };
  const d: EditableNode = { ...makeTextNode('D 岛'), note: { cid: 'cd' } };
  const sT = makeTextNode('sT');
  const sB = makeTextNode('sB');
  const sR = makeTextNode('sR');
  const other = makeTextNode('other');
  const root: EditableNode = {
    ...makeTextNode('根', [p, d, other]),
    note: {
      sections: [
        { id: 'sec_p', title: '父岛区', root: 'cid:c7', color: 'blue' },
        { id: 'sec_c', title: '子岛区', root: 'cid:c8', color: 'rose' },
      ],
      centers: [
        { at: 'node:R/P', cid: 'c7', dir: 'right', x: -520, y: 0 },
        { at: 'node:R/P/C', cid: 'c8', dir: 'right', x: 0, y: 0 },
        { at: 'node:R/D', cid: 'cd', dir: 'right', x: -900, y: 0 },
      ],
      edges: [{ from: 'cid:c9', to: 'cid:cd', rel: 'relates-to' }],
    },
  };
  // 投影视图：P 从 R 摘出、C 从 P 摘出（projectIslands 语义）；卫星与 D 各自独立落点。
  const layout = layoutForest(
    [
      { node: { ...root, children: [other] }, dir: 'right', pos: { x: 0, y: -420 } },
      { node: { ...p, children: [p1] }, dir: 'right', pos: { x: -520, y: 0 } },
      { node: c, dir: 'right', pos: { x: 0, y: 0 } },
      { node: sT, dir: 'right', pos: { x: 0, y: -210 } },
      { node: sB, dir: 'right', pos: { x: 0, y: 210 } },
      { node: sR, dir: 'right', pos: { x: 300, y: 0 } },
      { node: d, dir: 'right', pos: { x: -900, y: 0 } },
    ],
    createNodeMeasure(char, new Map()),
    new Set(),
  );
  const centerSet = new Set([p.id, c.id, d.id]);
  const members = new Map<string, string[]>([
    [root.id, [root.id, other.id]],
    [p.id, [p.id, p1.id, sT.id, sB.id, sR.id]],
    [c.id, [c.id, c1.id]],
    [d.id, [d.id]],
  ]);
  const nested = new Map<string, string[]>([
    [p.id, [c.id]],
    [c.id, []],
    [d.id, []],
  ]);
  return { layout, root, p, c, d, c1Id: c1.id, p1Id: p1.id, otherId: other.id, centerSet, members, nested };
}

function mountMini() {
  const f = miniFixture();
  return mount(
    f,
    {
      centerIds: f.centerSet,
      islandMembers: f.members,
      nestedCenterIdsByRoot: f.nested,
    },
    { sized: true },
  );
}

// ---------------- DOM 几何读取 ----------------

/** Section 框渲染矩形（SectionLayer 首个 rect = frame body，x/y/w/h = bounds 原值） */
function frameRectOf(container: HTMLElement, sectionId: string): Box {
  const g = container.querySelector(`g[data-section-id="${sectionId}"]`);
  const rect = g?.querySelector('rect');
  if (!rect) throw new Error(`frame ${sectionId} not rendered`);
  return {
    x: Number(rect.getAttribute('x')),
    y: Number(rect.getAttribute('y')),
    w: Number(rect.getAttribute('width')),
    h: Number(rect.getAttribute('height')),
  };
}

function pathDOf(container: HTMLElement, edgeKey: string): string {
  const p = container.querySelector(`[data-free-edge="${edgeKey}"] path`);
  const d = p?.getAttribute('d') ?? '';
  if (d === '') throw new Error(`path for ${edgeKey} not rendered`);
  return d;
}

const NUM_RE = /-?\d+(?:\.\d+)?/g;

/** path 起点（M 段 = 头两个数字） */
function startOf(d: string): { x: number; y: number } {
  const nums = d.match(NUM_RE) ?? [];
  if (nums.length < 2) throw new Error(`bad d: ${d}`);
  return { x: Number(nums[0]), y: Number(nums[1]) };
}

/** path 终点（末对坐标） */
function endOf(d: string): { x: number; y: number } {
  const nums = d.match(NUM_RE) ?? [];
  if (nums.length < 2) throw new Error(`bad d: ${d}`);
  return { x: Number(nums[nums.length - 2]), y: Number(nums[nums.length - 1]) };
}

/**
 * 点到矩形**边界**的距离：盒外 = 到矩形距离；盒内（含边界）= 到最近边的距离。
 * 锚点落在盒缘（Section 语义锚 / 12 候选锚点均取边点）→ 期望值 ≈ 0。
 */
function boundaryDistance(p: { x: number; y: number }, b: Box): number {
  const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.w));
  const dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.h));
  if (dx > 0 || dy > 0) return Math.hypot(dx, dy);
  return Math.min(p.x - b.x, b.x + b.w - p.x, p.y - b.y, b.y + b.h - p.y);
}

/** 渲染变换里的 k（`translate(x y) scale(k)`） */
function scaleK(container: HTMLElement): number {
  const t = container.querySelector('svg > g[transform]')?.getAttribute('transform') ?? '';
  const m = /scale\(([-\d.]+)\)/.exec(t);
  if (!m) throw new Error(`fixture broken: no scale in "${t}"`);
  return Number(m[1]);
}

describe('FE-FRAME-1 近景：跨 Section 贴框', () => {
  it('跨岛边 e0 两端分别落在各自 Section 框缘（M 起点 / 末点在框边界上）', async () => {
    const s = mountSectioned();
    await flushFrames();

    // 夹具有效性：两个 Section 框都渲染 + 两条自由边都在场
    const rootFrame = frameRectOf(s.container, 'sec_root');
    const cFrame = frameRectOf(s.container, 'sec_c');
    expect(s.container.querySelectorAll('[data-free-edge]').length).toBe(2);

    const d0 = pathDOf(s.container, 'e0');
    const p0 = startOf(d0); // from 端 = other（根区）
    const p3 = endOf(d0); // to 端 = C 岛（C 区）
    expect(boundaryDistance(p0, rootFrame)).toBeLessThan(0.75);
    expect(boundaryDistance(p3, cFrame)).toBeLessThan(0.75);
    // 判别力：端点确实在各自框缘（而非框内深处）
    expect(boundaryDistance(p0, cFrame)).toBeGreaterThan(0.75);
  });

  it('同 Section 边 e1 不提升：端点不在任何框缘上（对照）', async () => {
    const s = mountSectioned();
    await flushFrames();

    const rootFrame = frameRectOf(s.container, 'sec_root');
    const cFrame = frameRectOf(s.container, 'sec_c');
    expect(s.container.querySelectorAll('[data-free-edge]').length).toBe(2);

    const p0 = startOf(pathDOf(s.container, 'e1')); // from 端 = 根（根区）
    // 若错误提升 → 端点会落到框缘（≈0）；正确行为 = 留在节点盒（框内，距框缘有 padding 余量）
    expect(boundaryDistance(p0, rootFrame)).toBeGreaterThan(5);
    expect(boundaryDistance(p0, cFrame)).toBeGreaterThan(5);
  });
});

describe('FE-FRAME-1 远观：无 Section 岛贴总览卡', () => {
  it('近景贴节点盒 → 缩进总览后贴卡缘（前后对照）', async () => {
    const s = mountTrio();
    // 等尺寸就绪 + 首次 fit 落定，再读 k 折算缩放比
    await waitFor(() => {
      expect(s.container.querySelector('svg')?.getAttribute('width')).toBe('800');
    });
    await flushFrames();

    const layoutBoxOf = (id: string): Box | undefined =>
      s.layout.nodes.find((ln) => ln.node.id === id)?.box;
    const dBox = layoutBoxOf(s.d.id);
    expect(dBox).toBeDefined();
    const cardBounds = overviewBoundsOf([s.d.id], layoutBoxOf);
    expect(cardBounds).toBeDefined();

    // ① 近景（总览未激活）：D 无 Section → e0 起点仍在 D 节点盒缘
    expect(s.container.querySelector('[data-island-overview]')).toBeNull();
    const p0Near = startOf(pathDOf(s.container, 'e0'));
    expect(boundaryDistance(p0Near, dBox!)).toBeLessThan(0.75);

    // ② 缩到 k=0.2（< K_OVERVIEW）：D 岛出卡 → e0 起点改贴卡缘（卡缘 ≠ 节点盒缘，padding 距离）
    const kNow = scaleK(s.container);
    act(() => s.apiRef.current!.zoomBy(0.2 / kNow));
    await waitFor(() => {
      expect(scaleK(s.container)).toBeLessThan(K_OVERVIEW);
      expect(s.container.querySelector(`[data-island-overview="${s.d.id}"]`)).not.toBeNull();
    });
    await flushFrames();

    const p0Far = startOf(pathDOf(s.container, 'e0'));
    expect(boundaryDistance(p0Far, cardBounds!)).toBeLessThan(0.75);
    expect(boundaryDistance(p0Far, dBox!)).toBeGreaterThan(5);
  });
});

describe('FE-FRAME-1.1 远观：迷你卡 × 跨岛自由边（贴迷你，不贴父卡）', () => {
  it('近景贴子 Section 框 → 缩进总览后该端改贴迷你 VM bounds（非父卡 bounds）', async () => {
    const s = mountMini();
    await waitFor(() => {
      expect(s.container.querySelector('svg')?.getAttribute('width')).toBe('800');
    });
    await flushFrames();

    const boxOf = (id: string): Box | undefined =>
      s.layout.nodes.find((ln) => ln.node.id === id)?.box;

    // 夹具有效性：父 / 子两条 Section 框在场；近景不存在总览卡
    const secC = frameRectOf(s.container, 'sec_c');
    expect(frameRectOf(s.container, 'sec_p')).toBeDefined();
    expect(s.container.querySelector(`[data-island-overview-nested="${s.c.id}"]`)).toBeNull();

    // ① 近景：c1 端贴**子 Section 框缘**（F1；F3 同属父/子框 → 取面积最小者）
    const nearD = pathDOf(s.container, 'e0');
    const p0Near = startOf(nearD);
    expect(boundaryDistance(p0Near, secC)).toBeLessThan(0.75);
    // 判别力：端点确实在子框缘（父框更大，非同一矩形）
    expect(boundaryDistance(p0Near, frameRectOf(s.container, 'sec_p'))).toBeGreaterThan(5);
    // D 端无 Section → 仍在 D 节点盒缘（基线）
    const dBox = boxOf(s.d.id);
    expect(dBox).toBeDefined();
    expect(boundaryDistance(endOf(nearD), dBox!)).toBeLessThan(0.75);

    // ② 缩到 k < K_OVERVIEW：迷你卡出现 → c1 端改贴迷你卡 VM bounds（不是父卡 bounds）
    const kNow = scaleK(s.container);
    act(() => s.apiRef.current!.zoomBy(0.2 / kNow));
    await waitFor(() => {
      expect(scaleK(s.container)).toBeLessThan(K_OVERVIEW);
      expect(s.container.querySelector(`[data-island-overview-nested="${s.c.id}"]`)).not.toBeNull();
    });
    await flushFrames();

    // VM bounds 复算（与建卡同源公式；图层 placed 屏稳放大不在锚点口径内）
    const cards = buildIslandOverviewCards({
      centerIds: s.centerSet,
      membersByRoot: s.members,
      nestedCenterIdsByRoot: s.nested,
      boxOf,
      titleOf: (id) => id,
    });
    const pCard = cards.find((card) => card.rootId === s.p.id);
    const mini = pCard?.nestedCards?.find((m) => m.rootId === s.c.id);
    const dCard = cards.find((card) => card.rootId === s.d.id);
    expect(mini, 'fixture broken: 迷你卡未产出（overviewBoundsOf 无盒？）').toBeDefined();
    expect(pCard).toBeDefined();
    expect(dCard).toBeDefined();

    // 父卡 / D 卡在场（判别与断言的场景有效性）
    expect(s.container.querySelector(`[data-island-overview="${s.p.id}"]`)).not.toBeNull();
    expect(s.container.querySelector(`[data-island-overview="${s.d.id}"]`)).not.toBeNull();

    const farD = pathDOf(s.container, 'e0');
    const p0Far = startOf(farD);
    expect(boundaryDistance(p0Far, mini!.bounds)).toBeLessThan(0.75);
    // 判别力：迷你缘与父卡缘四向都有余量 —— 若锚到父卡（迷你优先顺序被破坏）此处必红
    expect(boundaryDistance(p0Far, pCard!.bounds)).toBeGreaterThan(5);
    // D 端：D 有卡 → 贴 D 卡 VM bounds
    expect(boundaryDistance(endOf(farD), dCard!.bounds)).toBeLessThan(0.75);
  });
});
