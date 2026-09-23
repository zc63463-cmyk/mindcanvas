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

/**
 * P0-B ②⑦：IDB 宿主的三态（A3）。
 *
 * 锚点：A3「IDB 写入失败，但 object URL 可用」——
 *  - ① 卡片带「仅本次会话」徽章（由 `store: null` 驱动）；
 *  - ② 文案含「未写入持久存储」；
 *  - ③ 新实例（模拟刷新）清单里没有该项。
 *
 * 负控锚点（A3 负控①）：沿用「只返回 AssetItem」的现状接口 →「能区分三态」必须失败。
 * 这正是本文件新增用例的判别核心：**失败时能拿到 `session-only`，而不是一个普通 item**。
 */
describe('P0-B：IdbAssetHost 三态（A3）', () => {
  it('写入成功 → written + store=browser-idb + bytes + refId', async () => {
    const host = new IdbAssetHost(STATIC, '/');
    const result = await host.uploadAssetDetailed(new File(['png-data'], 'shot.png', { type: 'image/png' }));
    expect(result.kind).toBe('written');
    if (result.kind !== 'written') throw new Error('unreachable');
    expect(result.store).toBe('browser-idb');
    expect(result.refId).toBe('assets/shot.png');
    expect(result.bytes).toBe(8);
  });

  it('putRecord 失败 → session-only/idb-failed（**不是**静默的成功 item）', async () => {
    const host = new IdbAssetHost([], '/');
    // 注入一次失败：让 indexedDB.open 失败（隐私模式 / 配额）
    const broken = new IDBFactory();
    broken.open = (() => {
      const req = { onsuccess: null, onerror: null, onupgradeneeded: null, error: new Error('blocked') } as unknown as IDBOpenDBRequest;
      queueMicrotask(() => req.onerror?.(new Event('error') as unknown as Event));
      return req;
    }) as IDBFactory['open'];
    (globalThis as { indexedDB: IDBFactory }).indexedDB = broken;

    const result = await host.uploadAssetDetailed(new File(['png-data'], 'lost.png', { type: 'image/png' }));
    expect(result.kind).toBe('session-only');
    if (result.kind !== 'session-only') throw new Error('unreachable');
    expect(result.reason).toBe('idb-failed');
    // 本次会话内仍可用（objectURL 已建）
    expect(host.resolveAsset({ kind: 'img', id: 'assets/lost.png' })).toMatch(/^blob:/);
  });

  it('session-only 的项在**新实例**（模拟刷新）里不存在（A3 ③）', async () => {
    const host = new IdbAssetHost([], '/');
    const broken = new IDBFactory();
    broken.open = (() => {
      const req = { onsuccess: null, onerror: null, onupgradeneeded: null, error: new Error('blocked') } as unknown as IDBOpenDBRequest;
      queueMicrotask(() => req.onerror?.(new Event('error') as unknown as Event));
      return req;
    }) as IDBFactory['open'];
    (globalThis as { indexedDB: IDBFactory }).indexedDB = broken;
    await host.uploadAssetDetailed(new File(['x'], 'gone.png', { type: 'image/png' }));

    // 恢复可用的 IDB：新实例读不到那次失败的写入
    (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    const fresh = new IdbAssetHost([], '/');
    const list = await fresh.listAssets();
    expect(list.some((a) => a.id === 'assets/gone.png')).toBe(false);
  });

  it('uploadAsset 薄包装：三态里非 failed 都返回 item（既有调用方零改动）', async () => {
    const host = new IdbAssetHost([], '/');
    const item = await host.uploadAsset(new File(['v'], 'a.png', { type: 'image/png' }));
    expect(item.id).toBe('assets/a.png');
  });
});

describe('P0-B：IdbAssetHost 作用域键与释放（R-07 / R-16）', () => {
  it('scopeMark 缺省 = browser:local/0；注入源可覆盖 epoch', () => {
    const plain = new IdbAssetHost([], '/');
    expect(plain.scopeMark()).toEqual({ scopeKey: 'browser:local', epoch: 0 });
    const marked = new IdbAssetHost([], '/', () => ({ scopeKey: 'browser:local', epoch: 5 }));
    expect(marked.scopeMark()).toEqual({ scopeKey: 'browser:local', epoch: 5 });
  });

  it('disposeScope / disposeAll 释放 objectURL（不再泄漏到会话结束）', async () => {
    const host = new IdbAssetHost([], '/');
    await host.uploadAssetDetailed(new File(['a'], 'a.png', { type: 'image/png' }));
    await host.uploadAssetDetailed(new File(['b'], 'b.png', { type: 'image/png' }));
    expect(host.cachedUrlCount()).toBe(2);
    expect(host.disposeScope('browser:local')).toBe(2);
    expect(host.cachedUrlCount()).toBe(0);
  });
});

// ================================================================ P0-FIX-R1 R1-1：来源标注与不落库

/**
 * `origin` 是**读侧**概念，且**不得**落进任何持久面。
 *
 * 旧实现在 `putRecord` 处写 `{ ...item, mime, data }` —— 展开表达式不受 TS 多余属性
 * 检查约束，给 `AssetItem` 加字段就会静默写进 IndexedDB。这里把「加了字段但记录里没有」
 * 钉死：既证明来源在**读侧**补上（无需迁移），也证明写入侧没漏出去。
 */
describe('R1-1：IDB 读侧标注 origin，写侧**不得**落库（零迁移）', () => {
  it('uploadAssetDetailed 产出的 item 带 origin=browser-idb', async () => {
    const host = new IdbAssetHost(STATIC, '/');
    const result = await host.uploadAssetDetailed(new File(['x'], 'a.png', { type: 'image/png' }));
    expect(result.kind).toBe('written');
    if (result.kind !== 'written') throw new Error('unreachable');
    expect(result.item.origin).toBe('browser-idb');
  });

  it('新实例 listAssets 重建的 IDB 项**读侧**带 origin=browser-idb（现有记录无该字段也能标）', async () => {
    const first = new IdbAssetHost(STATIC, '/');
    await first.uploadAsset(new File(['x'], 'a.png', { type: 'image/png' }));
    const second = new IdbAssetHost(STATIC, '/');
    const list = await second.listAssets();
    const uploaded = list.find((a) => a.id === 'assets/a.png');
    expect(uploaded).toBeDefined();
    expect(uploaded?.origin).toBe('browser-idb');
  });

  it('IDB 记录里**没有** origin 字段（origin 不入任何持久面）', async () => {
    const host = new IdbAssetHost(STATIC, '/');
    await host.uploadAsset(new File(['x'], 'a.png', { type: 'image/png' }));
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('mindcanvas-assets', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const req = db.transaction('assets', 'readonly').objectStore('assets').getAll();
      req.onsuccess = () => resolve(req.result as unknown[]);
      req.onerror = () => reject(req.error);
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row as object)).not.toContain('origin');
    }
  });

  it('静态清单项不因并集被误标（未标来源的静态项原样保留）', async () => {
    const host = new IdbAssetHost(STATIC, '/');
    const list = await host.listAssets();
    const demo = list.find((a) => a.id === 'demo-assets/demo-diagram.svg');
    expect(demo).toBeDefined();
    expect(demo?.origin).toBeUndefined();
  });
});

describe('R1-1：IdbAssetHost.resolveAssetState 不回落必然 404 的站点根', () => {
  it('已声明 browser-idb 但无缓存 → unresolved(unavailable)，**不是** baseUrl+id', async () => {
    const host = new IdbAssetHost([], '/');
    const state = host.resolveAssetState({ kind: 'img', id: 'assets/gone.png', origin: 'browser-idb' });
    expect(state).toEqual({ kind: 'unresolved', reason: 'unavailable' });
  });

  it('origin=workspace-assets 的项**不在此解析**（委托信号，避免拿到站点根 404）', () => {
    const host = new IdbAssetHost([], '/');
    expect(host.resolveAssetState({ kind: 'img', id: 'assets/a.png', origin: 'workspace-assets' })).toEqual({
      kind: 'unresolved',
      reason: 'unavailable',
    });
  });

  it('未标 origin 且无缓存 → 维持旧行为（静态打包资产回落 baseUrl+id）', () => {
    const host = new IdbAssetHost(STATIC, '/');
    expect(host.resolveAssetState({ kind: 'img', id: 'demo-assets/x.svg' })).toEqual({
      kind: 'resolved',
      url: '/demo-assets/x.svg',
    });
  });
});
