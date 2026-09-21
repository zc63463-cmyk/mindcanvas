/**
 * 视口裁剪（viewport culling）：layout 全量计算，渲染仅提交可见节点。
 * 世界坐标可见矩形由 transform 反推，节点盒 AABB 相交 + margin 外扩（防滚动跳变）。
 */
import type { Rect } from './fit.js';
import type { Box } from './mindmap.js';

export interface Transform2D {
  k: number;
  x: number;
  y: number;
}

/** 当前 transform 下的可见世界矩形 */
export function worldViewportRect(t: Transform2D, viewW: number, viewH: number): Rect {
  const k = t.k > 0 ? t.k : 1;
  return { x: -t.x / k || 0, y: -t.y / k || 0, w: viewW / k, h: viewH / k };
}

/** 节点盒与可见矩形相交（AABB；margin 外扩防边缘闪烁） */
export function isBoxInView(box: Rect, view: Rect, margin = 0): boolean {
  return (
    box.x + box.w >= view.x - margin &&
    box.x <= view.x + view.w + margin &&
    box.y + box.h >= view.y - margin &&
    box.y <= view.y + view.h + margin
  );
}

// ---------- links 可见性过滤（任一入视口则渲染，与 relGeos 规则一致） ----------

export interface LinkEndpoint {
  fromId: string;
  toId: string;
}

/**
 * 父子连线可见性过滤：任一端点 box 在视口（含 margin）内则保留。
 * 与 relGeos L233-235 规则对齐：连接到屏幕外节点的线仍画到屏幕边缘，避免半条线突然消失。
 * 纯函数，零依赖 React/DOM，可 Vitest 单测。
 *
 * @param links   任意带 fromId/toId 的连线数组（泛型保留原始结构）
 * @param nodesById  节点 box 映射（来自 layout.nodes）
 * @param view    世界坐标可见矩形（worldViewportRect 产出）
 * @param margin  视口外扩像素，防滚动边缘跳变（nodes/relGeos 均用 90）
 */
export function filterVisibleLinks<T extends LinkEndpoint>(
  links: T[],
  nodesById: Map<string, Box>,
  view: Rect,
  margin = 90,
): T[] {
  return links.filter((ln) => {
    const fromBox = nodesById.get(ln.fromId);
    const toBox = nodesById.get(ln.toId);
    const fromIn = fromBox ? isBoxInView(fromBox, view, margin) : false;
    const toIn = toBox ? isBoxInView(toBox, view, margin) : false;
    return fromIn || toIn;
  });
}
