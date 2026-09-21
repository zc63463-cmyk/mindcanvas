/**
 * G-P2 真浏览器视觉检查（2026-09-12 自由边路由重算治理）
 * ══════════════════════════════════════════════════════════════════════
 * 跑法：node tools/verify-freeedge-pan.mjs [baseUrl]   （默认 http://localhost:5174，需先起 dev server）
 *
 * 场景：清 localStorage → 内置示例 gateway.mm.md（自带 root.note.edges 自由边）。
 * 检查（硬断言）：
 *   ① pan 前后与回程，全部自由边 `path[d]` 非空、无 NaN/Infinity/undefined；
 *   ② 平移确实生效（投影 g 的 transform 变化）；
 *   ③ pan 全程自由边不被误删（每次都至少渲染 1 条；成员表前后打印供人工核对）。
 * 报告（人工比对截图用）：pan 前 / pan 后 / 回程 三张截图 → verify-shots/freeedge-pan-*.png；
 *   持久边（前后都在）的 d 是否逐字节相同（世界坐标路由在平移下应不变；成员变化触发的
 *   整表重算可能引起跨边协调差异，故此项为报告指标而非硬断言）。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:5174';
const SAFE_PAD = 28;
const PAN_DX = 18;
const PAN_DY = -6;
const STEPS = 14;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

await page.addInitScript(() => {
  try {
    localStorage.clear(); // 无「最近文档」→ 直接进内置示例（确定性）
  } catch {
    /* ignore */
  }
});

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('g[data-node-id]', { timeout: 20000 });
await page.waitForSelector('[data-free-edge]', { timeout: 15000 });
await page.waitForTimeout(1500); // 首帧稳定 + 入场动画收敛

/** 采样：投影 transform + 全部自由边可见 path 的 d（含有限性校验） */
const sample = () =>
  page.evaluate(() => {
    const proj = document.querySelector('svg > g');
    const edges = [];
    for (const g of document.querySelectorAll('[data-free-edge]')) {
      const paths = Array.from(g.querySelectorAll('path'));
      const visible = paths.find((p) => p.getAttribute('stroke') !== 'transparent');
      const d = visible ? (visible.getAttribute('d') ?? '') : '';
      const bad =
        d === '' || /NaN|Infinity|undefined|null/.test(d);
      edges.push({ key: g.getAttribute('data-free-edge'), d, bad });
    }
    return {
      transform: proj ? proj.getAttribute('transform') : null,
      edges,
    };
  });

const pan = async (start, dir = 1) => {
  await page.mouse.move(start.x, start.y);
  await page.waitForTimeout(120);
  await page.mouse.down();
  for (let i = 1; i <= STEPS; i++) {
    await page.mouse.move(start.x + dir * i * PAN_DX, start.y + dir * i * PAN_DY, { steps: 1 });
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(500); // 惯性收敛（本脚本只走 20px 级起步，速度低于阈值附近）
};

// 起点：网格扫描（远离节点盒 + 顶层是 svg，确保落在画布空白处 → 走 pan 分支）
const start = await page.evaluate((pad) => {
  const rects = Array.from(document.querySelectorAll('g[data-node-id]')).map((g) => {
    const r = g.getBoundingClientRect();
    return { x: r.x - pad, y: r.y - pad, r: r.right + pad, b: r.bottom + pad };
  });
  const inAny = (x, y) => rects.some((r) => x >= r.x && x <= r.r && y >= r.y && y <= r.b);
  const topmostIsSvg = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return !!el && el.tagName === 'svg';
  };
  for (let y = 760; y >= 80; y -= 60)
    for (let x = 60; x <= 1220; x += 60) {
      if (!topmostIsSvg(x, y)) continue;
      if (inAny(x, y)) continue;
      return { x, y };
    }
  return null;
}, SAFE_PAD);
if (!start) throw new Error('找不到可用的空白平移起点（网格扫描失败）');

const before = await sample();
await page.screenshot({ path: 'verify-shots/freeedge-pan-before.png' });

await pan(start);
const after = await sample();
await page.screenshot({ path: 'verify-shots/freeedge-pan-after.png' });

// 回程：反向平移回起点，验证「边重新进入」时仍无 NaN/不丢失
await pan({ x: start.x + STEPS * PAN_DX, y: start.y + STEPS * PAN_DY }, -1);
const back = await sample();
await page.screenshot({ path: 'verify-shots/freeedge-pan-back.png' });

/** 逐项校验：非空 + 有限 + 至少一条 */
const validate = (stage, s) => {
  if (s.edges.length === 0) throw new Error(`[${stage}] 自由边渲染数 = 0（误删/未解析）`);
  for (const e of s.edges) {
    if (e.bad) throw new Error(`[${stage}] 边 ${e.key} 的 d 非法：${JSON.stringify(e.d.slice(0, 80))}`);
  }
};

validate('before', before);
validate('after', after);
validate('back', back);
if (before.transform === after.transform) throw new Error('平移未生效（transform 未变化）');

/** 持久边 d 逐字节一致性（报告指标：世界坐标路由在纯平移下应不变） */
const pick = (s) => new Map(s.edges.map((e) => [e.key, e.d]));
const [b1, a1, k1] = [pick(before), pick(after), pick(back)];
const persistent = [...a1.keys()].filter((k) => b1.has(k));
const identical = persistent.filter((k) => a1.get(k) === b1.get(k));

console.log(
  JSON.stringify(
    {
      base: BASE,
      start,
      edgeCounts: { before: before.edges.length, after: after.edges.length, back: back.edges.length },
      panApplied: before.transform !== after.transform,
      transformBefore: before.transform,
      transformAfter: after.transform,
      transformBack: back.transform,
      persistentEdges: persistent.length,
      persistentDIdentical: identical.length,
      edgeKeys: before.edges.map((e) => e.key),
      invalidD: 0,
    },
    null,
    2,
  ),
);
await browser.close();
process.exit(0);
