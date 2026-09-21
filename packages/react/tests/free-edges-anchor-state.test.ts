/**
 * 锚定三态 + 折叠塌陷自环防护（P0-1 / P0-2 审查修复）。
 *
 * P0-1 stale 三态对齐：collectFreeEdges 先前只产 well-formed / dangling 二元。
 *   - 歧义锚（无 #N 的重复实体 / 节点路径多命中 / 非法锚文本）本应标 stale
 *     （内核 spec §5.5：宁可不写也不错写），却被误标 dangling → FreeEdgeLayer
 *     的 stale 分支成为死代码。
 *   - 组级合并规则与 resolveGroups 对齐：任一 stale → stale；
 *     否则任一 dangling → dangling；否则 well-formed。
 *
 * P0-2 折叠塌陷自环：边两端（祖孙关系）同被折叠到同一可视祖先时，
 *   freeEdgeEndpoints 会收敛出 fromId === toId 的零长度退化线。
 *   应跳过绘制（renderable:false）而非在卡片上画一个不可见点。
 */
import { describe, expect, it } from 'vitest';
import { makeEntityNode, makeTextNode, type EditableNode } from '@mindcanvas/kernel';
import { collectFreeEdges, freeEdgeEndpoints } from '../src/render/freeEdges.js';

function walkAll(root: EditableNode): EditableNode[] {
  const out: EditableNode[] = [];
  const walk = (n: EditableNode): void => {
    out.push(n);
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

function idOf(root: EditableNode, text: string): string {
  return walkAll(root).find((n) => n.text === text)!.id;
}

describe('collectFreeEdges：锚定三态（P0-1）', () => {
  it('well-formed：正常路径锚 / 唯一实体锚', () => {
    const root = makeTextNode('根', [
      makeTextNode('A'),
      makeEntityNode({ kind: 'issue', id: '88' }),
    ]);
    const a = idOf(root, 'A');
    const entityId = root.children[1]!.id;
    root.note = { edges: [{ from: 'node:根/A', to: '@issue:88', rel: 'relates-to' }] };
    const es = collectFreeEdges(root);
    expect(es[0]!.state).toBe('well-formed');
    expect(es[0]!.sourceId).toBe(a);
    expect(es[0]!.targetId).toBe(entityId);
  });

  it('well-formed：cid 锚（升格节点）→ 与 centers 同源索引，不得误走实体分支', () => {
    const a = makeTextNode('A');
    a.note = { cid: 'c1' };
    const b = makeTextNode('B');
    b.note = { cid: 'c2' };
    const root = makeTextNode('根', [a, b]);
    root.note = { edges: [{ from: 'cid:c1', to: 'cid:c2', rel: 'depends', source: 'manual' }] };
    const es = collectFreeEdges(root);
    expect(es).toHaveLength(1);
    expect(es[0]!.state).toBe('well-formed');
    expect(es[0]!.sourceId).toBe(a.id);
    expect(es[0]!.targetId).toBe(b.id);
  });

  it('dangling：cid 未登记在任何节点 note.cid → dangling', () => {
    const root = makeTextNode('根', [makeTextNode('A')]);
    root.note = { edges: [{ from: 'cid:c-missing', to: 'node:根/A', rel: 'x' }] };
    const e = collectFreeEdges(root)[0]!;
    expect(e.state).toBe('dangling');
    expect(e.sourceId).toBeNull();
  });

  it('dangling：实体未出现在画布 → dangling（targetId null）', () => {
    const root = makeTextNode('根', [makeTextNode('A')]);
    root.note = { edges: [{ from: 'node:根/A', to: '@issue:777', rel: 'relates-to' }] };
    const e = collectFreeEdges(root)[0]!;
    expect(e.state).toBe('dangling');
    expect(e.targetId).toBeNull();
  });

  it('dangling：节点路径失效 → dangling', () => {
    const root = makeTextNode('根', [makeTextNode('A')]);
    root.note = { edges: [{ from: 'node:根/A', to: 'node:根/不存在', rel: 'relates-to' }] };
    expect(collectFreeEdges(root)[0]!.state).toBe('dangling');
  });

  it('stale：无 #N 且同名实体重复出现 → 歧义，宁可悬空也不任意取一', () => {
    const root = makeTextNode('根', [
      makeTextNode('分支A', [makeEntityNode({ kind: 'issue', id: '8' })]),
      makeTextNode('分支B', [makeEntityNode({ kind: 'issue', id: '8' })]),
    ]);
    root.note = { edges: [{ from: 'node:根/分支A', to: '@issue:8', rel: 'relates-to' }] };
    const e = collectFreeEdges(root)[0]!;
    expect(e.state).toBe('stale'); // 契约修正：此前误标 dangling
    expect(e.targetId).toBeNull();
  });

  it('stale：#N 越界（指向不存在的第 N 次出现）→ 不可寻址', () => {
    const root = makeTextNode('根', [
      makeTextNode('分支A', [makeEntityNode({ kind: 'issue', id: '8' })]),
      makeTextNode('分支B', [makeEntityNode({ kind: 'issue', id: '8' })]),
    ]);
    root.note = { edges: [{ from: 'node:根/分支A', to: '@issue:8#9', rel: 'relates-to' }] };
    expect(collectFreeEdges(root)[0]!.state).toBe('stale');
  });

  it('stale：节点路径歧义（同父同名节点多处命中）', () => {
    const root = makeTextNode('根', [
      makeTextNode('分支', [makeTextNode('同名'), makeTextNode('同名')]),
    ]);
    root.note = { edges: [{ from: 'node:根/分支', to: 'node:根/分支/同名', rel: 'x' }] };
    expect(collectFreeEdges(root)[0]!.state).toBe('stale');
  });

  it('stale：无法解析的锚文本 → stale', () => {
    const root = makeTextNode('根', [makeTextNode('A')]);
    root.note = { edges: [{ from: 'node:根/A', to: '随便', rel: 'x' }] };
    expect(collectFreeEdges(root)[0]!.state).toBe('stale');
    root.note = { edges: [{ from: 'node:根/A', to: '', rel: 'x' }] };
    expect(collectFreeEdges(root)[0]!.state).toBe('stale');
  });

  it('组级合并：任一 stale → 整边 stale（歧义>悬空>正常）', () => {
    const root = makeTextNode('根', [
      makeTextNode('A'),
      makeTextNode('分支A', [makeEntityNode({ kind: 'issue', id: '8' })]),
      makeTextNode('分支B', [makeEntityNode({ kind: 'issue', id: '8' })]),
    ]);
    // from 正常、to 歧义 → stale
    root.note = { edges: [{ from: 'node:根/A', to: '@issue:8', rel: 'x' }] };
    expect(collectFreeEdges(root)[0]!.state).toBe('stale');
    // from 悬空、to 歧义 → stale 仍优先
    root.note = { edges: [{ from: 'node:根/不存在', to: '@issue:8', rel: 'x' }] };
    expect(collectFreeEdges(root)[0]!.state).toBe('stale');
    // from 歧义、to 悬空 → stale；无 stale 时 dangling 次之
    root.note = { edges: [{ from: '@issue:8', to: '@issue:999', rel: 'x' }] };
    expect(collectFreeEdges(root)[0]!.state).toBe('stale');
    root.note = { edges: [{ from: 'node:根/不存在', to: '@issue:999', rel: 'x' }] };
    expect(collectFreeEdges(root)[0]!.state).toBe('dangling');
  });
});

describe('freeEdgeEndpoints：折叠塌陷自环防护（P0-2）', () => {
  it('两端塌陷同一折叠祖先 → renderable:false（跳过零长度自环）', () => {
    // 结构：根[折叠组[子1[孙1]]]；边 子1 → 孙1，整组折叠
    const root = makeTextNode('根', [makeTextNode('折叠组', [makeTextNode('子1', [makeTextNode('孙1')])])]);
    const groupId = idOf(root, '折叠组');
    const z1 = idOf(root, '子1');
    const s1 = idOf(root, '孙1');
    root.note = { edges: [{ from: 'node:根/折叠组/子1', to: 'node:根/折叠组/子1/孙1', rel: 'x' }] };
    const e = collectFreeEdges(root)[0]!;
    // 折叠后代不在布局盒表；只有折叠祖先有盒
    const boxes = new Map([[groupId, { x: 0, y: 0, w: 60, h: 20 }]]);
    const eps = freeEdgeEndpoints(e, (id) => boxes.get(id), root, new Set([groupId]));
    expect(z1).not.toBe(s1); // 确保用例构造有效
    expect(eps.fromId).toBe(groupId);
    expect(eps.toId).toBe(groupId); // 塌陷收敛到同一祖先
    expect(eps.renderable).toBe(false); // 零几何 → 跳过绘制
  });

  it('单端塌陷（收缩到祖先）→ 不回归：正常渲染收缩边', () => {
    const root = makeTextNode('根', [
      makeTextNode('折叠组', [makeTextNode('子1', [makeTextNode('孙1')])]),
      makeTextNode('A'),
    ]);
    const groupId = idOf(root, '折叠组');
    const aId = idOf(root, 'A');
    root.note = { edges: [{ from: 'node:根/A', to: 'node:根/折叠组/子1/孙1', rel: 'x' }] };
    const e = collectFreeEdges(root)[0]!;
    const boxes = new Map([
      [groupId, { x: 0, y: 0, w: 60, h: 20 }],
      [aId, { x: 200, y: 0, w: 60, h: 20 }],
    ]);
    const eps = freeEdgeEndpoints(e, (id) => boxes.get(id), root, new Set([groupId]));
    expect(eps.fromId).toBe(aId);
    expect(eps.toId).toBe(groupId);
    expect(eps.renderable).toBe(true);
    expect(eps.ghost).toBe(false);
  });

  it('dangling → 不回归：幽灵锚仍可渲染', () => {
    const root = makeTextNode('根', [makeTextNode('A')]);
    root.note = { edges: [{ from: 'node:根/A', to: '@issue:777', rel: 'x' }] };
    const e = collectFreeEdges(root)[0]!;
    const boxes = new Map([[idOf(root, 'A'), { x: 0, y: 0, w: 100, h: 30 }]]);
    const eps = freeEdgeEndpoints(e, (id) => boxes.get(id), root, new Set());
    expect(eps.ghost).toBe(true);
    expect(eps.renderable).toBe(true);
  });
});