import { makeTextNode } from '@mindcanvas/kernel';
import { createCharMeasure, createNodeMeasure } from '@mindcanvas/react';
import { layoutMindmap } from '@mindcanvas/kernel';

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
const measure = createNodeMeasure(char, new Map());

function show(label, root) {
  const l = layoutMindmap(root, measure, new Set());
  console.log(`\n=== ${label} ===`);
  for (const n of l.nodes) {
    const c = { x: n.box.x + n.box.w / 2, y: n.box.y + n.box.h / 2 };
    console.log(
      `  ${String(n.node.text).padEnd(6)} box=(${n.box.x.toFixed(0)},${n.box.y.toFixed(0)},${n.box.w.toFixed(0)}x${n.box.h.toFixed(0)}) center=(${c.x.toFixed(0)},${c.y.toFixed(0)})`,
    );
  }
}

show(
  'root + A..E（5 子）',
  makeTextNode('根', [
    makeTextNode('A'),
    makeTextNode('B'),
    makeTextNode('C'),
    makeTextNode('D'),
    makeTextNode('E'),
  ]),
);
show(
  '根>分支>(A,B,C)（孙层 3 子）',
  makeTextNode('根', [
    makeTextNode('分支', [makeTextNode('A'), makeTextNode('B'), makeTextNode('C')]),
  ]),
);
