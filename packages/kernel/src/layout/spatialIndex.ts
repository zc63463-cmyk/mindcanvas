/**
 * 空间索引（网格桶）· 批次 B / B-P1
 * ══════════════════════════════════════════════════════════════════════
 * 用途：把「视口裁剪」与「节点命中粗筛」从 O(全量节点) 降到 O(可见格 + 桶内盒)。
 * 纯函数、零依赖（不碰 DOM / React），kernel 层可被 react 渲染器与 node 基准脚本复用。
 *
 * 契约（与 tests/spatial-index.test.ts 一一对应）：
 *  ① **不漏**：`queryBoxIndex(idx, rect)` 的结果是「与 rect AABB 相交（含贴边）」盒集合的**超集**。
 *     精判（`isBoxInView` / `hitNodeAt` 原函数）由调用方负责，索引只做粗筛。
 *  ② **不重且有序**：跨多格的盒只出现一次；结果按下标升序（顺序确定 → 调用方可「自后向前取最后命中」）。
 *  ③ **盒的格归属唯一**：盒按**半开区间** [lo, lo+w) 分桶 —— 恰落在格边界上的盒只归一个桶。
 *  ④ **查询按 1 格膨胀**：为覆盖「盒与查询矩形恰在格边界上相接」的情形（半开分桶会漏），
 *     查询侧把格范围向外各扩 1 格。代价是候选集略大（仍受超集契约允许），换来 clip/命中零漏判。
 */
import type { Box } from './mindmap.js';

/** 默认格子边长（世界单位）：512 ≈ 视口量级，兼顾桶内盒数量与格数 */
export const DEFAULT_CELL_SIZE = 512;

export interface BoxIndex {
  /** 实际使用的格子边长（> 0） */
  cellSize: number;
  /** 格键 `cx,cy` → 盒下标数组 */
  cells: Map<string, number[]>;
  /** 建立索引的盒数量 */
  size: number;
}

/** 浮点噪声容差：把「恰在格边界」的右/下开区间收进前一格（配合半开区间） */
const EPS = 1e-9;

/** 半开区间 [lo, lo+size) 覆盖的格下标范围（size ≤ 0 时退化为单格） */
function cellRange(lo: number, size: number, cellSize: number): [number, number] {
  const a = Math.floor(lo / cellSize);
  const b = Math.floor((lo + Math.max(size, 0) - EPS) / cellSize);
  return [a, b < a ? a : b];
}

const keyOf = (cx: number, cy: number): string => `${cx},${cy}`;

/** 建立网格桶索引（cellSize 非法时回落默认值） */
export function buildBoxIndex(boxes: ReadonlyArray<Box>, cellSize = DEFAULT_CELL_SIZE): BoxIndex {
  const cs = cellSize > 0 ? cellSize : DEFAULT_CELL_SIZE;
  const cells = new Map<string, number[]>();
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const [x0, x1] = cellRange(b.x, b.w, cs);
    const [y0, y1] = cellRange(b.y, b.h, cs);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = keyOf(cx, cy);
        const arr = cells.get(k);
        if (arr) arr.push(i);
        else cells.set(k, [i]);
      }
    }
  }
  return { cellSize: cs, cells, size: boxes.length };
}

/**
 * 粗筛：返回所有「可能与 rect 相交」的盒下标（升序、无重复）。
 * ⚠️ 结果是超集 —— 桶内盒未必真相交，须由调用方用精确谓词复判。
 */
export function queryBoxIndex(idx: BoxIndex, rect: Box): number[] {
  const [x0, x1] = cellRange(rect.x, rect.w, idx.cellSize);
  const [y0, y1] = cellRange(rect.y, rect.h, idx.cellSize);
  const hit = new Set<number>();
  // ① 查询按 1 格膨胀（契约 ④）
  for (let cx = x0 - 1; cx <= x1 + 1; cx++) {
    for (let cy = y0 - 1; cy <= y1 + 1; cy++) {
      const arr = idx.cells.get(keyOf(cx, cy));
      if (arr) for (const i of arr) hit.add(i);
    }
  }
  return [...hit].sort((a, b) => a - b);
}
