/**
 * 真浏览器端到端验证（2026-09-11，用户实测「删除没修复 / 二级环没触发」后）
 * ══════════════════════════════════════════════════════════════════════
 * 跑法：node tools/verify-delete-subring.mjs [baseUrl]      （默认 http://localhost:5174）
 *
 * 三项：
 *   ① 主画布键盘删除：点选一个非根节点 → 按 Delete → 断言节点消失；
 *      同时**记账 confirm 调用**（把 window.confirm 换成「记录 + 返回 false」——
 *      与 IDE webview 的静默语义一致，若代码还在调它，这里会显形）。
 *   ② 环内删除气泡：选节点 → 按住 Alt → 按 ↓（高亮删除）→ 松 Alt → 期望 .confirm-chip 出现；
 *      Enter 后断言节点被删（覆盖「不弹气泡」这条）。
 *   ③ 二级环原型：/subring.html → 点演示节点 → 按住 Alt 250ms+ → 一级环；悬停「更多」450ms+ → 二级环。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:5174';
const out = { base: BASE };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

// 「记账 + 静默 false」的 confirm（复现 IDE webview 语义；真浏览器原生 confirm 会阻塞脚本）
// 且每次加载清 localStorage：无「最近文档」→ 直接进画布，跳过启动页（确定性）
await page.addInitScript(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  window.__confirmCalls = [];
  window.confirm = (m) => {
    window.__confirmCalls.push(String(m));
    return false;
  };
  window.__keys = [];
  window.addEventListener('keydown', (e) => window.__keys.push(e.key), true);
});

const ids = () => page.$$eval('g[data-node-id]', (gs) => gs.map((g) => g.getAttribute('data-node-id') ?? ''));

// ── ① 键盘删除 ──
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-node-id]', { timeout: 20000 });
await page.waitForTimeout(800);

const before = await ids();
const target = before[before.length - 1] ?? '';
const node = page.locator(`g[data-node-id="${target}"]`).first();
const bb = await node.boundingBox();
const strokeBefore = await node.locator('rect').first().getAttribute('stroke');
await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
await page.waitForTimeout(400);
const strokeAfterClick = await node.locator('rect').first().getAttribute('stroke');
await page.keyboard.press('Delete');
await page.waitForTimeout(500);
const after = await ids();

out.deleteKey = {
  nodesBefore: before.length,
  nodesAfter: after.length,
  target,
  deleted: !after.includes(target),
  strokeBefore,
  strokeAfterClick, // 变化 = 已选中
  confirmCalls: await page.evaluate(() => window.__confirmCalls),
  keysSeen: await page.evaluate(() => window.__keys.slice(-6)),
};
console.log('① 键盘删除 =>', JSON.stringify(out.deleteKey));
await page.screenshot({ path: 'verify-shots/del-check.png' });

// ── ② 环内删除气泡 ──
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-node-id]', { timeout: 20000 });
await page.waitForTimeout(800);
const before2 = await ids();
const target2 = before2[before2.length - 1] ?? '';
const bb2 = await page.locator(`g[data-node-id="${target2}"]`).first().boundingBox();
await page.mouse.click(bb2.x + bb2.width / 2, bb2.y + bb2.height / 2);
await page.waitForTimeout(300);
await page.keyboard.down('Alt');
await page.waitForTimeout(450); // 越过 250ms 蓄力
const ringOpen = (await page.$$('.ring')).length > 0;
await page.keyboard.press('ArrowDown'); // 直映射：↓ = 删除
await page.waitForTimeout(150);
await page.keyboard.up('Alt'); // 松键 = 提交（危险动作 → 转二次确认气泡）
await page.waitForTimeout(300);
const chipVisible = (await page.$$('.confirm-chip')).length > 0;
if (chipVisible) {
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
}
const after2 = await ids();
out.ringDelete = {
  ringOpen,
  confirmChipShown: chipVisible,
  target: target2,
  deletedAfterEnter: !after2.includes(target2),
  nodesBefore: before2.length,
  nodesAfter: after2.length,
};
console.log('② 环内删除气泡 =>', JSON.stringify(out.ringDelete));
await page.screenshot({ path: 'verify-shots/ring-delete-check.png' });

// ── ③ 二级环沙盒（并入原预览页 /radial.html）：Alt 出环 → 悬停「更多」停顿 → 外圈展开 → 轮转 → 松键 ──
const p2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await p2.addInitScript(() => {
  window.__keys = [];
  window.addEventListener('keydown', (e) => window.__keys.push(e.key), true);
});
await p2.goto(`${BASE}/radial.html`, { waitUntil: 'networkidle' });
await p2.waitForSelector('.node-card', { timeout: 15000 });
await p2.waitForTimeout(400);
await p2.mouse.click(200, 700); // 空白处点一下：拿页面焦点（预览页无副作用）
const card = await p2.locator('.node-card').boundingBox();
const ax = Math.round(card.x + card.width); // 环心 = 节点卡右上角
const ay = Math.round(card.y);
const label = async () => (await p2.textContent('.float-label').catch(() => null))?.slice(0, 30) ?? null;

await p2.mouse.move(ax + 220, ay + 220); // 指针先离开环区
await p2.keyboard.down('Alt');
await p2.waitForTimeout(500); // 越过 250ms 蓄力
const l1 = (await p2.$$('.ring')).length > 0;
await p2.mouse.move(ax - 40, ay); // 一级「更多」扇区（左）
await p2.waitForTimeout(900); // 越过 dwell(450ms) → 下钻
const l2 = (await p2.$$('.sub-ring')).length > 0;
const seatBefore = await label();
await p2.keyboard.press('ArrowRight'); // 二级席位轮转 → 席 1「新建同级节点」
await p2.waitForTimeout(200);
const seatAfter = await label();
// 剪贴板席（席 6）：→ ×5 应能到达「复制节点文本」——
// 旧实现该席是 disabled 条件席（轮转跳过 + 描边几乎不可见）→ 用户观感「席位空缺」；本断言钉住「七席皆可达」
for (let i = 0; i < 5; i++) await p2.keyboard.press('ArrowRight');
await p2.waitForTimeout(200);
const copySeat = await label();
for (let i = 0; i < 5; i++) await p2.keyboard.press('ArrowLeft'); // ← ×5 回到席 1
await p2.waitForTimeout(200);
// 翻页：→ ×3 到席 4「升为中心」→ Enter 进方向页 → → 到「靠右生长」
for (let i = 0; i < 3; i++) await p2.keyboard.press('ArrowRight');
await p2.waitForTimeout(150);
const centerSeat = await label();
await p2.keyboard.press('Enter');
await p2.waitForTimeout(250);
const pageSwitch = await label(); // 进页后无高亮 → null
await p2.keyboard.press('ArrowRight');
await p2.waitForTimeout(200);
const dirSeat = await label();
const dimmed = (await p2.$$('.ring-dim')).length > 0; // 一级降透明（非当前级）
await p2.keyboard.up('Alt'); // 二级：有高亮 = 提交并收起
await p2.waitForTimeout(300);
out.subRingSandbox = {
  cardCorner: { x: ax, y: ay },
  level1Ring: l1,
  level2Ring: l2,
  mainDimmedAtL2: dimmed,
  seatBefore,
  seatAfterArrow: seatAfter,
  clipboardSeat: copySeat, // 期望「复制节点文本」（七席皆可达）
  centerSeat,
  pageSwitchLabel: pageSwitch,
  dirSeatAfterPage: dirSeat,
  closedAfterRelease: { ring: (await p2.$$('.ring')).length, sub: (await p2.$$('.sub-ring')).length },
  keysSeen: await p2.evaluate(() => window.__keys.slice(0, 8)),
};
console.log('③ 二级环沙盒（/radial.html）=>', JSON.stringify(out.subRingSandbox));
await p2.screenshot({ path: 'verify-shots/subring-sandbox-check.png' });

// ── ④ 主画布二级环（T5 画布接线）：Alt 出环 → 悬停「更多」停顿 → 外圈 → 选「新建同级」→ 松键**真建节点** ──
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-node-id]', { timeout: 20000 });
await page.waitForTimeout(800);
const before4 = await ids();
const target4 = before4[before4.length - 1] ?? '';
const bb4 = await page.locator(`g[data-node-id="${target4}"]`).first().boundingBox();
await page.mouse.click(bb4.x + bb4.width / 2, bb4.y + bb4.height / 2);
await page.waitForTimeout(300);
const ax4 = Math.round(bb4.x + bb4.width); // 环心 = 节点盒右上角（与 nodeCorner 同源）
const ay4 = Math.round(bb4.y);
await page.keyboard.down('Alt');
await page.waitForTimeout(450); // 越过 250ms 蓄力
const l1b = (await page.$$('.ring')).length > 0;
await page.mouse.move(ax4 - 40, ay4); // 一级「更多」扇区（左）
await page.waitForTimeout(800); // 越过停顿 450ms → 下钻
const l2b = (await page.$$('.sub-ring')).length > 0;
const dimB = (await page.$$('.ring-dim')).length > 0;
const seatAtDrill = (await page.textContent('.float-label').catch(() => null)) ?? null;
await page.keyboard.press('ArrowRight'); // 空高亮 → 席 1「新建同级节点」
await page.waitForTimeout(200);
const seatAfter4 = (await page.textContent('.float-label').catch(() => null)) ?? null;
await page.keyboard.up('Alt'); // 松键 = 提交席 1（真建同级节点）
await page.waitForTimeout(700);
const after4 = await ids();
out.canvasSubRing = {
  ringOpen: l1b,
  subRingOpen: l2b,
  mainDimmed: dimB,
  seatAtDrill,
  seatAfterArrow: seatAfter4,
  nodesBefore: before4.length,
  nodesAfter: after4.length,
  createdSibling: after4.length === before4.length + 1,
};
console.log('④ 主画布二级环（T5）=>', JSON.stringify(out.canvasSubRing));
await page.screenshot({ path: 'verify-shots/canvas-subring-check.png' });

// ── ⑤ 菜单瘦身（T6）：右键 → 首屏行数（不再四向平铺）→ 「生长方向」进子页 → 选向 → 关闭 ──
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-node-id]', { timeout: 20000 });
await page.waitForTimeout(800);
const ids5 = await ids();
const target5 = ids5[ids5.length - 1] ?? '';
const bb5 = await page.locator(`g[data-node-id="${target5}"]`).first().boundingBox();
await page.mouse.click(bb5.x + bb5.width / 2, bb5.y + bb5.height / 2, { button: 'right' });
await page.waitForTimeout(400);
const menuLabels = await page.$$eval('[data-menu-item]', (els) => els.map((e) => (e.textContent ?? '').trim()));
await page.locator('[data-menu-item]', { hasText: '生长方向' }).first().click();
await page.waitForTimeout(250);
const subLabels = await page.$$eval('[data-menu-item]', (els) => els.map((e) => (e.textContent ?? '').trim()));
const backRows = (await page.$$('[data-menu-back]')).length;
await page.locator('[data-menu-item]', { hasText: '向左' }).first().click();
await page.waitForTimeout(350);
const menuClosed = (await page.$$('[data-context-menu]')).length === 0;
out.menuT6 = {
  firstScreenRows: menuLabels.length,
  firstScreenLabels: menuLabels,
  dirPageRows: subLabels.length,
  dirPageLabels: subLabels,
  backRows,
  menuClosedAfterPick: menuClosed,
};
console.log('⑤ 菜单瘦身（T6）=>', JSON.stringify(out.menuT6));
await page.screenshot({ path: 'verify-shots/menu-t6-check.png' });

// ── ⑥ 帮助面板（T7）：? 打开 → 二级 7 席清单（与派生模型同源）→ Esc 关闭 ──
await page.mouse.click(640, 60); // 画布上缘空白处：拿焦点、避免落到侧栏控件
await page.waitForTimeout(200);
await page.keyboard.press('Shift+/'); // '?'（显式 Shift+/：布局无关）
await page.waitForTimeout(400);
const helpOpen = (await page.$$('[data-help-backdrop]')).length > 0;
const helpSeats = await page.$$eval('[data-sub-seat-label]', (els) => els.map((e) => e.textContent ?? ''));
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
const helpClosed = (await page.$$('[data-help-backdrop]')).length === 0;
out.helpT7 = {
  helpOpen,
  seatCount: helpSeats.length,
  seats: helpSeats,
  helpClosed,
  keysSeen: await page.evaluate(() => window.__keys.slice(-4)),
};
console.log('⑥ 帮助面板（T7）=>', JSON.stringify(out.helpT7));
await page.screenshot({ path: 'verify-shots/help-t7-check.png' });
await browser.close();
