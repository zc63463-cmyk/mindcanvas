/**
 * 锚引用迁移纯函数（plan 工作包 A2，design §5 冻结算法）。
 *
 * 职责：布局岛迁移（子树升格为文档根直接分支等操作）改变节点文本路径后，
 * 把散落在 note 键中的路径锚（centers.at / center_pos.at / edges.from / edges.to /
 * links[].to / groups[].members）同步迁移到新路径——**不做字符串全局替换**：
 * 每条锚在 beforeRoot 解析到唯一 nodeId → 在 afterRoot 按 nodeId 重建锚文本 →
 * 回解析验证仍指向同一 id。
 *
 * 锚类别处置（design §5）：
 * - 节点路径锚 `node:根/…`：按 nodeId 迁移（本模块主路径）；
 * - 实体节点锚 `@kind:id[#N]`（react freeEdges.anchorOfNode 产出，指向树中实体节点）：
 *   before 按 ref + 出现序号定位 nodeId，after 按出现次数重建（唯一 → 裸锚，多次 → #N）；
 * - 纯实体锚 `kind:id`（无 @ 前缀）：存在性由 resolver 判定、不指向树节点 → 原样保留；
 * - manual / source 等边属性不在锚清单内（调用方只圈定锚字段），天然原样保留。
 *
 * 冲突语义（宁可不写也不错写）：
 * - 新路径不可唯一表示（本次操作新增的同级同名歧义 / 名含斜杠 / 目标失去锚名）→
 *   结构化冲突（code + 锚 + nodeId），**整批拒绝**（ok: false，无任何 updates 产出）；
 * - 旧文件已有的 dangling / 歧义 / 不可解析锚 → 保留原值 + 诊断，不阻断无关编辑。
 *
 * 纯函数，零 DOM、零注册表副作用。空名节点透明规则与内核 note-anchor.effectiveChildren
 * 对齐（E8：空名节点不占锚路径段，其子树上提一级）。
 */
import {
  buildCidIndex,
  parseLinkAnchor,
  resolveLinkAnchor,
} from './note-anchor.js';
import { getNode, pathOf, type EditableNode } from '../tree/treeOps.js';
import type { EntityRef } from '../protocol/types.js';

/** 受影响锚引用：调用方从 note 键展开（field 为定位串，透传回执，本模块不解释） */
export interface AnchorRef {
  /** 锚所在 note 的键（如 'root'；文档级 edges 亦记 'root'） */
  noteKey: string;
  /** 字段定位串，如 'centers[0].at' / 'edges[2].from' / 'groups[g1].members[1]' */
  field: string;
  /** 原始锚文本 */
  anchor: string;
  /**
   * 该锚所属对象的稳定 cid（centers 条目携带）。存在时按 cid 身份解析 nodeId，
   * 迁移后仅重建 `at` 位置提示（双轨；cid 不变），根治改名/移动 dangling。
   * 无 cid 的旧数据走 nodeId 路径匹配（行为不变）。
   */
  cid?: string;
}

/** 单条锚迁移结果（from !== to 才产出；锚文本未变不进 updates，天然幂等） */
export interface AnchorUpdate {
  noteKey: string;
  field: string;
  from: string;
  to: string;
}

/** 阻断性冲突：任一冲突 → 整批拒绝（不产出 updates） */
export interface ReferenceConflict {
  code:
    | 'anchor-ambiguous-path'
    | 'anchor-name-contains-slash'
    | 'anchor-target-unnamed'
    | 'target-lost'
    | 'migration-verify-failed';
  noteKey: string;
  field: string;
  anchor: string;
  /** before 解析到的 nodeId（路径锚与实体节点锚均有） */
  nodeId?: string;
  message?: string;
}

/** 非阻断诊断：保留原值，仅告警（旧 dangling / 旧歧义 / 不可解析 / 目标被删降级） */
export interface ReferenceDiagnostic {
  code: 'dangling-kept' | 'pre-existing-ambiguous' | 'unparsable-anchor' | 'target-lost-kept';
  noteKey: string;
  field: string;
  anchor: string;
  message?: string;
}

/**
 * 迁移计划。两个分支都带 diagnostics（ok: true 时为非阻断诊断；
 * ok: false 时 conflicts 非空且不产出 updates——整批拒绝）。
 */
export type ReferenceMigrationPlan =
  | { ok: true; updates: AnchorUpdate[]; diagnostics: ReferenceDiagnostic[] }
  | { ok: false; conflicts: ReferenceConflict[]; diagnostics: ReferenceDiagnostic[] };

// ---------- 锚名与有效子节点（对齐内核 note-anchor 未导出的同规则函数） ----------

/** 节点锚名：text 用文本；entity 用 `@kind:id`；其余（image / 无 ref / 空文本）为空 */
function anchorName(n: EditableNode): string {
  if (n.type === 'text') return n.text ?? '';
  if (n.type === 'entity' && n.ref) return `@${n.ref.kind}:${n.ref.id}`;
  return '';
}

/** 有效子节点：空名节点不占锚路径段，其子树上提一级（E8 修复规则） */
function effectiveChildren(n: EditableNode): EditableNode[] {
  const out: EditableNode[] = [];
  for (const c of n.children) {
    if (anchorName(c) === '') out.push(...effectiveChildren(c));
    else out.push(c);
  }
  return out;
}

/** 前序遍历收集同 ref 实体节点（保留出现顺序——#N 消歧的位次依据） */
function collectEntityOccurrences(root: EditableNode, ref: EntityRef): EditableNode[] {
  const out: EditableNode[] = [];
  const walk = (n: EditableNode): void => {
    if (n.type === 'entity' && n.ref && n.ref.kind === ref.kind && n.ref.id === ref.id) {
      out.push(n);
    }
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

/**
 * 实体锚拆分（对齐 react freeEdges.splitEntityAnchor 规则）：
 * 兼容 `@kind:id`（anchorOfNode 产出）/ `@@kind:id`（历史残留）/ `kind:id`（内核契约）；
 * `#N` 后缀仅当剥离后仍是合法实体锚才成立（避免误伤 id 自带 `#` 的实体）。
 */
function splitEntityAnchorLocal(anchor: string): { base: string; occurrence: number | null } {
  let s: string;
  if (anchor.startsWith('@@')) s = anchor.slice(1);
  else if (anchor.startsWith('@')) s = anchor;
  else s = `@${anchor}`;
  const m = s.match(/^(.+)#(\d+)$/);
  if (m && /^@[^:\s]+:[^\s]+$/.test(m[1])) {
    return { base: m[1], occurrence: Number(m[2]) };
  }
  return { base: s, occurrence: null };
}

/**
 * 实体节点锚解析（#N 感知）：`@kind:id` 唯一出现 → nodeId；
 * 多命中 → 'ambiguous'（裸锚在多出现时不可寻址——freeEdges 约定多次出现一律带 #N）；
 * `@kind:id#N` → 取前序第 N 个（1 起）；越界 / 非实体锚形态 → null（dangling）。
 */
function resolveEntityNodeAnchor(
  root: EditableNode,
  anchor: string,
): string | 'ambiguous' | null {
  const split = splitEntityAnchorLocal(anchor);
  const m = split.base.match(/^@([^:\s]+):(.+)$/);
  if (!m) return null;
  const ref: EntityRef = { kind: m[1], id: m[2] };
  const list = collectEntityOccurrences(root, ref);
  if (split.occurrence === null) {
    return list.length === 1 ? list[0].id : 'ambiguous';
  }
  const idx = split.occurrence - 1;
  return idx >= 0 && idx < list.length ? list[idx].id : null;
}

/**
 * 在 after 上按 nodeId 重建锚文本（design §5「新文本路径锚」）。
 * - 目标丢失 → target-lost；目标失去锚名（空文本 / ref 清除 / image）→ anchor-target-unnamed；
 * - 实体节点 → 全局锚（唯一裸 / 多次 #N，对齐 react anchorOfNode 两趟逻辑）；
 * - 其余 → 路径锚：沿 pathOf 收集有效名段（空名透明穿过），逐段校验
 *   「不含斜杠」与「在其父的有效子中唯一」——任一不满足即不可唯一表示。
 */
function buildAnchorFor(
  after: EditableNode,
  nodeId: string,
): { anchor: string } | { conflict: ReferenceConflict['code']; message: string } {
  const node = getNode(after, nodeId);
  if (!node) {
    return { conflict: 'target-lost', message: `引用目标在迁移后树上丢失: ${nodeId}` };
  }
  const name = anchorName(node);
  if (name === '') {
    return {
      conflict: 'anchor-target-unnamed',
      message: '目标失去锚名（空文本 / 实体 ref 清除 / image），透明空节点不可寻址',
    };
  }
  if (node.type === 'entity' && node.ref) {
    const list = collectEntityOccurrences(after, node.ref);
    return { anchor: list.length <= 1 ? name : `${name}#${list.indexOf(node) + 1}` };
  }
  const path = pathOf(after, nodeId);
  if (!path) {
    return { conflict: 'target-lost', message: `无法定位节点路径: ${nodeId}` };
  }
  const segs: string[] = [];
  const rootName = anchorName(after);
  if (rootName.includes('/')) {
    return { conflict: 'anchor-name-contains-slash', message: `根名含斜杠，路径锚不可表示: ${rootName}` };
  }
  if (rootName !== '') segs.push(rootName);
  let cur = after;
  for (const idx of path) {
    const parent = cur;
    const child = parent.children[idx];
    if (!child) return { conflict: 'target-lost', message: '路径遍历中断（树结构与 pathOf 不一致）' };
    cur = child;
    const seg = anchorName(child);
    if (seg === '') continue; // 透明空名节点：不占段，后代上提
    if (seg.includes('/')) {
      return { conflict: 'anchor-name-contains-slash', message: `节点名含斜杠，路径锚不可表示: ${seg}` };
    }
    const same = effectiveChildren(parent).filter((s) => anchorName(s) === seg).length;
    if (same > 1) {
      return { conflict: 'anchor-ambiguous-path', message: `同级同名歧义（解析无法唯一命中）: ${seg}` };
    }
    segs.push(seg);
  }
  return { anchor: `node:${segs.join('/')}` };
}

/** 记录一条非阻断诊断 */
function keepWithDiagnostic(
  diagnostics: ReferenceDiagnostic[],
  code: ReferenceDiagnostic['code'],
  ref: AnchorRef,
  message: string,
): void {
  diagnostics.push({ code, noteKey: ref.noteKey, field: ref.field, anchor: ref.anchor, message });
}

/** 记录一条阻断冲突 */
function pushConflict(
  conflicts: ReferenceConflict[],
  ref: AnchorRef,
  code: ReferenceConflict['code'],
  nodeId: string | undefined,
  message: string,
): void {
  conflicts.push({ code, noteKey: ref.noteKey, field: ref.field, anchor: ref.anchor, nodeId, message });
}

/**
 * buildAnchorFor 冲突的统一出口（R2-0）：三个调用点（cid / 路径锚 / 实体锚）共用。
 * tolerateMissingTargets 开启且冲突为 target-lost（引用目标在 after 上被删）→
 * 降级为 target-lost-kept 诊断（保留原锚），其余引用照常迁移——删除被引用节点
 * 不再阻断整批（R2-A4：仅 remove-node 场景开启，防掩盖其他 kernel bug）。
 */
function handleBuildConflict(
  conflicts: ReferenceConflict[],
  diagnostics: ReferenceDiagnostic[],
  ref: AnchorRef,
  built: { conflict: ReferenceConflict['code']; message: string },
  nodeId: string | undefined,
  tolerateMissingTargets: boolean,
): void {
  if (tolerateMissingTargets && built.conflict === 'target-lost') {
    keepWithDiagnostic(
      diagnostics,
      'target-lost-kept',
      ref,
      `引用目标在迁移后树上丢失，保留原值（${built.message}）`,
    );
    return;
  }
  pushConflict(conflicts, ref, built.conflict, nodeId, built.message);
}

/**
 * 锚引用迁移计划（design §5 冻结算法）。
 *
 * @param before 迁移前树
 * @param after  迁移后树（同一会话，nodeId 稳定）
 * @param refs   受影响锚清单（调用方从 centers.at / center_pos.at / edges.from /
 *               edges.to / links[].to / groups[].members 展开为 { noteKey, field, anchor }）
 * @returns ok: true → updates（from !== to 的条目，按输入顺序）+ 非阻断 diagnostics；
 *          ok: false → conflicts（聚合全部冲突）+ diagnostics，**整批拒绝**（无 updates）。
 */
export function planReferenceMigration(
  before: EditableNode,
  after: EditableNode,
  refs: readonly AnchorRef[],
  opts?: { tolerateMissingTargets?: boolean },
): ReferenceMigrationPlan {
  const updates: AnchorUpdate[] = [];
  const conflicts: ReferenceConflict[] = [];
  const diagnostics: ReferenceDiagnostic[] = [];
  // R2-A4：缺省 false = 现行语义逐位不变；仅 remove-node 场景由 controller 传 true
  const tolerateMissingTargets = opts?.tolerateMissingTargets === true;
  for (const ref of refs) {
    const parsed = parseLinkAnchor(ref.anchor);
    if (!parsed) {
      keepWithDiagnostic(diagnostics, 'unparsable-anchor', ref, '锚文本不可解析，保留原值');
      continue;
    }
    // —— cid 双轨：锚所属对象带稳定 cid → 按 cid 身份解析 nodeId ——
    // 迁移后仅重建 `at` 位置提示（cid 不变），根治改名/移动导致路径锚 dangling。
    // 无 cid 的旧数据落到下方 nodeId 路径匹配分支（行为不变）。
    if (ref.cid !== undefined) {
      const idxBefore = buildCidIndex(before);
      const nodeId = idxBefore.get(ref.cid);
      if (nodeId === undefined) {
        keepWithDiagnostic(
          diagnostics,
          'dangling-kept',
          ref,
          '迁移前 cid 在树中未命中（cid 已丢失），保留原值',
        );
        continue;
      }
      const built = buildAnchorFor(after, nodeId);
      if ('conflict' in built) {
        handleBuildConflict(conflicts, diagnostics, ref, built, nodeId, tolerateMissingTargets);
        continue;
      }
      const verify = resolveLinkAnchor(after, {
        kind: 'node',
        target: built.anchor.slice('node:'.length),
      });
      if (verify.state !== 'well-formed' || verify.nodeId !== nodeId) {
        pushConflict(
          conflicts,
          ref,
          'migration-verify-failed',
          nodeId,
          `新锚回解析未指回原节点（${verify.state}${verify.reason ? `: ${verify.reason}` : ''}）`,
        );
        continue;
      }
      if (built.anchor !== ref.anchor) {
        updates.push({ noteKey: ref.noteKey, field: ref.field, from: ref.anchor, to: built.anchor });
      }
      continue;
    }
    if (parsed.kind === 'node') {
      // —— 节点路径锚：before 解析 → nodeId ——
      const res = resolveLinkAnchor(before, { kind: 'node', target: parsed.target });
      if (res.state === 'dangling') {
        keepWithDiagnostic(diagnostics, 'dangling-kept', ref, '迁移前路径即失效（旧文件 dangling），保留原值');
        continue;
      }
      if (res.state !== 'well-formed' || res.nodeId === undefined) {
        keepWithDiagnostic(
          diagnostics,
          'pre-existing-ambiguous',
          ref,
          '迁移前路径即歧义/非法（旧文件 stale），保留原值',
        );
        continue;
      }
      const nodeId = res.nodeId;
      const built = buildAnchorFor(after, nodeId);
      if ('conflict' in built) {
        handleBuildConflict(conflicts, diagnostics, ref, built, nodeId, tolerateMissingTargets);
        continue;
      }
      // 回解析验证：新锚在 after 上必须 well-formed 且指向同一 nodeId
      const verify = resolveLinkAnchor(after, {
        kind: 'node',
        target: built.anchor.slice('node:'.length),
      });
      if (verify.state !== 'well-formed' || verify.nodeId !== nodeId) {
        pushConflict(
          conflicts,
          ref,
          'migration-verify-failed',
          nodeId,
          `新锚回解析未指回原节点（${verify.state}${verify.reason ? `: ${verify.reason}` : ''}）`,
        );
        continue;
      }
      if (built.anchor !== ref.anchor) {
        updates.push({ noteKey: ref.noteKey, field: ref.field, from: ref.anchor, to: built.anchor });
      }
    } else if (parsed.target.startsWith('@')) {
      // —— 实体节点锚（@kind:id[#N] / @@kind:id）：指向树中实体节点 ——
      const resolved = resolveEntityNodeAnchor(before, ref.anchor);
      if (resolved === 'ambiguous') {
        keepWithDiagnostic(
          diagnostics,
          'pre-existing-ambiguous',
          ref,
          '迁移前实体即多重出现且为裸锚（不可唯一寻址），保留原值',
        );
        continue;
      }
      if (resolved === null) {
        keepWithDiagnostic(diagnostics, 'dangling-kept', ref, '迁移前实体节点锚即无法命中，保留原值');
        continue;
      }
      const nodeId = resolved;
      const built = buildAnchorFor(after, nodeId);
      if ('conflict' in built) {
        handleBuildConflict(conflicts, diagnostics, ref, built, nodeId, tolerateMissingTargets);
        continue;
      }
      // 回解析验证：#N 感知解析必须指回同一 nodeId
      const verify = resolveEntityNodeAnchor(after, built.anchor);
      if (verify !== nodeId) {
        pushConflict(
          conflicts,
          ref,
          'migration-verify-failed',
          nodeId,
          '实体节点锚回解析未指回原节点',
        );
        continue;
      }
      if (built.anchor !== ref.anchor) {
        updates.push({ noteKey: ref.noteKey, field: ref.field, from: ref.anchor, to: built.anchor });
      }
    }
    // else：纯实体锚（kind:id）→ 存在性由 resolver 判定，不指向树节点，原样保留
  }
  if (conflicts.length > 0) {
    return { ok: false, conflicts, diagnostics };
  }
  return { ok: true, updates, diagnostics };
}
