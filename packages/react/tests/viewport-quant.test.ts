/**
 * G-P2：quantizeRect —— 视口矩形向外对齐到网格（裁剪窗口量化）。
 *
 * 语义：量化结果为原矩形的**外扩超集**（永远包含原矩形），
 * 且只在跨越网格线时变化 → 裁剪 memo 依赖的变化频率从「每帧」降到「每 256px 至多一次」。
 */
import { describe, expect, it } from 'vitest';
import { CULL_QUANT, quantizeRect } from '../src/render/viewportQuant.js';

/** a 是否包含 b（含相切） */
function contains(a: { x: number; y: number; w: number; h: number }, b: typeof a): boolean {
  return a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h;
}

describe('quantizeRect', () => {
  it('非对齐矩形 → 量化结果是原矩形的外扩超集（四向都向外取整）', () => {
    const r = { x: 300, y: -100, w: 500, h: 200 };
    const q = quantizeRect(r, 256);
    expect(contains(q, r)).toBe(true);
    // 边界贴到网格：x/y 向下取整、右/下向上取整
    expect(q.x).toBe(256);
    expect(q.y).toBe(-256);
    expect(q.x + q.w).toBe(1024);
    expect(q.y + q.h).toBe(256);
  });

  it('已对齐网格的矩形 → 原样（不变形）', () => {
    const r = { x: 256, y: -512, w: 512, h: 256 };
    expect(quantizeRect(r, 256)).toEqual(r);
  });

  it('负坐标方向同样向外（floor/ceil 语义）', () => {
    const r = { x: -200, y: -1, w: 10, h: 10 };
    const q = quantizeRect(r, 256);
    expect(contains(q, r)).toBe(true);
    expect(q.x).toBe(-256);
    expect(q.y).toBe(-256);
  });

  it('稳定窗：矩形在网格内平移（不跨线）→ 量化结果恒定', () => {
    const a = quantizeRect({ x: 100, y: 0, w: 50, h: 50 }, 256);
    const b = quantizeRect({ x: 180, y: 0, w: 50, h: 50 }, 256);
    const c = quantizeRect({ x: 100, y: 0, w: 50, h: 50 }, 256);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('跨网格线 → 量化窗口变化（每 256 一次）', () => {
    const a = quantizeRect({ x: 100, y: 0, w: 50, h: 50 }, 256);
    const b = quantizeRect({ x: 300, y: 0, w: 50, h: 50 }, 256);
    expect(b).not.toEqual(a);
    expect(b.x - a.x).toBe(256);
  });

  it('CULL_QUANT 导出为 256（与 CULL_MARGIN=128 同量级）', () => {
    expect(CULL_QUANT).toBe(256);
  });

  it('q ≤ 0 / NaN 防护 → 原样返回（不产生 NaN 矩形）', () => {
    const r = { x: 1, y: 2, w: 3, h: 4 };
    expect(quantizeRect(r, 0)).toEqual(r);
    expect(quantizeRect(r, -256)).toEqual(r);
    expect(quantizeRect(r, NaN)).toEqual(r);
  });

  it('零宽/零高矩形 → 仍为超集（尺寸非负）', () => {
    const r = { x: 100, y: 100, w: 0, h: 0 };
    const q = quantizeRect(r, 256);
    expect(contains(q, r)).toBe(true);
    expect(q.w).toBeGreaterThanOrEqual(0);
    expect(q.h).toBeGreaterThanOrEqual(0);
  });
});
