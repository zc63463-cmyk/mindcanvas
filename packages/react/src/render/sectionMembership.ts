/**
 * FE-FRAME-1.1 · Section 成员清单（成员公式唯一出口，与取盒/建帧解耦的纯函数层）。
 *
 * 为什么分层：帧 bounds 必须跟 animBoxes / centerPreview 逐帧重算，而成员清单只跟
 * 文档树与岛表走。两者混在一个 memo 里 → 动画期每帧 walk(contentRoot) + 重算成员公式。
 * MapView 据此拆两级 memo：本模块（A 层：成员/标题/贴框索引）不带盒依赖；帧视图
 * （B 层：buildSectionViews + boundsIndex）只消费 A 的产物（设计见
 * docs/dispatch/2026-09-17-free-edge-frame-1.1-dispatch-prompt.md）。
 *
 * 纪律：
 * - 成员公式是**唯一出口**：画框（buildSectionViews 注入的 memberIdsOf）与贴框索引
 *   （memberIndex）由同一函数、同一结果产出 —— 杜绝「索引与框体漂移」（FE-FRAME-1 约束）；
 * - memberIndex 登记全部 well-formed section（与盒无关）；**成框与否由 boundsIndex 门控**
 *   （FE-FRAME-1 F4：无框 = 隐形，不提升）；
 * - 纯函数、零 React / 零 DOM（node 环境可测，与 sectionFrames / islandOverview 同风格）。
 */
import { resolveSections } from '@mindcanvas/kernel';
import type { EditableNode, ResolvedSection } from '@mindcanvas/kernel';
import { buildSectionMemberIndex, type SectionMemberIndex } from './freeEdgeFrameAnchor.js';
import { containedMemberIds } from './islandNesting.js';

/** NEST-CONTAIN-1：空岛表单例（「有岛」只看键存在性，避免空 Map 误走包容并集分支） */
const EMPTY_MEMBER_MAP: ReadonlyMap<string, readonly string[]> = new Map();

export interface SectionMembershipInput {
  /** 完整文档树根（controller.root）；缺省 / 无 sections → 空清单 */
  rootNode: EditableNode | undefined;
  /** 岛表（岛根 → 成员 id；含岛根自身）；缺省 → 内容树子树兜底 */
  islandMembers: ReadonlyMap<string, readonly string[]> | undefined;
  /** 嵌套升格（祖先中心 → 子孙中心）；缺省 → 不走包容并集 */
  nestedCenterIdsByRoot: ReadonlyMap<string, readonly string[]> | undefined;
}

/** A 层产物：随成员/岛表变化换代；不做盒依赖 → 动画期引用稳定 */
export interface SectionMembership {
  resolved: readonly ResolvedSection[];
  titleOf: (rootId: string) => string;
  memberIdsOf: (rootId: string) => readonly string[];
  /** 与画框 memberIdsOf 同源的贴框索引（未成框 section 由调用方的 bounds 索引门控） */
  memberIndex: SectionMemberIndex;
}

/** 空清单单例：无 sections 文档零分配、引用稳定（B 层据此早退） */
const EMPTY_MEMBERSHIP: SectionMembership = {
  resolved: [],
  titleOf: (id) => id,
  memberIdsOf: (id) => [id],
  memberIndex: new Map(),
};

export function buildSectionMembership(input: SectionMembershipInput): SectionMembership {
  const { rootNode, islandMembers, nestedCenterIdsByRoot } = input;
  if (rootNode === undefined || !rootNode.note?.sections) return EMPTY_MEMBERSHIP;
  const resolved = resolveSections(rootNode);
  if (resolved.length === 0) return EMPTY_MEMBERSHIP;

  // 内容树索引：子树成员与标题（岛成员缺失时兜底；含折叠隐藏的成员——AABB 只取有盒者，
  // memberCount 仍计全量子树，折叠徽标 +N 由此而来）
  const subtreeCache = new Map<string, string[]>();
  const titleCache = new Map<string, string>();
  const walk = (n: EditableNode): string[] => {
    const ids: string[] = [n.id];
    if (n.type === 'text' && n.text) titleCache.set(n.id, n.text);
    else if (n.type === 'entity' && n.ref) titleCache.set(n.id, `@${n.ref.kind}:${n.ref.id}`);
    for (const c of n.children) ids.push(...walk(c));
    subtreeCache.set(n.id, ids);
    return ids;
  };
  walk(rootNode);

  // FE-FRAME-1：成员清单缓存 —— 画框（buildSectionViews）与贴框索引共用同一公式、同一结果
  // （索引成员集必须与画框 memberIdsOf 逐项同源，否则会出现「贴到看不见的框」）。
  const memberCache = new Map<string, readonly string[]>();
  const memberIdsOf = (id: string): readonly string[] => {
    const cached = memberCache.get(id);
    if (cached !== undefined) return cached;
    // NEST-CONTAIN-1：仅当该 id **登记在岛表或嵌套表中**才走包容并集。无中心文档的
    // 产品壳会恒传「空 Map」（buildIslandView 无中心早退）——空 Map 是 truthy，
    // 若只判存在性，containedMemberIds 会返回空清单 → Section 框被整体吞掉；
    // 此时必须回退内容树子树（既有兜底语义）。
    const ids =
      islandMembers?.has(id) === true || nestedCenterIdsByRoot?.has(id) === true
        ? containedMemberIds(
            id,
            islandMembers ?? EMPTY_MEMBER_MAP,
            nestedCenterIdsByRoot ?? EMPTY_MEMBER_MAP,
          )
        : (islandMembers?.get(id) ?? subtreeCache.get(id) ?? [id]);
    memberCache.set(id, ids);
    return ids;
  };

  // 贴框索引：只登记 well-formed（有 rootId）的 section，成员取同一 memberIdsOf 结果；
  // ghost（dangling/stale）无成员语义、不登记（与画框的 ghost 分支一致）。
  const frames: { id: string; memberIds: readonly string[] }[] = [];
  for (const r of resolved) {
    if (r.state !== 'well-formed' || r.rootId === undefined) continue;
    frames.push({ id: r.spec.id, memberIds: memberIdsOf(r.rootId) });
  }

  return {
    resolved,
    titleOf: (id) => titleCache.get(id) ?? id,
    memberIdsOf,
    memberIndex: buildSectionMemberIndex(frames),
  };
}
