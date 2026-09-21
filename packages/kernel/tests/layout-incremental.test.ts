import { describe, expect, it } from 'vitest';
import {
  LayoutCache,
  layoutMindmap,
  updateNode,
  addChild,
  removeNode,
  moveNode,
} from '../src/index.js';
import type { EditableNode, LayoutResult, MeasureFn } from '../src/index.js';

// kernel 包无 DOM lib：计时与日志按既有基准测试惯例声明（benchmark-layout.test.ts 同款）
declare const performance: { now(): number };
declare const console: { log(...args: unknown[]): void };

/** 深 6 层 3 叉 → 1+3+9+27+81+243+729 = 1093 节点；计时用深 8 层 → 9841 */
function buildTree(maxDepth: number): EditableNode {
  let seq = 0;
  const mk = (depth: number): EditableNode => {
    const node: EditableNode = { id: `t${seq++}`, type: 'text', text: `t${seq}`, children: [] };
    if (depth < maxDepth) {
      for (let i = 0; i < 3; i++) node.children.push(mk(depth + 1));
    }
    return node;
  };
  return mk(0);
}

const measure: MeasureFn = (n) => ({ w: 40 + (n.text?.length ?? 0) * 6, h: 30 });
const collapsed = new Set<string>();

function leafId(root: EditableNode): string {
  let cur = root;
  while (cur.children.length > 0) cur = cur.children[0]!;
  return cur.id;
}

/** 逐坐标对比：增量结果必须与全量重算完全一致（节点/连线/包围盒） */
function expectIdentical(inc: LayoutResult, full: LayoutResult): void {
  expect(inc.nodes.length).toBe(full.nodes.length);
  const byId = new Map<string, (typeof full.nodes)[number]>();
  for (const n of full.nodes) byId.set(n.node.id, n);
  for (const n of inc.nodes) {
    const f = byId.get(n.node.id);
    expect(f, `缺失节点 ${n.node.id}`).toBeDefined();
    expect(n.box.x).toBe(f!.box.x);
    expect(n.box.y).toBe(f!.box.y);
    expect(n.box.w).toBe(f!.box.w);
    expect(n.box.h).toBe(f!.box.h);
    expect(n.side).toBe(f!.side);
    expect(n.depth).toBe(f!.depth);
  }
  expect(inc.links.length).toBe(full.links.length);
  for (let i = 0; i < full.links.length; i++) {
    expect(inc.links[i]!.path).toBe(full.links[i]!.path);
    expect(inc.links[i]!.fromId).toBe(full.links[i]!.fromId);
    expect(inc.links[i]!.toId).toBe(full.links[i]!.toId);
  }
  expect(inc.bounds).toEqual(full.bounds);
}

/** 编辑一次 + 增量与全量对比（通用断言骨架） */
function expectIncrementalEqualsFull(after: EditableNode, cache: LayoutCache): void {
  const inc = layoutMindmap(after, measure, collapsed, { cache, measureKey: 'k' });
  const full = layoutMindmap(after, measure, collapsed); // 无缓存 = 全量
  expectIdentical(inc, full);
}

describe('增量布局（M5-T6：结果与全量逐坐标一致）', () => {
  it('文本编辑（updateNode）→ 增量结果与全量逐坐标一致', () => {
    const cache = new LayoutCache();
    const root = buildTree(6);
    layoutMindmap(root, measure, collapsed, { cache, measureKey: 'k' });
    const after = updateNode(root, leafId(root), { text: '改过的文本变长了' });
    expectIncrementalEqualsFull(after, cache);
  });

  it('新增子节点（addChild）→ 一致', () => {
    const cache = new LayoutCache();
    const root = buildTree(6);
    layoutMindmap(root, measure, collapsed, { cache, measureKey: 'k' });
    const after = addChild(root, root.id, {
      id: 'new-root-child',
      type: 'text',
      text: '新分支',
      children: [],
    });
    expectIncrementalEqualsFull(after, cache);
    // 深层新增
    const after2 = addChild(root, leafId(root), {
      id: 'new-leaf',
      type: 'text',
      text: '新叶',
      children: [],
    });
    expectIncrementalEqualsFull(after2, cache);
  });

  it('删除节点（removeNode）→ 一致', () => {
    const cache = new LayoutCache();
    const root = buildTree(6);
    layoutMindmap(root, measure, collapsed, { cache, measureKey: 'k' });
    const after = removeNode(root, root.children[1]!.id).root;
    expectIncrementalEqualsFull(after, cache);
  });

  it('移动节点（moveNode 拖拽重排）→ 一致', () => {
    const cache = new LayoutCache();
    const root = buildTree(6);
    layoutMindmap(root, measure, collapsed, { cache, measureKey: 'k' });
    const after = moveNode(root, root.children[0]!.id, root.children[1]!.id, 0).root;
    expectIncrementalEqualsFull(after, cache);
  });

  it('连续多次编辑共享同一缓存 → 每次都与全量一致', () => {
    const cache = new LayoutCache();
    let tree = buildTree(6);
    layoutMindmap(tree, measure, collapsed, { cache, measureKey: 'k' });
    for (let i = 0; i < 5; i++) {
      tree = addChild(tree, leafId(tree), {
        id: `s${i}`,
        type: 'text',
        text: `s${i}`,
        children: [],
      });
      expectIncrementalEqualsFull(tree, cache);
    }
  });

  it('折叠变化（新 Set）→ 缓存失效但仍与全量一致', () => {
    const cache = new LayoutCache();
    const root = buildTree(6);
    layoutMindmap(root, measure, collapsed, { cache, measureKey: 'k' });
    const coll = new Set([root.children[0]!.id]);
    const inc = layoutMindmap(root, measure, coll, { cache, measureKey: 'k' }); // 键不匹配 → 全量重算
    expectIdentical(inc, layoutMindmap(root, measure, coll));
    // 再折叠另一支（缓存已更新为新键，继续增量）
    const coll2 = new Set([root.children[1]!.id]);
    const inc2 = layoutMindmap(root, measure, coll2, { cache, measureKey: 'k' });
    expectIdentical(inc2, layoutMindmap(root, measure, coll2));
    // 第三次同键调用（纯增量路径）仍一致
    expectIdentical(
      layoutMindmap(root, measure, coll2, { cache, measureKey: 'k' }),
      layoutMindmap(root, measure, coll2),
    );
  });

  it('measureKey 变化 → 强制全量但仍与全量一致', () => {
    const cache = new LayoutCache();
    const root = buildTree(6);
    layoutMindmap(root, measure, collapsed, { cache, measureKey: 'k1' });
    const m2: MeasureFn = (n) => ({ w: 60 + (n.text?.length ?? 0) * 8, h: 36 });
    const inc = layoutMindmap(root, m2, collapsed, { cache, measureKey: 'k2' });
    expectIdentical(inc, layoutMindmap(root, m2, collapsed));
  });

  it('性能：编辑单个节点（5461+ 节点基准）→ 增量中位 < 全量中位 × 30%', () => {
    const root = buildTree(8); // 9841 节点（≥5461 基准）
    const cache = new LayoutCache();
    layoutMindmap(root, measure, collapsed, { cache, measureKey: 'k' }); // 预热缓存
    const after = updateNode(root, leafId(root), { text: 'x'.repeat(64) });
    const median = (arr: number[]): number =>
      [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)]!;
    const fullTimes: number[] = [];
    const incTimes: number[] = [];
    for (let i = 0; i < 15; i++) {
      let a = performance.now();
      layoutMindmap(after, measure, collapsed);
      fullTimes.push(performance.now() - a);
      a = performance.now();
      layoutMindmap(after, measure, collapsed, { cache, measureKey: 'k' });
      incTimes.push(performance.now() - a);
    }
    const ratio = median(incTimes) / median(fullTimes);
    console.log(
      `[T6] 全量中位=${median(fullTimes).toFixed(2)}ms 增量中位=${median(incTimes).toFixed(2)}ms 比率=${ratio.toFixed(3)}`,
    );
    expect(ratio).toBeLessThan(0.3);
  });
});
