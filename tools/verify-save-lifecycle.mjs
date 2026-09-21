/**
 * 真浏览器端到端验收：保存生命周期（SAVE-LIFECYCLE 包 1 + 复核 R1）
 * ══════════════════════════════════════════════════════════════════════
 * 跑法：node tools/verify-save-lifecycle.mjs [baseUrl]   （默认 http://localhost:5175）
 *
 * 旅程 A · 慢写窗口不误清脏（审计 P0-A）
 *   带内存句柄打开种子文档（autosave 可用）→ 编辑① → 写入① 的 close() 被闸门挂起 →
 *   写入① 未完成时编辑② → 放行写入①：
 *     ① 写入① 完成后不得显示「✓ 已保存」；
 *     ② 必须真的发生写入② 且写盘内容含编辑②；
 *     ③ 放行写入② 之后才允许显示「✓ 已保存」。
 *
 * 旅程 B · 另存为之后排队 auto 写新文件（复核 R1）
 *   测点一（触发 autosave 落旧文件）→ 点「另存为」（mock 选择器返回新句柄）并把写入② 挂起 →
 *   写入② 未完成时编辑② → 300ms 后 auto 入队 → 放行写入②：
 *     ① 写入③ 的目的地必须是**新句柄**（不是旧文件）；
 *     ② 写入③ 内容含编辑②；
 *     ③ 全程对旧句柄的写入在另存为之后不再发生。
 *
 * 判据：退出码 0 = 全部通过。前置：先构建产物（checkSnapshotFresh 卡新鲜度），
 * 再用静态服务托管 dist（例：vite preview --port 5175）。
 *
 * 不声称覆盖：真实系统文件选择器的用户手势/取消（无头不可自动化，选择器用 mock 顶替）。
 */
import { chromium } from 'playwright';
import { assertLoadedBundle, checkSnapshotFresh } from './lib/snapshotCheck.mjs';

const BASE = process.argv[2] ?? 'http://localhost:5175';
const SEED_TEXT = '# E2E根\n\n- 甲节点\n- 乙节点\n';
const TARGET = '乙节点';
const EDIT1 = '乙节点一';
const EDIT2 = '乙节点二';
const OLD_NAME = 'e2e-save.mm.md';
const NEW_NAME = 'e2e-save-as.mm.md';

checkSnapshotFresh();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

await page.addInitScript(
  (seed) => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    window.__writes = [];
    window.__gates = [];
    window.__releaseWrite = (index) => {
      const g = window.__gates.find((x) => x.index === index);
      if (g) g.release();
    };
    // 内存句柄：createWritable().close() 一律挂起，等脚本显式放行（构造「慢写窗口」）
    const makeHandle = (name) => ({
      name,
      getFile: async () => new File([seed], name, { type: 'text/markdown' }),
      createWritable: async () => {
        const index = window.__writes.length + 1;
        let release = () => {};
        const gate = new Promise((resolve) => {
          release = () => resolve();
        });
        window.__gates.push({ index, release });
        return {
          write: async (data) => {
            window.__writes.push({
              index,
              handle: name,
              text: typeof data === 'string' ? data : '[blob]',
            });
          },
          close: async () => {
            await gate;
          },
        };
      },
    });
    window.showOpenFilePicker = async () => [makeHandle('e2e-save.mm.md')];
    window.showSaveFilePicker = async () => makeHandle('e2e-save-as.mm.md');
  },
  SEED_TEXT,
);

const saveStateText = () => page.locator('[data-save-state]').first().textContent();
const writeCount = () => page.evaluate(() => window.__writes.length);
const writeText = (i) => page.evaluate((idx) => String(window.__writes[idx]?.text ?? ''), i);
const writeHandle = (i) => page.evaluate((idx) => String(window.__writes[idx]?.handle ?? ''), i);

const out = { base: BASE };
let pass = true;
const check = (name, ok, detail) => {
  out[name] = { ok, detail };
  if (!ok) pass = false;
};

/** 打开带 mock 句柄的种子文档（autosave 条件成立）；每次导航由 initScript 重置记录 */
async function openSeedDoc() {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await assertLoadedBundle(page);
  const sampleBtn = page.getByRole('button', { name: '看内置示例' });
  if (await sampleBtn.count()) {
    await sampleBtn.click({ timeout: 3000 }).catch(() => undefined);
  }
  await page.waitForSelector('[data-node-id]', { timeout: 20000 });
  await page.waitForTimeout(600);
  await page.keyboard.press('Control+o');
  await page.waitForSelector(`g[data-node-id]:has-text("${TARGET}")`, { timeout: 20000 });
  await page.waitForTimeout(800);
}

async function editNode(fromText, toText) {
  const node = page.locator('g[data-node-id]', { hasText: fromText }).first();
  const bb = await node.boundingBox();
  if (bb === null) throw new Error(`节点无 boundingBox: ${fromText}`);
  await page.mouse.dblclick(bb.x + bb.width / 2, bb.y + bb.height / 2);
  const input = page.locator('input:not([type="file"])').first();
  await input.waitFor({ state: 'visible', timeout: 5000 });
  await input.fill(toText);
  await page.keyboard.press('Enter');
}

try {
  /* ---------------- 旅程 A：慢写窗口不误清脏（P0-A） ---------------- */
  await openSeedDoc();
  await editNode(TARGET, EDIT1);
  await page.waitForFunction(() => window.__writes.length === 1, { timeout: 8000 });
  const stateDuringWrite1 = await saveStateText();

  await editNode(EDIT1, EDIT2);
  await page.waitForTimeout(700);
  const stateBeforeRelease1 = await saveStateText();
  check('A1 写入① 挂起期间：显示保存中（不是已保存）', stateBeforeRelease1?.includes('保存中') === true, {
    stateDuringWrite1,
    stateBeforeRelease1,
  });

  await page.evaluate(() => window.__releaseWrite(1));
  await page.waitForFunction(() => window.__writes.length === 2, { timeout: 8000 });
  const stateAfterWrite1 = await saveStateText();
  check('A2 写入① 完成后不得显示「✓ 已保存」', stateAfterWrite1?.includes('已保存') !== true, {
    stateAfterWrite1,
  });

  await page.evaluate(() => window.__releaseWrite(2));
  await page.waitForFunction(
    () => document.querySelector('[data-save-state]')?.textContent?.includes('已保存') === true,
    { timeout: 8000 },
  );
  await page.waitForTimeout(300);
  const stateAfterWrite2 = await saveStateText();
  const totalA = await writeCount();
  const firstA = await writeText(0);
  const secondA = await writeText(1);
  check('A3 写入② 真的发生（最新编辑没有留在内存里）', totalA === 2, { total: totalA });
  check('A4 写入① 含编辑①', firstA.includes(EDIT1), { head: firstA.slice(0, 120) });
  check('A5 写入② 含编辑②', secondA.includes(EDIT2), { head: secondA.slice(0, 120) });
  check('A6 写入② 完成后才显示「✓ 已保存」', stateAfterWrite2?.includes('已保存') === true, {
    stateAfterWrite2,
  });
  out.statesA = { stateDuringWrite1, stateBeforeRelease1, stateAfterWrite1, stateAfterWrite2 };

  /* ---------------- 旅程 B：另存为之后排队 auto 写新文件（R1） ---------------- */
  await openSeedDoc();
  // 测点一：先落一次旧文件（否则首个写入就是另存为，测不到「之后」）
  await editNode(TARGET, EDIT1);
  await page.waitForFunction(() => window.__writes.length === 1, { timeout: 8000 });
  await page.evaluate(() => window.__releaseWrite(1));
  await page.waitForFunction(
    () => document.querySelector('[data-save-state]')?.textContent?.includes('已保存') === true,
    { timeout: 8000 },
  );
  check('B1 测点一写入旧文件', (await writeHandle(0)) === OLD_NAME, { handle: await writeHandle(0) });

  // 另存为（mock 选择器返回新句柄）→ 写入② 挂起
  await page.getByText('另存为', { exact: true }).click();
  await page.waitForFunction(() => window.__writes.length === 2, { timeout: 8000 });
  check('B2 另存为写入新句柄', (await writeHandle(1)) === NEW_NAME, { handle: await writeHandle(1) });

  // 写入② 未完成时继续编辑 → 300ms 后 auto 入队
  await editNode(EDIT1, EDIT2);
  await page.waitForTimeout(800);

  await page.evaluate(() => window.__releaseWrite(2));
  await page.waitForFunction(() => window.__writes.length === 3, { timeout: 8000 });
  const thirdHandle = await writeHandle(2);
  const thirdText = await writeText(2);
  check('B3 排队 auto 写的是新句柄（不是旧文件）', thirdHandle === NEW_NAME, { thirdHandle });
  check('B4 排队 auto 含最新编辑', thirdText.includes(EDIT2), { head: thirdText.slice(0, 120) });

  await page.evaluate(() => window.__releaseWrite(3));
  await page.waitForFunction(
    () => document.querySelector('[data-save-state]')?.textContent?.includes('已保存') === true,
    { timeout: 8000 },
  );
  await page.waitForTimeout(400);
  const totalB = await writeCount();
  const handlesB = await page.evaluate(() => window.__writes.map((w) => w.handle));
  check('B5 另存为后不再写旧文件（除测点一）', handlesB.slice(1).every((h) => h === NEW_NAME), {
    handles: handlesB,
    total: totalB,
  });
} catch (e) {
  check('脚本执行', false, String(e));
} finally {
  await browser.close();
}

out.result = pass ? 'PASS' : 'FAIL';
console.log(JSON.stringify(out, null, 2));
process.exit(pass ? 0 : 1);
