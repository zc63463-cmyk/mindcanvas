/**
 * 摘要卫星 · 森林专测（S3 · T4）。
 *
 * 森林是卫星的**第二现场**（设计稿 §1.4）：岛内局部布局先产出卫星，再由
 * `shiftIsland` 平移合并。两处易漏点：
 * 1. **漏移**：卫星子树根不在 `root.children` 链上（`parentId` = 成员父），
 *    `shiftTree(root, …)` 覆盖不到 → 卫星留在岛局部坐标（岛平移后卫星漂离）。
 * 2. **漏链**：`islandLinks` 按 `root.children` 走；卫星内部 S→子链接需要单独重建
 *    （path 含绝对坐标，平移后必须重算）。
 *
 * 判据：① 卫星随岛平移（世界坐标 = 局部坐标 + 岛 delta）；
 * ② 连续三次平移满足**幂等与累积正确**（落点相同 → 逐位相同；落点变化 → 精确累加）；
 * ③ 岛链接含 S→子、不含 P→S。
 */
import { describe, expect, it } from 'vitest';
import { parseMm } from '../src/protocol/parser.js';
import { astToEditable, type EditableNode } from '../src/tree/treeOps.js';
import { LayoutCache, type LayoutNode, type LayoutResult } from '../src/layout/mindmap.js';
import { layoutForest, type CenterSpec } from '../src/layout/forest.js';
import { satelliteHook } from '../src/layout/satellite.js';

const m = (): { w: number; h: number } => ({ w: 100, h: 30 });

function req<T>(v: T | undefined | null, what: string): T {
  if (v === undefined || v === null) throw new Error(`测试前置缺失：${what}`);
  return v;
}

function build(text: string): EditableNode {
  return req(astToEditable(req(parseMm(text).root, 'parseMm root')), 'astToEditable');
}

function findById(node: EditableNode, id: string): EditableNode | undefined {
  if (node.id === id) return node;
  for (const c of node.children) {
    const hit = findById(c, id);
    if (hit) return hit;
  }
  return undefined;
}

function mapNode(
  node: EditableNode,
  id: string,
  fn: (n: EditableNode) => EditableNode,
): EditableNode {
  const self = node.id === id ? fn(node) : node;
  const children = self.children.map((c) => mapNode(c, id, fn));
  return self === node && children.every((c, i) => c === node.children[i])
    ? node
    : { ...self, children };
}

function insertChild(
  node: EditableNode,
  parentId: string,
  child: EditableNode,
  index: number,
): EditableNode {
  if (node.id === parentId) {
    const children = [...node.children];
    children.splice(index, 0, child);
    return { ...node, children };
  }
  const children = node.children.map((c) => insertChild(c, parentId, child, index));
  return children.every((c, i) => c === node.children[i]) ? node : { ...node, children };
}

let cidSeq = 0;

/**
 * 在岛根下挂 [成员一..成员三] + 摘要 S（cid 锚，与生产写入同形态）。
 *
 * ⚠️ 夹具要点：`centers` 必须用**打补丁后的树里**的岛根节点——`insertChild` 沿路径
 * 重建祖先链，`root.children` 的旧引用不含新子节点。曾经踩过：拿打补丁前的
 * `island` 当中心 → 岛内布局看不到摘要（恒 0 卫星），误判为森林实现缺陷。
 */
function islandWithSummary(): {
  root: EditableNode;
  island: EditableNode;
  centerId: string;
  summaryId: string;
} {
  cidSeq = 0;
  const root = build(`# 文档根
## 岛根
- 成员一
- 成员二
- 成员三
## 旁观
- x`);
  const islandBefore = req(
    root.children.find((c) => c.text === '岛根'),
    '岛根',
  );
  // 给成员补 cid（夹具；生产由 planCreateSummary 补发）
  const members = islandBefore.children.filter((c) => c.text?.startsWith('成员'));
  expect(members).toHaveLength(3);
  let next = root;
  const cids: string[] = [];
  for (const mem of members) {
    cidSeq += 1;
    const cid = `sc${cidSeq}`;
    cids.push(cid);
    next = mapNode(next, mem.id, (n) => ({ ...n, note: { ...(n.note ?? {}), cid } }));
  }
  const summaryId = 'S-island';
  const summary: EditableNode = {
    id: summaryId,
    type: 'text',
    text: '岛摘要',
    note: { summary_of: { from: `cid:${cids[0]}`, to: `cid:${cids[2]}` } },
    children: [{ id: 'S-island-child', type: 'text', text: '摘要子', children: [] }],
  };
  const patched = insertChild(next, islandBefore.id, summary, islandBefore.children.length);
  // 取打补丁后的同 id 岛根（含摘要子节点）
  const island = req(findById(patched, islandBefore.id), '岛根(patched)');
  return { root: patched, island, centerId: islandBefore.id, summaryId };
}

function centersOf(
  island: EditableNode,
  pos?: { x: number; y: number },
  dir: 'right' | 'left' | 'down' | 'up' = 'right',
): CenterSpec[] {
  return [pos ? { node: island, dir, pos } : { node: island, dir }];
}

function satOf(res: LayoutResult): LayoutNode | undefined {
  return (res.satellites ?? [])[0];
}

describe('S3 · 森林：卫星随岛平移 / 岛链接 / placed 缓存', () => {
  it('右岛：卫星随岛平移（世界坐标 = origin 位移后的带外沿）', () => {
    const { island } = islandWithSummary();
    const at0 = layoutForest(centersOf(island, { x: 0, y: 0 }), m, new Set(), {
      satellite: satelliteHook,
    });
    const sat0 = req(satOf(at0), 'satellite@origin0');
    expect(sat0).toBeDefined();

    const at500 = layoutForest(centersOf(island, { x: 500, y: 120 }), m, new Set(), {
      satellite: satelliteHook,
    });
    const sat500 = req(satOf(at500), 'satellite@origin500');

    // 岛平移 (500,120) → 卫星精确跟随（不是留在局部坐标）
    expect(sat500.box.x - sat0.box.x).toBeCloseTo(500, 5);
    expect(sat500.box.y - sat0.box.y).toBeCloseTo(120, 5);
    // 卫星必须在岛内成员带外侧（证明它确实跟着走，而非锚在原点）
    const memberBoxes = ['成员一', '成员二', '成员三'].map((t) =>
      req(
        at500.nodes.find((n) => n.node.text === t),
        `member ${t}`,
      ),
    );
    const bandMaxX = Math.max(...memberBoxes.map((n) => n.box.x + n.box.w));
    expect(sat500.box.x).toBeGreaterThan(bandMaxX);
  });

  it('卫星内部链接（S→子）在平移后重建；不含 P→S', () => {
    const { island, summaryId } = islandWithSummary();
    const res = layoutForest(centersOf(island, { x: 300, y: 40 }), m, new Set(), {
      satellite: satelliteHook,
    });
    const parentId = island.id;
    const pairs = res.links.map((l) => [l.fromId, l.toId] as const);
    expect(
      pairs.some(([f, t]) => f === parentId && t === summaryId),
      'P→S 不得存在',
    ).toBe(false);
    const satLink = pairs.find(([f, t]) => f === summaryId && t === 'S-island-child');
    expect(satLink, 'S→子 必须重建').toBeDefined();
    const sat = req(satOf(res), 'satellite');
    const link = req(
      res.links.find((l) => l.fromId === summaryId && l.toId === 'S-island-child'),
      'satellite link',
    );
    // 链接 path 必须反映**平移后**的坐标（与卫星实际盒一致，不是局部坐标）。
    // 解析口径：path 形如 `M x1 y1 C cx1 cy1, cx2 cy2, x2 y2`——按「两个数一组」取 x，
    // 不能对全部数字取 min（会把 y 当成 x，第一版测试即栽在此）。
    const nums = [...link.path.matchAll(/-?\d+(?:\.\d+)?/g)].map((mm) => Number(mm[0]));
    const xs: number[] = [];
    for (let k = 0; k + 1 < nums.length; k += 2) xs.push(req(nums[k], `path.x[${k / 2}]`));
    const minX = Math.min(...xs);
    expect(minX, '链接起点应落在平移后的卫星附近').toBeGreaterThan(sat.box.x - 5);
    expect(minX).toBeGreaterThan(100); // 远大于原点附近（证明不是局部坐标）
    // 且链接两端与 S 及其子的**实际盒**吻合（同源几何）
    expect(minX).toBeCloseTo(sat.box.x + sat.box.w, 5);
  });

  it('卫星在扁表中（nodes 含卫星——渲染/命中零改动）', () => {
    const { island, summaryId } = islandWithSummary();
    const res = layoutForest(centersOf(island, { x: 0, y: 0 }), m, new Set(), {
      satellite: satelliteHook,
    });
    expect(res.nodes.some((n) => n.node.id === summaryId), '扁表应含卫星').toBe(true);
    // satellites 与 nodes 中的是**同一批对象引用**
    const sat = req(satOf(res), 'satellite');
    expect(res.nodes.includes(sat), 'satellites 项应与 nodes 同引用').toBe(true);
  });

  it('连续三次平移：同落点幂等，异落点精确累加', () => {
    const { island } = islandWithSummary();
    const cache = new LayoutCache();
    const collapsed = new Set<string>();
    const run = (x: number, y: number): LayoutResult =>
      layoutForest(centersOf(island, { x, y }), m, collapsed, {
        cache,
        measureKey: 'K',
        satellite: satelliteHook,
      });

    // 同落点重复三次 → 逐位相同（placed 引用复用，无累加漂移）
    const a1 = run(200, 50);
    const a2 = run(200, 50);
    const a3 = run(200, 50);
    expect(satOf(a2)?.box).toEqual(satOf(a1)?.box);
    expect(satOf(a3)?.box).toEqual(satOf(a1)?.box);
    expect(a2.nodes.length).toBe(a1.nodes.length);

    // 落点变化 → 精确累加（非漂移）：delta 恰为落点差
    const b = run(700, 50);
    const s1 = req(satOf(a1), 'sat@200');
    const sb = req(satOf(b), 'sat@700');
    expect(sb.box.x - s1.box.x).toBeCloseTo(500, 5);
    expect(sb.box.y - s1.box.y).toBeCloseTo(0, 5);

    // 回到原点 → 与首轮逐位相同（非破坏式：local 未被平移污染）
    const back = run(200, 50);
    expect(satOf(back)?.box).toEqual(s1.box);
  });

  it('placed 缓存条目含卫星（落点相同时引用复用，落点变化时重建）', () => {
    const { island } = islandWithSummary();
    const cache = new LayoutCache();
    // ⚠️ collapsedIds 必须是**同一个 Set 实例**：layoutForest 的缓存失效契约为身份比较，
    //    每次传 new Set() 会每轮 reset() → 恒 miss，测不出 placed 复用（第一版即栽在此）。
    const collapsed = new Set<string>();
    const run = (x: number): LayoutResult =>
      layoutForest(centersOf(island, { x, y: 0 }), m, collapsed, {
        cache,
        measureKey: 'K',
        satellite: satelliteHook,
      });
    const first = run(100);
    const second = run(100);
    const sat1 = req(satOf(first), 'sat1');
    const sat2 = req(satOf(second), 'sat2');
    // placed 复用 ⇒ 同一批对象引用（零分配，且证明卫星确实进了 placed.result）
    expect(sat2).toBe(sat1);
    // 落点变化 → 新副本（不是陈旧引用）
    const third = run(400);
    const sat3 = req(satOf(third), 'sat3');
    expect(sat3).not.toBe(sat1);
    expect(sat3.box.x - sat1.box.x).toBeCloseTo(300, 5);
  });

  it('左岛：卫星在成员带左侧（镜像）', () => {
    const { island } = islandWithSummary();
    const res = layoutForest(centersOf(island, { x: 0, y: 0 }, 'left'), m, new Set(), {
      satellite: satelliteHook,
    });
    const sat = req(satOf(res), 'satellite-left');
    const memberBoxes = ['成员一', '成员二', '成员三'].map((t) =>
      req(
        res.nodes.find((n) => n.node.text === t),
        `member ${t}`,
      ),
    );
    const bandMinX = Math.min(...memberBoxes.map((n) => n.box.x));
    // 左岛成员向岛根左侧生长 → 卫星更左（镜像）
    expect(sat.box.x + sat.box.w).toBeLessThan(bandMinX);
    expect(sat.side).toBe(-1);
  });

  it('down 岛（org）不承诺卫星：摘要留流内可见（降级，不消失）', () => {
    const { island, summaryId } = islandWithSummary();
    const res = layoutForest(centersOf(island, { x: 0, y: 0 }, 'down'), m, new Set(), {
      satellite: satelliteHook,
    });
    expect(res.satellites ?? [], 'down 岛不应产出卫星').toHaveLength(0);
    expect(
      res.nodes.some((n) => n.node.id === summaryId),
      '摘要必须留在流内可见（不得消失）',
    ).toBe(true);
  });

  it('无摘要岛：satellites 字段缺失（与基线逐位等价）', () => {
    const root = build('# 根\n## 岛\n- a\n- b');
    const center = req(root.children[0], 'center');
    const res = layoutForest([{ node: center, dir: 'right', pos: { x: 0, y: 0 } }], m, new Set(), {
      satellite: satelliteHook,
    });
    expect(res.satellites).toBeUndefined();
  });
});
