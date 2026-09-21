/** 实测：编辑 note 时浮窗放大（minHeight 360 / width ≥ 320 / textarea ≥150） */
import { chromium } from 'playwright';

const URL = process.env.MC_URL ?? 'http://localhost:5173';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-note-badge]', { timeout: 15000 });
await page.waitForTimeout(400);

// 1. 悬停带 note 的节点 → 预览浮窗
const badge = page.locator('[data-note-badge]').first();
const nodeId = await badge.getAttribute('data-note-badge');
const bb = await badge.boundingBox();
await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
await page.waitForSelector('[data-note-popover]', { timeout: 5000 });

// 2. 按下浮窗 → 固定
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(300);

// 3. 右键节点 → 上下文菜单 → 编辑 note笔记
const node = page.locator(`[data-node-id="${nodeId}"]`).first();
const nb = await node.boundingBox();
await page.mouse.click(nb.x + nb.width / 2, nb.y + nb.height / 2, { button: 'right' });
await page.waitForTimeout(400);

// 在整个文档里找「编辑 note笔记」菜单项
const editBtn = page.getByText('编辑 note笔记', { exact: false }).first();
if (await editBtn.count()) {
  await editBtn.click();
  await page.waitForTimeout(500);
} else {
  console.log('!! 未找到「编辑 note笔记」菜单项，列出当前菜单文本：');
  const texts = await page.evaluate(() =>
    [...document.querySelectorAll('button, [role="menuitem"]')]
      .map((b) => b.textContent?.trim())
      .filter((t) => t && t.length < 24),
  );
  console.log(JSON.stringify(texts));
}

const data = await page.evaluate(() => {
  const pop = document.querySelector('[data-note-popover]');
  if (!pop) return { popover: null };
  const pr = pop.getBoundingClientRect();
  const ta = pop.querySelector('textarea');
  const tar = ta?.getBoundingClientRect();
  return {
    mode: pop.getAttribute('data-note-mode'),
    popW: Math.round(pr.width),
    popH: Math.round(pr.height),
    editing: pop.querySelector('textarea') != null,
    taH: tar ? Math.round(tar.height) : null,
  };
});
console.log(JSON.stringify(data, null, 2));

await page.screenshot({ path: 'verify-shots/editing-note-verify.png' });
console.log('screenshot saved');
await browser.close();
