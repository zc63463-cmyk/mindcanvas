// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { astToEditable, layoutMindmap, makeEntityNode, makeTextNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView } from '../src/render/MapView.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

function assetLayout() {
  const root = makeTextNode('根', [
    makeEntityNode({ kind: 'img', id: 'demo-assets/demo-diagram.svg' }),
    makeEntityNode({ kind: 'draw', id: 'demo-assets/board.svg' }),
    makeEntityNode({ kind: 'issue', id: '1' }),
  ]);
  const editable = astToEditable(root)!;
  const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
  return { layout: layoutMindmap(editable, createNodeMeasure(char, new Map()), new Set()), char };
}

describe('NodeG：@img/@draw 资产预览渲染', () => {
  it('img/draw 实体节点渲染 <image> 且 href 拼接 assetBaseUrl（导图根 + 相对路径）', () => {
    const { layout, char } = assetLayout();
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} assetBaseUrl="/" />
      </ThemeProvider>,
    );
    const imgs = container.querySelectorAll('image');
    const hrefs = Array.from(imgs).map((i) => i.getAttribute('href'));
    expect(hrefs).toContain('/demo-assets/demo-diagram.svg');
    expect(hrefs).toContain('/demo-assets/board.svg');
  });

  it('非资产实体（@issue）不渲染 <image>', () => {
    const { layout, char } = assetLayout();
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} assetBaseUrl="/" />
      </ThemeProvider>,
    );
    expect(container.querySelectorAll('image').length).toBe(2);
  });
});

/**
 * P0-1 资产 URL 宿主解析：上传资产（objectURL）无法经 assetBaseUrl 拼接加载——
 * NodeG 必须优先走宿主注入的 resolveAssetUrl，返回 undefined 时回落默认拼接。
 */
describe('NodeG：resolveAssetUrl 宿主解析（P0-1）', () => {
  it('宿主返回 URL → <image> href 用宿主值；undefined → 回落 assetBaseUrl 拼接', () => {
    const { layout, char } = assetLayout();
    const { container } = render(
      <ThemeProvider>
        <MapView
          layout={layout}
          entities={new Map()}
          char={char}
          assetBaseUrl="/"
          resolveAssetUrl={(ref) => (ref.kind === 'img' ? `blob:host-${ref.id}` : undefined)}
        />
      </ThemeProvider>,
    );
    const hrefs = Array.from(container.querySelectorAll('image')).map((i) =>
      i.getAttribute('href'),
    );
    expect(hrefs).toContain('blob:host-demo-assets/demo-diagram.svg');
    expect(hrefs).toContain('/demo-assets/board.svg');
  });

  it('未传 resolveAssetUrl → 行为不变（全部回落 assetBaseUrl 拼接）', () => {
    const { layout, char } = assetLayout();
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} assetBaseUrl="/" />
      </ThemeProvider>,
    );
    const hrefs = Array.from(container.querySelectorAll('image')).map((i) =>
      i.getAttribute('href'),
    );
    expect(hrefs).toContain('/demo-assets/demo-diagram.svg');
  });
});

/**
 * 编辑态文字层守卫（2026-09-03）：
 * 内联编辑器是浮在节点盒上的 <input>，若 SVG 仍绘制文字就是两层同时可见 ——
 * 暗色主题下 input 底色只有 7% 不透明度，底下文字会直接透出来。
 * 这条锁的是「编辑中的节点一个 <text> 都不许画」，含主题文字、kindLabel、
 * 多行，以及资产缺失占位文字（后者曾在 noText 之外，被审查发现后补上）。
 */
describe('编辑态：SVG 不再绘制节点文字（避免与内联编辑器双层重叠）', () => {
  const targetId = (): { layout: ReturnType<typeof assetLayout>['layout']; char: ReturnType<
    typeof assetLayout
  >['char']; id: string } => {
    const { layout, char } = assetLayout();
    // 取一个非根节点（根是 layout.nodes[0]）
    const id = layout.nodes[1]!.node.id;
    return { layout, char, id };
  };

  it('编辑中的节点不渲染任何 <text>，其他节点照常渲染', () => {
    const { layout, char, id } = targetId();
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} editingId={id} />
      </ThemeProvider>,
    );
    const editing = container.querySelector(`[data-node-id="${id}"]`);
    expect(editing).not.toBeNull();
    expect(editing!.querySelectorAll('text').length).toBe(0);

    // 其他节点不受影响（否则就是误伤）
    const other = container.querySelector(
      `[data-node-id="${layout.nodes[2]!.node.id}"]`,
    );
    expect(other!.querySelectorAll('text').length).toBeGreaterThan(0);
  });

  it('非编辑态下该节点正常渲染文字（守卫没有过头）', () => {
    const { layout, char, id } = targetId();
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} />
      </ThemeProvider>,
    );
    const node = container.querySelector(`[data-node-id="${id}"]`);
    expect(node!.querySelectorAll('text').length).toBeGreaterThan(0);
  });

  it('资产加载失败时：非编辑态显示占位文字，编辑态不显示（虚线诊断框仍保留）', () => {
    const { layout, char } = assetLayout();
    // layout.nodes[1] 是 @img 实体节点（资产预览）
    const id = layout.nodes[1]!.node.id;

    // ① 非编辑态：触发 image 加载失败 → 应出现「✕ 资产缺失」
    const plain = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} assetBaseUrl="/" />
      </ThemeProvider>,
    );
    fireEvent.error(plain.container.querySelector('image')!);
    const shown = Array.from(
      plain.container.querySelector(`[data-node-id="${id}"]`)!.querySelectorAll('text'),
    ).map((t) => t.textContent);
    expect(shown).toContain('✕ 资产缺失');
    plain.unmount();

    // ② 编辑态：同样触发失败，但一个 <text> 都不该有
    const editing = render(
      <ThemeProvider>
        <MapView
          layout={layout}
          entities={new Map()}
          char={char}
          assetBaseUrl="/"
          editingId={id}
        />
      </ThemeProvider>,
    );
    fireEvent.error(editing.container.querySelector('image')!);
    const node = editing.container.querySelector(`[data-node-id="${id}"]`)!;
    expect(node.querySelectorAll('text').length).toBe(0);
    // 虚线框是诊断标识，不是文字 —— 编辑态保留它
    expect(node.querySelector('[data-asset-broken]')).not.toBeNull();
  });
});
