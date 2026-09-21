/**
 * 代码债务预算门禁 —— 冻结现有债务，禁止继续增长。
 *
 * 理念：清零存量债务的成本往往远高于收益（例如生产代码 94 处非空断言，
 * 逐一重构收益不匹配成本）。务实做法是**定基线、只减不增**：
 * 新增代码不得再引入，存量逐步消化。
 *
 * 基线来源：2026-09-02 实测（生产代码，排除测试）。
 * 更新基线：先改 CODE_BUDGET，并在提交信息中说明为何放宽。
 *
 * 运行：node scripts/check-code-budget.mjs
 * 退出码：0 = 在预算内；1 = 超预算（CI 应失败）
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SKIP = new Set(['node_modules', 'dist', '.git', '.workbuddy', 'bench-assets', 'dogfood-output']);

/** 预算上限（只减不增）。单位：处（大文件为个数） */
const CODE_BUDGET = {
  any: 0, // 已经为零，不允许再出现
  tsIgnore: 0, // 同上
  bang: 90, // 非空断言（生产代码；测试里的不计，见下）
  asCast: 31, // 类型断言（**不含** import/export 重命名，见统计处的 srcNoRename）
  console: 4, // console.log/warn/error/debug/info
  todo: 1, // TODO/FIXME/HACK/XXX
  defaultExport: 2, // 仅限入口组件（App / MindmapStage）；配置文件不计，见 isCounted
  bigFiles: 4, // 超过 600 行的生产文件数
};

const BIG_FILE_LIMIT = 600;

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) acc.push(p);
  }
  return acc;
}

const all = walk(ROOT).map((p) => {
  const rel = relative(ROOT, p).split('\\').join('/');
  return { rel, src: readFileSync(p, 'utf8') };
});
/** 是否计入债务统计：排除测试与构建配置（vite.config 等的 export default 是格式要求） */
function isCounted(rel) {
  const segs = rel.split('/');
  if (segs.some((s) => s === 'tests' || s === 'test')) return false;
  if (/\.test\.(ts|tsx)$/.test(rel)) return false;
  if (/\.config\.(ts|tsx)$/.test(rel)) return false;
  return true;
}

// 测试不计入：测试里大量 `x!.y` 是合理的「断言此处必非空」语义
const prod = all.filter((f) => isCounted(f.rel));

const actual = {
  any: 0,
  tsIgnore: 0,
  bang: 0,
  asCast: 0,
  console: 0,
  todo: 0,
  defaultExport: 0,
  bigFiles: 0,
};

const bigFiles = [];
for (const f of prod) {
  // `import { X as Y }` / `export { X as Y }` 的 as 是**重命名**，不是类型断言。
  // 不剥离会把 import 重命名误计入 asCast（曾导致假性超预算），统计前先排除。
  const srcNoRename = f.src.replace(/^(?:import|export)\s[\s\S]*?;/gm, '');
  actual.any += (f.src.match(/:\s*any\b|<any>|\bany\[\]/g) ?? []).length;
  actual.tsIgnore += (f.src.match(/@ts-(?:ignore|expect-error)/g) ?? []).length;
  actual.bang += (f.src.match(/!(?=\.|\[|\)|,|;|\s|$)/g) ?? []).length;
  actual.asCast += (srcNoRename.match(/\bas\s+(?:unknown|any|[A-Z]\w*)\b/g) ?? []).length;
  actual.console += (f.src.match(/\bconsole\.(log|warn|error|debug|info)\b/g) ?? []).length;
  actual.todo += (f.src.match(/\b(TODO|FIXME|HACK|XXX)\b/g) ?? []).length;
  actual.defaultExport += (f.src.match(/^\s*export default\b/gm) ?? []).length;
  const lines = f.src.split(/\r?\n/).length;
  if (lines > BIG_FILE_LIMIT) {
    actual.bigFiles++;
    bigFiles.push(`${f.rel} (${lines})`);
  }
}

console.log('代码债务预算检查（生产代码口径，测试不计入）\n');
console.log('  指标            实测   预算   状态');
console.log('  ' + '─'.repeat(48));

let over = 0;
for (const [k, budget] of Object.entries(CODE_BUDGET)) {
  const v = actual[k];
  const ok = v <= budget;
  const delta = v - budget;
  const mark = ok ? (v < budget ? `↓${-delta} 优于` : '持平') : `↑${delta} 超预算`;
  if (!ok) over++;
  console.log(`  ${k.padEnd(14)} ${String(v).padStart(5)} ${String(budget).padStart(6)}   ${mark}`);
}

if (bigFiles.length) {
  console.log(`\n  超 ${BIG_FILE_LIMIT} 行文件（${bigFiles.length}）：`);
  for (const b of bigFiles) console.log(`    ${b}`);
}

console.log('');
if (over === 0) {
  console.log('✅ 全部指标在预算内（债务未增长）');
  process.exit(0);
}
console.error(`❌ ${over} 项超出预算 —— 债务只减不增，请修正后再提交`);
process.exit(1);
