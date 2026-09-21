// @vitest-environment jsdom
/**
 * v1.5.0 T5：Section 折叠钮 + 选中态退出三件套。
 *
 * 断言：
 * - 折叠钮 → onToggleCollapse(rootId)（复用节点级会话态，不落盘）
 * - 折叠后 AABB 收缩只余 root（隐藏成员无盒 → 不参与 AABB），徽标转 +N
 * - 选中态：点框选中 → Esc 退出 / 画布空白点击退出 / 再点同框退出（toggle）
 * - 会话态纪律：折叠与选中均不产生任何 controller 写入（本层不持有 controller）
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { layoutForest, makeTextNode, type EditableNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView } from '../src/render/MapView.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

/** 文档树 R ── C(含 c1, c2)，C 升格为中心并标为 Section（cid:c7） */
function fixture(opts: { collapseRoot?: boolean } = {}) {
  const c1 = makeTextNode('c1');
  const c2 = makeTextNode('c2');
  const c: EditableNode = { ...makeTextNode('C', [c1, c2]), note: { cid: 'c7' } };
  const other = makeTextNode('other');
  const root: EditableNode = {
    ...makeTextNode('R', [c, other]),
    note: {
      sections: [{ id: 'sec_t5', title: '折叠测试', root: 'cid:c7', color: 'green' }],
      centers: [{ at: 'node:R/C', cid: 'c7', dir: 'right', x: 40, y: 0 }],
    },
  };
  // 折叠集合由本 fixture 自己的 id 构造（跨 fixture 取 id 会静默失效）
  const collapsed = new Set<string>(opts.collapseRoot ? [c.id] : []);
  // 布局树 = 投影后的视图（c 已从 root 摘出）；documentRoot 仍是完整树（含 c）。
  // 两份混用同一对象会让 c 子树在 layout.nodes 出现两次（React 重复 key 警告）。
  const layoutRoot: EditableNode = { ...root, children: [other] };
  const layout = layoutForest(
    [
      { node: layoutRoot, dir: 'right', pos: { x: 0, y: 0 } },
      { node: c, dir: 'right', pos: { x: 40, y: 0 } },
    ],
    createNodeMeasure(char, new Map()),
    collapsed,
  );
  return { layout, root, c, c1Id: c1.id, c2Id: c2.id, collapsed };
}

function setup(opts: { collapseRoot?: boolean; onToggleCollapse?: (id: string) => void } = {}) {
  const { collapseRoot = false, onToggleCollapse } = opts;
  const f = fixture({ collapseRoot });
  const members = new Map<string, string[]>([
    [f.root.id, [f.root.id]],
    [f.c.id, [f.c.id, f.c1Id, f.c2Id]],
  ]);
  const { container } = render(
    <ThemeProvider>
      <MapView
        layout={f.layout}
        documentRoot={f.root}
        entities={new Map()}
        char={char}
        centerIds={new Set([f.c.id])}
        islandMembers={members}
        collapsedIds={f.collapsed}
        onToggleCollapse={onToggleCollapse}
      />
    </ThemeProvider>,
  );
  const frame = () => container.querySelector('g[data-section-id]');
  const titlebar = () => container.querySelector('g[data-section-titlebar]');
  const foldBtn = () => container.querySelector('g[data-section-fold]');
  const rect = () => frame()?.querySelector('rect') ?? null;
  return { container, f, frame, titlebar, foldBtn, rect };
}

describe('T5：Section 折叠钮', () => {
  it('点击折叠钮 → onToggleCollapse(rootId) 恰一次', () => {
    const onToggleCollapse = vi.fn();
    const s = setup({ onToggleCollapse });
    const btn = s.foldBtn() as SVGGElement | null;
    expect(btn).not.toBeNull();
    fireEvent.pointerDown(btn as SVGGElement, { pointerId: 1, bubbles: true });
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
    expect(onToggleCollapse).toHaveBeenCalledWith(s.f.c.id);
  });

  it('折叠态：AABB 收缩（隐藏成员无盒不参与），徽标显示 +N', () => {
    const expanded = setup();
    const collapsed = setup({ collapseRoot: true });

    const rExp = expanded.rect();
    const rCol = collapsed.rect();
    expect(rExp).not.toBeNull();
    expect(rCol).not.toBeNull();
    // 折叠后只剩 root 有盒 → 框体明显更小
    const hExp = Number(rExp?.getAttribute('height'));
    const hCol = Number(rCol?.getAttribute('height'));
    expect(hCol).toBeLessThan(hExp);
    // 徽标文本含 "+"（+N 形态）
    const texts = [...(collapsed.frame()?.querySelectorAll('text') ?? [])].map(
      (t) => t.textContent ?? '',
    );
    expect(texts.some((t) => t.startsWith('+'))).toBe(true);
  });
});

describe('T5：Section 选中态退出三件套', () => {
  it('点框选中（虚线→实线描边），Esc 退出复原', () => {
    const s = setup();
    const r = s.rect() as SVGRectElement;
    const strokeBefore = r.getAttribute('stroke-dasharray');
    fireEvent.pointerDown(r, { pointerId: 1, bubbles: true });
    const rSel = s.rect() as SVGRectElement;
    expect(rSel.getAttribute('stroke-dasharray')).toBeNull(); // 选中态 = 实线

    fireEvent.keyDown(window, { key: 'Escape', bubbles: true });
    const rBack = s.rect() as SVGRectElement;
    expect(rBack.getAttribute('stroke-dasharray')).toBe(strokeBefore);
  });

  it('画布空白点击 → 退出选中', () => {
    const s = setup();
    fireEvent.pointerDown(s.rect() as SVGRectElement, { pointerId: 1, bubbles: true });
    expect((s.rect() as SVGRectElement).getAttribute('stroke-dasharray')).toBeNull();

    // 落点在 svg 空白（非任何 data-section-id 元素）→ 清选中
    const svg = s.container.querySelector('svg') as SVGSVGElement;
    fireEvent.pointerDown(svg, { pointerId: 1, bubbles: true });
    expect((s.rect() as SVGRectElement).getAttribute('stroke-dasharray')).not.toBeNull();
  });

  it('再次点击同框 → toggle 取消选中', () => {
    const s = setup();
    fireEvent.pointerDown(s.rect() as SVGRectElement, { pointerId: 1, bubbles: true });
    expect((s.rect() as SVGRectElement).getAttribute('stroke-dasharray')).toBeNull();
    fireEvent.pointerDown(s.rect() as SVGRectElement, { pointerId: 1, bubbles: true });
    expect((s.rect() as SVGRectElement).getAttribute('stroke-dasharray')).not.toBeNull();
  });
});
