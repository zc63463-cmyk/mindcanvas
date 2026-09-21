/**
 * 子树框编辑（局部大纲）的 `note.frame` 读写访问器（FO-A1 · 协议步）。
 *
 * 协议形态（挂**成框节点自身**的 note；设计 §3.1）：
 *   frame:
 *     version: 1
 *     depth: 2      # 有限整数 ≥ 1；从框根起算，前 depth 层进大纲
 *
 * 为什么不需要改 parser/serializer（零数据面改动）：
 *  - **写**：serializer 对对象值一律走**内联 JSON**（`frame: "{\"version\":1,\"depth\":2}"`），
 *    与 `links` / `attrs` 同口径；
 *  - **读**：parser 的顶层标量 `{...}` 分支 JSON 感知（该形态回读为**数值**对象），
 *    v1.7.0 起 `tryParseNestedMapping` 还能读手写的**块形态**（`frame:` + 缩进子键）。
 *    注意：块形态的值经 `scalarValue` 保留为**字符串**（无嵌套数值收敛），本访问器的
 *    严格口径（`typeof depth === 'number'`）不认它——原值仍透传不丢，等同「旧客户端
 *    忽略 `frame`」，整树按普通节点渲染（设计 §8 降级行）。
 *
 * 容错哲学（与 `section.ts` / W-ORPHAN-NOTE 一致）：读侧只做形态收窄，
 * **不认 ≠ 丢弃**——note 里的原值原样保留，重新序列化时原样写回。
 *
 * 写侧校验：`depth` 非法直接抛 `Error('invalid frame depth')`（设计 §8「写时校验拒绝」），
 * 调用方（命令层）负责先校验/钳制，不把非法值写进文档。
 *
 * FO-A2 增补（本文件下半部）：**相对深度**（框根 = 0，与文档根的 `depthOf` 无关）、
 * **子树最大相对深度**、**成框许可**（设计 §3.3：大纲层拒 / 挂载层允）、**depth 钳制**。
 */
import type { EditableNode } from '../tree/treeOps.js';
import type { FrameSpec, Note } from './types.js';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 规范化 depth：仅接受**有限整数 ≥ 1**（`Number.isInteger` 同时排除 NaN 与 ±Infinity）；
 * 其余形态（小数、0/负数、字符串 '2'、布尔、null、undefined）一律 `undefined`。
 */
export function normalizeFrameDepth(raw: unknown): number | undefined {
  if (typeof raw !== 'number') return undefined;
  if (!Number.isInteger(raw)) return undefined;
  return raw >= 1 ? raw : undefined;
}

/**
 * 读取节点的框标记：`version` 必须严格 `=== 1`、`depth` 合法，否则 `undefined`（非框）。
 * 只读形态收窄——note 中不合口径的原值原样透传，不在此处删除或改写。
 */
export function frameOf(note: Note | undefined | null): FrameSpec | undefined {
  const raw: unknown = note?.frame;
  if (!isRecord(raw)) return undefined;
  if (raw.version !== 1) return undefined;
  const depth = normalizeFrameDepth(raw.depth);
  if (depth === undefined) return undefined;
  return { version: 1, depth };
}

/**
 * 写入/更新框标记（不可变，不改传入 note）：无 note 时新建 `{ frame }`，其它键原样保留。
 * `depth` 非法 → 抛 `Error('invalid frame depth')`（写时拒绝，不产出半合法文档）。
 */
export function setFrame(note: Note | undefined, depth: number): Note {
  if (normalizeFrameDepth(depth) === undefined) throw new Error('invalid frame depth');
  return { ...(note ?? {}), frame: { version: 1, depth } };
}

/**
 * 删除框标记（拆框；不可变）：删键即回普通节点，**其它 note 字段不动**。
 * 无 `frame` 键时原样返回（no-op 不产生新对象，同 `removeSection` 口径）；
 * `note` 为 undefined 时透传 undefined。形态非法的 `frame` 值也一并删（拆框 = 删键）。
 */
export function clearFrame(note: Note | undefined): Note | undefined {
  if (note === undefined) return undefined;
  if (!Object.hasOwn(note, 'frame')) return note;
  const out: Note = { ...note };
  delete out.frame;
  return out;
}

// ── 相对深度与子树高度（设计 §3.2 D1：框根 d = 0） ──────────────────────────

/**
 * 相对**框根**的深度：框根自身 `0`，后代为路径边数；不在该子树内（含「祖先方向」）→ `null`。
 *
 * 与 `treeOps.depthOf` 的分工（**禁止混用**）：`depthOf` 从**文档根**起算且 root = 1，
 * 只服务于「移动后的深度上限校验」；框的深度语义一律以框根为 0（设计 §3.2 D1）。
 */
export function relativeDepth(frameRoot: EditableNode, nodeId: string): number | null {
  return relDepthFrom(frameRoot, nodeId, 0);
}

function relDepthFrom(node: EditableNode, nodeId: string, d: number): number | null {
  if (node.id === nodeId) return d;
  for (const child of node.children) {
    const found = relDepthFrom(child, nodeId, d + 1);
    if (found !== null) return found;
  }
  return null;
}

/** 子树内的最大相对深度：框根仅自身 → `0`；有后代 → 最深后代的相对深度。 */
export function subtreeMaxRelativeDepth(frameRoot: EditableNode): number {
  return deepestRelDepth(frameRoot, 0);
}

function deepestRelDepth(node: EditableNode, d: number): number {
  let max = d;
  for (const child of node.children) max = Math.max(max, deepestRelDepth(child, d + 1));
  return max;
}

// ── 成框许可（设计 §3.3：大纲层拒、挂载层允） ────────────────────────────────

/** 拒绝成框的原因：`not-found` = 候选不在树内；`inside-ancestor-outline` = 落在最近成框祖先的大纲层。 */
export type FrameDenyReason = 'not-found' | 'inside-ancestor-outline';

/**
 * 成框许可（一期纪律，设计 §3.3）：
 *
 * 1. 沿候选的祖先链（**不含自身**）自近及远找第一个带合法 `frameOf` 的祖先 F（其 `depth = D`）；
 * 2. 候选相对 F 的深度 `d`：`1 ≤ d ≤ D` → 拒（F 的**大纲层**内，禁止「大纲里再成框」）；
 *    `d > D` → 允（F 的**空间挂载层**——这正是 N3 修正允许的形态）；
 * 3. 无成框祖先（含候选即文档根）→ 允；候选不在树内 → `not-found`。
 *
 * 「以**最近**成框祖先为准」是照 §3.3 原文执行：候选若落在 F 的挂载层，更远的框管辖的
 * 也是「挂载层上的独立框」，与 F 的裁定一致；若不设此限，就得回读更远祖先的 `depth`，
 * 而那层的判断已被更近的框接管（且「框内嵌框」在写路径上本就进不来）。
 */
export function canCreateFrame(
  root: EditableNode,
  nodeId: string,
): { ok: true } | { ok: false; reason: FrameDenyReason } {
  const chain = chainToNode(root, nodeId, []);
  if (chain === null) return { ok: false, reason: 'not-found' };
  // 自近及远（chain 末项 = 候选自身，故从 length - 2 起）
  for (let i = chain.length - 2; i >= 0; i -= 1) {
    const ancestor = chain[i];
    if (ancestor === undefined) continue; // noUncheckedIndexedAccess 收窄（i 恒在界内）
    const spec = frameOf(ancestor.note);
    if (spec === undefined) continue; // 无框 / 形态非法 = 非框，继续向更远祖先找
    const d = chain.length - 1 - i; // 候选相对该祖先的深度（≥ 1：循环已排除自身）
    return d <= spec.depth ? { ok: false, reason: 'inside-ancestor-outline' } : { ok: true };
  }
  return { ok: true };
}

/** `node` → `nodeId` 的节点链（含两端）；不在子树内 → null */
function chainToNode(
  node: EditableNode,
  nodeId: string,
  trail: EditableNode[],
): EditableNode[] | null {
  const next = [...trail, node];
  if (node.id === nodeId) return next;
  for (const child of node.children) {
    const found = chainToNode(child, nodeId, next);
    if (found !== null) return found;
  }
  return null;
}

// ── 深度钳制（设计 §4.1 步进器范围 / §5.3 改深度） ───────────────────────────

/** 深度设计上限：与规格 §4.1「范围 1 … min(8, 子树最大深度)」一致 */
const FRAME_DEPTH_MAX = 8;

/**
 * 钳制 depth 到当前子树可用范围：`max(1, min(requested, max(1, maxRel), 8))`。
 *
 * 非有限数（NaN / ±Infinity）或小数入参先收敛（向下取整 / 回落 1），保证返回值**恒为**
 * `setFrame` 可接受的有限整数 ≥ 1——不让 NaN、小数漏到写侧去触发 `invalid frame depth`。
 * 对合法整数入参，结果与上式逐值等价。
 */
export function clampFrameDepth(requested: number, maxRel: number): number {
  const want = Math.max(1, floorOr(requested, 1));
  const cap = Math.max(1, floorOr(maxRel, 1));
  return Math.max(1, Math.min(want, cap, FRAME_DEPTH_MAX));
}

/** 有限数 → 向下取整；非有限（NaN / ±Infinity）→ fallback */
function floorOr(v: number, fallback: number): number {
  return Number.isFinite(v) ? Math.floor(v) : fallback;
}
