/**
 * DOM 精确文本度量（T3：替换 kernel 默认字符估算，度量≈最终渲染像素）。
 * canvas 2d measureText + 内核 cachedMetrics/displayMetrics 同一套换行盒高逻辑，
 * 保证「度量盒」与「渲染盒」一致——杜绝文字溢出/空洞。
 *
 * MEASURE-RANK（2026-09-18，DEPTH-VIS-1 收口）：字号自 DEPTH-VIS-1 起按**视觉档**分三档
 * （root/branch/leaf，见 `geometry.fontForRank`），度量必须同源分档——否则叶子按 branch 字号
 * 量（12px）却按 9px 画：叶卡白边约 25%、整体盒偏大还会压低 fit k（LOD 更早省文本）。
 * 分档入口只在 `createRankedCharMeasure` / `createNodeMeasure` / `createDisplayMetricsFn`，
 * 档位算式一律走 `fontForRank`（不得在本文件抄第二份）。
 */
import { cachedMetrics } from '@mindcanvas/kernel';
import type { CharMeasure, Entity, MeasureFn } from '@mindcanvas/kernel';
import type { DisplayMetrics, EditableNode } from '@mindcanvas/kernel';
import type { TokenSet } from '../theme/types.js';
import { fontForRank, visualRankOf, type VisualRank } from './geometry.js';

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

/** 视觉档 → 字符度量（按档缓存实例；同档多次取用同一函数，缓存键才稳定） */
export type CharMeasureOf = (rank: VisualRank) => CharMeasure;

/**
 * 主题字体块 → **三档字符度量**（root/branch/leaf，字号走 `fontForRank` 唯一出口）。
 *
 * 布局度量与展示度量都必须来自同一个 `charOf`：`createNodeMeasure(char, entities, charOf)`
 * 与 `createDisplayMetricsFn(char, entities, charOf)` 各自按档取字符度量，
 * 盒尺寸与渲染字号因此天然同源（「看起来大、点不中」的防线）。
 */
export function createRankedCharMeasure(
  font: TokenSet['font'],
  ctx?: CanvasRenderingContext2D | null,
): CharMeasureOf {
  const byRank = new Map<VisualRank, CharMeasure>();
  return (rank) => {
    let m = byRank.get(rank);
    if (m === undefined) {
      m = createCharMeasure({ family: font.family, size: fontForRank(font, rank).size }, ctx);
      byRank.set(rank, m);
    }
    return m;
  };
}

/** 节点级 MeasureFn / DisplayMetrics（内核 cachedMetrics 同一事实源；缓存按字符度量实例隔离，防主题切换串盒） */
const metricCaches = new WeakMap<CharMeasure, WeakMap<EditableNode, DisplayMetrics>>();

/**
 * 节点 → DisplayMetrics（渲染与度量同一事实源；供 MapView 建 metricsById）。
 *
 * @param charOf 档位字符度量（可选）：给了 → 按 `depth` 取档，与布局 `createNodeMeasure`
 *               同源分档；缺省 → 恒用 `char`（旧行为，逐像素不变）。
 *               缓存按**档位各自的字符度量实例**隔离（叶子不会命中分支档的换行结果）。
 */
export function createDisplayMetricsFn(
  char: CharMeasure,
  entities: Map<string, Entity>,
  charOf?: CharMeasureOf,
): (node: EditableNode, depth?: number) => ReturnType<typeof cachedMetrics> {
  return (node, depth) => {
    const measure = charOf === undefined || depth === undefined ? char : charOf(visualRankOf(depth));
    return cachedMetrics(ensureCache(measure), node, entities, measure);
  };
}

/**
 * 布局度量：node（+ 深度）→ {w,h}。
 *
 * `depth` 由内核布局逐层传入（`MeasureFn` 第二参，MEASURE-RANK）：
 * 给了 `charOf` 就按深度分档，缺省忽略 depth（= 旧单档行为）。
 */
export function createNodeMeasure(
  char: CharMeasure,
  entities: Map<string, Entity>,
  charOf?: CharMeasureOf,
): MeasureFn {
  const metric = createDisplayMetricsFn(char, entities, charOf);
  return (node, depth) => {
    const m = metric(node, depth);
    return { w: m.w, h: m.h };
  };
}

function ensureCache(char: CharMeasure): WeakMap<EditableNode, DisplayMetrics> {
  let c = metricCaches.get(char);
  if (!c) {
    c = new WeakMap();
    metricCaches.set(char, c);
  }
  return c;
}
