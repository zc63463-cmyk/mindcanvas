import { readFileSync } from 'node:fs';
import { parseMm, astToEditable, serializeMm, editableToAst } from '@mindcanvas/kernel';
import { collectFreeEdges } from '@mindcanvas/react';

// 验证文档级边（root.note.edges）能否穿过 markdown 序列化往返而不失真。
// 这是「连线能否持久化」的根：若往返丢字段/变形，用户存盘再打开连线就没了。
const src = readFileSync('src/demo/gateway.mm.md', 'utf8');

const parsed = parseMm(src);
const errCount = parsed.diagnostics.filter((d) => d.level === 'error').length;
console.log('parse 错误数 =', errCount);

const root = astToEditable(parsed.root);
const before = root.note?.edges;
console.log('\n=== 原始 edges ===');
console.log(JSON.stringify(before, null, 2));

const beforeResolved = collectFreeEdges(root).map((e) => ({
  rel: e.rel,
  from: e.from,
  to: e.to,
  state: e.state,
}));

// 回环：editable → ast → markdown → parse → editable
const roundTrip = serializeMm(editableToAst(root));
const reparsed = astToEditable(parseMm(roundTrip).root);
const after = reparsed.note?.edges;

console.log('\n=== 往返后 edges ===');
console.log(JSON.stringify(after, null, 2));

const afterResolved = collectFreeEdges(reparsed).map((e) => ({
  rel: e.rel,
  from: e.from,
  to: e.to,
  state: e.state,
}));

console.log('\n=== 字段保真 ===');
console.log('边数一致:', (before?.length ?? 0) === (after?.length ?? 0));
console.log('JSON 完全一致:', JSON.stringify(before) === JSON.stringify(after));

console.log('\n=== 解析结果一致 ===');
console.log(
  JSON.stringify(beforeResolved) === JSON.stringify(afterResolved) ? '一致 ✓' : '不一致 ✗',
);
if (JSON.stringify(beforeResolved) !== JSON.stringify(afterResolved)) {
  console.log('  before:', JSON.stringify(beforeResolved));
  console.log('  after :', JSON.stringify(afterResolved));
}

const allWellFormed = afterResolved.every((e) => e.state === 'well-formed');
console.log('\n往返后全部边仍 well-formed:', allWellFormed);
console.log(
  '结论 =',
  JSON.stringify(before) === JSON.stringify(after) && allWellFormed
    ? '往返保真 —— 连线可持久化'
    : '往返失真 —— 存盘后连线会丢',
);
