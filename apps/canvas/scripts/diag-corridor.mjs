/**
 * 诊断「侧边优先」：验证走廊穿越罚分是否真的把连线从"中心走廊"推到外侧。
 *
 * 场景：左右两个端点，中间一簇障碍，但障碍**留出了中间缝隙** ——
 * 于是存在两种都"合法"（不碰任何卡片）的走法：
 *   ① 从缝隙直穿中心（旧行为：crossing=0、inward=0，评分看不出问题）
 *   ② 绕到节点簇外侧（用户期望："按理讲应该是侧边优先"）
 * 对比 corridor 权重 0（旧）与 18（新）的选择差异。
 */
import { routeAesthetic } from '../../packages/react/src/render/edgeRouting.ts';

const A = { x: 0, y: 300, w: 120, h: 40 };
const B = { x: 900, y: 300, w: 120, h: 40 };

// 中间障碍簇：上下两段，中间留出 y=210..390 的缝隙
function buildCluster() {
  const obs = [];
  for (let y = 40; y < 200; y += 46) {
    obs.push({ id: `t${y}`, x: 420, y, w: 110, h: 34 });
  }
  for (let y = 400; y < 580; y += 46) {
    obs.push({ id: `b${y}`, x: 420, y, w: 110, h: 34 });
  }
  return obs;
}

const obstacles = buildCluster();

/** 采样路径上的点（支持 M..L 与 M..C 两种） */
function sample(d, n = 40) {
  const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
  if (d.includes('C')) {
    const [x0, y0, c1x, c1y, c2x, c2y, x3, y3] = nums;
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      out.push({
        x: u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x3,
        y: u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y3,
      });
    }
    return out;
  }
  const [x0, y0, x3, y3] = nums;
  return Array.from({ length: n + 1 }, (_, i) => ({
    x: x0 + ((x3 - x0) * i) / n,
    y: y0 + ((y3 - y0) * i) / n,
  }));
}

/** 是否穿过节点簇的"中心带"：|y - 簇中心 y| < 90 且 x 已进入簇的横向范围 */
function centerBandHits(pts) {
  const cy = 310;
  let hits = 0;
  for (const p of pts) {
    if (p.x > 400 && p.x < 560 && Math.abs(p.y - cy) < 90) hits++;
  }
  return hits / pts.length;
}

function report(label, clearWeight) {
  const r = routeAesthetic(A, B, obstacles, [], { weights: { clearance: clearWeight } });
  const pts = sample(r.d);
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  console.log(`\n[${label}] clearance=${clearWeight}`);
  console.log(`  d        = ${r.d.slice(0, 90)}`);
  console.log(`  routed   = ${r.routed}`);
  console.log(`  mid      = (${r.mid.x.toFixed(1)}, ${r.mid.y.toFixed(1)})`);
  console.log(`  y 范围   = ${minY.toFixed(1)} .. ${maxY.toFixed(1)}`);
  console.log(`  中心带占比 = ${(centerBandHits(pts) * 100).toFixed(1)}%`);
  return centerBandHits(pts);
}

console.log('=== 场景 ===');
console.log(`端点 A(0,300,120x40) → B(900,300,120x40)`);
console.log(`中间障碍簇：x=420..530，上下两段，中心缝隙 y=210..390`);

const before = report('旧行为（无净空罚分）', 0);
const after = report('新行为（净空罚分）', 14);

console.log('\n=== 结论 ===');
console.log(`中心带占比：${(before * 100).toFixed(1)}% → ${(after * 100).toFixed(1)}%`);
console.log(after < before ? '✓ 净空罚分生效：连线被推离中心' : '✗ 净空罚分未生效：仍走中心');
