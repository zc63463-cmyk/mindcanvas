// @vitest-environment jsdom
/**
 * FA2-T4：工作区资产真落盘。
 *
 * 锁死「导出的 Markdown 脱机后图片不断链」这件事：
 *  - 位图 / 大 SVG → 写进工作区 `./assets/`，id 是**相对路径**（不是 blob:、不是绝对路径）；
 *  - 小 SVG（≤15KB）→ 仍保留内联源码，可自包含写进 .mm.md（FA1-T5 能力不回退）；
 *  - 未挂载工作区 → 完全退回 IndexedDB 宿主，行为与之前一致。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceAssetHost, type WorkspaceWriter } from '../src/chrome/workspaceAssetHost.js';
import type { AssetHost } from '../src/chrome/assetHost.js';
import type { AssetItem } from '../src/chrome/AssetPanel.js';
import { INLINE_SVG_LIMIT } from '../src/chrome/assetIcons.js';

/** 内存工作区写入器：记录落盘内容 */
function fakeWorkspace(mounted = true) {
  const disk = new Map<string, { data: ArrayBuffer | string; mime: string }>();
  const w: WorkspaceWriter = {
    mounted,
    async writeAsset(name, data, mime) {
      disk.set(name, { data, mime });
      return `assets/${name}`;
    },
    async hasAsset(relPath) {
      return disk.has(relPath.replace(/^assets\//, ''));
    },
    async listAssetFiles() {
      return [...disk.keys()].map((name) => ({ path: `assets/${name}`, name }));
    },
    async readAssetFile(relPath) {
      const hit = disk.get(relPath.replace(/^assets\//, ''));
      if (!hit) return null;
      return new File([hit.data as BlobPart], relPath, { type: hit.mime });
    },
  };
  return { w, disk };
}

/** 最小 IndexedDB 宿主替身（记录上传，不做真实持久化） */
function fakeFallback(): AssetHost & { items: AssetItem[]; uploaded: File[] } {
  const uploaded: File[] = [];
  const items: AssetItem[] = [];
  return {
    baseUrl: '/',
    uploaded,
    items,
    async listAssets() {
      return [...items];
    },
    resolveAsset(item) {
      return `/${item.id}`;
    },
    async uploadAsset(file, kind) {
      uploaded.push(file);
      const item: AssetItem = {
        kind: kind ?? (file.name.endsWith('.svg') ? 'draw' : 'img'),
        id: `assets/${file.name}`,
        name: file.name,
        type: (file.name.toLowerCase().split('.').pop() ?? 'bin').slice(0, 8),
      };
      items.push(item);
      return item;
    },
    hasAsset(item) {
      return items.some((a) => a.id === item.id);
    },
  };
}

function pngFile(name = 'diagram.png', bytes = 64): File {
  return new File([new Uint8Array(bytes)], name, { type: 'image/png' });
}
function svgFile(name = 'icon.svg', size = 200): File {
  const body = `<svg xmlns="http://www.w3.org/2000/svg">${'<path d="M0 0"/>'.repeat(Math.max(1, Math.ceil(size / 16)))}</svg>`;
  return new File([body], name, { type: 'image/svg+xml' });
}

let created: string[] = [];
beforeEach(() => {
  created = [];
  // 记录 objectURL 创建，避免 jsdom 下真实分配
  URL.createObjectURL = ((blob: Blob) => {
    created.push('blob');
    return `blob:fake-${created.length}-${blob.size}`;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
});

describe('落盘分诊（谁该进磁盘）', () => {
  it('位图 → 落盘', () => {
    expect(WorkspaceAssetHost.shouldPersistToDisk(pngFile())).toBe(true);
  });

  it('超过 15KB 的 SVG → 落盘', () => {
    const big = svgFile('big.svg', INLINE_SVG_LIMIT + 100);
    expect(big.size).toBeGreaterThan(INLINE_SVG_LIMIT);
    expect(WorkspaceAssetHost.shouldPersistToDisk(big)).toBe(true);
  });

  it('小 SVG → 不落盘（保留内联，可自包含写进 .mm.md）', () => {
    const small = svgFile('small.svg', 200);
    expect(small.size).toBeLessThanOrEqual(INLINE_SVG_LIMIT);
    expect(WorkspaceAssetHost.shouldPersistToDisk(small)).toBe(false);
  });
});

describe('已挂载工作区：写入 ./assets/', () => {
  it('位图上传 → 写进磁盘，id 是相对路径（不是 blob:/绝对地址）', async () => {
    const { w, disk } = fakeWorkspace();
    const host = new WorkspaceAssetHost(fakeFallback(), () => w);
    const item = await host.uploadAsset(pngFile('shot.png'));

    expect(disk.has('shot.png')).toBe(true);
    expect(item.id).toBe('assets/shot.png');
    expect(item.id.startsWith('blob:')).toBe(false);
    expect(item.id.startsWith('/')).toBe(false);
  });

  it('落盘后 resolveAsset 返回可加载 URL（会话内 objectURL）', async () => {
    const { w } = fakeWorkspace();
    const host = new WorkspaceAssetHost(fakeFallback(), () => w);
    const item = await host.uploadAsset(pngFile('shot.png'));
    expect(host.resolveAsset(item)).toMatch(/^blob:/);
  });

  it('大 SVG → 落盘；小 SVG → 走回 IndexedDB 并带内联源码', async () => {
    const { w, disk } = fakeWorkspace();
    const fallback = fakeFallback();
    const host = new WorkspaceAssetHost(fallback, () => w);

    const big = await host.uploadAsset(svgFile('big.svg', INLINE_SVG_LIMIT + 50));
    expect(disk.has('big.svg')).toBe(true);

    const small = await host.uploadAsset(svgFile('small.svg', 200));
    expect(disk.has('small.svg')).toBe(false);
    expect(fallback.uploaded.length).toBe(1); // 只有小 SVG 进了回退宿主
    expect(small.svg).toContain('<svg');
  });

  it('listAssets 把磁盘资产并进清单（刷新后图库不空）', async () => {
    const { w } = fakeWorkspace();
    const host = new WorkspaceAssetHost(fakeFallback(), () => w);
    await host.uploadAsset(pngFile('a.png'));
    const list = await host.listAssets();
    expect(list.some((a) => a.id === 'assets/a.png')).toBe(true);
  });

  it('同一资产刷新后重建 objectURL（缩略图不裂）', async () => {
    const { w } = fakeWorkspace();
    const host = new WorkspaceAssetHost(fakeFallback(), () => w);
    await host.uploadAsset(pngFile('a.png'));
    // 模拟刷新：新宿主（objectURL 缓存空），从磁盘重建
    const fresh = new WorkspaceAssetHost(fakeFallback(), () => w);
    await fresh.listAssets();
    expect(fresh.resolveAsset({ id: 'assets/a.png' })).toMatch(/^blob:/);
  });

  it('hasAsset：磁盘命中 → true', async () => {
    const { w } = fakeWorkspace();
    const host = new WorkspaceAssetHost(fakeFallback(), () => w);
    await host.uploadAsset(pngFile('a.png'));
    expect(host.hasAsset({ kind: 'img', id: 'assets/a.png' })).toBe(true);
    expect(host.hasAsset({ kind: 'img', id: 'assets/none.png' })).toBe(false);
  });
});

describe('未挂载工作区：平滑降级', () => {
  it('mounted=false → 一切走回退宿主，磁盘无写入', async () => {
    const { w, disk } = fakeWorkspace(false);
    const fallback = fakeFallback();
    const host = new WorkspaceAssetHost(fallback, () => w);
    const item = await host.uploadAsset(pngFile('shot.png'));
    expect(disk.size).toBe(0);
    expect(fallback.uploaded.length).toBe(1);
    // 相对路径形态保持一致（便于日后挂载工作区后无缝切换）
    expect(item.id).toBe('assets/shot.png');
  });

  it('workspaceOf 返回 null → 同样降级（不抛）', async () => {
    const host = new WorkspaceAssetHost(fakeFallback(), () => null);
    await expect(host.uploadAsset(pngFile())).resolves.toBeDefined();
    expect(host.resolveAsset({ id: 'assets/shot.png' })).toBe('/assets/shot.png');
  });
});
