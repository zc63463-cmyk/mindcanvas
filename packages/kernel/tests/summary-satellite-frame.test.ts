/**
 * 摘要卫星 · 框路径专测（S3-R1 · frame 缺陷）。
 *
 * ## 缺陷
 *
 * `expandFrameIslands`（`src/layout/frameLayout.ts:245`）在真正展开时**新构造**返回对象
 * `{ nodes, links, bounds }`，未携带 `LayoutResult.satellites`——基座布局产出的卫星
 * 在框路径上被**静默丢弃**（加法字段丢失，而不是显式降级）。
 *
 * 可复现的最小形态（本文件夹具「框外摘要」）：文档里同时有**框**与**框外**的
 * well-formed 摘要时，摘要与框内子树无关——基座布局能正常为它产出卫星
 * （成员盒在基座上可见），而展开期新构造的对象把这个字段整个丢掉。
 *
 * ## 框内摘要为什么本来就不产出卫星（本测试锁死的契约）
 *
 * 框内节点在基座布局里根本不存在：编排层（`packages/react/src/demo/pipeline.ts:245`）
 * 把框根整棵后代交 `framePrunedCollapsed` 剪掉，再由 `expandFrameIslands` 按**框岛
 * 自有坐标**重建。于是基座的卫星钩子看不到任何框内成员盒
 * （`satellite.ts:bandOfMembers` 无盒 → 不产出卫星），而框岛重建路径没有、也不应
 * 凭空再造一套卫星几何（那要把卫星放置接进框岛的局部坐标/缓存体系，超出本批安全范围）。
 *
 * 故框路径对**框内**摘要的正确行为是显式降级，并保证最严重的失败形态不发生：
 * **摘要节点必须留在展开结果的 `nodes` 内可见**（框岛按事实树重建行，摘要作为普通
 * 子节点入行）。
 *
 * ## 红/绿判据
 *
 * 用例 ② 在候选代码上**真实失败**：夹具「框外摘要」的基座确实产出 1 个卫星，
 * 而 `expandFrameIslands` 返回结果的 `satellites` 为 `undefined`——静默丢失。
 */
import { describe, expect, it } from 'vitest';
import {
  collectFrameRoots,
  createFrameShellMeasure,
  expandFrameIslands,
  framePrunedCollapsed,
} from '../src/layout/frameLayout.js';
import {
  LayoutCache,
  type LayoutNode,
  type LayoutResult,
  layoutMindmap,
  type MeasureFn,
} from '../src/layout/mindmap.js';
import { buildSatellitePlan, satelliteHook } from '../src/layout/satellite.js';
import { setFrame } from '../src/protocol/frame.js';
import { parseMm } from '../src/protocol/parser.js';
import { astToEditable, type EditableNode } from '../src/tree/treeOps.js';

/** 确定性度量：宽 = 文本长度 × 10，高 = 30（几何断言的可读基数） */
const m = (node: EditableNode): { w: number; h: number } => ({
  w: (node.text ?? 'x').length * 10,
  h: 30,
});

/** 框内行度量选项（与 pipeline.ts:253 同形） */
const ROW_OPTS = { textMeasure: (t: string): number => t.length * 10 };

/** 框壳度量（与 pipeline 的 `createFrameShellMeasure(measure, frameRows)` 同形） */
function lm(): MeasureFn {
  return createFrameShellMeasure(m, { ...ROW_OPTS });
}

/** 取「必须存在」的值（替代 `!` 非空断言——项目 lint 对新增非空断言零容忍） */
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

/** 给节点打框（不可变：返回新节点对象） */
function framed(node: EditableNode, depth: number): EditableNode {
  return { ...node, note: setFrame(node.note, depth) };
}

/** 全树 id 前序全集（判「无节点消失」的权威口径） */
function allIds(node: EditableNode, out: string[] = []): string[] {
  out.push(node.id);
  for (const c of node.children) allIds(c, out);
  return out;
}

/** 幂等补 cid（夹具用；与 summary-satellite.test.ts 同口径） */
function ensureCids(root: EditableNode, ids: string[]): EditableNode {
  let next = root;
  let seq = 0;
  for (const id of ids) {
    seq += 1;
    next = mapNode(next, id, (n) => ({
      ...n,
      note: { ...(n.note ?? {}), cid: (n.note?.cid as string | undefined) ?? `fx${seq}` },
    }));
  }
  return next;
}

function cidOf(root: EditableNode, nodeId: string): string {
  const cid = findById(root, nodeId)?.note?.cid;
  if (typeof cid !== 'string') throw new Error(`节点 ${nodeId} 无 cid`);
  return cid;
}

/**
 * 在 `parentText` 下挂一个 well-formed 摘要（cid 锚，与生产写入同形态）。
 * `memberTexts` 的两端即 `summary_of` 范围。
 */
function addSummaryTo(
  root: EditableNode,
  parentText: string,
  memberTexts: string[],
  summaryId: string,
): EditableNode {
  const members = memberTexts.map((t) => req(findByText(root, t), t));
  const withCids = ensureCids(
    root,
    members.map((n) => n.id),
  );
  const summary: EditableNode = {
    id: summaryId,
    type: 'text',
    text: '摘要',
    note: {
      summary_of: {
        from: `cid:${cidOf(withCids, members[0]?.id ?? '')}`,
        to: `cid:${cidOf(withCids, members[members.length - 1]?.id ?? '')}`,
      },
    },
    children: [{ id: `${summaryId}-child`, type: 'text', text: '摘要子', children: [] }],
  };
  const parent = req(findByText(withCids, parentText), parentText);
  const parentNow = req(findById(withCids, parent.id), `${parentText}(patched)`);
  return insertChild(withCids, parentNow.id, summary, parentNow.children.length);
}

/**
 * 夹具 A「框外摘要」（**红证据来源**）：
 *
 * ```
 * 文档根
 * ├─ 框根（frame depth=1）        ← 剪枝集成员，基座里只剩壳
 * │  └─ 父行
 * └─ 中心
 *    ├─ 成员一 / 成员二 / 成员三
 *    └─ 摘要 S（summary_of 覆盖三名成员）   ← 在框**外**
 * ```
 *
 * 摘要与框内子树无关 → 基座布局真的为它产出卫星 → 展开期的静默丢弃可观测。
 */
function frameWithOutsideSummary(): {
  root: EditableNode;
  summaryId: string;
  frameRootId: string;
  centerId: string;
} {
  const base = build(`# 文档根
## 框根
- 父行
## 中心
- 成员一
- 成员二
- 成员三`);
  const withSummary = addSummaryTo(base, '中心', ['成员一', '成员二', '成员三'], 'S-outside');
  const frameRoot = req(findByText(withSummary, '框根'), '框根');
  const center = req(findByText(withSummary, '中心'), '中心');
  return {
    root: mapNode(withSummary, frameRoot.id, (n) => framed(n, 1)),
    summaryId: 'S-outside',
    frameRootId: frameRoot.id,
    centerId: center.id,
  };
}

/**
 * 夹具 B「框内摘要」：
 *
 * ```
 * 文档根
 * ├─ 框根（frame depth=1）
 * │  └─ 父行
 * │     ├─ 成员一 / 成员二 / 成员三
 * │     └─ 摘要 S（summary_of）        ← 在框**内**
 * └─ 旁观
 *    └─ x
 * ```
 */
function frameWithInsideSummary(): { root: EditableNode; summaryId: string } {
  const base = build(`# 文档根
## 框根
- 父行
- 成员一
- 成员二
- 成员三
## 旁观
- x`);
  const parent = req(findByText(base, '父行'), '父行');
  const members = ['成员一', '成员二', '成员三'].map((t) => req(findByText(base, t), t));
  let restructured = base;
  for (const mem of members) {
    restructured = removeChild(restructured, mem.id);
  }
  for (const mem of [...members].reverse()) {
    restructured = insertChild(restructured, parent.id, mem, 0);
  }
  const withSummary = addSummaryTo(
    restructured,
    '父行',
    ['成员一', '成员二', '成员三'],
    'S-inside',
  );
  const frameRoot = req(findByText(withSummary, '框根'), '框根');
  return {
    root: mapNode(withSummary, frameRoot.id, (n) => framed(n, 1)),
    summaryId: 'S-inside',
  };
}

/** 从树中移除某 id 的节点（不可变） */
function removeChild(node: EditableNode, id: string): EditableNode {
  const children = node.children.filter((c) => c.id !== id).map((c) => removeChild(c, id));
  return children.length === node.children.length &&
    children.every((c, i) => c === node.children[i])
    ? node
    : { ...node, children };
}

/**
 * 走**生产调用形态**（与 `pipeline.ts:245-280` 同形）：
 * `collectFrameRoots` → `framePrunedCollapsed` → 基座布局（`layoutMindmap`，带卫星钩子）
 * → 框壳度量 → `expandFrameIslands`。
 */
function runFramePath(
  root: EditableNode,
  collapsedIds: Set<string> = new Set(),
): { expanded: LayoutResult; base: LayoutResult; frameRootCount: number } {
  const frameRoots = collectFrameRoots(root);
  const pruned = framePrunedCollapsed(collapsedIds, frameRoots);
  const layoutMeasure =
    frameRoots.length === 0 ? m : createFrameShellMeasure(m, { ...ROW_OPTS, rowAuxH: undefined });
  const base = layoutMindmap(root, layoutMeasure, pruned, { satellite: satelliteHook });
  const expanded =
    frameRoots.length === 0 ? base : expandFrameIslands(base, root, layoutMeasure, collapsedIds);
  return { expanded, base, frameRootCount: frameRoots.length };
}

function idsOf(res: LayoutResult): string[] {
  return res.nodes.map((n) => n.node.id);
}

function nodeOf(res: LayoutResult, id: string): LayoutNode | undefined {
  return res.nodes.find((n) => n.node.id === id);
}

/** 结果指纹（判「同输入同输出」；含 satellites 字段形态） */
function fingerprint(res: LayoutResult): string {
  return JSON.stringify({
    n: res.nodes.map((n) => [n.node.id, n.box.x, n.box.y, n.box.w, n.box.h, n.side, n.depth]),
    l: res.links.map((l) => [l.fromId, l.toId, l.path]),
    b: res.bounds,
    s: (res.satellites ?? []).map((s) => [s.node.id, s.box.x, s.box.y]),
  });
}

describe('S3-R1 · 框路径：卫星字段不得静默丢失', () => {
  it('① 框外摘要：基座产出卫星，展开结果不得把它丢掉（红→绿核心）', () => {
    const { root, summaryId, frameRootId } = frameWithOutsideSummary();
    const plan = buildSatellitePlan(root);
    expect(plan.skip.has(summaryId), '夹具应为 well-formed 摘要（可摘除）').toBe(true);

    const { base, expanded, frameRootCount } = runFramePath(root);
    expect(frameRootCount, '夹具应命中一个框根').toBe(1);
    // 摘要与框内子树无关 → 基座真的产出卫星（这是本用例的前提，不是被测行为）
    expect(base.satellites ?? [], '基座应为框外摘要产出卫星（成员盒在基座上可见）').toHaveLength(1);
    expect(req(base.satellites, 'base.satellites')[0]?.node.id).toBe(summaryId);

    // 被测行为：展开期必须**显式**处理这个加法字段（传播或显式清空），不得静默丢弃。
    // 候选实现 `return { nodes, links, bounds }` → expanded.satellites === undefined → 失败。
    expect(
      (expanded.satellites ?? []).some((s) => s.node.id === summaryId),
      `展开结果丢失了基座产出的卫星 ${summaryId}（satellites=${JSON.stringify(
        expanded.satellites?.map((s) => s.node.id),
      )}）——加法字段被静默丢弃`,
    ).toBe(true);
    void frameRootId;
  });

  it('② 框路径不承诺卫星：框内摘要的 satellites 为空或缺失（显式降级）', () => {
    const { root } = frameWithInsideSummary();
    const { base, expanded } = runFramePath(root);
    expect(base.satellites ?? [], '框内摘要在基座上本就不产出卫星').toHaveLength(0);
    expect(
      expanded.satellites ?? [],
      '框路径对框内摘要不产出卫星（字段缺失或空数组都算显式降级）',
    ).toHaveLength(0);
  });

  it('③ 框内摘要节点仍在 nodes 中（框路径不得让摘要消失）', () => {
    const { root, summaryId } = frameWithInsideSummary();
    const { expanded } = runFramePath(root);
    expect(
      nodeOf(expanded, summaryId),
      `摘要节点 ${summaryId} 必须留在展开结果的 nodes 内（框路径降级：普通流行内可见）`,
    ).toBeDefined();
    expect(idsOf(expanded)).toContain(summaryId);
    // 摘要子也必须是普通流内的孩子（树边存在）
    const pairs = expanded.links.map((l) => `${l.fromId}->${l.toId}`);
    expect(pairs, '摘要子若可见则其树边必须存在').toContain(`${summaryId}->${summaryId}-child`);
    // 且该树边是**普通树边**（框岛行重建），不是卫星内部链接——框路径无卫星
    expect(expanded.satellites ?? []).toHaveLength(0);
  });

  it('④ 无节点消失：全树 id 全集 ⊆ 展开结果 nodes 的 id 集', () => {
    for (const fixture of [frameWithInsideSummary(), frameWithOutsideSummary()]) {
      const { root } = fixture;
      const { expanded } = runFramePath(root);
      const seen = new Set(idsOf(expanded));
      const missing = allIds(root).filter((id) => !seen.has(id));
      expect(missing, `以下节点在展开结果中消失：${missing.join(', ')}`).toEqual([]);
    }
  });

  it('⑤ 无摘要文档：展开结果与旧行为逐位等价（含 satellites 字段形态）', () => {
    const text = '# 文档根\n## 框根\n- 父行\n- a\n- b\n## 旁观\n- x';
    const plain = build(text);
    const frameRoot = req(findByText(plain, '框根'), '框根');
    const noSummary = mapNode(plain, frameRoot.id, (n) => framed(n, 1));
    const { expanded, base } = runFramePath(noSummary);
    expect(base.satellites ?? [], '无摘要基座不应有卫星').toHaveLength(0);
    expect(expanded.satellites ?? [], '无摘要展开不应有卫星').toHaveLength(0);
    const again = runFramePath(noSummary).expanded;
    expect(fingerprint(again), '同输入必须同输出').toBe(fingerprint(expanded));
  });

  it('⑥ 无框文档：走旧路径且不引入任何卫星扰动', () => {
    const text = '# 文档根\n## 父\n- 成员一\n- 成员二\n- 成员三';
    const withSummary = addSummaryTo(build(text), '父', ['成员一', '成员二', '成员三'], 'S-free');
    const { expanded, base, frameRootCount } = runFramePath(withSummary);
    expect(frameRootCount, '本文档无框').toBe(0);
    // 无框 → 展开函数整体引用复用（零行为变更）：基座即展开结果
    expect(expanded).toBe(base);
    expect((expanded.satellites ?? []).map((s) => s.node.id)).toEqual(['S-free']);
  });

  it('⑦ 框内摘要与框外摘要共存：只传播框外的，框内的留流行内可见', () => {
    // 框内摘要（S-in）与框外摘要（S-out）同文档：展开后
    //  - S-in 必须在 nodes 内（普通流行内可见），且不得被「复活」成卫星；
    //  - S-out 的卫星保留（它就是框路径如今唯一会产出的卫星）。
    const base = build(`# 文档根
## 框根
- 父行
- 成员i1
- 成员i2
- 成员i3
## 中心
- 成员一
- 成员二
- 成员三`);
    const parentRow = req(findByText(base, '父行'), '父行');
    const outerParent = req(findByText(base, '中心'), '中心');
    const innerMembers = ['成员i1', '成员i2', '成员i3'].map((t) => req(findByText(base, t), t));
    const outerMembers = ['成员一', '成员二', '成员三'].map((t) => req(findByText(base, t), t));
    let restructured = base;
    for (const mem of [...innerMembers, ...outerMembers]) {
      restructured = removeChild(restructured, mem.id);
    }
    for (const mem of [...innerMembers].reverse()) {
      restructured = insertChild(restructured, parentRow.id, mem, 0);
    }
    for (const mem of [...outerMembers].reverse()) {
      restructured = insertChild(restructured, outerParent.id, mem, 0);
    }
    // 先补全部 cid（框内/框外成员各一组），再按已定 cid 写两条 summary_of
    const allMembers = [...innerMembers, ...outerMembers].map((mem) =>
      req(findById(restructured, mem.id), mem.text ?? mem.id),
    );
    let seeded = ensureCids(
      restructured,
      allMembers.map((n) => n.id),
    );
    const summaryOf = (ids: readonly string[], summaryId: string): EditableNode => ({
      id: summaryId,
      type: 'text',
      text: summaryId,
      note: {
        summary_of: {
          from: `cid:${cidOf(seeded, ids[0] ?? '')}`,
          to: `cid:${cidOf(seeded, ids[ids.length - 1] ?? '')}`,
        },
      },
      children: [{ id: `${summaryId}-child`, type: 'text', text: `${summaryId}子`, children: [] }],
    });
    const innerSummary = summaryOf(
      innerMembers.map((n) => n.id),
      'S-in',
    );
    const rowNow = req(findById(seeded, parentRow.id), '父行(patched)');
    seeded = insertChild(seeded, rowNow.id, innerSummary, rowNow.children.length);
    const outerSummary = summaryOf(
      outerMembers.map((n) => n.id),
      'S-out',
    );
    const centerNow = req(findById(seeded, outerParent.id), '中心(patched)');
    seeded = insertChild(seeded, centerNow.id, outerSummary, centerNow.children.length);

    const frameRoot = req(findByText(seeded, '框根'), '框根');
    const root = mapNode(seeded, frameRoot.id, (n) => framed(n, 1));

    const { expanded } = runFramePath(root);
    expect(
      expanded.nodes.some((n) => n.node.id === 'S-in'),
      '框内摘要必须留流行内可见（降级不消失）',
    ).toBe(true);
    // 框内摘要不得被复活成卫星：展开结果的 satellites 只应含框外那一个
    expect(
      (expanded.satellites ?? []).map((s) => s.node.id),
      '只有框外摘要产出卫星',
    ).toEqual(['S-out']);
    // 框内摘要子是普通树边（框岛行重建），不是卫星内部链接
    expect(expanded.links.map((l) => `${l.fromId}->${l.toId}`)).toContain('S-in->S-in-child');
  });

  it('⑧ 卫星传播是**同一批对象引用**（框外卫星几何不被岛展开改写）', () => {
    const { root, summaryId } = frameWithOutsideSummary();
    const { base, expanded } = runFramePath(root);
    const baseSat = req((base.satellites ?? [])[0], 'base satellite');
    const outSat = req((expanded.satellites ?? [])[0], 'expanded satellite');
    expect(outSat.node.id).toBe(summaryId);
    // 同一引用：卫星不在 ctx.dropped 内，岛展开未触碰其几何（盒/缓存条目均复用）
    expect(outSat, '传播必须是同一引用，不得重新构造').toBe(baseSat);
    expect(expanded.nodes.includes(baseSat), 'satellites 项应与 nodes 同引用').toBe(true);
  });

  it('⑨ 嵌套框 + 缓存开/关：卫星传播逐位一致且可重复', () => {
    let root = build(`# 文档根
## 外框
- 行一
- 内框
- 行三
## 中心
- 成员一
- 成员二
- 成员三`);
    const inner = req(findByText(root, '内框'), '内框');
    root = mapNode(root, inner.id, (n) => framed(n, 1));
    const outer = req(findByText(root, '外框'), '外框');
    root = mapNode(root, outer.id, (n) => framed(n, 1));
    root = addSummaryTo(root, '中心', ['成员一', '成员二', '成员三'], 'S-nested');

    const run = (withCache: boolean): LayoutResult => {
      const frameRoots = collectFrameRoots(root);
      const pruned = framePrunedCollapsed(new Set<string>(), frameRoots);
      const cache = withCache ? new LayoutCache() : undefined;
      const opts = cache === undefined ? {} : { cache, measureKey: 'probe' };
      const b = layoutMindmap(root, lm(), pruned, { satellite: satelliteHook, ...opts });
      return expandFrameIslands(b, root, lm(), new Set(), opts);
    };
    const satIds = (res: LayoutResult): string[] => (res.satellites ?? []).map((s) => s.node.id);
    expect(satIds(run(true)), '缓存开启：卫星必须传播').toEqual(['S-nested']);
    expect(fingerprint(run(false))).toBe(fingerprint(run(false)));
    expect(fingerprint(run(true))).toBe(fingerprint(run(false)));
    expect(fingerprint(run(true)), '缓存开启不应改变传播后的几何').toBe(fingerprint(run(true)));
  });
});
