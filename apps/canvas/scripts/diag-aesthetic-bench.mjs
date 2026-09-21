/**
 * routeAesthetic 性能基准。
 * 重点量化新加的「全量障碍复核」成本：曲率大时曲线鼓到包围盒外，
 * 只用粗筛会漏检，因此每个候选都要再对全量障碍做一次穿障判定。
 */
import { routeAesthetic } from '../../packages/react/src/render/edgeRouting.ts';

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function buildScene(count) {
  const rng = makeRng(7);
  const boxes = [];
  const perRow = Math.ceil(Math.sqrt(count));
  for (let i = 0; i < count; i++) {
    const r = Math.floor(i / perRow);
    const c = i % perRow;
    boxes.push({
      id: `n${i}`,
      x: c * 200 + (rng() * 20 - 10),
      y: r * 90 + (rng() * 12 - 6),
      w: 110 + rng() * 50,
      h: 34,
    });
  }
  return boxes;
}

function bench(nodeCount, edgeCount) {
  const boxes = buildScene(nodeCount);
  const rng = makeRng(99);
  const edges = [];
  for (let i = 0; i < edgeCount; i++) {
    const ai = Math.floor(rng() * nodeCount);
    let bi = Math.floor(rng() * nodeCount);
    if (bi === ai) bi = (bi + 1) % nodeCount;
    edges.push([ai, bi]);
  }

  const t0 = performance.now();
  const polylines = [];
  let routed = 0;
  for (const [ai, bi] of edges) {
    const a = boxes[ai];
    const b = boxes[bi];
    const obs = boxes.filter((_, i) => i !== ai && i !== bi);
    const r = routeAesthetic(a, b, obs, polylines);
    if (r.routed) routed++;
    polylines.push(r.points);
  }
  const dt = performance.now() - t0;
  console.log(
    `节点 ${String(nodeCount).padStart(4)} | 边 ${String(edgeCount).padStart(3)} | ` +
      `总 ${dt.toFixed(1).padStart(7)}ms | 均摊 ${(dt / edgeCount).toFixed(2).padStart(6)}ms/边 | ` +
      `绕行率 ${((routed / edgeCount) * 100).toFixed(0)}%`,
  );
  return dt / edgeCount;
}

console.log('=== routeAesthetic 基准（含逐边累积的交叉协调）===');
bench(50, 30);
bench(100, 60);
bench(200, 100);
bench(400, 150);
bench(800, 200);
