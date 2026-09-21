/**
 * 真实内容端到端验证：用真实项目的 .mm.md 跑 parse → serialize → parse。
 *
 * 为什么需要它：此前往返验证只跑 demo / fixtures 这类「干净」数据，
 * 真实文档里有中文、特殊字符、空行分段、实体引用、笔记块混杂——
 * 序列化保真（1.3.1）到底成不成立，得用真实内容说话。
 *
 * 运行：cd apps/canvas && npx vite-node scripts/diag-real-content.mts [文件路径]
 */
import { readFileSync } from 'node:fs';
import { parseMm } from '../../packages/kernel/src/protocol/parser.ts';
import { serializeMm, verifyRoundTrip } from '../../packages/kernel/src/protocol/serializer.ts';

const file = process.argv[2] ?? '../../packages/kernel/tests/fixtures/pomodoroxi.mm.md';
// 相对 cwd（脚本约定在 apps/canvas 下运行），故用 ../../ 回到仓库根
const src = readFileSync(file, 'utf8');

console.log(`══════ 真实内容验证 ══════`);
console.log(`  文件: ${file.split('/').pop()}`);
console.log(`  原文: ${src.split('\n').length} 行 / ${src.length} 字符\n`);

// ① 解析
const first = parseMm(src);
console.log(`① 解析`);
console.log(`   根节点: ${first.root?.text ?? '(无)'}`);
console.log(`   诊断: ${first.diagnostics.length} 条`);
for (const d of first.diagnostics.slice(0, 10)) {
  console.log(`     - ${d.message}`);
}

// ② 数据语义等价（parse → serialize → parse）
const lossless = verifyRoundTrip(first.root);
console.log(`\n② 数据语义等价: ${lossless ? '✅ 无损' : '❌ 有损'}`);

// ③ 序列化幂等
const s1 = serializeMm(first.root);
const s2 = serializeMm(parseMm(s1).root);
console.log(`③ 序列化幂等:   ${s1 === s2 ? '✅ 幂等' : '❌ 不幂等'}`);

// ④ 空行分段保真（1.3.1 的核心修复）
const blankSrc = (src.match(/^[ \t]*$/gm) ?? []).length;
const blankOut = (s1.match(/^[ \t]*$/gm) ?? []).length;
console.log(`④ 空行分段:     原文 ${blankSrc} 处 → 输出 ${blankOut} 处`);

// ⑤ 实体引用保真
const refsSrc = (src.match(/@[a-z]+:[^\s]+/g) ?? []).length;
const refsOut = (s1.match(/@[a-z]+:[^\s]+/g) ?? []).length;
console.log(`⑤ 实体引用:     原文 ${refsSrc} 个 → 输出 ${refsOut} 个`);

console.log(`\n   输出: ${s1.split('\n').length} 行 / ${s1.length} 字符`);

// ⑥ 杂散行后果：标题下直接写描述文字（非 `- ` 列表项）会不会丢
const strays = first.diagnostics
  .filter((d) => d.message.includes('杂散行'))
  .map((d) => (d.message.split('杂散行:')[1] ?? '').trim())
  .filter((s) => s.length > 0);
if (strays.length > 0) {
  console.log(`\n⑥ 杂散行后果（关键）:`);
  for (const s of strays.slice(0, 4)) {
    const key = s.slice(0, 14);
    console.log(`   "${key}…" → ${s1.includes(key) ? '✅ 保留' : '❌ 序列化后丢失'}`);
  }
  // 打印序列化后的首个笔记块，看特殊字符是否被正确引用
  const noteBlock = s1.match(/<!--[\s\S]*?-->/)?.[0] ?? '(无笔记块)';
  console.log(`\n   序列化后的笔记块:\n${noteBlock.split('\n').map((l) => `     ${l}`).join('\n')}`);
}

const pass = lossless && s1 === s2 && refsSrc === refsOut;

// ⑦ 往返有损时，定位到底丢了什么（按「节点文本」集合对比）
if (!lossless) {
  // 带上 note 一起比（verifyRoundTrip 比 text+type+note+children，不只是文本）
  const sigs = (root: typeof first.root): string[] => {
    const out: string[] = [];
    const walk = (n: typeof first.root, path: string): void => {
      if (!n) return;
      out.push(`${path} | ${n.text} | note=${JSON.stringify(n.note ?? null)}`);
      (n.children ?? []).forEach((c, i) => walk(c, `${path}.${i}`));
    };
    walk(root, '0');
    return out;
  };
  const before = sigs(first.root);
  const after = sigs(parseMm(s1).root);
  console.log(`\n⑦ 有损定位：`);
  console.log(`   节点数 ${before.length} → ${after.length}`);
  let shown = 0;
  for (let i = 0; i < Math.max(before.length, after.length) && shown < 6; i++) {
    const b = before[i];
    const a = after[i];
    if (b !== a) {
      console.log(`   ── 第 ${i} 个节点不一致`);
      console.log(`      前: ${(b ?? '(无)').slice(0, 240)}`);
      console.log(`      后: ${(a ?? '(无)').slice(0, 240)}`);
      shown++;
    }
  }
}
console.log(`\n${pass ? '✅ 全部通过' : '❌ 存在问题，见上'}`);
