// @vitest-environment jsdom
/**
 * R4-3③：空 label 保护——rel 为空串时不再渲染空胶囊（标签整体不出现）。
 * label 非空 → 照常；label 空串 + rel 非空 → 回落 rel（保信息）；rel 兜底照常。
 *
 * R5-2：标签渲染移至宿主层（edge-labels 层，层序契约见 mapview-layer-order.test.tsx）——
 * 本文件改经真实 MapView 组合验证：选择器（[data-edge-label]）跨搬层保持同义，
 * 「空文本不产出胶囊」双保险（收集侧不产出 + EdgeLabel 内部守卫）仍在。
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { layoutMindmap, makeTextNode, type EditableNode } from '@mindcanvas/kernel';
import { MapView, ThemeProvider } from '../src/index.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

function mountWithEdge(spec: Record<string, unknown>) {
  const root: EditableNode = makeTextNode('根', [makeTextNode('A'), makeTextNode('B')]);
  root.note = { edges: [{ from: 'node:根/A', to: 'node:根/B', ...spec }] };
  const layout = layoutMindmap(root, createNodeMeasure(char, new Map()), new Set());
  return render(
    <ThemeProvider>
      <MapView layout={layout} entities={new Map()} char={char} />
    </ThemeProvider>,
  );
}

describe('空 label 保护（R4-3③）', () => {
  it('rel 空串 → 不渲染空胶囊', () => {
    const { container } = mountWithEdge({ rel: '', source: 'manual' });
    expect(container.querySelectorAll('[data-edge-label]').length).toBe(0);
  });

  it('label 非空 → 照常渲染；label 空串 + rel 非空 → 回落 rel；rel 兜底照常', () => {
    const labeled = mountWithEdge({ rel: 'blocks', label: '硬依赖' });
    expect(labeled.container.querySelectorAll('[data-edge-label]').length).toBe(1);

    const emptyLabel = mountWithEdge({ rel: 'blocks', label: '' });
    expect(emptyLabel.container.querySelectorAll('[data-edge-label]').length).toBe(1);

    const relOnly = mountWithEdge({ rel: 'blocks' });
    expect(relOnly.container.querySelectorAll('[data-edge-label]').length).toBe(1);
  });
});
