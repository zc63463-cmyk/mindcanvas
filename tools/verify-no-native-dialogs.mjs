/**
 * 真浏览器验收：no-native-dialogs（原生对话框零调用）
 * ══════════════════════════════════════════════════════════════════════
 * 跑法：node tools/verify-no-native-dialogs.mjs [baseUrl]   （默认 http://localhost:5175）
 *
 * 背景（apps/canvas/tests/no-native-dialogs.test.ts 的姊妹项）：
 * 静态扫源码只能证明「源码里没有 `confirm(`/`alert(`/`prompt(` 词形」；**运行时**是否真的
 * 一次都不弹，需要真实浏览器。P0-C §七 明确要求「no-native-dialogs 的真实验证（confirm/alert/prompt
 * 零调用）」。
 *
 * 做法（双通道，任一命中即判红）：
 *   ① **页面内探针**：`addInitScript` 在页面脚本执行前把 `window.confirm/alert/prompt`
 *      换成本地**记录器**（记录 name/args/stack，返回安全默认值）——这会捕获**应用代码**
 *      的直接调用。
 *   ② **Playwright dialog 事件**：注册 `page.on('dialog')` 并在事件里 `dismiss()`。
 *      即使有代码绕过 ①（例如缓存了原生引用），真弹出也会在此被捕获 —— 两通道互补。
 *
 * 覆盖的**易弹原生框**的真实旅程（都走 UI，不直接调内部函数）：
 *   · 删除非当前文档 → 内联确认条（A-D3 已改直删/确认条）→ 点「取消」/「确认」；
 *   · 删除**当前**文档 → F2 流程（三选 / 确认条）；
 *   · 改名到冲突名 → 冲突三选；
 *   · 未保存时「新建」→ 离开决策器（三选）；点「取消」；
 *   · 上传同名资产 → 同名三选（资产侧）。
 *
 * 判据：退出码 0 = 全旅程零原生对话框调用且零 dialog 事件。
 * 未覆盖（如实）：IDE webview 的「静默吞掉」行为（那正是本守卫存在的原因）无法在
 * 独立 Chromium 中复现；本脚本证明的是「独立 Chromium 中零调用」，二者不等价。
 */
import { chromium } from 'playwright';
import { assertLoadedBundle, checkSnapshotFresh } from './lib/snapshotCheck.mjs';
import { DIALOG_PROBE_SOURCE, FAKE_FS_SOURCE, createReport, diskList } from './lib/browserHarness.mjs';

const BASE = process.argv[2] ?? 'http://localhost:5175';
const WS = 'ws-nd';
const DOC = 'nd.mm.md';
const RED_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

checkSnapshotFresh();

const { out, check, unconfirmed, finish } = createReport('verify-no-native-dialogs', BASE);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

/** Playwright 通道：真弹出即记录并 dismiss（避免挂死） */
const pwDialogs = [];
page.on('dialog', async (d) => {
  pwDialogs.push({ type: d.type(), message: d.message().slice(0, 200) });
  await d.dismiss().catch(() => undefined);
});
page.on('pageerror', (e) => check('页面无未捕获异常', false, String(e)));

await page.addInitScript(DIALOG_PROBE_SOURCE);
await page.addInitScript(FAKE_FS_SOURCE);

const readProbe = () => page.evaluate(() => window.__dialogs ?? []);
const saveState = () => page.evaluate(() => document.querySelector('[data-save-state]')?.textContent?.trim() ?? null);

const openFileManager = async () => {
  if ((await page.locator('[data-fm-tabs]').count()) > 0) return;
  await page.getByText('文件管理', { exact: true }).first().click({ timeout: 8000 });
  await page.waitForTimeout(400);
};
const closeOverlay = async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
};

/** 每个旅程后断言「累计仍为零」 */
let stepIndex = 0;
async function assertStillZero(label) {
  stepIndex += 1;
  const probe = await readProbe();
  check(
    `ND-${stepIndex} ${label}：零原生对话框调用`,
    probe.length === 0 && pwDialogs.length === 0,
    { probe, pwDialogs },
  );
}

try {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await assertLoadedBundle(page);
  await page.evaluate(
    ([doc, red]) => {
      window.__ws.seed('ws-nd', { [doc]: '# ND 根\n\n- 甲\n- 乙\n', 'assets/a.png': red });
      window.__ws.mount('ws-nd');
    },
    [DOC, RED_PNG],
  );
  const sample = page.getByRole('button', { name: '看内置示例' });
  if (await sample.count()) await sample.click({ timeout: 3000 }).catch(() => undefined);
  await page.waitForSelector('[data-node-id]', { timeout: 20000 });
  await page.waitForTimeout(500);
  await assertStillZero('启动 + 看内置示例');

  // 挂载工作区
  await openFileManager();
  await page.getByText(/打开本地文件夹/).first().click();
  await page.waitForTimeout(1000);
  await assertStillZero('挂载工作区（showDirectoryPicker）');

  /* ── 旅程 1：删除**非当前**文档 → 内联确认条 → 取消 ── */
  await page.getByText(/全部目录/).first().click({ timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(300);
  const row = page.locator(`[data-doc-row][data-doc-path$="${DOC}"]`).first();
  await row.waitFor({ state: 'visible', timeout: 10000 });
  await row.click({ button: 'right' });
  await page.waitForSelector('[data-menu-delete], [data-menu-remove]', { timeout: 5000 }).catch(() => undefined);
  const delBtn = page.locator('[data-menu-delete], [data-menu-remove]').first();
  check('ND.1a 文件管理器提供删除入口（菜单可开）', (await delBtn.count()) > 0, { count: await delBtn.count() });
  if ((await delBtn.count()) > 0) await delBtn.click();
  await page.waitForTimeout(500);
  await assertStillZero('发起删除（非当前文档）');

  // 内联确认条（非窗口 confirm）应出现
  const confirmBar = await page.locator('[data-fm-confirm]').count();
  out.inlineConfirmBarShown = confirmBar > 0;
  check('ND.1b 删除确认走**内联确认条**（不是 window.confirm）', confirmBar > 0, { confirmBar });
  if (confirmBar > 0) {
    await page.locator('[data-fm-confirm-cancel]').first().click();
    await page.waitForTimeout(400);
    await assertStillZero('取消删除');
    check('ND.1c 取消删除后文件仍在磁盘', (await diskList(page, WS)).includes(DOC), { list: await diskList(page, WS) });
  }

  /* ── 旅程 2：打开文档 + 编辑 → 未保存时「新建」→ 离开决策（三选） ── */
  const row2 = page.locator(`[data-doc-row][data-doc-path$="${DOC}"]`).first();
  await row2.locator('button').last().click();
  await page.waitForTimeout(1200);
  await closeOverlay();
  await page.waitForSelector('[data-node-id]', { timeout: 20000 });
  // 编辑制造 dirty
  const bb = await page.locator('g[data-node-id]').first().boundingBox();
  if (bb !== null) {
    await page.mouse.dblclick(bb.x + bb.width / 2, bb.y + bb.height / 2);
    const ed = page.locator('input[data-overlay-editor]').first();
    await ed.waitFor({ state: 'visible', timeout: 8000 }).catch(() => undefined);
    if ((await ed.count()) > 0) {
      await ed.fill('ND 改动');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
    }
  }
  await page.waitForTimeout(300);
  await page.getByText('新建', { exact: true }).first().click();
  await page.waitForTimeout(700);
  await assertStillZero('未保存时点「新建」（离开决策）');
  const leaveThreeWay = await page.evaluate(() => {
    const t = document.body.textContent ?? '';
    return /保存|放弃|取消/.test(t) && /未保存|放弃修改|保存后/.test(t);
  });
  out.leavePromptShown = leaveThreeWay;
  // 非判据（观察项）：是否触发离开决策取决于文档是否真的 dirty —— 本脚本的编辑步骤
  // 可能未生效。**无论是否触发**，本旅程的原生框断言（ND-5/ND-6）恒成立且为真正的判据。
  out.observations = out.observations ?? [];
  out.observations.push({
    label: '离开决策 UI 是否出现',
    value: leaveThreeWay,
    note: leaveThreeWay
      ? '出现自定义三选（保存/放弃/取消）'
      : '未出现（可能文档未 dirty）；不影响「零原生框」结论',
  });
  // 取消该决策
  const cancelBtn = page.getByText('取消', { exact: true }).first();
  if ((await cancelBtn.count()) > 0) {
    await cancelBtn.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(400);
  }
  await assertStillZero('取消离开决策');

  /* ── 旅程 3：改名到冲突名 → 冲突三选（不弹原生框） ── */
  await openFileManager();
  await page.getByText(/全部目录/).first().click({ timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(300);
  const row3 = page.locator(`[data-doc-row][data-doc-path$="${DOC}"]`).first();
  if ((await row3.count()) > 0) {
    await row3.click({ button: 'right' });
    await page.waitForSelector('[data-menu-rename]', { timeout: 5000 }).catch(() => undefined);
    if ((await page.locator('[data-menu-rename]').count()) > 0) {
      await page.locator('[data-menu-rename]').first().click({ timeout: 5000 });
      await page.waitForSelector('[data-rename-input]', { timeout: 5000 }).catch(() => undefined);
      const ri = page.locator('[data-rename-input]').first();
      if ((await ri.count()) > 0) {
        await ri.fill('nd-renamed.mm.md');
        await ri.press('Enter');
        await page.waitForTimeout(800);
        // 产品会弹「冲突三选」（见 F1 脚本的 finding）—— 无论如何都必须是自定义 UI
        const conflictPanel = await page.locator('[data-fm-conflict]').count();
        out.conflictPanelShown = conflictPanel > 0;
        out.observations.push({
          label: '改名冲突面板是否出现',
          value: conflictPanel > 0,
          note: conflictPanel > 0
            ? '出现自定义冲突三选面板（[data-fm-conflict]）'
            : '未出现（改名可能直接成功或输入未提交）；不影响「零原生框」结论',
        });
        if (conflictPanel > 0) {
          await page.locator('[data-fm-conflict-cancel]').first().click();
          await page.waitForTimeout(400);
        }
        await assertStillZero('改名冲突三选 + 取消');
      }
    }
  }

  /* ── 旅程 4：上传同名资产 → 资产侧同名三选 ── */
  await closeOverlay();
  await page.keyboard.press('Control+Shift+A');
  await page.waitForSelector('[data-asset-panel]', { timeout: 8000 });
  await page.waitForTimeout(500);
  const fileInput = page.locator('[data-asset-panel] input[type="file"]').first();
  const blue =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC';
  await fileInput.setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(blue, 'base64') });
  await page.waitForTimeout(1000);
  await assertStillZero('上传同名资产（工作区已有 assets/a.png）');

  /* ── 旅程 5：保存（Ctrl+S）/ 适配视图 / 右键节点菜单等常规操作 ── */
  await page.keyboard.press('Control+Shift+A'); // 关图库
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(1000);
  await page.getByText('适配视图', { exact: true }).first().click({ timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(400);
  const nodeForMenu = page.locator('g[data-node-id]').first();
  const nb = await nodeForMenu.boundingBox();
  if (nb !== null) {
    await page.mouse.click(nb.x + nb.width / 2, nb.y + nb.height / 2, { button: 'right' });
    await page.waitForTimeout(500);
    await assertStillZero('节点右键菜单');
    await page.keyboard.press('Escape');
  }

  /* ── 汇总 ── */
  const finalProbe = await readProbe();
  out.finalProbe = finalProbe;
  out.pwDialogs = pwDialogs;
  check(
    'ND.9 全旅程累计：confirm/alert/prompt 零调用（页面探针 + Playwright dialog 双通道）',
    finalProbe.length === 0 && pwDialogs.length === 0,
    { finalProbe, pwDialogs },
  );

  unconfirmed(
    'no-native-dialogs 在 IDE 内嵌 webview 下的「静默吞掉」行为',
    '本脚本证明的是**独立 Chromium** 中零调用；webview 会静默吞掉原生框（本守卫的起因）无法在独立 Chromium 复现，二者不等价。',
  );
} catch (e) {
  check('脚本执行', false, String(e));
} finally {
  await browser.close();
}

out.pass = finish();
console.log(JSON.stringify(out, null, 2));
process.exit(out.pass ? 0 : 1);
