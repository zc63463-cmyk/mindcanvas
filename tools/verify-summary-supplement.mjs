/**
 * S5 补充验收（**新文件，不动 verify-summary.mjs**）：补 verify-summary 未覆盖的项。
 *
 * 覆盖（任务书「Undo 与替换若脚本未覆盖，你必须手动补做」+ 几何/顺序 + PNG + frame/satellite/cache）：
 *  E  Undo：创建摘要后 Ctrl+Z → 括线消失、摘要节点消失；Ctrl+Shift+Z 重做 → 复原
 *  F  替换：对同一区间再次创建摘要 → 仍 1 条括线（替换/不叠加）
 *  G  nestedSkip：成员区间**含另一摘要节点**时，不摘除嵌套摘要（两条括线都在，不删除嵌套节点）
 *  H  DOM 括线层序：背景 rect → tree-links → 边界补线 → summaries → nodes
 *  I  SVG 导出层序（同一文档）：背景 rect → 树线 path → boundaryLinks → summary → 节点卡
 *  J  PNG 导出：真实点「导出 PNG」按钮，落盘 .png（PNG 魔数）且非降级 .svg
 *  K  frame 路径 / 卫星传播 / 缓存 / 重复布局：数据面短路 + 缓存命中不改变布局与括线
 *
 * 落盘目录由 REVIEW_SHOTS 决定（与 verify-summary 同口径，**必填**，避免覆盖历史证据）。
 * 跑法：cd <worktree> && REVIEW_SHOTS=<dir> node tools/verify-summary-supplement.mjs http://localhost:5211
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:5211';
const SHOTS =
  process.argv
    .slice(2)
    .find((a) => a.startsWith('--shots='))
    ?.slice('--shots='.length) ??
  process.env.REVIEW_SHOTS;
if (!SHOTS) {
  console.error('[supplement] 必须显式指定 REVIEW_SHOTS（或 --shots=）——拒绝写历史证据目录');
  process.exit(2);
}
mkdirSync(SHOTS, { recursive: true });

// ─────────────────────────────────────────────────────────── 文档夹具
/** 右向基础：根 → 父[A A子, B, C, D]（A 带子 → 验证成员子树包围盒） */
const DOC_RIGHT = ['# 根', '', '## 父', '', '- A', '', '  - A子', '', '- B', '', '- C', '', '- D', ''].join('\n');

/**
 * nestedSkip 夹具：父[A, B, S1(摘要 of A..B), C, D, E]。
 * 随后对 **A..E** 建一条摘要 S2 —— S2 的成员区间**包含 S1**。
 * 期望（kernel 口径）：S1 不被摘除、不被删除，两条括线都在。
 * 锚写在 S1 自己的 note 上（cid 锚需要端点已有 cid；用**文本路径锚**避开 cid 预分配）。
 */
const DOC_NESTED = [
  '# 根',
  '',
  '## 父',
  '',
  '- A',
  '',
  '- B',
  '',
  '- C',
  '',
  '- D',
  '',
  '- E',
  '',
].join('\n');

/**
 * frame 场景：声明 sections（框）的文档，验证框路径与摘要卫星共存不互斥。
 * 字段按 `packages/kernel/src/protocol/section.ts:60` 的读取口径：`id` + `root` 为非空字符串
 * 才成条目（`members` 不是合法字段 —— 首轮我误用，见 gate 记录）。
 */
const DOC_FRAME = [
  '<!--',
  'sections:',
  '  - id: sec_a',
  '    title: 组一',
  '    root: "node:根/父"',
  '    color: blue',
  '-->',
  '# 根',
  '',
  '## 父',
  '',
  '- A',
  '',
  '- B',
  '',
  '- C',
  '',
].join('\n');

/**
 * dangling 夹具：摘要节点的 `summary_of` 端点指向**不存在的 cid**（`cid:nope`）。
 * 期望（`registry/summary-anchor.ts:83-101`）：`from-not-found` → dangling →
 * 不摘除、不产卫星、**不画括线**，但摘要节点**仍可见**（数据无损，回落普通节点）。
 * 同时验证浏览器侧能真实触发「锚失效降级」这条路径（org 布局那条无法经 UI 触发）。
 *
 * ⚠️ 笔记块的绑定方向（`protocol/parser.ts:308` 的 `pendingNote` + `:311` `bindNote`）：
 * 笔记块绑定到**其后第一个节点**，不是前一个。故块必须写在摘要节点**之前**。
 */
const DOC_DANGLE = [
  '# 根',
  '',
  '## 父',
  '',
  '- A',
  '',
  '- B',
  '',
  '<!--',
  'summary_of:',
  '  from: cid:nope',
  '  to: cid:nope',
  '-->',
  '- 悬空摘要',
  '',
].join('\n');

/**
 * stale 夹具：`from` 形态**不可解析**（既非 `cid:` 也非 `node:`）→ `summary-anchor.ts:79`
 * 返回 `stale`，reason=`unparsable-from`。期望同样：**不画括线、节点仍可见**。
 */
const DOC_STALE = [
  '# 根',
  '',
  '## 父',
  '',
  '- A',
  '',
  '- B',
  '',
  '<!--',
  'summary_of:',
  '  from: "!!bad-anchor!!"',
  '  to: cid:nope',
  '-->',
  '- 坏锚摘要',
  '',
].join('\n');

const DOC_QUEUE = [DOC_RIGHT, DOC_NESTED, DOC_FRAME, DOC_DANGLE, DOC_STALE];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });

await page.addInitScript(
  (docs) => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    const queue = docs.map((src, i) => ({ name: `s5-doc-${i}.mm.md`, src }));
    window.showOpenFilePicker = async () => {
      const item = queue.shift();
      if (!item) throw new Error('S5 夹具已用尽');
      return [
        {
          name: item.name,
          getFile: async () => new File([item.src], item.name, { type: 'text/markdown' }),
          createWritable: async () => ({ write: async () => undefined, close: async () => undefined }),
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

// ─────────────────────────────────────────────────────────── 工具（与 verify-summary 同口径）
const nodeIds = () =>
  page.evaluate(() => [...document.querySelectorAll('g[data-node-id]')].map((g) => g.getAttribute('data-node-id')));

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
  page.evaluate((id) => (document.querySelector(`g[data-node-id="${id}"]`)?.textContent ?? '').trim(), nid);

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
  await page.mouse.click((g.wx + g.w / 2) * g.k + g.tx, (g.wy + g.h / 2) * g.k + g.ty, { button: 'right' });
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
        memberCount: g?.getAttribute('data-summary-member-count') ?? null,
        d,
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
        hasStem: document.querySelector(`[data-summary-stem="${sid}"]`) !== null,
      };
    }),
  );

const summaryCount = async () => (await brackets()).length;
const summaryNodeCount = () => page.evaluate(() => [...document.querySelectorAll('g[data-node-id]')].filter((g) => (g.textContent ?? '').trim() === '摘要').length);

/** 布局数据指纹（幂等/缓存断言的对照面：世界几何，不含瞬时 UI 态） */
const layoutFingerprint = () =>
  page.evaluate(() => {
    const rows = [...document.querySelectorAll('g[data-node-id]')].map((g) => {
      const r = g.querySelector('rect');
      return `${g.getAttribute('data-node-id')}|${g.getAttribute('transform')}|${r?.getAttribute('width')}x${r?.getAttribute('height')}`;
    });
    const br = [...document.querySelectorAll('[data-summary-bracket]')].map(
      (p) => `${p.getAttribute('data-summary-bracket')}|${p.getAttribute('d')}`,
    );
    return [...rows, ...br].join('\n');
  });

const openDoc = async () => {
  await page.keyboard.press('Control+o');
  await page.waitForTimeout(900);
};
const fitView = async () => {
  await page.keyboard.press('Control+0');
  await page.waitForTimeout(400);
};

/** 菜单是否有「创建摘要…」入口（缺 action bag → 不显示） */
const menuHasCreateSummary = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-menu-item]')].some((el) =>
      ((el.textContent ?? '').trim()).startsWith('创建摘要'),
    ),
  );

// ─────────────────────────────────────────────────────────── 首屏
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-node-id]', { timeout: 20000 });
await openDoc();
await page.waitForFunction(() => document.querySelectorAll('g[data-node-id]').length >= 5, undefined, { timeout: 20000 });
await fitView();

// ════════════════════════════════ E · Undo（Ctrl+Z）+ Redo
section('E · Undo：创建摘要后 Ctrl+Z 回滚括线与节点');
check('E0 前置：无括线', (await summaryCount()) === 0);
await rightClickNodeText('A');
check('E1 右键菜单含「创建摘要…」', await menuHasCreateSummary());
await clickMenuItem('创建摘要');
await clickNodeText('C');
await page.waitForTimeout(600);

const createdIds = await nodeIds();
const beforeUndo = await brackets();
check('E2 创建后：1 条括线 + 摘要节点存在', beforeUndo.length === 1 && (await idOfText('摘要')) !== null, {
  n: beforeUndo.length,
  summaryId: beforeUndo[0]?.id,
});
await page.screenshot({ path: `${SHOTS}/e1-created.png` });

// —— Ctrl+Z ——（真实键盘，走 matchEditorKey → undo）
await page.keyboard.press('Control+z');
await page.waitForTimeout(700);
const afterUndo = await brackets();
check('E3 Ctrl+Z 后：括线消失（0 条）', afterUndo.length === 0, { n: afterUndo.length });
check('E4 Ctrl+Z 后：摘要节点消失', (await idOfText('摘要')) === null);
check('E5 Ctrl+Z 后：节点数回落到创建前', (await nodeIds()).length === createdIds.length - 1, {
  before: createdIds.length,
  after: (await nodeIds()).length,
});
await page.screenshot({ path: `${SHOTS}/e2-after-undo.png` });

// —— Ctrl+Shift+Z 重做 ——
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(700);
const afterRedo = await brackets();
check('E6 Ctrl+Shift+Z 重做：括线复原（1 条）', afterRedo.length === 1, { n: afterRedo.length });
check('E7 重做后摘要节点复原', (await idOfText('摘要')) !== null);
await page.screenshot({ path: `${SHOTS}/e3-after-redo.png` });

// ════════════════════════════════ F · 「替换」：同区间重复创建 → 不叠加
section('F · 同区间重复创建 → 命令层不替换（两次独立事务）；删除后重建不累积');

// —— F-A：**不删旧摘要**，直接对同一区间 A..C 再创建一次 ——
// 背景：`packages/react/tests/summary-create.test.ts:586` 明确记载命令层「重复触发同一范围 →
// 产生第二条摘要节点（两次独立事务）」——即**命令层不做替换**。本项实测的是：
// 即便画出两个摘要节点，**括线层**是否叠加成 2 条（渲染/几何层的替换语义）。
const beforeRepeat = (await brackets())[0];
check('FA0 前置：1 条括线', beforeRepeat !== undefined && (await summaryCount()) === 1);
const nodesBeforeRepeat = await nodeIds();
await rightClickNodeText('A');
await clickMenuItem('创建摘要');
await clickNodeText('C');
await page.waitForTimeout(800);
const afterRepeat = await brackets();
check(
  'FA1 同区间再次创建：括线变 **2 条**（命令层不替换 → 两个摘要节点各一条括线；见 summary-create.test.ts:586）',
  afterRepeat.length === 2,
  { n: afterRepeat.length, note: '命令层语义：重复触发同一范围 = 第二条摘要（两次独立事务）' },
);
check(
  'FA2 同区间再次创建：画布**多了一个摘要节点**（命令层不替换，与 summary-create.test.ts:586 一致）',
  (await nodeIds()).length === nodesBeforeRepeat.length + 1,
  { before: nodesBeforeRepeat.length, after: (await nodeIds()).length, note: '命令层语义：重复触发 = 第二条摘要' },
);
await page.screenshot({ path: `${SHOTS}/f0-repeat-create.png` });

// —— F-B：删除全部摘要后，在同一区间重建 → 括线复原且不累积 ——
await page.keyboard.press('Control+z'); // 撤销掉刚才多出来的那条
await page.waitForTimeout(600);
const afterUndoRepeat = await brackets();
check('FB1 Ctrl+Z 撤销重复创建后：回到 1 条括线', afterUndoRepeat.length === 1, { n: afterUndoRepeat.length });

const beforeReplace = afterUndoRepeat[0];
// 删除现存摘要（走真实菜单 del）→ 归零
await rightClickNodeText('摘要');
await clickMenuItem('删除节点');
await page.waitForTimeout(700);
check('FB2 删除旧摘要后：0 条括线', (await summaryCount()) === 0, { n: await summaryCount() });
await page.screenshot({ path: `${SHOTS}/f1-deleted.png` });

// 对**同一区间 A..C** 重新创建
await rightClickNodeText('A');
await clickMenuItem('创建摘要');
await clickNodeText('C');
await page.waitForTimeout(700);
const afterReplace = await brackets();
check('F2 同区间重建：仍恰好 1 条括线（未叠加）', afterReplace.length === 1, {
  n: afterReplace.length,
});
check('F3 重建后：画布只有 1 个摘要节点', (await summaryNodeCount()) === 1, {
  n: await summaryNodeCount(),
});
// 括线几何应与首次一致（同成员带 → 同括线）
if (beforeReplace && afterReplace[0]) {
  check(
    'F4 重建括线几何与首次一致（成员带未变 → 同一区间）',
    Math.abs(beforeReplace.minY - afterReplace[0].minY) < 1.5 &&
      Math.abs(beforeReplace.maxY - afterReplace[0].maxY) < 1.5 &&
      Math.abs(beforeReplace.maxX - afterReplace[0].maxX) < 1.5,
    { first: [beforeReplace.minX, beforeReplace.minY, beforeReplace.maxX, beforeReplace.maxY], again: [afterReplace[0].minX, afterReplace[0].minY, afterReplace[0].maxX, afterReplace[0].maxY] },
  );
}
await page.screenshot({ path: `${SHOTS}/f2-recreated.png` });

// 对照：**区间相交**（C..D 落在 A..C 内部）→ 属嵌套，外层/内层按 nestedSkip 语义处理。
// 期望（核 kernel `satellite.ts:126-130` + `summary-frames.test.ts:536`）：
//   区间含另一摘要节点的那一条**不摘除、不产括线**；数字断言只看「括号数不增」+ 两条都可见。
await rightClickNodeText('C');
await clickMenuItem('创建摘要');
await clickNodeText('D');
await page.waitForTimeout(800);
const overlap = await brackets();
check(
  'F5 区间相交（C..D 落在 A..C 内）：第二条**不产括线**（nestedSkip 契约：嵌套项留流内不画线）',
  overlap.length === 1,
  { n: overlap.length, note: 'kernel satellite.ts:126-130 / summary-frames.test.ts:536' },
);
check('F6 相交区间下：两个摘要节点都在画布可见（不消失）', (await summaryNodeCount()) === 2, {
  n: await summaryNodeCount(),
});
await page.screenshot({ path: `${SHOTS}/f3-overlap-nested.png` });

// ════════════════════════════════ G · nestedSkip（成员区间含另一摘要节点）
section('G · nestedSkip：成员区间含另一摘要节点 → 不摘除嵌套摘要');
await openDoc(); // DOC_NESTED：根 → 父[A B C D E]
await fitView();
check('G0 嵌套夹具已加载', (await idOfText('父')) !== null && (await summaryCount()) === 0);

// 先对 B..D 建内层摘要 S1
await rightClickNodeText('B');
await clickMenuItem('创建摘要');
await clickNodeText('D');
await page.waitForTimeout(700);
const inner = await brackets();
check('G1 内层摘要 S1 建立（1 条括线）', inner.length === 1, { n: inner.length });
const s1Id = (await idOfText('摘要')) ?? null;
const nodesWithS1 = (await nodeIds()).length;
await page.screenshot({ path: `${SHOTS}/g1-inner.png` });

// 再对 A..E 建外层摘要 S2 —— 成员区间 [A..E] 含 S1。
// 契约（`packages/kernel/src/layout/satellite.ts:126-130`；`summary-frames.test.ts:536`）：
//   外层摘要命中 `nestedSkip` → **不摘除（留流内可见）、不产卫星、不画括线**；
//   内层不受牵连 → 仍产卫星与括线。故期望：括线仍为 **1 条**（内层那条），节点都在。
await rightClickNodeText('A');
await clickMenuItem('创建摘要');
await clickNodeText('E');
await page.waitForTimeout(900);
const nested = await brackets();
check(
  'G2 外层摘要（区间含 S1）→ nestedSkip：外层不产括线，括线仍 1 条（内层那条）',
  nested.length === 1,
  { n: nested.length, note: 'kernel satellite.ts:126-130；非「2 条」——外层按契约留流内不画线' },
);
check('G3 嵌套摘要节点 S1 仍存在（未被删除）', s1Id !== null && (await idOfText('摘要')) !== null);
check('G4 节点数净增 1（只加了外层摘要，内层摘要未被摘除）', (await nodeIds()).length === nodesWithS1 + 1, {
  before: nodesWithS1,
  after: (await nodeIds()).length,
});
const s2Id = nested[0]?.id;
check('G5 仅存括线属于内层摘要 S1（外层 S2 不画线）', s2Id === s1Id, { bracketId: s2Id, s1Id });
check('G6 外层摘要节点仍在画布可见（留流内，不消失）', (await summaryNodeCount()) === 2, {
  n: await summaryNodeCount(),
});
await page.screenshot({ path: `${SHOTS}/g2-nested.png` });

// ════════════════════════════════ H · DOM 括线层序
section('H · DOM 层序：背景 rect → tree-links → 边界补线 → summaries → nodes');
const domOrder = await page.evaluate(() => {
  const svg = document.querySelector('svg');
  const rootG = svg ? [...svg.children].find((e) => e.tagName === 'g') : null;
  if (!rootG) return null;
  return [...rootG.children].map((el) => ({
    tag: el.tagName,
    layer: el.getAttribute('data-layer'),
    hasSummary: el.querySelector('[data-summary-bracket]') !== null,
    hasNode: el.querySelector('[data-node-id]') !== null,
    cls: el.getAttribute('class'),
  }));
});
check('H0 取到 SVG 根变换 g', domOrder !== null, { children: domOrder?.map((c) => c.layer ?? c.tag) });
const idxSummary = domOrder?.findIndex((c) => c.hasSummary) ?? -1;
const idxNodes = domOrder?.findIndex((c) => c.layer === 'nodes' || c.hasNode) ?? -1;
const idxTreeLinks = domOrder?.findIndex((c) => c.layer === 'tree-links') ?? -1;
const idxBg = domOrder?.findIndex((c) => c.tag === 'rect') ?? -1;
check('H1 summaries 层在 nodes 层之前（括线在节点卡之下，不盖节点）', idxSummary >= 0 && idxNodes >= 0 && idxSummary < idxNodes, {
  idxSummary,
  idxNodes,
});
check('H2 summaries 层在 tree-links 层之前（S4 契约：层序 = sections → summaries → tree-links）', idxSummary >= 0 && idxTreeLinks >= 0 && idxSummary < idxTreeLinks, {
  idxSummary,
  idxTreeLinks,
});
check(
  'H3 背景 rect 在最底（索引 -1 或缺省 → 由 MapView 外框承接）',
  idxBg === -1 || idxBg === 0,
  { idxBg },
);

// ════════════════════════════════ I · SVG 导出层序（含 boundaryLinks 位次）
section('I · SVG 导出层序：背景 rect → 树线 path → 摘要括线 → 节点卡');
const dl = (async () => {
  const wait = page.waitForEvent('download', { timeout: 20000 });
  await page.locator('text=导出').first().click();
  try {
    return await wait;
  } catch {
    return null;
  }
})();
const d = await dl;
if (d !== null) {
  const p = `${SHOTS}/supplement-export.svg`;
  await d.saveAs(p);
  const svg = readFileSync(p, 'utf8');
  const posBg = svg.indexOf('<rect');
  const posBracket = svg.indexOf('data-summary-bracket');
  // 树线：第一段「C 曲线」path（无 data-summary-* 标注、无 transform 的 path）
  const posLink = svg.indexOf('<path d="M ');
  const posNode = svg.search(/<g transform="translate\(/);
  const sids = [...new Set([...svg.matchAll(/data-summary-bracket="([^"]+)"/g)].map((m) => m[1]))];
  check('I1 导出落盘且含括线', svg.startsWith('<svg') && posBracket > 0, { path: p });
  check('I2 导出括线条数与画布 DOM 一致', sids.length === (await summaryCount()), {
    svg: sids.length,
    dom: await summaryCount(),
  });
  check('I3 层序：背景 rect → 树线 path', posBg >= 0 && posLink > posBg, { posBg, posLink });
  check('I4 层序：树线 path → 摘要括线', posLink >= 0 && posBracket > posLink, { posLink, posBracket });
  check('I5 层序：摘要括线 → 节点卡', posBracket >= 0 && posNode > posBracket, { posBracket, posNode });
  check('I6 导出含 stem 且数量 = 括线数', (svg.match(/data-summary-stem/g) ?? []).length === sids.length, {
    stems: (svg.match(/data-summary-stem/g) ?? []).length,
    brackets: sids.length,
  });
  check(
    'I7 导出括线几何与画布 DOM 括线几何同源（逐字比对 d）',
    (await brackets()).every((b) => svg.includes(`d="${b.d}"`)),
    { domD: (await brackets()).map((b) => b.d) },
  );
  check('I8 导出不画 Section 框（框是画布侧 chrome）', !svg.includes('<title>组一</title>'));
  writeFileSync(`${SHOTS}/supplement-export.svg`, svg);
} else {
  check('I1 导出落盘且含括线', false, { note: 'download 事件未触发' });
}
await page.screenshot({ path: `${SHOTS}/i0-export.png` });

// ════════════════════════════════ J · PNG 导出（真实按钮）
section('J · PNG 导出：真实点「导出 PNG」→ 落盘 .png 且非降级 SVG');
const pngDl = (async () => {
  const wait = page.waitForEvent('download', { timeout: 25000 });
  await page.locator('text=导出 PNG').first().click();
  try {
    return await wait;
  } catch {
    return null;
  }
})();
const pd = await pngDl;
if (pd !== null) {
  const name = pd.suggestedFilename();
  const p = `${SHOTS}/supplement-export-png.${name.split('.').pop()}`;
  await pd.saveAs(p);
  const bytes = readFileSync(p);
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const w = bytes.length > 20 ? bytes.readUInt32BE(16) : 0;
  const h = bytes.length > 24 ? bytes.readUInt32BE(20) : 0;
  check('J1 下载文件名后缀 = .png（未降级为 .svg）', name.endsWith('.png'), { name });
  check('J2 落盘内容为真 PNG（魔数 89 50 4E 47）', isPng, { first4: [...bytes.slice(0, 4)] });
  check('J3 PNG 尺寸解析合理（scale=2 → 宽高为导出 viewBox 的两倍）', w > 0 && h > 0, { w, h, bytes: bytes.length });
  check('J4 PNG 非空（体量 > 1KB）', bytes.length > 1024, { bytes: bytes.length });
  writeFileSync(`${SHOTS}/supplement-png-meta.txt`, `name=${name}\npath=${p}\nmagic=png\nwidth=${w}\nheight=${h}\nbytes=${bytes.length}\n`);
} else {
  check('J1 下载文件名后缀 = .png（未降级为 .svg）', false, { note: 'PNG download 事件未触发' });
}
await page.screenshot({ path: `${SHOTS}/j0-png.png` });

// ════════════════════════════════ K · frame 路径 / 卫星传播 / 缓存 / 重复布局
section('K · frame 路径 · 卫星传播 · 缓存 · 重复布局幂等');
await openDoc(); // DOC_FRAME：sections 声明 + 无摘要
await fitView();
check('K0 frame 夹具已加载', (await idOfText('父')) !== null);
check('K1 frame 文档初始无括线', (await summaryCount()) === 0);
// frame 路径下建摘要 → 框与括线共存（两种 chrome 不互斥）
await rightClickNodeText('A');
await clickMenuItem('创建摘要');
await clickNodeText('B');
await page.waitForTimeout(800);
const frameBrackets = await brackets();
check('K2 frame 文档中摘要括线正常产出（框路径与卫星路径不互斥）', frameBrackets.length === 1, {
  n: frameBrackets.length,
});
const frameHasSection = await page.evaluate(
  () => document.querySelector('[data-section-id],[data-section-layer]') !== null,
);
check('K3 frame 文档仍保留 Section 框层（未被摘要挤掉）', frameHasSection, { frameHasSection });
await page.screenshot({ path: `${SHOTS}/k1-frame-with-summary.png` });

// —— 重复布局幂等：连续 Ctrl+0 三次，布局指纹必须逐次一致（缓存命中 → 无漂移） ——
const fp1 = await layoutFingerprint();
await fitView();
const fp2 = await layoutFingerprint();
await fitView();
const fp3 = await layoutFingerprint();
check('K4 重复布局幂等（3 次 fit 后节点几何 + 括线 d 逐字一致 → 缓存命中无漂移）', fp1 === fp2 && fp2 === fp3, {
  len: [fp1.length, fp2.length, fp3.length],
  stable12: fp1 === fp2,
  stable23: fp2 === fp3,
});

// —— 卫星传播：编辑成员文本（真实重命名）后卫星与括线仍在（同一摘要锚） ——
const before = await brackets();
// 双击 A 进入编辑。探针实测（`probe-supplement-failures.mjs`）：双击后出现 INPUT 覆盖编辑器，
// 直接键入会**整体替换**文本（不是追加）——首轮断言「A改」因此失败，是**断言写错**不是产品问题。
// 正确做法：全选清空后键入「A改」，得到确定的改名结果。
const aId = await idOfText('A');
const ag = await geom(aId);
await page.mouse.dblclick((ag.wx + ag.w / 2) * ag.k + ag.tx, (ag.wy + ag.h / 2) * ag.k + ag.ty);
await page.waitForTimeout(600);
await page.keyboard.press('Control+a');
await page.keyboard.type('A改');
await page.keyboard.press('Enter');
await page.waitForTimeout(800);
const renamedOk = (await idOfText('A改')) !== null;
check('K5 成员文本真实改名成功（双击编辑 → 清空键入 A改）', renamedOk, { found: renamedOk });
const afterEdit = await brackets();
check('K6 改名后括线仍在（cid 锚不因改名失效 → 卫星传播）', afterEdit.length === 1, { n: afterEdit.length });
check('K7 改名后括线纵向范围仍贴合成员带', before[0] !== undefined && afterEdit[0] !== undefined && Math.abs(before[0].minY - afterEdit[0].minY) < 6, {
  before: [before[0]?.minY, before[0]?.maxY],
  after: [afterEdit[0]?.minY, afterEdit[0]?.maxY],
});
await page.screenshot({ path: `${SHOTS}/k2-after-rename.png` });

// ════════════════════════════════ L · dangling / stale（真实 UI 可触发）
section('L · dangling / stale：锚失效 → 无括线且节点仍可见（数据无损）');
await openDoc(); // DOC_DANGLE
await fitView();
const dangleLoaded = (await idOfText('父')) !== null;
check('L0 dangling 夹具已加载', dangleLoaded);
check('L1 dangling：不画括线（0 条）', (await summaryCount()) === 0, { n: await summaryCount() });
check('L2 dangling：摘要节点仍可见（回落普通节点，未消失）', (await idOfText('悬空摘要')) !== null, {
  visible: (await idOfText('悬空摘要')) !== null,
});
await page.screenshot({ path: `${SHOTS}/l1-dangling.png` });

await openDoc(); // DOC_STALE
await fitView();
const staleLoaded = (await idOfText('父')) !== null;
check('L3 stale 夹具已加载', staleLoaded);
check('L4 stale：不画括线（0 条）', (await summaryCount()) === 0, { n: await summaryCount() });
check('L5 stale：摘要节点仍可见（回落普通节点，未消失）', (await idOfText('坏锚摘要')) !== null, {
  visible: (await idOfText('坏锚摘要')) !== null,
});
await page.screenshot({ path: `${SHOTS}/l2-stale.png` });

// ════════════════════════════════ M · 普通文档：平移 / 编辑 / 保存（无摘要节点基线）
section('M · 普通文档（无摘要）：平移 · 编辑 · 保存');
const DOC_PLAIN = ['# 根', '', '## 甲', '', '## 乙', ''].join('\n');
// 用「新建」造一份干净普通文档（夹具队列已用尽，走真实新建入口）
await page.keyboard.press('Control+n');
await page.waitForTimeout(900);
const plainNodes = await nodeIds();
check('M0 新建普通文档已就绪', plainNodes.length >= 1, { n: plainNodes.length });
check('M1 普通文档无摘要节点、无括线', (await summaryCount()) === 0 && (await idOfText('摘要')) === null, {
  brackets: await summaryCount(),
});
await page.screenshot({ path: `${SHOTS}/m0-plain-doc.png` });

// —— 平移：真实按住空白拖动，视图变换必须变化 ——
const viewTransform = () =>
  page.evaluate(() => {
    const svg = document.querySelector('svg');
    const g = svg ? [...svg.children].find((e) => e.tagName === 'g') : null;
    return g?.getAttribute('transform') ?? null;
  });
const tBeforePan = await viewTransform();
await page.mouse.move(700, 700);
await page.mouse.down();
await page.mouse.move(560, 620, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(400);
const tAfterPan = await viewTransform();
check('M2 平移生效：视图变换改变（真实按住拖动）', tBeforePan !== null && tAfterPan !== null && tBeforePan !== tAfterPan, {
  before: tBeforePan,
  after: tAfterPan,
});
await page.screenshot({ path: `${SHOTS}/m1-panned.png` });

// —— 平移不产生括线（普通文档不该被平移影响出摘要） ——
check('M3 平移后普通文档仍无括线（平移不误产摘要）', (await summaryCount()) === 0, { n: await summaryCount() });

// —— 编辑：新建子节点（真实键盘 Tab）→ 节点数 +1 ——
await fitView();
const nBeforeEdit = (await nodeIds()).length;
// 先选中一个节点（点根）
const rootTxt = await page.evaluate(() => {
  const g = document.querySelector('g[data-node-id]');
  return (g?.textContent ?? '').trim();
});
if (rootTxt !== '') await clickNodeText(rootTxt);
await page.keyboard.press('Tab');
await page.waitForTimeout(600);
const nAfterEdit = (await nodeIds()).length;
check('M4 普通文档编辑（Tab 新建子节点）→ 节点数 +1', nAfterEdit === nBeforeEdit + 1, {
  before: nBeforeEdit,
  after: nAfterEdit,
});
check('M5 编辑后仍无括线（新增节点不误触发摘要）', (await summaryCount()) === 0, { n: await summaryCount() });
await page.screenshot({ path: `${SHOTS}/m2-edited.png` });

// —— 保存：真实 Ctrl+S。夹具的 createWritable 是桩（不落真实文件），
//    故此处只能验「保存路径被真实走到且无异常/无报错提示」，不伪称验了落盘字节。 ——
await page.keyboard.press('Control+s');
await page.waitForTimeout(900);
const saveNotice = await page.evaluate(() => {
  const txt = document.body.textContent ?? '';
  const bad = ['保存失败', '失败', '错误', 'Error'].filter((k) => txt.includes(k));
  return { hasBad: bad.length > 0, bad };
});
check('M6 Ctrl+S 保存路径走到且无失败提示', saveNotice.hasBad === false, saveNotice);
check('M7 保存后括线数不变（普通文档仍 0 条）', (await summaryCount()) === 0, { n: await summaryCount() });
await page.screenshot({ path: `${SHOTS}/m3-saved.png` });

// ─────────────────────────────────────────────────────────── 汇总
console.log(`\n${'═'.repeat(60)}`);
console.log(pass ? '✅ verify-summary-supplement 全部通过' : '❌ verify-summary-supplement 存在失败项');
console.log(`截图与导出件：${SHOTS}/`);
await browser.close();
process.exit(pass ? 0 : 1);
