/**
 * 真浏览器端到端验收：方向键**几何导航**（A 档）
 * ══════════════════════════════════════════════════════════════════════
 * 跑法：node tools/verify-arrow-navigation.mjs [baseUrl]   （默认 http://localhost:5175）
 *
 * 用 mock 文件句柄打开受控文档，逐条断言（含**旧实现必红**的判别项）：
 *   ① ↓ from A  → 选中**不变**（A 正下方无节点；旧语义会钻入 A1）
 *   ② → from B  → 根（左翼的"右"是父；旧语义给 null）
 *   ③ ← from B  → 选中不变（左翼尽头；旧语义会跳到父）
 *   ④ ↓ from A1 → A2（同翼兄弟正向守卫）
 *   ⑤ 视口跟随：放大到目标出视口后按 →，断言选中节点**必在视口内**（最小推入生效）
 *
 * 文档（`.mm.md`）与默认双翼布局：
 *   根(0,0) · A(+108,0) · A1(+216,−24) · A2(+216,+24) · B(−108,0)
 */
import { chromium } from 'playwright';
import { assertLoadedBundle, checkSnapshotFresh } from './lib/snapshotCheck.mjs';

const BASE = process.argv[2] ?? 'http://localhost:5175';
const DOC = '# 根\n\n- A\n  - A1\n  - A2\n- B\n';

// 先验产物新鲜度：防止「测的是旧快照」导致的假阴性（2026-09-13 已踩过一次）
checkSnapshotFresh();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

await page.addInitScript((seed) => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  const handle = {
    name: 'arrow-nav.mm.md',
    getFile: async () => new File([seed], 'arrow-nav.mm.md', { type: 'text/markdown' }),
    createWritable: async () => ({ write: async () => undefined, close: async () => undefined }),
  };
  window.showOpenFilePicker = async () => [handle];
}, DOC);

/** 精确文本 → 节点 id（避免 has-text 子串误配："A" 会匹配到 A1/A2） */
const idByText = (text) =>
  page.$$eval(
    'g[data-node-id]',
    (gs, t) => {
      for (const g of gs) {
        if ((g.textContent ?? '').trim() === t) return g.getAttribute('data-node-id');
      }
      return null;
    },
    text,
  );

/** 当前选中节点 id（按描边 = 选中色判定；选中色先由一次点击采样得到） */
let selectionStroke = '';
const selectedId = () =>
  page.$$eval(
    'g[data-node-id]',
    (gs, sel) => {
      for (const g of gs) {
        const rect = g.querySelector('rect');
        if (rect?.getAttribute('stroke') === sel) return g.getAttribute('data-node-id');
      }
      return null;
    },
    selectionStroke,
  );

/** 点击某文本节点（按盒中心） */
const clickNode = async (text) => {
  const id = await idByText(text);
  const node = page.locator(`g[data-node-id="${id}"]`).first();
  const bb = await node.boundingBox();
  await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.waitForTimeout(250);
  return id;
};

/** 选中节点盒是否完整落在视口内（含 24px 推入内边距） */
const selectedBoxInViewport = async () => {
  const id = await selectedId();
  if (id === null) return { ok: false, why: '无选中节点' };
  // 量节点**矩形本体**（rect）而非整个 <g>：<g> 还含折叠三角/角标等装饰，
  // 会比模型盒宽几像素 —— 而推入是按模型盒（ln.box）算的，两者要同口径比。
  const bb = await page.locator(`g[data-node-id="${id}"] rect`).first().boundingBox();
  if (bb === null) return { ok: false, why: '选中节点无矩形' };
  const PAD = 24;
  const TOL = 6; // 描边/圆角外扩容差
  const ok =
    bb.x >= PAD - TOL &&
    bb.y >= PAD - TOL &&
    bb.x + bb.width <= 1280 - PAD + TOL &&
    bb.y + bb.height <= 800 - PAD + TOL;
  return {
    ok,
    box: { x: Math.round(bb.x), y: Math.round(bb.y), w: Math.round(bb.width), h: Math.round(bb.height) },
  };
};

const out = { base: BASE };
let pass = true;
const check = (name, ok, detail) => {
  out[name] = { ok, detail };
  if (!ok) pass = false;
};

try {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await assertLoadedBundle(page); // ③ 防浏览器缓存旧 bundle
  await page.waitForSelector('[data-node-id]', { timeout: 20000 });
  await page.keyboard.press('Control+o'); // mock 句柄 → 受控文档
  await page.waitForFunction(
    () => [...document.querySelectorAll('g[data-node-id]')].some((g) => (g.textContent ?? '').trim() === 'A1'),
    { timeout: 20000 },
  );
  await page.waitForTimeout(600);

  // 采样选中描边色（自适应主题，不硬编码）
  const probe = await clickNode('根');
  selectionStroke = await page
    .locator(`g[data-node-id="${probe}"] rect`)
    .first()
    .getAttribute('stroke');

  // ① ↓ from A：A 正下方无节点 → 选中不变（旧语义：钻入 A1）
  const idA = await clickNode('A');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(250);
  const afterDownA = await selectedId();
  check('① ↓ from A 不钻子树（选中保持 A）', afterDownA === idA, { expected: idA, got: afterDownA });

  // ② → from B：左翼的"右"是父（旧语义：null）
  const idB = await clickNode('B');
  const idRoot = await idByText('根');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(250);
  const afterRightB = await selectedId();
  check('② → from B 走到根（左翼几何右 = 父）', afterRightB === idRoot, {
    expected: idRoot,
    got: afterRightB,
  });

  // ③ ← from B：左翼尽头 → 选中不变（旧语义：跳到父）
  await clickNode('B');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(250);
  const afterLeftB = await selectedId();
  check('③ ← from B 不动（B 左侧无节点）', afterLeftB === idB, { expected: idB, got: afterLeftB });

  // ④ ↓ from A1 → A2（正向守卫）
  const idA1 = await clickNode('A1');
  const idA2 = await idByText('A2');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(250);
  const afterDownA1 = await selectedId();
  check('④ ↓ from A1 → A2（同翼兄弟）', afterDownA1 === idA2, { expected: idA2, got: afterDownA1 });

  // ⑤ 视口跟随：Ctrl+0 定标（k=1 居中原点）→ 以根为中心放大 4×（ZOOM_MAX）
  //    → 根(640,400) 与 A(1072,400) 在视口内、A1(1504,·) 出视口；
  //    从根连按两次 →：第 2 次的目标在视口外，**最小推入**必须把它带进来。
  const contentTransform = () =>
    page.evaluate(() => {
      const g = document.querySelector('svg g[transform]');
      return g?.getAttribute('transform') ?? null;
    });
  await page.keyboard.press('Control+0');
  await page.waitForTimeout(500);
  await page.mouse.move(640, 400);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -240);
  await page.waitForTimeout(400);
  const idRoot2 = await clickNode('根');
  const idARight = await idByText('A');
  const idA1Right = await idByText('A1');
  check('⑤-0 布景：Ctrl+0 + 4× 放大后根已选中', (await selectedId()) === idRoot2, {
    selected: await selectedId(),
    wanted: idRoot2,
    tf: await contentTransform(),
  });

  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(420);
  const vis1 = await selectedBoxInViewport();
  check('⑤-1 放大后 → from 根 → A（视口内，无需推入）', (await selectedId()) === idARight, {
    expected: idARight,
    got: await selectedId(),
    ...vis1,
  });

  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  const vis2 = await selectedBoxInViewport();
  check('⑤-2 再 → → A1（原在视口外）→ 最小推入带进视口', vis2.ok && (await selectedId()) === idA1Right, {
    expected: idA1Right,
    got: await selectedId(),
    tf: await contentTransform(),
    ...vis2,
  });
} catch (e) {
  check('脚本执行', false, String(e));
} finally {
  await browser.close();
}

out.result = pass ? 'PASS' : 'FAIL';
console.log(JSON.stringify(out, null, 2));
process.exit(pass ? 0 : 1);
