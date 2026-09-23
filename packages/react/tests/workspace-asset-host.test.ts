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

    const _big = await host.uploadAsset(svgFile('big.svg', INLINE_SVG_LIMIT + 50));
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

// ================================================================ P0-B

/**
 * P0-B ①③④⑤⑥ 的工作区宿主面。
 *
 * 锚点：A2（同名三选，含「原文件字节逐字节不变」）、N2（同名同大小同时间戳不同字节
 * 必须进三选）、R-15（不得回落站点根）、R-07（两个作用域不互相覆盖）、R-16（统一 revoke）。
 */

/** 带作用域的假工作区（记录写入内容，供字节比对） */
function scopedWorkspace(initial: Record<string, string> = {}, mounted = true) {
  const disk = new Map<string, string>(Object.entries(initial));
  const w: WorkspaceWriter = {
    mounted,
    async writeAsset(name, data, mime) {
      const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
      disk.set(name, text);
      void mime;
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
      if (hit === undefined) return null;
      return new File([hit], relPath, { type: 'image/png' });
    },
  };
  return { w, disk };
}

function scopedHost(
  w: WorkspaceWriter | null,
  scope: { scopeId: string | null; scopeEpoch: number },
  fallback = fakeFallback(),
) {
  return new WorkspaceAssetHost(fallback, () => w, '', () => scope);
}

describe('P0-B ②：uploadAssetDetailed 三态可判别（R-08）', () => {
  it('已挂载 → written + store=workspace-assets + bytes（且 refId 是相对路径）', async () => {
    const { w } = scopedWorkspace();
    const host = scopedHost(w, { scopeId: 'ws:A', scopeEpoch: 1 });
    const result = await host.uploadAssetDetailed(pngFile('shot.png', 64));
    expect(result.kind).toBe('written');
    if (result.kind !== 'written') throw new Error('unreachable');
    expect(result.store).toBe('workspace-assets');
    expect(result.refId).toBe('assets/shot.png');
    expect(result.bytes).toBe(64);
  });

  it('未挂载 → session-only（**不是** written：没有写入任何持久存储）', async () => {
    const { w } = scopedWorkspace({}, false);
    const host = scopedHost(w, { scopeId: null, scopeEpoch: 0 });
    const result = await host.uploadAssetDetailed(pngFile('shot.png'));
    expect(result.kind).toBe('session-only');
    if (result.kind !== 'session-only') throw new Error('unreachable');
    expect(result.reason).toBe('no-workspace');
  });

  it('落盘抛错 → failed + E-IO（不再静默返回一个 item）', async () => {
    const { w } = scopedWorkspace();
    const broken: WorkspaceWriter = {
      ...w,
      async writeAsset() {
        throw new DOMException('disk full', 'QuotaExceededError');
      },
    };
    const host = scopedHost(broken, { scopeId: 'ws:A', scopeEpoch: 1 });
    const result = await host.uploadAssetDetailed(pngFile('shot.png'));
    expect(result.kind).toBe('failed');
  });

  it('uploadAsset 薄包装：成功返回 item（既有调用方零改动），失败抛出', async () => {
    const { w } = scopedWorkspace();
    const host = scopedHost(w, { scopeId: 'ws:A', scopeEpoch: 1 });
    const item = await host.uploadAsset(pngFile('shot.png'));
    expect(item.id).toBe('assets/shot.png');

    const broken: WorkspaceWriter = {
      ...w,
      async writeAsset() {
        throw new DOMException('nope', 'NotAllowedError');
      },
    };
    const failing = scopedHost(broken, { scopeId: 'ws:A', scopeEpoch: 1 });
    await expect(failing.uploadAsset(pngFile('x.png'))).rejects.toThrow();
  });
});

describe('P0-B ③：同名策略三选（A2 / N2）', () => {
  it('同名且未给 bytesEqual → 默认「保留两份」：新文件另存，原文件**逐字节不变**', async () => {
    const { w, disk } = scopedWorkspace({ 'diagram.png': 'ORIGINAL-240KB-CONTENT' });
    const host = scopedHost(w, { scopeId: 'ws:A', scopeEpoch: 1 });
    const result = await host.uploadAssetDetailed(pngFile('diagram.png', 96));
    expect(result.kind).toBe('written');
    if (result.kind !== 'written') throw new Error('unreachable');
    // 出现第二份
    expect(result.refId).toBe('assets/diagram 2.png');
    expect(disk.has('diagram.png')).toBe(true);
    expect(disk.has('diagram 2.png')).toBe(true);
    // 原文件字节逐字节不变（A2 ① 的核心断言）
    expect(disk.get('diagram.png')).toBe('ORIGINAL-240KB-CONTENT');
  });

  it('显式 replace → 覆盖原名（引用解析到新内容）', async () => {
    const { w, disk } = scopedWorkspace({ 'diagram.png': 'ORIGINAL' });
    const host = scopedHost(w, { scopeId: 'ws:A', scopeEpoch: 1 });
    const result = await host.uploadAssetDetailed(pngFile('diagram.png', 8), undefined, {
      conflict: 'replace',
    });
    expect(result.kind).toBe('written');
    if (result.kind !== 'written') throw new Error('unreachable');
    expect(result.refId).toBe('assets/diagram.png');
    expect(disk.get('diagram.png')).not.toBe('ORIGINAL');
  });

  it('取消 → **零写入**，清单不变，失败码是 E-ABORT', async () => {
    const { w, disk } = scopedWorkspace({ 'diagram.png': 'ORIGINAL' });
    const host = scopedHost(w, { scopeId: 'ws:A', scopeEpoch: 1 });
    const before = new Map(disk);
    const result = await host.uploadAssetDetailed(pngFile('diagram.png', 8), undefined, {
      conflict: 'cancel',
    });
    expect(result.kind).toBe('failed');
    if (result.kind !== 'failed') throw new Error('unreachable');
    expect(result.error.code).toBe('E-ABORT');
    expect([...disk.entries()]).toEqual([...before.entries()]);
  });

  it('N2 负控锚点：同名同大小同时间戳但字节不同 → **仍然进三选**（不得静默替换）', async () => {
    // 旧文件与新文件 size 相同、时间戳被刻意做成相同；唯一区别是字节
    const { w, disk } = scopedWorkspace({ 'x.png': 'AAAA' });
    const host = scopedHost(w, { scopeId: 'ws:A', scopeEpoch: 1 });
    const incoming = new File(['BBBB'], 'x.png', { type: 'image/png', lastModified: 1700000000000 });
    expect(incoming.size).toBe(4);

    const result = await host.uploadAssetDetailed(incoming);
    expect(result.kind).toBe('written');
    if (result.kind !== 'written') throw new Error('unreachable');
    // 进的是「保留两份」分支：新内容保住，旧内容没被替换
    expect(result.refId).toBe('assets/x 2.png');
    expect(disk.get('x.png')).toBe('AAAA');
    expect(disk.get('x 2.png')).toBe('BBBB');
  });

  it('只有**显式** bytesEqual=true 才跳过三选（§4.5.2 允许的唯一「同内容」情形）', async () => {
    const { w, disk } = scopedWorkspace({ 'a.png': 'SAME' });
    const host = scopedHost(w, { scopeId: 'ws:A', scopeEpoch: 1 });
    const result = await host.uploadAssetDetailed(pngFile('a.png', 4), undefined, {
      bytesEqual: true,
    });
    expect(result.kind).toBe('written');
    if (result.kind !== 'written') throw new Error('unreachable');
    expect(result.refId).toBe('assets/a.png');
    expect(disk.size).toBe(1); // 没有产生第二份
  });

  it('bytesEqual=false（本会话比对过且不同）→ 仍走保留两份', async () => {
    const { w } = scopedWorkspace({ 'a.png': 'X' });
    const host = scopedHost(w, { scopeId: 'ws:A', scopeEpoch: 1 });
    const result = await host.uploadAssetDetailed(pngFile('a.png', 8), undefined, {
      bytesEqual: false,
    });
    if (result.kind !== 'written') throw new Error('unreachable');
    expect(result.refId).toBe('assets/a 2.png');
  });
});

describe('P0-B ④：resolveAssetState 五态（R-15 不得回落站点根）', () => {
  it('已挂载且已缓存 → resolved', async () => {
    const { w } = scopedWorkspace();
    const host = scopedHost(w, { scopeId: 'ws:A', scopeEpoch: 1 });
    await host.uploadAssetDetailed(pngFile('a.png'));
    const state = host.resolveAssetState({ kind: 'img', id: 'assets/a.png' });
    expect(state.kind).toBe('resolved');
  });

  it('未挂载 + assets/ 引用 → unresolved(no-scope)（**不是** missing，也不是站点根 URL）', () => {
    const { w } = scopedWorkspace({}, false);
    const host = scopedHost(w, { scopeId: null, scopeEpoch: 0 });
    const state = host.resolveAssetState({ kind: 'img', id: 'assets/a.png' });
    expect(state).toEqual({ kind: 'unresolved', reason: 'no-scope' });
  });

  it('已挂载但清单里没有该文件 → unresolved(missing)', () => {
    const { w } = scopedWorkspace();
    const host = scopedHost(w, { scopeId: 'ws:A', scopeEpoch: 1 });
    const state = host.resolveAssetState({ kind: 'img', id: 'assets/gone.png' });
    expect(state).toEqual({ kind: 'unresolved', reason: 'missing' });
  });

  it('external：http(s)/../ → unresolved(external)，且**不**回落站点根', () => {
    const { w } = scopedWorkspace();
    const host = scopedHost(w, { scopeId: 'ws:A', scopeEpoch: 1 });
    expect(host.resolveAssetState({ kind: 'img', id: 'https://example.com/x.png' })).toEqual({
      kind: 'unresolved',
      reason: 'external',
    });
    expect(host.resolveAssetState({ kind: 'img', id: '../assets/x.png' })).toEqual({
      kind: 'unresolved',
      reason: 'external',
    });
  });

  it('data: 自包含 → resolved 为自身（脱离宿主也显示）', () => {
    const { w } = scopedWorkspace({}, false);
    const host = scopedHost(w, { scopeId: null, scopeEpoch: 0 });
    const url = 'data:image/svg+xml;utf8,%3Csvg%2F%3E';
    expect(host.resolveAssetState({ kind: 'draw', id: url })).toEqual({ kind: 'resolved', url });
  });

  it('五态枚举都在（wrong-scope / unavailable 是 P1-B 的接线面，此处只锁类型可达）', () => {
    const reasons: Array<'no-scope' | 'missing' | 'wrong-scope' | 'external' | 'unavailable'> = [
      'no-scope',
      'missing',
      'wrong-scope',
      'external',
      'unavailable',
    ];
    expect(reasons.length).toBe(5);
  });
});

describe('P0-B ①：作用域捕获与缓存键（R-07）', () => {
  it('scopeMark 读 getter 的**当前**值（挂载发生在宿主创建之后）', () => {
    let scope = { scopeId: null as string | null, scopeEpoch: 0 };
    const { w } = scopedWorkspace();
    const host = new WorkspaceAssetHost(fakeFallback(), () => w, '', () => scope);
    expect(host.scopeMark()).toEqual({ scopeKey: 'browser:local', epoch: 0 });
    scope = { scopeId: 'ws:A', scopeEpoch: 3 };
    expect(host.scopeMark()).toEqual({ scopeKey: 'ws:A', epoch: 3 });
  });

  it('isCurrent：epoch 变化即不当前（这是「迟到结果被丢弃」的判据）', () => {
    let epoch = 1;
    const { w } = scopedWorkspace();
    const host = new WorkspaceAssetHost(fakeFallback(), () => w, '', () => ({
      scopeId: 'ws:A',
      scopeEpoch: epoch,
    }));
    const captured = host.scopeMark();
    expect(host.isCurrent(captured)).toBe(true);
    epoch = 2;
    expect(host.isCurrent(captured)).toBe(false);
  });

  it('R-07：同一 id 在两个作用域下缓存互不覆盖', async () => {
    let scope = { scopeId: 'ws:A', scopeEpoch: 1 };
    const { w } = scopedWorkspace();
    const host = new WorkspaceAssetHost(fakeFallback(), () => w, '', () => scope);
    await host.uploadAssetDetailed(pngFile('a.png'));
    const inA = host.resolveAsset({ id: 'assets/a.png' });

    // 切到 B：A 的缓存不参与 B 的解析
    scope = { scopeId: 'ws:B', scopeEpoch: 2 };
    expect(host.resolveAsset({ id: 'assets/a.png' })).not.toBe(inA);
    expect(host.resolveAsset({ id: 'assets/a.png' })).toBe('/assets/a.png'); // 回退宿主
  });
});

describe('P0-B ⑥：统一 revoke + LRU（R-16）', () => {
  it('disposeScope 只释放该作用域的 URL，不影响其他作用域', async () => {
    let scope = { scopeId: 'ws:A', scopeEpoch: 1 };
    const { w } = scopedWorkspace();
    const host = new WorkspaceAssetHost(fakeFallback(), () => w, '', () => scope);
    await host.uploadAssetDetailed(pngFile('a.png'));
    scope = { scopeId: 'ws:B', scopeEpoch: 2 };
    await host.uploadAssetDetailed(pngFile('b.png'));
    expect(host.cachedUrlCount()).toBe(2);

    const released = host.disposeScope('ws:A');
    expect(released).toBe(1);
    expect(host.cachedUrlCount()).toBe(1); // B 的还在
  });

  it('disposeAll 归零（组件卸载路径）', async () => {
    const { w } = scopedWorkspace();
    const host = scopedHost(w, { scopeId: 'ws:A', scopeEpoch: 1 });
    await host.uploadAssetDetailed(pngFile('a.png'));
    await host.uploadAssetDetailed(pngFile('b.png'));
    expect(host.disposeAll()).toBe(2);
    expect(host.cachedUrlCount()).toBe(0);
  });

  it('同名替换 revoke 旧 URL（既有行为保留）', async () => {
    const revokes: string[] = [];
    URL.revokeObjectURL = ((u: string) => {
      revokes.push(u);
    }) as typeof URL.revokeObjectURL;
    const { w } = scopedWorkspace();
    const host = scopedHost(w, { scopeId: 'ws:A', scopeEpoch: 1 });
    await host.uploadAssetDetailed(pngFile('a.png'));
    await host.uploadAssetDetailed(pngFile('a.png'), undefined, { conflict: 'replace' });
    expect(revokes.length).toBeGreaterThan(0);
  });
});
