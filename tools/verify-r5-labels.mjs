/**
 * R5-2 真浏览器状态截图：边标签层（edge-labels）上提后的「标签-节点邻接态」。
 * ══════════════════════════════════════════════════════════════════════
 * 跑法：node tools/verify-r5-labels.mjs [baseUrl] [before|after]
 *   （默认 http://localhost:5174；mode 进文件名）
 *
 * 场景：3 边文档（同 verify-r5-jump；3 ≠ 内置示例 2 条，绕开既有 stableByKeys
 *   跨文档复用缺陷——见 R5-1 报告「发现」一节）。自动定位「标签胶囊 ↔ 最近节点盒」
 *   最近对 → 放大 4x → 裁剪该邻域；打印最近距离（实测约 28px——贴边未交叠）。
 *
 * 诚实标注（实测，见 R5-2 报告偏差节）：本脚本的 before/after 两态在最小文档上
 * 【像素一致】——布局与路由把标签天然保持在净空走廊（约 1 世界 px 贴边但不交叠），
 * 可见遮挡差异无法在可构造文档中复现。层序修复的主验收 = jsdom 契约测试
 * （mapview-layer-order.test.tsx：data-layer 序列 + 标签计数 + 命中区反例钉）；
 * 本脚本保留为「标签邻接态」证据与层序调参的测量工具。
 * ══════════════════════════════════════════════════════════════════════
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:5174';
const MODE = process.argv[3] ?? 'after';
if (MODE !== 'before' && MODE !== 'after') throw new Error(`mode 须为 before|after，收到 ${MODE}`);

const DOC = `<!--
edges:
  - from: node:根/A
    to: node:根/D
    rel: blocks
    label: 长边关系
  - from: node:根/B
    to: node:根/C
    rel: blocks
    label: 短边关系
  - from: node:根/C
    to: node:根/A
    rel: relates-to
    label: 斜向标签
-->
# 根

- A
- B
- C
- D
`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });

await page.addInitScript((doc) => {
  try {
    localStorage.clear();
    localStorage.setItem(
      'mindcanvas.library.v1',
      JSON.stringify([
        { id: 'r5-label-demo', name: 'r5-label.mm.md', ts: Date.now(), folder: '', tags: [], source: doc },
      ]),
    );
  } catch {
    /* ignore */
  }
}, DOC);

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.click('button:has-text("继续上次")');
await page.waitForSelector('[data-edge-label]', { timeout: 10000 });
await page.waitForTimeout(600);

/** 标签胶囊中心 ↔ 最近节点盒的最近对（屏幕坐标） */
const nearestPair = () =>
  page.evaluate(() => {
    const svg = document.querySelector('svg');
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    const toScreen = (x, y) => ({ sx: x * ctm.a + y * ctm.c + ctm.e, sy: x * ctm.b + y * ctm.d + ctm.f });
    const labelRects = [];
    for (const el of document.querySelectorAll('[data-edge-label]')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) labelRects.push({ cx: r.left + r.width / 2, cy: r.top + r.height / 2 });
    }
    const nodeRects = [];
    for (const el of document.querySelectorAll('[data-node-id]')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) nodeRects.push({ l: r.left, t: r.top, r: r.right, b: r.bottom });
    }
    let best = null;
    for (const L of labelRects) {
      for (const N of nodeRects) {
        const dx = Math.max(N.l - L.cx, 0, L.cx - N.r);
        const dy = Math.max(N.t - L.cy, 0, L.cy - N.b);
        const d = Math.hypot(dx, dy);
        if (!best || d < best.d) best = { d, sx: L.cx, sy: L.cy };
      }
    }
    return best;
  });

const pair0 = await nearestPair();
if (!pair0) throw new Error('无法定位标签/节点对');
console.log(`标签↔节点最近距离：${pair0.d.toFixed(1)}px（屏幕 ${pair0.sx.toFixed(1)}, ${pair0.sy.toFixed(1)}）`);

// 放大 4x（滚轮锚点=指针）→ 让胶囊与节点边界的层叠关系清晰可辨
await page.mouse.move(pair0.sx, pair0.sy);
for (let i = 0; i < 4; i++) {
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(80);
}
await page.waitForTimeout(500);
const pair = (await nearestPair()) ?? pair0;

const full = `verify-shots/r5-labels-${MODE}-full.png`;
const zoom = `verify-shots/r5-labels-${MODE}-zoom.png`;
await page.screenshot({ path: full });
const clip = {
  x: Math.min(Math.max(0, pair.sx - 170), 1280 - 340),
  y: Math.min(Math.max(0, pair.sy - 120), 800 - 240),
  width: 340,
  height: 240,
};
await page.screenshot({ path: zoom, clip });

const labelCount = await page.evaluate(() => document.querySelectorAll('[data-edge-label]').length);
console.log(`✔ 截图完成（${MODE}）；页面上 EdgeLabel 共 ${labelCount} 个`);
console.log(`截图：${full} / ${zoom}`);

await browser.close();
