import { readFileSync } from 'node:fs';
import {
  buildEditable,
  collectNodeChoices,
  collectFreeEdges,
  anchorOfNode,
} from '@mindcanvas/react';

const src = readFileSync('src/demo/gateway.mm.md', 'utf8');
const { editable: root } = buildEditable(src);

function anchorName(n) {
  if (n.type === 'text') return n.text ?? '';
  if (n.type === 'entity' && n.ref) return `@${n.ref.kind}:${n.ref.id}`;
  return '';
}

const all = [];
const walk = (n, d) => {
  all.push({ n, d });
  n.children.forEach((c) => walk(c, d + 1));
};
walk(root, 0);

console.log('=== 全树节点锚点可解析性 ===');
let empty = 0;
for (const { n, d } of all) {
  const name = anchorName(n);
  const anchor = anchorOfNode(root, n.id);
  const ok = anchor !== null;
  if (name === '') empty++;
  console.log(
    `${' '.repeat(d * 2)}${ok ? 'OK  ' : 'FAIL'} type=${n.type} name=${JSON.stringify(name)} anchor=${JSON.stringify(anchor)}`,
  );
}
console.log(`\n总节点 ${all.length}，空锚名 ${empty}`);

console.log('\n=== collectNodeChoices 覆盖 ===');
const choices = collectNodeChoices(root);
console.log(`候选数 ${choices.length} / 非根节点 ${all.length - 1}`);
const missing = all.filter((x) => x.n.id !== root.id && !choices.some((c) => c.id === x.n.id));
if (missing.length > 0) {
  console.log('!! 未进候选的节点（无法作为连线目标）：');
  missing.forEach((x) => console.log(`   ${JSON.stringify(anchorName(x.n))} type=${x.n.type}`));
} else {
  console.log('全部非根节点均在候选中');
}

console.log('\n=== 已有边解析 ===');
const edges = collectFreeEdges(root);
console.log(`边数 ${edges.length}`);
for (const e of edges) {
  console.log(
    `  ${e.key} state=${e.state} from=${JSON.stringify(e.from)} → to=${JSON.stringify(e.to)} src=${e.sourceId ? 'OK' : 'NULL'} tgt=${e.targetId ? 'OK' : 'NULL'}`,
  );
}
