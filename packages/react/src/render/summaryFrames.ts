/**
 * 摘要括线 · 纯几何视图模型（S4）。
 *
 * ## 与 MapView 的边界
 *
 * 与 `sectionFrames.ts` 同一可测性风格：**零 React、零 DOM** —— 输入是布局产物与
 * 文档根，输出是可直接渲染的括线视图；node 环境可测。
 *
 * ## 消费面（本模块最硬的纪律）
 *
 * 只消费四样东西：
 *
 * 1. `layout.satellites`（S3 摘除产物）—— **唯一的「该不该画括线」判据**；
 * 2. `buildSatellitePlan(root).specs`（kernel 已导出）—— **成员区间**；
 * 3. `layout.nodes` 的盒（成员子树带 + 摘要盒）；
 * 4. kernel 导出的 `SUMMARY_BRACKET_GAP` / `SUMMARY_STEM_GAP`。
 *
 * **不得**重解析 raw `summary_of`、**不得**自行推断成员区间、**不得**直接调
 * `resolveSummaries`。第 2 条看似「绕过布局」，实为**同一事实源的第二次读取**：
 * `buildSatellitePlan` 内部就是布局用的那个 `resolveSummaries`（S-A3 单一事实源），
 * 由 kernel 公开导出，react 层只按 `summaryNodeId` 与 `satellites` 对齐。
 *
 * 为什么必须这样：`LayoutResult.satellites` 是 `LayoutNode[]`，**不携带 `memberIds`**
 * （见 `outputs/summary-node/S4/S4-20260921-160000/contract-finding.md` 的实测探针）。
 * 成员区间是括线的定义域，缺它就只能重解析锚或按几何反推 —— 前者违规、后者不可靠。
 *
 * ## 几何（右向；左向严格镜像）
 *
 * ```
 *                    ┆← 括线：竖段贴 band 外沿 + BRACKET_GAP
 *   ┌── 成员一 ──────┤
 *   ├── 成员二 ──────┤← 指线（band 外沿 → 括线）
 *   └── 成员三 ──────┤———→ [摘要节点]   stem：括线中点 → 摘要盒外缘
 * ```
 *
 * - 带（band）= 成员**子树**包围盒的并集（不是成员自身盒——成员可能带子主题）；
 * - 括线竖段 x = `band.maxX + SUMMARY_BRACKET_GAP`（左向 `band.minX − GAP`）；
 * - 括线竖段跨 `[band.minY, band.maxY]`，两端各伸出指线回到 band 外沿；
 * - stem 从括线中点水平连到摘要盒外缘；其水平长度**由布局决定**（= `SUMMARY_STEM_GAP`，
 *   因为卫星落位时就按该间距放置）——故此处不重复引用该常量，避免「两处定义」漂移。
 *
 * 带与 stem 口径与 kernel `satellite.ts` 的落位同源（两侧都用成员子树并集 +
 * 同一对间距常量），否则括线会比卫星节点头部略短，视觉上「没框住」。
 */
import {
  buildSatellitePlan,
  SUMMARY_BRACKET_GAP,
  type Box,
  type EditableNode,
  type LayoutNode,
} from '@mindcanvas/kernel';

/** 一条摘要的括线视图（渲染层与导出层的共同输入） */
export interface SummaryView {
  /** 摘要节点 id（= 卫星子树根 id） */
  summaryId: string;
  /** 成员与摘要所在侧（-1 左 / 1 右）；取自卫星节点，不重推 */
  side: -1 | 1;
  /** 成员 id 清单（同父连续区间，顺序 = 兄弟顺序） */
  memberIds: readonly string[];
  /** 括线 path（世界坐标；方括号：上指线 → 竖段 → 下指线） */
  bracketPath: string;
  /** stem 起点（括线中点，贴括线竖段） */
  stemX1: number;
  stemY1: number;
  /** stem 终点（摘要盒外缘） */
  stemX2: number;
  stemY2: number;
  /** 成员带（成员子树并集；供上层高亮与命中，与括线几何同源） */
  memberBand: Box;
  /** 摘要盒（卫星自身盒） */
  summaryBox: Box;
}

export interface BuildSummaryViewsArgs {
  /** 文档根（事实树）—— 供 `buildSatellitePlan` 取成员区间 */
  root: EditableNode | null | undefined;
  /**
   * 布局摘除产物（`layout.satellites`）。**空数组 / undefined 一律零 view** ——
   * 「不重解析 raw summary_of」的落地方式：没有摘除就没有括线
   * （dangling / stale / nestedSkip / 降级路径根本不在这个数组里）。
   */
  satellites: readonly LayoutNode[];
  /** 布局扁表（含卫星自身，S-A1）；成员盒与摘要盒都在此内查 */
  nodes: readonly LayoutNode[];
}

/**
 * 由布局产物 + 文档根构建括线视图（纯函数，输入零改写）。
 *
 * 跳过规则（缺一不可，每条都有判别测试）：
 * - 无 `root` / 无 satellites / 计划无 specs → 零 view；
 * - 卫星盒不在扁表内 → 跳过（无锚不画线）；
 * - 成员盒全缺 → 跳过（kernel 同款：`bandOfMembers` 无命中不产卫星）；
 * - 成员盒部分缺失 → 用命中者的并集（与 kernel 一致，不因一个成员折叠丢掉整条线）；
 * - 计划里找不到对应 spec → 跳过（不一致时不猜区间）。
 */
export function buildSummaryViews(args: BuildSummaryViewsArgs): SummaryView[] {
  if (args.satellites.length === 0 || args.root === null || args.root === undefined) return [];
  const plan = buildSatellitePlan(args.root);
  if (plan.specs.length === 0) return [];
  // spec 按 summaryNodeId 索引（与 satellites 同一 id 空间）
  const memberIdsOf = new Map<string, readonly string[]>();
  for (const spec of plan.specs) memberIdsOf.set(spec.summaryNodeId, spec.memberIds);

  const boxOf = new Map<string, LayoutNode>();
  for (const ln of args.nodes) boxOf.set(ln.node.id, ln);

  const out: SummaryView[] = [];
  for (const sat of args.satellites) {
    const summaryId = sat.node.id;
    const summaryBox = boxOf.get(summaryId)?.box;
    if (!summaryBox) continue; // 卫星盒缺失 → 无锚，不画
    const memberIds = memberIdsOf.get(summaryId);
    if (memberIds === undefined || memberIds.length === 0) continue; // 无成员区间 → 不猜
    const band = bandOfMembers(memberIds, boxOf);
    if (!band) continue; // 成员盒全缺 → 不画
    const side: -1 | 1 = sat.side === -1 ? -1 : 1;
    out.push(buildView(summaryId, side, memberIds, band, summaryBox));
  }
  return out;
}

/** 成员带 = 成员子树包围盒并集；无命中 → null（与 kernel `bandOfMembers` 同口径） */
function bandOfMembers(
  memberIds: readonly string[],
  boxOf: Map<string, LayoutNode>,
): Box | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hit = 0;
  for (const id of memberIds) {
    const ln = boxOf.get(id);
    if (!ln) continue;
    const b = subtreeBBox(ln);
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.w > maxX) maxX = b.x + b.w;
    if (b.y + b.h > maxY) maxY = b.y + b.h;
    hit += 1;
  }
  return hit === 0 ? null : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** 成员子树包围盒（含自身盒） */
function subtreeBBox(ln: LayoutNode): Box {
  let minX = ln.box.x;
  let minY = ln.box.y;
  let maxX = ln.box.x + ln.box.w;
  let maxY = ln.box.y + ln.box.h;
  const walk = (n: LayoutNode): void => {
    if (n.box.x < minX) minX = n.box.x;
    if (n.box.y < minY) minY = n.box.y;
    if (n.box.x + n.box.w > maxX) maxX = n.box.x + n.box.w;
    if (n.box.y + n.box.h > maxY) maxY = n.box.y + n.box.h;
    for (const c of n.children) walk(c);
  };
  for (const c of ln.children) walk(c);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function buildView(
  summaryId: string,
  side: -1 | 1,
  memberIds: readonly string[],
  band: Box,
  summaryBox: Box,
): SummaryView {
  const bandMinX = band.x;
  const bandMaxX = band.x + band.w;
  const bandCenterY = band.y + band.h / 2;
  // 括线竖段 x：右向贴带右沿外，左向贴带左沿外
  const bracketX = side > 0 ? bandMaxX + SUMMARY_BRACKET_GAP : bandMinX - SUMMARY_BRACKET_GAP;
  // 指线回指成员带外沿
  const tipX = side > 0 ? bandMaxX : bandMinX;
  const top = band.y;
  const bottom = band.y + band.h;
  // 方括号：上指线 → 竖段 → 下指线
  const bracketPath =
    `M ${r(tipX)} ${r(top)} L ${r(bracketX)} ${r(top)} ` +
    `L ${r(bracketX)} ${r(bottom)} L ${r(tipX)} ${r(bottom)}`;
  // stem：从括线中点水平连到摘要盒外缘（右向取左缘，左向取右缘）
  const stemX1 = bracketX;
  const stemX2 = side > 0 ? summaryBox.x : summaryBox.x + summaryBox.w;
  return {
    summaryId,
    side,
    memberIds,
    bracketPath,
    stemX1: r(stemX1),
    stemY1: r(bandCenterY),
    stemX2: r(stemX2),
    stemY2: r(bandCenterY),
    memberBand: band,
    summaryBox,
  };
}

function r(v: number): number {
  return Math.round(v * 10) / 10;
}
