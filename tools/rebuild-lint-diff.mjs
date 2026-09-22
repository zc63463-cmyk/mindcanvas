// 重建 lint-diff-raw.json：基准与标注一致（S1 基线 → S4 候选 → R2 候选）
//
// 历史问题（S4-R2 复核 finding medium）：原文件自称是「与 S1 基线逐键对齐」的差分，
// 但头部 baseTotal/s4Total=1541/1541 与 S4 候选实测 1544 矛盾，且全文件 0 次出现
// useExportActions —— 说明它不是任何一对干净的两态差分，读者按文档核不动。
//
// 本脚本用临时 worktree 抽 S1 与 S4 两棵树（候选树即当前 worktree），
// 三方各自实跑 biome，产出**三对**差分（S1→S4 / S1→候选 / S4→候选），
// 每对都带自述的 base/target 标签与总数，使读者能直接对上文档。
//
// ## 用法
//   node tools/rebuild-lint-diff.mjs
//   node tools/rebuild-lint-diff.mjs --out=<path>      # 指定输出（默认见下）
//   node tools/rebuild-lint-diff.mjs --force           # 允许覆盖已存在的输出
//   LINT_OUT=<path> node tools/rebuild-lint-diff.mjs
//
// ## 输出目录（重要，勿踩）
//   默认输出到 `outputs/summary-node/S4-R2/S4-R2-20260921-160000/gates/lint-diff-raw.json`
//   —— 那是**已入库的历史证据文件**。默认**拒绝覆盖已存在的输出**，须显式 `--force`。
//   跑新一轮复算请用 `--out=` 指到本轮证据目录。
//
// ## 环境依赖（如实声明）
// - 需要本仓库 `node_modules`（biome）；三棵树用**同一个** biome 二进制。
// - 临时 worktree 建在 `os.tmpdir()`，并**以 junction 共享主仓 `node_modules`**
//   （不各自安装）；成功与失败路径**都会**清理（`try/finally`）。
// - 每个临时 worktree 建好后会**校验 HEAD == 目标 SHA**，不符即报错退出。
// - **不联网**。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BS = String.fromCharCode(92);
const ROOT = path.resolve(__dirname, '..');
const LEGACY_OUT = path.join(ROOT, 'outputs/summary-node/S4-R2/S4-R2-20260921-160000/gates/lint-diff-raw.json');
const BIOME = path.join(ROOT, 'node_modules/@biomejs/biome/bin/biome');
/** Windows 下 biome 的 bin 是 shell 脚本，须走 .cmd（与 runBiomeIn 同口径）。 */
const BIOME_CMD = process.platform === 'win32' ? path.join(ROOT, 'node_modules/.bin/biome.cmd') : BIOME;

function argValue(name) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`);
}

const OUT = path.resolve(argValue('out') ?? process.env.LINT_OUT ?? LEGACY_OUT);
const FORCE = hasFlag('force');

const S1 = '0fa0f9dfb6eecec6d47019b4efd2f7615fe9350b';
const S4C = '5cc072008dd5cf1278d3e7cdb735535fcf0697f1';

// ---------------------------------------------------------------- 覆盖防护
if (fs.existsSync(OUT) && !FORCE) {
  console.error(
    `[rebuild-lint-diff] 拒绝覆盖已存在的输出文件：\n  ${OUT}\n` +
      `  该路径可能是**已入库的历史证据**。若确要覆盖，请显式加 --force；\n` +
      `  若要写新一轮证据，请用 --out=<本轮证据目录>/gates/lint-diff-raw.json。`,
  );
  process.exit(2);
}
if (!fs.existsSync(BIOME_CMD)) {
  console.error(`[rebuild-lint-diff] 未找到 biome：${BIOME_CMD}\n  请先在仓库根执行 pnpm install（本脚本不联网安装）。`);
  process.exit(2);
}
const biomeVersion = execFileSync(BIOME_CMD, ['--version'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
}).trim();

function keysFromJson(p) {
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  return {
    total: j.summary.warnings,
    keys: j.diagnostics.map((d) => {
      const f = String(d.location?.path ?? '').split(BS).join('/');
      return f + '|' + (d.location?.start?.line ?? 0) + '|' + d.category;
    }),
    count: j.diagnostics.length,
  };
}

function runBiomeIn(dir, outJson) {
  // biome 的 bin 是 shell 脚本，Windows 下不能直接 execFile；走 cmd/shell 更稳。
  // 用 biome.cmd 并显式开 shell，保证在 win32 上也能跑。
  const cmd = process.platform === 'win32' ? path.join(ROOT, 'node_modules/.bin/biome.cmd') : BIOME;
  const out = execFileSync(cmd, ['lint', 'packages', 'apps', '--reporter=json', '--max-diagnostics=3000'], {
    cwd: dir,
    shell: process.platform === 'win32',
    maxBuffer: 1 << 30,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  fs.writeFileSync(outJson, out);
  return keysFromJson(outJson);
}

function diffKeys(base, target) {
  const B = new Set(base.keys);
  const T = new Set(target.keys);
  const added = {};
  const removed = {};
  for (const k of target.keys) {
    if (B.has(k)) continue;
    const p = k.split('|');
    const key = p[0] + '|' + p[2];
    (added[key] = added[key] || []).push(Number(p[1]));
  }
  for (const k of base.keys) {
    if (T.has(k)) continue;
    const p = k.split('|');
    const key = p[0] + '|' + p[2];
    (removed[key] = removed[key] || []).push(Number(p[1]));
  }
  for (const o of [added, removed]) for (const k of Object.keys(o)) o[k].sort((a, b) => a - b);

  // 按 file|category 聚合的净增（真正的「新增告警」判据）
  const agg = (o) => {
    const m = {};
    for (const k of Object.keys(o)) m[k] = (m[k] || 0) + o[k].length;
    return m;
  };
  const A = agg(added);
  const R = agg(removed);
  const all = Array.from(new Set(Object.keys(A).concat(Object.keys(R)))).sort();
  let net = 0;
  const nonzero = [];
  for (const k of all) {
    const d = (A[k] || 0) - (R[k] || 0);
    net += d;
    if (d !== 0) nonzero.push({ key: k, net: d, added: A[k] || 0, removed: R[k] || 0 });
  }
  return { added, removed, addedCount: Object.values(added).reduce((s, a) => s + a.length, 0), removedCount: Object.values(removed).reduce((s, a) => s + a.length, 0), netByFileCategory: net, nonzero };
}

// ---------------------------------------------------------------- 临时 worktree（自建自清）
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-diff-'));
const created = [];

function makeWorktree(ref, label) {
  const dir = path.join(tmpRoot, label);
  execFileSync('git', ['worktree', 'add', '--detach', dir, ref], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  created.push(dir);
  // 校验：HEAD 必须等于目标 SHA（防止 ref 解析到别处 / 复用错树）
  const head = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (head !== ref) {
    throw new Error(`[rebuild-lint-diff] worktree ${dir} 的 HEAD=${head} 与目标 ${ref} 不符`);
  }
  // biome 需要解析依赖：以 junction 共享主仓 node_modules（不各自安装、不联网）
  const nm = path.join(dir, 'node_modules');
  if (!fs.existsSync(nm)) {
    fs.symlinkSync(path.join(ROOT, 'node_modules'), nm, 'junction');
  }
  return dir;
}

function cleanup() {
  for (const dir of created.reverse()) {
    try {
      execFileSync('git', ['worktree', 'remove', '--force', dir], { cwd: ROOT, stdio: 'ignore' });
    } catch {
      /* 已不存在 / 移除失败：下面兜底删目录 */
    }
  }
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* 兜底清理失败不掩盖主流程结果 */
  }
}

let exitCode = 0;
try {
  const WT_S1 = makeWorktree(S1, 's1');
  const WT_S4 = makeWorktree(S4C, 's4');

  const jsonS1 = path.join(tmpRoot, 'lint-s1.json');
  const jsonS4 = path.join(tmpRoot, 'lint-s4.json');
  const jsonCand = path.join(tmpRoot, 'lint-cand.json');
  const s1 = runBiomeIn(WT_S1, jsonS1);
  const s4 = runBiomeIn(WT_S4, jsonS4);
  const cand = runBiomeIn(ROOT, jsonCand);

  const out = {
    _note:
      '本文件由 tools/rebuild-lint-diff.mjs 生成。S4-R2 复核 finding medium 指出原文件标注与内容不符' +
      '（自称 S1 差分但含 S4 中间态特征、且不含 useExportActions），故整体重建为**三对**自述清晰的差分。' +
      '读者请按 "pairs.<label>.base/target" 的标签理解，不要沿用旧文件的 baseTotal/s4Total 口径。',
    generatedBy: 'tools/rebuild-lint-diff.mjs',
    generatedAt: new Date().toISOString(),
    toolchain: {
      biome: biomeVersion,
      command: 'lint packages apps --reporter=json --max-diagnostics=3000',
      node: process.version,
      platform: process.platform,
    },
    refs: {
      s1: S1,
      s4Candidate: S4C,
      r2Candidate: '见 manifest.txt 的「交付候选提交 SHA」',
      r2CandidateResolved: execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    },
    totals: {
      s1: { warnings: s1.total, diagnostics: s1.count },
      s4Candidate: { warnings: s4.total, diagnostics: s4.count },
      r2Candidate: { warnings: cand.total, diagnostics: cand.count },
    },
    pairs: {},
  };

  const pairs = [
    ['s1_to_s4Candidate', 'S1 基线 → S4 候选', s1, s4],
    ['s1_to_r2Candidate', 'S1 基线 → S4-R2 候选（本文档作 lint 判据的那一对）', s1, cand],
    ['s4Candidate_to_r2Candidate', 'S4 候选 → S4-R2 候选（本批实际消除的 3 条）', s4, cand],
  ];
  for (const [label, desc, base, target] of pairs) {
    const d = diffKeys(base, target);
    out.pairs[label] = {
      description: desc,
      baseWarnings: base.total,
      targetWarnings: target.total,
      addedCount: d.addedCount,
      removedCount: d.removedCount,
      netByFileCategory: d.netByFileCategory,
      nonzero: d.nonzero,
      added: d.added,
      removed: d.removed,
    };
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log('written ' + OUT);
  console.log('toolchain: biome=' + biomeVersion + ' node=' + process.version);
  console.log('totals: s1=' + s1.total + ' s4=' + s4.total + ' cand=' + cand.total);
  for (const [label] of pairs) {
    const p = out.pairs[label];
    console.log(
      label + ': added=' + p.addedCount + ' removed=' + p.removedCount + ' 净增(file|category)=' + p.netByFileCategory +
        (p.nonzero.length ? '  非零: ' + p.nonzero.map((n) => n.key + ' net=' + n.net).join('; ') : '  （全部为行号位移）'),
    );
  }
} catch (err) {
  console.error('[rebuild-lint-diff] 失败：' + (err && err.message ? err.message : String(err)));
  exitCode = 1;
} finally {
  cleanup();
}
process.exit(exitCode);

