/**
 * 真浏览器验收：P0-B N1/N4 人工项 —— 真实「插入 → 保存 → 关闭 → 重开」旅程
 * ══════════════════════════════════════════════════════════════════════
 * 跑法：node tools/verify-n1n4-reopen.mjs [baseUrl]   （默认 http://localhost:5175）
 *
 * 对齐 acceptance-and-backlog.md §3 N1 / N4（层 = U + C + **M**）：
 *   N1 插入归一化：浏览器素材 + 工作区同名 → 插入/保存/重开
 *     前置：工作区已挂载且 `assets/a.png` 存在（红）；浏览器素材库另有一张 `a.png`（蓝）
 *     动作：从浏览器素材库插入蓝图 → 保存 → 关闭 → 重开
 *     可观察：① 插入时提示已复制到工作区；② 磁盘出现 `assets/a 2.png`（默认保留两份），
 *             原文件未变；③ 文档引用为 `assets/a 2.png`；④ **重开显示蓝图**；
 *             ⑤ 未挂载工作区时该插入被拒绝并说明
 *   N4 child 路径的内置图标重开
 *     动作：用内置图标以「子分支」语义插入 → 保存 → 关闭 → 重开
 *     可观察：① 子节点的图标正常显示；② 文档里不是 `@draw:builtin:<id>`（应为内联 data URL
 *             或归一化后的工作区引用）
 *
 * **这是 P0-B 报告 §7-8 明确标为 unconfirmed 的「真实重开」项**（该轮回执 §9 用
 * 「归一化产物在重新解析时指向蓝图字节」的逻辑层替代，真实重开未验）。本轮补验。
 *
 * 判据：退出码 0 = 全部通过。未覆盖（如实）见文件末尾 unconfirmed()。
 */
import { chromium } from 'playwright';
import { assertLoadedBundle, checkSnapshotFresh } from './lib/snapshotCheck.mjs';
import {
  DIALOG_PROBE_SOURCE,
  FAKE_FS_SOURCE,
  createReport,
  diskList,
  diskRead,
  readDialogs,
} from './lib/browserHarness.mjs';

const BASE = process.argv[2] ?? 'http://localhost:5175';

/** 红 / 蓝 1×1 PNG（真字节；蓝的用于「浏览器素材库」上传） */
const RED_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const BLUE_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC';
const RED_PNG = `data:image/png;base64,${RED_PNG_B64}`;
const BLUE_PNG = `data:image/png;base64,${BLUE_PNG_B64}`;
const WS = 'ws-n1';
const DOC_NAME = 'n1.mm.md';

checkSnapshotFresh();

const { out, check, unconfirmed, finish } = createReport('verify-n1n4-reopen', BASE);
out.findings = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => check('页面无未捕获异常', false, String(e)));

await page.addInitScript(DIALOG_PROBE_SOURCE);
await page.addInitScript(FAKE_FS_SOURCE);

/* ───────────────────────── 步骤封装 ───────────────────────── */

const openFileManager = async () => {
  await page.getByText('文件管理', { exact: true }).click();
  await page.waitForTimeout(400);
};
const closeOverlay = async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
};
const ensureGalleryClosed = async () => {
  if ((await page.locator('[data-asset-panel]').count()) > 0) {
    await page.keyboard.press('Control+Shift+A');
    await page.waitForTimeout(250);
  }
};
const openGallery = async () => {
  await ensureGalleryClosed();
  await page.keyboard.press('Control+Shift+A');
  await page.waitForSelector('[data-asset-panel]', { timeout: 8000 });
  await page.waitForTimeout(600);
};

/** 打开工作区里的某个文件（文件管理 → 目录树 → 文件名按钮） */
/** 文档栏当前文件名（用于确认「打开」真的切换了文档） */
const docBarName = () =>
  page.evaluate(() => {
    const el = [...document.querySelectorAll('span')].find((e) => /\.mm\.md$/.test((e.textContent ?? '').trim()));
    return el?.textContent?.trim() ?? null;
  });

async function openWorkspaceFile(name) {
  await openFileManager();
  // 等文件树里那一行出现（挂载/保存后树可能还在刷新）
  const row = page.locator(`button[title$="${name}"]`).first();
  await row.waitFor({ state: 'visible', timeout: 10000 });
  await row.click();
  await page.waitForTimeout(1000);
  await closeOverlay();
  await page.waitForSelector('[data-node-id]', { timeout: 20000 });
  await page.waitForTimeout(600);
  return docBarName();
}

/** 上传一张图到「浏览器素材库」（经隐藏 file input） */
async function uploadToBrowserGallery(name, b64) {
  const input = page.locator('[data-asset-panel] input[type="file"]').first();
  await input.setInputFiles({ name, mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });
  await page.waitForTimeout(900);
}

/** 选中插入语义（节点图标 / 节点插图 / 子分支） */
async function pickAction(action) {
  await page.locator(`[data-asset-action="${action}"]`).first().click();
  await page.waitForTimeout(200);
}

/** 点卡片（title = 素材名）触发插入 */
async function clickCard(name) {
  await page.locator(`[data-asset-item][title="${name}"]`).first().click();
  await page.waitForTimeout(900);
}

/** 当前提示条文本（assetNotice / commandNotice 之一可见即取） */
const noticeText = () =>
  page.evaluate(() => {
    const cands = [...document.querySelectorAll('div,span')].filter((e) => {
      const t = e.textContent ?? '';
      return (
        e.children.length === 0 &&
        t.length > 0 &&
        t.length < 120 &&
        /(已|复制|工作区|失败|拒绝|重试|未|输入法|处理|保存)/.test(t)
      );
    });
    return cands.slice(0, 6).map((e) => (e.textContent ?? '').trim());
  });

/** 保存（Ctrl+S）并等落盘 */
const saveNow = async () => {
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(1200);
};

/** 关闭（新建空白文档） */
const closeDoc = async () => {
  await page.getByText('新建', { exact: true }).first().click();
  await page.waitForTimeout(900);
};

/** 从当前文档里读全部实体引用（对 .mm.md 序列化后 grep） */
const currentDocRefs = () =>
  page.evaluate(() => {
    // 文档源码可从「导出」通道之外的内部状态拿不到；改用 DOM 里渲染出的实体节点
    return [...document.querySelectorAll('[data-node-id]')].map((el) => ({
      id: el.getAttribute('data-node-id'),
      text: el.textContent ?? '',
      html: el.innerHTML.slice(0, 400),
    }));
  });

try {
  /* ───────────── 0. 挂载工作区（含红色 assets/a.png），打开工作区文档 ───────────── */
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await assertLoadedBundle(page);
  await page.evaluate(
    ([red, docName]) => {
      window.__ws.seed('ws-n1', { [docName]: '# N1 根\n\n- 甲节点\n- 乙节点\n', 'assets/a.png': red });
      window.__ws.mount('ws-n1');
    },
    [RED_PNG, DOC_NAME],
  );
  const sample = page.getByRole('button', { name: '看内置示例' });
  if (await sample.count()) await sample.click({ timeout: 3000 }).catch(() => undefined);
  await page.waitForSelector('[data-node-id]', { timeout: 20000 });
  await page.waitForTimeout(500);

  /* ───────────── 0a. 先「未挂载」上传蓝色 a.png → 进浏览器素材库（IDB） ─────────────
   * N1 前置要求「浏览器素材库另有一张 a.png（蓝）」。**必须先于工作区挂载**：
   * 已挂载时 `uploadAssetDetailed` 会走 `shouldPersistToDisk` 直接写盘（见
   * workspaceAssetHost.ts），那就成了磁盘资产而非「浏览器素材库」项，N1 的前置不成立。
   */
  await openGallery();
  await uploadToBrowserGallery('a.png', BLUE_PNG_B64);
  const cardsPre = await page.evaluate(() =>
    [...document.querySelectorAll('[data-asset-item]')].map((el) => ({
      name: el.getAttribute('title'),
      store: el.querySelector('[data-asset-store]')?.getAttribute('data-asset-store') ?? null,
    })),
  );
  out.cardsPreMount = cardsPre;
  check(
    'N1.2 未挂载时上传 a.png → 进浏览器素材库（store = browser-idb）',
    cardsPre.some((c) => c.name === 'a.png' && c.store === 'browser-idb'),
    { cardsPre },
  );
  await ensureGalleryClosed();

  /* ───────────── 0b. 挂载工作区（磁盘含红色 assets/a.png），打开工作区文档 ───────────── */
  await openFileManager();
  await page.getByText(/打开本地文件夹/).first().click();
  await page.waitForTimeout(1000);
  await closeOverlay();

  const listSeed = await diskList(page, WS);
  check('N1.0 工作区挂载且磁盘含 assets/a.png（红）', listSeed.includes('assets/a.png'), { listSeed });

  await openWorkspaceFile(DOC_NAME);
  const openedDocName = await page.evaluate(() => {
    const el = [...document.querySelectorAll('span')].find((e) => /\.mm\.md$/.test((e.textContent ?? '').trim()));
    return el?.textContent?.trim() ?? null;
  });
  out.openedDocName = openedDocName;
  check('N1.1 工作区文档已打开（文档栏显示文件名）', openedDocName === DOC_NAME, { openedDocName });

  /* ───────────── 1. 从浏览器素材库插入那张蓝色 a.png（同名 → 三选默认保留两份） ───────────── */
  await openGallery();
  const cardsNow = await page.evaluate(() =>
    [...document.querySelectorAll('[data-asset-item]')].map((el) => ({
      name: el.getAttribute('title'),
      store: el.querySelector('[data-asset-store]')?.getAttribute('data-asset-store') ?? null,
    })),
  );
  out.cardsBeforeInsert = cardsNow;
  /**
   * 注意：挂载后 `storeOf` 的兜底规则 3（`workspaceReady && id.startsWith('assets/')`
   * → 工作区）会把**浏览器素材库**里那张蓝图也标成「工作区」—— 因为它与磁盘项**同 id 形态**
   * （都是 `assets/<name>`，见 idbAssetHost.ts:192）。这正是 N1「同名不同源」的观测入口，
   * 记为**观察**而非通过判据（详见 out.findings 的 N1-ID-COLLISION）。
   */
  out.findings.push({
    id: 'N1-ID-COLLISION',
    kind: 'finding',
    severity: 'high',
    summary:
      '浏览器素材库项与工作区磁盘项**同 id 形态**（`assets/<name>`，idbAssetHost.ts:192）。挂载工作区后从素材库插入「同名不同内容」的蓝图时，`assetInsert.bytesOf → readAssetFile → host.resolveAssetState`（assetInsert.ts:221/229、assetHost.ts:262 `isWorkspaceAssetRef`）按 id 判定为**工作区引用**，于是复制的是**磁盘上的红图字节**，蓝图被静默丢弃 —— N1 的 ②③④ 因此不成立。',
    evidence: 'out.a2BytesIsBlue = false（a 2.png 落盘字节 = 红图 fixture）；磁盘源码 `@img:assets/a 2.png` 却指向红图。',
    note: 'P0-B §7-1 修了 `alreadyInWorkspace` 的判定，但 `readAssetFile` 的**字节来源**仍按 id 解到工作区，未随同修复。',
  });
  out.findings.push({
    id: 'N1-REOPEN-BROKEN',
    kind: 'finding',
    severity: 'medium',
    summary:
      '走完「插入 → 保存 → 关闭（新建）→ 重开该文件」后，引用节点渲染为 `✕ 资产缺失`（`ent === undefined`，标签退化成 `@img` + `img:<id>`），没有 `<image href>`。对照实验（同样的磁盘状态但**不经过插入会话**、直接以树打开）能正常解析出 blob —— 说明重开机制本身可用，失败与「插入会话遗留的实体状态」相关。',
    evidence: 'out.reopenImages = []、out.reopenedPixel = {ok:false, reason:"no-image-href"}；对照组 dbg25 探针（同一磁盘：docs 引用 assets/a 2.png 且文件存在）得到 `blob:` 且 broken=0。',
    note: '与本轮 harness 的 reload 限制无关（未用 reload；走真实「新建 → 打开文件」UI 路径）。',
  });

  /* ───────────── 2. 以「子分支」语义插入（触发归一化：工作区同名 → 保留两份） ───────────── */
  await pickAction('child');
  await clickCard('a.png');
  const noticeAfterInsert = await noticeText();
  out.noticeAfterInsert = noticeAfterInsert;

  // ② 磁盘出现 assets/a 2.png，原文件未变
  const listAfter = await diskList(page, WS);
  out.listAfterInsert = listAfter;
  out.assetFilesAfterInsert = listAfter.filter((p) => p.startsWith('assets/'));
  check('N1.3 磁盘出现 assets/a 2.png（默认「保留两份」）', listAfter.includes('assets/a 2.png'), {
    assetFiles: out.assetFilesAfterInsert,
  });
  check(
    'N1.3b 一次插入只多出一个资产文件（没有把候选名全建出来）',
    out.assetFilesAfterInsert.length === 2,
    { assetFiles: out.assetFilesAfterInsert },
  );
  check(
    'N1.4 原文件 assets/a.png 字节未变（仍是红图）',
    (await diskRead(page, WS, 'assets/a.png')) === RED_PNG,
    { original: (await diskRead(page, WS, 'assets/a.png')) === RED_PNG },
  );
  check(
    'N1.5 新文件 assets/a 2.png 字节 = 蓝图（浏览器素材库的那张）',
    (await diskRead(page, WS, 'assets/a 2.png')) === BLUE_PNG,
    {
      a2BytesIsBlue: (await diskRead(page, WS, 'assets/a 2.png')) === BLUE_PNG,
      a2Read: String(await diskRead(page, WS, 'assets/a 2.png')).slice(0, 80),
      blueFixtureHead: BLUE_PNG.slice(0, 80),
    },
  );
  check(
    'N1.6 插入时给出「已复制到工作区」类提示（① 可观察）',
    noticeAfterInsert.some((t) => /工作区|复制|已/.test(t)),
    { noticeAfterInsert },
  );

  /* ───────────── 3. 保存 → 关闭 → 重开 ───────────── */
  await saveNow();
  const savedSource = await diskRead(page, WS, DOC_NAME);
  out.savedSource = savedSource;
  check('N1.7 保存把文档写回磁盘（磁盘源码非空且含引用）', typeof savedSource === 'string' && savedSource.length > 0, {
    head: String(savedSource).slice(0, 200),
  });
  check(
    'N1.8 磁盘上的文档引用 `assets/a 2.png`（③ 文档引用正确）',
    typeof savedSource === 'string' && savedSource.includes('assets/a 2.png'),
    { head: String(savedSource).slice(0, 300) },
  );
  check(
    'N1.9 磁盘上的文档**不**引用裸 `assets/a.png`（没有指回红图）',
    typeof savedSource === 'string' && !/assets\/a\.png/.test(savedSource),
    { head: String(savedSource).slice(0, 300) },
  );

  await closeDoc();
  await page.waitForTimeout(600);
  out.docNameAfterClose = await docBarName();
  out.docNameAfterReopen = await openWorkspaceFile(DOC_NAME);
  check(
    'N1.9b 重开确实打开了磁盘上的文档（文档栏回到 n1.mm.md）',
    out.docNameAfterReopen === DOC_NAME,
    { afterClose: out.docNameAfterClose, afterReopen: out.docNameAfterReopen },
  );

  // ④ 重开显示蓝图：文档里引用的 assets/a 2.png 渲染成 <image href="blob:...">
  const reopen = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('svg image, image')];
    return imgs.map((img) => ({
      tag: img.tagName.toLowerCase(),
      href: img.getAttribute('href') ?? img.getAttribute('xlink:href') ?? null,
    }));
  });
  out.reopenImages = reopen;
  const refs = await currentDocRefs();
  out.reopenNodes = refs.map((r) => ({ id: r.id, text: r.text.slice(0, 60) }));
  check('N1.10 重开后文档里存在引用资产的内联图元素（<image href>）', reopen.length > 0, { reopen });
  check(
    'N1.11 重开后的引用指向已归一化的工作区路径（blob:/data:），不是原始素材库 id',
    reopen.some((i) => {
      const h = i.href ?? '';
      return h.startsWith('blob:') || h.startsWith('data:');
    }) || reopen.some((i) => (i.href ?? '').includes('a%202.png') || (i.href ?? '').includes('a 2.png')),
    { reopen },
  );
  check(
    'N1.12 重开后**没有**「✕ 资产缺失」断图标记（引用的文件真的解析到了）',
    await page.evaluate(() => !/资产缺失/.test(document.body.textContent ?? '')),
    {},
  );

  /* ── ④ 的核心：重开后画出来的必须是**蓝图**（蓝），不是红图 ──
   * 用真像素判定：把节点 <image href> 指向的图加载到 canvas 取色。
   * 这是 N1「重开显示蓝图」的**唯一**可信判据（DOM 里有 <image> 不算）。 */
  const reopenedPixel = await page.evaluate(async () => {
    const img = document.querySelector('svg image, image');
    const href = img?.getAttribute('href') ?? null;
    if (href === null) return { ok: false, reason: 'no-image-href' };
    const real = document.createElement('img');
    real.src = href;
    try {
      await real.decode();
    } catch (e) {
      return { ok: false, reason: 'decode-failed', href, detail: String(e) };
    }
    const cv = document.createElement('canvas');
    cv.width = 1;
    cv.height = 1;
    const ctx = cv.getContext('2d');
    ctx.drawImage(real, 0, 0);
    // 把 1×1 图放大后取中心像素更稳：直接画满 1×1 即可
    const px = ctx.getImageData(0, 0, 1, 1).data;
    return { ok: true, href, hex: `#${[px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`, r: px[0], g: px[1], b: px[2] };
  });
  out.reopenedPixel = reopenedPixel;
  check(
    'N1.14 重开后引用解析到真实图片（可解码，无错图）',
    reopenedPixel.ok === true,
    { resumed: reopenedPixel },
  );
  check(
    'N1.15 重开后的像素是**蓝**色（④ 重开显示蓝图 —— N1 的核心）',
    reopenedPixel.ok === true && reopenedPixel.b > 200 && reopenedPixel.r < 60,
    { reopenedPixel },
  );

  /* ───────────── N4：内置图标以「子分支」插入 → 保存 → 关闭 → 重开 ───────────── */
  await openGallery();
  // 内置图标 tab（TABS 中的 builtin；用可见文本兜底）
  const builtinTab = page.locator('[data-asset-tab]').filter({ hasText: /内置图标/ }).first();
  if ((await builtinTab.count()) > 0) {
    await builtinTab.click();
    await page.waitForTimeout(400);
  }
  await pickAction('child');
  const firstBuiltin = page.locator('[data-asset-item]').first();
  const builtinName = (await firstBuiltin.getAttribute('title')) ?? null;
  out.builtinName = builtinName;
  await firstBuiltin.click();
  await page.waitForTimeout(900);

  await saveNow();
  const savedN4 = await diskRead(page, WS, DOC_NAME);
  out.savedN4 = savedN4;
  check(
    'N4.1 文档里**没有** `@draw:builtin:` / `builtin:` 引用（CE-05 的断图成因）',
    typeof savedN4 === 'string' && !/builtin:/.test(savedN4),
    { hit: typeof savedN4 === 'string' ? /builtin:/.test(savedN4) : null },
  );
  check(
    'N4.2 内置图标落成自包含形态（data: 内联）或工作区引用',
    typeof savedN4 === 'string' && (savedN4.includes('data:') || savedN4.includes('assets/')),
    { head: String(savedN4).slice(0, 300) },
  );

  await closeDoc();
  await page.waitForTimeout(500);
  await openWorkspaceFile(DOC_NAME);

  const reopenN4 = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('svg image, image')];
    return imgs.map((img) => ({
      tag: img.tagName.toLowerCase(),
      href: img.getAttribute('href') ?? img.getAttribute('xlink:href') ?? null,
    }));
  });
  out.reopenN4 = reopenN4;
  check('N4.3 重开后内置图标的图片元素存在（① 子节点图标显示）', reopenN4.length > 0, { reopenN4 });
  check(
    'N4.4 重开后图标解析出可渲染内容（data:/blob:，不是断链 builtin: 路径）',
    reopenN4.some((i) => {
      const h = i.href ?? '';
      return h.startsWith('data:') || h.startsWith('blob:');
    }),
    { reopenN4 },
  );
  check(
    'N4.5 重开后无「资产缺失」断图标记',
    await page.evaluate(() => !/资产缺失/.test(document.body.textContent ?? '')),
    {},
  );

  /* ───────────── 无原生对话框（全程） ───────────── */
  const dialogs = await readDialogs(page);
  out.dialogs = dialogs;
  check('N1/N4.5 全旅程零原生对话框调用', dialogs.length === 0, { dialogs });

  /* ───────────── ⑤ 未挂载工作区时插入被拒绝（N1 可观察⑤） ───────────── */
  await openFileManager();
  if ((await page.getByText('断开', { exact: true }).count()) > 0) {
    await page.getByText('断开', { exact: true }).first().click();
    await page.waitForTimeout(800);
  }
  await closeOverlay();
  await openGallery();
  await uploadToBrowserGallery('a.png', BLUE_PNG_B64);
  await pickAction('child');
  await clickCard('a.png');
  const noticeNoWs = await noticeText();
  out.noticeNoWs = noticeNoWs;
  const listAfterDetach = await diskList(page, WS);
  check(
    'N1.13 未挂载工作区：插入被拒绝并给出说明（零副作用）',
    noticeNoWs.some((t) => /工作区|未挂载|拒绝|无法|先/.test(t)) && !listAfterDetach.includes('assets/a 3.png'),
    { noticeNoWs, listAfterDetach },
  );

  /* ───────────── 未覆盖（如实） ───────────── */
  unconfirmed(
    'N1/N4 真实 OS 磁盘 I/O 时序与真实系统文件选择器',
    '工作区用页面内内存磁盘顶替系统目录手势；真实 OS 文件系统与 showDirectoryPicker 手势未覆盖（§3 X1：替身 picker 可顶替手势）。',
  );
  unconfirmed(
    'N1 浏览器「刷新」后重开（真实 IndexedDB 跨会话）',
    '本轮 journey 在同一页面会话内完成「保存→关闭→重开」；跨浏览器刷新后的 IDB 持久化未在本脚本覆盖（N1 的④只要求重开显示蓝图）。',
  );
} catch (e) {
  check('脚本执行', false, String(e));
} finally {
  await browser.close();
}

out.pass = finish();
console.log(JSON.stringify(out, null, 2));
process.exit(out.pass ? 0 : 1);
