/**
 * DOM 精确文本度量（T3：替换 kernel 默认字符估算，度量≈最终渲染像素）。
 * canvas 2d measureText + 内核 cachedMetrics/displayMetrics 同一套换行盒高逻辑，
 * 保证「度量盒」与「渲染盒」一致——杜绝文字溢出/空洞。
 */
import { cachedMetrics } from '@mindcanvas/kernel';
import type { CharMeasure, Entity, MeasureFn } from '@mindcanvas/kernel';
import type { EditableNode } from '@mindcanvas/kernel';

let sharedCtx: CanvasRenderingContext2D | null = null;

function get2d(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (sharedCtx) return sharedCtx;
  sharedCtx = document.createElement('canvas').getContext('2d');
  return sharedCtx;
}

/** 以主题字体构建字符度量（缺 DOM 时回退估算——Node 环境仍可布局） */
export function createCharMeasure(
  font: { family: string; size: number },
  ctx?: CanvasRenderingContext2D | null,
): CharMeasure {
  const canvasCtx = ctx ?? get2d();
  const fontStr = `${font.size}px ${font.family}`;
  if (!canvasCtx) {
    // 无 DOM（SSR/测试 node 环境）：CJK≈size、窄≈0.62*size，比例与内核默认一致
    return (text) => {
      let w = 0;
      for (const ch of text) w += ch.charCodeAt(0) > 0x2e7f ? font.size : font.size * 0.62;
      return w;
    };
  }
  return (text) => {
    if (canvasCtx.font !== fontStr) canvasCtx.font = fontStr;
    return Math.ceil(canvasCtx.measureText(text).width);
  };
}

/** 节点级 MeasureFn / DisplayMetrics（内核 cachedMetrics 同一事实源；缓存按字符度量实例隔离，防主题切换串盒） */
const metricCaches = new WeakMap<CharMeasure, WeakMap<EditableNode, unknown>>();

/** 节点 → DisplayMetrics（渲染与度量同一事实源；供 MapView 建 metricsById） */
export function createDisplayMetricsFn(
  char: CharMeasure,
  entities: Map<string, Entity>,
): (node: EditableNode) => ReturnType<typeof cachedMetrics> {
  const cache = ensureCache(char);
  return (node) => cachedMetrics(cache as WeakMap<EditableNode, never>, node, entities, char);
}

export function createNodeMeasure(char: CharMeasure, entities: Map<string, Entity>): MeasureFn {
  const metric = createDisplayMetricsFn(char, entities);
  return (node) => ({ w: metric(node).w, h: metric(node).h });
}

function ensureCache(char: CharMeasure): WeakMap<EditableNode, unknown> {
  let c = metricCaches.get(char);
  if (!c) {
    c = new WeakMap();
    metricCaches.set(char, c);
  }
  return c;
}
