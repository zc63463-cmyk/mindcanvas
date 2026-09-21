/**
 * 四向分叉节点碰撞诊断：量化「消解前 / 消解后」的节点盒重叠。
 *
 * 用法：pnpm --filter canvas diag:overlap
 *
 * 断言口径：`findOverlaps` 只统计**非同一条祖先链**的相交节点盒
 * （父子本就要靠近，其重叠由「父盒障碍」环节单独消解）。
 */
import {
  collectNodes,
  findLinkCrossings,
  findOverlaps,
  layoutMindmapBranched,
  linkGeometry,
  LINK_CLEAR_MARGIN,
  makeTextNode,
  NodeIndex,
  SEPARATE_MARGIN,
} from '@mindcanvas/kernel';

/** 有效方向表（显式声明优先，否则沿用父）——与布局内部同口径，仅用于诊断复算 */
function effectiveDirMap(root) {
  const byId = new Map();
  const dirOf = new Map();
  const walk = (n) => {
    byId.set(n.node.id, n);
    const d = n.node.note?.dir;
    if (typeof d === 'string') dirOf.set(n.node.id, d);
    else {
      const p = n.parentId === null ? undefined : byId.get(n.parentId);
      dirOf.set(n.node.id, (p && dirOf.get(p.node.id)) || 'right');
    }
    for (const c of n.children) walk(c);
  };
  walk(root);
  return dirOf;
}

/** 用最终盒坐标重建连线，统计「连线压在别的节点盒上」的次数 */
function countLinkCrossings(root, withClear) {
  const dirOf = effectiveDirMap(root);
  const index = withClear ? new NodeIndex(collectNodes(root)) : undefined;
  return findLinkCrossings(
    root,
    (p, c) => linkGeometry(p, c, dirOf.get(c.node.id) ?? 'right', dirOf, index).points,
    LINK_CLEAR_MARGIN,
  ).length;
}

/** 定长度量：宽随文本长度、高固定（可复现） */
const measure = (n) => ({ w: (n.text?.length ?? 1) * 9 + 24, h: 30 });

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIRS = ['right', 'left', 'down', 'up'];

function randomTree(node, rand, depth, maxDepth) {
  if (depth >= maxDepth) return node;
  const n = 1 + Math.floor(rand() * 3.2);
  for (let i = 0; i < n; i++) {
    const kid = makeTextNode(`${'x'.repeat(1 + Math.floor(rand() * 8))}-${depth}${i}`);
    if (rand() < 0.8) kid.note = { dir: DIRS[Math.floor(rand() * 4)] };
    randomTree(kid, rand, depth + 1, maxDepth);
    node.children.push(kid);
  }
  return node;
}

const rootOf = (res) => res.nodes.find((n) => n.parentId === null);

// ---------- 1. 随机压力：消解前后对比 ----------
const SEEDS = 200;
let cases = 0;
let dirty = 0;
let pairsBefore = 0;
let pairsAfter = 0;
let crossBefore = 0;
let crossAfter = 0;
let firstBadSeed = -1;

for (let seed = 1; seed <= SEEDS; seed++) {
  const raw = randomTree(makeTextNode('根'), mulberry32(seed), 0, 4);
  if (raw.children.length === 0) continue;
  cases++;
  const off = layoutMindmapBranched(raw, measure, new Set(), { separate: false });
  const on = layoutMindmapBranched(raw, measure, new Set());
  const before = findOverlaps(rootOf(off)).length;
  const after = findOverlaps(rootOf(on)).length;
  pairsBefore += before;
  pairsAfter += after;
  crossBefore += countLinkCrossings(rootOf(off), false);
  crossAfter += countLinkCrossings(rootOf(on), true);
  if (before > 0) {
    dirty++;
    if (firstBadSeed < 0) firstBadSeed = seed;
  }
}

console.log('四向分叉节点碰撞诊断（margin=' + SEPARATE_MARGIN + '）\n');
console.log(`  随机树用例              ${cases}（种子 1..${SEEDS}）`);
console.log(`  消解前有重叠的用例      ${dirty} (${((dirty / cases) * 100).toFixed(1)}%)`);
console.log(`  消解前重叠节点对总数    ${pairsBefore}`);
console.log(`  消解后重叠节点对总数    ${pairsAfter}`);
console.log(`  首个复现种子            ${firstBadSeed < 0 ? '—' : firstBadSeed}`);
console.log(`  连线压盒：避障前        ${crossBefore}`);
console.log(`  连线压盒：避障后        ${crossAfter}` +
  (crossBefore > 0 ? `（削减 ${((1 - crossAfter / crossBefore) * 100).toFixed(1)}%）` : ''));
console.log(pairsAfter === 0 ? '\n  ✅ 全部用例消解后零重叠' : '\n  ❌ 仍有残留重叠，消解未生效');

// ---------- 2. 人读示例：同节点四向分叉 ----------
const demo = makeTextNode('中心议题', []);
demo.children = ['右翼', '左翼', '下翼', '上翼'].map((text, i) =>
  Object.assign(makeTextNode(text), { note: { dir: DIRS[i] } }),
);
demo.children[0].children.push(makeTextNode('右翼·子一'), makeTextNode('右翼·子二'));
demo.children[2].children.push(makeTextNode('下翼·子一'), makeTextNode('下翼·子二'));

const shown = layoutMindmapBranched(demo, measure, new Set());
console.log('\n  四向分叉示例（盒左上角 + 尺寸）：');
for (const n of shown.nodes) {
  const tag = n.node.note?.dir ?? '—';
  console.log(
    `    ${String(n.node.text).padEnd(10)} dir=${tag.padEnd(5)} ` +
      `box=(${n.box.x.toFixed(0)}, ${n.box.y.toFixed(0)}) ${n.box.w.toFixed(0)}×${n.box.h.toFixed(0)}`,
  );
}
console.log(`    重叠对 = ${findOverlaps(rootOf(shown)).length}`);
