/**
 * A5（G2）：切断树边 / 接回子树——领域命令测试（T13/T14/T19/T20 相关断言）。
 *
 * 命令产出 TreeOp[]，全部经 kernel applyOp 模拟应用 + OpHistory.applyTransaction
 * 原子提交语义验证（一条 history 记录、失败零副作用）。
 */
import { describe, expect, it } from 'vitest';
import {
  applyOp,
  astToEditable,
  editableToAst,
  makeEntityNode,
  makeTextNode,
  OpHistory,
  parseMm,
  resolveLinkAnchor,
  serializeMm,
  type EditableNode,
} from '@mindcanvas/kernel';
import {
  collectCenters,
  collectReferenceAnchors,
  MAX_NODE_DEPTH,
  planAttachIsland,
  planCutTreeEdge,
  subtreeMaxDepth,
  summarizeReferenceDiagnostics,
} from '../src/index.js';

function makeTree(): EditableNode {
  return astToEditable(
    makeTextNode('根', [
      makeTextNode('任务', [makeTextNode('K3', [makeTextNode('K3子')])]),
      makeTextNode('生活'),
    ]),
  )!;
}

function idOf(root: EditableNode, text: string): string {
  const found = root.children.flatMap((c) => [c, ...c.children]).find((n) => n.text === text);
  if (found) return found.id;
  if (root.text === text) return root.id;
  throw new Error(`node not found: ${text}`);
}

/** 事务语义封装（与 controller.applyTransaction 同构：一次 history、失败零副作用） */
function applyTx(history: OpHistory, ops: Parameters<OpHistory['applyTransaction']>[0]) {
  return history.applyTransaction(ops);
}

describe('A5 planCutTreeEdge（T13：切断深层边）', () => {
  it('切断 任务→K3：K3 移为根末尾直接分支 + detached 标记 + 子树保留', () => {
    const root = makeTree();
    const k3 = idOf(root, 'K3');
    const plan = planCutTreeEdge(root, k3);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    // 事务提交（原子）
    const history = new OpHistory(root);
    const result = applyTx(history, plan.ops);
    expect(result).toEqual({ ok: true, applied: plan.ops.length });
    const after = history.current;

    // 结构：K3 移为根直接子（末尾），子树 K3子 保留
    const k3Node = after.children.find((n) => n.text === 'K3');
    expect(k3Node).toBeDefined();
    expect(k3Node!.children.map((n) => n.text)).toEqual(['K3子']);
    expect(after.children[after.children.length - 1]!.text).toBe('K3');
    // 原父收紧：任务不再含 K3
    const task = after.children.find((n) => n.text === '任务')!;
    expect(task.children.map((n) => n.text)).not.toContain('K3');

    // detached 标记（centers，at 已迁移为新锚 node:根/K3）
    const centers = collectCenters(after).filter((c) => c.detached);
    expect(centers).toHaveLength(1);
    expect(centers[0]!.nodeId).toBe(k3Node!.id);
    expect(centers[0]!.state).toBe('well-formed');

    // 一条 history 记录（批次）→ undo 完整恢复
    expect(history.canUndo()).toBe(true);
    const undone = history.undo()!;
    expect(undone.children.find((n) => n.text === '任务')!.children.map((n) => n.text)).toContain('K3');
    expect(undone.children.find((n) => n.text === 'K3')).toBeUndefined();
  });

  it('引用迁移：指向 K3 的文档级边在切断后更新为新锚', () => {
    const root = makeTree();
    const k3 = idOf(root, 'K3');
    root.note = {
      ...root.note,
      edges: [{ from: 'node:根/生活', to: 'node:根/任务/K3', rel: 'relates-to' }],
    };
    const plan = planCutTreeEdge(root, k3);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const history = new OpHistory(root);
    expect(applyTx(history, plan.ops).ok).toBe(true);
    const after = history.current;

    const edge = after.note?.edges as Array<{ from: string; to: string }>;
    expect(edge[0]!.to).toBe('node:根/K3');
    // 迁移后锚解析回同一物理节点（新树上的 K3）
    const k3New = after.children.find((n) => n.text === 'K3')!;
    const res = resolveLinkAnchor(after, { kind: 'node', target: edge[0]!.to.slice(5) });
    expect(res.state).toBe('well-formed');
    expect(res.nodeId).toBe(k3New.id);
  });

  it('拒绝：根不可切、已 detached 不可再切、深度超限', () => {
    const root = makeTree();
    const rootId = root.id;
    expect(planCutTreeEdge(root, rootId)).toMatchObject({
      ok: false,
      error: { code: 'is-root' },
    });

    // 已 detached（先切一次再切同节点）
    const k3 = idOf(root, 'K3');
    const first = planCutTreeEdge(root, k3);
    if (first.ok) {
      const history = new OpHistory(root);
      history.applyTransaction(first.ops);
      const after = history.current;
      const k3After = after.children.find((n) => n.text === 'K3')!.id;
      expect(planCutTreeEdge(after, k3After)).toMatchObject({
        ok: false,
        error: { code: 'already-detached' },
      });
    }

    // 深度超限：切「中」——子树相对深度 6（链条1→L1 2→…→叶5 6），切后最深 1+6=7 > 5 → 拒绝
    let deep = makeTextNode('叶5');
    for (let i = 4; i >= 1; i--) deep = makeTextNode(`L${i}`, [deep]);
    const deeper = astToEditable(makeTextNode('根', [makeTextNode('中', [makeTextNode('链条', [deep])])]))!;
    expect(subtreeMaxDepth(deeper.children[0]!)).toBeGreaterThan(MAX_NODE_DEPTH - 1);
    expect(planCutTreeEdge(deeper, deeper.children[0]!.id)).toMatchObject({
      ok: false,
      error: { code: 'depth-limit' },
    });
    // 对照：同一深链中的叶子（子树相对深度 0）可切——约束只看子树深度，不看当前深度
    const leafInDeeper = (() => {
      let n = deeper.children[0]!;
      while (n.children.length > 0) n = n.children[0]!;
      return n.id;
    })();
    expect(planCutTreeEdge(deeper, leafInDeeper).ok).toBe(true);
  });
});

describe('A5 planAttachIsland（T19/T20：接回）', () => {
  function detachedTree(): { root: EditableNode; k3: string } {
    const root = makeTree();
    const k3 = idOf(root, 'K3');
    const plan = planCutTreeEdge(root, k3);
    if (!plan.ok) throw new Error('fixture cut failed');
    const history = new OpHistory(root);
    history.applyTransaction(plan.ops);
    const after = history.current;
    return { root: after, k3: after.children.find((n) => n.text === 'K3')!.id };
  }

  it('detached 中心可接回目标父节点：结构恢复 + detached 清除 + 坐标进历史区', () => {
    const { root, k3 } = detachedTree();
    // 先给 K3 坐标（模拟用户摆放过）
    const withPos = applyOp(root, {
      type: 'update-node',
      id: root.id,
      patch: {
        note: {
          ...(root.note ?? {}),
          centers: [
            { at: 'node:根/K3', dir: 'right', x: 250, y: 80, detached: true },
          ],
        },
      },
    });
    const k3Id = withPos.children.find((n) => n.text === 'K3')!.id;
    const lifeId = withPos.children.find((n) => n.text === '生活')!.id;

    const plan = planAttachIsland(withPos, k3Id, lifeId);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const history = new OpHistory(withPos);
    expect(applyTx(history, plan.ops).ok).toBe(true);
    const after = history.current;

    // 结构：K3 挂到 生活 末尾
    const life = after.children.find((n) => n.text === '生活')!;
    expect(life.children.map((n) => n.text)).toContain('K3');
    // detached 清除（centers 无该条目）
    expect(collectCenters(after).find((c) => c.nodeId !== null && c.detached)).toBeUndefined();
    // 坐标进历史区（再升格吸附回原位）
    const history_ = (after.note?.center_pos ?? []) as Array<{ at: string; x: number }>;
    expect(history_.some((e) => e.at === 'node:根/K3' && e.x === 250)).toBe(true);
  });

  it('拒绝：接自身、接自身子树（成环）、深度超限、目标非 detached', () => {
    const { root, k3 } = detachedTree();
    const k3Child = root.children.find((n) => n.text === 'K3')!.children[0]!.id;
    expect(planAttachIsland(root, k3, k3)).toMatchObject({
      ok: false,
      error: { code: 'attach-to-self' },
    });
    expect(planAttachIsland(root, k3, k3Child)).toMatchObject({
      ok: false,
      error: { code: 'attach-to-descendant' },
    });
    // 深度超限：链条挂根上是 d1（d4 深度 4）+ K3 子树相对深度 1 + 1 = 6 > 5 → 拒绝
    let deep = makeTextNode('d4');
    deep = makeTextNode('d3', [deep]);
    deep = makeTextNode('d2', [deep]);
    deep = makeTextNode('d1', [deep]);
    const deepTree = applyOp(root, {
      type: 'add-child',
      parentId: root.id,
      child: deep,
    });
    const d1 = deepTree.children.find((n) => n.text === 'd1')!;
    const d4 = d1.children[0]!.children[0]!.children[0]!.id;
    expect(planAttachIsland(deepTree, k3, d4)).toMatchObject({
      ok: false,
      error: { code: 'depth-limit' },
    });
    // 非 detached：普通节点不可「接回」
    const lifeId = root.children.find((n) => n.text === '生活')!.id;
    expect(planAttachIsland(root, lifeId, root.id)).toMatchObject({
      ok: false,
      error: { code: 'not-detached' },
    });
  });

  it('T21 保存重开：detached 中心经 .mm.md 序列化往返后角色/坐标/连接状态一致', () => {
    const root = makeTree();
    const k3 = idOf(root, 'K3');
    const plan = planCutTreeEdge(root, k3, { pos: { x: 250, y: 80 } });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const history = new OpHistory(root);
    history.applyTransaction(plan.ops);
    const after = history.current;

    // 保存 → 重新 parse（id 全部重建，路径锚是唯一持久事实）
    const source = serializeMm(editableToAst(after));
    const reopened = astToEditable(parseMm(source).root)!;

    const centers = collectCenters(reopened).filter((c) => c.detached);
    expect(centers).toHaveLength(1);
    expect(centers[0]!.at).toBe('node:根/K3');
    expect(centers[0]!.state).toBe('well-formed');
    expect(centers[0]!.pos).toEqual({ x: 250, y: 80 });
    // 新 id 树上接回语义依旧成立
    const k3New = reopened.children.find((n) => n.text === 'K3')!.id;
    const lifeNew = reopened.children.find((n) => n.text === '生活')!.id;
    expect(planAttachIsland(reopened, k3New, lifeNew).ok).toBe(true);
  });
});

describe('A5 引用收集（collectReferenceAnchors）', () => {
  it('盘点 centers/center_pos/edges/links/groups 全清单', () => {
    const root = makeTree();
    root.note = {
      ...(root.note ?? {}),
      centers: [{ at: 'node:根/生活', dir: 'right' }],
      center_pos: [{ at: 'node:根/生活', x: 1, y: 2 }],
      edges: [{ from: 'node:根/生活', to: 'node:根/任务', rel: 'relates-to' }],
      groups: [{ id: 'g1', members: ['node:根/任务/K3'] }],
    };
    const k3 = root.children[0]!.children[0]!;
    k3.note = { links: [{ to: 'node:根/生活', rel: 'relates-to' }] } as never;
    const refs = collectReferenceAnchors(root);
    const fields = refs.map((r) => r.field);
    expect(fields).toContain('centers[0].at');
    expect(fields).toContain('center_pos[0].at');
    expect(fields).toContain('edges[0].from');
    expect(fields).toContain('edges[0].to');
    expect(fields).toContain('groups[0].members[0]');
    expect(fields).toContain('links[0].to');
  });

  it('v1.5.0：sections[].root 进入迁移盘点清单（cid 与 node: 两种锚都覆盖）', () => {
    const root = makeTree();
    root.note = {
      ...(root.note ?? {}),
      sections: [
        { id: 'sec_a', root: 'cid:c-work', color: 'blue' },
        { id: 'sec_b', root: 'node:根/任务' },
      ],
    };
    const refs = collectReferenceAnchors(root);
    const fields = refs.map((r) => r.field);
    expect(fields).toContain('sections[0].root');
    expect(fields).toContain('sections[1].root');
    const cidRef = refs.find((r) => r.field === 'sections[0].root')!;
    const pathRef = refs.find((r) => r.field === 'sections[1].root')!;
    expect(cidRef.anchor).toBe('cid:c-work');
    expect(pathRef.anchor).toBe('node:根/任务');
  });

  it('L2：文本字段内的链接进入盘点清单（span 级 field，按出现顺序编号）', () => {
    const root = makeTree();
    root.note = {
      ...(root.note ?? {}),
      desc: '前 [去A](node:根/生活) 后',
      note: ['条 [去C](node:根/任务)'],
      note_text: '文 [去B](node:根/生活)',
      qa: ['旧 [去D](node:根/任务/K3)'],
    };
    const refs = collectReferenceAnchors(root);
    const byField = new Map(refs.map((r) => [r.field, r.anchor]));
    expect(byField.get('desc#0')).toBe('node:根/生活');
    expect(byField.get('note[0]#0')).toBe('node:根/任务');
    expect(byField.get('note_text#0')).toBe('node:根/生活');
    expect(byField.get('qa[0]#0')).toBe('node:根/任务/K3');
  });

  it('L2：同字段多链接的 span 序号按出现顺序（desc#0 / desc#1）', () => {
    const root = makeTree();
    root.note = { ...(root.note ?? {}), desc: '[一](node:根/生活) 和 [二](node:根/任务)' };
    const refs = collectReferenceAnchors(root);
    const byField = new Map(refs.map((r) => [r.field, r.anchor]));
    expect(byField.get('desc#0')).toBe('node:根/生活');
    expect(byField.get('desc#1')).toBe('node:根/任务');
  });
});

describe('A5 引用迁移诊断上报（R0-4）', () => {
  it('切断：旧文件已有 dangling 边 → diagnostics 非空（dangling-kept）且不阻断提交', () => {
    const root = makeTree();
    // 旧文件遗留：指向不存在节点的边（迁移前即失效，非本次切断造成）
    root.note = { edges: [{ from: 'node:根/任务', to: 'node:根/不存在', rel: 'relates-to' }] };
    const k3 = idOf(root, 'K3');
    const plan = planCutTreeEdge(root, k3);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'dangling-kept',
        field: 'edges[0].to',
        anchor: 'node:根/不存在',
      }),
    );
    // 不阻断：结构移动仍在 ops 中，事务可提交
    expect(plan.ops.some((op) => op.type === 'move-node')).toBe(true);
  });

  it('切断：旧文件已有歧义实体锚 → pre-existing-ambiguous', () => {
    const built = astToEditable(
      makeTextNode('根', [
        makeTextNode('任务', [makeTextNode('K3', [makeTextNode('K3子')])]),
        makeEntityNode({ kind: 'issue', id: '8' }),
        makeEntityNode({ kind: 'issue', id: '8' }),
      ]),
    );
    if (built === null) throw new Error('fixture broken: astToEditable returned null');
    const root = built;
    root.note = { edges: [{ from: 'node:根/任务', to: '@issue:8', rel: 'relates-to' }] };
    const k3 = idOf(root, 'K3');
    const plan = planCutTreeEdge(root, k3);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'pre-existing-ambiguous', anchor: '@issue:8' }),
    );
  });

  it('summarizeReferenceDiagnostics：空 → null；多码聚合一行，语义=「本来就是坏」', () => {
    expect(summarizeReferenceDiagnostics([])).toBeNull();
    const one = summarizeReferenceDiagnostics([
      {
        code: 'dangling-kept',
        noteKey: 'n1',
        field: 'edges[0].to',
        anchor: 'node:根/不存在',
        message: 'x',
      },
    ]);
    expect(one).toContain('1 条');
    expect(one).toContain('本来就是坏');
    const mixed = summarizeReferenceDiagnostics([
      { code: 'dangling-kept', noteKey: 'n1', field: 'edges[0].to', anchor: 'a' },
      { code: 'dangling-kept', noteKey: 'n2', field: 'edges[1].to', anchor: 'b' },
      { code: 'pre-existing-ambiguous', noteKey: 'n3', field: 'edges[2].to', anchor: 'c' },
    ]);
    expect(mixed).toContain('3 条');
    expect(mixed).toContain('dangling-kept ×2');
    expect(mixed).toContain('pre-existing-ambiguous ×1');
  });
});
