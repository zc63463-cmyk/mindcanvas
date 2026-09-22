/**
 * DELIVERY-CLOSE 深度收尾 · 验收共享库（T1/T3/T4/T5 的基础设施）
 * ══════════════════════════════════════════════════════════════════════
 * 只放**跨脚本复用**的验收逻辑，不让 `verify-release-123.mjs` 继续单体膨胀：
 *
 * 1. `createWriteLedger()`   写盘账本：`write()` 只记 pending，`close()` 成功后才进 committed；
 *                            读文件永远取「最后一份 committed」，失败/未完成的写入不可读。
 *                            同一函数源码经 `WRITE_LEDGER_SOURCE` 注入浏览器（单一事实源，
 *                            避免单测 helper 与页面实现漂移）。
 * 2. `ledgerSelfCheck()`     Node 端自检：延迟 close 不可读、reject close 不新增成功记录、
 *                            issued 只表示尝试编号。由验收脚本在启动浏览器前跑一次并落证据。
 * 3. `semanticCanvas()`      自由画布语义投影：按 uuid 排序、显式忽略时间戳（写入即变，
 *                            非语义字段）——重开/再存的比较不得用字符串或数量替代。
 * 4. 导出件解析：`parsePngHeader` / `svgViewBox` / `svgNode` / `perturbSvgFontSize`
 *                            （PNG 是 SVG 的 scale=2 栅格化，坐标可精确映射到像素）。
 * 5. `inputPaths()` / `verifyInputs()` / `writeInputs()`   运行输入冻结清单：每次正式运行前
 *                            逐项复算，不一致即停（exit 3），修改后另建清单、保留旧清单。
 * 6. `fingerprint()`        候选源码指纹（git status -uall 过滤工作区相关面）：开工/收尾两次比较。
 *
 * 纪律：本文件不得产出 `console.*`（由验收脚本统一输出）；不得依赖包内 TS 源码。
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

/** 仓库根（tools/lib/ → ../..） */
export const ROOT = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
export const hashFile = (abs) => sha256(readFileSync(abs));

/* ───────────────────────────── 1. 写盘账本 ───────────────────────────── */

/**
 * 写盘账本（**自包含**：`toString()` 后可直接注入浏览器，勿引用外部作用域）。
 *
 * 语义（与 DC-R1/R2 的复核出口一一对应）：
 * - `begin` 分配「尝试编号」id（失败也递增，**不是**完成序号）；
 * - `write(v)` 只把内容记成 pending：`latest()` 此时读不到；
 * - `close(finish)` 先 await 完成（gate/落盘），**成功后**才进 committed（单份快照可查）；
 *   抛错（写失败）→ 不产生任何成功记录；
 * - 读文件（getFile）只应读 `latest(scope)`。
 */
export function createWriteLedger() {
  let issued = 0;
  const pending = [];
  const committed = [];
  return {
    begin(scope, handle) {
      const id = ++issued; // 尝试编号（可能失败），不是完成序号
      const entry = { id, scope, handle, startedAt: Date.now() };
      pending.push(entry);
      let text;
      const drop = () => {
        const i = pending.indexOf(entry);
        if (i >= 0) pending.splice(i, 1);
      };
      return {
        id,
        scope,
        write(value) {
          text = value;
        },
        async close(finish) {
          try {
            await finish(); // 拒绝（写失败/中止）→ 直接抛出，不进 committed
            if (typeof text !== 'string') throw new Error('Missing snapshot');
            committed.push({ id, scope, handle, text, committedAt: Date.now() });
          } finally {
            drop(); // 无论成败都结束该次尝试：失败不得留在 pending 里冒充「进行中」
          }
        },
        abort() {
          drop();
        },
      };
    },
    latest(scope) {
      for (let i = committed.length - 1; i >= 0; i -= 1) if (committed[i].scope === scope) return committed[i];
      return null;
    },
    committedCount(scope) {
      return scope === undefined ? committed.length : committed.filter((c) => c.scope === scope).length;
    },
    pendingCount() {
      return pending.length;
    },
    snapshot() {
      return {
        issued,
        committed: committed.map((c) => ({
          id: c.id,
          scope: c.scope,
          handle: c.handle,
          bytes: c.text.length,
          at: c.committedAt,
        })),
        pending: pending.map((p) => ({ id: p.id, scope: p.scope, handle: p.handle })),
      };
    },
  };
}

/**
 * 注入浏览器用的源码：**求值即得账本实例**（`(function createWriteLedger(){…})()`）。
 * 页面里 `new Function(\`return ${WRITE_LEDGER_SOURCE}\`)()` 直接拿到 ready 的 ledger——
 * 写成工厂表达式会被误当实例（`typeof ledger.begin === 'undefined'`），这里一并固定住。
 */
export const WRITE_LEDGER_SOURCE = `(${createWriteLedger.toString()})()`;

/**
 * Node 端自检（等价于浏览器里注入的同一函数）：
 * 覆盖「pending 不可读 / 延迟 close 仍不可读 / close 成功才可读 / reject 不新增成功记录 /
 * issued 只算尝试」——任一不成立即 throw，验收脚本据此判红。
 */
export function ledgerSelfCheck() {
  const steps = [];
  const assert = (name, cond, detail) => {
    steps.push({ name, ok: cond === true, detail });
    if (cond !== true) throw new Error(`ledger self-check failed: ${name}`);
  };
  const ledger = createWriteLedger();

  const a = ledger.begin('md:main', 'f.mm.md');
  a.write('v1');
  assert('pending 不可读（write 后未 close）', ledger.latest('md:main') === null, { pending: ledger.pendingCount() });

  const b = ledger.begin('md:main', 'f.mm.md');
  b.write('v2');
  assert('第二次尝试 issued=2（尝试编号非完成序号）', b.id === 2, { idA: a.id, idB: b.id });
  assert('两个 pending 都不进 committed', ledger.committedCount('md:main') === 0, ledger.snapshot());

  return {
    steps,
    /** 延迟 close：resolve 前不可读、resolve 后可读 */
    runDelayedClose: async () => {
      const l = createWriteLedger();
      let release;
      const gate = new Promise((r) => {
        release = r;
      });
      const e = l.begin('json', 'c.json');
      e.write('{"a":1}');
      const done = e.close(async () => {
        await gate;
      });
      assert('延迟 close：等待期间不可读', l.latest('json') === null, {});
      release();
      await done;
      assert('延迟 close：完成后可读且内容一致', l.latest('json')?.text === '{"a":1}', l.latest('json'));
      return steps;
    },
    /** reject close：抛错、不新增成功记录 */
    runRejectedClose: async () => {
      const l = createWriteLedger();
      const e = l.begin('json', 'c.json');
      e.write('{"a":1}');
      let threw = false;
      try {
        await e.close(async () => {
          throw new Error('disk-full');
        });
      } catch {
        threw = true;
      }
      assert('reject close：如实抛出', threw === true, {});
      assert('reject close：不新增成功记录', l.latest('json') === null && l.pendingCount() === 0, l.snapshot());
      return steps;
    },
  };
}

/* ───────────────────────────── 2. 语义投影 ───────────────────────────── */

/**
 * 自由画布语义投影（DC-R2）：按稳定身份（placementUuid / edgeUuid）排序，
 * 逐字段显式列出；`createdAt/updatedAt` **豁免**——它们在每次写盘时更新，
 * 不属模型语义（写入必然改写，比较它们等于比较时间戳）。
 * 夹具只含 `native` 卡；其他 kind 不得未经协议核对就套用本投影。
 */
export function semanticCanvas(model) {
  const placements = [...(model?.placements ?? [])]
    .sort((a, b) => String(a.placementUuid).localeCompare(String(b.placementUuid)))
    .map((p) => ({
      id: p.placementUuid,
      kind: p.kind,
      shell: p.shell ?? null,
      face: p.face ?? null,
      front: p.front ?? null,
      back: p.back ?? null,
      transform: p.transform ?? null,
      zIndex: p.zIndex ?? null,
    }));
  const edges = [...(model?.edges ?? [])]
    .sort((a, b) => String(a.edgeUuid).localeCompare(String(b.edgeUuid)))
    .map((e) => {
      const { createdAt, updatedAt, ...rest } = e;
      void createdAt;
      void updatedAt;
      return rest;
    });
  return { placements, edges };
}

/** 连接端点对（edgeUuid:from->to，排序）——数量/字符串比较之外的语义身份证据 */
export const edgePairs = (model) =>
  (model?.edges ?? []).map((e) => `${e.edgeUuid}:${e.fromPlacementUuid}->${e.toPlacementUuid}`).sort();

/* ───────────────────────────── 3. 导出件解析 ───────────────────────────── */

/** 主题注释带（设计规格 §10 L1：DescBlock 恒用 textMuted） */
export const MUTED_FILL = '#98a2b3';

/** 颜色归一：hex ↔ rgb() 不必等值比较（SVG 用 token hex，计算样式给 rgb()） */
export function normalizeFill(v) {
  const s = String(v).trim().toLowerCase();
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s);
  if (m === null) return s.replace(/^#/, '');
  return [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('');
}

/** 通道和（设计 §10 L4 的「简单通道和」亮度口径） */
export function channelSum(v) {
  const hex = normalizeFill(v);
  const m = /^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(hex);
  if (m === null) return null;
  return Number.parseInt(m[1], 16) + Number.parseInt(m[2], 16) + Number.parseInt(m[3], 16);
}

/** PNG 头部解码（签名 + IHDR 宽高 + 位深/色彩类型） */
export function parsePngHeader(buf) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  const signature = buf.length > 24 && sig.every((b, i) => buf[i] === b) && buf.toString('ascii', 12, 16) === 'IHDR';
  return {
    signature,
    width: signature ? buf.readUInt32BE(16) : 0,
    height: signature ? buf.readUInt32BE(20) : 0,
    bitDepth: signature ? buf[24] : 0,
    colorType: signature ? buf[25] : 0,
    bytes: buf.length,
  };
}

/**
 * 导出 SVG 的背景色（exportSvg 写入的首个整幅 `<rect … fill=canvas色>`）。
 * 用于「有效绘制」判定的**主题无关**口径：与背景同色即空白，
 * 不再把「深色画布」写死（classic 浅底主题下旧口径会退化成恒真）。
 */
export function svgBackgroundFill(svgText) {
  const m = /<rect x="[-\d.]+" y="[-\d.]+" width="[\d.]+" height="[\d.]+" fill="([^"]+)"/.exec(svgText);
  return m === null ? null : m[1];
}

/** SVG 导出的 viewBox / 声明尺寸（exportSvg 恒写入这两组属性） */
export function svgViewBox(svgText) {
  const vb = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(svgText);
  const wh = /width="([\d.]+)"\s+height="([\d.]+)"/.exec(svgText);
  if (vb === null || wh === null) return null;
  return {
    x: Number(vb[1]),
    y: Number(vb[2]),
    w: Number(vb[3]),
    h: Number(vb[4]),
    width: Number(wh[1]),
    height: Number(wh[2]),
  };
}

/**
 * 定位导出 SVG 中某个节点：`<g transform="translate(x y)"><rect w h/><text font-size fill>label</text></g>`。
 * 返回世界坐标下的盒与字号/颜色（`cx/cy` 为盒中心）——供「SVG ↔ 画布逐节点比对」与
 * 「PNG 像素区域 ↔ 节点坐标」映射共用。
 */
export function svgNode(svgText, label) {
  const re = /<g transform="translate\(([-\d.]+) ([-\d.]+)\)">([\s\S]*?)<\/g>/g;
  for (const m of svgText.matchAll(re)) {
    const inner = m[3] ?? '';
    const t = /<text\b([^>]*)>([^<]*)<\/text>/.exec(inner);
    if (t === null) continue;
    if (!(t[2] ?? '').includes(label)) continue;
    const attrs = t[1] ?? '';
    const rect = /<rect width="([\d.]+)" height="([\d.]+)"/.exec(inner);
    const x = Number(m[1]);
    const y = Number(m[2]);
    const w = rect === null ? 0 : Number(rect[1]);
    const h = rect === null ? 0 : Number(rect[2]);
    return {
      label,
      fontSize: Number(/font-size="([\d.]+)"/.exec(attrs)?.[1] ?? Number.NaN),
      fill: /fill="([^"]+)"/.exec(attrs)?.[1] ?? null,
      x,
      y,
      w,
      h,
      cx: x + w / 2,
      cy: y + h / 2,
    };
  }
  return null;
}

/**
 * 行为负控用：在**独立副本**里错改某个节点的字号（导出件副本，不动正常导出、不动产品）。
 * 返回 { text, changed }；找不到目标即 changed=false（调用方据此判红，不静默通过）。
 */
export function perturbSvgFontSize(svgText, label, delta) {
  const re = /<g transform="translate\(([-\d.]+) ([-\d.]+)\)">([\s\S]*?)<\/g>/g;
  let changed = false;
  const out = svgText.replace(re, (whole, x, y, inner) => {
    const t = /<text\b([^>]*)>([^<]*)<\/text>/.exec(inner ?? '');
    if (t === null || (t[2] ?? '').trim() !== label || changed) return whole;
    const bumped = (t[1] ?? '').replace(/font-size="([\d.]+)"/, (_, f) => `font-size="${Number(f) + delta}"`);
    changed = true;
    return whole.replace(t[0], t[0].replace(t[1], bumped));
  });
  return { text: out, changed };
}

/* ───────────────────────── 4. 运行输入冻结清单 ───────────────────────── */

/**
 * 本轮验收程序的输入集（脚本自身 + 依赖库 + 夹具 + 产物入口 bundle）。
 * **每次正式运行前逐项复算**：不一致 → 停止该运行（exit 3）；修改后 `writeInputs` 另建清单。
 */
export function inputPaths(root = ROOT) {
  const rels = [
    'tools/verify-release-123.mjs',
    'tools/lib/releaseAcceptance.mjs',
    'tools/lib/snapshotCheck.mjs',
    'apps/canvas/tests/fixtures/release-123.mm.md',
    'apps/canvas/tests/fixtures/release-123-centers.mm.md',
    'apps/canvas/tests/fixtures/release-123-canvas.mm.md',
    'apps/canvas/tests/fixtures/release-123-nested.mm.md',
    'apps/canvas/tests/fixtures/release-123.mc.canvas.json',
    'apps/canvas/dist/index.html',
  ];
  const html = readFileSync(join(root, 'apps/canvas/dist/index.html'), 'utf8');
  for (const m of html.matchAll(/\/assets\/([A-Za-z0-9_.-]+\.js)/g)) rels.push(`apps/canvas/dist/assets/${m[1]}`);
  return [...new Set(rels)];
}

/** [{ path, sha256, bytes }] */
export function digestMap(root = ROOT, rels = inputPaths(root)) {
  return rels.map((p) => {
    const abs = join(root, p);
    if (!existsSync(abs)) return { path: p, sha256: null, bytes: null };
    const buf = readFileSync(abs);
    return { path: p, sha256: sha256(buf), bytes: buf.length };
  });
}

const manifestText = (rows, reason) =>
  [
    `# DELIVERY-CLOSE 运行输入冻结清单 · generated=${new Date().toISOString()} · reason=${reason}`,
    ...rows.map((r) => `${r.sha256 ?? 'MISSING'}  ${r.path}`),
    '',
  ].join('\n');

/** 写（或重写）输入清单——环境/脚本修改后另建，保留旧清单与更改原因（原因写进首行） */
export function writeInputs(file, reason, root = ROOT) {
  mkdirSync(dirname(file), { recursive: true });
  const rows = digestMap(root);
  writeFileSync(file, manifestText(rows, reason), 'utf8');
  return rows;
}

/** 复算并与清单比对：{ ok, missing, mismatched, extra } */
export function verifyInputs(file, root = ROOT) {
  const rows = digestMap(root);
  const now = new Map(rows.map((r) => [r.path, r.sha256]));
  const declared = new Map();
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trim() === '' || line.startsWith('#')) continue;
    const m = /^([0-9a-f]{64}|MISSING)\s+(.+)$/.exec(line);
    if (m !== null) declared.set(m[2].trim(), m[1]);
  }
  const missing = [...declared.keys()].filter((p) => !now.has(p) || now.get(p) === null);
  const mismatched = [...declared.entries()]
    .filter(([p, h]) => now.has(p) && now.get(p) !== null && now.get(p) !== h)
    .map(([p, h]) => ({ path: p, declared: h, actual: now.get(p) }));
  const extra = [...now.keys()].filter((p) => !declared.has(p));
  return { ok: missing.length === 0 && mismatched.length === 0 && extra.length === 0, missing, mismatched, extra };
}

/* ───────────────────────────── 5. 候选指纹 ───────────────────────────── */

/** 工作区相关面（四包源码/测试/夹具/构建配置/验收工具/文档）；排除证据目录与禁区 */
const INCLUDE = [
  /^apps\//,
  /^packages\//,
  /^tools\/(?!graph-engine\/)/,
  /^scripts\//,
  /^docs\//,
  /^\.githooks\//,
  /^\.github\//,
  /^(CHANGELOG|README|CONTRIBUTING)\.md$/,
  /^package\.json$/,
  /^pnpm-(lock\.yaml|workspace\.yaml)$/,
  /^[^/]+\.(json|js|cjs|mjs|ts)$/,
];
const EXCLUDE = [/^outputs\//, /^_tmp/, /^\./, /^tools\/graph-engine\//];

/** git status -uall → 候选清单（含 untracked 文件；不整树暂存，只读） */
export function candidateList(root = ROOT) {
  const out = execFileSync('git', ['status', '--porcelain=v1', '-uall'], { cwd: root, encoding: 'utf8' });
  const rows = [];
  for (const line of out.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const status = line.slice(0, 2);
    let p = line.slice(3).trim();
    if (p.includes(' -> ')) p = p.split(' -> ')[1].trim();
    if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
    if (!INCLUDE.some((re) => re.test(p))) continue;
    if (EXCLUDE.some((re) => re.test(p))) continue;
    rows.push({ path: p.replace(/\\/g, '/'), status: status.trim() });
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

/** HEAD / branch / 候选文件哈希（开工与收尾各一次，除申报修改外不得有未归属变化） */
export function fingerprint(root = ROOT) {
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const rows = candidateList(root);
  return {
    generatedAt: new Date().toISOString(),
    head: git(['rev-parse', 'HEAD']),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    files: rows.map((r) => {
      const abs = join(root, r.path);
      return { ...r, sha256: existsSync(abs) ? hashFile(abs) : null };
    }),
  };
}

/** 相对路径（用于输出里可读的定位） */
export const relOf = (root, abs) => relative(root, abs).split('\\').join('/');

/* ─────────────────── 6. 完整候选清单（DF-R1） ─────────────────── */
/*
 * 注意：本文件是**验收驱动的运行时依赖** —— 任何改动都会改变运行输入冻结清单里
 * `tools/lib/releaseAcceptance.mjs` 的哈希，从而作废已固化的浏览器证据。
 * 因此本轮 DF-R1 的工具改动落在定稿之后，并**整批重跑**了正常与全部负控（见返修回执）。
 */

/**
 * 候选作用域（**含点目录**：此前 `/^\./` 的排除把 INCLUDE 里明确列出的
 * `.github/` 与 `.githooks/` 又排除了一次，导致两处未提交的门禁修改不进候选）。
 */
const FC_INCLUDE = [
  /^apps\//, // 源码 + 测试 + 夹具 + public 资产 + 样式（含 .css/.mm.md/.json）
  /^packages\//,
  /^tools\/(?!graph-engine\/)/,
  /^scripts\//,
  /^docs\//,
  /^\.github\//,
  /^\.githooks\//,
  /^\.dependency-cruiser\.js$/,
  /^biome\.json$/,
  /^tsconfig(\.base)?\.json$/,
  /^package\.json$/,
  /^pnpm-(lock\.yaml|workspace\.yaml)$/,
  /^(CHANGELOG|README|CONTRIBUTING)\.md$/,
];
/** 明确不属于候选的东西（历史未跟踪目录 / 证据目录 / 构建产物由运行输入清单另行覆盖） */
const FC_EXCLUDE = [
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)coverage\//,
  /^tools\/graph-engine\//,
  /^_tmp/,
  /^\.codebase-memory\//,
  /^\.cursor\//,
  /^outputs\//,
];

const fcInScope = (p) => FC_INCLUDE.some((re) => re.test(p)) && !FC_EXCLUDE.some((re) => re.test(p));

/**
 * 完整候选清单（DF-R1）：
 *
 * base = `git ls-files`（**全部 tracked**，含已被删除的项）
 *      ∪ `git ls-files --others --exclude-standard`（未跟踪但未被忽略）
 * → 按 `FC_INCLUDE` / `FC_EXCLUDE` 过滤 → 逐项 SHA256（文件不存在记为删除）。
 *
 * 与 `fingerprint()`（= 只看 `git status` 差异）的区别：
 * ① 覆盖作用域内**全部文件**，而不只是有改动的文件 —— 可独立证明「除申报差异外没有别的被动过」；
 * ② 修掉点目录被二次排除的 bug（`.github/`、`.githooks/` 现在会进候选）；
 * ③ 显式记录**删除项**（tracked 但磁盘上不存在）。
 *
 * 不覆盖：构建产物（`apps/canvas/dist/**`、CSS 打包结果）——那些由运行输入冻结清单
 * （`inputs.sha256`，含实际加载的入口 bundle）负责；两者合起来才是「源码 + 运行资产」。
 *
 * 重建方式（可独立复算）：
 *   git ls-files -z ; git ls-files -z --others --exclude-standard
 *   → 按 FC_INCLUDE/FC_EXCLUDE 过滤（见本文件）→ 对每个路径算 SHA256
 */
export function fullCandidateList(root = ROOT) {
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  const split = (out) => out.split('\0').filter((p) => p !== '');
  const tracked = split(git(['ls-files', '-z']));
  const untracked = split(git(['ls-files', '-z', '--others', '--exclude-standard']));
  const kindOf = new Map();
  for (const p of tracked) kindOf.set(p.replace(/\\/g, '/'), 'tracked');
  for (const p of untracked) if (!kindOf.has(p.replace(/\\/g, '/'))) kindOf.set(p.replace(/\\/g, '/'), 'untracked');

  const paths = [...kindOf.keys()].filter(fcInScope).sort((a, b) => a.localeCompare(b));
  const files = [];
  const deleted = [];
  for (const rel of paths) {
    const abs = join(root, rel);
    if (!existsSync(abs)) {
      deleted.push({ path: rel, source: kindOf.get(rel) });
      continue;
    }
    const buf = readFileSync(abs);
    files.push({ path: rel, source: kindOf.get(rel), sha256: sha256(buf), bytes: buf.length });
  }
  return {
    generatedAt: new Date().toISOString(),
    head: git(['rev-parse', 'HEAD']).trim(),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']).trim(),
    scope: {
      include: FC_INCLUDE.map(String),
      exclude: FC_EXCLUDE.map(String),
      note: 'tracked ∪ untracked(未忽略)；构建产物由 inputs.sha256 覆盖',
    },
    counts: { total: files.length, tracked: files.filter((f) => f.source === 'tracked').length, untracked: files.filter((f) => f.source === 'untracked').length, deleted: deleted.length },
    files,
    deleted,
  };
}

/** 复算完整候选：返回 missing / mismatched / extra（与清单声明逐项比对） */
export function verifyFullCandidate(candidate) {
  const now = new Map(fullCandidateList().files.map((f) => [f.path, f.sha256]));
  const declared = new Map(candidate.files.map((f) => [f.path, f.sha256]));
  const missing = [...declared.keys()].filter((p) => !now.has(p));
  const mismatched = [...declared.entries()]
    .filter(([p, h]) => now.has(p) && now.get(p) !== h)
    .map(([p, h]) => ({ path: p, declared: h, actual: now.get(p) }));
  const extra = [...now.keys()].filter((p) => !declared.has(p));
  return { ok: missing.length === 0 && mismatched.length === 0 && extra.length === 0, declared: declared.size, recomputed: now.size, missing, mismatched, extra };
}

/* ───────────────────────────── CLI（可复跑） ───────────────────────────── */
const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('tools/lib/releaseAcceptance.mjs');
if (isMain) {
  const argv = process.argv.slice(2);
  const arg = (k) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(`--${k}=`.length) ?? null;
  const cmd = argv[0];
  try {
    if (cmd === 'fingerprint') {
      const out = arg('out');
      const fp = fingerprint();
      if (out !== null) {
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, JSON.stringify(fp, null, 2), 'utf8');
      }
      console.log(JSON.stringify({ command: 'fingerprint', head: fp.head, files: fp.files.length, out }, null, 2));
    } else if (cmd === 'full-candidate') {
      const out = arg('out');
      const cand = fullCandidateList();
      if (out !== null) {
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, JSON.stringify(cand, null, 2), 'utf8');
      }
      console.log(
        JSON.stringify(
          { command: 'full-candidate', head: cand.head, counts: cand.counts, out },
          null,
          2,
        ),
      );
    } else if (cmd === 'verify-candidate') {
      const file = arg('file');
      if (file === null) throw new Error('verify-candidate: --file=<path> 必填');
      const v = verifyFullCandidate(JSON.parse(readFileSync(file, 'utf8')));
      console.log(JSON.stringify({ command: 'verify-candidate', file, ...v, mismatched: v.mismatched.slice(0, 20), missing: v.missing.slice(0, 20), extra: v.extra.slice(0, 20) }, null, 2));
      if (!v.ok) process.exit(1);
    } else if (cmd === 'inputs') {
      const file = arg('file');
      if (file === null) throw new Error('inputs: --file=<path> 必填');
      if (arg('reason') !== null) {
        const rows = writeInputs(file, arg('reason'));
        console.log(JSON.stringify({ command: 'inputs', action: 'write', file, rows: rows.length, reason: arg('reason') }, null, 2));
      } else {
        const v = verifyInputs(file);
        console.log(JSON.stringify({ command: 'inputs', action: 'verify', file, ...v }, null, 2));
        if (!v.ok) process.exit(3);
      }
    } else {
      console.log('usage: node tools/lib/releaseAcceptance.mjs fingerprint --out=<file>');
      console.log('       node tools/lib/releaseAcceptance.mjs inputs --file=<file> [--reason=<text>]');
    }
  } catch (e) {
    console.error(JSON.stringify({ command: cmd, error: String(e) }));
    process.exit(3);
  }
}
