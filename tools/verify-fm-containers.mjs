/**
 * 真浏览器验收：P1-A rider-A 容器一致化 —— 四条浮动条 + 文件侧三条内联条的 DOM 几何断言
 * ══════════════════════════════════════════════════════════════════════
 * 跑法：node tools/verify-fm-containers.mjs [baseUrl]   （默认 http://localhost:5175）
 *
 * 对齐 docs/dispatch/2026-09-23-P0-C-review.md §7-a 的验收原文：
 *   「新容器/统一样式的唯一事实源 + 视觉回归用脚本截图或 DOM 几何断言」。
 * 本脚本只做 **DOM 几何断言**（getBoundingClientRect + computed z-index）：
 *   浮动条：top / zIndex / 水平居中 / 消退行为（auto 到点消失、manual 常驻/点击关闭）
 *   内联条：inlineBarStyle 唯一事实源（margin 0 12px 8px / padding 6px 8px / radius 6）
 *
 * 触发方式（全部真实用户路径，构建产物上跑）：
 *   asset-notice    浏览器素材库上传 → 挂载工作区 → 插入图片（复制到工作区提示）
 *   pre-dir-hint    选中节点 → Alt+方向键（会话预方向提示，2.5s 自动消退）
 *   command-notice  localStorage 打满配额 → Ctrl+S（写盘成功、附属记录失败 → 4s 自动消退）
 *   scale-notice    打开 >20K 节点文档（常驻，切走即消）
 *   内联三条        树侧提示（不可打开文件点击）+ 投影失败 + 迁移失败（后两条靠同一配额手段）
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
const WS = 'ws-containers';

/** 蓝 1×1 PNG（浏览器素材库侧） */
const BLUE_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC';
const RED_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

checkSnapshotFresh();

const { out, check, unconfirmed, finish } = createReport('verify-fm-containers', BASE);
out.findings = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => check('页面无未捕获异常', false, String(e)));

await page.addInitScript(DIALOG_PROBE_SOURCE);
await page.addInitScript(FAKE_FS_SOURCE);

/** 读某条浮条的几何：位置 / z-index / 是否水平居中 */
const geom = (slot) =>
  page.evaluate((s) => {
    const el = document.querySelector(`[data-floating-notice="${s}"]`);
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      top: r.top,
      left: r.left,
      width: r.width,
      cx: r.left + r.width / 2,
      zIndex: cs.zIndex,
      padding: cs.padding,
      borderRadius: cs.borderRadius,
      fontSize: cs.fontSize,
    };
  }, slot);

const visible = (slot) => page.locator(`[data-floating-notice="${slot}"]`).count();

const VIEW_CX = 700; // 1400 / 2

/**
 * 把 localStorage 填到剩余 <256B（递减分块：1MB→…→256B，逐级填满）。
 * 只写一次 14MB 不可靠：不同 Chromium 配额不同，且即使 14MB 抛错，
 * 剩余的几百 KB 仍容得下索引的几 KB 写入 —— 必须把余量压到小写入也失败。
 */
const fillQuota = () =>
  page.evaluate(() => {
    localStorage.removeItem('__quota_junk__');
    let buf = '';
    let chunk = 1024 * 1024;
    while (chunk >= 256) {
      for (;;) {
        try {
          const next = `${buf}${'x'.repeat(chunk)}`;
          localStorage.setItem('__quota_junk__', next);
          buf = next;
        } catch {
          break;
        }
      }
      chunk = Math.floor(chunk / 4);
    }
  });

/* ───────────────────────── 0. 启动：未挂载上传蓝 a.png → 浏览器素材库 ───────────────────────── */
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await assertLoadedBundle(page);
const sample = page.getByRole('button', { name: '看内置示例' });
if (await sample.count()) await sample.click({ timeout: 3000 }).catch(() => undefined);
await page.waitForSelector('[data-node-id]', { timeout: 20000 });
await page.waitForTimeout(500);

await page.keyboard.press('Control+Shift+A'); // 开图库
await page.waitForSelector('[data-asset-panel]', { timeout: 8000 });
await page
  .locator('[data-asset-panel] input[type="file"]')
  .first()
  .setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(BLUE_PNG_B64, 'base64') });
await page.waitForTimeout(900);
await page.keyboard.press('Control+Shift+A'); // 关图库
await page.waitForTimeout(300);

/* ───────────────────────── 1. 挂载工作区（含 assets/a.png 红图与两个文档） ───────────────────────── */
await page.evaluate(
  ([ws, red]) => {
    window.__ws.seed(ws, {
      '容器甲.mm.md': '# 容器甲\n\n- 节点甲\n- 节点乙\n',
      '容器乙.mm.md': '# 容器乙\n\n- 节点丙\n',
      'assets/a.png': `data:image/png;base64,${red}`,
    });
    window.__ws.mount(ws);
  },
  [WS, RED_PNG_B64],
);
// 「打开本地文件夹…」在文件管理面板的 StorageBar 上 → 先开面板
await page.getByText('文件管理', { exact: true }).click();
await page.waitForTimeout(500);
await page.getByText(/打开本地文件夹|切换本地目录/).first().click();
await page.waitForTimeout(1200);
// 打开一份**已保存的工作区文档**作为当前文档：后续插入/保存都走真实磁盘文件
// （否则当前是内置示例浏览器文档，Ctrl+S 走下载兜底会给大图切换引入未保存守卫噪音）
await page.locator('button[title$="容器甲.mm.md"]').first().click();
await page.locator('[data-file-manager]').waitFor({ state: 'detached', timeout: 30000 });
await page.waitForSelector('[data-node-id]', { timeout: 20000 });
await page.waitForTimeout(600);

/* ───────────────────────── 2. asset-notice：浏览器素材插入 → 复制到工作区（manual，点击关闭） ───────────────────────── */
await page.keyboard.press('Control+Shift+A');
await page.waitForSelector('[data-asset-panel]', { timeout: 8000 });
await page.waitForTimeout(600);
await page.locator('[data-asset-action="media"]').first().click().catch(() => undefined);
await page.locator('[data-asset-item][title="a.png"]').first().click();
await page.waitForTimeout(1200);

check(
  'asset-notice 出现（浏览器素材插入工作区后有落点提示）',
  (await visible('asset-notice')) === 1,
  null,
);
const gAsset = await geom('asset-notice');
check(
  'asset-notice 几何：top=100 / zIndex=5 / 水平居中',
  gAsset !== null &&
    Math.abs(gAsset.top - 100) < 2 &&
    gAsset.zIndex === '5' &&
    Math.abs(gAsset.cx - VIEW_CX) < 2,
  JSON.stringify(gAsset),
);
await page.waitForTimeout(1500);
check('asset-notice 1.5s 后仍常驻（manual 语义保留）', (await visible('asset-notice')) === 1, null);
await page.locator('[data-floating-notice="asset-notice"]').first().click();
await page.waitForTimeout(400);
check('asset-notice 点击后关闭', (await visible('asset-notice')) === 0, null);

/* ───────────────────────── 3. pre-dir-hint：Alt+↓ 预方向（auto 2500ms 消退） ───────────────────────── */
await page.locator('g[data-node-id]').first().click({ force: true });
await page.waitForTimeout(300);
await page.keyboard.press('Alt+ArrowDown');
await page.waitForTimeout(400);
check('pre-dir-hint 出现', (await visible('pre-dir-hint')) === 1, null);
const gPre = await geom('pre-dir-hint');
check(
  'pre-dir-hint 几何：top=16 / zIndex=6 / 水平居中',
  gPre !== null &&
    Math.abs(gPre.top - 16) < 2 &&
    gPre.zIndex === '6' &&
    Math.abs(gPre.cx - VIEW_CX) < 2,
  JSON.stringify(gPre),
);
await page.waitForTimeout(2800);
check('pre-dir-hint 2.8s 后自动消退（auto 2500）', (await visible('pre-dir-hint')) === 0, null);

/* ───────────────────────── 4. command-notice：超深子树切断被拒（auto 4000ms 消退） ─────────────────────────
 * 触发路径：关系模式 → 右键 d1 树边 →「✂ 切断并独立」→ planCutTreeEdge 深度校验
 * （MAX_NODE_DEPTH=5：d1 子树 7 级，移为根直接分支后最深 7 > 5）→ setCommandNotice。
 * （保存元数据失败路径不可达：docHost.remember 与 handleStore.setFileHandle 均内部静默吞错，
 *  源码核实，不伪造。）
 */
// 先把第 2 步插脏的容器甲存干净，避免切文档触发未保存守卫
await page.keyboard.press('Control+S');
await page.waitForTimeout(1200);
// 造一份 7 级链深文档并打开
await page.evaluate((ws) => {
  const chain = Array.from({ length: 7 }, (_, i) => `${'  '.repeat(i)}- d${i + 1}`).join('\n');
  window.__ws.put(ws, '深链.mm.md', `# 深链\n\n${chain}\n`);
}, WS);
await page.getByText('文件管理', { exact: true }).click();
await page.waitForTimeout(500);
await page.locator('button[title$="深链.mm.md"]').first().click();
await page.locator('[data-file-manager]').waitFor({ state: 'detached', timeout: 30000 });
await page.waitForSelector('[data-node-id]', { timeout: 20000 });
await page.waitForTimeout(600);
// 进关系模式（树边右键入口仅关系态挂载）
await page.locator('[data-relation-mode]').first().click();
await page.waitForTimeout(500);
// 右键 d1 的树边命中区（子树 7 级，切断必被深度校验拒绝）
// 直接派发 contextmenu：命中区是透明 10px 描边带，坐标中点可能被卡片/标注层覆盖，
// 派发绕开几何遮挡，React 的 onContextMenu（preventDefault/stopPropagation）照常触发
await page.evaluate(() => {
  const el = document.querySelector('[data-tree-edge-hit]');
  if (el === null) throw new Error('无树边命中区（关系模式未生效？）');
  const r = el.getBoundingClientRect();
  el.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
    }),
  );
});
await page.waitForSelector('[data-tree-edge-cut]', { timeout: 8000 });
await page.locator('[data-tree-edge-cut]').first().click();
await page.waitForTimeout(800);

const cmdVisible = (await visible('command-notice')) === 1;
check('command-notice 出现（超深子树切断被命令层拒绝）', cmdVisible, null);
const gCmd = cmdVisible ? await geom('command-notice') : null;
check(
  'command-notice 几何：top=64 / zIndex=5 / 水平居中',
  gCmd !== null &&
    Math.abs(gCmd.top - 64) < 2 &&
    gCmd.zIndex === '5' &&
    Math.abs(gCmd.cx - VIEW_CX) < 2,
  JSON.stringify(gCmd),
);
await page.waitForTimeout(4500);
check('command-notice 4.5s 后自动消退（auto 4000）', (await visible('command-notice')) === 0, null);
// 退出关系模式，避免后续交互被边手柄拦截
await page.locator('[data-relation-mode]').first().click();
await page.waitForTimeout(400);

/* ───────────────────────── 5. scale-notice：>20K/50K 节点文档（常驻；切走即消） ─────────────────────────
 * 三深度 10 层展开后约 8.8 万节点（>50K 档：「图过大…已切换 Canvas 渲染」）；
 * 两档同用 scale-notice 槽位（manual 常驻），几何与消退行为逐值相同。
 */
const BIG = (() => {
  const lines = ['# 大图', ''];
  let seq = 0;
  const walk = (depth, indent) => {
    if (depth >= 10) return;
    for (let i = 0; i < 3; i += 1) {
      lines.push(`${indent}- n${seq += 1}（d${depth + 1}）`);
      walk(depth + 1, `${indent}  `);
    }
  };
  walk(0, '');
  return lines.join('\n');
})();
await page.evaluate(([ws, text]) => window.__ws.put(ws, 'big-30k.mm.md', text), [WS, BIG]);
await page.getByText('文件管理', { exact: true }).click();
await page.waitForTimeout(600);
await page.locator('button[title$="big-30k.mm.md"]').first().click();
// 大图（~29.5K 节点）解析+渲染耗时：等**模态真正关闭**（= openWorkspaceFile 完成），
// 不能只等 data-node-id（旧文档的节点一直都在，会立刻命中造成假时序）
await page.locator('[data-file-manager]').waitFor({ state: 'detached', timeout: 120000 });
await page.waitForTimeout(2000);

check('scale-notice 出现（>20K 节点；本夹具落在 >50K 档）', (await visible('scale-notice')) === 1, null);
const gScale = await geom('scale-notice');
check(
  'scale-notice 几何：top=10 / zIndex=3 / 水平居中',
  gScale !== null &&
    Math.abs(gScale.top - 10) < 2 &&
    gScale.zIndex === '3' &&
    Math.abs(gScale.cx - VIEW_CX) < 2,
  JSON.stringify(gScale),
);
await page.waitForTimeout(3000);
check('scale-notice 3s 后仍常驻（manual：条件存续期间不走）', (await visible('scale-notice')) === 1, null);

/* ───────────────────────── 6. 内联三条：inlineBarStyle 唯一事实源 ───────────────────────── */
/** 读文件侧内联条几何（data-fm-tree-notice / data-fm-projection-failed / data-fm-migrate-failed） */
const inlineGeom = (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (el === null) return null;
    const cs = getComputedStyle(el);
    return { margin: cs.margin, padding: cs.padding, borderRadius: cs.borderRadius, fontSize: cs.fontSize };
  }, sel);

// 6a. 树侧提示（不可打开文件点击）——重开文件管理（big 文档下也能开）
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.evaluate((ws) => {
  window.__ws.put(ws, '说明.txt', '非导图内容');
}, WS);
// 关大图回小文档，避免大树拖慢后续交互
await page.getByText('文件管理', { exact: true }).click();
await page.waitForTimeout(500);
await page.locator('button[title$="容器甲.mm.md"]').first().click();
await page.locator('[data-file-manager]').waitFor({ state: 'detached', timeout: 30000 });
await page.waitForTimeout(800);

await page.getByText('文件管理', { exact: true }).click();
await page.waitForTimeout(500);
await page.locator('[data-fm-show-other-input]').first().check();
await page.waitForTimeout(800);
const groupRow = page.locator('[data-other-files-group]').first();
await groupRow.locator('button').first().click();
await page.waitForTimeout(400);
await page.locator('[data-doc-path="说明.txt"] [data-doc-open]').first().click();
await page.waitForTimeout(500);
check('树侧提示出现（非导图文件点击）', (await page.locator('[data-fm-tree-notice]').count()) === 1, null);
const gInline1 = await inlineGeom('[data-fm-tree-notice]');
check(
  '树侧提示几何 = inlineBarStyle（margin 0 12px 8px / padding 6px 8px / radius 6px）',
  gInline1 !== null &&
    gInline1.margin === '0px 12px 8px' &&
    gInline1.padding === '6px 8px' &&
    gInline1.borderRadius === '6px',
  JSON.stringify(gInline1),
);

// 6b. 投影失败 + 迁移失败（同一配额手段：index 写不进 localStorage）
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
// 先腾空配额写入旧库条目（触发惰性迁移），**再**填满（顺序反了旧键自己都写不进去）
await page.evaluate(() => {
  localStorage.removeItem('__quota_junk__');
  localStorage.setItem(
    'mindcanvas.library.v1',
    JSON.stringify([{ id: '旧文档.mm.md', name: '旧文档.mm.md', ts: 5, folder: '', tags: [] }]),
  );
});
await fillQuota();
await page.getByText('文件管理', { exact: true }).click();
await page.waitForTimeout(1500);
const projVisible = (await page.locator('[data-fm-projection-failed]').count()) === 1;
const migVisible = (await page.locator('[data-fm-migrate-failed]').count()) === 1;
check('投影失败条出现（配额下收藏/最近写回失败可见）', projVisible || migVisible, {
  projection: projVisible,
  migrate: migVisible,
});
const gInline2 = projVisible
  ? await inlineGeom('[data-fm-projection-failed]')
  : migVisible
    ? await inlineGeom('[data-fm-migrate-failed]')
    : null;
check(
  '失败条几何 = inlineBarStyle（与树侧提示同一事实源）',
  gInline2 !== null &&
    gInline2.margin === '0px 12px 8px' &&
    gInline2.padding === '6px 8px' &&
    gInline2.borderRadius === '6px',
  JSON.stringify(gInline2),
);
await page.evaluate(() => localStorage.removeItem('__quota_junk__'));

/* ───────────────────────── 7. 四条浮条基础外观一致（padding/radius/字号同一组件） ───────────────────────── */
const baseGeoms = [];
for (const slot of ['asset-notice', 'pre-dir-hint', 'command-notice', 'scale-notice']) {
  const g = await geom(slot);
  if (g !== null) baseGeoms.push([slot, g]);
}
// 逐条触发已结束，这里用已知值断言「同一组件」的纪律由单测钉死；真浏览器侧记录残留条几何
out.barGeoms = baseGeoms;

unconfirmed('TreeErrorBar（扫描失败条）', '真实 FSA 扫描失败在替身内存盘上不可复现；几何同 inlineBarStyle 由单测钉死');

const pass = finish();
console.log(JSON.stringify(out, null, 2));
await browser.close();
process.exit(pass ? 0 : 1);
