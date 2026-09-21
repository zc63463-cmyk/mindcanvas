import { readFileSync } from 'node:fs';
import { buildEditable } from '@mindcanvas/react';
import { layoutMindmap } from '@mindcanvas/kernel';
import { createCharMeasure, createNodeMeasure } from '@mindcanvas/react';

const src = readFileSync('src/demo/gateway.mm.md', 'utf8');
const { editable: root } = buildEditable(src);
const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
const measure = createNodeMeasure(char, new Map());
const layout = layoutMindmap(root, measure, new Set());

console.log('=== demo 所有节点位置（按 y 排序）===\n');
const sorted = [...layout.nodes].sort((a, b) => a.box.y - b.box.y);
for (const ln of sorted) {
  const label = ln.node.type === 'entity' ? `@${ln.node.ref.kind}:${ln.node.ref.id}` : ln.node.text;
  console.log(
    `  y=${Math.round(ln.box.y).toString().padStart(5)}  x=[${Math.round(ln.box.x).toString().padStart(5)}, ${Math.round(
      ln.box.x + ln.box.w,
    )
      .toString()
      .padStart(5)}]  ${label}`,
  );
}
