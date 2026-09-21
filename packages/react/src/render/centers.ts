/**
 * 中心（升格节点）数据层 —— G6′ 混合布局。
 *
 * 与 freeEdges.ts 同构：`root.note.centers` 是**文档级**标注数组，
 * 节点数据保持纯净（不往节点上挂坐标/方向）。
 *
 * 设计（与边 manual、markvault placement 同一原则）：
 * - **路径锚**定位（`node:总览/工作`），不记 id —— astToEditable 每次解析都重新生成 id
 * - **坐标缺失即自动布局**：没有 x/y 的中心由 layoutForest 按 bounds 排开
 * - **存在即生效**：只有列在 centers 里的节点才是中心；移除即降格回自动布局
 * - **降格不清坐标**（用户决策④）：坐标留在 note 里，再升格可吸附回原位；
 *   真正要复位时才显式清除 x/y
 *
 * 纯函数，零 DOM。
 */
import {
  applyOp,
  buildCidIndex,
  getNode,
  parseLinkAnchor,
  resolveLinkAnchor,
  type AnchorResolutionState,
  type EditableNode,
  type GrowDir,
  type Note,
  type TreeOp,
} from '@mindcanvas/kernel';
import { anchorOfNode, collectEntityOccurrences, splitEntityAnchor } from './freeEdges.js';

/** 文档级中心标注（root.note.centers 数组成员；协议透传形状） */
export interface DocCenter {
  /** 路径锚（node:根/… 或实体 @kind:id）；cid 出现后降级为可过期的位置提示 */
  at: string;
  /**
   * 稳定子树身份（cid: c7 短码；节点 note.cid 标量的一对一关联）。
   * 解析优先级高于 at；分配后随节点存续，改名/移动/降格不回收。
   */
  cid?: string;
  /** 生长方向；缺省 right */
  dir?: string;
  /** 世界坐标（.mm.md 往返后可能为数字串——读侧 num() 容错还原） */
  x?: number | string;
  y?: number | string;
  /** G3：与语义父级的跨岛父子连接显示；缺省 hide（兼容旧数据） */
  parent_link?: string;
  /** G2（A5）：切断独立标记（往返后可能为 "true" 字符串；detached 岛不画容器边、禁普通降格） */
  detached?: boolean | string;
}

/** 中心读侧诊断（dup cid 等；line 不适用，省略） */
export interface CenterDiagnostic {
  code: string;
  message: string;
  /** 涉及 cid（如 dup-cid） */
  cid?: string;
}

/** 解析后的中心（会话内；key = `c${index}` 定位 root.note.centers 数组） */
export interface Center {
  key: string;
  index: number;
  /** 解析到的节点 id（null = 锚失效，渲染层应跳过） */
  nodeId: string | null;
  /** 原始路径锚（at）；cid 存在时仅为位置提示 */
  at: string;
  /** 稳定身份（优先解析依据；可能缺省=旧数据） */
  cid?: string;
  /** 生长方向（已校验，非法值回落 right） */
  dir: GrowDir;
  /** 坐标（null = 交由 layoutForest 自动排列） */
  pos: { x: number; y: number } | null;
  /** G3 跨岛父子连接显示（已校验；缺省 hide） */
  parentLink: 'show' | 'hide';
  /** G2（A5）：切断标记（detached 中心禁普通降格、不画容器线） */
  detached: boolean;
  state: AnchorResolutionState;
  /** 读侧诊断（重复 cid 等） */
  diagnostics?: CenterDiagnostic[];
}

/** parent_link 合法值校验（缺省/非法 → hide） */
export function isParentLink(v: unknown): v is 'show' | 'hide' {
  return v === 'show' || v === 'hide';
}

export const GROW_DIRS: readonly GrowDir[] = ['right', 'left', 'down', 'up'];

const GROW_DIR_VALUES: readonly string[] = GROW_DIRS;

export function isGrowDir(v: unknown): v is GrowDir {
  return typeof v === 'string' && GROW_DIR_VALUES.includes(v);
}

/** 未知协议形状的窄化守卫（读侧容错；运行期类型收窄，不做断言转换） */
export function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * 分配下一个 cid（纯函数）。
 *
 * - `root.note.next_cid` 为单调计数器，分配后 +1，**永不复用**（手写重复 cid 由 collectCenters 读侧 dup 诊断拦截）；
 * - next_cid 经 .mm.md 往返会变为数字串（v1.0.0 协议），此处容错强转；缺省从 1 起；
 * - 返回新的 note 对象（不可变），不改动传入值。
 */
export function assignCid(note: Note | undefined): { cid: string; note: Note } {
  const base: Note = note ?? {};
  const raw = base.next_cid;
  const next =
    typeof raw === 'number' && Number.isFinite(raw)
      ? raw
      : typeof raw === 'string' && /^\d+$/.test(raw)
        ? Number(raw)
        : 1;
  const cid = `c${next}`;
  const out: Note = { ...base, next_cid: next + 1 };
  return { cid, note: out };
}

/**
 * 确保某节点持有 cid：已有则沿用（降格不回收、再升格沿用）；无则分配新 cid 并写入节点 note，
 * 同时 bump `root.note.next_cid`。
 *
 * 返回更新后的 rootNote / nodeNote 与 cid（allocated 标记是否 newly 分配）。
 * 调用方负责把 nodeNote 作为 update-node 的 patch 提交（事务内自动分配埋点）。
 */
export function ensureNodeCid(
  rootNote: Note | undefined,
  nodeNote: Note | undefined,
): { rootNote: Note; nodeNote: Note; cid: string; allocated: boolean } {
  const existing = typeof nodeNote?.cid === 'string' ? nodeNote.cid : undefined;
  if (existing) {
    return { rootNote: rootNote ?? {}, nodeNote: nodeNote ?? {}, cid: existing, allocated: false };
  }
  const { cid, note } = assignCid(rootNote);
  return { rootNote: note, nodeNote: { ...(nodeNote ?? {}), cid }, cid, allocated: true };
}

/**
 * 数值容错读取：note 数值字面量经 .mm.md 往返（kernel parseMm 裸标量保字符串，
 * v1.0.0 冻结协议行为）会变成 "250" 这类数字串——读侧还原，不回写。
 */
function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** detached 布尔容错（同上：往返后 "true" 字符串） */
function isDetachedFlag(v: unknown): boolean {
  return v === true || v === 'true';
}

/**
 * 实体节点锚解析（@kind:id[#N] → 树中实体节点的 nodeId）。
 *
 * anchorOfNode 对实体节点产出 `@kind:id`（多次出现加 #N），但内核 resolveLinkAnchor
 * 对实体锚只验语法、不定位节点（ADR-0004：实体存在性归 resolver）。中心投影需要
 * nodeId 才能划岛，故在此按 anchorOfNode 的逆向规则解析：
 * 唯一出现 → 裸锚命中；多次出现 → 必须带 #N（裸锚多命中 = stale，与内核同名歧义语义一致）。
 */
function resolveEntityCenterAnchor(
  root: EditableNode,
  at: string,
): { state: AnchorResolutionState; nodeId?: string } {
  const { base, occurrence } = splitEntityAnchor(at);
  const list = collectEntityOccurrences(root).get(base);
  if (!list || list.length === 0) return { state: 'dangling' };
  if (occurrence === null) {
    if (list.length > 1) return { state: 'stale' };
    return { state: 'well-formed', nodeId: list[0] };
  }
  const idx = occurrence - 1;
  const hit = idx >= 0 ? list[idx] : undefined;
  return hit !== undefined ? { state: 'well-formed', nodeId: hit } : { state: 'dangling' };
}

/**
 * 收集全部中心（路径锚 / cid 锚 → nodeId）。
 *
 * 解析优先级：**cid 优先，at 为位置提示**。条目带 cid 时按 cid 索引定位 nodeId
 * （改名/移动不 dangling）；无 cid 的旧数据走 path/entity 解析（完全兼容）。
 * 重复 cid → **first-wins**（保留首个，后续丢弃）并在首个 Center 上记 `dup-cid` 诊断。
 */
export function collectCenters(root: EditableNode): Center[] {
  const raw = root.note?.centers;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const cidIndex = buildCidIndex(root);
  const seenCid = new Map<string, number>();
  const diagByIndex = new Map<number, CenterDiagnostic[]>();
  const out: Center[] = [];
  raw.forEach((item, index) => {
    if (!isRec(item)) return;
    const cid = typeof item.cid === 'string' ? item.cid : undefined;

    // 重复 cid：first-wins，丢弃重复条目并记录诊断（挂在首个条目上）
    if (cid !== undefined) {
      if (seenCid.has(cid)) {
        const firstIdx = seenCid.get(cid);
        // 防御式收窄（has 已保证存在，但不用非空断言——预算纪律 bang 只减不增）
        if (firstIdx !== undefined) {
          const arr = diagByIndex.get(firstIdx) ?? [];
          arr.push({ code: 'dup-cid', message: `重复 cid 已忽略（沿用首个条目）`, cid });
          diagByIndex.set(firstIdx, arr);
        }
        return;
      }
      seenCid.set(cid, index);
    }

    // 脏数据守卫：cid 与 at 均缺失的条目无任何锚来源，跳过（保持旧行为；
    // cid-only 条目合法——cid 即锚，at 可缺省为位置提示）。
    if (cid === undefined && typeof item.at !== 'string') return;

    let res: { state: AnchorResolutionState; nodeId?: string } | null = null;
    if (cid !== undefined) {
      // cid 优先：按节点 note.cid 索引定位（身份稳定，改名/移动不 dangling）
      const nodeId = cidIndex.get(cid);
      res =
        nodeId !== undefined
          ? { state: 'well-formed', nodeId }
          : { state: 'dangling' };
    } else if (typeof item.at === 'string') {
      const parsed = parseLinkAnchor(item.at);
      if (parsed && parsed.kind === 'node') {
        res = resolveLinkAnchor(root, parsed);
      } else if (parsed && parsed.kind === 'entity') {
        // 实体节点升格（G6″ A3）：@issue:8 这类锚同样定位到树中实体节点
        res = resolveEntityCenterAnchor(root, item.at);
      }
    }
    const x = num(item.x);
    const y = num(item.y);
    const at = typeof item.at === 'string' ? item.at : cid ? `cid:${cid}` : '';
    out.push({
      key: `c${index}`,
      index,
      nodeId: res?.nodeId ?? null,
      at,
      cid,
      dir: isGrowDir(item.dir) ? item.dir : 'right',
      // 坐标必须成对：缺一个就整体交给自动排列
      pos: x !== undefined && y !== undefined ? { x, y } : null,
      // G3：非法值回落 hide（缺省隐藏，兼容旧数据）
      parentLink: isParentLink(item.parent_link) ? item.parent_link : 'hide',
      // G2：detached 标记（容错 "true" 字符串；其它值视为未切断——旧数据兼容）
      detached: isDetachedFlag(item.detached),
      state: res?.state ?? 'stale',
      ...(diagByIndex.has(index) ? { diagnostics: diagByIndex.get(index) } : {}),
    });
  });
  // dup-cid 诊断后挂：重复条目在处理首个条目之后才被识别（forEach 顺序），
  // 首个 Center 此时已入列——统一收尾合并，避免诊断记录在案却无人挂载。
  for (const c of out) {
    const diags = diagByIndex.get(c.index);
    if (diags && c.diagnostics === undefined) c.diagnostics = diags;
  }
  return out;
}

/**
 * 写入/更新一个中心（按路径锚匹配；已存在则更新 dir/pos）。
 * 返回新的 note 对象（不可变；不改动传入值）。
 */
export function upsertCenter(
  note: Note | undefined,
  at: string,
  patch: {
    dir?: GrowDir;
    x?: number;
    y?: number;
    parentLink?: 'show' | 'hide';
    detached?: boolean;
    /** 稳定身份（升格/cut/attach 事务内分配或沿用；缺省不改动既有 cid） */
    cid?: string;
  } = {},
): Note {
  const raw = note?.centers;
  const list: DocCenter[] = Array.isArray(raw)
    ? raw.filter((i): i is DocCenter => isRec(i))
    : [];
  const idx = list.findIndex((c) => c.at === at);
  const prev: DocCenter = (idx >= 0 ? list[idx] : undefined) ?? { at };
  const next: DocCenter = { ...prev, at };
  if (patch.dir !== undefined) next.dir = patch.dir;
  // cid 仅在显式指定时写入（分配/沿用）；不传则保留 prev 既有 cid（降格移除由 removeCenter 处理）
  if (patch.cid !== undefined) next.cid = patch.cid;
  // G3：parent_link 只在显式指定时写入（新升格缺省不写 = hide，协议面保持最小）
  if (patch.parentLink !== undefined) {
    if (patch.parentLink === 'show') next.parent_link = 'show';
    else delete next.parent_link; // hide 为缺省语义，不落字段
  }
  // G2：detached 只在显式指定时写入；false 删字段（未切断 = 缺省语义）
  if (patch.detached !== undefined) {
    if (patch.detached === true) next.detached = true;
    else delete next.detached;
  }

  // 未显式给坐标时，优先保留当前已有的有效成对坐标；仅在新升格或当前位置无效时恢复历史位置。
  const currentX = num(prev.x);
  const currentY = num(prev.y);
  const history = collectCenterHistory(note);
  const remembered = history.get(at);
  if (patch.x !== undefined && patch.y !== undefined) {
    next.x = patch.x;
    next.y = patch.y;
  } else if (currentX !== undefined && currentY !== undefined) {
    next.x = currentX;
    next.y = currentY;
  } else if (remembered) {
    next.x = remembered.x;
    next.y = remembered.y;
  } else {
    delete next.x;
    delete next.y;
  }
  // dir 缺省时补上，避免读取侧反复回落
  if (next.dir === undefined) next.dir = 'right';

  const outList = idx >= 0 ? list.map((c, i) => (i === idx ? next : c)) : [...list, next];
  const out: Note = { ...(note ?? {}) };
  out.centers = outList;
  return out;
}

/**
 * 移除一个中心（降格）。
 *
 * @param dropPos  false（默认）= **坐标进历史区**，再升格可吸附回原位（用户决策④）；
 *                 true = 连坐标一起丢弃，彻底复位
 */
export function removeCenter(note: Note | undefined, at: string, dropPos = false): Note {
  const base: Note = note ?? {};
  const raw = base.centers;
  if (!Array.isArray(raw)) return base;
  const list = raw.filter((i): i is DocCenter => isRec(i));
  const idx = list.findIndex((c) => c.at === at);
  if (idx < 0) return base;

  const centers = list.filter((_, i) => i !== idx);
  let out: Note = { ...base, centers };

  // 降格前把当前坐标留档（供再升格吸附回原位）
  if (!dropPos) {
    const cur = list[idx];
    const x = cur ? num(cur.x) : undefined;
    const y = cur ? num(cur.y) : undefined;
    if (x !== undefined && y !== undefined) out = rememberCenterPos(out, at, { x, y });
  } else {
    out = forgetCenterPos(out, at);
  }
  return out;
}

/**
 * 历史坐标暂存区：`root.note.center_pos`。
 * 「存在即生效」的补充 —— 降格后坐标从 centers 移除，但在此留档，
 * 再次升格时由 posOfHistory 读回，实现「吸附回原位」。
 */
export interface CenterPosEntry {
  at: string;
  x: number;
  y: number;
}

export function collectCenterHistory(note: Note | undefined): Map<string, { x: number; y: number }> {
  const raw = note?.center_pos;
  const out = new Map<string, { x: number; y: number }>();
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    if (!isRec(item)) continue;
    if (typeof item.at !== 'string') continue;
    const x = num(item.x);
    const y = num(item.y);
    if (x === undefined || y === undefined) continue;
    out.set(item.at, { x, y });
  }
  return out;
}

/** 写入历史坐标（覆盖同 at 的旧值） */
export function rememberCenterPos(
  note: Note | undefined,
  at: string,
  pos: { x: number; y: number },
): Note {
  const base: Note = note ?? {};
  const raw = base.center_pos;
  const list = Array.isArray(raw)
    ? raw.filter((i): i is CenterPosEntry => isRec(i))
    : [];
  const rest = list.filter((e) => e.at !== at);
  const out: Note = { ...base };
  out.center_pos = [...rest, { at, x: pos.x, y: pos.y }];
  return out;
}

/** 丢弃历史坐标（彻底复位） */
export function forgetCenterPos(note: Note | undefined, at: string): Note {
  const base: Note = note ?? {};
  const raw = base.center_pos;
  if (!Array.isArray(raw)) return base;
  const list = raw.filter((i): i is CenterPosEntry => isRec(i));
  const next = list.filter((e) => e.at !== at);
  if (next.length === list.length) return base;
  const out: Note = { ...base };
  out.center_pos = next;
  return out;
}

/** 升格为中心的事务计划 */
export type PromotePlan =
  | { ok: true; ops: TreeOp[]; cid: string }
  | { ok: false; error: { code: 'is-root' | 'not-found'; message: string } };

/**
 * 将某节点升格为中心（事务内自动分配 cid）。
 *
 * - 节点已有 cid → 沿用（降格不回收、再升格沿用既有身份），不 bump next_cid；
 * - 节点无 cid → 分配新 cid（bump next_cid，永不复用），写入节点 note 与 centers 条目；
 * - 中心条目同时持有 `at`（当前路径提示）与 `cid`（稳定身份）；
 * - 坐标沿用 upsertCenter 历史区逻辑（再升格可吸附回原位）。
 *
 * 返回 update-node ops（root + 节点），交由 controller.applyTransaction 原子提交。
 */
export function planPromoteCenter(
  root: EditableNode,
  nodeId: string,
  opts: { dir?: GrowDir; pos?: { x: number; y: number } } = {},
): PromotePlan {
  if (nodeId === root.id) {
    return { ok: false, error: { code: 'is-root', message: '文档根不可升格为中心' } };
  }
  const node = getNode(root, nodeId);
  if (!node) {
    return { ok: false, error: { code: 'not-found', message: '目标节点不存在' } };
  }
  const { rootNote, nodeNote, cid, allocated } = ensureNodeCid(root.note, node.note);
  const at = anchorOfNode(root, nodeId) ?? `cid:${cid}`;
  const ops: TreeOp[] = [];
  // ① 节点 note 写入 cid（仅新分配时需要；沿用则不改动既有值）
  if (allocated) {
    ops.push({ type: 'update-node', id: nodeId, patch: { note: nodeNote } });
  }
  // ② 中心条目（at + cid），坐标沿用历史区
  const centerPatch: {
    dir?: GrowDir;
    x?: number;
    y?: number;
    cid?: string;
  } = { dir: opts.dir ?? 'right', cid };
  if (opts.pos !== undefined) {
    centerPatch.x = opts.pos.x;
    centerPatch.y = opts.pos.y;
  }
  const nextRootNote = upsertCenter(rootNote, at, centerPatch);
  ops.push({ type: 'update-node', id: root.id, patch: { note: nextRootNote } });
  return { ok: true, ops, cid };
}
