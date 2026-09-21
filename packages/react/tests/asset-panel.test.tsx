// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { AssetPanel, type AssetItem } from '../src/chrome/AssetPanel.js';

// vitest 未开 globals，@testing-library/react 不会自动清理 DOM；显式 afterEach(cleanup) 避免用例间泄漏
afterEach(cleanup);

const ASSETS: AssetItem[] = [
  { kind: 'img', id: 'demo-assets/demo-diagram.svg', name: 'demo-diagram.svg', type: 'svg' },
  { kind: 'draw', id: 'demo-assets/board.svg', name: 'board.svg', type: 'svg' },
];

describe('AssetPanel：图库侧栏', () => {
  it('渲染资产列表（名称 + 类型徽章）', () => {
    const { container } = render(
      <AssetPanel assets={ASSETS} onInsert={vi.fn()} onClose={vi.fn()} />,
    );
    expect(container.textContent).toContain('demo-diagram.svg');
    expect(container.textContent).toContain('board.svg');
  });

  it('点击资产 → onInsert 回调该资产项', () => {
    const insert = vi.fn();
    const { getByText } = render(
      <AssetPanel assets={ASSETS} onInsert={insert} onClose={vi.fn()} />,
    );
    fireEvent.click(getByText('demo-diagram.svg'));
    expect(insert).toHaveBeenCalledWith(ASSETS[0]);
  });

  it('点击关闭 → onClose', () => {
    const close = vi.fn();
    const { container } = render(<AssetPanel assets={ASSETS} onInsert={vi.fn()} onClose={close} />);
    fireEvent.click(container.querySelector('[data-asset-close]')!);
    expect(close).toHaveBeenCalled();
  });

  it('空资产 → 空态引导（指向面板上传/画布拖拽，不再指浏览器做不到的本地目录）', () => {
    const { container } = render(
      <AssetPanel assets={[]} onInsert={vi.fn()} onClose={vi.fn()} onUpload={vi.fn()} />,
    );
    expect(container.textContent).toContain('上传');
    expect(container.textContent).not.toContain('assets/');
  });
});

/**
 * P1-1 面板上传入口：唯一外部入口曾是「拖进画布/粘贴」，图库面板只读。
 * 上传按钮（file input）+ 面板拖拽 → onUpload(files)；未传 onUpload 时按钮不渲染（向后兼容）。
 */
describe('AssetPanel：上传入口（P1-1）', () => {
  const FILES = [new File(['x'], 'u.png', { type: 'image/png' })];

  it('提供 onUpload → 渲染上传按钮；点击按钮触发隐藏 file input', () => {
    const { container } = render(
      <AssetPanel assets={ASSETS} onInsert={vi.fn()} onClose={vi.fn()} onUpload={vi.fn()} />,
    );
    const btn = container.querySelector('[data-asset-upload]');
    expect(btn).not.toBeNull();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    const clickSpy = vi.spyOn(input, 'click');
    fireEvent.click(btn!);
    expect(clickSpy).toHaveBeenCalled();
  });

  it('file input change → onUpload 收到文件数组', () => {
    const onUpload = vi.fn();
    const { container } = render(
      <AssetPanel assets={ASSETS} onInsert={vi.fn()} onClose={vi.fn()} onUpload={onUpload} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: FILES });
    fireEvent.change(input);
    expect(onUpload).toHaveBeenCalledWith(FILES);
  });

  it('面板 drop 文件 → 阻止默认并透传 onUpload', () => {
    const onUpload = vi.fn();
    const { container } = render(
      <AssetPanel assets={ASSETS} onInsert={vi.fn()} onClose={vi.fn()} onUpload={onUpload} />,
    );
    const panel = container.querySelector('[data-asset-panel]')!;
    const dt = { files: FILES };
    const dropEvent = fireEvent.drop(panel, { dataTransfer: dt, bubbles: true });
    expect(dropEvent).toBe(false); // fireEvent 返回 false = preventDefault 已被调用
    expect(onUpload).toHaveBeenCalledWith(FILES);
  });

  it('未传 onUpload → 上传按钮不渲染（既有只读用法零破坏）', () => {
    const { container } = render(<AssetPanel assets={ASSETS} onInsert={vi.fn()} onClose={vi.fn()} />);
    expect(container.querySelector('[data-asset-upload]')).toBeNull();
    expect(() => {
      fireEvent.drop(container.querySelector('[data-asset-panel]')!, {
        dataTransfer: { files: FILES },
        bubbles: true,
      });
    }).not.toThrow();
  });
});
