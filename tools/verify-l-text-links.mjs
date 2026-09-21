/**
 * L 批真浏览器验证：文本区域链接 Phase 1（只读渲染 / 幽灵态 / 点击跳转 / 插入入口）
 * ══════════════════════════════════════════════════════════════════
 * 跑法：node tools/verify-l-text-links.mjs [baseUrl]（默认 http://localhost:5177）
 *   （需先构建快照 + 起静态服务：cd apps/canvas && vite preview --port 5177）
 *
 * 夹具：「任务」节点 note_text =「[A](node:根/任务/A) 与 [丢](node:根/不存在)」
 *   —— 两条链接：well-formed（命中 根/任务/A）+ dangling（路径不存在）。
 *
 * 场景：
 *   ① 悬停「任务」→ 预览浮窗：链接渲染为 label（[A]/[丢]），三态标记正确
 *      （well-formed cursor=pointer；dangling 虚线 + title + cursor=default）
 *      → l-links-preview.png（全页）+ l-links-preview-zoom.png（浮窗特写）
 *   ② 点击 well-formed → 跳转：A 的**屏幕**位置变化且落在视口中心（focusNode）
 *      —— 指标用 getBoundingClientRect（g.transform 是世界坐标，viewport 平移不改它）
 *      → l-links-jump.png
 *   ③ 幽灵不可跳：点击 dangling → A 屏幕位置不再变化（视图不动）
 *   ④ 插入入口（L3）：空白清理 → 点选「任务」→ Alt 长按出环 → 悬停「更多」下钻
 *      → 二级环轮转到「编辑笔记」→ 松 Alt 进编辑态 → 点「插入链接」→ 选「任务 / A」
 *      → textarea 出现第二条 [A](node:根/任务/A)（光标处插入）
 *      → l-links-insert-picker.png + l-links-insert-done.png
 */
import { chromium } from 'playwright';
import { assertLoadedBundle, checkSnapshotFresh } from './lib/snapshotCheck.mjs';

/** 非 `--` 开头的首个参数 = baseUrl（`--allow-stale` 等 flag 不进 base） */
const BASE = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:5177';

const DOC = [
  '# 根',
  '',
  '<!--',
  'note_text: "[A](node:根/任务/A) 与 [丢](node:根/不存在)"',
  '-->',
  '## 任务',
  '',
  '### A',
  '',
  '### B',
  '',
].join('\n');

checkSnapshotFresh();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });

await page.addInitScript((src) => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  window.showOpenFilePicker = async () => [
    {
      name: 'l-links.mm.md',
      getFile: async () => new File([src], 'l-links.mm.md', { type: 'text/markdown' }),
      createWritable: async () => ({ write: async () => undefined, close: async () => undefined }),
    },
  ];
}, DOC);

let pass = true;
const check = (name, ok, detail) => {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) pass = false;
};

/** A 的屏幕中心（focusNode 平移 viewport 改变的是屏幕映射；g.transform 是世界坐标不动） */
const aCenter = () =>
  page.evaluate(() => {
    const gs = [...document.querySelectorAll('g[data-node-id]')];
    const g = gs.find((el) => (el.textContent ?? '').trim() === 'A');
    if (!g) return null;
    const r = g.getBoundingClientRect();
    return { cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2) };
  });

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await assertLoadedBundle(page);
await page.waitForSelector('[data-node-id]', { timeout: 20000 });
await page.keyboard.press('Control+o'); // mock 句柄 → 夹具文档
await page.waitForSelector('[data-note-badge]', { timeout: 20000 });
await page.waitForTimeout(700); // fit 动画 + 字体落定

// ① 悬停带 note 的节点（任务）→ 预览浮窗
const badge = page.locator('[data-note-badge]').first();
const taskId = await badge.getAttribute('data-note-badge');
if (taskId === null) throw new Error('badge 无 data-note-badge');
const taskNode = page.locator(`g[data-node-id="${taskId}"]`).first();
const tb = await taskNode.boundingBox();
if (tb === null) throw new Error('任务节点无 boundingBox');
await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
await page.waitForSelector('[data-note-popover]', { timeout: 8000 });
await page.waitForTimeout(300);

const links = await page.evaluate(() => {
  const pop = document.querySelector('[data-note-popover]');
  if (pop === null) return null;
  return [...pop.querySelectorAll('[data-text-link]')].map((el) => {
    const cs = getComputedStyle(el);
    return {
      anchor: el.getAttribute('data-text-link'),
      state: el.getAttribute('data-link-state'),
      title: el.getAttribute('title'),
      text: el.textContent,
      decoStyle: cs.textDecorationStyle,
      cursor: cs.cursor,
    };
  });
});
console.log('[preview] links =', JSON.stringify(links));
const well = links?.find((l) => l.anchor === 'node:根/任务/A');
const ghost = links?.find((l) => l.anchor === 'node:根/不存在');
check('预览浮窗渲染 2 条链接', links !== null && links.length === 2, links);
check('well-formed：显示 label「A」+ cursor=pointer', well?.text === 'A' && well?.cursor === 'pointer', well);
check(
  'dangling 幽灵态：虚线 + title 含「失效」+ cursor=default',
  ghost?.state === 'dangling' &&
    ghost?.decoStyle === 'dashed' &&
    (ghost?.title ?? '').includes('失效') &&
    ghost?.cursor === 'default',
  ghost,
);
await page.screenshot({ path: 'verify-shots/l-links-preview.png' });
const popBox = await page.locator('[data-note-popover]').boundingBox();
if (popBox !== null) {
  await page.screenshot({
    path: 'verify-shots/l-links-preview-zoom.png',
    clip: {
      x: Math.max(0, popBox.x - 12),
      y: Math.max(0, popBox.y - 12),
      width: Math.min(1280, popBox.width + 24),
      height: Math.min(800, popBox.height + 24),
    },
  });
}

// ② 点击 well-formed 链接 → 跳转（A 屏幕位置 → 视口中心）
const before = await aCenter();
await page.locator('[data-text-link="node:根/任务/A"]').click({ timeout: 4000 });
await page.waitForTimeout(1200); // focusNode 平滑动画
const after = await aCenter();
console.log('[jump] A 屏幕 =', JSON.stringify({ before, after }));
check(
  '点击 well-formed → A 屏幕位置变化（focusNode 平移）',
  before !== null && after !== null && (before.cx !== after.cx || before.cy !== after.cy),
  { before, after },
);
check(
  '跳转后 A 落在视口中心附近（±80px）',
  after !== null && Math.abs(after.cx - 640) < 80 && Math.abs(after.cy - 400) < 80,
  after,
);
await page.screenshot({ path: 'verify-shots/l-links-jump.png' });

// ③ 幽灵不可跳：点 dangling → A 屏幕位置不变
const beforeGhost = await aCenter();
await page.locator('[data-link-state="dangling"]').click({ timeout: 4000 });
await page.waitForTimeout(700);
const afterGhost = await aCenter();
console.log('[ghost-click] A 屏幕 =', JSON.stringify({ beforeGhost, afterGhost }));
check(
  '点击 dangling 幽灵链接 → 视图不动（A 屏幕位置不变）',
  beforeGhost !== null && afterGhost !== null && beforeGhost.cx === afterGhost.cx && beforeGhost.cy === afterGhost.cy,
  { beforeGhost, afterGhost },
);

// ④ 插入入口（L3）：空白清理（清 hover 浮窗、保选中）→ 重新点选「任务」→ Alt 出环 →
//    悬停「更多」下钻 → 二级环轮转到「编辑笔记」→ 松 Alt → 编辑态
await page.mouse.move(100, 700); // 指针移开（清 hover 预览；不点击）
await page.waitForTimeout(300);
const tb2 = await taskNode.boundingBox();
if (tb2 === null) throw new Error('任务节点无 boundingBox（第二轮）');
await page.mouse.click(tb2.x + tb2.width / 2, tb2.y + tb2.height / 2);
await page.waitForTimeout(350);
const ax = Math.round(tb2.x + tb2.width); // 环心 = 节点盒右上角（与 nodeCorner 同源）
const ay = Math.round(tb2.y);
await page.keyboard.down('Alt');
await page.waitForTimeout(500); // 越过 250ms 蓄力
const ringOpen = (await page.locator('.ring').count()) > 0;
check('Alt 长按 → 一级环出现', ringOpen, { ringOpen });
// 键盘高亮「更多」（left=ArrowLeft）→ dwell 450ms 自动下钻（与指针悬停同一 dwell 通道）
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(800);
const subRingOpen = (await page.locator('.sub-ring').count()) > 0;
check('高亮「更多」停顿 → 二级环展开', subRingOpen, { subRingOpen, ax, ay });
let seatLabel = null;
for (let i = 0; i < 8; i++) {
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(160);
  seatLabel = await page.textContent('.float-label').catch(() => null);
  if ((seatLabel ?? '').includes('编辑笔记')) break;
}
console.log('[ring] seat =', JSON.stringify(seatLabel));
check('二级环轮转到「编辑笔记」席', (seatLabel ?? '').includes('编辑笔记'), { seatLabel });
await page.keyboard.up('Alt'); // 提交 → 进编辑态
await page.waitForTimeout(600);

const insertBtn = page.locator('[data-insert-link]');
check('编辑态出现「插入链接」按钮', (await insertBtn.count()) === 1, { count: await insertBtn.count() });
const beforeValue = await page.evaluate(
  () => document.querySelector('[data-note-popover] textarea')?.value ?? null,
);
await insertBtn.click();
await page.waitForSelector('[data-edge-anchor-panel]', { timeout: 5000 });
await page.waitForTimeout(200);
await page.screenshot({ path: 'verify-shots/l-links-insert-picker.png' });

const option = page.locator('[data-edge-anchor-option="node:根/任务/A"]');
check('候选选择器含「任务 / A」候选', (await option.count()) === 1, { count: await option.count() });
await option.click();
await page.waitForTimeout(300);
const afterValue = await page.evaluate(
  () => document.querySelector('[data-note-popover] textarea')?.value ?? null,
);
const countHit = (s) => (s ?? '').split('[A](node:根/任务/A)').length - 1;
console.log('[insert] value before/after =', JSON.stringify({ beforeValue, afterValue }));
check(
  '选中候选 → textarea 插入 [A](node:根/任务/A)（光标处，出现第二条）',
  countHit(beforeValue) === 1 && countHit(afterValue) === 2,
  { beforeHits: countHit(beforeValue), afterHits: countHit(afterValue) },
);
const popBox2 = await page.locator('[data-note-popover]').boundingBox();
if (popBox2 !== null) {
  await page.screenshot({
    path: 'verify-shots/l-links-insert-done.png',
    clip: {
      x: Math.max(0, popBox2.x - 12),
      y: Math.max(0, popBox2.y - 12),
      width: Math.min(1280, popBox2.width + 24),
      height: Math.min(800, popBox2.height + 24),
    },
  });
}

console.log(pass ? '\n✅ L 批文本链接验证全部通过' : '\n❌ 存在失败项');
await Promise.race([browser.close().catch(() => undefined), new Promise((r) => setTimeout(r, 5000))]);
process.exit(pass ? 0 : 1);
