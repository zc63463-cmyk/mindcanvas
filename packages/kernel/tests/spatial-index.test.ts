/**
 * 空间索引（网格桶）· 纯函数契约（批次 B · B-P1）
 *
 * 契约（调用方依赖的四条）：
 *  ① **不漏**：`queryBoxIndex` 的结果是「与查询矩形 AABB 相交」的**超集**（桶内可有未命中的盒）
 *     —— 精判由调用方原函数负责，索引只做粗筛。
 *  ② **不重**：跨多格的盒在结果里只出现一次；查询结果按下标升序（顺序确定，便于「自后向前取最后命中」）。
 *  ③ **边界唯一归属**：盒恰落在格边界上时只归一个桶（半开区间 [lo, lo+w)）。
 *  ④ 退化安全：空集 / 单盒 / 超大格（1 桶）/ 超小格（每盒各格）都不塌。
 */
import { describe, expect, it } from 'vitest';
import { isBoxInView } from '../src/layout/cull.js';
import type { Box } from '../src/layout/mindmap.js';
import { buildBoxIndex, DEFAULT_CELL_SIZE, queryBoxIndex } from '../src/layout/spatialIndex.js';

/** 确定性 PRNG（避免 Math.random 造成不可复现的失败） */
function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

const box = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h });

/** 线性精确过滤（对照组）：AABB 相交，与索引粗筛同口径 */
const exactHits = (boxes: readonly Box[], rect: Box): number[] =>
  boxes.map((_, i) => i).filter((i) => isBoxInView(boxes[i], rect, 0));

describe('spatialIndex · 等价性（粗筛 ⊇ 精确命中）', () => {
  it('随机 200 盒 × 20 查询矩形：每个精确命中都被粗筛包含（不漏）', () => {
    const rng = makeRng(20260912);
    const boxes: Box[] = Array.from({ length: 200 }, () =>
      box(rng() * 20000, rng() * 20000, rng() * 800, rng() * 400),
    );
    const idx = buildBoxIndex(boxes);
    const queries: Box[] = Array.from({ length: 20 }, () =>
      box(rng() * 20000, rng() * 20000, rng() * 4000, rng() * 3000),
    );

    let checkedHits = 0;
    for (const q of queries) {
      const coarse = new Set(queryBoxIndex(idx, q));
      const exact = exactHits(boxes, q);
      checkedHits += exact.length;
      for (const i of exact) {
        expect(coarse.has(i), `粗筛漏掉精确命中 #${i}（query=${JSON.stringify(q)}）`).toBe(true);
      }
    }
    expect(checkedHits).toBeGreaterThan(20); // 采样有效性：查询确实命中了不少盒（实测 31）
  });

  it('结果无重复且按下标升序（跨多格的盒只出现一次）', () => {
    const boxes = [box(0, 0, 2000, 2000), box(3000, 0, 100, 100), box(0, 3000, 100, 100)];
    const idx = buildBoxIndex(boxes, 256);
    const got = queryBoxIndex(idx, box(0, 0, 3200, 3200));
    expect(got).toEqual([...new Set(got)]); // 无重复
    expect(got).toEqual([...got].sort((a, b) => a - b)); // 升序
    expect(got).toContain(0);
    expect(got).toContain(1);
  });
});

describe('spatialIndex · 退化输入', () => {
  it('空集：0 桶、查询空数组', () => {
    const idx = buildBoxIndex([]);
    expect(idx.size).toBe(0);
    expect(idx.cells.size).toBe(0);
    expect(queryBoxIndex(idx, box(0, 0, 100, 100))).toEqual([]);
  });

  it('单盒：命中与不命中两个方向都正确', () => {
    const idx = buildBoxIndex([box(100, 100, 50, 50)], 256);
    expect(queryBoxIndex(idx, box(90, 90, 80, 80))).toEqual([0]);
    expect(queryBoxIndex(idx, box(1000, 1000, 10, 10))).toEqual([]);
  });

  it('cellSize 过大（整个索引 1 桶）→ 退化为线性；结果仍包含真命中（超集契约）', () => {
    const boxes = [box(0, 0, 10, 10), box(5000, 5000, 10, 10), box(50, 50, 10, 10)];
    const idx = buildBoxIndex(boxes, 1e9);
    expect(idx.cells.size).toBe(1);
    const got = queryBoxIndex(idx, box(0, 0, 60, 60));
    expect(got).toContain(0);
    expect(got).toContain(2);
  });

  it('cellSize 过小（1）→ 互不重叠的盒各占各格', () => {
    const boxes = [box(0, 0, 4, 4), box(100, 0, 4, 4), box(200, 0, 4, 4)];
    const idx = buildBoxIndex(boxes, 1);
    expect(idx.cells.size).toBe(3 * 4 * 4); // 每盒 4×4 格
    expect(queryBoxIndex(idx, box(99, 0, 6, 6))).toEqual([1]);
  });

  it('缺省 cellSize = DEFAULT_CELL_SIZE（512）', () => {
    const idx = buildBoxIndex([box(0, 0, 10, 10)]);
    expect(idx.cellSize).toBe(DEFAULT_CELL_SIZE);
    expect(DEFAULT_CELL_SIZE).toBe(512);
  });

  it('零尺寸盒（w/h = 0）：不塌、只归一格', () => {
    const idx = buildBoxIndex([box(512, 512, 0, 0)], 512);
    expect(idx.cells.size).toBe(1);
    expect(queryBoxIndex(idx, box(500, 500, 20, 20))).toEqual([0]);
  });
});

describe('spatialIndex · 格边界唯一归属', () => {
  it('盒恰在格边界上（[512,1024) 宽 512）→ 只归一个桶', () => {
    const idx = buildBoxIndex([box(512, 0, 512, 10)], 512);
    expect(idx.cells.size).toBe(1);
    const first = [...idx.cells.values()][0];
    expect(first).toEqual([0]);
  });

  it('盒跨两格（[0,1024)）→ 归两桶，但查询结果不重复计数', () => {
    const idx = buildBoxIndex([box(0, 0, 1024, 10)], 512);
    expect(idx.cells.size).toBe(2);
    expect(queryBoxIndex(idx, box(0, 0, 1024, 10))).toEqual([0]);
    expect(queryBoxIndex(idx, box(700, 0, 10, 10))).toEqual([0]); // 只落在第 2 格也能命中
  });

  it('负坐标盒（世界坐标为负）同样不漏', () => {
    const boxes = [box(-900, -900, 200, 200), box(-100, -100, 50, 50)];
    const idx = buildBoxIndex(boxes, 512);
    expect(queryBoxIndex(idx, box(-1000, -1000, 600, 600))).toEqual([0, 1]);
    // 远离的查询 → 空（近邻格可能因「查询膨胀 1 格」被纳入，故这里取足够远）
    expect(queryBoxIndex(idx, box(5000, 5000, 10, 10))).toEqual([]);
  });

  it('盒与查询恰在格边界上相接 → 仍不漏（查询膨胀 1 格的价值）', () => {
    const boxes = [box(0, 0, 512, 512)]; // 恰占格 (0,0)；右/下边缘落在 512 边界
    const idx = buildBoxIndex(boxes, 512);
    const touch = box(512, 0, 100, 100); // 左边缘贴盒右边缘（= 格 1 起点）
    expect(exactHits(boxes, touch)).toEqual([0]); // 精确判据：贴边 = 命中
    expect(queryBoxIndex(idx, touch)).toContain(0); // 半开分桶本会漏 → 膨胀后覆盖
  });

  it('查询矩形恰与盒边界相接（贴边）→ 与 isBoxInView 同步判为命中', () => {
    const boxes = [box(0, 0, 100, 100)];
    const idx = buildBoxIndex(boxes, 512);
    const touching = box(100, 0, 50, 50); // 左边缘贴盒右边缘
    expect(exactHits(boxes, touching)).toEqual([0]); // 精确判据：贴边算命中
    expect(queryBoxIndex(idx, touching)).toEqual([0]);
  });
});
