import { describe, expect, it } from 'vitest';
import { cachedMetrics } from '../src/layout/nodeLayout.js';
import type { DisplayMetrics } from '../src/layout/nodeLayout.js';
import type { EditableNode } from '../src/tree/treeOps.js';

function t(id: string, text: string, children: EditableNode[] = []): EditableNode {
  return { id, type: 'text', text, children };
}

const EMPTY_ENTITIES = new Map();

describe('layout/nodeLayout：cachedMetrics 引用键缓存', () => {
  it('同 node 引用二次测量命中缓存（measure 不再执行）', () => {
    const node = t('a', 'hello **world**');
    const cache = new WeakMap<EditableNode, DisplayMetrics>();
    let calls = 0;
    const measure = (s: string): number => {
      calls += 1;
      return s.length;
    };
    cachedMetrics(cache, node, EMPTY_ENTITIES, measure);
    const afterFirst = calls;
    expect(afterFirst).toBeGreaterThan(0); // 首次确实度量了
    cachedMetrics(cache, node, EMPTY_ENTITIES, measure);
    expect(calls).toBe(afterFirst); // 二次命中缓存，零增量
    expect(cachedMetrics(cache, node, EMPTY_ENTITIES, measure)).toBe(
      cachedMetrics(cache, node, EMPTY_ENTITIES, measure),
    );
  });

  it('不同 node 引用（不可变更新产生新引用）→ 重算增量', () => {
    const n1 = t('a', 'one');
    const n2 = t('a', 'two'); // 同 id 新引用（内容变更）
    const cache = new WeakMap<EditableNode, DisplayMetrics>();
    let calls = 0;
    const measure = (s: string): number => {
      calls += 1;
      return s.length;
    };
    cachedMetrics(cache, n1, EMPTY_ENTITIES, measure);
    const afterFirst = calls;
    cachedMetrics(cache, n2, EMPTY_ENTITIES, measure);
    expect(calls).toBeGreaterThan(afterFirst); // 新引用 → 重算
  });

  it('entity 节点不缓存：每次调用都重算（entities 更新后必然反映）', () => {
    const entity: EditableNode = {
      id: 'e',
      type: 'entity',
      ref: { kind: 'issue', id: '1' },
      children: [],
    };
    const cache = new WeakMap<EditableNode, DisplayMetrics>();
    let calls = 0;
    const measure = (s: string): number => {
      calls += 1;
      return s.length;
    };
    cachedMetrics(cache, entity, EMPTY_ENTITIES, measure);
    const afterFirst = calls;
    cachedMetrics(cache, entity, EMPTY_ENTITIES, measure);
    expect(calls).toBeGreaterThan(afterFirst); // entity 每次直算
  });
});
