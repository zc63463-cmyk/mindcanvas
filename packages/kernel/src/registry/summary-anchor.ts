/**
 * 摘要范围锚解析契约（S1，仿 section-anchor.ts 的三态 + 诊断形态）。
 *
 * 语义：摘要是「**同一父节点下的一段连续兄弟**」——锚是范围两端，
 * 不是成员清单（拖入/拖出由位置自然伸缩，无需增量维护）：
 *   成员A ← from ... to → 成员C   ][ 摘要
 *
 * 锚复用内核统一锚体系（parseLinkAnchor / resolveLinkAnchor）：
 * - `cid:xxx`       → 稳定子树身份（写入一律落 cid；改名/移动不失效）
 * - `node:根/分支/名` → 文本路径锚（读取兼容；改名/移动经 planReferenceMigration 重建）
 *
 * 三态（设计稿 §4.2）：
 * - well-formed：两端命中 + 与摘要节点同父 + 顺序合法 + 摘要节点自身不在范围内
 * - dangling   ：端点被删 / 移出同父 / 倒序 / 摘要节点落在范围内
 * - stale      ：锚不可解析（手写坏值 / 歧义路径）
 *
 * 中间成员被增删**不**触发 dangling：范围按位置自然伸缩（XMind 同款语义）。
 *
 * dangling 治理：**数据无损**——锚元数据保留在文档中，产出 W_SUMMARY_DANGLING 诊断，
 * 渲染层回落为普通节点（不画括线）供用户修复；绝不静默删除
 * （与 W-SECTION-DANGLING / W-ORPHAN-NOTE 同一哲学）。
 */
import {
  buildCidIndex,
  parseLinkAnchor,
  resolveLinkAnchor,
  type AnchorResolutionState,
} from './note-anchor.js';
import { summaryOf } from '../protocol/summary.js';
import type { SummarySpec } from '../protocol/types.js';
import type { EditableNode } from '../tree/treeOps.js';

/** 摘要范围锚失效/非法的诊断码 */
export const W_SUMMARY_DANGLING = 'W-SUMMARY-DANGLING';

/** 解析后的摘要（纯函数输出，无渲染语义） */
export interface ResolvedSummary {
  /** 摘要节点（持有 summary_of 的那个节点）的会话内 id */
  summaryNodeId: string;
  state: AnchorResolutionState;
  /** well-formed → 范围成员（同父连续区间，含两端，按兄弟顺序） */
  memberIds?: string[];
  /** well-formed → 成员与摘要节点的共同父节点 id（布局卫星据此定位成员带） */
  parentId?: string;
  /** dangling / stale 的原因（可解释性，用于诊断文案与面板提示） */
  reason?: string;
  /** 摘要节点文本（诊断文案可读性；不影响三态判定） */
  label?: string;
}

/** 摘要级诊断（非阻断；渲染层/面板据此提示降级与一键修复） */
export interface SummaryDiagnostic {
  code: typeof W_SUMMARY_DANGLING;
  summaryNodeId: string;
  message: string;
}

/** 节点在树中的定位（父 + 兄弟序；根 parent = null） */
interface NodePos {
  parent: EditableNode | null;
  parentId: string | null;
  index: number;
}

/** 单条摘要的三态解析（纯函数；pos / cidIndex 由调用方预建复用） */
function resolveOne(
  root: EditableNode,
  cidIndex: Map<string, string>,
  pos: Map<string, NodePos>,
  node: EditableNode,
  spec: SummarySpec,
): ResolvedSummary {
  const id = node.id;
  const label = node.text !== undefined && node.text !== '' ? node.text : undefined;
  const withLabel = label !== undefined ? { label } : {};

  // ① 锚形态：不可解析 → stale（手写坏值；两端分别标注，便于用户定位）
  const fromAnchor = parseLinkAnchor(spec.from);
  if (!fromAnchor) return { summaryNodeId: id, state: 'stale', reason: 'unparsable-from', ...withLabel };
  const toAnchor = parseLinkAnchor(spec.to);
  if (!toAnchor) return { summaryNodeId: id, state: 'stale', reason: 'unparsable-to', ...withLabel };

  // ② 命中：cid 未命中 / 路径失效 → dangling；路径歧义 → stale（宁可不认也不错认）
  const fromRes = resolveLinkAnchor(root, fromAnchor, cidIndex);
  if (fromRes.state !== 'well-formed' || fromRes.nodeId === undefined) {
    return {
      summaryNodeId: id,
      state: fromRes.state,
      reason: fromRes.state === 'stale' ? 'from-unresolvable' : 'from-not-found',
      ...withLabel,
    };
  }
  const toRes = resolveLinkAnchor(root, toAnchor, cidIndex);
  if (toRes.state !== 'well-formed' || toRes.nodeId === undefined) {
    return {
      summaryNodeId: id,
      state: toRes.state,
      reason: toRes.state === 'stale' ? 'to-unresolvable' : 'to-not-found',
      ...withLabel,
    };
  }

  // ③ 结构：同父 + 顺序 + S 不在范围内
  const self = pos.get(id);
  const fromPos = pos.get(fromRes.nodeId);
  const toPos = pos.get(toRes.nodeId);
  if (!self || !fromPos || !toPos) {
    // 防御：resolveLinkAnchor 的命中必来自本树，正常不可达
    return { summaryNodeId: id, state: 'dangling', reason: 'position-unknown', ...withLabel };
  }
  if (self.parent === null) {
    // 摘要节点是文档根：根没有兄弟，锚永远不可能成立
    return { summaryNodeId: id, state: 'dangling', reason: 'summary-is-root', ...withLabel };
  }
  // 同父校验的三种异形分别给最可解释的原因：
  //  ① 成员之间同父、但摘要节点不在这个父下（S 被搬走）→ summary-not-same-parent
  //  ② 端点偏离（跨父选择 / 端点指向根自身）→ from-/to-not-same-parent
  // 先判 ①：它能把「整条摘要在错层」与「某一个端点变坏」区分开。
  const membersShareParent = fromPos.parentId !== null && fromPos.parentId === toPos.parentId;
  if (membersShareParent && self.parentId !== fromPos.parentId) {
    return { summaryNodeId: id, state: 'dangling', reason: 'summary-not-same-parent', ...withLabel };
  }
  if (fromPos.parentId !== self.parentId) {
    return { summaryNodeId: id, state: 'dangling', reason: 'from-not-same-parent', ...withLabel };
  }
  if (toPos.parentId !== self.parentId) {
    return { summaryNodeId: id, state: 'dangling', reason: 'to-not-same-parent', ...withLabel };
  }
  if (fromPos.index > toPos.index) {
    return { summaryNodeId: id, state: 'dangling', reason: 'order-inverted', ...withLabel };
  }
  if (self.index >= fromPos.index && self.index <= toPos.index) {
    // 摘要节点落在自己的范围里（自己括自己）——成员会包含它，几何与语义都不成立
    return { summaryNodeId: id, state: 'dangling', reason: 'summary-in-range', ...withLabel };
  }

  // self.parent === null 已在上方提前返回，此处 parent 必非空（用 parent.id 取得 string）
  const parent = self.parent;
  const memberIds = parent.children.slice(fromPos.index, toPos.index + 1).map((c) => c.id);
  return {
    summaryNodeId: id,
    state: 'well-formed',
    memberIds,
    parentId: parent.id,
    ...withLabel,
  };
}

/**
 * 解析全树的摘要锚（先序遍历，按树序返回）。
 *
 * cid 索引**一次预建**供所有条目复用（与 resolveSections 同口径）；无摘要的文档
 * 零额外开销（先收集再决定是否建索引）。同一条锚对成员位置的解释在解析期定死，
 * 渲染/布局层不再复核。
 */
export function resolveSummaries(root: EditableNode): ResolvedSummary[] {
  const pos = new Map<string, NodePos>();
  const pending: Array<{ node: EditableNode; spec: SummarySpec }> = [];
  const walk = (node: EditableNode, parent: EditableNode | null, index: number): void => {
    pos.set(node.id, { parent, parentId: parent?.id ?? null, index });
    const spec = summaryOf(node.note);
    if (spec) pending.push({ node, spec });
    // 块体 forEach：避免 concise body 把 walk 的返回值当作回调返回值（lint/useIterableCallbackReturn）
    node.children.forEach((child, i) => {
      walk(child, node, i);
    });
  };
  walk(root, null, 0);
  if (pending.length === 0) return [];
  const cidIndex = buildCidIndex(root);
  return pending.map(({ node, spec }) => resolveOne(root, cidIndex, pos, node, spec));
}

/** 非 well-formed 条目的原因码 → 人类可读提示（原因码本身照原样保留在消息里，便于检索） */
function describeReason(reason: string | undefined): string {
  switch (reason) {
    case 'from-not-found':
      return '范围起点端点被删';
    case 'to-not-found':
      return '范围终点端点被删';
    case 'from-not-same-parent':
      return '范围起点不在摘要节点所在层级（跨父选择）';
    case 'to-not-same-parent':
      return '范围终点不在摘要节点所在层级（跨父选择）';
    case 'summary-not-same-parent':
      return '摘要节点与范围不同父（摘要被移走）';
    case 'order-inverted':
      return '范围顺序倒置（起点在终点之后）';
    case 'summary-in-range':
      return '摘要节点落在自己的范围内';
    case 'summary-is-root':
      return '摘要节点是文档根（根没有兄弟）';
    case 'from-unresolvable':
    case 'to-unresolvable':
      return '范围端点锚歧义（同级同名，无法唯一命中）';
    default:
      return '范围锚不可解析';
  }
}

/** 收集非 well-formed 摘要的诊断（dangling 与 stale 同码不同措辞，均可解释） */
export function collectSummaryDiagnostics(
  resolved: readonly ResolvedSummary[],
): SummaryDiagnostic[] {
  const out: SummaryDiagnostic[] = [];
  for (const r of resolved) {
    if (r.state === 'well-formed') continue;
    // dangling = 端点/结构失效（可修复：改锚或改结构）；stale = 锚文本本身非法（要重写）
    const kind = r.state === 'stale' ? '歧义/非法' : '已失效';
    const reason = r.reason ?? 'unknown';
    out.push({
      code: W_SUMMARY_DANGLING,
      summaryNodeId: r.summaryNodeId,
      message: `摘要「${r.label ?? r.summaryNodeId}」的范围锚${kind}（${reason}）：${describeReason(r.reason)}；元数据保留，按普通节点渲染待修复`,
    });
  }
  return out;
}
