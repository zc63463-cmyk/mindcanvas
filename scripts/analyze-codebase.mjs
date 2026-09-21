/**
 * 代码库结构实测 —— 为「规范化编写逻辑 / 层次逻辑 / 实现逻辑」提供数据基础。
 *
 * 测量维度：
 *   A. 层次：各包规模、依赖方向、导出面收敛度、跨层直取内部文件
 *   B. 编写：文件规模分布、类型安全（any / ! / as）、导出模式、console/TODO
 *   C. 实现：复杂度热点（函数密度、最长函数）、拆分候选
 *
 * 运行：node scripts/analyze-codebase.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SKIP = new Set(['node_modules', 'dist', '.git', '.workbuddy', 'bench-assets', 'dogfood-output', 'coverage']);

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

const files = walk(ROOT).map((p) => {
  const src = readFileSync(p, 'utf8');
  const lines = src.split(/\r?\n/);
  const code = lines.filter((l) => l.trim() && !l.trim().startsWith('//') && !l.trim().startsWith('*')).length;
  return {
    path: relative(ROOT, p).split(sep).join('/'),
    src,
    lines: lines.length,
    code,
    isTest: /tests?\//.test(relative(ROOT, p).split(sep).join('/')),
    pkg: relative(ROOT, p).split(sep).join('/').split('/')[1] ?? '?',
  };
});

const prod = files.filter((f) => !f.isTest);
const test = files.filter((f) => f.isTest);

console.log('══════ A. 层次结构 ══════\n');
const byPkg = {};
for (const f of prod) {
  const key = f.path.split('/').slice(0, 2).join('/');
  (byPkg[key] ??= { files: 0, lines: 0, max: 0, maxFile: '' }).files++;
  (byPkg[key] ??= { files: 0, lines: 0, max: 0, maxFile: '' }).lines += f.lines;
  const b = byPkg[key];
  if (f.lines > b.max) {
    b.max = f.lines;
    b.maxFile = f.path;
  }
}
console.log('生产代码按包/目录：');
for (const [k, v] of Object.entries(byPkg).sort((a, b) => b[1].lines - a[1].lines)) {
  console.log(`  ${k.padEnd(28)} ${String(v.files).padStart(3)} 文件  ${String(v.lines).padStart(6)} 行  最大 ${v.max} (${v.maxFile.split('/').pop()})`);
}
console.log(`\n测试代码：${test.length} 文件 / ${test.reduce((s, f) => s + f.lines, 0)} 行`);
console.log(`生产/测试行数比：1 : ${(test.reduce((s, f) => s + f.lines, 0) / prod.reduce((s, f) => s + f.lines, 0)).toFixed(2)}`);

console.log('\n══════ A2. 导出面收敛度 ══════\n');
for (const entry of ['packages/kernel/src/index.ts', 'packages/react/src/index.ts']) {
  const f = prod.find((x) => x.path === entry);
  if (!f) continue;
  const names = new Set();
  for (const m of f.src.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const n of m[1].split(',')) {
      const t = n.trim().replace(/^type\s+/, '');
      if (t) names.add(t);
    }
  }
  // 显式具名导出（含 export const/function/class/interface/type 声明）
  for (const m of f.src.matchAll(/export\s+(?:declare\s+)?(?:const|function|class|interface|type|enum)\s+(\w+)/g)) names.add(m[1]);
  const starCount = (f.src.match(/export\s+\*/g) ?? []).length;
  const pkg = entry.includes('kernel') ? 'kernel' : 'react';
  // 穿透模式下：包内所有具名导出都成为公开 API
  const allExports = new Set();
  for (const x of prod) {
    if (!x.path.startsWith(`packages/${pkg}/src/`)) continue;
    if (x.path.endsWith('/index.ts')) continue;
    for (const m of x.src.matchAll(/export\s+(?:declare\s+)?(?:const|function|class|interface|type|enum|default)\s+(\w+)?/g)) {
      if (m[1]) allExports.add(m[1]);
    }
  }
  console.log(`  ${pkg.padEnd(7)} 入口直接导出 ${String(names.size).padStart(3)} 个符号 · export * ${starCount} 处`);
  console.log(`         穿透后实际公开面 ≈ ${allExports.size} 个符号  ${starCount > 0 ? '⚠ 全量穿透（内部即公开）' : '✅ 显式收敛'}`);
}

console.log('\n══════ A3. 跨层直取内部（绕过 index 的深 import）══════\n');
let deepImports = 0;
const deepByFile = {};
for (const f of prod) {
  for (const m of f.src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const spec = m[1];
    if (spec.includes('@mindcanvas/')) continue;
    const resolved = join(ROOT, f.path, '..', spec).split(sep).join('/').replace(ROOT.split(sep).join('/') + '/', '');
    const m2 = resolved.match(/^packages\/(kernel|react)\/src\/(.+)$/);
    if (m2 && m2[2].split('/').length > 1 && !m2[2].endsWith('/index')) {
      deepImports++;
      (deepByFile[f.path] ??= []).push(spec);
    }
  }
}
console.log(`  包内跨模块深 import 总数：${deepImports}（包内细粒度引用，正常）`);
const crossPkg = {};
for (const f of prod) {
  for (const m of f.src.matchAll(/from\s+['"]@mindcanvas\/(kernel|react)(?:\/([^'"]*))?['"]/g)) {
    const target = m[1];
    const self = f.path.startsWith(`packages/${target}`) ? target : 'other';
    const sub = m[2] ?? '(root)';
    const key = `${f.path.split('/')[1]} → ${target}${sub === '(root)' ? '' : '/' + sub}`;
    (crossPkg[key] ??= 0);
    crossPkg[key]++;
  }
}
console.log('\n  跨包引用（应按 包名根 引用，不应带子路径）：');
for (const [k, v] of Object.entries(crossPkg)) {
  const bad = k.includes('/') && !k.endsWith('(root)') ? '  ⚠ 子路径' : '';
  console.log(`    ${k.padEnd(50)} ${v}${bad}`);
}

console.log('\n══════ B. 编写逻辑一致性 ══════\n');
const metrics = { any: 0, bang: 0, asCast: 0, console: 0, todo: 0, tsIgnore: 0, biomeIgnore: 0, defaultExport: 0 };
for (const f of prod) {
  metrics.any += (f.src.match(/:\s*any\b|<any>|\bany\[\]/g) ?? []).length;
  // 非空断言：! 出现在 . [ ) , ; 空白 或 行尾 之前（不要求前导 \w，覆盖 foo)! 与 arr[i]! ）
  metrics.bang += (f.src.match(/!(?=\.|\[|\)|,|;|\s|$)/g) ?? []).length;
  metrics.asCast += (f.src.match(/\bas\s+(?:unknown|any|[A-Z]\w*)\b/g) ?? []).length;
  metrics.console += (f.src.match(/\bconsole\.(log|warn|error|debug|info)\b/g) ?? []).length;
  metrics.todo += (f.src.match(/\b(TODO|FIXME|HACK|XXX)\b/g) ?? []).length;
  metrics.tsIgnore += (f.src.match(/@ts-(?:ignore|expect-error)/g) ?? []).length;
  metrics.biomeIgnore += (f.src.match(/biome-ignore/g) ?? []).length;
  metrics.defaultExport += (f.src.match(/^\s*export default\b/gm) ?? []).length;
}
const prodLines = prod.reduce((s, f) => s + f.lines, 0);
console.log(`  生产代码总行数：${prodLines}`);
for (const [k, v] of Object.entries(metrics)) {
  const per1k = ((v / prodLines) * 1000).toFixed(1);
  console.log(`    ${k.padEnd(14)} ${String(v).padStart(5)}  (${per1k} /千行)`);
}

console.log('\n══════ C. 复杂度热点（拆分候选）══════\n');
const big = prod
  .map((f) => {
    const fnCount = (f.src.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+\w+|^\s*(?:export\s+)?const\s+\w+\s*=\s*(?:async\s*)?\(/gm) ?? []).length;
    const jsxReturn = (f.src.match(/^\s*return\s*\(/gm) ?? []).length;
    return { ...f, fnCount, jsxReturn, avgFn: fnCount ? Math.round(f.lines / fnCount) : 0 };
  })
  .sort((a, b) => b.lines - a.lines)
  .slice(0, 15);
console.log('  文件                                              行   函数  均长  JSX块');
for (const f of big) {
  const flag = f.lines > 600 ? ' ⚠' : '';
  console.log(
    `  ${f.path.padEnd(48)} ${String(f.lines).padStart(4)} ${String(f.fnCount).padStart(5)} ${String(f.avgFn).padStart(5)} ${String(f.jsxReturn).padStart(5)}${flag}`,
  );
}

console.log('\n══════ C2. 最长函数 TOP 10（按行数估算）══════\n');
const fns = [];
for (const f of prod) {
  const lines = f.src.split(/\r?\n/);
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const m = l.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
    if (m) {
      if (cur) fns.push(cur);
      cur = { name: m[1], file: f.path, start: i + 1, depth: 0 };
    }
    if (cur) {
      cur.depth += (l.match(/\{/g) ?? []).length - (l.match(/\}/g) ?? []).length;
      if (cur.depth <= 0 && i > cur.start) {
        // 行数按 1-based 闭区间计数：i 是 0-based 下标 → len = (i+1) − start + 1 = i − start + 2
        // （此前写 +1 少算 1 行：StageContent 报 1780、实际 1781 —— 2026-09-13 修正）
        cur.len = i - cur.start + 2;
        fns.push(cur);
        cur = null;
      }
    }
  }
  if (cur) {
    // 文件尾仍未闭合：按「文件以换行结尾」口径取末行（lines.length−1）计入
    cur.len = lines.length - cur.start;
    fns.push(cur);
  }
}
for (const fn of fns.sort((a, b) => b.len - a.len).slice(0, 10)) {
  console.log(`  ${String(fn.len).padStart(4)} 行  ${fn.name.padEnd(28)} ${fn.file}:${fn.start}`);
}
