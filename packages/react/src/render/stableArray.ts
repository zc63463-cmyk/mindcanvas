/**
 * G-P1：内容键 identity 稳定化（React memo / useMemo 友好）。
 *
 * 背景（自由边路由重算治理，见 docs/dispatch/2026-09-12-freeedge-routing-recompute-plan.md）：
 * `MapView` 的 `visibleFreeEdges` memo 因裁剪窗口（view）逐帧变化而每帧产出**新数组**，
 * 击穿 `FreeEdgeLayer` 路由 useMemo → pan 期逐帧整表重算路由。本工具把「内容未变」的
 * 数组还原为同一引用，让下游 memo 恢复命中。
 *
 * 语义守护：只有「长度一致 && 逐项 key 一致」才复用 prev —— 成员/顺序变了必须换引用，
 * 否则消费方会渲染陈旧成员。比较仅读 key（O(n)，不做深比较）。
 *
 * **调用方契约（R5 补·实事故）**：key 相同 **不代表成员内容相同** —— 位置型 key
 * （如 `e0`）在「换了数据源但成员数相同」时逐项相等；若 prev 来自旧数据源，复用即让
 * 消费方渲染**陈旧成员**（MapView 自由边曾因此跨文档整层不渲染：端点在新树解析全落空）。
 * 跨代次（换文档 / 换 root）必须先换代：把 prev 置 null，或调用方自持
 * `{ source, arr }` 先比对 source（MapView 采用后者，见其 freeEdgesStableRef）。
 */
export function stableByKeys<T>(
  prev: readonly T[] | null,
  next: readonly T[],
  keyOf: (t: T) => string,
): readonly T[] {
  if (prev === null || prev.length !== next.length) return next;
  for (let i = 0; i < next.length; i++) {
    const a = prev[i];
    const b = next[i];
    // 长度一致时逐项必在（防御 undefined 项：保守换引用，绝不误复用）
    if (a === undefined || b === undefined) return next;
    if (keyOf(a) !== keyOf(b)) return next;
  }
  return prev;
}
