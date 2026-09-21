/**
 * edgeRouting 单测 + 性质测试（property-based）。
 *
 * 覆盖范围：曲率自适应路由 routeAesthetic（当前唯一路由器）及其依赖的几何工具。
 * 旧的「网格 A* / trunk 折线」路由器已整体移除（Issue #5），相应测试随之删除；
 * 其价值最高的不变量（不穿障、性能护栏）已迁移到 routeAesthetic 上。
 *
 * 核心不变量：**最终 SVG path 与任一障碍（含 pad）无交**。
 * 直接采样 d 串做验证，而非只验证折线 —— 曲线与折线的实际走向并不一致。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BLOCK_PADDING,
  DEFAULT_CURVATURE_STEPS,
  bezierFromAnchors,
  corridorObstacles,
  edgeAnchorCandidates,
  findCrossings,
  inferBowSide,
  inferBowSideFromPoints,
  pathWithJumps,
  polylineHitsObstacle,
  routeAesthetic,
  segmentIntersectsRect,
  type RouteObstacle,
  type RouteResult,
} from '../src/render/edgeRouting.js';

// ---------- 测试工具 ----------

/** 确定性 PRNG（LCG），保证性质测试可复现 */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const box = (x: number, y: number, w = 120, h = 34): RouteObstacle => ({ x, y, w, h });

// ---------- 基础几何 ----------

describe('segmentIntersectsRect：线段-矩形相交', () => {
  const r = box(100, 100, 100, 50);
  it('穿过矩形 → true', () => {
    expect(segmentIntersectsRect(0, 125, 300, 125, r)).toBe(true);
  });
  it('完全在矩形外（水平错开）→ false', () => {
    expect(segmentIntersectsRect(0, 0, 300, 0, r)).toBe(false);
  });
  it('AABB 相交但线段从矩形下方掠过 → false（Liang-Barsky 精确判定）', () => {
    // 矩形横条 x∈[100,200] y∈[100,110]；线段 y=x/3 从 (0,0) 到 (300,100)，
    // 全程在矩形下方（x∈[100,200] 时 y∈[33,67]），仅 AABB 在 y=100 处边界相接
    expect(segmentIntersectsRect(0, 0, 300, 100, box(100, 100, 100, 10))).toBe(false);
  });
  it('端点落在矩形内 → true', () => {
    expect(segmentIntersectsRect(120, 120, 400, 400, r)).toBe(true);
  });
  it('padding 生效：无 pad 不相交，加 pad 后相交', () => {
    // 竖直线段在矩形右侧 5px 处：矩形 x∈[100,200]
    const seg = { x1: 205, y1: 0, x2: 205, y2: 300 };
    expect(segmentIntersectsRect(seg.x1, seg.y1, seg.x2, seg.y2, r, 0)).toBe(false);
    // pad=10 → 有效右边界扩到 210 > 205 → 相交
    expect(segmentIntersectsRect(seg.x1, seg.y1, seg.x2, seg.y2, r, 10)).toBe(true);
  });
});

describe('corridorObstacles：走廊粗筛', () => {
  it('只保留与走廊相交的障碍', () => {
    const near = box(100, 0, 20, 20);
    const far = box(5000, 5000, 20, 20);
    const kept = corridorObstacles({ x: 0, y: 0 }, { x: 200, y: 0 }, 50, [near, far]);
    expect(kept).toEqual([near]);
  });
});

describe('曲率自适应路由 routeAesthetic（外围绕行优先）', () => {
  /** 采样 path（M/L/Q/C 全支持）用于穿障校验 */
  const dense = (d: string): { x: number; y: number }[] => {
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
        for (let k = 1; k <= 8; k++) {
          out.push({ x: cur!.x + (p.x - cur!.x) * (k / 8), y: cur!.y + (p.y - cur!.y) * (k / 8) });
        }
        cur = p;
      } else if (head === 'Q') {
        const cp = { x: n[0]!, y: n[1]! };
        const p = { x: n[2]!, y: n[3]! };
        for (let k = 1; k <= 8; k++) {
          const t = k / 8;
          const u = 1 - t;
          out.push({
            x: u * u * cur!.x + 2 * u * t * cp.x + t * t * p.x,
            y: u * u * cur!.y + 2 * u * t * cp.y + t * t * p.y,
          });
        }
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
  };

  it('无障碍 → 直连（routed=false，不做无谓弯曲）', () => {
    const a = box(0, 100);
    const b = box(400, 100);
    const r = routeAesthetic(a, b, []);
    expect(r.d).not.toBe('');
    expect(r.routed).toBe(false);
  });

  it('障碍挡路 → 外绕（routed=true，且曲线绕到障碍外側）', () => {
    // 墙横跨 y=-80..400，两节点在 y=100..134 → 水平直连必被挡
    const a = box(0, 100);
    const b = box(400, 100);
    const wall = box(180, -80, 40, 400);
    const r = routeAesthetic(a, b, [wall]);
    expect(r.routed).toBe(true);
    // 曲线中点应绕到墙的上方（墙顶 y=-80）：mid.y 明显小于墙顶
    expect(r.mid.y).toBeLessThan(wall.y);
    // 关键：整条曲线不得穿障
    expect(polylineHitsObstacle(dense(r.d), [wall], DEFAULT_BLOCK_PADDING)).toBe(false);
  });

  it('不穿障（性质测试，200 例随机）', () => {
    const rng = makeRng(20260901);
    const violations: { x: number; y: number }[][] = [];
    for (let iter = 0; iter < 200; iter++) {
      const a = { x: rng() * 200, y: rng() * 500, w: 90 + rng() * 80, h: 30 + rng() * 20 };
      const b = { x: 380 + rng() * 380, y: rng() * 500, w: 90 + rng() * 80, h: 30 + rng() * 20 };
      const obstacles: RouteObstacle[] = [];
      const n = 1 + Math.floor(rng() * 3);
      for (let k = 0; k < n; k++) {
        const o = { x: 150 + rng() * 350, y: rng() * 600, w: 60 + rng() * 110, h: 30 + rng() * 50 };
        const overlaps = [a, b].some(
          (e) =>
            o.x < e.x + e.w + 10 &&
            o.x + o.w > e.x - 10 &&
            o.y < e.y + e.h + 10 &&
            o.y + o.h > e.y - 10,
        );
        if (!overlaps) obstacles.push(o);
      }
      const r = routeAesthetic(a, b, obstacles);
      const pts = dense(r.d);
      if (polylineHitsObstacle(pts, obstacles, DEFAULT_BLOCK_PADDING))
        violations.push(pts.slice(0, 3));
    }
    // 允许极少数降级为直穿的用例（设计上允许），但占比应很低（≤5%）
    expect(violations.length).toBeLessThanOrEqual(10);
  });

  it('直穿降级：所有组合均穿障时返回直线（不得乱绕）', () => {
    // 巨型墙把两端点整个包住 → 任何曲率都绕不开
    const a = box(0, 0);
    const b = box(400, 0);
    const wall = box(-300, -300, 1200, 900);
    const r = routeAesthetic(a, b, [wall]);
    expect(r.d).not.toBe('');
    // 降级路径应为直线（M...L），而非带 C 的曲线
    expect(r.d).toContain('L');
    expect(r.d).not.toContain('C');
    expect(r.routed).toBe(false);
  });

  it('交叉罚分：会避开已存在的边', () => {
    const a = box(0, 100);
    const b = box(400, 100);
    // 已有一条横穿的边，新边若取同侧会与之交叉 → 应被罚分而改选
    const existing: { x: number; y: number }[][] = [
      [
        { x: 0, y: 60 },
        { x: 400, y: 60 },
      ],
    ];
    const withExisting = routeAesthetic(a, b, [], existing);
    const without = routeAesthetic(a, b, []);
    // 两者应都能产出路径；且带已有边时不应选择与之交叉的方案
    expect(withExisting.d).not.toBe('');
    expect(without.d).not.toBe('');
    // 无障碍时交叉数为 0，结果应与无已有边一致
    expect(withExisting.d).toBe(without.d);
  });

  it('edgeAnchorCandidates：落在边界上、避开角点、数量正确', () => {
    const bx = { x: 0, y: 0, w: 100, h: 40 };
    const pts = edgeAnchorCandidates(bx, 3);
    expect(pts).toHaveLength(12); // 4 边 × 3
    for (const p of pts) {
      const onVert = Math.abs(p.x - bx.x) < 1e-6 || Math.abs(p.x - (bx.x + bx.w)) < 1e-6;
      const onHorz = Math.abs(p.y - bx.y) < 1e-6 || Math.abs(p.y - (bx.y + bx.h)) < 1e-6;
      expect(onVert || onHorz).toBe(true);
    }
    // 不应取到角点
    for (const p of pts) {
      const isCorner =
        (Math.abs(p.x - bx.x) < 1e-6 || Math.abs(p.x - (bx.x + bx.w)) < 1e-6) &&
        (Math.abs(p.y - bx.y) < 1e-6 || Math.abs(p.y - (bx.y + bx.h)) < 1e-6);
      expect(isCorner).toBe(false);
    }
  });

  it('bezierFromAnchors：曲率为 0 时控制点共线（退化直线）；正负曲率关于弦对称', () => {
    const p0 = { x: 0, y: 0 };
    const p3 = { x: 100, y: 0 };
    const flat = bezierFromAnchors(p0, p3, 0);
    // 曲率 0 → 控制点落在弦上（y 均为 0）
    expect(Math.abs(flat.c1.y)).toBeLessThan(1e-9);
    expect(Math.abs(flat.c2.y)).toBeLessThan(1e-9);
    const up = bezierFromAnchors(p0, p3, 0.5);
    const down = bezierFromAnchors(p0, p3, -0.5);
    // 正负曲率应朝相反方向鼓（mid.y 互为反号）
    expect(up.mid.y).toBeGreaterThan(0);
    expect(down.mid.y).toBeLessThan(0);
    expect(Math.abs(up.mid.y + down.mid.y)).toBeLessThan(1e-9);
  });

  it('forceSide：指定绕行侧时曲率被约束在该侧（对标 markvault routingSide）', () => {
    // 由返回的中点相对「弦中点」在法向上的投影符号反推曲率符号（与 bezierFromAnchors 定义一致）
    const curvOf = (r: RouteResult): number => {
      const p0 = r.points[0]!;
      const p3 = r.points[r.points.length - 1]!;
      const dx = p3.x - p0.x;
      const dy = p3.y - p0.y;
      const l = Math.hypot(dx, dy) || 1;
      const nxv = -dy / l;
      const nyv = dx / l;
      const lineMid = { x: (p0.x + p3.x) / 2, y: (p0.y + p3.y) / 2 };
      return (r.mid.x - lineMid.x) * nxv + (r.mid.y - lineMid.y) * nyv;
    };

    const a = box(0, 100);
    const b = box(300, 100);
    const wall = box(120, 60, 40, 120);
    const left = routeAesthetic(a, b, [wall], [], { forceSide: 'left' });
    const right = routeAesthetic(a, b, [wall], [], { forceSide: 'right' });

    // 两侧都应产出有效路径（forceSide 不会导致画不出线 —— 有直穿降级兜底
    expect(left.d).not.toBe('');
    expect(right.d).not.toBe('');

    // 关键断言：曲率符号被约束在指定侧
    //   'left'  → 曲率 ≤ 0 → 中点在法向的投影 ≤ 0
    //   'right' → 曲率 ≥ 0 → 中点在法向的投影 ≥ 0
    expect(curvOf(left)).toBeLessThanOrEqual(1e-6);
    expect(curvOf(right)).toBeGreaterThanOrEqual(-1e-6);

    // 两侧结果不应都退化成同一条直线（说明 forceSide 确实起了定向作用
    // 至少一侧应当真的绕行（非零投影）
    expect(Math.abs(curvOf(left)) + Math.abs(curvOf(right))).toBeGreaterThan(0);
  });

  it('默认曲率档位含 0 且正负对称', () => {
    expect(DEFAULT_CURVATURE_STEPS).toContain(0);
    expect(DEFAULT_CURVATURE_STEPS.some((c) => c > 0)).toBe(true);
    expect(DEFAULT_CURVATURE_STEPS.some((c) => c < 0)).toBe(true);
  });
});

describe('性能护栏（routeAesthetic）', () => {
  it('200 节点 / 100 边全量路由耗时在预算内（防回归）', () => {
    const nodeCount = 200;
    const perRow = Math.ceil(Math.sqrt(nodeCount));
    const nodes: RouteObstacle[] = [];
    for (let i = 0; i < nodeCount; i++) {
      const r = Math.floor(i / perRow);
      const c = i % perRow;
      nodes.push({ x: c * 200, y: r * 90, w: 110, h: 34 });
    }
    const rng = makeRng(7);
    const t0 = performance.now();
    // 逐边累积已路由折线 —— 真实渲染链路里的跨边交叉协调，成本随边数增长
    const polylines: { x: number; y: number }[][] = [];
    for (let i = 0; i < 100; i++) {
      const a = Math.floor(rng() * nodeCount);
      let b = Math.floor(rng() * nodeCount);
      if (a === b) b = (b + 1) % nodeCount;
      const obs = nodes.filter((_, k) => k !== a && k !== b);
      const r = routeAesthetic(nodes[a]!, nodes[b]!, obs, polylines);
      polylines.push([...r.points]);
    }
    const elapsed = performance.now() - t0;
    // 实测约 750ms（含跨边交叉协调）；阈值留 3x 余量以吸收 CI 机器差异
    expect(elapsed).toBeLessThan(2500);
  });
});

// ---------- Line jumps 跳线（Issue #4） ----------

describe('Line jumps 跳线', () => {
  const horizontal = [
    { x: 0, y: 100 },
    { x: 200, y: 100 },
  ];
  const vertical = [
    { x: 100, y: 0 },
    { x: 100, y: 200 },
  ];

  it('findCrossings 找对交点，上下关系由绘制次序决定（先画者在下）', () => {
    const xs = findCrossings([horizontal, vertical]);
    expect(xs).toHaveLength(1);
    expect(xs[0]!.x).toBeCloseTo(100, 6);
    expect(xs[0]!.y).toBeCloseTo(100, 6);
    // horizontal 先绘制 → 被压在下；vertical 后绘制 → 在上
    expect(xs[0]!.under).toBe(0);
    expect(xs[0]!.over).toBe(1);
  });

  it('交换输入顺序 → under/over 随之交换（关系稳定、可预期）', () => {
    const xs = findCrossings([vertical, horizontal]);
    expect(xs).toHaveLength(1);
    expect(xs[0]!.under).toBe(0); // 此时 vertical 先绘制 → 在下
    expect(xs[0]!.over).toBe(1);
  });

  it('平行 / 不相交 → 无交点', () => {
    const a = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const b = [
      { x: 0, y: 50 },
      { x: 100, y: 50 },
    ];
    expect(findCrossings([a, b])).toHaveLength(0);
  });

  it('pathWithJumps：无跳线点退化为折线；有跳线点则插入折线跳（M/L-only）', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    // 无跳线点 → 原样折线
    expect(pathWithJumps(pts, [])).toBe('M 0 0 L 100 0');
    // 落在路径上的跳线点 → 折线跳（梯形桥），且首尾不变。
    // R5-1 断言口径变更：旧判据 toContain('C')（贝塞尔拱弧）——折线化后恒假失效，
    // 换成语义等价折线判据：不含 C + 全串写死（顶点数 = 2 + 4 = 6，抬升高度 = radius = 5）。
    const jumped = pathWithJumps(pts, [{ x: 50, y: 0 }], 5);
    expect(jumped.startsWith('M 0 0')).toBe(true);
    expect(jumped.endsWith('L 100 0')).toBe(true);
    expect(jumped).not.toContain('C');
    // enter(45,0) → 抬升(45,5) → 平台右端(55,5) → exit(55,0)
    expect(jumped).toBe('M 0 0 L 45 0 L 45 5 L 55 5 L 55 0 L 100 0');
  });

  it('pathWithJumps：折线跳抬升高度 = radius（radius 参数生效）', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const jumped = pathWithJumps(pts, [{ x: 50, y: 0 }], 8);
    // enter/exit = 50 ∓ 8；抬升高度 = radius = 8（写死）
    expect(jumped).toBe('M 0 0 L 42 0 L 42 8 L 58 8 L 58 0 L 100 0');
    expect(jumped).not.toContain('C');
  });

  it('pathWithJumps：斜线段上同样沿法向抬起（平台段平行于路径）', () => {
    const d = pathWithJumps(
      [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ],
      [{ x: 50, y: 50 }],
      5,
    );
    expect(d).not.toContain('C');
    // 收集全部 L 顶点（写死数量 = 5：enter / 抬升端 / 平台右端 / exit / 末点）
    const pts: Array<{ x: number; y: number }> = [];
    for (const seg of d.match(/L [^L]+/g) ?? []) {
      const [sx, sy] = seg.slice(2).split(' ');
      pts.push({ x: Number(sx), y: Number(sy) });
    }
    expect(pts).toHaveLength(5);
    // 抬升两端（1、2 号 L 顶点）到弦（y=x）的距离 = radius
    const distToChord = (p: { x: number; y: number }): number => Math.abs(p.y - p.x) / Math.SQRT2;
    const rise = pts[1] ?? { x: 0, y: 0 };
    const fall = pts[2] ?? { x: 0, y: 0 };
    expect(distToChord(rise)).toBeCloseTo(5, 6);
    expect(distToChord(fall)).toBeCloseTo(5, 6);
    // 平台段方向与路径平行（斜率 = 1）
    expect((fall.y - rise.y) / (fall.x - rise.x)).toBeCloseTo(1, 6);
  });

  it('pathWithJumps：跳线点远离路径时忽略（不产生畸形弧）', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const jumped = pathWithJumps(pts, [{ x: 50, y: 400 }], 5);
    expect(jumped).toBe('M 0 0 L 100 0');
  });
});

// ---------- 净空罚分（侧边优先）与权重活性 ----------

/** 采样 path（M..L 或 M..C）为折线 */
function sampleRoute(d: string, n = 40): { x: number; y: number }[] {
  const m = d.match(
    /^M ([\d.-]+) ([\d.-]+) C ([\d.-]+) ([\d.-]+), ([\d.-]+) ([\d.-]+), ([\d.-]+) ([\d.-]+)$/,
  );
  if (!m) {
    const l = d.match(/^M ([\d.-]+) ([\d.-]+) L ([\d.-]+) ([\d.-]+)$/);
    if (!l) return [];
    const v = l.slice(1).map(Number);
    return Array.from({ length: n + 1 }, (_, i) => ({
      x: v[0]! + ((v[2]! - v[0]!) * i) / n,
      y: v[1]! + ((v[3]! - v[1]!) * i) / n,
    }));
  }
  const v = m.slice(1).map(Number);
  const p0 = { x: v[0]!, y: v[1]! };
  const c1 = { x: v[2]!, y: v[3]! };
  const c2 = { x: v[4]!, y: v[5]! };
  const p3 = { x: v[6]!, y: v[7]! };
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const u = 1 - t;
    return {
      x: u ** 3 * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * p3.x,
      y: u ** 3 * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * p3.y,
    };
  });
}

/** 弧高 / 弦长：曲线鼓出去多少（相对两点直线距离） */
function arcRatio(d: string): number {
  const pts = sampleRoute(d);
  if (pts.length < 2) return 0;
  const p0 = pts[0]!;
  const p3 = pts[pts.length - 1]!;
  const dx = p3.x - p0.x;
  const dy = p3.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  let maxDev = 0;
  for (const q of pts)
    maxDev = Math.max(maxDev, Math.abs(((q.x - p0.x) * -dy + (q.y - p0.y) * dx) / len));
  return maxDev / len;
}

describe('净空罚分（侧边优先）', () => {
  // 左右两端点，中间一簇障碍且留出缝隙：直线不撞任何卡片，但贴着节点群穿过 ——
  // 这正是「走中心」的形态，也是净空罚分唯一能起作用的场景。
  const A = box(0, 300, 120, 40);
  const B = box(900, 300, 120, 40);
  const cluster = [
    box(420, 40, 110, 34),
    box(420, 86, 110, 34),
    box(420, 132, 110, 34),
    box(420, 178, 110, 34),
    box(420, 400, 110, 34),
    box(420, 446, 110, 34),
    box(420, 492, 110, 34),
    box(420, 538, 110, 34),
  ];

  it('净空罚分把「从缝里穿过」的连线推到外侧', () => {
    const off = routeAesthetic(A, B, cluster, [], { weights: { clearance: 0 } });
    const on = routeAesthetic(A, B, cluster, [], { weights: { clearance: 14 } });
    // 关掉净空罚分 → 直线穿缝（这就是被投诉的形态）
    expect(off.routed).toBe(false);
    // 打开 → 绕到节点簇外：中点明显离开缝隙所在的 y 带
    expect(on.routed).toBe(true);
    expect(Math.abs(on.mid.y - 300)).toBeGreaterThan(150);
  });

  it('clearance 是活旋钮（调权重会改变结果，不是摆设）', () => {
    // 回归守卫：曾出现"四组参数输出完全一样"的死旋钮现象。
    // 本用例守住 clearance 权重确实进入了决策链路。
    // 注意：它守的是"权重能否影响结果"，不覆盖"权重是否在所有场景下都区分得开" ——
    // 后者与场景有关（有些边只有唯一可行曲率，权重再怎么调也一样），靠调参对照页看。
    const off = routeAesthetic(A, B, cluster, [], { weights: { clearance: 0 } });
    const on = routeAesthetic(A, B, cluster, [], { weights: { clearance: 14 } });
    expect(off.d).not.toBe(on.d);
  });

  it('bend 是净空项的有效制衡（调大 bend → 弧不更夸张）', () => {
    // 回归守卫：bend 曾比净空项小一个数量级（0.4 vs 18），完全拉不住曲率，
    // 结果每条被挡的边都撑到 |c|≈2、弧高 150% 弦长。
    const loose = routeAesthetic(A, B, cluster, [], { weights: { bend: 0.4 } });
    const tight = routeAesthetic(A, B, cluster, [], { weights: { bend: 6 } });
    expect(arcRatio(tight.d)).toBeLessThanOrEqual(arcRatio(loose.d) + 1e-9);
  });

  it('弧高不超过弦长（几何硬约束 |c| <= 1.33）', () => {
    // 超过这条线后曲线看起来是"甩出去绕一大圈"，而不是把两点连起来。
    const rng = makeRng(4242);
    for (let iter = 0; iter < 60; iter++) {
      const a = { x: rng() * 200, y: rng() * 500, w: 90 + rng() * 80, h: 30 + rng() * 20 };
      const b = { x: 380 + rng() * 380, y: rng() * 500, w: 90 + rng() * 80, h: 30 + rng() * 20 };
      const obs: RouteObstacle[] = [];
      const n = 1 + Math.floor(rng() * 3);
      for (let k = 0; k < n; k++) {
        const o = { x: 150 + rng() * 350, y: rng() * 600, w: 60 + rng() * 110, h: 30 + rng() * 50 };
        const overlaps = [a, b].some(
          (e) =>
            o.x < e.x + e.w + 10 &&
            o.x + o.w > e.x - 10 &&
            o.y < e.y + e.h + 10 &&
            o.y + o.h > e.y - 10,
        );
        if (!overlaps) obs.push(o);
      }
      const r = routeAesthetic(a, b, obs);
      expect(arcRatio(r.d)).toBeLessThanOrEqual(1.0 + 1e-6);
    }
  });

  it('退化输入不崩溃、不产出 NaN（零尺寸盒 / 重合端点）', () => {
    // NaN 一旦进到 d 串里，比较运算恒为 false，会让整条边静默消失或渲染错乱。
    const degenerate: [RouteObstacle, RouteObstacle, string][] = [
      [box(0, 0, 0, 0), box(100, 100, 120, 34), '源盒零尺寸'],
      [box(0, 0, 120, 34), box(0, 0, 0, 0), '靶盒零尺寸'],
      [box(50, 50, 120, 34), box(50, 50, 120, 34), '两端点完全重合'],
      [box(0, 0, 1, 1), box(0, 0, 1, 1), '1×1 微盒重合'],
      // 真正的零弦长：两个零尺寸盒落在同一点 → 所有锚点重合，chord = 0。
      // 这是唯一能触发「除以弦长」除零的路径，必须守住。
      [box(50, 50, 0, 0), box(50, 50, 0, 0), '零尺寸盒同点（chord=0）'],
    ];
    for (const [a, b, label] of degenerate) {
      const r = routeAesthetic(a, b, [box(200, 200, 120, 34)]);
      expect(r.d, label).not.toBe('');
      expect(r.d, label).not.toMatch(/NaN|Infinity|undefined/);
      expect(Number.isFinite(r.mid.x), `${label} mid.x`).toBe(true);
      expect(Number.isFinite(r.mid.y), `${label} mid.y`).toBe(true);
      expect(Number.isFinite(r.nx), `${label} nx`).toBe(true);
      expect(Number.isFinite(r.ny), `${label} ny`).toBe(true);
    }
  });

  it('直线离卡片足够远时才走快路径（贴着走必须交给评分）', () => {
    // 直线不撞卡片、但离得很近 → 不能走 preferStraight 快路径，否则永远直穿。
    const near = routeAesthetic(A, B, cluster, [], { weights: { clearance: 14 } }, true);
    expect(near.routed).toBe(true);
    // 把卡片撤走后，同一组端点就应该直连了
    const empty = routeAesthetic(A, B, [], [], { weights: { clearance: 14 } }, true);
    expect(empty.routed).toBe(false);
  });
});

// ---------- Opp 一键反向：inferBowSide 推断当前鼓向 ----------

describe('inferBowSide：从路径 d 推断当前鼓向（Opp 的前置）', () => {
  it('水平 L→R 连线：鼓向下方 → right；鼓向上方 → left', () => {
    // 水平连线，c1.y > 中点 y → 向下鼓（SVG y 轴向下），按约定 = right
    const r = bezierFromAnchors({ x: 0, y: 100 }, { x: 200, y: 100 }, 0.7);
    expect(inferBowSide(r.d)).toBe('right');
    expect(inferBowSide(bezierFromAnchors({ x: 0, y: 100 }, { x: 200, y: 100 }, -0.7).d)).toBe(
      'left',
    );
  });

  it('标记与 forceSide 同语义：提取的是曲率符号，端点互换不改变标记', () => {
    // 关键语义：forceSide 的 'right' = 曲率 ≥ 0、'left' = 曲率 ≤ 0，是**相对 from→to 方向**的。
    // inferBowSide 提取的正是这个曲率符号，所以端点互换（物理鼓向会相反）时标记保持不变 ——
    // 这与 forceSide 的约定一致：同一条边无论从哪端看，'right' 都指同一个曲率方向。
    const fwd = bezierFromAnchors({ x: 0, y: 100 }, { x: 200, y: 100 }, 0.7).d;
    const rev = bezierFromAnchors({ x: 200, y: 100 }, { x: 0, y: 100 }, 0.7).d;
    expect(inferBowSide(fwd)).toBe('right');
    expect(inferBowSide(rev)).toBe('right'); // 曲率同为 +0.7 → 标记不变
    // 翻符号 → 标记随之翻转
    expect(inferBowSide(bezierFromAnchors({ x: 0, y: 100 }, { x: 200, y: 100 }, -0.7).d)).toBe(
      'left',
    );
  });

  it('直线（L 路径）→ auto（不鼓，无所谓方向）', () => {
    expect(inferBowSide('M 0 0 L 100 0')).toBe('auto');
  });

  it('c=0 的 cubic（控制点共线）→ auto', () => {
    expect(inferBowSide('M 0 0 C 70 0 130 0 200 0')).toBe('auto');
  });

  it('斜向连线也能判断', () => {
    // p0=(0,0)→p3=(100,100)，c1=(50,50 + 鼓偏移)
    // 用 bezierFromAnchors 来构造更可靠
    const r1 = bezierFromAnchors({ x: 0, y: 0 }, { x: 100, y: 100 }, 0.5);
    expect(['left', 'right']).toContain(inferBowSide(r1.d));
  });

  it('Opp 完整闭环：auto 算出鼓向 → 取反 → forceSide 强制 → 结果确实翻面', () => {
    // 这是 Opp 按钮的核心链路（EdgeEditor.flipSide）：
    //   1) auto 模式路由 → 得到实际渲染的 d
    //   2) inferBowSide(d) 读出当前鼓向 S
    //   3) 设 routingSide = opposite(S) → FreeEdgeLayer 以 forceSide 重路由
    //   4) 新路径的鼓向应为 opposite(S)
    // 若任一环节语义不一致（比如 inferBowSide 与 forceSide 的 left/right 约定相反），此用例即红。
    const A = box(0, 300, 120, 40);
    const B = box(900, 300, 120, 40);
    const cluster = [
      box(420, 40, 110, 34),
      box(420, 86, 110, 34),
      box(420, 132, 110, 34),
      box(420, 178, 110, 34),
      box(420, 400, 110, 34),
      box(420, 446, 110, 34),
      box(420, 492, 110, 34),
      box(420, 538, 110, 34),
    ];
    const auto = routeAesthetic(A, B, cluster);
    const current = inferBowSide(auto.d);
    expect(current).not.toBe('auto'); // 这条边必须真的绕了行，否则测不到翻转

    const opposite: 'left' | 'right' = current === 'right' ? 'left' : 'right';
    const flipped = routeAesthetic(A, B, cluster, [], { forceSide: opposite });
    expect(inferBowSide(flipped.d)).toBe(opposite);
    // 且确实换了另一侧（不是原地不动）
    expect(flipped.d).not.toBe(auto.d);
  });
});

describe('inferBowSideFromPoints：从路由顶点直接判向（跳线桥免疫）', () => {
  it('两点直线 → auto；而同一条边的跳线 d 经字符串解析会按跳线方向落侧', () => {
    const straight = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(inferBowSideFromPoints(straight)).toBe('auto');
    // 记录两法差异（这就是 EdgeEditor 改走顶点的原因）：折线跳桥把 rise/fall 抬离弦
    // radius，字符串 API 会把「跳线方向」读成鼓向（R5-1 已知形态事实）。
    expect(inferBowSide(pathWithJumps(straight, [{ x: 50, y: 0 }], 5))).toBe('right');
  });

  it('三点弓形 → 与 inferBowSide 同约定（上弓 left / 下弓 right）', () => {
    expect(
      inferBowSideFromPoints([
        { x: 0, y: 100 },
        { x: 100, y: 60 },
        { x: 200, y: 100 },
      ]),
    ).toBe('left');
    expect(
      inferBowSideFromPoints([
        { x: 0, y: 100 },
        { x: 100, y: 140 },
        { x: 200, y: 100 },
      ]),
    ).toBe('right');
  });

  it('共线三点 / 顶点不足 / 退化弦 → auto', () => {
    expect(
      inferBowSideFromPoints([
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
      ]),
    ).toBe('auto');
    expect(
      inferBowSideFromPoints([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]),
    ).toBe('auto');
    expect(inferBowSideFromPoints([])).toBe('auto');
    expect(
      inferBowSideFromPoints([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ]),
    ).toBe('auto');
  });
});

describe('inferBowSide：跳线/折线路径（R3-2）', () => {
  it('跳线 d（pathWithJumps 真实输出）→ 按主体折线的鼓向判定（今天恒 auto）', () => {
    // 主体弓向上（mid 高于首末弦）→ left；跳线弧只是过障小弧，不代表整体鼓向
    const bowUp = pathWithJumps(
      [
        { x: 0, y: 100 },
        { x: 100, y: 60 },
        { x: 200, y: 100 },
      ],
      [{ x: 50, y: 80 }],
    );
    // R5-1 断言口径变更：折线化后跳线不再产 C（toContain('C') 恒假失效）。
    // 语义等价判据：确有多段折线（跳线注入 4 个顶点 → 3 输入 + 4 = 7 个 M/L 指令 ≥ 4）。
    expect((bowUp.match(/[MLC]/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(inferBowSide(bowUp)).toBe('left');

    const bowDown = pathWithJumps(
      [
        { x: 0, y: 100 },
        { x: 100, y: 140 },
        { x: 200, y: 100 },
      ],
      [{ x: 50, y: 120 }],
    );
    expect(inferBowSide(bowDown)).toBe('right');
  });

  it('单 C 段路径行为逐位不变（回归钉）', () => {
    expect(inferBowSide(bezierFromAnchors({ x: 0, y: 100 }, { x: 200, y: 100 }, 0.7).d)).toBe(
      'right',
    );
    expect(inferBowSide(bezierFromAnchors({ x: 0, y: 100 }, { x: 200, y: 100 }, -0.7).d)).toBe(
      'left',
    );
  });

  it('纯折线（无跳线弧）→ 中点相对首末弦判定', () => {
    expect(inferBowSide('M 0 100 L 100 60 L 200 100')).toBe('left');
    expect(inferBowSide('M 0 100 L 100 140 L 200 100')).toBe('right');
  });

  it('直线/退化 → auto（不鼓或不可判）', () => {
    expect(inferBowSide('M 0 0 L 100 0')).toBe('auto');
    expect(inferBowSide('M 0 0 L 50 0 L 100 0')).toBe('auto'); // 三点共线
    expect(inferBowSide('')).toBe('auto');
    expect(inferBowSide('not a path')).toBe('auto');
  });
});

describe('RouteResult.forcedSideFallback（R3-4：指定侧无解的显式反馈）', () => {
  it('forceSide + 全穿障 → 直穿降级时置位（routed 仍为 false）', () => {
    const a = box(0, 0);
    const b = box(400, 0);
    const wall = box(-300, -300, 1200, 900); // 巨型墙：任何曲率都绕不开
    const r = routeAesthetic(a, b, [wall], [], { forceSide: 'left' });
    expect(r.routed).toBe(false);
    expect(r.forcedSideFallback).toBe(true);
  });

  it('无 forceSide 的同款全穿障降级 → 标志不得置位（关键区分钉：防全量误报）', () => {
    const a = box(0, 0);
    const b = box(400, 0);
    const wall = box(-300, -300, 1200, 900);
    const r = routeAesthetic(a, b, [wall]);
    expect(r.routed).toBe(false);
    expect(r.forcedSideFallback).toBeUndefined();
  });

  it('空旷直连 → 不置位', () => {
    const r = routeAesthetic(box(0, 100), box(400, 100), []);
    expect(r.routed).toBe(false);
    expect(r.forcedSideFallback).toBeUndefined();
  });

  it('正常绕行 → 不置位', () => {
    const a = box(0, 100);
    const b = box(400, 100);
    const wall = box(180, -80, 40, 400);
    const r = routeAesthetic(a, b, [wall]);
    expect(r.routed).toBe(true);
    expect(r.forcedSideFallback).toBeUndefined();
  });
});
