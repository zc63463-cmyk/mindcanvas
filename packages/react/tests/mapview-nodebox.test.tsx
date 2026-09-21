// @vitest-environment jsdom
/**
 * MapViewApi · nodeBox / subtreeBoxes（v1.8.0 Phase 3 幽灵预览的只读逆变换）。
 * 断言客户端矩形、缩放 k、子树遍历与未知 id 兜底。
 */
import { expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { astToEditable, layoutMindmap, makeTextNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView } from '../src/render/MapView.js';
import type { MapViewApi } from '../src/render/MapView.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

/** 小型树 → 布局（同 mapview.test.tsx 夹具） */
function smallLayout() {
  const root = makeTextNode('根', [
    makeTextNode('分支 A', [makeTextNode('叶 1'), makeTextNode('叶 2')]),
    makeTextNode('分支 B'),
  ]);
  const editable = astToEditable(root)!;
  const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
  return {
    layout: layoutMindmap(editable, createNodeMeasure(char, new Map()), new Set()),
    char,
  };
}

function mount() {
  const { layout, char } = smallLayout();
  const apiRef: { current: MapViewApi | null } = { current: null };
  render(
    <ThemeProvider>
      <MapView layout={layout} entities={new Map()} char={char} apiRef={apiRef} />
    </ThemeProvider>,
  );
  return { api: apiRef.current!, layout };
}

it('nodeBox：客户端矩形 + 缩放 k；未知 id → null', () => {
  const { api, layout } = mount();
  const rootId = layout.nodes.find((n) => n.parentId === null)!.node.id;
  const nb = api.nodeBox(rootId)!;
  expect(nb.w).toBeGreaterThan(0);
  expect(nb.h).toBeGreaterThan(0);
  expect(nb.k).toBeGreaterThan(0);
  expect(api.nodeBox('不存在')).toBeNull();
});

it('subtreeBoxes：含自身遍历可见子树；叶子=1 个盒；未知 id → 空数组', () => {
  const { api, layout } = mount();
  const rootId = layout.nodes.find((n) => n.parentId === null)!.node.id;
  const sub = api.subtreeBoxes(rootId);
  expect(sub).toHaveLength(layout.nodes.length);
  expect(sub.map((b) => b.id)).toContain(rootId);
  const leaf = layout.nodes.find((n) => n.children.length === 0)!.node.id;
  expect(api.subtreeBoxes(leaf)).toHaveLength(1);
  expect(api.subtreeBoxes('不存在')).toEqual([]);
});
