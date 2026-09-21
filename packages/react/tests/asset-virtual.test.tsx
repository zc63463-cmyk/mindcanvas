// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { AssetPanel, type AssetItem } from '../src/chrome/AssetPanel.js';

/** 批量构造资产 */
function assetsOf(n: number): AssetItem[] {
  return Array.from({ length: n }, (_, i) => ({
    kind: 'img' as const,
    id: `assets/a${i}.svg`,
    name: `a${i}.svg`,
    type: 'svg',
  }));
}

describe('AssetPanel 虚拟滚动（P3：大图集窗口化渲染）', () => {
  it('500 资产 → 只渲染可视区间（DOM << 500），滚动后区间移动', () => {
    const { container } = render(
      <AssetPanel assets={assetsOf(500)} onInsert={vi.fn()} onClose={vi.fn()} />,
    );
    const scroller = container.querySelector('[data-asset-scroller]') as HTMLElement;
    expect(scroller).not.toBeNull();
    const initial = container.querySelectorAll('[data-asset-item]').length;
    expect(initial).toBeGreaterThan(0);
    expect(initial).toBeLessThan(60); // 窗口化：远小于全量 500

    // 滚动到中部 → 区间移动（首项不再是 a0）
    Object.defineProperty(scroller, 'scrollTop', { value: 250 * 30, writable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 400, writable: true });
    fireEvent.scroll(scroller);
    const texts = Array.from(container.querySelectorAll('[data-asset-item]')).map(
      (el) => el.textContent ?? '',
    );
    expect(texts.some((t) => t.includes('a250'))).toBe(true);
    expect(texts.some((t) => t.includes('a0'))).toBe(false);
    expect(container.querySelectorAll('[data-asset-item]').length).toBeLessThan(60);
  });

  it('缩略图：resolve prop → img src = 宿主解析 URL；失效自动隐藏', () => {
    const assets = [{ kind: 'img' as const, id: 'assets/x.svg', name: 'x.svg', type: 'svg' }];
    const { container } = render(
      <AssetPanel
        assets={assets}
        onInsert={vi.fn()}
        onClose={vi.fn()}
        resolve={(a) => '/base/' + a.id}
      />,
    );
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/base/assets/x.svg');
    fireEvent.error(img!);
    expect(container.querySelector('img')).toBeNull(); // 失效缩略图隐藏
  });

  it('缺省 resolve → 不渲染缩略图（回归既有形态）', () => {
    const { container } = render(
      <AssetPanel
        assets={[{ kind: 'img' as const, id: 'a.svg', name: 'a.svg', type: 'svg' }]}
        onInsert={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container.querySelector('img')).toBeNull();
  });
});
