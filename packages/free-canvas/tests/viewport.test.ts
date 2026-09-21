import { describe, expect, it } from 'vitest';
import { clampScale, screenToWorld, zoomAt } from '../src/index.js';

describe('viewport', () => {
  it('clampScale', () => {
    expect(clampScale(0.01)).toBe(0.15);
    expect(clampScale(10)).toBe(4);
    expect(clampScale(1)).toBe(1);
  });

  it('zoomAt 保持锚点世界坐标', () => {
    const vp = { panX: 100, panY: 50, scale: 1 };
    const sx = 200;
    const sy = 150;
    const before = screenToWorld(sx, sy, vp);
    const next = zoomAt(vp, sx, sy, 2);
    const after = screenToWorld(sx, sy, next);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(next.scale).toBe(2);
  });
});
