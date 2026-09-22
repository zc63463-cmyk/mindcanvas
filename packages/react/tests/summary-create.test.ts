/**
 * S2 · 摘要创建事务（`planCreateSummary` / `createSummary`）。
 *
 * 契约（计划 §2 S2 + 本包任务书 §四）：
 *  - `planCreateSummary` 是**纯函数**，返回明确成功或可解释失败（不抛、不改入参）；
 *  - 校验顺序：两端存在 → 两端非根 → **同一父级** → from 在 to 之前 → 摘要节点不自包含；
 *  - ops 形状（稳定可审计顺序）：
 *      ① 需要时 update root（next_cid bump）
 *      ② 需要时 update from / to（**仅缺失才补 cid**）
 *      ③ add-child(共同父, S, index = to.index + 1)
 *  - 新摘要节点：`newId()`、默认文本「摘要」、note 写 `summary_of: {from, to}`；
 *  - 单条 `applyTransaction` 提交 → **单条 undo 完整回滚**（含 cid 补发）；
 *  - 事务失败 → 树 / cid / 选择**零部分变化**。
 *
 * 判别力说明：本文件同时断言「合法用例成功」与「非法用例失败且零写入」。
 * 只断言前者会漏掉「守卫形同虚设但仍返回 ok」的实现（见 ndjson 阴性对照）。
 */
import { describe, expect, it } from 'vitest';
import {
  astToEditable,
  getNode,
  makeTextNode,
  parseMm,
  resolveSummaries,
  summaryOf,
  type EditableNode,
  type SummarySpec,
  type TreeOp,
} from '@mindcanvas/kernel';
import { EditorController } from '../src/edit/controller.js';
import type { EditorControllerOptions } from '../src/edit/controller.js';
import {
  createSummary,
  mergeSummaryOf,
  planCreateSummary,
  summaryOfNode,
  type SummaryPlanError,
} from '../src/edit/summaryCommands.js';
import { FrameScheduler } from '../src/render/scheduler.js';

/* ────────────────────────── 夹具 ────────────────────────── */

function ast(tree: EditableNode): EditableNode {
  const built = astToEditable(tree);
  if (built === null) throw new Error('fixture broken: astToEditable returned null');
  return built;
}

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

function childAt(node: EditableNode, index: number): EditableNode {
  const c = node.children[index];
  if (!c) throw new Error(`fixture broken: no child at ${index}`);
  return c;
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

/**
 * 标准夹具：根下 5 个兄弟（A B C D E），另有一个跨父节点 F（挂在 A 下）。
 * 覆盖：同父区间 / 跨父 / 末位 / 中间位。
 */
function fixture(tree?: EditableNode): EditableNode {
  return ast(
    tree ?? {
      id: 'r',
      type: 'text',
      text: '根',
      children: [
        {
          id: 'a',
          type: 'text',
          text: 'A',
          children: [{ id: 'f', type: 'text', text: 'F', children: [] }],
        },
        { id: 'b', type: 'text', text: 'B', children: [] },
        { id: 'c', type: 'text', text: 'C', children: [] },
        { id: 'd', type: 'text', text: 'D', children: [] },
        { id: 'e', type: 'text', text: 'E', children: [] },
      ],
    },
  );
}

/** 树快照：结构与 note 的规范化串（用于「零部分变化」逐位断言） */
function snapshot(root: EditableNode): string {
  return JSON.stringify(root, (_k, v) => (v === undefined ? '__undef__' : v));
}

function widened(plan: { ok: boolean }): { ok: false; error: SummaryPlanError } {
  if (plan.ok !== false) throw new Error('expected a rejected plan');
  return plan as { ok: false; error: SummaryPlanError };
}

/** 从 ops 里取出唯一/指定的 update-node（窄化类型，免去逐处 undefined 检查） */
function updateOp(ops: readonly TreeOp[], id: string): Extract<TreeOp, { type: 'update-node' }> {
  const found = ops.find(
    (o): o is Extract<TreeOp, { type: 'update-node' }> => o.type === 'update-node' && o.id === id,
  );
  if (!found) throw new Error(`expected update-node for ${id}`);
  return found;
}

/** 从 ops 里取出 add-child（窄化类型） */
function addChildOp(ops: readonly TreeOp[]): Extract<TreeOp, { type: 'add-child' }> {
  const found = ops.find((o): o is Extract<TreeOp, { type: 'add-child' }> => o.type === 'add-child');
  if (!found) throw new Error('expected add-child');
  return found;
}

/* ────────────────────── plan：失败矩阵 ────────────────────── */

describe('planCreateSummary · 拒绝路径（明确失败 + 零副作用）', () => {
  it('fromId 不存在 → not-found，且不产生 ops', () => {
    const root = fixture();
    const plan = planCreateSummary(root, 'ghost', idOf(root, 'C'));
    const rej = widened(plan);
    expect(rej.error.code).toBe('not-found');
    expect('ops' in rej).toBe(false);
  });

  it('toId 不存在 → not-found', () => {
    const root = fixture();
    const plan = planCreateSummary(root, idOf(root, 'A'), 'ghost');
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.error.code).toBe('not-found');
  });

  it('from 为根 → is-root', () => {
    const root = fixture();
    const plan = planCreateSummary(root, root.id, idOf(root, 'C'));
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.error.code).toBe('is-root');
  });

  it('to 为根 → is-root', () => {
    const root = fixture();
    const plan = planCreateSummary(root, idOf(root, 'A'), root.id);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.error.code).toBe('is-root');
  });

  it('跨父（A 与 F 不同父）→ not-same-parent（阴性对照的判别点）', () => {
    const root = fixture();
    const plan = planCreateSummary(root, idOf(root, 'A'), idOf(root, 'F'));
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.error.code).toBe('not-same-parent');
  });

  it('倒序（C 在 B 之前）→ reversed', () => {
    const root = fixture();
    const plan = planCreateSummary(root, idOf(root, 'C'), idOf(root, 'B'));
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.error.code).toBe('reversed');
  });

  it('from === to 单成员区间 → 合法（S1 契约：单成员合法）', () => {
    const root = fixture();
    const plan = planCreateSummary(root, idOf(root, 'C'), idOf(root, 'C'));
    expect(plan.ok).toBe(true);
  });

  it('拒绝路径不修改传入树（纯函数）', () => {
    const root = fixture();
    const before = snapshot(root);
    planCreateSummary(root, idOf(root, 'A'), idOf(root, 'F'));
    planCreateSummary(root, 'ghost', idOf(root, 'C'));
    expect(snapshot(root)).toBe(before);
  });
});

/* ────────────────────── plan：成功形状 ────────────────────── */

describe('planCreateSummary · 成功形状（ops 稳定且可审计）', () => {
  it('合法同父范围：index = to.index + 1，单事务三件套', () => {
    const root = fixture();
    const plan = planCreateSummary(root, idOf(root, 'A'), idOf(root, 'C'));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    // ops 顺序：update root(next_cid) → update from → update to → add-child
    const kinds = plan.ops.map((o) => `${o.type}:${'id' in o ? o.id : o.parentId}`);
    expect(kinds).toEqual([
      `update-node:${root.id}`,
      `update-node:${idOf(root, 'A')}`,
      `update-node:${idOf(root, 'C')}`,
      `add-child:${root.id}`,
    ]);

    const add = addChildOp(plan.ops);
    expect(add.index).toBe(3); // C 是 index 2 → 插到 3
    expect(add.child.id).toBe(plan.summaryId);
    expect(add.child.text).toBe('摘要');
    expect(summaryOf(add.child.note)).toEqual({
      from: `cid:${plan.fromCid}`,
      to: `cid:${plan.toCid}`,
    });
  });

  it('to 为末位成员时插到末尾（index = to.index + 1 = 长度）', () => {
    const root = fixture();
    const plan = planCreateSummary(root, idOf(root, 'D'), idOf(root, 'E'));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const add = addChildOp(plan.ops);
    expect(add.index).toBe(5); // A B C D E → 末尾
  });

  it('from/to 均缺 cid → 两端各补一次，next_cid 只 bump 一次到位', () => {
    const root = fixture();
    const plan = planCreateSummary(root, idOf(root, 'A'), idOf(root, 'B'));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // 无既有 next_cid → 从 c1 起分配，两个节点 → next_cid 变 3
    expect(plan.fromCid).toBe('c1');
    expect(plan.toCid).toBe('c2');
    const rootOp = updateOp(plan.ops, root.id);
    expect((rootOp.patch.note as Record<string, unknown>).next_cid).toBe(3);
  });

  it('from/to 已有 cid → 不补发、不 bump、不替换既有值', () => {
    const root = fixture();
    root.note = { next_cid: 10 };
    const a = getNode(root, idOf(root, 'A'));
    const b = getNode(root, idOf(root, 'B'));
    if (!a || !b) throw new Error('fixture broken');
    a.note = { ...(a.note ?? {}), cid: 'c7' };
    b.note = { ...(b.note ?? {}), cid: 'c8' };

    const plan = planCreateSummary(root, a.id, b.id);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.fromCid).toBe('c7');
    expect(plan.toCid).toBe('c8');
    // 已有 cid → 无 update root、无 update from/to，只剩 add-child
    expect(plan.ops.map((o) => o.type)).toEqual(['add-child']);
  });

  it('一端有 cid 一端没有 → 只补缺的一端，next_cid 只进位一次', () => {
    const root = fixture();
    root.note = { next_cid: 5 };
    const a = getNode(root, idOf(root, 'A'));
    if (!a) throw new Error('fixture broken');
    a.note = { cid: 'c2' };

    const plan = planCreateSummary(root, a.id, idOf(root, 'B'));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.fromCid).toBe('c2');
    expect(plan.toCid).toBe('c5');
    // root 更新 + B 的补发 + add-child（A 不动）
    expect(plan.ops.map((o) => `${o.type}`)).toEqual([
      'update-node',
      'update-node',
      'add-child',
    ]);
    expect(updateOp(plan.ops, idOf(root, 'B')).id).toBe(idOf(root, 'B'));
  });

  it('摘要节点不自包含：范围端点自身是摘要节点时不纳入自己（from=to=已存在摘要）', () => {
    // 已有一个摘要节点 S（在根下、范围 A..B）。再对 S 自己发起 from=to=S 会得到
    // 「摘要 of 自己」——拒绝，避免自包含范围。
    const root = fixture();
    const p1 = planCreateSummary(root, idOf(root, 'A'), idOf(root, 'B'));
    expect(p1.ok).toBe(true);
    if (!p1.ok) return;
    // 把 S 真实插入树，模拟"已存在摘要节点"
    const ctrl = makeController(root);
    const made = createSummary(ctrl, idOf(root, 'A'), idOf(root, 'B'));
    expect(made.ok).toBe(true);
    if (!made.ok) return;

    const selfPlan = planCreateSummary(ctrl.root, made.summaryId, made.summaryId);
    expect(selfPlan.ok).toBe(false);
    if (selfPlan.ok) return;
    expect(selfPlan.error.code).toBe('summary-in-range');
  });

  it('把摘要节点当作范围端点（B..S）也被拒绝', () => {
    const root = fixture();
    const ctrl = makeController(root);
    const made = createSummary(ctrl, idOf(root, 'A'), idOf(root, 'B'));
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const plan = planCreateSummary(ctrl.root, idOf(ctrl.root, 'B'), made.summaryId);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.error.code).toBe('summary-in-range');
  });

  it('每次 plan 产出新摘要 id（newId，不复用）', () => {
    const root = fixture();
    const p1 = planCreateSummary(root, idOf(root, 'A'), idOf(root, 'B'));
    const p2 = planCreateSummary(root, idOf(root, 'A'), idOf(root, 'B'));
    if (!p1.ok || !p2.ok) throw new Error('expected ok');
    expect(p1.summaryId).not.toBe(p2.summaryId);
  });
});

/* ────────────────── plan：from === to 单成员端点的 cid 分配 ────────────────── */

/**
 * R1 判别测试（单成员区间 fromId === toId）。
 *
 * 契约（任务书 §四 11/12 + S1 契约「单成员合法」）：
 *  - 单成员只是「两端恰为同一节点」，**不是**两次分配的理由：cid 分配必须按
 *    **去重后的端点节点**计数——同一节点只分配一次、只 update 一次、`next_cid`
 *    只推进一次；
 *  - 两端 cid 必须相同（from/to 指向同一节点），否则摘要在创建瞬间就是 dangling
 *    （锚 `cid:c5` 在 `cid:c6` 被最后写入后不再命中任何节点）。
 *
 * 判别力：缺陷实现（`allocate(from)` / `allocate(to)` 各自独立分配）会同时违反
 * 上面每一条——fromCid≠toCid、端点被 update 两次、next_cid 推进两次、解析 dangling。
 */
describe('planCreateSummary · from === to 单成员端点的 cid 只分配一次', () => {
  it('端点无 cid：只分配一次 / 只 update 该端点一次 / next_cid 只推进一次', () => {
    const root = fixture();
    root.note = { next_cid: 5 };
    const c = idOf(root, 'C');

    const plan = planCreateSummary(root, c, c);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    // 一次分配：两端复用同一个 cid
    expect(plan.toCid).toBe(plan.fromCid);
    expect(plan.fromCid).toBe('c5');

    // ops 形状：update root(next_cid) → update 端点（**一条**） → add-child
    expect(plan.ops.map((o) => `${o.type}:${'id' in o ? o.id : o.parentId}`)).toEqual([
      `update-node:${root.id}`,
      `update-node:${c}`,
      `add-child:${root.id}`,
    ]);
    expect(plan.ops.filter((o) => o.type === 'update-node' && o.id === c)).toHaveLength(1);

    // next_cid 只推进一次（5 → 6，不是 7）；端点补发成 cid
    const rootOp = updateOp(plan.ops, root.id);
    expect((rootOp.patch.note as Record<string, unknown>).next_cid).toBe(6);
    const endpointOp = updateOp(plan.ops, c);
    expect((endpointOp.patch.note as Record<string, unknown>).cid).toBe('c5');

    // 摘要锚两端同值（同一节点）
    const spec = summaryOf(addChildOp(plan.ops).child.note);
    expect(spec).toEqual({ from: 'cid:c5', to: 'cid:c5' });
  });

  it('端点无 cid：createSummary 后摘要 well-formed，成员恰为该节点', () => {
    const ctrl = makeController(fixture());
    const id = idOf(ctrl.root, 'C');
    const res = createSummary(ctrl, id, id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // 返回的两端 cid 一致，且就是端点 note 上的实际 cid
    expect(res.toCid).toBe(res.fromCid);
    const endpointCid = getNode(ctrl.root, id)?.note?.cid;
    expect(endpointCid).toBe(res.fromCid);

    // 解析：创建即 well-formed（缺陷实现下端点 note 只留 toCid → from-not-found → dangling）
    const resolved = resolveSummaries(ctrl.root);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.state).toBe('well-formed');
    expect(resolved[0]?.summaryNodeId).toBe(res.summaryId);
    expect(resolved[0]?.memberIds).toEqual([id]);

    // next_cid 只推进一次
    expect(ctrl.root.note?.next_cid).toBe(2);
  });

  it('端点无 cid：单条 Undo 逐位还原；Redo 后摘要仍 well-formed', () => {
    const ctrl = makeController(fixture());
    const id = idOf(ctrl.root, 'C');
    const before = snapshot(ctrl.root);

    const res = createSummary(ctrl, id, id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const afterCreate = snapshot(ctrl.root);

    // 单条 undo：结构 + cid 补发 + next_cid 全部逐位回原（一次分配 ⇒ 一条事务里语义完整）
    expect(ctrl.undo()).toBe(true);
    expect(snapshot(ctrl.root)).toBe(before);

    // redo 重放同一事务：仍 well-formed，成员仍恰为该节点
    expect(ctrl.redo()).toBe(true);
    expect(snapshot(ctrl.root)).toBe(afterCreate);
    const resolved = resolveSummaries(ctrl.root);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.state).toBe('well-formed');
    expect(resolved[0]?.memberIds).toEqual([id]);
  });

  it('两端都已有 cid（同一节点）：不补发、不 bump、ops 只剩 add-child', () => {
    const root = fixture();
    root.note = { next_cid: 10 };
    const c = getNode(root, idOf(root, 'C'));
    if (!c) throw new Error('fixture broken');
    c.note = { ...(c.note ?? {}), cid: 'c7', status: 'draft' };

    const plan = planCreateSummary(root, c.id, c.id);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.fromCid).toBe('c7');
    expect(plan.toCid).toBe('c7');
    expect(plan.ops.map((o) => o.type)).toEqual(['add-child']);
    // 端点未被触碰：note 原样（含非 cid 字段）
    expect(getNode(root, c.id)?.note).toEqual({ cid: 'c7', status: 'draft' });
  });
});

/* ────────────────────── plan：summary_of 扩展字段 ────────────────────── */

describe('planCreateSummary · summary_of 扩展字段不被静默删除', () => {
  it('新摘要写最小 {from,to}，不夹带未知键', () => {
    const root = fixture();
    const plan = planCreateSummary(root, idOf(root, 'A'), idOf(root, 'B'));
    if (!plan.ok) throw new Error('expected ok');
    const add = addChildOp(plan.ops);
    expect(Object.keys(add.child.note?.summary_of ?? {})).toEqual(['from', 'to']);
  });

  it('补发 cid 时端点的其它 note 字段原样保留', () => {
    const root = fixture();
    const a = getNode(root, idOf(root, 'A'));
    if (!a) throw new Error('fixture broken');
    // A 是**普通节点**（不是摘要节点，否则会被 summary-in-range 先行拒绝），
    // 但 note 上带有无关字段。判别对象：补发 cid 的 update-node 不得冲掉它们。
    a.note = { status: 'draft', label: '第 2 章' };

    const plan = planCreateSummary(root, a.id, idOf(root, 'B'));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const aOp = updateOp(plan.ops, a.id);
    const note = aOp.patch.note as Record<string, unknown>;
    expect(note.cid).toBeDefined();
    // 其它 note 字段原样保留（补发实现若用 `{cid}` 重建 note 会在此转红）
    expect(note.status).toBe('draft');
    expect(note.label).toBe('第 2 章');
  });

  it('端点已有 cid 且带扩展 note 字段时，端点完全不被 update（零改动）', () => {
    const root = fixture();
    const a = getNode(root, idOf(root, 'A'));
    const b = getNode(root, idOf(root, 'B'));
    if (!a || !b) throw new Error('fixture broken');
    a.note = { cid: 'c7', status: 'draft' };
    b.note = { cid: 'c8' };
    const plan = planCreateSummary(root, a.id, b.id);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // 两端都有 cid ⇒ 无 update root、无 update 端点，只剩 add-child
    expect(plan.ops.map((o) => o.type)).toEqual(['add-child']);
  });

  it('mergeSummaryOf 保留 summary_of 内未知扩展键（N-3：upsert 会丢，merge 不丢）', () => {
    const note = {
      cid: 'c9',
      summary_of: { from: 'cid:c1', to: 'cid:c2', label: '第 2 章', future: { x: 1 } },
      status: 'draft',
    };
    const merged = mergeSummaryOf(note, { from: 'cid:c5', to: 'cid:c6' });
    expect(merged.summary_of).toEqual({
      from: 'cid:c5',
      to: 'cid:c6',
      label: '第 2 章',
      future: { x: 1 },
    });
    expect(merged.status).toBe('draft');
    expect(merged.cid).toBe('c9');
    // 不可变：输入未被改写
    expect(note.summary_of.from).toBe('cid:c1');
  });

  it('mergeSummaryOf：summary_of 缺失 / 非对象时退化为写最小 {from,to}', () => {
    expect(mergeSummaryOf(undefined, { from: 'cid:c1', to: 'cid:c2' }).summary_of).toEqual({
      from: 'cid:c1',
      to: 'cid:c2',
    });
    const scalar = mergeSummaryOf(
      { summary_of: 'garbage' as unknown as SummarySpec },
      { from: 'cid:c1', to: 'cid:c2' },
    );
    expect(scalar.summary_of).toEqual({ from: 'cid:c1', to: 'cid:c2' });
  });
});

/* ────────────────────── create：事务 + Undo ────────────────────── */

describe('createSummary · 单事务提交与单条 Undo', () => {
  it('成功后树中出现摘要节点，可被 resolveSummaries 解析为 well-formed', () => {
    const ctrl = makeController(fixture());
    const res = createSummary(ctrl, idOf(ctrl.root, 'A'), idOf(ctrl.root, 'C'));
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const resolved = resolveSummaries(ctrl.root);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.state).toBe('well-formed');
    expect(resolved[0]?.summaryNodeId).toBe(res.summaryId);
    expect(resolved[0]?.memberIds).toEqual([
      idOf(ctrl.root, 'A'),
      idOf(ctrl.root, 'B'),
      idOf(ctrl.root, 'C'),
    ]);
  });

  it('创建后选中新摘要节点由调用方负责（controller.select）', () => {
    const ctrl = makeController(fixture());
    const res = createSummary(ctrl, idOf(ctrl.root, 'A'), idOf(ctrl.root, 'B'));
    if (!res.ok) throw new Error('expected ok');
    ctrl.select(res.summaryId);
    expect(ctrl.selectedId).toBe(res.summaryId);
  });

  it('缺 cid 场景：单条 undo 完整还原树 + cid（逐位）', () => {
    const ctrl = makeController(fixture());
    const before = snapshot(ctrl.root);
    const res = createSummary(ctrl, idOf(ctrl.root, 'A'), idOf(ctrl.root, 'C'));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // 事务后确实变了（含 cid 补发）
    expect(snapshot(ctrl.root)).not.toBe(before);
    expect(getNode(ctrl.root, idOf(ctrl.root, 'A'))?.note?.cid).toBeDefined();

    const undone = ctrl.undo();
    expect(undone).toBe(true);
    // 逐位还原：结构、cid 补发、next_cid 全部回原
    expect(snapshot(ctrl.root)).toBe(before);
  });

  it('已有 cid 场景：undo 同样逐位还原', () => {
    const root = fixture();
    root.note = { next_cid: 9 };
    const ctrl = makeController(root);
    const a = getNode(ctrl.root, idOf(ctrl.root, 'A'));
    const b = getNode(ctrl.root, idOf(ctrl.root, 'B'));
    if (!a || !b) throw new Error('fixture broken');
    a.note = { ...(a.note ?? {}), cid: 'c3' };
    b.note = { ...(b.note ?? {}), cid: 'c4' };
    const before = snapshot(ctrl.root);

    const res = createSummary(ctrl, a.id, b.id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(ctrl.undo()).toBe(true);
    expect(snapshot(ctrl.root)).toBe(before);
  });

  it('undo 后 redo 可重放（同一事务）', () => {
    const ctrl = makeController(fixture());
    const before = snapshot(ctrl.root);
    const res = createSummary(ctrl, idOf(ctrl.root, 'A'), idOf(ctrl.root, 'B'));
    if (!res.ok) throw new Error('expected ok');
    const afterCreate = snapshot(ctrl.root);
    expect(ctrl.undo()).toBe(true);
    expect(snapshot(ctrl.root)).toBe(before);
    expect(ctrl.redo()).toBe(true);
    expect(snapshot(ctrl.root)).toBe(afterCreate);
  });

  it('重复触发同一范围 → 产生第二条摘要节点（两次独立事务，两条 undo）', () => {
    const ctrl = makeController(fixture());
    const r1 = createSummary(ctrl, idOf(ctrl.root, 'A'), idOf(ctrl.root, 'B'));
    const r2 = createSummary(ctrl, idOf(ctrl.root, 'A'), idOf(ctrl.root, 'B'));
    if (!r1.ok || !r2.ok) throw new Error('expected both ok');
    expect(r1.summaryId).not.toBe(r2.summaryId);
    expect(resolveSummaries(ctrl.root)).toHaveLength(2);
    expect(ctrl.undo()).toBe(true);
    expect(resolveSummaries(ctrl.root)).toHaveLength(1);
  });

  it('非法范围 → 不提交，树与选择状态零变化', () => {
    const ctrl = makeController(fixture());
    ctrl.select(idOf(ctrl.root, 'A'));
    const before = snapshot(ctrl.root);
    const selBefore = ctrl.selectedId;

    const res = createSummary(ctrl, idOf(ctrl.root, 'A'), idOf(ctrl.root, 'F'));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('not-same-parent');
    expect(snapshot(ctrl.root)).toBe(before);
    expect(ctrl.selectedId).toBe(selBefore);
    // 失败不产生历史条目
    expect(ctrl.canUndo).toBe(false);
  });

  it('事务失败无部分写入：ops 合法但 add-child 目标父消失时整批拒绝', () => {
    const ctrl = makeController(fixture());
    const before = snapshot(ctrl.root);
    // 构造一个必然失败的批次：正确计划 + 末尾追加一个会失败的 remove-node（根不可删）
    const plan = planCreateSummary(ctrl.root, idOf(ctrl.root, 'A'), idOf(ctrl.root, 'B'));
    if (!plan.ok) throw new Error('expected ok');
    const txn = ctrl.applyTransaction([
      ...plan.ops,
      { type: 'remove-node', id: ctrl.root.id },
    ]);
    expect(txn.ok).toBe(false);
    // 整批回滚：连合法的 add-child 也不落盘
    expect(snapshot(ctrl.root)).toBe(before);
    expect(resolveSummaries(ctrl.root)).toHaveLength(0);
    expect(ctrl.canUndo).toBe(false);
  });

  it('cancel 语义：失败后再次以同一 fromId 发起不复用旧状态（每次 plan 重新分配 id）', () => {
    const ctrl = makeController(fixture());
    const bad = createSummary(ctrl, idOf(ctrl.root, 'A'), idOf(ctrl.root, 'F'));
    expect(bad.ok).toBe(false);
    const good = createSummary(ctrl, idOf(ctrl.root, 'A'), idOf(ctrl.root, 'B'));
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    expect(getNode(ctrl.root, good.summaryId)).not.toBeNull();
    expect(resolveSummaries(ctrl.root)).toHaveLength(1);
  });
});

/* ────────────────────── summaryOfNode 辅助读取 ────────────────────── */

describe('summaryOfNode · 摘要节点判定辅助', () => {
  it('普通节点 → undefined；摘要节点 → 其 spec', () => {
    const ctrl = makeController(fixture());
    expect(summaryOfNode(ctrl.root, idOf(ctrl.root, 'A'))).toBeUndefined();
    const res = createSummary(ctrl, idOf(ctrl.root, 'A'), idOf(ctrl.root, 'B'));
    if (!res.ok) throw new Error('expected ok');
    expect(summaryOfNode(ctrl.root, res.summaryId)).toEqual({
      from: `cid:${res.fromCid}`,
      to: `cid:${res.toCid}`,
    });
  });
});

/* ────────────────────── 解析往返（含 parseMm 形态） ────────────────────── */

describe('创建结果经 .mm.md 往返后仍 well-formed', () => {
  it('serialize → parse → 摘要锚与成员区间保持', () => {
    const ctrl = makeController(fixture());
    const res = createSummary(ctrl, idOf(ctrl.root, 'A'), idOf(ctrl.root, 'C'));
    if (!res.ok) throw new Error('expected ok');
    // 成员文本在往返后可用于定位（cid 会被保留，但解析出的 id 是新的）
    const md = ctrl.serialize();
    const reparsed = parseMm(md);
    if (reparsed === null) throw new Error('reparse failed');
    const back = astToEditable(reparsed.root);
    if (back === null) throw new Error('astToEditable failed');
    const resolved = resolveSummaries(back);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.state).toBe('well-formed');
    expect(resolved[0]?.memberIds).toHaveLength(3);
    // 成员就是 A/B/C（按文本核对，不依赖会话内 id）
    const memberTexts = (resolved[0]?.memberIds ?? []).map((id) => getNode(back, id)?.text);
    expect(memberTexts).toEqual(['A', 'B', 'C']);
    // 摘要节点本身也往返了，默认文本保留
    expect(getNode(back, resolved[0]?.summaryNodeId ?? '')?.text).toBe('摘要');
  });
});

/* ────────────────────── 默认文本与 note 写入 ────────────────────── */

describe('摘要节点写盘细节', () => {
  it('默认文本为「摘要」，note 带 summary_of', () => {
    const ctrl = makeController(fixture());
    const res = createSummary(ctrl, idOf(ctrl.root, 'A'), idOf(ctrl.root, 'B'));
    if (!res.ok) throw new Error('expected ok');
    const node = getNode(ctrl.root, res.summaryId);
    expect(node?.text).toBe('摘要');
    expect(summaryOf(node?.note)).toBeDefined();
  });

  it('摘要节点落在共同父级下、紧随 to 之后', () => {
    const ctrl = makeController(fixture());
    const res = createSummary(ctrl, idOf(ctrl.root, 'A'), idOf(ctrl.root, 'C'));
    if (!res.ok) throw new Error('expected ok');
    const parent = ctrl.root;
    const ids = parent.children.map((c) => c.id);
    expect(ids[ids.indexOf(idOf(ctrl.root, 'C')) + 1]).toBe(res.summaryId);
  });

  it('makeTextNode 夹具不参与：摘要节点不是 entity/image', () => {
    const ctrl = makeController(ast(makeTextNode('根', [makeTextNode('X'), makeTextNode('Y')])));
    const kids = ctrl.root.children;
    const x = childAt(ctrl.root, 0);
    const y = kids[1];
    if (!y) throw new Error('fixture broken');
    const res = createSummary(ctrl, x.id, y.id);
    if (!res.ok) throw new Error('expected ok');
    expect(getNode(ctrl.root, res.summaryId)?.type).toBe('text');
  });
});
