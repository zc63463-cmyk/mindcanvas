/**
 * MEASURE-RANK：度量按视觉档分档（`createRankedCharMeasure` / `createNodeMeasure(char, entities, charOf)`）。
 *
 * 为什么要有这批：DEPTH-VIS-1 把三档字号拉开后，布局度量仍用 branch 字号量所有节点 →
 * 叶卡白边约 25%，整体盒偏大还压低 fit k（LOD 更早省文本）。分档度量让「盒 = 字号」同源：
 *  - 档位字号算式唯一出口 `fontForRank`（root=sizeRoot / branch=size / leaf=sizeLeaf）；
 *  - 同一段文本在三档下的盒宽严格递减；
 *  - 缺省不给 charOf → 逐像素等于旧行为（所有既有调用方零改动）。
 *
 * 无 DOM 环境：`createCharMeasure(..., null)` 走估算回退（CJK≈size、窄≈0.62×size），
 * 宽高因此可精确断言。
 */

import { astToEditable, layoutMindmap, makeTextNode } from '@mindcanvas/kernel';
import { describe, expect, it } from 'vitest';
import {
  createCharMeasure,
  createNodeMeasure,
  createRankedCharMeasure,
} from '../src/render/domMeasure.js';
import { fontForRank } from '../src/render/geometry.js';
import { THEMES } from '../src/theme/tokens.js';
import type { TokenSet } from '../src/theme/types.js';

const CJK = '甲乙丙丁'; // 4 个全角字 → 估算宽 = 4 × size

describe('createRankedCharMeasure：三档字符度量同源', () => {
  it('档位字号走 fontForRank 唯一出口（glass 13/12/9）', () => {
    const charOf = createRankedCharMeasure(THEMES.glass.font, null);
    expect(charOf('root')(CJK)).toBe(4 * fontForRank(THEMES.glass.font, 'root').size);
    expect(charOf('branch')(CJK)).toBe(4 * fontForRank(THEMES.glass.font, 'branch').size);
    expect(charOf('leaf')(CJK)).toBe(4 * fontForRank(THEMES.glass.font, 'leaf').size);
    expect([charOf('root')(CJK), charOf('branch')(CJK), charOf('leaf')(CJK)]).toEqual([52, 48, 36]);
  });

  it('同档多次取用返回**同一实例**（缓存键稳定：metrics 缓存按实例隔离）', () => {
    const charOf = createRankedCharMeasure(THEMES.classic.font, null);
    expect(charOf('leaf')).toBe(charOf('leaf'));
    expect(charOf('leaf')).not.toBe(charOf('branch'));
  });

  it('旧主题缺 sizeRoot → 根档回退 size + 2（不得崩）', () => {
    const legacy: TokenSet['font'] = {
      family: 'sans-serif',
      size: 11,
      sizeLeaf: 9,
      weight: 500,
      weightRoot: 600,
    };
    const charOf = createRankedCharMeasure(legacy, null);
    expect(charOf('root')('甲')).toBe(13);
    expect(charOf('branch')('甲')).toBe(11);
    expect(charOf('leaf')('甲')).toBe(9);
  });
});

describe('createNodeMeasure：盒随档位收缩（叶不再留 branch 字号的白边）', () => {
  /** 同名文本的 root / branch / leaf 三份盒（同一棵树，深度由布局决定） */
  function boxesOf(token: TokenSet, withCharOf: boolean) {
    const text = '叶子叶子'; // 4 全角字：深度差直接反映为宽度差
    const root = astToEditable(makeTextNode(text, [makeTextNode(text, [makeTextNode(text)])]))!;
    const char = createCharMeasure({ family: token.font.family, size: token.font.size }, null);
    const charOf = withCharOf ? createRankedCharMeasure(token.font, null) : undefined;
    const layout = layoutMindmap(root, createNodeMeasure(char, new Map(), charOf), new Set());
    const widthAt = (depth: number): number => layout.nodes.find((ln) => ln.depth === depth)!.box.w;
    return { root: widthAt(0), branch: widthAt(1), leaf: widthAt(2) };
  }

  it('glass：root > branch > leaf，且叶盒 = 用叶档字符度量单档布局的叶盒（等价性）', () => {
    const b = boxesOf(THEMES.glass, true);
    expect(b.root).toBeGreaterThan(b.branch);
    expect(b.branch).toBeGreaterThan(b.leaf);

    // 等价性：分档度量的叶盒 == 直接拿叶档字符度量跑一遍单档布局的叶盒
    const text = '叶子叶子';
    const root = astToEditable(makeTextNode(text, [makeTextNode(text, [makeTextNode(text)])]))!;
    const leafChar = createCharMeasure(
      { family: THEMES.glass.font.family, size: THEMES.glass.font.sizeLeaf },
      null,
    );
    const leafOnly = layoutMindmap(root, createNodeMeasure(leafChar, new Map()), new Set());
    expect(b.leaf).toBe(leafOnly.nodes.find((ln) => ln.depth === 2)!.box.w);
  });

  it('classic / sticker：同样三档递减（三主题一致）', () => {
    for (const token of [THEMES.classic, THEMES.sticker]) {
      const b = boxesOf(token, true);
      expect(b.root).toBeGreaterThan(b.branch);
      expect(b.branch).toBeGreaterThan(b.leaf);
    }
  });

  it('缺省不给 charOf → 三档同宽（旧行为逐值不变）', () => {
    const b = boxesOf(THEMES.glass, false);
    expect(b.root).toBe(b.branch);
    expect(b.branch).toBe(b.leaf);
  });
});
