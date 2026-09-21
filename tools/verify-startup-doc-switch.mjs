/**
 * S2F 真浏览器验证：启动页三出口 → 画布树同步（构建产物复现/回归）
 * ══════════════════════════════════════════════════════════════════
 * 跑法（**必须构建产物**——dev server 因 StrictMode 双调用 effect 会掩盖本 bug，见派遣计划 §1.6）：
 *   cd apps/canvas && node ../../node_modules/.pnpm/vite@8.2.2/node_modules/vite/bin/vite.js build
 *   cd apps/canvas && node ../../node_modules/.pnpm/vite@8.2.2/node_modules/vite/bin/vite.js preview --port 5178 --strictPort
 *   node tools/verify-startup-doc-switch.mjs http://localhost:5178
 *
 * 场景（每场景重新 goto；initScript 重新种 library）：
 *   ① 继续上次 → 画布含「S2F-A子」、不含 gateway 节点；
 *   ② 最近列表（s2f-b.mm.md）→ 画布含「S2F-B子」、不含 gateway 节点；
 *   ③ 新建 → 画布含「未命名」、不含 gateway 节点。
 * 断言口径（D5·双边）：目标独有节点存在 且 gateway 独有节点不存在。
 * 截图：verify-shots/s2f-{resume,recent,new}.png。
 */
import { chromium } from 'playwright';
import { assertLoadedBundle, checkSnapshotFresh } from './lib/snapshotCheck.mjs';

/** 非 `--` 开头的首个参数 = baseUrl（`--allow-stale` 等 flag 不进 base） */
const BASE = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:5178';

const DOC_A = ['# S2F-A根', '', '## S2F-A子', ''].join('\n');
const DOC_B = ['# S2F-B根', '', '## S2F-B子', ''].join('\n');
/** gateway 示例树独有节点（双边断言的反侧） */
const GATEWAY_NODE = 'Agent Gateway';

console.log('[verify] baseUrl =', BASE);
checkSnapshotFresh();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });

await page.addInitScript((seed) => {
  try {
    localStorage.clear();
    localStorage.setItem(
      'mindcanvas.library.v1',
      JSON.stringify([
        { id: 's2f-a', name: 's2f-a.mm.md', source: seed.a, ts: Date.now(), tags: [] },
        { id: 's2f-b', name: 's2f-b.mm.md', source: seed.b, ts: Date.now() - 100000, tags: [] },
      ]),
    );
  } catch {
    /* ignore */
  }
}, { a: DOC_A, b: DOC_B });

let pass = true;
const check = (name, ok, detail) => {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) pass = false;
};

const nodeTexts = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('g[data-node-id]')].map((g) => (g.textContent ?? '').trim()),
  );

/** 等目标节点出现（超时不为抛——双边断言统一记账）；返回节点文本现场 */
async function waitTarget(target, timeout = 8000) {
  await page
    .waitForFunction(
      (t) =>
        [...document.querySelectorAll('g[data-node-id]')].some((g) =>
          (g.textContent ?? '').includes(t),
        ),
      target,
      { timeout },
    )
    .catch(() => undefined);
  return nodeTexts();
}

/** 单场景：加载 → 启动页 → 出口点击 → 双边断言 → 截图 */
async function runScenario({ name, button, target, shot }) {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await assertLoadedBundle(page);
  await page.waitForSelector('button', { timeout: 15000 });
  await page.locator('button', { hasText: button }).click();
  await page.waitForSelector('g[data-node-id]', { timeout: 15000 });
  await waitTarget(target);
  // 文档切换伴随 M5-T2 过渡：被删（gateway）节点在 ghosts 层淡出（动画期间仍带 data-node-id）。
  // 等 ghost 组清空（动画结束即整组移除；上限 2.5s）再断言 —— 双边只针对稳态画布。
  await page
    .waitForFunction(() => document.querySelectorAll('[data-ghost-group]').length === 0, undefined, {
      timeout: 2500,
    })
    .catch(() => undefined);
  const texts = await nodeTexts();
  const ghostLeft = await page.evaluate(
    () => document.querySelectorAll('[data-ghost-group]').length,
  );
  console.log(`[${name}] 过渡 ghost 组残留 = ${ghostLeft}`);
  check(`[${name}] 画布含目标节点「${target}」`, texts.some((t) => t.includes(target)), texts);
  check(
    `[${name}] 画布不含 gateway 节点「${GATEWAY_NODE}」`,
    !texts.some((t) => t.includes(GATEWAY_NODE)),
    texts,
  );
  await page.screenshot({ path: `verify-shots/s2f-${shot}.png` });
}

await runScenario({ name: '继续上次', button: '继续上次', target: 'S2F-A子', shot: 'resume' });
await runScenario({ name: '最近列表', button: 's2f-b.mm.md', target: 'S2F-B子', shot: 'recent' });
await runScenario({ name: '新建', button: '新建', target: '未命名', shot: 'new' });

console.log(pass ? '\n✅ S2F 启动页文档切换同步验证全部通过' : '\n❌ 存在失败项（复现/回归未过）');
await Promise.race([browser.close().catch(() => undefined), new Promise((r) => setTimeout(r, 5000))]);
process.exit(pass ? 0 : 1);
