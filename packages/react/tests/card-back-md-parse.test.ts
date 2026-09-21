/**
 * P2b：背面 markdown 块级解析（`chrome/cardBackMd.ts` 纯函数）——表格子集判别。
 *
 * 落点说明：渲染侧断言在 `card-back-markdown.test.tsx`（jsdom）；本文件为
 * vitest 默认 node 环境的纯函数测试（无 DOM 依赖），覆盖解析 8 类。
 */
import { describe, expect, it } from 'vitest';
import { parseCardBackMd } from '../src/chrome/cardBackMd.js';

describe('parseCardBackMd：表格（P2b：GFM pipe 子集）', () => {
  it('基本 2×2：header + delimiter + 一行数据', () => {
    const blocks = parseCardBackMd('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(blocks).toEqual([{ t: 'table', align: [null, null], head: ['a', 'b'], rows: [['1', '2']] }]);
  });

  it('对齐三态 + 无对齐（L / C / R / null）', () => {
    const blocks = parseCardBackMd(
      '| a | b | c | d |\n| :-- | :-: | --: | --- |\n| 1 | 2 | 3 | 4 |',
    );
    expect(blocks).toEqual([
      {
        t: 'table',
        align: ['left', 'center', 'right', null],
        head: ['a', 'b', 'c', 'd'],
        rows: [['1', '2', '3', '4']],
      },
    ]);
  });

  it('首尾管道可选：无管道写法与带管道写法解析同构', () => {
    const bare = parseCardBackMd('a | b\n--- | ---\n1 | 2');
    const piped = parseCardBackMd('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(bare).toEqual(piped);
  });

  it('`\\|` 转义不拆列（保字面管道）', () => {
    const blocks = parseCardBackMd('| a\\|b | c |\n|---|---|\n| 1\\|2 | 3 |');
    expect(blocks).toEqual([
      { t: 'table', align: [null, null], head: ['a|b', 'c'], rows: [['1|2', '3']] },
    ]);
  });

  it('列数不齐：以 header 为准（行多丢、行少补空）', () => {
    const blocks = parseCardBackMd('| a | b |\n|---|---|\n| 1 | 2 | 3 |\n| 9 |');
    expect(blocks).toEqual([
      { t: 'table', align: [null, null], head: ['a', 'b'], rows: [['1', '2'], ['9', '']] },
    ]);
  });

  it('无 delimiter 行 = 段落（范围外不升级钉）', () => {
    const blocks = parseCardBackMd('| a | b |\n| 1 | 2 |');
    expect(blocks).toEqual([{ t: 'paragraph', text: '| a | b |\n| 1 | 2 |' }]);
  });

  it('表格终止前文段落（前文独立成段，表格从 header 行起）', () => {
    const blocks = parseCardBackMd('前文\n| a | b |\n|---|---|\n| 1 | 2 |');
    expect(blocks).toEqual([
      { t: 'paragraph', text: '前文' },
      { t: 'table', align: [null, null], head: ['a', 'b'], rows: [['1', '2']] },
    ]);
  });

  it('引用内表格：沿递归解析自然获得', () => {
    const blocks = parseCardBackMd('> | a | b |\n> |---|---|\n> | 1 | 2 |');
    expect(blocks).toEqual([
      {
        t: 'quote',
        blocks: [{ t: 'table', align: [null, null], head: ['a', 'b'], rows: [['1', '2']] }],
      },
    ]);
  });
});
