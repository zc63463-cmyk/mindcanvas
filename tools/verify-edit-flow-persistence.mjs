/**
 * 真浏览器端到端验收：编辑流不被打断（批次 E 修复在**产物**里是否真的生效）
 * ══════════════════════════════════════════════════════════════════════
 * 跑法：node tools/verify-edit-flow-persistence.mjs [baseUrl]   （默认 http://localhost:5175）
 *
 * 复刻用户实测场景（2026-09-13）：
 *   打开一个**带文件句柄**的文档 → 选中节点 → 双击编辑 → Enter 提交
 *   → 等待 autosave（300ms debounce）→ 三条断言：
 *     ① 保存真的发生：写盘内容含新文本（否则用例空转，无判别力）
 *     ② **全树节点 id 集合不变**（无 re-parse/重建——修复前 `doc.source` 被改写
 *        → buildEditable 重解析 → astToEditable 重新生成全部 id → 旧 selectedId 失配）
 *     ③ 选中高亮保持（选中节点的 rect stroke 仍是 selection 色）
 *
 * 为什么无头脚本能触发 autosave：用 addInitScript 把 `window.showOpenFilePicker`
 * 换成内存句柄 mock（{ getFile, createWritable }）→ 文档满足 `saved + handle`
 * （useAutoSave 的早退条件）→ autosave 条件成立。
 *
 * 修复前（旧产物）预期：① 通过、② ③ 失败（id 全变 + 高亮丢失）。
 * 修复后（E 批起）：三条全过。退出码 0 = 全过；1 = 有断言失败（打印明细）。
 */
import { chromium } from 'playwright';
import { assertLoadedBundle, checkSnapshotFresh } from './lib/snapshotCheck.mjs';

const BASE = process.argv[2] ?? 'http://localhost:5175';
const SEED_TEXT = '# E2E根\n\n- 甲节点\n- 乙节点\n';
const TARGET = '乙节点';
const APPEND = '改';
const EXPECT_TEXT = TARGET + APPEND;

// 先验产物新鲜度：防止「测的是旧快照」导致的假阴性（2026-09-13 已踩过一次）
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
    // 内存文件句柄 mock：满足 FsFileHandle 契约（name / getFile / createWritable）
    const handle = {
      name: 'e2e-flow.mm.md',
      getFile: async () => new File([seed], 'e2e-flow.mm.md', { type: 'text/markdown' }),
      createWritable: async () => ({
        write: async (data) => {
          window.__writes.push(typeof data === 'string' ? data : '[blob]');
        },
        close: async () => undefined,
      }),
    };
    window.showOpenFilePicker = async () => [handle];
  },
  SEED_TEXT,
);

const ids = () => page.$$eval('g[data-node-id]', (gs) => gs.map((g) => g.getAttribute('data-node-id') ?? ''));
const nodeByText = (t) => page.locator('g[data-node-id]', { hasText: t }).first();
const strokeOf = (node) => node.locator('rect').first().getAttribute('stroke');

const out = { base: BASE };
let pass = true;
const check = (name, ok, detail) => {
  out[name] = { ok, detail };
  if (!ok) pass = false;
};

try {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await assertLoadedBundle(page); // ③ 防浏览器缓存旧 bundle
  // 启动页只在「有最近文档」时出现（已清 localStorage → 通常直接进画布）；
  // 若出现则点「看内置示例」跳过。用短超时探测，不做硬等待。
  const sampleBtn = page.getByRole('button', { name: '看内置示例' });
  if (await sampleBtn.count()) {
    await sampleBtn.click({ timeout: 3000 }).catch(() => undefined);
  }
  await page.waitForSelector('[data-node-id]', { timeout: 20000 });
  await page.waitForTimeout(600);

  // Ctrl+O → 走 mock 句柄打开我的种子文档（此刻起 doc 带 handle → autosave 可用）
  await page.keyboard.press('Control+o');
  await page.waitForSelector(`g[data-node-id]:has-text("${TARGET}")`, { timeout: 20000 });
  await page.waitForTimeout(800);

  const node = nodeByText(TARGET);
  const bb = await node.boundingBox();
  if (bb === null) throw new Error('目标节点无 boundingBox');
  const cx = bb.x + bb.width / 2;
  const cy = bb.y + bb.height / 2;

  const strokeIdle = await strokeOf(node);
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(400);
  const strokeSelected = await strokeOf(node);
  check('选中生效（描边变化）', strokeIdle !== strokeSelected, { strokeIdle, strokeSelected });

  const idsBefore = await ids();

  // 双击进入编辑 → 追加文本 → Enter 提交
  await page.mouse.dblclick(cx, cy);
  const input = page.locator('input:not([type="file"])').first();
  await input.waitFor({ state: 'visible', timeout: 5000 });
  await input.fill(EXPECT_TEXT);
  await page.keyboard.press('Enter');

  // 等 autosave 真正落盘（300ms debounce）——用写盘 mock 记账，防空转
  await page.waitForFunction(() => window.__writes.length > 0, { timeout: 6000 });
  await page.waitForTimeout(400);

  const writes = await page.evaluate(() => window.__writes);
  check(
    '① autosave 真的发生（写盘含新文本）',
    writes.length > 0 && String(writes[writes.length - 1]).includes(EXPECT_TEXT),
    { writes: writes.length, tail: String(writes[writes.length - 1]).slice(0, 120) },
  );

  const idsAfter = await ids();
  const sameIds =
    idsAfter.length === idsBefore.length && idsBefore.every((id, i) => id === idsAfter[i]);
  check('② 全树节点 id 集合不变（无重解析/重建）', sameIds, {
    before: idsBefore.length,
    after: idsAfter.length,
    firstDiff: idsBefore.findIndex((id, i) => id !== idsAfter[i]),
  });

  const stillThere = await page.locator(`g[data-node-id="${idsBefore[idsBefore.length - 1]}"]`).count();
  const strokeAfter = await strokeOf(nodeByText(EXPECT_TEXT));
  check('③ 选中高亮保持（编辑后仍为 selection 描边）', strokeAfter === strokeSelected && stillThere > 0, {
    strokeAfter,
    strokeSelected,
  });

  out.textOnCanvas = await nodeByText(EXPECT_TEXT).count();
} catch (e) {
  check('脚本执行', false, String(e));
} finally {
  await browser.close();
}

out.result = pass ? 'PASS' : 'FAIL';
console.log(JSON.stringify(out, null, 2));
process.exit(pass ? 0 : 1);
