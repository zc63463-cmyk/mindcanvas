/**
 * 适配视口（fit-to-window / Ctrl+0）：给定内容边界与视口，计算缩放与居中平移。
 * 纯函数，供 MapView 在 transform 上应用。
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Viewport {
  w: number;
  h: number;
}

export interface FitTransform {
  k: number;
  x: number;
  y: number;
}

export interface FitOptions {
  /** 缩放上限（防放大过头） */
  max?: number;
  /** 留白系数（0~1，1 = 填满不留白） */
  pad?: number;
}

/** bounds → 适配视口的 { k, x, y }（居中）；空内容/宽高为 0 时回退 k=1、原心平移 */
export function fitIntoView(
  bounds: Rect,
  viewport: Viewport,
  options: FitOptions = {},
): FitTransform {
  const pad = options.pad ?? 0.9;
  const max = options.max ?? 4;
  if (bounds.w <= 0 || bounds.h <= 0 || viewport.w <= 0 || viewport.h <= 0) {
    // 空图：保持 100%，内容中心对准视口中心
    return {
      k: 1,
      x: viewport.w / 2 - bounds.x - bounds.w / 2,
      y: viewport.h / 2 - bounds.y - bounds.h / 2,
    };
  }
  const fill = Math.min(viewport.w / bounds.w, viewport.h / bounds.h) * pad;
  const k = Math.min(fill, max);
  const x = (viewport.w - bounds.w * k) / 2 - bounds.x * k;
  const y = (viewport.h - bounds.h * k) / 2 - bounds.y * k;
  return { k, x, y };
}
