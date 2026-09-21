// @vitest-environment jsdom
/**
 * R4-3②：失效边退出路由协调（契约：已否定的关系不塑形别人）。
 *
 * 判别场景：A→D 与 B→C 交叉——两条都有效时 B→C 会收到跳线弧（d 含拱）；
 * A→D 置 invalidAt 后，B→C 的 d 必须与「只渲染 B→C 一条」逐位相同
 * （失效边不进跳线/协调输入集），且失效边自身仍绘制（灰虚线）。
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { makeTextNode, layoutMindmap, type EditableNode } from '@mindcanvas/kernel';
import { ThemeProvider, glassToken, FreeEdgeLayer, type FreeEdge } from '../src/index.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

function buildScene(): { root: EditableNode; boxes: Map<string, { x: number; y: number; w: number; h: number }> } {
  const root = makeTextNode('根', [makeTextNode('A'), makeTextNode('B'), makeTextNode('C'), makeTextNode('D')]);
  const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
  const layout = layoutMindmap(root, createNodeMeasure(char, new Map()), new Set());
  const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const ln of layout.nodes) boxes.set(ln.node.id, ln.box);
  return { root, boxes };
}

function edgeOf(
  root: EditableNode,
  index: number,
  fromText: string,
  toText: string,
  invalidAt?: string,
): FreeEdge {
  const find = (t: string): EditableNode => {
    for (const c of root.children) if (c.text === t) return c;
    throw new Error(`not found ${t}`);
  };
  return {
    key: `e${index}`,
    index,
    sourceId: find(fromText).id,
    targetId: find(toText).id,
    from: `node:根/${fromText}`,
    to: `node:根/${toText}`,
    rel: 'relates-to',
    dir: 'fwd',
    state: 'well-formed',
    ...(invalidAt !== undefined ? { invalidAt } : {}),
  };
}

function renderScene(
  edges: FreeEdge[],
  boxes: Map<string, { x: number; y: number; w: number; h: number }>,
  root: EditableNode,
): Map<string, string> {
  const screen = render(
    <ThemeProvider>
      <svg>
        <FreeEdgeLayer
          edges={edges}
          boxOf={(id) => boxes.get(id)}
          root={root}
          collapsed={new Set()}
          token={glassToken}
          obstacles={[...boxes.entries()].map(([id, box]) => ({ id, box }))}
        />
      </svg>
    </ThemeProvider>,
  );
  const ds = new Map<string, string>();
  for (const g of screen.container.querySelectorAll('[data-free-edge]')) {
    const key = g.getAttribute('data-free-edge') ?? '';
    const visible = [...g.querySelectorAll('path')].find(
      (p) => p.getAttribute('stroke') !== 'transparent',
    );
    ds.set(key, visible?.getAttribute('d') ?? '');
  }
  screen.unmount();
  return ds;
}

describe('失效边退出路由协调（R4-3②）', () => {
  it('失效边在场：正常边 d = 单独渲染逐位相同（不收跳线弧）；失效边自身仍绘制', () => {
    const { root, boxes } = buildScene();
    const crossing = edgeOf(root, 0, 'A', 'D'); // 长边（跨过 B、C 行）
    const short = edgeOf(root, 1, 'B', 'C'); // 短边（与长边交叉）

    // 前置：两活跃边交叉 → 短边 d 含跳线拱（多个 C 段），确认场景判别力
    const both = renderScene([crossing, short], boxes, root);
    const bothShortD = both.get('e1') ?? '';
    expect(bothShortD).not.toBe('');
    expect((bothShortD.match(/C /g) ?? []).length).toBeGreaterThan(0); // 有跳线拱

    // 短边单独渲染（失效边不在场）→ 基准 d
    const alone = renderScene([short], boxes, root);
    const aloneShortD = alone.get('e1') ?? '';

    // 契约：长边失效后，短边 d 必须与「单独渲染」逐位相同（旧实现：长边仍在
    // 跳线输入集 → 短边带拱 → d 变，红）
    const invalidCrossing = { ...crossing, invalidAt: '2026-09-13T00:00:00.000Z' };
    const after = renderScene([invalidCrossing, short], boxes, root);
    expect(after.get('e1')).toBe(aloneShortD);

    // 失效边自身仍绘制（灰虚线 = strokeDasharray 存在）
    const screen = render(
      <ThemeProvider>
        <svg>
          <FreeEdgeLayer
            edges={[invalidCrossing, short]}
            boxOf={(id) => boxes.get(id)}
            root={root}
            collapsed={new Set()}
            token={glassToken}
          />
        </svg>
      </ThemeProvider>,
    );
    const g = screen.container.querySelector('[data-free-edge="e0"]');
    expect(g).not.toBeNull();
    const dashed = [...(g?.querySelectorAll('path') ?? [])].some((p) =>
      p.getAttribute('stroke-dasharray'),
    );
    expect(dashed).toBe(true);
    screen.unmount();
  });
});
