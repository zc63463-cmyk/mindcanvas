import { makeTextNode, makeEntityNode } from '@mindcanvas/kernel';
import { anchorOfNode, collectFreeEdges } from '@mindcanvas/react';

// 场景：用户把一个中间节点的文字删空（inline 编辑清空后提交）
// 其下子树是否还能被连线寻址？
const root = makeTextNode('根', [
  makeTextNode('中间节点', [makeTextNode('子A'), makeTextNode('子B')]),
  makeTextNode('源'),
]);

const mid = root.children[0];
const childA = mid.children[0];
const childB = mid.children[1];
const source = root.children[1];

const from = anchorOfNode(root, source.id);
const to = anchorOfNode(root, childB.id);
console.log('清空前：');
console.log('  anchorOfNode(子B) =', to);
root.note = { edges: [{ from, to, rel: 'relates-to' }] };
console.log('  边解析 targetId 命中子B:', collectFreeEdges(root)[0].targetId === childB.id);

// 现在把中间节点文字清空
mid.text = '';
console.log('\n清空「中间节点」文字后：');
console.log('  anchorOfNode(子A) =', anchorOfNode(root, childA.id));
console.log('  anchorOfNode(子B) =', anchorOfNode(root, childB.id));
root.note = { edges: [{ from, to, rel: 'relates-to' }] };
const e = collectFreeEdges(root)[0];
console.log('  边解析 targetId 命中子B:', e.targetId === childB.id, '| state =', e.state);
console.log('  结果 =', e.targetId === childB.id ? '仍可寻址' : '子树不可寻址 —— 已有边退化为悬空');

// 子树的兄弟节点是否仍可寻址（验证是否是整棵子树失效）
const otherAnchor = anchorOfNode(root, childA.id);
console.log('\n  同层子A 锚 =', otherAnchor, '（null 表示整棵子树丢失）');

// 关键：清空后【新建】的边能否寻址？（旧边 dangling 是语义正确——节点确实改名了）
const newTo = anchorOfNode(root, childB.id);
root.note = { edges: [{ from, to: newTo, rel: 'relates-to' }] };
const e2 = collectFreeEdges(root)[0];
console.log('\n清空后【新建】边（锚 =', newTo, '）：');
console.log('  targetId 命中子B:', e2.targetId === childB.id, '| state =', e2.state);
console.log(
  '  结果 =',
  e2.targetId === childB.id ? '子树可寻址 —— 已修复' : '仍不可寻址 —— 未修复',
);
