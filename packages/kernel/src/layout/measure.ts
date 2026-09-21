/**
 * 文本度量抽象（K2 纯净性防线）。
 * kernel 零 DOM 依赖：布局引擎所需文本度量以注入接口提供 ——
 * kernel 提供默认字符宽度估算实现；精确 DOM 度量（measureText）由 packages/react 将来注入。
 */
import type { EditableNode } from '../tree/treeOps.js';
import { displayMetrics } from './nodeLayout.js';

/** 字符宽度度量函数（注入接口；字符串 → 像素宽近似） */
export type CharMeasure = (text: string) => number;

/** 默认字符宽度估算（无 DOM）：CJK/全角 ≈ 12px，窄字符 ≈ 7px */
export const defaultCharMeasure: CharMeasure = (text) => {
  let w = 0;
  for (const ch of text) w += ch.charCodeAt(0) > 0x2e7f ? 12 : 7;
  return w;
};

/**
 * 默认节点级 MeasureFn（node → {w,h}）。
 * 基于 displayMetrics（与渲染层同一套换行/盒高逻辑）+ 空实体表 + 默认字符估算。
 * packages/react 将来注入精确 DOM 度量以替换本默认实现（TODO(K3)）。
 */
export function defaultMeasure(node: EditableNode): { w: number; h: number } {
  const m = displayMetrics(node, new Map(), defaultCharMeasure);
  return { w: m.w, h: m.h };
}
