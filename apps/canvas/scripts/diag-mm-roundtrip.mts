/**
 * 诊断：.mm.md 纯文本往返（round-trip）压力测试
 *
 * 这是「纯文本思维导图构建」的**核心硬指标**：
 * 用户用外部编辑器（VSCode / Obsidian）手写或修改 .mm.md 后，
 * 解析 → 序列化 → 再解析，数据必须无损。否则「纯文本是事实源」就不成立。
 *
 * 覆盖：9 种实体 kind / 跨库前缀 / 未知 kind / 笔记块全部已知字段 /
 *       多行 desc / next 数组 / links 对象列表 / 文档级 edges / 未知字段透传 /
 *       断裂引用。
 *
 * 运行：npx tsx apps/canvas/scripts/diag-mm-roundtrip.mts
 * 注意：import 走**源码**相对路径，不走包名 —— 否则会静默测到陈旧 dist。
 */
import { parseMm } from '../../packages/kernel/src/protocol/parser.ts';
import { serializeMm, verifyRoundTrip } from '../../packages/kernel/src/protocol/serializer.ts';

const DOC = `<!--
edges:
  - from: node:根/分支A/叶子1
    to: "@issue:8"
    rel: blocks
    dir: both
    label: 硬依赖
    note: 需先合入网关协议
    attrs: {"priority":"high"}
-->
# 根

## 分支A
- 叶子1
<!--
one_liner: 一句话摘要
status: 进行中
next:
  - 第一步
  - 第二步
reminder: 节点引用是快照不是拷贝
desc: 第一行描述\\n第二行描述\\n第三行描述
qa:
  - 问题一
  - 问题二
links:
  - rel: blocks
    to: "@issue:1"
    dir: back
    label: 阻塞
  - rel: relates-to
    to: node:根/分支A/叶子2
custom_field: 未知字段应透传
-->
- @issue:1
- @pr:12
- @doc:docs/a.md
- @milestone:M1
- @note:某笔记
- @idea:proj:3
- @annotation:anno-1
- @img:assets/a.svg
- @draw:assets/b.svg
- 叶子2

## 前向兼容与边界
- @unknownkind:xyz
- @issue:myorg/repo:42
- 普通文本节点
`;

function count(node: any, acc = { nodes: 0, refs: 0, notes: 0 }) {
  if (!node) return acc;
  acc.nodes++;
  if (node.ref) acc.refs++;
  if (node.note) acc.notes++;
  for (const c of node.children ?? []) count(c, acc);
  return acc;
}

const p1 = parseMm(DOC);
const stats = count(p1.root);

console.log('=== 第一次解析 ===');
console.log('节点/实体/笔记:', stats);
console.log('收集到 refs:', p1.refs.length);
console.log('诊断:', p1.diagnostics.length === 0 ? '无' : '');
for (const d of p1.diagnostics) console.log(`   [${d.code}] L${d.line} ${d.message}`);

const text1 = serializeMm(p1.root!);
const p2 = parseMm(text1);

console.log('\n=== 第二次解析（序列化后再解析）===');
console.log('诊断:', p2.diagnostics.length === 0 ? '无' : '');
for (const d of p2.diagnostics) console.log(`   [${d.code}] L${d.line} ${d.message}`);

const a = JSON.stringify(p1.root);
const b = JSON.stringify(p2.root);
const lossless = a === b;

console.log('\n=== 判定 ===');
console.log('verifyRoundTrip:', verifyRoundTrip(p1.root!));
console.log('结构无损:', lossless ? '✅ 是' : '❌ 否');
console.log('refs 一致:', JSON.stringify(p1.refs) === JSON.stringify(p2.refs) ? '✅' : '❌');

if (!lossless) {
  console.log('\n--- 差异定位 ---');
  const pa = JSON.parse(a);
  const pb = JSON.parse(b);
  console.log('p1:', JSON.stringify(pa, null, 1).slice(0, 1200));
  console.log('p2:', JSON.stringify(pb, null, 1).slice(0, 1200));
}

console.log('\n=== 序列化产物（用户将看到的文本）===');
console.log(text1);

// 关键字段抽查
const leaf = JSON.stringify(p1.root);
const checks: [string, boolean][] = [
  ['多行 desc 保留 \\n', leaf.includes('第二行描述')],
  ['next 数组两项', /"next":\["第一步","第二步"\]/.test(leaf)],
  ['未知字段透传', leaf.includes('custom_field')],
  ['未知 kind 保留', leaf.includes('unknownkind')],
  ['跨库前缀保留', leaf.includes('myorg/repo:42')],
  ['节点级 links 两条', (leaf.match(/"rel"/g) ?? []).length >= 2],
  ['links 保 rel/to/dir/label', leaf.includes('"dir":"back"') && leaf.includes('阻塞')],
  ['文档级 edges 保留', leaf.includes('硬依赖')],
];
console.log('\n=== 关键能力抽查 ===');
for (const [name, ok] of checks) console.log(`${ok ? '✅' : '❌'} ${name}`);

// ── 纯文本事实源的两个「文本形态」指标 ──────────────────────
const text2 = serializeMm(p2.root!);
const blankIn = (DOC.match(/^$/gm) ?? []).length;
const blankOut = (text1.match(/^$/gm) ?? []).length;

console.log('\n=== 文本形态（纯文本事实源的关键体验）===');
console.log(`手写输入空行数: ${blankIn} → 序列化后空行数: ${blankOut}`);
console.log('格式保真（空行/分段保留）:', blankOut >= blankIn ? '✅' : `❌ 丢失 ${blankIn - blankOut} 段空行`);
console.log('幂等（再序列化一次结果不变）:', text1 === text2 ? '✅ 已规范化' : '❌ 每次保存都在变');
console.log(
  '首次导入 diff 噪音:',
  text1 === DOC ? '无（与手写完全一致）' : '有（结构等价，但排版被规范化 → 首次保存会重写全文）',
);
