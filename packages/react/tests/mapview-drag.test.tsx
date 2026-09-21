// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { astToEditable, layoutMindmap, makeTextNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView } from '../src/render/MapView.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

/** 根 → A(叶a) / B(叶b)；jsdom 无尺寸 → 恒等变换，世界坐标 = 屏幕坐标 */
function layout() {
  const root = astToEditable(
    makeTextNode('根', [
      makeTextNode('A', [makeTextNode('叶a')]),
      makeTextNode('B', [makeTextNode('叶b')]),
    ]),
  )!;
  return layoutMindmap(root, createNodeMeasure(char, new Map()), new Set());
}

function center(l: ReturnType<typeof layout>, text: string) {
  const n = l.nodes.find((x) => x.node.text === text)!;
  return { x: n.box.x + n.box.w / 2, y: n.box.y + n.box.h / 2, id: n.node.id, box: n.box };
}

function drag(
  el: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
  pointerId = 1,
) {
  fireEvent.pointerDown(el, { clientX: from.x, clientY: from.y, pointerId, bubbles: true });
  fireEvent.pointerMove(el, { clientX: to.x, clientY: to.y, pointerId, bubbles: true });
}

describe('MapView 节点拖拽重排（M5-T5 集成）', () => {
  it('拖拽节点 → 克隆跟随 + 原节点置灰 + 悬停目标高亮与插入指示', async () => {
    const l = layout();
    const a = center(l, 'A');
    const b = center(l, 'B');
    const { container } = render(
      <ThemeProvider>
        <MapView layout={l} entities={new Map()} char={char} />
      </ThemeProvider>,
    );
    const wheel = container.querySelector('div[style*="touch-action"]') as HTMLElement;
    // 命中 A → 拖到 B 中段（child 模式）
    drag(wheel, a, b);
    // 克隆出现（浮空层）
    expect(container.querySelector('g[data-drag-clone]')).not.toBeNull();
    // 原节点置灰（opacity 0.45）
    const orig = container.querySelector(`g[data-node-id="${a.id}"]`);
    expect(orig?.getAttribute('opacity')).toBe('0.45');
    // 落点指示器（child → 虚线环）
    const indicator = container.querySelector('g[data-drop-indicator] rect');
    expect(indicator).not.toBeNull();
    // 目标高亮 = 合法（selection 令牌色描边）
    const target = container.querySelector(`g[data-node-id="${b.id}"] rect`);
    expect(target?.getAttribute('stroke')).toBe('#7ae9c4'); // glass 主题 selection
  });

  it('松手 → onNodeMove 收到正确 move-node op（child 追加）', () => {
    const l = layout();
    const a = center(l, 'A');
    const b = center(l, 'B');
    const onNodeMove = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <MapView layout={l} entities={new Map()} char={char} onNodeMove={onNodeMove} />
      </ThemeProvider>,
    );
    const wheel = container.querySelector('div[style*="touch-action"]') as HTMLElement;
    drag(wheel, a, b);
    fireEvent.pointerUp(wheel, { clientX: b.x, clientY: b.y, pointerId: 1, bubbles: true });
    expect(onNodeMove).toHaveBeenCalledTimes(1);
    expect(onNodeMove.mock.calls[0]![0]).toEqual({
      type: 'move-node',
      id: a.id,
      targetParentId: b.id,
      index: 1, // B 现有 1 个子（叶b）→ 追加为 index 1
    });
    // 拖拽层清空
    expect(container.querySelector('g[data-drag-clone]')).toBeNull();
  });

  it('before 悬停带 → 作为目标前兄弟（落 root）', () => {
    const l = layout();
    const a = center(l, 'A');
    const b = center(l, 'B');
    const onNodeMove = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <MapView layout={l} entities={new Map()} char={char} onNodeMove={onNodeMove} />
      </ThemeProvider>,
    );
    const wheel = container.querySelector('div[style*="touch-action"]') as HTMLElement;
    // 拖到 B 顶 25% 带（before）
    drag(wheel, a, { x: b.x, y: b.box.y + 2 });
    fireEvent.pointerUp(wheel, { clientX: b.x, clientY: b.box.y + 2, pointerId: 1, bubbles: true });
    const rootId = l.nodes.find((n) => n.depth === 0)!.node.id;
    const bIndex = l.nodes
      .find((n) => n.depth === 0)!
      .children.findIndex((c) => c.node.id === b.id);
    expect(onNodeMove.mock.calls[0]![0]).toEqual({
      type: 'move-node',
      id: a.id,
      targetParentId: rootId,
      index: bIndex,
    });
  });

  it('Esc 取消拖拽：克隆消失且不触发 onNodeMove', () => {
    const l = layout();
    const a = center(l, 'A');
    const b = center(l, 'B');
    const onNodeMove = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <MapView layout={l} entities={new Map()} char={char} onNodeMove={onNodeMove} />
      </ThemeProvider>,
    );
    const wheel = container.querySelector('div[style*="touch-action"]') as HTMLElement;
    drag(wheel, a, b);
    expect(container.querySelector('g[data-drag-clone]')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.pointerUp(wheel, { clientX: b.x, clientY: b.y, pointerId: 1, bubbles: true });
    expect(container.querySelector('g[data-drag-clone]')).toBeNull();
    expect(onNodeMove).not.toHaveBeenCalled();
  });

  it('落到自身子树 → 拒绝态反馈（warn 描边）且松手不执行', () => {
    const l = layout();
    const a = center(l, 'A');
    const leafA = center(l, '叶a');
    const onNodeMove = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <MapView layout={l} entities={new Map()} char={char} onNodeMove={onNodeMove} />
      </ThemeProvider>,
    );
    const wheel = container.querySelector('div[style*="touch-action"]') as HTMLElement;
    drag(wheel, a, leafA);
    // 拒绝态：目标高亮 = warn 色（#f76b58 glass 主题）
    const target = container.querySelector(`g[data-node-id="${leafA.id}"] rect`);
    expect(target?.getAttribute('stroke')).toBe('#f76b58');
    const indicator = container.querySelector('g[data-drop-indicator] rect');
    expect(indicator?.getAttribute('stroke')).toBe('#f76b58');
    fireEvent.pointerUp(wheel, { clientX: leafA.x, clientY: leafA.y, pointerId: 1, bubbles: true });
    expect(onNodeMove).not.toHaveBeenCalled();
    // 拖拽层清空（拒绝后回到原位）
    expect(container.querySelector('g[data-drag-clone]')).toBeNull();
  });

  it('空白处 pointerdown 仍走画布平移（节点拖拽不劫持）', async () => {
    const l = layout();
    const { container } = render(
      <ThemeProvider>
        <MapView layout={l} entities={new Map()} char={char} />
      </ThemeProvider>,
    );
    const wheel = container.querySelector('div[style*="touch-action"]') as HTMLElement;
    const blank = { x: 500, y: 300 }; // 远离节点
    drag(wheel, blank, { x: 520, y: 310 });
    await new Promise((r) => setTimeout(r, 20)); // 等 rAF 广播后 React 重渲
    // 平移后 svg 世界组 transform 变化（无节点克隆）
    const g = container.querySelector('svg g')!;
    expect(g.getAttribute('transform')).not.toBe('translate(0 0) scale(1)');
    expect(container.querySelector('g[data-drag-clone]')).toBeNull();
  });
});
