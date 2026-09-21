/**
 * 导出面收敛前置调研：摸清「真实被消费的符号」vs「当前公开的符号」。
 *
 * 收敛导出面（export * → 显式具名）不能拍脑袋砍 ——
 * kernel 是三项目共享的协议层，误删符号会破坏外部消费者。
 * 先测出谁在用谁，再决定哪些必须留在公开面。
 *
 * 运行：node scripts/analyze-exports.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SKIP = new Set(['node_modules', 'dist', '.git', '.workbuddy', 'bench-assets', 'dogfood-output']);

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

const files = walk(ROOT).filter((p) => {
  const r = relative(ROOT, p).split('\\').join('/');
  return !/tests?\//.test(r) && !/\/tests?\//.test(r);
});

/** 收集某包所有具名导出（含 index 的 re-export 解析） */
function collectExports(pkg) {
  const out = new Map(); // symbol -> Set<定义文件>
  const dir = join(ROOT, 'packages', pkg, 'src');
  for (const p of walk(dir)) {
    const src = readFileSync(p, 'utf8');
    const rel = relative(ROOT, p).split('\\').join('/');
    // 注意覆盖 abstract class 与 async function —— 漏掉会误报「消费了但找不到导出」
    for (const m of src.matchAll(
      /export\s+(?:declare\s+)?(?:abstract\s+)?(?:const|let|async\s+function|function|class|interface|type|enum)\s+(\w+)/g,
    )) {
      if (!out.has(m[1])) out.set(m[1], new Set());
      out.get(m[1]).add(rel);
    }
    // export { a, b as c }
    for (const m of src.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
      for (const n of m[1].split(',')) {
        const t = n.trim().replace(/^type\s+/, '');
        if (!t) continue;
        const name = t.includes(' as ') ? t.split(' as ')[1].trim() : t;
        if (!out.has(name)) out.set(name, new Set());
        out.get(name).add(rel);
      }
    }
  }
  return out;
}

/** 统计从 @mindcanvas/X 实际导入的符号（按消费者分组） */
function collectImports(pkg) {
  const used = new Map(); // symbol -> Set<消费者文件>
  for (const p of files) {
    const src = readFileSync(p, 'utf8');
    const rel = relative(ROOT, p).split('\\').join('/');
    const selfPkg = rel.startsWith(`packages/${pkg}/`) ? pkg : rel.startsWith('apps/') ? 'app' : 'other';
    if (selfPkg === pkg) continue;
    // 关键：必须区分子句来自哪个包，否则 app 从 react 导入的符号会被误算进 kernel
    for (const m of src.matchAll(
      /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]@mindcanvas\/([\w-]+)(?:\/[^'"]*)?['"]/g,
    )) {
      if (m[2] !== pkg) continue;
      for (const n of m[1].split(',')) {
        const t = n.trim().replace(/^type\s+/, '');
        if (!t) continue;
        const name = t.includes(' as ') ? t.split(' as ')[0].trim() : t;
        if (!used.has(name)) used.set(name, new Set());
        used.get(name).add(rel);
      }
    }
    for (const m of src.matchAll(
      /import\s+(?:type\s+)?(\w+)\s*,\s*\{([^}]*)\}\s*from\s*['"]@mindcanvas\/([\w-]+)/g,
    )) {
      if (m[3] !== pkg) continue;
      if (!used.has('[default]')) used.set('[default]', new Set());
      used.get('[default]').add(rel);
    }
    for (const m of src.matchAll(/import\s+\*\s+as\s+(\w+)\s+from\s*['"]@mindcanvas\/([\w-]+)/g)) {
      if (m[2] !== pkg) continue;
      if (!used.has('[namespace]')) used.set('[namespace]', new Set());
      used.get('[namespace]').add(`${rel} (as ${m[1]})`);
    }
    // 子路径深引用（绕过包根）：必须留公开面，否则收敛即破坏
    for (const m of src.matchAll(
      /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]@mindcanvas\/([\w-]+)\/([^'"]+)['"]/g,
    )) {
      if (m[2] !== pkg) continue;
      if (!used.has('[deep:' + m[3] + ']')) used.set('[deep:' + m[3] + ']', new Set());
      used.get('[deep:' + m[3] + ']').add(rel);
    }
  }
  return used;
}

for (const pkg of ['kernel', 'react']) {
  const exported = collectExports(pkg);
  const used = collectImports(pkg);
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`@mindcanvas/${pkg}`);
  console.log('═'.repeat(70));
  console.log(`当前公开面（穿透后）: ${exported.size} 个符号`);
  console.log(`外部实际消费        : ${used.size} 个符号`);
  const unused = [...exported.keys()].filter((k) => !used.has(k)).sort();
  console.log(`从未被跨包消费      : ${unused.length} 个 (${((unused.length / exported.size) * 100).toFixed(0)}%)`);

  const missing = [...used.keys()].filter((k) => !exported.has(k) && !k.startsWith('['));
  if (missing.length) console.log(`⚠ 消费了但找不到导出: ${missing.join(', ')}`);

  console.log(`\n── 外部实际消费的 ${used.size} 个符号 ──`);
  for (const [k, v] of [...used.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const consumers = [...v];
    const label = consumers.length === 1 ? consumers[0] : `${consumers.length} 处`;
    console.log(`  ${k.padEnd(30)} ${label}`);
  }

  console.log(`\n── 从未被跨包消费的符号（收敛候选，前 40）──`);
  console.log('  ' + unused.slice(0, 40).join(', '));
  if (unused.length > 40) console.log(`  ... 另 ${unused.length - 40} 个`);
}
