// @vitest-environment jsdom
/**
 * ROOT-DRAG-1：根节点拖拽禁写 center 条目（静默升格后门修复）。
 *
 * 背景（2026-09-17 目视核查取证）：宿主 `centerIds` 取 `islandView.specs`（**刻意含虚拟根岛**，
 * 与布局同源），而「拖拽 = 移动坐标」的判定与 Section 标题栏拖起守卫此前都只看 centerIds →
 * 拖文档根节点本体 / 拖锚定根节点的 Section 标题，松手即由宿主 `handleCenterMove` 的
 * `upsertCenter` 兜底分支**新建根 center 条目** —— 等价于绕过 `planPromoteCenter` 的
 * is-root 守卫静默升格（总览「根区」卡由 2/无⊞ 变 9/⊞4）。
 *
 * 修复口径（任务书 §2）：
 * - 新增 `centerEntryIds` = **有 center 条目**的真实中心集合（宿主持有）；
 * - 拖起守卫 / 手势中心判定 / 预览门控统一改判该集合（缺省回退 centerIds，向后兼容）；
 * - 宿主 `handleCenterMove` 对无条目 id 直接跳过（兜底，零写入）。
 *
 * 本测以「宿主形态」装配：centerIds 含根岛根（模拟 specs），centerEntryIds 只含真实中心。
 * 先红（修复前：拖根会回调 onCenterMove）后绿。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { layoutForest, makeTextNode, type EditableNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView } from '../src/render/MapView.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

/**
 * 文档：根（cid:c0，挂「根区」Section）── C 岛（cid:c7，升格中心，挂「C 区」Section）── c1；
 * 另有未升格的 other 留在根岛。
 * 宿主形态：centerIds = {根, C}（specs 含虚拟根岛）；centerEntryIds = {C}。
 */
function fixture() {
  const c1 = makeTextNode('c1');
  const c: EditableNode = { ...makeTextNode('C 岛', [c1]), note: { cid: 'c7' } };
  const other = makeTextNode('other');
  const root: EditableNode = {
    ...makeTextNode('根', [c, other]),
    note: {
      cid: 'c0',
      sections: [
        { id: 'sec_root', title: '根区', root: 'cid:c0', color: 'slate' },
        { id: 'sec_c', title: 'C 区', root: 'cid:c7', color: 'rose' },
      ],
      centers: [{ at: 'node:R/C', cid: 'c7', dir: 'right', x: 40, y: 0 }],
    },
  };
  // 布局视图 = 投影后（C 已从根岛摘出）；坐标贴原点（jsdom 视口裁剪范围小）
  const layoutRoot: EditableNode = { ...root, children: [other] };
  const layout = layoutForest(
    [
      { node: layoutRoot, dir: 'right', pos: { x: 0, y: 0 } },
      { node: c, dir: 'right', pos: { x: 160, y: 0 } },
    ],
    createNodeMeasure(char, new Map()),
    new Set(),
  );
  return { layout, root, c, c1Id: c1.id, otherId: other.id };
}

type CenterMoveFn = (id: string, worldDx: number, worldDy: number) => void;

function setup(onCenterMove: CenterMoveFn) {
  const f = fixture();
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
        // 宿主形态：布局岛根（含虚拟根岛）+ 可拖中心（仅真实条目）
        centerIds={new Set([f.root.id, f.c.id])}
        centerEntryIds={new Set([f.c.id])}
        islandMembers={members}
        onCenterMove={onCenterMove}
      />
    </ThemeProvider>,
  );
  const wheel = container.querySelector('div[style*="touch-action"]') as HTMLElement;
  const nodeCenter = (text: string) => {
    const n = f.layout.nodes.find((x) => x.node.text === text)!;
    return { x: n.box.x + n.box.w / 2, y: n.box.y + n.box.h / 2 };
  };
  return { container, wheel, f, nodeCenter };
}

const transformOf = (container: HTMLElement, id: string): string | null =>
  container.querySelector(`g[data-node-id="${id}"]`)?.getAttribute('transform') ?? null;

/** 一次完整拖拽：按在 from 上，移动 (dx,dy)，抬起 */
function drag(
  from: Element | HTMLElement,
  wheel: HTMLElement,
  at: { x: number; y: number },
  dx: number,
  dy: number,
): void {
  fireEvent.pointerDown(from, { pointerId: 1, clientX: at.x, clientY: at.y, bubbles: true });
  fireEvent.pointerMove(wheel, { clientX: at.x + dx / 2, clientY: at.y + dy / 2, pointerId: 1, bubbles: true });
  fireEvent.pointerMove(wheel, { clientX: at.x + dx, clientY: at.y + dy, pointerId: 1, bubbles: true });
  fireEvent.pointerUp(wheel, { clientX: at.x + dx, clientY: at.y + dy, pointerId: 1, bubbles: true });
}

describe('ROOT-DRAG-1：虚拟根岛不可拖（零写入）', () => {
  it('拖「根区」Section 标题 → onCenterMove 零调用，根岛零偏移（不进入拖拽管线）', () => {
    const onCenterMove = vi.fn((_id: string, _dx: number, _dy: number) => {});
    const { container, wheel, f, nodeCenter } = setup(onCenterMove);
    const titlebar = container.querySelector('g[data-section-titlebar="sec_root"]');
    expect(titlebar).not.toBeNull(); // 夹具有效性：根区框已渲染

    const rootBefore = transformOf(container, f.root.id);
    drag(titlebar as SVGGElement, wheel, nodeCenter('根'), 40, 25);

    expect(onCenterMove).not.toHaveBeenCalled();
    expect(transformOf(container, f.root.id)).toBe(rootBefore); // 预览也未动
  });

  it('拖根节点本体 → onCenterMove 零调用，节点零偏移（落 pan 分支）', () => {
    const onCenterMove = vi.fn((_id: string, _dx: number, _dy: number) => {});
    const { container, wheel, f, nodeCenter } = setup(onCenterMove);
    const at = nodeCenter('根');
    const rootBefore = transformOf(container, f.root.id);

    drag(wheel, wheel, at, 40, 25);

    expect(onCenterMove).not.toHaveBeenCalled();
    expect(transformOf(container, f.root.id)).toBe(rootBefore);
  });
});

describe('ROOT-DRAG-1 对照：真实中心拖拽语义不变', () => {
  it('拖「C 区」Section 标题 → onCenterMove 恰一次（世界位移）', () => {
    const onCenterMove = vi.fn((_id: string, _dx: number, _dy: number) => {});
    const { container, wheel, f, nodeCenter } = setup(onCenterMove);
    const titlebar = container.querySelector('g[data-section-titlebar="sec_c"]');
    expect(titlebar).not.toBeNull();

    drag(titlebar as SVGGElement, wheel, nodeCenter('C 岛'), 40, 25);

    expect(onCenterMove).toHaveBeenCalledTimes(1);
    expect(onCenterMove.mock.calls[0]?.[0]).toBe(f.c.id);
    expect(onCenterMove.mock.calls[0]?.[1]).toBeCloseTo(40);
    expect(onCenterMove.mock.calls[0]?.[2]).toBeCloseTo(25);
  });

  it('拖真实中心节点本体 → onCenterMove 恰一次（isCenter 判据同源未破）', () => {
    const onCenterMove = vi.fn((_id: string, _dx: number, _dy: number) => {});
    const { container, wheel, f, nodeCenter } = setup(onCenterMove);
    const at = nodeCenter('C 岛');
    drag(wheel, wheel, at, 30, 20);

    expect(onCenterMove).toHaveBeenCalledTimes(1);
    expect(onCenterMove.mock.calls[0]?.[0]).toBe(f.c.id);
  });
});
