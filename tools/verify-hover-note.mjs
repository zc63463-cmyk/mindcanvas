/**
 * 实测验证：hover note 浮窗宽度是否对齐节点、字号是否不大于节点字号。
 * 迁移自 playwright-cli 会话（其 CLI 会话在 Windows 下不稳定），直接驱动 playwright-core。
 */
import { chromium } from 'playwright';

const URL = process.env.MC_URL ?? 'http://localhost:5173';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-note-badge]', { timeout: 15000 });
await page.waitForTimeout(500);

const badgeCount = await page.evaluate(() => document.querySelectorAll('[data-note-badge]').length);
console.log('badge count =', badgeCount);

// 悬停第一个带 note 角标的节点（角标本身就在节点盒内）
const badge = page.locator('[data-note-badge]').first();
const bb = await badge.boundingBox();
await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
await page.waitForTimeout(400);

const data = await page.evaluate(() => {
  const pop = document.querySelector('[data-note-popover]');
  if (!pop) return { popover: null };
  const pr = pop.getBoundingClientRect();
  // 节点盒：badge 的 data-note-badge 存的就是节点 id，用它精确量节点卡
  const badge = document.querySelector('[data-note-badge]');
  const nodeId = badge?.getAttribute('data-note-badge');
  const node = nodeId ? document.querySelector(`[data-node-id="${nodeId}"]`) : null;
  const nr = node?.getBoundingClientRect();
  const body = pop.querySelector('[data-note-textarea] div:last-child');
  const nodeFont = node ? getComputedStyle(node.querySelector('text') ?? node).fontSize : null;
  return {
    mode: pop.getAttribute('data-note-mode'),
    popW: Math.round(pr.width),
    popX: Math.round(pr.x),
    nodeW: nr ? Math.round(nr.width) : null,
    nodeFont,
    bodyFont: body ? getComputedStyle(body).fontSize : null,
  };
});
console.log(JSON.stringify(data, null, 2));

await page.screenshot({ path: 'verify-shots/hover-note-verify.png' });
console.log('screenshot saved');
await browser.close();
