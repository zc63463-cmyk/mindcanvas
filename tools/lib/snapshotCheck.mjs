/**
 * 快照新鲜度守卫（真浏览器 verify 脚本共用）
 * ══════════════════════════════════════════════════════════════════════
 * **为什么需要**：2026-09-13 编辑流批次收口后，用户在自己跑的静态快照（:5175）上复测，
 * 结论是「没解决」——实际那份 `apps/canvas/dist` 构建于修复提交**前 3 小时**，修复根本没
 * 进入他测的产物。一轮往返因此白费。
 * 本守卫把「快照是否过期」从「靠人记得」变成「脚本一眼可见」，三查：
 *   ① 产物存在，且新于 HEAD 提交时间（提交了但忘了 build）
 *   ② 产物新于 src 下最新源码（改了源码但忘了 build）
 *   ③ 页面**实际加载**的 bundle == 产物 index.html 引用的 bundle（浏览器缓存了旧 JS）
 * 过期 → 醒目告警并 `exit(1)`（除非 `--allow-stale` 或环境变量 `ALLOW_STALE=1`）。
 *
 * 用法（在 verify 脚本里）：
 * ```js
 * import { assertLoadedBundle, checkSnapshotFresh } from './lib/snapshotCheck.mjs';
 * checkSnapshotFresh();                       // 启动浏览器之前
 * await page.goto(...);                       // ...
 * await assertLoadedBundle(page);              // 首屏加载后
 * ```
 */
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** tools/lib/ → 仓库根；`decodeURIComponent` 负责解掉 `.pathname` 的 `%20` 等编码 */
const ROOT = decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(
  /^\/([A-Za-z]:)/,
  '$1',
);
const DIST_INDEX = join(ROOT, 'apps/canvas/dist/index.html');
/** 参与「产物是否落后于源码」判定的源码根（editor 侧改了都要重建产物） */
const SRC_ROOTS = [
  join(ROOT, 'apps/canvas/src'),
  join(ROOT, 'packages/react/src'),
  join(ROOT, 'packages/kernel/src'),
];

const allowStale = () =>
  process.argv.includes('--allow-stale') || process.env.ALLOW_STALE === '1';

/** 本地时段（sv-SE 给的是 ISO 形状：2026-09-13 17:29:29） */
const stamp = (ms) => new Date(ms).toLocaleString('sv-SE');
const fail = (msg) => {
  console.error(`\n⛔ ${msg}\n`);
  process.exit(1);
};

/** src 树里最新一次 .ts/.tsx 修改时间（跳过 dist/测试外的噪声目录） */
function newestSrcMtime(dir, best = 0) {
  let out = best;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out = newestSrcMtime(p, out);
    else if (/\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) out = Math.max(out, st.mtimeMs);
  }
  return out;
}

/** 产物 index.html 引用的入口 bundle 文件名（形如 main-XXXXXXXX.js） */
export function expectedBundleName() {
  const html = readFileSync(DIST_INDEX, 'utf8');
  const m = /\/assets\/(main-[A-Za-z0-9_-]+\.js)/.exec(html);
  return m?.[1] ?? null;
}

/**
 * 启动前调用：产物存在性 / 新鲜度三查中的 ①②，并打印实际引用入口。
 * @returns {{ distMs: number, srcMs: number, headMs: number|null, bundle: string|null }}
 */
export function checkSnapshotFresh() {
  let distMs;
  try {
    distMs = statSync(DIST_INDEX).mtimeMs;
  } catch {
    fail(`找不到产物 ${DIST_INDEX} —— 先构建：\n   cd apps/canvas && node ../../node_modules/.pnpm/vite@8.2.2/node_modules/vite/bin/vite.js build`);
  }
  const srcMs = Math.max(...SRC_ROOTS.map((d) => newestSrcMtime(d)));
  let headMs = null;
  try {
    headMs = Number(execSync('git log -1 --format=%ct', { cwd: ROOT, encoding: 'utf8' })) * 1000;
  } catch {
    /* 无 git / 无提交 → 跳过该项 */
  }
  const bundle = expectedBundleName();

  console.log('[snapshot] 产物构建于', stamp(distMs), '· 引用的入口 =', bundle ?? '(未识别)');
  console.log('[snapshot] 最新源码', stamp(srcMs), headMs === null ? '· HEAD 时间未知' : `· HEAD 提交 ${stamp(headMs)}`);

  const stale = [];
  if (headMs !== null && distMs < headMs) stale.push(`产物比 HEAD 提交旧 ${Math.round((headMs - distMs) / 1000)}s`);
  if (distMs < srcMs) stale.push(`产物比最新源码旧 ${Math.round((srcMs - distMs) / 1000)}s`);

  if (stale.length > 0) {
    const msg = [
      '快照已过期（你测的产物不含最新改动）：',
      ...stale.map((s) => `   · ${s}`),
      '   重建：cd apps/canvas && node ../../node_modules/.pnpm/vite@8.2.2/node_modules/vite/bin/vite.js build',
      '   然后浏览器里 Ctrl+Shift+R 硬刷新（新 index.html 会引用新 hash 的 JS）。',
      '   （确实要测旧产物：加 --allow-stale）',
    ].join('\n');
    if (allowStale()) console.warn(`\n⚠️ ${msg}\n（--allow-stale：继续）`);
    else fail(msg);
  }
  return { distMs, srcMs, headMs, bundle };
}

/**
 * 首屏加载后调用：③ 页面实际加载的入口 bundle 是否就是产物引用的那个
 * （浏览器缓存旧 index.html + 旧 JS 时，这里会不一致 —— 用户会以为自己测的是新版本）。
 */
export async function assertLoadedBundle(page) {
  const expected = expectedBundleName();
  const loaded = await page.evaluate(() => {
    const s = document.querySelector('script[type="module"][src]');
    return s?.getAttribute('src') ?? null;
  });
  const loadedName = loaded === null ? null : loaded.split('/').pop();
  console.log('[snapshot] 页面实际加载 =', loadedName ?? '(未识别)');
  if (expected !== null && loadedName !== null && expected !== loadedName) {
    const msg = `页面加载的是旧 bundle（浏览器缓存）：期望 ${expected}，实际 ${loadedName}\n   在页面上按 Ctrl+Shift+R 硬刷新后重试（或 --allow-stale 忽略）`;
    if (allowStale()) console.warn(`\n⚠️ ${msg}\n`);
    else fail(msg);
  }
  return loadedName;
}
