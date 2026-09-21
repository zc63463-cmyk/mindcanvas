/**
 * .mm.md 解析器 · entity-ref v0.2.1 两阶段文法完整实现
 * Phase 1 行词法（P1–P8 首中即止 + NOTE 状态机）→ Phase 2 结构装配（标题栈 + 列表栈）
 *
 * 关键实现决策（与规格 golden tests 对齐）：
 * - 重复 H1：诊断 E-MULTI-ROOT 后保持 H1 栈语义（弹空栈 → 挂到根下），
 *   使后续 H2 归入降级根名下（golden T23；规格伪代码 "level←2" 与 T23 期望矛盾，以期望为准）。
 * - AST 深度 ≤16：超限节点不挂载且不压栈（子树自然上提，golden T17）。
 * - 笔记绑定「其后第一个结构节点」；合成空根不接收笔记（golden T24）。
 */

import type { Diagnostic, EntityRef, MindNode, Note, ParseResult } from './types.js';
import { REGISTERED_KINDS, validateId } from './types.js';

const MAX_DEPTH = 16;

// ---------- 行词法 ----------

type LineToken =
  | { t: 'note-open' }
  | { t: 'inline-comment' }
  | { t: 'blank' }
  | { t: 'heading'; level: number; title: string }
  | { t: 'heading-bad' }
  | { t: 'list'; indent: number; content: string }
  | { t: 'stray' };

const RE_NOTE_OPEN = /^[ \t]*<!--[ \t]*$/;
const RE_NOTE_CLOSE = /^[ \t]*-->[ \t]*$/;
const RE_INLINE_COMMENT = /^[ \t]*<!--.*-->[ \t]*$/;
const RE_BLANK = /^[ \t]*$/;
const RE_HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const RE_HEADING_BAD = /^#{7,}([ \t].*)?$/;
const RE_LIST = /^([ \t]*)-[ \t]+(.*?)[ \t]*$/;

function classifyLine(line: string): LineToken {
  if (RE_NOTE_OPEN.test(line)) return { t: 'note-open' };
  if (RE_INLINE_COMMENT.test(line)) return { t: 'inline-comment' };
  if (RE_BLANK.test(line)) return { t: 'blank' };
  const h = line.match(RE_HEADING);
  if (h) return { t: 'heading', level: h[1].length, title: h[2] };
  if (RE_HEADING_BAD.test(line)) return { t: 'heading-bad' };
  const li = line.match(RE_LIST);
  if (li && li[2].length > 0) {
    const indent = li[1].replace(/\t/g, '    ').length;
    return { t: 'list', indent, content: li[2] };
  }
  return { t: 'stray' };
}

// ---------- 列表项内容分类（R1 → R2 → R3） ----------

const RE_REF = /^@([a-z][a-z0-9_]*):(.*)$/;
/** 引用意图探测（含大写 kind / 数字开头 kind，如 @ISSUE:42、@2fa:x → W-INVALID-REF） */
const RE_REF_INTENT = /^@([A-Za-z0-9_]+):/;
const RE_IMAGE = /^!\[([^\]]*)\]\(([^()\s]+)\)$/;

interface ContentParse {
  node: MindNode;
  diag?: { code: string; message: string };
}

function parseContent(content: string): ContentParse {
  const refMatch = content.match(RE_REF);
  if (refMatch) {
    const kind = refMatch[1];
    const id = refMatch[2].trim();
    if ((REGISTERED_KINDS as readonly string[]).includes(kind)) {
      if (validateId(kind, id)) {
        return { node: { type: 'entity', ref: { kind, id }, children: [] } };
      }
      return {
        node: { type: 'text', text: content, children: [] },
        diag: { code: 'W-INVALID-REF', message: `@${kind}:${id} id 校验失败` },
      };
    }
    // 未注册 kind：保留 EntityNode（前向兼容）+ W-UNKNOWN-KIND
    return {
      node: { type: 'entity', ref: { kind, id }, children: [] },
      diag: { code: 'W-UNKNOWN-KIND', message: `kind 未注册: ${kind}` },
    };
  }
  if (RE_REF_INTENT.test(content)) {
    return {
      node: { type: 'text', text: content, children: [] },
      diag: { code: 'W-INVALID-REF', message: `有引用意图但 kind 非法: ${content}` },
    };
  }
  const imgMatch = content.match(RE_IMAGE);
  if (imgMatch) {
    return { node: { type: 'image', url: imgMatch[2], children: [] } };
  }
  return { node: { type: 'text', text: content, children: [] } };
}

/** 从列表项内容提取实体引用（idea「演化」区块等场景复用；非引用行返回 null） */
export function tryParseRef(content: string): EntityRef | null {
  const cp = parseContent(content.trim());
  return cp.node.type === 'entity' ? (cp.node.ref ?? null) : null;
}

// ---------- 笔记块 YAML（容忍未知字段；非法结构 → null → E-INVALID-NOTE-YAML） ----------

const RE_KEY = /^([^:\s][^:]*):[ \t]*(.*)$/;
const RE_YAML_LIST_ITEM = /^[ \t]*-[ \t]+(.*)$/;

function stripQuotes(v: string): string {
  if (v.length >= 2) {
    const a = v[0];
    const b = v[v.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) {
      // 对称反转义（serializer 写引号标量时转义了 \\ 与 \"）
      // v1.3.0：多行描述（note.desc）以 \n 转义写入，此处需还原为真实换行；
      // 若不做此还原，"a\nb" 会被反转义成 "anb"（丢换行且吞字符）。
      return v
        .slice(1, -1)
        .replace(/\\(.)/g, (_, ch: string) => (ch === 'n' ? '\n' : ch === 't' ? '\t' : ch));
    }
  }
  return v;
}

/** 标量值解析：{ / [ 起始 → JSON（attrs 内联对象等）；其余按带引号字符串 */
function scalarValue(v: string): unknown {
  const s = stripQuotes(v.trim());
  if (s.startsWith('{') || s.startsWith('[')) {
    try {
      return JSON.parse(s);
    } catch {
      return s;
    }
  }
  return s;
}

/**
 * 尝试解析一层嵌套 mapping（v1.7.0）：`key:` 空值 + 后续「缩进 > 0 的 key: value」行
 * （无 '-' 项）。返回 null = 不是嵌套 mapping（交回调用方原判别路径：列表 / 空串）。
 * 仅一层；值经 scalarValue（保留字符串形态，数字/布尔由消费端容错收敛）。
 */
function tryParseNestedMapping(
  lines: readonly string[],
  i: number,
): { obj: Record<string, unknown>; next: number } | null {
  let k = i + 1;
  while (k < lines.length && lines[k]?.trim() === '') k++;
  const first = lines[k];
  if (first === undefined) return null;
  if (!/^[ \t]/.test(first)) return null; // 下一非空行无缩进 → 不是嵌套
  const trimmedFirst = first.trim();
  if (trimmedFirst.match(RE_YAML_LIST_ITEM)) return null; // '-' 项 → 列表路径
  if (trimmedFirst.match(RE_KEY) === null) return null;
  const obj: Record<string, unknown> = {};
  let j = k;
  while (j < lines.length) {
    const line = lines[j];
    if (line === undefined) break;
    const t = line.trim();
    if (t === '') {
      j++;
      continue;
    }
    const fm = /^[ \t]/.test(line) && !t.startsWith('-') ? t.match(RE_KEY) : null;
    if (fm === null || fm[1] === undefined) break;
    obj[fm[1]] = scalarValue(fm[2] ?? '');
    j++;
  }
  if (Object.keys(obj).length === 0) return null;
  return { obj, next: j };
}

function parseNoteYaml(body: string): Note | null {
  // 剥离笔记公共缩进（列表下注释块常带缩进）：键/列表项不带前导空白，方可 RE_KEY 解析
  const rawLines = body.split('\n');
  let minIndent = Infinity;
  for (const l of rawLines) {
    if (l.trim() === '') continue;
    const n = l.match(/^[ \t]*/)?.[0]?.length ?? 0;
    if (n < minIndent) minIndent = n;
  }
  const lines =
    minIndent === Infinity || minIndent === 0
      ? rawLines
      : rawLines.map((l) => (l.trim() === '' ? l : l.slice(minIndent)));
  const note: Note = {};
  let sawKey = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }
    const m = line.match(RE_KEY);
    if (!m) return null; // 顶层不是 mapping → 整个笔记丢弃
    const key = m[1];
    const value = m[2].trim();
    if (value === '') {
      // v1.7.0：嵌套 mapping（key: 空值 + 下一非空行「缩进的 key: value」，非 '-' 项）
      // → 一层嵌套对象（note.lens 等结构化字段）。此前该形态落入列表分支：
      // 无 '-' 项 → note[key]=''，后续缩进行顶层匹配失败 → E-INVALID-NOTE-YAML
      // **整条笔记丢弃（连 dir 等合法字段一起）**——失败模式过重，改为支持一层嵌套。
      // 值经 scalarValue（保留字符串形态；数字/布尔由消费端容错收敛，见 beamSide 读取器）。
      const nested = tryParseNestedMapping(lines, i);
      if (nested !== null) {
        note[key] = nested.obj;
        i = nested.next;
        sawKey = true;
        continue;
      }
      // 列表：字符串项（旧行为）或扁平对象项（1.1.0，links 等）。
      // 对象项判别（宁保守不误判）：未引号 + "- key: value" 形态 + 紧随续行字段（缩进 key: value）。
      // 仅由形态+续行判定，不做首项决定论——冒号字符串列表（qa/decisions/rel）行为不变。
      const items: Array<string | Record<string, unknown>> = [];
      let i0 = i + 1;
      const isObjItem = (text: string): boolean => {
        if (text.startsWith('"') || text.startsWith("'")) return false; // 引号开头 = 字符串项
        if (!text.match(RE_KEY)) return false;
        // 续行探测：下一非空行有缩进且为 key: value
        for (let k = i0 + 1; k < lines.length; k++) {
          if (lines[k]!.trim() === '') continue;
          return /^[ \t]/.test(lines[k]!) && lines[k]!.trim().match(RE_KEY) !== null;
        }
        return false;
      };
      let j = i0;
      while (j < lines.length) {
        if (lines[j]!.trim() === '') break;
        const trimmed = lines[j]!.trim();
        const dash = trimmed.match(RE_YAML_LIST_ITEM);
        if (dash) {
          if (isObjItem(dash[1]!)) {
            const om = dash[1]!.match(RE_KEY)!;
            const item: Record<string, unknown> = { [om[1]!]: scalarValue(om[2] ?? '') };
            let k = j + 1;
            while (k < lines.length) {
              if (lines[k]!.trim() === '') break;
              const t2 = lines[k]!.trim();
              if (/^[ \t]/.test(lines[k]!) && !t2.startsWith('-') && t2.match(RE_KEY)) {
                const fm = t2.match(RE_KEY)!;
                item[fm[1]!] = scalarValue(fm[2] ?? '');
                k++;
                continue;
              }
              break;
            }
            items.push(item);
            j = k;
            continue;
          }
          items.push(stripQuotes(dash[1].trim()));
          j++;
          continue;
        }
        break;
      }
      if (items.length > 0) {
        note[key] = items;
        i = j;
      } else {
        note[key] = '';
        i++;
      }
    } else {
      // 顶层标量：{...} 形态 → 尝试 JSON（结构化标注对象，如 note.edge）；失败回落字符串
      const s = stripQuotes(value);
      if (s.startsWith('{') && s.endsWith('}')) {
        try {
          note[key] = JSON.parse(s);
        } catch {
          note[key] = s;
        }
      } else {
        note[key] = s;
      }
      i++;
    }
    sawKey = true;
  }
  return sawKey ? note : null;
}

// ---------- 结构装配 ----------

interface HeadingEntry {
  level: number;
  node: MindNode;
  depth: number;
}

interface ListEntry {
  indent: number;
  node: MindNode;
  depth: number;
}

/** 主入口：.mm.md 文本 → ParseResult（root/refs/diagnostics） */
export function parseMm(text: string): ParseResult {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const diagnostics: Diagnostic[] = [];
  let root: MindNode | null = null;
  const headingStack: HeadingEntry[] = [];
  let listStack: ListEntry[] = [];
  let inNote = false;
  let noteOpenLine = 0;
  let noteBody: string[] = [];
  let pendingNote: { note: Note; line: number } | null = null;

  const bindNote = (node: MindNode): void => {
    if (pendingNote !== null) {
      node.note = pendingNote.note;
      pendingNote = null;
    }
  };

  /** 挂载（含深度检查）；返回子深度，超限返回 null（不挂载不压栈） */
  const attach = (
    parent: MindNode,
    parentDepth: number,
    node: MindNode,
    line: number,
  ): number | null => {
    if (parentDepth + 1 > MAX_DEPTH) {
      diagnostics.push({
        code: 'E-DEPTH-EXCEEDED',
        line,
        message: `AST 深度超过 ${MAX_DEPTH}，节点不挂载（子树上提）`,
      });
      return null;
    }
    parent.children.push(node);
    return parentDepth + 1;
  };

  const synthRoot = (line: number): void => {
    diagnostics.push({ code: 'E-NO-ROOT', line, message: '无根：合成空标题根（不接收笔记）' });
    root = { type: 'text', text: '', children: [] };
    headingStack.length = 0;
    headingStack.push({ level: 1, node: root, depth: 1 });
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNo = idx + 1;
    const line = lines[idx];

    if (inNote) {
      if (RE_NOTE_CLOSE.test(line)) {
        inNote = false;
        const note = parseNoteYaml(noteBody.join('\n'));
        if (note !== null) {
          if (pendingNote !== null) {
            diagnostics.push({
              code: 'W-NOTE-SHADOWED',
              line: pendingNote.line,
              message: '前一未绑定笔记块被遮蔽',
            });
          }
          pendingNote = { note, line: noteOpenLine };
        } else if (noteBody.some((l) => l.trim() !== '')) {
          diagnostics.push({
            code: 'E-INVALID-NOTE-YAML',
            line: noteOpenLine,
            message: '笔记块体不是合法 YAML mapping，笔记丢弃',
          });
        }
        // else 分支：空块（`<!--` `-->` 之间全空白）容忍为「无笔记」，不出诊断。
        // v1.7.1：历史写端曾为空 note（{}）落空块，旧文件重解析不该报「非法 YAML」；
        // 下次保存后空块自然消失（serializer 已不落空块）。
        noteBody = [];
      } else {
        noteBody.push(line);
      }
      continue;
    }

    const tok = classifyLine(line);
    switch (tok.t) {
      case 'note-open':
        inNote = true;
        noteOpenLine = lineNo;
        noteBody = [];
        break;
      case 'inline-comment':
      case 'blank':
        break;
      case 'heading-bad':
        diagnostics.push({
          code: 'E-DEPTH-EXCEEDED',
          line: lineNo,
          message: '标题层级超过 6（≥7 个 #），行忽略',
        });
        break;
      case 'heading': {
        let level = tok.level;
        if (level === 1) {
          if (root === null) {
            root = { type: 'text', text: tok.title, children: [] };
            bindNote(root);
            headingStack.length = 0;
            headingStack.push({ level: 1, node: root, depth: 1 });
            listStack = [];
            break;
          }
          diagnostics.push({
            code: 'E-MULTI-ROOT',
            line: lineNo,
            message: '多根：H1 降级为根下分支（保持 H1 栈语义）',
          });
          // 保持 level 1（golden T23：后续 H2 挂到降级根名下）
        }
        if (root === null) {
          synthRoot(lineNo);
        }
        while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
          headingStack.pop();
        }
        const node: MindNode = { type: 'text', text: tok.title, children: [] };
        bindNote(node);
        const top = headingStack.length > 0 ? headingStack[headingStack.length - 1] : null;
        const parent = top !== null ? top.node : (root as MindNode);
        const parentDepth = top !== null ? top.depth : 1;
        const childDepth = attach(parent, parentDepth, node, lineNo);
        if (childDepth !== null) {
          headingStack.push({ level, node, depth: childDepth });
        }
        listStack = [];
        break;
      }
      case 'list': {
        if (root === null) {
          synthRoot(lineNo);
        }
        while (listStack.length > 0 && listStack[listStack.length - 1].indent >= tok.indent) {
          listStack.pop();
        }
        const cp = parseContent(tok.content);
        const node = cp.node;
        if (cp.diag) diagnostics.push({ ...cp.diag, line: lineNo });
        bindNote(node);
        const parentEntry: { node: MindNode; depth: number } | null =
          listStack.length > 0
            ? listStack[listStack.length - 1]
            : headingStack.length > 0
              ? headingStack[headingStack.length - 1]
              : null;
        const parent = parentEntry !== null ? parentEntry.node : (root as MindNode);
        const parentDepth = parentEntry !== null ? parentEntry.depth : 1;
        const childDepth = attach(parent, parentDepth, node, lineNo);
        if (childDepth !== null) {
          listStack.push({ indent: tok.indent, node, depth: childDepth });
        }
        break;
      }
      case 'stray':
        diagnostics.push({
          code: 'W-STRAY-LINE',
          line: lineNo,
          message: `杂散行: ${line.trim()}`,
        });
        break;
    }
  }

  if (inNote) {
    diagnostics.push({
      code: 'E-UNCLOSED-NOTE',
      line: noteOpenLine,
      message: '笔记块未闭合，整体丢弃',
    });
  }
  if (pendingNote !== null) {
    diagnostics.push({
      code: 'W-ORPHAN-NOTE',
      line: pendingNote.line,
      message: '孤儿笔记：其后无结构节点',
    });
  }

  const refs: EntityRef[] = [];
  if (root !== null) {
    const walk = (n: MindNode): void => {
      if (n.type === 'entity' && n.ref) refs.push(n.ref);
      n.children.forEach(walk);
    };
    walk(root);
  }

  return { root, refs, diagnostics };
}
