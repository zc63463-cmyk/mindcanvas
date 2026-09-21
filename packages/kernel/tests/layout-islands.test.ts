/**
 * 递归布局岛投影（projectIslands + layoutIslands）：
 * 已批准 G1 语义——已升格后代不随祖先移动，每节点由最近升格祖先控制，
 * 任意深度可升格；根自身可作为中心条目（不重复投影）。
 *
 * 关键回归点：
 * - 投影是新建副本：源树任何节点不得被修改（children 数组/结构深比较）
 * - 深层升格必须从父岛剔除（旧 buildCenterSpecs 的一级过滤会整体丢弃深层标注）
 * - pos 的 {x:0,y:0} 是合法坐标，禁止真值判断导致漂移
 */
import { describe, expect, it } from 'vitest';
import {
  layoutIslands,
  projectIslands,
  type LayoutIsland,
  type ValidatedCenterSpec,
} from '../src/layout/islands.js';
import { layoutForest } from '../src/layout/forest.js';
import { walkNodes, type EditableNode } from '../src/tree/treeOps.js';

function t(id: string, children: EditableNode[] = []): EditableNode {
  return { id, type: 'text', text: id, children };
}

const measure = (): { w: number; h: number } => ({ w: 100, h: 30 });

/** 构造一条已校验中心（锚解析由调用方完成，这里直接给解析结果） */
function center(
  nodeId: string | null,
  overrides: Partial<Omit<ValidatedCenterSpec, 'nodeId'>> = {},
): ValidatedCenterSpec {
  return {
    nodeId,
    at: nodeId === null ? 'node:?' : `node:${nodeId}`,
    dir: 'right',
    pos: null,
    state: 'well-formed',
    ...overrides,
  };
}

/** 前序遍历全树节点 id */
function treeIds(root: EditableNode): string[] {
  const out: string[] = [];
  walkNodes(root, (n) => out.push(n.id));
  return out;
}

/** 各岛成员并集 */
function flattenMembers(islands: readonly LayoutIsland[]): string[] {
  return islands.flatMap((i) => i.memberIds);
}

/** 不变量：成员并集 = 全树 id 且无重复、owner 恰好覆盖每个节点一次 */
function expectFullCoverage(p: {
  islands: LayoutIsland[];
  ownerByNodeId: Map<string, string>;
}, root: EditableNode): void {
  const members = flattenMembers(p.islands);
  expect(new Set(members).size).toBe(members.length);
  expect(members.slice().sort()).toEqual(treeIds(root).slice().sort());
  expect(p.ownerByNodeId.size).toBe(treeIds(root).length);
}

describe('layout/islands：投影 projectIslands', () => {
  it('★ 三层 R→A→B→C、B 与 C 均升格：B 不留父岛、C 独立岛、owner 唯一、源树不可变', () => {
    const root = t('R', [t('A', [t('B', [t('C')])])]);
    const before = JSON.stringify(root);
    const p = projectIslands(root, [center('B'), center('C', { dir: 'down' })]);
    // 源树不可变（深比较）
    expect(JSON.stringify(root)).toBe(before);

    // 岛清单：根岛恒在前，升格岛按 DFS 发现序
    expect(p.islands.map((i) => i.rootId)).toEqual(['R', 'B', 'C']);
    expect(p.islands.map((i) => i.sourceKind)).toEqual(['root', 'promoted', 'promoted']);

    // 根岛：B 被剔除，A 不再带 B
    const rootIsland = p.islands[0]!;
    expect(rootIsland.memberIds.slice().sort()).toEqual(['A', 'R']);
    expect(rootIsland.projectedRoot.children.map((c) => c.id)).toEqual(['A']);
    const aProj = rootIsland.projectedRoot.children[0]!;
    expect(aProj.children).toEqual([]);

    // B 岛：C 被剔除（嵌套升格同理）
    const bIsland = p.islands[1]!;
    expect(bIsland.memberIds).toEqual(['B']);
    expect(bIsland.projectedRoot.children).toEqual([]);
    expect(bIsland.direction).toBe('right');

    // C 岛：最深层级仍可独立成岛
    const cIsland = p.islands[2]!;
    expect(cIsland.memberIds).toEqual(['C']);
    expect(cIsland.direction).toBe('down');

    // owner：每节点恰一个，B/C 由自己控制
    expect(p.ownerByNodeId.get('R')).toBe('R');
    expect(p.ownerByNodeId.get('A')).toBe('R');
    expect(p.ownerByNodeId.get('B')).toBe('B');
    expect(p.ownerByNodeId.get('C')).toBe('C');
    expect(p.ownerByNodeId.size).toBe(4);

    // 跨岛真实父子边（A→B、B→C）
    expect(p.boundaryLinks).toEqual([
      { fromId: 'A', toId: 'B' },
      { fromId: 'B', toId: 'C' },
    ]);
    expect(p.diagnostics).toEqual([]);

    // 布局阶段也不得改源树
    layoutIslands(p, measure, new Set());
    expect(JSON.stringify(root)).toBe(before);
  });

  it('B 升格且 B→D：D 归 B 岛（不随祖先 R/A）', () => {
    const root = t('R', [t('A', [t('B', [t('D')])])]);
    const p = projectIslands(root, [center('B')]);
    const bIsland = p.islands.find((i) => i.rootId === 'B');
    expect(bIsland?.memberIds.slice().sort()).toEqual(['B', 'D']);
    expect(bIsland?.projectedRoot.children.map((c) => c.id)).toEqual(['D']);
    expect(p.ownerByNodeId.get('D')).toBe('B');
    expect(p.boundaryLinks).toEqual([{ fromId: 'A', toId: 'B' }]);
    expect(p.diagnostics).toEqual([]);
    expectFullCoverage(p, root);
  });

  it('重复 nodeId 两条中心：first-wins、第二条进诊断、渲染清单不重复', () => {
    const root = t('R', [t('A', [t('B')])]);
    const p = projectIslands(root, [
      center('B', { pos: { x: 100, y: 50 } }),
      center('B', { dir: 'down', pos: { x: 900, y: 900 } }),
    ]);
    // 只开一个 B 岛，采用第一条的方向与坐标
    expect(p.islands.filter((i) => i.rootId === 'B')).toHaveLength(1);
    const bIsland = p.islands.find((i) => i.rootId === 'B');
    expect(bIsland?.direction).toBe('right');
    expect(bIsland?.position).toEqual({ x: 100, y: 50 });
    // 第二条进诊断
    expect(p.diagnostics).toHaveLength(1);
    expect(p.diagnostics[0]?.code).toBe('duplicate-center');
    expect(p.diagnostics[0]?.nodeId).toBe('B');
    expect(p.diagnostics[0]?.at).toBe('node:B');
    // 渲染清单不重复
    const layout = layoutIslands(p, measure, new Set());
    expect(layout.nodes.filter((n) => n.node.id === 'B')).toHaveLength(1);
    expectFullCoverage(p, root);
  });

  it('nodeId=null 与 state=stale：跳过 + 诊断，内容不丢', () => {
    const root = t('R', [t('A', [t('B')])]);
    const p = projectIslands(root, [center(null), center('A', { state: 'stale' })]);
    // 均被跳过 → 只剩根岛（内容完整）
    expect(p.islands).toHaveLength(1);
    expect(p.islands[0]?.rootId).toBe('R');
    expect(p.boundaryLinks).toEqual([]);
    expect(p.diagnostics.map((d) => d.code)).toEqual(['center-null-node', 'center-anchor-stale']);
    expect(p.diagnostics[1]?.nodeId).toBe('A');
    expect(p.diagnostics[1]?.at).toBe('node:A');
    expectFullCoverage(p, root);
  });

  it('根自身作为中心：根岛用其 pos 与方向，不重复投影', () => {
    const root = t('R', [t('A')]);
    const p = projectIslands(root, [center('R', { dir: 'down', pos: { x: 123, y: 456 } })]);
    expect(p.islands).toHaveLength(1);
    const ri = p.islands[0]!;
    expect(ri.sourceKind).toBe('root');
    expect(ri.rootId).toBe('R');
    expect(ri.direction).toBe('down');
    expect(ri.position).toEqual({ x: 123, y: 456 });
    expect(ri.memberIds.slice().sort()).toEqual(['A', 'R']);
    expect(p.boundaryLinks).toEqual([]);
    expect(p.diagnostics).toEqual([]);
    // 渲染层不出现第二个 R
    const layout = layoutIslands(p, measure, new Set());
    expect(layout.nodes.filter((n) => n.node.id === 'R')).toHaveLength(1);
    const rb = layout.nodes.find((n) => n.node.id === 'R')!.box;
    expect(rb.x + rb.w / 2).toBeCloseTo(123, 6);
    expect(rb.y + rb.h / 2).toBeCloseTo(456, 6);
  });

  it('全部一级分支升格：documentRoot 仍为根岛，owner 覆盖全树', () => {
    const root = t('R', [t('A', [t('a1')]), t('B')]);
    const p = projectIslands(root, [center('A'), center('B')]);
    expect(p.islands).toHaveLength(3);
    const ri = p.islands[0]!;
    expect(ri.sourceKind).toBe('root');
    expect(ri.memberIds).toEqual(['R']);
    expect(ri.projectedRoot.children).toEqual([]);
    expect(p.boundaryLinks).toEqual([
      { fromId: 'R', toId: 'A' },
      { fromId: 'R', toId: 'B' },
    ]);
    expectFullCoverage(p, root);
  });

  it('无有效中心：仍返回单根岛、无边界边、无诊断（回退判断由调用方做）', () => {
    const root = t('R', [t('A')]);
    const p = projectIslands(root, []);
    expect(p.islands).toHaveLength(1);
    expect(p.islands[0]?.sourceKind).toBe('root');
    expect(p.islands[0]?.memberIds.slice().sort()).toEqual(['A', 'R']);
    expect(p.boundaryLinks).toEqual([]);
    expect(p.diagnostics).toEqual([]);
  });
});

describe('layout/islands：布局 layoutIslands', () => {
  it('有 pos 岛不漂移（0,0 是合法坐标），根岛 pos 独立生效', () => {
    const root = t('R', [t('A', [t('a1')])]);
    const p = projectIslands(root, [
      center('R', { pos: { x: 2000, y: 100 } }),
      center('A', { pos: { x: 0, y: 0 } }),
    ]);
    const layout = layoutIslands(p, measure, new Set());
    const bA = layout.nodes.find((n) => n.node.id === 'A')!.box;
    // A 岛根中心精确落在 (0,0)——若实现把 0 当缺省值会漂到别处
    expect(bA.x + bA.w / 2).toBeCloseTo(0, 6);
    expect(bA.y + bA.h / 2).toBeCloseTo(0, 6);
    const bR = layout.nodes.find((n) => n.node.id === 'R')!.box;
    expect(bR.x + bR.w / 2).toBeCloseTo(2000, 6);
    expect(bR.y + bR.h / 2).toBeCloseTo(100, 6);
    // 每岛登记自己的包围盒
    expect(layout.islandBounds.size).toBe(2);
    expect(layout.islandBounds.has('R')).toBe(true);
    expect(layout.islandBounds.has('A')).toBe(true);
  });

  it('无 pos 岛按岛 bounds 横向自动排开、互不重叠', () => {
    const root = t('R', [t('A', [t('a1'), t('a2')]), t('B', [t('b1')])]);
    const p = projectIslands(root, [center('A'), center('B')]);
    const layout = layoutIslands(p, measure, new Set(), { gap: 100 });
    expect(layout.islandBounds.size).toBe(3);
    const boundsR = layout.islandBounds.get('R')!;
    const boundsA = layout.islandBounds.get('A')!;
    const boundsB = layout.islandBounds.get('B')!;
    // 发现序（根岛 → A → B）从左到右依次排开
    expect(boundsA.minX).toBeGreaterThanOrEqual(boundsR.maxX);
    expect(boundsB.minX).toBeGreaterThanOrEqual(boundsA.maxX);
  });

  it('折叠成员可见性与 layoutForest 一致；memberIds 不丢节点', () => {
    const root = t('R', [t('A', [t('a1'), t('a2')]), t('B')]);
    const p = projectIslands(root, [center('B')]);
    const collapsed = new Set(['A']);
    const layout = layoutIslands(p, measure, collapsed);
    const ids = layout.nodes.map((n) => n.node.id);
    // 根岛内 A 可见、其子树隐藏；兄弟岛 B 不受影响
    expect(ids).toContain('A');
    expect(ids).not.toContain('a1');
    expect(ids).not.toContain('a2');
    expect(ids).toContain('B');
    // 折叠只影响可见性布局：成员清单完整
    const rootIsland = p.islands[0]!;
    expect(rootIsland.memberIds.slice().sort()).toEqual(['A', 'R', 'a1', 'a2'].sort());
    // 与直接对根岛投影树调 layoutForest 完全一致（同树、同折叠集、同为无 pos 首岛）
    const standalone = layoutForest(
      [{ node: rootIsland.projectedRoot, dir: 'right' }],
      measure,
      collapsed,
    );
    const islandNodes = layout.nodes.filter(
      (n) => p.ownerByNodeId.get(n.node.id) === 'R',
    );
    expect(islandNodes.map((n) => [n.node.id, { ...n.box }])).toEqual(
      standalone.nodes.map((n) => [n.node.id, { ...n.box }]),
    );
  });
});
