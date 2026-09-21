/**
 * Phase 1 · 导出面显式化生成器（TypeScript Compiler API 版）
 *
 * 把 `export * from '...'` 换成 `export { a, b } from '...'` + `export type { C, D } from '...'`。
 * **保留全部当前符号、零删减** —— 唯一变化是把隐式穿透变成可审查的显式清单。
 *
 * ⚠️ 为什么必须用 TS API 而不是正则：
 *   本项目开了 `verbatimModuleSyntax`，re-export 类型必须写 `export type`，
 *   否则报 TS1205；且跨模块重名（如 EntityRef 被多个模块导出）在 export * 下
 *   由编译器自动处理，显式化后会变成 TS2300 Duplicate identifier。
 *   —— 正则版生成器在这两点上都会失败（已实测）。
 *
 * 用法：
 *   node scripts/gen-explicit-exports-ts.mjs <kernel|react>            # 预览
 *   node scripts/gen-explicit-exports-ts.mjs <kernel|react> --write    # 写入
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import { createRequire } from 'node:module';

// typescript 未装在根 node_modules（各包自带），用 require 从包内解析
const require = createRequire(resolvePath(`packages/${process.argv[2] ?? 'kernel'}/package.json`));
const ts = require('typescript');

const pkg = process.argv[2];
const write = process.argv.includes('--write');
if (!pkg) {
  console.error('用法: node scripts/gen-explicit-exports-ts.mjs <kernel|react> [--write]');
  process.exit(1);
}

const ENTRY = resolvePath(`packages/${pkg}/src/index.ts`);
const TSCONFIG = resolvePath(`packages/${pkg}/tsconfig.json`);

const configFile = ts.readConfigFile(TSCONFIG, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, dirname(TSCONFIG));
const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
const checker = program.getTypeChecker();
const entrySf = program.getSourceFile(ENTRY);
if (!entrySf) {
  console.error(`找不到 ${ENTRY}`);
  process.exit(1);
}

const entrySym = checker.getSymbolAtLocation(entrySf);
if (!entrySym) {
  console.error('入口模块无符号');
  process.exit(1);
}

/** 入口当前导出的全部符号（含 export * 展开后的结果） */
const exported = checker.getExportsOfModule(entrySym);
console.log(`\n${ENTRY}`);
console.log(`  入口导出符号总数: ${exported.length}`);

/** 每个符号的原始声明所在文件（用于按来源分组） */
function originSpecifier(symbol) {
  let s = symbol;
  if (s.flags & ts.SymbolFlags.Alias) s = checker.getAliasedSymbol(s);
  const decls = s.getDeclarations() ?? [];
  if (decls.length === 0) return null;
  const file = decls[0].getSourceFile().fileName.replace(/\\/g, '/');
  const srcRoot = resolvePath(`packages/${pkg}/src`).replace(/\\/g, '/') + '/';

  // 来自其他包（如 kernel 的 dist/*.d.ts）→ 用包名，不能拼相对路径
  if (!file.startsWith(srcRoot)) {
    const m = file.match(/packages\/([^/]+)\//);
    return m ? `@mindcanvas/${m[1]}` : null;
  }

  const rel = file.replace(srcRoot, '');
  const dir = rel.split('/').slice(0, -1).join('/');
  // 注意先剥 .d.ts 再剥 .ts，否则 types.d.ts 会变成 types.d.js
  const base = rel
    .split('/')
    .pop()
    .replace(/\.d\.ts$/, '')
    .replace(/\.tsx?$/, '');
  if (!base || base === 'index') return null;
  return dir ? `./${dir}/${base}.js` : `./${base}.js`;
}

/** 判断符号是否只含类型（需 export type） */
function isTypeOnly(symbol) {
  let s = symbol;
  if (s.flags & ts.SymbolFlags.Alias) s = checker.getAliasedSymbol(s);
  const flags = s.flags;
  const hasValue = (flags & (ts.SymbolFlags.Value | ts.SymbolFlags.Class | ts.SymbolFlags.Function | ts.SymbolFlags.Variable)) !== 0;
  const hasType = (flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.TypeParameter)) !== 0;
  if (hasValue) return false; // class/enum 既是值也是类型，用 export {} 即可
  return hasType;
}

// ── 解析原文件：区分 注释头 / 已有显式 export / 待替换的 export * ──
const srcText = readFileSync(ENTRY, 'utf8');
const lines = srcText.split(/\r?\n/);

const headerLines = [];
const existingBlocks = [];
const existingNames = new Set();
let block = null;

for (const l of lines) {
  const isStar = /^export\s+\*\s*from\s*['"][^'"]+['"];?\s*$/.test(l);
  if (isStar) continue; // 由生成的清单取代

  if (/^export\b/.test(l)) {
    block = [l];
    if (/;\s*$/.test(l)) {
      existingBlocks.push(block.join('\n'));
      block = null;
    }
    continue;
  }
  if (block) {
    block.push(l);
    if (/;\s*$/.test(l)) {
      existingBlocks.push(block.join('\n'));
      block = null;
    }
    continue;
  }
  headerLines.push(l); // 注释与其它非 export 行
}

// 已有显式导出覆盖的符号（避免清单里重复导出 → TS2300）
for (const b of existingBlocks) {
  for (const m of b.matchAll(/^\s*(\w+),?\s*$/gm)) existingNames.add(m[1]);
  for (const m of b.matchAll(/export\s+(?:const|let|function|class|async function)\s+(\w+)/g)) existingNames.add(m[1]);
}
if (existingNames.size) console.log(`  已有显式导出 ${existingNames.size} 个（原样保留，清单跳过）`);

// 按来源模块分组 + 去重 + 分类（跳过入口本地定义与已有显式导出）
const byModule = new Map();
const dupes = [];
const claimed = new Map();
for (const sym of exported) {
  const name = sym.getName();
  if (name === 'default') continue;
  const spec = originSpecifier(sym);
  if (!spec) {
    console.error(`  ⚠ 无法定位来源: ${name}`);
    continue;
  }
  // 入口自身定义（如 export const kernelPlaceholder）→ 原文件已保留，跳过
  if (spec === './index.js') continue;
  if (existingNames.has(name)) continue;
  if (claimed.has(name)) {
    dupes.push(`${name}（${claimed.get(name)} 与 ${spec}）`);
    continue;
  }
  claimed.set(name, spec);
  if (!byModule.has(spec)) byModule.set(spec, { values: new Set(), types: new Set() });
  const g = byModule.get(spec);
  if (isTypeOnly(sym)) g.types.add(name);
  else g.values.add(name);
}

const totalValues = [...byModule.values()].reduce((s, g) => s + g.values.size, 0);
const totalTypes = [...byModule.values()].reduce((s, g) => s + g.types.size, 0);
console.log(`  值导出 ${totalValues} 个 · 类型导出 ${totalTypes} 个 · 合计 ${totalValues + totalTypes}`);
console.log(`  来源模块 ${byModule.size} 个`);
if (dupes.length) {
  console.log(`\n  ⚠ 跨模块重名 ${dupes.length} 处（保留首个来源，其余不重复导出）：`);
  for (const d of dupes.slice(0, 10)) console.log(`     ${d}`);
}

// 按来源模块生成 export / export type 块
const blocks = [];
for (const [spec, g] of [...byModule.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const parts = [];
  if (g.values.size) {
    const names = [...g.values].sort((a, b) => a.localeCompare(b));
    parts.push(`export {\n${names.map((n) => `  ${n},`).join('\n')}\n} from '${spec}';`);
  }
  if (g.types.size) {
    const names = [...g.types].sort((a, b) => a.localeCompare(b));
    parts.push(`export type {\n${names.map((n) => `  ${n},`).join('\n')}\n} from '${spec}';`);
  }
  if (parts.length) blocks.push(parts.join('\n'));
}

const header = headerLines.join('\n').replace(/\n+$/, '');
const content = [header, ...existingBlocks, ...blocks].filter(Boolean).join('\n\n') + '\n';

if (write) {
  writeFileSync(ENTRY, content, 'utf8');
  console.log(`\n✅ 已写入 ${ENTRY}`);
  console.log(`   验证: packages/${pkg}/node_modules/.bin/tsc -p packages/${pkg}/tsconfig.json`);
} else {
  console.log('\n（预览模式，加 --write 写入）\n' + '─'.repeat(60));
  console.log(content.slice(0, 2000));
}
