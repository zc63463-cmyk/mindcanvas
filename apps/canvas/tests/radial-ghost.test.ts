/**
 * ghostBoxOf：幽灵落点纯函数（v1.8.0 Phase 3 ①）。
 * 锁定四向间距（H_GAP/V_GAP × k）与视口内收（决策 A1）。
 */
import { describe, expect, it } from 'vitest';
import { ghostBoxOf } from '../src/radialGhost';

const nb = { x: 400, y: 300, w: 120, h: 30, k: 1 };

describe('ghostBoxOf · 四向落点', () => {
  it('right/left 隔 H_GAP（64 × k）', () => {
    expect(ghostBoxOf(nb, 'right', 1024, 768).x).toBe(400 + 120 + 64);
    expect(ghostBoxOf(nb, 'left', 1024, 768).x).toBe(400 - 120 - 64);
  });

  it('down/up 隔 V_GAP（14 × k）', () => {
    expect(ghostBoxOf(nb, 'down', 1024, 768).y).toBe(300 + 30 + 14);
    expect(ghostBoxOf(nb, 'up', 1024, 768).y).toBe(300 - 30 - 14);
  });

  it('缩放 k 参与间距折算', () => {
    const zoomed = { ...nb, k: 2 };
    expect(ghostBoxOf(zoomed, 'right', 2048, 1536).x).toBe(400 + 120 + 128);
  });
});

describe('ghostBoxOf · 视口内收（A1）', () => {
  it('贴右缘/上缘 → 收进 EDGE_PAD', () => {
    const g = ghostBoxOf({ ...nb, x: 990, y: -20 }, 'right', 1024, 768);
    expect(g.x + g.w).toBeLessThanOrEqual(1024 - 8);
    expect(g.y).toBeGreaterThanOrEqual(8);
  });

  it('视口比盒还小 → 尽力值（不产生 NaN/负值）', () => {
    const g = ghostBoxOf({ ...nb, w: 2000, h: 1000 }, 'right', 800, 600);
    expect(Number.isFinite(g.x)).toBe(true);
    expect(Number.isFinite(g.y)).toBe(true);
    expect(g.x).toBe(8);
    expect(g.y).toBe(8);
  });
});
