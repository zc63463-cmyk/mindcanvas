/**
 * DEPTH-VIS-1：深度视觉阶梯的单一出口（rank 映射 + 字号/字重阶梯）。
 * 设计权威：docs/specs/2026-09-18-depth-visual-hierarchy-design.md §4（锁定数值）/ §6（测试）。
 *
 * DEPTH-VIS-1.1（同设计 §10 L1–L5）：glass 叶标题不得落入幕布注释带
 * （`CHROME.textMuted` = DescBlock 用色）——叶的「淡」靠卡/字号字重，不靠标题变灰。
 *
 * 纯函数层：NodeG / OverlayEditor / Canvas scene / 导出 / note 浮窗都只许走这两个出口，
 * 任何按 depth 自行分档的读取都会与本文件断言的三主题阶梯漂移。
 */
import { describe, expect, it } from 'vitest';
import { fontOf, nodeCardStyle, visualRankOf } from '../src/render/geometry.js';
import { CHROME, THEMES } from '../src/theme/tokens.js';
import type { TokenSet } from '../src/theme/types.js';

/** [主题 id, 令牌] —— 三主题都必须过阶梯断言（glass 为深底重点主题） */
const THEME_ENTRIES: Array<[string, TokenSet]> = Object.entries(THEMES);

describe('visualRankOf：depth → 视觉档（三档切分 = 既有 depth 语义）', () => {
  it('depth 0 → root；1 → branch；≥2 → leaf（不引入「有子才算父」的新切分）', () => {
    expect(visualRankOf(0)).toBe('root');
    expect(visualRankOf(1)).toBe('branch');
    expect(visualRankOf(2)).toBe('leaf');
    expect(visualRankOf(3)).toBe('leaf');
    expect(visualRankOf(99)).toBe('leaf');
  });
});

describe('fontOf：字号/字重阶梯（父 > 一级 > 叶）', () => {
  it.each(THEME_ENTRIES)('%s：size 与 weight 均三档严格递减', (_id, token) => {
    const root = fontOf(token, 0);
    const branch = fontOf(token, 1);
    const leaf = fontOf(token, 2);
    expect(root.size).toBeGreaterThan(branch.size);
    expect(branch.size).toBeGreaterThan(leaf.size);
    expect(root.weight).toBeGreaterThan(branch.weight);
    expect(branch.weight).toBeGreaterThan(leaf.weight);
  });

  it('设计 §4 锁定值：classic 13/12/9 · 700/600/500', () => {
    const t = THEMES.classic;
    expect([fontOf(t, 0).size, fontOf(t, 1).size, fontOf(t, 2).size]).toEqual([13, 12, 9]);
    const w = [fontOf(t, 0).weight, fontOf(t, 1).weight, fontOf(t, 2).weight];
    expect(w).toEqual([700, 600, 500]);
  });

  it('设计 §4 锁定值：sticker 14/13/10 · 700/600/500', () => {
    const t = THEMES.sticker;
    expect([fontOf(t, 0).size, fontOf(t, 1).size, fontOf(t, 2).size]).toEqual([14, 13, 10]);
    const w = [fontOf(t, 0).weight, fontOf(t, 1).weight, fontOf(t, 2).weight];
    expect(w).toEqual([700, 600, 500]);
  });

  it('设计 §4 锁定值：glass 13/12/9 · 650/550/450（深底主题差距须够大）', () => {
    const t = THEMES.glass;
    expect([fontOf(t, 0).size, fontOf(t, 1).size, fontOf(t, 2).size]).toEqual([13, 12, 9]);
    const w = [fontOf(t, 0).weight, fontOf(t, 1).weight, fontOf(t, 2).weight];
    expect(w).toEqual([650, 550, 450]);
  });

  it('旧主题缺 sizeRoot / weightLeaf → 回退 size + 2 / weight（不得崩）', () => {
    const legacy: TokenSet = {
      ...THEMES.classic,
      font: { family: 'sans-serif', size: 11, sizeLeaf: 9, weight: 500, weightRoot: 600 },
    };
    expect(fontOf(legacy, 0)).toEqual({ size: 13, weight: 600 });
    expect(fontOf(legacy, 1)).toEqual({ size: 11, weight: 500 });
    expect(fontOf(legacy, 2)).toEqual({ size: 9, weight: 500 });
  });

  it('同档内不随具体 depth 漂移（depth 2 与 depth 9 同款；leaf 恒用 sizeLeaf）', () => {
    for (const [, token] of THEME_ENTRIES) {
      expect(fontOf(token, 9)).toEqual(fontOf(token, 2));
      expect(fontOf(token, 2).size).toBe(token.font.sizeLeaf);
    }
  });
});

/** #rrggbb → 三通道和（简单相对亮度代理；DESIGN §10 L4 的「通道和」口径） */
function channelSum(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`channelSum 只接受 #rrggbb：${hex}`);
  const n = Number.parseInt(m[1]!, 16);
  return ((n >> 16) & 0xff) + ((n >> 8) & 0xff) + (n & 0xff);
}

describe('DEPTH-VIS-1.1：叶标题 ≠ 幕布注释（DESIGN §10 L1–L5）', () => {
  it('glass leafDefault.text ≠ CHROME.textMuted，且更亮、≥ #d3d7e0', () => {
    const leaf = THEMES.glass.color.leafDefault.text;
    expect(leaf).not.toBe(CHROME.textMuted);
    expect(channelSum(leaf)).toBeGreaterThan(channelSum(CHROME.textMuted));
    expect(channelSum(leaf)).toBeGreaterThanOrEqual(channelSum('#d3d7e0'));
  });

  it('nodeCardStyle(glass, palette, "leaf").text 走 leafDefault（防接线漂移），测钉同上', () => {
    const token = THEMES.glass;
    const style = nodeCardStyle(token, token.color.branches[0]!, 'leaf');
    expect(style.text).toBe(token.color.leafDefault.text);
    expect(style.text).not.toBe(CHROME.textMuted);
    expect(channelSum(style.text)).toBeGreaterThan(channelSum(CHROME.textMuted));
  });

  it('classic / sticker：叶字不等于 CHROME.textMuted（浅底守卫，不强制提亮）', () => {
    expect(THEMES.classic.color.leafDefault.text).not.toBe(CHROME.textMuted);
    expect(THEMES.sticker.color.leafDefault.text).not.toBe(CHROME.textMuted);
  });
});
