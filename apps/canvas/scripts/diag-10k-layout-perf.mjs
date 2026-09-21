/**
 * 诊断：10K 全量布局 vs 增量布局的【稳态】耗时分布。
 *
 * 背景：`tests/acceptance-10k.test.tsx` 的门禁 `incMs < layoutMs * 0.5` 偶发抖动。
 * 该测试里 layoutMs 是**单次冷启动**测量、incMs 是**7 次热态中位数** ——
 * 分母不稳而分子稳，阈值就会忽紧忽松。本脚本测出冷/热各自的真实分布，
 * 用来定一个既稳定、又不掩盖真实回归的阈值。
 *
 * 运行：cd apps/canvas && npx vite-node scripts/diag-10k-layout-perf.mjs
 */
import {
  LayoutCache,
  astToEditable,
  layoutMindmap,
  parseMm,
  updateNode,
} from '../../packages/kernel/src/index.ts';
import { createCharMeasure, createNodeMeasure } from '../../packages/react/src/render/domMeasure.ts';

function genBigSource(depth = 8, fanout = 3) {
  const lines = ['# 10K 节点验收图', ''];
  let seq = 0;
  const walk = (d, indent) => {
    if (d >= depth) return;
    for (let i = 0; i < fanout; i++) {
      lines.push(`${indent}- n${seq++}`);
      walk(d + 1, indent + '  ');
    }
  };
  walk(0, '');
  return lines.join('\n');
}

const stat = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const med = s[Math.floor(s.length / 2)];
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return { min: s[0], med, max: s[s.length - 1], mean };
};
const fmt = (o) =>
  `min=${o.min.toFixed(1)} 中位=${o.med.toFixed(1)} 均值=${o.mean.toFixed(1)} max=${o.max.toFixed(1)}`;

const source = genBigSource();
const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
const measure = () => createNodeMeasure(char, new Map());

const t0 = performance.now();
const { root } = parseMm(source);
console.log(`parseMs = ${(performance.now() - t0).toFixed(1)}`);

const editable = astToEditable(root);

// ── 全量布局：第 1 次是冷启动，之后是热态 ──
const coldT = performance.now();
let layout = layoutMindmap(editable, measure(), new Set());
const coldMs = performance.now() - coldT;
console.log(`\n全量布局 冷启动 = ${coldMs.toFixed(1)}ms`);

const fullTimes = [];
for (let i = 0; i < 9; i++) {
  const t = performance.now();
  layout = layoutMindmap(editable, measure(), new Set());
  fullTimes.push(performance.now() - t);
}
const full = stat(fullTimes);
console.log(`全量布局 热态 x9: ${fmt(full)}`);
console.log(`  逐次: [${fullTimes.map((x) => x.toFixed(1)).join(', ')}]`);

// ── 增量布局：预热后取稳态 ──
const cache = new LayoutCache();
layoutMindmap(editable, measure(), new Set(), { cache, measureKey: 'k' });

let leaf = editable;
const findLeaf = (n) => {
  if (n.children.length === 0) leaf = n;
  else for (const c of n.children) findLeaf(c);
};
findLeaf(editable);
const edited = updateNode(editable, leaf.id, { text: 'x'.repeat(10) });

const incTimes = [];
for (let i = 0; i < 9; i++) {
  const t = performance.now();
  layoutMindmap(edited, measure(), new Set(), { cache, measureKey: 'k' });
  incTimes.push(performance.now() - t);
}
const inc = stat(incTimes);
console.log(`\n增量布局 x9（每次新建 measure）: ${fmt(inc)}`);
console.log(`  逐次: [${incTimes.map((x) => x.toFixed(1)).join(', ')}]`);

// ── 对照：复用同一个 measure（内含文本宽度缓存），看增量收益是否被"每次重测文本"掩盖 ──
const sharedMeasure = createNodeMeasure(char, new Map());
const cache2 = new LayoutCache();
layoutMindmap(editable, sharedMeasure, new Set(), { cache: cache2, measureKey: 'k' });
const fullSharedTimes = [];
for (let i = 0; i < 9; i++) {
  const t = performance.now();
  layoutMindmap(editable, sharedMeasure, new Set(), { cache: cache2, measureKey: 'k' });
  fullSharedTimes.push(performance.now() - t);
}
const fullShared = stat(fullSharedTimes);
console.log(`\n[对照] 全量布局 x9（复用 measure + cache）: ${fmt(fullShared)}`);

const incSharedTimes = [];
for (let i = 0; i < 9; i++) {
  const t = performance.now();
  layoutMindmap(edited, sharedMeasure, new Set(), { cache: cache2, measureKey: 'k' });
  incSharedTimes.push(performance.now() - t);
}
const incShared = stat(incSharedTimes);
console.log(`[对照] 增量布局 x9（复用 measure + cache）: ${fmt(incShared)}`);
console.log(
  `  → 增量/全量 = ${((incShared.med / fullShared.med) * 100).toFixed(1)}%  (复用 measure 时)`,
);

// ── 验证假设：collapsed 每次新建 Set 是否会让缓存永不命中 ──
// T6（kernel）实测增量/全量 = 1.2%，本脚本却是 105%。唯一的调用差异是：
// T6 复用同一个 collapsed 引用，而这里每次 `new Set()`。若缓存键含 collapsed 引用，则永远不命中。
const stableCollapsed = new Set();
const cache3 = new LayoutCache();
const measure3 = createNodeMeasure(char, new Map());
layoutMindmap(editable, measure3, stableCollapsed, { cache: cache3, measureKey: 'k' });
const incStableTimes = [];
for (let i = 0; i < 9; i++) {
  const t = performance.now();
  layoutMindmap(edited, measure3, stableCollapsed, { cache: cache3, measureKey: 'k' });
  incStableTimes.push(performance.now() - t);
}
const incStable = stat(incStableTimes);
console.log(`\n[验证] 增量布局 x9（collapsed 引用稳定）: ${fmt(incStable)}`);
console.log(`  → 对比「每次 new Set()」的 ${incShared.med.toFixed(1)}ms：` +
  `${incShared.med > incStable.med * 3 ? '缓存确实因新 Set 而未命中！' : '差异不大，假设不成立'}`);

console.log('\n=== 稳态比例（增量 / 全量）===');
console.log(`  中位数比: ${((inc.med / full.med) * 100).toFixed(1)}%`);
console.log(`  均值比  : ${((inc.mean / full.mean) * 100).toFixed(1)}%`);
console.log(`  最坏比  : ${((inc.max / full.min) * 100).toFixed(1)}%  (增量最慢 / 全量最快)`);
console.log(`\n=== 若沿用「单次冷启动 layoutMs」作分母 ===`);
console.log(`  增量中位 / 冷启动 = ${((inc.med / coldMs) * 100).toFixed(1)}%`);
console.log(`  → 现行阈值 50% 的余量: ${(0.5 / (inc.med / coldMs)).toFixed(2)}x`);
void layout;
