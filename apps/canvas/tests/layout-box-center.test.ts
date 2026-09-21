/**
 * PROMOTE-SEED-1：共享布局取点纯函数单测
 * （升格落点 / 切断落点同口径：{ x: box.x + w/2, y: box.y + h/2 }）。
 */
import { describe, expect, it } from 'vitest';
import { layoutBoxCenterOf } from '../src/layoutBoxCenter.js';

const layout = {
  nodes: [
    { node: { id: 'a' }, box: { x: 100, y: 50, w: 60, h: 40 } },
    { node: { id: 'b' }, box: { x: -20, y: -10, w: 10, h: 10 } },
  ],
};

describe('layoutBoxCenterOf', () => {
  it('命中 → 盒中心（x + w/2, y + h/2）', () => {
    expect(layoutBoxCenterOf(layout, 'a')).toEqual({ x: 130, y: 70 });
    expect(layoutBoxCenterOf(layout, 'b')).toEqual({ x: -15, y: -5 });
  });

  it('未命中（折叠隐藏 / 未入 layout）→ undefined', () => {
    expect(layoutBoxCenterOf(layout, 'missing')).toBeUndefined();
  });

  it('空布局 → undefined', () => {
    expect(layoutBoxCenterOf({ nodes: [] }, 'a')).toBeUndefined();
  });
});
