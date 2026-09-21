/**
 * FE-FRAME-1 · 跨框自由边端点贴盒（纯函数，零 React / 零 DOM）。
 *
 * 问题：跨岛自由边原锚定**叶子节点盒** —— 线从框外穿入「扎进」框内节点；远观总览档
 * 成员被藏，端点仍用原叶盒 → 线穿入卡内空洞（R1 观感）。本模块把「解析后的端点盒」
 * 按归属提升为框身 / 卡身（设计：docs/specs/2026-09-17-free-edge-frame-anchor-design.md）。
 *
 * 口径（F1–F5 已拍板，禁止再议）：
 * - F1 谁提升：端点有效 id（折叠上溯之后，即 `eps.fromId` / `eps.toId`）属于某 Section
 *   成员清单 → 该端取盒 = 该 Section 的 `frame.bounds`；
 * - F2 同框不提升：两端提升后同 sectionId（或同总览卡 rootId）→ 两端回退节点盒
 *   （避免框内边变成零长 / 贴边自环）；
 * - F3 多框重叠：取**面积最小**的成框 Section（嵌套最深的代理；非嵌套重叠同样收敛）；
 * - F4 无 Section 的中心岛：**不**提升「隐形岛 AABB」——只有帧/卡进了索引才可能提升；
 * - F5 总览优先：`overview` 时先查总览卡（迷你卡优先于父卡）→ 用卡 bounds；未命中卡的
 *   端才走 F1 的 Section 提升。
 *
 * 纪律（F8）：
 * - 只改写 `EdgeEndpoints.from / to` 两个盒；`fromId / toId / ghost / renderable` 原样
 *   通过 —— 边身份 / 命中 / 菜单不变；
 * - 未提升（或完全无命中）时返回**原对象引用** —— 路由缓存 key（含端点盒坐标）与
 *   React 下游的引用稳定性都依赖这一点；
 * - ghost 边（幽灵锚点）整体不提升：其 to 盒是「未锚定」的合成占位，提升会伪造可达性
 *   视觉（幽灵圆点会画到卡中心）；ghost 的 fromId 是有效 id 但此边本就少见，先保语义。
 *
 * 接线（MapView）：`freeEdgeEndpoints` 解析后、`routeAesthetic` 之前经
 * FreeEdgeLayer 的 `refineEndpoints` 钩子介入（解析后提升，不重建 edgeResolverOf）。
 */
import type { Box } from '@mindcanvas/kernel';
import type { EdgeEndpoints } from './freeEdges.js';

/** sectionId → 成员 id 集（与画 Section 框的 memberIdsOf 同源） */
export type SectionMemberIndex = ReadonlyMap<string, ReadonlySet<string>>;

/** sectionId → frame.bounds（须含 centerPreview 后的盒，与屏幕框一致） */
export type SectionBoundsIndex = ReadonlyMap<string, Box>;

/** 总览卡条目：顶层卡与展平后的一级迷你卡同构（迷你卡只出现在数组前部，见下） */
export interface OverviewCardEntry {
  rootId: string;
  bounds: Box;
  memberIds: ReadonlySet<string>;
}

/**
 * 总览卡索引（**扁平数组**）。
 *
 * 顺序约定 = 迷你优先的匹配顺序：构造方须「先注册全部迷你卡，再注册各自父卡」
 * （MapView 逐顶层卡处理：先 `nestedCards[]` 后父卡本体）。迷你卡的 member 集是父卡
 * 的**真子集**（nest-contain 并集的下属），故顺序匹配（find 首个命中）即「迷你优先于父卡」。
 */
export type OverviewCardIndex = readonly OverviewCardEntry[];

/** 由「帧条目（id + 成员清单）」构建 sectionId → 成员集索引 */
export function buildSectionMemberIndex(
  frames: readonly { id: string; memberIds: readonly string[] }[],
): SectionMemberIndex {
  const out = new Map<string, ReadonlySet<string>>();
  for (const f of frames) out.set(f.id, new Set(f.memberIds));
  return out;
}

/**
 * F3：含该 nodeId 的**成框** Section 中取 bounds 面积最小者（嵌套最深代理）。
 * 只认「成员集包含 + bounds 在索引中」的 section —— 成员全隐藏而未产出帧的 section
 * 不算成框（F4：无视觉框不改锚）。
 */
export function owningSectionId(
  nodeId: string,
  index: SectionMemberIndex,
  bounds: SectionBoundsIndex,
): string | undefined {
  let best: string | undefined;
  let bestArea = Infinity;
  for (const [sectionId, members] of index) {
    if (!members.has(nodeId)) continue;
    const b = bounds.get(sectionId);
    if (b === undefined) continue;
    const area = b.w * b.h;
    if (area < bestArea) {
      bestArea = area;
      best = sectionId;
    }
  }
  return best;
}

/** 总览卡归属（迷你优先；见 OverviewCardIndex 的顺序约定） */
export function owningOverviewCard(
  nodeId: string,
  cards: OverviewCardIndex,
): { rootId: string; bounds: Box } | undefined {
  for (const c of cards) {
    if (c.memberIds.has(nodeId)) return { rootId: c.rootId, bounds: c.bounds };
  }
  return undefined;
}

export interface RefineFreeEdgeEndpointsOpts {
  /** 总览档是否激活（F5 开关；false 时跳过卡提升） */
  overview: boolean;
  /** 总览卡索引（overview 时提供；迷你在前、父卡在后） */
  overviewCards?: OverviewCardIndex;
  sectionMembers: SectionMemberIndex;
  sectionBounds: SectionBoundsIndex;
}

/**
 * 解析后提升：改写 `eps.from / to` 为框身 / 卡身盒；无变化时返回原引用。
 * 调用方（FreeEdgeLayer）须在 `freeEdgeEndpoints` 之后、路由之前调用。
 */
export function refineFreeEdgeEndpoints(
  eps: EdgeEndpoints,
  opts: RefineFreeEdgeEndpointsOpts,
): EdgeEndpoints {
  // 不可渲染 / 幽灵锚点：原样（ghost 语义 = 未锚定占位，提升会伪造可达性）
  if (!eps.renderable || eps.ghost) return eps;
  const { overview, overviewCards, sectionMembers, sectionBounds } = opts;

  let from = eps.from;
  let to = eps.to;
  // 已被总览卡提升的端不再参与 Section 提升（F5：卡优先）
  let fromPinned = false;
  let toPinned = false;

  if (overview && overviewCards !== undefined && overviewCards.length > 0) {
    const cFrom = owningOverviewCard(eps.fromId, overviewCards);
    const cTo = owningOverviewCard(eps.toId, overviewCards);
    // F2：两端同卡 → 不提升（保持节点盒）
    if (cFrom !== undefined && cTo !== undefined && cFrom.rootId === cTo.rootId) return eps;
    if (cFrom !== undefined) {
      from = cFrom.bounds;
      fromPinned = true;
    }
    if (cTo !== undefined) {
      to = cTo.bounds;
      toPinned = true;
    }
  }

  const sFrom = fromPinned
    ? undefined
    : owningSectionId(eps.fromId, sectionMembers, sectionBounds);
  const sTo = toPinned ? undefined : owningSectionId(eps.toId, sectionMembers, sectionBounds);
  // F2：两端同 Section → 不提升（两端都保持节点盒）
  if (sFrom !== undefined && sFrom === sTo) return eps;
  if (sFrom !== undefined) from = sectionBounds.get(sFrom) ?? from;
  if (sTo !== undefined) to = sectionBounds.get(sTo) ?? to;

  if (from === eps.from && to === eps.to) return eps;
  return { ...eps, from, to };
}
