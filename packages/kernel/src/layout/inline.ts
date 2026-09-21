/**
 * 行内富文本 token（渲染层展示）：**加粗** / `code` / [label](url) → 分段渲染。
 * 解析宽容：未闭合标记按普通文本保留；code 内容不嵌套解析。
 */

export type InlineType = 'text' | 'strong' | 'code' | 'link';

export interface InlineToken {
  t: InlineType;
  text: string;
  /** 仅 link 有目标 URL */
  href?: string;
}

/** 样式宽度系数（度量近似：粗体略宽、等宽略窄——与文本实际渲染一致） */
const STYLE_W: Record<InlineType, number> = { text: 1, strong: 1.05, code: 0.95, link: 1 };

/** 文本 → 行内 token 序列（扫描式，优先 code > strong > link） */
export function tokenizeInline(text: string): InlineToken[] {
  const out: InlineToken[] = [];
  let buf = '';
  const flush = (): void => {
    if (buf) {
      out.push({ t: 'text', text: buf });
      buf = '';
    }
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    if (ch === '`') {
      const close = text.indexOf('`', i + 1);
      if (close !== -1) {
        flush();
        out.push({ t: 'code', text: text.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    } else if (ch === '*' && text[i + 1] === '*') {
      const close = text.indexOf('**', i + 2);
      if (close !== -1) {
        flush();
        out.push({ t: 'strong', text: text.slice(i + 2, close) });
        i = close + 2;
        continue;
      }
    } else if (ch === '[') {
      const lb = text.indexOf('](', i + 1);
      if (lb !== -1) {
        const close = text.indexOf(')', lb + 2);
        if (close !== -1) {
          flush();
          out.push({ t: 'link', text: text.slice(i + 1, lb), href: text.slice(lb + 2, close) });
          i = close + 1;
          continue;
        }
      }
    }
    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

/** token 行渲染宽度（按样式系数加权度量） */
export function inlineWidth(tokens: InlineToken[], measure: (s: string) => number): number {
  return tokens.reduce((sum, t) => sum + measure(t.text) * STYLE_W[t.t], 0);
}

/** 去除行内标记，返回渲染后可见文本（搜索/比对用；未闭合标记原样保留） */
export function stripInline(text: string): string {
  return tokenizeInline(text)
    .map((t) => t.text)
    .join('');
}
