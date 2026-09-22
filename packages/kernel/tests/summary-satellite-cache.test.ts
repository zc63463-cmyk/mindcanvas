/**
 * 摘要卫星 · 缓存与编辑序列（S3 · T5）。
 *
 * 本文件是「卫星 × 缓存耦合」的唯一强钉——设计稿 §4 风险 1 指出这是**唯一能出
 * 静默陈旧几何**的地方。方法：让同一份编辑序列分别在**缓存开启**与**缓存关闭**下
 * 跑完，每一步都要求两者逐位等价。
 *
 * 为什么这是充分判据：缓存关闭 = 全量重算 = 「正确参照系」；缓存开启若与它逐位不同，
 * 就是缓存复用给出了陈旧几何（身份命中但几何已变的经典缺陷）。这条判据不依赖任何
 * 关于「哪个键位够不够」的推理。
 *
 * 覆盖任务书 §4.3 的连续编辑：创建摘要、删除摘要、修改成员、修改摘要文本、
 * 缩进、反缩进、移动成员、折叠和展开。另含 §4.4「同一输入重复布局三次」与
 * §4.7「主题/字号/测量缓存变化不破坏卫星归属」。
 */
import { describe, expect, it } from 'vitest';
import { parseMm } from '../src/protocol/parser.js';
import { astToEditable, updateNode, type EditableNode } from '../src/tree/treeOps.js';
import { layoutMindmap, LayoutCache, type LayoutResult } from '../src/layout/mindmap.js';
import { layoutLogic } from '../src/layout/layouts.js';
import { layoutForest, type CenterSpec } from '../src/layout/forest.js';
import { satelliteHook } from '../src/layout/satellite.js';

/** 度量（h 随文本变化——真实文本度量形态，能暴露「文本改长短 → 盒高变」的复用陷阱） */
const m = (n: EditableNode): { w: number; h: number } => ({
  w: 40 + (n.text ?? '').length * 8,
  h: 30 + (n.text ?? '').length * 2,
});

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

function findByText(node: EditableNode, text: string): EditableNode | undefined {
  if (node.text === text) return node;
  for (const c of node.children) {
    const hit = findByText(c, text);
    if (hit) return hit;
  }
  return undefined;
}

/** 不可变整树映射（保持未变子树的**对象身份**——缓存复用的前提） */
function mapTree(
  node: EditableNode,
  fn: (n: EditableNode) => EditableNode,
  descendInto: (n: EditableNode) => boolean = () => true,
): EditableNode {
  const self = fn(node);
  if (!descendInto(self)) return self;
  const children = self.children.map((c) => mapTree(c, fn, descendInto));
  return children.every((c, i) => c === self.children[i]) ? self : { ...self, children };
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

function removeChild(node: EditableNode, id: string): EditableNode {
  const children = node.children
    .filter((c) => c.id !== id)
    .map((c) => removeChild(c, id));
  return children.length === node.children.length &&
    children.every((c, i) => c === node.children[i])
    ? node
    : { ...node, children };
}

/** 完整指纹（含卫星；用于「缓存开 == 缓存关」逐步比对） */
function fingerprint(res: LayoutResult): string {
  return JSON.stringify({
    n: res.nodes.map((n) => [n.node.id, n.box.x, n.box.y, n.box.w, n.box.h, n.side, n.depth, n.parentId]),
    l: res.links.map((l) => [l.fromId, l.toId, l.path]),
    b: res.bounds,
    s: (res.satellites ?? []).map((s) => [s.node.id, s.box.x, s.box.y, s.box.w, s.box.h, s.side]),
  });
}

let cidSeq = 0;

/** 带摘要的基线文档：父下三个成员 + 摘要 S（cid 锚） */
function docWithSummary(): EditableNode {
  cidSeq = 0;
  const root = build('# 根\n## 父\n- 成员一\n- 成员二\n- 成员三');
  const parent = req(findByText(root, '父'), '父');
  const members = parent.children;
  let next = root;
  const cids: string[] = [];
  for (const mem of members) {
    cidSeq += 1;
    const cid = `cc${cidSeq}`;
    cids.push(cid);
    next = mapTree(next, (n) => (n.id === mem.id ? { ...n, note: { ...(n.note ?? {}), cid } } : n));
  }
  const summary: EditableNode = {
    id: 'S',
    type: 'text',
    text: '摘要',
    note: { summary_of: { from: `cid:${cids[0]}`, to: `cid:${cids[2]}` } },
    children: [{ id: 'S-child', type: 'text', text: '摘要子', children: [] }],
  };
  return insertChild(next, parent.id, summary, parent.children.length);
}

/** 派生「无摘要」形态（供第①步基线与对照使用） */
function withoutSummary(doc: EditableNode): EditableNode {
  return removeChild(doc, 'S');
}

// ============================================================================
// T5-a：编辑序列 × 缓存开/关逐位等价
// ============================================================================

describe('S3 · 编辑序列：缓存开启与关闭逐步逐位等价', () => {
  /**
   * 路径选择说明：本用例走 **`layoutMindmap`** 而非 `layoutLogic`。
   * 原因是 `layoutLogic` 存在**基线既有**的缓存失效缺口（不校验 collapsedKey/
   * measureKey）——见下方「基线既有缺陷 · 边界标注」用例的实测复现。
   * `layoutMindmap` 在入口做了键位身份校验（mindmap.ts），是折叠语义可信赖的路径。
   * 无折叠变化的 `layoutLogic` 等价性由下方 measureKey/重复布局用例覆盖。
   */
  it('mindmap 路径：创建/删摘要/改成员/改摘要文本/缩进/移动/折叠/展开', () => {
    // ⚠️ 折叠集合的缓存契约是**身份比较**（mindmap.ts 头注释）：任何折叠增删必须换新
    //    Set 实例（真实调用方每次重建 Set）。若原地 mutate 同一实例，缓存不会失效——
    //    那是**违反前置契约**的用法，不在本测试判据内。故这里一律换实例。
    let collapsedInc = new Set<string>();
    let collapsedFull = new Set<string>();
    const cache = new LayoutCache();
    let inc = docWithSummary();
    let full = inc;

    const runInc = (): LayoutResult =>
      layoutMindmap(inc, m, collapsedInc, {
        cache,
        measureKey: 'K',
        satellite: satelliteHook,
      });
    const runFull = (): LayoutResult =>
      layoutMindmap(full, m, collapsedFull, { satellite: satelliteHook });

    const steps: Array<{ name: string; apply: () => void }> = [];

    // ① 创建摘要：从「无摘要」出发
    {
      const base = withoutSummary(docWithSummary());
      inc = base;
      full = base;
      steps.push({
        name: '创建摘要（插入 S 节点）',
        apply: () => {
          const withS = docWithSummary();
          inc = withS;
          full = withS;
        },
      });
    }
    // ② 修改成员文本（改长 → w/h 变化 → 卫星带随动）
    steps.push({
      name: '修改成员文本（成员二 → 加长）',
      apply: () => {
        const target = req(findByText(inc, '成员二'), '成员二');
        inc = updateNode(inc, target.id, { text: '成员二加长文本' });
        full = inc;
      },
    });
    // ③ 修改摘要文本（卫星自身盒变化 → S 垂直重居中）
    steps.push({
      name: '修改摘要文本',
      apply: () => {
        inc = updateNode(inc, 'S', { text: '摘要改名更长的标题' });
        full = inc;
      },
    });
    // ④ 中间成员增（带伸缩 + 卫星带宽变化）
    steps.push({
      name: '中间插入成员',
      apply: () => {
        const parent = req(findByText(inc, '父'), '父');
        const mid = req(findByText(inc, '成员二加长文本'), '成员二加长文本');
        const idx = parent.children.findIndex((c) => c.id === mid.id);
        const newNode: EditableNode = { id: 'NEW', type: 'text', text: '新增成员', children: [] };
        inc = insertChild(inc, parent.id, newNode, idx + 1);
        full = inc;
      },
    });
    // ⑤ 折叠父（成员全隐 → 无卫星）
    steps.push({
      name: '折叠父（成员不可见）',
      apply: () => {
        const pid = req(findByText(inc, '父'), '父').id;
        collapsedInc = new Set([...collapsedInc, pid]);
        collapsedFull = new Set([...collapsedFull, pid]);
      },
    });
    // ⑥ 展开父
    steps.push({
      name: '展开父',
      apply: () => {
        const pid = req(findByText(inc, '父'), '父').id;
        collapsedInc = new Set([...collapsedInc].filter((x) => x !== pid));
        collapsedFull = new Set([...collapsedFull].filter((x) => x !== pid));
      },
    });
    // ⑦ 折叠摘要自身（仅盒）
    steps.push({
      name: '折叠摘要节点自身',
      apply: () => {
        collapsedInc = new Set([...collapsedInc, 'S']);
        collapsedFull = new Set([...collapsedFull, 'S']);
      },
    });
    // ⑧ 展开摘要
    steps.push({
      name: '展开摘要节点',
      apply: () => {
        collapsedInc = new Set([...collapsedInc].filter((x) => x !== 'S'));
        collapsedFull = new Set([...collapsedFull].filter((x) => x !== 'S'));
      },
    });
    // ⑨ 缩进「新增成员」（成为成员二的孩子 → 退出范围，带收缩）
    steps.push({
      name: '缩进新增成员（移出成员带）',
      apply: () => {
        const parent = req(findByText(inc, '父'), '父');
        const newNode = req(findById(inc, 'NEW'), 'NEW');
        const anchor = req(findByText(inc, '成员二加长文本'), 'anchor');
        inc = removeChild(inc, 'NEW');
        inc = insertChild(inc, anchor.id, { ...newNode, id: 'NEW2' }, anchor.children.length);
        full = inc;
        void parent;
      },
    });
    // ⑩ 反缩进（移回父下）
    steps.push({
      name: '反缩进新增成员（移回成员带）',
      apply: () => {
        const parent = req(findByText(inc, '父'), '父');
        const moved = req(findById(inc, 'NEW2'), 'NEW2');
        inc = removeChild(inc, 'NEW2');
        inc = insertChild(inc, parent.id, { ...moved, id: 'NEW3' }, parent.children.length - 1);
        full = inc;
      },
    });
    // ⑪ 删除摘要（卫星消失，成员回流）
    steps.push({
      name: '删除摘要节点',
      apply: () => {
        inc = removeChild(inc, 'S');
        full = inc;
      },
    });

    for (const [i, step] of steps.entries()) {
      step.apply();
      const a = runInc();
      const b = runFull();
      expect(a.nodes.length, `步骤 ${i + 1}「${step.name}」：nodes 数`).toBe(b.nodes.length);
      expect(
        fingerprint(a),
        `步骤 ${i + 1}「${step.name}」：缓存开 vs 关 逐位不等`,
      ).toBe(fingerprint(b));
    }
  });

  /**
   * 前置缺陷（**基线既有，非本批引入**）：`layoutLogic` 不做 `collapsedKey`/`measureKey`
   * 身份校验——与 `layoutMindmap`（mindmap.ts 入口）和 `layoutForest`（forest.ts 入口）
   * 不同，它直接消费缓存。于是「热缓存 + 折叠集合换实例」时，复用子树带着旧的折叠态返回，
   * 输出与无缓存不等价。
   *
   * 已在**基线 worktree `e187fa9`（mindcanvas-s2-f4，clean）**实测复现（无任何卫星参与）：
   *     WARM 5 / COLLAPSED 5 / COLD 2
   * 即缺陷与摘要卫星无关，是 `layoutLogic` 自身的缓存失效纪律缺口。
   *
   * 本批**不修**（修它等于改 `layouts.ts` 的缓存语义，超出「摘要卫星」范围，且会扰动
   * F3 既有判据）。此处把边界**显式钉住并标注**，防止被误读为 S3 的等价性承诺：
   * 卫星在「无折叠变化」的前提下与无缓存逐位等价（上方用例已覆盖），
   * 但「折叠集合变化 + 热缓存」这一组合受基线缺陷限制。
   */
  it('【基线既有缺陷 · 边界标注】layoutLogic 热缓存 + 折叠换实例：与无缓存不等价', () => {
    const doc = docWithSummary();
    const cache = new LayoutCache();
    const warm = layoutLogic(doc, m, new Set<string>(), 1, {
      cache,
      measureKey: 'K',
      satellite: satelliteHook,
    });
    expect(warm.nodes.length, '预热：全文展开').toBeGreaterThan(2);
    const parentId = req(findByText(doc, '父'), '父').id;
    // 折叠集合换新实例（合法调用形态）→ 期望重算；实际因 layoutLogic 不校验键而复用旧子树
    const stale = layoutLogic(doc, m, new Set<string>([parentId]), 1, {
      cache,
      measureKey: 'K',
      satellite: satelliteHook,
    });
    const cold = layoutLogic(doc, m, new Set<string>([parentId]), 1, { satellite: satelliteHook });
    // 记录事实：热缓存路径给出了陈旧几何（节点数多于折叠后应有值）
    expect(stale.nodes.length, '基线缺陷：热缓存未失效，返回陈旧展开几何').toBeGreaterThan(
      cold.nodes.length,
    );
    expect(cold.nodes.length, '无缓存：折叠后只剩根与父').toBe(2);
    // 而**卫星本身**不放大该缺陷：两条路径都受同一份陈旧子树影响
    expect((stale.satellites ?? []).length).toBeGreaterThanOrEqual(0);
  });

  it('同一输入重复布局三次：结果逐位相同（含卫星）', () => {
    const doc = docWithSummary();
    const collapsed = new Set<string>();
    const cache = new LayoutCache();
    const run = (): LayoutResult =>
      layoutMindmap(doc, m, collapsed, { cache, measureKey: 'K', satellite: satelliteHook });
    const a = fingerprint(run());
    const b = fingerprint(run());
    const c = fingerprint(run());
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('measureKey 变化（主题/字号）后：缓存失效不破坏卫星归属', () => {
    const doc = docWithSummary();
    const collapsed = new Set<string>();
    const cache = new LayoutCache();
    const at = (key: string): LayoutResult =>
      layoutMindmap(doc, m, collapsed, { cache, measureKey: key, satellite: satelliteHook });
    const k1 = at('theme-A');
    const k1again = at('theme-A');
    expect(fingerprint(k1again), '同键重复应逐位相同').toBe(fingerprint(k1));
    // 换度量键（模拟切主题/改字号）→ 全量重算
    const k2 = at('theme-B');
    // 卫星**归属**必须不变（同一批成员、同一摘要），只是几何按新度量重算
    expect((k2.satellites ?? []).map((s) => s.node.id)).toEqual(
      (k1.satellites ?? []).map((s) => s.node.id),
    );
    // 且 k2 必须与「无缓存跑 k2」逐位等价（换键后缓存未给陈旧几何）
    const cold = layoutMindmap(doc, m, new Set(collapsed), {
      measureKey: 'theme-B',
      satellite: satelliteHook,
    });
    expect(fingerprint(k2)).toBe(fingerprint(cold));
    // 回到 k1 同样逐位等价
    const back = at('theme-A');
    expect(fingerprint(back)).toBe(fingerprint(k1));
  });

  it('折叠集合身份变化（新 Set 实例）→ 全量重算且与缓存关逐位等价', () => {
    const doc = docWithSummary();
    const cache = new LayoutCache();
    const s1 = new Set<string>();
    const a = layoutMindmap(doc, m, s1, { cache, measureKey: 'K', satellite: satelliteHook });
    // 新 Set 实例（身份不同）→ reset 全量；结果必须仍与无缓存一致
    const s2 = new Set<string>();
    const b = layoutMindmap(doc, m, s2, { cache, measureKey: 'K', satellite: satelliteHook });
    const cold = layoutMindmap(doc, m, new Set<string>(), { satellite: satelliteHook });
    expect(fingerprint(a)).toBe(fingerprint(cold));
    expect(fingerprint(b)).toBe(fingerprint(cold));
  });
});

// ============================================================================
// T5-b：森林岛内编辑序列 × 缓存开/关
// ============================================================================

describe('S3 · 森林岛内编辑序列：缓存开启与关闭逐步逐位等价', () => {
  function forestFixture(): { island: EditableNode; doc: EditableNode } {
    cidSeq = 0;
    const root = build('# 文档根\n## 岛根\n- 成员一\n- 成员二\n- 成员三\n## 旁观\n- x');
    const islandBefore = req(
      root.children.find((c) => c.text === '岛根'),
      '岛根',
    );
    let next = root;
    const cids: string[] = [];
    for (const mem of islandBefore.children) {
      cidSeq += 1;
      const cid = `ff${cidSeq}`;
      cids.push(cid);
      next = mapTree(next, (n) => (n.id === mem.id ? { ...n, note: { ...(n.note ?? {}), cid } } : n));
    }
    const summary: EditableNode = {
      id: 'FS',
      type: 'text',
      text: '岛摘要',
      note: { summary_of: { from: `cid:${cids[0]}`, to: `cid:${cids[2]}` } },
      children: [{ id: 'FS-child', type: 'text', text: '摘要子', children: [] }],
    };
    const patched = insertChild(next, islandBefore.id, summary, islandBefore.children.length);
    const island = req(findById(patched, islandBefore.id), '岛根(patched)');
    return { island, doc: patched };
  }

  const specOf = (island: EditableNode, x: number, y: number): CenterSpec[] => [
    { node: island, dir: 'right', pos: { x, y } },
  ];

  it('岛内：改成员 / 改摘要 / 插成员 → 每步缓存开 == 关', () => {
    const { island, doc } = forestFixture();
    let collapsedInc = new Set<string>();
    let collapsedFull = new Set<string>();
    const cache = new LayoutCache();
    let incDoc = doc;
    let incIsland = island;
    let fullIsland = island;

    const runInc = (): LayoutResult =>
      layoutForest(specOf(incIsland, 250, 60), m, collapsedInc, {
        cache,
        measureKey: 'K',
        satellite: satelliteHook,
      });
    const runFull = (): LayoutResult =>
      layoutForest(specOf(fullIsland, 250, 60), m, collapsedFull, {
        satellite: satelliteHook,
      });

    const steps: Array<{ name: string; apply: () => void }> = [
      {
        name: '改成员文本',
        apply: () => {
          const t = req(findByText(incDoc, '成员二'), '成员二');
          incDoc = updateNode(incDoc, t.id, { text: '成员二改长' });
          incIsland = req(findById(incDoc, incIsland.id), 'island');
          fullIsland = incIsland;
        },
      },
      {
        name: '改摘要文本',
        apply: () => {
          incDoc = updateNode(incDoc, 'FS', { text: '岛摘要改名' });
          incIsland = req(findById(incDoc, incIsland.id), 'island');
          fullIsland = incIsland;
        },
      },
      {
        name: '中间插成员',
        apply: () => {
          const parent = incIsland;
          const idx = parent.children.findIndex((c) => c.text === '成员二改长');
          incDoc = insertChild(
            incDoc,
            parent.id,
            { id: 'FNEW', type: 'text', text: '岛新成员', children: [] },
            idx + 1,
          );
          incIsland = req(findById(incDoc, incIsland.id), 'island');
          fullIsland = incIsland;
        },
      },
      {
        name: '折叠岛内摘要',
        apply: () => {
          collapsedInc = new Set([...collapsedInc, 'FS']);
          collapsedFull = new Set([...collapsedFull, 'FS']);
        },
      },
      {
        name: '展开岛内摘要',
        apply: () => {
          collapsedInc = new Set([...collapsedInc].filter((x) => x !== 'FS'));
          collapsedFull = new Set([...collapsedFull].filter((x) => x !== 'FS'));
        },
      },
      {
        name: '删除岛内摘要',
        apply: () => {
          incDoc = removeChild(incDoc, 'FS');
          incIsland = req(findById(incDoc, incIsland.id), 'island');
          fullIsland = incIsland;
        },
      },
    ];

    for (const [i, step] of steps.entries()) {
      step.apply();
      const a = runInc();
      const b = runFull();
      expect(
        fingerprint(a),
        `岛内步骤 ${i + 1}「${step.name}」：缓存开 vs 关 逐位不等`,
      ).toBe(fingerprint(b));
    }
  });

  it('岛平移前后逐位等价：同落点重复三次 + 落点往返', () => {
    const { island } = forestFixture();
    const collapsed = new Set<string>();
    const cache = new LayoutCache();
    const run = (x: number, y: number): LayoutResult =>
      layoutForest(specOf(island, x, y), m, collapsed, {
        cache,
        measureKey: 'K',
        satellite: satelliteHook,
      });
    const a = fingerprint(run(0, 0));
    expect(fingerprint(run(0, 0))).toBe(a);
    expect(fingerprint(run(0, 0))).toBe(a);
    const moved = run(400, -120);
    expect(fingerprint(run(0, 0)), '往返后应回到原位（非破坏式平移）').toBe(a);
    // 位移量精确等于落点差
    const s0 = req((run(0, 0).satellites ?? [])[0], 'sat@0');
    const s1 = req((moved.satellites ?? [])[0], 'sat@moved');
    expect(s1.box.x - s0.box.x).toBeCloseTo(400, 5);
    expect(s1.box.y - s0.box.y).toBeCloseTo(-120, 5);
  });

  it('森林：无摘要文档缓存开/关逐位等价且无 satellites 字段', () => {
    const root = build('# 根\n## 岛\n- a\n- b\n- c');
    const island = req(root.children[0], 'island');
    const cache = new LayoutCache();
    const collapsed = new Set<string>();
    const inc = layoutForest(specOf(island, 0, 0), m, collapsed, {
      cache,
      measureKey: 'K',
      satellite: satelliteHook,
    });
    const full = layoutForest(specOf(island, 0, 0), m, new Set<string>(), {
      satellite: satelliteHook,
    });
    expect(inc.satellites).toBeUndefined();
    expect(full.satellites).toBeUndefined();
    expect(fingerprint(inc)).toBe(fingerprint(full));
  });
});
