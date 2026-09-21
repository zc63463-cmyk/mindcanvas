/**
 * 生成「连线调参对照页」——同一张导图、同一组关系线，切换 corridor/bend 权重即时对比。
 *
 * 目的：把 #6 调参验收从"对着数字想象"变成"看一眼就能定"。
 * 输出：docs/preview/routing-tuning.html
 *
 * 运行：cd apps/canvas && npx vite-node scripts/gen-routing-tuning.mjs
 */
import { writeFileSync } from 'node:fs';
import {
  routeAesthetic,
  polylineHitsObstacle,
} from '../../../packages/react/src/render/edgeRouting.ts';

// ---------- 场景：双侧思维导图 ----------
// 根节点居中，左右各 3 个一级分支、每个分支 2 个二级节点。
const N = (id, x, y, w, h, label) => ({ id, x, y, w, h, label });

const root = N('root', 520, 380, 140, 40, '中心主题');

const nodes = [
  root,
  // 右分支
  N('R1', 720, 120, 130, 34, '右·分支一'),
  N('R2', 720, 380, 130, 34, '右·分支二'),
  N('R3', 720, 640, 130, 34, '右·分支三'),
  N('R1a', 900, 56, 120, 34, 'R1a'),
  N('R1b', 900, 184, 120, 34, 'R1b'),
  N('R2a', 900, 316, 120, 34, 'R2a'),
  N('R2b', 900, 444, 120, 34, 'R2b'),
  N('R3a', 900, 576, 120, 34, 'R3a'),
  N('R3b', 900, 704, 120, 34, 'R3b'),
  // 左分支
  N('L1', 300, 120, 130, 34, '左·分支一'),
  N('L2', 300, 380, 130, 34, '左·分支二'),
  N('L3', 300, 640, 130, 34, '左·分支三'),
  N('L1a', 140, 56, 120, 34, 'L1a'),
  N('L1b', 140, 184, 120, 34, 'L1b'),
  N('L2a', 140, 316, 120, 34, 'L2a'),
  N('L2b', 140, 444, 120, 34, 'L2b'),
  N('L3a', 140, 576, 120, 34, 'L3a'),
  N('L3b', 140, 704, 120, 34, 'L3b'),
];

const byId = new Map(nodes.map((n) => [n.id, n]));

// 树边（父子连线，仅作背景参照）
const treeEdges = [
  ['root', 'R1'],
  ['root', 'R2'],
  ['root', 'R3'],
  ['R1', 'R1a'],
  ['R1', 'R1b'],
  ['R2', 'R2a'],
  ['R2', 'R2b'],
  ['R3', 'R3a'],
  ['R3', 'R3b'],
  ['root', 'L1'],
  ['root', 'L2'],
  ['root', 'L3'],
  ['L1', 'L1a'],
  ['L1', 'L1b'],
  ['L2', 'L2a'],
  ['L2', 'L2b'],
  ['L3', 'L3a'],
  ['L3', 'L3b'],
];

// 关系线（本次要调参的对象）——刻意覆盖多种形态
const relEdges = [
  {
    id: 'e1',
    from: 'L2a',
    to: 'R2a',
    color: '#94a3b8',
    note: '对照组：直线本就通畅（不该无谓弯曲）',
  },
  { id: 'e2', from: 'L1b', to: 'R3a', color: '#e5484d', note: '被根节点挡·斜向长边' },
  { id: 'e3', from: 'R1a', to: 'R3b', color: '#f5a524', note: '纵向长边·穿过本级与二级节点' },
  { id: 'e4', from: 'L1a', to: 'L3b', color: '#3b82f6', note: '纵向长边·同侧穿多级' },
  { id: 'e5', from: 'R2a', to: 'R3a', color: '#8b5cf6', note: '短边被单个节点挡（看弧是否夸张）' },
  { id: 'e6', from: 'L3b', to: 'R1a', color: '#10b981', note: '长斜向·被根节点挡' },
  // 争议边：直线没撞上任何卡片，但只擦着约 17px 的间隙从节点中间穿过 ——
  // 这正是「走中心」投诉的形态，也是 corridor 权重唯一真正起作用的场景。
  { id: 'e7', from: 'L1b', to: 'R1a', color: '#ec4899', note: '争议·贴 L1/R1 擦过（间隙≈17px）' },
  { id: 'e8', from: 'L3a', to: 'R3b', color: '#06b6d4', note: '争议·贴 L3/R3 擦过（间隙≈17px）' },
];

// ---------- 参数预设 ----------
const PRESETS = [
  {
    key: 'A',
    name: '旧行为（无净空罚分）',
    clearance: 0,
    bend: 1.5,
    desc: 'clearance=0 / bend=1.5 —— 修复前的样子，弧小但会贴着节点群穿中心',
  },
  {
    key: 'B',
    name: '当前默认',
    clearance: 14,
    bend: 2.5,
    desc: 'clearance=14 / bend=2.5 —— 本次修正后的取值（bend 与 clearance 同量级）',
  },
  {
    key: 'C',
    name: '收敛（弧更小）',
    clearance: 8,
    bend: 3.5,
    desc: 'clearance=8 / bend=3.5 —— 若觉得默认弧太大',
  },
  {
    key: 'D',
    name: '坚决（更走外侧）',
    clearance: 24,
    bend: 0.8,
    desc: 'clearance=24 / bend=0.8 —— 若觉得还是贴中心（代价是弧更大）',
  },
];

// ---------- 几何工具 ----------
const center = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** 从 path d 反推曲率 c（控制点法向偏移 / 弦长） */
function curvatureOf(d) {
  const m = d.match(
    /^M ([\d.-]+) ([\d.-]+) C ([\d.-]+) ([\d.-]+), ([\d.-]+) ([\d.-]+), ([\d.-]+) ([\d.-]+)$/,
  );
  if (!m) return 0;
  const n = m.slice(1).map(Number);
  const p0 = { x: n[0], y: n[1] };
  const c1 = { x: n[2], y: n[3] };
  const p3 = { x: n[6], y: n[7] };
  const dx = p3.x - p0.x;
  const dy = p3.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  // c1 相对弦的法向偏移 = bow = len * c
  const bow = ((c1.x - p0.x) * -dy + (c1.y - p0.y) * dx) / len;
  return bow / len;
}

function segmentsOf(pts) {
  const out = [];
  for (let i = 0; i + 1 < pts.length; i++) out.push([pts[i], pts[i + 1]]);
  return out;
}

function segCross(a1, a2, b1, b2) {
  const d = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = d(a1, a2, b1);
  const d2 = d(a1, a2, b2);
  const d3 = d(b1, b2, a1);
  const d4 = d(b1, b2, a2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** 采样 path（M..L 或 M..C）为折线 */
function samplePath(d, n = 40) {
  const m = d.match(
    /^M ([\d.-]+) ([\d.-]+) C ([\d.-]+) ([\d.-]+), ([\d.-]+) ([\d.-]+), ([\d.-]+) ([\d.-]+)$/,
  );
  if (!m) {
    const l = d.match(/^M ([\d.-]+) ([\d.-]+) L ([\d.-]+) ([\d.-]+)$/);
    if (!l) return [];
    const v = l.slice(1).map(Number);
    return Array.from({ length: n + 1 }, (_, i) => ({
      x: v[0] + ((v[2] - v[0]) * i) / n,
      y: v[1] + ((v[3] - v[1]) * i) / n,
    }));
  }
  const v = m.slice(1).map(Number);
  const p0 = { x: v[0], y: v[1] };
  const c1 = { x: v[2], y: v[3] };
  const c2 = { x: v[4], y: v[5] };
  const p3 = { x: v[6], y: v[7] };
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({
      x: u ** 3 * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * p3.x,
      y: u ** 3 * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * p3.y,
    });
  }
  return out;
}

// ---------- 跑每个预设 ----------
const PAD = 3;
const results = [];

for (const preset of PRESETS) {
  const routedEdges = [];
  const polylines = [];
  for (const e of relEdges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    const obstacles = nodes.filter((n) => n.id !== e.from && n.id !== e.to);
    const r = routeAesthetic(a, b, obstacles, polylines, {
      weights: { clearance: preset.clearance, bend: preset.bend },
    });
    polylines.push([...r.points]);
    routedEdges.push({ ...e, r, pts: samplePath(r.d), c: curvatureOf(r.d) });
  }

  // 指标
  let hits = 0;
  let maxDevRatio = 0;
  let sumAbsC = 0;
  for (const e of routedEdges) {
    const obstacles = nodes.filter((n) => n.id !== e.from && n.id !== e.to);
    if (polylineHitsObstacle(e.pts, obstacles, PAD)) hits++;
    const p0 = e.pts[0];
    const p3 = e.pts[e.pts.length - 1];
    const dx = p3.x - p0.x;
    const dy = p3.y - p0.y;
    const len = Math.hypot(dx, dy) || 1;
    let maxDev = 0;
    for (const q of e.pts) {
      const dev = Math.abs(((q.x - p0.x) * -dy + (q.y - p0.y) * dx) / len);
      if (dev > maxDev) maxDev = dev;
    }
    maxDevRatio = Math.max(maxDevRatio, maxDev / len);
    sumAbsC += Math.abs(e.c);
  }

  // 与树边的交叉数（视觉噪声）
  const treeSegs = [];
  for (const [from, to] of treeEdges) {
    const a = center(byId.get(from));
    const b = center(byId.get(to));
    treeSegs.push([a, b]);
  }
  let treeCrossings = 0;
  for (const e of routedEdges) {
    for (const s of segmentsOf(e.pts)) {
      for (const t of treeSegs) if (segCross(s[0], s[1], t[0], t[1])) treeCrossings++;
    }
  }

  results.push({
    ...preset,
    edges: routedEdges,
    metrics: {
      hits,
      maxDevRatio,
      avgAbsC: sumAbsC / routedEdges.length,
      treeCrossings,
      curvedCount: routedEdges.filter((e) => e.r.routed).length,
    },
  });
}

// ---------- 渲染 ----------
const minX = Math.min(...nodes.map((n) => n.x)) - 60;
const minY = Math.min(...nodes.map((n) => n.y)) - 60;
const maxX = Math.max(...nodes.map((n) => n.x + n.w)) + 60;
const maxY = Math.max(...nodes.map((n) => n.y + n.h)) + 60;
const VW = maxX - minX;
const VH = maxY - minY;

function renderMap(result, w = 760) {
  const h = (VH / VW) * w;
  const s = w / VW;
  const tx = (x) => (x - minX) * s;
  const ty = (y) => (y - minY) * s;

  const treeSvg = treeEdges
    .map(([from, to]) => {
      const a = center(byId.get(from));
      const b = center(byId.get(to));
      return `<line x1="${tx(a.x).toFixed(1)}" y1="${ty(a.y).toFixed(1)}" x2="${tx(b.x).toFixed(1)}" y2="${ty(b.y).toFixed(1)}" stroke="#c9c4b8" stroke-width="${1.4 * s}" />`;
    })
    .join('\n');

  const nodeSvg = nodes
    .map((n) => {
      const isRoot = n.id === 'root';
      return `<g>
      <rect x="${tx(n.x).toFixed(1)}" y="${ty(n.y).toFixed(1)}" width="${(n.w * s).toFixed(1)}" height="${(n.h * s).toFixed(1)}"
        rx="${6 * s}" fill="${isRoot ? '#2d2a26' : '#ffffff'}" stroke="${isRoot ? '#2d2a26' : '#b9b2a4'}" stroke-width="${1.2 * s}" />
      <text x="${tx(n.x + n.w / 2).toFixed(1)}" y="${ty(n.y + n.h / 2 + 4).toFixed(1)}" text-anchor="middle"
        font-size="${11 * s}" fill="${isRoot ? '#ffffff' : '#3a352e'}" font-family="system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif">${n.label}</text>
    </g>`;
    })
    .join('\n');

  const edgeSvg = result.edges
    .map((e) => {
      const d = e.r.d
        .replace(
          /^M ([\d.-]+) ([\d.-]+) C ([\d.-]+) ([\d.-]+), ([\d.-]+) ([\d.-]+), ([\d.-]+) ([\d.-]+)$/,
          (_m, x0, y0, c1x, c1y, c2x, c2y, x3, y3) =>
            `M ${tx(+x0).toFixed(1)} ${ty(+y0).toFixed(1)} C ${tx(+c1x).toFixed(1)} ${ty(+c1y).toFixed(1)}, ${tx(+c2x).toFixed(1)} ${ty(+c2y).toFixed(1)}, ${tx(+x3).toFixed(1)} ${ty(+y3).toFixed(1)}`,
        )
        .replace(
          /^M ([\d.-]+) ([\d.-]+) L ([\d.-]+) ([\d.-]+)$/,
          (_m, x0, y0, x3, y3) =>
            `M ${tx(+x0).toFixed(1)} ${ty(+y0).toFixed(1)} L ${tx(+x3).toFixed(1)} ${ty(+y3).toFixed(1)}`,
        );
      return `<path d="${d}" fill="none" stroke="${e.color}" stroke-width="${2.2 * s}" stroke-linecap="round" opacity="0.9" />`;
    })
    .join('\n');

  return `<svg viewBox="0 0 ${w} ${h.toFixed(0)}" width="100%" style="display:block">
  ${treeSvg}
  ${edgeSvg}
  ${nodeSvg}
</svg>`;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

const tabsHtml = results
  .map(
    (r, i) =>
      `<button class="tab${i === 1 ? ' active' : ''}" data-i="${i}">${r.key} · ${esc(r.name)}</button>`,
  )
  .join('');

const panelsHtml = results
  .map(
    (r, i) => `<div class="panel${i === 1 ? ' active' : ''}" data-i="${i}">
    <div class="preset-desc"><b>${r.key}. ${esc(r.name)}</b> —— ${esc(r.desc)}</div>
    <div class="cols">
      <div class="map">${renderMap(r)}</div>
      <div class="side">
        <table class="metrics">
          <tr><td>平均 |曲率|</td><td><b>${r.metrics.avgAbsC.toFixed(2)}</b></td></tr>
          <tr><td>最大 弧高/弦长</td><td><b>${(r.metrics.maxDevRatio * 100).toFixed(0)}%</b></td></tr>
          <tr><td>弯曲绕行边数</td><td><b>${r.metrics.curvedCount} / ${relEdges.length}</b></td></tr>
          <tr><td>与树线交叉</td><td><b>${r.metrics.treeCrossings}</b></td></tr>
          <tr><td>穿障边数</td><td class="${r.metrics.hits === 0 ? 'ok' : 'bad'}"><b>${r.metrics.hits}</b></td></tr>
        </table>
        <div class="legend">
          ${relEdges.map((e) => `<div class="lg"><i style="background:${e.color}"></i><span>${e.id} ${esc(e.note)}</span></div>`).join('')}
        </div>
        <div class="per">
          <div class="per-h">逐边曲率</div>
          ${r.edges
            .map(
              (e) =>
                `<div class="per-row"><span class="sw" style="background:${e.color}"></span><span class="pid">${e.id}</span><span class="pbar"><i style="width:${Math.min(100, Math.abs(e.c) * 50)}%;background:${e.color}"></i></span><span class="pv">${e.c.toFixed(2)}</span></div>`,
            )
            .join('')}
        </div>
      </div>
    </div>
  </div>`,
  )
  .join('');

const gridHtml = results
  .map(
    (r) => `<div class="cell">
    <div class="cell-h">${r.key}. ${esc(r.name)}</div>
    ${renderMap(r, 460)}
    <div class="cell-m">平均|曲率| ${r.metrics.avgAbsC.toFixed(2)} · 最大弧高 ${(r.metrics.maxDevRatio * 100).toFixed(0)}% · 树线交叉 ${r.metrics.treeCrossings}</div>
  </div>`,
  )
  .join('');

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>连线调参对照 · mindcanvas</title>
<style>
  :root { --bg:#fbf9f4; --card:#fff; --line:#e3ddd0; --ink:#2d2a26; --mute:#7a7367; --accent:#8a6d3b; }
  * { box-sizing:border-box; }
  body { margin:0; padding:28px 24px 64px; background:var(--bg); color:var(--ink);
    font-family:system-ui,-apple-system,'Segoe UI','Microsoft YaHei',sans-serif; }
  h1 { font-size:20px; margin:0 0 6px; letter-spacing:.3px; }
  .sub { color:var(--mute); font-size:13px; margin-bottom:20px; line-height:1.7; }
  .tabs { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:16px; }
  .tab { padding:8px 14px; border:1px solid var(--line); background:var(--card); color:var(--ink);
    border-radius:8px; cursor:pointer; font-size:13px; transition:.15s; }
  .tab:hover { border-color:var(--accent); }
  .tab.active { background:var(--ink); color:#fff; border-color:var(--ink); }
  .panel { display:none; background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; }
  .panel.active { display:block; }
  .preset-desc { font-size:13px; color:var(--mute); margin-bottom:14px; padding-bottom:12px; border-bottom:1px dashed var(--line); }
  .cols { display:grid; grid-template-columns:minmax(0,1.55fr) minmax(260px,1fr); gap:18px; align-items:start; }
  .map { background:#fffdf8; border:1px solid var(--line); border-radius:10px; padding:8px; }
  .side { display:flex; flex-direction:column; gap:14px; }
  table.metrics { width:100%; border-collapse:collapse; font-size:13px; }
  table.metrics td { padding:7px 4px; border-bottom:1px solid #f0ece2; }
  table.metrics td:last-child { text-align:right; }
  .ok { color:#1a7f37; } .bad { color:#c0392b; }
  .legend { display:flex; flex-direction:column; gap:6px; font-size:12px; color:var(--mute); }
  .lg { display:flex; align-items:center; gap:8px; }
  .lg i { width:14px; height:3px; border-radius:2px; flex:none; }
  .per { font-size:12px; }
  .per-h { color:var(--mute); margin-bottom:8px; }
  .per-row { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
  .sw { width:10px; height:10px; border-radius:3px; flex:none; }
  .pid { width:26px; color:var(--mute); flex:none; }
  .pbar { flex:1; height:6px; background:#f0ece2; border-radius:3px; overflow:hidden; }
  .pbar i { display:block; height:100%; border-radius:3px; }
  .pv { width:34px; text-align:right; font-variant-numeric:tabular-nums; }
  h2 { font-size:16px; margin:32px 0 12px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:14px; }
  .cell { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px; }
  .cell-h { font-size:13px; font-weight:600; margin-bottom:8px; }
  .cell-m { font-size:11px; color:var(--mute); margin-top:8px; font-variant-numeric:tabular-nums; }
  .note { margin-top:28px; font-size:12px; color:var(--mute); line-height:1.8;
    background:#fffdf8; border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
  @media (max-width:900px){ .cols{ grid-template-columns:1fr; } }
</style>
</head>
<body>
<h1>连线调参对照</h1>
<div class="sub">
  同一张双侧思维导图、同一组 5 条关系线，只切换 <code>corridor</code>（走廊穿越罚分）与 <code>bend</code>（曲率罚分）两个权重。
  目标选型的判断点：<b>弧是否大到喧宾夺主</b> vs <b>是否还在贴着节点群中心走</b>。
</div>

<div class="tabs">${tabsHtml}</div>
${panelsHtml}

<h2>四预设并排</h2>
<div class="grid">${gridHtml}</div>

<div class="note">
  <b>怎么读这张表</b><br>
  · <b>平均 |曲率|</b> 越低越平；<b>最大弧高/弦长</b> 是最夸张那条线鼓出去多少（超过约 60% 就会显得绕远）。<br>
  · <b>与树线交叉</b> 是视觉噪声指标 —— 关系线压过父子连线越多，图越乱。<br>
  · <b>穿障边数</b> 必须为 0，非 0 即为缺陷。<br>
  · <b>弯曲绕行边数</b> 的比例反映"有多少条边真的需要绕"；无障碍的短边本该直连。<br><br>
  <b>调节方向</b>：觉得弧太大 → 调小 <code>corridor</code> / 调大 <code>bend</code>（往 C 走）；
  觉得还是贴中心 → 调大 <code>corridor</code> / 调小 <code>bend</code>（往 D 走）。
</div>

<script>
  const tabs = document.querySelectorAll('.tab')
  const panels = document.querySelectorAll('.panel')
  tabs.forEach((t) => t.addEventListener('click', () => {
    const i = t.dataset.i
    tabs.forEach((x) => x.classList.toggle('active', x === t))
    panels.forEach((p) => p.classList.toggle('active', p.dataset.i === i))
  }))
</script>
</body>
</html>
`;

const out = new URL('../../../docs/preview/routing-tuning.html', import.meta.url);
writeFileSync(out, html, 'utf8');
console.log('已生成:', out);

console.log('\n=== 指标汇总 ===');
console.log('预设   平均|c|  最大弧高/弦长  弯曲边  树线交叉  穿障');
for (const r of results) {
  const m = r.metrics;
  console.log(
    `${r.key}      ${m.avgAbsC.toFixed(2)}      ${(m.maxDevRatio * 100).toFixed(0).padStart(3)}%         ` +
      `${m.curvedCount}/${relEdges.length}      ${String(m.treeCrossings).padStart(2)}       ${m.hits}`,
  );
}

// 逐边曲率 —— 用于判断每条边的取值是"早停拍板"还是"评分拍板"
console.log('\n=== 逐边曲率（早停阈值 |c| <= 0.45；超过即由评分决定）===');
console.log('边    ' + PRESETS.map((p) => p.key.padStart(7)).join('') + '   形态');
for (let i = 0; i < relEdges.length; i++) {
  const row = results.map((r) => {
    const e = r.edges[i];
    const c = e.c;
    return (e.r.routed ? c.toFixed(2) : '直线').padStart(7);
  });
  console.log(`${relEdges[i].id}  ${row.join('')}   ${relEdges[i].note}`);
}
