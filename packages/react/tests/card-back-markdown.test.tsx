// @vitest-environment jsdom
/**
 * P1-N2：节点卡背面 markdown 只读渲染（受限子集）判别测试。
 *
 * 范围清单（支持）：标题 h1–h6 / 无序·有序·嵌套列表 / 任务列表 / 引用块 /
 * 围栏代码块（``` 与 ~~~）/ 水平线 / 行内样式（strong·code·link —— 与 kernel
 * `layout/inline.ts` 同口径，不引第二套行内语法）/ 链接（http(s) 白名单 + 内部锚）。
 * 范围外（按纯文本呈现，不执行）：图片 / 裸 HTML / 斜体·删除线。
 * P2b：表格（GFM pipe 子集）已转为支持项——见「表格（P2b）」describe。
 * 安全：无 dangerouslySetInnerHTML（行为断言：无 img/script 元素、危险协议不可点、
 * 外链 target=_blank + rel=noopener noreferrer）。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { glassToken } from '../src/theme/tokens.js';
import { CardBackMarkdown } from '../src/chrome/CardBackMarkdown.js';

const token = glassToken;

function renderMd(md: string, onJumpToAnchor?: (a: string) => void): HTMLElement {
  const { container } = render(
    <CardBackMarkdown md={md} token={token} onJumpToAnchor={onJumpToAnchor} />,
  );
  return container;
}

describe('CardBackMarkdown：标题', () => {
  it('h1–h6 逐级映射', () => {
    const c = renderMd('# 一\n\n## 二\n\n### 三\n\n#### 四\n\n##### 五\n\n###### 六');
    const pairs: Array<[string, string]> = [
      ['h1', '一'],
      ['h2', '二'],
      ['h3', '三'],
      ['h4', '四'],
      ['h5', '五'],
      ['h6', '六'],
    ];
    for (const [tag, text] of pairs) {
      const el = c.querySelector(tag);
      expect(el).not.toBeNull();
      expect(el?.textContent).toBe(text);
    }
  });

  it('# 后无空格不是标题（按段落文本）', () => {
    const c = renderMd('#hashtag');
    expect(c.querySelector('h1')).toBeNull();
    expect(c.textContent).toContain('#hashtag');
  });
});

describe('CardBackMarkdown：列表', () => {
  it('无序列表 → ul/li', () => {
    const c = renderMd('- 甲\n- 乙');
    const items = c.querySelectorAll('ul > li');
    expect(items.length).toBe(2);
    expect(items[0]?.textContent).toBe('甲');
    expect(items[1]?.textContent).toBe('乙');
  });

  it('有序列表 → ol/li（起始号保留）', () => {
    const c = renderMd('3. 三\n4. 四');
    const ol = c.querySelector('ol');
    expect(ol).not.toBeNull();
    expect(ol?.getAttribute('start')).toBe('3');
    expect(c.querySelectorAll('ol > li').length).toBe(2);
  });

  it('嵌套列表（缩进 > 基准）→ li 内嵌套 ul', () => {
    const c = renderMd('- 甲\n  - 甲一\n  - 甲二\n- 乙');
    const outer = c.querySelectorAll('ul');
    expect(outer.length).toBe(2);
    const firstLi = c.querySelector('ul > li');
    expect(firstLi?.querySelector('ul')?.textContent).toBe('甲一甲二');
  });

  it('嵌套有序（ul 内 ol）', () => {
    const c = renderMd('- 甲\n  1. 一\n  2. 二');
    expect(c.querySelector('ul ol')).not.toBeNull();
  });

  it('任务列表 → 只读 checkbox（disabled，勾选态映射）', () => {
    const c = renderMd('- [ ] 待办\n- [x] 已完成');
    const boxes = c.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes.length).toBe(2);
    expect(boxes[0]?.checked).toBe(false);
    expect(boxes[1]?.checked).toBe(true);
    expect(boxes[0]?.disabled).toBe(true);
    expect(c.textContent).toContain('待办');
    expect(c.textContent).toContain('已完成');
  });
});

describe('CardBackMarkdown：引用块', () => {
  it('> 文本 → blockquote', () => {
    const c = renderMd('> 引用一行');
    const bq = c.querySelector('blockquote');
    expect(bq).not.toBeNull();
    expect(bq?.textContent).toBe('引用一行');
  });

  it('嵌套 >> → blockquote 内 blockquote', () => {
    const c = renderMd('> 外\n> > 内');
    expect(c.querySelector('blockquote blockquote')?.textContent).toBe('内');
  });

  it('引用内列表可渲染', () => {
    const c = renderMd('> - 甲\n> - 乙');
    expect(c.querySelectorAll('blockquote li').length).toBe(2);
  });
});

describe('CardBackMarkdown：围栏代码块', () => {
  it('``` 围栏 → pre>code，内容原样、不做行内解析', () => {
    const c = renderMd('```\n**not bold** `not code`\n```');
    const pre = c.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toBe('**not bold** `not code`');
    expect(pre?.querySelector('strong')).toBeNull();
  });

  it('~~~ 围栏同样生效', () => {
    const c = renderMd('~~~\nplain\n~~~');
    expect(c.querySelector('pre')?.textContent).toBe('plain');
  });

  it('围栏内 HTML 不执行', () => {
    const c = renderMd('```\n<img src="x" onerror="boom()">\n```');
    expect(c.querySelector('img')).toBeNull();
    expect(c.querySelector('pre')?.textContent).toContain('<img');
  });
});

describe('CardBackMarkdown：水平线', () => {
  it('--- / *** / ___ → hr', () => {
    const c = renderMd('---\n\n***\n\n___');
    expect(c.querySelectorAll('hr').length).toBe(3);
  });
});

describe('CardBackMarkdown：段落与行内（inline.ts 同口径）', () => {
  it('连续行合入同一段落（换行保留在文本节点）', () => {
    const c = renderMd('第一行\n第二行');
    const ps = c.querySelectorAll('p');
    expect(ps.length).toBe(1);
    expect(ps[0]?.textContent).toBe('第一行\n第二行');
  });

  it('**strong** → strong；`code` → code', () => {
    const c = renderMd('前 **粗** 后 `码`');
    expect(c.querySelector('strong')?.textContent).toBe('粗');
    expect(c.querySelector('code')?.textContent).toBe('码');
  });

  it('未闭合 ** 保持字面；斜体/删除线不解释（不引第二套行内语法）', () => {
    const c = renderMd('**未闭合 与 *斜* 与 ~~删~~');
    expect(c.querySelector('strong')).toBeNull();
    expect(c.querySelector('em')).toBeNull();
    expect(c.querySelector('del')).toBeNull();
    expect(c.textContent).toContain('**未闭合');
    expect(c.textContent).toContain('*斜*');
    expect(c.textContent).toContain('~~删~~');
  });
});

describe('CardBackMarkdown：链接', () => {
  it('外链 http(s) → a[target=_blank][rel=noopener noreferrer]', () => {
    const c = renderMd('[官网](https://example.com/x)');
    const a = c.querySelector('a');
    expect(a).not.toBeNull();
    expect(a?.getAttribute('href')).toBe('https://example.com/x');
    expect(a?.getAttribute('target')).toBe('_blank');
    expect(a?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a?.textContent).toBe('官网');
  });

  it('内部锚 node: → 点击回调锚原文（不是 <a>）', () => {
    const jump = vi.fn();
    const c = renderMd('去 [任务甲](node:根/任务甲) 看看', jump);
    const el = c.querySelector('[data-note-md-anchor]');
    expect(el).not.toBeNull();
    if (el === null) throw new Error('内部锚 span 缺失');
    expect(el.getAttribute('data-note-md-anchor')).toBe('node:根/任务甲');
    expect(c.querySelector('a')).toBeNull();
    fireEvent.click(el);
    expect(jump).toHaveBeenCalledTimes(1);
    expect(jump).toHaveBeenCalledWith('node:根/任务甲');
  });

  it('内部锚 cid: / @kind: 同样可点', () => {
    const jump = vi.fn();
    const c = renderMd('[甲](cid:c7) 与 [乙](@issue:88)', jump);
    const anchors = c.querySelectorAll('[data-note-md-anchor]');
    expect(anchors.length).toBe(2);
    if (anchors[0] === undefined || anchors[1] === undefined) throw new Error('内部锚缺失');
    fireEvent.click(anchors[0]);
    fireEvent.click(anchors[1]);
    expect(jump).toHaveBeenNthCalledWith(1, 'cid:c7');
    expect(jump).toHaveBeenNthCalledWith(2, '@issue:88');
  });

  it('无跳转回调 → 内部锚渲染但不可点（cursor 默认）', () => {
    const c = renderMd('[甲](node:根/甲)');
    const el = c.querySelector<HTMLElement>('[data-note-md-anchor]');
    expect(el).not.toBeNull();
    expect(el?.style.cursor).toBe('default');
  });

  it('危险协议 javascript: → 纯文本不可点', () => {
    const c = renderMd('[点我](javascript:alert(1))');
    expect(c.querySelector('a')).toBeNull();
    expect(c.querySelector('[data-note-md-anchor]')).toBeNull();
    expect(c.textContent).toContain('[点我](javascript:alert(1))');
  });

  it('mailto / 裸域名 → 纯文本（白名单外）', () => {
    const c = renderMd('[邮](mailto:a@b.c) [裸](example.com)');
    expect(c.querySelector('a')).toBeNull();
    expect(c.textContent).toContain('[邮](mailto:a@b.c)');
    expect(c.textContent).toContain('[裸](example.com)');
  });
});

describe('CardBackMarkdown：表格（P2b：GFM pipe 子集）', () => {
  it('表头 → thead>tr>th；数据 → tbody>tr>td', () => {
    const c = renderMd('| 名 | 值 |\n|---|---|\n| 甲 | 1 |');
    expect(c.querySelectorAll('table thead th').length).toBe(2);
    expect(c.querySelector('table thead th')?.textContent).toBe('名');
    expect(c.querySelectorAll('table tbody tr td').length).toBe(2);
    expect(c.querySelector('table tbody')?.textContent).toBe('甲1');
  });

  it('单元格走行内口径（**strong** / 内部锚 data-note-md-anchor 可点）', () => {
    const jump = vi.fn();
    const c = renderMd('| 键 | 值 |\n|---|---|\n| **粗** | [甲](node:根/甲) |', jump);
    expect(c.querySelector('table strong')?.textContent).toBe('粗');
    const anchor = c.querySelector('table [data-note-md-anchor]');
    expect(anchor?.getAttribute('data-note-md-anchor')).toBe('node:根/甲');
    if (anchor === null) throw new Error('表格内内部锚缺失');
    fireEvent.click(anchor);
    expect(jump).toHaveBeenCalledWith('node:根/甲');
  });

  it('对齐三态 → th/td 同列同款 textAlign（无标记列兜底 left）', () => {
    const c = renderMd('| a | b | c | d |\n| :-- | :-: | --: | --- |\n| 1 | 2 | 3 | 4 |');
    const ths = c.querySelectorAll<HTMLTableCellElement>('table th');
    expect(ths[0]?.style.textAlign).toBe('left');
    expect(ths[1]?.style.textAlign).toBe('center');
    expect(ths[2]?.style.textAlign).toBe('right');
    expect(ths[3]?.style.textAlign).toBe('left');
    const tds = c.querySelectorAll<HTMLTableCellElement>('table tbody td');
    expect(tds[0]?.style.textAlign).toBe('left');
    expect(tds[1]?.style.textAlign).toBe('center');
    expect(tds[2]?.style.textAlign).toBe('right');
    expect(tds[3]?.style.textAlign).toBe('left');
  });

  it('table[data-note-md-table] 存在 + 容器横向滚动（overflowX auto）', () => {
    const c = renderMd('| a | b |\n|---|---|\n| 1 | 2 |');
    const table = c.querySelector('table[data-note-md-table]');
    expect(table).not.toBeNull();
    expect(table?.closest('div')?.style.overflowX).toBe('auto');
  });
});

describe('CardBackMarkdown：范围外降级（按纯文本）', () => {
  it('图片 ![]() 不加载（无 img、字面文本）', () => {
    const c = renderMd('前 ![图](b.png) 后');
    expect(c.querySelector('img')).toBeNull();
    expect(c.textContent).toContain('![图](b.png)');
    expect(c.textContent).toContain('前');
  });

  it('图片写在行内代码里不被拆散（code 优先）', () => {
    const c = renderMd('`![图](b.png)`');
    expect(c.querySelector('img')).toBeNull();
    expect(c.querySelector('code')?.textContent).toBe('![图](b.png)');
  });

  it('裸 HTML 不执行（无元素、字面文本）', () => {
    const c = renderMd('<b>粗</b> 与 <script>alert(1)</script>');
    expect(c.querySelector('b')).toBeNull();
    expect(c.querySelector('script')).toBeNull();
    expect(c.textContent).toContain('<b>粗</b>');
  });

  it('表格语法 → 表格渲染（P2b 升级：原「按文本行」范围外钉原位翻转）', () => {
    const c = renderMd('| a | b |\n|---|---|\n| 1 | 2 |');
    const table = c.querySelector('table[data-note-md-table]');
    expect(table).not.toBeNull();
    expect(table?.querySelectorAll('th').length).toBe(2);
    expect(table?.querySelector('th')?.textContent).toBe('a');
    expect(table?.querySelectorAll('td').length).toBe(2);
    expect(c.textContent).toContain('1');
  });
});

describe('CardBackMarkdown：空输入', () => {
  it('空串 / 纯空白 → 不渲染任何内容', () => {
    expect(renderMd('').firstChild).toBeNull();
    expect(renderMd('   \n  ').firstChild).toBeNull();
  });
});
