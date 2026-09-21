import { describe, expect, it } from 'vitest';
import { fitIntoView } from '../src/layout/fit.js';

describe('layout/fit：适配视口（fit-to-window / Ctrl+0）', () => {
  it('大图缩放至填满：取 min 横/纵比例并居中，含留白系数', () => {
    const t = fitIntoView(
      { x: 0, y: 0, w: 2000, h: 1000 },
      { w: 1000, h: 800 },
      { max: 2, pad: 0.9 },
    );
    expect(t.k).toBeCloseTo(0.45, 6);
    expect(t.x).toBeCloseTo(50, 6);
    expect(t.y).toBeCloseTo(175, 6);
  });

  it('小图不超过 max 缩放上限', () => {
    const t = fitIntoView(
      { x: 0, y: 0, w: 100, h: 100 },
      { w: 1000, h: 800 },
      { max: 1.5, pad: 0.9 },
    );
    expect(t.k).toBe(1.5);
  });

  it('非零原点内容居中：平移量 = 视口中心 − 内容中心(缩放后)', () => {
    const t = fitIntoView(
      { x: 100, y: 50, w: 200, h: 100 },
      { w: 800, h: 600 },
      { max: 2, pad: 1 },
    );
    // fill = min(800/200, 600/100) = 4 → 受 max 截断 2
    expect(t.k).toBe(2);
    expect(t.x).toBeCloseTo(0, 6);
    expect(t.y).toBeCloseTo(100, 6);
  });

  it('空视口或空内容不产生 NaN（回退 k=1 原心）', () => {
    const t = fitIntoView({ x: 0, y: 0, w: 0, h: 0 }, { w: 800, h: 600 });
    expect(Number.isFinite(t.k)).toBe(true);
    expect(Number.isFinite(t.x)).toBe(true);
    expect(Number.isFinite(t.y)).toBe(true);
  });
});
