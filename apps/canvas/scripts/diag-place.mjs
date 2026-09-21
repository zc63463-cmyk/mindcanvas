/**
 * 节点落位诊断：打印每个节点「为什么在这」——有效生长方向（● 显式 / ○ 继承）、
 * 盒坐标，以及盒重叠 / 连线压盒清单。用于定位「节点被顶远 / 连线穿过节点」。
 *
 * 用法：pnpm --filter canvas exec node scripts/diag-place.mjs <path/to/xxx.mm.md>
 *      （不给路径则用仓库根的 gateway.mm.md）
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  astToEditable,
  collectNodes,
  findLinkCrossings,
  findOverlaps,
  layoutMindmapBranched,
  linkGeometry,
  LINK_CLEAR_MARGIN,
  NodeIndex,
  parseMm,
  SEPARATE_MARGIN,
} from '@mindcanvas/kernel';
import { buildIslandView, createCharMeasure, createNodeMeasure } from '@mindcanvas/react';
import { collectCenters } from '@mindcanvas/react';

const file = process.argv[2];
if (!file) {
  console.error('用法：node scripts/diag-place.mjs <path/to/xxx.mm.md>');
  process.exit(1);
}
const parsed = parseMm(readFileSync(file, 'utf8'));
const editable = parsed.root ? astToEditable(parsed.root) : null;
if (!editable) {
  console.error(`无法解析 ${file}`);
  process.exit(1);
}

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
const measure = createNodeMeasure(char, new Map());
const centers = collectCenters(editable);
const islandView = buildIslandView(editable, centers);

console.log(`文档：${file}`);
console.log(`中心（岛）标注：${centers.length} 条`);
for (const c of centers) {
  console.log(
    `  at=${c.at}  nodeId=${c.nodeId ?? '(失效)'}  dir=${c.dir}  ` +
      `pos=${c.pos ? `(${c.pos.x}, ${c.pos.y})` : '无（自动排列）'}`,
  );
}

if (islandView.specs) {
  console.log('\n⚠ 该文档存在布局岛（多中心）：各岛按 centers 坐标落位，单树口径不适用。');
  console.log('  若某岛位置离谱，先看上面 pos —— 带坐标的岛永远按坐标摆放，dir 不参与。');
  process.exit(0);
}

const layout = layoutMindmapBranched(editable, measure, new Set());
const root = layout.nodes.find((n) => n.parentId === null);
if (!root) {
  console.error('布局结果缺少根节点');
  process.exit(1);
}

const dirOf = new Map();
const byId = new Map();
const walkDirs = (n) => {
  byId.set(n.node.id, n);
  const d = n.node.note?.dir;
  if (typeof d === 'string') dirOf.set(n.node.id, d);
  else {
    const p = n.parentId === null ? undefined : byId.get(n.parentId);
    dirOf.set(n.node.id, (p && dirOf.get(p.node.id)) || 'right');
  }
  for (const c of n.children) walkDirs(c);
};
walkDirs(root);

console.log('\n节点落位（● 自己声明 dir / ○ 继承）：');
for (const n of layout.nodes) {
  const explicit = typeof n.node.note?.dir === 'string';
  const indent = '  '.repeat(Math.max(0, n.depth));
  const text = String(n.node.text).slice(0, 18);
  console.log(
    `  ${indent}${text.padEnd(20)} ${explicit ? '●' : '○'} ` +
      `${String(dirOf.get(n.node.id) ?? '').padEnd(5)} ` +
      `box=(${n.box.x.toFixed(0)}, ${n.box.y.toFixed(0)}) ${n.box.w.toFixed(0)}×${n.box.h.toFixed(0)}`,
  );
}

const index = new NodeIndex(collectNodes(root));
const crossings = findLinkCrossings(
  root,
  (p, c) => linkGeometry(p, c, dirOf.get(c.node.id) ?? 'right', dirOf, index).points,
  LINK_CLEAR_MARGIN,
);
const overlaps = findOverlaps(root);

console.log(`\n盒重叠对：${overlaps.length}（分离 margin=${SEPARATE_MARGIN}）`);
for (const o of overlaps.slice(0, 8)) {
  console.log(`  ✗ 「${o.a.node.text}」 × 「${o.b.node.text}」`);
}
console.log(`连线压盒：${crossings.length}（净空=${LINK_CLEAR_MARGIN}）`);
for (const k of crossings.slice(0, 8)) {
  console.log(`  ✗ 「${k.from.node.text}」→「${k.to.node.text}」 压过 「${k.node.node.text}」`);
}
