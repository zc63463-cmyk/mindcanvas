/**
 * 连线自然度（P0+P1 深度优化）—— 规范 S 形 / 书签位锚点 / 平行错位 / 长度自适应弓向。
 *
 * 背景（docs/2026-09-04 调研结论）：成熟产品（Obsidian Canvas / React Flow / markvault MindFlow）
 * 把「锚点是语义端口、曲线是显式形状语言」当作自然度的根基；
 * 此前的 routeAesthetic 逐边贪心评分导致锚点在卡片四边漂移、曲率鼓向随机、平出平入缺失。
 *
 * 本批契约（TDD 先行的验收标尺）：
 * 1. `semanticAnchorPair(a, b, stagger)` —— 按相对位置产出「书签位」锚点对 + 进出方向：
 *    水平对齐 → 右缘中点 → 左缘中点；垂直对齐 → 下中点 → 上中点。
 *    stagger 沿「垂直 / 水平」轴反向错位（平行入边不重叠），步长 = 盒边长 × 0.125。
 * 2. `tangentSBezier(p0, dir0, p3, dir3, beta)` —— 端点切向语义化的三次贝塞尔：
 *    控制点沿进出方向伸展 max(弦距 × beta, 20) → 平出平入的 S 形。
 * 3. `routeAesthetic` 默认走『语义锚对 + 小曲率』优先：可接受解应从书签位锚点出发、
 *    首段切向水平（水平流）或垂直（垂直流），而不是对角锚 + 甩出大弧。
 * 4. `anchorStagger` 选项：平行入边逐条错位，端点坐标随 stagger 单调变化。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BLOCK_PADDING,
  polylineHitsObstacle,
  routeAesthetic,
  semanticAnchorPair,
  tangentSBezier,
  type RouteObstacle,
} from '../src/render/edgeRouting.js';

function box(x: number, y: number, w = 100, h = 32): { x: number; y: number; w: number; h: number } {
  return { x, y, w, h };
}

/** 采样 SVG path（M/L/Q/C 全支持）为折线 —— 与 edge-routing.test.ts 同款 */
function dense(d: string): { x: number; y: number }[] {
  const cmds = d.match(/[MLCQ][^MLCQ]*/g) ?? [];
  let cur: { x: number; y: number } | null = null;
  const out: { x: number; y: number }[] = [];
  for (const c of cmds) {
    const n = c
      .slice(1)
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    const head = c[0];
    if (head === 'M') {
      cur = { x: n[0]!, y: n[1]! };
      out.push(cur);
    } else if (head === 'L') {
      const p = { x: n[0]!, y: n[1]! };
      for (let k = 1; k <= 8; k++) out.push({ x: cur!.x + (p.x - cur!.x) * (k / 8), y: cur!.y + (p.y - cur!.y) * (k / 8) });
      cur = p;
    } else if (head === 'C') {
      const c1 = { x: n[0]!, y: n[1]! };
      const c2 = { x: n[2]!, y: n[3]! };
      const p = { x: n[4]!, y: n[5]! };
      for (let k = 1; k <= 8; k++) {
        const t = k / 8;
        const u = 1 - t;
        out.push({
          x: u * u * u * cur!.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p.x,
          y: u * u * u * cur!.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p.y,
        });
      }
      cur = p;
    }
  }
  return out;
}

describe('semanticAnchorPair：书签位语义锚点', () => {
  it('水平对齐（目标在右）→ 源右缘中点 → 靶左缘中点，进出方向水平相对', () => {
    const a = box(0, 100);
    const b = box(400, 100);
    const { p0, dir0, p3, dir3 } = semanticAnchorPair(a, b);
    expect(p0.x).toBeCloseTo(a.x + a.w); // 源右缘
    expect(p0.y).toBeCloseTo(a.y + a.h / 2); // 中点
    expect(p3.x).toBeCloseTo(b.x); // 靶左缘
    expect(p3.y).toBeCloseTo(b.y + b.h / 2);
    expect(dir0).toEqual({ x: 1, y: 0 });
    expect(dir3).toEqual({ x: -1, y: 0 });
  });

  it('水平对齐（目标在左）→ 方向镜像', () => {
    const a = box(400, 100);
    const b = box(0, 100);
    const { p0, dir0, p3, dir3 } = semanticAnchorPair(a, b);
    expect(p0.x).toBeCloseTo(a.x); // 源左缘
    expect(dir0).toEqual({ x: -1, y: 0 });
    expect(dir3).toEqual({ x: 1, y: 0 });
  });

  it('垂直对齐（目标在下）→ 源下中点 → 靶上中点，进出方向垂直相对', () => {
    const a = box(100, 0);
    const b = box(100, 400);
    const { p0, dir0, p3, dir3 } = semanticAnchorPair(a, b);
    expect(p0.y).toBeCloseTo(a.y + a.h); // 源下缘
    expect(p0.x).toBeCloseTo(a.x + a.w / 2);
    expect(p3.y).toBeCloseTo(b.y); // 靶上缘
    expect(p3.x).toBeCloseTo(b.x + b.w / 2);
    expect(dir0).toEqual({ x: 0, y: 1 });
    expect(dir3).toEqual({ x: 0, y: -1 });
  });

  it('stagger 沿垂直轴反向错位（步长 = 盒高 × 0.0625），多次错位单调', () => {
    const a = box(0, 100);
    const b = box(400, 100);
    const s0 = semanticAnchorPair(a, b, 0);
    const s1 = semanticAnchorPair(a, b, 1);
    const s2 = semanticAnchorPair(a, b, 2);
    const step = (a.h * 0.125) / 2; // 32 × 0.0625 = 2（半档，防出盒内缩）
    expect(s1.p0.y - s0.p0.y).toBeCloseTo(step);
    expect(s2.p0.y - s1.p0.y).toBeCloseTo(step);
    // 靶端反向错位（平行入边对称展开，不重叠）
    expect(s1.p3.y - s0.p3.y).toBeCloseTo(-step);
    expect(s2.p3.y - s1.p3.y).toBeCloseTo(-step);
  });
});

describe('tangentSBezier：平出平入规范 S 形', () => {
  it('水平进出 → 控制点与端点同 y（首段切向水平/末段切向水平）', () => {
    const p0 = { x: 300, y: 216 };
    const p3 = { x: 400, y: 216 };
    const r = tangentSBezier(p0, { x: 1, y: 0 }, p3, { x: -1, y: 0 });
    expect(r.c1.y).toBeCloseTo(p0.y);
    expect(r.c2.y).toBeCloseTo(p3.y);
    // 伸展量 = 弦距 × beta，受 20px 下限保护
    expect(r.c1.x - p0.x).toBeCloseTo(Math.max(20, 100 * 0.4));
  });

  it('垂直进出 → 控制点与端点同 x', () => {
    const p0 = { x: 0, y: 0 };
    const p3 = { x: 0, y: 100 };
    const r = tangentSBezier(p0, { x: 0, y: 1 }, p3, { x: 0, y: -1 });
    expect(r.c1.x).toBeCloseTo(p0.x);
    expect(r.c2.x).toBeCloseTo(p3.x);
  });

  it('短弦 → 伸展量受下限保护（不低于 20px）', () => {
    const r = tangentSBezier({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 10, y: 0 }, { x: -1, y: 0 });
    expect(r.c1.x).toBeCloseTo(20);
  });

  it('中点位于两控制点之间、且法向单位化', () => {
    const r = tangentSBezier({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 100, y: 0 }, { x: -1, y: 0 });
    expect(r.mid.x).toBeGreaterThan(r.c1.x);
    expect(r.mid.x).toBeLessThan(r.c2.x);
    expect(Math.hypot(r.nx, r.ny)).toBeCloseTo(1);
  });
});

describe('routeAesthetic：语义锚优先 + 书签位 + 平出平入（P0/P1）', () => {
  /**
   * 「书签位带」判定：起点应落在源盒四条边的中点一带（×0.38 边长范围），
   * 而不是随目标中心方向漂移到对角/角落。这是锚点语义化的核心契约。
   */
  const isBookmarkBand = (p: { x: number; y: number }, b: { x: number; y: number; w: number; h: number }): boolean => {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const onLeftOrRight =
      Math.abs(p.x - b.x) < b.w * 0.12 && Math.abs(p.y - cy) < b.h * 0.38;
    const onRightV =
      Math.abs(p.x - (b.x + b.w)) < b.w * 0.12 && Math.abs(p.y - cy) < b.h * 0.38;
    const onTop = Math.abs(p.y - b.y) < b.h * 0.12 && Math.abs(p.x - cx) < b.w * 0.38;
    const onBottom =
      Math.abs(p.y - (b.y + b.h)) < b.h * 0.12 && Math.abs(p.x - cx) < b.w * 0.38;
    return onLeftOrRight || onRightV || onTop || onBottom;
  };

  it('无障碍 → 仍直连（不因新机制引入无谓弯曲）', () => {
    const a = box(0, 200);
    const b = box(400, 200);
    const r = routeAesthetic(a, b, []);
    expect(r.routed).toBe(false);
    expect(r.d).not.toContain('C');
  });

  it('高墙挡直连 → 绕行不穿障，且起点落在书签位边带（锚不随目标中心对角漂移）', () => {
    const a = box(0, 200);
    const b = box(400, 200);
    const wall: RouteObstacle = box(200, -100, 40, 600);
    const r = routeAesthetic(a, b, [wall]);
    expect(r.routed).toBe(true);
    expect(polylineHitsObstacle(dense(r.d), [wall], DEFAULT_BLOCK_PADDING)).toBe(false);
    const m = r.d.match(/^M ([\d.]+) ([\d.-]+) /);
    expect(m).not.toBeNull();
    const sx = Number(m![1]);
    const sy = Number(m![2]);
    expect(isBookmarkBand({ x: sx, y: sy }, a)).toBe(true);
  });

  it('垂直流：被中间障碍隔开 → 绕行不穿障，起点落在书签位边带', () => {
    const a = box(100, 0, 100, 32);
    const b = box(100, 400, 100, 32);
    const wall: RouteObstacle = box(80, 190, 160, 40);
    const r = routeAesthetic(a, b, [wall]);
    expect(r.routed).toBe(true);
    expect(polylineHitsObstacle(dense(r.d), [wall], DEFAULT_BLOCK_PADDING)).toBe(false);
    const m = r.d.match(/^M ([\d.]+) ([\d.-]+) /);
    expect(m).not.toBeNull();
    expect(isBookmarkBand({ x: Number(m![1]), y: Number(m![2]) }, a)).toBe(true);
  });

  // 平行错位（stagger）的验收在 FreeEdgeLayer 集成层：两条入边指向同一节点
  // 时渲染出的路径必须错开（见 free-edges / 集成用例）。

  it('anchorStagger：无碍直连时按语义锚错位（平行入边不重叠）', () => {
    const a = box(0, 200);
    const b = box(400, 200);
    const r0 = routeAesthetic(a, b, [], [], { anchorStagger: 0 });
    const r1 = routeAesthetic(a, b, [], [], { anchorStagger: 1 });
    expect(r0.d).not.toBe(r1.d);
    expect(r1.d).toContain('L'); // 直连保持
    const m1 = r1.d.match(/^M ([\d.]+) ([\d.-]+) /);
    // stagger 1：源锚 = 右缘中点下移半档（a.y + h/2 + h×0.0625 = 218）
    expect(Number(m1![2])).toBeCloseTo(a.y + a.h / 2 + a.h * 0.0625);
    // 与未错位的 r0 起点不同（错位生效）
    const m0 = r0.d.match(/^M ([\d.]+) ([\d.-]+) /);
    expect(Number(m1![2])).not.toBeCloseTo(Number(m0![2]));
  });

  it('高墙 + forceSide 定侧：左/右鼓向被锁定，mid 分居弦两侧', () => {
    const a = box(0, 200);
    const b = box(400, 200);
    const wall: RouteObstacle = box(200, -100, 40, 600);
    const left = routeAesthetic(a, b, [wall], [], { forceSide: 'left' });
    const right = routeAesthetic(a, b, [wall], [], { forceSide: 'right' });
    expect(left.d).not.toBe('');
    expect(right.d).not.toBe('');
    const midOf = (d: string) => {
      const pts = dense(d);
      return pts[Math.floor(pts.length / 2)]!;
    };
    // 水平流：forceSide 'left' → 向上鼓（mid.y 低于语义弦起点 y）；'right' → 向下鼓
    const startY = dense(left.d)[0]!.y;
    const lm = midOf(left.d);
    const rm = midOf(right.d);
    expect(lm.y).toBeLessThan(startY);
    expect(rm.y).toBeGreaterThan(startY);
    // 两侧必须分居明显（至少一个盒高 1/2 ≈ 16px）
    expect(Math.abs(rm.y - lm.y)).toBeGreaterThan(16);
    // 定侧后两侧都不得穿障
    expect(polylineHitsObstacle(dense(left.d), [wall], DEFAULT_BLOCK_PADDING)).toBe(false);
    expect(polylineHitsObstacle(dense(right.d), [wall], DEFAULT_BLOCK_PADDING)).toBe(false);
  });
});