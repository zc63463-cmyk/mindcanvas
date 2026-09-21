import { describe, expect, it } from 'vitest';
import { astToEditable, layoutMindmap, makeTextNode } from '@mindcanvas/kernel';
import {
  createCharMeasure,
  createDisplayMetricsFn,
  createNodeMeasure,
} from '../src/render/domMeasure.js';

const FONT = { family: 'Segoe UI, sans-serif', size: 11 };

describe('domMeasure：DOM 精确度量注入（T3）', () => {
  it('无 DOM 环境回退估算（Node 仍可布局）', () => {
    const measure = createCharMeasure(FONT, null);
    const wCjk = measure('测');
    const wAscii = measure('a');
    expect(wCjk).toBe(11);
    expect(wAscii).toBeCloseTo(6.82, 1);
  });

  it('createNodeMeasure 产出 >0 盒子；度量盒与 displayMetrics 同源', () => {
    const root = makeTextNode('根主题', [
      makeTextNode('子节点一'),
      makeTextNode('子节点二很长很长'),
    ]);
    const editable = astToEditable(root)!;
    const char = createCharMeasure(FONT, null);
    const metric = createDisplayMetricsFn(char, new Map());
    const measure = createNodeMeasure(char, new Map());
    const layout = layoutMindmap(editable, measure, new Set());
    expect(layout.nodes.length).toBe(3);
    for (const n of layout.nodes) {
      expect(n.box.w).toBeGreaterThan(0);
      expect(n.box.h).toBeGreaterThan(0);
      // 渲染度量与盒一致：盒宽 = 度量宽（同源）
      const m = metric(n.node);
      expect(n.box.w).toBe(m.w);
    }
  });

  it('文本度量随字体切换变化（主题字体驱动盒大小）', () => {
    const text = '思维导图渲染层';
    const small = createCharMeasure(FONT, null);
    const big = createCharMeasure({ ...FONT, size: 16 }, null);
    expect(big(text)).toBeGreaterThan(small(text));
  });
});
