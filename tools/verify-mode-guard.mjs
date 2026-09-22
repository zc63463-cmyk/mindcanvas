/**
 * 真浏览器端到端验收：MODE-GUARD（包 2）离开保护
 * ══════════════════════════════════════════════════════════════════════
 * 跑法：先构建产物 + 静态托管 dist，再 `node tools/verify-mode-guard.mjs [baseUrl]`。
 *
 * 旅程 A · 导图 dirty → 切模式确认（键盘与遮罩）
 *   打开带句柄种子 → 编辑节点 → 点 App 浮标 → 确认框出现；
 *   Esc = 取消（内容保留、仍在导图）→ 点遮罩 = 取消 → Tab/Enter（默认焦点「保存并继续」）
 *   → 写盘（fs 句柄）→ 进入自由画布。
 * 旅程 B · 自由画布 fs 离开
 *   打开带句柄画布 → 建便签 → 「← 导图」→ 保存并继续 → 写回句柄 → 回到导图。
 * 旅程 C · 下载兜底不自动离开（?nofs=1：无 showSaveFilePicker）
 *   建便签 → 「← 导图」→ 保存并继续 → **留在自由画布** + 提示「已发起下载…」→ 放弃修改才离开。
 * 旅程 D · 中文组合未结束 + 遮罩不穿透 + beforeunload
 *   自由画布进入编辑态并派发 compositionstart → 「← 导图」→ 提示「输入法组合未结束」且不离开；
 *   确认框打开时 elementFromPoint 命中遮罩（工具栏不可被穿透点击）；dirty 时 beforeunload 被拦截。
 *
 * 不声称覆盖：系统文件选择器的**真实**用户手势（无头不可自动化，选择器以内存句柄顶替）。
 * 文件写入只落在内存句柄上，不触碰用户工作文档。
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { assertLoadedBundle, checkSnapshotFresh } from './lib/snapshotCheck.mjs';

const BASE = process.argv[2] ?? 'http://localhost:5175';
const SEED_NAME = 'mg-seed.mm.md';
/** 自由画布「打开」用的真画布 JSON（形状必须合法，直接取仓库里的演示文件） */
const CANVAS_JSON = readFileSync(
  new URL('../apps/canvas/src/demo/demo-free.mc.canvas.json', import.meta.url),
  'utf8',
);
const CANVAS_NAME = 'mg-canvas.mc.canvas.json';
/** 旅程 E：含 note.md 的文档（`note:` 块绑定其后第一个结构节点 = 甲） */
const NOTE_DOC_NAME = 'mg-note.mm.md';
const NOTE_DOC_TEXT = ['# 根', '', '<!--', 'note:', '  - 条目一', 'md: "## 原背面"', '-->', '', '## 甲', ''].join('\n');
const MD_EDITED = '## 改后的背面';
const MD_CANDIDATE = '## 尚未确认的背面候选';
const MD_CONFIRMED = '## 已确认的背面';
const SEED_TEXT = '# MG根\n\n- 甲节点\n- 乙节点\n';
const TARGET = '乙节点';
const EDITED = '乙节点改';
/** 组合输入（IME）联合断言用文本：未确认候选串 vs 确认后的文字 */
const CANDIDATE_TEXT = '尚未确认的候选文字';
const CONFIRMED_TEXT = '已确认的文字';

checkSnapshotFresh();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

await page.addInitScript(
  ({ seed, name, canvasJson, canvasName, noteName, noteText }) => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    window.__writes = [];
    window.__gates = [];
    window.__releaseWrite = (index) => {
      const g = window.__gates.find((x) => x.index === index);
      if (g) g.release();
    };
    window.__releaseAll = () => {
      for (const g of window.__gates) g.release();
    };
    // 置位后新闸门立即放行（避免「自动保存先占住闸门」干扰手动保存断言）
    window.__autoRelease = false;
    // 内存句柄：createWritable().close() 挂起，等脚本放行（可观察「保存中」窗口）
    const makeHandle = (handleName) => ({
      name: handleName,
      // 按扩展名给内容：导图用 .mm.md 种子，自由画布用合法 .mc.canvas.json
      getFile: async () =>
        handleName.endsWith('.mc.canvas.json')
          ? new File([canvasJson], handleName, { type: 'application/json' })
          : new File([handleName === noteName ? noteText : seed], handleName, { type: 'text/markdown' }),
      createWritable: async () => {
        const index = window.__writes.length + 1;
        let release = () => {};
        const gate = new Promise((resolve) => {
          release = () => resolve();
        });
        window.__gates.push({ index, release });
        if (window.__autoRelease) release();
        return {
          write: async (data) => {
            window.__writes.push({
              index,
              handle: handleName,
              text: typeof data === 'string' ? data : '[blob]',
            });
          },
          close: async () => {
            await gate;
          },
        };
      },
    });
    // 打开：按调用方请求的 types 分派 —— 导图（Markdown）给种子，自由画布（application/json）给画布。
    // `?notedoc=1` 时导图给「含 note.md 的文档」（旅程 E）。
    window.__openCount = 0;
    window.showOpenFilePicker = async (options) => {
      window.__openCount += 1;
      const wantsJson = JSON.stringify(options?.types ?? []).includes('application/json');
      if (wantsJson) return [makeHandle(canvasName)];
      return [makeHandle(location.search.includes('notedoc=1') ? noteName : name)];
    };
    // ?nofs=1：不提供 showSaveFilePicker → 保存走下载兜底（验证「下载不自动离开」）
    if (!location.search.includes('nofs=1')) {
      window.showSaveFilePicker = async () => makeHandle('mg-saved.mm.md');
    }
  },
  {
    seed: SEED_TEXT,
    name: SEED_NAME,
    canvasJson: CANVAS_JSON,
    canvasName: CANVAS_NAME,
    noteName: NOTE_DOC_NAME,
    noteText: NOTE_DOC_TEXT,
  },
);

const out = { base: BASE };
let pass = true;
const check = (name, ok, detail) => {
  out[name] = { ok, detail };
  if (!ok) pass = false;
};

const has = async (sel) => (await page.locator(sel).count()) > 0;
const text = async (sel) => (await page.locator(sel).first().textContent()) ?? '';
const click = (sel) => page.locator(sel).first().click();
const wait = (ms) => page.waitForTimeout(ms);

/**
 * 在指定编辑器上派发合成组合事件（bubbles 才能被 React 合成事件系统收到）。
 * 注意：这是**合成事件**，不覆盖真实输入法/候选框（见报告「验证限制」）。
 */
function dispatchCompositionOn(selector, type) {
  return page.evaluate(
    ({ sel, t }) => {
      document.querySelector(sel)?.dispatchEvent(new CompositionEvent(t, { bubbles: true }));
    },
    { sel: selector, t: type },
  );
}

/** 自由画布面编辑器上的组合事件（旅程 D） */
const dispatchComposition = (type) => dispatchCompositionOn('[data-fc-editor]', type);

/** 滚轮升档直到固定 note 面板出现（面板档位 k ≥ 0.65） */
async function ensureNotePanel(containerSel) {
  for (let i = 0; i < 8; i++) {
    if ((await page.locator(containerSel).count()) > 0) return true;
    await page.mouse.move(400, 300);
    await page.mouse.wheel(0, -600);
    await wait(200);
  }
  return (await page.locator(containerSel).count()) > 0;
}

/** 打开带句柄的种子文档（Ctrl+O → mock 内存句柄） */
async function openSeed() {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await assertLoadedBundle(page);
  const sample = page.getByRole('button', { name: '看内置示例' });
  if ((await sample.count()) > 0) await sample.click({ timeout: 3000 }).catch(() => undefined);
  await page.waitForSelector('[data-node-id]', { timeout: 20000 });
  await wait(500);
  await page.keyboard.press('Control+o');
  await page.waitForSelector(`g[data-node-id]:has-text("${TARGET}")`, { timeout: 20000 });
  await wait(600);
}

async function editNode(from, to) {
  const node = page.locator('g[data-node-id]', { hasText: from }).first();
  const bb = await node.boundingBox();
  if (bb === null) throw new Error(`节点无 boundingBox: ${from}`);
  await page.mouse.dblclick(bb.x + bb.width / 2, bb.y + bb.height / 2);
  const input = page.locator('[data-overlay-editor]').first();
  await input.waitFor({ state: 'visible', timeout: 5000 });
  await input.fill(to);
  await page.keyboard.press('Enter');
  await wait(200);
}

/**
 * 落一张便签。
 * `corner` = 落在画布右下空地（打开的演示画布在原点附近已有卡片，点中心可能命中既有卡而不新建）。
 */
async function createSticky(pos = 'center') {
  await click('[data-fc-tool="sticky"]');
  const host = page.locator('[data-fc-host]').first();
  const bb = await host.boundingBox();
  if (bb === null) throw new Error('缺少自由画布宿主');
  const x = pos === 'corner' ? bb.x + bb.width - 150 : bb.x + bb.width / 2;
  const y = pos === 'corner' ? bb.y + bb.height - 150 : bb.y + bb.height / 2;
  await page.mouse.click(x, y);
  await wait(250);
}

try {
  /* ---------------- 旅程 A：导图 dirty → 确认框键盘/遮罩 ---------------- */
  await openSeed();
  await editNode(TARGET, EDITED);
  check('A1 编辑后出现未保存标记', (await text('[data-save-state]')).includes('未保存'), {
    state: await text('[data-save-state]'),
  });

  await click('[data-app-freecanvas]');
  await wait(150);
  check('A2 切模式弹出确认框（不再静默丢弃）', await has('[data-unsaved-prompt]'), {
    fcStage: await has('[data-fc-stage]'),
  });
  check('A3 确认框内未离开导图', (await has('[data-fc-stage]')) === false, {});

  await page.keyboard.press('Escape');
  await wait(150);
  check('A4 Esc = 取消：模态关闭且内容保留', (await has('[data-unsaved-prompt]')) === false, {
    stillMindmap: (await has('[data-fc-stage]')) === false,
    keepsEdit: (await page.locator(`g[data-node-id]:has-text("${EDITED}")`).count()) > 0,
  });

  // 点遮罩（远离卡片中心）= 取消
  await click('[data-app-freecanvas]');
  await wait(120);
  await page.mouse.click(24, 24);
  await wait(150);
  check('A5 点遮罩 = 取消（保守，不当作确认/放弃）', (await has('[data-unsaved-prompt]')) === false, {
    stillMindmap: (await has('[data-fc-stage]')) === false,
  });

  // 遮罩不可穿透：确认框打开时，工具栏坐标处命中的是遮罩而不是按钮
  await click('[data-app-freecanvas]');
  await wait(120);
  const floatBox = await page.locator('[data-app-freecanvas]').first().boundingBox();
  const hitBackdrop = floatBox
    ? await page.evaluate(
        ({ x, y }) => {
          const el = document.elementFromPoint(x, y);
          return el?.closest('[data-unsaved-backdrop]') !== null;
        },
        { x: floatBox.x + floatBox.width / 2, y: floatBox.y + floatBox.height / 2 },
      )
    : false;
  check('A6 遮罩拦住下层点击（elementFromPoint = 遮罩）', hitBackdrop, { hitBackdrop });

  // 键盘：默认焦点在「保存并继续」；Tab 在模态内循环（不逃到画布），Enter 激活聚焦按钮
  const focusProbe = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      return {
        tag: el?.tagName ?? null,
        attrs: el === null ? null : (el.getAttribute('data-unsaved-save') ?? null) !== null,
        inModal: el?.closest?.('[data-unsaved-prompt]') !== null,
        modalOpen: document.querySelector('[data-unsaved-prompt]') !== null,
      };
    });
  const focusStart = await focusProbe();
  await page.keyboard.press('Tab');
  const focusAfter1 = await focusProbe();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const focusAfter3 = await focusProbe();
  check('A7 Tab 循环后焦点仍在模态内', focusAfter3.inModal, {
    focusStart,
    focusAfter1,
    focusAfter3,
  });
  await page.evaluate(() => {
    window.__autoRelease = true;
    window.__releaseAll(); // 放行可能已存在的自动保存闸门
  });
  await page.keyboard.press('Enter');
  await wait(600);
  const saveGate = await page.evaluate(() => window.__writes.length);
  const fcStageAfter = await has('[data-fc-stage]');
  check('A8 Enter 激活聚焦按钮「保存并继续」→ 写盘后进入自由画布', saveGate >= 1 && fcStageAfter, {
    writes: saveGate,
    fcStage: fcStageAfter,
  });
  check('A9 写盘内容为编辑后的文本', (await page.evaluate(() => window.__writes[0]?.text ?? '')).includes(EDITED), {});

  /* ---------------- 旅程 B：自由画布 fs 离开 ---------------- */
  await click('[data-fc-open]');
  await wait(500);
  check('B1 自由画布打开带句柄文档', (await text('[data-fc-title]')).includes(CANVAS_NAME), {
    title: await text('[data-fc-title]'),
  });
  const cardsBefore = await page.locator('[data-fc-card]').count();
  await createSticky('corner');
  const cardsAfter = await page.locator('[data-fc-card]').count();
  check('B2a 新便签已落下（模型变脏）', cardsAfter === cardsBefore + 1, { cardsBefore, cardsAfter });
  await click('[data-fc-exit]');
  await wait(150);
  check('B2 有未保存便签 → 返回导图弹确认', await has('[data-unsaved-prompt]'), {});
  await click('[data-unsaved-save]');
  await wait(250);
  await page.evaluate(() => window.__releaseAll());
  await wait(400);
  check('B3 保存并继续（fs）→ 回到导图', (await has('[data-fc-stage]')) === false, {
    prompt: await has('[data-unsaved-prompt]'),
  });

  /* ---------------- 旅程 C：下载兜底不自动离开（无 showSaveFilePicker） ---------------- */
  await page.goto(`${BASE}/?nofs=1`, { waitUntil: 'networkidle' });
  await assertLoadedBundle(page);
  await page.waitForSelector('[data-node-id]', { timeout: 20000 });
  await wait(300);
  await click('[data-app-freecanvas]');
  await wait(200);
  await createSticky();
  await click('[data-fc-exit]');
  await wait(150);
  await click('[data-unsaved-save]');
  await wait(500);
  const cNotice = await text('[data-unsaved-notice]');
  check('C1 下载兜底：不自动离开且提示已发起下载', (await has('[data-fc-stage]')) && cNotice.includes('已发起下载'), {
    notice: cNotice,
    fcStage: await has('[data-fc-stage]'),
  });
  await click('[data-unsaved-discard]');
  await wait(250);
  check('C2 显式放弃才离开', (await has('[data-fc-stage]')) === false, {});

  /* ---------------- 旅程 D：组合输入（IME）+ beforeunload ---------------- */
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await assertLoadedBundle(page);
  await page.waitForSelector('[data-node-id]', { timeout: 20000 });
  await wait(300);
  await click('[data-app-freecanvas]');
  await wait(250);
  await click('[data-fc-open]'); // 带句柄画布 → 后面可以断言**写出文本**
  await wait(400);
  await createSticky('corner');
  // 编辑态会把该卡的 `[data-fc-front]` 换成编辑框 → 正面元素数少 1 就是「未回写模型」的投影证据
  const frontsBeforeEdit = await page.locator('[data-fc-front]').count();

  // 进入卡片编辑态（双击）→ 输入未确认候选串 → 派发组合开始
  const card = page.locator('[data-fc-card]').last();
  const cb = await card.boundingBox();
  if (cb !== null) await page.mouse.dblclick(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.waitForSelector('[data-fc-editor]', { timeout: 5000 });
  await page.fill('[data-fc-editor]', CANDIDATE_TEXT);
  await dispatchComposition('compositionstart');

  await click('[data-fc-exit]');
  await wait(250);
  const editorKept = await has('[data-fc-editor]');
  const frontsWhileComposing = await page.locator('[data-fc-front]').count();
  check('D1 组合未结束：编辑器未被失焦关闭、未回写模型', editorKept === true && frontsWhileComposing === frontsBeforeEdit - 1, {
    editorKept,
    frontsBeforeEdit,
    frontsWhileComposing,
    inFc: await has('[data-fc-stage]'),
  });
  check(
    'D2 组合未结束：不弹模态（不抢焦点）+ 非模态提示 + 不离开',
    (await has('[data-unsaved-prompt]')) === false &&
      (await has('[data-unsaved-blocked]')) === true &&
      (await has('[data-fc-stage]')) === true,
    {
      prompt: await has('[data-unsaved-prompt]'),
      blocked: await has('[data-unsaved-blocked]'),
      blockedText: await text('[data-unsaved-blocked]'),
    },
  );
  const blockedByUnload = await page.evaluate(() => {
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  check('D3 dirty 时 beforeunload 被拦截（原生能力，不弹自定义模态）', blockedByUnload, {
    blockedByUnload,
  });

  // 完成组合（最后确认文字）→ 请求自动续跑 → 三选项模态
  await page.fill('[data-fc-editor]', CONFIRMED_TEXT);
  await dispatchComposition('compositionend');
  await page.waitForSelector('[data-unsaved-prompt]', { timeout: 8000 });
  check('D4 组合结束后自动续跑 → 出现三选项模态', await has('[data-unsaved-prompt]'), {
    prompt: await has('[data-unsaved-prompt]'),
  });

  await page.evaluate(() => {
    window.__autoRelease = true; // 之后新开的写入闸门立即放行（避免与「闸门何时登记」竞速）
    window.__releaseAll();
  });
  await click('[data-unsaved-save]');
  await wait(700);
  const writes = await page.evaluate(() => window.__writes.map((w) => w.text).join('\n'));
  check(
    'D5 保存并继续 → 写出的是确认后的文字；候选串从未进入模型/文件',
    (await has('[data-fc-stage]')) === false &&
      writes.includes(CONFIRMED_TEXT) &&
      !writes.includes(CANDIDATE_TEXT),
    {
      left: (await has('[data-fc-stage]')) === false,
      hasConfirmed: writes.includes(CONFIRMED_TEXT),
      hasCandidate: writes.includes(CANDIDATE_TEXT),
    },
  );
  /* -------- 旅程 E：背面 Markdown 预览态草稿 + 输入焦点链路（MG-R4 / MG-R1-B） -------- */
  await page.goto(`${BASE}/?notedoc=1`, { waitUntil: 'networkidle' });
  await assertLoadedBundle(page);
  await page.waitForSelector('[data-node-id]', { timeout: 20000 });
  await wait(400);
  await page.keyboard.press('Control+o'); // 打开含 note.md 的文档（内存句柄）
  await page.waitForSelector('g[data-node-id]:has-text("甲")', { timeout: 20000 });
  await wait(600);

  // 点节点 → 固定 note 面板（面板档位不足时先滚轮升档）
  await page.locator('g[data-node-id]', { hasText: '甲' }).first().click();
  const panelReady = await ensureNotePanel('[data-note-flip]');
  check('E1 点节点固定 note 面板（翻面入口可用）', panelReady, {
    flip: await has('[data-note-flip]'),
  });

  await click('[data-note-flip]'); // 翻到背面
  await wait(400);
  await click('[data-note-md-edit]'); // 编辑背面
  await page.waitForSelector('[data-note-md-input]', { timeout: 8000 });

  // 改源文 → 切预览（textarea 卸载；草稿只在组件状态里）
  await page.fill('[data-note-md-input]', MD_EDITED);
  await click('[data-note-md-toggle]');
  await wait(300);
  check('E2 切预览后源文编辑器卸载（草稿转入组件状态）', (await has('[data-note-md-input]')) === false, {
    preview: await has('[data-note-md-preview]'),
  });

  const blockedByDraft = await page.evaluate(() => {
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  check('E3 预览态草稿：beforeunload 拦截（不再判成「没有草稿」）', blockedByDraft, {
    blockedByDraft,
  });

  // 请求切模式 → 先 flush 草稿（进模型）→ 变脏 → 三选项模态
  await click('[data-app-freecanvas]');
  await page.waitForSelector('[data-unsaved-prompt]', { timeout: 8000 });
  check('E4 预览态草稿被提交：切模式出现确认（不静默丢弃）', (await has('[data-unsaved-prompt]')) && (await has('[data-fc-stage]')) === false, {
    inFc: await has('[data-fc-stage]'),
  });

  await click('[data-unsaved-cancel]');
  await wait(300);
  check('E5 取消后仍在导图（内容未被丢弃）', (await has('[data-fc-stage]')) === false && (await has('[data-unsaved-prompt]')) === false, {});

  // 组合输入：源文编辑器里组合中 → 点入口（真实浏览器这一步会让编辑框失焦）
  await click('[data-note-md-edit]');
  await page.waitForSelector('[data-note-md-input]', { timeout: 8000 });
  await page.fill('[data-note-md-input]', MD_CANDIDATE);
  await dispatchCompositionOn('[data-note-md-input]', 'compositionstart');
  await click('[data-app-freecanvas]');
  await wait(300);
  check(
    'E6 组合未结束：源文编辑器未被失焦关闭、不弹模态、非模态提示可见',
    (await has('[data-note-md-input]')) === true &&
      (await has('[data-unsaved-prompt]')) === false &&
      (await has('[data-unsaved-blocked]')) === true,
    {
      editor: await has('[data-note-md-input]'),
      prompt: await has('[data-unsaved-prompt]'),
      blocked: await has('[data-unsaved-blocked]'),
    },
  );

  // 组合结束（确认文字）→ 自动续跑 → 保存并继续 → 写出的文件是确认文字、从不含候选串
  await page.fill('[data-note-md-input]', MD_CONFIRMED);
  await dispatchCompositionOn('[data-note-md-input]', 'compositionend');
  await page.waitForSelector('[data-unsaved-prompt]', { timeout: 8000 });
  check('E7 组合结束后自动续跑 → 三选项模态', await has('[data-unsaved-prompt]'), {});
  await page.evaluate(() => {
    window.__autoRelease = true;
    window.__releaseAll();
  });
  await click('[data-unsaved-save]');
  await wait(800);
  const mdWrites = await page.evaluate(() => window.__writes.map((w) => w.text).join('\n'));
  check(
    'E8 保存并继续：写出文件含确认文字、从不含候选串，且已进入自由画布',
    (await has('[data-fc-stage]')) === true &&
      mdWrites.includes('已确认的背面') &&
      !mdWrites.includes('尚未确认的背面候选'),
    {
      left: await has('[data-fc-stage]'),
      hasConfirmed: mdWrites.includes('已确认的背面'),
      hasCandidate: mdWrites.includes('尚未确认的背面候选'),
    },
  );
} catch (e) {
  check('脚本执行', false, String(e));
} finally {
  await browser.close();
}

out.result = pass ? 'PASS' : 'FAIL';
console.log(JSON.stringify(out, null, 2));
process.exit(pass ? 0 : 1);
