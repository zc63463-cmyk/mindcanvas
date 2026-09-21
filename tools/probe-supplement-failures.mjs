/**
 * S5 诊断探针（**只读，不改产品**）：定位 F5 / K3 / K5 失败的真实原因。
 * 不是为了「洗白」——结论以实际 DOM 为准，失败就报失败。
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = 'http://localhost:5211';
const SHOTS = process.env.REVIEW_SHOTS;
mkdirSync(SHOTS, { recursive: true });

const DOC_RIGHT = ['# 根', '', '## 父', '', '- A', '', '  - A子', '', '- B', '', '- C', '', '- D', ''].join('\n');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
await page.addInitScript((src) => {
  try { localStorage.clear(); } catch { /* ignore */ }
  window.showOpenFilePicker = async () => [{
    name: 'probe.mm.md',
    getFile: async () => new File([src], 'probe.mm.md', { type: 'text/markdown' }),
    createWritable: async () => ({ write: async () => undefined, close: async () => undefined }),
  }];
}, DOC_RIGHT);

const nodeIds = () => page.evaluate(() => [...document.querySelectorAll('g[data-node-id]')].map((g) => g.getAttribute('data-node-id')));
const textOf = (id) => page.evaluate((i) => (document.querySelector(`g[data-node-id="${i}"]`)?.textContent ?? '').trim(), id);
const idOfText = async (t) => { for (const id of await nodeIds()) if ((await textOf(id)) === t) return id; return null; };
const geom = (id) => page.evaluate((i) => {
  const g = document.querySelector(`g[data-node-id="${i}"]`);
  if (!g) return null;
  const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(g.getAttribute('transform') ?? '');
  const r = g.querySelector('rect');
  const svg = g.closest('svg');
  const tg = svg ? [...svg.children].find((el) => el.tagName === 'g') : null;
  const t = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\)\s*scale\(\s*(-?[\d.]+)/.exec(tg?.getAttribute('transform') ?? '');
  return m && r ? { wx: +m[1], wy: +m[2], w: +(r.getAttribute('width') ?? 0), h: +(r.getAttribute('height') ?? 0), tx: t ? +t[1] : 0, ty: t ? +t[2] : 0, k: t ? +t[3] : 1 } : null;
}, id);
const clickText = async (t) => { const id = await idOfText(t); const g = await geom(id); await page.mouse.click((g.wx + g.w / 2) * g.k + g.tx, (g.wy + g.h / 2) * g.k + g.ty); await page.waitForTimeout(200); return id; };
const rightClickText = async (t) => { const id = await idOfText(t); const g = await geom(id); await page.mouse.click((g.wx + g.w / 2) * g.k + g.tx, (g.wy + g.h / 2) * g.k + g.ty, { button: 'right' }); await page.waitForTimeout(300); };
const menuItems = () => page.evaluate(() => [...document.querySelectorAll('[data-menu-item]')].map((e) => (e.textContent ?? '').trim()));
const clickMenuItem = async (label) => {
  for (const it of await page.$$('[data-menu-item]')) {
    const t = ((await it.textContent()) ?? '').trim();
    if (t.startsWith(label)) { await it.click(); await page.waitForTimeout(350); return t; }
  }
  return null;
};
const brackets = () => page.evaluate(() => [...document.querySelectorAll('[data-summary-bracket]')].map((p) => ({ id: p.getAttribute('data-summary-bracket'), d: p.getAttribute('d'), mc: p.closest('[data-summary-id]')?.getAttribute('data-summary-member-count') })));

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-node-id]', { timeout: 20000 });
await page.keyboard.press('Control+o');
await page.waitForTimeout(900);
await page.waitForFunction(() => document.querySelectorAll('g[data-node-id]').length >= 5, undefined, { timeout: 20000 });
await page.keyboard.press('Control+0');
await page.waitForTimeout(400);

console.log('=== F5 诊断：建 A..C 摘要，再建 C..D 摘要 ===');
await rightClickText('A');
console.log('菜单项:', JSON.stringify(await menuItems()));
console.log('点创建摘要 →', await clickMenuItem('创建摘要'));
await clickText('C');
await page.waitForTimeout(700);
console.log('B1 括线:', JSON.stringify(await brackets()));

await rightClickText('C');
console.log('第二次菜单项:', JSON.stringify(await menuItems()));
console.log('点创建摘要 →', await clickMenuItem('创建摘要'));
await clickText('D');
await page.waitForTimeout(900);
console.log('B2 括线:', JSON.stringify(await brackets()));
console.log('节点文本全集:', JSON.stringify(await Promise.all((await nodeIds()).map(async (i) => `${i}:${await textOf(i)}`))));
// 画布上可见的提示文案
console.log('提示文案:', await page.evaluate(() => [...document.querySelectorAll('*')].filter((e) => e.children.length === 0 && (e.textContent ?? '').includes('摘要')).map((e) => (e.textContent ?? '').trim()).slice(0, 12)));
await page.screenshot({ path: `${SHOTS}/probe-f5.png` });

console.log('\n=== K5 诊断：双击改名路径 ===');
// 回到干净态：撤销两次
await page.keyboard.press('Control+z');
await page.waitForTimeout(400);
await page.keyboard.press('Control+z');
await page.waitForTimeout(700);
console.log('撤销后括线:', JSON.stringify(await brackets()));
await page.mouse.click(20, 860);
await page.waitForTimeout(300);
const aid = await idOfText('A');
const ag = await geom(aid);
console.log('A 几何:', JSON.stringify(ag));
await page.mouse.dblclick((ag.wx + ag.w / 2) * ag.k + ag.tx, (ag.wy + ag.h / 2) * ag.k + ag.ty);
await page.waitForTimeout(600);
await page.screenshot({ path: `${SHOTS}/probe-k5-edit.png` });
console.log('双击后编辑态探针:', await page.evaluate(() => ({
  textarea: document.querySelectorAll('textarea').length,
  contenteditable: document.querySelectorAll('[contenteditable="true"]').length,
  focusedTag: document.activeElement?.tagName,
  focusedText: (document.activeElement?.textContent ?? '').slice(0, 40),
  overlay: document.querySelectorAll('[data-edit-overlay],[data-overlay-editor]').length,
  allAttrs: [...document.querySelectorAll('svg [data-node-id]')].slice(0, 1).map((g) => [...g.attributes].map((a) => a.name)),
})));
await page.keyboard.type('改');
await page.keyboard.press('Enter');
await page.waitForTimeout(800);
console.log('改名后 A 节点 id:', await idOfText('A改'), ' 原 A:', await idOfText('A'));
console.log('改名后节点文本:', JSON.stringify(await Promise.all((await nodeIds()).map(async (i) => `${i}:${await textOf(i)}`))));
await page.screenshot({ path: `${SHOTS}/probe-k5-after.png` });

await browser.close();
process.exit(0);
