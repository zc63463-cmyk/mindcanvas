import { describe, expect, it } from 'vitest';
import { isBoxInView, worldViewportRect } from '../src/layout/cull.js';

describe('layout/cull：视口裁剪（世界坐标可见矩形 + AABB 相交）', () => {
  it('worldViewportRect：由 transform 反推可见世界矩形', () => {
    // k=1、无偏移：可见世界 [0,0]-[100,80]
    expect(worldViewportRect({ k: 1, x: 0, y: 0 }, 100, 80)).toEqual({ x: 0, y: 0, w: 100, h: 80 });
    // k=0.5、偏移 (100,50)：世界宽高放大 2 倍，起点回推
    const r = worldViewportRect({ k: 0.5, x: 100, y: 50 }, 100, 80);
    expect(r.x).toBeCloseTo(-200, 6);
    expect(r.y).toBeCloseTo(-100, 6);
    expect(r.w).toBeCloseTo(200, 6);
    expect(r.h).toBeCloseTo(160, 6);
  });

  it('isBoxInView：标准相交/不相交判定 + margin 外扩', () => {
    const view = { x: 0, y: 0, w: 100, h: 80 };
    expect(isBoxInView({ x: 10, y: 10, w: 30, h: 20 }, view)).toBe(true);
    expect(isBoxInView({ x: 200, y: 10, w: 30, h: 20 }, view)).toBe(false);
    // margin 外扩：超出 40px 内被视为可见（防滚动跳变）
    expect(isBoxInView({ x: 130, y: 10, w: 30, h: 20 }, view, 40)).toBe(true);
    expect(isBoxInView({ x: 150, y: 10, w: 30, h: 20 }, view, 40)).toBe(false);
  });

  it('视图在盒子中间（大视口包含小盒子）→ 可见', () => {
    expect(isBoxInView({ x: 40, y: 30, w: 10, h: 10 }, { x: 0, y: 0, w: 100, h: 100 })).toBe(true);
  });
});
