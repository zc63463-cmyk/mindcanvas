// @vitest-environment jsdom
/**
 * IO-1 集成：总览档真的控制了 DOM 与交互（设计 §6 测试计划 + §8 成功标准）。
 *
 * 夹具 = 双岛文档（根岛 R + 升格中心岛 C），C 上挂 Section「摩擦分析」与一条跨岛父子梁：
 * - 缩到 k < 0.35：出现 `data-island-overview` 卡（标题 = Section.title）；
 *   两岛成员 `data-node-id` 全部消失；岛内树边消失；`data-boundary-link` 仍在；
 *   C 的 Section 标题栏让位（D10 不双标题）；
 * - 放大回 k ≥ 0.35：卡消失、节点与 Section chrome 恢复（无残留）；
 * - 标题带拖拽 = 中心拖（onCenterMove 恰一次 + 整岛实时预览跟随）；
 * - 双击卡 = 聚焦进岛（k 上升越过阈值 → 总览退出）。
 */
import { describe, expect, it, vi } from 'vitest';
import { afterEach } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { layoutForest, makeTextNode, type EditableNode } from '@mindcanvas/kernel';
import type { RefObject } from 'react';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView, type MapViewApi } from '../src/render/MapView.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';
import { K_OVERVIEW } from '../src/render/islandOverview.js';

afterEach(() => cleanup());

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

/**
 * 文档树：R ── C（含 c1）── other；C 升格为中心（cid:c7）→ 投影为独立岛。
 * 布局树 = 投影后的视图（C 已从 root 摘出）；documentRoot 仍是完整树（cid 锚解析走它）。
 * 坐标贴原点：jsdom 无布局引擎 → 可见世界矩形仅靠 CULL_MARGIN(128) 撑开。
 */
function fixture() {
  const c1 = makeTextNode('c1');
  const c: EditableNode = { ...makeTextNode('C 岛', [c1]), note: { cid: 'c7' } };
  const other = makeTextNode('other');
  const root: EditableNode = {
    ...makeTextNode('根', [c, other]),
    note: {
      sections: [{ id: 'sec_io', title: '摩擦分析', root: 'cid:c7', color: 'blue' }],
      centers: [{ at: 'node:R/C', cid: 'c7', dir: 'right', x: 40, y: 0 }],
    },
  };
  const layoutRoot: EditableNode = { ...root, children: [other] };
  const layout = layoutForest(
    [
      { node: layoutRoot, dir: 'right', pos: { x: 0, y: 0 } },
      { node: c, dir: 'right', pos: { x: 40, y: 0 } },
    ],
    createNodeMeasure(char, new Map()),
    new Set(),
  );
  return { layout, root, c, c1Id: c1.id, otherId: other.id };
}

type Fixture = ReturnType<typeof fixture>;

/**
 * IO-2 夹具：三岛文档 R ── P（含 p1、C）── C（含 c1）。
 * 内容树：R > P > { p1, C > c1 }；P、C 均升格中心 → P 是 C 的内容树祖先（nested 表 P→[C]）。
 * 两层 Section（父岛区 / 子岛区）用于验证迷你标题 = 子 Section.title。
 */
function nestedFixture() {
  const c1 = makeTextNode('c1');
  const c: EditableNode = { ...makeTextNode('C 岛', [c1]), note: { cid: 'c8' } };
  const p1 = makeTextNode('p1');
  const p: EditableNode = { ...makeTextNode('P 岛', [p1, c]), note: { cid: 'c7' } };
  const other = makeTextNode('other');
  const root: EditableNode = {
    ...makeTextNode('根', [p, other]),
    note: {
      sections: [
        { id: 'sec_p', title: '父岛区', root: 'cid:c7', color: 'blue' },
        { id: 'sec_c', title: '子岛区', root: 'cid:c8', color: 'rose' },
      ],
      centers: [
        { at: 'node:R/P', cid: 'c7', dir: 'right', x: 0, y: 160 },
        { at: 'node:R/P/C', cid: 'c8', dir: 'right', x: 60, y: 210 },
      ],
    },
  };
  // 投影视图：P 从 R 摘出、C 从 P 摘出（projectIslands 语义）
  const layoutRoot: EditableNode = { ...root, children: [other] };
  const pView: EditableNode = { ...p, children: [p1] };
  const layout = layoutForest(
    [
      { node: layoutRoot, dir: 'right', pos: { x: 0, y: 0 } },
      { node: pView, dir: 'right', pos: { x: 0, y: 160 } },
      { node: c, dir: 'right', pos: { x: 60, y: 210 } },
    ],
    createNodeMeasure(char, new Map()),
    new Set(),
  );
  return { layout, root, p, c, p1Id: p1.id, c1Id: c1.id, otherId: other.id };
}

/** IO-2 装配：三岛成员表 + nested 表（P→[C]），其余走 mount 默认 */
function mountNested(
  over: Partial<React.ComponentProps<typeof MapView>> = {},
  opts: { sized?: boolean } = {},
) {
  const f = nestedFixture();
  return mount(
    f,
    {
      centerIds: new Set([f.p.id, f.c.id]),
      islandMembers: new Map<string, string[]>([
        [f.root.id, [f.root.id, f.otherId]],
        [f.p.id, [f.p.id, f.p1Id]],
        [f.c.id, [f.c.id, f.c1Id]],
      ]),
      nestedCenterIdsByRoot: new Map<string, string[]>([
        [f.p.id, [f.c.id]],
        [f.c.id, []],
      ]),
      ...over,
    },
    opts,
  );
}

function mount<F extends Fixture>(
  f: F,
  over: Partial<React.ComponentProps<typeof MapView>> = {},
  opts: { sized?: boolean } = {},
) {
  const apiRef: RefObject<MapViewApi | null> = { current: null };
  const onCenterMove = vi.fn();
  // 尺寸就绪模拟（jsdom 无 ResizeObserver）：仅聚焦用例需要真实视口宽高
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
          centerIds={new Set([f.c.id])}
          islandMembers={
            new Map<string, string[]>([
              [f.root.id, [f.root.id, f.otherId]],
              [f.c.id, [f.c.id, f.c1Id]],
            ])
          }
          boundaryLinks={[{ fromId: f.root.id, toId: f.c.id }]}
          onCenterMove={onCenterMove}
          {...over}
        />
      </ThemeProvider>,
    );
    return { container, apiRef, onCenterMove, ...f };
  } finally {
    if (opts.sized) w.ResizeObserver = prev;
  }
}

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

/** 渲染变换里的 k（`translate(x y) scale(k)`） */
function scaleK(container: HTMLElement): number {
  const t = container.querySelector('svg > g[transform]')?.getAttribute('transform') ?? '';
  const m = /scale\(([-\d.]+)\)/.exec(t);
  if (!m) throw new Error(`fixture broken: no scale in "${t}"`);
  return Number(m[1]);
}

const cardOf = (c: HTMLElement, id: string): Element | null =>
  c.querySelector(`[data-island-overview="${id}"]`);

function wheelOf(container: HTMLElement): HTMLElement {
  return container.querySelector('div[style*="touch-action"]') as HTMLElement;
}

/** 缩到 k=0.2（< K_OVERVIEW；不触发 ZOOM_MIN 回弹 → k 稳定可断言） */
function zoomBelowThreshold(s: ReturnType<typeof mount>): void {
  const kNow = scaleK(s.container);
  act(() => s.apiRef.current!.zoomBy(0.2 / kNow));
}

describe('IO-1：k<0.35 + 有岛 → 总览档 DOM 切换', () => {
  it('进入总览：卡出现、成员 NodeG/岛内树边消失、boundaryLinks 保留、Section 让位', async () => {
    const s = mount(fixture());
    const linkPaths = () =>
      s.container.querySelector('[data-layer="tree-links"]')?.querySelectorAll('path').length ?? 0;
    // k=1：既有渲染——两条岛内树边 + 一条跨岛梁；无总览层
    expect(cardOf(s.container, s.c.id)).toBeNull();
    expect(s.container.querySelectorAll('[data-node-id]').length).toBe(4);
    expect(linkPaths()).toBe(3);
    expect(s.container.querySelector('g[data-section-titlebar]')).not.toBeNull();

    zoomBelowThreshold(s);
    await waitFor(() => {
      expect(scaleK(s.container)).toBeLessThan(K_OVERVIEW);
      expect(cardOf(s.container, s.c.id)).not.toBeNull();
    });

    // ① 每岛一卡（根岛 + 中心岛），标题 = Section.title（D3）
    expect(s.container.querySelectorAll('[data-island-overview]').length).toBe(2);
    expect(cardOf(s.container, s.c.id)?.textContent).toContain('摩擦分析');
    expect(cardOf(s.container, s.c.id)?.getAttribute('data-member-count')).toBe('2');
    expect(cardOf(s.container, s.root.id)?.getAttribute('data-member-count')).toBe('2');
    // ② 岛内成员 NodeG 全部隐藏（含中心本体卡）
    expect(s.container.querySelectorAll('[data-node-id]').length).toBe(0);
    // ③ 岛内树边消失，跨岛梁保留（成功标准 §8-2）
    expect(linkPaths()).toBe(1);
    expect(s.container.querySelector('[data-boundary-link]')).not.toBeNull();
    // ④ D10：有卡的 root 不再画 Section chrome（避免双标题）
    expect(s.container.querySelector('g[data-section-titlebar]')).toBeNull();
  });

  it('放大回 k≥0.35：总览层不残留、节点与 Section chrome 恢复（成功标准 §8-5）', async () => {
    const s = mount(fixture());
    zoomBelowThreshold(s);
    await waitFor(() => {
      expect(cardOf(s.container, s.c.id)).not.toBeNull();
    });

    act(() => s.apiRef.current!.zoomBy(20)); // k → 进入 full 档
    await waitFor(() => {
      expect(cardOf(s.container, s.c.id)).toBeNull();
      expect(s.container.querySelector(`[data-node-id="${s.c.id}"]`)).not.toBeNull();
    });
    expect(s.container.querySelectorAll('[data-island-overview]').length).toBe(0);
    expect(s.container.querySelector('g[data-section-titlebar]')).not.toBeNull();
    expect(s.container.querySelectorAll('[data-node-id]').length).toBe(4);
  });

  it('无中心岛（文档未升格）：k 再低也不进总览（D2）', async () => {
    const f = fixture();
    const s = mount(f, { centerIds: new Set(), islandMembers: new Map() });
    zoomBelowThreshold(s);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(s.container.querySelectorAll('[data-island-overview]').length).toBe(0);
    expect(s.container.querySelectorAll('[data-node-id]').length).toBe(4);
  });
});

describe('IO-1：总览卡交互', () => {
  it('标题带拖拽 = 中心拖：整岛实时预览 + onCenterMove 恰一次（世界位移）', async () => {
    const s = mount(fixture());
    zoomBelowThreshold(s);
    await waitFor(() => {
      expect(cardOf(s.container, s.c.id)).not.toBeNull();
    });
    const titlebar = s.container.querySelector(
      `[data-island-overview-titlebar="${s.c.id}"]`,
    ) as SVGGElement | null;
    expect(titlebar).not.toBeNull();
    const bodyX = () =>
      s.container.querySelector(`[data-island-overview-body="${s.c.id}"]`)?.getAttribute('x');
    const before = bodyX();

    fireEvent.pointerDown(titlebar!, { pointerId: 1, bubbles: true });
    fireEvent.pointerMove(wheelOf(s.container), {
      clientX: 12,
      clientY: 8,
      pointerId: 1,
      bubbles: true,
    });
    fireEvent.pointerMove(wheelOf(s.container), {
      clientX: 40,
      clientY: 25,
      pointerId: 1,
      bubbles: true,
    });
    // 拖动中：卡 bounds 跟随中心预览偏移（整岛跟移，非仅标题）
    expect(bodyX()).not.toBe(before);
    fireEvent.pointerUp(wheelOf(s.container), {
      clientX: 40,
      clientY: 25,
      pointerId: 1,
      bubbles: true,
    });

    expect(s.onCenterMove).toHaveBeenCalledTimes(1);
    // k=0.2 → 世界位移 = 屏幕位移 / k
    expect(s.onCenterMove).toHaveBeenCalledWith(s.c.id, 40 / 0.2, 25 / 0.2);
  });

  it('双击卡 = 聚焦进岛：k 上升越过阈值 → 总览退出（成功标准 §8-4）', async () => {
    const s = mount(fixture(), {}, { sized: true });
    // 等尺寸就绪（svg width=800）+ 首次 fit 落定，再读当前 k 折算缩放比——
    // 否则 fit 会异步覆盖掉「在 k=1 上算出的」缩放比（实测 3.28 覆盖 0.2）。
    await waitFor(() => {
      expect(s.container.querySelector('svg')?.getAttribute('width')).toBe('800');
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    zoomBelowThreshold(s);
    await waitFor(() => {
      expect(scaleK(s.container)).toBeLessThan(K_OVERVIEW);
      expect(cardOf(s.container, s.c.id)).not.toBeNull();
    });

    const card = cardOf(s.container, s.c.id) as Element;
    fireEvent.dblClick(card, { bubbles: true, cancelable: true });

    await waitFor(() => {
      expect(scaleK(s.container)).toBeGreaterThan(K_OVERVIEW);
      expect(cardOf(s.container, s.c.id)).toBeNull();
    });
  });
});

/** 取 SVG 矩形的数值盒（N3 钳制断言用） */
function numBox(container: HTMLElement, sel: string) {
  const el = container.querySelector(sel);
  if (!el) throw new Error(`fixture broken: missing ${sel}`);
  return {
    x: Number(el.getAttribute('x')),
    y: Number(el.getAttribute('y')),
    w: Number(el.getAttribute('width')),
    h: Number(el.getAttribute('height')),
  };
}

describe('IO-2：父卡内一级迷你子卡（§9 N1–N6）', () => {
  it('迷你卡出现：顶层仍无子岛大卡、父卡 ⊞ 保留、迷你钳在父卡内（N2/N3/N6）', async () => {
    const s = mountNested();
    zoomBelowThreshold(s);
    await waitFor(() => {
      expect(s.container.querySelector(`[data-island-overview="${s.p.id}"]`)).not.toBeNull();
      expect(s.container.querySelector(`[data-island-overview-nested="${s.c.id}"]`)).not.toBeNull();
    });

    const mini = s.container.querySelector(`[data-island-overview-nested="${s.c.id}"]`);
    expect(mini?.getAttribute('data-parent-island')).toBe(s.p.id);
    expect(mini?.textContent).toContain('子岛区'); // 迷你标题 = 子 Section.title
    expect(mini?.getAttribute('data-member-count')).toBe('2'); // C ∪ c1
    // N2：顶层仍只有 R / P 两张卡（C 只作迷你，不出顶层大卡）
    expect(s.container.querySelectorAll('[data-island-overview]').length).toBe(2);
    expect(s.container.querySelector(`[data-island-overview="${s.c.id}"]`)).toBeNull();
    expect(s.container.querySelector(`[data-island-overview="${s.root.id}"]`)).not.toBeNull();
    // N6：父卡 ⊞ 角标仍在
    expect(
      s.container.querySelector(`[data-island-overview-nested-count="${s.p.id}"]`),
    ).not.toBeNull();
    // N3：迷你矩形落在父卡矩形内（屏稳最小尺寸撑大也须钳住）
    const parent = numBox(s.container, `[data-island-overview-body="${s.p.id}"]`);
    const inner = numBox(s.container, `[data-island-overview-mini-body="${s.c.id}"]`);
    expect(inner.x).toBeGreaterThanOrEqual(parent.x);
    expect(inner.y).toBeGreaterThanOrEqual(parent.y);
    expect(inner.x + inner.w).toBeLessThanOrEqual(parent.x + parent.w);
    expect(inner.y + inner.h).toBeLessThanOrEqual(parent.y + parent.h);
    expect(inner.w).toBeGreaterThan(0);
    expect(inner.h).toBeGreaterThan(0);
  });

  it('拖迷你标题 → onCenterMove 首参 = 子中心 id（恰一次；父中心零提交，N5）', async () => {
    const s = mountNested();
    zoomBelowThreshold(s);
    await waitFor(() => {
      expect(
        s.container.querySelector(`[data-island-overview-mini-titlebar="${s.c.id}"]`),
      ).not.toBeNull();
    });
    const titlebar = s.container.querySelector(
      `[data-island-overview-mini-titlebar="${s.c.id}"]`,
    ) as SVGGElement;

    fireEvent.pointerDown(titlebar, { pointerId: 1, bubbles: true });
    fireEvent.pointerMove(wheelOf(s.container), {
      clientX: 12,
      clientY: 8,
      pointerId: 1,
      bubbles: true,
    });
    fireEvent.pointerMove(wheelOf(s.container), {
      clientX: 40,
      clientY: 25,
      pointerId: 1,
      bubbles: true,
    });
    fireEvent.pointerUp(wheelOf(s.container), {
      clientX: 40,
      clientY: 25,
      pointerId: 1,
      bubbles: true,
    });

    expect(s.onCenterMove).toHaveBeenCalledTimes(1);
    expect(s.onCenterMove.mock.calls[0]?.[0]).toBe(s.c.id);
    expect(s.onCenterMove.mock.calls[0]?.[1]).toBeCloseTo(40 / 0.2);
    expect(s.onCenterMove.mock.calls[0]?.[2]).toBeCloseTo(25 / 0.2);
    // 拖子父不动：不得出现父中心的提交
    expect(s.onCenterMove.mock.calls.some((call: unknown[]) => call[0] === s.p.id)).toBe(false);
  });

  it('双击迷你 → 聚焦子岛并越阈退出总览（§9.3-3）', async () => {
    const s = mountNested({}, { sized: true });
    await waitFor(() => {
      expect(s.container.querySelector('svg')?.getAttribute('width')).toBe('800');
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    zoomBelowThreshold(s);
    await waitFor(() => {
      expect(scaleK(s.container)).toBeLessThan(K_OVERVIEW);
      expect(s.container.querySelector(`[data-island-overview-nested="${s.c.id}"]`)).not.toBeNull();
    });

    const mini = s.container.querySelector(`[data-island-overview-nested="${s.c.id}"]`) as Element;
    fireEvent.dblClick(mini, { bubbles: true, cancelable: true });

    await waitFor(() => {
      expect(scaleK(s.container)).toBeGreaterThan(K_OVERVIEW);
      expect(s.container.querySelector(`[data-island-overview-nested="${s.c.id}"]`)).toBeNull();
    });
  });
});

describe('IO-UX2：标题剪裁（省略号收尾 + 动态徽章预留）', () => {
  it('超长标题以「…」收尾（回归钉：不再被 clipPath 硬裁半字）；短标题卡保持原文', async () => {
    const f = fixture();
    // 覆盖 C 的 Section 标题为超长串（layout 不变；Section 解析走 documentRoot）
    const root: EditableNode = {
      ...f.root,
      note: {
        ...f.root.note,
        sections: [
          {
            id: 'sec_io',
            title: '这是一个非常长的章节标题用于验证省略号截断在远观总览卡上生效',
            root: 'cid:c7',
            color: 'blue',
          },
        ],
      },
    };
    const s = mount({ ...f, root });
    zoomBelowThreshold(s);
    await waitFor(() => {
      expect(cardOf(s.container, s.c.id)).not.toBeNull();
    });

    // 可见标题（标题带内的 text，排除 body <title> tooltip 全文）以「…」收尾
    const longTitle = s.container.querySelector(
      `[data-island-overview-titlebar="${s.c.id}"] text`,
    )?.textContent;
    expect(longTitle).not.toBeUndefined();
    expect(longTitle?.endsWith('…')).toBe(true);
    // 短标题卡（根岛：节点文本「根」）保持原文、不追加省略号
    const shortTitle = s.container.querySelector(
      `[data-island-overview-titlebar="${s.root.id}"] text`,
    )?.textContent;
    expect(shortTitle).toBe('根');
  });
});
