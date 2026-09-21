/**
 * 小地图映射（纯函数）：内容 bounds + 当前视图 transform → 缩略内容矩形与视口指示框。
 * 供 MapView 右下角 minimap 渲染与跳转定位。
 */
import type { Rect } from './fit.js';
import type { Box } from './mindmap.js';

export interface MinimapRects {
  /** 全图在缩略面板内的位置（等比缩小并居中） */
  content: Rect;
  /** 当前视口在缩略面板内的指示框（越界 clamp 到 content） */
  viewport: Rect;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** 共享：计算 bounds → panel 的等比缩放与居中偏移 */
function contentTransform(bounds: Rect, panel: Rect): { scale: number; ox: number; oy: number } {
  const bw = Math.max(1, bounds.w);
  const bh = Math.max(1, bounds.h);
  const scale = Math.min(panel.w / bw, panel.h / bh);
  const ox = panel.x + (panel.w - bw * scale) / 2;
  const oy = panel.y + (panel.h - bh * scale) / 2;
  return { scale, ox, oy };
}

/** content bounds + 视图 transform → minimap 内容与视口指示框 */
export function minimapRects(
  bounds: Rect,
  viewW: number,
  viewH: number,
  transform: { k: number; x: number; y: number },
  panel: Rect,
): MinimapRects {
  const bw = Math.max(1, bounds.w);
  const bh = Math.max(1, bounds.h);
  const { scale, ox, oy } = contentTransform(bounds, panel);
  const contentW = bw * scale;
  const contentH = bh * scale;
  const content: Rect = { x: ox, y: oy, w: contentW, h: contentH };

  const k = transform.k > 0 ? transform.k : 1;
  // 当前可见的世界坐标矩形 [wx0,wy0,wx1,wy1]
  const wx0 = -transform.x / k;
  const wy0 = -transform.y / k;
  const wx1 = wx0 + viewW / k;
  const wy1 = wy0 + viewH / k;
  const vx = clamp(ox + (wx0 - bounds.x) * scale, ox, ox + contentW);
  const vy = clamp(oy + (wy0 - bounds.y) * scale, oy, oy + contentH);
  const vx1 = clamp(ox + (wx1 - bounds.x) * scale, ox, ox + contentW);
  const vy1 = clamp(oy + (wy1 - bounds.y) * scale, oy, oy + contentH);
  return {
    content,
    viewport: { x: vx, y: vy, w: Math.max(0, vx1 - vx), h: Math.max(0, vy1 - vy) },
  };
}

/** 将每个节点的世界坐标 box 映射到 minimap 面板内，返回缩略矩形数组（节点级内容展示） */
export function minimapNodeRects(nodes: Array<{ box: Box }>, bounds: Rect, panel: Rect): Rect[] {
  if (!nodes.length) return [];
  const { scale, ox, oy } = contentTransform(bounds, panel);
  const out: Rect[] = new Array(nodes.length);
  for (let i = 0; i < nodes.length; i++) {
    const b = nodes[i].box;
    out[i] = {
      x: ox + (b.x - bounds.x) * scale,
      y: oy + (b.y - bounds.y) * scale,
      w: Math.max(0, b.w * scale),
      h: Math.max(0, b.h * scale),
    };
  }
  return out;
}

/** 缩略面板内的点 → 世界坐标 x（跳转定位用）；与 minimapRects 同参数 */
export function minimapPointToWorld(
  px: number,
  py: number,
  bounds: Rect,
  panel: Rect,
): { x: number; y: number } {
  const { scale, ox, oy } = contentTransform(bounds, panel);
  return { x: bounds.x + (px - ox) / scale, y: bounds.y + (py - oy) / scale };
}
