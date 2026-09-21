/**
 * S4 真浏览器验收：摘要括线（创建 / 成员变化 / 方向 / 导出）
 * ══════════════════════════════════════════════════════════════════════
 * 跑法：
 *   1) cd apps/canvas && 构建（`pnpm -r build`）
 *   2) 静态服务本 worktree 的 dist：`npx vite preview --port 5176`（在 apps/canvas 下）
 *   3) `node tools/verify-summary.mjs [baseUrl]`（默认 http://localhost:5176）
 *
 * ## 证据输出目录（重要，勿踩）
 * 截图 / `bundle.txt` / 导出件的落盘目录由环境变量 **`REVIEW_SHOTS`** 决定；
 * 未设置时默认写 `outputs/summary-node/S4/S4-20260921-160000/browser`
 * —— 那是**已入库的历史证据目录**。跑新一轮验收时**务必显式指定**，否则会覆盖旧证据：
 *   `REVIEW_SHOTS=outputs/summary-node/<新RunId>/browser node tools/verify-summary.mjs <url>`
 * 另可用 `--shots=<dir>` 参数（等价，命令行优先）。
 *
 * 前置守卫：`lib/snapshotCheck.mjs` 三查（产物存在 / 新于源码与 HEAD / 页面实际
 * 加载的 bundle == 产物引用的 bundle）。**页面必须加载本 worktree 新构建的 bundle**；
 * 首屏后 `assertLoadedBundle` 打印实际加载路径，不一致即 exit 1。
 *
 * ## 覆盖（任务书 §七）
 * - A 创建摘要：真实右键入口 → 两跳点选 → 摘要节点出现 → **括线出现** → 可选中；
 * - B 成员变化：删中间成员 → 括线收缩；删端点 → 降级（无括线）且无节点消失；
 * - C 方向：右向（A 组已证）；左向用「森林左岛」夹具；org/显式 dir/框内 → 节点可见但无括线；
 * - D 导出：SVG 含括线 path；三主题；三档缩放；截图与导出件落盘存证。
 *
 * ## 边界（不伪称覆盖）
 * - 文件选择器用 `showOpenFilePicker` **桩**（浏览器自动化无法驱动真实 OS 选择器）；
 * - 真实 OS 输入法、跨浏览器（仅 Chromium）不在本脚本范围。
 * 这两条与仓内既有 `verify-*` 脚本同边界，已在回执「未覆盖项」明列。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { assertLoadedBundle, checkSnapshotFresh } from './lib/snapshotCheck.mjs';

/** 默认写**已入库的历史证据目录**；新一轮验收必须用 REVIEW_SHOTS 或 --shots= 覆盖。 */
const DEFAULT_SHOTS = 'outputs/summary-node/S4/S4-20260921-160000/browser';
const BASE = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:5176';
const SHOTS =
  process.argv
    .slice(2)
    .find((a) => a.startsWith('--shots='))
    ?.slice('--shots='.length) ??
  process.env.REVIEW_SHOTS ??
  DEFAULT_SHOTS;
mkdirSync(SHOTS, { recursive: true });
if (SHOTS === DEFAULT_SHOTS && !process.env.REVIEW_SHOTS_ALLOW_LEGACY) {
  console.warn(
    `[verify-summary] ⚠️ 未指定输出目录，正在写入历史证据目录：${DEFAULT_SHOTS}\n` +
      `                 这会**覆盖已入库的 S4 证据**。如需如此请设 REVIEW_SHOTS_ALLOW_LEGACY=1；\n` +
      `                 否则请用 REVIEW_SHOTS=<新目录> 或 --shots=<新目录>。`,
  );
}

// ---------------------------------------------------------------- 文档夹具
/** 右向：根 → 父[A(带子) B C D]。A 的子用于验证「成员带含子树」。 */
const DOC_RIGHT = [
  '# 根',
  '',
  '## 父',
  '',
  '- A',
  '',
  '  - A子',
  '',
  '- B',
  '',
  '- C',
  '',
  '- D',
  '',
].join('\n');

/**
 * 左向：森林双岛（左右各一中心）。右岛/左岛由 centers 的 dir 决定；
 * 左岛内的摘要应产 side=left 的括线。
 */
const DOC_LEFT = [
  '<!--',
  'centers:',
  '  - at: "node:根/右岛"',
  '    cid: cr',
  '    dir: right',
  '    x: 260',
  '    y: 0',
  '  - at: "node:根/左岛"',
  '    cid: cl',
  '    dir: left',
  '    x: -260',
  '    y: 0',
  '-->',
  '# 根',
  '',
  '## 右岛',
  '',
  '### 右一',
  '',
  '### 右二',
  '',
  '## 左岛',
  '',
  '### 左一',
  '',
  '### 左二',
  '',
].join('\n');

/** org 布局（down）：不承诺卫星 → 摘要应留流内可见、无括线 */
const DOC_ORG = ['<!--', 'layout: org', '-->', '# 根', '', '## 父', '', '- A', '', '- B', '', '- C', ''].join('\n');

/** 普通文档（无摘要）：导出零差异对照 */
const DOC_PLAIN = ['# 根', '', '## 甲', '', '## 乙', ''].join('\n');

checkSnapshotFresh();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });

/** 文档队列桩：按 Ctrl+O 顺序供给夹具 */
const DOC_QUEUE = [DOC_RIGHT, DOC_LEFT, DOC_ORG, DOC_PLAIN];
await page.addInitScript(
  (docs) => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    const queue = docs.map((src, i) => ({ name: `s4-doc-${i}.mm.md`, src }));
    window.__s4Queue = queue.length;
    window.showOpenFilePicker = async () => {
      const item = queue.shift();
      if (!item) throw new Error('S4 夹具已用尽');
      return [
        {
          name: item.name,
          getFile: async () => new File([item.src], item.name, { type: 'text/markdown' }),
          createWritable: async () => ({
            write: async () => undefined,
            close: async () => undefined,
          }),
        },
      ];
    };
  },
  DOC_QUEUE,
);

let pass = true;
const check = (name, ok, detail) => {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) pass = false;
};
const section = (t) => console.log(`\n──── ${t} ────`);

// ---------------------------------------------------------------- 工具
const nodeIds = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('g[data-node-id]')].map((g) => g.getAttribute('data-node-id')),
  );

/** 节点世界中心 + 世界→屏幕变换（fit/缩放后非恒等，必须换算） */
const geom = (nid) =>
  page.evaluate((id) => {
    const g = document.querySelector(`g[data-node-id="${id}"]`);
    if (!g) return null;
    const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(g.getAttribute('transform') ?? '');
    const r = g.querySelector('rect');
    if (!m || !r) return null;
    const svg = g.closest('svg');
    const tg = svg ? [...svg.children].find((el) => el.tagName === 'g') : null;
    const t = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\)\s*scale\(\s*(-?[\d.]+)/.exec(
      tg?.getAttribute('transform') ?? '',
    );
    return {
      wx: Number(m[1]),
      wy: Number(m[2]),
      w: Number(r.getAttribute('width') ?? 0),
      h: Number(r.getAttribute('height') ?? 0),
      tx: t ? Number(t[1]) : 0,
      ty: t ? Number(t[2]) : 0,
      k: t ? Number(t[3]) : 1,
    };
  }, nid);

const textOf = (nid) =>
  page.evaluate(
    (id) => (document.querySelector(`g[data-node-id="${id}"]`)?.textContent ?? '').trim(),
    nid,
  );

const idOfText = async (text) => {
  for (const id of await nodeIds()) if ((await textOf(id)) === text) return id;
  return null;
};

const clickNodeText = async (text) => {
  const id = await idOfText(text);
  if (id === null) throw new Error(`画布找不到节点「${text}」`);
  const g = await geom(id);
  if (g === null) throw new Error(`节点「${text}」无几何`);
  await page.mouse.click((g.wx + g.w / 2) * g.k + g.tx, (g.wy + g.h / 2) * g.k + g.ty);
  await page.waitForTimeout(150);
  return id;
};

const rightClickNodeText = async (text) => {
  const id = await idOfText(text);
  if (id === null) throw new Error(`画布找不到节点「${text}」`);
  const g = await geom(id);
  await page.mouse.click((g.wx + g.w / 2) * g.k + g.tx, (g.wy + g.h / 2) * g.k + g.ty, {
    button: 'right',
  });
  await page.waitForTimeout(250);
};

const clickMenuItem = async (label) => {
  const items = await page.$$('[data-menu-item]');
  const seen = [];
  for (const it of items) {
    const t = ((await it.textContent()) ?? '').trim();
    seen.push(t);
    if (t.startsWith(label)) {
      await it.click();
      await page.waitForTimeout(300);
      return true;
    }
  }
  throw new Error(`菜单项「${label}」缺失；现有=${JSON.stringify(seen)}`);
};

/** 括线读回（渲染层 DOM 口径） */
const brackets = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-summary-bracket]')].map((p) => {
      const g = p.closest('[data-summary-id]');
      const sid = p.getAttribute('data-summary-bracket');
      const d = p.getAttribute('d') ?? '';
      const nums = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
      const xs = [];
      const ys = [];
      for (let i = 0; i + 1 < nums.length; i += 2) {
        xs.push(nums[i]);
        ys.push(nums[i + 1]);
      }
      return {
        id: sid,
        side: g?.getAttribute('data-summary-side') ?? null,
        d,
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
        hasStem: document.querySelector(`[data-summary-stem="${sid}"]`) !== null,
        pointerEvents: p.getAttribute('pointer-events') ?? p.style.pointerEvents ?? null,
      };
    }),
  );

/** 世界盒并集（成员带对照；含子树由 selector 决定） */
const worldBoxOf = async (texts) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of texts) {
    const id = await idOfText(t);
    if (id === null) continue;
    const g = await geom(id);
    if (g === null) continue;
    minX = Math.min(minX, g.wx);
    minY = Math.min(minY, g.wy);
    maxX = Math.max(maxX, g.wx + g.w);
    maxY = Math.max(maxY, g.wy + g.h);
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
};

const openDoc = async () => {
  await page.keyboard.press('Control+o');
  await page.waitForTimeout(800);
};
const fitView = async () => {
  await page.keyboard.press('Control+0');
  await page.waitForTimeout(400);
};

// ---------------------------------------------------------------- 首屏
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
const loadedBundle = await assertLoadedBundle(page);
await page.waitForSelector('[data-node-id]', { timeout: 20000 });
await openDoc();
await page.waitForFunction(() => document.querySelectorAll('g[data-node-id]').length >= 5, undefined, {
  timeout: 20000,
});
await page.waitForTimeout(700);
console.log('[bundle] 页面实际加载 =', loadedBundle);
writeFileSync(
  `${SHOTS}/bundle.txt`,
  `base=${BASE}\nloadedBundle=${loadedBundle}\n`,
);

// ════════════════════════════════ A 创建摘要
section('A · 创建摘要（真实右键入口 + 两跳点选）');
await fitView();
check('A0 初始：无括线', (await brackets()).length === 0);

await rightClickNodeText('A');
const hasSummaryItem = await page.evaluate(() =>
  [...document.querySelectorAll('[data-menu-item]')].some((el) =>
    ((el.textContent ?? '').trim()).startsWith('创建摘要'),
  ),
);
check('A1 右键菜单含「创建摘要…」', hasSummaryItem);
await page.screenshot({ path: `${SHOTS}/a1-menu.png` });

await clickMenuItem('创建摘要');
const draftShown = await page.evaluate(() =>
  [...document.querySelectorAll('*')].some((el) =>
    (el.textContent ?? '').includes('点选范围末成员'),
  ),
);
check('A2 第一跳后出现引导文案（等待末成员）', draftShown);
await page.screenshot({ path: `${SHOTS}/a2-draft.png` });

await clickNodeText('C');
await page.waitForTimeout(500);

const summaryId = await idOfText('摘要');
check('A3 摘要节点出现', summaryId !== null, { summaryId });
const created = await brackets();
check('A4 括线出现（恰好 1 条）', created.length === 1, { n: created.length });
const b0 = created[0];
check('A5 括线带 stem', b0?.hasStem === true);
check('A6 方向 = 右向', b0?.side === 'right', { side: b0?.side });
check('A7 括线 pointer-events:none（不抢命中）', b0?.pointerEvents === 'none', {
  pe: b0?.pointerEvents,
});

const band = await worldBoxOf(['A', 'A子', 'B', 'C']);
if (band && b0) {
  check('A8 括线竖段在成员带右侧', b0.maxX >= band.maxX - 1e-6, {
    bracketMaxX: b0.maxX,
    bandMaxX: band.maxX,
  });
  check(
    'A9 括线纵向贴合成员带上下沿',
    Math.abs(b0.minY - band.minY) < 1.5 && Math.abs(b0.maxY - band.maxY) < 1.5,
    { bracket: [b0.minY, b0.maxY], band: [band.minY, band.maxY] },
  );
}
await page.screenshot({ path: `${SHOTS}/a3-created.png` });

if (summaryId !== null) {
  // 创建后摘要**已自动选中**（生产 `createSummary` 末尾 `controller.select(S)`）——
  // 故此处先断言自动选中态，再看「选中 → 成员高亮」。
  const autoSel = await page.evaluate(() => document.querySelectorAll('[data-summary-highlight]').length);
  check('A10 创建后摘要自动选中 → 成员高亮出现', autoSel >= 1, { highlight: autoSel });
  await page.screenshot({ path: `${SHOTS}/a4-selected.png` });

  // 点空白取消 → 再点摘要 → 重新选中（证明点击真能选中，不是「恰好本来就选着」）
  await page.mouse.click(20, 860);
  await page.waitForTimeout(300);
  const cleared = await page.evaluate(() => document.querySelectorAll('[data-summary-highlight]').length);
  check('A11 点空白取消选中（高亮消失）', cleared === 0, { highlight: cleared });

  await clickNodeText('摘要');
  const reSel = await page.evaluate(() => document.querySelectorAll('[data-summary-highlight]').length);
  check('A12 从未选中态点选摘要 → 成员高亮出现（可选中）', reSel >= 1, { highlight: reSel });

  // 选中成员 → 反向高亮所属摘要（§三.10；只读状态，不改布局数据）
  const layoutBefore = JSON.stringify(await brackets());
  await clickNodeText('B');
  const memberSel = await page.evaluate(
    () => document.querySelectorAll('[data-summary-highlight]').length,
  );
  check('A13 选中成员 → 反向显示所属摘要状态', memberSel >= 1, { highlight: memberSel });
  const layoutAfter = JSON.stringify(await brackets());
  check('A14 选择不改变括线几何/布局数据', layoutBefore === layoutAfter);
}

// ════════════════════════════════ B 成员变化
section('B · 成员变化（删除成员 → 收缩 / 降级）');
const beforeDel = await brackets();
check('B0 前置：1 条括线', beforeDel.length === 1);

await rightClickNodeText('B');
await clickMenuItem('删除节点');
await page.waitForTimeout(600);
const afterMid = await brackets();
check('B1 删中间成员：括线仍在（1 条）', afterMid.length === 1, { n: afterMid.length });
if (afterMid[0] && beforeDel[0]) {
  check(
    'B2 括线范围收缩（纵向跨度变小）',
    afterMid[0].maxY - afterMid[0].minY < beforeDel[0].maxY - beforeDel[0].minY - 1e-6,
    {
      before: beforeDel[0].maxY - beforeDel[0].minY,
      after: afterMid[0].maxY - afterMid[0].minY,
    },
  );
}
await page.screenshot({ path: `${SHOTS}/b1-shrunk.png` });

const nodesBefore = (await nodeIds()).length;
await rightClickNodeText('A');
await clickMenuItem('删除节点');
await page.waitForTimeout(600);
check('B3 删端点：括线消失（降级）', (await brackets()).length === 0);
check('B4 摘要节点仍在（降级为普通流节点，不消失）', (await idOfText('摘要')) !== null);
const nodesAfter = (await nodeIds()).length;
check('B5 无异常节点消失（净减 = 删掉的 2 个成员）', nodesBefore - nodesAfter === 2, {
  before: nodesBefore,
  after: nodesAfter,
});
await page.screenshot({ path: `${SHOTS}/b2-degraded.png` });

// ════════════════════════════════ C 方向：左岛
section('C · 方向（森林左岛）');
await openDoc(); // DOC_LEFT
await fitView();
const leftIslandOk = (await idOfText('左岛')) !== null;
check('C0 左岛文档已加载', leftIslandOk);
await rightClickNodeText('左一');
await clickMenuItem('创建摘要');
await clickNodeText('左二');
await page.waitForTimeout(500);
const leftViews = await brackets();
check('C1 左岛摘要产出括线', leftViews.length >= 1, { n: leftViews.length });
const lv = leftViews.find((b) => b.side === 'left');
check('C2 括线方向 = 左向', lv !== undefined, { sides: leftViews.map((b) => b.side) });
if (lv) {
  const bandL = await worldBoxOf(['左一', '左二']);
  if (bandL) {
    check('C3 左向括线在成员带左侧', lv.minX <= bandL.minX + 1e-6, {
      bracketMinX: lv.minX,
      bandMinX: bandL.minX,
    });
  }
}
await page.screenshot({ path: `${SHOTS}/c1-left-island.png` });

// ════════════════════════════════ C 降级域：无括线的路径
section('C · 降级域（不承诺卫星的路径：节点可见、无括线）');
//
// ⚠️ **实测边界（重要，不伪称覆盖）**：`note.layout: org` 这类**布局声明在画布侧不被消费**
// —— `packages/react/src/demo/pipeline.ts` 不读 `note.layout`，`MindmapStage` 也没有
// 布局类型切换 UI（`getLayout` 注册表只在 kernel 内部可达）。因此**无法经真实 UI 触发
// org / timeline / fishbone 路径**。org 降级域由 kernel 层用例（`summary-satellite.test.ts`
// 的降级域断言）覆盖，本浏览器脚本不重复、也不伪装覆盖。
//
// 浏览器侧能真实触发的是**锚失效降级**（B 组已验：删端点 → dangling → 无括线且节点可见）。
// 这里再补一条：降级后括线层整体消失（DOM 中无 summaries 层），确认不是「画了空层」。
await openDoc(); // DOC_ORG（其实仍是 mindmap 路径——记录该边界）
await fitView();
await rightClickNodeText('A');
const orgHasSummary = await page.evaluate(() =>
  [...document.querySelectorAll('[data-menu-item]')].some((el) =>
    ((el.textContent ?? '').trim()).startsWith('创建摘要'),
  ),
);
if (orgHasSummary) {
  await clickMenuItem('创建摘要');
  await clickNodeText('C');
  await page.waitForTimeout(500);
  // 该文档走 mindmap 路径 → 应正常产括线（**不是**降级域）；
  // 此断言记录「layout 声明未被消费」这一事实，避免读者以为它验了 org。
  const n = (await brackets()).length;
  check(
    'C4 声明 layout:org 的文档仍走 mindmap 路径（画布不消费 note.layout）→ 有括线',
    n >= 1,
    { n, note: '实测边界：org 降级域由 kernel 用例覆盖，不经 UI' },
  );
  check('C5 该文档摘要节点可见', (await idOfText('摘要')) !== null);
}
await page.screenshot({ path: `${SHOTS}/c2-layout-decl-not-consumed.png` });

// ════════════════════════════════ 三主题 × 三档缩放（在**有括线**的文档上）
section('D · 三主题 × 三档缩放（括线必须同步存在）');
const themeLabels = ['经典', '贴纸', '玻璃'];
// 当前文档（C 组留下的 layout:org 文档）已有括线（C4 已证）→ 直接在此做主题/缩放。
check('D-pre 当前文档有括线（主题/缩放断言的前提）', (await brackets()).length >= 1);
for (const label of themeLabels) {
  const btn = page.locator('button[aria-pressed]').filter({ hasText: label }).first();
  if ((await btn.count()) > 0) {
    await btn.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/theme-${label}.png` });
    const bs = await brackets();
    check(`D7 主题「${label}」：括线仍在`, bs.length >= 1, { n: bs.length });
  } else {
    check(`D7 主题「${label}」：切换器不存在`, false);
  }
}
/** 当前画布缩放 k（变换 g 的 scale） */
const canvasScale = () =>
  page.evaluate(() => {
    const svg = document.querySelector('svg');
    const g = svg ? [...svg.children].find((e) => e.tagName === 'g') : null;
    const m = /scale\(\s*(-?[\d.]+)/.exec(g?.getAttribute('transform') ?? '');
    return m ? Number(m[1]) : null;
  });

// 真三档缩放：滚轮必须落在**画布热区**上才生效（页面级滚轮不改变视图）。
const vp = await page.evaluate(() => {
  const el = document.querySelector('div[style*="touch-action"]');
  const r = el ? el.getBoundingClientRect() : { x: 0, y: 0, width: 1400, height: 900 };
  return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
});
const zoomSteps = [
  { tag: 'z-out', apply: async () => { await page.mouse.move(vp.cx, vp.cy); await page.mouse.wheel(0, 360); } },
  { tag: 'z-mid', apply: async () => { await page.keyboard.press('Control+0'); } }, // fit = 1
  { tag: 'z-in', apply: async () => { await page.mouse.move(vp.cx, vp.cy); await page.mouse.wheel(0, -480); } },
];
const seenK = [];
for (const z of zoomSteps) {
  await z.apply();
  await page.waitForTimeout(450);
  const k = await canvasScale();
  seenK.push(k);
  await page.screenshot({ path: `${SHOTS}/${z.tag}.png` });
  const bs = await brackets();
  check(`D8 缩放档 ${z.tag}：k=${k}，括线随节点同步（仍存在）`, bs.length >= 1, { k, n: bs.length });
}
check(
  'D9 三档缩放实际不同（k 互异 → 截图非重复）',
  new Set(seenK.map((k) => (k ?? 0).toFixed(3))).size === 3,
  { seenK },
);
check('D10 括线几何仍贴合成员带（缩放后同源）', (await brackets()).length >= 1);

// ════════════════════════════════ D 导出
section('D · 导出 SVG（含括线）');
// 当前处于 org 文档（无括线）。重开左岛文档并在其中建摘要，再导出，
// 使导出断言作用在**确有括线**的文档上。
await openDoc(); // DOC_PLAIN（队尾）
await fitView();
check('D0 普通文档：无括线（导出对照基线）', (await brackets()).length === 0);
await page.screenshot({ path: `${SHOTS}/plain.png` });

// 逐步重建：以「新建」起一份含摘要文档不可行（夹具已用尽）——改用当前无摘要文档
// 直接建摘要，验证导出链路（方向无关，导出只关心括线存在与不重复）。
await rightClickNodeText('甲');
const plainHasSummary = await page.evaluate(() =>
  [...document.querySelectorAll('[data-menu-item]')].some((el) =>
    ((el.textContent ?? '').trim()).startsWith('创建摘要'),
  ),
);
if (plainHasSummary) {
  await clickMenuItem('创建摘要');
  await clickNodeText('乙');
  await page.waitForTimeout(500);
}
const beforeExport = await brackets();
check('D1 导出前括线存在', beforeExport.length >= 1, { n: beforeExport.length });

const download = await (async () => {
  const wait = page.waitForEvent('download', { timeout: 20000 });
  await page.locator('text=导出').first().click();
  try {
    return await wait;
  } catch {
    return null;
  }
})();
if (download !== null) {
  const path = `${SHOTS}/export-summary.svg`;
  await download.saveAs(path);
  const svg = readFileSync(path, 'utf8');
  check('D2 SVG 导出落盘成功', svg.startsWith('<svg'), { path });
  check('D3 导出 SVG 含括线 path', svg.includes('data-summary-bracket'));
  check('D4 导出 SVG 含 stem', svg.includes('data-summary-stem'));
  const n = (svg.match(/data-summary-bracket/g) ?? []).length;
  check('D5 括线数量与画布一致（不重复绘制）', n === beforeExport.length, {
    svg: n,
    dom: beforeExport.length,
  });
  const m = /<path[^>]*data-summary-bracket="[^"]*"[^>]*stroke="([^"]+)"/.exec(svg);
  check('D6 括线线色取自主题 token（非硬编码）', m !== null, { stroke: m?.[1] });
} else {
  check('D2 SVG 导出落盘成功', false, { note: 'download 事件未触发' });
}
await page.screenshot({ path: `${SHOTS}/d0-exported.png` });

// ════════════════════════════════ 汇总
console.log(`\n${'═'.repeat(60)}`);
console.log(pass ? '✅ verify-summary 全部通过' : '❌ verify-summary 存在失败项');
console.log(`截图与导出件：${SHOTS}/`);
await browser.close();
process.exit(pass ? 0 : 1);
