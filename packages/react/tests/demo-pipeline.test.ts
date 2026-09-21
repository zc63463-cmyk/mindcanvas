import { describe, expect, it } from 'vitest';
import { buildEditable, buildEntities, layoutDemo } from '../src/demo/pipeline.js';

/** 反映 gateway.mm.md 结构的迷你样例（协议语法同源 kernel golden） */
const SAMPLE = `# Agent Gateway

## 文档（Forgejo 真实）
- @doc:docs/01-architecture.md
- @doc:docs/07-entity-ref-protocol.md

## 任务（真实 Issue）
- @issue:1
- @issue:6

## 断裂引用（unresolved 演示）
- @issue:99
- @pr:17
`;

describe('demo 数据管线（T3：parseMm → astToEditable → layoutMindmap）', () => {
  it('解析 .mm.md → 可编辑树 + refs 收集', () => {
    const { editable, refs, diagnostics } = buildEditable(SAMPLE);
    expect(editable).not.toBeNull();
    expect(diagnostics.length).toBe(0);
    // 根 + 3 顶级分支 + 6 叶
    expect(editable!.children.length).toBe(3);
    expect(refs.map((r) => `${r.kind}:${r.id}`)).toEqual([
      'doc:docs/01-architecture.md',
      'doc:docs/07-entity-ref-protocol.md',
      'issue:1',
      'issue:6',
      'issue:99',
      'pr:17',
    ]);
  });

  it('buildEntities：已解析 vs 未解析（缺口 → unresolved）', () => {
    const { refs } = buildEditable(SAMPLE);
    const entities = buildEntities(refs, {
      'doc:docs/01-architecture.md': { title: '架构设计', status: 'published' },
      'issue:1': { title: '门户显示优化', status: 'open' },
    });
    expect(entities.get('doc:docs/01-architecture.md')!.title).toBe('架构设计');
    expect(entities.get('issue:1')!.status).toBe('open');
    expect(entities.get('issue:99')!.status).toBe('unresolved');
    expect(entities.get('pr:17')!.meta?.unresolved_reason).toBe('not-found');
  });

  it('layoutDemo：注入 DOM 度量 → 布局产出盒子/连线', () => {
    const { editable } = buildEditable(SAMPLE);
    const { layout } = layoutDemo(editable!, new Map(), (s) => s.length * 10);
    expect(layout.nodes.length).toBe(10);
    expect(layout.links.length).toBe(9);
    for (const n of layout.nodes) {
      expect(n.box.w).toBeGreaterThan(0);
      expect(n.box.h).toBeGreaterThan(0);
    }
    expect(layout.bounds.maxX).toBeGreaterThan(layout.bounds.minX);
    // 连线 path 非空
    expect(layout.links.every((l) => l.path.length > 0)).toBe(true);
  });
});
