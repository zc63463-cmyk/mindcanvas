import { describe, expect, it } from 'vitest';
import { collectEntityRelations, radialLayout } from '../src/chrome/entityGraph.js';
import type { EditableNode, Entity } from '@mindcanvas/kernel';

function node(
  id: string,
  type: 'text' | 'entity',
  ref?: { kind: string; id: string },
): EditableNode {
  return { id, type, text: id, ref, children: [] } as EditableNode;
}

function tree(): EditableNode {
  const root = node('root', 'text') as EditableNode & { children: EditableNode[] };
  root.children = [
    node('n1', 'entity', { kind: 'issue', id: '1' }),
    node('n2', 'entity', { kind: 'issue', id: '1' }),
    node('n3', 'entity', { kind: 'doc', id: 'docs/a.md' }),
    node('n4', 'entity', { kind: 'img', id: 'assets/x.png' }),
  ];
  return root;
}

describe('实体关系数据层（F1：collectEntityRelations + radialLayout）', () => {
  it('聚合：同实体多引用合并为一组，refNodes 按文档序', () => {
    const rels = collectEntityRelations(tree(), new Map());
    const issue = rels.find((r) => r.ref.kind === 'issue')!;
    expect(issue.refNodes).toEqual([
      { nodeId: 'n1', text: 'n1' },
      { nodeId: 'n2', text: 'n2' },
    ]);
    expect(rels.length).toBe(3); // issue/doc/img 三类
  });

  it('标题：entities map 提供；缺失 → ref.id 兜底', () => {
    const entities = new Map<string, Entity>([
      ['issue:1', { kind: 'issue', id: '1', title: '门户显示优化', status: 'open', ref: null }],
    ]);
    const rels = collectEntityRelations(tree(), entities);
    expect(rels.find((r) => r.ref.kind === 'issue')!.title).toBe('门户显示优化');
    expect(rels.find((r) => r.ref.kind === 'doc')!.title).toBe('docs/a.md');
  });

  it('排序：引用数降序（高频实体在前）', () => {
    const rels = collectEntityRelations(tree(), new Map());
    expect(rels[0]!.kind).toBe('issue'); // 2 个引用 > 1
    expect(rels[0]!.refNodes.length).toBe(2);
  });

  it('无实体 → 空数组', () => {
    const plain = node('only', 'text') as EditableNode & { children: EditableNode[] };
    plain.children = [];
    expect(collectEntityRelations(plain, new Map())).toEqual([]);
  });

  it('radialLayout：起点顶部顺时针均匀分布；count 0/1 边界', () => {
    expect(radialLayout(0, 100)).toEqual([]);
    const one = radialLayout(1, 100);
    expect(one[0]!.x).toBeCloseTo(0, 6);
    expect(one[0]!.y).toBeCloseTo(-100, 6);
    const four = radialLayout(4, 50);
    // 顶部开始、每 90°
    expect(four[0]!.x).toBeCloseTo(0, 6);
    expect(four[0]!.y).toBeCloseTo(-50, 6);
    expect(four[1]!.x).toBeCloseTo(50, 6);
    expect(four[1]!.y).toBeCloseTo(0, 6);
    expect(four[2]!.x).toBeCloseTo(0, 6);
    expect(four[2]!.y).toBeCloseTo(50, 6);
    // 半径正确
    for (const p of four) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(50, 6);
    }
  });
});
