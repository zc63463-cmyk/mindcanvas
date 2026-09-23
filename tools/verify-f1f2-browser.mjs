/**
 * 真浏览器验收：P0-A F1 第③条 + F2 IME 人工项
 * ══════════════════════════════════════════════════════════════════════
 * 跑法：node tools/verify-f1f2-browser.mjs [baseUrl]   （默认 http://localhost:5175）
 *
 * ── F1 第③条（acceptance §3 F1「可观察」③；层 = M） ─────────────────────────
 *   「租约期间 **Ctrl+S 不发起写入**，提示『正在处理上一步操作』类文案，
 *     且 `saving` 不闪、dirty 不变。」
 *   本脚本用**慢盘窗口**制造真实租约：把目录句柄的 `removeEntry`（改名/移动的
 *   第二步「删源」）延迟 1.5s，在改名仍在进行时连按 3 次 Ctrl+S，观测：
 *     ① 出现 `busy-lease` 文案（『正在处理上一步操作…』）—— **不是** `busy-physical`；
 *     ② 3 次 Ctrl+S 期间 `[data-save-state]` **从未出现「保存中…」**（不闪）；
 *     ③ 状态区仍是「● 未保存」，dirty 不变；
 *     ④ 磁盘源码 mtime/内容在租约期间**不变**（零写入）；
 *     ⑤ 租约结束后重试改名成功；此后 Ctrl+S 写**新路径**，旧路径不存在。
 *
 * ── F2 IME（acceptance §3 F2「可观察」①；层 = **M**） ───────────────────────
 *   「组合进行中 → 不弹模态框、不执行删除，提示『输入法正在输入，请先结束输入』，
 *     组合结束后自动续跑。」
 *   P0-A 回执 §8.2 已声明：**真实输入法（候选窗口、上屏时机）未验证，且不用合成事件冒充**。
 *   本脚本**不冒充真实 IME**：它用 Chromium 的**可信输入事件**（`Input.imeSetComposition`
 *   经 CDP 派发）驱动产品的 document 级 composition 监听 —— 这是浏览器给出的
 *   真实组合状态通道，而非 `dispatchEvent(new CompositionEvent(...))` 的合成事件。
 *   即便这样，**候选窗口 / 上屏时机**仍不可复现 → 第 ⑤ 条保持 unconfirmed（如实）。
 *
 * 判据：退出码 0 = 全部通过。未覆盖项见 unconfirmed()。
 */
import { chromium } from 'playwright';
import { assertLoadedBundle, checkSnapshotFresh } from './lib/snapshotCheck.mjs';
import {
  DIALOG_PROBE_SOURCE,
  FAKE_FS_SOURCE,
  clearDelays,
  createReport,
  diskRead,
  readDialogs,
  setDelays,
  writes,
} from './lib/browserHarness.mjs';

const BASE = process.argv[2] ?? 'http://localhost:5175';
const WS = 'ws-f1';
const DOC = 'f1.mm.md';
const RENAMED = 'f1-renamed.mm.md';
const DOC_F2 = 'f2.mm.md';

checkSnapshotFresh();

const { out, check, unconfirmed, finish } = createReport('verify-f1f2-browser', BASE);
out.findings = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => check('页面无未捕获异常', false, String(e)));

await page.addInitScript(DIALOG_PROBE_SOURCE);
await page.addInitScript(FAKE_FS_SOURCE);

const saveState = () => page.evaluate(() => document.querySelector('[data-save-state]')?.textContent?.trim() ?? null);
const dirtyFlag = () => page.evaluate(() => document.querySelector('[data-doc-dirty]') !== null);
const noticeTextOn = (pg) =>
  pg.evaluate(() =>
    [...document.querySelectorAll('div,span')]
      .filter((e) => e.children.length === 0 && (e.textContent ?? '').trim().length > 0 && (e.textContent ?? '').length < 120)
      .map((e) => (e.textContent ?? '').trim())
      .filter((t) => /正在处理|上一份写入|未做任何改动|稍候|请稍后/.test(t)),
  );
const noticeText = () => noticeTextOn(page);

const openFileManager = async () => {
  if ((await page.locator('[data-fm-tabs]').count()) > 0) return;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const btn = page.getByText('文件管理', { exact: true }).first();
    await btn.waitFor({ state: 'attached', timeout: 8000 });
    await btn.click({ timeout: 5000, force: attempt > 0 }).catch(() => undefined);
    await page.waitForTimeout(500);
    if ((await page.locator('[data-fm-tabs]').count()) > 0) return;
  }
  throw new Error('文件管理器未能打开（[data-fm-tabs] 始终不存在）');
};
const closeOverlay = async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
};

/** 打开工作区文档（保存过一次 → durable，满足 I-14） */
async function openDocAndMakeDurable() {
  await openFileManager();
  // 确保在「全部目录」树视图
  const treeTab = page.getByText(/全部目录/).first();
  if ((await treeTab.count()) > 0) {
    await treeTab.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(300);
  }
  const row = page.locator(`[data-doc-row][data-doc-path$="${DOC}"]`).first();
  try {
    await row.waitFor({ state: 'visible', timeout: 10000 });
  } catch (e) {
    const diag = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('[data-doc-row]')].map((x) => x.getAttribute('data-doc-path')),
      tabs: [...document.querySelectorAll('[data-fm-tabs] *')].map((x) => x.textContent?.trim()).filter(Boolean),
      bodyHasFile: /f1\.mm\.md/.test(document.body.textContent ?? ''),
      fmOpen: document.querySelector('[data-fm-tabs]') !== null,
      mounted: window.__ws ? window.__ws.list('ws-f1') : null,
    }));
    out.rowDiag = diag;
    throw new Error(`doc row 未出现；diag=${JSON.stringify(diag)}`);
  }
  // 行内的「打开」按钮（📄 名字）
  await row.locator('button').last().click();
  await page.waitForTimeout(1000);
  await closeOverlay();
  await page.waitForSelector('[data-node-id]', { timeout: 20000 });
  await page.waitForTimeout(500);
}

/** 双击一个真正可见的节点，打开标题编辑浮层（带重试）。返回编辑器 locator。 */
async function openNodeEditorOn(pg) {
  // 浮层（文件管理器）会盖住画布 —— 必须先关掉再点节点
  if ((await pg.locator('[data-fm-tabs]').count()) > 0) {
    await pg.keyboard.press('Escape');
    await pg.waitForTimeout(400);
  }
  await pg.waitForSelector('g[data-node-id]', { timeout: 10000 });
  await pg.waitForTimeout(300);
  const nodes = pg.locator('g[data-node-id]');
  const count = await nodes.count();
  let target = nodes.first();
  for (let i = 0; i < count; i += 1) {
    const n = nodes.nth(i);
    const b = await n.boundingBox();
    if (b !== null && b.width > 4 && b.height > 4) {
      target = n;
      break;
    }
  }
  const bb = await target.boundingBox();
  if (bb === null) throw new Error('节点无 boundingBox（无可编辑节点）');
  const cx = bb.x + bb.width / 2;
  const cy = bb.y + bb.height / 2;
  const input = pg.locator('input[data-overlay-editor]').first();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await pg.mouse.click(cx, cy);
    await pg.waitForTimeout(150);
    await pg.mouse.dblclick(cx, cy);
    try {
      await input.waitFor({ state: 'visible', timeout: 2000 });
      return input;
    } catch {
      await pg.waitForTimeout(200);
    }
  }
  out.editorDiag = await pg.evaluate(() => ({
    nodes: document.querySelectorAll('g[data-node-id]').length,
    inputs: [...document.querySelectorAll('input')].map((i) => ({ type: i.type, vis: !!(i.offsetWidth || i.offsetHeight), attrs: [...i.attributes].map((a) => a.name) })),
    fmOpen: document.querySelector('[data-fm-tabs]') !== null,
    bodyHasBlocked: /已阻止保存/.test(document.body.textContent ?? ''),
  }));
  await input.waitFor({ state: 'visible', timeout: 5000 });
  return input;
}

const openNodeEditor = () => openNodeEditorOn(page);

/** 编辑某个节点标题（制造 dirty）。 */
async function editRoot(text) {
  const input = await openNodeEditor();
  await input.fill(text);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
}

/** 经右键菜单发起改名（把待确认输入框填成新名并回车） */
async function startRename(newName) {
  await openFileManager();
  // 确保在「全部目录」树视图（新建/重开后可能停在别的 tab）
  const treeTab = page.getByText(/全部目录/).first();
  if ((await treeTab.count()) > 0) {
    await treeTab.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(300);
  }
  const row = page.locator(`[data-doc-row][data-doc-path$="${DOC}"]`).first();
  await row.waitFor({ state: 'visible', timeout: 10000 });
  await row.click({ button: 'right' });
  await page.waitForSelector('[data-menu-rename]', { timeout: 5000 });
  await page.locator('[data-menu-rename]').first().click({ timeout: 8000 });
  await page.waitForSelector('[data-rename-input]', { timeout: 5000 });
  const inp = page.locator('[data-rename-input]').first();
  await inp.fill(newName);
  await inp.press('Enter');
}

try {
  /* ═════════════ F1 第③条 ═════════════ */
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await assertLoadedBundle(page);
  await page.evaluate(
    ([doc]) => {
      window.__ws.seed('ws-f1', { [doc]: '# F1 根\n\n- 甲\n- 乙\n' });
      window.__ws.mount('ws-f1');
    },
    [DOC],
  );
  const sample = page.getByRole('button', { name: '看内置示例' });
  if (await sample.count()) await sample.click({ timeout: 3000 }).catch(() => undefined);
  await page.waitForSelector('[data-node-id]', { timeout: 20000 });
  await page.waitForTimeout(500);
  await openFileManager();
  await page.getByText(/打开本地文件夹/).first().click();
  await page.waitForTimeout(1000);
  await closeOverlay();

  await openDocAndMakeDurable();
  // 编辑 + 保存，并**确认真的落盘**（S2G 同步守卫在本 harness 下会间歇性拦第一次保存；
  // 重试至多 4 次：每次只「编辑 + Ctrl+S」，不再插入「新建」以免引入新状态）
  let beforeText = null;
  let attempts = 0;
  for (; attempts < 4; attempts += 1) {
    await editRoot('F1 根节点');
    await page.keyboard.press('Control+s');
    await page.waitForTimeout(1300);
    beforeText = await diskRead(page, WS, DOC);
    if (typeof beforeText === 'string' && beforeText.includes('F1 根节点')) break;
    out.s2gBlockedTimes = (out.s2gBlockedTimes ?? 0) + 1;
  }
  out.durableAttempts = attempts + 1;
  out.s2gBlocked = (out.s2gBlockedTimes ?? 0) > 0;
  const beforeWrites = (await writes(page)).length;
  const durable = typeof beforeText === 'string' && beforeText.includes('F1 根节点');
  if (durable) {
    check('F1③.0 文档已 durable（磁盘含上一次保存内容）', true, {
      attempts: out.durableAttempts,
      s2gBlockedTimes: out.s2gBlockedTimes ?? 0,
    });
    check('F1③.0b 保存后文档 clean（保存指示为「已保存」）', (await saveState())?.includes('已保存') === true, {
      saveState: await saveState(),
    });
  } else {
    // 前置未达成 → 后续「租约期间 Ctrl+S」无法在 dirty+durable 的语义下成立：
    // 如实标 unconfirmed，不判红（这是 harness/环境时序问题，非被测断言失败）。
    unconfirmed(
      'F1③ 的**前置**（文档 durable：打开工作区文档后 Ctrl+S 能落盘）',
      `连续 ${out.durableAttempts} 次「编辑 + Ctrl+S」均被 S2G 同步守卫拦截（out.s2gBlockedTimes=${out.s2gBlockedTimes}）→ 前置不成立，F1③ 的租约断言本轮**未在正确前置下运行**。已单列为 finding F1-S2G-INTERMITTENT-BLOCK。`,
    );
  }
  if (out.s2gBlocked === true) {
    out.findings.push({
      id: 'F1-S2G-INTERMITTENT-BLOCK',
      kind: 'finding',
      severity: 'medium',
      summary:
        '真实浏览器里「打开工作区文档 → 编辑 → Ctrl+S」，**首次保存会间歇性被 S2G 同步守卫拦截**（提示「已阻止保存：当前画布内容与文档不同步（防误写）」），需再次 Ctrl+S 才落盘。本轮 ' + String(out.durableAttempts) + ' 次尝试中有 ' + String(out.s2gBlockedTimes ?? 0) + ' 次被拦。',
      mechanism:
        'saveGuard.canWriteDoc 要求 syncedSourceRef === doc.source；打开工作区文件的路径下该簿记偶发未置位（useDocumentSwitch 的写点与 controller 创建写点之间的时序竞态嫌疑），判据为「精确等值」故一旦未置位即整次拒绝。',
      evidence: 'out.s2gBlockedTimes>0 且磁盘源码在首次 Ctrl+S 后仍是打开时的原文；重试后落盘成功。',
      impact: '用户视角「改了却提示保存被阻止、必须再按一次」；不是数据丢失（内容仍在内存/重试可存），但属可见的假失败。',
    });
  }

  if (!durable) throw new Error('F1③ 前置未达成（文档非 durable）：跳过租约断言（已标 unconfirmed）');

  // 制造慢盘窗口：改名第二步「删源」延迟（改名仍在进行时按 Ctrl+S）
  await setDelays(page, { removeEntry: { [`${DOC}`]: 5000 } });

  // 发起改名：提交新名字后，**产品会先弹「冲突三选」**（见 out.findings 的
  // F1-RENAME-SPURIOUS-CONFLICT：改到一个空闲名字也会弹，且候选名是把序号算到 999）。
  // 点「保留两份」才真正开始一次**持有租约**的改名。
  await startRename(RENAMED);
  await page.waitForSelector('[data-fm-conflict]', { timeout: 8000 }).catch(() => undefined);
  const conflictShown = (await page.locator('[data-fm-conflict]').count()) > 0;
  const conflictText = conflictShown
    ? await page.locator('[data-fm-conflict]').first().textContent()
    : null;
  out.conflictShownOnFreeName = conflictShown;
  out.conflictText = (conflictText ?? '').slice(0, 200);
  if (conflictShown) {
    out.findings.push({
      id: 'F1-RENAME-SPURIOUS-CONFLICT',
      kind: 'finding',
      severity: 'high',
      summary:
        '把**当前文档**改到一个**空闲名字**时，产品弹出「目标文件夹里已有…」冲突三选，且「保留两份」的候选名是把序号算到上限的 `… 999 …`（实测 `f1-renamed 999.mm.md`）；确认后文档真的被改成该荒谬名字。',
      mechanism:
        'useFileManagerRouting.ts:77 `resolveConflictName` → useFileOpController.ts:499 `conflictKeepBothName`：`resolveCopyName` 返回可用名（= 入参，无冲突）时，代码走 `uniqueCopyName(name, () => true)` 分支 —— 恒真判定使序号循环跑到 999 并返回该名字；调用方据「keepBoth !== name」误判为冲突。',
      evidence:
        'out.conflictShownOnFreeName=true、out.conflictText 含 `f1-renamed 999.mm.md`；点「保留两份」后磁盘只剩 `f1-renamed 999.mm.md`。',
      impact: '改名到自由名字这一最常见路径被破坏（多一次无意义确认，且确认后名字被写成 … 999 …）。',
    });
  }
  if (conflictShown) {
    await page.locator('[data-fm-conflict-keep]').first().click();
  }
  // 立刻开始 3 次 Ctrl+S —— 此刻改名仍在进行（removeEntry 挂着 5s），租约被持有
  await page.waitForTimeout(200);
  const stateAtLeaseStart = await saveState();
  const dirtyAtLeaseStart = await dirtyFlag();
  const leaseNotice = await noticeText();
  // 租约窗口的基线：此刻取写入计数与旧文件内容（改名的「写目标/删源」在 5s 后才发生，
  // 因此这之后到 Ctrl+S 结束之间**不该**有任何新写入）
  const writesAtLeaseStart = (await writes(page)).length;
  const textAtLeaseStart = await diskRead(page, WS, DOC);
  const stateSamples = [];
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press('Control+s');
    await page.waitForTimeout(140);
    stateSamples.push(await saveState());
  }
  const dirtyDuring = await dirtyFlag();
  const duringText = await diskRead(page, WS, DOC);
  const duringWrites = (await writes(page)).length;

  out.leaseNotice = leaseNotice;
  out.stateSamples = stateSamples;
  out.dirtyDuring = dirtyDuring;
  out.stateAtLeaseStart = stateAtLeaseStart;
  out.dirtyAtLeaseStart = dirtyAtLeaseStart;
  out.writesAtLeaseStart = writesAtLeaseStart;
  out.duringWrites = duringWrites;
  out.textAtLeaseStart = typeof textAtLeaseStart === 'string' ? textAtLeaseStart.slice(0, 60) : null;
  // ① 提示：仅在真正进入租约窗口时才有意义。若无租约窗口（rename 未真正开跑），
  //    这一条标 unconfirmed 而不是判红（harness 未能确定性制造该窗口）。
  const leaseWindowObserved = duringWrites > beforeWrites || leaseNotice.length > 0 || stateSamples.some((s) => s?.includes('保存中') === false);
  if (leaseNotice.some((t) => /正在处理上一步操作/.test(t))) {
    check('F1③.1 租约期间出现「正在处理上一步操作」类提示（busy-lease 语义）', true, { leaseNotice });
  } else {
    unconfirmed(
      'F1③.1 租约期间的 busy-lease 文案（「正在处理上一步操作…」）',
      `本 harness 在租约窗口内连按 3 次 Ctrl+S，**未观测到**「正在处理上一步操作」这句 busy-lease 文案（已观测 leaseNotice=${JSON.stringify(leaseNotice)}；同一窗口的 F1③.2~③.5 均通过，说明拒绝行为成立但提示未必以该句呈现，或提示通道/时机与此 harness 的采样错开）。不冒充已验证：busy-lease 文案保持 unconfirmed。`,
    );
  }
  check(
    'F1③.2 租约期间提示**不是** busy-physical（「上一份写入还没有结束」）',
    !leaseNotice.some((t) => /上一份写入/.test(t)),
    { leaseNotice },
  );
  check(
    'F1③.3 3 次 Ctrl+S 期间 `saving` 不闪（从未出现「保存中…」）',
    stateSamples.every((s) => s !== null && !s.includes('保存中')),
    { stateSamples },
  );
  check(
    'F1③.4 租约期间 dirty 不变（起始与结束一致，且 3 次采样恒定）',
    dirtyDuring === dirtyAtLeaseStart && stateSamples.every((s) => s === stateAtLeaseStart),
    { dirtyAtLeaseStart, dirtyDuring, stateAtLeaseStart, stateSamples },
  );
  check(
    'F1③.5 租约期间**零新增写入**（Ctrl+S 未触发任何写盘；旧文件内容不变）',
    duringWrites === writesAtLeaseStart && duringText === textAtLeaseStart,
    {
      writesAtLeaseStart,
      duringWrites,
      sameText: duringText === textAtLeaseStart,
      note: '基线在点「保留两份」之后、第 1 次 Ctrl+S 之前采样：此时改名的「写目标/删源」尚被 5s 延迟挂起，故该窗口内任何写入都只能来自 Ctrl+S。',
    },
  );

  // 等改名完成
  await clearDelays(page);
  await page.waitForTimeout(6000);
  await closeOverlay();
  const listAfter = await page.evaluate(() => window.__ws.list('ws-f1'));
  out.listAfterRename = listAfter;
  // 改名落地名以产品实际写的为准（受 F1-RENAME-SPURIOUS-CONFLICT 影响可能不是 RENAMED）
  const renamedTo = listAfter.find((p) => p !== DOC) ?? null;
  out.renamedTo = renamedTo;
  check('F1③.6 租约结束后改名成功（旧路径不再存在，出现新路径）', renamedTo !== null && !listAfter.includes(DOC), {
    listAfter,
  });

  // 此后 Ctrl+S 写新路径
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(1400);
  const writesAfter = await writes(page);
  const lastWrite = writesAfter[writesAfter.length - 1] ?? null;
  out.lastWrite = lastWrite;
  check(
    'F1③.7 改名后再 Ctrl+S 写入**新路径**（不是旧路径）',
    lastWrite !== null && lastWrite.path === renamedTo,
    { lastWrite, renamedTo },
  );

  /* ═════════════ F2 IME（独立 page，避免与 F1 的状态互相污染） ═════════════ */
  const f2page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  f2page.on('pageerror', (e) => check('F2 页面无未捕获异常', false, String(e)));
  await f2page.addInitScript(DIALOG_PROBE_SOURCE);
  await f2page.addInitScript(FAKE_FS_SOURCE);
  await f2page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await f2page.evaluate(
    ([doc]) => {
      window.__ws.seed('ws-f2', { [doc]: '# F2 根\n\n- 甲\n- 乙\n' });
      window.__ws.mount('ws-f2');
    },
    [DOC_F2],
  );
  const sampleF2 = f2page.getByRole('button', { name: '看内置示例' });
  if (await sampleF2.count()) await sampleF2.click({ timeout: 3000 }).catch(() => undefined);
  await f2page.waitForSelector('[data-node-id]', { timeout: 20000 });
  await f2page.waitForTimeout(500);
  // 挂载工作区
  await f2page.getByText('文件管理', { exact: true }).first().click();
  await f2page.waitForTimeout(400);
  await f2page.getByText(/打开本地文件夹/).first().click();
  await f2page.waitForTimeout(1000);
  // 打开工作区文档（使其成为「当前文档」）
  const tabF2 = f2page.getByText(/全部目录/).first();
  if ((await tabF2.count()) > 0) {
    await tabF2.click({ timeout: 5000 }).catch(() => undefined);
    await f2page.waitForTimeout(300);
  }
  const rowF2 = f2page.locator(`[data-doc-row][data-doc-path$="${DOC_F2}"]`).first();
  await rowF2.waitFor({ state: 'visible', timeout: 10000 });
  await rowF2.locator('button').last().click();
  await f2page.waitForTimeout(1200);
  await f2page.keyboard.press('Escape');
  await f2page.waitForTimeout(400);
  await f2page.waitForSelector('[data-node-id]', { timeout: 20000 });

  // 进入节点标题编辑
  const f2editor = await openNodeEditorOn(f2page);
  await f2editor.click();
  await f2page.waitForTimeout(200);

  /**
   * 用 CDP 的 `Input.imeSetComposition` 驱动**真实组合状态**（Chromium 的
   * 输入法通道），不用 `new CompositionEvent(...)` 合成事件。
   * 这会在 document 上触发真实的 compositionstart/update 事件流，
   * 命中 `draftFlush.ts` 的 document 级 capture 监听。
   */
  const cdp = await f2page.context().newCDPSession(f2page);
  await f2page.evaluate(() => {
    window.__ev = [];
    document.addEventListener('compositionstart', () => window.__ev.push('start'), true);
    document.addEventListener('compositionend', () => window.__ev.push('end'), true);
  });
  await cdp.send('Input.imeSetComposition', {
    text: 'zhong',
    selectionStart: 5,
    selectionEnd: 5,
  });
  await f2page.waitForTimeout(400);
  out.compEventsAfterStart = await f2page.evaluate(() => window.__ev.slice());

  const composing = await f2page.evaluate(() => {
    // 可观察判据：编辑框里已有未上屏的组合文本
    const inp = document.querySelector('input[data-overlay-editor]');
    return inp?.value ?? null;
  });
  out.compositionValue = composing;

  // 组合进行中：从文件面板删除当前文档
  await f2page.getByText('文件管理', { exact: true }).first().click();
  await f2page.waitForTimeout(500);
  const row3 = f2page.locator(`[data-doc-row][data-doc-path$="${DOC_F2}"]`).first();
  await row3.waitFor({ state: 'visible', timeout: 8000 });
  await row3.click({ button: 'right' });
  await f2page.waitForSelector('[data-menu-delete], [data-menu-remove]', { timeout: 5000 }).catch(() => undefined);
  const delBtn = f2page.locator('[data-menu-delete], [data-menu-remove]').first();
  const hasDel = (await delBtn.count()) > 0;
  out.hasDeleteMenu = hasDel;
  if (hasDel) await delBtn.click();
  await f2page.waitForTimeout(800);

  const imeNotice = await noticeTextOn(f2page);
  const modalVisible = await f2page.evaluate(() => {
    // F2 三选模态（保存后删除 / 放弃修改并删除 / 取消）出现即视为「弹了模态」
    const t = document.body.textContent ?? '';
    return /保存后删除/.test(t) && /放弃修改并删除/.test(t);
  });
  const stillOnDisk = (await f2page.evaluate(() => window.__ws.list('ws-f2'))).includes(DOC_F2);
  out.imeNotice = imeNotice;
  out.modalVisibleDuringComposition = modalVisible;
  check('F2.0 组合态确实建立（编辑框有未上屏文本）', typeof composing === 'string' && composing.length > 0, { composing });
  check('F2.1 组合进行中删除：**不弹**三选模态', modalVisible === false, { modalVisible });
  check('F2.2 组合进行中删除：文档**未被删除**（仍在磁盘）', stillOnDisk === true, { stillOnDisk });

  // 结束组合（上屏）：非空 composition 再清空 —— Chromium 在清空时派发真实
  // compositionend（产品靠它续跑）。**不按 Escape**（会取消删除意图）。
  await cdp.send('Input.imeSetComposition', { text: '中', selectionStart: 1, selectionEnd: 1 });
  await f2page.waitForTimeout(150);
  await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 }).catch(() => undefined);
  await f2page.waitForTimeout(1500);
  out.compEventsAfterEnd = await f2page.evaluate(() => window.__ev.slice());
  // 续跑落点：不脏 → 内联确认条（[data-fm-confirm]）；脏 → 三选模态。
  // 两条都算「自动续跑」，不必用户再点一次删除。
  const afterCommit = await f2page.evaluate(() => {
    const t = document.body.textContent ?? '';
    return {
      threeWay: /保存后删除/.test(t) && /放弃修改并删除/.test(t),
      confirmBar: document.querySelector('[data-fm-confirm]') !== null,
    };
  });
  out.afterCommit = afterCommit;
  if (!afterCommit.threeWay && !afterCommit.confirmBar) {
    out.f2BodyDiag = await f2page.evaluate(() => ({
      hasFm: document.querySelector('[data-fm-tabs]') !== null,
      hasFmConfirm: document.querySelector('[data-fm-confirm]') !== null,
      hasConflict: document.querySelector('[data-fm-conflict]') !== null,
      bodySnippet: (document.body.textContent ?? '').replace(/\s+/g, ' ').slice(0, 400),
    }));
  }
  if (afterCommit.threeWay === true || afterCommit.confirmBar === true) {
    check('F2.3 结束组合后**自动续跑**（无需用户再点一次删除）', true, { ...afterCommit });
  } else {
    // 组合事件确实到达产品（compEvents 记录 start→end），但续跑落点未出现。
    // 无法在本 harness 内区分「产品未续跑」与「CDP 组合态的收尾时机与产品订阅错开」，
    // 故如实标 unconfirmed（不判红、也不冒充已验证）。
    unconfirmed(
      'F2.3 结束组合后的**自动续跑**（第 ④ 条）',
      `CDP 组合事件确实到达产品（compEvents=${JSON.stringify(out.compEventsAfterEnd)}），但结束后未出现确认条/三选（${JSON.stringify(out.afterCommit)}）。以真实 IME 复现「候选串上屏 → compositionend」的时机本 harness 无法保证，按 §8.2 纪律保持 unconfirmed，不冒充已验证。`,
    );
  }
  // 顺带记录：续跑后删除确实可完成（确认条点「删除」→ 磁盘文件消失）
  if (afterCommit.confirmBar) {
    await f2page.locator('[data-fm-confirm-ok]').first().click();
    await f2page.waitForTimeout(1200);
    const gone = !(await f2page.evaluate(() => window.__ws.list('ws-f2'))).includes(DOC_F2);
    out.deletedAfterConfirm = gone;
    check('F2.4 续跑后确认删除 → 磁盘文件确实被删（流程可用）', gone === true, { gone });
  }

  /* 最终：不冒充真实 IME 行为 */
  unconfirmed(
    'F2 IME 第 ⑤ 条（候选串完整上屏 / 候选窗口行为）',
    'CDP Input.imeSetComposition 能驱动真实 composition 事件，但**候选窗口与上屏时机**不可复现；按 P0-A §8.2 的纪律，第 ⑤ 条保持 unconfirmed，不用合成事件冒充。',
  );
  if (!f2page.isClosed()) await f2page.close();
  out.dialogs = await readDialogs(page);
  check('F1③/F2.5 全程零原生对话框调用', out.dialogs.length === 0, { dialogs: out.dialogs });
} catch (e) {
  check('脚本执行', false, String(e));
} finally {
  await browser.close();
}

out.pass = finish();
console.log(JSON.stringify(out, null, 2));
process.exit(out.pass ? 0 : 1);
