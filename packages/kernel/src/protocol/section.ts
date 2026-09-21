/**
 * Section 空间分区的读取访问器（v1.5.0 · Phase 1 子树锚定）。
 *
 * 协议形态（挂文档根节点 note，与 centers/edges/links/groups 同列）：
 *   <!--
 *   sections:
 *   - id: sec_9f3a
 *     title: 摩擦分析
 *     color: blue
 *     root: cid:7c2e1a
 *   -->
 *
 * 为什么不需要改 parser/serializer：自研 note YAML 已支持 sequence-of-mappings
 * （parser.ts 对象项三条件判定 + 续行字段）且序列化对称（serializer.ts 对象数组
 * 发 `- fk:` + 续行 `k:`）——本模块只做类型化读取与容错收窄，数据面零改动。
 *
 * 容错哲学（与 W-ORPHAN-NOTE 一致）：形态非法的条目**跳过但不丢弃**——
 * Note 原值透传保留，重新序列化时原样写回；本访问器只影响「读取侧看到什么」。
 */
import {
  DEFAULT_SECTION_COLOR,
  SECTION_COLORS,
  type Note,
  type SectionColor,
  type SectionSpec,
} from './types.js';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asOptString(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

/**
 * 读取侧的 color：**原样保留未知 token**（前向兼容）。
 *
 * 与渲染侧 `sectionColorOf` 分工明确：
 *  - 此处只做「是不是非空字符串」的形态校验，未知 token 如 `neon-future` 照收——
 *    这样存量文件的未来配色在「解析 → 序列化」往返中不会丢值；
 *  - `sectionColorOf` 才把未知值归一化到 slate 供渲染。
 *
 * 这里的一处断言是**有意为之的唯一收敛点**：`SectionSpec.color` 的静态类型是封闭联合，
 * 而读侧要开放接收任意字符串。断言被限制在本函数内，不扩散到调用方。
 */
function readSectionColor(v: unknown): SectionColor | undefined {
  return typeof v === 'string' && v !== '' ? (v as SectionColor) : undefined;
}

/** 收窄为已知配色 token（渲染侧归一化的判定依据） */
export function isKnownSectionColor(v: unknown): v is SectionColor {
  return typeof v === 'string' && (SECTION_COLORS as readonly string[]).includes(v);
}

/**
 * 读取 note 的 Section 清单（仅形态合法的条目：id/root 为非空字符串）。
 * 非数组、非对象项、缺 id/root 的条目一律跳过（原值仍在 note 中，不丢）。
 */
export function sectionsOf(note: Note | undefined | null): SectionSpec[] {
  const raw = note?.sections;
  if (!Array.isArray(raw)) return [];
  const out: SectionSpec[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = asOptString(item.id);
    const root = asOptString(item.root);
    if (!id || !root) continue;
    const spec: SectionSpec = { id, root };
    const title = asOptString(item.title);
    if (title !== undefined) spec.title = title;
    const color = readSectionColor(item.color);
    if (color !== undefined) spec.color = color;
    const members = asOptString(item.members);
    if (members !== undefined) spec.members = members;
    // YAML 标量不强制布尔：手写 `collapsed: true` 解析为字符串 'true'，两种形态都认
    const collapsedRaw: unknown = item.collapsed;
    if (collapsedRaw === true || collapsedRaw === 'true') spec.collapsed = true;
    out.push(spec);
  }
  return out;
}

/** 渲染用配色：已知 token 原样，未知/缺省回退 slate（原始值在 note 中透传不丢） */
export function sectionColorOf(spec: SectionSpec): SectionColor {
  return isKnownSectionColor(spec.color) ? spec.color : DEFAULT_SECTION_COLOR;
}

/** 生成一个 Section id（纯函数，无副作用；调用方决定是否使用） */
export function makeSectionId(seed = Date.now()): string {
  const s = Math.floor(seed).toString(36);
  const r = Math.floor(Math.random() * 0xffffff).toString(36);
  return `sec_${s}${r}`;
}

/**
 * 写入/更新一个 Section（按 id 匹配；不可变，不改传入值）。
 *
 * 与 upsertCenter 同构：**按 id 匹配**而非按 root——同一子树重复标记应复用既有条目
 * （调用方负责先用 sectionOf(rootId) 查重），避免手写 YAML/重复点击产出双条目。
 *
 * 透传纪律：list 里既有的**畸形条目**（形态非法的原值）原样保留，
 * 不因一次写入而丢弃——与 sectionsOf 的「跳过但不丢弃」一致。
 */
export function upsertSection(note: Note | undefined, spec: SectionSpec): Note {
  const base: Note = note ?? {};
  const raw = base.sections;
  const list: SectionSpec[] = Array.isArray(raw) ? [...raw] : [];
  const idx = list.findIndex((i) => isRecord(i) && i.id === spec.id);
  const next: SectionSpec = { id: spec.id, root: spec.root };
  if (spec.title !== undefined) next.title = spec.title;
  if (spec.color !== undefined) next.color = spec.color;
  if (spec.members !== undefined) next.members = spec.members;
  if (spec.collapsed === true) next.collapsed = true;
  const outList = idx >= 0 ? list.map((i, n) => (n === idx ? next : i)) : [...list, next];
  const out: Note = { ...base };
  out.sections = outList;
  return out;
}

/** 移除一个 Section（按 id；不可变）。找不到则原样返回。 */
export function removeSection(note: Note | undefined, sectionId: string): Note {
  const base: Note = note ?? {};
  const raw = base.sections;
  if (!Array.isArray(raw)) return base;
  const list = raw.filter((i) => !(isRecord(i) && i.id === sectionId));
  if (list.length === raw.length) return base;
  const out: Note = { ...base };
  if (list.length === 0) delete out.sections;
  else out.sections = list;
  return out;
}

