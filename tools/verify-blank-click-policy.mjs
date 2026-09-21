/**
 * 真浏览器端到端验收：画布空白处的点击策略（v1.8.10 用户裁决）
 * ══════════════════════════════════════════════════════════════════════
 * 跑法：node tools/verify-blank-click-policy.mjs [baseUrl]   （默认 http://localhost:5175）
 *
 * 裁决内容：
 *   ④ 单击空白 = **只取消选中**（不再顺手清 note 的固定/编辑态 —— 那是用户显式打开的面板，
 *      此前会被静默关掉 = 正在输入的笔记内容直接消失）；
 *   ③ 双击空白 = **无操作**（不再 fit 回全图）。
 *
 * 断言：
 *   ① 点击"有笔记的节点"→ 选中 + 固定卡片出现（`[data-note-pinned="true"]`）
 *   ② 单击空白 → 选中被清（保留行为）**且固定卡片仍在**（新行为）
 *   ③ 双击空白 → 视口变换不变（新行为；旧实现在这里会变成 fit 目标）
 */
import { chromium } from 'playwright';
import { assertLoadedBundle, checkSnapshotFresh } from './lib/snapshotCheck.mjs';

const BASE = process.argv[2] ?? 'http://localhost:5175';
/** 夹具：根 + A（带 note_text）+ B —— 注释块写在被注释节点标题之前 */
const DOC = '# 根\n\n<!--\nnote_text: 夹具笔记\n-->\n## A\n\n## B\n';

checkSnapshotFresh(); // P0：产物新鲜度（防"修了但测的是旧快照"）

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

await page.addInitScript((seed) => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  const handle = {
    name: 'blank-click.mm.md',
    getFile: async () => new File([seed], 'blank-click.mm.md', { type: 'text/markdown' }),
    createWritable: async () => ({ write: async () => undefined, close: async () => undefined }),
  };
  window.showOpenFilePicker = async () => [handle];
}, DOC);

const idByText = (text) =>
  page.$$eval(
    'g[data-node-id]',
    (gs, t) => {
      for (const g of gs) if ((g.textContent ?? '').trim() === t) return g.getAttribute('data-node-id');
      return null;
    },
    text,
  );

let selectionStroke = '';
const selectedId = () =>
  page.$$eval(
    'g[data-node-id]',
    (gs, sel) => {
      for (const g of gs) if (g.querySelector('rect')?.getAttribute('stroke') === sel) return g.getAttribute('data-node-id');
      return null;
    },
    selectionStroke,
  );

const pinnedCount = () => page.locator('[data-note-pinned="true"]').count();
const contentTransform = () => page.evaluate(() => document.querySelector('svg > g[transform]')?.getAttribute('transform') ?? null);

/** 找一个不在任何节点盒附近的屏幕点（含 8px 余量） */
const blankPoint = async () => {
  const boxes = await page.$$eval('g[data-node-id]', (gs) =>
    gs.map((g) => {
      const r = g.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }),
  );
  const cands = [
    [40, 760],
    [1240, 760],
    [40, 40],
    [1240, 40],
    [640, 780],
    [64, 420],
    [1216, 420],
  ];
  for (const [x, y] of cands) {
    if (!boxes.some((b) => x >= b.x - 8 && x <= b.x + b.w + 8 && y >= b.y - 8 && y <= b.y + b.h + 8)) {
      return { x, y };
    }
  }
  throw new Error('找不到可用的空白点');
};

const out = { base: BASE };
let pass = true;
const check = (name, ok, detail) => {
  out[name] = { ok, detail };
  if (!ok) pass = false;
};

try {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await assertLoadedBundle(page); // P0：防浏览器缓存旧 bundle
  await page.waitForSelector('[data-node-id]', { timeout: 20000 });
  await page.keyboard.press('Control+o'); // mock 句柄 → 受控文档
  await page.waitForFunction(
    () => [...document.querySelectorAll('g[data-node-id]')].some((g) => (g.textContent ?? '').trim() === 'A'),
    { timeout: 20000 },
  );
  await page.waitForTimeout(600);

  const idA = await idByText('A');
  const nodeA = page.locator(`g[data-node-id="${idA}"]`).first();
  const bb = await nodeA.boundingBox();
  await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.waitForTimeout(350);
  selectionStroke = await nodeA.locator('rect').first().getAttribute('stroke');
  const pinnedAfterSelect = await pinnedCount();
  check('① 点击有笔记的节点 → 选中 + 固定卡片出现', (await selectedId()) === idA && pinnedAfterSelect >= 1, {
    selected: await selectedId(),
    expected: idA,
    pinned: pinnedAfterSelect,
  });

  // ② 单击空白：只取消选中，固定卡片必须保留
  const bp1 = await blankPoint();
  await page.mouse.click(bp1.x, bp1.y);
  await page.waitForTimeout(350);
  const selAfterBlank = await selectedId();
  const pinnedAfterBlank = await pinnedCount();
  check('② 单击空白 → 选中被清 且 note 卡片仍在（只取消选中）', selAfterBlank === null && pinnedAfterBlank >= 1, {
    selected: selAfterBlank,
    pinned: pinnedAfterBlank,
    point: bp1,
  });

  // ③ 双击空白：视口不变
  const tfBefore = await contentTransform();
  const bp2 = await blankPoint();
  await page.mouse.dblclick(bp2.x, bp2.y);
  await page.waitForTimeout(500);
  const tfAfter = await contentTransform();
  check('③ 双击空白 → 视口变换不变（不再 fit 回全图）', tfAfter === tfBefore, {
    before: tfBefore,
    after: tfAfter,
    point: bp2,
  });
} catch (e) {
  check('脚本执行', false, String(e));
} finally {
  await browser.close();
}

out.result = pass ? 'PASS' : 'FAIL';
console.log(JSON.stringify(out, null, 2));
process.exit(pass ? 0 : 1);
