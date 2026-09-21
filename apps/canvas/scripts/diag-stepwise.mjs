/**
 * 逐档复刻 routeAesthetic 的内层判定（只用导出的纯函数），打印每个曲率档位的：
 *   穿障? / 净空不足占比 / inward / 各项罚分 / 总分
 *
 * 用途：调权重平衡时看"评分到底怎么选的"。若某档明显更优却选了另一档，说明早停或
 * 权重有问题；若所有档位总分几乎不变，说明该项权重是死旋钮。
 *
 * 运行：cd apps/canvas && npx vite-node scripts/diag-stepwise.mjs
 */
import {
  corridorObstacles,
  edgeAnchorCandidates,
  bezierFromAnchors,
  sampleCubic,
  polylineHitsObstacle,
  pointClearance,
  segmentIntersectsRect,
  DEFAULT_BLOCK_PADDING,
  DEFAULT_CURVATURE_STEPS,
} from '../../packages/react/src/render/edgeRouting.ts';

const A = { x: 0, y: 300, w: 120, h: 40 };
const B = { x: 900, y: 300, w: 120, h: 40 };

const obstacles = [];
for (let y = 40; y < 200; y += 46) obstacles.push({ id: `t${y}`, x: 420, y, w: 110, h: 34 });
for (let y = 400; y < 580; y += 46) obstacles.push({ id: `b${y}`, x: 420, y, w: 110, h: 34 });

// 与 routeAesthetic 内部一致的三层障碍集
const ac = { x: A.x + A.w / 2, y: A.y + A.h / 2 };
const bc = { x: B.x + B.w / 2, y: B.y + B.h / 2 };
const corridorSet = corridorObstacles(ac, bc, 180, obstacles);
const clearTarget = Math.max(80, ((A.h + B.h) / 2) * 3);
const nearBand = corridorSet.filter((o) =>
  segmentIntersectsRect(ac.x, ac.y, bc.x, bc.y, o, clearTarget),
);
const centroid =
  nearBand.length > 0
    ? {
        x: nearBand.reduce((s, o) => s + o.x + o.w / 2, 0) / nearBand.length,
        y: nearBand.reduce((s, o) => s + o.y + o.h / 2, 0) / nearBand.length,
      }
    : null;

const aAnchors = edgeAnchorCandidates(A, 3);
const bAnchors = edgeAnchorCandidates(B, 3);
const pairs = [];
for (const p0 of aAnchors)
  for (const p3 of bAnchors) pairs.push({ p0, p3, dist: Math.hypot(p3.x - p0.x, p3.y - p0.y) });
pairs.sort((u, v) => u.dist - v.dist);

const straightLen = Math.hypot(bc.x - ac.x, bc.y - ac.y) || 1;

console.log(
  `走廊集 ${corridorSet.length} 个，贴缝集 ${nearBand.length} 个` +
    (centroid
      ? `，质心 (${centroid.x.toFixed(0)}, ${centroid.y.toFixed(0)})`
      : '（无贴缝 → 走快路径）'),
);
console.log(`clearTarget = ${clearTarget.toFixed(0)}，弧高上限 |c| <= 1.33`);
console.log(
  `最近锚点对: (${pairs[0].p0.x}, ${pairs[0].p0.y}) → (${pairs[0].p3.x}, ${pairs[0].p3.y})  chord=${pairs[0].dist.toFixed(0)}\n`,
);

// 与源码默认一致的权重；改这里即可试算不同取值
const W = { crossing: 12, inward: 8, clearance: 14, bend: 2.5, length: 0.5 };

const { p0, p3 } = pairs[0];
const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y) || 1;

// 注意：本表只检视**最近锚点对**。routeAesthetic 会枚举全部 144 个锚点对，
// 最终可能选中另一对（尤其当最近那对无论怎么弯都达不到 |c| <= 0.45 的早停条件时）。
// 因此本表用于分析"权重如何博弈"，不代表最终选择 —— 最终选择看 diag-corridor.mjs。
console.log('档位    穿障  净空占比  inward   bend  length   总分   弧高/弦长');
const steps = [...DEFAULT_CURVATURE_STEPS]
  .filter((c) => Math.abs(c) <= 1.33)
  .sort((u, v) => Math.abs(u) - Math.abs(v));

for (const c of steps) {
  const bez = bezierFromAnchors(p0, p3, c);
  const pts = sampleCubic(p0, bez.c1, bez.c2, p3, 20); // 与源码默认 samples=20 一致
  const blocked =
    polylineHitsObstacle(pts, corridorSet, DEFAULT_BLOCK_PADDING) ||
    polylineHitsObstacle(pts, obstacles, DEFAULT_BLOCK_PADDING);

  // 净空成本：离最近卡片不足 clearTarget 的采样点占比
  let tight = 0;
  for (const q of pts) {
    let minD = Infinity;
    for (const o of corridorSet) minD = Math.min(minD, pointClearance(q, o));
    if (minD < clearTarget) tight++;
  }
  const tightRatio = tight / pts.length;

  // 内凸：曲线中点朝质心方向的投影（外凸钳到 0）
  let inward = 0;
  if (centroid) {
    const lineMid = { x: (p0.x + p3.x) / 2, y: (p0.y + p3.y) / 2 };
    const toCx = centroid.x - lineMid.x;
    const toCy = centroid.y - lineMid.y;
    const cl = Math.hypot(toCx, toCy) || 1;
    inward = ((bez.mid.x - lineMid.x) * toCx + (bez.mid.y - lineMid.y) * toCy) / (cl * chord);
    if (inward < 0) inward = 0;
  }

  const sClear = W.clearance * tightRatio;
  const sBend = W.bend * Math.abs(c);
  const sLen = W.length * (chord / straightLen);
  const total = sClear + W.inward * inward + sBend + sLen;
  const devRatio = 0.75 * Math.abs(c); // 弧高 / 弦长

  console.log(
    `${String(c).padStart(5)}  ${blocked ? ' 是 ' : ' 否 '}   ${tightRatio.toFixed(3).padStart(6)}  ` +
      `${inward.toFixed(3).padStart(6)}  ${sBend.toFixed(2).padStart(5)}  ${sLen.toFixed(2).padStart(5)}  ` +
      `${blocked ? '   —' : total.toFixed(2).padStart(6)}    ${(devRatio * 100).toFixed(0).padStart(3)}%`,
  );
}
