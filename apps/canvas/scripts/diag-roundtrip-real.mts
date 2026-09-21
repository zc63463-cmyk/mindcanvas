/**
 * 用真实 .mm.md 文件验证往返无损 + 空行保真。
 *
 * 存在的意义：这套环境里 vitest 偶发挂起（SIGTERM），
 * 用 vite-node 跑纯函数验证更稳，可作为 vitest 之外的快速复核手段。
 *
 * 运行：cd apps/canvas && npx vite-node scripts/diag-roundtrip-real.mts
 */
import { readFileSync } from 'node:fs';
import { parseMm } from '../../packages/kernel/src/protocol/parser.ts';
import { serializeMm } from '../../packages/kernel/src/protocol/serializer.ts';

const files = ['./src/demo/gateway.mm.md', '../../bench-assets/big-10k.mm.md'];

for (const f of files) {
  let src: string;
  try {
    src = readFileSync(f, 'utf8');
  } catch {
    console.log(`\n── ${f} ──\n  (跳过：文件不存在)`);
    continue;
  }

  const p1 = parseMm(src);
  const t1 = serializeMm(p1.root!);
  const p2 = parseMm(t1);
  const t2 = serializeMm(p2.root!);

  const lossless = JSON.stringify(p1.root) === JSON.stringify(p2.root);
  const idempotent = t1 === t2;
  const blankIn = (src.match(/^\s*$/gm) ?? []).length;
  const blankOut = (t1.match(/^\s*$/gm) ?? []).length;

  console.log(`\n── ${f} ──`);
  console.log(`  节点解析: ${p1.root ? 'ok' : 'FAILED'} · refs ${p1.refs.length} · 诊断 ${p1.diagnostics.length}`);
  console.log(`  往返无损: ${lossless ? '✅' : '❌ 结构不一致'}`);
  console.log(`  幂等    : ${idempotent ? '✅' : '❌ 再序列化发生变化'}`);
  console.log(`  空行    : 输入 ${blankIn} → 输出 ${blankOut} ${blankOut > 0 ? '✅ 分段保留' : '⚠ 全被压缩'}`);
  if (p1.diagnostics.length) {
    for (const d of p1.diagnostics.slice(0, 5)) console.log(`    [${d.code}] L${d.line}`);
  }
  if (!lossless) {
    console.log('  --- 差异 ---');
    console.log('  p1:', JSON.stringify(p1.root).slice(0, 400));
    console.log('  p2:', JSON.stringify(p2.root).slice(0, 400));
  }
}
