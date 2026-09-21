/**
 * P1 · 节点卡背面：`note.md` 源文的 **markdown 只读渲染**（受限子集）。
 * P2b · 新增表格渲染（GFM pipe 子集）；**块级解析已提取**至 `chrome/cardBackMd.ts`
 * （纯函数模块，逐字搬迁）——本文件只留渲染，import 自新模块（不做 re-export）。
 *
 * 定位（设计稿 `docs/specs/2026-09-14-node-card-flip-markdown-design.md` §5）：
 * 渲染只读、无副作用、**范围收敛**——不自研完备语法、不引第二套行内语法。
 *
 * 范围清单（支持）：
 *   标题 h1–h6 / 无序·有序·嵌套列表 / 任务列表（只读 checkbox）/ 引用块（可嵌套）/
 *   围栏代码块（``` 与 ~~~）/ 水平线 / 段落 / 表格（`<table data-note-md-table>` +
 *   thead/tbody；对齐 → `textAlign`；窄面板内横向滚动）；行内 = `kernel/layout/inline.ts`
 *   同口径（**strong / code / link** 三类，zip 化；不解释斜体、删除线、转义与自动链接）；
 *   链接 = http(s) 白名单（外链 `target=_blank rel="noopener noreferrer"`）+
 *   内部锚（`node:` / `cid:` / `@kind:id`，点 `onJumpToAnchor`，与 L 批 TextLinkSpans
 *   同款回调机制；锚语法由 kernel `parseLinkAnchor` 判定）。
 *
 * 范围外（**按纯文本呈现，不执行**）：图片（`!` 前缀链接形态；不加载、字面文本）、裸 HTML
 * （无元素生成；本组件全程**无 `dangerouslySetInnerHTML`**，输出走 React 元素树）、
 * HTML 表格 / colspan·rowspan / 列表项内表格、自动链接 / 脚注 / 公式（不解）。
 *
 * 文件名与 `chrome/note.ts`（R15 翻卡背面分区格式化）语义不同：那是固定字段分区，
 * 本文件渲染的是 markdown 源文，两者不混用。
 */
import type { CSSProperties, ReactNode } from 'react';
import { parseLinkAnchor, tokenizeInline } from '@mindcanvas/kernel';
import { CHROME } from '../theme/tokens.js';
import type { TokenSet } from '../theme/types.js';
import { type CardBackBlock, parseCardBackMd } from './cardBackMd.js';

// ---------- React 渲染（元素树；无 HTML 串直插） ----------

export interface CardBackMarkdownProps {
  /** `note.md` 源文（空串/纯空白 → 不渲染，返回 null） */
  md: string;
  token: TokenSet;
  /** 内部锚跳转回调（缺省 → 锚只渲染不可点，与 L 批 TextLinkSpans 缺省纪律一致） */
  onJumpToAnchor?: (anchor: string) => void;
}

/** 链接触发的按下不冒泡（比照 TextLinkSpans：点链接 = 跳转意图，不承担宿主手势职责） */
function stopProp(e: { stopPropagation(): void }): void {
  e.stopPropagation();
}

const HTTP_RE = /^https?:\/\//i;
const H_EM = [1.45, 1.28, 1.14, 1.06, 1, 0.95];

/**
 * URL 形态判定（与 `edit/textLinks.ts` 的 T-A6 口径逐字一致）：
 * `scheme://` 与已知非内部 scheme 一律**不认作内部锚**——否则 `[a](mailto:x@y)`
 * 会被 kernel 实体锚正则（宽松 `kind:id`）误吞成 `mailto` 实体锚（L 批实测同款坑）。
 */
const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
const NON_ANCHOR_SCHEMES = new Set(['mailto', 'tel', 'file', 'data', 'javascript']);

function isUrlLike(target: string): boolean {
  if (URL_SCHEME_RE.test(target)) return true;
  const m = /^([^:\s][^:]*?):/.exec(target);
  return m !== null && NON_ANCHOR_SCHEMES.has((m[1] ?? '').toLowerCase());
}

const rootStyle: CSSProperties = {
  color: CHROME.text,
  fontSize: CHROME.fontSizeSmall,
  fontFamily: CHROME.fontFamily,
  lineHeight: 1.6,
  wordBreak: 'break-word',
};
const paraStyle: CSSProperties = { margin: '6px 0', whiteSpace: 'pre-wrap' };
const preStyle: CSSProperties = {
  margin: '8px 0',
  padding: '6px 8px',
  background: CHROME.panelBg,
  border: `1px solid ${CHROME.panelBorder}`,
  borderRadius: CHROME.radiusSmall,
  overflowX: 'auto',
  fontSize: '0.95em',
  lineHeight: 1.5,
};
const codeTextStyle: CSSProperties = {
  fontFamily: 'ui-monospace, Consolas, monospace',
  whiteSpace: 'pre',
};
const inlineCodeStyle: CSSProperties = {
  fontFamily: 'ui-monospace, Consolas, monospace',
  background: CHROME.panelBg,
  borderRadius: 4,
  padding: '0 3px',
  fontSize: '0.95em',
};
const hrStyle: CSSProperties = {
  border: 'none',
  borderTop: `1px solid ${CHROME.panelBorder}`,
  margin: '10px 0',
};
const quoteStyle: CSSProperties = {
  margin: '8px 0',
  padding: '2px 0 2px 10px',
  borderLeft: `2px solid ${CHROME.neonSoft}`,
  color: CHROME.textMuted,
};
const listStyle: CSSProperties = { margin: '6px 0', paddingLeft: 20 };
const liStyle: CSSProperties = { lineHeight: 1.6 };
const checkboxStyle: CSSProperties = { marginRight: 5, verticalAlign: 'middle' };
/** 表格容器：窄面板内允许横向滚动（同代码块 `preStyle.overflowX` 先例） */
const tableWrapStyle: CSSProperties = { margin: '8px 0', overflowX: 'auto' };
const tableStyle: CSSProperties = {
  borderCollapse: 'collapse',
  fontSize: '0.95em',
  lineHeight: 1.5,
};
const thStyle: CSSProperties = {
  border: `1px solid ${CHROME.panelBorder}`,
  background: CHROME.panelBg,
  padding: '4px 8px',
  fontWeight: 600,
};
const tdStyle: CSSProperties = {
  border: `1px solid ${CHROME.panelBorder}`,
  padding: '4px 8px',
  verticalAlign: 'top',
};

function headingStyle(level: number): CSSProperties {
  return {
    margin: '10px 0 6px',
    fontWeight: 600,
    fontSize: `${H_EM[level - 1] ?? 1}em`,
    lineHeight: 1.35,
  };
}

/**
 * 行内渲染（`tokenizeInline` 同口径 + 图片降级 + 链接分类）。
 * 图片：markdown 的「`!` + 链接」在 token 层 = 文本 `!` + link —— 合并回**字面文本**，
 * 不生成 `<img>`（行内代码内的图片语法是 code token，天然不被拆散）。
 */
function renderInline(
  text: string,
  token: TokenSet,
  onJumpToAnchor: ((anchor: string) => void) | undefined,
  keyPrefix: string,
): ReactNode[] {
  const tokens = tokenizeInline(text);
  const linkStyle: CSSProperties = {
    color: token.color.linkStroke,
    textDecorationLine: 'underline',
    textUnderlineOffset: 2,
  };
  const out: ReactNode[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const tk = tokens[i];
    if (tk === undefined) continue;
    const next = tokens[i + 1];
    if (tk.t === 'text' && tk.text.endsWith('!') && next !== undefined && next.t === 'link') {
      const before = tk.text.slice(0, -1);
      if (before !== '') out.push(before);
      // 注意：感叹号用 \x21 转义写 —— 避免「感叹号+方括号」在源码连写触发 budget 的
      // bang 哑正则假阳性（非断言）；输出字符串与图片语法逐字一致
      out.push(`\x21[${next.text}](${next.href ?? ''})`);
      i += 1;
      continue;
    }
    if (tk.t === 'text') {
      out.push(tk.text);
      continue;
    }
    if (tk.t === 'strong') {
      out.push(<strong key={`${keyPrefix}s${i}`}>{tk.text}</strong>);
      continue;
    }
    if (tk.t === 'code') {
      out.push(
        <code key={`${keyPrefix}c${i}`} style={inlineCodeStyle}>
          {tk.text}
        </code>,
      );
      continue;
    }
    const target = (tk.href ?? '').trim();
    if (HTTP_RE.test(target)) {
      out.push(
        <a
          key={`${keyPrefix}a${i}`}
          href={target}
          target="_blank"
          rel="noopener noreferrer"
          onPointerDown={stopProp}
          onClick={stopProp}
          style={linkStyle}
        >
          {tk.text}
        </a>,
      );
      continue;
    }
    if (!isUrlLike(target) && parseLinkAnchor(target) !== null) {
      const clickable = onJumpToAnchor !== undefined;
      out.push(
        <span
          key={`${keyPrefix}n${i}`}
          data-note-md-anchor={target}
          onPointerDown={stopProp}
          onClick={(e) => {
            e.stopPropagation();
            if (clickable) onJumpToAnchor(target);
          }}
          style={{ ...linkStyle, cursor: clickable ? 'pointer' : 'default' }}
        >
          {tk.text}
        </span>,
      );
      continue;
    }
    // 白名单外（javascript: / mailto: / scheme:// / 裸域名 / 空目标等）→ 字面文本，不可点
    out.push(`[${tk.text}](${target})`);
  }
  return out;
}

function HeadingView({
  level,
  text,
  token,
  onJumpToAnchor,
  k,
}: {
  level: number;
  text: string;
  token: TokenSet;
  onJumpToAnchor: ((anchor: string) => void) | undefined;
  k: string;
}) {
  const style = headingStyle(level);
  const children = renderInline(text, token, onJumpToAnchor, k);
  switch (level) {
    case 1:
      return <h1 style={style}>{children}</h1>;
    case 2:
      return <h2 style={style}>{children}</h2>;
    case 3:
      return <h3 style={style}>{children}</h3>;
    case 4:
      return <h4 style={style}>{children}</h4>;
    case 5:
      return <h5 style={style}>{children}</h5>;
    default:
      return <h6 style={style}>{children}</h6>;
  }
}

function ListView({
  block,
  token,
  onJumpToAnchor,
  k,
}: {
  block: Extract<CardBackBlock, { t: 'list' }>;
  token: TokenSet;
  onJumpToAnchor: ((anchor: string) => void) | undefined;
  k: string;
}) {
  const items = block.items.map((item, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: 静态只读内容 —— 位置即身份（无重排、无内部状态），与仓内位置键纪律一致
    <li key={`i${i}`} style={liStyle}>
      {item.checked !== undefined && (
        <input type="checkbox" checked={item.checked} disabled readOnly style={checkboxStyle} />
      )}
      {item.text !== '' && <span>{renderInline(item.text, token, onJumpToAnchor, `${k}i${i}`)}</span>}
      {item.subs.map((sub, j) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 静态只读内容 —— 位置即身份（同上）
        <BlockView key={`s${j}`} block={sub} token={token} onJumpToAnchor={onJumpToAnchor} k={`${k}s${j}`} />
      ))}
    </li>
  ));
  if (block.ordered) {
    return (
      <ol start={block.start > 1 ? block.start : undefined} style={listStyle}>
        {items}
      </ol>
    );
  }
  return <ul style={listStyle}>{items}</ul>;
}

/** 表格（P2b）：单元格内容走 `renderInline`（strong/code/link/内部锚同段落口径） */
function TableView({
  block,
  token,
  onJumpToAnchor,
  k,
}: {
  block: Extract<CardBackBlock, { t: 'table' }>;
  token: TokenSet;
  onJumpToAnchor: ((anchor: string) => void) | undefined;
  k: string;
}) {
  // th/td 同列同款：对齐缺失（null）兜底左对齐（th 浏览器默认居中，显式覆盖保持一致）
  const alignAt = (j: number): CSSProperties['textAlign'] => block.align[j] ?? 'left';
  return (
    <div style={tableWrapStyle}>
      <table data-note-md-table style={tableStyle}>
        <thead>
          <tr>
            {block.head.map((cell, j) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 静态只读内容 —— 位置即身份（同上）
              <th key={`h${j}`} style={{ ...thStyle, textAlign: alignAt(j) }}>
                {renderInline(cell, token, onJumpToAnchor, `${k}h${j}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, r) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 静态只读内容 —— 位置即身份（同上）
            <tr key={`r${r}`}>
              {row.map((cell, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 静态只读内容 —— 位置即身份（同上）
                <td key={`c${j}`} style={{ ...tdStyle, textAlign: alignAt(j) }}>
                  {renderInline(cell, token, onJumpToAnchor, `${k}c${r}_${j}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BlockView({
  block,
  token,
  onJumpToAnchor,
  k,
}: {
  block: CardBackBlock;
  token: TokenSet;
  onJumpToAnchor: ((anchor: string) => void) | undefined;
  k: string;
}) {
  switch (block.t) {
    case 'heading':
      return (
        <HeadingView
          level={block.level}
          text={block.text}
          token={token}
          onJumpToAnchor={onJumpToAnchor}
          k={`${k}h`}
        />
      );
    case 'paragraph':
      return <p style={paraStyle}>{renderInline(block.text, token, onJumpToAnchor, `${k}p`)}</p>;
    case 'code':
      return (
        <pre style={preStyle}>
          <code style={codeTextStyle}>{block.text}</code>
        </pre>
      );
    case 'hr':
      return <hr style={hrStyle} />;
    case 'quote':
      return (
        <blockquote style={quoteStyle}>
          {block.blocks.map((sub, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 静态只读内容 —— 位置即身份（同上）
            <BlockView key={`q${i}`} block={sub} token={token} onJumpToAnchor={onJumpToAnchor} k={`${k}q${i}`} />
          ))}
        </blockquote>
      );
    case 'list':
      return <ListView block={block} token={token} onJumpToAnchor={onJumpToAnchor} k={`${k}l`} />;
    case 'table':
      return <TableView block={block} token={token} onJumpToAnchor={onJumpToAnchor} k={`${k}t`} />;
    default:
      return null;
  }
}

/** 节点卡背面 markdown 只读视图（纯展示；空源文 → null，调用方不渲染背面） */
export function CardBackMarkdown({ md, token, onJumpToAnchor }: CardBackMarkdownProps) {
  if (md.trim() === '') return null;
  const blocks = parseCardBackMd(md);
  return (
    <div data-note-back-md style={rootStyle}>
      {blocks.map((b, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 静态只读内容 —— 位置即身份（同上）
        <BlockView key={`b${i}`} block={b} token={token} onJumpToAnchor={onJumpToAnchor} k={`b${i}`} />
      ))}
    </div>
  );
}
