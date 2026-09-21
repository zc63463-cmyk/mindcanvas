import { describe, expect, it } from 'vitest';
import { graphJsonToMindmap, type GraphJsonPayload } from '../src/adapters/graphJsonAdapter.js';
import { layoutForest } from '../src/layout/forest.js';

const sampleGraph: GraphJsonPayload = {
  version: '1.0.0',
  domain: 'math',
  source_hash: 'hash_test',
  nodes: [
    { id: 'rolle-theorem', label: '罗尔定理', level: 'L0', kind: 'theorem' },
    { id: 'lagrange-mvt', label: '拉格朗日中值定理', level: 'L0', kind: 'theorem' },
    { id: 'cauchy-mvt', label: '柯西中值定理', level: 'L0', kind: 'theorem' },
    { id: 'taylor-expansion', label: '泰勒公式', level: 'L1', kind: 'paradigm' },
    { id: 'power-rule', label: '幂函数求导', level: 'L0', kind: 'theorem' },
  ],
  edges: [
    { from: 'rolle-theorem', to: 'lagrange-mvt', kind: 'calls_core', direction: 'fwd' },
    { from: 'lagrange-mvt', to: 'cauchy-mvt', kind: 'calls_core', direction: 'fwd' },
    { from: 'cauchy-mvt', to: 'taylor-expansion', kind: 'calls_core', direction: 'fwd' },
    { from: 'power-rule', to: 'taylor-expansion', kind: 'calls_core', direction: 'fwd' },
  ],
  indices: {
    in_degree: {
      'rolle-theorem': 0,
      'lagrange-mvt': 1,
      'cauchy-mvt': 1,
      'taylor-expansion': 2,
      'power-rule': 0,
    },
    topological_order: [
      'rolle-theorem',
      'power-rule',
      'lagrange-mvt',
      'cauchy-mvt',
      'taylor-expansion',
    ],
  },
};

describe('graphJsonAdapter', () => {
  it('正确将 GraphJsonPayload 转换为 mindcanvas AST 与中心清单', () => {
    const res = graphJsonToMindmap(sampleGraph);

    // 1. Root 检查
    expect(res.root.type).toBe('text');
    expect(res.root.text).toBe('MATH 知识拓扑');

    // 2. 边检查：4 条因果边转换为了文档级边
    expect(res.edges.length).toBe(4);
    expect(res.edges[0]).toEqual({
      from: '@theorem:rolle-theorem',
      to: '@theorem:lagrange-mvt',
      rel: 'calls_core',
      dir: 'fwd',
      label: undefined,
      source: 'imported',
    });

    // 3. 多中心检查：由于 rolle-theorem 和 power-rule 入度为 0，生成 2 个森林中心
    expect(res.centers.length).toBe(2);

    // 4. 验证 centers 可直接运行 layoutForest 布局
    const measure = (): { w: number; h: number } => ({ w: 120, h: 32 });
    const layout = layoutForest(res.centers, measure, new Set());

    expect(layout.nodes.length).toBe(5);
    expect(layout.bounds.maxX).toBeGreaterThan(layout.bounds.minX);
  });

  it('FIX-008: twin 边只进文档级自由边，不进入树结构', () => {
    const twinGraph: GraphJsonPayload = {
      version: '1.0.0',
      domain: 'math',
      source_hash: 'hash_twin',
      nodes: [
        { id: 'a', label: 'A', kind: 'theorem' },
        { id: 'b', label: 'B', kind: 'theorem' },
      ],
      edges: [{ from: 'a', to: 'b', kind: 'twin', direction: 'both' }],
      indices: { in_degree: { a: 0, b: 0 }, topological_order: ['a', 'b'] },
    };
    const res = graphJsonToMindmap(twinGraph);
    expect(res.edges).toHaveLength(1);
    expect(res.edges[0].rel).toBe('twin');
    const centerA = res.centers[0].node;
    expect(centerA.children.length).toBe(0);
  });
});
