/**
 * S3 · 嵌套摘要（`nestedSkip` 分支）回归覆盖。
 *
 * ## 覆盖面缺口（本文件存在的理由）
 *
 * `satellite.ts` 的 `nestedSkip` 分支（`:126-130`，判据 `r.memberIds.some(id => allSummaryIds.has(id))`）
 * 在本次提交前**零测试覆盖**：`git grep nestedSkip` 全仓命中只在 `satellite.ts` 自身
 * （源码 8 处，测试 0 处）。本文件是该分支的第一份正式回归覆盖。
 *
 * ## 语义（与 `satellite.ts` 头注释 §嵌套摘要 一致）
 *
 * `resolveSummaries` 按结构解析，**不排除**成员区间里含另一个摘要节点；本批
 * **明确不实现嵌套摘要 UI**（不画嵌套括线、不做嵌套折叠），但也**不允许节点消失
 * 或产生无效几何**。处置 = 该外层摘要**不摘除**，留在普通流内可见，并在
 * `nestedSkip` 里记录原因。
 *
 * ## 为什么夹具必须「受限排布」（本文件最容易被写成假覆盖的一点）
 *
 * 复核已指出：能让外层摘要的成员区间**真的**包含内层摘要节点的排布是受限的。
 * 直觉写法（外层摘要挂在内层成员之后）会被 `resolveOne` 的
 * `summary-in-range` 判据（`summary-anchor.ts:132`）打回 `dangling`——
 * 因为外层摘要自身落在了自己声明的区间内（`[成员A, 外层摘要, 内层摘要, 成员B]`）。
 * 本文件用两个探针用例把这个边界钉死在测试里（见「夹具可达性」describe）：
 *
 * - 探针 A（**反例**）：外层摘要排在内层摘要**之前** → 外层 `dangling/summary-in-range`，
 *   `nestedSkip` 为空集。若有人「整理」夹具时把两者顺序换错，探针 A 会立刻指出
 *   它不是嵌套场景。
 * - 探针 B（**正例**）：外层摘要在声明区间**之外**（排在终点成员之后），区间
 *   `[成员A, 内层摘要, 成员B]` 天然含内层摘要节点 → 外层 `well-formed` 且
 *   命中 `nestedSkip`。正式用例全部基于探针 B 的同构排布。
 *
 * ## 术语
 *
 * - **外层摘要 S_out**：成员区间含另一个摘要节点的摘要（本批不摘除）。
 * - **内层摘要 S_in**：被 S_out 的成员区间包住的那个摘要节点（可能自己被摘除，
 *   这并不违反「不得让节点消失」——它改以卫星形态出现，仍可达、仍被布局产出）。
 */
import { describe, expect, it } from 'vitest';
import { buildSatellitePlan } from '../src/layout/satellite.js';
import { LayoutCache } from '../src/layout/mindmap.js';
import { layoutMindmap } from '../src/layout/mindmap.js';
import { resolveSummaries } from '../src/registry/summary-anchor.js';
import { satelliteHook } from '../src/layout/satellite.js';
import type { EditableNode } from '../src/tree/treeOps.js';

const m = (): { w: number; h: number } => ({ w: 100, h: 30 });

/** 手工造节点（与 `summary-anchor.test.ts` 同款；cid 是锚的唯一依据）。 */
function text(
  id: string,
  t: string,
  children: EditableNode[] = [],
  note?: EditableNode['note'],
): EditableNode {
  return { id, type: 'text', text: t, ...(note ? { note } : {}), children };
}

/**
 * 正例夹具（探针 B 同构）——**唯一**被正式用例使用的嵌套排布：
 *
 * ```
 * 总览(root) ├─ 成员A(m1, cid:ca)
 *            ├─ 内层摘要(s2, cid:cs2)  summary_of: cb … cb   → memberIds [m2]（well-formed）
 *            ├─ 成员B(m2, cid:cb)
 *            └─ 外层摘要(s1, cid:cs1)  summary_of: ca … cb   → memberIds [m1, s2, m2]（well-formed）
 * ```
 *
 * 外层摘要在自己声明的区间**之后**，故不触发 `summary-in-range`；区间跨越内层摘要
 * → 命中 `nestedSkip`。返回的两个摘要 id 供断言直接引用，避免字符串散落。
 */
function nestedFixture(): { root: EditableNode; outerId: string; innerId: string } {
  const root = text('root', '总览', [
    text('m1', '成员A', [], { cid: 'ca' }),
    text('s2', '内层摘要', [], { cid: 'cs2', summary_of: { from: 'cid:cb', to: 'cid:cb' } }),
    text('m2', '成员B', [], { cid: 'cb' }),
    text('s1', '外层摘要', [], { cid: 'cs1', summary_of: { from: 'cid:ca', to: 'cid:cb' } }),
  ]);
  return { root, outerId: 's1', innerId: 's2' };
}

/**
 * layoutMindmap 在「非折叠」下的节点 id 集。
 * `LayoutResult.nodes` 是前序压平表（含卫星）；折叠集恒为空 → 全树可见。
 */
function laidOutIds(root: EditableNode): { ids: Set<string>; satIds: Set<string> } {
  const res = layoutMindmap(root, m, new Set(), { satellite: satelliteHook });
  return {
    ids: new Set(res.nodes.map((n) => n.node.id)),
    satIds: new Set((res.satellites ?? []).map((s) => s.node.id)),
  };
}

/** 数值有限性判据（无效几何 = NaN / ±Infinity；min>max 的空区间也算无效）。 */
function expectFiniteBox(box: { x: number; y: number; w: number; h: number }, what: string): void {
  for (const k of ['x', 'y', 'w', 'h'] as const) {
    expect(Number.isFinite(box[k]), `${what}.box.${k} 必须有限（实为 ${box[k]}）`).toBe(true);
  }
  expect(box.w, `${what}.box.w 应为正`).toBeGreaterThan(0);
  expect(box.h, `${what}.box.h 应为正`).toBeGreaterThan(0);
}

// ============================================================================
// 夹具可达性：先证明「什么排布才真的命中 nestedSkip」，并把假覆盖形态钉死
// ============================================================================

describe('S3 · nestedSkip 夹具可达性（防止写成永远不命中的假覆盖）', () => {
  it('反例：外层摘要排在内层摘要之前 → 命中 summary-in-range 降级，nestedSkip 为空', () => {
    // 与正例只差外层/内层摘要的**兄弟顺序**。此排布下外层摘要落在自己声明的
    // 区间 [ca … cs2] 之内 → summary-anchor.ts:132 判 dangling。
    const root = text('root', '总览', [
      text('m1', '成员A', [], { cid: 'ca' }),
      text('s1', '外层摘要', [], { cid: 'cs1', summary_of: { from: 'cid:ca', to: 'cid:cs2' } }),
      text('s2', '内层摘要', [], { cid: 'cs2', summary_of: { from: 'cid:cb', to: 'cid:cb' } }),
      text('m2', '成员B', [], { cid: 'cb' }),
    ]);
    const rs = resolveSummaries(root);
    const outer = rs.find((r) => r.summaryNodeId === 's1');
    expect(outer, '外层摘要应有解析条目').toBeDefined();
    expect(outer?.state, '此排布下外层摘要不是 well-formed（故不是嵌套场景）').toBe('dangling');
    expect(outer?.reason, '降级原因应为 summary-in-range').toBe('summary-in-range');
    // nestedSkip 只收 well-formed 条目：本排布下它必然为空集
    expect([...buildSatellitePlan(root).nestedSkip]).toEqual([]);
  });

  it('正例：外层摘要的成员区间真的含内层摘要节点 → nestedSkip 命中', () => {
    const { root, outerId, innerId } = nestedFixture();
    const rs = resolveSummaries(root);
    const outer = rs.find((r) => r.summaryNodeId === outerId);
    const inner = rs.find((r) => r.summaryNodeId === innerId);
    // ① 外层 well-formed 且区间确实含内层摘要 id（嵌套的唯一判据）
    expect(outer?.state, '外层摘要应 well-formed').toBe('well-formed');
    expect(outer?.memberIds, '外层成员区间应含内层摘要节点').toContain(innerId);
    expect(outer?.memberIds).toContain('m1');
    expect(outer?.memberIds).toContain('m2');
    // ② 内层自身也是 well-formed（嵌套不因外层而降级）
    expect(inner?.state, '内层摘要应独立 well-formed').toBe('well-formed');
    // ③ 规划层：外层进 nestedSkip，不在 skip；内层可摘除
    const plan = buildSatellitePlan(root);
    expect([...plan.nestedSkip], '外层摘要应命中 nestedSkip').toEqual([outerId]);
    expect(plan.skip.has(outerId), '外层摘要不得被摘除').toBe(false);
    expect(plan.skip.has(innerId), '内层摘要可摘除').toBe(true);
    expect(plan.specs.map((s) => s.summaryNodeId), '外层摘要不得产出卫星规格').toEqual([innerId]);
  });
});

// ============================================================================
// 正式覆盖：nestedSkip 的四条硬判据
// ============================================================================

describe('S3 · nestedSkip：嵌套外层摘要不摘除、不产卫星、两个节点都可见', () => {
  it('外层摘要不进入 skip / specs（不摘除、不产卫星几何）', () => {
    const { root, outerId, innerId } = nestedFixture();
    const plan = buildSatellitePlan(root);
    expect(plan.skip.has(outerId), '外层摘要必须留在流内（不得进 skip）').toBe(false);
    expect(
      plan.specs.some((s) => s.summaryNodeId === outerId),
      '外层摘要不得产出卫星规格',
    ).toBe(false);
    expect(plan.nestedSkip.has(outerId), '外层摘要应被记入 nestedSkip').toBe(true);
    // 内层不受牵连：仍按普通摘要摘除并产规格
    expect(plan.skip.has(innerId)).toBe(true);
    expect(plan.specs.map((s) => s.summaryNodeId)).toEqual([innerId]);
  });

  it('外层与内层节点都仍在普通流 / 布局输出中可见（不得让节点消失）', () => {
    const { root, outerId, innerId } = nestedFixture();
    const { ids, satIds } = laidOutIds(root);
    // 外层：既在 layoutMindmap 的 nodes 里，也不是卫星
    expect(ids.has(outerId), '外层摘要必须出现在 nodes 中（留流内可见）').toBe(true);
    expect(satIds.has(outerId), '外层摘要不得被转成卫星').toBe(false);
    // 内层：被摘除为卫星，但仍在 nodes 压平表内可见（可见性判据看 nodes）
    expect(ids.has(innerId), '内层摘要必须仍可见（卫星形态）').toBe(true);
    expect(satIds.has(innerId), '内层摘要应作为卫星出现').toBe(true);
    // 成员一个都不能丢
    for (const id of ['m1', 'm2']) {
      expect(ids.has(id), `成员 ${id} 必须可见`).toBe(true);
    }
  });

  it('不产生无效卫星几何：卫星盒有限且为正，且不含外层摘要', () => {
    const { root, outerId } = nestedFixture();
    const res = layoutMindmap(root, m, new Set(), { satellite: satelliteHook });
    const sats = res.satellites ?? [];
    expect(sats, '本夹具应恰好产出 1 颗卫星（内层摘要）').toHaveLength(1);
    for (const s of sats) {
      expect(s.node.id, '卫星只能是内层摘要').toBe('s2');
      expect(s.node.id, '外层摘要不得出现在卫星中').not.toBe(outerId);
      expectFiniteBox(s.box, `卫星 ${s.node.id}`);
    }
    // 全表盒都必须有限（无效几何最典型的形态是 NaN 传播到整表）
    for (const n of res.nodes) expectFiniteBox(n.box, `nodes[${n.node.id}]`);
    for (const k of ['minX', 'minY', 'maxX', 'maxY'] as const) {
      expect(Number.isFinite(res.bounds[k]), `bounds.${k} 必须有限`).toBe(true);
    }
    expect(res.bounds.minX, 'bounds 区间应有效').toBeLessThanOrEqual(res.bounds.maxX);
    expect(res.bounds.minY, 'bounds 区间应有效').toBeLessThanOrEqual(res.bounds.maxY);
  });

  it('摘除语义不因嵌套而改变：外层摘要占普通槽位，内层不占', () => {
    const { root, innerId } = nestedFixture();
    const res = layoutMindmap(root, m, new Set(), { satellite: satelliteHook });
    const parent = res.nodes.find((n) => n.node.id === 'root');
    expect(parent, '根节点应存在').toBeDefined();
    const flowChildIds = (parent?.children ?? []).map((c) => c.node.id);
    // 外层留在流内 → 是父的布局子节点；内层被摘除 → 不是
    expect(flowChildIds, '外层摘要应作为父的布局子节点留在流内').toContain('s1');
    expect(flowChildIds, '内层摘要应已被摘除（改走卫星）').not.toContain(innerId);
  });

  it('缓存开/关结果一致：nestedSkip 判定不依赖缓存', () => {
    const { root } = nestedFixture();
    const collapsed = new Set<string>();
    const cache = new LayoutCache();
    const warm = layoutMindmap(root, m, collapsed, {
      cache,
      measureKey: 'K',
      satellite: satelliteHook,
    });
    const cold = layoutMindmap(root, m, collapsed, { satellite: satelliteHook });
    const fp = (r: typeof warm): string =>
      JSON.stringify({
        n: r.nodes.map((n) => [n.node.id, n.box.x, n.box.y, n.box.w, n.box.h, n.side, n.depth]),
        l: r.links.map((l) => [l.fromId, l.toId, l.path]),
        s: (r.satellites ?? []).map((s) => [s.node.id, s.box.x, s.box.y]),
        b: r.bounds,
      });
    expect(fp(warm), '热缓存 vs 无缓存应逐位一致').toBe(fp(cold));
  });
});
