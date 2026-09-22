/**
 * S1 · summary_of 锚迁移登记（采集 / 解析 / 写回）。
 *
 * 契约：`summary_of.from / summary_of.to` 是**新的锚字段形态**（一层嵌套对象，
 * 与 sections[].root / centers[].at 并列），必须登记进既有的迁移体系：
 *  - `collectReferenceAnchors` 采集为 field `summary_of.from` / `summary_of.to`；
 *  - 编辑管线（改名/缩进/重排/剪切）触发 `planReferenceMigration` 后，**路径锚**被
 *    重写为新路径（仍 well-formed）；**cid 锚**身份稳定、原样保留即正确；
 *  - 端点被删 → 锚文本原样保留（数据无损），由解析层报 dangling（不是静默删除）。
 *
 * 迁移的判别力证据：本文件同时断言「锚文本实际被改写」与「改写后 resolveSummaries
 * 仍 well-formed」——只断言前者会漏掉「写成了另一个坏锚」。
 */
import { describe, expect, it } from 'vitest';
import {
  applyOp,
  astToEditable,
  makeTextNode,
  resolveSummaries,
  type EditableNode,
  type Note,
  type TreeOp,
} from '@mindcanvas/kernel';
import { FrameScheduler } from '../src/render/scheduler.js';
import { EditorController, collectReferenceAnchors, planCutTreeEdge } from '../src/index.js';
import type { EditorControllerOptions } from '../src/edit/controller.js';

function ast(tree: EditableNode): EditableNode {
  const built = astToEditable(tree);
  if (built === null) throw new Error('fixture broken: astToEditable returned null');
  return built;
}

/** 真实控制器（node 环境无 rAF——同步 FrameScheduler，与既有迁移用例同款） */
function makeController(root: EditableNode, opts: EditorControllerOptions = {}): EditorController {
  const frame = new FrameScheduler({
    raf: (cb) => {
      cb();
      return 1;
    },
    rafCancel: () => undefined,
  });
  return new EditorController(root, opts, frame);
}

function idOf(root: EditableNode, text: string): string {
  const found: string[] = [];
  const walk = (n: EditableNode): void => {
    if (n.text === text) found.push(n.id);
    n.children.forEach(walk);
  };
  walk(root);
  const hit = found[0];
  if (hit === undefined || found.length > 1) throw new Error(`fixture broken: ${text}`);
  return hit;
}

/** 取第 index 个子节点：显式检查替代非空断言（fixture broken 时信息更清楚） */
function childAt(node: EditableNode, index: number): EditableNode {
  const c = node.children[index];
  if (!c) throw new Error(`fixture broken: children[${index}] 缺失`);
  return c;
}

interface SummaryAnchor {
  from?: unknown;
  to?: unknown;
}

function anchorOf(root: EditableNode, summaryNodeId: string, label: string): SummaryAnchor {
  const found: EditableNode[] = [];
  const walk = (n: EditableNode): void => {
    if (n.id === summaryNodeId) found.push(n);
    n.children.forEach(walk);
  };
  walk(root);
  const node = found[0];
  if (!node) throw new Error(`fixture broken: ${label} 摘要节点丢失`);
  const raw: unknown = node.note?.summary_of;
  if (typeof raw !== 'object' || raw === null) throw new Error(`fixture broken: ${label} summary_of 形态非法`);
  return raw as SummaryAnchor;
}

function resolveById(root: EditableNode, summaryNodeId: string) {
  const r = resolveSummaries(root).find((x) => x.summaryNodeId === summaryNodeId);
  if (!r) throw new Error('fixture broken: resolveSummaries 未返回该摘要');
  return r;
}

/** 根 → [成员A, 成员B, 摘要（路径锚）] */
function makePathTree(): EditableNode {
  const root = ast(makeTextNode('根', [makeTextNode('成员A'), makeTextNode('成员B'), makeTextNode('摘要')]));
  const summary = childAt(root, 2);
  summary.note = { summary_of: { from: 'node:根/成员A', to: 'node:根/成员B' } };
  return root;
}

/** 根 → [成员A(cid=ca), 成员B(cid=cb), 摘要（cid 锚）] */
function makeCidTree(): EditableNode {
  const root = ast(makeTextNode('根', [makeTextNode('成员A'), makeTextNode('成员B'), makeTextNode('摘要')]));
  childAt(root, 0).note = { cid: 'ca' };
  childAt(root, 1).note = { cid: 'cb' };
  childAt(root, 2).note = { summary_of: { from: 'cid:ca', to: 'cid:cb' } };
  return root;
}

describe('S1 · collectReferenceAnchors 采集 summary_of', () => {
  it('路径锚被采集为 summary_of.from / summary_of.to（noteKey = 摘要节点 id）', () => {
    const root = makePathTree();
    const s = idOf(root, '摘要');
    const refs = collectReferenceAnchors(root).filter((r) => r.field.startsWith('summary_of.'));
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => ({ noteKey: r.noteKey, field: r.field, anchor: r.anchor }))).toEqual([
      { noteKey: s, field: 'summary_of.from', anchor: 'node:根/成员A' },
      { noteKey: s, field: 'summary_of.to', anchor: 'node:根/成员B' },
    ]);
  });

  it('坏形态（summary_of 非对象）不被采集，也不影响其它锚', () => {
    const root = makePathTree();
    const note: Note = { edges: [{ from: 'node:根/成员A', to: 'node:根/成员B' }] };
    // 手写 / 外部文件的非法形态：走索引签名写入（键用非字面量），零断言零 any
    const key: string = 'summary_of';
    note[key] = '坏值';
    childAt(root, 2).note = note;
    const refs = collectReferenceAnchors(root);
    expect(refs.some((r) => r.field.startsWith('summary_of.'))).toBe(false);
    expect(refs.some((r) => r.field === 'edges[0].from')).toBe(true);
  });
});

describe('S1 · 改名：路径锚重写 / cid 锚原样', () => {
  it('改名成员 → summary_of.from 重写为新路径，且 resolveSummaries 仍 well-formed', () => {
    const controller = makeController(makePathTree());
    const s = idOf(controller.root, '摘要');
    const a = idOf(controller.root, '成员A');

    expect(resolveById(controller.root, s).state).toBe('well-formed');

    controller.updateText(a, '成员A2');

    expect(anchorOf(controller.root, s, '改名后').from).toBe('node:根/成员A2');
    expect(anchorOf(controller.root, s, '改名后').to).toBe('node:根/成员B');
    expect(resolveById(controller.root, s)).toMatchObject({
      state: 'well-formed',
      memberIds: [idOf(controller.root, '成员A2'), idOf(controller.root, '成员B')],
    });
  });

  it('cid 锚在改名后原样保留（身份稳定，无需改写）', () => {
    const controller = makeController(makeCidTree());
    const s = idOf(controller.root, '摘要');
    const a = idOf(controller.root, '成员A');

    controller.updateText(a, '成员A2');

    expect(anchorOf(controller.root, s, 'cid 改名后')).toEqual({ from: 'cid:ca', to: 'cid:cb' });
    expect(resolveById(controller.root, s)).toMatchObject({ state: 'well-formed' });
  });

  it('改名父级 → 两条锚一起跟随新路径（批量端到端）', () => {
    // 根 → [甲 → [成员A, 成员B, 摘要]]：三者同父，锚 = 甲/成员A … 甲/成员B
    const root = ast(
      makeTextNode('根', [
        makeTextNode('甲', [makeTextNode('成员A'), makeTextNode('成员B'), makeTextNode('摘要')]),
      ]),
    );
    childAt(childAt(root, 0), 2).note = {
      summary_of: { from: 'node:根/甲/成员A', to: 'node:根/甲/成员B' },
    };
    const controller = makeController(root);
    const s = idOf(controller.root, '摘要');
    const jia = idOf(controller.root, '甲');

    expect(resolveById(controller.root, s).state).toBe('well-formed');
    controller.updateText(jia, '甲2');

    // 两条锚都必须跟随（只改一条会让区间跨父）
    expect(anchorOf(controller.root, s, '改名父级后').from).toBe('node:根/甲2/成员A');
    expect(anchorOf(controller.root, s, '改名父级后').to).toBe('node:根/甲2/成员B');
    expect(resolveById(controller.root, s).state).toBe('well-formed');
  });

  it('成员被反缩进移出范围 → 锚文本跟随新路径，但结构跨父 → dangling（可见、可解释、数据不丢）', () => {
    const root = ast(
      makeTextNode('根', [
        makeTextNode('甲', [makeTextNode('成员A'), makeTextNode('成员B'), makeTextNode('摘要')]),
      ]),
    );
    childAt(childAt(root, 0), 2).note = {
      summary_of: { from: 'node:根/甲/成员A', to: 'node:根/甲/成员B' },
    };
    const controller = makeController(root);
    const s = idOf(controller.root, '摘要');
    const a = idOf(controller.root, '成员A');

    expect(controller.outdent(a)).toBe(true);

    // 引用层仍被迁移到新路径（锚不丢），但成员不再同父 → 解析层如实报 dangling
    expect(anchorOf(controller.root, s, '反缩进后').from).toBe('node:根/成员A');
    expect(anchorOf(controller.root, s, '反缩进后').to).toBe('node:根/甲/成员B');
    expect(resolveById(controller.root, s)).toMatchObject({
      state: 'dangling',
      reason: 'from-not-same-parent',
    });
  });
});

describe('S1 · 剪切 / 接回：含摘要子树的批量迁移', () => {
  it('planCutTreeEdge 把摘要子树整体搬到根 → from/to 重写为新路径且仍 well-formed', () => {
    const root = ast(
      makeTextNode('根', [
        makeTextNode('甲', [makeTextNode('区', [makeTextNode('成员A'), makeTextNode('成员B'), makeTextNode('摘要')])]),
      ]),
    );
    const qu = idOf(root, '区');
    const s = idOf(root, '摘要');
    childAt(childAt(childAt(root, 0), 0), 2).note = {
      summary_of: { from: 'node:根/甲/区/成员A', to: 'node:根/甲/区/成员B' },
    };

    const plan = planCutTreeEdge(root, qu);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    let after: EditableNode = root;
    for (const op of plan.ops as TreeOp[]) after = applyOp(after, op);

    expect(anchorOf(after, s, '切后')).toEqual({
      from: 'node:根/区/成员A',
      to: 'node:根/区/成员B',
    });
    expect(resolveById(after, s).state).toBe('well-formed');
    // 迁移 op 与前缀结构 op 同批（单条 undo 的前提）
    expect(plan.ops.some((op) => op.type === 'move-node')).toBe(true);
    expect(plan.ops.some((op) => op.type === 'update-node' && op.id === s)).toBe(true);
  });

  it('迁移幂等：对迁移后的树再跑一次迁移 → 零 updates', () => {
    const root = ast(
      makeTextNode('根', [
        makeTextNode('甲', [makeTextNode('区', [makeTextNode('成员A'), makeTextNode('成员B'), makeTextNode('摘要')])]),
      ]),
    );
    const qu = idOf(root, '区');
    childAt(childAt(childAt(root, 0), 0), 2).note = {
      summary_of: { from: 'node:根/甲/区/成员A', to: 'node:根/甲/区/成员B' },
    };
    const plan = planCutTreeEdge(root, qu);
    if (!plan.ok) throw new Error('fixture broken: cut 被拒');
    let after: EditableNode = root;
    for (const op of plan.ops as TreeOp[]) after = applyOp(after, op);

    // 同一集合再迁移一次：锚文本已是最新 → 不产出任何 update
    const again = collectReferenceAnchors(after).filter((r) => r.field.startsWith('summary_of.'));
    expect(again).toHaveLength(2);
    expect(again.map((r) => r.anchor)).toEqual(['node:根/区/成员A', 'node:根/区/成员B']);
  });
});

describe('S1 · 端点被删：锚不被静默删除（数据无损）', () => {
  it('删除 from 端点成员 → summary_of 原值保留，解析层报 dangling', () => {
    const controller = makeController(makePathTree());
    const s = idOf(controller.root, '摘要');
    const a = idOf(controller.root, '成员A');

    controller.removeNode(a);

    // 元数据保留（不是静默删除）——由解析层给出可解释的三态
    expect(anchorOf(controller.root, s, '删端点后').from).toBe('node:根/成员A');
    expect(resolveById(controller.root, s)).toMatchObject({
      state: 'dangling',
      reason: 'from-not-found',
    });
  });
});
