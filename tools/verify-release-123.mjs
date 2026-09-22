/**
 * DELIVERY-CLOSE 发布矩阵验收（真浏览器）· 深度收尾版（DC-R1 / DC-R2 / DC-R3）
 * ══════════════════════════════════════════════════════════════════════
 * 跑法：
 *   node tools/verify-release-123.mjs <baseUrl> [--mode=normal|neg-*] [--out=<证据目录>] [--inputs=<冻结清单>]
 *
 * 前置：pnpm --filter canvas build（checkSnapshotFresh 卡新鲜度）+ 静态服务托管 dist。
 * 证据：`--out` 指向**本轮独占**目录（正常 / 每个负控各自一份），截图 `shots/`、导出原件 `exports/`、
 *       结果 `results.json`；不指定时退到 `outputs/delivery-close-finish/_unscoped/<mode>`。
 * 输入：`--inputs=<file>` 给出时先逐项复算冻结清单，不一致即停（exit 3，见 T1）。
 *
 * 覆盖（每 check 独立记录；正常模式期望全绿）：
 *   R1 导图 打开→编辑→**保存确认（等待新的已完成写入）**→Undo（按节点身份核对）→重开对照**最后一份成功快照**
 *      + R1g **句柄身份**：句柄创建时固定 scope/原文，跨夹具切换与延迟 close 都不串档（DF-R2）
 *   R2 三主题：主题身份 / 字号严格阶梯 / 绘制度量（文字不溢盒）/ 输入命中（编辑框字号=绘制字号）
 *      / SVG 逐节点字号+颜色对应 / PNG 解码（尺寸 + 逐节点有效内容）/ 导出件落盘
 *   R3 框与中心：框壳/行/挂出（含几何互不重叠）、框内编辑与挂出节点不重叠、嵌套框、跨框边**端点语义核对**、
 *      升格（data-center 角标 + 落盘 center 条目）、中心拖动整岛跟移 + **另一岛不动/视口不位移**、
 *      总览动态（k<0.35 出卡，回 full 收起）
 *   R4 LOD：两阈值邻域**来回缩放过程**采样（同向不振荡 + 实际落点在 ±0.02 内才判到达 + 回到 full 可读）
 *      + 检测器自检 + **两档滞回带**（0.5 与 0.26 各双侧）+ **手势活动窗口内 LOD 冻结、释放后收敛**（DF-R3）
 *   R5 Canvas 纯树后端：`?backend=canvas` 身份（HUD 后端=canvas、无 SVG 节点层）+ 画布尺寸/墨量/跨度
 *      + **连线落笔**（跨度内无整列空白 + 细柱）+ 坐标命中的节点身份核对（DF-R4）
 *   R6 自由画布：非空连接夹具；改正面/背面 + 拖动（按 viewport scale 换算世界位移）→ 解析**最后一份 JSON**
 *      （按 uuid 结构化核对）→ 重开核对实际 UI（文本/翻面/世界相对坐标/edgeUuid 端点）→ 再存语义一致
 *   R7 保存 / 另存为目的地隔离（DF-R5，真实 UI 触发另存为）：A/B 各自最后快照、B 后续写入不改 A、
 *      A 的 pending 与 close 失败都不改 B 也不推进成功快照、换 handle 重开同一文件读回最新成功快照
 *
 * 负控模式（`--mode=`；**预期值一律不变**，只扰动独立副本或在运行期省略动作）：
 *   neg-undoredo      省略 Ctrl+Z                                  → R1e 必须失败
 *   neg-stalejson     自由画布读取永远返回原始夹具                  → R6d/R6f 必须失败（复核证实的旧假绿）
 *   neg-canvas        不加速 backend 参数（回 SVG）                 → R5a/R5b 必须失败
 *   neg-endpoints     跨框边端点写进**独立夹具副本**                → R3d 必须失败（不改期望对）
 *   neg-theme         扰动**导出 SVG 副本**的字号                   → R2d 必须失败（不改期望档位）
 *   neg-canvas-links  只把路径几何指令打成空函数（节点卡/文字照旧） → R5d 必须失败（DF-R4）
 *   neg-saveas-share  **只**让「另存为目的地」塌回当前已打开文件的身份（打开侧 id 不变）
 *                     → R7b/R7c 必须失败（DF-R5）
 *
 * 目的地身份（DF-R5）：把此前混在一起的三层拆开 ——
 *   ① 夹具来源 `fixtureKind`；② 目的地 id（打开 = `open:<夹具来源>:<名>`，另存为 = `save:<名>`）；
 *   ③ 句柄对象（一次性外壳，创建时冻结目的地与原文）。两个不同 Markdown 文件必得两个身份，
 *   同名但来源不同也不合并；同一目的地换 handle 重开读回同一 committed。
 *
 * 不声称覆盖（如实声明）：真实系统文件选择器/保存对话框手势（内存句柄 mock）、
 * 真实 OS 输入法（合成 CompositionEvent 见 verify-mode-guard）、触控、跨浏览器（仅 Chromium）、离线、
 * 跨平台像素金图（PNG 只做尺寸+有效绘制，不做逐像素基线）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import {
  WRITE_LEDGER_SOURCE,
  channelSum,
  edgePairs as edgePairsOf,
  ledgerSelfCheck,
  normalizeFill,
  parsePngHeader,
  perturbSvgFontSize,
  semanticCanvas,
  svgBackgroundFill,
  svgNode,
  svgViewBox,
  verifyInputs,
} from './lib/releaseAcceptance.mjs';
import { assertLoadedBundle, checkSnapshotFresh, expectedBundleName } from './lib/snapshotCheck.mjs';

const ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const argv = process.argv.slice(2);
const arg = (k) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit === undefined ? null : hit.slice(`--${k}=`.length);
};
const BASE = argv.find((a) => a.startsWith('http')) ?? 'http://localhost:5175';
const MODE = arg('mode') ?? 'normal';
const NEG = {
  undoredo: MODE === 'neg-undoredo',
  staleJson: MODE === 'neg-stalejson',
  canvasSvg: MODE === 'neg-canvas',
  endpoints: MODE === 'neg-endpoints',
  theme: MODE === 'neg-theme',
  // DF-R4：只把「路径几何」打成空函数（节点卡/文字照旧）→ 连线检查必须红
  canvasLinks: MODE === 'neg-canvas-links',
  // DF-R5：**只**中性化目的地隔离（回修复前的 `md:<fixtureKind>` 单键）→ 同格式另存为隔离检查必须红
  shareDestinations: MODE === 'neg-saveas-share',
};

/* ── 证据目录（本轮独占；正常与每个负控各一份，不共享同名文件） ── */
const OUT = resolve(ROOT, arg('out') ?? `outputs/delivery-close-finish/_unscoped/${MODE}`);
const SHOTS = join(OUT, 'shots');
const EXPORTS = join(OUT, 'exports');
mkdirSync(SHOTS, { recursive: true });
mkdirSync(EXPORTS, { recursive: true });

/* ── T1：运行输入冻结清单（不一致 → 停止该运行，不冒充证据） ── */
const INPUTS_FILE = arg('inputs');
let inputsReceipt = { declared: null, ok: null, missing: [], mismatched: [], extra: [] };
if (INPUTS_FILE !== null) {
  if (!existsSync(INPUTS_FILE)) {
    console.error(`⛔ 输入冻结清单不存在：${INPUTS_FILE}\n   先建：node tools/lib/releaseAcceptance.mjs inputs --file=${INPUTS_FILE} --reason=...`);
    process.exit(3);
  }
  inputsReceipt = { declared: INPUTS_FILE, ...verifyInputs(INPUTS_FILE) };
  if (!inputsReceipt.ok) {
    console.error(`⛔ 运行输入与冻结清单不一致（停止该运行）：\n${JSON.stringify(inputsReceipt, null, 2)}`);
    process.exit(3);
  }
}

/* ── T1：写盘账本 Node 端自检（与注入浏览器的是同一份函数源码） ── */
const ledgerCheck = ledgerSelfCheck();
await ledgerCheck.runDelayedClose();
await ledgerCheck.runRejectedClose();
writeFileSync(
  join(OUT, 'ledger-selfcheck.json'),
  JSON.stringify({ steps: ledgerCheck.steps }, null, 2),
  'utf8',
);

const FIXTURE_DIR = new URL('../apps/canvas/tests/fixtures/', import.meta.url);
const MAIN = readFileSync(new URL('release-123.mm.md', FIXTURE_DIR), 'utf8');
const CENTERS = readFileSync(new URL('release-123-centers.mm.md', FIXTURE_DIR), 'utf8');
const PURE = readFileSync(new URL('release-123-canvas.mm.md', FIXTURE_DIR), 'utf8');
const NESTED = readFileSync(new URL('release-123-nested.mm.md', FIXTURE_DIR), 'utf8');
const CANVAS_JSON = readFileSync(new URL('release-123.mc.canvas.json', FIXTURE_DIR), 'utf8');

/**
 * neg-endpoints：把跨框边的目标端点写进**独立夹具副本**（cid:c4 → cid:c3）。
 * **期望对不变**（仍是 甲内框子一 → 乙挂出一），因此这是一次真正的行为负控：
 * 若 R3d 仍判绿，说明端点身份检查没有鉴别力。扰动没命中 → 环境失败（exit 3），不算命中。
 */
const CENTERS_PERTURBED = CENTERS.replace(/to:\s*"cid:c4"/, 'to: "cid:c3"');
if (NEG.endpoints && CENTERS_PERTURBED === CENTERS) {
  console.error('⛔ neg-endpoints 扰动未命中夹具中的 `to: "cid:c4"` —— 环境失败，不计负控命中');
  process.exit(3);
}
const CENTERS_UNDER_TEST = NEG.endpoints ? CENTERS_PERTURBED : CENTERS;

const LEAF = '叶子甲一';
const LEAF_EDITED = '叶子甲一改';
const PURE_NODES = 9; // 纯树夹具：根 + 2 分支 + 6 叶
const PURE_LABELS = ['纯树根', '分支甲', '分支乙', '甲叶一', '甲叶二', '甲叶三', '乙叶一', '乙叶二', '乙叶三'];
/** 纯树夹具各节点的 depth（= 视觉档）——命中身份要跨档才算证明「三档都被画出来」 */
const PURE_DEPTH = {
  纯树根: 0,
  分支甲: 1,
  分支乙: 1,
  甲叶一: 2,
  甲叶二: 2,
  甲叶三: 2,
  乙叶一: 2,
  乙叶二: 2,
  乙叶三: 2,
};
const FREE_A = 'pl_r123_a';
const FREE_B = 'pl_r123_b';
const EDGE_1 = 'ed_r123_1';
const EDGE_2 = 'ed_r123_2';
const FRONT_A_NEW = '## 验收卡甲\n正面已改（返修核对）';
const BACK_B_NEW = '## 乙背面\n背面已改（返修核对）';
const DRAG = { dx: 120, dy: 60 };
/** 主题身份（ThemeSwitcher 顺序 = classic/sticker/glass；标签即身份，不看索引猜） */
const THEME_IDS = ['classic', 'sticker', 'glass'];
const THEME_LABELS = ['经典', '贴纸', '玻璃'];
/** DEPTH-VIS-1 三档字号（tokens.ts 实测；用于「指定主题身份 → 对应字号」的静态对照） */
const THEME_SIZE = {
  classic: { root: 13, branch: 12, leaf: 9 },
  sticker: { root: 14, branch: 13, leaf: 10 },
  glass: { root: 13, branch: 12, leaf: 9 },
};
/** glass 叶标题（DEPTH-VIS-1.1 L2）：必须 ≠ CHROME.textMuted，且亮度更高 */
const MUTED = '#98a2b3';
/**
 * LOD 阈值（DF-R3）：与 `packages/react/src/render/geometry.ts` 的
 * `LOD_FULL_K` / `LOD_DETAIL_K` / `LOD_HYSTERESIS` **逐值一致**。
 * 跨阈值断言必须用这三个真实阈值判定，不得用「<0.35 / ≥0.6」这类宽松近似替代。
 */
const LOD_FULL_K = 0.5;
const LOD_DETAIL_K = 0.26;
const LOD_HYSTERESIS = 0.02;

checkSnapshotFresh();
const expectedBundle = expectedBundleName();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)));

await page.addInitScript(
  ({ main, centers, pure, nested, canvasJson, staleJson, canvasLinksNoDraw, shareDestinations, ledgerSrc }) => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    window.__pageErrors = [];
    window.addEventListener('pageerror', (e) =>
      window.__pageErrors.push(String(e && e.message ? e.message : e)),
    );
    /**
     * neg-canvas-links（行为负控）：把**路径几何指令**打成空函数 —— 只影响连线/箭头的落笔，
     * 节点卡的 `roundRect` 与文字 `fillText` 照旧。产品源码、期望值与正常导出件都不动。
     * 目的：证明 R5d 的「跨度内无整列空白 + 细柱」确实能识别「连线没画」。
     */
    if (canvasLinksNoDraw) {
      const proto = CanvasRenderingContext2D.prototype;
      for (const m of ['lineTo', 'quadraticCurveTo', 'bezierCurveTo']) proto[m] = function () {};
    }
    // 写盘账本：与 Node 端自检**同一份函数源码**（单一事实源，避免 helper 与页面漂移）
    window.__ledger = new Function(`return ${ledgerSrc}`)();
    window.__gates = [];
    window.__autoRelease = true;
    window.__reads = [];
    window.__pickerCalls = [];
    window.__releaseAll = () => {
      for (const g of window.__gates) g.release();
    };
    /** 让下一次 close 失败（release 前置的 gate 被 reject）——用于「失败不推进成功快照」 */
    window.__rejectAll = () => {
      for (const g of window.__gates) g.reject(new Error('injected close failure'));
    };
    window.__fixtureKind = 'main'; // 'main' | 'centers' | 'pure' | 'nested'
    window.__originalJson = canvasJson; // 原始夹具（读来源负控的对照物）
    const MD_NAME = 'release-123.mm.md';
    const JSON_NAME = 'release-123.mc.canvas.json';
    const SAVE_DEFAULT_NAME = 'release-123-saved.mm.md';
    const fixtureOf = () =>
      window.__fixtureKind === 'centers'
        ? centers
        : window.__fixtureKind === 'pure'
          ? pure
          : window.__fixtureKind === 'nested'
            ? nested
            : main;

    /**
     * 目的地身份（DF-R5）：把此前混在一起的**三层**拆开。
     *
     * ① **夹具来源** `fixtureKind`（main/centers/pure/nested）——决定「打开选择器返回的那份文件」
     *    的种子内容（同一份夹具 = 同一份原文件）。
     * ② **目的地 id** = 账本的存储键：
     *    - 打开选择器：`open:<bucket>:<name>`（bucket = 夹具来源；**同一份文件重复打开 → 同一 id**，
     *      所以换 handle 重开读回同一 committed，不会每次 picker 都造空文件）；
     *    - 另存为选择器：`save:<name>`（用户在保存对话框里选定的**新路径**；与当前夹具来源无关 ——
     *      路径就是路径）。
     *    两个不同 Markdown 文件必得两个 id；**同名但来源不同**（open vs save）也不合并。
     * ③ **句柄对象**：一次性外壳，自带 destinationId 与创建时冻结的 `originalText`。
     *
     * 修复前只有 `md:<fixtureKind>` 一个键：另存为文件 B 与已打开的 A 撞同一身份，
     * 写 B 之后经 A 也读出 B 的内容（主控同格式目的地探针实测 aScope=bScope=`md:main`）。
     */
    const bucketOf = (kind) => (kind === 'md' ? window.__fixtureKind : kind);
    const openDestId = (kind, name) => `open:${bucketOf(kind)}:${name}`;
    const saveDestId = (name) => `save:${name}`;
    /**
     * neg-saveas-share：**只**中性化「另存为目的地与已打开文件之间的隔离」——
     * 把另存为的落点塌回**当前夹具那份已打开文件**的身份（正是修复前 `md:<fixtureKind>` 的行为）。
     *
     * 刻意**不**改打开侧的 id 方案：否则 R1c/R1f/R3f/R6c 这些「本次新完成写入落在哪份文件」
     * 的正常断言会因为命名口径变化而一起变红，负控就不再是「只打隔离」了。
     */
    const legacySaveDestId = (kind) => (kind === 'md' ? openDestId('md', MD_NAME) : kind);

    /**
     * 目的地表：id → { seed }。seed 在**首次见到该目的地**时固定，
     * 之后重建句柄只复用、不重置存储（「不能每次 picker 都造空文件」）。
     * 打开目的地 seed = 该夹具的原文件；另存为目的地在磁盘上尚不存在 → seed = 空。
     */
    const destinations = new Map();
    const destSeed = (id, seed) => {
      const hit = destinations.get(id);
      if (hit !== undefined) return hit.seed;
      destinations.set(id, { id, seed });
      return seed;
    };

    /** 该句柄的读取口径（只用**冻结身份**，不再看 window.__fixtureKind） */
    const readDest = (dest, kind, originalText) => {
      if (kind === 'json' && staleJson) return canvasJson; // neg-stalejson：读取恒返回原始夹具
      const last = window.__ledger.latest(dest);
      return last !== null ? last.text : originalText;
    };
    /** 供 Node 端读某个**具体目的地**的最后成功快照（null = 该文件还没有成功落盘过） */
    window.__destText = (dest) => window.__ledger.latest(dest)?.text ?? null;
    /** 有内容的全部目的地 id（用于「除本句柄外无人被写」这类断言，不依赖 id 命名格式） */
    window.__destIds = () => [...new Set(window.__ledger.snapshot().committed.map((c) => c.scope))];
    window.__openDestId = (kind = 'md') => openDestId(kind, kind === 'json' ? JSON_NAME : MD_NAME);
    window.__saveDestId = (name = SAVE_DEFAULT_NAME) => saveDestId(name);

    /**
     * 句柄 = **不可变的文件身份**（DF-R2 + DF-R5）。
     *
     * `destinationId`、`originalText`（该文件的原内容）在**创建句柄时一次性固定**；
     * 此后 `getFile` / `createWritable` 只用这份身份。跨夹具切换（main → pure）、
     * 延迟 close、以及同一夹具下的两个不同目的地都不会串档。
     */
    const makeHandle = (name, kind, origin) => {
      const dest =
        origin === 'save'
          ? shareDestinations
            ? legacySaveDestId(kind)
            : saveDestId(name)
          : openDestId(kind, name);
      const seed = origin === 'save' ? '' : kind === 'json' ? canvasJson : fixtureOf();
      const originalText = destSeed(dest, seed); // ← 创建时固定（原文件内容）
      const handle = {
        name,
        kind,
        origin,
        destinationId: dest,
        scope: dest, // 兼容旧断言名：scope 就是目的地 id
        originalText,
        getFile: async () => {
          const text = readDest(dest, kind, originalText);
          window.__reads.push({ kind: dest, text });
          return new File([text], name, { type: 'text/plain' });
        },
        createWritable: async () => {
          const entry = window.__ledger.begin(dest, name);
          let release = () => {};
          let reject = () => {};
          const gate = new Promise((resolveGate, rejectGate) => {
            release = () => resolveGate();
            reject = (e) => rejectGate(e);
          });
          gate.catch(() => undefined); // 失败由 close() 如实抛出，这里不产生 unhandled rejection
          window.__gates.push({ id: entry.id, scope: dest, release, reject });
          if (window.__autoRelease) release();
          return {
            write: async (data) => {
              entry.write(typeof data === 'string' ? data : '[blob]');
            },
            close: async () => {
              await entry.close(async () => {
                await gate;
              });
            },
            abort: async () => {
              entry.abort();
            },
          };
        },
      };
      if (origin === 'save') window.__lastSaveHandle = handle;
      else window.__lastOpenHandle = handle;
      return handle;
    };
    window.showOpenFilePicker = async (options) => {
      const wantsJson = JSON.stringify(options?.types ?? []).includes('application/json');
      window.__pickerCalls.push({ picker: 'open', json: wantsJson });
      return [makeHandle(wantsJson ? JSON_NAME : MD_NAME, wantsJson ? 'json' : 'md', 'open')];
    };
    window.showSaveFilePicker = async (options) => {
      const name = options?.suggestedName ?? SAVE_DEFAULT_NAME;
      window.__pickerCalls.push({ picker: 'save', name });
      return makeHandle(name, 'md', 'save');
    };
  },
  {
    main: MAIN,
    centers: CENTERS_UNDER_TEST,
    pure: PURE,
    nested: NESTED,
    canvasJson: CANVAS_JSON,
    staleJson: NEG.staleJson,
    canvasLinksNoDraw: NEG.canvasLinks,
    shareDestinations: NEG.shareDestinations,
    ledgerSrc: WRITE_LEDGER_SOURCE,
  },
);

const out = { base: BASE, mode: MODE, out: OUT, inputs: inputsReceipt };
let pass = true;
/**
 * 环境失败（≠ 负控命中）：负控的扰动没落到目标上、夹具缺元素、超时等，
 * 都不能算「预定检查被触发」。命中环境失败时整轮以 exit 3 收口，避免把噪声冒充证据。
 */
const ENV = [];
const envFail = (msg) => {
  ENV.push(msg);
  throw new Error(`ENV-FAIL: ${msg}`);
};
/** 固定 caseId 账本：caseId / 期望（写在 name）/ 实际（detail）/ 状态 */
const CASES = [];
const check = (name, ok, detail) => {
  const caseId = /^([A-Za-z0-9-]+)/.exec(name)?.[1] ?? name;
  const row = { caseId, name, ok: ok === true, detail: detail ?? null };
  CASES.push(row);
  out[name] = { ok: ok === true, detail };
  if (ok !== true) pass = false;
};
const wait = (ms) => page.waitForTimeout(ms);
const has = async (sel) => (await page.locator(sel).count()) > 0;
const count = (sel) => page.locator(sel).count();
const click = (sel) => page.locator(sel).first().click();
const clickText = (t) => page.getByText(t, { exact: true }).first().click();
const saveShot = (name) => page.screenshot({ path: join(SHOTS, name) });
/** 每次导航后记录**页面实际加载的 bundle**（证据：本轮跑的是哪个产物） */
const loadedBundles = [];
const checkBundle = async () => {
  const name = await assertLoadedBundle(page);
  loadedBundles.push(name);
  return name;
};
/**
 * 注入就绪自检：账本 / 文件选择器替身没装好 → 后续「已完成写入」「读取来源」证据全部作废，
 * 立即按**环境失败**（exit 3）停止该运行，不让它退化成「夹具没加载还继续断言」。
 */
const assertInjectionReady = async () => {
  const probe = await page.evaluate(() => ({
    ledger: typeof window.__ledger?.begin === 'function',
    committedCount: typeof window.__ledger?.committedCount === 'function',
    openPicker: typeof window.showOpenFilePicker === 'function',
    savePicker: typeof window.showSaveFilePicker === 'function',
  }));
  if (!probe.ledger || !probe.committedCount || !probe.openPicker || !probe.savePicker) {
    envFail(`浏览器注入未就绪（写盘账本 / 文件选择器替身）：${JSON.stringify(probe)}`);
  }
  return probe;
};
const worldTransform = () =>
  page.evaluate(() => document.querySelector('svg')?.querySelector('g')?.getAttribute('transform') ?? null);
const zoomOf = async () => {
  const m = /scale\(\s*([\d.]+)/.exec((await worldTransform()) ?? '');
  return m === null ? null : Number(m[1]);
};
/** 性能面板读数（面板行 = div > span(键) + span(值)） */
const hudRow = (key) =>
  page.evaluate((k) => {
    for (const row of document.querySelectorAll('div')) {
      const spans = row.children;
      if (spans.length === 2 && spans[0].textContent?.trim() === k) return spans[1].textContent?.trim() ?? null;
    }
    return null;
  }, key);
const nodeLabels = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('g[data-node-id]'), ...document.querySelectorAll('[data-frame-row]')]
      .map((el) => (el.textContent ?? '').trim())
      .filter((t) => t.length > 0),
  );
/** 节点身份查询：普通节点（g[data-node-id]）或**框行**（[data-frame-node]）都算 */
const nodeIdOf = (label) =>
  page.evaluate((lb) => {
    const g = [...document.querySelectorAll('g[data-node-id]')].find((el) =>
      (el.textContent ?? '').includes(lb),
    );
    if (g) return g.getAttribute('data-node-id');
    const row = [...document.querySelectorAll('[data-frame-node]')].find((el) =>
      (el.textContent ?? '').includes(lb),
    );
    return row?.getAttribute('data-frame-node') ?? null;
  }, label);
const nodeTextById = (id) =>
  page.evaluate(
    (i) =>
      document.querySelector(`g[data-node-id="${i}"]`)?.textContent?.trim() ??
      document.querySelector(`[data-frame-node="${i}"]`)?.textContent?.trim() ??
      null,
    id,
  );
const nodeBoxById = (id) =>
  page.evaluate((i) => {
    const el =
      document.querySelector(`g[data-node-id="${i}"]`) ?? document.querySelector(`[data-frame-node="${i}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, id);
const fontOf = (label) =>
  page.evaluate((lb) => {
    const g = [...document.querySelectorAll('g[data-node-id]')].find((el) =>
      (el.textContent ?? '').includes(lb),
    );
    const t = g?.querySelector('text');
    return t ? Number.parseFloat(getComputedStyle(t).fontSize) : null;
  }, label);
const textFillOf = (label) =>
  page.evaluate((lb) => {
    const g = [...document.querySelectorAll('g[data-node-id]')].find((el) =>
      (el.textContent ?? '').includes(lb),
    );
    const t = g?.querySelector('text');
    return t ? getComputedStyle(t).fill : null;
  }, label);
/** 幕布注释带（DescBlock）实际字色——DEPTH-VIS-1.1 L1 要求恒为 CHROME.textMuted */
const descFillOf = () =>
  page.evaluate(() => {
    const el = document.querySelector('[data-desc-text]');
    return el === null ? null : getComputedStyle(el).color;
  });
/**
 * 当前「打开的那份文件」的目的地 id（DF-R5：不再用 `md:<fixtureKind>` 单键）。
 * md → `open:<夹具来源>:<文件名>`；json → `open:json:<文件名>`。
 */
const destOfKind = (kind) => page.evaluate((k) => window.__openDestId(k), kind);
/** 已完成（close 成功）的写出计数——**尝试编号 issued 不是完成序号** */
const committedCount = (dest) => page.evaluate((s) => window.__ledger.committedCount(s), dest);
/** 某**具体目的地**的最后一份已完成写出（null = 该文件还没成功落盘过） */
const destText = (dest) => page.evaluate((s) => window.__destText(s), dest);
/** 最后一份**已完成**写出（打开的那份文件；空串 = 还没有成功快照） */
const lastWriteText = async (kind) => (await destText(await destOfKind(kind))) ?? '';
/** 账本快照（证据用：issued 只算尝试，committed 才是「已完成写入」） */
const ledgerSnapshot = () => page.evaluate(() => window.__ledger.snapshot());
/** 适配视图（工具栏按钮）：打开新文档后必须做，否则端点可能落在视口外 */
const fitView = async () => {
  const btn = page.getByRole('button', { name: '适配视图' }).first();
  if ((await btn.count()) > 0) await btn.click().catch(() => undefined);
  await wait(700);
};
const waitForSaved = async (timeoutMs = 12000) => {
  const t0 = Date.now();
  for (;;) {
    const s = await page.locator('[data-save-state]').first().textContent().catch(() => null);
    if (s !== null && s.includes('已保存')) return s;
    if (Date.now() - t0 > timeoutMs) return s;
    await wait(200);
  }
};

async function boot() {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await checkBundle();
  await assertInjectionReady();
  await page.waitForSelector('[data-node-id]', { timeout: 20000 });
  await wait(400);
  const sample = page.getByRole('button', { name: '看内置示例' });
  if (await sample.count()) await sample.click({ timeout: 3000 }).catch(() => undefined);
  await wait(400);
}
async function openFixture(kind) {
  await page.evaluate((k) => {
    window.__fixtureKind = k;
  }, kind);
  await page.keyboard.press('Control+o');
  await wait(500);
  if (await has('[data-unsaved-prompt]')) {
    await click('[data-unsaved-discard]');
    await wait(400);
    await page.keyboard.press('Control+o');
    await wait(400);
  }
  for (let i = 0; i < 25; i++) {
    // Canvas 后端没有 SVG 节点层 → 以「节点标签或 HUD 统计」任一到位为加载完成
    if ((await nodeLabels()).length >= 2 || (await hudRow('节点')) !== null) break;
    await wait(250);
  }
  await wait(500);
}
async function editNodeById(id, toText) {
  const bb = await nodeBoxById(id);
  if (bb === null) throw new Error(`节点无 boundingBox: ${id}`);
  await page.mouse.dblclick(bb.x + bb.w / 2, bb.y + bb.h / 2);
  const input = page.locator('[data-overlay-editor]').first();
  await input.waitFor({ state: 'visible', timeout: 5000 });
  await input.fill(toText);
  await page.keyboard.press('Enter');
  await wait(300);
}
/**
 * 显式保存（T1 契约）：**保存前**捕获完成序号 → 点击保存 → 等待「本次新的已完成写入」+ UI 非 saving。
 * 不靠 `writes.length >= 1`、固定睡眠或历史「已保存」文本过关。
 *
 * DF-R5：等待口径从「某个固定 scope 的计数」改为**全局已完成写入数**，
 * 因为「另存为」之后当前会话目的地已经换成了新文件（`save:<name>`），
 * 继续盯旧的 `md:<fixtureKind>` 会永远等不到。返回的 `lastScope` 记录这次新完成写入
 * 落在**哪个目的地**，由调用方按需断言（证据里也能看清）。
 */
async function saveViaClick(kind = 'md') {
  await page.evaluate(() => {
    window.__autoRelease = true;
  });
  const before = await page.evaluate(() => window.__ledger.snapshot().committed.length);
  await clickText('保存');
  const newCommit = await page
    .waitForFunction(
      (b) => window.__ledger.snapshot().committed.length > b,
      before,
      { timeout: 15000, polling: 80 },
    )
    .then(() => true)
    .catch(() => false);
  const snap = await ledgerSnapshot();
  const after = snap.committed.length;
  const state = await waitForSaved();
  return { kind, before, after, newCommit, state, lastScope: snap.committed[after - 1]?.scope ?? null };
}
const journey = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    check(`${name} 执行`, false, String(e));
  }
};
/** JSON.parse 的安全版（解析失败返回 null，由调用方判红；不吞成「空对象也算通过」） */
const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

try {
  await boot();
} catch (e) {
  // 注入/启动即失败 → 环境失败收口（exit 3），不把「没跑起来」写成产品结论
  ENV.push(String(e));
  check('R0 启动与注入就绪', false, { error: String(e) });
}

/* ───────────────── R1 导图：编辑 → 保存确认 → Undo（按身份）→ 重开对快照 ───────────────── */
await journey('R1', async () => {
  await openFixture('main');
  check(
    'R1a 夹具打开（普通节点 + 框行都渲染）',
    (await has('g[data-node-id]:has-text("叶子甲一")')) && (await count('[data-frame-row]')) >= 1,
    { nodes: await count('[data-node-id]'), frameRows: await count('[data-frame-row]') },
  );
  await saveShot('release-123-01-fixture.png');

  const leafId = await nodeIdOf(LEAF);
  const tBefore = await worldTransform();
  await editNodeById(leafId, LEAF_EDITED);
  const afterEdit = await nodeTextById(leafId);
  check(
    'R1b 编辑按节点身份生效（同一 id 文本 == 新标题；旧标题不再出现在任何节点）',
    afterEdit === LEAF_EDITED && !(await nodeLabels()).some((l) => l.includes(LEAF) && !l.includes(LEAF_EDITED)),
    { leafId, afterEdit },
  );

  // 保存并**等本次确认完成**（新的 committed 写入），再核对「最后一份已完成快照」（单份，不拼接历史）
  const mdDest = await destOfKind('md');
  const saved = await saveViaClick('md');
  const snap1 = await lastWriteText('md');
  check(
    'R1c 保存确认后：本次新完成写入**落在打开的那份文件** + 最后一份快照含新标题 + 描述 + 背面 md（单份快照）',
    saved.newCommit &&
      saved.lastScope === mdDest &&
      saved.state !== null &&
      saved.state.includes('已保存') &&
      snap1.includes(LEAF_EDITED) &&
      snap1.includes('一级分支的描述') &&
      snap1.includes('背面标题'),
    { save: saved, mdDest, bytes: snap1.length, head: snap1.slice(0, 160) },
  );
  const tAfter = await worldTransform();
  check('R1d 保存不 reset/fit（保存前后世界变换逐值相同）', tBefore === tAfter, { tBefore, tAfter });

  // Undo 必须在**保存完成之后**（DC-R1）；负控只省略这一次按键，期望不变
  if (!NEG.undoredo) {
    await page.keyboard.press('Control+z');
    await wait(500);
  }
  const afterUndo = await nodeTextById(leafId);
  const labelsAfterUndo = await nodeLabels();
  check(
    'R1e 保存完成后 Ctrl+Z：同一节点回退旧标题、新标题消失',
    afterUndo === LEAF && !labelsAfterUndo.some((l) => l.includes(LEAF_EDITED)),
    {
      undoExecuted: !NEG.undoredo,
      leafId,
      afterUndo,
      labels: labelsAfterUndo.slice(0, 8),
      tAfterUndo: await worldTransform(),
    },
  );

  // 重开：与「最后一份成功快照」对照（快照可含 Undo 后的自动保存，故取最新一份）
  await wait(900);
  const refSnap = await lastWriteText('md');
  const refTitle = (/^###\s+(.+)$/m.exec(refSnap) ?? [])[1]?.trim() ?? null;
  await openFixture('main');
  const labels = await nodeLabels();
  const otherTitle = refTitle === LEAF ? LEAF_EDITED : LEAF;
  check(
    'R1f 重开内容 == 最后一份成功快照（标题取自快照、另一版本标题不存在）',
    refTitle !== null && labels.includes(refTitle) && !labels.some((l) => l === otherTitle),
    { refTitle, otherTitle, labels: labels.slice(0, 8) },
  );

  /**
   * R1g 句柄身份（DF-R2）：句柄在**创建时**固定 scope 与原始内容，
   * 此后跨夹具切换（main → pure）仍读写原文件；已创建的 writable 延迟 close 也落回原 scope。
   * 放在 R1 末尾：探针必须写一次再**复原**，不扰动后续旅程重开 main 夹具所见的内容。
   */
  const handleIdentity = await page.evaluate(async () => {
    const h = window.__lastOpenHandle;
    if (h === undefined || h === null) return { error: '页面未挂到 showOpenFilePicker 句柄' };
    const scope = h.scope;
    const before = await (await h.getFile()).text();
    const prevKind = window.__fixtureKind;
    window.__fixtureKind = 'pure';
    const afterSwitch = await (await h.getFile()).text();
    // 已创建的 writable：先卡住 gate，切夹具后再放行 close
    window.__autoRelease = false;
    const w = await h.createWritable();
    await w.write('# delayed\n');
    const pendingText = await (await h.getFile()).text(); // 未 close → 仍读原文件
    window.__fixtureKind = 'nested';
    window.__autoRelease = true;
    window.__releaseAll();
    await w.close();
    // 复原：后续旅程重开 main 夹具时必须仍看到原文档
    const w2 = await h.createWritable();
    await w2.write(h.originalText);
    await w2.close();
    window.__fixtureKind = prevKind;
    const last = window.__ledger.latest(scope);
    const ids = window.__destIds();
    return {
      scope,
      name: h.name,
      before,
      afterSwitch,
      pendingText,
      restored: last?.text === h.originalText,
      thisCommits: window.__ledger.committedCount(scope),
      // 除本句柄的目的地外，**没有别的地点**拿到过成功写入（跨夹具切换不串档）
      otherScopesWithContent: ids.filter((s) => s !== scope),
      readKinds: [...new Set(window.__reads.map((r) => r.kind))],
    };
  });
  check(
    'R1g 句柄身份：创建时固定目的地/原文；跨夹具切换仍读写原文件；延迟 close 不串档；探针后内容已复原',
    handleIdentity.error === undefined &&
      typeof handleIdentity.scope === 'string' &&
      handleIdentity.scope.length > 0 &&
      handleIdentity.before === handleIdentity.afterSwitch &&
      handleIdentity.pendingText === handleIdentity.before &&
      handleIdentity.restored === true &&
      handleIdentity.otherScopesWithContent.length === 0 &&
      handleIdentity.thisCommits >= 3,
    handleIdentity,
  );
});

/* ───────────────── R2 三主题：字号/度量/命中 + SVG 字号色 + PNG 解码 ───────────────── */
await journey('R2', async () => {
  await fitView(); // 三主题比对前先适配视图：保证 full LOD（叶文字在档）且节点都在视口内
  const buttons = await page.evaluate(() =>
    [...document.querySelectorAll('button[aria-pressed]')].map((b) => (b.textContent ?? '').trim()),
  );
  const themeOrder = THEME_LABELS.filter((l) => buttons.includes(l));
  check('R2g 主题身份：切换器含「经典 / 贴纸 / 玻璃」三个按钮（按标签定位，不靠索引）', themeOrder.length === 3, {
    buttons,
    themeOrder,
  });

  const seen = [];
  for (const label of THEME_LABELS) {
    const i = THEME_LABELS.indexOf(label);
    const themeId = THEME_IDS[i];
    await page.locator('button[aria-pressed]').filter({ hasText: label }).first().click();
    await wait(500);
    const pressed = await page.evaluate(
      (l) =>
        [...document.querySelectorAll('button[aria-pressed]')]
          .filter((b) => (b.textContent ?? '').trim() === l)
          .map((b) => b.getAttribute('aria-pressed')),
      label,
    );
    const root = await fontOf('发布验收根');
    const branch = await fontOf('分支甲');
    const leaf = await fontOf('叶子甲二');
    const expectSize = THEME_SIZE[themeId];
    const leafFill = await textFillOf('叶子甲二');
    const descFill = await descFillOf();
    const identityOk =
      pressed.length === 1 &&
      pressed[0] === 'true' &&
      root === expectSize.root &&
      branch === expectSize.branch &&
      leaf === expectSize.leaf;
    const rank = {
      i,
      themeId,
      label,
      pressed,
      root,
      branch,
      leaf,
      expectSize,
      identityOk,
      strict: root !== null && branch !== null && leaf !== null && root > branch && branch > leaf,
    };

    // 绘制度量：文字包围盒不得溢出轨卡盒（度量与绘制同源）
    const fit = await page.evaluate((lb) => {
      const g = [...document.querySelectorAll('g[data-node-id]')].find((el) =>
        (el.textContent ?? '').includes(lb),
      );
      const t = g?.querySelector('text');
      const r = g?.querySelector('rect');
      if (!t || !r) return null;
      return { textW: t.getBBox().width, boxW: Number(r.getAttribute('width') ?? 0) };
    }, '分支甲');
    const descVisible = await has('[data-desc-text]');

    // 输入命中：双击分支节点 → 编辑框出现且字号 == 该节点绘制字号
    const branchId = await nodeIdOf('分支甲');
    const bb = await nodeBoxById(branchId);
    await page.mouse.dblclick(bb.x + bb.w / 2, bb.y + bb.h / 2);
    const editor = page.locator('[data-overlay-editor]').first();
    await editor.waitFor({ state: 'visible', timeout: 5000 });
    const editorInfo = await editor.evaluate((el) => ({
      font: Number.parseFloat(getComputedStyle(el).fontSize),
      text: el.value ?? el.textContent ?? '',
    }));
    await page.keyboard.press('Escape');
    await wait(300);
    // 编辑框在世界坐标下可能带 1/k 屏稳补偿 → 用「编辑框字号 × k ≈ 节点绘制字号」核对同源
    const kNow = (await zoomOf()) ?? 1;
    // 编辑框与节点卡「同档」：允许 ≤10% 的实现差（远小于跨档差 12 vs 9 = 25%），并要求文本同一节点
    const relDiff =
      rank.branch === null ? 1 : Math.abs(editorInfo.font - rank.branch) / Math.max(rank.branch, 1);
    const hitOk = relDiff <= 0.1 && editorInfo.text.includes('分支甲');
    seen.push({
      ...rank,
      leafFill,
      descFill,
      fit,
      descVisible,
      editorFont: editorInfo.font,
      editorScale: kNow,
      editorText: editorInfo.text.slice(0, 20),
      hitOk,
    });
    await saveShot(`release-123-02-theme-${i + 1}-${themeId}.png`);

    // SVG：helper 解析导出件；neg-theme 只扰动**导出副本**（期望不变）
    const dlSvg = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
    await clickText('导出');
    const svgDl = await dlSvg;
    const svgRaw = svgDl === null ? '' : readFileSync(await svgDl.path(), 'utf8');
    const perturbed = NEG.theme ? perturbSvgFontSize(svgRaw, '分支甲', 4) : { text: svgRaw, changed: false };
    if (NEG.theme && !perturbed.changed) {
      envFail(`neg-theme 扰动未命中导出件中的「分支甲」（导出 ${svgRaw.length} bytes）`);
    }
    writeFileSync(join(EXPORTS, `release-123-theme${i + 1}-${themeId}${NEG.theme ? '-perturbed' : ''}.svg`), perturbed.text);
    const vb = svgViewBox(svgRaw);
    const bgFill = svgBackgroundFill(svgRaw);
    const svgCmp = [];
    for (const nodeLabel of ['发布验收根', '分支甲', '叶子甲二']) {
      const inSvg = svgNode(perturbed.text, nodeLabel);
      const onCanvas = { fontSize: await fontOf(nodeLabel), fill: await textFillOf(nodeLabel) };
      svgCmp.push({
        label: nodeLabel,
        inSvg,
        onCanvas,
        ok:
          inSvg !== null &&
          onCanvas.fontSize !== null &&
          Math.abs(inSvg.fontSize - onCanvas.fontSize) < 0.51 &&
          normalizeFill(inSvg.fill) === normalizeFill(onCanvas.fill ?? ''),
      });
    }
    seen[seen.length - 1].svgFile = `release-123-theme${i + 1}-${themeId}.svg`;
    seen[seen.length - 1].perturbApplied = perturbed.changed;
    seen[seen.length - 1].vb = vb;
    seen[seen.length - 1].bgFill = bgFill;
    seen[seen.length - 1].svgCmp = svgCmp;

    // PNG：解码（签名 + IHDR）+ 逐节点区域有效内容（PNG = 导出 SVG 的 scale 倍栅格化，坐标可精确映射）
    const dlPng = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
    await clickText('导出 PNG');
    const pngDl = await dlPng;
    const pngBuf = pngDl === null ? Buffer.alloc(0) : readFileSync(await pngDl.path());
    writeFileSync(join(EXPORTS, `release-123-theme${i + 1}-${themeId}.png`), pngBuf);
    const png = parsePngHeader(pngBuf);
    const scale = vb === null || png.width === 0 ? 0 : png.width / vb.w;
    const regions =
      vb === null || scale <= 0
        ? []
        : ['发布验收根', '分支甲', '叶子甲二']
            .map((l) => ({ label: l, n: svgNode(svgRaw, l) }))
            .filter((r) => r.n !== null)
            .map((r) => ({
              label: r.label,
              x: (r.n.x - vb.x) * scale + 1,
              y: (r.n.y - vb.y) * scale + 1,
              w: Math.max(1, r.n.w * scale - 2),
              h: Math.max(1, r.n.h * scale - 2),
            }));
    const drawn =
      pngDl === null ? null : await pngPixelStats(page, pngBuf, { bg: bgFill, regions });
    seen[seen.length - 1].png = { ...png, ...(drawn ?? {}) };
  }
  check(
    'R2a 三主题：每个主题身份对应的 root/branch/leaf 字号 == 该主题 token 声明值且严格阶梯',
    seen.length === 3 && seen.every((s) => s.identityOk && s.strict),
    {
      themes: seen.map(({ i, themeId, pressed, root, branch, leaf, expectSize, identityOk, strict }) => ({
        i,
        themeId,
        pressed,
        root,
        branch,
        leaf,
        expectSize,
        identityOk,
        strict,
      })),
    },
  );
  check(
    'R2b 绘制度量一致：文字包围盒不溢出节点盒 + 描述区可见',
    seen.every((s) => s.fit !== null && s.fit.textW <= s.fit.boxW - 2 && s.descVisible),
    { fits: seen.map((s) => ({ i: s.i, fit: s.fit, descVisible: s.descVisible })) },
  );
  check(
    'R2c 输入命中一致：双击命中该节点且编辑框字号 == 绘制字号',
    seen.every((s) => s.hitOk),
    {
      rows: seen.map((s) => ({
        i: s.i,
        editorFont: s.editorFont,
        branch: s.branch,
        editorScale: s.editorScale,
        editorText: s.editorText,
        hitOk: s.hitOk,
      })),
    },
  );
  check(
    'R2d SVG 逐节点字号 + 颜色与画布一致（三主题；neg-theme 下为扰动副本 → 必须红）',
    seen.every((s) => s.svgCmp.length === 3 && s.svgCmp.every((c) => c.ok)),
    {
      perTheme: seen.map((s) => ({ i: s.i, themeId: s.themeId, perturbApplied: s.perturbApplied, svgCmp: s.svgCmp })),
    },
  );
  check(
    'R2e PNG 解码：签名/尺寸合法 + 三节点区域各有非背景内容（背景取自导出件，逐主题对照）',
    seen.every(
      (s) =>
        s.png.signature === true &&
        s.png.width > 200 &&
        s.png.height > 200 &&
        s.bgFill !== null &&
        s.png.regions !== undefined &&
        s.png.regions.length === 3 &&
        s.png.regions.every((r) => r.ratio >= 0.01 && r.colors >= 2),
    ),
    {
      perTheme: seen.map((s) => ({
        i: s.i,
        themeId: s.themeId,
        bg: s.bgFill,
        png: {
          signature: s.png.signature,
          width: s.png.width,
          height: s.png.height,
          bitDepth: s.png.bitDepth,
          regions: s.png.regions,
        },
      })),
    },
  );
  check(
    'R2h 叶标题不落入幕布注释带（≠ muted；glass 更亮）+ desc 用 muted',
    seen.every((s) => {
      const leafSum = channelSum(s.leafFill ?? '');
      const mutedSum = channelSum(MUTED);
      const notMuted = normalizeFill(s.leafFill ?? '') !== normalizeFill(MUTED);
      const descendOk = s.descFill === null || normalizeFill(s.descFill) === normalizeFill(MUTED);
      const glassOk = s.themeId !== 'glass' || (leafSum !== null && mutedSum !== null && leafSum > mutedSum);
      return notMuted && descendOk && glassOk;
    }),
    {
      rows: seen.map((s) => ({
        themeId: s.themeId,
        leafFill: s.leafFill,
        leafSum: channelSum(s.leafFill ?? ''),
        mutedSum: channelSum(MUTED),
        descFill: s.descFill,
      })),
    },
  );
  check('R2f 导出原件已落盘（本轮独占目录 exports/）', seen.length === 3, {
    dir: EXPORTS,
    files: seen.map((s) => `${s.svgFile} / release-123-theme${s.i + 1}-${s.themeId}.png`),
  });
});

/* ───────────────── R3 框 / 中心 / 跨框边 / 升格·拖动·总览 ───────────────── */
await journey('R3', async () => {
  await openFixture('main');
  const shells = await count('[data-frame-shell]');
  const rows = await count('[data-frame-row]');
  const hangs = await count('[data-frame-hang="true"]');
  check('R3a 主夹具框：框壳 / 大纲行 / 挂出行渲染', shells >= 1 && rows >= 1 && hangs >= 1, {
    shells,
    rows,
    hangs,
  });
  await saveShot('release-123-03-frame.png');

  // 框内编辑：编辑框不得压在挂出节点上
  const row = page.locator('[data-frame-row]').first();
  const rb = await row.boundingBox();
  if (rb !== null) await page.mouse.dblclick(rb.x + rb.width / 2, rb.y + rb.height / 2);
  const editor = page.locator('[data-overlay-editor]').first();
  const editorShown = await editor
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  const hangId = await nodeIdOf('框内挂出子');
  const eb = editorShown ? await editor.boundingBox() : null;
  const hb = hangId === null ? null : await nodeBoxById(hangId);
  const overlap =
    eb !== null && hb !== null && eb.x < hb.x + hb.w && eb.x + eb.width > hb.x && eb.y < hb.y + hb.h && eb.y + eb.height > hb.y;
  if (editorShown) await page.keyboard.press('Escape');
  await wait(200);
  check('R3b 框内编辑：编辑框不与挂出节点重叠', editorShown && overlap === false, {
    editorShown,
    editorBox: eb,
    hangBox: hb,
    overlap,
  });

  // ── GEO-FRAME：框壳包含所属行；同壳内相邻行不重叠；挂出行不与普通行重叠；外部卡不压框壳 ──
  const frameGeo = await page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    return {
      shells: [...document.querySelectorAll('[data-frame-shell]')].map((el) => ({
        root: el.getAttribute('data-frame-root'),
        box: box(el),
        rows: [...el.querySelectorAll('[data-frame-row]')].map((r) => ({
          label: (r.textContent ?? '').trim(),
          hang: r.getAttribute('data-frame-hang') === 'true',
          box: box(r),
        })),
      })),
      svgNodes: [...document.querySelectorAll('g[data-node-id]')].map((el) => ({
        label: (el.textContent ?? '').trim(),
        box: box(el),
      })),
    };
  });
  const interArea = (a, b) =>
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inside = (inner, outer, tol = 0.5) =>
    inner.x >= outer.x - tol &&
    inner.y >= outer.y - tol &&
    inner.x + inner.w <= outer.x + outer.w + tol &&
    inner.y + inner.h <= outer.y + outer.h + tol;
  const frameDiag = frameGeo.shells.map((s) => {
    const plain = s.rows.filter((r) => !r.hang);
    const hangs = s.rows.filter((r) => r.hang);
    const rowOverlaps = [];
    for (let i = 0; i < plain.length; i += 1) {
      for (let j = i + 1; j < plain.length; j += 1) {
        const a = interArea(plain[i].box, plain[j].box);
        if (a > 0.5) rowOverlaps.push({ a: plain[i].label, b: plain[j].label, area: Math.round(a) });
      }
    }
    const hangOverlaps = [];
    for (const h of hangs) {
      for (const r of plain) {
        const a = interArea(h.box, r.box);
        if (a > 0.5) hangOverlaps.push({ hang: h.label, row: r.label, area: Math.round(a) });
      }
    }
    return {
      root: s.root,
      rows: s.rows.length,
      plain: plain.length,
      hangs: hangs.length,
      rowsInsideShell: s.rows.every((r) => inside(r.box, s.box)),
      notInside: s.rows.filter((r) => !inside(r.box, s.box)).map((r) => r.label),
      rowOverlaps,
      hangOverlaps,
    };
  });
  // 外部卡（不属于该框的 SVG 节点）不得压在框壳上
  const outsideLabels = ['发布验收根', '分支甲', '叶子甲一', '叶子甲二'];
  const externalOverlaps = [];
  for (const s of frameGeo.shells) {
    for (const n of frameGeo.svgNodes) {
      if (!outsideLabels.some((l) => n.label.includes(l))) continue;
      const a = interArea(s.box, n.box);
      if (a > 0.5) externalOverlaps.push({ shell: s.root, node: n.label, area: Math.round(a) });
    }
  }
  check(
    'R3i 框壳包含所属行 + 相邻行/挂出行互不重叠 + 外部卡不压框壳（同一视口变换下比较）',
    frameDiag.length >= 1 &&
      frameDiag.every((d) => d.rows >= 2 && d.rowsInsideShell && d.rowOverlaps.length === 0 && d.hangOverlaps.length === 0) &&
      externalOverlaps.length === 0,
    { frameDiag, externalOverlaps },
  );

  // ── 嵌套框夹具：框内成框（空间挂载层允许成框）──
  await openFixture('nested');
  await fitView();
  const nestedGeo = await page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const shells = [...document.querySelectorAll('[data-frame-shell]')].map((el) => ({
      root: el.getAttribute('data-frame-root'),
      rows: [...el.querySelectorAll('[data-frame-row]')].map((r) => ({
        id: r.getAttribute('data-frame-node'),
        text: (r.textContent ?? '').trim(),
        hang: r.getAttribute('data-frame-hang') === 'true',
        box: box(r),
      })),
      box: box(el),
    }));
    const rowIds = shells.flatMap((s) => s.rows.map((r) => r.id));
    return {
      shells,
      rowIds,
      duplicatedRowIds: rowIds.filter((id, i) => rowIds.indexOf(id) !== i),
      labels: [...document.querySelectorAll('g[data-node-id], [data-frame-row]')].map((el) =>
        (el.textContent ?? '').trim(),
      ),
    };
  });
  await saveShot('release-123-03-nested-frame.png');
  const shellOf = (needle) =>
    nestedGeo.shells.find((s) => s.rows[0] !== undefined && s.rows[0].text.includes(needle)) ?? null;
  const outerShell = shellOf('外框');
  const innerShell = shellOf('内框');
  const rowsInsideOwnShell = nestedGeo.shells.every((s) => s.rows.every((r) => inside(r.box, s.box)));
  const rowOverlapWithin = [];
  for (const s of nestedGeo.shells) {
    for (let i = 0; i < s.rows.length; i += 1) {
      for (let j = i + 1; j < s.rows.length; j += 1) {
        const a = interArea(s.rows[i].box, s.rows[j].box);
        if (a > 0.5) rowOverlapWithin.push({ shell: s.root, a: s.rows[i].text, b: s.rows[j].text, area: Math.round(a) });
      }
    }
  }
  /**
   * 断言口径（与产品实际契约一致，不硬套「内壳被外壳几何包含」）：
   * 挂出子树在**空间挂载层**上成框 —— 内层壳会落在**外壳旁边**（挂出外包络不属于
   * `[data-frame-shell]` 的盒），所以本项检查「各自成壳 + 每壳的行都在自己的壳内 + 行互不重叠
   * + 没有任何节点被两个壳重复当成行」，不要求两壳彼此不相交（计划 T4 同款口径）。
   */
  check(
    'R3j 嵌套框：外层框与内层框各自成壳（两个壳根），每壳的行在自己壳内且互不重叠，节点无重复成行',
    nestedGeo.shells.length === 2 &&
      outerShell !== null &&
      innerShell !== null &&
      outerShell.root !== innerShell.root &&
      outerShell.rows.some((r) => r.text.includes('外框行')) &&
      innerShell.rows.some((r) => r.text.includes('内框行一')) &&
      innerShell.rows.some((r) => r.text.includes('内框行二')) &&
      rowsInsideOwnShell &&
      rowOverlapWithin.length === 0 &&
      nestedGeo.duplicatedRowIds.length === 0,
    {
      shells: nestedGeo.shells,
      labels: nestedGeo.labels.slice(0, 12),
      rowsInsideOwnShell,
      rowOverlapWithin,
      duplicatedRowIds: nestedGeo.duplicatedRowIds,
      outerRoot: outerShell?.root ?? null,
      innerRoot: innerShell?.root ?? null,
    },
  );

  // ── 中心夹具：嵌套中心（祖先中心 → 子孙中心）+ 跨框边端点 ──
  await openFixture('centers');
  await fitView(); // 打开新文档后先适配视图：端点/壳都在视口内，截图可人工核验
  const cLabels = await nodeLabels();
  const cShells = await page.evaluate(() =>
    [...document.querySelectorAll('[data-frame-shell]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    }),
  );
  const centersInDom = await page.evaluate(() =>
    [...document.querySelectorAll('[data-center]')].map((el) => el.getAttribute('data-center')),
  );
  const nestedCenterLabel = '甲内嵌套中心';
  check(
    'R3c 中心夹具：三中心角标（含**子孙嵌套中心**）且框壳渲染',
    centersInDom.length === 3 && cShells.length >= 1 && cLabels.includes(nestedCenterLabel),
    { centersInDom, shells: cShells, hasNested: cLabels.includes(nestedCenterLabel) },
  );
  await saveShot('release-123-03-centers.png');

  // 跨框边：按语义身份定位端点（夹具的跨框边 = cid:c7（甲内框子一）→ cid:c4（乙挂出一））。
  // neg-endpoints **不改这里的期望对**，而是把目标端点写进独立夹具副本（见文件头）。
  const pairs = { from: '甲内框子一', to: '乙挂出一' };
  const fromId = await nodeIdOf(pairs.from);
  const toId = await nodeIdOf(pairs.to);
  const fb = fromId === null ? null : await nodeBoxById(fromId);
  const tb = toId === null ? null : await nodeBoxById(toId);
  // 视口内同时可见（截图可人工核验双方端点）
  const visible = (b) => b !== null && b.x > 0 && b.y > 0 && b.x + b.w < 1440 && b.y + b.h < 900;
  const bothVisible = visible(fb) && visible(tb);
  // 语义身份判定：对每条候选连线，取「其起点最近的是哪个节点 / 终点最近的是哪个节点」，
  // 必须分别等于期望的 from / to —— 不用魔法容差，而是用「最近节点唯一性」钉住端点归属。
  const endpoints =
    fb === null || tb === null
      ? null
      : await page.evaluate(
    ({ fLabel, tLabel }) => {
      const distTo = (px, py, b) => {
        const dx = Math.max(b.x - px, 0, px - (b.x + b.w));
        const dy = Math.max(b.y - py, 0, py - (b.y + b.h));
        return Math.hypot(dx, dy);
      };
      const nodes = [];
      for (const el of document.querySelectorAll('g[data-node-id], [data-frame-node]')) {
        const id = el.getAttribute('data-node-id') ?? el.getAttribute('data-frame-node');
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        nodes.push({ id, label: (el.textContent ?? '').trim(), box: { x: r.x, y: r.y, w: r.width, h: r.height } });
      }
      const nearest = (px, py) => {
        let best = null;
        for (const n of nodes) {
          const d = distTo(px, py, n.box);
          if (best === null || d < best.d) best = { d: Math.round(d * 10) / 10, label: n.label, id: n.id };
        }
        return best;
      };
      const rows = [];
      for (const el of document.querySelectorAll('path, line, polyline')) {
        if (el.closest('[data-frame-shell]')) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 40 && r.height < 40) continue; // 只考量跨屏的连线
        // **真实端点**：path 用 getPointAtLength（曲线 bbox 角点不是端点）；line 用 x1/y1/x2/y2
        let a = null;
        let b = null;
        if (el.tagName.toLowerCase() === 'line') {
          a = [Number(el.getAttribute('x1')), Number(el.getAttribute('y1'))];
          b = [Number(el.getAttribute('x2')), Number(el.getAttribute('y2'))];
        } else if (typeof el.getTotalLength === 'function') {
          const svg = el.ownerSVGElement;
          const ctm = el.getScreenCTM();
          const toScreen = (pt) => {
            const p = svg.createSVGPoint();
            p.x = pt.x;
            p.y = pt.y;
            const q = p.matrixTransform(ctm);
            return [q.x, q.y];
          };
          const len = el.getTotalLength();
          a = toScreen(el.getPointAtLength(0));
          b = toScreen(el.getPointAtLength(len));
        }
        if (a === null || b === null) continue;
        const s = nearest(a[0], a[1]);
        const e = nearest(b[0], b[1]);
        rows.push({
          startLabel: s?.label ?? null,
          endLabel: e?.label ?? null,
          startDist: s?.d ?? null,
          endDist: e?.d ?? null,
          span: Math.round(r.width),
        });
      }
      const match = rows.find(
        (r) => r.startLabel !== null && r.startLabel.includes(fLabel) && r.endLabel !== null && r.endLabel.includes(tLabel),
      );
      return { match: match ?? null, rows: rows.slice(0, 6), links: rows.length, nodeCount: nodes.length };
    },
      { fLabel: pairs.from, tLabel: pairs.to },
    );
  check(
    'R3d 跨框边端点按语义身份命中两端点节点（起/终最近节点分别等于期望对）',
    bothVisible && endpoints !== null && endpoints.match !== null,
    { pairs, fromId, toId, fromBox: fb, toBox: tb, bothVisible, endpoints },
  );
  await saveShot('release-123-03-cross-frame-edge.png');

  // ── 中心拖动：整岛成员（含**嵌套中心**成员）同向等量跟移 ──
  const centerId = await nodeIdOf('甲中心');
  const members = [
    '甲中心',
    '甲框内一',
    '甲框内二',
    '甲挂出一',
    '甲挂出子一',
    '甲内嵌套中心',
    '甲内嵌套子一',
    '甲内成框',
    '甲内框子一',
  ];
  /**
   * DF-R3：拖中心必须同时保护**另一岛**与**视口**。
   * 只比「甲岛成员同向位移」是不够的 —— 整体视口平移也会让全部成员同时位移而判绿。
   * 因此同批采样：甲岛成员（应位移 +140/+90）、乙岛成员（应**不动**）、世界变换（应**逐值不变**）。
   */
  const otherIsland = ['乙中心', '乙框内一', '乙框内二', '乙挂出一'];
  const before = {};
  for (const m of [...members, ...otherIsland]) {
    const id = await nodeIdOf(m);
    if (id !== null) before[m] = await nodeBoxById(id);
  }
  const tBeforeDrag = await worldTransform();
  const cb = centerId === null ? null : await nodeBoxById(centerId);
  if (cb !== null) {
    await page.mouse.move(cb.x + cb.w / 2, cb.y + cb.h / 2);
    await page.mouse.down();
    await page.mouse.move(cb.x + cb.w / 2 + 140, cb.y + cb.h / 2 + 90, { steps: 10 });
    await page.mouse.up();
    await wait(900);
  }
  const after = {};
  for (const m of [...members, ...otherIsland]) {
    const id = await nodeIdOf(m);
    if (id !== null) after[m] = await nodeBoxById(id);
  }
  const tAfterDrag = await worldTransform();
  const deltas = Object.keys(before)
    .filter((m) => members.includes(m) && after[m] !== undefined)
    .map((m) => ({ m, dx: after[m].x - before[m].x, dy: after[m].y - before[m].y }));
  const otherDeltas = Object.keys(before)
    .filter((m) => otherIsland.includes(m) && after[m] !== undefined)
    .map((m) => ({ m, dx: after[m].x - before[m].x, dy: after[m].y - before[m].y }));
  const nestedMoved = deltas.find((d) => d.m === '甲内嵌套子一');
  check(
    'R3g 中心拖动：整岛（含嵌套中心与框）成员同向等量跟移（≥6 成员，±5px）',
    deltas.length >= 6 &&
      deltas.every((d) => Math.abs(d.dx - 140) < 6 && Math.abs(d.dy - 90) < 6) &&
      nestedMoved !== undefined,
    { deltas, centerId },
  );
  check(
    'R3g2 中心拖动：**另一岛成员不移动**（≤1px）且**世界变换逐值不变**（排除整体视口平移冒充岛位移）',
    otherDeltas.length >= 3 &&
      otherDeltas.every((d) => Math.abs(d.dx) <= 1 && Math.abs(d.dy) <= 1) &&
      tBeforeDrag !== null &&
      tBeforeDrag === tAfterDrag,
    { otherDeltas, otherIsland, tBeforeDrag, tAfterDrag },
  );
  await saveShot('release-123-03-center-drag.png');

  // ── 升格：右键 → 升为中心 → 角标 + 落盘 ──
  // 升格目标选**非框内**子树节点：框内节点升格可能受框语义限制（本轮不新增产品能力）
  const promoteLabel = '乙挂出一';
  const promoteId = await nodeIdOf(promoteLabel);
  await page.keyboard.press('Escape'); // 清掉拖拽后的选中态，避免右键落在选中装饰上
  await fitView(); // 拖动后视野可能偏移 → 先适配，保证目标在视口内
  // 直接在节点矩形上派发 contextmenu（坐标取自真实布局，避免鼠标路径命中装饰元素）
  const rightClicked = await page.evaluate((id) => {
    const rect = document.querySelector(`g[data-node-id="${id}"] rect`);
    if (!rect) return false;
    const r = rect.getBoundingClientRect();
    rect.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: r.x + r.width / 2,
        clientY: r.y + r.height / 2,
        button: 2,
      }),
    );
    return true;
  }, promoteId);
  await wait(600);
  const menuShown = await has('[data-context-menu]');
  const menuItemsSeen = await page.evaluate(() =>
    [...document.querySelectorAll('[data-context-menu] div')]
      .map((el) => (el.textContent ?? '').trim())
      .filter((t) => t.length > 0 && t.length < 24)
      .slice(0, 24),
  );
  /**
   * 点菜单行：行 DOM 文本是「标签 + 快捷键提示」拼接（如「升为中心（钉住坐标）环：更多›」），
   * 且行有 onClick 但无 role=button → 用**最内层**以标签开头的 div 触发 JS click
   * （Playwright 的 getByText 精确匹配会因提示后缀失配）。
   */
  const clickMenuRow = (prefix) =>
    page.evaluate((p) => {
      const rows = [...document.querySelectorAll('[data-context-menu] div')].filter(
        (d) => d.querySelector('div') === null && (d.textContent ?? '').trim().startsWith(p),
      );
      const el = rows[rows.length - 1];
      if (!el) return false;
      el.click();
      return true;
    }, prefix);
  const promoteFound = await clickMenuRow('升为中心（钉住坐标）');
  await wait(700);
  const dirFound = await clickMenuRow('靠右生长');
  await wait(1200);
  const badgeAfter = await page.evaluate(
    (i) => document.querySelector(`[data-center="${i}"]`) !== null,
    promoteId,
  );
  const noticeAfter = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find((d) =>
      (d.textContent ?? '').includes('未提交') || (d.textContent ?? '').includes('不可'),
    );
    return el === undefined ? null : el.textContent.slice(0, 120);
  });
  check('R3e 升格：右键菜单 → 升为中心 → 该节点出现中心角标（按 id）', menuShown && badgeAfter, {
    menuShown,
    rightClicked,
    promoteId,
    badgeAfter,
    noticeAfter,
    menuItems: menuItemsSeen,
    promoteItemFound: promoteFound,
    dirItemFound: dirFound,
    centersInDom: await page.evaluate(() =>
      [...document.querySelectorAll('[data-center]')].map((el) => el.getAttribute('data-center')),
    ),
  });

  const savedCenter = await saveViaClick('md');
  const centerSnap = await lastWriteText('md');
  check(
    'R3f 升格落盘：本次新完成写入 + 快照含 centers 条目与坐标',
    savedCenter.newCommit &&
      centerSnap.includes('centers:') &&
      /\bx:\s*-?[\d.]+/.test(centerSnap) &&
      /\by:\s*-?[\d.]+/.test(centerSnap),
    { bytes: centerSnap.length, save: savedCenter },
  );

  // 总览动态：k < 0.35 出岛卡（含**嵌套迷你卡**）；回 full 收起
  await page.mouse.move(720, 450);
  for (let i = 0; i < 60; i++) {
    const k = await zoomOf();
    if (k !== null && k < 0.33) break;
    await page.mouse.wheel(0, 150);
    await wait(70);
  }
  await wait(900);
  const kOver = await zoomOf();
  const cards = await count('[data-island-overview]');
  const nestedMiniCards = await count('[data-island-overview-nested]');
  const cardRoots = await page.evaluate(() =>
    [...document.querySelectorAll('[data-island-overview]')].map((el) =>
      el.getAttribute('data-island-overview'),
    ),
  );
  await saveShot('release-123-03-overview.png');
  for (let i = 0; i < 60; i++) {
    const k = await zoomOf();
    if (k !== null && k >= 0.62) break;
    await page.mouse.wheel(0, -150);
    await wait(70);
  }
  await wait(800);
  const kBack = await zoomOf();
  const cardsBack = await count('[data-island-overview]');
  const fullLabels = (await nodeLabels()).length;
  check(
    'R3h 总览动态：k<0.35 出现岛总览卡（含嵌套迷你卡），回 full 收起且节点恢复',
    cards >= 1 &&
      kOver !== null &&
      kOver < 0.35 &&
      nestedMiniCards >= 1 &&
      cardsBack === 0 &&
      fullLabels >= 4,
    { kOver, cards, nestedMiniCards, cardRoots, kBack, cardsBack, fullLabels },
  );
});

/* ───────────────── R4 LOD：两阈值来回缩放过程采样 ───────────────── */
await journey('R4', async () => {
  await openFixture('main'); // R3 结束时停在中心夹具 → 回到主夹具再做 LOD 采样
  await fitView();
  await wait(500);
  /** 单方向采样：返回 [{k, lod, labels}]；steps 为滚轮步数 */
  const sweep = async (dir, steps = 26) => {
    await page.mouse.move(720, 450);
    const samples = [];
    for (let i = 0; i < steps; i++) {
      const k = await zoomOf();
      const lod = await hudRow('LOD');
      const labels = (await nodeLabels()).length;
      samples.push({ k, lod, labels });
      await page.mouse.wheel(0, dir * 90);
      await wait(90);
    }
    return samples;
  };
  /**
   * 页内一次性读 k + LOD + 时间戳（同一次 evaluate，避免两次往返把「冻结窗口」耗掉）。
   * 手势冻结窗口 = 最后一次 wheel 后 120ms（见 MapView 的 `scheduleGestureRelease`）。
   */
  const lodSnap = (label) =>
    page.evaluate((tag) => {
      const tf = document.querySelector('svg')?.querySelector('g')?.getAttribute('transform') ?? '';
      const m = /scale\(\s*([\d.]+)/.exec(tf);
      let lod = null;
      for (const row of document.querySelectorAll('div')) {
        const spans = row.children;
        if (spans.length === 2 && spans[0].textContent?.trim() === 'LOD') {
          lod = spans[1].textContent?.trim() ?? null;
          break;
        }
      }
      return { tag, k: m === null ? null : Number(m[1]), lod, t: performance.now() };
    }, label);

  /**
   * 缩放到目标 k。滚轮每格是**乘性**缩放（`zoomAt(k, exp(-deltaY*0.0016))`）：
   * 固定步长会在目标附近反复越过（实测 0.4947 ↔ 0.5107 来回 140 格仍不落点），
   * 因此步长随距离自适应、下限 4 格（k≈0.5 时约 0.3%，k≈0.25 时约 0.16%）：既收敛，也不跨出滞回带。
   */
  const zoomTo = async (target, maxSteps = 120) => {
    await page.mouse.move(720, 450);
    for (let i = 0; i < maxSteps; i += 1) {
      const k = await zoomOf();
      if (k === null) {
        await wait(70);
        continue;
      }
      const diff = k - target;
      if (Math.abs(diff) <= 0.004) return k;
      const step = Math.max(4, Math.min(160, Math.round(Math.abs(diff) * 400)));
      await page.mouse.wheel(0, diff > 0 ? step : -step);
      await wait(70);
    }
    return await zoomOf();
  };
  const lodStop = async (target) => {
    const k = await zoomTo(target);
    await wait(260); // > 120ms：等手势释放，LOD 才会按当前 k 重算
    return { target, k, lod: await hudRow('LOD') };
  };

  const outbound = await sweep(1); // 缩小
  await wait(600);
  const inbound = await sweep(-1); // 放大
  await wait(600);

  const detailRank = { full: 3, detail: 2, skeleton: 1, badge: 0 };
  /**
   * 单调性按**缩放方向**分组判定（不假设采样从 full 开始）：
   * 取相邻样本对，k 下降的那些对里 LOD 不得回升；k 上升的对里 LOD 不得下降。
   * 与 R3 结束时的残留缩放状态无关，因此方向混入不会造成假红/假绿。
   */
  /**
   * 判据 = **档位序列在单次手势内不反向**：
   *   缩小（outbound）：rank 序列非增；放大（inbound）：rank 序列非减。
   * 只看档位序列（不看 k 的逐点升降）——滚轮到缩放上/下限会被钳住并回弹
   * （实测 4.564 → 4.555 → 4.32），那种 k 微回弹不是 LOD 抖动。
   * 真抖动（如 full→detail→full）会让序列反向 → 判红。
   */
  const rankSeq = (samples) =>
    samples.map((s) => detailRank[s.lod] ?? null).filter((r) => r !== null);
  const nonIncreasing = (seq) => seq.every((r, i) => i === 0 || seq[i - 1] >= r);
  const nonDecreasing = (seq) => seq.every((r, i) => i === 0 || seq[i - 1] <= r);
  const monotone = (samples, dir) => {
    const seq = rankSeq(samples);
    return seq.length >= 2 && (dir === 'out' ? nonIncreasing(seq) : nonDecreasing(seq));
  };
  /**
   * 抖动检测（LOD 口径）：同一次单向缩放里，**档位不得回到已离开过的档**
   * （如 full → detail → full）。标签数会被视口裁剪影响（放大到远离节点时归零），
   * 所以只作证据记录、不作判据。
   */
  const lodOscillates = (samples) => {
    const seen = new Set();
    let prev = null;
    for (const s of samples) {
      const r = detailRank[s.lod] ?? null;
      if (r === null) continue;
      if (prev !== null && r !== prev) {
        // 换档：若目标档此前出现过且不是紧邻回退，视为振荡
        if (seen.has(r) ) return true;
      }
      if (prev !== null) seen.add(prev);
      prev = r;
    }
    return false;
  };
  check(
    'R4a 缩小方向：LOD 档位序列非增（不在阈值处来回）',
    monotone(outbound, 'out') && lodOscillates(outbound) === false,
    {
      monotone: monotone(outbound, 'out'),
      oscillates: lodOscillates(outbound),
      rankSeq: rankSeq(outbound),
      lod: outbound.map((s) => s.lod),
      k: outbound.map((s) => (s.k === null ? null : Math.round(s.k * 1000) / 1000)),
      labels: outbound.map((s) => s.labels),
    },
  );
  check(
    'R4b 放大方向：LOD 档位序列非减（不在阈值处来回）',
    monotone(inbound, 'in') && lodOscillates(inbound) === false,
    {
      monotone: monotone(inbound, 'in'),
      oscillates: lodOscillates(inbound),
      rankSeq: rankSeq(inbound),
      lod: inbound.map((s) => s.lod),
      k: inbound.map((s) => (s.k === null ? null : Math.round(s.k * 1000) / 1000)),
      labels: inbound.map((s) => s.labels),
    },
  );
  const minOut = Math.min(...outbound.map((s) => s.k ?? 9));
  const maxIn = Math.max(...inbound.map((s) => s.k ?? 0));
  // DF-R3：跨阈值判定必须用**真实阈值**（0.26 / 0.5），不得用「<0.35 / ≥0.6」这类宽松近似替代
  check(
    `R4c 来回缩放确实跨越两阈值（实测最低 < LOD_DETAIL_K=${LOD_DETAIL_K} 且最高 ≥ LOD_FULL_K=${LOD_FULL_K}）`,
    minOut < LOD_DETAIL_K && maxIn >= LOD_FULL_K,
    { minOut, maxIn, LOD_DETAIL_K, LOD_FULL_K },
  );
  await fitView(); // 采样结束后视野可能停在小区域（裁剪会隐藏远处节点）→ 先适配再断言可读性
  const leafFont = (await fontOf('叶子甲一改')) ?? (await fontOf(LEAF));
  check('R4d 回到 full 档可读（leaf 字号 ≥ 8px）', leafFont !== null && leafFont >= 8, { leafFont });
  /**
   * 阈值邻域静止稳定（DF-R3 修正）：停在阈值附近不缩放，多次采样档位/标签集合必须逐次一致。
   *
   * 修正点：原实现把「有限循环用尽」也当成到达 —— 复核实测 near05 落在 k=0.5349（超出自身
   * 搜索目标 0.5±0.02）却仍判 PASS。现在**实际落点必须落在目标 ±0.02 内**才算到达；
   * 用尽预算仍未到达 → `reached=false`，检查判红并如实报告未到达。
   */
  const neighborhoodStable = async (targetK, tolerance = 0.02) => {
    await page.mouse.move(720, 450);
    let k = await zoomOf();
    let steps = 0;
    for (; steps < 120; steps += 1) {
      k = await zoomOf();
      if (k !== null && Math.abs(k - targetK) <= tolerance) break;
      const diff = k === null ? 0 : k - targetK;
      const step = Math.max(4, Math.min(160, Math.round(Math.abs(diff) * 400)));
      await page.mouse.wheel(0, diff > 0 ? step : -step);
      await wait(70);
    }
    const kAtStart = await zoomOf();
    const reached = kAtStart !== null && Math.abs(kAtStart - targetK) <= tolerance;
    const lodSamples = [];
    const labelSamples = [];
    for (let i = 0; i < 8; i++) {
      lodSamples.push(await hudRow('LOD'));
      labelSamples.push((await nodeLabels()).join(','));
      await wait(160);
    }
    // 首帧可能仍在上一状态（滚轮循环刚结束）→ 允许第 1 次采样后落定，此后必须逐次一致
    const lodStable = lodSamples.slice(1).every((v) => v === lodSamples[1] && v !== null);
    const labelStable = labelSamples.slice(1).every((v) => v === labelSamples[1]);
    return {
      targetK,
      tolerance,
      kAtStart,
      kAtEnd: await zoomOf(),
      steps,
      reached,
      lodStable,
      labelStable,
      lodSamples,
      labelCounts: labelSamples.map((s) => s.split(',').filter((x) => x.length > 0).length),
    };
  };
  const near05 = await neighborhoodStable(LOD_FULL_K);
  const near026 = await neighborhoodStable(LOD_DETAIL_K);
  check(
    `R4e 阈值邻域静止采样稳定（k≈${LOD_FULL_K} / ${LOD_DETAIL_K} 各 8 次：实际落点在 ±0.02 内、档位恒定、标签集合落定后一致）`,
    near05.reached &&
      near05.lodStable &&
      near05.labelStable &&
      near026.reached &&
      near026.lodStable &&
      near026.labelStable,
    { near05, near026 },
  );
  check(
    'R4f 检测器自检：档位反复被判为真、单调样本被判为假',
    lodOscillates([
      { lod: 'full' },
      { lod: 'detail' },
      { lod: 'full' },
    ]) === true &&
      lodOscillates([{ lod: 'full' }, { lod: 'detail' }, { lod: 'skeleton' }]) === false,
    {},
  );
  /**
   * R4g 滞回带旅程（真实 wheel）：`LOD_HYSTERESIS` 使**同一个 k** 在「从 full 下来」时
   * 仍判 full（k ≥ 0.5−0.02），在「从 detail 上来」时仍判 detail（k < 0.5）——进出档取不同阈值。
   * 逐点记录实际落到的 k（滚轮落点不精确，判据用**实测 k** 而非目标值）。
   */
  const FULL_BAND = [LOD_FULL_K - LOD_HYSTERESIS, LOD_FULL_K]; // [0.48, 0.50)
  await lodStop(0.56); // 先稳稳站在 full 上
  const hStart = { k: await zoomOf(), lod: await hudRow('LOD') };
  const h1 = await lodStop(0.49); // 从 full 下来，停在滞回带内 → 应仍 full
  const h2 = await lodStop(0.465); // 越过 0.48 → detail
  const h3 = await lodStop(0.49); // 从 detail 上来，未达 0.5 → 应仍 detail
  const h4 = await lodStop(0.505); // 达 0.5 → full
  const inFullBand = (s) => s.k !== null && s.k >= FULL_BAND[0] && s.k < FULL_BAND[1];
  check(
    `R4g full 档滞回带（真实 wheel）：同一 k∈[${FULL_BAND[0]},${FULL_BAND[1]}) 从 full 下来仍 full、从 detail 上来仍 detail；≥${LOD_FULL_K} 回 full`,
    hStart.lod === 'full' &&
      inFullBand(h1) &&
      h1.lod === 'full' &&
      h2.k !== null &&
      h2.k < FULL_BAND[0] &&
      h2.lod === 'detail' &&
      inFullBand(h3) &&
      h3.lod === 'detail' &&
      h4.k !== null &&
      h4.k >= LOD_FULL_K &&
      h4.lod === 'full',
    { hStart, h1, h2, h3, h4, band: `[${FULL_BAND[0]}, ${FULL_BAND[1]})` },
  );

  /**
   * R4i detail 档滞回带（DF-R3 补齐的第二阈值侧）：`LOD_DETAIL_K=0.26`、滞回 0.02 →
   * 带 = [0.24, 0.26)。同一个 k≈0.25 从 detail 下来仍 detail、从 skeleton 上来仍 skeleton。
   */
  const DETAIL_BAND = [LOD_DETAIL_K - LOD_HYSTERESIS, LOD_DETAIL_K]; // [0.24, 0.26)
  await lodStop(0.55); // 先回到 full，再从上方一路下来建立 detail
  const d0 = await lodStop(0.3); // < 0.5 且 ≥ 0.26 → detail
  const d1 = await lodStop(0.25); // 从 detail 下来，停在带内 → 应仍 detail
  const d2 = await lodStop(0.23); // 越过 0.24 → skeleton
  const d3 = await lodStop(0.25); // 从 skeleton 上来，未达 0.26 → 应仍 skeleton
  const d4 = await lodStop(0.27); // 达 0.26 → detail
  const inDetailBand = (s) => s.k !== null && s.k >= DETAIL_BAND[0] && s.k < DETAIL_BAND[1];
  check(
    `R4i detail 档滞回带（真实 wheel）：同一 k∈[${DETAIL_BAND[0]},${DETAIL_BAND[1]}) 从 detail 下来仍 detail、从 skeleton 上来仍 skeleton；≥${LOD_DETAIL_K} 回 detail`,
    d0.lod === 'detail' &&
      inDetailBand(d1) &&
      d1.lod === 'detail' &&
      d2.k !== null &&
      d2.k < DETAIL_BAND[0] &&
      d2.lod === 'skeleton' &&
      inDetailBand(d3) &&
      d3.lod === 'skeleton' &&
      d4.k !== null &&
      d4.k >= LOD_DETAIL_K &&
      d4.lod === 'detail',
    { d0, d1, d2, d3, d4, band: `[${DETAIL_BAND[0]}, ${DETAIL_BAND[1]})` },
  );

  /**
   * R4h 手势活动窗口内 LOD 冻结（DF-R3）：`MapView` 用 `zoomGestureActive` 冻结档位、
   * 空闲 120ms 才解冻（`scheduleGestureRelease`）。这里在**页内**派发一次大幅度 wheel 并
   * 只等两帧就读 HUD —— 样本确定落在 120ms 窗口内：
   *   窗口内 k 已跨过两个阈值，档位必须**仍是**手势前的 full；
   *   释放后按当前 k 与滞回收敛到 skeleton。
   * 只要求「不反向」是识别不出「去掉冻结」回归的，因此这里把冻结本身作为条件。
   */
  await lodStop(0.8); // 站在 full（k≥0.5）**并等手势释放**，否则 before.lod 还是上一段的冻结值
  const gesture = await page.evaluate(async () => {
    const readK = () => {
      const tf = document.querySelector('svg')?.querySelector('g')?.getAttribute('transform') ?? '';
      const m = /scale\(\s*([\d.]+)/.exec(tf);
      return m === null ? null : Number(m[1]);
    };
    const readLod = () => {
      for (const row of document.querySelectorAll('div')) {
        const spans = row.children;
        if (spans.length === 2 && spans[0].textContent?.trim() === 'LOD') {
          return spans[1].textContent?.trim() ?? null;
        }
      }
      return null;
    };
    const t0 = performance.now();
    const before = { k: readK(), lod: readLod() };
    const target = document.elementFromPoint(720, 450);
    if (target === null) return { error: '画布中心取不到元素' };
    target.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: 720,
        clientY: 450,
        deltaY: 900, // exp(-900*0.0016)=0.237：一次跨过 0.26 与 0.5
      }),
    );
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const during = { k: readK(), lod: readLod() };
    return { before, during, elapsedMs: performance.now() - t0 };
  });
  await wait(450); // > 120ms：手势释放
  const afterGesture = { k: await zoomOf(), lod: await hudRow('LOD') };
  check(
    'R4h 手势活动窗口内 LOD 冻结（窗口内 k 已跨两阈值但档位不变），释放后按当前 k 收敛到 skeleton',
    gesture.error === undefined &&
      gesture.before.k !== null &&
      gesture.before.k >= LOD_FULL_K &&
      gesture.before.lod === 'full' &&
      gesture.during.k !== null &&
      gesture.during.k < LOD_DETAIL_K &&
      gesture.during.lod === 'full' &&
      gesture.elapsedMs < 120 &&
      afterGesture.k !== null &&
      afterGesture.k < DETAIL_BAND[0] &&
      afterGesture.lod === 'skeleton',
    { ...gesture, afterGesture, freezeWindowMs: 120 },
  );
  await saveShot('release-123-04-lod-return.png');
});

/* ───────────────── R5 Canvas 纯树后端：身份 + 渲染 ───────────────── */
await journey('R5', async () => {
  const query = NEG.canvasSvg ? '' : '?backend=canvas';
  await page.goto(`${BASE}/${query}`, { waitUntil: 'networkidle' });
  await checkBundle();
  await assertInjectionReady();
  // Canvas 后端无 SVG 节点层 → 等「canvas 或节点」任一出现
  await page.waitForSelector('canvas, [data-node-id]', { timeout: 20000 });
  await wait(400);
  const sample = page.getByRole('button', { name: '看内置示例' });
  if (await sample.count()) await sample.click({ timeout: 3000 }).catch(() => undefined);
  await wait(400);
  await openFixture('pure');
  await wait(600);
  await fitView(); // 默认缩放下连线只有不到 1px：先适配视图，连线落墨才可判定
  await wait(400);

  const backend = await hudRow('后端');
  const canvasEls = await count('canvas');
  const svgNodes = await count('g[data-node-id]');
  check(
    'R5a Canvas 身份：HUD 后端 = canvas、存在 <canvas>、无 SVG 节点层',
    backend === 'canvas' && canvasEls >= 1 && svgNodes === 0,
    { backend, canvasEls, svgNodes, query },
  );

  /**
   * 逐区域绘制 + 命中候选：在画布像素上找「墨迹带」——
   * 沿深度轴的每个带 = 一档 depth（root / branch / leaf）；带内横轴最大墨迹 run 的中心
   * 就是一张节点卡的中心（可直接用于坐标命中）。命中点按 canvas 像素 → 页面坐标换算。
   */
  const probe = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    const W = c.width;
    const H = c.height;
    if (W === 0 || H === 0) return { W, H, ink: 0, empty: true };
    const d = ctx.getImageData(0, 0, W, H).data;
    const isBg = (r, g, b) => r < 24 && g < 26 && b < 34;
    const colInk = new Array(W).fill(0);
    const rowInk = new Array(H).fill(0);
    let ink = 0;
    let minX = W;
    let maxX = -1;
    let minY = H;
    let maxY = -1;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const i = (y * W + x) * 4;
        if (d[i + 3] <= 8 || isBg(d[i], d[i + 1], d[i + 2])) continue;
        ink += 1;
        colInk[x] += 1;
        rowInk[y] += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    const runsOf = (arr) => {
      const out = [];
      let s = null;
      for (let i = 0; i < arr.length; i += 1) {
        if (arr[i] > 0) {
          if (s === null) s = i;
        } else if (s !== null) {
          if (i - s >= 4) out.push([s, i - 1]);
          s = null;
        }
      }
      if (s !== null && arr.length - s >= 4) out.push([s, arr.length - 1]);
      return out;
    };
    const merge = (rs, gap) => {
      const out = [];
      for (const r of rs) {
        const last = out[out.length - 1];
        if (last !== undefined && r[0] - last[1] <= gap) last[1] = r[1];
        else out.push([r[0], r[1]]);
      }
      return out;
    };
    const inkIn = (x0, x1, y0, y1) => {
      let n = 0;
      for (let y = y0; y <= y1; y += 1)
        for (let x = x0; x <= x1; x += 1) {
          const i = (y * W + x) * 4;
          if (d[i + 3] > 8 && !isBg(d[i], d[i + 1], d[i + 2])) n += 1;
        }
      return n;
    };
    const cols = merge(runsOf(colInk), Math.max(6, Math.round(W * 0.015))).map(([s, e]) => ({
      s,
      e,
      ink: inkIn(s, e, 0, H - 1),
    }));
    const rows = merge(runsOf(rowInk), Math.max(6, Math.round(H * 0.015))).map(([s, e]) => ({
      s,
      e,
      ink: inkIn(0, W - 1, s, e),
    }));
    /**
     * 连线落笔的直接签名（DF-R4）：
     * - `spanEmpty` = 墨迹跨度内**整列无墨**的列数。树线把相邻节点列连起来 → 跨度为 0；
     *   省略路径几何时（负控）会留下整列空白（实测 19 列）。
     * - `thinCols` = 该列墨迹 ≤ `THIN_MAX_PX` 的列数（连线笔画量级）。
     *   节点卡列实测 ≥18px/列，连线走廊实测 4px/列，两侧量级分明。
     */
    const THIN_MAX_PX = 12;
    let spanEmpty = 0;
    let thinCols = 0;
    let thinInk = 0;
    for (let x = minX; x <= maxX; x += 1) {
      if (colInk[x] === 0) spanEmpty += 1;
      else if (colInk[x] <= THIN_MAX_PX) {
        thinCols += 1;
        thinInk += colInk[x];
      }
    }
    const rect = c.getBoundingClientRect();
    const toScreen = (px, py) => ({
      x: rect.left + ((px + 0.5) * rect.width) / W,
      y: rect.top + ((py + 0.5) * rect.height) / H,
    });
    /**
     * 命中候选：在墨迹 bbox 上按 13×3 网格采样（连线落笔后节点列已被连通，
     * 「按列带取卡中心」的旧启发式不再成立）。逐点双击后由编辑浮层文本核对身份，
     * 命中不到就继续；不依赖布局方向等坐标先验，卡在网格点附近即可命中。
     */
    const candidates = [];
    const seenPts = new Set();
    for (let i = 0; i <= 12; i += 1) {
      const px = minX + ((maxX - minX) * i) / 12;
      for (const fy of [0.5, 0.25, 0.75]) {
        const py = minY + (maxY - minY) * fy;
        const screen = toScreen(px, py);
        const key = `${Math.round(screen.x)},${Math.round(screen.y)}`;
        if (seenPts.has(key)) continue;
        seenPts.add(key);
        candidates.push({ px, py, ...screen });
      }
    }
    return {
      W,
      H,
      ink,
      bbox: { minX, minY, maxX, maxY },
      cols,
      rows,
      spanEmpty,
      thinCols,
      thinInk,
      THIN_MAX_PX,
      candidates,
      canvasRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    };
  });
  const total = await hudRow('节点');
  const hudLinks = await hudRow('连线');
  /**
   * R5b 判据调整说明（DF-R4 后）：原判据含「至少 3 条**分离**墨迹带」——那是连线尚未落笔时
   * 用来代替「三档节点都被画出」的代理指标。连线落笔后节点列已被树线连通（实测 1 条连通行），
   * 该代理指标**必然失效**。这里不再用它，改为由 R5c 的**按坐标命中并核对节点身份**直接证明
   * 多档节点被画出（比数带子更直接），R5b 只保留「画布尺寸 / 墨迹跨度 / 墨量」这类仍然成立的条件。
   */
  const spanW = probe === null ? 0 : probe.bbox.maxX - probe.bbox.minX;
  const drawOk =
    probe !== null && probe.ink >= 2000 && probe.W > 100 && probe.H > 100 && spanW >= probe.W * 0.3;
  check(
    'R5b Canvas 渲染：画布尺寸有效 + 墨迹量 ≥2000px + 横跨 ≥30% 画布',
    drawOk,
    {
      ink: probe?.ink ?? null,
      W: probe?.W ?? null,
      H: probe?.H ?? null,
      bbox: probe?.bbox ?? null,
      spanW,
      colRuns: probe?.cols?.length ?? null,
      rowRuns: probe?.rows?.length ?? null,
      totalNodes: total,
      hudLinks,
      expected: PURE_NODES,
    },
  );

  /**
   * R5d 连线落笔（DF-R4 核心）：跨度内**不得有整列空白**，且存在足够的「细柱」。
   * 负控 `neg-canvas-links` 只把 `lineTo/quadraticCurveTo/bezierCurveTo` 打成空函数
   * （节点卡/文字照旧）→ `spanEmpty` 从 0 变 19、`thinCols` 从 ≥10 变 0，本项必红。
   */
  check(
    'R5d Canvas 连线落笔：墨迹跨度内无整列空白（相邻节点被线连通）+ 存在 ≥10 条连线笔画量级的细柱',
    probe !== null && probe.spanEmpty === 0 && probe.thinCols >= 10,
    {
      spanEmpty: probe?.spanEmpty ?? null,
      thinCols: probe?.thinCols ?? null,
      thinInk: probe?.thinInk ?? null,
      THIN_MAX_PX: probe?.THIN_MAX_PX ?? null,
      spanW,
      hudLinks,
    },
  );

  // 坐标命中：在网格点双击 → 编辑浮层的文本必须命中夹具里的已知节点
  const hits = [];
  for (const cand of (probe?.candidates ?? []).slice(0, 16)) {
    let text = null;
    try {
      await page.mouse.dblclick(cand.x, cand.y);
      const editor = page.locator('[data-overlay-editor]').first();
      const shown = await editor
        .waitFor({ state: 'visible', timeout: 2500 })
        .then(() => true)
        .catch(() => false);
      if (shown) {
        text = await editor.evaluate((el) => String(el.value ?? el.textContent ?? '').trim());
      }
      await page.keyboard.press('Escape');
      await wait(200);
    } catch (e) {
      hits.push({ point: cand, error: String(e) });
      continue;
    }
    hits.push({ point: { x: Math.round(cand.x), y: Math.round(cand.y) }, text });
    const seen = new Set(hits.filter((h) => h.text !== null).map((h) => PURE_DEPTH[h.text]));
    if (seen.size >= 3) break; // 三档都命中即停（省时；未达则跑满候选）
  }
  const known = hits.filter((h) => h.text !== null && PURE_LABELS.includes(h.text));
  const distinct = [...new Set(known.map((h) => h.text))];
  const depthsHit = [...new Set(distinct.map((l) => PURE_DEPTH[l]))].sort();
  check(
    'R5c Canvas 坐标命中：至少两个**不同**已知节点，且命中身份跨越 ≥2 个 depth 档（编辑浮层文本核对）',
    distinct.length >= 2 && depthsHit.length >= 2,
    {
      hits,
      knownLabels: distinct,
      depthsHit,
      fixtureLabels: PURE_LABELS,
      candidates: probe?.candidates?.length ?? 0,
    },
  );
  await saveShot('release-123-05-canvas-backend.png');
});

/* ───────────────── R6 自由画布：结构化保存 + 重开语义一致 ───────────────── */
await journey('R6', async () => {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await checkBundle();
  await assertInjectionReady();
  await page.waitForSelector('[data-node-id]', { timeout: 20000 });
  await wait(400);
  await click('[data-app-freecanvas]');
  await wait(500);
  await click('[data-fc-open]');
  await wait(800);

  const original = JSON.parse(CANVAS_JSON);
  const origA = original.placements.find((p) => p.placementUuid === FREE_A);
  const cards = await count('[data-fc-card]');
  const edgesDom = await count('[data-fc-edge]');
  check('R6a 打开非空连接夹具（3 卡 + 2 边）', cards === 3 && edgesDom === 2, { cards, edgesDom });

  // 改正面（甲）
  const cardA = page.locator(`[data-fc-card][data-fc-uuid="${FREE_A}"]`).first();
  const ab = await cardA.boundingBox();
  if (ab === null) throw new Error('缺失卡甲');
  await page.mouse.dblclick(ab.x + ab.width / 2, ab.y + ab.height / 2);
  const editor = page.locator('[data-fc-editor]').first();
  await editor.waitFor({ state: 'visible', timeout: 5000 });
  await editor.fill(FRONT_A_NEW);
  await page.keyboard.press('Shift+Enter');
  await wait(400);

  // 改背面（乙）：翻面 → 编辑背面
  const cardB = page.locator(`[data-fc-card][data-fc-uuid="${FREE_B}"]`).first();
  await cardB.hover();
  await cardB.locator('[data-fc-flip]').click();
  await wait(600);
  const bFlipped = (await cardB.getAttribute('data-fc-face')) === 'back';
  const bbB = await cardB.boundingBox();
  await page.mouse.dblclick(bbB.x + bbB.width / 2, bbB.y + bbB.height / 2);
  const backEditor = page.locator('[data-fc-editor]').first();
  await backEditor.waitFor({ state: 'visible', timeout: 5000 });
  await backEditor.fill(BACK_B_NEW);
  await page.keyboard.press('Shift+Enter');
  await wait(400);
  check('R6b 改正面（甲）+ 翻面后背改面（乙）', bFlipped, { bFlipped });

  /**
   * 拖动前把 viewport scale **推离 1**（以卡甲为锚滚轮缩放）。
   *
   * 为什么必须这样做：`scale === 1` 时「屏幕 120px」与「世界 120 单位」同值，
   * 两种写法（除以 scale / 直接当世界值）都会通过 —— 断言没有鉴别力。
   * 实测 `release-123.mc.canvas.json` 默认 scale=1；缩到 ≈1.5 后，
   * 120 屏幕像素应写出 **80** 世界单位（`120 ÷ 1.4993`），直接当 120 世界单位的写法会差 40。
   */
  const origB = original.placements.find((p) => p.placementUuid === FREE_B);
  const rectOfCards = () =>
    page.evaluate(
      ({ a, b }) => {
        const rectOf = (u) => {
          const el = document.querySelector(`[data-fc-card][data-fc-uuid="${u}"]`);
          if (el === null) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        };
        return { a: rectOf(a), b: rectOf(b) };
      },
      { a: FREE_A, b: FREE_B },
    );
  const scaleOf = (rects) =>
    rects.a === null || rects.b === null || origB === undefined || origB.transform.x === origA.transform.x
      ? null
      : (rects.b.x - rects.a.x) / (origB.transform.x - origA.transform.x);
  const rectsPreZoom = await rectOfCards();
  const preZoomScale = scaleOf(rectsPreZoom);
  if (rectsPreZoom.a === null) envFail('自由画布缩放前取不到卡甲盒');
  await page.mouse.move(rectsPreZoom.a.x + rectsPreZoom.a.w / 2, rectsPreZoom.a.y + rectsPreZoom.a.h / 2);
  for (let i = 0; i < 3; i += 1) {
    await page.mouse.wheel(0, -90);
    await wait(120);
  }
  await wait(400);
  const rectsBefore = await rectOfCards();
  const dragScale = scaleOf(rectsBefore);
  if (dragScale === null || !(dragScale > 0)) {
    envFail(`自由画布 viewport scale 推不出（卡缺失或世界间距为 0）：${JSON.stringify({ rectsBefore })}`);
  }
  check(
    'R6b2 拖动前 viewport scale 已明显推离 1（否则「屏幕位移 ÷ scale」与「直接当世界值」同值，断言无鉴别力）',
    dragScale > 1.2,
    { preZoomScale, dragScale, zoomSteps: 3, wheelDelta: -90 },
  );
  // 用户手势是**屏幕**像素 → 世界位移 = 屏幕位移 ÷ scale（不得把 120 屏幕像素当成 120 世界单位）
  const worldDrag = { dx: DRAG.dx / dragScale, dy: DRAG.dy / dragScale };

  // 拖动甲
  const ab2 = await cardA.boundingBox();
  await page.mouse.move(ab2.x + ab2.width / 2, ab2.y + ab2.height / 2);
  await page.mouse.down();
  await page.mouse.move(ab2.x + ab2.width / 2 + DRAG.dx, ab2.y + ab2.height / 2 + DRAG.dy, { steps: 10 });
  await page.mouse.up();
  await wait(500);

  const saved = await saveViaClick('json');
  const snapJson = await lastWriteText('json');
  const last = parseJson(snapJson);
  const pA = last?.placements?.find((p) => p.placementUuid === FREE_A);
  const pB = last?.placements?.find((p) => p.placementUuid === FREE_B);
  const expectA = { x: origA.transform.x + worldDrag.dx, y: origA.transform.y + worldDrag.dy };
  const structOk =
    saved.newCommit &&
    last !== null &&
    last.placements.length === 3 &&
    pA?.front?.body === FRONT_A_NEW &&
    // 世界单位容差 1.0：指针坐标整数化 ±0.5 屏幕 px ÷ scale(≥1.2) ≤ 0.42 世界单位；
    // 「直接当世界值」的错写法在 scale≈1.5 时差 40 —— 容差与错值不在同一量级。
    Math.abs(pA.transform.x - expectA.x) < 1 &&
    Math.abs(pA.transform.y - expectA.y) < 1 &&
    pB?.face === 'back' &&
    pB?.back?.body === BACK_B_NEW &&
    edgePairsOf(last).join() === edgePairsOf(original).join();
  check(
    'R6c 最后一份 JSON：正/背面文本、拖动坐标（屏幕位移 ÷ scale 得世界位移）、连接端点按 uuid 结构化核对',
    structOk,
    {
      save: saved,
      dragScale,
      screenDelta: DRAG,
      worldDelta: worldDrag,
      aFront: pA?.front?.body,
      aTransform: pA?.transform,
      expectA,
      bFace: pB?.face,
      bBack: pB?.back?.body,
      edges: edgePairsOf(last),
      edgesOriginal: edgePairsOf(original),
    },
  );

  // 重开：句柄读到的是「最后一份成功快照」→ 核对实际 UI（清空读取日志，只看重开这一段）
  await page.evaluate(() => {
    window.__reads = [];
  });
  await click('[data-fc-exit]');
  await wait(700);
  await click('[data-app-freecanvas]');
  await wait(500);
  await click('[data-fc-open]');
  await wait(900);
  const reopened = await page.evaluate(
    ({ a, b, e1, e2 }) => {
      const cardOf = (uuid) => document.querySelector(`[data-fc-card][data-fc-uuid="${uuid}"]`);
      const rectOf = (el) => (el === null || el === undefined ? null : el.getBoundingClientRect());
      const centerOf = (el) => {
        const r = rectOf(el);
        return r === null ? null : { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      };
      const ca = cardOf(a);
      const cb = cardOf(b);
      /** 边端点（屏幕坐标）：EdgeLayer 以**卡中心**为锚，逐 uuid 核对端点归属 */
      const edges = [];
      for (const line of document.querySelectorAll('[data-fc-edge]')) {
        const svg = line.ownerSVGElement;
        const m = line.getScreenCTM();
        const toScreen = (x, y) => {
          const p = svg.createSVGPoint();
          p.x = x;
          p.y = y;
          const q = p.matrixTransform(m);
          return { x: q.x, y: q.y };
        };
        edges.push({
          uuid: line.getAttribute('data-fc-edge-uuid'),
          a: toScreen(Number(line.getAttribute('x1')), Number(line.getAttribute('y1'))),
          b: toScreen(Number(line.getAttribute('x2')), Number(line.getAttribute('y2'))),
        });
      }
      return {
        faceA: ca?.getAttribute('data-fc-face') ?? null,
        frontA: ca?.querySelector('[data-fc-front]')?.textContent ?? null,
        faceB: cb?.getAttribute('data-fc-face') ?? null,
        backB: cb?.querySelector('[data-fc-back-body]')?.textContent ?? null,
        centerA: centerOf(ca),
        centerB: centerOf(cb),
        centerC: centerOf(cardOf('pl_r123_c')),
        rectA: rectOf(ca),
        rectB: rectOf(cb),
        relX: rectOf(ca) !== null && rectOf(cb) !== null ? rectOf(ca).x - rectOf(cb).x : null,
        relY: rectOf(ca) !== null && rectOf(cb) !== null ? rectOf(ca).y - rectOf(cb).y : null,
        edges,
        ordered: [`${e1}`, `${e2}`],
        cards: document.querySelectorAll('[data-fc-card]').length,
        reads: window.__reads.map((r) => ({ kind: r.kind, bytes: r.text.length, text: r.text })),
        // DF-R5：不再用固定的 'json' 单键，改读**这份画布文件自己的目的地**
        lastCommitted: window.__destText(window.__openDestId('json')),
        originalJson: window.__originalJson,
      };
    },
    { a: FREE_A, b: FREE_B, e1: EDGE_1, e2: EDGE_2 },
  );
  const near = (p, q, tol) =>
    p !== null && q !== null && Math.abs(p.x - q.x) < tol && Math.abs(p.y - q.y) < tol;
  const edgeById = (uuid) => reopened.edges.find((e) => e.uuid === uuid) ?? null;
  const e1 = edgeById(EDGE_1);
  const e2 = edgeById(EDGE_2);
  // 端点身份：ed_r123_1 = 甲→乙、ed_r123_2 = 乙→丙（端点 == 对应卡中心）
  const endpointsOk =
    e1 !== null && near(e1.a, reopened.centerA, 2) && near(e1.b, reopened.centerB, 2) &&
    e2 !== null && near(e2.a, reopened.centerB, 2) && near(e2.b, reopened.centerC, 2);
  /**
   * 重开后的 scale 也**重新测**（viewport 随快照持久化，重开后仍是 ≈1.5）：
   * 卡间屏幕相对位移 ÷ scale 才是世界相对位移，才能与快照里的世界坐标同口径比较。
   * 不这样换算就会把「屏幕上看起来差 50%」误判为内容漂移。
   */
  const reopenedScale =
    reopened.rectA !== null &&
    reopened.rectB !== null &&
    pA !== undefined &&
    pB !== undefined &&
    pB.transform.x !== pA.transform.x
      ? (reopened.rectB.x - reopened.rectA.x) / (pB.transform.x - pA.transform.x)
      : null;
  const relWorld =
    reopenedScale === null || reopened.relX === null
      ? null
      : { x: reopened.relX / reopenedScale, y: reopened.relY / reopenedScale };
  const expectedRel = { x: pA.transform.x - pB.transform.x, y: pA.transform.y - pB.transform.y };
  const relOk =
    relWorld !== null &&
    Math.abs(relWorld.x - expectedRel.x) < 1.5 &&
    Math.abs(relWorld.y - expectedRel.y) < 1.5;
  const uiOk =
    reopened.cards === 3 &&
    reopened.edges.length === 2 &&
    endpointsOk &&
    reopened.faceA === 'front' &&
    reopened.frontA === FRONT_A_NEW &&
    reopened.faceB === 'back' &&
    reopened.backB === BACK_B_NEW &&
    relOk;
  check('R6d 重开核对实际 UI（文本/翻面/世界相对坐标/按 edgeUuid 的端点归属）', uiOk, {
    faces: { a: reopened.faceA, b: reopened.faceB },
    texts: { a: reopened.frontA, b: reopened.backB },
    reopenedScale,
    rel: { screen: { x: reopened.relX, y: reopened.relY }, world: relWorld, expect: expectedRel },
    edges: reopened.edges,
    centers: { a: reopened.centerA, b: reopened.centerB, c: reopened.centerC },
    endpointsOk,
  });

  // 读来源：重开读取必须 == **最后一份成功快照**，且 ≠ 原始夹具（返回旧夹具的负控必须失败）
  const readCheck = {
    count: reopened.reads.length,
    allEqualLastCommitted:
      reopened.lastCommitted !== null && reopened.reads.every((r) => r.text === reopened.lastCommitted),
    anyEqualToOriginal: reopened.reads.some((r) => r.text === reopened.originalJson),
  };
  check('R6f 重开读取 == 最后成功快照（任意一次读到原始夹具都算失败）', readCheck.count >= 1 && readCheck.allEqualLastCommitted && readCheck.anyEqualToOriginal === false, readCheck);

  // 再存一次：语义投影与上一份快照一致（按 uuid 排序；忽略写入即变的时间戳）
  const state2 = await saveViaClick('json');
  const j2 = parseJson(await lastWriteText('json'));
  const proj2 = j2 === null ? null : semanticCanvas(j2);
  const proj1 = last === null ? null : semanticCanvas(last);
  const same = state2.newCommit && proj2 !== null && proj1 !== null && JSON.stringify(proj2) === JSON.stringify(proj1);
  check('R6e 重开后再存：语义投影（placements+edges 按 uuid 排序）与上一份快照一致', same, {
    save: state2,
    placements2: proj2?.placements?.map((p) => [p.id, p.face, p.transform]),
    edges2: proj2?.edges?.map((e) => `${e.edgeUuid}:${e.fromPlacementUuid}->${e.toPlacementUuid}`),
  });
  await saveShot('release-123-06-free-canvas.png');
  out.R6ledger = await ledgerSnapshot();
});

/* ───────────────── R7 保存 / 另存为：同格式目的地隔离（DF-R5） ─────────────────
 * 放在最后：本旅程会把会话目的地切到「另存为」的新文件，并可能改动 main 夹具文本，
 * 放在末尾可保证不扰动前面已通过的 R1–R6 视野。
 * 端到端走**真实 UI**（另存为按钮）触发 `showSaveFilePicker`，再逐目的地核对账本。
 */
await journey('R7', async () => {
  // 新开一页：R6 结束时停在自由画布，且本旅程要独立验证「同一夹具下的两个目的地」，
  // 不复用前面的账本状态（goto 后 ledger 是新的一份，A 的首个 committed 就发生在 R7a）。
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await checkBundle();
  await assertInjectionReady();
  await page.waitForSelector('[data-node-id]', { timeout: 20000 });
  await wait(400);
  await openFixture('main');
  await fitView();
  await wait(400);
  await page.evaluate(() => {
    window.__aHandle = window.__lastOpenHandle; // 记下 A 的句柄对象（R7f 要证明换的是新对象）
  });

  const aDest = await destOfKind('md');
  const leafId = await nodeIdOf(LEAF);
  await editNodeById(leafId, LEAF_EDITED);
  const saveA = await saveViaClick('md');
  const aAfterSave = await destText(aDest);
  check(
    'R7a 打开文件 A 保存（A 有自己的 committed，落在 A 的目的地）',
    saveA.newCommit && saveA.lastScope === aDest && aAfterSave !== null && aAfterSave.includes(LEAF_EDITED),
    { aDest, saveA, bytes: aAfterSave?.length ?? 0 },
  );

  // 真实 UI 另存为：必然唤起 showSaveFilePicker → 新目的地 B
  await clickText('另存为');
  const saveAsDone = await page
    .waitForFunction(() => window.__lastSaveHandle !== undefined && window.__lastSaveHandle !== null, undefined, {
      timeout: 15000,
      polling: 80,
    })
    .then(() => true)
    .catch(() => false);
  if (!saveAsDone) envFail('另存为未唤起 showSaveFilePicker（UI 入口或 FS 分支变化）');
  await wait(700);
  const bDest = await page.evaluate(() => window.__lastSaveHandle?.destinationId ?? null);
  const bName = await page.evaluate(() => window.__lastSaveHandle?.name ?? null);
  const aAfterSaveAs = await destText(aDest);
  const bAfterSaveAs = await destText(bDest);
  check(
    'R7b 另存为：写入落在**新目的地 B**，原目的地 A 的最后快照逐字不变',
    aDest !== null && bDest !== null && aDest !== bDest && aAfterSaveAs === aAfterSave &&
      bAfterSaveAs !== null && bAfterSaveAs.includes(LEAF_EDITED),
    { aDest, bDest, bName, aUnchanged: aAfterSaveAs === aAfterSave, bBytes: bAfterSaveAs?.length ?? 0 },
  );

  // B 的后续写入不改 A（会话目的地已切到 B）
  await editNodeById(leafId, `${LEAF_EDITED}二`);
  const saveB = await saveViaClick('md');
  const aAfterB2 = await destText(aDest);
  const bAfterB2 = await destText(bDest);
  check(
    'R7c B 的后续保存只改 B：A 的最后快照仍逐字不变',
    saveB.newCommit && saveB.lastScope === bDest && aAfterB2 === aAfterSave &&
      bAfterB2 !== null && bAfterB2.includes(`${LEAF_EDITED}二`),
    { saveB, aDest, bDest, aUnchanged: aAfterB2 === aAfterSave, bAdvanced: bAfterB2 !== bAfterSaveAs },
  );

  /**
   * A 的 pending（write 之后未 close）与**写入失败**（close 被拒）都不得影响 B。
   * 这段没有对应 UI 入口（浏览器里没法让系统写入失败），因此直接对**替身**操作 ——
   * DF-R5 的对象本来就是替身契约；仍在真实浏览器里、用的是同一份注入句柄。
   */
  const pending = await page.evaluate(async () => {
    const h = window.__lastOpenHandle;
    window.__autoRelease = false;
    const w = await h.createWritable();
    await w.write('A PENDING（未 close）');
    const bNow = window.__destText(window.__lastSaveHandle.destinationId);
    const aNow = window.__destText(h.destinationId);
    await w.abort(); // 清掉 pending，不留残渣
    window.__autoRelease = true;
    return { aNow, bNow, aDest: h.destinationId, bDest: window.__lastSaveHandle.destinationId };
  });
  const aAfterPending = await destText(aDest);
  const bAfterPending = await destText(bDest);
  check(
    'R7d A 的未完成写入（pending，未 close）不改 A 也不必改 B',
    pending.aNow === aAfterSave && pending.bNow === bAfterB2 &&
      aAfterPending === aAfterSave && bAfterPending === bAfterB2,
    { aAfterPending: aAfterPending === aAfterSave ? 'unchanged' : 'CHANGED', bSame: bAfterPending === bAfterB2 },
  );

  const failed = await page.evaluate(async () => {
    const h = window.__lastOpenHandle;
    window.__autoRelease = false;
    const w = await h.createWritable();
    await w.write('A FAILED（close 会失败）');
    window.__rejectAll();
    let threw = false;
    try {
      await w.close();
    } catch {
      threw = true;
    }
    window.__autoRelease = true;
    return {
      threw,
      aNow: window.__destText(h.destinationId),
      bNow: window.__destText(window.__lastSaveHandle.destinationId),
    };
  });
  const aAfterFailed = await destText(aDest);
  const bAfterFailed = await destText(bDest);
  check(
    'R7e A 的写入失败（close 被拒 → 不记账）既不推进 A 的成功快照，也不改 B',
    failed.threw && failed.aNow === aAfterSave && failed.bNow === bAfterB2 &&
      aAfterFailed === aAfterSave && bAfterFailed === bAfterB2,
    { threw: failed.threw, aAdvanced: failed.aNow !== aAfterSave, bSame: failed.bNow === bAfterB2 },
  );

  /**
   * 换 handle 重开同一文件（同一次 picker、同一目的地）：
   * 必须读回该文件**最新的成功快照**，而不是每次 picker 都造一个空文件。
   */
  const reopen = await page.evaluate(async (expected) => {
    const oldHandle = window.__aHandle;
    const [h2] = await window.showOpenFilePicker({});
    const text = await (await h2.getFile()).text();
    return {
      newHandleObject: h2 !== oldHandle,
      dest: h2.destinationId,
      sameDest: h2.destinationId === oldHandle.destinationId,
      matchesExpectedDest: h2.destinationId === expected,
      text,
      latest: window.__destText(h2.destinationId),
      bytes: text.length,
    };
  }, aDest);
  check(
    'R7f 换 handle 重开同一文件：**新句柄对象**、同一目的地、读回最新成功快照（不是每次新建空文件）',
    reopen.newHandleObject === true &&
      reopen.sameDest === true &&
      reopen.matchesExpectedDest === true &&
      reopen.bytes > 0 &&
      reopen.text === aAfterSave &&
      reopen.latest === aAfterSave,
    reopen,
  );
  await saveShot('release-123-07-saveas-isolation.png');
});

/* ── R0：未捕获异常不得被空 catch 吞成 PASS ── */
check('R0 页面无未捕获 pageerror', pageErrors.length === 0, { pageErrors });
await browser.close();

const failed = CASES.filter((c) => !c.ok);
/** 环境失败（扰动没命中/缺元素/超时）≠ 负控命中：整轮以 exit 3 收口，不能冒充证据 */
const exitCode = ENV.length > 0 ? 3 : pass ? 0 : 1;
out.bundle = { expected: expectedBundle, loaded: loadedBundles };
out.cases = CASES;
out.envFailures = ENV;
out.pageErrors = pageErrors;
out.summary = {
  mode: MODE,
  total: CASES.length,
  passed: CASES.length - failed.length,
  failed: failed.length,
  failedCaseIds: failed.map((c) => c.caseId),
  envFailures: ENV.length,
  result: ENV.length > 0 ? 'ENV-FAIL' : pass ? 'PASS' : 'FAIL',
  exitCode,
};
out.result = out.summary.result;
writeFileSync(join(OUT, 'results.json'), JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
process.exit(exitCode);

/* ───────────────────────── 小工具 ───────────────────────── */

/**
 * 页内解码 PNG（data URL → Image → canvas 采样）。
 *
 * 「有效绘制」口径**主题无关**：与导出件的背景色（`bg`）不同才算墨迹——
 * 旧口径把「深色 = 背景」写死，classic 浅底下会退化成恒真。
 * `regions` 由调用方按「导出 viewBox ↔ PNG 像素」精确映射后给出（PNG = 导出 SVG 的 scale 倍栅格化），
 * 因而可以逐节点核对「这块区域确实画了东西」，而不是只看全图非空。
 */
async function pngPixelStats(page, buf, opts) {
  const dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
  return page.evaluate(
    ({ url, bg, regions }) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const ctx = c.getContext('2d');
          if (!ctx) return resolve(null);
          ctx.drawImage(img, 0, 0);
          const { data } = ctx.getImageData(0, 0, c.width, c.height);
          const bgRgb = (() => {
            const m = /^#?([0-9a-f]{6})$/i.exec(String(bg ?? '').trim());
            if (m === null) return null;
            const n = Number.parseInt(m[1], 16);
            return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
          })();
          const isInk = (r, g, b, a) => {
            if (a <= 8) return false;
            if (bgRgb === null) return true;
            return Math.abs(r - bgRgb.r) + Math.abs(g - bgRgb.g) + Math.abs(b - bgRgb.b) > 24;
          };
          const seen = new Set();
          let ink = 0;
          let minX = c.width;
          let minY = c.height;
          let maxX = -1;
          let maxY = -1;
          for (let i = 0; i < data.length; i += 4) {
            const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
            if (isInk(r, g, b, a)) {
              ink += 1;
              const px = (i / 4) % c.width;
              const py = Math.floor(i / 4 / c.width);
              if (px < minX) minX = px;
              if (px > maxX) maxX = px;
              if (py < minY) minY = py;
              if (py > maxY) maxY = py;
            }
            if (i % 4000 === 0) seen.add(`${r >> 4},${g >> 4},${b >> 4}`);
          }
          const regionStats = (regions ?? []).map((rg) => {
            const x0 = Math.max(0, Math.round(rg.x));
            const y0 = Math.max(0, Math.round(rg.y));
            const x1 = Math.min(c.width, Math.round(rg.x + rg.w));
            const y1 = Math.min(c.height, Math.round(rg.y + rg.h));
            let total = 0;
            let nonBg = 0;
            const colors = new Set();
            for (let y = y0; y < y1; y += 1) {
              for (let x = x0; x < x1; x += 1) {
                const i = (y * c.width + x) * 4;
                const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
                total += 1;
                colors.add(`${r >> 4},${g >> 4},${b >> 4}`);
                if (isInk(r, g, b, a)) nonBg += 1;
              }
            }
            return {
              label: rg.label,
              w: x1 - x0,
              h: y1 - y0,
              total,
              nonBg,
              ratio: total === 0 ? 0 : nonBg / total,
              colors: colors.size,
            };
          });
          resolve({
            width: c.width,
            height: c.height,
            colors: seen.size,
            inkRatio: ink / (data.length / 4),
            inkW: maxX < 0 ? 0 : maxX - minX,
            inkH: maxY < 0 ? 0 : maxY - minY,
            bg: bgRgb,
            regions: regionStats,
          });
        };
        img.onerror = () => resolve(null);
        img.src = url;
      }),
    { url: dataUrl, bg: opts?.bg ?? null, regions: opts?.regions ?? [] },
  );
}
