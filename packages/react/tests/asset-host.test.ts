// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { DemoAssetHost, isImageFileName, kindOfFileName } from '../src/chrome/assetHost.js';

const ASSETS = [
  {
    kind: 'img' as const,
    id: 'demo-assets/demo-diagram.svg',
    name: 'demo-diagram.svg',
    type: 'svg',
  },
  { kind: 'draw' as const, id: 'demo-assets/board.svg', name: 'board.svg', type: 'svg' },
];

describe('资产宿主（P0：每导图一个资产空间，宿主注入清单/解析/上传）', () => {
  it('listAssets：返回打包清单副本（异步契约）', async () => {
    const host = new DemoAssetHost(ASSETS, '/');
    expect(await host.listAssets()).toEqual(ASSETS);
    // 副本：外部改不了宿主内部清单
    const list = await host.listAssets();
    list.pop();
    expect((await host.listAssets()).length).toBe(2);
  });

  it('resolveAsset：baseUrl + 导图相对 id', () => {
    const host = new DemoAssetHost(ASSETS, '/demo-assets/');
    expect(host.resolveAsset(ASSETS[0]!)).toBe('/demo-assets/demo-assets/demo-diagram.svg');
    expect(host.resolveAsset({ kind: 'img', id: 'assets/x.png' })).toBe(
      '/demo-assets/assets/x.png',
    );
  });

  it('uploadAsset：加入清单 + objectURL 解析（会话级）', async () => {
    const host = new DemoAssetHost(ASSETS);
    const file = new File(['<svg/>'], 'arch.svg', { type: 'image/svg+xml' });
    const item = await host.uploadAsset(file);
    expect(item).toMatchObject({ kind: 'draw', id: 'assets/arch.svg', name: 'arch.svg' });
    expect(host.hasAsset(item)).toBe(true);
    expect(host.resolveAsset(item)).toMatch(/^blob:/); // objectURL 可加载
    expect((await host.listAssets()).length).toBe(3);
  });

  it('uploadAsset：同名文件 → 替换语义（清单不重复，resolve 指向新内容）', async () => {
    const host = new DemoAssetHost(ASSETS);
    await host.uploadAsset(new File(['v1'], 'dup.png', { type: 'image/png' }));
    const item2 = await host.uploadAsset(new File(['v2-longer-content'], 'dup.png', { type: 'image/png' }));
    const list = await host.listAssets();
    expect(list.filter((a) => a.id === 'assets/dup.png').length).toBe(1);
    expect(host.hasAsset(item2)).toBe(true);
    expect(host.resolveAsset(item2)).toMatch(/^blob:/);
  });

  it('hasAsset：未知 id → false；kindOfFileName 按扩展名归类', () => {
    const host = new DemoAssetHost(ASSETS);
    expect(host.hasAsset(ASSETS[0]!)).toBe(true);
    expect(host.hasAsset({ kind: 'img', id: 'missing.png' })).toBe(false);
    expect(kindOfFileName('a.svg')).toBe('draw');
    expect(kindOfFileName('b.png')).toBe('img');
    expect(kindOfFileName('c.jpeg')).toBe('img');
  });

  it('isImageFileName：扩展名兜底（file.type 为空的系统拖拽场景，N-6）', () => {
    expect(isImageFileName('a.png')).toBe(true);
    expect(isImageFileName('b.JPG')).toBe(true);
    expect(isImageFileName('c.jpeg')).toBe(true);
    expect(isImageFileName('d.webp')).toBe(true);
    expect(isImageFileName('e.avif')).toBe(true);
    expect(isImageFileName('f.svg')).toBe(true);
    expect(isImageFileName('g.gif')).toBe(true);
    expect(isImageFileName('h.txt')).toBe(false);
    expect(isImageFileName('i.mm.md')).toBe(false);
    expect(isImageFileName('noext')).toBe(false);
  });
});
