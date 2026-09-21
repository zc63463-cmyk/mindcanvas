import { makeTextNode, makeEntityNode } from '@mindcanvas/kernel';
import { anchorOfNode, collectFreeEdges } from '@mindcanvas/react';

// 同一实体 @issue:8 出现在两个分支 —— 检验边能否锚定到「用户选中的那一个」
const root = makeTextNode('根', [
  makeTextNode('分支A', [makeEntityNode({ kind: 'issue', id: '8' })]),
  makeTextNode('分支B', [makeEntityNode({ kind: 'issue', id: '8' })]),
  makeTextNode('源'),
]);

const first = root.children[0].children[0];
const second = root.children[1].children[0];
const source = root.children[2];

console.log('分支A 的 @issue:8  nodeId =', first.id);
console.log('分支B 的 @issue:8  nodeId =', second.id);
console.log('anchorOfNode(第一个) =', anchorOfNode(root, first.id));
console.log('anchorOfNode(第二个) =', anchorOfNode(root, second.id));

const from = anchorOfNode(root, source.id);
const to = anchorOfNode(root, second.id); // 用户连到「分支B」那个
root.note = { edges: [{ from, to, rel: 'relates-to' }] };

const [e] = collectFreeEdges(root);
console.log('\n用户连到「分支B」的 @issue:8：');
console.log('  期望 targetId =', second.id, '(分支B)');
console.log('  实际 targetId =', e.targetId);
console.log('  结果 =', e.targetId === second.id ? '正确锚定' : '错锚到分支A —— 歧义 BUG');
