// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { IdbAssetHost } from '../src/chrome/idbAssetHost.js';
import { DemoAssetHost } from '../src/chrome/assetHost.js';

const STATIC = [
  {
    kind: 'img' as const,
    id: 'demo-assets/demo-diagram.svg',
    name: 'demo-diagram.svg',
    type: 'svg',
  },
];

// fake-indexeddb 的 DB 是进程级全局：每个用例前重置工厂，隔离上传残留
beforeEach(() => {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});

describe('IdbAssetHost：IndexedDB 持久化资产宿主（P0-2：上传刷新不丢）', () => {
  it('uploadAsset → 清单含新项 + resolveAsset 返回 blob URL（会话内）', async () => {
    const host = new IdbAssetHost(STATIC, '/');
    const file = new File(['<svg/>'], 'arch.svg', { type: 'image/svg+xml' });
    const item = await host.uploadAsset(file);
    expect(item).toMatchObject({ kind: 'draw', id: 'assets/arch.svg', name: 'arch.svg' });
    expect(host.hasAsset(item)).toBe(true);
    expect(host.resolveAsset(item)).toMatch(/^blob:/);
    const list = await host.listAssets();
    expect(list.some((a) => a.id === 'assets/arch.svg')).toBe(true);
  });

  it('持久化：新实例（同 DB）listAssets 仍含上传资产，resolveAsset 同步可解析', async () => {
    const first = new IdbAssetHost(STATIC, '/');
    await first.uploadAsset(new File(['png-data'], 'shot.png', { type: 'image/png' }));

    // 模拟刷新：全新实例重开同一 DB
    const second = new IdbAssetHost(STATIC, '/');
    const list = await second.listAssets();
    const up = list.find((a) => a.id === 'assets/shot.png');
    expect(up).toBeDefined();
    expect(up!.kind).toBe('img');
    // listAssets 已预热 objectURL → 同步 resolve 命中 blob
    expect(second.resolveAsset(up!)).toMatch(/^blob:/);
    // 静态清单仍在（并集）
    expect(list.some((a) => a.id === 'demo-assets/demo-diagram.svg')).toBe(true);
    // 静态资产（未上传）resolve 回落 baseUrl + id
    expect(
      second.resolveAsset({ kind: 'img', id: 'demo-assets/demo-diagram.svg' }),
    ).toBe('/demo-assets/demo-diagram.svg');
  });

  it('同名上传 → 替换语义（清单不重复，resolve 指向新内容）', async () => {
    const host = new IdbAssetHost([], '/');
    await host.uploadAsset(new File(['v1'], 'a.txt.png', { type: 'image/png' }));
    await host.uploadAsset(new File(['v2-longer-content'], 'a.txt.png', { type: 'image/png' }));
    const list = await host.listAssets();
    expect(list.filter((a) => a.id === 'assets/a.txt.png').length).toBe(1);
    // objectURL 已更新为新 blob（内容长度不同 → URL 必不同）
    const url = host.resolveAsset({ kind: 'img', id: 'assets/a.txt.png' });
    expect(url).toMatch(/^blob:/);
  });

  it('listAssets 幂等：重复调用不重复预热/不重复合并静态清单', async () => {
    const host = new IdbAssetHost(STATIC, '/');
    const l1 = await host.listAssets();
    const l2 = await host.listAssets();
    expect(l1).toEqual(l2);
    expect(l1.length).toBe(1);
  });

  it('hasAsset：未知 id → false', async () => {
    const host = new IdbAssetHost(STATIC, '/');
    expect(host.hasAsset({ kind: 'img', id: 'assets/none.png' })).toBe(false);
    expect(host.hasAsset(STATIC[0]!)).toBe(true);
  });
});

/**
 * FA1-T5：小 SVG 留下源码，让「设为节点图标」能把图标内联进 .mm.md
 * （脱离本机 IndexedDB 也能在 Obsidian / VS Code 里显示 = 自包含分发）。
 * 大 SVG / 位图不存文本：那会让库体积失控，且它们本来也不适合当图标。
 */
describe('IdbAssetHost：小 SVG 源码留存（FA1-T5 自包含）', () => {
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>';

  it('小 SVG 上传 → item.svg 带源码；新实例 listAssets 仍能取回（跨会话）', async () => {
    const first = new IdbAssetHost([], '/');
    const item = await first.uploadAsset(new File([SVG], 'star.svg', { type: 'image/svg+xml' }));
    expect(item.kind).toBe('draw');
    expect(item.svg).toBe(SVG);

    const second = new IdbAssetHost([], '/');
    const list = await second.listAssets();
    expect(list.find((a) => a.id === 'assets/star.svg')?.svg).toBe(SVG);
  });

  it('位图（png）不存 svg 源码（避免库膨胀 + 它当不了 currentColor 图标）', async () => {
    const host = new IdbAssetHost([], '/');
    const item = await host.uploadAsset(new File(['png-data'], 'shot.png', { type: 'image/png' }));
    expect(item.svg).toBeUndefined();
  });

  it('超过 15KB 的 SVG 不存源码（体积门槛）', async () => {
    const big = `<svg xmlns="http://www.w3.org/2000/svg">${'<path d="M0 0"/>'.repeat(1200)}</svg>`;
    expect(big.length).toBeGreaterThan(15 * 1024);
    const host = new IdbAssetHost([], '/');
    const item = await host.uploadAsset(new File([big], 'big.svg', { type: 'image/svg+xml' }));
    expect(item.svg).toBeUndefined();
  });
});

describe('DemoAssetHost：小 SVG 源码留存（与 IdbAssetHost 同口径）', () => {
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>';
  it('小 SVG 上传 → item.svg 有源码（换宿主不丢内联能力）', async () => {
    const host = new DemoAssetHost([]);
    const item = await host.uploadAsset(new File([SVG], 'star.svg', { type: 'image/svg+xml' }));
    expect(item.svg).toBe(SVG);
  });
});
