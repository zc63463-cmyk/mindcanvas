// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { AssetPanel, type AssetItem } from '../src/chrome/AssetPanel.js';
import {
  badgesFor,
  formatAssetStoreDetail,
  formatAssetWriteNotice,
  formatDurability,
  isForbiddenAssetCopy,
} from '../src/chrome/assetStoreCopy.js';

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

/**
 * P0-B ⑦：落点 / 可携带性徽章与文案（A3 ②、A6 ④、§2.3、§1.7）。
 *
 * 判别核心是**禁止表述**：界面不得出现「已保存，换电脑也能用」类承诺。
 * 这里既正面锁「该说的说了」（session-only 必须说「没有写入持久存储」），
 * 也反面锁「不该说的没说」（扫描全部导出文案）。
 */
describe('P0-B：落点徽章（AssetPanel.storeOf 通道）', () => {
  it('storeOf 给出的落点渲染成对应徽章；不同落点显示不同徽章（A1 ③）', () => {
    const items: AssetItem[] = [
      { kind: 'img', id: 'assets/red.png', name: 'red.png', type: 'png' },
      { kind: 'img', id: 'assets/blue.png', name: 'blue.png', type: 'png' },
    ];
    const { container } = render(
      <AssetPanel
        assets={items}
        defaultView="grid"
        onInsert={vi.fn()}
        onClose={vi.fn()}
        storeOf={(a) => (a.id.includes('red') ? 'workspace-assets' : 'browser-idb')}
      />,
    );
    const badges = Array.from(container.querySelectorAll('[data-asset-store]')).map((n) =>
      n.getAttribute('data-asset-store'),
    );
    expect(badges).toContain('workspace-assets');
    expect(badges).toContain('browser-idb');
    expect(container.textContent).toContain('📁 本工作区');
    expect(container.textContent).toContain('💾 浏览器');
  });

  it('storeOf 缺省 / 返回 null → 会话级徽章「⚠ 仅本次会话」（A3 ①）', () => {
    const { container } = render(
      <AssetPanel
        assets={[{ kind: 'img', id: 'assets/x.png', name: 'x.png', type: 'png' }]}
        defaultView="grid"
        onInsert={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const badge = container.querySelector('[data-asset-store]');
    expect(badge?.getAttribute('data-asset-store')).toBe('session');
    expect(container.textContent).toContain('仅本次会话');
  });

  it('内置项 → 🎨 内置徽章', () => {
    const { container } = render(
      <AssetPanel
        assets={[]}
        defaultView="grid"
        onInsert={vi.fn()}
        onClose={vi.fn()}
        storeOf={(a) => (a.source === 'builtin' ? 'builtin' : null)}
      />,
    );
    fireEvent.click(container.querySelector('[data-asset-tab]:nth-child(3)')!);
    expect(container.textContent).toContain('🎨 内置');
  });

  it('列表视图同样渲染落点徽章（两个视图口径一致）', () => {
    const { container } = render(
      <AssetPanel
        assets={[{ kind: 'img', id: 'assets/x.png', name: 'x.png', type: 'png' }]}
        onInsert={vi.fn()}
        onClose={vi.fn()}
        storeOf={() => 'workspace-assets'}
      />,
    );
    expect(container.querySelector('[data-asset-store="workspace-assets"]')).not.toBeNull();
  });
});

describe('P0-B：落点文案表（§1.7 允许/禁止）', () => {
  it('session-only 的文案含「没有写入持久存储」且**不含**「已保存」（A3 ② / A3 负控②）', () => {
    const text = formatAssetWriteNotice(null);
    expect(text).toContain('没有写入持久存储');
    expect(text).not.toContain('已保存');
  });

  it('browser-idb 的成功文案含「已保存」但**必须同时**给出失效条件（§4.3 纪律）', () => {
    const text = formatAssetWriteNotice('browser-idb');
    expect(text).toContain('已保存');
    expect(text).toMatch(/换浏览器|清理浏览器数据/);
    expect(text).toContain('缺失');
  });

  it('workspace-assets 文案说「把整个文件夹拷走仍可用」，且**不说**「换电脑也能用」', () => {
    const text = formatAssetWriteNotice('workspace-assets', '我的资料');
    expect(text).toContain('我的资料/assets/');
    expect(text).toContain('把整个文件夹拷走');
    expect(isForbiddenAssetCopy(text)).toBe(false);
  });

  it('data: 内联文案只讲「已作为文本写入文档」，不含任何「图片文件已保存」（A7 ①）', () => {
    const text = formatAssetWriteNotice('builtin');
    expect(text).toContain('作为文本写入文档');
    expect(text).not.toContain('图片文件');
  });

  it('isForbiddenAssetCopy：逐条命中 §2.3 禁止的表述', () => {
    expect(isForbiddenAssetCopy('已保存，换电脑也能用')).toBe(true);
    expect(isForbiddenAssetCopy('换机器还在')).toBe(true);
    expect(isForbiddenAssetCopy('单文件即可携带图片')).toBe(true);
    expect(isForbiddenAssetCopy('到哪都能用')).toBe(true);
    expect(isForbiddenAssetCopy('把整个文件夹拷走仍可用')).toBe(false);
  });

  it('**全部导出文案**都不含禁止表述（A6 负控：界面不得出现承诺）', () => {
    const texts = [
      formatAssetWriteNotice('workspace-assets', 'W'),
      formatAssetWriteNotice('browser-idb', 'W'),
      formatAssetWriteNotice('builtin', 'W'),
      formatAssetWriteNotice(null, 'W'),
      formatAssetStoreDetail('workspace-assets', 'W'),
      formatAssetStoreDetail('browser-idb', 'W'),
      formatAssetStoreDetail('builtin', 'W'),
      formatAssetStoreDetail(null, 'W'),
      formatDurability('workspace-assets', 'W'),
      formatDurability('browser-idb', 'W'),
      formatDurability(null, 'W'),
    ];
    for (const t of texts) {
      expect(isForbiddenAssetCopy(t), `禁止表述出现在：${t}`).toBe(false);
    }
  });

  it('badgesFor：落点徽章 + 可携带性徽章成对，会话级可携带性为「—」（§2.3 表）', () => {
    expect(badgesFor('workspace-assets')).toEqual({
      badge: '📁 本工作区',
      portability: '📦 随文件夹',
    });
    expect(badgesFor('browser-idb').portability).toBe('🔒 仅此浏览器');
    expect(badgesFor('builtin').portability).toBe('✈ 自包含');
    expect(badgesFor(null)).toEqual({ badge: '⚠ 仅本次会话', portability: '—' });
  });

  it('未知工作区名时不编造名字（回落「工作区」）', () => {
    expect(formatAssetWriteNotice('workspace-assets')).toContain('工作区/assets/');
    expect(formatAssetStoreDetail('workspace-assets', '')).toContain('工作区/assets/');
  });
});
