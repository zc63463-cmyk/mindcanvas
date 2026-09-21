/**
 * R5-1 真浏览器视觉验证：跳线折线化（梯形桥）before/after 对照。
 * ══════════════════════════════════════════════════════════════════════
 * 跑法：node tools/verify-r5-jump.mjs [baseUrl] [before|after]
 *   （默认 http://localhost:5174，需先起 dev server；mode 进文件名）
 *
 * 场景：预置 localStorage 文档库（root + A/B/C/D，两条交叉自由边 A→D、B→C）
 *   → 启动页「继续上次」→ 进画布 → 等两条自由边渲染。
 * 硬断言（按 mode）：
 *   after ：存在「M/L-only 且 L 顶点 ≥ 4」的边（折线跳形态）；
 *   before：存在「含 C 且 L 顶点 ≥ 3」的边（旧拱弧形态）。
 * 报告：边 d 原样输出 + 两张截图（整幅 / 交叉点放大裁剪）
 *   → verify-shots/r5-jump-<mode>-{full,zoom}.png
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:5174';
const MODE = process.argv[3] ?? 'after';
if (MODE !== 'before' && MODE !== 'after') throw new Error(`mode 须为 before|after，收到 ${MODE}`);

/** 演示文档：root + 4 子节点；A→D（长边）与 B→C（短边）在布局上交叉。
 *  注意 3 条边（≠ 内置示例的 2 条）：绕开「同 key 序列跨文档复用旧成员」的既有缺陷
 *  （stableByKeys 仅按 key 比较；本批范围外，见 R5-1 报告「发现」一节）。 */
const DOC = `<!--
edges:
  - from: node:根/A
    to: node:根/D
    rel: blocks
    label: 长边
  - from: node:根/B
    to: node:根/C
    rel: blocks
    label: 短边
  - from: node:根/C
    to: node:根/A
    rel: relates-to
    label: 斜向
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
        { id: 'r5-jump-demo', name: 'r5-jump.mm.md', ts: Date.now(), folder: '', tags: [], source: doc },
      ]),
    );
  } catch {
    /* ignore */
  }
}, DOC);

await page.goto(BASE, { waitUntil: 'networkidle' });

// 启动页（有最近文档）→「继续上次」
await page.click('button:has-text("继续上次")');
await page.waitForSelector('[data-free-edge]', { timeout: 10000 });
await page.waitForFunction(
  () => document.querySelectorAll('[data-free-edge]').length >= 3,
  undefined,
  { timeout: 10000 },
);
// 字体/度量落定 + 路由稳定（两帧 + 短憩，避免适配动画中途截图）
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
await page.waitForTimeout(400);

/** 读两条自由边的可见 path d */
const ds = await page.evaluate(() =>
  [...document.querySelectorAll('[data-free-edge]')].map((g) => {
    const visible = [...g.querySelectorAll('path')].find(
      (p) => p.getAttribute('stroke') !== 'transparent',
    );
    return { key: g.getAttribute('data-free-edge') ?? '', d: visible?.getAttribute('d') ?? '' };
  }),
);
console.log(`[${MODE}] 边 d 原样输出：`);
for (const e of ds) console.log(`  ${e.key}: ${e.d}`);

// 断言（按 mode 的形态判据）
const lCount = (d) => (d.match(/L /g) ?? []).length;
const hasC = (d) => /C /.test(d);
const okFold = ds.some((e) => !hasC(e.d) && lCount(e.d) >= 4);
const okArc = ds.some((e) => hasC(e.d) && lCount(e.d) >= 3);
if (MODE === 'after' && !okFold) throw new Error('未发现「M/L-only 折线跳」形态的边（L ≥ 4）');
if (MODE === 'before' && !okArc) throw new Error('未发现「C 拱弧 + 多段折线」形态的边（L ≥ 3）');

// 交叉点 ≈ 前两条 path 的最近接近点 → 屏幕坐标（放大定位用）
const crossingPoint = () =>
  page.evaluate(() => {
    const paths = [...document.querySelectorAll('[data-free-edge]')]
      .slice(0, 2)
      .map((g) => [...g.querySelectorAll('path')].find((p) => p.getAttribute('stroke') !== 'transparent'))
      .filter(Boolean);
    if (paths.length < 2) return null;
    const sample = (el) => {
      const L = el.getTotalLength();
      const n = 120;
      return Array.from({ length: n + 1 }, (_, i) => el.getPointAtLength((L * i) / n));
    };
    const a = sample(paths[0]);
    const b = sample(paths[1]);
    let best = null;
    for (const pa of a) {
      for (const pb of b) {
        const dd = Math.hypot(pa.x - pb.x, pa.y - pb.y);
        if (!best || dd < best.dd) best = { dd, x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
      }
    }
    const ctm = paths[0].getScreenCTM();
    return { sx: best.x * ctm.a + best.y * ctm.c + ctm.e, sy: best.x * ctm.b + best.y * ctm.d + ctm.f, gap: best.dd };
  });

const pt0 = await crossingPoint();
if (!pt0) throw new Error('无法定位交叉点');

// 放大 4x（滚轮锚点=指针）：让 5px 跳线在截图中清晰可辨
await page.mouse.move(pt0.sx, pt0.sy);
for (let i = 0; i < 4; i++) {
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(80);
}
await page.waitForTimeout(500); // 手势释放 + LOD 落定
const pt = (await crossingPoint()) ?? pt0;

const full = `verify-shots/r5-jump-${MODE}-full.png`;
const zoom = `verify-shots/r5-jump-${MODE}-zoom.png`;
await page.screenshot({ path: full });
const clip = {
  x: Math.min(Math.max(0, pt.sx - 160), 1280 - 320),
  y: Math.min(Math.max(0, pt.sy - 110), 800 - 220),
  width: 320,
  height: 220,
};
await page.screenshot({ path: zoom, clip });
console.log(
  `✔ 断言通过（${MODE}）；交叉点屏幕坐标 (${pt.sx.toFixed(1)}, ${pt.sy.toFixed(1)})，两线间距 ${pt.gap.toFixed(2)}px`,
);
console.log(`截图：${full} / ${zoom}`);

await browser.close();
