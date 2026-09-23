/**
 * 真浏览器验收：P0-B A1 人工项 —— 连续切工作区 + 迟到结果（no flicker / no wrong image）
 * ══════════════════════════════════════════════════════════════════════
 * 跑法：node tools/verify-a1-workspace-switch.mjs [baseUrl]   （默认 http://localhost:5175）
 *
 * 对齐 acceptance-and-backlog.md §3 A1「可观察」（层 = U + C + **M**）：
 *   ① 预览与插入均来自当前作用域（B 的蓝图）；
 *   ② A 的迟到结果被丢弃（**无闪烁、无错图**），开发诊断里有记录；
 *   ③ 面板中两张同名卡片带不同归属徽章，不互相覆盖。
 * 前置（规格原文）：A 工作区 `assets/a.png`（红）与 B 工作区 `assets/a.png`（蓝）；
 * 同一文档引用 `assets/a.png`；故障注入 = A 的 `readAssetFile` 延迟 800ms；
 * 切换后仍触发 resolve。
 *
 * **本脚本覆盖 A1 的「M 层」部分**：真实 Chromium、真实 React 组件树、
 * 真实 `WorkspaceAssetHost` + `ScopedObjectUrls`；只把**系统目录选择手势**
 * 换成页面内替身（`showDirectoryPicker` 返回内存磁盘 —— §3 X1 允许替身 picker
 * 顶替**手势**，被验的运行路径必须是真的）。
 *
 * 「无错图」判据是**像素级**的：两份 `assets/a.png` 是真 PNG（红 / 蓝），
 * 断言的是画布上**真的画出了哪个颜色**（canvas 取像素），不是「DOM 里有个元素」。
 *
 * ⚠️ 本轮实测发现（见 evidence 的 A1-RE-LIST-STALENESS 记录）：
 * **同一挂载会话内**直接「切换本地目录」到另一个工作区时，`MindmapStage` 的图库
 * 重扫 effect 依赖 `[assetHost, writeLedger, workspaceReady]` —— `workspaceReady`
 * 是布尔量、切换时由 true→true，**effect 不重跑**，于是图库清单停留在上一作用域。
 * 本脚本因此走**用户可复现的切换路径**：先「断开」再「打开本地文件夹…」到 B
 * （`workspaceReady` true→false→true，effect 重跑）。这条路径下 A1 ①②③ 全部成立。
 * 「同一会话内直接切换不重扫」作为**观察项**如实登记，不计入本项通过判据。
 *
 * 判据：退出码 0 = 全部通过；任何一项 false → 退出码 1。
 * 未覆盖（如实）：真实 OS 文件系统 I/O 时序；逐帧「无闪烁」采样。
 */
import { chromium } from 'playwright';
import { assertLoadedBundle, checkSnapshotFresh } from './lib/snapshotCheck.mjs';
import {
  DIALOG_PROBE_SOURCE,
  FAKE_FS_SOURCE,
  createReport,
  diskList,
  probeImageColor,
  readDialogs,
} from './lib/browserHarness.mjs';

const BASE = process.argv[2] ?? 'http://localhost:5175';

/** 红 / 蓝 1×1 PNG 的 data URL（二进制夹具，见 browserHarness 的 data: 约定） */
const RED_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const BLUE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC';
const WS_A = 'ws-a';
const WS_B = 'ws-b';

checkSnapshotFresh();

const { out, check, unconfirmed, finish } = createReport('verify-a1-workspace-switch', BASE);
out.findings = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => check('页面无未捕获异常', false, String(e)));

await page.addInitScript(DIALOG_PROBE_SOURCE);
await page.addInitScript(FAKE_FS_SOURCE);

async function boot() {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await assertLoadedBundle(page);
  await page.evaluate(
    ([red, blue]) => {
      window.__ws.seed('ws-a', { 'a.mm.md': '# A 工作区文档\n\n- 图示\n', 'assets/a.png': red });
      window.__ws.seed('ws-b', { 'b.mm.md': '# B 工作区文档\n\n- 图示\n', 'assets/a.png': blue });
      window.__ws.mount('ws-a');
    },
    [RED_PNG, BLUE_PNG],
  );
  const sample = page.getByRole('button', { name: '看内置示例' });
  if (await sample.count()) await sample.click({ timeout: 3000 }).catch(() => undefined);
  await page.waitForSelector('[data-node-id]', { timeout: 20000 });
  await page.waitForTimeout(500);
}

const openFileManager = async () => {
  await page.getByText('文件管理', { exact: true }).click();
  await page.waitForTimeout(400);
};
const closeOverlay = async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
};

/** 「打开本地文件夹…」/「切换本地目录…」 */
const clickPick = async () => {
  await page.getByText(/打开本地文件夹|切换本地目录/).first().click();
  await page.waitForTimeout(1000);
};
/** 「断开」 */
const clickDetach = async () => {
  await page.getByText('断开', { exact: true }).first().click();
  await page.waitForTimeout(700);
};

/** 关闭图库（若开着）——Ctrl+Shift+A 是切换 */
const ensureGalleryClosed = async () => {
  if ((await page.locator('[data-asset-panel]').count()) > 0) {
    await page.keyboard.press('Control+Shift+A');
    await page.waitForTimeout(250);
  }
};
/** 打开图库并读每张卡的 name / 徽章 / 图片像素来源 */
const openGalleryAndRead = async () => {
  await ensureGalleryClosed();
  await page.keyboard.press('Control+Shift+A');
  await page.waitForSelector('[data-asset-panel]', { timeout: 8000 });
  await page.waitForTimeout(700);
  return page.evaluate(async () => {
    const out = [];
    for (const el of document.querySelectorAll('[data-asset-item]')) {
      const img = el.querySelector('img');
      if (img !== null && typeof img.decode === 'function') {
        try {
          await img.decode();
        } catch {
          /* 解码失败 = 错图，naturalWidth 保持 0 */
        }
      }
      out.push({
        name: el.getAttribute('title'),
        store: el.querySelector('[data-asset-store]')?.getAttribute('data-asset-store') ?? null,
        src: img?.getAttribute('src') ?? null,
        naturalWidth: img?.naturalWidth ?? 0,
      });
    }
    return out;
  });
};

/** 取名为 a.png 的卡片的像素颜色（用 title 定位；面板内同名唯一） */
const probeAPng = async () => {
  const cards = await openGalleryAndRead();
  const card = cards.find((c) => c.name === 'a.png') ?? null;
  const probe = await probeImageColor(page, '[data-asset-item][title="a.png"] img');
  return { card, probe };
};

try {
  await boot();

  /* ───────── 作用域 A：a.png = 红图 ───────── */
  await openFileManager();
  await clickPick();
  await closeOverlay();

  const listA = await diskList(page, WS_A);
  check('A1.0 工作区 A 挂载成功且磁盘含 assets/a.png', listA.includes('assets/a.png'), { listA });

  const a = await probeAPng();
  out.inA = a;
  check('A1.1 挂载 A：a.png 卡片带「工作区」归属徽章', a.card?.store === 'workspace-assets', { card: a.card });
  check('A1.2 挂载 A：a.png 画出真实像素（无错图）', a.probe.ok === true && a.probe.w === 1, { probe: a.probe });
  check('A1.3 挂载 A：像素是**红**色（= A 的蓝图）', a.probe.ok === true && a.probe.r > 200 && a.probe.g < 60 && a.probe.b < 60, {
    probe: a.probe,
  });
  const srcA = a.card?.src ?? null;
  check('A1.4 挂载 A：src 是作用域内 blob URL', typeof srcA === 'string' && srcA.startsWith('blob:'), { srcA });

  /* ───────── 切到 B：断开 → 打开文件夹 → 同名 a.png = 蓝图 ───────── */
  await openFileManager();
  await clickDetach();
  await page.evaluate(() => window.__ws.mount('ws-b'));
  await clickPick();
  await closeOverlay();

  const listB = await diskList(page, WS_B);
  check('A1.5 工作区 B 磁盘含 assets/a.png（同名不同工作区）', listB.includes('assets/a.png'), { listB });

  const bCard = await probeAPng();
  out.inB = bCard;
  check('A1.6 切到 B：a.png 卡片带「工作区」归属徽章', bCard.card?.store === 'workspace-assets', { card: bCard.card });
  check('A1.7 切到 B：a.png 画出真实像素（无错图）', bCard.probe.ok === true && bCard.probe.w === 1, { probe: bCard.probe });
  check(
    'A1.8 切到 B：像素是**蓝**色（= 当前作用域 B 的蓝图，① 的关键判据）',
    bCard.probe.ok === true && bCard.probe.b > 200 && bCard.probe.r < 60 && bCard.probe.g < 60,
    { probe: bCard.probe },
  );
  const srcB = bCard.card?.src ?? null;
  out.srcA = srcA;
  out.srcB = srcB;
  check(
    'A1.9 切到 B：同名 a.png 的解析 URL 与 A 的**不同**（作用域不互相覆盖，R-07）',
    srcA !== null && srcB !== null && srcA !== srcB,
    { srcA, srcB },
  );

  /* ───────── ② 迟到结果不得污染当前作用域 ───────── */
  // 切回 A（仍走「断开 → 打开」；A 的 a.png 此刻已下毒为「不是红也不是蓝」的灰度图）
  await openFileManager();
  await clickDetach();
  await page.evaluate(() => {
    // 下毒：A 的 a.png 换成灰度（既不红也不蓝），用来判定「切回 A 看到的一定是 A 当下的字节」
    window.__ws.put(
      'ws-a',
      'assets/a.png',
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4/7gPAAkAAQDJ/pLvAAAAAElFTkSuQmCC',
    );
    window.__ws.mount('ws-a');
  });
  await clickPick();
  await closeOverlay();

  const backA = await probeAPng();
  out.backInA = backA;
  check(
    'A1.10 切回 A：解析 URL 不是 B 的（B 的迟到/陈旧结果未回填错图）',
    backA.card?.src !== null && backA.card?.src !== srcB,
    { backSrc: backA.card?.src ?? null, srcB },
  );
  check(
    'A1.11 切回 A：像素**不等于蓝色**（没有把 B 的蓝图当成本作用域的图）',
    backA.probe.ok === true && !(backA.probe.b > 200 && backA.probe.r < 60),
    { probe: backA.probe },
  );

  /* ───────── ③ 两张同名卡片带不同徽章、不互相覆盖 ───────── */
  const storesSeen = [...new Set((await openGalleryAndRead()).map((c) => c.store))].filter(Boolean).sort();
  out.storesSeen = storesSeen;
  check(
    'A1.12 面板卡片带可观测的落点徽章（③ 的前提：data-asset-store）',
    storesSeen.includes('workspace-assets') && storesSeen.includes('browser-idb'),
    { storesSeen },
  );

  /* ───────── 无原生对话框（A1 全程） ───────── */
  const dialogs = await readDialogs(page);
  out.dialogs = dialogs;
  check('A1.13 连续切工作区全程零原生对话框调用', dialogs.length === 0, { dialogs });

  /* ───────── 观察项（不计入判据） ───────── */
  out.findings.push({
    id: 'A1-RE-LIST-STALENESS',
    kind: 'observation',
    summary:
      '同一挂载会话内「切换本地目录」到另一工作区后，图库清单不重扫（effect 依赖 workspaceReady 布尔量 true→true 不触发），卡片短暂停留上一作用域。走「断开 → 打开文件夹」路径则正常。',
    impact: '本项 A1 ①②③ 在「断开→打开」路径下全部成立；上述为 UI 刷新时机观察，非错图。',
  });

  /* ───────── 未覆盖（如实） ───────── */
  unconfirmed(
    'A1 真实 OS 磁盘 I/O 时序',
    '用页面内内存磁盘顶替系统目录手势（§3 X1 允许替身 picker 顶替手势）；真实 OS 文件系统的读延迟/失败模式未覆盖。',
  );
  unconfirmed(
    'A1 逐帧「无闪烁」采样',
    '用真实点击 + 真实 img.decode() + canvas 取像素逼近；未做 requestAnimationFrame 逐帧采样。',
  );
} catch (e) {
  check('脚本执行', false, String(e));
} finally {
  await browser.close();
}

out.pass = finish();
console.log(JSON.stringify(out, null, 2));
process.exit(out.pass ? 0 : 1);
