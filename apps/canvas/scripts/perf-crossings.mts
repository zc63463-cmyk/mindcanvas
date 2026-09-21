/**
 * 性能画像：连线交叉检测（findCrossings）与障碍命中（polylineHitsObstacle）。
 *
 * 用途：优化前后对比，用数字证明收益（不凭感觉说"变快了"）。
 * 运行：cd apps/canvas && npx vite-node scripts/perf-crossings.mts
 */
import { findCrossings, polylineHitsObstacle } from '../../packages/react/src/render/edgeRouting.ts';
import type { RouteObstacle } from '../../packages/react/src/render/edgeRouting.ts';

type Pt = { x: number; y: number };

/** 确定性伪随机（保证每次压测数据一致，可比） */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 生成 N 条「类真实导图」的折线。
 *
 * 为什么不能用全局横跨的线：那样每条线的包围盒都≈整个画布，
 * AABB 预筛永远命中 → 测出来的只是预筛的额外开销，而非真实收益。
 * 真实导图的边绝大多数是局部的（相邻/同分支节点间），少数长程（自由边）。
 */
function genPolylines(n: number, ptsPerLine = 20, seed = 42): Pt[][] {
  const rnd = mulberry32(seed);
  const W = 4000;
  const H = 3000;
  // 节点：网格分布 + 抖动（模拟布局后的节点位置）
  const nodeCount = Math.max(n, 200);
  const nodes: Pt[] = [];
  const cols = Math.ceil(Math.sqrt(nodeCount * (W / H)));
  for (let i = 0; i < nodeCount; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    nodes.push({
      x: ((c + 0.5) / cols) * W + (rnd() - 0.5) * 60,
      y: ((r + 0.5) / Math.ceil(nodeCount / cols)) * H + (rnd() - 0.5) * 60,
    });
  }
  const out: Pt[][] = [];
  for (let k = 0; k < n; k++) {
    // 85% 局部边（连到邻近节点），15% 长程边（自由边，跨分支）
    const from = nodes[Math.floor(rnd() * nodes.length)]!;
    let to: Pt;
    if (rnd() < 0.85) {
      // 邻近：在附近节点里挑
      let bi = 0;
      let bd = Infinity;
      for (let s = 0; s < 12; s++) {
        const cand = Math.floor(rnd() * nodes.length);
        const d = Math.hypot(nodes[cand]!.x - from.x, nodes[cand]!.y - from.y);
        if (d > 1 && d < bd) {
          bd = d;
          bi = cand;
        }
      }
      to = nodes[bi]!;
    } else {
      to = nodes[Math.floor(rnd() * nodes.length)]!;
    }
    // 贝塞尔状折线：起点→终点，带侧向弯曲
    const line: Pt[] = [];
    const bow = (rnd() - 0.5) * Math.hypot(to.x - from.x, to.y - from.y) * 0.25;
    for (let i = 0; i < ptsPerLine; i++) {
      const t = i / (ptsPerLine - 1);
      const arc = Math.sin(t * Math.PI) * bow;
      line.push({
        x: from.x + (to.x - from.x) * t + arc * 0.3,
        y: from.y + (to.y - from.y) * t + arc,
      });
    }
    out.push(line);
  }
  return out;
}

/** 线段求交（与 edgeRouting 内部实现等价的 O(1) 测试，用于朴素版对照） */
function segIntersectPoint(
  a1: Pt,
  a2: Pt,
  b1: Pt,
  b2: Pt,
): Pt | null {
  const r = { x: a2.x - a1.x, y: a2.y - a1.y };
  const s = { x: b2.x - b1.x, y: b2.y - b1.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((b1.x - a1.x) * s.y - (b1.y - a1.y) * s.x) / denom;
  const u = ((b1.x - a1.x) * r.y - (b1.y - a1.y) * r.x) / denom;
  // 必须与生产实现一致：严格落在两条线段内部，排除端点
  // （相邻线段的公共端点不算交叉；此处若放宽会多算出大量假交点）
  if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null;
  return { x: a1.x + t * r.x, y: a1.y + t * r.y };
}

/**
 * 朴素版（优化前的 O(E² × P²)）—— 与 findCrossings 做等价性与性能对照。
 * 只在本脚本内使用，不进生产代码。
 */
function findCrossingsNaive(polylines: readonly Pt[][]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < polylines.length; i++) {
    for (let j = i + 1; j < polylines.length; j++) {
      const a = polylines[i]!;
      const b = polylines[j]!;
      for (let m = 0; m + 1 < a.length; m++) {
        for (let n = 0; n + 1 < b.length; n++) {
          const p = segIntersectPoint(a[m]!, a[m + 1]!, b[n]!, b[n + 1]!);
          if (p) out.push(p);
        }
      }
    }
  }
  return out;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/** 跑 run 次取中位数（抗抖动） */
function bench(name: string, runs: number, fn: () => void): number {
  const samples: number[] = [];
  for (let r = 0; r < runs; r++) {
    const t = performance.now();
    fn();
    samples.push(performance.now() - t);
  }
  const m = median(samples);
  console.log(`  ${name.padEnd(34)} ${m.toFixed(2)} ms`);
  return m;
}

console.log('══════ 连线避障性能画像 ══════\n');

for (const n of [50, 100, 200, 400]) {
  const lines = genPolylines(n);
  console.log(`── ${n} 条边 × 20 点 ──`);
  const tOpt = bench('findCrossings（AABB 预筛）', 5, () => {
    findCrossings(lines);
  });
  const tNaive = bench('findCrossings（朴素对照）', 5, () => {
    findCrossingsNaive(lines);
  });
  const speedup = tNaive / tOpt;
  console.log(`  加速比: ${speedup.toFixed(2)}×`);

  // 等价性校验：预筛只应筛掉「必然无交」的边对，交点数量必须一致
  const opt = findCrossings(lines);
  const naive = findCrossingsNaive(lines);
  const same =
    opt.length === naive.length &&
    opt.every((c, k) => Math.abs(c.x - naive[k]!.x) < 1e-9 && Math.abs(c.y - naive[k]!.y) < 1e-9);
  console.log(
    `  ${same ? '✅ 结果一致' : '❌ 结果不一致'}: 优化 ${opt.length} 个交点 / 朴素 ${naive.length} 个\n`,
  );

  // 障碍命中：模拟 N 个节点盒作为障碍
  const obstacles: RouteObstacle[] = [];
  for (let i = 0; i < n * 2; i++) {
    obstacles.push({ x: (i * 37) % 3800, y: (i * 53) % 2800, w: 180, h: 44 });
  }
  bench('polylineHitsObstacle ×全部边', 5, () => {
    for (const ln of lines) polylineHitsObstacle(ln, obstacles);
  });

  console.log(`  边对组合数: ${(n * (n - 1)) / 2}  逐段测试上界: ${((n * (n - 1)) / 2) * 19 * 19}\n`);
}

console.log('══════ 完成 ══════');
