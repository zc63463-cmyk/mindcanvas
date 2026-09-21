/**
 * T4：links/groups 锚定解析契约单测（spec §5.5「锚定与失联规则」，K5 镜子一/二缺口消化）。
 * 三态判定：well-formed（唯一命中）/ dangling（路径失效）/ stale（歧义或格式非法）。
 */
import { describe, expect, it } from 'vitest';
import { makeTextNode } from '../src/tree/treeOps.js';
import type { EditableNode } from '../src/tree/treeOps.js';
import {
  parseLinkAnchor,
  resolveGroups,
  resolveLinkAnchor,
  resolveLinks,
} from '../src/registry/note-anchor.js';

/** 测试树：根 > 分支A > [叶1, 叶2]；根 > 分支B */
function makeTree(): EditableNode {
  return makeTextNode('根', [
    makeTextNode('分支A', [makeTextNode('叶1'), makeTextNode('叶2')]),
    makeTextNode('分支B'),
  ]);
}

describe('parseLinkAnchor：锚文本解析', () => {
  it('node: 前缀 → 节点锚；其余 → 实体锚（kind:id）', () => {
    expect(parseLinkAnchor('node:根/分支A/叶1')).toEqual({ kind: 'node', target: '根/分支A/叶1' });
    expect(parseLinkAnchor('issue:88')).toEqual({ kind: 'entity', target: 'issue:88' });
    expect(parseLinkAnchor('doc:docs/架构设计.md')).toEqual({
      kind: 'entity',
      target: 'doc:docs/架构设计.md',
    });
  });
  it('无法识别（空 / 无冒号）→ null', () => {
    expect(parseLinkAnchor('node:')).toBeNull();
    expect(parseLinkAnchor('')).toBeNull();
    expect(parseLinkAnchor('no-colon')).toBeNull();
  });
});

describe('resolveLinkAnchor：节点锚三态判定', () => {
  it('well-formed：路径唯一命中 → 返回 nodeId', () => {
    const root = makeTree();
    const r = resolveLinkAnchor(root, { kind: 'node', target: '根/分支A/叶2' });
    expect(r.state).toBe('well-formed');
    expect(r.nodeId).toBeDefined();
  });
  it('dangling：路径失效（节点改名/移动）', () => {
    const root = makeTree();
    const r = resolveLinkAnchor(root, { kind: 'node', target: '根/分支A/不存在的叶' });
    expect(r.state).toBe('dangling');
    expect(r.reason).toBe('path-not-found');
  });
  it('stale：歧义（同名多命中）→ 宁可不写也不错写', () => {
    const root = makeTextNode('根', [
      makeTextNode('分支A', [makeTextNode('同名'), makeTextNode('同名')]),
    ]);
    const r = resolveLinkAnchor(root, { kind: 'node', target: '根/分支A/同名' });
    expect(r.state).toBe('stale');
    expect(r.reason).toBe('ambiguous-node-path');
  });
  it('实体锚：语法合法 → well-formed；非法 → stale', () => {
    const root = makeTree();
    expect(resolveLinkAnchor(root, { kind: 'entity', target: 'issue:88' }).state).toBe(
      'well-formed',
    );
    expect(resolveLinkAnchor(root, { kind: 'entity', target: 'bad anchor' }).state).toBe('stale');
  });
});

describe('空名节点透明穿过（E8：清空中间节点文字后子树仍可寻址）', () => {
  it('中间节点文本被清空 → 后代仍可按「跳过该段」的路径命中', () => {
    const root = makeTextNode('根', [
      makeTextNode('中间节点', [makeTextNode('子A'), makeTextNode('子B')]),
      makeTextNode('源'),
    ]);
    root.children[0]!.text = ''; // 用户 inline 编辑清空
    const r = resolveLinkAnchor(root, { kind: 'node', target: '根/子B' });
    expect(r.state).toBe('well-formed');
    expect(r.nodeId).toBe(root.children[0]!.children[1]!.id);
  });
  it('旧路径（含已清空的段名）→ dangling（节点确实改名，语义正确）', () => {
    const root = makeTextNode('根', [
      makeTextNode('中间节点', [makeTextNode('子A'), makeTextNode('子B')]),
    ]);
    root.children[0]!.text = '';
    const r = resolveLinkAnchor(root, { kind: 'node', target: '根/中间节点/子B' });
    expect(r.state).toBe('dangling');
  });
  it('多个空名兄弟下同名后代 → stale（不任意取一）', () => {
    const root = makeTextNode('根', [
      makeTextNode('', [makeTextNode('同名')]),
      makeTextNode('', [makeTextNode('同名')]),
    ]);
    const r = resolveLinkAnchor(root, { kind: 'node', target: '根/同名' });
    expect(r.state).toBe('stale');
    expect(r.reason).toBe('ambiguous-node-path');
  });
  it('无空名节点时行为不变（回归）', () => {
    const root = makeTree();
    expect(resolveLinkAnchor(root, { kind: 'node', target: '根/分支A/叶1' }).state).toBe(
      'well-formed',
    );
    expect(resolveLinkAnchor(root, { kind: 'node', target: '根/不存在' }).state).toBe('dangling');
  });
});

describe('resolveLinks：note.links 数组逐条解析', () => {
  it('节点锚 + 实体锚混合 → 各自状态', () => {
    const root = makeTree();
    const links = [
      { rel: 'blocks', to: 'node:根/分支A/叶1' },
      { rel: 'relates-to', to: 'issue:88' },
      { rel: 'duplicates', to: 'node:根/分支X' }, // dangling
    ];
    const resolved = resolveLinks(root, links);
    expect(resolved.map((l) => l.state)).toEqual(['well-formed', 'well-formed', 'dangling']);
    expect(resolved[0]!.rel).toBe('blocks');
    expect(resolved[0]!.nodeId).toBeDefined();
  });
  it('非数组 / 缺 to → 忽略', () => {
    const root = makeTree();
    expect(resolveLinks(root, null)).toEqual([]);
    expect(resolveLinks(root, [{ rel: 'blocks' }])).toEqual([]);
    expect(resolveLinks(root, 'not-array')).toEqual([]);
  });
});

describe('resolveGroups：圈定组解析（组级状态聚合）', () => {
  it('全部成员 well-formed → 组 well-formed', () => {
    const root = makeTree();
    const groups = [
      {
        id: 'g1',
        label: 'M2',
        sem_role: 'milestone',
        members: ['node:根/分支A/叶1', 'node:根/分支B'],
      },
    ];
    const resolved = resolveGroups(root, groups);
    expect(resolved[0]!.state).toBe('well-formed');
    expect(resolved[0]!.members.map((m) => m.state)).toEqual(['well-formed', 'well-formed']);
  });
  it('任一成员 dangling → 组 dangling；任一 stale → 组 stale', () => {
    const root = makeTree();
    const gDangle = resolveGroups(root, [
      { id: 'g1', members: ['node:根/分支A/叶1', 'node:根/没了'] },
    ]);
    expect(gDangle[0]!.state).toBe('dangling');
    // 歧义成员 → 组 stale（优先级最高）
    const dup = makeTextNode('根', [
      makeTextNode('A', [makeTextNode('同名'), makeTextNode('同名')]),
    ]);
    const gStale = resolveGroups(dup, [{ id: 'g2', members: ['node:根/A/同名'] }]);
    expect(gStale[0]!.state).toBe('stale');
  });
  it('缺 id / 非数组 → 忽略', () => {
    const root = makeTree();
    expect(resolveGroups(root, [{ label: '无id' }])).toEqual([]);
    expect(resolveGroups(root, null)).toEqual([]);
  });
});
