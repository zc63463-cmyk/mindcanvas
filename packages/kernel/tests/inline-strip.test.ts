import { describe, expect, it } from 'vitest';
import { stripInline } from '../src/layout/inline.js';

describe('layout/inline：stripInline 去除行内标记（搜索用纯文本）', () => {
  it('去除加粗/代码/链接标记，保留内容文本', () => {
    expect(stripInline('**重点** 内容')).toBe('重点 内容');
    expect(stripInline('运行 `npm test` 即可')).toBe('运行 npm test 即可');
    expect(stripInline('见 [文档](http://a.b)')).toBe('见 文档');
  });

  it('混合标记按序还原', () => {
    expect(stripInline('**A** `B` [C](u) D')).toBe('A B C D');
  });

  it('未闭合标记原样保留（与渲染一致）', () => {
    expect(stripInline('a **b')).toBe('a **b');
  });
});
