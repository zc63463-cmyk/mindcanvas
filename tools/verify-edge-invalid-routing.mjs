/**
 * R4-3② 真浏览器视觉验证（失效边退出路由协调）
 * ══════════════════════════════════════════════════════════════════════
 * 跑法：node tools/verify-edge-invalid-routing.mjs [baseUrl]（默认 http://localhost:5174，需先起 dev server）
 *
 * 场景：清 localStorage → 内置示例 gateway.mm.md（自带 root.note.edges 自由边）
 *   → 进关系模式 → 记录全部边 path d → 选中最后一条边 → 点「失效（可恢复）」
 *   → 再记录全部边 d。
 * 硬断言：
 *   ① 除被失效边外，其余边 path d **逐字节相同**（失效边退出路由协调——不塑形别人）；
 *   ② 被失效边仍渲染（灰虚线：stroke-dasharray 存在）。
 * 报告：失效前 / 失效后 两张截图 → verify-shots/edge-invalid-{before,after}.png。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:5174';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

await page.addInitScript(() => {
  try {
    localStorage.clear(); // 无「最近文档」→ 直接进内置示例（确定性）
  } catch {
    /* ignore */
  }
});

await page.goto(BASE, { waitUntil: 'networkidle' });

// 进关系模式（边命中区挂载）
await page.click('[data-relation-mode]');
await page.waitForSelector('[data-free-edge]', { timeout: 10000 });

/** 读全部边可见 path 的 d（排除命中区透明描边） */
async function readEdgePaths() {
  return page.evaluate(() => {
    const out = new Map();
    for (const g of document.querySelectorAll('[data-free-edge]')) {
      const key = g.getAttribute('data-free-edge') ?? '';
      const paths = [...g.querySelectorAll('path')];
      const visible = paths.find((p) => p.getAttribute('stroke') !== 'transparent');
      out.set(key, {
        d: visible?.getAttribute('d') ?? '',
        dashed: paths.some((p) => (p.getAttribute('stroke-dasharray') ?? '') !== ''),
      });
    }
    return [...out.entries()].map(([k, v]) => ({ key: k, ...v }));
  });
}

const before = await readEdgePaths();
const beforeMap = new Map(before.map((e) => [e.key, e]));
if (before.length < 2) throw new Error(`场景要求 ≥2 条自由边，实测 ${before.length}`);
console.log(`失效前：${before.length} 条边`);

await page.screenshot({ path: 'verify-shots/edge-invalid-before.png' });

// 选中最后一条边（保证仍有其它正常边可对照）→ 失效。
// 命中区是透明宽描边——playwright 的元素中心点击可能落不到线上，
// 故取路径中点的真实屏幕坐标（getPointAtLength + getScreenCTM）后用鼠标点。
const targetKey = before[before.length - 1].key;
const midPoint = await page.evaluate((key) => {
  const g = document.querySelector(`[data-free-edge="${key}"]`);
  const hit = g?.querySelector('path[stroke="transparent"]');
  if (!g || !hit) return null;
  const len = hit.getTotalLength();
  const pt = hit.getPointAtLength(len / 2);
  const ctm = hit.getScreenCTM();
  if (!ctm) return null;
  return {
    sx: pt.x * ctm.a + pt.y * ctm.c + ctm.e,
    sy: pt.x * ctm.b + pt.y * ctm.d + ctm.f,
  };
}, targetKey);
if (!midPoint) throw new Error('cannot resolve edge midpoint screen coords');
await page.mouse.click(midPoint.sx, midPoint.sy);
await page.waitForSelector('[data-edge-editor]', { timeout: 5000 });
await page.click('[data-edge-invalidate]');

// 等待重渲完成：失效边出现灰虚线
await page.waitForFunction(
  (key) => {
    const g = document.querySelector(`[data-free-edge="${key}"]`);
    if (!g) return false;
    return [...g.querySelectorAll('path')].some(
      (p) => (p.getAttribute('stroke-dasharray') ?? '') !== '',
    );
  },
  targetKey,
  { timeout: 5000 },
);

const after = await readEdgePaths();
const afterMap = new Map(after.map((e) => [e.key, e]));

await page.screenshot({ path: 'verify-shots/edge-invalid-after.png' });

// 硬断言 ①：其余边 d 逐字节相同
let checked = 0;
for (const [key, entry] of beforeMap) {
  if (key === targetKey) continue;
  const afterEntry = afterMap.get(key);
  if (!afterEntry) throw new Error(`边 ${key} 失效后消失`);
  if (entry.d !== afterEntry.d) {
    throw new Error(`正常边 ${key} 的 d 被失效边牵动：\nbefore=${entry.d}\nafter =${afterEntry.d}`);
  }
  checked += 1;
}
// 硬断言 ②：被失效边仍渲染且呈虚线
const target = afterMap.get(targetKey);
if (!target || target.d === '') throw new Error('失效边不再渲染');
if (!target.dashed) throw new Error('失效边未呈虚线');

console.log(`✔ ${checked} 条正常边 d 逐字节相同；失效边 ${targetKey} 仍渲染（虚线）`);
console.log('截图：verify-shots/edge-invalid-before.png / edge-invalid-after.png');

await browser.close();
