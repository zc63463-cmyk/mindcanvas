/**
 * G-P2：裁剪窗口量化（自由边路由重算治理）。
 *
 * 背景：`MapView` 的自由边可见集 memo 依赖 view 的原始数值 —— pan 期间逐帧变化，
 * 裁剪窗口「每帧都可能变」。量化到 CULL_QUANT 世界单位网格后，窗口只在跨网格线时
 * 变化 → 下游（stableByKeys 稳定化后的）路由重算频率从「每帧」降到「每 256px 至多一次」。
 *
 * 语义（与计划 G-P2 一致）：量化结果为原矩形的**外扩超集**（永远包含原矩形）——
 * 可见成员从「原窗口成员」变为「超集成员」，是允许的语义超集（多渲染少量边缘的边），
 * 不会漏渲染（原窗口内成员必在超集内）。
 */
export interface QuantRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 量化网格尺寸（世界单位，与 CULL_MARGIN=128 同量级） */
export const CULL_QUANT = 256;

/**
 * 把矩形向外对齐到 q 的网格：x/y 向下取整，右/下边界向上取整 → 外扩超集。
 * q ≤ 0（含 NaN）→ 原样返回（防护：不产出 NaN/退化矩形）。
 */
export function quantizeRect(rect: QuantRect, q: number): QuantRect {
  if (!(q > 0)) return rect;
  const x0 = Math.floor(rect.x / q) * q;
  const y0 = Math.floor(rect.y / q) * q;
  const x1 = Math.ceil((rect.x + rect.w) / q) * q;
  const y1 = Math.ceil((rect.y + rect.h) / q) * q;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
