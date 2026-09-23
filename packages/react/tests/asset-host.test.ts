// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  ASSET_CONFLICT_LABEL,
  ASSET_CONFLICT_ORDER,
  assetFavKey,
  assetKeyOf,
  BROWSER_SCOPE_KEY,
  browserScopeMark,
  cacheKeyOf,
  copyNameFor,
  DEFAULT_ASSET_CONFLICT_CHOICE,
  DemoAssetHost,
  durabilityOfStore,
  isExternalRef,
  isImageFileName,
  isSelfContainedRef,
  isWorkspaceAssetRef,
  kindOfFileName,
  portabilityOfStore,
  uniqueAssetName,
} from '../src/chrome/assetHost.js';

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

/**
 * P0-B：三态可判别 / 可携带性 / 同名三选 / 五态解析的**纯函数层**。
 *
 * 锚点（acceptance §3 A2 A3、§3.1 N2、shared-contracts §4.5.1 §4.5.2 §1.7）：
 *  - A3 负控①：沿用「只返回 AssetItem」的现状接口 → 「能区分三态」必须失败；
 *  - N2 负控：用 size+mtime 判同内容 → 「新内容已保存」必须失败；
 *  - I-12：`written` 只说明本次写入成功，**不**说明可携带。
 */
describe('P0-B：store ↔ portability ↔ durability 的单点映射', () => {
  it('portabilityOfStore：workspace-assets → folder-relative；browser-idb → browser-local；builtin → self-contained', () => {
    expect(portabilityOfStore('workspace-assets')).toBe('folder-relative');
    expect(portabilityOfStore('browser-idb')).toBe('browser-local');
    expect(portabilityOfStore('builtin')).toBe('self-contained');
  });

  it('durabilityOfStore：browser-idb 是 browser-storage（本机持久但**不可携带**），null → session-only', () => {
    expect(durabilityOfStore('workspace-assets')).toBe('filesystem');
    // 关键分野：browser-idb 不能在耐久性上被当成「跟 workspace 一样」
    expect(durabilityOfStore('browser-idb')).toBe('browser-storage');
    expect(durabilityOfStore('builtin')).toBe('session-only');
    expect(durabilityOfStore(null)).toBe('session-only');
  });

  it('可携带性与本地持久性**不是同一个字段**（I-12 的结构保证）', () => {
    // browser-idb：本机持久（browser-storage）却不可携带（browser-local）
    const store = 'browser-idb' as const;
    expect(durabilityOfStore(store)).not.toBe('session-only');
    expect(portabilityOfStore(store)).toBe('browser-local');
  });
});

describe('P0-B：AssetKey 构造（勘误 E-3 §4.7.1）', () => {
  it('assetKeyOf = id 整体（不含 kind 前缀）；assetFavKey 补回 kind:', () => {
    expect(assetKeyOf({ id: 'assets/a.png' })).toBe('assets/a.png');
    expect(assetKeyOf({ id: 'builtin:star' })).toBe('builtin:star');
    expect(assetFavKey('img', 'assets/a.png')).toBe('img:assets/a.png');
    expect(assetFavKey('draw', 'builtin:star')).toBe('draw:builtin:star');
  });

  it('data URL 的中段冒号不被误切（与 parseAssetFavKey 的「只切第一个冒号」同口径）', () => {
    const dataUrl = 'data:image/svg+xml;utf8,%3Csvg%3E';
    expect(assetFavKey('draw', dataUrl)).toBe(`draw:${dataUrl}`);
    const key = assetFavKey('draw', dataUrl);
    const sep = key.indexOf(':');
    expect(key.slice(sep + 1)).toBe(dataUrl);
  });
});

describe('P0-B：引用形态判定（I-4 / I-5）', () => {
  it('isWorkspaceAssetRef：只认 assets/ 前缀，且排除自包含与外部', () => {
    expect(isWorkspaceAssetRef('assets/a.png')).toBe(true);
    expect(isWorkspaceAssetRef('demo-assets/x.svg')).toBe(false);
    expect(isWorkspaceAssetRef('builtin:star')).toBe(false);
    expect(isWorkspaceAssetRef('data:image/svg+xml;utf8,x')).toBe(false);
    expect(isWorkspaceAssetRef('https://example.com/a.png')).toBe(false);
  });

  it('isExternalRef：http(s) / 协议相对 / ../ / ./ 一律视为外部（不产生 W-ASSET-MISSING）', () => {
    expect(isExternalRef('https://example.com/x.png')).toBe(true);
    expect(isExternalRef('HTTP://example.com/x.png')).toBe(true);
    expect(isExternalRef('//cdn.example.com/x.png')).toBe(true);
    expect(isExternalRef('../assets/x.png')).toBe(true);
    expect(isExternalRef('./x.png')).toBe(true);
    expect(isExternalRef('assets/x.png')).toBe(false);
  });

  it('isSelfContainedRef：builtin: 与 data: 自包含（不属于任何作用域，I-5）', () => {
    expect(isSelfContainedRef('builtin:star')).toBe(true);
    expect(isSelfContainedRef('data:image/svg+xml;utf8,x')).toBe(true);
    expect(isSelfContainedRef('assets/a.png')).toBe(false);
  });
});

describe('P0-B：缓存键含作用域（R-07）', () => {
  it('cacheKeyOf：同 id 在不同作用域 → 不同键（两个工作区的 a.png 不互相覆盖）', () => {
    const a = cacheKeyOf({ scopeKey: 'ws:A', epoch: 1 }, 'assets/a.png');
    const b = cacheKeyOf({ scopeKey: 'ws:B', epoch: 1 }, 'assets/a.png');
    expect(a).not.toBe(b);
    expect(a).toBe('ws:A::assets/a.png');
    expect(b).toBe('ws:B::assets/a.png');
  });

  it('browserScopeMark：无工作区时唯一作用域 = browser:local（与 P0-D 索引层同口径）', () => {
    expect(BROWSER_SCOPE_KEY).toBe('browser:local');
    expect(browserScopeMark(7)).toEqual({ scopeKey: 'browser:local', epoch: 7 });
  });
});

describe('P0-B：同名三选（§4.5.2 / N2）', () => {
  it('默认焦点是 keep-both（安全侧，不覆盖、不影响既有引用）', () => {
    expect(DEFAULT_ASSET_CONFLICT_CHOICE).toBe('keep-both');
    expect(ASSET_CONFLICT_ORDER[0]).toBe('keep-both');
  });

  it('三选的顺序与文案是唯一事实源', () => {
    expect(ASSET_CONFLICT_ORDER).toEqual(['keep-both', 'replace', 'cancel']);
    expect(ASSET_CONFLICT_LABEL['keep-both']).toBe('保留两份');
    expect(ASSET_CONFLICT_LABEL.replace).toBe('显式替换');
    expect(ASSET_CONFLICT_LABEL.cancel).toBe('取消');
  });

  it('copyNameFor：diagram.png → diagram 2.png（扩展名保留，序号在扩展名之前）', () => {
    expect(copyNameFor('diagram.png', 1)).toBe('diagram.png');
    expect(copyNameFor('diagram.png', 2)).toBe('diagram 2.png');
    expect(copyNameFor('diagram.png', 10)).toBe('diagram 10.png');
    // 多点文件名：只按**最后**一个点切扩展名
    expect(copyNameFor('a.b.svg', 2)).toBe('a.b 2.svg');
    // 无扩展名
    expect(copyNameFor('noext', 2)).toBe('noext 2');
  });

  it('uniqueAssetName：探测到占用就继续加序号（不假设「只有一个同名」）', async () => {
    const taken = new Set(['diagram.png', 'diagram 2.png']);
    const name = await uniqueAssetName('diagram.png', (c) => taken.has(c));
    expect(name).toBe('diagram 3.png');
  });
});
