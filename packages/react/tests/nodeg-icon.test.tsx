// @vitest-environment jsdom
/**
 * FA1-T3/T5：节点图标与内联插图的渲染。
 *
 * 锁死的是「素材不再只能当子节点」这件事在画布上的可见结果：
 *  - note.icon（data URL 单色 SVG）→ **内联**渲染成 <g data-node-icon>，
 *    并带 style.color（currentColor 才能跟随主题，<image> 做不到）；
 *  - note.icon（资产引用）→ 走 <image>（大图 / 位图不内联）；
 *  - note.media → 文本节点本体上方出现插图卡片（不是新子节点）；
 *  - 没有 icon 的节点不画任何图标（零回归）。
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { astToEditable, layoutMindmap, makeTextNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView } from '../src/render/MapView.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';
import { svgToDataUrl } from '../src/render/svgTint.js';

const STAR =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#111"><path d="M5 13l4 4L19 7"/></svg>';
const STAR_URL = svgToDataUrl(STAR);

function layoutOf(nodes: ReturnType<typeof makeTextNode>[]) {
  const root = makeTextNode('根', nodes);
  const editable = astToEditable(root)!;
  const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
  return { layout: layoutMindmap(editable, createNodeMeasure(char, new Map()), new Set()), char };
}

function iconNode(note: Record<string, unknown>) {
  return { ...makeTextNode('带图标'), note };
}

describe('NodeG：节点图标渲染（FA1-T3）', () => {
  it('data URL 单色 SVG → 内联 <g data-node-icon>（含 path），非 <image>', () => {
    const { layout, char } = layoutOf([iconNode({ icon: STAR_URL })]);
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} />
      </ThemeProvider>,
    );
    const icon = container.querySelector('[data-node-icon]');
    expect(icon).not.toBeNull();
    expect(icon!.tagName.toLowerCase()).toBe('g');
    expect(icon!.querySelector('path')).not.toBeNull();
  });

  it('内联图标带 style.color（currentColor 的宿主色来源 —— 随主题变色的关键）', () => {
    const { layout, char } = layoutOf([iconNode({ icon: STAR_URL })]);
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} />
      </ThemeProvider>,
    );
    const icon = container.querySelector('[data-node-icon]') as SVGGElement;
    expect(icon.getAttribute('style')).toContain('color');
  });

  it('内联前已过净化：script / 事件属性不会进入 DOM', () => {
    const tag = 'script';
    const evil = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><${tag}>x</${tag}><path d="M0 0"/></svg>`;
    const { layout, char } = layoutOf([iconNode({ icon: svgToDataUrl(evil) })]);
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} />
      </ThemeProvider>,
    );
    const icon = container.querySelector('[data-node-icon]');
    expect(icon!.innerHTML).not.toContain(tag);
    expect(icon!.innerHTML).not.toContain('onload');
  });

  it('资产引用型 icon → 走 <image>（位图/大图不内联）', () => {
    const { layout, char } = layoutOf([iconNode({ icon: 'draw:demo-assets/star.svg' })]);
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} assetBaseUrl="/" />
      </ThemeProvider>,
    );
    const icon = container.querySelector('[data-node-icon]');
    expect(icon!.tagName.toLowerCase()).toBe('image');
    expect(icon!.getAttribute('href')).toBe('/demo-assets/star.svg');
  });

  it('无 icon → 不渲染任何图标元素（既有节点零回归）', () => {
    const { layout, char } = layoutOf([makeTextNode('普通节点')]);
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} />
      </ThemeProvider>,
    );
    expect(container.querySelector('[data-node-icon]')).toBeNull();
  });

  it('编辑态（noText）不画图标 —— 与文字层同规则，避免和浮层输入重叠', () => {
    const { layout, char } = layoutOf([iconNode({ icon: STAR_URL })]);
    const id = layout.nodes[1]!.node.id;
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} editingId={id} />
      </ThemeProvider>,
    );
    const node = container.querySelector(`[data-node-id="${id}"]`)!;
    expect(node.querySelector('[data-node-icon]')).toBeNull();
  });
});

describe('NodeG：内联插图（FA1-T3 —— 素材属于节点本体，不是子节点）', () => {
  it('文本节点带 note.media → 渲染插图 <image>（不是新增子节点）', () => {
    const { layout, char } = layoutOf([iconNode({ media: 'img:demo-assets/photo.png' })]);
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} assetBaseUrl="/" />
      </ThemeProvider>,
    );
    const hrefs = Array.from(container.querySelectorAll('image')).map((i) =>
      i.getAttribute('href'),
    );
    expect(hrefs).toContain('/demo-assets/photo.png');
    // 子节点数量没有变化（插图没有变成子节点）
    expect(layout.nodes.length).toBe(2); // 根 + 1
  });

  it('无 media → 文本节点不渲染 <image>', () => {
    const { layout, char } = layoutOf([makeTextNode('纯文本')]);
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} assetBaseUrl="/" />
      </ThemeProvider>,
    );
    expect(container.querySelectorAll('image').length).toBe(0);
  });
});
