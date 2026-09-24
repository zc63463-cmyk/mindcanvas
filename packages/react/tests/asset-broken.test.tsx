// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { astToEditable, layoutMindmap, makeEntityNode, makeTextNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView } from '../src/render/MapView.js';
import { AssetPanel } from '../src/chrome/AssetPanel.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

function assetLayout() {
  const root = makeTextNode('根', [makeEntityNode({ kind: 'img', id: 'demo-assets/missing.svg' })]);
  return layoutMindmap(astToEditable(root)!, createNodeMeasure(char, new Map()), new Set());
}

function brokenImage(container: HTMLElement): SVGImageElement {
  const img = container.querySelector('image')!;
  fireEvent.error(img);
  return img;
}

describe('资产失效态（P2：加载失败 → warn 占位 + 面板失效标识）', () => {
  it('@img 加载失败 → 图片隐藏 + warn 占位出现（data-asset-broken）', () => {
    const { container } = render(
      <ThemeProvider>
        <MapView layout={assetLayout()} entities={new Map()} char={char} assetBaseUrl="/" />
      </ThemeProvider>,
    );
    expect(container.querySelector('image')).not.toBeNull(); // 正常：先渲染图片
    brokenImage(container);
    expect(container.querySelector('image')).toBeNull(); // 失败：图片隐藏
    const broken = container.querySelector('g[data-asset-broken] rect');
    expect(broken).not.toBeNull();
    expect(broken?.getAttribute('stroke')).toBe('#f76b58'); // glass 主题 warn
    expect(container.textContent).toContain('资产缺失');
  });

  it('加载成功路径不受影响（无 onError 触发 → 无占位）', () => {
    const { container } = render(
      <ThemeProvider>
        <MapView layout={assetLayout()} entities={new Map()} char={char} assetBaseUrl="/" />
      </ThemeProvider>,
    );
    expect(container.querySelector('g[data-asset-broken]')).toBeNull();
    expect(container.querySelector('image')).not.toBeNull();
  });

  it('AssetPanel：isMissing 项 → 失效标识（data-missing + 禁止插入）', () => {
    const insert = vi.fn();
    const assets = [
      { kind: 'img' as const, id: 'demo-assets/ok.svg', name: 'ok.svg', type: 'svg' },
      { kind: 'draw' as const, id: 'assets/lost.svg', name: 'lost.svg', type: 'svg' },
    ];
    const { container } = render(
      <AssetPanel
        assets={assets}
        onInsert={insert}
        onClose={vi.fn()}
        isMissing={(a) => a.id === 'assets/lost.svg'}
      />,
    );
    const items = container.querySelectorAll('[data-asset-item]');
    expect(items[0]?.getAttribute('data-missing')).toBeNull();
    expect(items[1]?.getAttribute('data-missing')).toBeDefined();
    expect(container.textContent).toContain('（失效）');
    // 失效项点击不触发插入
    fireEvent.click(items[1]!);
    expect(insert).not.toHaveBeenCalled();
    fireEvent.click(items[0]!);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('AssetPanel 缺省无 isMissing → 全部可插入（回归）', () => {
    const insert = vi.fn();
    const assets = [{ kind: 'img' as const, id: 'a.svg', name: 'a.svg', type: 'svg' }];
    const { container } = render(
      <AssetPanel assets={assets} onInsert={insert} onClose={vi.fn()} />,
    );
    fireEvent.click(container.querySelector('[data-asset-item]')!);
    expect(insert).toHaveBeenCalledTimes(1);
  });
});

/**
 * ── P0-FIX-R1 R1-2(j)：五态下**缺失信号不得被吞** ────────────────────────
 *
 * 修复渲染回落 404 时最容易犯的错是「既然不发请求了，那也别画 ✕ 了」——
 * 那会把「这张图不在」变成「什么也没发生」，用户失去唯一线索（缺失诊断口径同样弱化）。
 * 这里把「真缺失仍画 ✕」与「加载中不画 ✕」成对钉住。
 */
describe('资产缺失信号（R1-2：unresolved 保留 ✕，pending 不冒充缺失）', () => {
  function fiveStateLayout() {
    const root = makeTextNode('根', [
      makeEntityNode({ kind: 'img', id: 'assets/gone.png' }),
      makeEntityNode({ kind: 'img', id: 'assets/loading.png' }),
    ]);
    const editable = astToEditable(root);
    if (!editable) throw new Error('fixture broken: astToEditable returned null');
    return layoutMindmap(editable, createNodeMeasure(char, new Map()), new Set());
  }

  it('unresolved → 画 ✕ 且不渲染 <image>（不发必然 404 的请求）；pending → 两者都不出现', () => {
    const { container } = render(
      <ThemeProvider>
        <MapView
          layout={fiveStateLayout()}
          entities={new Map()}
          char={char}
          assetBaseUrl="/"
          resolveAssetState={(ref) =>
            ref.id === 'assets/gone.png'
              ? { kind: 'unresolved', reason: 'missing' }
              : { kind: 'pending', reason: 'listing' }
          }
        />
      </ThemeProvider>,
    );
    // 缺失那条：✕ 占位在（信号保留）
    const broken = container.querySelectorAll('[data-asset-broken]');
    expect(broken.length).toBe(1);
    expect(container.textContent).toContain('资产缺失');
    // 两条都**没有** <image>：一个不发必然失败的请求，一个还不想出图
    expect(container.querySelectorAll('image').length).toBe(0);
  });

  it('unresolved 的 ✕ 不依赖 onError（没有加载就没有失败事件，占位须由状态直出）', () => {
    const { container } = render(
      <ThemeProvider>
        <MapView
          layout={fiveStateLayout()}
          entities={new Map()}
          char={char}
          assetBaseUrl="/"
          resolveAssetState={() => ({ kind: 'unresolved', reason: 'no-scope' })}
        />
      </ThemeProvider>,
    );
    // 全未挂载 → 两条都画 ✕（两条都是「不在」，不是一个「不在」一个「在加载」）
    expect(container.querySelectorAll('[data-asset-broken]').length).toBe(2);
    expect(container.querySelectorAll('image').length).toBe(0);
  });
});
