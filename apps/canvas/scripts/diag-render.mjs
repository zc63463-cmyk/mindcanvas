import { readFileSync } from 'node:fs';
import {
  buildEditable,
  collectFreeEdges,
  freeEdgeEndpoints,
  buildFreeEdgePath,
  borderPoint,
} from '@mindcanvas/react';
import { layoutMindmap } from '@mindcanvas/kernel';
import { createCharMeasure, createNodeMeasure } from '@mindcanvas/react';

const src = readFileSync('src/demo/gateway.mm.md', 'utf8');
const { editable: root, refs } = buildEditable(src);

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
const measure = createNodeMeasure(char, new Map());
const layout = layoutMindmap(root, measure, new Set());

const boxes = new Map();
for (const ln of layout.nodes) boxes.set(ln.node.id, ln.box);
const labelOf = new Map();
for (const ln of layout.nodes) {
  labelOf.set(
    ln.node.id,
    ln.node.type === 'entity' ? `@${ln.node.ref.kind}:${ln.node.ref.id}` : ln.node.text,
  );
}

console.log('=== 布局盒（前 8 个）===');
layout.nodes.slice(0, 8).forEach((ln) => {
  console.log(
    `  ${labelOf.get(ln.node.id)}  box=(${ln.box.x.toFixed(0)},${ln.box.y.toFixed(0)},${ln.box.w.toFixed(0)}x${ln.box.h.toFixed(0)})`,
  );
});

const edges = collectFreeEdges(root);
console.log(`\n=== 边渲染几何（${edges.length} 条）===`);
for (const e of edges) {
  const eps = freeEdgeEndpoints(e, (id) => boxes.get(id), root, new Set());
  if (!eps.renderable) {
    console.log(`  ${e.key} 不可渲染！`);
    continue;
  }
  const { d, mid } = buildFreeEdgePath(eps.from, eps.to, 0.16);
  const m = d.match(
    /^M ([\d.-]+) ([\d.-]+) C [\d.-]+ [\d.-]+, [\d.-]+ [\d.-]+, ([\d.-]+) ([\d.-]+)$/,
  );
  const [sx, sy, ex, ey] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  const onBorder = (p, b) => {
    const eps2 = 0.6;
    const onL = Math.abs(p.x - b.x) < eps2 && p.y >= b.y - eps2 && p.y <= b.y + b.h + eps2;
    const onR = Math.abs(p.x - (b.x + b.w)) < eps2 && p.y >= b.y - eps2 && p.y <= b.y + b.h + eps2;
    const onT = Math.abs(p.y - b.y) < eps2 && p.x >= b.x - eps2 && p.x <= b.x + b.w + eps2;
    const onB = Math.abs(p.y - (b.y + b.h)) < eps2 && p.x >= b.x - eps2 && p.x <= b.x + b.w + eps2;
    return onL || onR || onT || onB;
  };
  const srcLabel = labelOf.get(eps.fromId) ?? '?';
  const tgtLabel = labelOf.get(eps.toId) ?? (eps.ghost ? '(ghost)' : '?');
  console.log(`\n  ${e.key}: ${srcLabel} → ${tgtLabel}${eps.ghost ? ' [GHOST]' : ''}`);
  console.log(
    `    源盒 (${eps.from.x.toFixed(0)},${eps.from.y.toFixed(0)},${eps.from.w.toFixed(0)}x${eps.from.h.toFixed(0)})`,
  );
  console.log(
    `    靶盒 (${eps.to.x.toFixed(0)},${eps.to.y.toFixed(0)},${eps.to.w.toFixed(0)}x${eps.to.h.toFixed(0)})`,
  );
  console.log(
    `    起点 (${sx.toFixed(1)},${sy.toFixed(1)}) 落在源盒边界: ${onBorder({ x: sx, y: sy }, eps.from)}`,
  );
  console.log(
    `    终点 (${ex.toFixed(1)},${ey.toFixed(1)}) 落在靶盒边界: ${onBorder({ x: ex, y: ey }, eps.to)}`,
  );
  console.log(`    标签中点 (${mid.x.toFixed(1)},${mid.y.toFixed(1)})`);
}
