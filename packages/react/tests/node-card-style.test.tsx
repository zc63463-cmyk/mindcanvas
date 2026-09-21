// @vitest-environment jsdom
/**
 * DEPTH-VIS-1：三档节点卡（root 最醒目 → branch → leaf 最弱）与绘制侧同源。
 * 设计权威：docs/specs/2026-09-18-depth-visual-hierarchy-design.md §4/§6。
 *
 * 教训背景：同款描边/字号下叶卡在深色主题（glass）里与一级分支同样亮，
 * 扫读会被密叶抢走注意力。这里把「父 ≥ 子」的描边/填色/文字阶梯钉成断言，
 * 并在 DOM 上实测 NodeG 的 font-size / font-weight = fontOf（防「看起来大、点不中」）。
 */

import { astToEditable, layoutMindmap, makeTextNode } from '@mindcanvas/kernel';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  createCharMeasure,
  createDisplayMetricsFn,
  createNodeMeasure,
} from '../src/render/domMeasure.js';
import { fontOf, nodeCardStyle, visualRankOf } from '../src/render/geometry.js';
import { NodeG } from '../src/render/NodeG.js';
import { CHROME, THEMES } from '../src/theme/tokens.js';
import type { TokenSet } from '../src/theme/types.js';

/** [主题 id, 令牌] —— 三主题同语义阶梯（glass 目视重点） */
const THEME_ENTRIES: Array<[string, TokenSet]> = Object.entries(THEMES);

/** rgba(...) 第四位 alpha（非 rgba / 无 alpha → 1）—— 断言「谁更实」用 */
function alphaOf(color: string): number {
  const m = /rgba?\(([^)]+)\)/.exec(color);
  if (!m) return 1;
  const parts = m[1]!.split(',').map((s) => Number(s.trim()));
  return parts.length === 4 ? (parts[3] ?? 1) : 1;
}

describe('nodeCardStyle：三档描边阶梯（root ≥ branch ≥ leaf）', () => {
  it.each(THEME_ENTRIES)('%s：描边宽 root ≥ branch ≥ leaf，root 严格更厚', (_id, token) => {
    const palette = token.color.branches[0]!;
    const root = nodeCardStyle(token, palette, 'root');
    const branch = nodeCardStyle(token, palette, 'branch');
    const leaf = nodeCardStyle(token, palette, 'leaf');
    expect(root.strokeWidth).toBeGreaterThanOrEqual(branch.strokeWidth);
    expect(branch.strokeWidth).toBeGreaterThanOrEqual(leaf.strokeWidth);
    expect(root.strokeWidth).toBeGreaterThan(leaf.strokeWidth);
  });

  it('classic：root = 同支深色描边 + 1.8（不再与 branch 同款），fill 仍是分支卡', () => {
    const token = THEMES.classic;
    const b = token.color.branches[0]!;
    const root = nodeCardStyle(token, b, 'root');
    const branch = nodeCardStyle(token, b, 'branch');
    expect(root.strokeWidth).toBe(1.8);
    expect(root.stroke).toBe(b.text);
    expect(root.stroke).not.toBe(branch.stroke);
    expect(root.fill).toBe(b.fill);
    expect(branch.strokeWidth).toBe(token.nodeStyle.strokeWidth);
  });

  it('sticker：同款规则（深色描边 + 1.8；branch 仍是贴纸色板）', () => {
    const token = THEMES.sticker;
    const b = token.color.branches[3]!;
    const root = nodeCardStyle(token, b, 'root');
    expect(root.strokeWidth).toBe(1.8);
    expect(root.stroke).toBe(b.text);
    expect(nodeCardStyle(token, b, 'branch').stroke).toBe(b.stroke);
  });

  it('glass：root 更不透明更亮（fill/stroke alpha ↑、text 取主文字色）；leaf 更弱', () => {
    const token = THEMES.glass;
    const b = token.color.branches[0]!;
    const root = nodeCardStyle(token, b, 'root');
    const branch = nodeCardStyle(token, b, 'branch');
    const leaf = nodeCardStyle(token, b, 'leaf');
    expect(alphaOf(root.fill)).toBeGreaterThan(alphaOf(branch.fill));
    expect(alphaOf(root.stroke)).toBeGreaterThan(alphaOf(branch.stroke));
    expect(root.strokeWidth).toBe(1.6);
    expect(root.text).toBe(token.color.text);
    expect(alphaOf(leaf.fill)).toBeLessThan(alphaOf(branch.fill));
    expect(alphaOf(leaf.stroke)).toBeLessThan(alphaOf(branch.stroke));
    expect(leaf.strokeWidth).toBeLessThan(branch.strokeWidth);
  });

  it('leaf 不比 branch 更「实」（三主题 fill/stroke alpha ≤ branch）—— 父先于子', () => {
    for (const [, token] of THEME_ENTRIES) {
      const b = token.color.branches[0]!;
      const branch = nodeCardStyle(token, b, 'branch');
      const leaf = nodeCardStyle(token, b, 'leaf');
      expect(alphaOf(leaf.fill)).toBeLessThanOrEqual(alphaOf(branch.fill));
      expect(alphaOf(leaf.stroke)).toBeLessThanOrEqual(alphaOf(branch.stroke));
      expect(leaf.strokeWidth).toBeLessThanOrEqual(branch.strokeWidth);
    }
  });

  it('glass 叶标题 ≠ 幕布注释（DEPTH-VIS-1.1：弱化靠卡/字号，不靠字色掉进 muted 带）', () => {
    const token = THEMES.glass;
    const b = token.color.branches[0]!;
    const leaf = nodeCardStyle(token, b, 'leaf');
    expect(leaf.text).toBe(token.color.leafDefault.text);
    expect(leaf.text).not.toBe(CHROME.textMuted);
    expect(leaf.text).not.toBe(token.color.accent);
  });
});

describe('绘制同源：NodeG 三档字号/字重 = fontOf（DOM 实测）', () => {
  /** 渲染单节点（depth 指定档位），取标题 <text> 的 font-size / font-weight 属性 */
  function textStyleOf(
    depth: number,
    token: TokenSet,
  ): { size: string | null; weight: string | null } {
    const editable = astToEditable(makeTextNode('节点文本'))!;
    const char = createCharMeasure({ family: 'sans-serif', size: token.font.size }, null);
    const metric = createDisplayMetricsFn(char, new Map());
    const layout = layoutMindmap(editable, createNodeMeasure(char, new Map()), new Set());
    const ln = layout.nodes[0]!;
    const style = nodeCardStyle(token, token.color.branches[0], visualRankOf(depth));
    const { container } = render(
      // 包一层 <svg>：NodeG 本体是 <g>，独立渲染会落到 HTML 命名空间（真实宿主恒在 SVG 内）
      <svg>
        <NodeG
          node={ln}
          style={style}
          metrics={metric(editable)}
          token={token}
          depth={depth}
          root={depth === 0}
          chipX={null}
          noText={false}
        />
      </svg>,
    );
    const text = container.querySelector('text')!;
    return { size: text.getAttribute('font-size'), weight: text.getAttribute('font-weight') };
  }

  it.each(THEME_ENTRIES)('%s：三档 DOM 字号/字重 = fontOf（父 > 一级 > 叶）', (_id, token) => {
    for (const depth of [0, 1, 2]) {
      const { size, weight } = textStyleOf(depth, token);
      const expected = fontOf(token, depth);
      expect(size).toBe(String(expected.size));
      expect(weight).toBe(String(expected.weight));
    }
    // 三档实测值互不相同（同款 = 阶梯没生效）
    const sizes = [0, 1, 2].map((d) => textStyleOf(d, token).size);
    expect(new Set(sizes).size).toBe(3);
  });

  it('glass：根 13px / 一级 12px / 叶 9px（深底重点主题逐像素对照）', () => {
    const token = THEMES.glass;
    expect(textStyleOf(0, token).size).toBe('13');
    expect(textStyleOf(1, token).size).toBe('12');
    expect(textStyleOf(2, token).size).toBe('9');
  });
});
