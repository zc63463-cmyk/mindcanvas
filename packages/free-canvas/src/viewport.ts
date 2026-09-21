import type { CanvasViewport } from './types.js';

export const MIN_SCALE = 0.15;
export const MAX_SCALE = 4;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** 屏幕点 → 世界坐标 */
export function screenToWorld(
  screenX: number,
  screenY: number,
  vp: CanvasViewport,
): { x: number; y: number } {
  return {
    x: (screenX - vp.panX) / vp.scale,
    y: (screenY - vp.panY) / vp.scale,
  };
}

/** 世界点 → 屏幕坐标 */
export function worldToScreen(
  worldX: number,
  worldY: number,
  vp: CanvasViewport,
): { x: number; y: number } {
  return {
    x: worldX * vp.scale + vp.panX,
    y: worldY * vp.scale + vp.panY,
  };
}

/** 以屏幕点为锚缩放（保持该点下世界坐标不变） */
export function zoomAt(
  vp: CanvasViewport,
  screenX: number,
  screenY: number,
  nextScale: number,
): CanvasViewport {
  const scale = clampScale(nextScale);
  const world = screenToWorld(screenX, screenY, vp);
  return {
    scale,
    panX: screenX - world.x * scale,
    panY: screenY - world.y * scale,
  };
}

export function panBy(vp: CanvasViewport, dx: number, dy: number): CanvasViewport {
  return { ...vp, panX: vp.panX + dx, panY: vp.panY + dy };
}

/** CSS transform 字符串：translate + scale */
export function viewportCssTransform(vp: CanvasViewport): string {
  return `translate(${vp.panX}px, ${vp.panY}px) scale(${vp.scale})`;
}
