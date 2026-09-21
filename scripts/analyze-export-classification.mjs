/**
 * 导出面分类 —— 为「收敛哪些符号」提供决策依据。
 *
 * ⚠️ 关键教训：不能按「本仓库内是否被消费」来收敛。
 *    kernel 是三项目共享协议层，ADR-0004 冻结的公开接口
 *    （KindRegistry / LayoutRegistry / MindNode / ParseResult …）
 *    本仓库内几乎不消费 —— 它们是给外部用的扩展点。
 *    按消费数据收敛 = 删掉冻结接口。
 *
 * 分类：
 *   FROZEN     —— ADR-0004 / CHANGELOG 1.0.0 明确冻结的公开接口（不可收敛）
 *   CONSUMED   —— 本仓库内跨包实际消费（不可收敛）
 *   EXTENSION  —— 扩展点形状（Registry/Algorithm/Options/Func/Builder…）（建议保留）
 *   INTERNAL   —— 其余（收敛候选，仍需人工确认）
 *
 * 运行：node scripts/analyze-export-classification.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SKIP = new Set(['node_modules', 'dist', '.git', '.workbuddy', 'bench-assets', 'dogfood-output']);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) acc.push(p);
  }
  return acc;
}

// ADR-0004 冻结清单（CHANGELOG 1.0.0「冻结的公开接口面」）
const FROZEN_KERNEL = new Set([
  'parseMm', 'serializeMm', 'astToEditable', 'editableToAst', 'validateId', 'stripOrgPrefix',
  'refKey', 'unresolvedEntity', 'isUnresolved', 'REGISTERED_KINDS', 'KIND_META', 'KIND_FALLBACK_COLOR',
  'EntityRef', 'Entity', 'Resolver', 'resolveAll', 'Note', 'MindNode', 'UnresolvedReason',
  'Diagnostic', 'ParseResult', 'KindRegistry', 'NoteKeyRegistry', 'RendererRegistry',
  'LayoutRegistry', 'SemanticsRegistry', 'ChannelRegistry', 'Registry', 'UnregisterHandle',
  'createKernelRegistries', 'registerBuiltinKinds', 'parseLinkAnchor', 'resolveLinkAnchor',
  'resolveLinks', 'resolveGroups', 'AnchorResolutionState', 'LinkAnchor', 'LinkDir',
  'ResolvedLink', 'ResolvedGroup', 'Plugin', 'PluginHost', 'applyOp', 'invertOp', 'OpHistory',
  'TreeOp', 'pathOf', 'nodeByPath', 'searchNodes', 'layoutMindmap', 'MeasureFn', 'CharMeasure',
  'isBoxInView', 'filterVisibleLinks',
]);
const FROZEN_REACT = new Set([
  'ThemeProvider', 'useTheme', 'TokenSet', 'MapView', 'GlassCard', 'FlipCard', 'ThemeSwitcher',
  'QaEditor', 'GrowthCommentPanel', 'ShortcutHelpPanel', 'ContextMenu', 'SearchPanel',
  'OutlinePanel', 'formatNote', 'EditorController', 'useEditor', 'matchEditorKey',
  'EDITOR_KEY_BINDINGS', 'buildEditable', 'buildEntities', 'layoutDemo', 'createCharMeasure',
  'searchMind',
]);

const EXTENSION_HINT =
  /(Registry|Algorithm|Func|Options|Options\b|Builder|Provider|Handler|Strategy|Kind|Plugin|Host|Registry)$/;

const files = walk(ROOT)
  .map((p) => relative(ROOT, p).split('\\').join('/'))
  .filter((r) => !/tests?\//.test(r) && !/\/tests?\//.test(r));

function collectExports(pkg) {
  const out = new Map();
  for (const p of walk(join(ROOT, 'packages', pkg, 'src'))) {
    const src = readFileSync(p, 'utf8');
    const rel = relative(ROOT, p).split('\\').join('/');
    for (const m of src.matchAll(
      /export\s+(?:declare\s+)?(?:abstract\s+)?(?:const|let|async\s+function|function|class|interface|type|enum)\s+(\w+)/g,
    )) {
      if (!out.has(m[1])) out.set(m[1], rel);
    }
    for (const m of src.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
      for (const n of m[1].split(',')) {
        const t = n.trim().replace(/^type\s+/, '');
        if (!t) continue;
        const name = t.includes(' as ') ? t.split(' as ')[1].trim() : t;
        if (!out.has(name)) out.set(name, rel);
      }
    }
  }
  return out;
}

function collectConsumed(pkg) {
  const used = new Set();
  for (const rel of files) {
    if (rel.startsWith(`packages/${pkg}/`)) continue;
    const src = readFileSync(join(ROOT, rel), 'utf8');
    for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]@mindcanvas\/([\w-]+)(?:\/[^'"]*)?['"]/g)) {
      if (m[2] !== pkg) continue;
      for (const n of m[1].split(',')) {
        const t = n.trim().replace(/^type\s+/, '');
        if (t) used.add(t.includes(' as ') ? t.split(' as ')[0].trim() : t);
      }
    }
  }
  return used;
}

const summary = [];
for (const [pkg, frozen] of [
  ['kernel', FROZEN_KERNEL],
  ['react', FROZEN_REACT],
]) {
  const exported = collectExports(pkg);
  const consumed = collectConsumed(pkg);
  const buckets = { FROZEN: [], CONSUMED: [], EXTENSION: [], INTERNAL: [] };
  for (const [name, file] of exported) {
    if (frozen.has(name)) buckets.FROZEN.push(name);
    else if (consumed.has(name)) buckets.CONSUMED.push(name);
    else if (EXTENSION_HINT.test(name)) buckets.EXTENSION.push(name);
    else buckets.INTERNAL.push(name);
  }
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`@mindcanvas/${pkg}  公开面 ${exported.size} 个符号`);
  console.log('═'.repeat(72));
  for (const [k, v] of Object.entries(buckets)) {
    const pct = ((v.length / exported.size) * 100).toFixed(0);
    console.log(`  ${k.padEnd(10)} ${String(v.length).padStart(4)} (${pct}%)`);
  }
  summary.push({ pkg, total: exported.size, buckets });

  const safe = buckets.INTERNAL.filter((n) => !/^(DEFAULT|MAX|MIN|H_|V_|LINE_|DESC_|EDGE_|CANVAS_|ENTITY_)/.test(n));
  console.log(`\n  ── 收敛候选 INTERNAL（${buckets.INTERNAL.length}）──`);
  console.log('  ' + buckets.INTERNAL.sort().join(', '));
  console.log(`\n  ── 扩展点 EXTENSION（${buckets.EXTENSION.length}）建议保留 ──`);
  console.log('  ' + buckets.EXTENSION.sort().join(', '));
}

console.log(`\n${'═'.repeat(72)}`);
console.log('结论');
console.log('═'.repeat(72));
for (const s of summary) {
  const must = s.buckets.FROZEN.length + s.buckets.CONSUMED.length;
  console.log(`  ${s.pkg.padEnd(7)} 必须保留 ${must} / ${s.total}（冻结 ${s.buckets.FROZEN.length} + 已消费 ${s.buckets.CONSUMED.length}）`);
  console.log(`         可讨论 ${s.buckets.EXTENSION.length + s.buckets.INTERNAL.length}（扩展点 ${s.buckets.EXTENSION.length} + 内部 ${s.buckets.INTERNAL.length}）`);
}
console.log('\n  ⚠️ 但「可讨论」不等于「可删」——kernel 对外共享，删前须确认外部项目未使用。');
console.log('  建议：先做显式化（export * → 具名清单，零删减），拿到可审查清单后再逐项决策。');
