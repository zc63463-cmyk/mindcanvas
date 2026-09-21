/**
 * IO-1 · 岛级远观总览（语义缩放）纯函数层。
 *
 * 触发：`k < K_OVERVIEW` 且**有中心岛** → 一岛一卡：标题（Section.title 优先，否则中心文本）
 * + 成员/嵌套角标 + 色条。成员 NodeG 与岛内树边由 MapView 隐藏，岛间 boundaryLinks /
 * 自由边保留（设计 §3 D1–D11，`docs/specs/2026-09-17-island-overview-design.md`）。
 *
 * 纪律（本模块只做纯投影，绝不越界）：
 * - 零 React / 零 DOM（node 环境可测，与 sectionFrames 同风格）；
 * - **不写** `collapsedIds`、不改 `.mm.md` 协议、不碰 layoutForest / projectIslands；
 * - 阈值 `K_OVERVIEW` 独立于 `lodFor` 阈值表（总览档可与 skeleton 档并存，互不改写）；
 * - 子孙岛不出独立卡（D6 / IO-2 N2）：凡登记在任一祖先 nested 表的中心一律跳过顶层集合；
 *   其成员已并入祖先卡的 bounds（nest-contain 并集）与计数，出顶层卡会「一岛两卡」。
 *
 * IO-2（设计 §9）：顶层卡可带 `nestedCards` —— **一级**迷你子卡（直接子孙，父卡内框）。
 * 迷你复用同结构但 `nestedCards` 恒不填（N1：更深只显示 ⊞，不递归）；迷你 bounds 经
 * `clampBoundsInside` 钳在父卡内（N3：屏稳最小尺寸撑破父卡时允许缩身，禁止画到父卡外）。
 */
import type { Box } from '@mindcanvas/kernel';
import { containedMemberIds } from './islandNesting.js';
import { SECTION_PADDING, SECTION_TITLE_H } from './sectionFrames.js';

/** 总览触发阈值（与 note「badge 以下」同带：`NOTE_LOD_BADGE_K`；独立常量，不改 lodFor） */
export const K_OVERVIEW = 0.35;

/** 卡上侧外扩（标题栏 + 小间距）——与 Section 帧同一公式（buildSectionViews 的上侧外扩） */
export const OVERVIEW_TOP_PAD = SECTION_TITLE_H + 6;

/**
 * 「有岛」唯一口径（D2）：**中心集合非空**才算岛文档。
 *
 * 为什么不用岛表（membersByRoot）存在性：产品壳在无中心文档上会恒传「空岛表 + 空
 * centerIds」（buildIslandView 无中心早退），空 Map 是 truthy —— 只判存在性会把
 * 无中心文档误送进总览档。
 */
export function hasOverviewIslands(centerIds: ReadonlySet<string> | undefined | null): boolean {
  return (centerIds?.size ?? 0) > 0;
}

/**
 * 总览档判定：`k < K_OVERVIEW` 且有岛。
 *
 * 脏 k（NaN / ≤0：初始化瞬间）→ 不进入总览，退化为既有节点/Section 渲染——
 * 不让一帧脏值闪出总览层（与 noteLodFor 的脏值容忍同款纪律）。
 */
export function overviewActive(k: number, hasIslands: boolean): boolean {
  if (!hasIslands) return false;
  if (!Number.isFinite(k) || k <= 0) return false;
  return k < K_OVERVIEW;
}

/**
 * 屏稳世界尺寸：屏幕目标 px ÷ k（Section ghost chip 的 1/k 技巧同源）——
 * 总览档 `k ∈ [ZOOM_MIN, K_OVERVIEW)` 全程字号/卡身屏幕恒定。
 * k 脏值（NaN / ≤0）按 1 兜底；结果按 [minWorld, maxWorld] 钳制（世界值口径）。
 */
export function screenStableSize(px: number, k: number, minWorld = 0, maxWorld = Infinity): number {
  const kk = Number.isFinite(k) && k > 0 ? k : 1;
  return clamp(px / kk, minWorld, maxWorld);
}

/**
 * 远观文本宽估算（IO-UX2：标题截断阈值用，**非排版真相**）：
 * CJK / 全角 = 1em，拉丁 / 数字 / 空格 ≈ 0.56em。
 * 与 BadgePill 的 0.62 粗估同族——那边「宁宽勿窄」装下文本；这里是截断阈值，允许略紧：
 * 估宽偏差只会多露/少露约半个字符宽，硬兜底仍由图层 clipPath 承担（不破版）。
 */
export function estimateTextWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) {
    w += isFullWidth(ch) ? fontSize : fontSize * 0.56;
  }
  return w;
}

/**
 * 标题截断（IO-UX2）：可容纳 → **原文**（绝不追加省略号）；超宽 → 贪心累计到
 * 「再加一个字符 + …」即超宽为止，以「…」收尾；一个字符也放不下 → 单个「…」；
 * `maxWidth ≤ 0`（退化窄盒）→ 空串（不画半个字，也不硬塞省略号）。
 * 只决定**可见文本**；clipPath 仍是估算误差的硬兜底（两层不互斥）。
 */
export function truncateWithEllipsis(title: string, maxWidth: number, fontSize: number): string {
  if (maxWidth <= 0) return '';
  if (estimateTextWidth(title, fontSize) <= maxWidth) return title;
  const ellipsis = '…';
  const ellipsisW = estimateTextWidth(ellipsis, fontSize);
  let w = 0;
  let out = '';
  for (const ch of title) {
    const cw = estimateTextWidth(ch, fontSize);
    if (w + cw + ellipsisW > maxWidth) break;
    w += cw;
    out += ch;
  }
  return out === '' ? ellipsis : `${out}${ellipsis}`;
}

/** 全宽码位（CJK 部首/统一表意、CJK 标点、全角形、兼容表意） */
function isFullWidth(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0xff00 && code <= 0xffef) ||
    (code >= 0xf900 && code <= 0xfaff)
  );
}

/** 总览卡视图模型（渲染层只读消费；bounds 与 Section 帧同口径） */
export interface IslandOverviewCard {
  /** 岛根（= 中心 id / 投影岛根）：选中、拖拽、聚焦的挂点 */
  rootId: string;
  /** Section.title 优先；无 Section → 中心节点文本（titleOf 回退） */
  title: string;
  /** Section 色板键（如 'blue'）；无 Section → 缺省（渲染层回落中性色） */
  color?: string;
  /** 本卡覆盖的成员总数（本岛 ∪ 包容子孙岛，去重） */
  memberCount: number;
  /** 被本卡包容的子孙升格中心数（D6：只出角标，不出子卡） */
  nestedCount: number;
  /** 世界坐标：成员盒并集 + Section 同款外扩（上侧额外含标题栏） */
  bounds: Box;
  /**
   * IO-2：**一级**迷你子卡（直接子孙升格中心；父卡内框，N1）。
   * 仅顶层卡携带；迷你自身的该字段恒不填（更深嵌套只出 `nestedCount` 的 ⊞）。
   */
  nestedCards?: readonly IslandOverviewCard[];
}

export interface BuildIslandOverviewCardsInput {
  /** 语义中心集合（hasOverviewIslands 的同一来源） */
  centerIds: ReadonlySet<string>;
  /** 岛表：岛根 → 成员 id（含岛根自身；buildIslandView.membersByRoot） */
  membersByRoot: ReadonlyMap<string, readonly string[]>;
  /** 嵌套升格：祖先中心 → 非切断子孙中心（缺省 → 子孙不并入、各自出卡） */
  nestedCenterIdsByRoot?: ReadonlyMap<string, readonly string[]>;
  /** rootId → Section 标题/色；无则缺省（走 titleOf 与中性色） */
  sectionByRootId?: ReadonlyMap<string, { title: string; color?: string }>;
  /** 中心文本（无 Section 时的标题回退） */
  titleOf: (id: string) => string;
  /** 取盒（应注入预览/动画感知的盒函数——卡随中心拖拽实时跟随） */
  boxOf: (id: string) => Box | undefined;
  /** 外扩覆盖（缺省 SECTION_PADDING，与 Section 帧一致） */
  padding?: number;
}

/**
 * 卡成员解算（建卡与「隐藏成员集」共用同一实现——藏起来的正好是卡覆盖的，无空洞）。
 *
 * - 有 nested 表 → `containedMemberIds`（本岛 ∪ 各包容子孙岛成员，去重、本岛在前）；
 * - 无嵌套信息且岛表无该 root（退化调用）→ `[rootId]`：至少罩住中心本体，
 *   不产生「成员被藏、却无卡代理」的空洞。
 */
export function islandOverviewMemberIdsOf(
  rootId: string,
  membersByRoot: ReadonlyMap<string, readonly string[]>,
  nestedCenterIdsByRoot?: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
  const contained =
    nestedCenterIdsByRoot !== undefined
      ? containedMemberIds(rootId, membersByRoot, nestedCenterIdsByRoot)
      : (membersByRoot.get(rootId) ?? []);
  return contained.length > 0 ? contained : [rootId];
}

/**
 * 成员盒并集 + 外扩（公式与 buildSectionViews 逐值一致 → 卡与 Section 框同形，
 * 外扩常量同源不产生魔法数分叉）；全部成员无盒（折叠隐藏/未布局）→ undefined（不产卡）。
 */
export function overviewBoundsOf(
  memberIds: readonly string[],
  boxOf: (id: string) => Box | undefined,
  padding = SECTION_PADDING,
): Box | undefined {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = 0;
  for (const id of memberIds) {
    const b = boxOf(id);
    if (!b) continue;
    found++;
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.w > maxX) maxX = b.x + b.w;
    if (b.y + b.h > maxY) maxY = b.y + b.h;
  }
  if (found === 0) return undefined;
  return {
    x: minX - padding,
    y: minY - OVERVIEW_TOP_PAD,
    w: maxX - minX + padding * 2,
    h: maxY - minY + OVERVIEW_TOP_PAD + padding,
  };
}

/**
 * 把 box 钳进 region（四周内缩 `inset`）——IO-2 N3：
 * 越界先**缩身**（宽/高各自封顶到可用区；屏稳最小尺寸撑破父卡时允许略缩），再平移贴边；
 * 结果恒落在 `region` 内（`inset = 0` 时贴到 region 边界）。退化区（内缩后宽/高 ≤0）→ 0 尺寸。
 */
export function clampBoundsInside(region: Box, box: Box, inset = 0): Box {
  const innerX = region.x + inset;
  const innerY = region.y + inset;
  const innerW = Math.max(0, region.w - inset * 2);
  const innerH = Math.max(0, region.h - inset * 2);
  const w = innerW > 0 ? Math.min(box.w, innerW) : 0;
  const h = innerH > 0 ? Math.min(box.h, innerH) : 0;
  return {
    x: clamp(box.x, innerX, Math.max(innerX, innerX + innerW - w)),
    y: clamp(box.y, innerY, Math.max(innerY, innerY + innerH - h)),
    w,
    h,
  };
}

/**
 * IO-2：某顶层卡的**一级**迷你子卡（直接子孙；N1 不递归）。
 * - 成员 = `islandOverviewMemberIdsOf(child)`（含更深嵌套成员的 nest-contain 并集，
 *   与 N3「自身成员并集」一致）；无盒者跳过（`nestedCards.length ≤ nestedCount` 的唯一来源）；
 * - 标题/色/计数与顶层同规则；`nestedCards` 恒不填。
 */
function buildNestedMiniCards(
  parentId: string,
  input: BuildIslandOverviewCardsInput,
): readonly IslandOverviewCard[] {
  const childIds = input.nestedCenterIdsByRoot?.get(parentId) ?? [];
  const out: IslandOverviewCard[] = [];
  for (const childId of childIds) {
    const section = input.sectionByRootId?.get(childId);
    const memberIds = islandOverviewMemberIdsOf(
      childId,
      input.membersByRoot,
      input.nestedCenterIdsByRoot,
    );
    const bounds = overviewBoundsOf(memberIds, input.boxOf, input.padding);
    if (bounds === undefined) continue;
    const title =
      section !== undefined && section.title !== '' ? section.title : input.titleOf(childId);
    out.push({
      rootId: childId,
      title,
      ...(section?.color !== undefined ? { color: section.color } : {}),
      memberCount: memberIds.length,
      nestedCount: input.nestedCenterIdsByRoot?.get(childId)?.length ?? 0,
      bounds,
    });
  }
  return out;
}

/**
 * 建卡（唯一入口；顺序稳定：centerIds 先序，再补岛表中未登记的中心——同序可测）。
 *
 * 卡集合 = `centerIds ∪ membersByRoot.keys()`，再减去所有嵌套子孙中心：
 * - 并集理由：centerIds 是语义中心、岛表是渲染事实（含虚拟根岛）；并集防「岛表里有岛却
 *   没有卡 → 成员被隐藏且无代理」；
 * - 减法理由：D6 —— 子孙岛只出祖先卡上的嵌套角标。
 */
export function buildIslandOverviewCards(
  input: BuildIslandOverviewCardsInput,
): readonly IslandOverviewCard[] {
  const nestedIds = new Set<string>();
  if (input.nestedCenterIdsByRoot !== undefined) {
    for (const list of input.nestedCenterIdsByRoot.values()) {
      for (const id of list) nestedIds.add(id);
    }
  }
  const roots: string[] = [];
  const seen = new Set<string>();
  const pushRoot = (id: string): void => {
    if (seen.has(id) || nestedIds.has(id)) return;
    seen.add(id);
    roots.push(id);
  };
  for (const id of input.centerIds) pushRoot(id);
  for (const id of input.membersByRoot.keys()) pushRoot(id);

  const out: IslandOverviewCard[] = [];
  for (const rootId of roots) {
    const section = input.sectionByRootId?.get(rootId);
    const memberIds = islandOverviewMemberIdsOf(
      rootId,
      input.membersByRoot,
      input.nestedCenterIdsByRoot,
    );
    const bounds = overviewBoundsOf(memberIds, input.boxOf, input.padding);
    if (bounds === undefined) continue;
    const title =
      section !== undefined && section.title !== '' ? section.title : input.titleOf(rootId);
    // IO-2：直接子孙 → 父卡内的一级迷你卡（N1；更深不再递归）
    const nestedCards = buildNestedMiniCards(rootId, input);
    out.push({
      rootId,
      title,
      ...(section?.color !== undefined ? { color: section.color } : {}),
      memberCount: memberIds.length,
      nestedCount: input.nestedCenterIdsByRoot?.get(rootId)?.length ?? 0,
      bounds,
      ...(nestedCards.length > 0 ? { nestedCards } : {}),
    });
  }
  return out;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
