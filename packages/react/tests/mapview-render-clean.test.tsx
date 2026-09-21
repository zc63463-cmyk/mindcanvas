// MapView 渲染卫生回归：初始渲染不得产生 React key 警告（A6 浏览器冒烟发现）。
// 历史缺陷：visibleNodes.map 返回无 key 的 <> Fragment；links 以 SVG d 字符串作 key
// （两条几何相同的边 → 重复 key）。
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { astToEditable, layoutMindmap, makeTextNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView } from '../src/render/MapView.js';
import { createCharMeasure } from '../src/render/domMeasure.js';

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

describe('MapView 渲染卫生（A6 冒烟回归）', () => {
  it('初始渲染零 React key 告警（links + nodes 两条列表）', () => {
    const errs: unknown[][] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      errs.push(a);
    });
    // 故意造两条几何形状相同的树边（对称兄弟子树）——复现旧 key 缺陷的形态
    const root = astToEditable(
      makeTextNode('根', [
        makeTextNode('A', [makeTextNode('A1'), makeTextNode('A2')]),
        makeTextNode('B', [makeTextNode('B1'), makeTextNode('B2')]),
      ]),
    )!;
    const layout = layoutMindmap(
      root,
      (n) => ({ w: 40 + (n.text?.length ?? 0) * 6, h: 30 }),
      new Set(),
    );
    render(
      <ThemeProvider>
        <MapView
          layout={layout}
          documentRoot={root}
          entities={new Map()}
          char={char}
          assetBaseUrl="/"
        />
      </ThemeProvider>,
    );
    spy.mockRestore();
    const keyWarnings = errs.filter(
      (a) =>
        String(a[0]).includes('unique "key"') ||
        String(a[0]).includes('unique key') ||
        String(a[0]).includes('missing key'),
    );
    if (keyWarnings.length > 0) console.log(keyWarnings.map((w) => w.join('\n')).join('\n---\n'));
    expect(keyWarnings).toHaveLength(0);
  });
});
