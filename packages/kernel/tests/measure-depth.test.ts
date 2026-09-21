/**
 * MEASURE-RANK · 度量深度透传（`MeasureFn` 第二参 `depth?`）。
 *
 * 背景：视觉档（root / branch / leaf）字号分档后，度量必须拿到**布局即将写入
 * `LayoutNode.depth` 的那个深度**，否则叶子按 branch 字号量（白边）或按 root 字号量（溢字）。
 *
 * 契约：
 *  - 已知深度就传：`layoutMindmap` / `layoutMindmapBranched` / logic·org / 框壳与挂出岛；
 *  - 传的值 = 该节点在**所属布局域**内的深度（岛/框内以岛根/框根为 0）；
 *  - 缺省不传 = 旧行为（单档度量），`(node) => …` 实现零改动。
 */
import { describe, expect, it } from 'vitest';
import { layoutMindmapBranched } from '../src/layout/branching.js';
import { createFrameShellMeasure } from '../src/layout/frameLayout.js';
import { layoutLogic, layoutOrg } from '../src/layout/layouts.js';
import { LayoutCache, layoutMindmap, type MeasureFn } from '../src/layout/mindmap.js';
import { setFrame } from '../src/protocol/frame.js';
import { type EditableNode, makeTextNode } from '../src/tree/treeOps.js';

/** 记录每次度量拿到的深度（node.id → 深度集合）；盒高 = 深度 + 10（便于断言盒随档变化） */
function spyMeasure(): { measure: MeasureFn; depths: Map<string, number[]> } {
  const depths = new Map<string, number[]>();
  const measure: MeasureFn = (node, depth) => {
    const list = depths.get(node.id) ?? [];
    list.push(depth ?? -1);
    depths.set(node.id, list);
    const h = (depth ?? 0) + 10;
    return { w: 40, h };
  };
  return { measure, depths };
}

/** 三层链：root → child → grand */
function chain(): { root: EditableNode; child: EditableNode; grand: EditableNode } {
  const grand = makeTextNode('孙');
  const child = makeTextNode('子', [grand]);
  const root = makeTextNode('根', [child]);
  return { root, child, grand };
}

const depthOf = (depths: Map<string, number[]>, node: EditableNode): number[] =>
  depths.get(node.id) ?? [];

describe('layoutMindmap：逐层传深度', () => {
  it('根 0 / 一级 1 / 叶 2（同一节点每次度量都拿到同一个深度）', () => {
    const { root, child, grand } = chain();
    const { measure, depths } = spyMeasure();
    const layout = layoutMindmap(root, measure, new Set());

    expect(new Set(depthOf(depths, root))).toEqual(new Set([0]));
    expect(new Set(depthOf(depths, child))).toEqual(new Set([1]));
    expect(new Set(depthOf(depths, grand))).toEqual(new Set([2]));

    // 盒高 = 深度 + 10 → 视觉档度量真的进了盒
    const boxOf = (n: EditableNode) => layout.nodes.find((ln) => ln.node.id === n.id)!.box;
    expect(boxOf(root).h).toBe(10);
    expect(boxOf(child).h).toBe(11);
    expect(boxOf(grand).h).toBe(12);
  });

  it('折叠剪枝不改变已展开节点的深度口径', () => {
    const { root, child, grand } = chain();
    const { measure, depths } = spyMeasure();
    layoutMindmap(root, measure, new Set([grand.id]));
    expect(new Set(depthOf(depths, child))).toEqual(new Set([1]));
    // 折叠节点的深度仍由父链决定（它是 child 的孩子 = 2）
    expect(new Set(depthOf(depths, grand))).toEqual(new Set([2]));
  });

  it('旧式单参 measure 零改动（忽略 depth，行为逐值不变）', () => {
    const { root, child } = chain();
    const legacy: MeasureFn = () => ({ w: 40, h: 20 });
    const layout = layoutMindmap(root, legacy, new Set());
    const boxOf = (n: EditableNode) => layout.nodes.find((ln) => ln.node.id === n.id)!.box;
    expect(boxOf(root).h).toBe(20);
    expect(boxOf(child).h).toBe(20);
  });
});

describe('layoutMindmapBranched / logic / org：骨架同样带深度', () => {
  it('分支布局（有 note.dir 声明）：骨架逐层传 0/1/2', () => {
    const grand = makeTextNode('孙');
    const child = makeTextNode('子', [grand]);
    child.note = { dir: 'down' };
    const root = makeTextNode('根', [child]);

    const { measure, depths } = spyMeasure();
    const layout = layoutMindmapBranched(root, measure, new Set());
    expect(new Set(depthOf(depths, root))).toEqual(new Set([0]));
    expect(new Set(depthOf(depths, child))).toEqual(new Set([1]));
    expect(new Set(depthOf(depths, grand))).toEqual(new Set([2]));
    expect(layout.nodes.length).toBe(3);
  });

  it('logic / org（岛内回退布局）：depth 从岛根 0 起递增', () => {
    const { root, child, grand } = chain();
    for (const run of [
      (m: MeasureFn) => layoutLogic(root, m, new Set(), 1),
      (m: MeasureFn) => layoutOrg(root, m, new Set(), 1),
    ]) {
      const { measure, depths } = spyMeasure();
      run(measure);
      expect(new Set(depthOf(depths, root))).toEqual(new Set([0]));
      expect(new Set(depthOf(depths, grand))).toEqual(new Set([2]));
    }
  });
});

describe('框壳与挂出岛：深度穿透包装层', () => {
  it('createFrameShellMeasure 把 depth 透传给 base（非框节点）', () => {
    const plain = makeTextNode('普通');
    const shell = createFrameShellMeasure((node, depth) => ({
      w: 40,
      h: (depth ?? 0) + 10,
    }));
    expect(shell(plain, 2)).toEqual({ w: 40, h: 12 });
    // 缺省不传 → 与旧调用方一致（深度 0 档）
    expect(shell(plain)).toEqual({ w: 40, h: 10 });
  });

  it('挂出子树以**文档绝对深度**度量（盒高 = 绝对深度 + 10）', () => {
    const hang = makeTextNode('挂出');
    const framed = makeTextNode('框', [makeTextNode('行', [hang])]);
    framed.note = setFrame(framed.note, 1);
    const root = makeTextNode('根', [framed]);

    const { measure, depths } = spyMeasure();
    const layout = layoutMindmap(root, createFrameShellMeasure(measure), new Set());
    // 框根 = depth 1；挂出子树根 = 框根 + 框深 1 + 1 = 3（与 LayoutNode.depth 同口径）
    const hangNode = layout.nodes.find((ln) => ln.node.id === hang.id)!;
    expect(hangNode.depth).toBe(3);
    // 同一节点会被量多次（挂点/外包络估算 + 真实布局），但**每次深度都必须一致**
    expect(new Set(depthOf(depths, hang))).toEqual(new Set([3]));
  });
});

describe('LayoutCache：子树高度按 (节点, 深度) 双键', () => {
  it('同一节点对象换深度后不得命中旧高度', () => {
    // 深度敏感度量：高 = 深度 + 10
    const measure: MeasureFn = (_node, depth) => ({ w: 40, h: (depth ?? 0) + 10 });
    const cache = new LayoutCache();
    // 同一个折叠集（身份比较的缓存契约：换 Set 会整体 reset → 双键断言失去意义）
    const collapsed = new Set<string>();

    // ① root → a → b：b 在深度 2（高 12）
    const b = makeTextNode('b');
    const a = makeTextNode('a', [b]);
    const root1 = makeTextNode('root', [a]);
    const l1 = layoutMindmap(root1, measure, collapsed, { cache, measureKey: 'k' });
    expect(l1.nodes.find((ln) => ln.node.id === b.id)!.box.h).toBe(12);

    // ② 结构变深：root → a′ / c → d → b（b 身份不变、深度 3，高应为 13）
    const a2: EditableNode = { ...a, children: [] };
    const d = makeTextNode('d', [b]);
    const c = makeTextNode('c', [d]);
    const root2: EditableNode = { ...root1, children: [a2, c] };
    const l2 = layoutMindmap(root2, measure, collapsed, { cache, measureKey: 'k' });
    const b2 = l2.nodes.find((ln) => ln.node.id === b.id)!;
    expect(b2.depth).toBe(3);
    expect(b2.box.h).toBe(13);
    // 双键契约：同一节点对象在两个深度**各存一份**高度（旧单键会被后写覆盖/命中陈旧值）
    const byDepth = cache.heightsByDepth.get(b);
    expect(byDepth?.get(2)).toBe(12);
    expect(byDepth?.get(3)).toBe(13);
  });
});
