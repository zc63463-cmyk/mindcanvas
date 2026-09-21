import { describe, expect, it } from 'vitest';
import { minimapNodeRects, minimapRects } from '../src/layout/minimap.js';
import type { Rect } from '../src/layout/fit.js';
import type { Box } from '../src/layout/mindmap.js';

describe('layout/minimap：内容缩略与视口指示框', () => {
  const box: Rect = { x: 0, y: 0, w: 40, h: 40 };

  it('与视图完全对齐：contents 居中，view 可视区映射为等比例框', () => {
    const bounds: Rect = { x: 0, y: 0, w: 100, h: 100 };
    // k=1、无偏移：可见世界区 = [0,50]x[0,50]，scale=0.4 → 框 20x20
    const r = minimapRects(bounds, 50, 50, { k: 1, x: 0, y: 0 }, box);
    expect(r.content).toEqual({ x: 0, y: 0, w: 40, h: 40 });
    expect(r.viewport).toEqual({ x: 0, y: 0, w: 20, h: 20 });
  });

  it('大图等比缩小并居中（content 小于 panel，上下留白）', () => {
    const bounds: Rect = { x: 0, y: 0, w: 2000, h: 1000 };
    const r = minimapRects(bounds, 1000, 800, { k: 0.45, x: 50, y: 175 }, box);
    // scale = min(40/2000, 40/1000) = 0.02 → content 40x20，y 方向留白 10
    expect(r.content.w).toBeCloseTo(40, 6);
    expect(r.content.h).toBeCloseTo(20, 6);
    expect(r.content.y).toBeCloseTo(10, 6);
    // 当前可见世界区中心应对齐图中位置（可命中 content 内）
    expect(r.viewport.w).toBeGreaterThan(0);
    expect(r.viewport.h).toBeGreaterThan(0);
  });

  it('偏移后可见区越界 → clamp 到 content 范围内', () => {
    const bounds: Rect = { x: 0, y: 0, w: 100, h: 100 };
    // 视图看向左上外（负偏移）：k=1, x=10, y=10 → 可见世界 x∈[-10,40]
    const r = minimapRects(bounds, 50, 50, { k: 1, x: 10, y: 10 }, box);
    expect(r.viewport.x).toBeGreaterThanOrEqual(r.content.x);
    expect(r.viewport.y).toBeGreaterThanOrEqual(r.content.y);
    expect(r.viewport.x + r.viewport.w).toBeLessThanOrEqual(r.content.x + r.content.w);
  });

  it('负/空 bounds 不产生 NaN', () => {
    const r = minimapRects({ x: 0, y: 0, w: 0, h: 0 }, 100, 100, { k: 1, x: 0, y: 0 }, box);
    expect(Number.isFinite(r.content.x)).toBe(true);
    expect(Number.isFinite(r.viewport.w)).toBe(true);
  });

  it('minimapNodeRects：把每个节点 box 映射到缩略面板坐标（与 content 等比对齐）', () => {
    const bounds: Rect = { x: 0, y: 0, w: 100, h: 100 };
    const panel: Rect = { x: 0, y: 0, w: 40, h: 40 };
    const nodes: Array<{ box: Box }> = [
      { box: { x: 0, y: 0, w: 20, h: 10 } }, // 左上节点
      { box: { x: 50, y: 50, w: 30, h: 20 } }, // 中间节点
      { box: { x: 80, y: 90, w: 20, h: 10 } }, // 右下节点
    ];
    // scale = min(40/100, 40/100) = 0.4；ox=0, oy=0, content 40x40
    const rects = minimapNodeRects(nodes, bounds, panel);
    expect(rects).toHaveLength(3);
    // 节点1：x=0, y=0, w=8, h=4
    expect(rects[0]).toEqual({ x: 0, y: 0, w: 8, h: 4 });
    // 节点2：x=50*0.4=20, y=50*0.4=20, w=30*0.4=12, h=20*0.4=8
    expect(rects[1]).toEqual({ x: 20, y: 20, w: 12, h: 8 });
    // 节点3：x=32, y=36, w=8, h=4
    expect(rects[2]).toEqual({ x: 32, y: 36, w: 8, h: 4 });
  });

  it('minimapNodeRects：非零 origin 的 bounds 按偏移换算', () => {
    const bounds: Rect = { x: 100, y: 200, w: 100, h: 100 };
    const panel: Rect = { x: 0, y: 0, w: 40, h: 40 };
    const nodes: Array<{ box: Box }> = [
      { box: { x: 100, y: 200, w: 20, h: 10 } }, // 左上
    ];
    const rects = minimapNodeRects(nodes, bounds, panel);
    expect(rects[0]).toEqual({ x: 0, y: 0, w: 8, h: 4 });
  });

  it('minimapNodeRects：空节点列表返回空数组且不抛错', () => {
    const bounds: Rect = { x: 0, y: 0, w: 100, h: 100 };
    const panel: Rect = { x: 0, y: 0, w: 40, h: 40 };
    expect(minimapNodeRects([], bounds, panel)).toEqual([]);
  });

  it('minimapNodeRects：内容上下留白时也按居中对齐', () => {
    const bounds: Rect = { x: 0, y: 0, w: 200, h: 100 }; // 宽高比 2:1
    const panel: Rect = { x: 0, y: 0, w: 40, h: 40 }; // 1:1 → y 留白 10
    const nodes: Array<{ box: Box }> = [{ box: { x: 0, y: 0, w: 20, h: 10 } }];
    // scale = min(40/200, 40/100) = 0.2 → content 40x20, ox=0, oy=10
    const rects = minimapNodeRects(nodes, bounds, panel);
    expect(rects[0].x).toBe(0);
    expect(rects[0].y).toBe(10); // 居中后，顶部留白 10
    expect(rects[0].w).toBe(4);
    expect(rects[0].h).toBe(2);
  });
});
