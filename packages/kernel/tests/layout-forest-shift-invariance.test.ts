/**
 * 森林布局缓存 · shiftTree 不变量回归钉（F5：delta memo 陈旧几何修复）。
 *
 * 缺陷机制（复核四步证据链，2026-09-14）：F4 曾给 `shiftTree` 加 delta memo（只校验
 * 岛平移量 `dx/dy`）；岛内放置重放会**原地改写复用 LayoutNode 的 box**（F3 机制）——
 * 身份相等 ≠ 几何未变。深层 w-编辑可只改后代 box 而「岛级 dx/dy」不变 → memo 命中
 * 返回陈旧副本（实测 n5：当前 box.x=358 vs 陈旧副本 322，差 36px 持久错位）。
 * 修复 = 移除 memo（每次实算；复核实测代价 ~2.1ms，远低于 16ms 预算）。
 *
 * 为什么是「四方向 × 两种 measure」矩阵：四方向覆盖不同放置公式分支（stack / org）；
 * 两种 measure 覆盖 h 恒定（F 批夹具形态）与 h 随文本（真实文本度量形态）——两者都
 * 必须在覆盖内。
 *
 * 为什么必须「编辑有子节点的节点」：编辑叶节点只改自身盒；编辑**有子节点**的节点时
 * 其 w 变化会推移后代/复用节点的 box，才触发「复用节点 box 被重放改写」路径——
 * F 批夹具（h 恒定 + 编辑恒为 deepLeaf）恰好走不到，故本矩阵专项施压。
 */
import { describe, expect, it } from 'vitest';
import { LayoutCache, type LayoutResult } from '../src/layout/mindmap.js';
import { layoutForest, type CenterSpec } from '../src/layout/forest.js';
import { projectIslands, type ValidatedCenterSpec } from '../src/layout/islands.js';
import { updateNode, type EditableNode } from '../src/tree/treeOps.js';

function buildTree(depth: number): EditableNode {
  let seq = 0;
  const mk = (d: number): EditableNode => {
    seq += 1;
    const node: EditableNode = {
      id: `n${seq}`,
      type: 'text',
      text: d === 0 ? '根' : `n${seq}`,
      children: [],
    };
    if (d < depth) for (let i = 0; i < 3; i++) node.children.push(mk(d + 1));
    return node;
  };
  return mk(0);
}

const measureHConst = (n: EditableNode): { w: number; h: number } => ({
  w: 40 + (n.text ? n.text.length : 0) * 6,
  h: 30,
});

/** h 随文本变化（真实文本度量的形态：换行/形状都会改 h） */
const measureHVary = (n: EditableNode): { w: number; h: number } => ({
  w: 40 + (n.text ? n.text.length : 0) * 6,
  h: 30 + (n.text ? n.text.length : 0) * 2,
});

function pickCenters(root: EditableNode, k: number): EditableNode[] {
  const out: EditableNode[] = [];
  const q = [...root.children];
  while (q.length > 0 && out.length < k) {
    const n = q.shift();
    if (!n) break;
    out.push(n);
    for (const c of n.children) q.push(c);
  }
  return out;
}

function specsOf(
  root: EditableNode,
  k: number,
  dir: 'right' | 'left' | 'down' | 'up',
): CenterSpec[] {
  const picks = pickCenters(root, k);
  const centers: ValidatedCenterSpec[] = picks.map((node, i) => {
    const angle = (i / Math.max(k, 1)) * 2 * Math.PI;
    return {
      nodeId: node.id,
      at: `node:${node.id}`,
      dir,
      pos: { x: Math.round(700 * Math.cos(angle)), y: Math.round(500 * Math.sin(angle)) },
      state: 'well-formed' as const,
    };
  });
  const projection = projectIslands(root, centers);
  return projection.islands.map((island) => ({
    node: island.projectedRoot,
    dir: island.direction,
    ...(island.position !== null ? { pos: island.position } : {}),
  }));
}

function expectBitIdentical(a: LayoutResult, b: LayoutResult, label: string): void {
  expect(a.nodes.length, `${label}：nodes 数`).toBe(b.nodes.length);
  expect(a.links.length, `${label}：links 数`).toBe(b.links.length);
  for (const [i, x] of a.nodes.entries()) {
    const y = b.nodes[i];
    if (!y) throw new Error(`${label}：b.nodes[${i}] 缺失`);
    expect(x.node.id, `${label}：nodes[${i}].id`).toBe(y.node.id);
    for (const k of ['x', 'y', 'w', 'h'] as const) {
      expect(
        Object.is(x.box[k], y.box[k]),
        `${label}：nodes[${i}](${x.node.id}).box.${k} 陈旧/漂移（${x.box[k]} vs ${y.box[k]}）`,
      ).toBe(true);
    }
  }
  for (const k of ['minX', 'minY', 'maxX', 'maxY'] as const) {
    expect(Object.is(a.bounds[k], b.bounds[k]), `${label}：bounds.${k}`).toBe(true);
  }
}

/** 沿首子链找到「有子节点」的深节点（编辑它会触发其子树的 off-chain 复用） */
function deepBranch(node: EditableNode): EditableNode {
  let cur = node;
  while (cur.children.length > 0 && cur.children[0]?.children.length) {
    const c = cur.children[0];
    if (!c) break;
    cur = c;
  }
  return cur;
}

const DIRS = ['right', 'left', 'down', 'up'] as const;
const MEASURES: Array<{ name: string; m: (n: EditableNode) => { w: number; h: number } }> = [
  { name: 'h恒定', m: measureHConst },
  { name: 'h随文本', m: measureHVary },
];

describe('shiftTree 不变量：热缓存 → 深节点编辑 → 与无缓存逐位等价', () => {
  for (const dir of DIRS) {
    for (const { name, m } of MEASURES) {
      it(`dir=${dir} / ${name}：热缓存 → 深节点文本加长 → 与无缓存逐位等价`, () => {
        const root = buildTree(4);
        const collapsed = new Set<string>();
        const cache = new LayoutCache();

        // 热缓存（第一次调用，建立 memo 与 cache.nodes）
        const warm = layoutForest(specsOf(root, 1, dir), m, collapsed, {
          cache,
          measureKey: 'K',
        });
        expect(warm.nodes.length).toBeGreaterThan(0);

        // 编辑：升格岛内一个「有子节点」的深分支（其自身 w 变化 → off-chain 子节点的 x/y 依赖项变化）
        const island = pickCenters(root, 1)[0];
        if (!island) throw new Error('无中心');
        const target = deepBranch(island);
        const edited = updateNode(root, target.id, { text: `${target.text ?? ''}加长文本加长` });

        const inc = layoutForest(specsOf(edited, 1, dir), m, collapsed, {
          cache,
          measureKey: 'K',
        });
        const full = layoutForest(specsOf(edited, 1, dir), m, collapsed);
        expectBitIdentical(inc, full, `dir=${dir}/${name}`);
      });
    }
  }
});
