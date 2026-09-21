/**
 * canonical writer · entity-ref v0.2.1
 * 写端规范：UTF-8 无 BOM、LF 行尾、2 空格列表缩进、笔记块独占三行（<!-- / YAML / -->）。
 *
 * 结构映射（round-trip 保证：parse(serialize(ast)) ≡ ast）：
 * - 根 → H1；纯文本链深度 2–6 → H2–H6
 * - 实体/图像节点、深度 >6 的节点、列表节点的子孙 → 列表项（相对缩进 2 空格/层）
 * - 笔记块置于所属节点行之前（绑定语义「其后第一个结构节点」）
 *
 * 已知歧义（协议层接受，编辑器规避）：文本内容恰为 @kind:id 或 ![](url) 形态时
 * 重新解析会变为实体/图像节点 —— 规格歧义点 1 的既定行为（加前缀词消歧）。
 */

import { parseMm } from './parser.js';
import type { MindNode, Note } from './types.js';

const KNOWN_NOTE_ORDER = ['one_liner', 'decisions', 'status', 'next', 'reminder'] as const;

/** YAML 标量序列化：空串/首尾空格/特殊起始字符/形如 key:value 时加双引号（防对象项误读） */
function yamlScalar(v: string): string {
  if (
    v === '' ||
    /^\s|\s$/.test(v) ||
    /^["'[\]{}>|&*!#%@`,]/.test(v) ||
    /^- /.test(v) ||
    v === '---' ||
    v === '-->' ||
    /^[^:\s][^:]*:/.test(v)
  ) {
    return (
      '"' +
      v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t') +
      '"'
    );
  }
  // v1.3.0：多行标量（note.desc 描述含 \n）必须以双引号 + \n 转义写入——
  // 否则裸换行会截断 YAML 行结构，重解析时第二行不是 key:value → E-INVALID-NOTE-YAML → 笔记整体丢弃。
  if (v.includes('\n') || v.includes('\t')) {
    return (
      '"' +
      v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t') +
      '"'
    );
  }
  return v;
}

/** 对象项字段值：嵌套对象/数组 → 内联 JSON；标量走 yamlScalar */
function yamlField(v: unknown): string {
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return yamlScalar(String(v));
}

function noteToLines(note: Note): string[] {
  const lines: string[] = [];
  const emit = (key: string, value: unknown): void => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      if (value.length === 0) return;
      lines.push(`${key}:`);
      for (const item of value) {
        if (item !== null && typeof item === 'object') {
          // 扁平对象项（links 等）：首字段随 "-"，其余字段续行缩进
          const entries = Object.entries(item as Record<string, unknown>);
          if (entries.length === 0) continue;
          const [fk, fv] = entries[0]!;
          lines.push(`  - ${fk}: ${yamlField(fv)}`);
          for (const [k, v] of entries.slice(1)) lines.push(`    ${k}: ${yamlField(v)}`);
        } else {
          lines.push(`  - ${yamlScalar(String(item))}`);
        }
      }
      return;
    }
    // 对象/数组值 → 内联 JSON（结构化标注对象）；yamlScalar 对 { 开头自动加引号
    const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (s === '') return;
    lines.push(`${key}: ${yamlScalar(s)}`);
  };
  for (const key of KNOWN_NOTE_ORDER) {
    if (key in note) emit(key, note[key]);
  }
  for (const [key, value] of Object.entries(note)) {
    if ((KNOWN_NOTE_ORDER as readonly string[]).includes(key)) continue;
    emit(key, value);
  }
  return lines;
}

type Mode = 'heading' | 'list';

function emitNode(
  out: string[],
  node: MindNode,
  mode: Mode,
  headingLevel: number,
  listIndent: number,
): void {
  // 规范分段：非首个 heading 前留一个空行。
  //
  // 纯文本事实源要求「用户手写的分段能保住」——否则首次保存会把整篇压成一坨，
  // 产生全量 diff，削弱 .mm.md 可读 / 可 diff / 外部编辑器友好的价值。
  //
  // 必须放在笔记块**之前**：笔记块归属其后的节点（解析规则如此），
  // 若放在笔记之后，空行会插到「笔记 ↔ 所属节点」之间，把两者拆开。
  if (mode === 'heading' && out.length > 0) out.push('');
  if (node.note) {
    // v1.7.1：空 note（{} / 全 undefined / 空数组）不落块——此前会写出 `<!--` `-->`
    // 空块，重解析判 E-INVALID-NOTE-YAML（往返自伤：清空字段的节点保存后报「非法 YAML」）。
    // 门禁侧 strip 用同一判据（noteToLines 空即视为无 note），三处口径一致。
    const noteLines = noteToLines(node.note);
    if (noteLines.length > 0) {
      out.push('<!--');
      out.push(...noteLines);
      out.push('-->');
    }
  }
  if (mode === 'heading') {
    out.push(`${'#'.repeat(headingLevel)} ${node.type === 'text' ? (node.text ?? '') : ''}`);
    // 子女全部为文本且未达 H6 → 继续标题链；混合子女 → 全部列表项（保证兄弟同父，round-trip 关键）
    const allText = node.children.length > 0 && node.children.every((ch) => ch.type === 'text');
    for (const child of node.children) {
      if (allText && headingLevel < 6) {
        emitNode(out, child, 'heading', headingLevel + 1, 0);
      } else {
        emitNode(out, child, 'list', 0, 0);
      }
    }
    return;
  }
  const indent = ' '.repeat(listIndent);
  if (node.type === 'text') {
    out.push(`${indent}- ${node.text ?? ''}`);
  } else if (node.type === 'image') {
    out.push(`${indent}- ![](${node.url ?? ''})`);
  } else {
    out.push(`${indent}- @${node.ref?.kind ?? 'unknown'}:${node.ref?.id ?? ''}`);
  }
  for (const child of node.children) {
    emitNode(out, child, 'list', 0, listIndent + 2);
  }
}

/** 序列化 AST → canonical .mm.md 文本（末尾带 LF） */
export function serializeMm(root: MindNode): string {
  const out: string[] = [];
  if (root.type === 'text') {
    emitNode(out, root, 'heading', 1, 0);
  } else {
    // 防御：非文本根（编辑器不应产生）—— 合成空 H1，原节点降为列表子项
    out.push('# ');
    emitNode(out, root, 'list', 0, 0);
  }
  return out.join('\n') + '\n';
}

/** round-trip 自校验：序列化产物重新解析后与原 AST 深度相等（保存前安全闸） */
export function verifyRoundTrip(root: MindNode): boolean {
  const first = { root };
  const text = serializeMm(root);
  const second = parseMm(text);
  return stableStringify(strip(second.root)) === stableStringify(strip(first.root));
}

/**
 * 稳定序列化：对象键按字典序输出。
 *
 * 为什么需要：`strip()` 产出的 `note` 字段来自 YAML 解析，键顺序取决于**原文书写顺序**；
 * 而 `serializeMm` 按 `KNOWN_NOTE_ORDER` 重排后再写入，重新解析得到的键顺序就可能不同
 * （例：原文 `desc → status`，往返后变成 `status → desc`）。
 *
 * 直接 `JSON.stringify` 比较对键顺序敏感，会把这种「内容完全一致、仅顺序不同」的情况
 * 误判为往返有损——而本函数是**保存前安全闸**，误报会拦住本该通过的保存。
 */
/**
 * 类型谓词：`unknown` → 普通对象（非 null、非数组）。
 *
 * 用它替代类型断言：断言会增加 asCast 债务，而债务预算门禁是「只减不增」的。
 * 谓词同样能收窄类型，且零债务。
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stableStringify(v: unknown): string {
  return JSON.stringify(v, (_key, val) => {
    if (isRecord(val)) {
      return Object.fromEntries(Object.keys(val).sort().map((k) => [k, val[k]]));
    }
    return val;
  });
}

function strip(n: MindNode | null): unknown {
  if (n === null) return null;
  const out: Record<string, unknown> = { type: n.type };
  if (n.type === 'text' && n.text !== undefined) out.text = n.text;
  if (n.type === 'image' && n.url !== undefined) out.url = n.url;
  if (n.type === 'entity' && n.ref !== undefined) out.ref = { kind: n.ref.kind, id: n.ref.id };
  // 与写端同判据（noteToLines 空 = 不落块）：空 note 在往返比较中等同于「无 note」，
  // 否则内存里的 {}（清空字段的遗留）会被安全闸误判为「往返有损」而拦住保存。
  if (n.note !== undefined && noteToLines(n.note).length > 0) out.note = n.note;
  out.children = n.children.map(strip);
  return out;
}
