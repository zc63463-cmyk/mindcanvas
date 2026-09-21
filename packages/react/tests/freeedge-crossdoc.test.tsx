// @vitest-environment jsdom
/**
 * G-P1 换代检查：自由边跨文档稳定化（R5 复核发现 → 深度修复的回归钉）。
 *
 * 缺陷形态（修复前实测）：`stableByKeys` 只比 key，而 `FreeEdge.key = e${index}` 是
 * **位置键**（freeEdges.ts:239）—— 换文档后「边数相同且非零」时 key 序列逐项相等 →
 * 复用**旧文档的边对象**（sourceId/targetId 指向已丢弃的树）→ 端点盒全落空
 * （freeEdgeEndpoints.renderable=false）→ 自由边**整层不渲染**。
 * 实测触发：文档 A 1 条边 → 切到文档 B 1 条边 → `[data-free-edge]` 1 → 0。
 *
 * 修复后：稳定化带来源换代检查（代次 = collectFreeEdges 的输入 rootNode）。
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { layoutMindmap, makeTextNode } from '@mindcanvas/kernel';
import { MapView, ThemeProvider } from '../src/index.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

/** 结构不同（根名不同 → 节点 id 不同）、边数可调的文档 */
function makeDoc(rootName: string, edgeCount: number) {
  const root = makeTextNode(rootName, [makeTextNode('A'), makeTextNode('B')]);
  root.note = {
    edges: Array.from({ length: edgeCount }, (_, i) => ({
      from: `node:${rootName}/A`,
      to: `node:${rootName}/B`,
      rel: `rel-${i}`,
      label: `标签${i}`,
    })),
  };
  return layoutMindmap(root, createNodeMeasure(char, new Map()), new Set());
}

function mount(layout: ReturnType<typeof makeDoc>, entities: Map<string, never>) {
  return (
    <ThemeProvider>
      <MapView layout={layout} entities={entities} char={char} relationMode />
    </ThemeProvider>
  );
}

describe('自由边跨文档换代检查（stableByKeys 调用方契约）', () => {
  it('换文档（边数相同、key 序列相同）→ 自由边仍渲染（修复前：整层 0 条）', () => {
    const entities = new Map<string, never>();
    const { container, rerender } = render(mount(makeDoc('根A', 1), entities));
    expect(container.querySelectorAll('[data-free-edge]').length).toBe(1);

    rerender(mount(makeDoc('根B', 1), entities));
    expect(container.querySelectorAll('[data-free-edge]').length).toBe(1);
  });

  it('换文档（边数不同）→ 仍渲染（相邻行为回归钉：长度路径不得被换代逻辑吃掉）', () => {
    const entities = new Map<string, never>();
    const { container, rerender } = render(mount(makeDoc('根C', 1), entities));
    expect(container.querySelectorAll('[data-free-edge]').length).toBe(1);

    rerender(mount(makeDoc('根D', 2), entities));
    expect(container.querySelectorAll('[data-free-edge]').length).toBe(2);
  });
});
