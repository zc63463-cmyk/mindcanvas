// @vitest-environment jsdom
/**
 * 嵌套中心包容语义——**子岛随父岛拖动**（推翻原 C3「不跟随」）。
 *
 * 用户需求：父 Section / 中心内再升格子孙岛，应留在父框内；拖父岛时子孙跟移。
 * 投影层仍剔除升格子树（独立布局）；包容只影响 Section AABB 成员并集与拖动预览/提交。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { astToEditable, layoutForest, makeTextNode } from '@mindcanvas/kernel';
import { collectCenters } from '../src/render/centers.js';
import { buildIslandView } from '../src/demo/pipeline.js';
import { SECTION_PADDING, SECTION_TITLE_H } from '../src/render/sectionFrames.js';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView } from '../src/render/MapView.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

function nestedFixture() {
  const root = astToEditable(
    makeTextNode('root', [makeTextNode('P', [makeTextNode('p1'), makeTextNode('C', [makeTextNode('c1')])])]),
  );
  if (root === null) throw new Error('fixture broken: astToEditable returned null');
  const p = root.children[0];
  if (p === undefined) throw new Error('fixture broken: P missing');
  const p1 = p.children[0];
  if (p1 === undefined) throw new Error('fixture broken: p1 missing');
  const c = p.children[1];
  if (c === undefined) throw new Error('fixture broken: C missing');
  const c1 = c.children[0];
  if (c1 === undefined) throw new Error('fixture broken: c1 missing');
  p.note = { cid: 'c1' };
  c.note = { cid: 'c2' };
  root.note = {
    centers: [
      { at: 'node:root/P', dir: 'right', cid: 'c1', x: 0, y: 0 },
      { at: 'node:root/P/C', dir: 'right', cid: 'c2', x: 120, y: 0 },
    ],
    // NEST-CONTAIN-1：P 标 Section（cid:c1 = P）——验证 Section AABB 包容子孙岛 C
    sections: [{ id: 'sec_p', title: 'P 分区', root: 'cid:c1', color: 'blue' }],
  };
  return { root, p, p1, c, c1 };
}

function transformOf(container: HTMLElement, id: string): string | null {
  return container.querySelector(`g[data-node-id="${id}"]`)?.getAttribute('transform') ?? null;
}

function setup() {
  const f = nestedFixture();
  const view = buildIslandView(f.root, collectCenters(f.root));
  if (view.specs === null) throw new Error('fixture broken: specs null');
  const layout = layoutForest(view.specs, createNodeMeasure(char, new Map()), new Set());
  const { container } = render(
    <ThemeProvider>
      <MapView
        layout={layout}
        // Section 锚解析（cid）与标题索引走完整内容树；中心拖拽本身不依赖它
        documentRoot={f.root}
        entities={new Map()}
        char={char}
        centerIds={new Set([f.p.id, f.c.id])}
        islandMembers={view.membersByRoot}
        nestedCenterIdsByRoot={view.nestedCenterIdsByRoot}
        onCenterMove={vi.fn()}
      />
    </ThemeProvider>,
  );
  const wheel = container.querySelector('div[style*="touch-action"]');
  if (!(wheel instanceof HTMLElement)) throw new Error('fixture broken: wheel missing');
  const centerOf = (id: string) => {
    const n = layout.nodes.find((x) => x.node.id === id);
    if (n === undefined) throw new Error(`fixture broken: layout node ${id} missing`);
    return { x: n.box.x + n.box.w / 2, y: n.box.y + n.box.h / 2 };
  };
  return { container, wheel, centerOf, f, view, layout };
}

describe('嵌套包容：投影成员仍互斥；nested 表记录子孙', () => {
  it('membersByRoot 互斥；nestedCenterIdsByRoot：P → [C]', () => {
    const f = nestedFixture();
    const view = buildIslandView(f.root, collectCenters(f.root));
    expect(view.membersByRoot.get(f.p.id)).toEqual([f.p.id, f.p1.id]);
    expect(view.membersByRoot.get(f.c.id)).toEqual([f.c.id, f.c1.id]);
    expect(view.nestedCenterIdsByRoot.get(f.p.id)).toEqual([f.c.id]);
  });
});

describe('嵌套包容：拖父中心 P → 子岛 C 跟移', () => {
  it('拖 P：P 与 C 两岛成员盒均位移', () => {
    const { container, wheel, centerOf, f } = setup();
    const pBefore = transformOf(container, f.p.id);
    const p1Before = transformOf(container, f.p1.id);
    const cBefore = transformOf(container, f.c.id);
    const c1Before = transformOf(container, f.c1.id);
    expect(pBefore).not.toBeNull();
    expect(cBefore).not.toBeNull();

    const pPos = centerOf(f.p.id);
    fireEvent.pointerDown(wheel, { clientX: pPos.x, clientY: pPos.y, pointerId: 1, bubbles: true });
    fireEvent.pointerMove(wheel, {
      clientX: pPos.x + 30,
      clientY: pPos.y + 20,
      pointerId: 1,
      bubbles: true,
    });

    expect(transformOf(container, f.p.id)).not.toBe(pBefore);
    expect(transformOf(container, f.p1.id)).not.toBe(p1Before);
    expect(transformOf(container, f.c.id)).not.toBe(cBefore);
    expect(transformOf(container, f.c1.id)).not.toBe(c1Before);
  });
});

describe('嵌套包容：拖子中心 C → 父岛 P 不随动', () => {
  it('拖 C：仅 C 岛位移', () => {
    const { container, wheel, centerOf, f } = setup();
    const pBefore = transformOf(container, f.p.id);
    const p1Before = transformOf(container, f.p1.id);
    const cBefore = transformOf(container, f.c.id);
    const c1Before = transformOf(container, f.c1.id);

    const cPos = centerOf(f.c.id);
    fireEvent.pointerDown(wheel, { clientX: cPos.x, clientY: cPos.y, pointerId: 1, bubbles: true });
    fireEvent.pointerMove(wheel, {
      clientX: cPos.x + 30,
      clientY: cPos.y + 20,
      pointerId: 1,
      bubbles: true,
    });

    expect(transformOf(container, f.c.id)).not.toBe(cBefore);
    expect(transformOf(container, f.c1.id)).not.toBe(c1Before);
    expect(transformOf(container, f.p.id)).toBe(pBefore);
    expect(transformOf(container, f.p1.id)).toBe(p1Before);
  });
});

describe('嵌套包容：P 的 Section AABB 罩住子孙岛 C', () => {
  it('frame bounds = (P 岛成员 ∪ C 岛成员) 外扩；C 岛成员盒全在框内', () => {
    const { container, f, view, layout } = setup();
    const rect = container.querySelector('g[data-section-id="sec_p"] > rect');
    if (!(rect instanceof Element)) throw new Error('fixture broken: section frame missing');
    const num = (attr: string): number => Number(rect.getAttribute(attr));
    const frame = { x: num('x'), y: num('y'), w: num('width'), h: num('height') };
    const boxOf = (id: string) => {
      const n = layout.nodes.find((x) => x.node.id === id);
      if (n === undefined) throw new Error(`fixture broken: layout node ${id} missing`);
      return n.box;
    };
    const nestedMembers = view.membersByRoot.get(f.c.id) ?? [];
    expect(nestedMembers.length).toBeGreaterThan(0);
    const all = [...(view.membersByRoot.get(f.p.id) ?? []), ...nestedMembers];
    const minX = Math.min(...all.map((id) => boxOf(id).x));
    const minY = Math.min(...all.map((id) => boxOf(id).y));
    const maxX = Math.max(...all.map((id) => boxOf(id).x + boxOf(id).w));
    const maxY = Math.max(...all.map((id) => boxOf(id).y + boxOf(id).h));
    // 外扩公式与 buildSectionViews 一致：左右下 SECTION_PADDING、上侧标题栏 + 6
    expect(frame.x).toBeCloseTo(minX - SECTION_PADDING, 6);
    expect(frame.y).toBeCloseTo(minY - (SECTION_TITLE_H + 6), 6);
    expect(frame.w).toBeCloseTo(maxX - minX + SECTION_PADDING * 2, 6);
    expect(frame.h).toBeCloseTo(maxY - minY + (SECTION_TITLE_H + 6) + SECTION_PADDING, 6);
    // 直接语义断言：子孙岛成员盒均在框内（接线断开则退化为仅 P 岛 → 框缩小）
    for (const id of nestedMembers) {
      const b = boxOf(id);
      expect(frame.x).toBeLessThanOrEqual(b.x);
      expect(frame.y).toBeLessThanOrEqual(b.y);
      expect(frame.x + frame.w).toBeGreaterThanOrEqual(b.x + b.w);
      expect(frame.y + frame.h).toBeGreaterThanOrEqual(b.y + b.h);
    }
    // 夹具区分度守卫：C 岛右缘确实超出「仅 P 岛」并集右缘（否则本测抓不住接线回归）
    const pOnlyMaxX = Math.max(
      ...(view.membersByRoot.get(f.p.id) ?? []).map((id) => boxOf(id).x + boxOf(id).w),
    );
    const nestedMaxX = Math.max(...nestedMembers.map((id) => boxOf(id).x + boxOf(id).w));
    expect(nestedMaxX).toBeGreaterThan(pOnlyMaxX);
  });
});
