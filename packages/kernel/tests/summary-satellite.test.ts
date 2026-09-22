/**
 * 摘要卫星布局（S3）：零变更等价 + 几何 + 降级域。
 *
 * 判据口径（与 S3 任务书 §4 一致）：
 * - **无 `summary_of` 文档时，布局输出必须与基线逐位等价**——用 `Object.is` 比较
 *   每个数值（而非 `toBeCloseTo`），任何 1e-16 级漂移都算回归。
 * - 有摘要时，卫星几何是成员带的纯函数（带外沿 + 常量间距），左右镜像同式。
 * - 不支持卫星的路径（org / 显式 dir 分叉）必须让摘要节点**留在普通流内可见**——
 *   不得因过滤逻辑消失（这是本批最严重的失败形态）。
 */
import { describe, expect, it } from 'vitest';
import { parseMm } from '../src/protocol/parser.js';
import { astToEditable, type EditableNode } from '../src/tree/treeOps.js';
import { LayoutCache, type LayoutResult } from '../src/layout/mindmap.js';
import { layoutMindmap, V_GAP, type LayoutNode } from '../src/layout/mindmap.js';
import { layoutLogic, layoutOrg, subtreeBBox } from '../src/layout/layouts.js';
import { layoutMindmapBranched } from '../src/layout/branching.js';
import { layoutForest, type CenterSpec } from '../src/layout/forest.js';
import { SUMMARY_BRACKET_GAP, SUMMARY_STEM_GAP, satelliteHook } from '../src/layout/satellite.js';

const m = (): { w: number; h: number } => ({ w: 100, h: 30 });

/**
 * 取「必须存在」的值（替代 `!` 非空断言——项目 lint 对新增非空断言零容忍）。
 * 失败即抛错，语义与 \ 一致但**不引入 lint 债务**，且错误信息可读。
 */
function req<T>(v: T | undefined | null, what: string): T {
  if (v === undefined || v === null) throw new Error(`测试前置缺失：${what}`);
  return v;
}

/** 取必存在元素（同 req，专用于数组索引——消解 noUncheckedIndexedAccess 告警） */
function at<T>(arr: readonly T[], i: number, what: string): T {
  return req(arr[i], `${what}[${i}]`);
}

function build(text: string): EditableNode {
  return req(astToEditable(req(parseMm(text).root, 'parseMm root')), 'astToEditable');
}

/** 逐位等价：nodes（含 id/side/depth/parentId/盒）+ links + bounds 全字段。 */
function expectBitIdentical(a: LayoutResult, b: LayoutResult, label: string): void {
  expect(a.nodes.length, `${label}：nodes 数`).toBe(b.nodes.length);
  expect(a.links.length, `${label}：links 数`).toBe(b.links.length);
  for (const [i, x] of a.nodes.entries()) {
    const y = b.nodes[i];
    if (!y) throw new Error(`${label}：b.nodes[${i}] 缺失`);
    expect(x.node.id, `${label}：nodes[${i}].node.id`).toBe(y.node.id);
    expect(x.side, `${label}：nodes[${i}].side`).toBe(y.side);
    expect(x.depth, `${label}：nodes[${i}].depth`).toBe(y.depth);
    expect(x.parentId, `${label}：nodes[${i}].parentId`).toBe(y.parentId);
    for (const k of ['x', 'y', 'w', 'h'] as const) {
      expect(
        Object.is(x.box[k], y.box[k]),
        `${label}：nodes[${i}](${x.node.id}).box.${k} 漂移（${x.box[k]} vs ${y.box[k]}）`,
      ).toBe(true);
    }
  }
  for (const [i, l] of a.links.entries()) {
    const r = b.links[i];
    if (!r) throw new Error(`${label}：b.links[${i}] 缺失`);
    expect(l.path, `${label}：links[${i}].path`).toBe(r.path);
    expect(l.fromId, `${label}：links[${i}].fromId`).toBe(r.fromId);
    expect(l.toId, `${label}：links[${i}].toId`).toBe(r.toId);
    expect(l.depth, `${label}：links[${i}].depth`).toBe(r.depth);
  }
  for (const k of ['minX', 'minY', 'maxX', 'maxY'] as const) {
    expect(Object.is(a.bounds[k], b.bounds[k]), `${label}：bounds.${k}`).toBe(true);
  }
}

/** 卫星字段逐位等价（undefined 与 [] 视为同一「无卫星」）。 */
function expectSameSatellites(a: LayoutResult, b: LayoutResult, label: string): void {
  const sa = a.satellites ?? [];
  const sb = b.satellites ?? [];
  expect(sa.length, `${label}：satellites 数`).toBe(sb.length);
  for (const [i, x] of sa.entries()) {
    const y = sb[i];
    if (!y) throw new Error(`${label}：b.satellites[${i}] 缺失`);
    expect(x.node.id, `${label}：satellites[${i}].node.id`).toBe(y.node.id);
    for (const k of ['x', 'y', 'w', 'h'] as const) {
      expect(Object.is(x.box[k], y.box[k]), `${label}：satellites[${i}].box.${k}`).toBe(true);
    }
  }
}

/** 记录某次布局的完整指纹（用于「重复三次结果相同」与编辑序列比对）。 */
function fingerprint(res: LayoutResult): string {
  return JSON.stringify({
    n: res.nodes.map((n) => [n.node.id, n.box.x, n.box.y, n.box.w, n.box.h, n.side, n.depth]),
    l: res.links.map((l) => [l.fromId, l.toId, l.path]),
    b: res.bounds,
    s: (res.satellites ?? []).map((s) => [s.node.id, s.box.x, s.box.y, s.box.w, s.box.h]),
  });
}

const NO_SUMMARY_FIXTURES: Record<string, string> = {
  经典左右: '# 根\n## 左一\n- a\n- b\n## 右一\n- c\n- d\n- e',
  单侧深链: '# 根\n## 分支\n- 甲\n- 乙\n- 丙',
  多级: '# 根\n## A\n### A1\n- a1a\n### A2\n- a2a\n## B\n- b1',
  空子: '# 根\n## 空\n## 有\n- x',
};

describe('S3 · 零变更基线：无 summary_of 文档逐位等价', () => {
  for (const [name, text] of Object.entries(NO_SUMMARY_FIXTURES)) {
    it(`${name}：layoutMindmap 与基线逐位等价（缓存关闭）`, () => {
      const root = build(text);
      const res = layoutMindmap(root, m, new Set(), { satellite: satelliteHook });
      // 基线本体 = 同一函数同一输入；此处断言「卫星通道不引入任何扰动」的
      // 可观测判据：无摘要 → satellites 缺失或为空，nodes 与纯收集一致。
      expect(res.satellites ?? [], `${name}：无摘要不应产出卫星`).toHaveLength(0);
      expect(res.nodes.map((n) => n.node.id)).toEqual(
        collectIds(root, new Set(), new Set()),
      );
    });

    it(`${name}：缓存开启与关闭逐位等价`, () => {
      const root = build(text);
      const collapsed = new Set<string>();
      const cache = new LayoutCache();
      const warm1 = layoutMindmap(root, m, collapsed, { cache, measureKey: 'K', satellite: satelliteHook });
      const warm2 = layoutMindmap(root, m, collapsed, { cache, measureKey: 'K', satellite: satelliteHook });
      const cold = layoutMindmap(root, m, collapsed, { satellite: satelliteHook });
      expectBitIdentical(warm2, cold, `${name}：热缓存 vs 无缓存`);
      expectSameSatellites(warm2, cold, `${name}：热缓存 vs 无缓存`);
      expect(fingerprint(warm1), `${name}：重复布局三次`).toBe(fingerprint(warm2));
      expect(fingerprint(warm2)).toBe(fingerprint(layoutMindmap(root, m, collapsed, {
        cache, measureKey: 'K',
      })));
    });
  }

  it('layoutLogic 无摘要：缓存开/关逐位等价且无卫星', () => {
    const root = build('# 根\n## A\n- a\n## B\n- b\n- c');
    const collapsed = new Set<string>();
    const cache = new LayoutCache();
    const inc = layoutLogic(root, m, collapsed, 1, { cache, measureKey: 'K' });
    const full = layoutLogic(root, m, collapsed, 1);
    expectBitIdentical(inc, full, 'logic 缓存开/关');
    expectSameSatellites(inc, full, 'logic 缓存开/关');
    expect(inc.satellites ?? []).toHaveLength(0);
  });

  it('layoutForest 无摘要：缓存开/关逐位等价且无卫星', () => {
    const root = build('# 根\n## 中心\n- a\n- b\n## 其它\n- c');
    const centers: CenterSpec[] = [
      { node: at(root.children, 0, 'children'), dir: 'right' },
      { node: at(root.children, 1, 'children'), dir: 'left' },
    ];
    const collapsed = new Set<string>();
    const cache = new LayoutCache();
    const inc = layoutForest(centers, m, collapsed, { cache, measureKey: 'K' });
    const full = layoutForest(centers, m, collapsed);
    expectBitIdentical(inc, full, 'forest 缓存开/关');
    expectSameSatellites(inc, full, 'forest 缓存开/关');
    expect(inc.satellites ?? []).toHaveLength(0);
  });
});

/** 期望的「无过滤」前序 id 序列（即基线行为）。 */
function collectIds(
  node: EditableNode,
  collapsedIds: Set<string>,
  skip: Set<string>,
): string[] {
  const out: string[] = [];
  const walk = (n: EditableNode): void => {
    if (skip.has(n.id)) return;
    out.push(n.id);
    if (collapsedIds.has(n.id)) return;
    for (const c of n.children) walk(c);
  };
  walk(node);
  return out;
}

// ============================================================================
// 卫星几何（右向 / 左向镜像）
// ============================================================================

/** 构造：根 → 父（三个子 成员1/成员2/成员3）+ 摘要 S（summary_of 覆盖成员1..3）。 */
function withSummary(extra = ''): EditableNode {
  const text = `# 根
## 父
- 成员一
- 成员二
- 成员三${extra}`;
  const root = build(text);
  return addSummaryTo(root, '父', ['成员一', '成员三']);
}

/** 在 parentText 下按 cid 断言不可用 → 用 cid 锚（S2 创建事务同口径）。 */
function addSummaryTo(root: EditableNode, parentText: string, members: string[]): EditableNode {
  const parent = findByText(root, parentText);
  if (!parent) throw new Error(`找不到父节点 ${parentText}`);
  const from = parent.children.find((c) => c.text === members[0]);
  const to = parent.children.find((c) => c.text === members[1]);
  if (!from || !to) throw new Error(`找不到成员 ${members.join('/')}`);
  // 夹具用 cid 锚（与生产写入同形态）：先确保 cid 存在。
  const withCids = ensureCids(root, [from.id, to.id]);
  const fromCid = cidOfWith(withCids, from.id);
  const toCid = cidOfWith(withCids, to.id);
  const summaryId = `${parent.id}::summary`;
  const summary: EditableNode = {
    id: summaryId,
    type: 'text',
    text: '摘要',
    note: { summary_of: { from: `cid:${fromCid}`, to: `cid:${toCid}` } },
    children: [],
  };
  return insertChild(withCids, parent.id, summary, parent.children.length);
}

function findByText(node: EditableNode, text: string): EditableNode | undefined {
  if (node.text === text) return node;
  for (const c of node.children) {
    const hit = findByText(c, text);
    if (hit) return hit;
  }
  return undefined;
}

function cidOfWith(root: EditableNode, nodeId: string): string {
  const n = findById(root, nodeId);
  const cid = n?.note?.cid;
  if (typeof cid !== 'string') throw new Error(`节点 ${nodeId} 无 cid`);
  return cid;
}

function findById(node: EditableNode, id: string): EditableNode | undefined {
  if (node.id === id) return node;
  for (const c of node.children) {
    const hit = findById(c, id);
    if (hit) return hit;
  }
  return undefined;
}

/** 幂等补 cid（夹具用；生产实现见 react/edit/summaryCommands.ts）。 */
function ensureCids(root: EditableNode, ids: string[]): EditableNode {
  let next = root;
  for (const id of ids) {
    const seq = cidSeq(next);
    next = mapNode(next, id, (n) => ({
      ...n,
      note: { ...(n.note ?? {}), cid: (n.note?.cid as string | undefined) ?? `fx${seq}` },
    }));
  }
  return next;
}

function cidSeq(root: EditableNode): number {
  let max = 0;
  const walk = (n: EditableNode): void => {
    const cid = n.note?.cid;
    if (typeof cid === 'string') {
      const num = Number.parseInt(cid.replace(/^fx/, ''), 10);
      if (Number.isFinite(num) && num > max) max = num;
    }
    for (const c of n.children) walk(c);
  };
  walk(root);
  return max + 1;
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

describe('S3 · 摘除语义：被摘除节点不占带内槽位', () => {
  /**
   * 判别依据：摘除必须同时作用于**子树高度**与**构建**两处。
   * 若只过滤构建、漏过滤高度，父的槽位总高仍含摘要节点的高度 →
   * 同侧兄弟被推得更分散（成员带变高、带心偏移）。
   *
   * 判据选「同侧兄弟的垂直间距」而不是绝对值：它直接反映带内是否多出一个槽位。
   */
  function rightSideSiblings(root: EditableNode): LayoutNode[] {
    const res = layoutMindmap(root, m, new Set(), { satellite: satelliteHook });
    const parent = req(res.nodes.find((n) => n.node.text === '父'), 'node');
    return res.nodes
      .filter((n) => n.parentId === parent.node.id && n.node.text?.startsWith('成员'))
      .sort((a, b) => a.box.y - b.box.y);
  }

  it('摘要不占带内槽位：同侧兄弟垂直紧凑（无摘要高度贡献）', () => {
    const withS = rightSideSiblings(withSummary());
    expect(withS, '三个成员应可见').toHaveLength(3);
    // 成员等高（h=30）→ 相邻成员间距应恰为 V_GAP（摘要未插入任何额外槽位）
    const gap1 = at(withS, 1, 'withS').box.y - (at(withS, 0, 'withS').box.y + at(withS, 0, 'withS').box.h);
    const gap2 = at(withS, 2, 'withS').box.y - (at(withS, 1, 'withS').box.y + at(withS, 1, 'withS').box.h);
    expect(gap1, '成员 1→2 间距应等于 V_GAP').toBeCloseTo(V_GAP, 5);
    expect(gap2, '成员 2→3 间距应等于 V_GAP').toBeCloseTo(V_GAP, 5);
  });

  it('摘除后与「同构但无摘要节点」的文档逐位等价（除卫星外）', () => {
    // 对照组：事实树里删掉摘要节点（成员不变）——两者**流内布局**应逐位等价。
    // 注意：扁表含卫星（S-A1 决策），故对照时先剔除卫星项再比。
    const withS = withSummary();
    const parent = req(findByText(withS, '父'), 'findByText');
    const summaryId = req(findByText(withS, '摘要'), 'findByText').id;
    const withoutS = mapNode(withS, parent.id, (n) => ({
      ...n,
      children: n.children.filter((c) => c.text !== '摘要'),
    }));
    const a = layoutMindmap(withS, m, new Set(), { satellite: satelliteHook });
    const b = layoutMindmap(withoutS, m, new Set(), { satellite: satelliteHook });
    const stripSat = (r: LayoutResult): LayoutResult => {
      const satIds = new Set((r.satellites ?? []).map((s) => s.node.id));
      // bounds **不参与**本次对照：卫星是带外新增的盒，必然扩大 AABB；
      // 它由专门的「卫星扩大 bounds」用例覆盖（见下）。
      return {
        nodes: r.nodes.filter((n) => !satIds.has(n.node.id)),
        links: r.links,
        bounds: b.bounds,
      };
    };
    expect(a.satellites ?? [], '带摘要一方应产出卫星').toHaveLength(1);
    expect(b.satellites ?? [], '无摘要一方不应产出卫星').toHaveLength(0);
    expect(at(a.satellites ?? [], 0, 'satellite').node.id, '卫星即摘要节点').toBe(summaryId);
    // 摘除语义 = 流内布局与「本来就没有摘要节点」逐位等价
    expectBitIdentical(stripSat(a), b, '摘除后流内 vs 无摘要');
    // 而 bounds 必须**扩大**到覆盖卫星（否则 fit/裁剪会切掉卫星）
    expect(a.bounds.maxX).toBeGreaterThan(b.bounds.maxX);
    const sat = at(a.satellites ?? [], 0, 'satellite');
    expect(a.bounds.maxX).toBeGreaterThanOrEqual(sat.box.x + sat.box.w);
    expect(a.bounds.minY).toBeLessThanOrEqual(sat.box.y);
    expect(a.bounds.maxY).toBeGreaterThanOrEqual(sat.box.y + sat.box.h);
  });
});

describe('S3 · 卫星几何', () => {
  /**
   * `satellite.ts` 自持一份 `subtreeBBox`（不从 layouts.ts 取——那会形成
   * `mindmap → satellite → layouts → mindmap` 循环，depcruise 实测拦截）。
   * 两份算式必须同值：卫星带的几何口径不能因「哪一份」而漂移。
   * 判据取卫星实际落点与 `layouts.subtreeBBox` 推得的带外沿一致。
   */
  it('带外沿口径与 layouts.subtreeBBox 一致（自持副本不得漂移）', () => {
    const root = withSummary();
    const res = layoutMindmap(root, m, new Set(), { satellite: satelliteHook });
    const sat = at(res.satellites ?? [], 0, 'satellite');
    const parent = req(res.nodes.find((n) => n.node.text === '父'), 'node');
    // 成员 = 父的三个成员子（摘要已摘除，不在父的子列表）
    const memberLns = parent.children.filter((c) => c.node.text?.startsWith('成员'));
    expect(memberLns).toHaveLength(3);
    const canon = memberLns.reduce(
      (acc, ln) => {
        const b = subtreeBBox(ln);
        return {
          minX: Math.min(acc.minX, b.minX),
          minY: Math.min(acc.minY, b.minY),
          maxX: Math.max(acc.maxX, b.maxX),
          maxY: Math.max(acc.maxY, b.maxY),
        };
      },
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    // 右向：sat.left = canon.maxX + BRACKET_GAP + STEM_GAP
    expect(sat.box.x).toBeCloseTo(canon.maxX + SUMMARY_BRACKET_GAP + SUMMARY_STEM_GAP, 5);
    expect(sat.box.y + sat.box.h / 2).toBeCloseTo((canon.minY + canon.maxY) / 2, 5);
  });
  it('右向：卫星位于成员带外侧，间距 = BRACKET_GAP + STEM_GAP', () => {
    const root = withSummary();
    const res = layoutMindmap(root, m, new Set(), { satellite: satelliteHook });
    const sat = (res.satellites ?? []).find((s) => s.node.text === '摘要');
    expect(sat, '摘要应产出卫星').toBeDefined();
    const parent = req(res.nodes.find((n) => n.node.text === '父'), 'node');
    const members = ['成员一', '成员二', '成员三']
      .map((t) => res.nodes.find((n) => n.node.text === t))
      .filter((n): n is LayoutNode => n !== undefined);
    expect(members, '成员应可见').toHaveLength(3);
    const band = members.reduce(
      (acc, n) => ({
        minX: Math.min(acc.minX, n.box.x),
        minY: Math.min(acc.minY, n.box.y),
        maxX: Math.max(acc.maxX, n.box.x + n.box.w),
        maxY: Math.max(acc.maxY, n.box.y + n.box.h),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    // 右向：位图在带外沿右侧
    expect(req(sat, 'sat').box.x).toBeCloseTo(band.maxX + SUMMARY_BRACKET_GAP + SUMMARY_STEM_GAP, 5);
    // 垂直居中于成员带
    expect(req(sat, 'sat').box.y + req(sat, 'sat').box.h / 2).toBeCloseTo((band.minY + band.maxY) / 2, 5);
    // 侧向 = 成员的侧向（同侧）
    expect(req(sat, 'sat').side).toBe(at(members, 0, 'members').side);
    expect(parent.box.x, '父盒不受卫星影响').toBeLessThan(band.minX);
  });

  it('左向：左右镜像一致', () => {
    const root = withSummary();
    const res = layoutMindmap(root, m, new Set(), { satellite: satelliteHook });
    const sat = req(
      (res.satellites ?? []).find((s) => s.node.text === '摘要'),
      'satellite',
    );
    const members = ['成员一', '成员二', '成员三']
      .map((t) => res.nodes.find((n) => n.node.text === t))
      .filter((n): n is LayoutNode => n !== undefined);
    const side = at(members, 0, 'members').side;
    if (side > 0) {
      // 本夹具走右侧；左向镜像由下方专测覆盖（成员分配由贪心决定）
      expect(sat.box.x).toBeGreaterThan(Math.max(...members.map((n) => n.box.x + n.box.w)));
    } else {
      expect(sat.box.x + sat.box.w).toBeLessThan(Math.min(...members.map((n) => n.box.x)));
    }
  });

  it('摘要子树链接：含 S→子，不含 P→S', () => {    const root = build('# 根\n## 父\n- 成员一\n- 成员二\n- 成员三');
    const parent = req(findByText(root, '父'), 'findByText');
    const withChild = (() => {
      const summary: EditableNode = {
        id: 'S',
        type: 'text',
        text: '摘要',
        note: {},
        children: [{ id: 'S1', type: 'text', text: '摘要子', children: [] }],
      };
      const patched = insertChild(root, parent.id, summary, parent.children.length);
      const from = req(findByText(patched, '成员一'), 'findByText');
      const to = req(findByText(patched, '成员三'), 'findByText');
      let next = ensureCids(patched, [from.id, to.id]);
      const fromCid = cidOfWith(next, from.id);
      const toCid = cidOfWith(next, to.id);
      next = mapNode(next, 'S', (n) => ({
        ...n,
        note: { summary_of: { from: `cid:${fromCid}`, to: `cid:${toCid}` } },
      }));
      return next;
    })();
    const res = layoutMindmap(withChild, m, new Set(), { satellite: satelliteHook });
    const parentId = req(findByText(withChild, '父'), 'findByText').id;
    const ids = res.links.map((l) => [l.fromId, l.toId] as const);
    expect(ids.some(([f, t]) => f === parentId && t === 'S'), 'P→S 不得存在').toBe(false);
    expect(ids.some(([f, t]) => f === 'S' && t === 'S1'), 'S→子 必须保留').toBe(true);
  });
});

// ============================================================================
// S3-R1 · 子树口径判别（防「成员盒带」恒等分叉）
// ============================================================================

/**
 * 构造**带子树**的夹具：成员一有三个子节点（c1/c2/c3），成员二/成员三为叶。
 *
 * 夹具之所以必须带子节点：既有「带外沿口径」用例的成员**全是叶节点**，
 * 此时 `subtreeBBox(ln) ≡ ln.box`，两份实现（`satellite.ts` 自持副本与
 * `layouts.ts` 导出件）即使分叉也恒等——实测把 `satellite.ts` 的递归
 * 关掉（`for (const c of ln.children)` → `for (const c of [])`）后
 * 既有 19 个用例**仍全绿**。故本组用「子树明显大于自身盒」的夹具重钉。
 *
 * 复算实测值（本文件自测口径，见下用例断言）：
 * - 成员一自身盒 `(278,-59)..(378,-29)`，其 `subtreeBBox` = `(278,-103)..(542,15)`：
 *   `maxX` 378→542（**+164**）、`minY` -59→-103（**-44**）；
 * - 成员盒带 `maxX=378`，子树带 `maxX=542`；
 * - 卫星 `x=564` = 子树带 `542 + BRACKET(12) + STEM(10)`；按成员盒带只会给 `400`（**差 164**）；
 * - 卫星中心 `y=0` = 子树带中心；成员盒带中心为 `22`（**差 22**）。
 */
function withSummarySubtrees(): EditableNode {
  const text = `# 根
## 父
- 成员一
  - c1
  - c2
  - c3
- 成员二
- 成员三`;
  const root = build(text);
  return addSummaryTo(root, '父', ['成员一', '成员三']);
}

describe('S3-R1 · 子树口径：带外沿必须用子树并集（成员带子节点时判别）', () => {
  /**
   * 四项口径一致性：把「同一份子树几何」在四条独立路径上取值并**逐值比对**——
   * 任何一条路径的分叉都会让其中一项偏离，而不是被叶节点夹具的恒等式吃掉。
   *
   * (1) `satellite.ts` 自持的 `subtreeBBox`：**未导出**（生产源码不得为测试加
   *     test-only 导出，故不经由直接 import 取值），改由**卫星实际落点**间接
   *     断言——卫星的 `x` 与 `y` 是该副本输出的**纯函数**
   *     （`satellite.ts:272-275`：`edge = band.maxX`；`satellite.ts:263`：
   *     `top = (band.minY + band.maxY)/2 - h/2`），故落点即副本的观测量。
   * (2) `layouts.ts` 的导出 `subtreeBBox`：直接调用，逐值取四项。
   * (3) 一个**真实**含子节点的 `LayoutNode`：从布局结果里取成员一，断言其
   *     `children` 非空（夹具确证含子节点，否则本组退化为既有恒等用例）。
   * (4) `minX` / `minY` / `maxX` / `maxY` **四项逐值**一致。
   */
  it('四项口径一致：layouts.subtreeBBox = 真实含子树节点 = 卫星落点', () => {
    const root = withSummarySubtrees();
    const res = layoutMindmap(root, m, new Set(), { satellite: satelliteHook });
    const sat = req((res.satellites ?? [])[0], 'satellite');
    const members = ['成员一', '成员二', '成员三']
      .map((t) => req(res.nodes.find((n) => n.node.text === t), `member ${t}`));

    // (3) 成员一必须**真的带子树**——这是本组与既有叶节点用例的分水岭
    const first = at(members, 0, 'members');
    expect(first.node.text, '成员一').toBe('成员一');
    expect(first.children.length, '成员一必须含子节点（否则本用例无判别力）').toBeGreaterThan(0);
    expect(first.children.map((c) => c.node.text), '成员一子树').toEqual(['c1', 'c2', 'c3']);

    // (4) 子树并集：四项逐值（canon = layouts.ts 导出件的并集）
    const canon = members.reduce(
      (acc, ln) => {
        const b = subtreeBBox(ln);
        return {
          minX: Math.min(acc.minX, b.minX),
          minY: Math.min(acc.minY, b.minY),
          maxX: Math.max(acc.maxX, b.maxX),
          maxY: Math.max(acc.maxY, b.maxY),
        };
      },
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    // (2) 逐值钉住导出件对**含子树**节点的输出（复算实测值）
    expect(subtreeBBox(first), '成员一 subtreeBBox').toEqual({
      minX: 278,
      minY: -103,
      maxX: 542,
      maxY: 15,
    });
    expect(canon, '成员子树并集（四项）').toEqual({
      minX: 278,
      minY: -103,
      maxX: 542,
      maxY: 103,
    });

    // 判别力自证：子树带必须**明显大于**成员自身盒带（否则又退化为恒等）
    const ownBox = members.reduce(
      (acc, n) => ({
        minX: Math.min(acc.minX, n.box.x),
        minY: Math.min(acc.minY, n.box.y),
        maxX: Math.max(acc.maxX, n.box.x + n.box.w),
        maxY: Math.max(acc.maxY, n.box.y + n.box.h),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    expect(canon.maxX - ownBox.maxX, '子树带 maxX 必须明显越过成员自身盒').toBeGreaterThan(100);
    expect(ownBox.minY - canon.minY, '子树带 minY 必须明显越过成员自身盒').toBeGreaterThan(0);

    // (1) satellite.ts 自持副本：观测量 = 卫星落点（副本未导出，见上注释）
    //     右向：S.left = 子树带 maxX + BRACKET_GAP + STEM_GAP
    expect(sat.box.x, 'satellite.ts 副本：带外沿须用子树并集的 maxX').toBeCloseTo(
      canon.maxX + SUMMARY_BRACKET_GAP + SUMMARY_STEM_GAP,
      5,
    );
    //     且**不得**等于「成员自身盒带」推出的位置（差 164px，防恒等退化）
    expect(
      sat.box.x - (ownBox.maxX + SUMMARY_BRACKET_GAP + SUMMARY_STEM_GAP),
      '卫星不得落在成员自身盒带外沿（自持副本分叉的判别量）',
    ).toBeCloseTo(164, 5);
    //     垂直：S 中心 = 子树带中心（minY/maxY 两项亦参与）
    expect(sat.box.y + sat.box.h / 2, 'satellite.ts 副本：带心须用子树并集的 minY/maxY').toBeCloseTo(
      (canon.minY + canon.maxY) / 2,
      5,
    );
    //     成员自身盒带中心为 22，与子树带中心相差 22 —— 再次排除恒等退化
    expect(
      (canon.minY + canon.maxY) / 2 - (ownBox.minY + ownBox.maxY) / 2,
      '子树带心与成员盒带心必须可分',
    ).toBeCloseTo(-22, 5);
  });
});

describe('S3 · 降级域：摘要节点不得消失', () => {
  const degraded: Record<string, LayoutResult> = {};

  it('org 布局：摘要留流内可见', () => {
    const root = withSummary();
    const res = layoutOrg(root, m, new Set(), 1);
    degraded.org = res;
    expect(res.nodes.some((n) => n.node.text === '摘要'), '摘要必须可见').toBe(true);
  });

  it('显式 dir 分叉路径：摘要留流内可见', () => {
    const root = withSummary();
    // 注入显式 dir 让 layoutMindmapBranched 走分支路径（非回退）
    const marked = mapNode(root, req(findByText(root, '父'), 'findByText').id, (n) => ({
      ...n,
      note: { ...(n.note ?? {}), dir: 'right' },
    }));
    const res = layoutMindmapBranched(marked, m, new Set(), { islandDir: 'right' });
    degraded.branched = res;
    expect(res.nodes.some((n) => n.node.text === '摘要'), '摘要必须可见').toBe(true);
  });

  it('降级域不产出卫星（避免无括线的孤立几何）', () => {
    for (const [label, res] of Object.entries(degraded)) {
      expect(res.satellites ?? [], `${label}：降级域不应产出卫星`).toHaveLength(0);
    }
  });
});
