// @vitest-environment jsdom
/**
 * FA1-T3/T4：素材中心的网格视图、分类检索与插入语义。
 *
 * 锁死这次重构要解决的三件事：
 *  1. 面板能呈现现代网格（不再是 230px 单列文本列表）；
 *  2. 搜索 + 分类 Tabs 可用（大图集里找得到东西）；
 *  3. 点击素材可自由选择「节点图标 / 节点插图 / 子分支」——
 *     不再无差别新建子节点（旧行为由 onInsert 兜底，仍可用）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ASSET_ACTION_LABEL, AssetPanel, type AssetItem } from '../src/chrome/AssetPanel.js';
import { BUILTIN_ICONS } from '../src/chrome/assetIcons.js';

// vitest 未开 globals，@testing-library/react 不会自动清理 DOM；显式 afterEach(cleanup) 避免用例间泄漏
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const ASSETS: AssetItem[] = [
  { kind: 'img', id: 'demo-assets/demo-diagram.svg', name: 'demo-diagram.svg', type: 'svg' },
  { kind: 'draw', id: 'demo-assets/board.svg', name: 'board.svg', type: 'svg' },
  { kind: 'img', id: 'demo-assets/photo.png', name: 'photo.png', type: 'png' },
];

function gridPanel(over: Partial<Parameters<typeof AssetPanel>[0]> = {}) {
  return render(
    <AssetPanel
      assets={ASSETS}
      onInsert={vi.fn()}
      onClose={vi.fn()}
      defaultView="grid"
      {...over}
    />,
  );
}

describe('AssetPanel：网格视图（FA1-T4）', () => {
  it('defaultView=grid → 渲染网格容器，每个资产一个卡片', () => {
    const { container } = gridPanel();
    expect(container.querySelector('[data-asset-grid]')).not.toBeNull();
    // 默认 Tab = 本地上传，只含宿主资产（内置图标另有 Tab）
    expect(container.querySelectorAll('[data-asset-item]').length).toBe(ASSETS.length);
  });

  it('网格卡片为 80px 卡片 + 48px 矢量预览（非 32×22 小缩略图）', () => {
    const { container } = gridPanel({ resolve: (a) => '/base/' + a.id });
    const img = container.querySelector('img');
    expect(img?.getAttribute('width')).toBe('48');
    expect(img?.getAttribute('height')).toBe('48');
    expect(img?.getAttribute('src')).toBe('/base/demo-assets/demo-diagram.svg');
  });

  it('可切换到列表视图（数据-Scroller 仍在，虚拟滚动未被移除）', () => {
    const { container } = gridPanel();
    fireEvent.click(container.querySelector('[data-asset-view="list"]')!);
    expect(container.querySelector('[data-asset-scroller]')).not.toBeNull();
    expect(container.querySelector('[data-asset-grid]')).toBeNull();
  });
});

describe('AssetPanel：搜索与分类（FA1-T4）', () => {
  it('搜索框实时过滤（按名称）', () => {
    const { container } = gridPanel();
    const input = container.querySelector('[data-asset-search]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'board' } });
    const names = Array.from(container.querySelectorAll('[data-asset-item]')).map(
      (el) => el.textContent ?? '',
    );
    expect(names.length).toBe(1);
    expect(names[0]).toContain('board.svg');
  });

  it('搜索可按类型命中（png 只命中图片，不命中 svg）', () => {
    const { container } = gridPanel();
    const input = container.querySelector('[data-asset-search]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'png' } });
    const names = Array.from(container.querySelectorAll('[data-asset-item]')).map(
      (el) => el.textContent ?? '',
    );
    expect(names.length).toBe(1);
    expect(names[0]).toContain('photo.png');
  });

  it('无命中 → 空态给出「没有匹配」提示，而不是空白', () => {
    const { container } = gridPanel();
    const input = container.querySelector('[data-asset-search]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(container.textContent).toContain('没有匹配');
  });

  it('内置图标 Tab → 出现内置矢量图标（开箱可用，不依赖用户上传）', () => {
    const { container } = gridPanel();
    const tabs = Array.from(container.querySelectorAll('[data-asset-tab]'));
    const builtinTab = tabs.find((t) => (t.textContent ?? '').includes('内置'));
    fireEvent.click(builtinTab!);
    expect(container.querySelectorAll('[data-asset-item]').length).toBe(BUILTIN_ICONS.length);
    expect(container.textContent).toContain(BUILTIN_ICONS[0]!.name);
  });

  it('内置图标卡片的 src 是带具体颜色的 data URL（currentColor 在 <img> 里会解析成黑）', () => {
    const { container } = gridPanel();
    const tabs = Array.from(container.querySelectorAll('[data-asset-tab]'));
    fireEvent.click(tabs.find((t) => (t.textContent ?? '').includes('内置'))!);
    const img = container.querySelector('img');
    const src = img?.getAttribute('src') ?? '';
    expect(src.startsWith('data:image/svg+xml')).toBe(true);
    expect(src).not.toContain('currentColor');
    expect(decodeURIComponent(src)).toContain('#e8eaef');
  });

  it('收藏（★）→ 常用 Tab 只出现收藏项', () => {
    const { container } = gridPanel();
    // 收藏第 1 张卡
    fireEvent.click(container.querySelector('[data-asset-fav]')!);
    const tabs = Array.from(container.querySelectorAll('[data-asset-tab]'));
    fireEvent.click(tabs.find((t) => (t.textContent ?? '').includes('常用'))!);
    const names = Array.from(container.querySelectorAll('[data-asset-item]')).map(
      (el) => el.textContent ?? '',
    );
    expect(names.length).toBe(1);
    expect(names[0]).toContain('demo-diagram.svg');
  });
});

describe('AssetPanel：插入语义三选一（FA1-T3）', () => {
  it('默认（未传 onInsertAs）→ 点击仍走 onInsert（既有调用方零破坏）', () => {
    const insert = vi.fn();
    const { container } = gridPanel({ onInsert: insert });
    expect(container.querySelector('[data-asset-action]')).toBeNull();
    fireEvent.click(container.querySelectorAll('[data-asset-item]')[0]!);
    expect(insert).toHaveBeenCalledWith(ASSETS[0]);
  });

  it('传入 onInsertAs → 出现「插入为」三选一，默认子分支', () => {
    const { container } = gridPanel({ onInsertAs: vi.fn() });
    const actions = Array.from(container.querySelectorAll('[data-asset-action]'));
    expect(actions.map((a) => a.textContent)).toEqual([
      ASSET_ACTION_LABEL.icon,
      ASSET_ACTION_LABEL.media,
      ASSET_ACTION_LABEL.child,
    ]);
    expect(actions[2]!.getAttribute('data-active')).not.toBeNull();
  });

  it('切到「节点图标」后点击素材 → onInsertAs(item, "icon")', () => {
    const insertAs = vi.fn();
    const { container } = gridPanel({ onInsertAs: insertAs });
    fireEvent.click(container.querySelector('[data-asset-action="icon"]')!);
    fireEvent.click(container.querySelectorAll('[data-asset-item]')[0]!);
    expect(insertAs).toHaveBeenCalledWith(ASSETS[0], 'icon');
  });

  it('切到「节点插图」后点击素材 → onInsertAs(item, "media")（不再新建子节点）', () => {
    const insertAs = vi.fn();
    const { container } = gridPanel({ onInsertAs: insertAs });
    fireEvent.click(container.querySelector('[data-asset-action="media"]')!);
    fireEvent.click(container.querySelectorAll('[data-asset-item]')[1]!);
    expect(insertAs).toHaveBeenCalledWith(ASSETS[1], 'media');
  });

  it('语义选择跨点击保持（连点两次都是 icon）', () => {
    const insertAs = vi.fn();
    const { container } = gridPanel({ onInsertAs: insertAs });
    fireEvent.click(container.querySelector('[data-asset-action="icon"]')!);
    fireEvent.click(container.querySelectorAll('[data-asset-item]')[0]!);
    fireEvent.click(container.querySelectorAll('[data-asset-item]')[1]!);
    expect(insertAs).toHaveBeenNthCalledWith(1, ASSETS[0], 'icon');
    expect(insertAs).toHaveBeenNthCalledWith(2, ASSETS[1], 'icon');
  });
});

describe('AssetPanel：上传热区与粘贴入库（FA1-T4）', () => {
  it('有 onUpload → 底部虚线 Dropzone 可见且文案明确', () => {
    const { container } = gridPanel({ onUpload: vi.fn() });
    const zone = container.querySelector('[data-asset-dropzone]');
    expect(zone).not.toBeNull();
    expect(zone?.textContent).toContain('拖拽 SVG / 图片到此处');
  });

  it('点 Dropzone → 触发隐藏 file input', () => {
    const { container } = gridPanel({ onUpload: vi.fn() });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');
    fireEvent.click(container.querySelector('[data-asset-dropzone]')!);
    expect(clickSpy).toHaveBeenCalled();
  });

  it('剪贴板粘贴 <svg> 纯文本 → 合成 File 交给 onPaste', () => {
    const onPaste = vi.fn();
    gridPanel({ onPaste });
    const event = new Event('paste', { bubbles: true }) as Event & {
      clipboardData: { files: File[]; getData: (t: string) => string };
    };
    Object.defineProperty(event, 'clipboardData', {
      value: { files: [], getData: () => '<svg xmlns="http://www.w3.org/2000/svg"></svg>' },
    });
    window.dispatchEvent(event);
    expect(onPaste).toHaveBeenCalledTimes(1);
    const [files] = onPaste.mock.calls[0] as [File[]];
    expect(files[0]?.name.endsWith('.svg')).toBe(true);
  });

  it('剪贴板粘贴的普通文本（非 SVG）→ 不入库', () => {
    const onPaste = vi.fn();
    gridPanel({ onPaste });
    const event = new Event('paste', { bubbles: true }) as Event & {
      clipboardData: { files: File[]; getData: (t: string) => string };
    };
    Object.defineProperty(event, 'clipboardData', { value: { files: [], getData: () => 'hello' } });
    window.dispatchEvent(event);
    expect(onPaste).not.toHaveBeenCalled();
  });

  it('未传 onUpload → 无 Dropzone、无 file input（只读用法零破坏）', () => {
    const { container } = gridPanel();
    expect(container.querySelector('[data-asset-dropzone]')).toBeNull();
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });
});
