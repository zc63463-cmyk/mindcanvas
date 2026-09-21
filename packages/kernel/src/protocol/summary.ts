/**
 * 摘要节点（XMind 式概要）读取访问器（S1）。
 *
 * 协议形态（写在**摘要节点自己**的 note 上，与 centers/links/sections 同列）：
 *   <!--
 *   summary_of:
 *     from: cid:c7
 *     to: cid:c9
 *   -->
 *   - 第 2 章全量对齐
 *
 * 为什么不需要改 parser/serializer：块形态走 v1.7.0 的一层嵌套 mapping 判定
 * （`key:` 空值 + 缩进子键），内联 JSON 走顶层标量的 `{...}` 分支；两者都已支持，
 * 且序列化对称（对象值 → 内联 JSON）。本模块只做类型化读取与容错收窄，数据面零改动。
 *
 * 容错哲学（与 section.ts / frame.ts / W-ORPHAN-NOTE 一致）：读侧只做形态收窄，
 * **不认 ≠ 丢弃**——坏形态原值仍在 note 中，重新序列化原样写回；本访问器只影响
 * 「读取侧看到什么」。三态解析与诊断见 `registry/summary-anchor.ts`。
 */
import type { Note, SummarySpec } from './types.js';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 非空字符串才收（空串 / 缺字段 / 非字符串一律视为「这个字段没有值」） */
function asOptString(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

/**
 * 读取 note 的范围锚（严格收窄：`from` / `to` **两者皆为非空字符串**才返回）。
 *
 * 任一端缺失/形态非法 → `undefined`（调用方据此把该节点当普通节点处理）；
 * 原值仍在 note 里，不被本函数改写或删除——这是「坏锚不静默删除」的第一道保证。
 * `summary_of` 内的**未知字段不参与收窄也不丢弃**（前向兼容：未来新增键不会
 * 让存量文件的现有锚失效）。
 */
export function summaryOf(note: Note | undefined | null): SummarySpec | undefined {
  const raw = note?.summary_of;
  if (!isRecord(raw)) return undefined;
  const from = asOptString(raw.from);
  const to = asOptString(raw.to);
  if (from === undefined || to === undefined) return undefined;
  return { from, to };
}

/**
 * 写入/更新范围锚（不可变，不改传入值）。
 *
 * 与 `upsertSection` 同构：**按 key 覆盖**而非追加——同一节点只可能有一条摘要锚
 * （重复写入应替换范围，不是产生第二条）。其它 note 字段原样保留。
 */
export function upsertSummaryOf(note: Note | undefined, spec: SummarySpec): Note {
  const base: Note = note ?? {};
  const out: Note = { ...base };
  out.summary_of = { from: spec.from, to: spec.to };
  return out;
}

/**
 * 移除范围锚（不可变）。键不存在 → **原引用返回**（供调用方零成本判等，
 * 与 `removeSection` 未命中的语义一致）。
 */
export function removeSummaryOf(note: Note | undefined): Note {
  const base: Note = note ?? {};
  if (!('summary_of' in base)) return base;
  const out: Note = { ...base };
  delete out.summary_of;
  return out;
}
