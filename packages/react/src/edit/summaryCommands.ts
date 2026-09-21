/**
 * 摘要创建命令（S2）：`planCreateSummary`（纯函数计划）+ `createSummary`（单事务提交）。
 *
 * 语义：摘要是「**同一父节点下的一段连续兄弟**」的范围标记——锚记两端，不记成员清单。
 * 本模块只负责**创建**（S2 范围）；卫星布局（S3）与括线渲染（S4）不在此处。
 *
 * 事务形态（计划 §2 S2；单条 undo 完整回滚）：
 *   ① update-node(root)      —— 仅当需要补发 cid（bump `next_cid` 一次到位）
 *   ② update-node(from)      —— 仅当 from 缺 cid
 *   ③ update-node(to)        —— 仅当 to 缺 cid
 *   ④ add-child(parent, S, index = to.index + 1)
 * ops 顺序**稳定**（先 root 后端点，最后落节点），便于审计与快照。
 *
 * 校验顺序（首个失败即返回，错误码可解释）：
 *   not-found → is-root → summary-in-range → not-same-parent → reversed
 *
 * ## summary_of 扩展字段（S1 复核 N-3 的 S2 义务）
 *
 * `upsertSummaryOf` 以 `{from, to}` **整体重建** `summary_of`，会丢弃未知扩展键。
 * 因此本模块**不用它写已有节点**：端点补发 cid 走 `mergeSummaryOf`（合并语义），
 * 保留 `summary_of` 内不被本模块认识的键。新建摘要节点自身写最小 `{from, to}`——
 * 新节点本就没有历史扩展键，写最小集即无损（任务书 §五 2）。
 */
import {
  getNode,
  newId,
  parentIdOf,
  summaryOf,
  type EditableNode,
  type Note,
  type SummarySpec,
  type TreeOp,
} from '@mindcanvas/kernel';
import { assignCid } from '../render/centers.js';
import type { EditorController } from './controller.js';

/** 摘要节点默认文本（创建后由用户改名；与 XMind 概要的「概要」同款占位） */
export const SUMMARY_DEFAULT_TEXT = '摘要';

/** 计划失败的原因码（可解释；调用方据此给提示，不做字符串匹配） */
export type SummaryPlanErrorCode =
  /** 端点节点在当前树中不存在 */
  | 'not-found'
  /** 端点是文档根（根没有兄弟，不能作为范围成员） */
  | 'is-root'
  /** 两端不在同一父级下（范围必须是同父连续兄弟） */
  | 'not-same-parent'
  /** from 在 to 之后（倒序区间） */
  | 'reversed'
  /** 端点自身是摘要节点：要么自包含（from=to=S），要么把 S 当成员（嵌套摘要，本批不做） */
  | 'summary-in-range';

export interface SummaryPlanError {
  code: SummaryPlanErrorCode;
  message: string;
}

/** 计划成功时的完整形状（cid 已定，ops 可直接提交） */
export interface SummaryPlanOk {
  ok: true;
  /** 稳定顺序的事务 ops（见文件头 ①–④） */
  ops: TreeOp[];
  /** 新摘要节点 id（`newId()`，每次 plan 重新分配，不复用） */
  summaryId: string;
  /** from 端点最终使用的 cid（已有则沿用，缺失则新分配） */
  fromCid: string;
  /** to 端点最终使用的 cid */
  toCid: string;
}

export type SummaryPlan = SummaryPlanOk | { ok: false; error: SummaryPlanError };

/** 创建结果：成功带新摘要 id 与两端 cid；失败带可解释原因 */
export type CreateSummaryResult =
  | { ok: true; summaryId: string; fromCid: string; toCid: string }
  | { ok: false; error: SummaryPlanError };

/** note 上的 cid 是否已可用（空串视为缺失——与 `ensureNodeCid` 的判定同口径） */
function noteCid(note: Note | undefined): string | undefined {
  const cid = note?.cid;
  return typeof cid === 'string' && cid !== '' ? cid : undefined;
}

/**
 * 合并写入 `summary_of`（不可变）。
 *
 * 与 `upsertSummaryOf` 的差别只在**已有值**的处理：本函数保留 `summary_of` 内
 * 除 `from` / `to` 外的全部键（前向兼容——未来新增 `label` / 样式键不会被本次
 * 端点补发抹掉）。`summary_of` 缺失或非对象时等价于写最小 `{from, to}`。
 */
export function mergeSummaryOf(note: Note | undefined, spec: SummarySpec): Note {
  const base: Note = note ?? {};
  const raw: unknown = base.summary_of;
  // 先展开既有对象（保住 `summary_of` 内本模块不认识的扩展键），再覆盖 from/to。
  // 展开 `unknown` 前先收窄为 object——Object.assign 接受 unknown 源，无需类型断言
  // （预算 asCast 31/31 已满，本包不得新增断言）。
  const merged: SummarySpec = Object.assign(
    {},
    typeof raw === 'object' && raw !== null ? raw : undefined,
    { from: spec.from, to: spec.to },
  );
  return { ...base, summary_of: merged };
}

/**
 * 读取某节点的摘要范围锚（不存在 / 形态非法 → `undefined`）。
 * 薄封装：`summaryOf(getNode(...).note)`，供交互层少写一层空判。
 */
export function summaryOfNode(root: EditableNode, id: string): SummarySpec | undefined {
  return summaryOf(getNode(root, id)?.note);
}

/** 计划失败的小构造器（统一 message 措辞） */
function fail(code: SummaryPlanErrorCode, message: string): SummaryPlan {
  return { ok: false, error: { code, message } };
}

/**
 * 计划一次摘要创建（**纯函数**：不改 root、不抛异常、不读写外部状态）。
 *
 * @param root   当前可编辑树（只读）
 * @param fromId 范围起点（必须是 to 的前序同父兄弟）
 * @param toId   范围终点（摘要节点插在其后一位）
 */
export function planCreateSummary(
  root: EditableNode,
  fromId: string,
  toId: string,
): SummaryPlan {
  // ① 两端存在
  const from = getNode(root, fromId);
  if (!from) return fail('not-found', '范围起点节点不存在');
  const to = getNode(root, toId);
  if (!to) return fail('not-found', '范围终点节点不存在');

  // ② 两端非根（根没有兄弟，永远不能是范围成员）
  if (fromId === root.id) return fail('is-root', '文档根不能作为摘要范围的起点');
  if (toId === root.id) return fail('is-root', '文档根不能作为摘要范围的终点');

  // ③ 摘要节点自身不得参与范围。端点已是摘要节点时有两种坏局：
  //    from=to=S 会造出自包含（S 落进自己的范围）；否则会把 S 当成员（嵌套摘要，本批不做）。
  //    两者都拒绝——「不许把摘要节点纳入自己的范围」（任务书 §四 5）。
  if (summaryOf(from.note) !== undefined || summaryOf(to.note) !== undefined) {
    return fail('summary-in-range', '摘要节点不能作为摘要范围的端点');
  }

  // ④ 同一父级
  const parentId = parentIdOf(root, fromId);
  if (parentId === null || parentId !== parentIdOf(root, toId)) {
    return fail('not-same-parent', '摘要范围必须是同一父级下的连续兄弟');
  }
  const parent = getNode(root, parentId);
  if (!parent) return fail('not-found', '范围端点的共同父节点不存在');

  // ⑤ 顺序：from 必须在 to 之前（同父，子节点索引即阅读顺序）
  const fromIndex = parent.children.findIndex((c) => c.id === fromId);
  const toIndex = parent.children.findIndex((c) => c.id === toId);
  if (fromIndex < 0 || toIndex < 0) {
    // 防御：parentIdOf 命中即应在本父子列表中，正常不可达
    return fail('not-found', '范围端点不在其父节点的子节点列表中');
  }
  if (fromIndex > toIndex) return fail('reversed', '范围起点在终点之后（请按阅读顺序选择）');

  return buildPlan(root, parent, from, to, toIndex);
}

/**
 * 构造最终计划（cid 分配与 ops 在同一遍里完成）。
 *
 * cid 分配纪律（任务书 §四 11/12）：
 *  - **缺失才补**：已有 cid 一律沿用，不替换、不重复分配；
 *  - `next_cid` **一次到位**：两端都缺时在同一 `rootNote` 上连续分配，
 *    只产生**一条** root 更新（不重复 bump）；
 *  - **按节点去重**：`fromId === toId`（单成员区间，S1 契约合法）时两端是同一节点，
 *    只分配一次、只 update 一次、`next_cid` 只推进一次（见下方注释）。
 */
function buildPlan(
  root: EditableNode,
  parent: EditableNode,
  from: EditableNode,
  to: EditableNode,
  toIndex: number,
): SummaryPlanOk {
  let rootNote: Note = root.note ?? {};
  let rootDirty = false;

  const allocate = (node: EditableNode): { cid: string; note: Note } => {
    const existing = noteCid(node.note);
    if (existing !== undefined) return { cid: existing, note: node.note ?? {} };
    const assigned = assignCid(rootNote);
    rootNote = assigned.note;
    rootDirty = true;
    // 合并既有 note 字段（保住 summary_of 等——`ensureNodeCid` 同款语义）
    return { cid: assigned.cid, note: { ...(node.note ?? {}), cid: assigned.cid } };
  };

  // 端点**去重**后再分配：单成员区间（fromId === toId）的两端是同一个节点，
  // 只分配一次 cid——两次分配会让两端拿到两个 cid，写入后 from 锚失效（创建即 dangling）。
  const fromAlloc = allocate(from);
  const toAlloc = from.id === to.id ? fromAlloc : allocate(to);

  const ops: TreeOp[] = [];
  if (rootDirty) ops.push({ type: 'update-node', id: root.id, patch: { note: rootNote } });
  if (fromAlloc.cid !== noteCid(from.note)) {
    ops.push({ type: 'update-node', id: from.id, patch: { note: fromAlloc.note } });
  }
  // 端点相同时不重复推送（同一节点一条补发即可：两次 patch 后者会覆盖前者）
  if (to.id !== from.id && toAlloc.cid !== noteCid(to.note)) {
    ops.push({ type: 'update-node', id: to.id, patch: { note: toAlloc.note } });
  }

  const summaryId = newId();
  ops.push({
    type: 'add-child',
    parentId: parent.id,
    index: toIndex + 1,
    child: {
      id: summaryId,
      type: 'text',
      text: SUMMARY_DEFAULT_TEXT,
      note: { summary_of: { from: `cid:${fromAlloc.cid}`, to: `cid:${toAlloc.cid}` } },
      children: [],
    },
  });

  return { ok: true, ops, summaryId, fromCid: fromAlloc.cid, toCid: toAlloc.cid };
}

/**
 * 创建摘要：计划 → **单条事务**提交。
 *
 * 成功时树中新增摘要节点；**选中由调用方负责**（命令层不碰瞬时 UI 状态，与
 * `frameCommands` 同款分层）。失败时零写入：树、cid、撤销栈均无变化
 * （`applyTransaction` 整批校验 + 整批回滚）。
 */
export function createSummary(
  controller: EditorController,
  fromId: string,
  toId: string,
): CreateSummaryResult {
  const plan = planCreateSummary(controller.root, fromId, toId);
  if (!plan.ok) return { ok: false, error: plan.error };
  const txn = controller.applyTransaction(plan.ops);
  if (!txn.ok) {
    // 计划已通过校验仍提交失败（并发编辑/迁移冲突）——原样转达，不伪造成功
    return { ok: false, error: { code: 'not-found', message: txn.error.message } };
  }
  return { ok: true, summaryId: plan.summaryId, fromCid: plan.fromCid, toCid: plan.toCid };
}
