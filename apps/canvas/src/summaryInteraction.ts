/**
 * S2 摘要两跳交互的**提示文案**与**第二跳判定**（纯函数，可测）。
 *
 * 为什么单独成文件：`MindmapStage.tsx` 已在 `bigFiles` 名单（>600 行），
 * 交互文案与「这次点击算不算合法第二跳」的判定属于可独立测试的纯逻辑，
 * 外提后既守住预算，也让两跳规则有单一事实源（宿主与测试消费同一份）。
 *
 * 文案契约（任务书 §六）：必须明确要求「选择同一父级范围的末成员」。
 */

/** 第一跳后（已登记起点）的引导提示 */
export const SUMMARY_PICK_END_NOTICE = '点选范围末成员（需同一父级；Esc 取消）';

/** 第二跳判定结果：`accept` 才真正建摘要；其余为「保留草稿 + 给提示」 */
export type SummarySecondHop =
  /** 合法末成员 → 建摘要 */
  | { kind: 'accept' }
  /** 起点已不在树中（如起点被删 / 文档被替换）→ 草稿作废，清掉并提示 */
  | { kind: 'start-gone' };

/**
 * 第二跳判定（纯函数）。
 *
 * 只判「是否还能继续」；跨父 / 倒序 / 根 / 摘要端点等**语义**拒绝留给
 * `planCreateSummary` 统一裁决（单一校验源），避免两处规则漂移。
 *
 * **单成员范围（点回起点）合法**：设计稿 §4.5「单击同一节点 = 单成员摘要（允许）」，
 * 数据层契约亦为「单成员 `from==to` 合法」（S1）；`planCreateSummary` 对 `fromId === toId`
 * 按**同一节点只分配一次 cid** 处理（R1 修复）。此处不得再以「点回起点」为由拒绝
 * —— 那只会把数据层/交互层的问题用 UI 拒绝掩盖。
 */
export function classifySecondHop(
  draftFromId: string,
  hasFrom: (id: string) => boolean,
): SummarySecondHop {
  if (!hasFrom(draftFromId)) return { kind: 'start-gone' };
  // 其余一律 accept —— 包括「点回起点」：两端同一节点 = **单成员摘要**，
  // 属合法范围（S1 契约），由 planCreateSummary 的同一节点去重分支正确落库。
  // 语义拒绝（跨父 / 根 / 倒序 / 摘要端点）统一由数据层裁决，此处不做 UI 拒绝。
  return { kind: 'accept' };
}
