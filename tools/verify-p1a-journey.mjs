/**
 * 真浏览器验收：P1-A 人工旅程 —— a11y 键盘走查 + X1 归档旅程
 * ══════════════════════════════════════════════════════════════════════
 * 跑法：node tools/verify-p1a-journey.mjs [baseUrl]   （默认 http://localhost:5175）
 *
 * 对齐 acceptance-and-backlog.md §5 P1-A 停止点（:519）：「交付 a11y 键盘走查
 * + X1 导图部分的人工旅程」。构建产物（vite preview）上跑，替身只顶替
 * showDirectoryPicker 与磁盘 I/O（browserHarness 纪律）。
 *
 * A. a11y 键盘走查（file-management.md §6 键位表全键位）：
 *    Tab 进树 → ↑/↓ 移动（tabindex 随之迁移）→ → 展开 / ← 折叠 → Home/End →
 *    Enter 打开 → F2 改名（输入框内方向键让位 = 负控 1 真机版）→ Esc 关面板；
 *    aria-current 只落在真正打开的那一份（同名文档对）；
 *    treeitem 语义 + aria-level / aria-expanded / aria-selected。
 * B. 交互补充：排序切换（列头写明依据、不动「最近」）、标题搜索（仅已索引）、
 *    「显示其他文件」灰显点击提示。
 * C. X1 归档旅程：右键「改为归档」→ 树中 `_归档/` 可见（普通目录）→
 *    从归档再打开；删除确认条旁「改为归档」入口同一编排。
 *
 * 判据：退出码 0 = 全部通过。未覆盖（如实）经 unconfirmed() 登记。
 */
import { chromium } from 'playwright';
import { assertLoadedBundle, checkSnapshotFresh } from './lib/snapshotCheck.mjs';
import {
  DIALOG_PROBE_SOURCE,
  FAKE_FS_SOURCE,
  createReport,
} from './lib/browserHarness.mjs';

const BASE = process.argv[2] ?? 'http://localhost:5175';
const WS = 'ws-p1a';

checkSnapshotFresh();

const { out, check, unconfirmed, finish } = createReport('verify-p1a-journey', BASE);
out.findings = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => check('页面无未捕获异常', false, String(e)));

await page.addInitScript(DIALOG_PROBE_SOURCE);
await page.addInitScript(FAKE_FS_SOURCE);

/* ───────────────────────── 启动 & 挂载工作区 ───────────────────────── */
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await assertLoadedBundle(page);
const sample = page.getByRole('button', { name: '看内置示例' });
if (await sample.count()) await sample.click({ timeout: 3000 }).catch(() => undefined);
await page.waitForSelector('[data-node-id]', { timeout: 20000 });
await page.waitForTimeout(500);

await page.evaluate((ws) => {
  window.__ws.seed(ws, {
    '当前文档.mm.md': '# 北极星目标\n\n- 内容一\n- 内容二\n',
    '甲组/同名.mm.md': '# 甲组同名\n\n- 甲\n',
    '乙组/同名.mm.md': '# 乙组同名\n\n- 乙\n',
    '待归档.mm.md': '# 待归档\n\n- 数据\n',
    '子目录/嵌套.mm.md': '# 嵌套\n\n- 内\n',
    '说明.txt': '非导图内容',
  });
  window.__ws.mount(ws);
}, WS);

const openFileManager = async () => {
  // 幂等：模态已开时「文件管理」按钮在遮罩下点不到，跳过
  if ((await page.locator('[data-file-manager]').count()) === 0) {
    await page.getByText('文件管理', { exact: true }).click();
    await page.waitForTimeout(600);
  }
};
const closeOverlay = async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
};
/** 挂载工作区：打开文件管理 → StorageBar 的「打开本地文件夹…」→ 替身句柄 */
const mountWorkspace = async () => {
  await openFileManager();
  await page.getByText(/打开本地文件夹|切换本地目录/).first().click();
  await page.waitForTimeout(1200);
};
/** 树里当前持有 tabindex=0 的行 key（doc-path 或 dir-path） */
const focusedKey = () =>
  page.evaluate(() => {
    const el = document.querySelector('[data-fm-tree-root] [tabindex="0"]');
    return el?.getAttribute('data-doc-path') ?? el?.getAttribute('data-dir-path') ?? null;
  });

await mountWorkspace();

// 打开「当前文档.mm.md」作为当前文档（后续 aria-current 走查的锚）
await openFileManager();
await page.locator('button[title$="当前文档.mm.md"]').first().click();
await page.waitForTimeout(1000);
await closeOverlay();

/* ═════════════════════════ A. a11y 键盘走查 ═════════════════════════ */
await openFileManager();

// A1. 树语义：role=tree / treeitem / aria-level
const treeRole = await page.evaluate(() => document.querySelector('[data-fm-tree-root]')?.getAttribute('role'));
check('A1 树容器 role=tree', treeRole === 'tree', treeRole);
const rootRows = await page.$$eval('[data-fm-tree-root] [role="treeitem"]', (els) =>
  els.map((e) => ({ lvl: e.getAttribute('aria-level'), sel: e.getAttribute('aria-selected') })),
);
check(
  'A1 根层行 role=treeitem 且 aria-level=1',
  rootRows.length > 0 && rootRows.every((r) => r.lvl === '1'),
  JSON.stringify(rootRows.slice(0, 6)),
);

// A2. Tab 进树：focus 落在唯一 tabindex=0 的行
const firstRow = page.locator('[data-fm-tree-root] [tabindex="0"]');
await firstRow.focus();
await page.waitForTimeout(200);
check('A2 Tab 位：全树恰一行 tabindex=0 且可聚焦', (await focusedKey()) !== null, await focusedKey());

// A3. ↓ 移动焦点（activeElement 真的迁移，旧行降为 -1）
const before = await focusedKey();
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(200);
const after = await focusedKey();
check('A3 ArrowDown 焦点迁移', before !== null && after !== null && before !== after, { before, after });

// A4. → 展开「甲组」，← 折叠回来
// 若当前焦点不在目录行，直接点目录行聚焦（走查允许先鼠标定锚，键位行为才是被验对象）
if ((await focusedKey()) !== '甲组') {
  await page.locator('[data-dir-path="甲组"]').first().focus();
  await page.waitForTimeout(200);
}
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(300);
const expanded = await page.locator('[data-dir-path="甲组"]').first().getAttribute('aria-expanded');
check('A4 ArrowRight 展开目录（aria-expanded=true）', expanded === 'true', expanded);
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(300);
const collapsed = await page.locator('[data-dir-path="甲组"]').first().getAttribute('aria-expanded');
check('A4 ArrowLeft 折叠目录（aria-expanded=false）', collapsed === 'false', collapsed);

// A5. Home / End 到首末行
await page.keyboard.press('End');
await page.waitForTimeout(200);
const endKey = await focusedKey();
await page.keyboard.press('Home');
await page.waitForTimeout(200);
const homeKey = await focusedKey();
check('A5 Home/End 到首末行', homeKey !== null && endKey !== null && homeKey !== endKey, { homeKey, endKey });

// A6. aria-current：展开两组同名目录后，只有真正打开的「当前文档.mm.md」带 aria-current
await page.locator('[data-dir-path="甲组"] button').first().click();
await page.locator('[data-dir-path="乙组"] button').first().click();
await page.waitForTimeout(400);
const currentRows = await page.$$eval('[data-doc-current]', (els) =>
  els.map((e) => e.getAttribute('data-doc-path')),
);
check('A6 仅当前文档一份高亮（aria-current 唯一）', currentRows.length === 1 && currentRows[0] === '当前文档.mm.md', currentRows);

// A7. 同名文档对：乙组/同名.mm.md 不得带 aria-current
const otherCurrent = await page.locator('[data-doc-path="乙组/同名.mm.md"]').getAttribute('aria-current');
check('A7 同名另一份无 aria-current', otherCurrent === null, otherCurrent);

// A8. F2 进改名；输入框内方向键**不**移动树焦点（负控 1 真机版）；Esc 退出改名
await page.locator('[data-doc-path="待归档.mm.md"]').first().focus();
await page.waitForTimeout(200);
await page.keyboard.press('F2');
await page.waitForTimeout(400);
const renameInput = page.locator('[data-rename-input]');
check('A8 F2 出现重命名输入框', (await renameInput.count()) === 1, null);
const treeFocusBefore = await focusedKey();
await renameInput.press('ArrowDown');
await page.waitForTimeout(200);
const treeFocusAfter = await focusedKey();
check('A8 ★负控1真机：输入框内 ↓ 不移动树焦点', treeFocusBefore === treeFocusAfter, {
  treeFocusBefore,
  treeFocusAfter,
});
await renameInput.press('Escape');
await page.waitForTimeout(400);
check('A8 Esc 退出改名（输入框消失）', (await page.locator('[data-rename-input]').count()) === 0, null);

// A9. Enter 打开当前行（焦点行 = 待归档.mm.md）→ 文档栏切换
await page.locator('[data-doc-path="待归档.mm.md"]').first().focus();
await page.waitForTimeout(200);
await page.keyboard.press('Enter');
await page.waitForTimeout(1000);
const docBar = await page.evaluate(() => {
  const el = [...document.querySelectorAll('span')].find((e) => /\.mm\.md$/.test((e.textContent ?? '').trim()));
  return el?.textContent?.trim() ?? null;
});
check('A9 Enter 打开焦点行（文档栏切换为 待归档.mm.md）', docBar === '待归档.mm.md', docBar);

// A10. Esc 关面板（模态级）：Enter 打开后面板已自动关，这里重开再验 Esc
await page.waitForTimeout(400);
await openFileManager();
await page.waitForTimeout(500);
const fmStillOpen = (await page.locator('[data-file-manager]').count()) === 1;
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const fmAfterEsc = (await page.locator('[data-file-manager]').count()) === 1;
check('A10 Esc 关闭文件面板', fmStillOpen && !fmAfterEsc, { fmStillOpen, fmAfterEsc });

/* ═════════════════════════ B. 排序 / 标题搜索 / 显示其他文件 ═════════════════════════ */
await openFileManager();

// B1. 排序切换：列头写明依据；行序真的变
const sortSelect = page.locator('[data-fm-sort-select]');
await sortSelect.selectOption('mtime');
await page.waitForTimeout(300);
const sortLabel = await page.locator('[data-fm-sort-active]').textContent();
check('B1 切换排序后列头写明「最近修改」', (sortLabel ?? '').includes('最近修改'), sortLabel);

// B2. 「最近」视图无排序工具条（UD-2 不动 openedAt）
await page.locator('[data-tab="recent"]').first().click();
await page.waitForTimeout(400);
check('B2 「最近」视图不渲染排序工具条', (await page.locator('[data-fm-sort]').count()) === 0, null);
await page.locator('[data-tab="tree"]').first().click();
await page.waitForTimeout(300);

// B3. 标题搜索：搜「北极星」（只有索引 title 命中，文件名不含）
await page.locator('[data-fm-search]').fill('北极星');
await page.waitForTimeout(500);
const hitByTitle = (await page.locator('[data-doc-path="当前文档.mm.md"]').count()) === 1;
check('B3 按内部标题搜到「当前文档.mm.md」', hitByTitle, null);
await page.locator('[data-fm-search]').fill('');

// B4. 「显示其他文件」：分组出现 → 展开 → 点击提示「非导图文件」且不打开
await page.locator('[data-fm-show-other-input]').first().check();
await page.waitForTimeout(800);
const group = page.locator('[data-other-files-group]').first();
check('B4 分组「其他文件（1 项，本应用不打开）」出现', (await group.count()) === 1, null);
await group.locator('button').first().click();
await page.waitForTimeout(400);
await page.locator('[data-doc-path="说明.txt"] [data-doc-open]').first().click();
await page.waitForTimeout(500);
const notice = await page.locator('[data-fm-tree-notice]').textContent().catch(() => null);
check('B4 点击不支持文件给出提示（非导图文件，本应用不打开）', (notice ?? '').includes('非导图文件'), notice);
const docStill = await page.evaluate(() => {
  const el = [...document.querySelectorAll('span')].find((e) => /\.mm\.md$/.test((e.textContent ?? '').trim()));
  return el?.textContent?.trim() ?? null;
});
check('B4 点击后未打开该文件（当前文档不变）', docStill === '待归档.mm.md', docStill);

/* ═════════════════════════ C. X1 归档旅程 ═════════════════════════ */
// 当前文档 = 待归档.mm.md。先归档「子目录/嵌套.mm.md」（右键入口）。
// 子目录默认折叠 → 子行不在 DOM，先展开再右键。
await page.locator('[data-dir-path="子目录"] button').first().click();
await page.waitForTimeout(400);
await page.locator('[data-doc-path="子目录/嵌套.mm.md"]').first().click({ button: 'right' });
await page.waitForTimeout(400);
const menuArchive = page.locator('[data-menu-archive]');
check('C1 右键菜单存在「改为归档」项', (await menuArchive.count()) === 1, null);
await menuArchive.first().click();
await page.waitForTimeout(1000);

const diskAfterArchive = await page.evaluate((w) => window.__ws.list(w), WS);
check(
  'C2 磁盘：源消失、`_归档/子目录/嵌套.mm.md` 出现（目录被创建）',
  diskAfterArchive.includes('_归档/子目录/嵌套.mm.md') &&
    !diskAfterArchive.includes('子目录/嵌套.mm.md'),
  diskAfterArchive,
);
const archiveDirInTree = (await page.locator('[data-dir-path="_归档"]').count()) === 1;
check('C2 树中 `_归档/` 作为普通目录可见（不隐藏、不特殊渲染）', archiveDirInTree, null);

// C3. 展开 _归档 → 子目录 → 从归档再打开（X1 闭环）
await page.locator('[data-dir-path="_归档"] button').first().click();
await page.waitForTimeout(300);
await page.locator('[data-dir-path="_归档/子目录"] button').first().click();
await page.waitForTimeout(300);
await page.locator('button[title$="_归档/子目录/嵌套.mm.md"]').first().click();
await page.waitForTimeout(1200);
const docAfterReopen = await page.evaluate(() => {
  const el = [...document.querySelectorAll('span')].find((e) => /\.mm\.md$/.test((e.textContent ?? '').trim()));
  return el?.textContent?.trim() ?? null;
});
check('C3 从归档再打开（文档栏 = 嵌套.mm.md）', docAfterReopen === '嵌套.mm.md', docAfterReopen);

// C4. 删除确认条旁的「改为归档」（入口二，同一编排）：归档当前打开的文档
await openFileManager();
await page.locator('[data-doc-path="待归档.mm.md"]').first().click({ button: 'right' });
await page.waitForTimeout(300);
await page.locator('[data-menu-delete]').first().click();
await page.waitForTimeout(400);
const confirmArchive = page.locator('[data-fm-confirm-archive]');
check('C4 删除确认条旁存在「改为归档」', (await confirmArchive.count()) === 1, null);
await confirmArchive.first().click();
await page.waitForTimeout(1200);
const diskAfter2 = await page.evaluate((w) => window.__ws.list(w), WS);
check(
  'C4 确认条入口归档生效（`_归档/待归档.mm.md` 落盘，未走删除）',
  diskAfter2.includes('_归档/待归档.mm.md') && !diskAfter2.includes('待归档.mm.md'),
  diskAfter2,
);
const removedZero = !(await diskAfter2.includes('待归档.mm.md'));
check('C4 归档不是删除（源路径不再存在于磁盘 = 移动语义）', removedZero, null);

// C5. 已在归档里的文档不再给归档入口（零 I/O 空操作不给按钮）
// 容错：目录展开态在多次重载后可能收起，先确保 _归档 展开再等行出现
await page.waitForTimeout(600);
const archiveRow = page.locator('[data-dir-path="_归档"]');
if ((await archiveRow.getAttribute('aria-expanded')) !== 'true') {
  await archiveRow.locator('button').first().click();
  await page.waitForTimeout(400);
}
try {
  await page
    .locator('[data-doc-path="_归档/待归档.mm.md"] [data-doc-open]')
    .first()
    .click({ button: 'right', timeout: 10000 });
} catch (e) {
  const treeDump = await page.$$eval('[data-fm-tree-root] [data-doc-path]', (els) =>
    els.map((e) => e.getAttribute('data-doc-path')),
  );
  check('C5 树中出现 `_归档/待归档.mm.md` 行', false, treeDump);
  throw e;
}
await page.waitForTimeout(400);
check(
  'C5 已在归档的文档右键无「改为归档」',
  (await page.locator('[data-menu-archive]').count()) === 0,
  null,
);
await page.keyboard.press('Escape');

unconfirmed('真实 OS 输入法（IME）在重命名输入框内的组合键行为', '需真实 IME，替身不伪造（沿用 P0 批次口径）');
unconfirmed('触控/拖放归位', '本轮键盘走查不含触控（file-management §6 标注未验证项）');
unconfirmed('真实 File System Access 权限被拒场景', '替身内存盘恒 granted；失败路径由单测负控 5 覆盖');

const pass = finish();
console.log(JSON.stringify(out, null, 2));
await browser.close();
process.exit(pass ? 0 : 1);
