// 一次性目视诊断页生成器：新旧连线几何对比（semantic on/off × 多场景）
// 用法：cd packages/react && npx vite-node ../scripts/_edge-natural-preview.mts
// 输出：.workbuddy/tmp/edge-natural-preview.html（不进仓库）
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeAesthetic, semanticAnchorPair, tangentSBezier, type RouteObstacle } from '../src/render/edgeRouting.ts';

const dir = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..', '.workbuddy', 'tmp');
const out = resolve(dir, 'edge-natural-preview.html');
const box = (x: number, y: number, w = 100, h = 32) => ({ x, y, w, h });

interface Scene {
  name: string;
  a: { x: number; y: number; w: number; h: number };
  b: { x: number; y: number; w: number; h: number };
  obs: RouteObstacle[];
  stagger?: number;
}

const scenes: Scene[] = [
  { name: '水平 · 无障（直连）', a: box(0, 60), b: box(420, 60) },
  { name: '水平 · 轻障（小方块挡直线）', a: box(0, 60), b: box(420, 60), obs: [box(190, 50, 40, 80)] },
  { name: '水平 · 高墙（显著绕行）', a: box(0, 60), b: box(420, 60), obs: [box(190, -120, 40, 620)] },
  { name: '垂直 · 中层障碍', a: box(110, 0), b: box(110, 420), obs: [box(80, 190, 60, 40)] },
  { name: '斜流 · 中央障碍', a: box(0, 300), b: box(420, 80), obs: [box(140, 160, 130, 90)] },
  { name: '水平 · 平行入边（stagger 3）', a: box(0, 60), b: box(420, 60) },
  { name: '水平 · 平行入边（stagger 0/1/2）', a: box(0, 60), b: box(420, 60) },
];

function pathEl(d: string, color: string, width = 1.5, dash?: string): string {
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''} />`;
}

function sceneSvg(s: Scene, idx: number): string {
  const { a, b } = s;
  const pad = 30;
  const W = 560;
  const H = 420;
  const viewBox = `${Math.min(a.x, b.x) - pad} ${Math.min(a.y, b.y) - pad} ${W} ${H}`;
  let body = '';
  for (const o of s.obs ?? []) {
    body += `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" fill="rgba(255,80,80,0.14)" stroke="#e5484d" stroke-width="1" />`;
  }
  const render = (label: string, r: { d: string }, color: string, dash?: string) =>
    `<text x="${Math.min(a.x, b.x) - pad + 8}" y="${Math.min(a.y, b.y) - pad + (label === '新' ? 18 : 34)}" fill="#888" font-size="12">${label}</text>` +
    pathEl(r.d, color, 1.7, dash);
  const aRect = `<rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" rx="6" fill="rgba(46,160,255,0.16)" stroke="#5aa7ff" stroke-width="1.2" />`;
  const bRect = `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="6" fill="rgba(46,160,255,0.16)" stroke="#5aa7ff" stroke-width="1.2" />`;

  if (s.stagger !== undefined) {
    const sem = semanticAnchorPair(a, b, s.stagger);
    const t = tangentSBezier(sem.p0, sem.dir0, sem.p3, sem.dir3, 0.4);
    body += render('新 · 直接 tanBezier', t, '#52d97a');
    body += `<circle cx="${sem.p0.x}" cy="${sem.p0.y}" r="3.2" fill="#52d97a" /><circle cx="${sem.p3.x}" cy="${sem.p3.y}" r="3.2" fill="#52d97a" />`;
    body += aRect + bRect;
  } else {
    const good = routeAesthetic(a, b, s.obs ?? [], [], { semantic: true });
    const old = routeAesthetic(a, b, s.obs ?? [], [], { semantic: false });
    body += render('新（semantic）', good, '#52d97a');
    body += render('旧（greedy）', old, '#e879f9', '5 4');
    body += aRect + bRect;
    // 锚点标记
    const m = good.d.match(/^M ([\d.-]+) ([\d.-]+) /);
    if (m) body += `<circle cx="${m[1]}" cy="${m[2]}" r="2.6" fill="#52d97a" />`;
    const m2 = old.d.match(/^M ([\d.-]+) ([\d.-]+) /);
    if (m2) body += `<circle cx="${m2[1]}" cy="${m2[2]}" r="2.6" fill="#e879f9" />`;
  }

  return `<div class="scene"><h3>${idx + 1}. ${s.name}</h3><svg viewBox="${viewBox}" width="560" height="${H}" style="background:#12141a;border:1px solid #2a2d36;border-radius:8px">${body}</svg></div>`;
}

const staggerBlock = (() => {
  const a = box(0, 60);
  const b = box(420, 60);
  let inner = '';
  for (let s = 0; s <= 3; s++) {
    const sem = semanticAnchorPair(a, b, s);
    const t = tangentSBezier(sem.p0, sem.dir0, sem.p3, sem.dir3, 0.4);
    inner += pathEl(t.d, ['#52d97a', '#ffb340', '#5aa7ff', '#e879f9'][s], 1.6);
  }
  inner += `<rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" rx="6" fill="rgba(46,160,255,0.16)" stroke="#5aa7ff"/>`;
  inner += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="6" fill="rgba(46,160,255,0.16)" stroke="#5aa7ff"/>`;
  return `<div class="scene"><h3>平行入边错位（stagger 0..3，同一目标）</h3><svg viewBox="-30 -40 560 260" width="560" height="200" style="background:#12141a;border:1px solid #2a2d36;border-radius:8px">${inner}</svg></div>`;
})();

const html = `<!doctype html><html><head><meta charset="utf-8"><title>连线自然度诊断（P0/P1）</title>
<style>body{background:#0d1016;color:#ddd;font-family:ui-monospace,Consolas,monospace;margin:24px}.scene{margin-bottom:26px}h3{font-size:14px;margin:0 0 8px;color:#9aa4b2}svg text{font-family:ui-monospace,Consolas,monospace}</style>
</head><body><h2> edgeRouting · semantic vs greedy 对照（本页由诊断脚本生成，不入仓库）</h2>
${scenes.map((s, i) => sceneSvg(s, i)).join('\n')}
${staggerBlock}
</body></html>`;
writeFileSync(out, html, 'utf8');
console.log('written:', out);