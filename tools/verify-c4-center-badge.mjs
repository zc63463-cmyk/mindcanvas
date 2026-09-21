/**
 * C4 真浏览器四态视觉验证：中心角标（左上 `data-center` 小圆点）
 * ══════════════════════════════════════════════════════════════════════
 * 跑法：node tools/verify-c4-center-badge.mjs [baseUrl]（默认 http://localhost:5176）
 *   （需先起静态快照：cd apps/canvas && vite preview --port 5176，或任意服务 dist 的方式）
 *
 * 场景 A（中心文档，SVG 后端）：
 *   ① plain    普通态：升格节点左上角标出现（data-center=1），title =「中心（doc#cid）」
 *   ② selected 选中态：点选中心后角标仍在
 *   ③ dragging 拖拽中：按住拖动（预览中）角标随节点盒平移；Esc 取消后复原
 * 场景 B（>5 万节点纯树，自动 Canvas 降级）：
 *   ④ canvas   降级态：canvas 出现、SVG 节点层整体让位（data-center=0）、
 *      降级提示条含「中心标记」（C4 文案追加项）
 *
 * 截图：verify-shots/c4-badge-{plain,selected,dragging,canvas}.png
 */
import { chromium } from 'playwright';
import { assertLoadedBundle, checkSnapshotFresh } from './lib/snapshotCheck.mjs';

/** 非 `--` 开头的首个参数 = baseUrl（`--allow-stale` 等 flag 不进 base） */
const BASE = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:5176';

/** 中心文档：根 note 写 centers（cid 稳定身份）+ 「工作」节点 note 写同源 cid */
const DOC_CENTER = [
  '<!--',
  'centers:',
  '  - at: "node:根/工作"',
  '    cid: c1',
  '    dir: right',
  '    x: 240',
  '    y: 0',
  '-->',
  '# 根',
  '',
  '<!--',
  'cid: c1',
  '-->',
  '## 工作',
  '',
  '### 项目A',
  '',
  '## 生活',
  '',
].join('\n');

/** 大文档：根 + 50010 个兄弟（layout.nodes = 50011 > CANVAS_AUTO_NODES=50000 → 自动降级） */
const BIG_N = 50010;
const DOC_BIG = ['# 根', '', ...Array.from({ length: BIG_N }, (_, i) => `- N${i}`), ''].join('\n');

checkSnapshotFresh();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });

await page.addInitScript(
  ({ a, b }) => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    const queue = [
      { name: 'c4-center.mm.md', src: a },
      { name: 'c4-big.mm.md', src: b },
    ];
    window.showOpenFilePicker = async () => {
      const item = queue.shift();
      if (!item) throw new Error('no doc left');
      return [
        {
          name: item.name,
          getFile: async () => new File([item.src], item.name, { type: 'text/markdown' }),
          createWritable: async () => ({ write: async () => undefined, close: async () => undefined }),
        },
      ];
    };
  },
  { a: DOC_CENTER, b: DOC_BIG },
);

const readBadge = () =>
  page.evaluate(() => {
    const g = document.querySelector('[data-center]');
    const circle = g?.querySelector('circle');
    return {
      count: document.querySelectorAll('[data-center]').length,
      id: g?.getAttribute('data-center') ?? null,
      title: g?.querySelector('title')?.textContent ?? null,
      cx: circle ? Number(circle.getAttribute('cx')) : null,
      cy: circle ? Number(circle.getAttribute('cy')) : null,
      pointerEvents: g?.getAttribute('pointer-events') ?? null,
    };
  });

let pass = true;
const check = (name, ok, detail) => {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) pass = false;
};

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await assertLoadedBundle(page);
await page.waitForSelector('[data-node-id]', { timeout: 20000 });
await page.keyboard.press('Control+o'); // mock 句柄 → 中心文档
await page.waitForFunction(() => document.querySelectorAll('[data-center]').length === 1, undefined, {
  timeout: 20000,
});
await page.waitForTimeout(700); // fit 动画 + 字体落定

// ① 普通态
const plain = await readBadge();
console.log('[plain] badge =', JSON.stringify(plain));
check('普通态：角标出现（data-center=1）', plain.count === 1, plain);
check('title =「中心（c4-center.mm.md#c1）」', plain.title === '中心（c4-center.mm.md#c1）', {
  title: plain.title,
});
check("pointerEvents = 'none'（不抢命中）", plain.pointerEvents === 'none', {
  pe: plain.pointerEvents,
});
await page.screenshot({ path: 'verify-shots/c4-badge-plain.png' });

// ② 选中态：点选中心节点
const node = page.locator(`g[data-node-id="${plain.id}"]`).first();
const bb = await node.boundingBox();
if (bb === null) throw new Error('中心节点无 boundingBox');
await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
await page.waitForTimeout(300);
const selected = await readBadge();
check('选中态：角标仍在（count = 1）', selected.count === 1 && selected.cx === plain.cx, {
  cx: selected.cx,
  was: plain.cx,
});
await page.screenshot({ path: 'verify-shots/c4-badge-selected.png' });

// ③ 拖拽中：按住拖动（预览态截图后才 Esc 取消）
const membersOf = () =>
  page.evaluate(() => {
    const gs = [...document.querySelectorAll('g[data-node-id]')];
    const t = (text) =>
      gs.find((g) => (g.textContent ?? '').trim() === text)?.getAttribute('transform') ?? null;
    return { work: t('工作'), projA: t('项目A'), root: t('根'), life: t('生活') };
  });
const beforeMove = await membersOf();

await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
await page.mouse.down();
await page.mouse.move(bb.x + bb.width / 2 + 40, bb.y + bb.height / 2 + 10, { steps: 4 });
await page.mouse.move(bb.x + bb.width / 2 + 80, bb.y + bb.height / 2 + 30, { steps: 4 });
await page.waitForTimeout(250);
const duringMove = await membersOf();
console.log('[dragging] before =', JSON.stringify(beforeMove));
console.log('[dragging] during =', JSON.stringify(duringMove));
check(
  '拖拽中：整岛成员跟随（工作+项目A 盒平移）',
  duringMove.work !== beforeMove.work && duringMove.projA !== beforeMove.projA,
  { before: beforeMove, during: duringMove },
);
check(
  '拖拽中：非成员不动（根/生活）',
  duringMove.root === beforeMove.root && duringMove.life === beforeMove.life,
  { before: beforeMove, during: duringMove },
);
const dragState = await page.evaluate(() => {
  const clone = document.querySelector('[data-drag-clone]');
  const badge = document.querySelector('[data-center]');
  const g = badge?.closest('g[data-node-id]');
  return {
    clone: clone !== null,
    workTransform: g?.getAttribute('transform') ?? null,
    workOpacity: g?.getAttribute('opacity') ?? null,
  };
});
console.log('[dragging] state =', JSON.stringify(dragState));
const dragging = await readBadge();
check('拖拽中：无浮空克隆（中心拖拽=整岛预览，非改结构）', dragState.clone === false, dragState);
check('拖拽中：角标随节点盒平移（cx 变化）', dragging.cx !== null && dragging.cx !== plain.cx, {
  cx: dragging.cx,
  was: plain.cx,
});
await page.screenshot({ path: 'verify-shots/c4-badge-dragging.png' });

await page.keyboard.press('Escape'); // 取消预览（零副作用）
await page.mouse.up();
await page.waitForTimeout(300);
const restored = await readBadge();
check('Esc 取消：角标复原（cx 回原位）', restored.cx === plain.cx, {
  cx: restored.cx,
  was: plain.cx,
});

// ④ Canvas 降级态：打开 5 万节点文档（自动降级）
console.log(`[canvas] 打开 ${BIG_N} 节点文档（等布局 + 自动降级，可能要数十秒）…`);
const t0 = Date.now();
await page.keyboard.press('Control+o');
await page.waitForFunction(() => document.body.textContent?.includes('中心标记'), undefined, {
  timeout: 240000,
});
console.log(`[canvas] 降级提示出现（耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`);
await page.waitForTimeout(400);
await page.screenshot({ path: 'verify-shots/c4-badge-canvas.png' });
const big = await page.evaluate(() => ({
  canvas: document.querySelectorAll('canvas').length,
  svgNodes: document.querySelectorAll('g[data-node-id]').length,
  centers: document.querySelectorAll('[data-center]').length,
  notice: document.body.textContent?.includes('中心标记') ?? false,
}));
console.log('[canvas] state =', JSON.stringify(big));
check('降级态：canvas 出现', big.canvas >= 1, big);
check('降级态：SVG 节点层让位（g[data-node-id] = 0）', big.svgNodes === 0, big);
check('降级态：无中心角标（data-center = 0）', big.centers === 0, big);
check('降级提示含「中心标记」（C4 文案）', big.notice === true, big);

console.log(pass ? '\n✅ C4 四态视觉验证全部通过' : '\n❌ 存在失败项');
// 5 万节点页面下 browser.close() 可能长时间不返回——限时等它，不阻塞退出码
await Promise.race([
  browser.close().catch(() => undefined),
  new Promise((r) => setTimeout(r, 5000)),
]);
process.exit(pass ? 0 : 1);
