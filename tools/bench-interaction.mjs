/**
 * 交互性能基线（批次 B · B-P0）
 * ══════════════════════════════════════════════════════════════════════
 * 跑法：node tools/bench-interaction.mjs [baseUrl]   （默认 http://localhost:5174，需先起 dev server）
 *
 * 场景：清 localStorage → 默认 demo 文档（打开即有大图不可达 → 按计划在 demo 上测机制指标）。
 *
 * 度量（全部在页面内计数，零采样开销）：
 *   ① nodeMutations —— 落在节点 `g[data-node-id]`（自身或内部）的 DOM 变更次数。
 *      **机制指标**：pan 是否重建节点 DOM。P2 验收 = 保持 0。
 *   ② nodeMountChurn —— 裁剪引起的**整节点挂载/卸载**数量。**预期行为**（节点真离开视口），
 *      memo 不应消除它；单独观测，防 P1 索引接入后裁剪口径漂移。
 *   ③ frameGapMsP50/P95 —— pan 窗口内 rAF 间隔。
 *   ④ 平移生效证据：投影 g 的 transform 前后值 + 可见节点数前后值。
 *
 * 2026-09-12 口径修正（P0 实测）：pan 的 DOM 变更只有两类——
 *   (a) 节点 g 内部重挂 → ①（当前实现下实测恒为 0：React 结构复用已避免）
 *   (b) 裁剪整节点挂/卸 → ②（target 是容器 g、removed 是节点 g 本身）
 * 故「pan 重建」在 DOM 层面不可复现，P2 的判别性机制指标另由 jsdom 的**节点组件渲染次数**承担。
 *
 * 记账方式与 tools/verify-delete-subring.mjs 同构（playwright-core 绝对路径 + addInitScript）。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:5174';
const STEPS = 20;
const STEP_DX = 18;
const STEP_DY = -6;
/**
 * 起点自动选择：扫描网格，取「topmost 元素是 svg（不落在 chrome 面板上）
 * 且距所有节点盒 ≥ SAFE_PAD」的点 —— 落在节点上会变节点拖拽、落在面板上不会平移。
 * （节点 g 可能设了 pointer-events 屏蔽，DOM 命中测不出节点位置，必须按几何矩形判。）
 */
const SAFE_PAD = 28;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

await page.addInitScript(() => {
  try {
    localStorage.clear(); // 无「最近文档」→ 直接进画布（跳过启动页，确定性）
  } catch {
    /* ignore */
  }
  const w = window;
  w.__bench = {
    nodeMutations: 0,
    nodeMountChurn: 0,
    childListTotal: 0,
    attributesTotal: 0,
    frames: [],
    t0: 0,
    t1: 0,
  };

  /** 自身即节点 g（SVG 下用 tagName + 属性判，不依赖 matches 选择器） */
  const isNodeG = (el) =>
    !!(el && el.nodeType === 1 && el.tagName === 'g' && el.hasAttribute('data-node-id'));
  /** 严格位于某个节点 g 内部（不含自身） */
  const insideNodeG = (el) => {
    for (let p = el ? el.parentElement : null; p; p = p.parentElement) {
      if (isNodeG(p)) return true;
    }
    return false;
  };
  /** 增删节点中节点 g 的数量（容器被整体挂/卸时按子树逐个计数） */
  const countNodeGs = (list) => {
    let n = 0;
    for (const el of list) {
      if (!el || el.nodeType !== 1) continue;
      if (isNodeG(el)) n += 1;
      else if (typeof el.querySelectorAll === 'function') n += el.querySelectorAll('g[data-node-id]').length;
    }
    return n;
  };

  const install = () => {
    if (!document.body) {
      requestAnimationFrame(install);
      return;
    }
    const obs = new MutationObserver((records) => {
      const b = w.__bench;
      for (const rec of records) {
        const atNode = isNodeG(rec.target) || insideNodeG(rec.target);
        if (rec.type === 'childList') {
          b.childListTotal++;
          b.nodeMountChurn += countNodeGs(rec.addedNodes) + countNodeGs(rec.removedNodes);
          if (atNode) b.nodeMutations++;
        } else if (rec.type === 'attributes') {
          b.attributesTotal++;
          if (atNode) b.nodeMutations++;
        }
      }
    });
    obs.observe(document.body, { subtree: true, childList: true, attributes: true });
  };
  install();

  const tick = (t) => {
    w.__bench.frames.push(t);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('g[data-node-id]', { timeout: 20000 });
await page.waitForTimeout(1500); // 首帧稳定 + 自动布局/入场动画收敛

const snapshot = () =>
  page.evaluate(() => {
    const proj = document.querySelector('svg > g');
    return {
      nodes: document.querySelectorAll('g[data-node-id]').length,
      transform: proj ? proj.getAttribute('transform') : null,
    };
  });

const before = await snapshot();

// 起点：网格扫描（优先左下区域，远离居中排布的节点）
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
  const order = [];
  for (let y = 760; y >= 80; y -= 60) for (let x = 60; x <= 1220; x += 60) order.push({ x, y });
  for (const p of order) {
    if (!topmostIsSvg(p.x, p.y)) continue;
    if (inAny(p.x, p.y)) continue;
    return p;
  }
  return null;
}, SAFE_PAD);
if (!start) throw new Error('找不到可用的空白平移起点（网格扫描失败）');

await page.mouse.move(start.x, start.y);
await page.waitForTimeout(150);
// 清零点：起点移动与稳定期都不计入
await page.evaluate(() => {
  const b = window.__bench;
  b.nodeMutations = 0;
  b.nodeMountChurn = 0;
  b.childListTotal = 0;
  b.attributesTotal = 0;
  b.frames.length = 0;
  b.t0 = performance.now();
});

await page.mouse.down();
for (let i = 1; i <= STEPS; i++) {
  await page.mouse.move(start.x + i * STEP_DX, start.y + i * STEP_DY, { steps: 1 });
  await page.waitForTimeout(16);
}
await page.mouse.up();
await page.evaluate(() => {
  window.__bench.t1 = performance.now();
});

const after = await snapshot();
const measured = await page.evaluate(() => {
  const b = window.__bench;
  const f = b.frames.filter((t) => t >= b.t0 && t <= b.t1);
  const gaps = [];
  for (let i = 1; i < f.length; i++) gaps.push(Math.round(f[i] - f[i - 1]));
  gaps.sort((a, b2) => a - b2);
  const q = (p) => (gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))] : null);
  return {
    nodeMutations: b.nodeMutations,
    nodeMountChurn: b.nodeMountChurn,
    childListTotal: b.childListTotal,
    attributesTotal: b.attributesTotal,
    frameSamples: f.length,
    frameGapMsP50: q(0.5),
    frameGapMsP95: q(0.95),
    panWindowMs: Math.round(b.t1 - b.t0),
  };
});

const out = {
  base: BASE,
  nodesBefore: before.nodes,
  nodesAfter: after.nodes,
  panApplied: before.transform !== after.transform,
  transformBefore: before.transform,
  transformAfter: after.transform,
  steps: STEPS,
  start,
  ...measured,
};
console.log('交互基线 =>', JSON.stringify(out));
await page.screenshot({ path: 'verify-shots/bench-interaction.png' });
await browser.close();
