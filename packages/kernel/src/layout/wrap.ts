/**
 * 节点文本换行（盒内多行显示）：
 * - ASCII 词（字母数字连字符等）为不可拆 token；空白串归一为单空格（行首丢弃）
 * - CJK / 标点每字符一个 token（任意断行）
 * - 单 token 超过 maxWidth 时按字符硬切——保证所有行宽 ≤ maxWidth，盒宽可控
 */
export function tokenize(text: string): string[] {
  const matches = text.match(/[A-Za-z0-9_.\-/@#$%^&+=*]+|\s+|[^\sA-Za-z0-9_.\-/@#$%^&+=*]/gu);
  return matches ?? (text.length > 0 ? [text] : []);
}

function hardSplit(token: string, maxWidth: number, measure: (s: string) => number): string[] {
  const parts: string[] = [];
  let seg = '';
  for (const ch of token) {
    if (seg !== '' && measure(seg + ch) > maxWidth) {
      parts.push(seg);
      seg = ch;
    } else {
      seg += ch;
    }
  }
  if (seg !== '') parts.push(seg);
  return parts;
}

/** 文本 → 行数组（每行宽度 ≤ maxWidth，超宽 token 硬切；空文本 → ['']） */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  if (text.length === 0) return [''];
  if (maxWidth <= 0) return [text];
  const tokens: string[] = [];
  for (const raw of tokenize(text)) {
    if (/^\s+$/.test(raw)) tokens.push(' ');
    else if (measure(raw) > maxWidth) tokens.push(...hardSplit(raw, maxWidth, measure));
    else tokens.push(raw);
  }
  const lines: string[] = [];
  let cur = '';
  for (const tk of tokens) {
    if (tk === ' ' && cur === '') continue;
    if (cur === '') {
      cur = tk;
      continue;
    }
    if (measure(cur + tk) <= maxWidth) {
      cur += tk;
    } else {
      lines.push(cur);
      cur = tk === ' ' ? '' : tk;
    }
  }
  if (cur !== '') lines.push(cur);
  return lines.length > 0 ? lines : [''];
}
