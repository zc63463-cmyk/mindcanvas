// @vitest-environment jsdom
/**
 * v1.5.0 T4：Section 标题栏拖拽 —— 接管 center 拖拽管线（D1：Section ⇒ center）。
 *
 * 语义等价性（这是本测试的核心断言）：拖 Section 标题栏 ≡ 按住其 root 中心节点本体。
 * 因此复用 mapview-center-drag 的三条硬约束：
 * - 拖动中整岛（root + 全部成员）同步偏移，非仅标题栏
 * - pointerup 恰一次 onCenterMove（世界位移）
 * - Esc / pointercancel → 预览复原、onCenterMove 零调用（取消不写文档）
 *
 * 另含 D1 守卫：root 不在 centerIds 中 → 不启动拖拽（否则会退化为节点重排，语义错误）。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { astToEditable, layoutForest, makeTextNode, type EditableNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView } from '../src/render/MapView.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

/**
 * 文档树：R ── C（含 c1）── other。
 * C 被升格为中心（center 条目带 cid:c7，节点 note.cid='c7'）→ 投影为独立岛。
 * 根 note.sections 用 `cid:c7` 锚定 C 子树（写入侧一律 cid，此处直接构造解析前形状）。
 *
 * 关键：center 是**文档树内的节点**（projectIslands 把它提出来），
 * 而非与根并列的独立树——否则 buildCidIndex 走不到它，锚退化为 dangling。
 *
 * 坐标贴原点：jsdom 无布局引擎 → viewport 恒为 1×1，可见世界矩形仅靠 CULL_MARGIN(128)
 * 撑开。Section 帧走 isBoxInView 自裁剪，故成员必须落在 |x|,|y| ≲ 128 内才可见
 * （与 mapview-center-drag 的 fixture 同一约束）。
 */
function fixture(withSection: boolean, withCenter: boolean) {
  const c1 = makeTextNode('c1');
  const c: EditableNode = { ...makeTextNode('C', [c1]), note: { cid: 'c7' } };
  const other = makeTextNode('other');
  const root: EditableNode = {
    ...makeTextNode('R', [c, other]),
    note: {
      ...(withSection
        ? { sections: [{ id: 'sec_t4', title: '摩擦分析', root: 'cid:c7', color: 'blue' }] }
        : {}),
      ...(withCenter
        ? { centers: [{ at: 'node:R/C', cid: 'c7', dir: 'right', x: 40, y: 0 }] }
        : {}),
    },
  };
  // 布局树 = 投影后的视图：c 已从 root 摘出（projectIslands 语义），只作为独立岛存在。
  // documentRoot 仍是完整树（含 c）——cid 锚解析与标题/成员缓存走它；若两份混用同一对象，
  // c 子树会在 layout.nodes 里出现两次 → React 重复 key 警告（节点与边各重复一对）。
  const layoutRoot: EditableNode = { ...root, children: [other] };
  const layout = layoutForest(
    [
      { node: layoutRoot, dir: 'right', pos: { x: 0, y: 0 } },
      { node: c, dir: 'right', pos: { x: 40, y: 0 } },
    ],
    createNodeMeasure(char, new Map()),
    new Set(),
  );
  return {
    layout,
    root,
    c,
    c1Id: c1.id,
    otherId: other.id,
    centerSet: withCenter ? new Set([c.id]) : new Set<string>(),
  };
}

type CenterMoveFn = (id: string, worldDx: number, worldDy: number) => void;

function setup(
  opts: {
    withSection?: boolean;
    withCenter?: boolean;
    onCenterMove?: CenterMoveFn;
    /** NEST-CONTAIN-1：模拟 MindmapStage 无中心恒传「空岛表」的形态 */
    emptyIslandMaps?: boolean;
  } = {},
) {
  const { withSection = true, withCenter = true, onCenterMove = vi.fn(), emptyIslandMaps = false } = opts;
  const f = fixture(withSection, withCenter);
  const members = new Map<string, string[]>([
    [f.root.id, [f.root.id, f.otherId]],
    [f.c.id, [f.c.id, f.c1Id]],
  ]);
  const { container } = render(
    <ThemeProvider>
      <MapView
        layout={f.layout}
        documentRoot={f.root}
        entities={new Map()}
        char={char}
        centerIds={f.centerSet}
        islandMembers={emptyIslandMaps ? new Map<string, string[]>() : members}
        nestedCenterIdsByRoot={emptyIslandMaps ? new Map<string, string[]>() : undefined}
        onCenterMove={onCenterMove}
      />
    </ThemeProvider>,
  );
  const titlebar = container.querySelector('g[data-section-titlebar]');
  const wheel = container.querySelector('div[style*="touch-action"]') as HTMLElement;
  return { container, wheel, titlebar, ...f, onCenterMove };
}

function transformOf(container: HTMLElement, id: string): string | null {
  return container.querySelector(`g[data-node-id="${id}"]`)?.getAttribute('transform') ?? null;
}

describe('T4：Section 标题栏拖拽 ≡ 中心节点拖拽（实时预览）', () => {
  it('Section 帧渲染出标题栏热区（D1 前置：有 Section 才有此行）', () => {
    const { titlebar } = setup();
    expect(titlebar).not.toBeNull();
  });

  it('标题栏 pointerdown + move → root 与全部成员同步偏移（整岛预览）', () => {
    const s = setup();
    const cBefore = transformOf(s.container, s.c.id);
    const c1Before = transformOf(s.container, s.c1Id);
    const titlebar = s.titlebar as SVGGElement;

    fireEvent.pointerDown(titlebar, { pointerId: 1, bubbles: true });
    fireEvent.pointerMove(s.wheel, { clientX: 10, clientY: 6, pointerId: 1, bubbles: true });
    fireEvent.pointerMove(s.wheel, { clientX: 30, clientY: 20, pointerId: 1, bubbles: true });

    // jsdom 恒等变换 k=1 → 世界位移 = 屏幕位移
    expect(transformOf(s.container, s.c.id)).not.toBe(cBefore);
    expect(transformOf(s.container, s.c1Id)).not.toBe(c1Before);
  });

  it('pointerup → onCenterMove 恰一次，参数为 (rootId, worldDx, worldDy)', () => {
    const onCenterMove = vi.fn();
    const s = setup({ onCenterMove });
    const titlebar = s.titlebar as SVGGElement;

    // 起点用 root 中心附近（手势层按世界位移，起点只需落在 wheel 上）
    fireEvent.pointerDown(titlebar, { pointerId: 1, bubbles: true });
    fireEvent.pointerMove(s.wheel, { clientX: 12, clientY: 8, pointerId: 1, bubbles: true });
    fireEvent.pointerMove(s.wheel, { clientX: 40, clientY: 25, pointerId: 1, bubbles: true });
    fireEvent.pointerUp(s.wheel, { clientX: 40, clientY: 25, pointerId: 1, bubbles: true });

    expect(onCenterMove).toHaveBeenCalledTimes(1);
    expect(onCenterMove).toHaveBeenCalledWith(s.c.id, 40, 25);
  });

  it('Esc → 预览复原、onCenterMove 零调用（取消不写文档）', () => {
    const onCenterMove = vi.fn();
    const s = setup({ onCenterMove });
    const cBefore = transformOf(s.container, s.c.id);
    const titlebar = s.titlebar as SVGGElement;

    fireEvent.pointerDown(titlebar, { pointerId: 1, bubbles: true });
    fireEvent.pointerMove(s.wheel, { clientX: 30, clientY: 20, pointerId: 1, bubbles: true });
    expect(transformOf(s.container, s.c.id)).not.toBe(cBefore);

    fireEvent.keyDown(window, { key: 'Escape', bubbles: true });
    expect(transformOf(s.container, s.c.id)).toBe(cBefore);
    expect(onCenterMove).not.toHaveBeenCalled();
  });

  it('pointercancel → 预览复原、零副作用', () => {
    const onCenterMove = vi.fn();
    const s = setup({ onCenterMove });
    const cBefore = transformOf(s.container, s.c.id);
    const titlebar = s.titlebar as SVGGElement;

    fireEvent.pointerDown(titlebar, { pointerId: 1, bubbles: true });
    fireEvent.pointerMove(s.wheel, { clientX: 30, clientY: 20, pointerId: 1, bubbles: true });
    fireEvent.pointerCancel(s.wheel, { pointerId: 1, bubbles: true });

    expect(transformOf(s.container, s.c.id)).toBe(cBefore);
    expect(onCenterMove).not.toHaveBeenCalled();
  });
});

describe('T4：D1 守卫 —— root 非 center 时不启动拖拽', () => {
  it('centerIds 为空 → pointerdown 标题栏不产生任何偏移（退化为无操作，不误作节点重排）', () => {
    const onCenterMove = vi.fn();
    const s = setup({ withCenter: false, onCenterMove });
    const cBefore = transformOf(s.container, s.c.id);
    const titlebar = s.titlebar as SVGGElement | null;

    // 无 center → 布局走单树路径，Section 帧仍渲染（root 锚按 cid 解析成功）
    if (titlebar) fireEvent.pointerDown(titlebar, { pointerId: 1, bubbles: true });
    fireEvent.pointerMove(s.wheel, { clientX: 60, clientY: 40, pointerId: 1, bubbles: true });
    fireEvent.pointerUp(s.wheel, { clientX: 60, clientY: 40, pointerId: 1, bubbles: true });

    expect(transformOf(s.container, s.c.id)).toBe(cBefore);
    expect(onCenterMove).not.toHaveBeenCalled();
  });
});

describe('T4 回归（NEST-CONTAIN-1）：无中心文档 + Section —— 空岛表不得吞掉内容树兜底', () => {
  it('islandMembers / nestedCenterIdsByRoot 均为空 Map（产品壳恒传形态）→ 框仍渲染且罩住 C 子树', () => {
    const s = setup({ withCenter: false, emptyIslandMaps: true });
    const group = s.container.querySelector('g[data-section-id="sec_t4"]');
    expect(group).not.toBeNull();
    const rect = group?.querySelector('rect');
    if (!rect) throw new Error('fixture broken: section frame rect missing');
    const num = (attr: string): number => Number(rect.getAttribute(attr));
    const frame = { x: num('x'), y: num('y'), w: num('width'), h: num('height') };
    const boxOf = (id: string) => {
      const n = s.layout.nodes.find((x) => x.node.id === id);
      if (n === undefined) throw new Error(`fixture broken: layout node ${id} missing`);
      return n.box;
    };
    // 成员兜底 = 内容树子树 [C, c1]；框必须罩住两者
    for (const id of [s.c.id, s.c1Id]) {
      const b = boxOf(id);
      expect(frame.x).toBeLessThanOrEqual(b.x);
      expect(frame.y).toBeLessThanOrEqual(b.y);
      expect(frame.x + frame.w).toBeGreaterThanOrEqual(b.x + b.w);
      expect(frame.y + frame.h).toBeGreaterThanOrEqual(b.y + b.h);
    }
  });
});
