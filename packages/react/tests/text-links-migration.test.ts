/**
 * L2：文本区域链接纳入锚迁移（span 级 field + 右→左替换）。
 *
 * 契约（派遣计划 §3 L2）：
 *  - collectReferenceAnchors 增扫 desc / note[i] / note_text / qa[i] 内的链接
 *    （field 形如 `desc#0` / `note[2]#1` / `note_text#0`）；
 *  - 改名 / 切搬后：路径锚 → 新路径（经 R1-1 管线自动迁移）；`cid:` 锚原样保留；
 *  - 同一字段多处替换从右往左（防位移）——同字段两条链接同时迁移的判别；
 *  - 坏锚（本来就 dangling）保留原值、不阻断其他迁移；非链接形态原样不动。
 */
import { describe, expect, it } from 'vitest';
import { applyOp, astToEditable, makeTextNode, type EditableNode } from '@mindcanvas/kernel';
import { FrameScheduler } from '../src/render/scheduler.js';
import { EditorController, planCutTreeEdge } from '../src/index.js';

function ast(tree: EditableNode): EditableNode {
  const built = astToEditable(tree);
  if (built === null) throw new Error('fixture broken: astToEditable returned null');
  return built;
}

/** 真实控制器（node 环境无 rAF——同步 FrameScheduler，与 controller-anchor-migration 同款） */
function makeController(root: EditableNode): EditorController {
  const frame = new FrameScheduler({
    raf: (cb) => {
      cb();
      return 1;
    },
    rafCancel: () => undefined,
  });
  return new EditorController(root, {}, frame);
}

function idOf(root: EditableNode, text: string): EditableNode {
  const found: EditableNode[] = [];
  const walk = (n: EditableNode): void => {
    if (n.text === text) found.push(n);
    n.children.forEach(walk);
  };
  walk(root);
  const hit = found[0];
  if (hit === undefined || found.length > 1) throw new Error(`fixture broken: ${text}`);
  return hit;
}

/** 树：根 → [任务 → [A（cid:c-a）, K3], 生活] */
function makeTree(): EditableNode {
  const root = ast(
    makeTextNode('根', [
      makeTextNode('任务', [makeTextNode('A'), makeTextNode('K3')]),
      makeTextNode('生活'),
    ]),
  );
  const a = idOf(root, 'A');
  a.note = { ...(a.note ?? {}), cid: 'c-a' };
  return root;
}

describe('L2 · 文本链接迁移：改名（R1-1 管线自动迁移）', () => {
  it('desc / note[0] / note_text 内路径锚随新路径迁移；cid: 锚原样保留', () => {
    const root = makeTree();
    root.note = {
      desc: '看 [名](node:根/任务/A) 与 [稳](cid:c-a)',
      note: ['条目 [去B](node:根/任务/A)'],
      note_text: '正文 [去C](node:根/任务/A)',
    };
    const controller = makeController(root);
    controller.updateText(idOf(controller.root, 'A').id, 'A2');

    expect(controller.root.note?.desc).toBe('看 [名](node:根/任务/A2) 与 [稳](cid:c-a)');
    expect(controller.root.note?.note?.[0]).toBe('条目 [去B](node:根/任务/A2)');
    expect(controller.root.note?.note_text).toBe('正文 [去C](node:根/任务/A2)');
  });

  it('同字段两条链接同时迁移（父改名；替换从右往左防位移）', () => {
    const root = makeTree();
    root.note = { desc: '乙 [e2](node:根/任务/K3) 与 甲 [e1](node:根/任务/A)' };
    const controller = makeController(root);
    controller.updateText(idOf(controller.root, '任务').id, '任务2');

    expect(controller.root.note?.desc).toBe(
      '乙 [e2](node:根/任务2/K3) 与 甲 [e1](node:根/任务2/A)',
    );
  });

  it('回归钉：本来就是 dangling 的锚保留原值、不阻断其他锚迁移', () => {
    const root = makeTree();
    root.note = { desc: '坏 [x](node:根/不存在) 好 [y](node:根/生活)' };
    const controller = makeController(root);
    controller.updateText(idOf(controller.root, '生活').id, '生活2');

    expect(controller.root.note?.desc).toBe('坏 [x](node:根/不存在) 好 [y](node:根/生活2)');
  });

  it('非链接形态不受迁移影响（[已归档] / 裸 (node:x) 原样保留）', () => {
    const root = makeTree();
    root.note = { desc: '[已归档] 说 (node:根/X) 但 [y](node:根/生活)' };
    const controller = makeController(root);
    controller.updateText(idOf(controller.root, '生活').id, '生活2');

    expect(controller.root.note?.desc).toBe('[已归档] 说 (node:根/X) 但 [y](node:根/生活2)');
  });
});

describe('L2 · 文本链接迁移：切搬（planCutTreeEdge）', () => {
  it('切断 A：desc 内指向 A 的锚迁移为根下新路径', () => {
    const root = makeTree();
    root.note = { desc: '去 [x](node:根/任务/A)' };
    const aId = idOf(root, 'A').id;
    const plan = planCutTreeEdge(root, aId);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    let cur = root;
    for (const op of plan.ops) cur = applyOp(cur, op);
    expect(cur.note?.desc).toBe('去 [x](node:根/A)');
  });
});
