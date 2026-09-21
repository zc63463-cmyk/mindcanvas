/**
 * Phase 1 · 导出面显式化生成器
 *
 * 把 `export * from '...'` 换成 `export { a, b, c } from '...'`。
 * **保留全部当前符号、零删减** —— 唯一变化是把隐式穿透变成可审查的显式清单。
 * 风险由 tsc 兜底：清单少一个符号，typecheck 立刻报错。
 *
 * 用法：
 *   node scripts/gen-explicit-exports.mjs kernel        # 打印预览
 *   node scripts/gen-explicit-exports.mjs kernel --write # 写入文件
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const pkg = process.argv[2];
const write = process.argv.includes('--write');
if (!pkg) {
  console.error('用法: node scripts/gen-explicit-exports.mjs <kernel|react> [--write]');
  process.exit(1);
}

const ENTRY = `packages/${pkg}/src/index.ts`;
const entryDir = dirname(ENTRY);

/** .ts 源码中 import './x.js' 实际指向 ./x.ts */
function resolveSpec(spec, fromFile) {
  let p = resolve(dirname(fromFile), spec);
  if (p.endsWith('.js')) p = p.slice(0, -3) + '.ts';
  if (existsSync(p)) return p;
  if (existsSync(p + '.ts')) return p + '.ts';
  for (const cand of [join(p, 'index.ts'), p + '/index.ts']) if (existsSync(cand)) return cand;
  return null;
}

/** 收集一个文件的具名导出（export * 递归展开，带循环防护） */
function collect(file, sink, visited = new Set()) {
  const key = file;
  if (visited.has(key)) return;
  visited.add(key);
  const src = readFileSync(file, 'utf8');

  for (const m of src.matchAll(
    /export\s+(?:declare\s+)?(?:abstract\s+)?(?:const|let|async\s+function|function|class|interface|type|enum)\s+(\w+)/g,
  )) {
    sink.add(m[1]);
  }
  for (const m of src.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}\s*(?:from\s*['"]([^'"]+)['"])?/g)) {
    for (const n of m[1].split(',')) {
      const t = n.trim().replace(/^type\s+/, '');
      if (!t) continue;
      const name = t.includes(' as ') ? t.split(' as ')[1].trim() : t;
      sink.add(name);
    }
  }
  for (const m of src.matchAll(/export\s+\*\s*from\s*['"]([^'"]+)['"]/g)) {
    const target = resolveSpec(m[1], file);
    if (target) collect(target, sink, visited);
    else console.error(`  ⚠ 无法解析: ${m[1]} (来自 ${file})`);
  }
}

const entrySrc = readFileSync(ENTRY, 'utf8');
const lines = entrySrc.split(/\r?\n/);

// 找所有 `export * from '...'`，保持原顺序与来源
const stars = [];
for (const line of lines) {
  const m = line.match(/^export\s+\*\s*from\s*['"]([^'"]+)['"];?\s*$/);
  if (m) stars.push({ spec: m[1], raw: line });
}
if (stars.length === 0) {
  console.log(`${ENTRY} 已无 export *，无需处理`);
  process.exit(0);
}

const groups = [];
const allNames = new Set();
for (const s of stars) {
  const target = resolveSpec(s.spec, ENTRY);
  if (!target) {
    console.error(`  ⚠ 无法解析: ${s.spec}`);
    continue;
  }
  const names = new Set();
  collect(target, names);
  groups.push({ spec: s.spec, names: [...names].sort((a, b) => a.localeCompare(b)) });
  for (const n of names) allNames.add(n);
}

// 跨模块重名检测（同名在多个来源导出 → 显式化会冲突）
const seen = new Map();
for (const g of groups) {
  for (const n of g.names) {
    if (seen.has(n)) console.error(`  ⚠ 重名冲突: ${n} 同时来自 ${seen.get(n)} 与 ${g.spec}`);
    else seen.set(n, g.spec);
  }
}

console.log(`\n${ENTRY}`);
console.log(`  export * ${stars.length} 处 → 显式导出 ${allNames.size} 个符号（零删减）\n`);
for (const g of groups) console.log(`  ${g.spec.padEnd(28)} ${g.names.length} 个`);

// 生成新内容：保持原文件结构，只替换 export * 行
let out = [...lines];
let cursor = 0;
out = out.flatMap((line) => {
  const m = line.match(/^export\s+\*\s*from\s*['"]([^'"]+)['"];?\s*$/);
  if (!m) return [line];
  const g = groups.find((x) => x.spec === m[1]);
  if (!g || g.names.length === 0) return [line];
  cursor++;
  const body = g.names.map((n) => `  ${n},`).join('\n');
  return [`export {`, body, `} from '${m[1]}';`];
});

const content = out.join('\n');
if (write) {
  writeFileSync(ENTRY, content, 'utf8');
  console.log(`\n✅ 已写入 ${ENTRY}`);
  console.log('   下一步：跑 typecheck 验证清单完整性');
  console.log(`   packages/${pkg}/node_modules/.bin/tsc -p packages/${pkg}/tsconfig.json`);
} else {
  console.log('\n（预览模式，加 --write 写入）');
  console.log('─'.repeat(60));
  console.log(content.slice(0, 1500));
}
