/**
 * links/groups 锚定解析契约（spec §5.5「锚定与失联规则」，K5 镜子一/二压力点）。
 * 纯函数判定（不涉及渲染）：
 * - 节点锚：`node:根/分支/节点名`（路径锚，人可读 / LLM 可读）
 * - 实体锚：`kind:id`（如 `issue:88`）
 * - 解析状态三态：well-formed（唯一命中）/ dangling（路径失效：节点移动/改名）/ stale（歧义或格式非法，宁可不写也不错写）
 * 同名歧义用 `#序号` 消歧（spec §5.5）；本模块对多命中返回 stale 而非任意取一。
 */
import type { EditableNode } from '../tree/treeOps.js';

/** 锚定目标解析状态（spec §5.5） */
export type AnchorResolutionState = 'well-formed' | 'dangling' | 'stale';

/** 链接锚定目标：节点锚（路径）或实体锚（kind:id）或 cid 锚（稳定子树身份） */
export interface LinkAnchor {
  kind: 'node' | 'entity' | 'cid';
  /** 节点锚：`根/分支/节点名`；实体锚：`kind:id`；cid 锚：`c7`（node.note.cid 标量） */
  target: string;
}

/** 锚定解析结果（纯函数输出，无渲染语义） */
export interface AnchorResolution {
  state: AnchorResolutionState;
  /** well-formed 节点锚 → 命中节点 id */
  nodeId?: string;
  /** dangling / stale 的原因（可解释性，P8） */
  reason?: string;
}

/** 边方向（links 永远声明在源节点，dir 仅是渲染端箭头语义，不产生第二条数据） */
export type LinkDir = 'fwd' | 'back' | 'both';

const LINK_DIRS: readonly string[] = ['fwd', 'back', 'both'];

/** 解析后的链接条目（来源 note.links 数组） */
export interface ResolvedLink {
  /** 关系类型（语义注册表枚举，如 blocks / relates-to / duplicates / causes） */
  rel: string;
  /** 原始锚文本（`node:...` 或 `kind:id`） */
  to: string;
  anchor: LinkAnchor;
  state: AnchorResolutionState;
  nodeId?: string;
  reason?: string;
  /** 边方向（1.1.0 增补）：fwd 源→目标 / back 目标→源 / both 双向；缺省 = fwd */
  dir?: LinkDir;
  /** 边短标签（渲染为边中点 chip） */
  label?: string;
  /** 边备注（hover 浮窗呈现） */
  note?: string;
  /** 任意边属性透传 */
  attrs?: Record<string, unknown>;
  /** 非致命告警（如非法 dir 已回落 fwd）；不参与锚定三态判定 */
  warnings?: string[];
}

/** 解析后的圈定组成员（来源 group.members） */
export interface ResolvedGroupMember extends AnchorResolution {
  /** 原始成员锚（`node:...` 或 `kind:id`） */
  anchor: string;
}

/** 解析后的圈定组（来源根节点 note.groups） */
export interface ResolvedGroup {
  id: string;
  label?: string;
  sem_role?: string;
  /** 成员逐个解析（well-formed / dangling / stale） */
  members: ResolvedGroupMember[];
  /** 组级状态：任一成员 stale → stale；否则任一 dangling → dangling；否则 well-formed */
  state: AnchorResolutionState;
}

/**
 * 解析锚文本：`node:...` → 节点锚；`cid:...` → cid 锚（稳定子树身份）；
 * `kind:id` → 实体锚；无法识别 → null。
 *
 * cid 锚优先级在「解析」侧与 `node:` 并列（先于实体正则），避免被实体正则误吞为
 * `cid:c7` 实体锚。cid 锚在「解析结果」侧优先于 `at`（路径提示），根治改名/移动 dangling。
 */
export function parseLinkAnchor(to: string): LinkAnchor | null {
  if (to.startsWith('node:')) {
    const target = to.slice('node:'.length);
    return target.trim() === '' ? null : { kind: 'node', target };
  }
  if (to.startsWith('cid:')) {
    const target = to.slice('cid:'.length);
    return target.trim() === '' ? null : { kind: 'cid', target };
  }
  // 实体锚：`kind:id`（kind 非空、id 非空、不含空白；含冒号的 doc 路径等按首个冒号切分）
  const m = to.match(/^([^:\s][^:]*?):(.+)$/);
  if (!m) return null;
  return { kind: 'entity', target: to };
}

/**
 * 构建 cid → nodeId 索引（扫描全树 node.note.cid 标量）。
 * 纯函数、零 DOM；kernel 内建索引而非由 react 注入，避免 kernel 反向依赖 react
 * （仍允许调用方注入现成索引以省去扫描，见 resolveLinkAnchor 第三参）。
 */
export function buildCidIndex(root: EditableNode): Map<string, string> {
  const idx = new Map<string, string>();
  const walk = (n: EditableNode): void => {
    const c = n.note?.cid;
    if (typeof c === 'string' && c !== '' && !idx.has(c)) idx.set(c, n.id);
    n.children.forEach(walk);
  };
  walk(root);
  return idx;
}

/** 节点锚匹配名：text 节点用文本；entity 节点用 `@kind:id`；其余空 */
function nodeAnchorName(n: EditableNode): string {
  if (n.type === 'text') return n.text ?? '';
  if (n.type === 'entity' && n.ref) return `@${n.ref.kind}:${n.ref.id}`;
  return '';
}

/**
 * 有效子节点：空名节点（text 文本为空 / entity 无 ref）不占锚路径段，其子树上提一级。
 * E8 修复：此前空名节点会「截断」整个子树——用户把中间节点文字删空后，其下所有后代
 * 都无法被路径锚寻址，已有边集体退化为 dangling（用户反馈②「连线丢失」）。
 * 无空名节点的树 → 等价于 n.children，行为不变。
 */
function effectiveChildren(n: EditableNode): EditableNode[] {
  const out: EditableNode[] = [];
  for (const c of n.children) {
    if (nodeAnchorName(c) === '') out.push(...effectiveChildren(c));
    else out.push(c);
  }
  return out;
}

/**
 * 文本路径解析：首段匹配根自身（也允许省略根名，直接从根的子节点匹配），
 * 之后逐段匹配子节点名（空名节点透明穿过，见 effectiveChildren）。
 * 返回 { node } / { node: null, ambiguous: true }（多命中）/ { node: null, ambiguous: false }（未命中）。
 */
function resolveNodeTextPath(
  root: EditableNode,
  segments: string[],
): { node: EditableNode | null; ambiguous: boolean } {
  // 首段是否即根名
  const startsAtRoot = nodeAnchorName(root) === segments[0];
  let candidates: EditableNode[] = [root];
  for (let i = startsAtRoot ? 1 : 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const next: EditableNode[] = [];
    for (const c of candidates) {
      for (const child of effectiveChildren(c)) {
        if (nodeAnchorName(child) === seg) next.push(child);
      }
    }
    if (next.length === 0) return { node: null, ambiguous: false };
    if (next.length > 1) return { node: null, ambiguous: true };
    candidates = next;
  }
  return { node: candidates[0] ?? null, ambiguous: false };
}

/**
 * 解析单个锚（对树）：well-formed（唯一命中）/ dangling（路径失效）/ stale（歧义/非法）。
 *
 * @param cidIndex 可选注入的 cid→nodeId 索引（调用方预建，省去每次解析全树扫描）；
 *                 不传则内部用 buildCidIndex 现建（kernel 纯协议，零 react 依赖）。
 */
export function resolveLinkAnchor(
  root: EditableNode,
  anchor: LinkAnchor,
  cidIndex?: Map<string, string>,
): AnchorResolution {
  if (anchor.kind === 'cid') {
    const idx = cidIndex ?? buildCidIndex(root);
    const nodeId = idx.get(anchor.target);
    return nodeId !== undefined
      ? { state: 'well-formed', nodeId }
      : { state: 'dangling', reason: 'cid-not-found' };
  }
  if (anchor.kind === 'entity') {
    // 实体锚：语法合法即 well-formed（实体是否存在由 resolver 判定，超出内核纯函数范畴）
    const ok = /^[^:\s][^:]*?:[^:\s]+$/.test(anchor.target);
    return ok ? { state: 'well-formed' } : { state: 'stale', reason: 'malformed-entity-anchor' };
  }
  const segments = anchor.target.split('/').filter((s) => s.trim() !== '');
  if (segments.length === 0) return { state: 'stale', reason: 'empty-node-path' };
  const { node, ambiguous } = resolveNodeTextPath(root, segments);
  if (node) return { state: 'well-formed', nodeId: node.id };
  return ambiguous
    ? { state: 'stale', reason: 'ambiguous-node-path' }
    : { state: 'dangling', reason: 'path-not-found' };
}

/** 解析 note.links 数组（原始透传值 → 逐条解析状态；1.1.0 起透传 dir/label/note/attrs） */
export function resolveLinks(root: EditableNode, rawLinks: unknown): ResolvedLink[] {
  if (!Array.isArray(rawLinks)) return [];
  const out: ResolvedLink[] = [];
  for (const item of rawLinks) {
    if (typeof item !== 'object' || item === null) continue;
    const raw = item as {
      rel?: unknown;
      to?: unknown;
      dir?: unknown;
      label?: unknown;
      note?: unknown;
      attrs?: unknown;
    };
    if (typeof raw.to !== 'string') continue;
    const warnings: string[] = [];
    // dir 归一：合法三值透传；非法值回落 fwd + 告警（W 级，不参与三态判定）
    let dir: LinkDir | undefined;
    if (raw.dir !== undefined) {
      if (typeof raw.dir === 'string' && (LINK_DIRS as readonly string[]).includes(raw.dir)) {
        dir = raw.dir as LinkDir;
      } else {
        dir = 'fwd';
        warnings.push('invalid-dir-defaulted-fwd');
      }
    }
    const anchor = parseLinkAnchor(raw.to);
    if (!anchor) {
      out.push({
        rel: String(raw.rel ?? ''),
        to: raw.to,
        anchor: { kind: 'node', target: raw.to },
        state: 'stale',
        reason: 'unparsable-anchor',
      });
      continue;
    }
    const res = resolveLinkAnchor(root, anchor);
    out.push({
      rel: String(raw.rel ?? ''),
      to: raw.to,
      anchor,
      ...res,
      ...(dir !== undefined ? { dir } : {}),
      ...(typeof raw.label === 'string' ? { label: raw.label } : {}),
      ...(typeof raw.note === 'string' ? { note: raw.note } : {}),
      ...(typeof raw.attrs === 'object' && raw.attrs !== null
        ? { attrs: raw.attrs as Record<string, unknown> }
        : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  }
  return out;
}

/** 解析根节点 note.groups 数组（圈定组 + 成员逐个解析） */
export function resolveGroups(root: EditableNode, rawGroups: unknown): ResolvedGroup[] {
  if (!Array.isArray(rawGroups)) return [];
  const out: ResolvedGroup[] = [];
  for (const item of rawGroups) {
    if (typeof item !== 'object' || item === null) continue;
    const { id, label, sem_role, members } = item as {
      id?: unknown;
      label?: unknown;
      sem_role?: unknown;
      members?: unknown;
    };
    if (typeof id !== 'string') continue;
    const memberList: ResolvedGroupMember[] = [];
    if (Array.isArray(members)) {
      for (const m of members) {
        if (typeof m !== 'string') continue;
        const anchor = parseLinkAnchor(m);
        const res = anchor
          ? resolveLinkAnchor(root, anchor)
          : { state: 'stale' as const, reason: 'unparsable-anchor' };
        memberList.push({ anchor: m, ...res });
      }
    }
    // 组级状态：任一 stale → stale；否则任一 dangling → dangling；否则 well-formed
    const state: AnchorResolutionState = memberList.some((m) => m.state === 'stale')
      ? 'stale'
      : memberList.some((m) => m.state === 'dangling')
        ? 'dangling'
        : 'well-formed';
    out.push({
      id,
      label: typeof label === 'string' ? label : undefined,
      sem_role: typeof sem_role === 'string' ? sem_role : undefined,
      members: memberList,
      state,
    });
  }
  return out;
}
