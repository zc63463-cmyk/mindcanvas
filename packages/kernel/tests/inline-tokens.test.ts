import { describe, expect, it } from 'vitest';
import { inlineWidth, tokenizeInline } from '../src/layout/inline.js';

describe('layout/inline：行内富文本 token 解析（加粗/代码/链接）', () => {
  it('纯文本 → 单个 text token', () => {
    expect(tokenizeInline('普通文本 abc')).toEqual([{ t: 'text', text: '普通文本 abc' }]);
  });

  it('**加粗** → strong token', () => {
    expect(tokenizeInline('a **b** c')).toEqual([
      { t: 'text', text: 'a ' },
      { t: 'strong', text: 'b' },
      { t: 'text', text: ' c' },
    ]);
  });

  it('`code` → code token（等宽样式）', () => {
    expect(tokenizeInline('x `y=1` z')).toEqual([
      { t: 'text', text: 'x ' },
      { t: 'code', text: 'y=1' },
      { t: 'text', text: ' z' },
    ]);
  });

  it('[label](url) → link token（带 href）', () => {
    expect(tokenizeInline('see [doc](http://a.b/c) now')).toEqual([
      { t: 'text', text: 'see ' },
      { t: 'link', text: 'doc', href: 'http://a.b/c' },
      { t: 'text', text: ' now' },
    ]);
  });

  it('三种语法混合按序解析', () => {
    expect(tokenizeInline('**A** `B` [C](u) D')).toEqual([
      { t: 'strong', text: 'A' },
      { t: 'text', text: ' ' },
      { t: 'code', text: 'B' },
      { t: 'text', text: ' ' },
      { t: 'link', text: 'C', href: 'u' },
      { t: 'text', text: ' D' },
    ]);
  });

  it('未闭合标记（** 或 ` 无配对）→ 按普通文本宽容保留', () => {
    expect(tokenizeInline('**oops')).toEqual([{ t: 'text', text: '**oops' }]);
    expect(tokenizeInline('a `b')).toEqual([{ t: 'text', text: 'a `b' }]);
  });

  it('inlineWidth：按样式系数累积宽度（strong 略宽、code 略窄）', () => {
    const measure = (s: string): number => s.length;
    expect(inlineWidth(tokenizeInline('**ab**'), measure)).toBeCloseTo(2.1, 6);
    expect(inlineWidth(tokenizeInline('a`b`c'), measure)).toBeCloseTo(1 + 0.95 + 1, 6);
    expect(inlineWidth(tokenizeInline('[x](u)'), measure)).toBeCloseTo(1, 6);
  });
});
