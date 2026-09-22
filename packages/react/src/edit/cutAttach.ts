/**
 * A5（G2）：切断树边 / 接回子树——领域命令层。
 *
 * 是什么：
 * - `planCutTreeEdge`：切断 A→B（真实父子树边）——B 子树移为**文档根直接分支（末尾）**、
 *   centers 标记 detached；引用按「前树解析 nodeId → 后树重建锚」迁移（A2 地基）。
 * - `planAttachIsland`：detached 分支显式接回目标父节点（清 detached、坐标进历史区）。
 * - 两者都产出 **TreeOp[]**，交 `controller.applyTransaction` 原子提交
 *   （全批预校验、失败零副作用、一次 history——禁止以「连调多次 apply」替代）。
 *
 * 不是什么：
 * - 不碰自由边删除（那是边级操作，不拆树）；不做 UI（菜单在 NodeContextMenu/TreeEdgeEditor）
 * - 不做截断式文本替换（迁移一律走 planReferenceMigration 的 nodeId 语义）
 *
 * 深度约束：.mm.md heading 层级 H1–H6（根=1）→ 节点最大相对深度 5。
 * 切断后 B 新深度=1；接回后 B 新深度=目标深度+1——超限即结构化拒绝，不硬凑。
 */
import {
  applyOp,
  findNode,
  getNode,
  planReferenceMigration,
  type AnchorRef,
  type EditableNode,
  type Note,
  type ReferenceDiagnostic,
  type TreeOp,
} from '@mindcanvas/kernel';
import { collectCenters, ensureNodeCid, isRec, removeCenter, upsertCenter } from '../render/centers.js';
import { anchorOfNode } from '../render/freeEdges.js';
import { applySpanReplace, parseTextLinks } from './textLinks.js';

/** .mm.md heading 层级上限（H6）→ 节点相对根的最大深度（根深度 0） */
export const MAX_NODE_DEPTH = 5;

export type CutAttachErrorCode =
  | 'not-found'
  | 'is-root'
  | 'already-detached'
  | 'not-detached'
  | 'attach-to-self'
  | 'attach-to-descendant'
  | 'depth-limit'
  | 'reference-conflict';

export type CutAttachPlan =
  | { ok: true; ops: TreeOp[]; diagnostics: ReferenceDiagnostic[] }
  | { ok: false; error: { code: CutAttachErrorCode; message: string } };

/** 节点子树内的最大相对深度（叶子 = 0） */
export function subtreeMaxDepth(node: EditableNode): number {
  let max = 0;
  const walk = (n: EditableNode, d: number): void => {
    if (d > max) max = d;
    for (const c of n.children) walk(c, d + 1);
  };
  walk(node, 0);
  return max;
}

/** 节点相对根的深度 */
function depthOf(root: EditableNode, id: string): number | null {
  let found: number | null = null;
  const walk = (n: EditableNode, d: number): boolean => {
    if (n.id === id) {
      found = d;
      return true;
    }
    for (const c of n.children) if (walk(c, d + 1)) return true;
    return false;
  };
  walk(root, 0);
  return found;
}

/** target 是否位于 subtree（含 subtree 根自身）内 —— 接回防成环 */
function isWithin(subtree: EditableNode, id: string): boolean {
  if (subtree.id === id) return true;
  return subtree.children.some((c) => isWithin(c, id));
}

const ANCHOR_NOTE_KEYS = ['centers', 'center_pos', 'edges', 'links', 'groups', 'sections'] as const;

/**
 * L2：从一段文本收集行内链接锚 → span 级 field（`desc#0` / `note[2]#1` / …）。
 * 链接判定与渲染同源（textLinks.parseTextLinks：URL 形态 / 裸括号文本不入链接）；
 * span 序号按出现顺序编号，与 applyAnchorUpdateToNote 的定位口径一致。
 */
function collectTextLinkRefs(
  noteKey: string,
  key: string,
  text: unknown,
  itemIndex: number | undefined,
  out: AnchorRef[],
): void {
  if (typeof text !== 'string' || text === '') return;
  const prefix = itemIndex === undefined ? key : `${key}[${itemIndex}]`;
  let k = 0;
  for (const span of parseTextLinks(text)) {
    if (span.kind !== 'link' || span.anchorText === undefined) continue;
    out.push({ noteKey, field: `${prefix}#${k}`, anchor: span.anchorText });
    k += 1;
  }
}

/**
 * 盘点全树 note 锚引用（design §5 清单：centers.at / center_pos.at / edges 两端 /
 * links[].to / groups[].members）。noteKey 用**会话内节点 id**（迁移 update 的定位键）。
 * 未知/非数组形状静默跳过——与「未知元数据保留但不承诺自动迁移」的纪律一致。
 */
export function collectReferenceAnchors(root: EditableNode): AnchorRef[] {
  const refs: AnchorRef[] = [];
  const walk = (n: EditableNode): void => {
    const note = n.note; // Note 自带索引签名，直读免断言
    if (note) {
      for (const key of ANCHOR_NOTE_KEYS) {
        const arr = note[key];
        if (!Array.isArray(arr)) continue;
        arr.forEach((item, i) => {
          if (key === 'groups') {
            if (!isRec(item)) return;
            const members = item.members;
            if (!Array.isArray(members)) return;
            members.forEach((m, j) => {
              if (typeof m === 'string') {
                refs.push({ noteKey: n.id, field: `groups[${i}].members[${j}]`, anchor: m });
              }
            });
            return;
          }
          if (!isRec(item)) return;
          if (typeof item.at === 'string') {
            // centers[].at 携带所属对象 cid → anchor-migrate 走 cid 双轨（按身份重建 at 提示）
            refs.push({
              noteKey: n.id,
              field: `${key}[${i}].at`,
              anchor: item.at,
              ...(typeof item.cid === 'string' ? { cid: item.cid } : {}),
            });
          }
          if (key === 'sections' && typeof item.root === 'string') {
            // sections[].root：cid 锚身份稳定（迁移时原样保留即正确）；
            // node: 路径锚走 planReferenceMigration 的 nodeId 重建（v1.5.0 Phase 1）
            refs.push({ noteKey: n.id, field: `sections[${i}].root`, anchor: item.root });
          }
          if (typeof item.from === 'string') {
            refs.push({ noteKey: n.id, field: `${key}[${i}].from`, anchor: item.from });
          }
          if (typeof item.to === 'string') {
            refs.push({ noteKey: n.id, field: `${key}[${i}].to`, anchor: item.to });
          }
        });
      }
      // 摘要范围锚（S1）：`summary_of: {from, to}` 是**对象值**，不在 ANCHOR_NOTE_KEYS 的
      // 数组键 walk 内 → 单列分支；field 形态 `summary_of.from` / `summary_of.to`。
      // 写入落 cid（身份稳定，迁移时原样保留即正确）；手写/旧文件的 node: 路径锚
      // 走 planReferenceMigration 的 nodeId 重建（与 sections[].root 同轨）。
      const summaryAnchor = note.summary_of;
      if (isRec(summaryAnchor)) {
        if (typeof summaryAnchor.from === 'string') {
          refs.push({ noteKey: n.id, field: 'summary_of.from', anchor: summaryAnchor.from });
        }
        if (typeof summaryAnchor.to === 'string') {
          refs.push({ noteKey: n.id, field: 'summary_of.to', anchor: summaryAnchor.to });
        }
      }
      // L2：文本字段内的行内链接（desc / note_text 标量；note[i] / qa[i] 数组项）。
      // field 形态 `desc#0` / `note_text#0` / `note[2]#1` / `qa[0]#0`——span 序号按出现顺序。
      collectTextLinkRefs(n.id, 'desc', note.desc, undefined, refs);
      collectTextLinkRefs(n.id, 'note_text', note.note_text, undefined, refs);
      for (const key of ['note', 'qa'] as const) {
        const arr = note[key];
        if (!Array.isArray(arr)) continue;
        arr.forEach((item, i) => {
          if (typeof item === 'string') collectTextLinkRefs(n.id, key, item, i, refs);
        });
      }
    }
    for (const c of n.children) walk(c);
  };
  walk(root);
  return refs;
}

/** 把单条锚迁移写回 note（不可变；field 形如 `centers[0].at` / `groups[1].members[2]`；
 *  L2 追加 span 形态 `desc#0` / `note_text#0` / `note[2]#1` / `qa[0]#0`——文本字段内链接的锚替换） */
export function applyAnchorUpdateToNote(
  note: Note | undefined,
  field: string,
  to: string,
): Note {
  // L2：文本字段 span 形态 → 替换第 k 个链接的目标区间
  const sm = /^([a-z_]+)(?:\[(\d+)\])?#(\d+)$/.exec(field);
  if (sm) {
    return applyTextLinkUpdate(note, sm[1] ?? '', sm[2], Number(sm[3]), to);
  }
  const m = /^([a-z_]+)\[(\d+)\](?:\.([a-z]+))?$/.exec(field);
  // S1：摘要范围锚形态 `summary_of.from` / `summary_of.to`（对象值内的叶子字段，
  // 不是数组项——与上面的 `key[i].leaf` 形态刻意分开，避免正则在两条路径上互相误吃）。
  // 两组默认空串 = 未命中分支（正则两组均为 `+`，命中即非空），无需非空断言。
  if (!m) {
    const [, dk = '', dleaf = ''] = /^([a-z_]+)\.([a-z_]+)$/.exec(field) ?? [];
    if (dk === '') return note ?? {};
    const base0: Note = note ?? {};
    const cur0 = base0[dk];
    if (!isRec(cur0)) return base0;
    const out0: Note = { ...base0 };
    out0[dk] = { ...cur0, [dleaf]: to };
    return out0;
  }
  const key = m[1];
  if (!key) return note ?? {};
  const idx = Number(m[2]);
  const leaf = m[3];
  const base: Note = note ?? {};
  const raw = base[key]; // 索引签名直读
  if (!Array.isArray(raw)) return base;
  const list = raw.slice();
  if (leaf === undefined) {
    // groups[i].members[j] —— 整条即锚字符串（经由 members 路径时 m[3] 为 members 的场景见下）
    list[idx] = to;
  } else {
    const cur = list[idx];
    if (!isRec(cur)) return base;
    const obj = { ...cur };
    obj[leaf] = to;
    list[idx] = obj;
  }
  const out: Note = { ...base };
  out[key] = list;
  return out;
}

/**
 * L2：文本字段内第 k 个链接的锚替换（desc / note_text 标量；note[i] / qa[i] 数组项）。
 *
 * **从右往左的位移纪律**：链接定位与替换同源（同一 parse 结果的 target 区间），
 * 单条 update 只替换一处；applySpanReplace 内部对替换列表**从右往左**应用——
 * 若同一文本上批量传入多处替换（区间均基于同一原文），前段长度变化不会让后段错位。
 * 同一字段的多条 update 由 buildMigrationOps 逐条处理：每条基于最新文本重新解析，
 * span 序号在链接数量不变时语义稳定（锚文本替换不改变链接数/顺序）。
 *
 * 第 k 个链接不存在 / 文本形态不符 → 原 note 返回（防御性 no-op：updates 基于
 * 同代文本构建，找不到即跳过——不抛错、不阻断整批）。
 */
function applyTextLinkUpdate(
  note: Note | undefined,
  key: string,
  itemIndex: string | undefined,
  k: number,
  to: string,
): Note {
  const base: Note = note ?? {};
  const text = readTextValue(base, key, itemIndex);
  if (text === undefined) return base;
  const links = parseTextLinks(text).filter((s) => s.kind === 'link');
  const span = links[k];
  if (!span || span.targetStart === undefined || span.targetEnd === undefined) return base;
  const next = applySpanReplace(text, [{ start: span.targetStart, end: span.targetEnd, text: to }]);
  const out: Note = { ...base };
  if (itemIndex === undefined) {
    out[key] = next;
    return out;
  }
  const raw = base[key];
  if (!Array.isArray(raw)) return base;
  const list = raw.slice();
  list[Number(itemIndex)] = next;
  out[key] = list;
  return out;
}

/** groups[i].members[j] 形态的 field 解析（三层） */
function applyGroupMemberUpdate(note: Note | undefined, field: string, to: string): Note {
  const m = /^groups\[(\d+)\]\.members\[(\d+)\]$/.exec(field);
  if (!m) return note ?? {};
  const gi = Number(m[1]);
  const mi = Number(m[2]);
  const base: Note = note ?? {};
  const raw = base.groups;
  if (!Array.isArray(raw)) return base;
  const groups = raw.slice();
  const cur = groups[gi];
  if (!isRec(cur)) return base;
  const g = { ...cur };
  if (!Array.isArray(g.members)) return base;
  const members = g.members.slice();
  members[mi] = to;
  g.members = members;
  groups[gi] = g;
  const out: Note = { ...base };
  out.groups = groups;
  return out;
}

/** 冲突 → 用户可读文案（cut/attach 与 R1-1 编辑管线共用同一格式；含冲突码 + 字段 + 锚文本） */
export function formatReferenceConflict(c: {
  code: string;
  field: string;
  anchor?: string;
  message?: string;
}): string {
  const anchor = c.anchor !== undefined && c.anchor !== '' ? `：${c.anchor}` : '';
  return `引用迁移冲突（${c.code} @ ${c.field}）${anchor}：${c.message ?? '新路径不可唯一表示'}`;
}

/** L2：读 span 形态 field 承载的文本（itemIndex 缺省 → 标量键；有 → 数组第 i 项） */
function readTextValue(
  note: Note | undefined,
  key: string,
  itemIndex: string | undefined,
): string | undefined {
  if (!note) return undefined;
  const raw = note[key];
  if (itemIndex === undefined) return typeof raw === 'string' ? raw : undefined;
  if (!Array.isArray(raw)) return undefined;
  const item = raw[Number(itemIndex)];
  return typeof item === 'string' ? item : undefined;
}

/** 读迁移 field 指向的当前锚值（field 形如 centers[0].at / edges[1].from / groups[0].members[2]；
 *  L2 追加 span 形态 `desc#0` / `note_text#0` / `note[2]#1` / `qa[0]#0`） */
function readAnchorField(note: Note | undefined, field: string): string | undefined {
  if (!note) return undefined;
  // L2：文本字段 span 形态 → 第 k 个链接的锚原文
  const sm = /^([a-z_]+)(?:\[(\d+)\])?#(\d+)$/.exec(field);
  if (sm) {
    const text = readTextValue(note, sm[1] ?? '', sm[2]);
    if (text === undefined) return undefined;
    const links = parseTextLinks(text).filter((s) => s.kind === 'link');
    return links[Number(sm[3])]?.anchorText;
  }
  // S1：摘要范围锚形态 `summary_of.from` / `summary_of.to`（对象值内的叶子字段）。
  // 两组默认空串 = 未命中分支，无需非空断言。
  const [, dk = '', dleaf = ''] = /^([a-z_]+)\.([a-z_]+)$/.exec(field) ?? [];
  if (dk !== '') {
    const cur = note[dk];
    if (!isRec(cur)) return undefined;
    const v = cur[dleaf];
    return typeof v === 'string' ? v : undefined;
  }
  const m = /^([a-z_]+)\[(\d+)\]\.(?:members\[(\d+)\]|([a-z]+))$/.exec(field);
  const key = m?.[1];
  if (key === undefined) return undefined;
  const arr = note[key];
  if (!Array.isArray(arr)) return undefined;
  const at = m?.[2];
  const item = arr[at !== undefined ? Number(at) : -1];
  if (!isRec(item)) return undefined;
  const mi = m?.[3];
  if (mi !== undefined) {
    const members = item.members;
    if (!Array.isArray(members)) return undefined;
    const mv = members[Number(mi)];
    return typeof mv === 'string' ? mv : undefined;
  }
  const prop = m?.[4];
  if (prop === undefined) return undefined;
  const v = item[prop];
  return typeof v === 'string' ? v : undefined;
}

/**
 * R1-1：迁移 updates → 顺序 update-node ops（在 staged 树上逐条应用，保证 note 全量 patch 一致）。
 * 幂等：当前字段值已等于 to 的 update 跳过——controller 管线对 cut/attach 批次
 * （内含各自的迁移 op）重入迁移时不产生冗余 op。
 */
export function buildMigrationOps(
  staged: EditableNode,
  updates: readonly { noteKey: string; field: string; to: string }[],
): { ops: TreeOp[]; staged: EditableNode } {
  const ops: TreeOp[] = [];
  let cur = staged;
  for (const u of updates) {
    const node = getNode(cur, u.noteKey);
    if (!node) continue;
    if (readAnchorField(node.note, u.field) === u.to) continue;
    const isGroupMember = u.field.startsWith('groups[') && u.field.includes('.members[');
    const nextNote = isGroupMember
      ? applyGroupMemberUpdate(node.note, u.field, u.to)
      : applyAnchorUpdateToNote(node.note, u.field, u.to);
    cur = applyOp(cur, { type: 'update-node', id: u.noteKey, patch: { note: nextNote } });
    ops.push({ type: 'update-node', id: u.noteKey, patch: { note: nextNote } });
  }
  return { ops, staged: cur };
}

/** 迁移 updates → 追加 update-node ops（基于 staged 树逐条应用，保证 note 全量 patch 顺序一致） */
function migrationOps(
  staged: EditableNode,
  updates: readonly { noteKey: string; field: string; to: string }[],
  ops: TreeOp[],
): { staged: EditableNode; conflicts: boolean } {
  const built = buildMigrationOps(staged, updates);
  ops.push(...built.ops);
  return { staged: built.staged, conflicts: false };
}

/**
 * R0-4：迁移诊断 → 用户提示文案（一行汇总）。
 * planReferenceMigration 的诊断全是「迁移前即坏」类（dangling-kept /
 * pre-existing-ambiguous / unparsable-anchor）→ 语义统一为「本来就是坏，
 * 已保留原值，非本次操作造成」，与冲突类「本次操作没改成」明确区分。
 * 空数组 → null（无提示）。
 */
export function summarizeReferenceDiagnostics(
  diagnostics: readonly ReferenceDiagnostic[],
): string | null {
  if (diagnostics.length === 0) return null;
  const byCode = new Map<string, number>();
  for (const d of diagnostics) byCode.set(d.code, (byCode.get(d.code) ?? 0) + 1);
  const parts = [...byCode.entries()].map(([code, n]) => `${code} ×${n}`);
  return `引用迁移提示：${diagnostics.length} 条引用本来就是坏的，已保留原值（${parts.join('，')}）——非本次操作造成`;
}

/** 模拟应用 ops（事务预演——与 applyTransaction 同一套 applyOp 语义） */
function simulate(root: EditableNode, ops: readonly TreeOp[]): EditableNode {
  let cur = root;
  for (const op of ops) cur = applyOp(cur, op);
  return cur;
}

/**
 * 切断 A→B（G2 推荐案，已批准）：B 子树移为文档根直接分支（末尾）+ detached 标记。
 * 引用迁移；新歧义阻断提交（结构化冲突）。
 *
 * @param opts.pos B 岛根当前可见本体中心（UI 层从布局取，防首次落位跳变）；缺省自动排列
 */
export function planCutTreeEdge(
  root: EditableNode,
  childId: string,
  opts: { pos?: { x: number; y: number } } = {},
): CutAttachPlan {
  if (childId === root.id) {
    return { ok: false, error: { code: 'is-root', message: '文档根不可切断' } };
  }
  const loc = findNode(root, childId);
  if (!loc) return { ok: false, error: { code: 'not-found', message: '目标节点不存在' } };
  const center = collectCenters(root).find((c) => c.nodeId === childId);
  if (center?.detached) {
    return { ok: false, error: { code: 'already-detached', message: '该分支已是切断独立状态' } };
  }
  // 深度约束：B 移为根直接子（新深度 1）后，子树最深节点 ≤ 5
  const dMax = subtreeMaxDepth(loc.node);
  if (1 + dMax > MAX_NODE_DEPTH) {
    return {
      ok: false,
      error: {
        code: 'depth-limit',
        message: `子树深度超限：切断后最深层级将超过 H${MAX_NODE_DEPTH + 1}（当前子树相对深度 ${dMax}）`,
      },
    };
  }

  const beforeAt = anchorOfNode(root, childId) ?? '';
  const ops: TreeOp[] = [];
  // ① 结构移动：非根直接子 → 移到根末尾（保留孩子顺序；已是直接子则只做标记）
  if (loc.parent.id !== root.id) {
    ops.push({ type: 'move-node', id: childId, targetParentId: root.id, index: root.children.length });
  }
  // ② detached 标记（先按 before 锚 upsert；锚迁移由 ④ 统一改写为新锚）
  // 事务内自动分配/沿用 cid：节点已有 cid 沿用，无则分配（bump next_cid，永不复用）
  const { rootNote, nodeNote, cid, allocated } = ensureNodeCid(root.note, loc.node.note);
  if (allocated) {
    ops.push({ type: 'update-node', id: childId, patch: { note: nodeNote } });
  }
  const dir = center?.dir ?? 'right';
  const posPatch = opts.pos !== undefined ? { x: opts.pos.x, y: opts.pos.y } : {};
  const noteAfterUpsert = upsertCenter(rootNote, beforeAt, {
    dir,
    detached: true,
    cid,
    ...posPatch,
  });
  ops.push({ type: 'update-node', id: root.id, patch: { note: noteAfterUpsert } });

  // ③④ 预演应用 → 引用迁移（前树解析 → 后树重建锚 → 回验）
  let staged = simulate(root, ops);
  const refs = collectReferenceAnchors(root);
  const plan = planReferenceMigration(root, staged, refs);
  if (!plan.ok) {
    const c = plan.conflicts[0];
    return {
      ok: false,
      error: {
        code: 'reference-conflict',
        message: c
          ? formatReferenceConflict(c)
          : '引用迁移冲突：新路径不可唯一表示',
      },
    };
  }
  const mig = migrationOps(staged, plan.updates, ops);
  staged = mig.staged;

  // ⑤ B 自身中心条目对齐新锚——迁移 refs 基于 before 收集，**首次切断时 centers
  // 尚不存在**（detached op 才写入），收集不到该条目 → at 会停在旧锚（dangling）。
  // 幂等：若迁移已改写 at（再切断场景），此处 findIndex 找不到旧锚则跳过。
  const newAt = anchorOfNode(staged, childId);
  if (newAt !== null && newAt !== beforeAt) {
    const rootNode = getNode(staged, root.id);
    const raw = rootNode?.note?.centers;
    if (rootNode && Array.isArray(raw)) {
      const list = raw.slice();
      const i = list.findIndex((c) => isRec(c) && c.at === beforeAt);
      if (i >= 0) {
        const cur = list[i];
        if (isRec(cur)) list[i] = { ...cur, at: newAt };
        const noteNew: Note = { ...(rootNode.note ?? {}) };
        noteNew.centers = list;
        const op: TreeOp = { type: 'update-node', id: root.id, patch: { note: noteNew } };
        ops.push(op);
        staged = applyOp(staged, op);
      }
    }
  }
  return { ok: true, ops, diagnostics: plan.diagnostics };
}

/**
 * 接回 detached 分支到目标父节点：move + 清 detached（坐标进历史区，保留位置记忆）。
 * 拒绝：接自身/接任意后代（成环）、深度超限、目标不存在、目标非 detached。
 */
export function planAttachIsland(
  root: EditableNode,
  childId: string,
  targetParentId: string,
): CutAttachPlan {
  if (childId === root.id) {
    return { ok: false, error: { code: 'is-root', message: '文档根不可接回' } };
  }
  const loc = findNode(root, childId);
  if (!loc) return { ok: false, error: { code: 'not-found', message: '目标节点不存在' } };
  const center = collectCenters(root).find((c) => c.nodeId === childId);
  if (!center?.detached) {
    return { ok: false, error: { code: 'not-detached', message: '该节点不是切断独立的分支' } };
  }
  const target = getNode(root, targetParentId);
  if (!target) {
    return { ok: false, error: { code: 'not-found', message: '目标父节点不存在' } };
  }
  if (targetParentId === childId) {
    return { ok: false, error: { code: 'attach-to-self', message: '不能接回到自身' } };
  }
  if (isWithin(loc.node, targetParentId)) {
    return { ok: false, error: { code: 'attach-to-descendant', message: '不能接回到自身子树内（成环）' } };
  }
  const dt = depthOf(root, targetParentId) ?? 0;
  const dMax = subtreeMaxDepth(loc.node);
  if (dt + 1 + dMax > MAX_NODE_DEPTH) {
    return {
      ok: false,
      error: {
        code: 'depth-limit',
        message: `接回后子树深度超限（目标深度 ${dt}，子树相对深度 ${dMax}，上限 H${MAX_NODE_DEPTH + 1}）`,
      },
    };
  }

  const beforeAt = anchorOfNode(root, childId) ?? '';
  // 事务内确保节点持有 cid（无则分配；降格/接回不回收节点 cid，再升格沿用）
  const { rootNote, nodeNote, allocated } = ensureNodeCid(root.note, loc.node.note);
  const ops: TreeOp[] = [
    { type: 'move-node', id: childId, targetParentId, index: target.children.length },
  ];
  if (allocated) {
    ops.push({ type: 'update-node', id: childId, patch: { note: nodeNote } });
  }
  // 清 detached（降格语义但**保留坐标**：坐标进 center_pos 历史区，再切断可吸附回原位）
  const noteAfterRemove = removeCenter(rootNote, beforeAt, false);
  ops.push({ type: 'update-node', id: root.id, patch: { note: noteAfterRemove } });

  let staged = simulate(root, ops);
  const refs = collectReferenceAnchors(root);
  const plan = planReferenceMigration(root, staged, refs);
  if (!plan.ok) {
    const c = plan.conflicts[0];
    return {
      ok: false,
      error: {
        code: 'reference-conflict',
        message: c
          ? formatReferenceConflict(c)
          : '引用迁移冲突：新路径不可唯一表示',
      },
    };
  }
  const mig = migrationOps(staged, plan.updates, ops);
  staged = mig.staged;
  return { ok: true, ops, diagnostics: plan.diagnostics };
}
