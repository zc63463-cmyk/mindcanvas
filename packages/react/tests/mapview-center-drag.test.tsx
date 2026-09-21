// @vitest-environment jsdom
/**
 * G6″ A4：中心岛拖动——实时整岛预览 + 取消路径（T10 / T11）。
 *
 * 覆盖：
 * - 拖动中岛内全部成员节点同步偏移（不是只动标题卡片）；无浮空克隆/置灰
 * - pointerup 一次提交（onCenterMove 恰一次，位移 = 屏幕位移 ÷ k；jsdom 恒等变换 k=1）
 * - Esc / pointercancel / blur → 预览清空、零副作用（onCenterMove 不被调用）
 * - 非中心节点拖拽不受影响（仍走浮空克隆）
 *
 * T12（缩放 0.5/1/2 换算）依赖真实 viewport 缩放，jsdom 恒等变换无法构造——
 * 归真实浏览器验收（plan A4：禁止只断言回调次数就声称拖动完成）。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { astToEditable, layoutForest, makeTextNode, type EditableNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView } from '../src/render/MapView.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

/**
 * 森林 fixture：根岛 R（含未升格的 other）+ 中心岛 C（含子 c1）。
 * C 升格 = 从根岛投影剔除；布局用两个 CenterSpec 直接构造（渲染层只消费布局结果）。
 */
function forestFixture(): { layout: ReturnType<typeof layoutForest>; r: EditableNode; c: EditableNode } {
  const c = makeTextNode('C', [makeTextNode('c1')]);
  const r = makeTextNode('R', [makeTextNode('other')]);
  const layout = layoutForest(
    [
      { node: r, dir: 'right', pos: { x: 0, y: 0 } },
      // jsdom 视口裁剪范围小：两岛贴近原点摆放，保证成员都在视口内
      { node: c, dir: 'right', pos: { x: 120, y: 0 } },
    ],
    createNodeMeasure(char, new Map()),
    new Set(),
  );
  return { layout, r, c };
}

function centerOf(l: ReturnType<typeof layoutForest>, text: string) {
  const n = l.nodes.find((x) => x.node.text === text)!;
  return { x: n.box.x + n.box.w / 2, y: n.box.y + n.box.h / 2, id: n.node.id };
}

type CenterMoveFn = (id: string, worldDx: number, worldDy: number) => void;

function setup(onCenterMove: CenterMoveFn) {
  const { layout, r, c } = forestFixture();
  const c1Id = layout.nodes.find((n) => n.node.text === 'c1')!.node.id;
  const otherId = layout.nodes.find((n) => n.node.text === 'other')!.node.id;
  const members = new Map<string, string[]>([
    [r.id, [r.id, otherId]],
    [c.id, [c.id, c1Id]],
  ]);
  const { container } = render(
    <ThemeProvider>
      <MapView
        layout={layout}
        entities={new Map()}
        char={char}
        centerIds={new Set([c.id])}
        islandMembers={members}
        onCenterMove={onCenterMove}
      />
    </ThemeProvider>,
  );
  const wheel = container.querySelector('div[style*="touch-action"]') as HTMLElement;
  const cPos = centerOf(layout, 'C');
  const otherPos = centerOf(layout, 'other');
  return { container, wheel, cPos, otherPos, cId: c.id, c1Id, otherId };
}

/** 节点 g 的 transform（NodeG 定位） */
function transformOf(container: HTMLElement, id: string): string | null {
  return container.querySelector(`g[data-node-id="${id}"]`)?.getAttribute('transform') ?? null;
}

describe('G6″ A4：中心岛拖动实时预览（T10）', () => {
  it('拖动中岛内全部成员同步偏移；不出现浮空克隆；原节点不置灰', () => {
    const onCenterMove = vi.fn((_id: string, _dx: number, _dy: number) => {});
    const { container, wheel, cPos, cId, c1Id } = setup(onCenterMove);
    const cBefore = transformOf(container, cId);
    const c1Before = transformOf(container, c1Id);

    fireEvent.pointerDown(wheel, { clientX: cPos.x, clientY: cPos.y, pointerId: 1, bubbles: true });
    fireEvent.pointerMove(wheel, { clientX: cPos.x + 10, clientY: cPos.y + 6, pointerId: 1, bubbles: true });
    fireEvent.pointerMove(wheel, { clientX: cPos.x + 30, clientY: cPos.y + 20, pointerId: 1, bubbles: true });

    // 岛根与子成员都偏移（jsdom 恒等变换 k=1 → 世界位移 = 屏幕位移 (+30, +20)）
    expect(transformOf(container, cId)).not.toBe(cBefore);
    expect(transformOf(container, c1Id)).not.toBe(c1Before);
    expect(transformOf(container, cId)).toBe('translate(128 3)');
    // 中心拖拽无浮空克隆、无置灰（改结构拖拽的表现被排除）
    expect(container.querySelector('g[data-drag-clone]')).toBeNull();
    const orig = container.querySelector(`g[data-node-id="${cId}"]`);
    expect(orig?.getAttribute('opacity')).not.toBe('0.45');
  });

  it('pointerup → onCenterMove 恰一次（累计位移，世界坐标）', () => {
    const onCenterMove = vi.fn((_id: string, _dx: number, _dy: number) => {});
    const { container, wheel, cPos, cId } = setup(onCenterMove);
    fireEvent.pointerDown(wheel, { clientX: cPos.x, clientY: cPos.y, pointerId: 1, bubbles: true });
    fireEvent.pointerMove(wheel, { clientX: cPos.x + 12, clientY: cPos.y + 8, pointerId: 1, bubbles: true });
    fireEvent.pointerMove(wheel, { clientX: cPos.x + 40, clientY: cPos.y + 25, pointerId: 1, bubbles: true });
    fireEvent.pointerUp(wheel, { clientX: cPos.x + 40, clientY: cPos.y + 25, pointerId: 1, bubbles: true });
    expect(onCenterMove).toHaveBeenCalledTimes(1);
    expect(onCenterMove).toHaveBeenCalledWith(cId, 40, 25);
  });
});

describe('G6″ A4：取消路径（T11）', () => {
  it('Esc → 预览清空（成员位置复原）、onCenterMove 零调用', () => {
    const onCenterMove = vi.fn((_id: string, _dx: number, _dy: number) => {});
    const { container, wheel, cPos, cId, c1Id } = setup(onCenterMove);
    const cBefore = transformOf(container, cId);
    fireEvent.pointerDown(wheel, { clientX: cPos.x, clientY: cPos.y, pointerId: 1, bubbles: true });
    fireEvent.pointerMove(wheel, { clientX: cPos.x + 30, clientY: cPos.y + 20, pointerId: 1, bubbles: true });
    expect(transformOf(container, cId)).not.toBe(cBefore); // 预览中

    fireEvent.keyDown(window, { key: 'Escape', bubbles: true });
    expect(transformOf(container, cId)).toBe(cBefore); // 复原
    expect(onCenterMove).not.toHaveBeenCalled(); // 零副作用
  });

  it('pointercancel → 预览清空、零副作用', () => {
    const onCenterMove = vi.fn((_id: string, _dx: number, _dy: number) => {});
    const { container, wheel, cPos, cId } = setup(onCenterMove);
    const cBefore = transformOf(container, cId);
    fireEvent.pointerDown(wheel, { clientX: cPos.x, clientY: cPos.y, pointerId: 1, bubbles: true });
    fireEvent.pointerMove(wheel, { clientX: cPos.x + 30, clientY: cPos.y + 20, pointerId: 1, bubbles: true });
    expect(transformOf(container, cId)).not.toBe(cBefore);

    fireEvent.pointerCancel(wheel, { pointerId: 1, bubbles: true });
    expect(transformOf(container, cId)).toBe(cBefore);
    expect(onCenterMove).not.toHaveBeenCalled();
  });

  it('window blur → 预览清空、零副作用', () => {
    const onCenterMove = vi.fn((_id: string, _dx: number, _dy: number) => {});
    const { container, wheel, cPos, cId } = setup(onCenterMove);
    const cBefore = transformOf(container, cId);
    fireEvent.pointerDown(wheel, { clientX: cPos.x, clientY: cPos.y, pointerId: 1, bubbles: true });
    fireEvent.pointerMove(wheel, { clientX: cPos.x + 30, clientY: cPos.y + 20, pointerId: 1, bubbles: true });
    expect(transformOf(container, cId)).not.toBe(cBefore);

    fireEvent.blur(window);
    expect(transformOf(container, cId)).toBe(cBefore);
    expect(onCenterMove).not.toHaveBeenCalled();
  });

  it('非中心节点拖拽不受影响：仍走浮空克隆（改结构拖拽）', () => {
    const onCenterMove = vi.fn((_id: string, _dx: number, _dy: number) => {});
    const { container, wheel, c1Id } = setup(onCenterMove);
    const l = forestFixture().layout;
    const c1 = centerOf(l, 'c1');
    // 拖「c1」（非中心）→ 克隆出现（既有行为未被波及）
    fireEvent.pointerDown(wheel, { clientX: c1.x, clientY: c1.y, pointerId: 1, bubbles: true });
    fireEvent.pointerMove(wheel, { clientX: c1.x + 30, clientY: c1.y + 20, pointerId: 1, bubbles: true });
    expect(container.querySelector('g[data-drag-clone]')).not.toBeNull();
  });
});
