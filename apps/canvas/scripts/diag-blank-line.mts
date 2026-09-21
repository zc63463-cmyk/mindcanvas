/**
 * 最小复现：验证 serializer 的分段空行行为（针对 serializer-roundtrip.test.ts 的两个断言）。
 *
 * 运行：cd apps/canvas && npx vite-node scripts/diag-blank-line.mts
 */
import { parseMm } from '../../packages/kernel/src/protocol/parser.ts';
import { serializeMm } from '../../packages/kernel/src/protocol/serializer.ts';

const cases: Array<[string, string]> = [
  ['甲/乙（全 heading 链）', '# 根\n## 分支\n- 甲\n  - 乙'],
  ['noted（笔记归后节点）', '# 根\n<!--\none_liner: x\n-->\n## 分支'],
  ['简单两分支', '# 根\n## A\n- a\n## B\n- b'],
];

for (const [name, src] of cases) {
  const root = parseMm(src).root!;
  const out = serializeMm(root);
  console.log(`\n── ${name} ──`);
  console.log('  输入:', JSON.stringify(src));
  console.log('  输出:', JSON.stringify(out));
  const re = parseMm(out);
  console.log('  再解析无损:', JSON.stringify(re.root) === JSON.stringify(root) ? '✅' : '❌');
  console.log('  幂等:', serializeMm(re.root!) === out ? '✅' : '❌');
}
