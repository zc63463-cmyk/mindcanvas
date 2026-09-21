/**
 * hitNodeAt · 索引粗筛 vs 线性路径**逐点等价**（批次 B · B-P1）
 *
 * 本文件是 B-P1 的头号风险守护（计划 §3 风险 1：「hitNodeAt 语义漂移会改点击/拖拽行为」）：
 * 同一条 `visible` 数组下，索引版必须与线性版返回**同一个对象引用**（= 同一节点），
 * 覆盖：自后向前「取最大下标」、skip 过滤、6px pad（HIT_PAD）边界。
 */
import { makeTextNode, buildBoxIndex, type Box, type LayoutNode } from '@mindcanvas/kernel';
import { describe, expect, it } from 'vitest';
import { HIT_PAD, hitNodeAt } from '../src/render/useMapGestures.js';

/** 确定性 PRNG（可复现） */
function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

const ln = (box: Box, depth = 1): LayoutNode => ({
  node: makeTextNode('n'),
  box,
  side: 1,
  depth,
  parentId: null,
  children: [],
});

/** 交错的网格盒（大量重叠 → 触发「取最大下标」的决胜逻辑） */
function overlappingGrid(cols: number, rows: number): LayoutNode[] {
  const out: LayoutNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push(ln({ x: c * 40, y: r * 30, w: 60, h: 40 }));
    }
  }
  return out;
}

describe('hitNodeAt · 索引版与线性版等价（B-P1）', () => {
  it('交错网格 × 网格探针：两路径返回同一节点（无 skip）', () => {
    const visible = overlappingGrid(12, 12);
    const index = buildBoxIndex(visible.map((v) => v.box));
    let hits = 0;
    for (let y = -20; y <= 380; y += 7) {
      for (let x = -20; x <= 500; x += 11) {
        const w = { x, y };
        const a = hitNodeAt(visible, w, undefined, index);
        const b = hitNodeAt(visible, w);
        expect(a, `索引版与线性版不一致 @(${x},${y})`).toBe(b);
        if (a) hits++;
      }
    }
    expect(hits).toBeGreaterThan(200); // 探针有效性：确实大量命中
  });

  it('skip 过滤下同样等价（反复剔除不同子集）', () => {
    const visible = overlappingGrid(8, 8);
    const index = buildBoxIndex(visible.map((v) => v.box));
    const skips: Array<(v: LayoutNode) => boolean> = [
      (v) => v.depth === 0, // 本例全为 depth=1 → 不过滤
      (v) => visible.indexOf(v) % 3 === 0,
      (v) => visible.indexOf(v) > visible.length - 20,
    ];
    for (const skip of skips) {
      for (let y = -10; y <= 260; y += 13) {
        for (let x = -10; x <= 340; x += 17) {
          expect(hitNodeAt(visible, { x, y }, skip, index)).toBe(
            hitNodeAt(visible, { x, y }, skip),
          );
        }
      }
    }
  });

  it('pad 边界：距盒边 6px 命中、6.01px 不命中（两路径一致）', () => {
    const visible = [ln({ x: 100, y: 100, w: 50, h: 30 })];
    const index = buildBoxIndex(visible.map((v) => v.box));
    const inside = { x: 100 - HIT_PAD, y: 100 - HIT_PAD }; // 恰在容差上
    const outside = { x: 100 - HIT_PAD - 0.01, y: 100 }; // 刚超出容差
    expect(HIT_PAD).toBe(6);
    expect(hitNodeAt(visible, inside, undefined, index)).toBe(visible[0]);
    expect(hitNodeAt(visible, inside)).toBe(visible[0]);
    expect(hitNodeAt(visible, outside, undefined, index)).toBeNull();
    expect(hitNodeAt(visible, outside)).toBeNull();
  });

  it('重叠盒：索引版返回「最大下标」命中（= 后绘制在上），skip 后落到前一个', () => {
    const a = ln({ x: 0, y: 0, w: 100, h: 100 });
    const b = ln({ x: 50, y: 50, w: 100, h: 100 });
    const visible = [a, b];
    const index = buildBoxIndex(visible.map((v) => v.box));
    const w = { x: 60, y: 60 }; // 两盒都命中
    expect(hitNodeAt(visible, w, undefined, index)).toBe(b);
    expect(hitNodeAt(visible, w, (v) => v === b, index)).toBe(a);
    expect(hitNodeAt(visible, w, (v) => v === b, index)).toBe(hitNodeAt(visible, w, (v) => v === b));
  });

  it('随机盒 × 随机探针（确定性种子）：两路径全等', () => {
    const rng = makeRng(20260912);
    const visible = Array.from({ length: 150 }, () =>
      ln({ x: rng() * 3000, y: rng() * 3000, w: rng() * 120 + 10, h: rng() * 80 + 10 }),
    );
    const index = buildBoxIndex(visible.map((v) => v.box));
    for (let i = 0; i < 400; i++) {
      const w = { x: rng() * 3200 - 100, y: rng() * 3200 - 100 };
      expect(hitNodeAt(visible, w, undefined, index)).toBe(hitNodeAt(visible, w));
    }
  });

  it('空可见集与空索引：返回 null（两路径一致）', () => {
    const index = buildBoxIndex([]);
    expect(hitNodeAt([], { x: 0, y: 0 }, undefined, index)).toBeNull();
    expect(hitNodeAt([], { x: 0, y: 0 })).toBeNull();
    expect(hitNodeAt([], { x: 0, y: 0 }, undefined, null)).toBeNull();
  });

  it('index = null 时走线性路径（小图/阈值下行为不变）', () => {
    const visible = overlappingGrid(3, 3);
    for (let y = -5; y <= 80; y += 5) {
      for (let x = -5; x <= 120; x += 5) {
        expect(hitNodeAt(visible, { x, y }, undefined, null)).toBe(hitNodeAt(visible, { x, y }));
      }
    }
  });
});
