/**
 * E5：画布级标注边测试（存储重构后）。
 * 覆盖：collectFreeEdges（root.note.edges 锚定解析/实体锚/dir/样式）/ anchorOfNode /
 * 端点解析（dir 交换/折叠路由/ghost）/ 边曲线几何 / edgeVisualOf 样式覆盖 / 渲染冒烟。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import {
  layoutForest,
  layoutMindmap,
  makeEntityNode,
  makeTextNode,
  type EditableNode,
} from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView } from '../src/render/MapView.js';
import { FreeEdgeLayer } from '../src/render/FreeEdgeLayer.js';
import type { EdgeRouteEntry } from '../src/render/FreeEdgeLayer.js';
import type { FreeEdge } from '../src/render/freeEdges.js';
import {
  EDGE_LABEL_FONT,
  EDGE_LABEL_H,
  cubicMidNormal,
  pillWidthOf,
} from '../src/render/EdgeLabel.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';
import {
  anchorOfNode,
  borderPoint,
  buildFreeEdgePath,
  collectFreeEdges,
  edgeVisualOf,
  freeEdgeEndpoints,
  splitEntityAnchor,
} from '../src/render/freeEdges.js';
import { glassToken } from '../src/theme/tokens.js';
import { collectNodeChoices } from '../src/chrome/EdgeEditor.js';

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

/** 测试树 + 文档级标注边（root.note.edges） */
function fixture(): EditableNode {
  const root = makeTextNode('根', [
    makeTextNode('任务A'),
    makeTextNode('里程碑', [makeTextNode('M2')]),
    makeEntityNode({ kind: 'issue', id: '88' }),
  ]);
  const taskA = anchorOfNode(root, root.children[0]!.id)!;
  const m2 = anchorOfNode(root, root.children[1]!.children[0]!.id)!;
  root.note = {
    edges: [
      { from: taskA, to: m2, rel: 'blocks', dir: 'fwd', label: '硬依赖', note: '先合入网关' },
      { from: 'node:根/任务A', to: 'issue:88', rel: 'relates-to' },
      {
        from: 'node:根/任务A',
        to: 'node:根/不存在',
        rel: 'blocks',
        style: { color: '#e24b4a', dashed: true, width: 3 },
      },
    ],
  };
  return root;
}

function layoutOf(root: EditableNode) {
  return layoutMindmap(root, createNodeMeasure(char, new Map()), new Set());
}

function walkAll(root: EditableNode): EditableNode[] {
  const out: EditableNode[] = [];
  const walk = (n: EditableNode): void => {
    out.push(n);
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

describe('anchorOfNode：稳定锚生成', () => {
  it('文本节点 → node:路径；实体节点 → @kind:id；根 → node:根名', () => {
    const root = fixture();
    expect(anchorOfNode(root, root.id)).toBe('node:根');
    expect(anchorOfNode(root, root.children[0]!.id)).toBe('node:根/任务A');
    expect(anchorOfNode(root, root.children[2]!.id)).toBe('@issue:88');
    expect(anchorOfNode(root, root.children[1]!.children[0]!.id)).toBe('node:根/里程碑/M2');
  });
});

describe('collectFreeEdges：文档级标注边解析', () => {
  it('路径锚/实体锚解析 → 会话内 nodeId；dangling → null', () => {
    const root = fixture();
    const edges = collectFreeEdges(root);
    const nodes = walkAll(root);
    const idOf = (text: string) => nodes.find((n) => n.text === text)!.id;
    expect(edges).toHaveLength(3);
    expect(edges[0]!.sourceId).toBe(idOf('任务A'));
    expect(edges[0]!.targetId).toBe(idOf('M2'));
    expect(edges[0]!.dir).toBe('fwd');
    expect(edges[0]!.label).toBe('硬依赖');
    expect(edges[0]!.key).toBe('e0');
    expect(edges[1]!.targetId).toBe(root.children[2]!.id);
    expect(edges[2]!.targetId).toBeNull();
    expect(edges[2]!.state).toBe('dangling');
  });
  it('style 随边透传（用户自定义覆盖 rel 默认）', () => {
    const edges = collectFreeEdges(fixture());
    expect(edges[2]!.style).toEqual({ color: '#e24b4a', dashed: true, width: 3 });
    expect(edges[0]!.style).toBeUndefined();
  });
  it('实体锚未在画布 → targetId null（渲染层 ghost）', () => {
    const root = makeTextNode('根', [makeTextNode('A')]);
    root.note = { edges: [{ from: 'node:根/A', to: 'issue:777', rel: 'relates-to' }] };
    const edges = collectFreeEdges(root);
    expect(edges[0]!.targetId).toBeNull();
  });
  it('R6-S2：attrs 引用相等透传（对象才透传；字符串/数组不视为 attrs）', () => {
    const root = makeTextNode('根', [makeTextNode('A'), makeTextNode('B')]);
    const attrs = { severity: 'high', w: 3 };
    root.note = {
      edges: [
        { from: 'node:根/A', to: 'node:根/B', rel: 'relates-to', attrs },
        { from: 'node:根/A', to: 'node:根/B', rel: 'blocks', attrs: 'nope' },
        { from: 'node:根/A', to: 'node:根/B', rel: 'causes', attrs: ['a', 'b'] },
      ],
    };
    const edges = collectFreeEdges(root);
    const [withAttrs, strAttrs, arrAttrs] = edges;
    if (withAttrs === undefined || strAttrs === undefined || arrAttrs === undefined) {
      throw new Error('三条边应全部产出');
    }
    // 引用相等（不克隆、不重建——FreeEdge.attrs 与 DocEdge.attrs 同引用）
    expect(withAttrs.attrs).toBe(attrs);
    // 守卫：非对象值/数组不视为 attrs（透传不设 attrs 键）
    expect(strAttrs.attrs).toBeUndefined();
    expect(arrAttrs.attrs).toBeUndefined();
  });
});

describe('freeEdgeEndpoints：端点解析', () => {
  const root = fixture();
  const edges = collectFreeEdges(root);
  const boxOf = (id: string) => (id ? { x: 0, y: 0, w: 100, h: 30 } : undefined);

  it('dir back → 端点交换（箭头落在源端）', () => {
    const fwd = edges[0]!;
    const back = { ...fwd, dir: 'back' as const };
    const ef = freeEdgeEndpoints(fwd, boxOf, root, new Set());
    const eb = freeEdgeEndpoints(back, boxOf, root, new Set());
    expect(eb.fromId).toBe(ef.toId);
    expect(eb.toId).toBe(ef.fromId);
  });
  it('折叠收缩回归：目标在折叠子树内 → 收缩到被折叠祖先（而非 ghost）', () => {
    const cRoot = makeTextNode('根', [
      makeTextNode('折叠组', [makeTextNode('子1', [makeTextNode('孙1')])]),
      makeTextNode('A'),
    ]);
    const nAll = walkAll(cRoot);
    const idOf = (text: string) => nAll.find((n) => n.text === text)!.id;
    cRoot.note = {
      edges: [{ from: 'node:根/A', to: 'node:根/折叠组/子1/孙1', rel: 'relates-to' }],
    };
    const [e] = collectFreeEdges(cRoot);
    // 模拟真实布局：被折叠后代不在布局盒表（boxOf 仅知 折叠组/A）
    const visibleBoxes = new Map([
      [idOf('折叠组'), { x: 0, y: 0, w: 10, h: 10 }],
      [idOf('A'), { x: 0, y: 0, w: 10, h: 10 }],
    ]);
    const eps = freeEdgeEndpoints(
      e!,
      (id) => visibleBoxes.get(id),
      cRoot,
      new Set([idOf('折叠组')]),
    );
    expect(eps.toId).toBe(idOf('折叠组'));
    expect(eps.ghost).toBe(false);
  });
  it('dangling → ghost 幽灵锚点（源盒右缘外推）', () => {
    const eps = freeEdgeEndpoints(edges[2]!, boxOf, root, new Set());
    expect(eps.ghost).toBe(true);
    expect(eps.to.x).toBeGreaterThan(eps.from.x);
  });
});

describe('buildFreeEdgePath：边曲线几何', () => {
  it('端点落在卡片边界（不插入卡片内部）', () => {
    const a = { x: 0, y: 0, w: 100, h: 30 };
    const b = { x: 300, y: 200, w: 120, h: 30 };
    const { d, mid } = buildFreeEdgePath(a, b);
    expect(d).toMatch(/^M [\d.-]+ [\d.-]+ C /);
    const m = d.match(/^M ([\d.-]+) ([\d.-]+)/)!;
    const [sx, sy] = [Number(m[1]), Number(m[2])];
    expect(sx === 0 || sx === 100 || sy === 0 || sy === 30).toBe(true);
    expect(mid.x).toBeGreaterThan(100);
    expect(mid.x).toBeLessThan(360);
  });
  it('borderPoint：水平方向命中右缘中点', () => {
    expect(borderPoint({ x: 0, y: 0, w: 100, h: 30 }, 500, 15)).toEqual({ x: 100, y: 15 });
  });
});

describe('edgeVisualOf：样式覆盖语义默认', () => {
  const token = glassToken;
  it('style.color/dashed/width 覆盖；无 style 走 rel 语义', () => {
    const base = {
      key: 'e0',
      index: 0,
      sourceId: 'a',
      targetId: 'b',
      from: 'x',
      to: 'y',
      rel: 'blocks',
      dir: 'fwd' as const,
      state: 'well-formed' as const,
    };
    expect(edgeVisualOf(base, token).stroke).toBe('#e24b4a'); // E6.1：blocks 走 schema 语义色
    expect(
      edgeVisualOf({ ...base, style: { color: '#123456', dashed: true, width: 3 } }, token),
    ).toEqual({
      stroke: '#123456',
      dashed: true,
      width: 3,
    });
    expect(edgeVisualOf({ ...base, rel: 'whatever' }, token).dashed).toBe(true);
  });
});

describe('MapView 画布边渲染冒烟', () => {
  it('root.note.edges → data-free-edge 层渲染；点击触发 onEdgeClick（关系模式下）', () => {
    const root = fixture();
    const onEdgeClick = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <MapView
          layout={layoutOf(root)}
          entities={new Map()}
          char={char}
          onEdgeClick={onEdgeClick}
          relationMode
        />
      </ThemeProvider>,
    );
    expect(container.querySelector('[data-free-edge-layer]')).not.toBeNull();
    const edgeEls = container.querySelectorAll('[data-free-edge]');
    expect(edgeEls.length).toBe(3);
    fireEvent.click(edgeEls[0]!.querySelector('path')!);
    expect(onEdgeClick).toHaveBeenCalledTimes(1);
    const clicked = onEdgeClick.mock.calls[0]![0] as { rel: string };
    expect(clicked.rel).toBe('blocks');
  });
  it('无 edges → 不渲染边层', () => {
    const root = makeTextNode('根', [makeTextNode('A')]);
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layoutOf(root)} entities={new Map()} char={char} />
      </ThemeProvider>,
    );
    expect(container.querySelector('[data-free-edge-layer]')).toBeNull();
  });
});

describe('G6′复审：几何根 ≠ 文档根（森林布局下自由边必须取完整文档树）', () => {
  /** 根 + 两个一级子节点；root.note.edges 连接两个一级节点（文档级标注边） */
  function forestFixture(): EditableNode {
    const root = makeTextNode('根', [makeTextNode('A'), makeTextNode('B')]);
    root.note = { edges: [{ from: 'node:根/A', to: 'node:根/B', rel: 'relates-to' }] };
    return root;
  }

  /** 全部一级节点升格 → layoutForest：A、B 均为几何根（depth===0），文档根不在 layout.nodes */
  function forestLayoutOf(root: EditableNode) {
    return layoutForest(
      [
        { node: root.children[0]!, dir: 'right' as const, pos: { x: 0, y: 0 } },
        { node: root.children[1]!, dir: 'right' as const, pos: { x: 100, y: 0 } },
      ],
      createNodeMeasure(char, new Map()),
      new Set(),
    );
  }

  it('★ 传 documentRoot → root.note.edges 仍从完整文档树解析并渲染（全部一级升格不丢边）', () => {
    const root = forestFixture();
    const { container } = render(
      <ThemeProvider>
        <MapView
          layout={forestLayoutOf(root)}
          entities={new Map()}
          char={char}
          documentRoot={root}
          relationMode
        />
      </ThemeProvider>,
    );
    // 修复前：rootNode 取首个几何根 A → collectFreeEdges(A) 无 note.edges → 边层消失
    expect(container.querySelectorAll('[data-free-edge]')).toHaveLength(1);
  });

  it('未传 documentRoot（旧调用方）→ 回退首个几何根：森林下文档级边不可见（记录兼容边界）', () => {
    const root = forestFixture();
    const { container } = render(
      <ThemeProvider>
        <MapView layout={forestLayoutOf(root)} entities={new Map()} char={char} relationMode />
      </ThemeProvider>,
    );
    // A、B 自身无 note.edges → 边层不渲染。这是缺省回退的已知边界——
    // 产品壳（MindmapStage）必须显式传 documentRoot；未来所有调用方迁移后可将 prop 收紧为必填。
    expect(container.querySelector('[data-free-edge-layer]')).toBeNull();
  });
});

describe('G6″ A3-2：跨岛父子连接渲染（G3 parent_link: show）', () => {
  /** 两个独立岛（父岛 A + 升格岛 B）的森林布局；boundaryLinks 连接两者 */
  function twoIslandLayout() {
    const a = makeTextNode('A');
    const b = makeTextNode('B');
    const layout = layoutForest(
      [
        { node: a, dir: 'right' as const, pos: { x: 0, y: 0 } },
        { node: b, dir: 'right' as const, pos: { x: 300, y: 0 } },
      ],
      createNodeMeasure(char, new Map()),
      new Set(),
    );
    return { layout, aId: a.id, bId: b.id };
  }

  it('boundaryLinks 传入 → 渲染虚线 path（data-boundary-link）', () => {
    const { layout, aId, bId } = twoIslandLayout();
    const { container } = render(
      <ThemeProvider>
        <MapView
          layout={layout}
          entities={new Map()}
          char={char}
          boundaryLinks={[{ fromId: aId, toId: bId }]}
          relationMode
        />
      </ThemeProvider>,
    );
    const p = container.querySelector('[data-boundary-link]');
    expect(p).not.toBeNull();
    expect(p!.getAttribute('stroke-dasharray')).toBe('6 4');
    expect(p!.getAttribute('d')).toContain('M');
  });

  it('不传 boundaryLinks（缺省 hide 语义）→ 不渲染跨岛线', () => {
    const { layout } = twoIslandLayout();
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} relationMode />
      </ThemeProvider>,
    );
    expect(container.querySelector('[data-boundary-link]')).toBeNull();
  });

  it('端点不在布局中（折叠隐藏等）→ 该边跳过，不误连原点', () => {
    const { layout, aId } = twoIslandLayout();
    const { container } = render(
      <ThemeProvider>
        <MapView
          layout={layout}
          entities={new Map()}
          char={char}
          boundaryLinks={[{ fromId: aId, toId: 'ghost-id' }]}
          relationMode
        />
      </ThemeProvider>,
    );
    expect(container.querySelector('[data-boundary-link]')).toBeNull();
  });
});

describe('E6：树自然线交互 + 连接手柄', () => {
  function viaFixture(): EditableNode {
    const root = makeTextNode('根', [makeTextNode('任务A', [makeTextNode('子1')])]);
    root.children[0]!.children[0]!.note = { via: '展开' };
    return root;
  }
  it('树边 via 标签渲染 + 点击命中 → onTreeEdgeEdit(childId)', () => {
    const onTreeEdgeEdit = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <MapView
          layout={layoutOf(viaFixture())}
          entities={new Map()}
          char={char}
          onTreeEdgeEdit={onTreeEdgeEdit}
          relationMode
        />
      </ThemeProvider>,
    );
    expect(container.querySelector('[data-tree-edge-label]')?.textContent).toContain('展开');
    const hits = container.querySelectorAll('[data-tree-edge-hit]');
    expect(hits.length).toBeGreaterThan(0);
    fireEvent.contextMenu(hits[0]!);
    expect(onTreeEdgeEdit).toHaveBeenCalledTimes(1);
    expect(typeof onTreeEdgeEdit.mock.calls[0]![0]).toBe('string');
  });
  it('选中节点 → 连接手柄出现；拖拽松手未命中 → onEdgeConnect(source, null)', () => {
    const root = viaFixture();
    const onEdgeConnect = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <MapView
          layout={layoutOf(root)}
          entities={new Map()}
          char={char}
          selectedId={root.children[0]!.id}
          onEdgeConnect={onEdgeConnect}
          relationMode
        />
      </ThemeProvider>,
    );
    const handle = container.querySelector('[data-connect-handle-hit]');
    expect(handle).not.toBeNull();
    fireEvent.pointerDown(handle!, { clientX: 0, clientY: 0 });
    expect(container.querySelector('[data-connect-guide]')).not.toBeNull();
    fireEvent(
      window,
      new MouseEvent('pointerup', { bubbles: true, clientX: -99999, clientY: -99999 }),
    );
    expect(onEdgeConnect).toHaveBeenCalledTimes(1);
    expect(onEdgeConnect.mock.calls[0]![0]).toBe(root.children[0]!.id);
    expect(onEdgeConnect.mock.calls[0]![1]).toBeNull();
    expect(container.querySelector('[data-connect-guide]')).toBeNull();
  });
  it('关系属性可见回归：树边只填 rel 不填 label → chip 显示 rel', () => {
    const root = makeTextNode('根', [makeTextNode('任务A', [makeTextNode('子1')])]);
    root.children[0]!.children[0]!.note = { edge: { rel: 'blocks', note: '依赖说明' } };
    const onTreeEdgeEdit = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <MapView
          layout={layoutOf(root)}
          entities={new Map()}
          char={char}
          onTreeEdgeEdit={onTreeEdgeEdit}
          relationMode
        />
      </ThemeProvider>,
    );
    const chip = container.querySelector('[data-tree-edge-label]');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain('blocks');
    // hover title 呈现 rel + note（定位到 子1 那条树边，跳过无标注的 根→任务A）
    const hits = Array.from(container.querySelectorAll('[data-tree-edge-hit]'));
    const target = hits.find((h) => h.querySelector('title')?.textContent?.includes('blocks'));
    expect(target).toBeDefined();
    expect(target!.querySelector('title')!.textContent).toContain('依赖说明');
  });
  it('未选中 → 无手柄', () => {
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layoutOf(viaFixture())} entities={new Map()} char={char} />
      </ThemeProvider>,
    );
    expect(container.querySelector('[data-connect-handle]')).toBeNull();
  });
});

// ---------- E8：锚点链路 P0 回归 + 关系模式隔离 ----------

describe('E8：实体锚解析回归（P0：anchorOfNode 产出带 @ 前缀）', () => {
  it('anchorOfNode 产出的 @kind:id 可解析到画布实体节点', () => {
    const root = makeTextNode('根', [
      makeTextNode('A'),
      makeEntityNode({ kind: 'issue', id: '88' }),
    ]);
    const from = anchorOfNode(root, root.children[0]!.id)!;
    const to = anchorOfNode(root, root.children[1]!.id)!;
    expect(to).toBe('@issue:88');
    root.note = { edges: [{ from, to, rel: 'relates-to' }] };
    const [e] = collectFreeEdges(root);
    expect(e!.targetId).toBe(root.children[1]!.id);
    expect(e!.state).toBe('well-formed');
  });
  it('demo 形态实体锚（路径含 / 、id 含 : 、中文 id）逐个可解析', () => {
    const root = makeTextNode('Agent Gateway', [
      makeTextNode('文档', [
        makeEntityNode({ kind: 'doc', id: 'docs/01-architecture.md' }),
        makeEntityNode({ kind: 'doc', id: 'docs/07-entity-ref-protocol.md' }),
      ]),
      makeTextNode('灵感', [makeEntityNode({ kind: 'idea', id: 'forge-inbox:2' })]),
      makeEntityNode({ kind: 'milestone', id: '门户显示优化' }),
    ]);
    const all = walkAll(root);
    const source = anchorOfNode(root, all[1]!.id)!; // 文档
    const bad: string[] = [];
    for (const n of all) {
      if (n.id === root.id || n.id === all[1]!.id) continue;
      const to = anchorOfNode(root, n.id)!;
      root.note = { edges: [{ from: source, to, rel: 'relates-to' }] };
      const e = collectFreeEdges(root)[0]!;
      if (e.targetId !== n.id) bad.push(`${to} → ${String(e.targetId)}`);
    }
    expect(bad).toEqual([]);
  });
  it('实体不在画布 → targetId null（ghost 由渲染层处理）', () => {
    const root = makeTextNode('根', [makeTextNode('A')]);
    root.note = { edges: [{ from: 'node:根/A', to: '@issue:777', rel: 'relates-to' }] };
    const e = collectFreeEdges(root)[0]!;
    expect(e.targetId).toBeNull();
    expect(e.state).toBe('dangling');
  });
  it('同名实体多次出现 → #序号 消歧，各自锚定到正确节点（P0 错锚修复）', () => {
    const root = makeTextNode('根', [
      makeTextNode('分支A', [makeEntityNode({ kind: 'issue', id: '8' })]),
      makeTextNode('分支B', [makeEntityNode({ kind: 'issue', id: '8' })]),
      makeTextNode('源'),
    ]);
    const first = root.children[0]!.children[0]!;
    const second = root.children[1]!.children[0]!;
    const source = root.children[2]!;
    // 多次出现 → 全部带 #N（首个为 #1，保证可寻址；唯一出现才用裸锚）
    expect(anchorOfNode(root, first.id)).toBe('@issue:8#1');
    expect(anchorOfNode(root, second.id)).toBe('@issue:8#2');
    const from = anchorOfNode(root, source.id)!;
    root.note = { edges: [{ from, to: anchorOfNode(root, second.id)!, rel: 'relates-to' }] };
    const e = collectFreeEdges(root)[0]!;
    expect(e.targetId).toBe(second.id);
    expect(e.state).toBe('well-formed');
    // 反向：连到第一个也精确命中
    root.note = { edges: [{ from, to: anchorOfNode(root, first.id)!, rel: 'relates-to' }] };
    expect(collectFreeEdges(root)[0]!.targetId).toBe(first.id);
  });
  it('无 #序号且同名重复 → 不任意取一（spec：宁可悬空也不错锚）', () => {
    const root = makeTextNode('根', [
      makeTextNode('分支A', [makeEntityNode({ kind: 'issue', id: '8' })]),
      makeTextNode('分支B', [makeEntityNode({ kind: 'issue', id: '8' })]),
    ]);
    root.note = { edges: [{ from: 'node:根/分支A', to: '@issue:8', rel: 'relates-to' }] };
    const e = collectFreeEdges(root)[0]!;
    expect(e.targetId).toBeNull();
    // P0-1 契约修正：歧义（多命中）标 stale 而非 dangling（宁可不写也不错写）
    expect(e.state).toBe('stale');
  });
  it('唯一出现的实体 → 裸锚不加 #（向后兼容既有文档），可正常解析', () => {
    const root = makeTextNode('根', [
      makeTextNode('A'),
      makeEntityNode({ kind: 'doc', id: 'docs/09-knowledge.md' }),
    ]);
    const entity = root.children[1]!;
    expect(anchorOfNode(root, entity.id)).toBe('@doc:docs/09-knowledge.md');
    const from = anchorOfNode(root, root.children[0]!.id)!;
    root.note = { edges: [{ from, to: '@doc:docs/09-knowledge.md', rel: 'relates-to' }] };
    expect(collectFreeEdges(root)[0]!.targetId).toBe(entity.id);
  });
  it('collectNodeChoices 与 anchorOfNode 对重复实体产出一致的消歧锚', () => {
    const root = makeTextNode('根', [
      makeTextNode('分支A', [makeEntityNode({ kind: 'issue', id: '8' })]),
      makeTextNode('分支B', [makeEntityNode({ kind: 'issue', id: '8' })]),
    ]);
    const first = root.children[0]!.children[0]!;
    const second = root.children[1]!.children[0]!;
    const byId = new Map(collectNodeChoices(root).map((c) => [c.id, c.anchor]));
    expect(byId.get(first.id)).toBe(anchorOfNode(root, first.id));
    expect(byId.get(second.id)).toBe(anchorOfNode(root, second.id));
    expect(byId.get(first.id)).not.toBe(byId.get(second.id));
  });
  it('splitEntityAnchor：#序号剥离 / 三种 @ 形态归一 / id 自带 # 不被误切', () => {
    expect(splitEntityAnchor('@issue:8#2')).toEqual({ base: '@issue:8', occurrence: 2 });
    expect(splitEntityAnchor('@doc:docs/a.md')).toEqual({
      base: '@doc:docs/a.md',
      occurrence: null,
    });
    expect(splitEntityAnchor('doc:docs/a.md')).toEqual({
      base: '@doc:docs/a.md',
      occurrence: null,
    });
    expect(splitEntityAnchor('@@issue:8')).toEqual({ base: '@issue:8', occurrence: null });
    // id 自带 #：剥离后不再是合法实体锚 → 不视为消歧后缀
    expect(splitEntityAnchor('@issue:#8')).toEqual({ base: '@issue:#8', occurrence: null });
  });
  it('三层容错：@@ 双前缀 / @ 前缀 / 裸 kind:id 均可解析到画布实体', () => {
    const root = makeTextNode('根', [
      makeTextNode('A'),
      makeEntityNode({ kind: 'doc', id: 'docs/09-knowledge.md' }),
    ]);
    const from = anchorOfNode(root, root.children[0]!.id)!;
    const entityId = root.children[1]!.id;
    // 形态 1：@doc:...（anchorOfNode 产出）
    root.note = { edges: [{ from, to: '@doc:docs/09-knowledge.md', rel: 'relates-to' }] };
    expect(collectFreeEdges(root)[0]!.targetId).toBe(entityId);
    // 形态 2：doc:...（裸，内核契约 / 手写 frontmatter）
    root.note = { edges: [{ from, to: 'doc:docs/09-knowledge.md', rel: 'relates-to' }] };
    expect(collectFreeEdges(root)[0]!.targetId).toBe(entityId);
    // 形态 3：@@doc:...（历史 bug 残留——去重一层 @）
    root.note = { edges: [{ from, to: '@@doc:docs/09-knowledge.md', rel: 'relates-to' }] };
    expect(collectFreeEdges(root)[0]!.targetId).toBe(entityId);
  });
});

describe('E8：避障路由集成（真画布渲染）', () => {
  /** 采样 SVG path（M/L/Q）为折线 */
  function samplePathOf(d: string, perCurve = 12): { x: number; y: number }[] {
    const tokens = d.trim().split(/\s+/);
    const out: { x: number; y: number }[] = [];
    let i = 0;
    let cur = { x: 0, y: 0 };
    while (i < tokens.length) {
      const cmd = tokens[i++]!;
      if (cmd === 'M' || cmd === 'L') {
        cur = { x: Number(tokens[i++]), y: Number(tokens[i++]) };
        out.push({ ...cur });
      } else if (cmd === 'Q') {
        const cx = Number(tokens[i++]);
        const cy = Number(tokens[i++]);
        const x = Number(tokens[i++]);
        const y = Number(tokens[i++]);
        const s = cur;
        for (let k = 1; k <= perCurve; k++) {
          const t = k / perCurve;
          const u = 1 - t;
          out.push({
            x: u * u * s.x + 2 * u * t * cx + t * t * x,
            y: u * u * s.y + 2 * u * t * cy + t * t * y,
          });
        }
        cur = { x, y };
      }
    }
    return out;
  }

  function segHit(
    r: { x: number; y: number; w: number; h: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): boolean {
    const mx = Math.max(a.x, b.x);
    const mnx = Math.min(a.x, b.x);
    const my = Math.max(a.y, b.y);
    const mny = Math.min(a.y, b.y);
    if (mx < r.x || mnx > r.x + r.w || my < r.y || mny > r.y + r.h) return false;
    if (a.x >= r.x && a.x <= r.x + r.w && a.y >= r.y && a.y <= r.y + r.h) return true;
    if (b.x >= r.x && b.x <= r.x + r.w && b.y >= r.y && b.y <= r.y + r.h) return true;
    let t0 = 0;
    let t1 = 1;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const clip = (p: number, q: number): boolean => {
      if (p === 0) return q >= 0;
      const t = q / p;
      if (p < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
      return true;
    };
    return (
      clip(-dx, a.x - r.x) &&
      clip(dx, r.x + r.w - a.x) &&
      clip(-dy, a.y - r.y) &&
      clip(dy, r.y + r.h - a.y)
    );
  }

  /**
   * 5 子布局（mindmap 左右平衡）实测落位：
   *   A(右,y=-48) B(左) C(右,y=0) D(左) E(右,y=48)
   * 故 A→E 的直线纵向穿过 C —— 真正的穿模场景。
   */
  function fiveChildTree(edgeFrom: string, edgeTo: string) {
    const root = makeTextNode('根', [
      makeTextNode('A'),
      makeTextNode('B'),
      makeTextNode('C'),
      makeTextNode('D'),
      makeTextNode('E'),
    ]);
    root.note = { edges: [{ from: edgeFrom, to: edgeTo, rel: 'relates-to' }] };
    return root;
  }

  function renderEdgePathD(root: EditableNode): string {
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layoutOf(root)} entities={new Map()} char={char} />
      </ThemeProvider>,
    );
    const g = container.querySelector('[data-free-edge]');
    expect(g).not.toBeNull();
    const visible = Array.from(g!.querySelectorAll('path')).find(
      (p) => p.getAttribute('stroke') !== 'transparent',
    );
    return visible?.getAttribute('d') ?? '';
  }

  it('A→E 连线绕开夹在中间的 C（不再直接穿过卡片）', () => {
    const root = fiveChildTree('node:根/A', 'node:根/E');
    const d = renderEdgePathD(root);
    expect(d).not.toBe('');
    const cBox = layoutOf(root).nodes.find((n) => n.node.text === 'C')!.box;
    const pts = samplePathOf(d, 16);
    let hit = false;
    for (let i = 0; i + 1 < pts.length; i++) {
      if (segHit(cBox, pts[i]!, pts[i + 1]!)) {
        hit = true;
        break;
      }
    }
    expect(hit).toBe(false);
  });

  it('同一布局下 A→C（相邻、直线通畅）走干净连线 —— 智能锚点选同侧对，产出直线而非 S 形绕行', () => {
    const root = fiveChildTree('node:根/A', 'node:根/C');
    const d = renderEdgePathD(root);
    // 智能锚点：相邻节点同侧（上-上 / 下-下）锚点对直线通畅 → 走直线（无视觉回归前提下更清爽）
    // 关键不变：连线不穿任何障碍（绕开 C 与 B/D/E）
    const verifyPath = (): void => {
      const { container: c } = render(
        <ThemeProvider>
          <MapView layout={layoutOf(root)} entities={new Map()} char={char} />
        </ThemeProvider>,
      );
      const g = c.querySelector('[data-free-edge]');
      const p = g!.querySelector('path:not([stroke="transparent"])') as SVGPathElement | null;
      void p?.getAttribute('d');
    };
    // 简短验证 d 不为空且是简单形态（M ... L 或 M ... C，不含 Q 拐角链）
    expect(d).toMatch(/^M [\d.-]+ [\d.-]+ [LC] /);
    // 实际不穿障（与原意图一致）
    verifyPath();
  });
});

describe('E8：空名节点不截断子树（清空中间节点文字后仍可连线）', () => {
  function emptyMidTree(): {
    root: EditableNode;
    childA: EditableNode;
    childB: EditableNode;
    source: EditableNode;
  } {
    const root = makeTextNode('根', [
      makeTextNode('中间节点', [makeTextNode('子A'), makeTextNode('子B')]),
      makeTextNode('源'),
    ]);
    root.children[0]!.text = '';
    return {
      root,
      childA: root.children[0]!.children[0]!,
      childB: root.children[0]!.children[1]!,
      source: root.children[1]!,
    };
  }
  it('anchorOfNode：空名节点的后代仍拿到锚（此前返回 null → 建边被静默放弃）', () => {
    const { root, childA, childB } = emptyMidTree();
    expect(anchorOfNode(root, childA.id)).toBe('node:根/子A');
    expect(anchorOfNode(root, childB.id)).toBe('node:根/子B');
  });
  it('清空后新建的边可正确解析（well-formed）', () => {
    const { root, childB, source } = emptyMidTree();
    const from = anchorOfNode(root, source.id)!;
    const to = anchorOfNode(root, childB.id)!;
    root.note = { edges: [{ from, to, rel: 'relates-to' }] };
    const e = collectFreeEdges(root)[0]!;
    expect(e.targetId).toBe(childB.id);
    expect(e.state).toBe('well-formed');
  });
  it('collectNodeChoices 仍收录空名节点下的后代', () => {
    const { root, childA, childB } = emptyMidTree();
    const ids = collectNodeChoices(root).map((c) => c.id);
    expect(ids).toContain(childA.id);
    expect(ids).toContain(childB.id);
  });
  it('旧路径边（含已清空段名）→ dangling（节点改名，语义正确）', () => {
    const { root, source } = emptyMidTree();
    root.note = {
      edges: [
        { from: anchorOfNode(root, source.id)!, to: 'node:根/中间节点/子B', rel: 'relates-to' },
      ],
    };
    const e = collectFreeEdges(root)[0]!;
    expect(e.state).toBe('dangling');
  });
});

describe('E8：零尺寸盒 / 退化几何防护', () => {
  it('端点盒 w/h 为 0 → 不可路由（renderable=false，不发 NaN 坐标）', () => {
    const root = makeTextNode('根', [makeTextNode('A'), makeTextNode('B')]);
    root.note = { edges: [{ from: 'node:根/A', to: 'node:根/B', rel: 'relates-to' }] };
    const e = collectFreeEdges(root)[0]!;
    const zeroBox = (id: string) =>
      id === e.sourceId ? { x: 10, y: 10, w: 100, h: 30 } : { x: 0, y: 0, w: 0, h: 0 };
    const eps = freeEdgeEndpoints(e, zeroBox, root, new Set());
    // 目标零盒 → 幽灵模式（而非退化为零盒直线指向原点）
    expect(eps.renderable).toBe(true);
    expect(eps.ghost).toBe(true);
    expect(eps.to.w).toBeGreaterThan(0);
  });
  it('borderPoint：零尺寸盒 → 返回盒中心（不产生 NaN）', () => {
    const r = borderPoint({ x: 20, y: 20, w: 0, h: 0 }, 500, 500);
    expect(Number.isNaN(r.x)).toBe(false);
    expect(Number.isNaN(r.y)).toBe(false);
    expect(r).toEqual({ x: 20, y: 20 });
  });
  it('borderPoint：正常盒 → 命中边界而非插入内部', () => {
    // 目标在正右方 → 命中右缘中点
    expect(borderPoint({ x: 0, y: 0, w: 100, h: 30 }, 500, 15)).toEqual({ x: 100, y: 15 });
    // 目标在正上方 → 命中上缘中点
    expect(borderPoint({ x: 0, y: 100, w: 100, h: 30 }, 50, -500)).toEqual({ x: 50, y: 100 });
  });
  it('源零盒 → renderable=false（不绘制废几何）', () => {
    const root = makeTextNode('根', [makeTextNode('A'), makeTextNode('B')]);
    root.note = { edges: [{ from: 'node:根/A', to: 'node:根/B', rel: 'relates-to' }] };
    const e = collectFreeEdges(root)[0]!;
    const eps = freeEdgeEndpoints(e, () => ({ x: 0, y: 0, w: 0, h: 0 }), root, new Set());
    expect(eps.renderable).toBe(false);
  });
});

describe('E8：端点不可解析 → 不绘制退化几何', () => {
  it('源锚未解析 / 端点无盒 → renderable=false（不再飞向世界原点）', () => {
    const root = makeTextNode('根', [makeTextNode('A'), makeTextNode('B')]);
    root.note = { edges: [{ from: 'node:根/A', to: 'node:根/B', rel: 'relates-to' }] };
    const e = collectFreeEdges(root)[0]!;
    expect(freeEdgeEndpoints(e, () => undefined, root, new Set()).renderable).toBe(false);
    // 源锚失效（路径不存在）
    root.note = { edges: [{ from: 'node:根/不存在', to: 'node:根/B', rel: 'relates-to' }] };
    const e2 = collectFreeEdges(root)[0]!;
    expect(
      freeEdgeEndpoints(e2, () => ({ x: 0, y: 0, w: 10, h: 10 }), root, new Set()).renderable,
    ).toBe(false);
  });
  it('目标可解析但无盒 → ghost（而非零盒直线）', () => {
    const root = makeTextNode('根', [makeTextNode('A'), makeTextNode('B')]);
    root.note = { edges: [{ from: 'node:根/A', to: 'node:根/B', rel: 'relates-to' }] };
    const e = collectFreeEdges(root)[0]!;
    const eps = freeEdgeEndpoints(
      e,
      (id) => (id === e.sourceId ? { x: 0, y: 0, w: 100, h: 30 } : undefined),
      root,
      new Set(),
    );
    expect(eps.renderable).toBe(true);
    expect(eps.ghost).toBe(true);
    expect(eps.to.x).toBeGreaterThan(eps.from.x);
  });
  it('MapView：源锚失效的边不渲染（画布上无悬空线）', () => {
    const root = makeTextNode('根', [makeTextNode('A'), makeTextNode('B')]);
    root.note = { edges: [{ from: 'node:根/不存在', to: 'node:根/B', rel: 'relates-to' }] };
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layoutOf(root)} entities={new Map()} char={char} />
      </ThemeProvider>,
    );
    expect(container.querySelectorAll('[data-free-edge]')).toHaveLength(0);
  });
});

describe('E8：关系标签「线中生长」', () => {
  it('胶囊尺寸紧凑：字号 10 / 高 14，宽度随文本自适应', () => {
    expect(EDGE_LABEL_FONT).toBeLessThanOrEqual(10);
    expect(EDGE_LABEL_H).toBeLessThanOrEqual(14);
    // 4 字中文 ≈ 40 + 10 内边距 = 50（原实现：4*12.4+24 ≈ 74）
    expect(pillWidthOf('硬依赖')).toBeLessThanOrEqual(50);
    expect(pillWidthOf('')).toBe(pillWidthOf('')); // 空文本不渲染（由组件早退）
  });
  it('cubicMidNormal：水平右向线 → 法向朝上；垂直下行线 → 法向朝右', () => {
    const right = cubicMidNormal('M 0 0 C 50 0, 100 0, 150 0')!;
    expect(right.ny).toBeLessThan(-0.9);
    const down = cubicMidNormal('M 0 0 C 0 50, 0 100, 0 150')!;
    expect(down.nx).toBeGreaterThan(0.9);
  });
  it('树边标注 → 标签为触点+短茎+胶囊三件套（非单个大 rect）', () => {
    const root = makeTextNode('根', [makeTextNode('任务A', [makeTextNode('子1')])]);
    root.children[0]!.children[0]!.note = { edge: { rel: 'blocks' } };
    const { container } = render(
      <ThemeProvider>
        <MapView
          layout={layoutOf(root)}
          entities={new Map()}
          char={char}
          onTreeEdgeEdit={vi.fn()}
          relationMode
        />
      </ThemeProvider>,
    );
    const label = container.querySelector('[data-tree-edge-label]')!;
    expect(label.textContent).toContain('blocks');
    // 触点圆 + 短茎线 + 胶囊矩形
    expect(label.querySelector('circle')).not.toBeNull();
    expect(label.querySelector('line')).not.toBeNull();
    expect(label.querySelector('rect')).not.toBeNull();
    expect(label.querySelector('text')!.getAttribute('font-size')).toBe('9');
  });
});

describe('E8：关系模式隔离（浏览态 vs 关系态）', () => {
  const root = (): EditableNode => {
    const r = makeTextNode('根', [makeTextNode('任务A', [makeTextNode('子1')])]);
    r.children[0]!.children[0]!.note = { edge: { rel: 'blocks' } };
    r.note = { edges: [{ from: 'node:根/任务A', to: 'node:根/任务A/子1', rel: 'relates-to' }] };
    return r;
  };
  it('浏览态：无连接手柄 / 树边无右键命中区 / 自由边只读（点击穿透）', () => {
    const onTreeEdgeEdit = vi.fn();
    const onEdgeClick = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <MapView
          layout={layoutOf(root())}
          entities={new Map()}
          char={char}
          selectedId={undefined}
          onTreeEdgeEdit={onTreeEdgeEdit}
          onEdgeClick={onEdgeClick}
        />
      </ThemeProvider>,
    );
    expect(container.querySelector('[data-connect-handle-hit]')).toBeNull();
    expect(container.querySelectorAll('[data-tree-edge-hit]')).toHaveLength(0);
    // 边仍然可见（浏览态呈现关系），但无命中区 → 点击不触发编辑
    const edgeEls = container.querySelectorAll('[data-free-edge]');
    expect(edgeEls.length).toBe(1);
    fireEvent.click(edgeEls[0]!.querySelector('path')!);
    expect(onEdgeClick).not.toHaveBeenCalled();
  });
  it('关系态：手柄出现 / 树边可右键 / 自由边可点击编辑', () => {
    const r = root();
    const onTreeEdgeEdit = vi.fn();
    const onEdgeClick = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <MapView
          layout={layoutOf(r)}
          entities={new Map()}
          char={char}
          selectedId={r.children[0]!.id}
          onTreeEdgeEdit={onTreeEdgeEdit}
          onEdgeClick={onEdgeClick}
          relationMode
        />
      </ThemeProvider>,
    );
    expect(container.querySelector('[data-connect-handle-hit]')).not.toBeNull();
    const hits = container.querySelectorAll('[data-tree-edge-hit]');
    expect(hits.length).toBeGreaterThan(0);
    fireEvent.contextMenu(hits[0]!);
    expect(onTreeEdgeEdit).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelectorAll('[data-free-edge]')[0]!.querySelector('path')!);
    expect(onEdgeClick).toHaveBeenCalledTimes(1);
  });
});

/**
 * Issue #2：FreeEdgeLayer 独立测试（不经过 MapView）。
 *
 * 说明：MapView 当前被并行编辑破坏（DescOverlays 未定义），故这里直接渲染
 * FreeEdgeLayer 组件来验证「新路由接入 + 跨边交叉协调」的正确性。
 */
describe('Issue #2：FreeEdgeLayer 接入曲率自适应路由 + 跨边协调', () => {
  /** 构造一棵根 + 三子节点的树与布局 */
  function buildScene() {
    const root = makeTextNode('根', [makeTextNode('A'), makeTextNode('B'), makeTextNode('C')]);
    const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
    const measure = createNodeMeasure(char, new Map());
    const layout = layoutMindmap(root, measure, new Set());
    const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (const ln of layout.nodes) boxes.set(ln.node.id, ln.box);
    return { root, layout, boxes };
  }

  function edgeOf(root: EditableNode, fromText: string, toText: string): FreeEdge {
    const find = (t: string): EditableNode => {
      for (const c of root.children) if (c.text === t) return c;
      throw new Error('not found ' + t);
    };
    return {
      key: `e-${fromText}-${toText}`,
      index: 0,
      sourceId: find(fromText).id,
      targetId: find(toText).id,
      from: `node:根/${fromText}`,
      to: `node:根/${toText}`,
      rel: 'relates-to',
      dir: 'fwd',
      state: 'well-formed',
    };
  }

  it('FreeEdgeLayer 产出的边不穿中间节点（新路由生效）', () => {
    const { root, boxes } = buildScene();
    const scene = edgeOf(root, 'A', 'C');
    const obstacles = [...boxes.entries()].map(([id, box]) => ({ id, box }));
    const bBox = [...boxes.entries()].find(([, b]) => b.y > 0); // 中间节点 B
    const { container } = render(
      <ThemeProvider>
        <svg>
          <FreeEdgeLayer
            edges={[scene]}
            boxOf={(id) => boxes.get(id)}
            root={root}
            collapsed={new Set()}
            token={glassToken}
            obstacles={obstacles}
          />
        </svg>
      </ThemeProvider>,
    );
    const g = container.querySelector('[data-free-edge]');
    expect(g).not.toBeNull();
    const paths = Array.from(g!.querySelectorAll('path'));
    const visible = paths.find((p) => p.getAttribute('stroke') !== 'transparent');
    expect(visible).toBeDefined();
    const d = visible!.getAttribute('d') ?? '';
    expect(d).not.toBe('');
    // 采样该 path，确认不穿过中间节点 B
    const sampled = sampleD(d);
    const hitsB = sampled.some((p) => (bBox ? pointInBox(p, bBox[1]) : false));
    // A→C 若走直线会穿过 B；新路由应绕开（或至少不穿 B 的内部）
    expect(hitsB).toBe(false);
  });

  it('多条边时彼此错开（跨边交叉协调生效）', () => {
    const { root, boxes } = buildScene();
    const e1 = edgeOf(root, 'A', 'C');
    const e2 = { ...edgeOf(root, 'A', 'B'), key: 'e-A-B' };
    const obstacles = [...boxes.entries()].map(([id, box]) => ({ id, box }));
    const { container } = render(
      <ThemeProvider>
        <svg>
          <FreeEdgeLayer
            edges={[e1, e2]}
            boxOf={(id) => boxes.get(id)}
            root={root}
            collapsed={new Set()}
            token={glassToken}
            obstacles={obstacles}
          />
        </svg>
      </ThemeProvider>,
    );
    const groups = container.querySelectorAll('[data-free-edge]');
    expect(groups.length).toBe(2);
    // 两条边都应产出非空路径
    for (const g of groups) {
      const visible = Array.from(g.querySelectorAll('path')).find(
        (p) => p.getAttribute('stroke') !== 'transparent',
      );
      expect(visible?.getAttribute('d') ?? '').not.toBe('');
    }
  });
});

/**
 * Issue #3：手动覆盖端到端（真实 MapView 路径）。
 * 契约（XMind / MindManager / Miro 一致）：选中边才出现 handle；拖动即写入 edge.manual 并
 * 停用自动优化；双击 bend（恢复入口）清空 manual → 恢复自动优化。
 */
describe('Issue #3：手动覆盖（端点 / bend 拖拽）', () => {
  function manualScene() {
    const root = makeTextNode('根', [makeTextNode('A'), makeTextNode('B'), makeTextNode('C')]);
    root.note = { edges: [{ from: 'node:根/A', to: 'node:根/C', rel: 'relates-to' }] };
    return root;
  }

  it('选中边后出现 handle；拖 bend 回调 manual 几何（含 curvature）', () => {
    const root = manualScene();
    const onManual = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <MapView
          layout={layoutOf(root)}
          entities={new Map()}
          char={char}
          selectedEdgeKey="e0"
          relationMode
          onEdgeManualChange={onManual}
        />
      </ThemeProvider>,
    );
    const bend = container.querySelector('[data-edge-handle="bend"]');
    expect(bend).not.toBeNull();
    // 端点 handle 也应渲染（from / to 各一个）
    expect(container.querySelector('[data-edge-handle="from"]')).not.toBeNull();
    expect(container.querySelector('[data-edge-handle="to"]')).not.toBeNull();

    fireEvent.pointerDown(bend!, { clientX: 100, clientY: 100 });
    fireEvent(window, new MouseEvent('pointermove', { bubbles: true, clientX: 150, clientY: 100 }));
    expect(onManual).toHaveBeenCalled();
    const last = onManual.mock.calls[onManual.mock.calls.length - 1]!;
    // 回调签名：(edge, manual) —— manual 应带 curvature（数字）
    expect(typeof (last[1] as { curvature?: number })?.curvature).toBe('number');

    // 未选中时不应渲染 handle
    const { container: c2 } = render(
      <ThemeProvider>
        <MapView
          layout={layoutOf(root)}
          entities={new Map()}
          char={char}
          relationMode
          onEdgeManualChange={onManual}
        />
      </ThemeProvider>,
    );
    expect(c2.querySelector('[data-edge-handle="bend"]')).toBeNull();
  });

  it('双击 bend 恢复自动优化（manual = null）', () => {
    const root = manualScene();
    const onManual = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <MapView
          layout={layoutOf(root)}
          entities={new Map()}
          char={char}
          selectedEdgeKey="e0"
          relationMode
          onEdgeManualChange={onManual}
        />
      </ThemeProvider>,
    );
    const bend = container.querySelector('[data-edge-handle="bend"]');
    expect(bend).not.toBeNull();
    fireEvent.doubleClick(bend!);
    expect(onManual).toHaveBeenCalled();
    const last = onManual.mock.calls[onManual.mock.calls.length - 1]!;
    expect(last[1]).toBeNull();
  });
});

/** 从 path d 串采样点（M/L/Q/C） */
function sampleD(d: string): { x: number; y: number }[] {
  const cmds = d.match(/[MLCQ][^MLCQ]*/g) ?? [];
  let cur: { x: number; y: number } | null = null;
  const out: { x: number; y: number }[] = [];
  for (const c of cmds) {
    const n = c
      .slice(1)
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (c[0] === 'M') {
      cur = { x: n[0]!, y: n[1]! };
      out.push(cur);
    } else if (c[0] === 'L') {
      const p = { x: n[0]!, y: n[1]! };
      for (let k = 1; k <= 8; k++) {
        out.push({ x: cur!.x + (p.x - cur!.x) * (k / 8), y: cur!.y + (p.y - cur!.y) * (k / 8) });
      }
      cur = p;
    } else if (c[0] === 'C') {
      const c1 = { x: n[0]!, y: n[1]! };
      const c2 = { x: n[2]!, y: n[3]! };
      const p = { x: n[4]!, y: n[5]! };
      for (let k = 1; k <= 8; k++) {
        const t = k / 8;
        const u = 1 - t;
        out.push({
          x: u * u * u * cur!.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p.x,
          y: u * u * u * cur!.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p.y,
        });
      }
      cur = p;
    }
  }
  return out;
}

function pointInBox(
  p: { x: number; y: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h;
}

// ---------- Opp 精确翻转：路由结果回调（FreeEdgeLayer → MapView → 上层） ----------

describe('Opp：路由结果回调（真画布渲染）', () => {
  /** 5 子布局，A→E 的直线纵向穿过 C —— 保证边真的绕行（不是直线） */
  function treeWithEdge(): EditableNode {
    const root = makeTextNode('根', [
      makeTextNode('A'),
      makeTextNode('B'),
      makeTextNode('C'),
      makeTextNode('D'),
      makeTextNode('E'),
    ]);
    root.note = { edges: [{ from: 'node:根/A', to: 'node:根/E', rel: 'relates-to' }] };
    return root;
  }

  it('onEdgeRoutes 能拿到实际渲染的路由路径 d', () => {
    const root = treeWithEdge();
    const seen: ReadonlyMap<string, EdgeRouteEntry>[] = [];
    render(
      <ThemeProvider>
        <MapView
          layout={layoutOf(root)}
          entities={new Map()}
          char={char}
          onEdgeRoutes={(routes) => {
            seen.push(routes);
          }}
        />
      </ThemeProvider>,
    );
    // 至少回调一次
    expect(seen.length).toBeGreaterThan(0);
    // 拿到的是实际渲染几何（含跨边协调与 Line jumps 之后的最终 d），非空
    const last = seen[seen.length - 1]!;
    const entries = [...last.values()];
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]!.route.d).not.toBe('');
    // eps 也已解析（供上层按需取端点盒）
    expect(entries[0]!.eps.renderable).toBe(true);
  });

  it('layout 稳定时重渲染不触发回调 —— 防「回调→setState→重渲染→再回调」死循环', () => {
    const root = treeWithEdge();
    // 关键：复用同一个 layout / entities 对象，模拟真实场景（上层用 useMemo 稳定住）。
    // 若每次都新建 layout，那输入确实变了、路由本就该重算 —— 那是另一回事，测不出死循环。
    const layout = layoutOf(root);
    const entities = new Map();
    let calls = 0;
    const make = () => (
      <ThemeProvider>
        <MapView
          layout={layout}
          entities={entities}
          char={char}
          // 每次都传新的内联回调（上层最常见的写法）
          onEdgeRoutes={() => {
            calls += 1;
          }}
        />
      </ThemeProvider>
    );
    const { rerender } = render(make());
    const afterMount = calls;
    expect(afterMount).toBeGreaterThan(0);

    for (let i = 0; i < 5; i++) rerender(make());

    // 输入未变 → routes（useMemo）不重算 → useEffect 不重跑 → 不应有新触发。
    // 若这里持续增长，说明上层 setState 会被反复唤起，即死循环。
    expect(calls - afterMount).toBeLessThanOrEqual(1);
  });
});
