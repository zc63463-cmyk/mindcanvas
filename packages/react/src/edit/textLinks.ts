/**
 * 文本区域链接（Phase 1）——行内链接解析纯函数。
 *
 * 语法（T-A1，与 note.rel / sections.root 锚语法逐字一致）：
 *   [显示名](node:根/任务/A)   ← 路径锚（可读；改名后靠迁移跟随，L2）
 *   [显示名](cid:c7)           ← 稳定身份锚（改名/移动天然跟随）
 *   [显示名](@issue:88)       ← 实体锚（复用实体解析）
 *
 * 解析规则（判别测试钉死，tests/text-links.test.ts）：
 *   - label 内 `\]` 转义；未转义 `[` 使候选作废（宁可不认，绝不误伤）；
 *   - target 内 `\)` 转义；到未转义 `)` 终止；两端 trim；
 *   - 目标串可被 parseLinkAnchor 解析（node: / cid: / 实体）才是链接；
 *   - URL 形态（scheme:// 或 mailto/tel/…）不认（T-A6：外部链接另立，安全策略需白名单）；
 *   - 无 root → 只做语法解析；提供 root → resolveLinkAnchor 三态（well-formed/dangling/stale）。
 *
 * 存储纪律：**不存 nodeId**（会话内 id 每次解析都变）——原文即所写，本模块只做投影。
 * 本模块零 DOM、零副作用；`.tsx` 渲染在 chrome/TextLinkSpans.tsx（只读态展示）。
 */
import { parseLinkAnchor, resolveLinkAnchor } from '@mindcanvas/kernel';
import type { AnchorResolutionState, EditableNode, LinkAnchor } from '@mindcanvas/kernel';

/** 文本 span：纯文本段或链接段（区间 [start, end) 基于源文本） */
export interface TextSpan {
  kind: 'text' | 'link';
  /** 原文片段（link = 完整 `[label](target)` 原文；text = 纯文本段） */
  text: string;
  start: number;
  end: number;
  /** link：显示名（已去转义） */
  label?: string;
  /** link：锚原文（已去转义、trim；可直接喂 parseLinkAnchor） */
  anchorText?: string;
  /** link：目标串在源文本中的区间（含空白/转义原文；锚迁移替换只动这段） */
  targetStart?: number;
  targetEnd?: number;
  /** link：解析后的锚 */
  anchor?: LinkAnchor;
  /** link：三态（调用方提供 root 时才有） */
  state?: AnchorResolutionState;
  /** link：well-formed 命中节点 id（提供 root 时才有） */
  nodeId?: string;
  /** link：dangling/stale 的原因（提供 root 时才有） */
  reason?: string;
}

/** 替换操作（区间基于**同一原文**；applySpanReplace 内部从右往左应用防位移） */
export interface SpanReplacement {
  start: number;
  end: number;
  text: string;
}

/** 反转义：`\x` → 字面 x（label 与 target 同一口径） */
function unescapeEscapes(s: string): string {
  return s.replace(/\\([\s\S])/g, '$1');
}

/**
 * URL 形态判定（T-A6）：外部链接 Phase 1 不渲染为可点击（白名单 + rel 策略另立）。
 * `scheme://` 与已知非内部 scheme 一律不认作内部锚——避免 `[a](http://…)` 被
 * 实体锚正则吞成 `http` 实体。
 */
const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
const NON_ANCHOR_SCHEMES = new Set(['mailto', 'tel', 'file', 'data', 'javascript']);

function isUrlLike(target: string): boolean {
  if (URL_SCHEME_RE.test(target)) return true;
  const m = /^([^:\s][^:]*?):/.exec(target);
  return m !== null && NON_ANCHOR_SCHEMES.has((m[1] ?? '').toLowerCase());
}

/** 行内链接候选（结构成立，尚未判锚） */
interface LinkCandidate {
  labelRaw: string;
  targetRaw: string;
  /** 目标区间（`(` 后一位 → `)` 前一位） */
  targetStart: number;
  targetEnd: number;
  /** 右括号后一位（link span 的 end） */
  end: number;
}

/** 从 `[` 起尝试读取一个行内链接候选；结构不成立 → null（该位置不作为起点） */
function readLinkCandidate(text: string, start: number): LinkCandidate | null {
  let i = start + 1;
  let labelRaw = '';
  let closed = false;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (ch === '\\' && i + 1 < text.length) {
      labelRaw += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === '[') return null; // 嵌套未转义 [ → 候选作废（宁可不认）
    if (ch === ']') {
      closed = true;
      i += 1;
      break;
    }
    labelRaw += ch;
    i += 1;
  }
  if (!closed || text.charAt(i) !== '(') return null;
  const targetStart = i + 1;
  let j = targetStart;
  let targetRaw = '';
  let tClosed = false;
  while (j < text.length) {
    const ch = text.charAt(j);
    if (ch === '\\' && j + 1 < text.length) {
      targetRaw += text.slice(j, j + 2);
      j += 2;
      continue;
    }
    if (ch === ')') {
      tClosed = true;
      break;
    }
    targetRaw += ch;
    j += 1;
  }
  if (!tClosed) return null;
  return { labelRaw, targetRaw, targetStart, targetEnd: j, end: j + 1 };
}

/**
 * 解析文本中的行内链接 → span 序列。
 *
 * @param root     提供时对每个链接做 resolveLinkAnchor 三态（渲染幽灵态用）
 * @param cidIndex 可选注入的 cid→nodeId 索引（调用方预建可省去每锚全树扫描）
 */
export function parseTextLinks(
  text: string,
  root?: EditableNode | null,
  cidIndex?: Map<string, string>,
): TextSpan[] {
  if (text === '') return [];
  const spans: TextSpan[] = [];
  let cursor = 0;
  let i = 0;
  while (i < text.length) {
    if (text.charAt(i) !== '[') {
      i += 1;
      continue;
    }
    const cand = readLinkCandidate(text, i);
    if (cand === null) {
      i += 1;
      continue;
    }
    const target = unescapeEscapes(cand.targetRaw).trim();
    const anchor = target === '' || isUrlLike(target) ? null : parseLinkAnchor(target);
    if (anchor === null) {
      // 非锚形态（URL / 空目标 / 不可解析）：不切段——保持原文按纯文本呈现
      i += 1;
      continue;
    }
    if (i > cursor) {
      spans.push({ kind: 'text', text: text.slice(cursor, i), start: cursor, end: i });
    }
    const span: TextSpan = {
      kind: 'link',
      text: text.slice(i, cand.end),
      start: i,
      end: cand.end,
      label: unescapeEscapes(cand.labelRaw),
      anchorText: target,
      targetStart: cand.targetStart,
      targetEnd: cand.targetEnd,
      anchor,
    };
    if (root) {
      const res = resolveLinkAnchor(root, anchor, cidIndex);
      span.state = res.state;
      if (res.nodeId !== undefined) span.nodeId = res.nodeId;
      if (res.reason !== undefined) span.reason = res.reason;
    }
    spans.push(span);
    cursor = cand.end;
    i = cand.end;
  }
  if (cursor < text.length) {
    spans.push({ kind: 'text', text: text.slice(cursor), start: cursor, end: text.length });
  }
  return spans;
}

/**
 * 按替换列表重写文本。
 *
 * **从右往左应用（防位移）**：多个替换区间都基于**同一原文**，若从左往右做，
 * 前一处替换改变了字符串长度，后面区间的偏移就全部错位。排序后自右向左应用，
 * 左侧区间不受右侧已发生的长度变化影响——这是调用方（锚迁移，L2）同字段
 * 多处替换的正确性前提。
 */
export function applySpanReplace(text: string, replacements: readonly SpanReplacement[]): string {
  if (replacements.length === 0) return text;
  const sorted = [...replacements].sort((a, b) => b.start - a.start);
  for (const r of sorted) {
    if (r.start < 0 || r.end < r.start || r.end > text.length) {
      throw new Error(
        `applySpanReplace: 替换区间越界 [${r.start}, ${r.end})（文本长度 ${text.length}）`,
      );
    }
  }
  for (let k = 1; k < sorted.length; k++) {
    const right = sorted[k - 1]; // start 更大（靠右）
    const left = sorted[k]; // start 更小（靠左）
    if (right === undefined || left === undefined) continue;
    if (left.end > right.start) {
      throw new Error('applySpanReplace: 替换区间重叠');
    }
  }
  let out = text;
  for (const r of sorted) {
    out = out.slice(0, r.start) + r.text + out.slice(r.end);
  }
  return out;
}

/**
 * 实体锚 → 树中携带该实体引用的节点 id（前序首个匹配；无 → null）。
 *
 * resolveLinkAnchor 对实体锚只做**语法**判定（well-formed 无 nodeId——实体是否存在
 * 由 resolver 判定，超出内核纯函数范畴）；跳转要落到树中的实体节点，本函数补上
 * 「语法 → 节点」的桥。接受 `@kind:id`（与节点锚名展示一致）与裸 `kind:id` 两种写法；
 * `#N` 消歧写法不猜测（宁可不跳，与 kernel 的歧义纪律一致）。
 */
export function findEntityNodeId(root: EditableNode, entityTarget: string): string | null {
  const want = entityTarget.startsWith('@') ? entityTarget.slice(1) : entityTarget;
  let found: string | null = null;
  const walk = (n: EditableNode): boolean => {
    if (n.type === 'entity' && n.ref && `${n.ref.kind}:${n.ref.id}` === want) {
      found = n.id;
      return true;
    }
    return n.children.some(walk);
  };
  walk(root);
  return found;
}

/**
 * 插入链接的首选锚（T-A7）：目标节点已有 cid → `cid:cX`（改名/移动天然跟随）；
 * 无 cid → 回退锚原样（路径锚 / 实体锚，靠 L2 迁移跟随）。
 * **不做全库补发**（T-A7 明确）：cid 只由升格/切断等显式事务分配。
 */
export function preferredLinkAnchor(
  root: EditableNode,
  nodeId: string,
  fallback: string,
): string {
  let cid: string | null = null;
  const walk = (n: EditableNode): boolean => {
    if (n.id === nodeId) {
      const c = n.note?.cid;
      cid = typeof c === 'string' && c !== '' ? c : null;
      return true;
    }
    return n.children.some(walk);
  };
  walk(root);
  return cid === null ? fallback : `cid:${cid}`;
}
