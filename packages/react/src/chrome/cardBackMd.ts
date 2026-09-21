/**
 * P2b · 节点卡背面 markdown **块级解析**（纯函数；自 `CardBackMarkdown.tsx` 提取）。
 *
 * 定位（设计稿 `docs/specs/2026-09-14-node-card-flip-markdown-design.md` §5）：
 * 本模块承载背面渲染的**块模型 + 行扫描 parser**（零 React 依赖、零副作用，可直接单测）；
 * React 渲染（元素树）留在 `CardBackMarkdown.tsx`。行内口径不在本模块
 * （渲染侧 = `kernel/layout/inline.ts` 同口径：**strong / code / link** 三类）。
 *
 * 范围清单（支持）：标题 h1–h6 / 无序·有序·嵌套列表 / 任务列表（只读 checkbox）/
 *   引用块（可嵌套）/ 围栏代码块（``` 与 ~~~）/ 水平线 / 段落 /
 *   **GFM pipe 表格子集**（P2b 新增：`|` 分列（首尾管道可选）、header + delimiter 行判定、
 *   `\|` 转义不拆列、列数以 header 为准（多丢少补）、对齐三态）。
 *
 * 范围外（**按纯文本呈现，不执行**）：图片（`!` 前缀链接形态）、裸 HTML、
 *   HTML 表格 / colspan·rowspan、列表项内表格（沿 P1 列表简化口径）。
 *
 * 简化口径（子集取舍，均有测试钉住）：
 * - 表格判定：当前行含未转义 `|` 且**下一行**为合法 delimiter 行（列数 ≥ 1、
 *   每列 `:?-+:?`）；无 delimiter 行 → 维持段落语义（不升级为表格）；
 * - 表格数据行：非空且含未转义 `|`，否则表格结束（交回主循环）；
 * - 表格转义仅 `\|`（反引号行内代码**不**豁免管道拆分）；引用块内表格沿递归解析自然获得；
 * - 空行分隔块；列表内空行后随「同级条目」则列表延续，否则列表结束；
 * - 引用块要求每行带 `>`（不做 lazy continuation）；标题不做 setext、不剥闭合 `#`；
 * - 围栏未闭合 → 直到文末（内容原样）；缩进代码块 / 多段列表项不支持。
 */

// ---------- 块模型 ----------

/** 表格列对齐（null = 无标记；渲染侧按左对齐兜底） */
export type CardBackTableAlign = 'left' | 'center' | 'right' | null;

export type CardBackBlock =
  | { t: 'heading'; level: number; text: string }
  | { t: 'paragraph'; text: string }
  | { t: 'code'; text: string }
  | { t: 'hr' }
  | { t: 'quote'; blocks: CardBackBlock[] }
  | { t: 'list'; ordered: boolean; start: number; items: CardBackItem[] }
  | { t: 'table'; align: CardBackTableAlign[]; head: string[]; rows: string[][] };

export interface CardBackItem {
  /** 任务列表勾选态；`undefined` = 普通条目（非任务） */
  checked: boolean | undefined;
  /** 条目文本（多行合段；空串 = 无文本） */
  text: string;
  /** 嵌套列表（仅列表块；条目内其余缩进行按续行并入 text） */
  subs: CardBackBlock[];
}

const RE_FENCE = /^ {0,3}(`{3,}|~{3,})\s*(.*)$/;
const RE_HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const RE_HR = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/;
const RE_QUOTE = /^ {0,3}>[ \t]?(.*)$/;
const RE_LIST = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const RE_TASK = /^\[([ xX])\][ \t]+(.*)$/;
/** 表格 delimiter 单元格：`---` / `:--` / `:--:` / `--:`（至少一个 `-`） */
const RE_DELIM_CELL = /^:?-+:?$/;

/** 缩进宽度（tab 按 4 空格折算，与 kernel parser 的列表口径一致） */
function indentWidth(ws: string): number {
  return ws.replace(/\t/g, '    ').length;
}

interface FenceOpen {
  ch: string;
  len: number;
}

function matchFenceOpen(line: string): FenceOpen | null {
  const m = line.match(RE_FENCE);
  if (m === null) return null;
  const marker = m[1] ?? '';
  return { ch: marker.charAt(0), len: marker.length };
}

function isFenceClose(line: string, open: FenceOpen): boolean {
  const t = line.trim();
  if (t.length < open.len) return false;
  for (const c of t) {
    if (c !== open.ch) return false;
  }
  return true;
}

/** 该行是否可作为「新块起点」（段落的终止条件；与主循环的块判定同序） */
function startsBlock(line: string, next: string | undefined): boolean {
  return (
    matchFenceOpen(line) !== null ||
    RE_HEADING.test(line) ||
    RE_HR.test(line) ||
    RE_QUOTE.test(line) ||
    RE_LIST.test(line) ||
    isTableStart(line, next)
  );
}

// ---------- 表格（P2b：GFM pipe 子集） ----------

interface TableRowSplit {
  /** 拆出的单元格（已 trim；首尾管道剥离） */
  cells: string[];
  /** 是否含未转义 `|`（`\|` 不算） */
  hasPipe: boolean;
}

/**
 * 拆一行 pipe 行：未转义 `|` 分列、首尾管道可选（剥离）、`\|` 保字面。
 * 其余反斜杠序列**不解释**（原样保留，与行内口径一致）。
 */
function splitTableRow(line: string): TableRowSplit {
  const s = line.trim();
  const cells: string[] = [];
  let cur = '';
  let hasPipe = false;
  let escaped = false;
  let trailingPipe = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s.charAt(i);
    if (escaped) {
      cur += ch === '|' ? '|' : `\\${ch}`;
      escaped = false;
      trailingPipe = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      trailingPipe = false;
      continue;
    }
    if (ch === '|') {
      hasPipe = true;
      cells.push(cur);
      cur = '';
      trailingPipe = true;
      continue;
    }
    cur += ch;
    trailingPipe = false;
  }
  if (escaped) cur += '\\';
  cells.push(cur);
  if (hasPipe && s.startsWith('|')) cells.shift();
  if (trailingPipe) cells.pop();
  return { cells: cells.map((c) => c.trim()), hasPipe };
}

/** delimiter 行判定：列数 ≥ 1 且每列匹配 `:?-+:?`（trim 后） */
function isDelimiterRow(cells: readonly string[]): boolean {
  return cells.length > 0 && cells.every((cell) => RE_DELIM_CELL.test(cell));
}

/**
 * 表格起点判定：当前行含未转义 `|` 且下一行为合法 delimiter 行。
 * `startsBlock`（段落终止）与主循环共用本判定，保证两处口径一致。
 */
function isTableStart(line: string, next: string | undefined): boolean {
  if (next === undefined) return false;
  const head = splitTableRow(line);
  if (!head.hasPipe || head.cells.length === 0) return false;
  return isDelimiterRow(splitTableRow(next).cells);
}

/** 单个 delimiter 单元格 → 对齐标记（`:` 在左 = left、在右 = right、两侧 = center） */
function tableAlignOf(cell: string): CardBackTableAlign {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (left) return 'left';
  if (right) return 'right';
  return null;
}

/**
 * 解析表格（起点已由 `isTableStart` 确认）：header + delimiter + 数据行。
 * 列数以 header 为准（多丢少补；对齐数组与 header 同长，delimiter 缺列 = null）。
 */
function parseTable(
  lines: readonly string[],
  start: number,
  end: number,
): { block: Extract<CardBackBlock, { t: 'table' }>; next: number } {
  const head = splitTableRow(lines[start] ?? '').cells;
  const delim = splitTableRow(lines[start + 1] ?? '').cells;
  const align = head.map((_, j) => tableAlignOf(delim[j] ?? ''));
  const rows: string[][] = [];
  let i = start + 2;
  while (i < end) {
    const cur = lines[i] ?? '';
    if (cur.trim() === '') break;
    const row = splitTableRow(cur);
    if (!row.hasPipe) break;
    rows.push(head.map((_, j) => row.cells[j] ?? ''));
    i += 1;
  }
  return { block: { t: 'table', align, head, rows }, next: i };
}

// ---------- 行扫描 parser ----------

/**
 * 解析 `note.md` → 块序列。纯函数，无副作用（调用方决定是否渲染）。
 *
 * 简化口径（子集取舍，均有测试钉住）：
 * - 空行分隔块；列表内空行后随「同级条目」则列表延续，否则列表结束；
 * - 引用块要求每行带 `>`（不做 lazy continuation）；标题不做 setext、不剥闭合 `#`；
 * - 围栏未闭合 → 直到文末（内容原样）；缩进代码块 / 多段列表项不支持。
 */
export function parseCardBackMd(md: string): CardBackBlock[] {
  const lines = md.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  return parseBlocks(lines, 0, lines.length);
}

function parseBlocks(lines: readonly string[], start: number, end: number): CardBackBlock[] {
  const out: CardBackBlock[] = [];
  let i = start;
  while (i < end) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const fence = matchFenceOpen(line);
    if (fence !== null) {
      const code: string[] = [];
      i += 1;
      while (i < end) {
        const cur = lines[i] ?? '';
        if (isFenceClose(cur, fence)) {
          i += 1;
          break;
        }
        code.push(cur);
        i += 1;
      }
      out.push({ t: 'code', text: code.join('\n') });
      continue;
    }
    const h = line.match(RE_HEADING);
    if (h !== null) {
      out.push({ t: 'heading', level: (h[1] ?? '').length, text: h[2] ?? '' });
      i += 1;
      continue;
    }
    if (RE_HR.test(line)) {
      out.push({ t: 'hr' });
      i += 1;
      continue;
    }
    if (RE_QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < end) {
        const q = (lines[i] ?? '').match(RE_QUOTE);
        if (q === null) break;
        inner.push(q[1] ?? '');
        i += 1;
      }
      out.push({ t: 'quote', blocks: parseBlocks(inner, 0, inner.length) });
      continue;
    }
    const li = line.match(RE_LIST);
    if (li !== null) {
      const res = parseList(lines, i, end, indentWidth(li[1] ?? ''));
      out.push(res.block);
      i = res.next;
      continue;
    }
    if (isTableStart(line, lines[i + 1])) {
      const res = parseTable(lines, i, end);
      out.push(res.block);
      i = res.next;
      continue;
    }
    const para: string[] = [];
    while (i < end) {
      const cur = lines[i] ?? '';
      if (cur.trim() === '' || startsBlock(cur, lines[i + 1])) break;
      para.push(cur.trim());
      i += 1;
    }
    out.push({ t: 'paragraph', text: para.join('\n') });
  }
  return out;
}

function parseList(
  lines: readonly string[],
  start: number,
  end: number,
  baseIndent: number,
): { block: CardBackBlock; next: number } {
  const firstMarker = (lines[start] ?? '').match(RE_LIST)?.[2] ?? '-';
  const ordered = /\d/.test(firstMarker);
  const parsedStart = ordered ? Number.parseInt(firstMarker, 10) : 1;
  const startNum = Number.isFinite(parsedStart) ? parsedStart : 1;
  const items: CardBackItem[] = [];
  let i = start;
  while (i < end) {
    const m = (lines[i] ?? '').match(RE_LIST);
    if (m === null) break;
    if (indentWidth(m[1] ?? '') !== baseIndent) break;
    if (/\d/.test(m[2] ?? '') !== ordered) break; // 序号 ↔ 符号切换 = 新列表
    let text = m[3] ?? '';
    let checked: boolean | undefined;
    const task = text.match(RE_TASK);
    if (task !== null) {
      checked = (task[1] ?? ' ') !== ' ';
      text = task[2] ?? '';
    }
    const cont: string[] = [];
    if (text !== '') cont.push(text);
    const subs: CardBackBlock[] = [];
    i += 1;
    while (i < end) {
      const cur = lines[i] ?? '';
      if (cur.trim() === '') {
        // 空行：后随同级条目 → 列表延续（跳到该条目）；否则列表结束
        let j = i + 1;
        while (j < end && (lines[j] ?? '').trim() === '') j += 1;
        const nxt = (lines[j] ?? '').match(RE_LIST);
        if (
          nxt !== null &&
          indentWidth(nxt[1] ?? '') === baseIndent &&
          /\d/.test(nxt[2] ?? '') === ordered
        ) {
          i = j;
        }
        break;
      }
      const nm = cur.match(RE_LIST);
      if (nm !== null) {
        const ind = indentWidth(nm[1] ?? '');
        if (ind > baseIndent) {
          const sub = parseList(lines, i, end, ind);
          subs.push(sub.block);
          i = sub.next;
          continue;
        }
        break; // 同级/更浅：交回外层循环
      }
      if (indentWidth((cur.match(/^[ \t]*/) ?? [''])[0]) > baseIndent) {
        cont.push(cur.trim());
        i += 1;
        continue;
      }
      break; // 缩进不足的非标记行：列表结束
    }
    items.push({ checked, text: cont.join('\n'), subs });
  }
  return { block: { t: 'list', ordered, start: startNum, items }, next: i };
}
