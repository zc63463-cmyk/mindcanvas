/**
 * P1-3 · manual 手动路径形状语言统一。
 *
 * 问题：自动路由已迁移到「语义锚 + 相切 S 形」（semanticAnchorPair + tangentSBezier），
 * 而手动锁定（edge.manual）仍用旧「法向弓」（bezierFromAnchors）——用户首次拖 bend/端点
 * 后曲线形状瞬间跳变，观感断裂。
 *
 * 契约：
 * - 手动无细节（未拖端点）时落点/进出方向 = 语义锚（与自动路由完全同款，贴边而非中心拉线）
 * - manual.from/to 覆盖落点，进出方向按落点所在边推断（左右/上下缘）
 * - curvature 语义保留为「侧向弓」：控制点沿弦法向平移，弯度量级与原行为一致
 *   （curvature=0 → 纯 S 形；mid 侧移 = 0.75 × chord × curvature）
 */
import { describe, expect, it } from 'vitest';
import { manualAnchors, manualBezier, sideDirOf } from '../src/render/edgeRouting.js';

describe('manualBezier：相切基形 + 侧向弓', () => {
  const p0 = { x: 100, y: 15 };
  const p3 = { x: 500, y: 15 };
  const RIGHT = { x: 1, y: 0 };
  const LEFT = { x: -1, y: 0 };

  it('curvature=0 → 纯 S 形：控制点沿进出方向相切，mid 无侧移', () => {
    const b = manualBezier(p0, RIGHT, p3, LEFT, 0);
    expect(b.c1.x).toBeGreaterThan(p0.x); // 相切平出（+x）
    expect(b.c2.x).toBeGreaterThan(p3.x); // 相切平入（p3 左缘，控制点向右外伸）
    expect(b.c1.y).toBe(p0.y);
    expect(b.c2.y).toBe(p3.y);
    expect(b.mid.y).toBe(15); // 无侧移
    expect(b.mid.x).toBeGreaterThan(300); // S 形沿切向自然外展（控制点外伸所致）
  });

  it('curvature>0 → 控制点沿弦法向 (-dy,dx) 平移；mid 侧移 = 0.75×chord×c', () => {
    const b = manualBezier(p0, RIGHT, p3, LEFT, 0.3);
    // 水平边：dy=0 → 法向 (0,1) 向下，弯向下方
    expect(b.c1.y).toBe(15 + 400 * 0.3);
    expect(b.c2.y).toBe(15 + 400 * 0.3);
    expect(b.mid.y).toBeCloseTo(15 + 0.75 * 400 * 0.3, 6);
    expect(b.mid.x).toBeCloseTo(420, 6); // 与 S 形基形一致（控制点外伸不因弓而变 x）
  });

  it('curvature<0 → 反向侧移（向上）', () => {
    const b = manualBezier(p0, RIGHT, p3, LEFT, -0.2);
    expect(b.mid.y).toBeCloseTo(15 - 0.75 * 400 * 0.2, 6);
  });

  it('curvature 不为 0 时端点仍相切（端点不动，整体侧弓）', () => {
    const b = manualBezier(p0, RIGHT, p3, LEFT, 0.5);
    expect(b.c1.x).toBe(p0.x + 160); // ext = max(400*0.4, 20) = 160，弓只改 y
    expect(b.c1.y).toBe(p0.y + 400 * 0.5);
  });
});

describe('sideDirOf：归一化落点 → 进出方向', () => {
  it('按主导轴判定边：右半区 → 右；左半区 → 左；上半 → 上；下半 → 下', () => {
    expect(sideDirOf({ x: 0.9, y: 0.5 })).toEqual({ x: 1, y: 0 });
    expect(sideDirOf({ x: 0.1, y: 0.5 })).toEqual({ x: -1, y: 0 });
    expect(sideDirOf({ x: 0.5, y: 0.9 })).toEqual({ x: 0, y: 1 });
    expect(sideDirOf({ x: 0.5, y: 0.1 })).toEqual({ x: 0, y: -1 });
  });
  it('中心回落 → 右（不返回非法零向量），角点时按主导轴归边', () => {
    expect(sideDirOf({ x: 0.5, y: 0.5 })).toEqual({ x: 1, y: 0 });
    expect(sideDirOf({ x: 0.9, y: 0.9 })).toEqual({ x: 1, y: 0 }); // 水平主导（px 0.4 = py 0.4 平局 → 水平优先）
    expect(sideDirOf({ x: 0.4, y: 0.95 })).toEqual({ x: 0, y: 1 }); // 垂直主导（py 0.45 > px 0.1）→ 下
  });
});

describe('manualAnchors：语义锚基形 + 手动覆盖', () => {
  const from = { x: 0, y: 0, w: 100, h: 30 };
  const to = { x: 500, y: 0, w: 100, h: 30 };

  it('无手动细节 → 落点/方向 = 语义锚（右缘中点 → 左缘中点，贴边而非中心拉线）', () => {
    const a = manualAnchors(from, to);
    expect(a.p0).toEqual({ x: 100, y: 15 }); // 右缘中点
    expect(a.p3).toEqual({ x: 500, y: 15 }); // 左缘中点
    expect(a.dir0).toEqual({ x: 1, y: 0 });
    expect(a.dir3).toEqual({ x: -1, y: 0 });
  });

  it('manual.from 覆盖落点（左缘附近）→ 落点移动到归一化位置，方向随边', () => {
    const a = manualAnchors(from, to, { x: 0.2, y: 0.5 });
    expect(a.p0).toEqual({ x: 20, y: 15 });
    expect(a.dir0).toEqual({ x: -1, y: 0 }); // 左半区 → 左出
    expect(a.p3).toEqual({ x: 500, y: 15 }); // to 未设 → 语义锚
    expect(a.dir3).toEqual({ x: -1, y: 0 });
  });

  it('manual.to 覆盖 + 垂直主导盒 → 上下缘方向', () => {
    const below = { x: 0, y: 300, w: 60, h: 20 };
    const a = manualAnchors(from, below, undefined, { x: 0.5, y: 0.1 });
    expect(a.p3).toEqual({ x: 30, y: 302 }); // below.x + 60*0.5, below.y + 20*0.1
    expect(a.dir3).toEqual({ x: 0, y: -1 }); // 上半区 → 上入
  });
});