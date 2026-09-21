import { describe, expect, it } from 'vitest';
import { fixedNotePanelsOf } from '../src/render/fixedNotePanels.js';
import { nodeAuxiliaryRegions } from '../src/render/nodeAuxiliary.js';
import { estimateNoteAreaHeight } from '../src/chrome/NoteGrowthPanel.js';

describe('fixed note 笔记尺寸', () => {
  it('使用紧凑的卡片预留高度，避免固定态产生大块留白', () => {
    expect(estimateNoteAreaHeight()).toBe(132);
  });
});

describe('nodeAuxiliaryRegions', () => {
  it('keeps every auxiliary area disjoint and reserves the fixed note at the bottom', () => {
    const regions = nodeAuxiliaryRegions(300, {
      descHeight: 40,
      qaHeight: 80,
      fixedNoteHeight: 120,
    });

    expect(regions.body).toEqual({ y: 0, h: 60 });
    expect(regions.desc).toEqual({ y: 60, h: 40 });
    expect(regions.qa).toEqual({ y: 100, h: 80 });
    expect(regions.fixedNote).toEqual({ y: 180, h: 120 });
  });

  it('does not allocate an absent region', () => {
    const regions = nodeAuxiliaryRegions(156, { fixedNoteHeight: 120 });

    expect(regions.body).toEqual({ y: 0, h: 36 });
    expect(regions.desc).toBeNull();
    expect(regions.qa).toBeNull();
    expect(regions.fixedNote).toEqual({ y: 36, h: 120 });
  });
});

describe('fixedNotePanelsOf', () => {
  const layout = {
    nodes: [
      { node: { id: 'visible', note: { note: ['a'], note_text: 'visible text' } }, box: { x: 10, y: 10, w: 160, h: 156 } },
      { node: { id: 'offscreen', note: { note: ['b'], note_text: 'far away' } }, box: { x: 2000, y: 2000, w: 160, h: 156 } },
    ],
  };

  it('indexes once and omits fixed notes outside the visible world rect', () => {
    const panels = fixedNotePanelsOf(
      layout,
      new Set(['visible', 'offscreen']),
      new Set(['visible']),
      { x: 0, y: 0, w: 400, h: 400 },
      { k: 2, x: 5, y: 7 },
      120,
    );

    // 屏幕锚点不变；尺寸改为**世界基线 + k**（渲染侧用 transform: scale(k) 统一缩放）
    expect(panels).toEqual([
      expect.objectContaining({
        id: 'visible',
        editing: true,
        x: 25,
        y: 123,
        worldWidth: 160,
        worldHeight: 108,
        k: 2,
      }),
    ]);
    // 与旧口径（屏幕像素）等价：world × k
    expect(panels[0]!.worldWidth * panels[0]!.k).toBe(320);
    expect(panels[0]!.worldHeight * panels[0]!.k).toBe(216);
  });
});
