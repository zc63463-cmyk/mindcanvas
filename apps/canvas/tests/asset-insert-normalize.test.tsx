// @vitest-environment jsdom
/**
 * P0-B ⑤：插入归一化（acceptance §3.1 N1 / N4，不变量 I-10）。
 *
 * **N1**：工作区已挂载且 `assets/a.png` 存在（红）；浏览器素材库另有一张 `a.png`（蓝）。
 * 从浏览器素材库插入蓝图 → 保存 → 关闭 → 重开：
 *  ① 插入时提示已复制到工作区；
 *  ② 磁盘出现 `assets/a 2.png`（默认保留两份），原文件未变；
 *  ③ 文档引用为 `assets/a 2.png`；
 *  ④ 重开显示蓝图；
 *  ⑤ 未挂载工作区时该插入被**拒绝**并说明。
 *
 * **N4**：内置图标以「子分支」语义插入 → 子节点图标正常显示；
 *  文档里**不是** `@draw:builtin:<id>`（应为内联 data URL 或归一化后的工作区引用）。
 *
 * 负控锚点（§3.1 N1/N4「负控」）：
 *  - 只给卡片加 scope 徽章、插入仍写 `assets/a.png` →「重开显示蓝图」必须失败（初版被打回的根因）；
 *  - child 直接写 `builtin:` 引用 →「重开后无断图」必须失败（CE-05）。
 *
 * 层：U（归一化纯函数）+ C（调用点）。**真实重开（M）未由本机验证**（无真实浏览器），
 * 这里用「归一化产物的引用在重新解析时确实指向蓝图字节」替代 —— 覆盖到 ③④ 的逻辑层。
 */

import type { AssetHost, AssetItem, WorkspaceWriter } from '@mindcanvas/react';
import {
  WorkspaceAssetHost,
  builtinInlineRef,
  fileNameOfAsset,
  inlineRefOf,
  normalizeForInsert,
} from '@mindcanvas/react';
import { beforeEach, describe, expect, it } from 'vitest';

/** 内存工作区：记录磁盘内容，供「原文件字节不变」与「重开读到蓝图」断言 */
function disk(initial: Record<string, string> = {}): {
  w: WorkspaceWriter;
  files: Map<string, string>;
} {
  const files = new Map<string, string>(Object.entries(initial));
  const w: WorkspaceWriter = {
    mounted: true,
    async writeAsset(name, data) {
      files.set(name, typeof data === 'string' ? data : new TextDecoder().decode(data));
      return `assets/${name}`;
    },
    async hasAsset(relPath) {
      return files.has(relPath.replace(/^assets\//, ''));
    },
    async listAssetFiles() {
      return [...files.keys()].map((name) => ({ path: `assets/${name}`, name }));
    },
    async readAssetFile(relPath) {
      const hit = files.get(relPath.replace(/^assets\//, ''));
      return hit === undefined ? null : new File([hit], relPath, { type: 'image/png' });
    },
  };
  return { w, files };
}

const SMALL_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>';

/** 归一化器的字节来源宿主（模块级：所有用例共用同一份替身） */
const blueHost = blueprintHost() as unknown as AssetHost;

/** 蓝图的字节只能来自 fetch（jsdom 无 blob: 实现）——每个用例前装上替身 */
beforeEach(stubFetchBlue);

/**
 * 浏览器素材库里的蓝图。**必须带字节来源**：归一化要「先把字节复制到工作区」，
 * 而字节只能来自内联源码（`svg`）或宿主解析出的 URL（`fetch`）。
 *
 * 用一个注入宿主 + `fetch` 替身给出蓝图字节（`BLUE-BYTES`），模拟「浏览器素材库里的蓝图」。
 */
const BLUE_BYTES = 'BLUE-BYTES';
function browserBlueprint(name = 'a.png'): AssetItem {
  return { kind: 'img', id: `assets/${name}`, name, type: 'png' };
}
function blueprintHost(name = 'a.png') {
  return {
    baseUrl: '/',
    async listAssets() {
      return [browserBlueprint(name)];
    },
    resolveAsset: (item: { id: string }) => `blob:blueprint-${item.id}`,
    async uploadAsset() {
      return browserBlueprint(name);
    },
    hasAsset: () => true,
    resolveAssetState: (item: { kind: 'img' | 'draw'; id: string }) => ({
      kind: 'resolved' as const,
      url: `blob:blueprint-${item.id}`,
    }),
  };
}
/** 让 `fetch(blob:...)` 返回蓝图字节（jsdom 没有 blob: 的 fetch 实现） */
function stubFetchBlue(): void {
  (globalThis as { fetch: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
    void input;
    return new Response(BLUE_BYTES, { status: 200, headers: { 'content-type': 'image/png' } });
  }) as typeof fetch;
}

describe('N1：已挂载工作区 → 字节落 assets/，同名走「保留两份」', () => {
  it('磁盘已有 a.png（红）→ 归一化产出 assets/a 2.png，原文件**逐字节不变**', async () => {
    const { w, files } = disk({ 'a.png': 'RED' });
    const result = await normalizeForInsert(browserBlueprint('a.png'), { workspace: w }, blueHost);
    expect(result.kind).toBe('normalized');
    if (result.kind !== 'normalized') throw new Error('unreachable');
    // ② 出现第二份
    expect(result.refId).toBe('assets/a 2.png');
    expect(result.store).toBe('workspace-assets');
    expect(result.relPath).toBe('assets/a 2.png');
    expect(result.renamed).toBe(true);
    // ① 原文件未变（红线）
    expect(files.get('a.png')).toBe('RED');
    expect(files.has('a 2.png')).toBe(true);
  });

  it('同名冲突选「取消」→ refused，**磁盘零写入**', async () => {
    const { w, files } = disk({ 'a.png': 'RED' });
    const before = new Map(files);
    const result = await normalizeForInsert(
      browserBlueprint('a.png'),
      { workspace: w, conflict: 'cancel' },
      blueHost,
    );
    expect(result.kind).toBe('refused');
    expect([...files.entries()]).toEqual([...before.entries()]);
  });

  it('同名冲突显式「替换」→ 写原名（引用解析到新内容）', async () => {
    const { w, files } = disk({ 'a.png': 'RED' });
    const result = await normalizeForInsert(
      browserBlueprint('a.png'),
      { workspace: w, conflict: 'replace' },
      blueHost,
    );
    if (result.kind !== 'normalized') throw new Error('unreachable');
    expect(result.refId).toBe('assets/a.png');
    expect(files.get('a.png')).not.toBe('RED');
  });

  it('③④ 重开解析：归一化后的引用在**新一次解析**里指向写入的字节', async () => {
    const { w, files } = disk({ 'a.png': 'RED' });
    const result = await normalizeForInsert(browserBlueprint('a.png'), { workspace: w }, blueHost);
    if (result.kind !== 'normalized') throw new Error('unreachable');
    // 模拟「关闭 → 重开」：用磁盘重建（不依赖任何内存态）
    const reopened = await w.readAssetFile(result.refId);
    expect(reopened).not.toBeNull();
    // 原文件仍是红的，新引用是写入的那份（蓝图 = 与红色不同）
    expect(files.get('a.png')).toBe('RED');
    expect(files.get('a 2.png')).not.toBe('RED');
  });

  it('未占用同名 → 直接用原名，不产生多余副本', async () => {
    const { w, files } = disk({});
    const result = await normalizeForInsert(
      browserBlueprint('fresh.png'),
      { workspace: w },
      blueHost,
    );
    if (result.kind !== 'normalized') throw new Error('unreachable');
    expect(result.refId).toBe('assets/fresh.png');
    expect(result.renamed).toBe(false);
    expect(files.size).toBe(1);
  });

  it('**磁盘项**（id 即目标路径）→ 复用，不重复写（幂等）', async () => {
    const { w, files } = disk({ 'a.png': 'SAME' });
    const before = new Map(files);
    const result = await normalizeForInsert(
      { kind: 'img', id: 'assets/a.png', name: 'a.png', type: 'png' },
      { workspace: w, alreadyInWorkspace: true },
      blueHost,
    );
    if (result.kind !== 'normalized') throw new Error('unreachable');
    expect(result.refId).toBe('assets/a.png');
    expect(result.renamed).toBe(false);
    expect([...files.entries()]).toEqual([...before.entries()]);
  });

  it('**浏览器项**同名（id 也是 assets/a.png 但来自素材库）→ 必须走三选，不静默复用', async () => {
    // 判别点：同样的字符串 id，但资产来自浏览器素材库 → 它是冲突，不是「已在磁盘」
    const { w, files } = disk({ 'a.png': 'RED' });
    const result = await normalizeForInsert(browserBlueprint('a.png'), { workspace: w }, blueHost);
    if (result.kind !== 'normalized') throw new Error('unreachable');
    expect(result.refId).toBe('assets/a 2.png');
    expect(files.get('a.png')).toBe('RED');
  });

  it('落盘抛错 → refused(write-failed)（零副作用）', async () => {
    const w: WorkspaceWriter = {
      mounted: true,
      async writeAsset() {
        throw new DOMException('disk', 'QuotaExceededError');
      },
      async hasAsset() {
        return false;
      },
      async listAssetFiles() {
        return [];
      },
      async readAssetFile() {
        return null;
      },
    };
    const result = await normalizeForInsert(browserBlueprint('a.png'), { workspace: w }, blueHost);
    expect(result.kind).toBe('refused');
    if (result.kind !== 'refused') throw new Error('unreachable');
    expect(result.reason).toBe('write-failed');
  });
});

describe('N1 ⑤：未挂载工作区 → 只有小 SVG 能内联，其余拒绝', () => {
  it('位图（无源码）+ 无工作区 → refused(no-workspace)，**不写任何新形态引用**', async () => {
    const result = await normalizeForInsert(
      browserBlueprint('big.png'),
      { workspace: null },
      blueHost,
    );
    expect(result).toEqual({ kind: 'refused', reason: 'no-workspace' });
  });

  it('小 SVG 源码 + 无工作区 → 内联 data URL（自包含，脱离工作区仍显示）', async () => {
    const item: AssetItem = {
      kind: 'draw',
      id: 'assets/icon.svg',
      name: 'icon.svg',
      type: 'svg',
      svg: SMALL_SVG,
    };
    const result = await normalizeForInsert(item, { workspace: null }, blueHost);
    expect(result.kind).toBe('normalized');
    if (result.kind !== 'normalized') throw new Error('unreachable');
    expect(result.inline).toBe(true);
    expect(result.refId.startsWith('data:image/svg+xml')).toBe(true);
    expect(result.relPath).toBeNull();
    // 不得写入 `browser:<id>` 之类的新形态（I-10 规则 3 明文）
    expect(result.refId.startsWith('browser:')).toBe(false);
  });
});

describe('N4：内置图标以 child 语义插入 → 内联，而不是 builtin: 引用（CE-05）', () => {
  it('builtin 项 → 归一化产出内联 data URL，**不是** builtin:<id>', async () => {
    const item: AssetItem = {
      kind: 'draw',
      id: 'builtin:star',
      name: '星标',
      type: 'svg',
      source: 'builtin',
      svg: SMALL_SVG,
    };
    const result = await normalizeForInsert(item, { workspace: null }, blueHost);
    expect(result.kind).toBe('normalized');
    if (result.kind !== 'normalized') throw new Error('unreachable');
    expect(result.store).toBe('builtin');
    expect(result.inline).toBe(true);
    // CE-05：文档里不得出现 builtin: 引用
    expect(result.refId.startsWith('builtin:')).toBe(false);
    expect(result.refId.startsWith('data:')).toBe(true);
  });

  it('builtin 项即使已挂载工作区也内联（三种语义同口径，不自相矛盾）', async () => {
    const { w } = disk({});
    const item: AssetItem = {
      kind: 'draw',
      id: 'builtin:star',
      name: '星标',
      type: 'svg',
      source: 'builtin',
      svg: SMALL_SVG,
    };
    const result = await normalizeForInsert(item, { workspace: w }, blueHost);
    if (result.kind !== 'normalized') throw new Error('unreachable');
    expect(result.inline).toBe(true);
    expect(result.refId.startsWith('data:')).toBe(true);
  });

  it('builtinInlineRef 只对 source=builtin 且有源码的项生效（不误捕普通资产）', () => {
    expect(
      builtinInlineRef({
        kind: 'draw',
        id: 'builtin:star',
        name: '星标',
        type: 'svg',
        source: 'builtin',
        svg: SMALL_SVG,
      }),
    ).toContain('data:image/svg+xml');
    expect(
      builtinInlineRef({ kind: 'img', id: 'assets/a.png', name: 'a.png', type: 'png' }),
    ).toBeNull();
  });

  it('净化失败的 SVG → 拒绝（不开绕过净化的旁路）', async () => {
    const item: AssetItem = {
      kind: 'draw',
      id: 'assets/bad.svg',
      name: 'bad.svg',
      type: 'svg',
      svg: 'not-an-svg-at-all',
    };
    const result = await normalizeForInsert(item, { workspace: null }, blueHost);
    expect(result.kind).toBe('refused');
  });
});

describe('归一化纯函数面（I-10 的输入输出契约）', () => {
  it('fileNameOfAsset：assets/<rel> 取末段，其余取 name', () => {
    expect(
      fileNameOfAsset({ kind: 'img', id: 'assets/sub/a.png', name: 'whatever', type: 'png' }),
    ).toBe('a.png');
    expect(fileNameOfAsset({ kind: 'img', id: 'builtin:star', name: '星标', type: 'svg' })).toBe(
      '星标',
    );
  });

  it('inlineRefOf：非 SVG 源码 → null（调用方按不支持处置）', () => {
    expect(inlineRefOf('x')).toBeNull();
  });

  it('writer.hasAsset 抛错 → 视为未占用（保守：宁可多写一份也不覆盖）', async () => {
    const w: WorkspaceWriter = {
      mounted: true,
      async writeAsset(name) {
        return `assets/${name}`;
      },
      async hasAsset() {
        throw new Error('unreadable');
      },
      async listAssetFiles() {
        return [];
      },
      async readAssetFile() {
        return null;
      },
    };
    const result = await normalizeForInsert(browserBlueprint('a.png'), { workspace: w }, blueHost);
    expect(result.kind).toBe('normalized');
  });

  it('写盘抛错 → refused(write-failed)（零副作用，调用方不得改文档）', async () => {
    const w: WorkspaceWriter = {
      mounted: true,
      async writeAsset() {
        throw new DOMException('disk', 'QuotaExceededError');
      },
      async hasAsset() {
        return false;
      },
      async listAssetFiles() {
        return [];
      },
      async readAssetFile() {
        return null;
      },
    };
    const result = await normalizeForInsert(browserBlueprint('a.png'), { workspace: w }, blueHost);
    expect(result.kind).toBe('refused');
    if (result.kind !== 'refused') throw new Error('unreachable');
    expect(result.reason).toBe('write-failed');
  });
});

/**
 * ── P0-FIX-R1 R1-1：**来源路由**的集成面 ──────────────────────────────────
 *
 * 上面的 N1 组用「注入宿主 + fetch 替身」证明归一化会复制字节；但那组里浏览器项**没有**
 * 来源标注，走的仍是「按 id 前缀」的旧路由 —— 真实缺陷正是发生在有来源的时候：
 * 浏览器素材库的项 id 也是 `assets/<name>`，挂载工作区后它与磁盘项**同 id**，
 * 于是「取字节」这一步命中了磁盘同名文件的缓存，蓝图被红图静默顶替（N1.5 实测）。
 *
 * 本组把来源显式标上，并用**返回真实字节**的宿主替身（而不是一个常数）证明：
 * 选浏览器库项 → 落盘字节 = 蓝图；选磁盘项 → 复用、不重写。
 */

/** 蓝图 fixture（浏览器素材库里的那张；与磁盘红图同名不同字节） */
const BLUE_PNG = 'BLUE-PNG-BYTES';
const RED_PNG = 'RED-PNG-BYTES';

/**
 * 带来源标注的浏览器素材库替身（模拟挂载工作区后的 `WorkspaceAssetHost` 合成宿主）。
 *
 * 关键行为：`resolveAsset({id:'assets/a.png', origin:'browser-idb'})` /
 * `resolveAssetState` 返回**蓝图** URL；而对 `origin:'workspace-assets'` 的同 id 项
 * 返回**红图** URL。旧实现按 id 前缀路由，两问必得同一答 → 蓝图丢失。
 */
function originAwareHost(diskBytes = RED_PNG, browserBytes = BLUE_PNG) {
  const url = (item: { id: string; origin?: string }) =>
    item.origin === 'workspace-assets' ? `blob:disk-${item.id}` : `blob:browser-${item.id}`;
  const bytesOfUrl = (u: string) => (u.startsWith('blob:disk-') ? diskBytes : browserBytes);
  return {
    baseUrl: '/',
    async listAssets() {
      return [browserBlueprint('a.png')];
    },
    resolveAsset: url,
    async uploadAsset() {
      return browserBlueprint('a.png');
    },
    hasAsset: () => true,
    resolveAssetState: (item: { kind: 'img' | 'draw'; id: string; origin?: string }) => ({
      kind: 'resolved' as const,
      url: url(item),
    }),
    /** 测试专用：把 URL 换成真实字节（经 fetch 替身走同一条读取链） */
    __bytesOfUrl: bytesOfUrl,
  };
}

/** 让 `fetch(blob:...)` 返回对应字节（jsdom 没有 blob: 的 fetch 实现） */
function stubFetchByUrl(mapper: (u: string) => string): void {
  (globalThis as { fetch: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
    const u = String(input);
    return new Response(mapper(u), { status: 200, headers: { 'content-type': 'image/png' } });
  }) as typeof fetch;
}

describe('R1-1：字节按**来源**路由（浏览器库项 vs 磁盘项同名）', () => {
  it('(b) 选**浏览器库项**插入 → 落盘 assets/a 2.png 字节 = 蓝图 fixture（逐字节）', async () => {
    const { w, files } = disk({ 'a.png': RED_PNG });
    const host = originAwareHost();
    stubFetchByUrl(host.__bytesOfUrl);

    // 清单里两项：同 id、不同来源（这是复合键的实际形态）
    const browserItem: AssetItem = { ...browserBlueprint('a.png'), origin: 'browser-idb' };
    const diskItem: AssetItem = { ...browserBlueprint('a.png'), origin: 'workspace-assets' };

    const result = await normalizeForInsert(browserItem, { workspace: w }, host as never);

    if (result.kind !== 'normalized') throw new Error('unreachable');
    // 落盘字节必须是**蓝**图（旧实现按 id 前缀取到磁盘缓存 → 红图）
    expect(files.get('a 2.png')).toBe(BLUE_PNG);
    // (c) 原文件字节不变 + 文档引用是新名
    expect(files.get('a.png')).toBe(RED_PNG);
    expect(result.refId).toBe('assets/a 2.png');

    // 对照：磁盘项走复用路径（(d) 既有行为不回归）
    const before = new Map(files);
    const reuse = await normalizeForInsert(
      diskItem,
      { workspace: w, alreadyInWorkspace: true },
      host as never,
    );
    if (reuse.kind !== 'normalized') throw new Error('unreachable');
    expect(reuse.refId).toBe('assets/a.png');
    expect([...files.entries()]).toEqual([...before.entries()]);
  });

  /**
   * **(b) 的接线级版本** —— 用**真实 `WorkspaceAssetHost`**，不替换解析方法。
   *
   * 为什么单开一条：上面那条用宿主替身，「来源路由」发生在替身里而不是产品代码里，
   * 因此把 `WorkspaceAssetHost.resolveAssetState` 的来源分支中性化后它**依然绿**
   * （实测）。这一条把 fallback 换成返回**蓝图字节**的 IDB 替身、把磁盘放成**红图**，
   * 并且让磁盘红图先被 `listAssets` 预热进 scope 缓存（正是踩坑现场）——
   * 于是「取字节」到底命中谁，完全由产品代码的来源路由决定。
   */
  it('(b) 接线级：真实 WorkspaceAssetHost 下，选浏览器库项 → 落盘字节 = 蓝图（不是磁盘红图）', async () => {
    const { w, files } = disk({ 'a.png': RED_PNG });
    // 浏览器素材库（fallback）：同 id、来源 browser-idb、字节 = 蓝图
    const browserItems: AssetItem[] = [
      { kind: 'img', id: 'assets/a.png', name: 'a.png', type: 'png', origin: 'browser-idb' },
    ];
    const fallback = {
      baseUrl: '/',
      async listAssets() {
        return [...browserItems];
      },
      resolveAsset: () => 'blob:browser-a.png',
      async uploadAsset() {
        return browserItems[0] as AssetItem;
      },
      hasAsset: () => true,
      resolveAssetState: () => ({ kind: 'resolved' as const, url: 'blob:browser-a.png' }),
    };
    const host = new WorkspaceAssetHost(fallback, () => w, '');
    // fetch 替身按**主机名**分派（`URL.createObjectURL` 在本仓其它测试里被全局替身过，
    // 返回的 blob URL 不含文件名字节，故不能按路径子串判别）。
    stubFetchByUrl((u) => (u.includes('browser-a.png') ? BLUE_PNG : RED_PNG));

    // 挂载后加载清单 → 磁盘红图被预热进 scope 缓存（缺陷的触发条件）
    const list = await host.listAssets();
    const browserItem = list.find((a) => a.origin === 'browser-idb');
    const diskItem = list.find((a) => a.origin === 'workspace-assets');
    expect(browserItem).toBeDefined();
    expect(diskItem).toBeDefined();

    const result = await normalizeForInsert(
      browserItem as AssetItem,
      { workspace: w },
      host as never,
    );
    if (result.kind !== 'normalized') throw new Error('unreachable');

    expect(result.refId).toBe('assets/a 2.png');
    // 红线：落盘的是**蓝图**字节；按 id 前缀路由会拿到磁盘红图（NC-R1-1 的转红点）
    expect(files.get('a 2.png')).toBe(BLUE_PNG);
    expect(files.get('a.png')).toBe(RED_PNG);
  });

  it('同一字符串 id 的两个来源 → 归一化结果不同（判别性：来源真的参与路由）', async () => {
    const host = originAwareHost();
    stubFetchByUrl(host.__bytesOfUrl);
    const { w: w1, files: f1 } = disk({ 'a.png': RED_PNG });
    const { w: w2, files: f2 } = disk({ 'a.png': RED_PNG });

    const asBrowser = await normalizeForInsert(
      { ...browserBlueprint('a.png'), origin: 'browser-idb' },
      { workspace: w1 },
      host as never,
    );
    const asDisk = await normalizeForInsert(
      { ...browserBlueprint('a.png'), origin: 'workspace-assets' },
      { workspace: w2, alreadyInWorkspace: true },
      host as never,
    );

    if (asBrowser.kind !== 'normalized' || asDisk.kind !== 'normalized') {
      throw new Error('unreachable');
    }
    expect(asBrowser.refId).toBe('assets/a 2.png');
    expect(asDisk.refId).toBe('assets/a.png');
    expect(f1.get('a 2.png')).toBe(BLUE_PNG);
    expect(f2.has('a 2.png')).toBe(false);
  });

  it('(e) 未挂载 → 浏览器库位图仍被拒绝；小 SVG 仍可内联（不回归）', async () => {
    const host = originAwareHost();
    stubFetchByUrl(host.__bytesOfUrl);
    const bitmap = await normalizeForInsert(
      { ...browserBlueprint('big.png'), origin: 'browser-idb' },
      { workspace: null },
      host as never,
    );
    expect(bitmap).toEqual({ kind: 'refused', reason: 'no-workspace' });

    const svg: AssetItem = {
      kind: 'draw',
      id: 'assets/icon.svg',
      name: 'icon.svg',
      type: 'svg',
      svg: SMALL_SVG,
      origin: 'browser-idb',
    };
    const inlined = await normalizeForInsert(svg, { workspace: null }, host as never);
    expect(inlined.kind).toBe('normalized');
    if (inlined.kind !== 'normalized') throw new Error('unreachable');
    expect(inlined.refId.startsWith('data:image/svg+xml')).toBe(true);
  });

  it('(f) origin 不进文档引用：refId 只有 assets/<rel> / data: / builtin 三形态', async () => {
    const host = originAwareHost();
    stubFetchByUrl(host.__bytesOfUrl);
    const { w } = disk({});
    const result = await normalizeForInsert(
      { ...browserBlueprint('fresh.png'), origin: 'browser-idb' },
      { workspace: w },
      host as never,
    );
    if (result.kind !== 'normalized') throw new Error('unreachable');
    // 引用字节里**没有**来源字样（origin 是运行时概念）
    expect(result.refId).toBe('assets/fresh.png');
    expect(result.refId).not.toContain('browser-idb');
    expect(result.refId).not.toContain('workspace-assets');
  });
});

/**
 * ── P0-FIX-R1 R1-2：写后**不依赖 listAssets** 的同会话解析 ────────────────
 *
 * 机制（P0-C-review §4）：归一化落盘走 `WorkspaceWriter`（`assetInsert.writeNormalized`），
 * 绕过了宿主 `writeToDisk` 的 URL 登记；app 层归一化成功后也没有刷新清单/预热缓存。
 * 于是同一会话内新引用解析 miss → 渲染端回落 `baseUrl + id` → 断图；
 * 而**不经插入、直接打开同磁盘状态**却正常（挂载期 listAssets 预热过缓存）。
 * 这条差异就是 N1-REOPEN-BROKEN 的全部内容，这里把它钉在「写」这一侧。
 */
describe('R1-2(g)：归一化写后同会话可解析（不经 listAssets）', () => {
  it('写成功即触发宿主预热：写后立刻 resolveAssetState 命中（同一会话、无清单刷新）', async () => {
    const { w } = disk({});
    // 计数 listAssets 调用：断言「同会话解析」不靠清单刷新兜底
    let listCalls = 0;
    const fallback = {
      baseUrl: '/',
      async listAssets() {
        listCalls += 1;
        return [];
      },
      resolveAsset: () => '/x',
      async uploadAsset() {
        return browserBlueprint('x.png') as AssetItem;
      },
      hasAsset: () => true,
      resolveAssetState: () => ({ kind: 'unresolved' as const, reason: 'unavailable' as const }),
    };
    const host = new WorkspaceAssetHost(fallback, () => w, '');
    stubFetchByUrl((u) => (u.includes('browser-') ? BLUE_PNG : RED_PNG));

    const result = await normalizeForInsert(
      { ...browserBlueprint('fresh.png'), origin: 'browser-idb' },
      { workspace: w },
      host as never,
    );
    if (result.kind !== 'normalized') throw new Error('unreachable');

    // 关键：**没有**调用过 listAssets，新引用也已经解析得到
    expect(listCalls).toBe(0);
    const state = host.resolveAssetState({
      kind: 'img',
      id: result.refId,
      origin: 'workspace-assets',
    });
    expect(state.kind).toBe('resolved');
    if (state.kind !== 'resolved') throw new Error('unreachable');
    expect(state.url.startsWith('blob:')).toBe(true);
  });

  it('旧宿主（无 primeWorkspaceAsset）→ 行为同今：插入仍成功（可选面不破兼容）', async () => {
    const { w, files } = disk({});
    // 没有 primeWorkspaceAsset 的宿主
    const legacyHost = {
      baseUrl: '/',
      async listAssets() {
        return [];
      },
      resolveAsset: () => 'blob:browser-fresh.png',
      async uploadAsset() {
        return browserBlueprint('fresh.png') as AssetItem;
      },
      hasAsset: () => true,
    };
    stubFetchByUrl(() => BLUE_PNG);
    const result = await normalizeForInsert(
      { ...browserBlueprint('fresh.png'), origin: 'browser-idb' },
      { workspace: w },
      legacyHost as never,
    );
    // 预热缺失**不得**把已成功的落盘改判成 refused
    expect(result.kind).toBe('normalized');
    expect(files.get('fresh.png')).toBe(BLUE_PNG);
  });

  it('预热抛错 → 插入仍是 normalized（磁盘事实成立，best-effort）', async () => {
    const { w, files } = disk({});
    const throwingHost = {
      baseUrl: '/',
      async listAssets() {
        return [];
      },
      resolveAsset: () => 'blob:browser-fresh.png',
      async uploadAsset() {
        return browserBlueprint('fresh.png') as AssetItem;
      },
      hasAsset: () => true,
      async primeWorkspaceAsset() {
        throw new Error('boom');
      },
    };
    stubFetchByUrl(() => BLUE_PNG);
    const result = await normalizeForInsert(
      { ...browserBlueprint('fresh.png'), origin: 'browser-idb' },
      { workspace: w },
      throwingHost as never,
    );
    expect(result.kind).toBe('normalized');
    expect(files.get('fresh.png')).toBe(BLUE_PNG);
  });
});

import { BUILTIN_ASSET_ITEMS } from '@mindcanvas/react';
/**
 * N4 · 渲染层：**面板的 child 分支**不得写 `builtin:` 引用（CE-05 的真正接线面）。
 *
 * 为什么单开一组：上面 N4 的三条直接调 `normalizeForInsert` —— 它们证明**归一化函数**
 * 会把内置图标内联，却证明不了 `SidePanels` 的 child 分支**调用了**它。
 * 实测（负控 SP3）：把 `SidePanels` 的 child 分支改回 `refId = item.id`（CE-05 的旧实现）
 * 后，仅调函数的用例全绿、exit 0 —— 守卫没被钉住。
 *
 * 这里驱动真实组件：点内置图标 + 选「子分支」语义 → 读 controller 收到的引用 id。
 * 断言「收到的 id 不是 builtin:」，因此中性化 child 分支即转红。
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach } from 'vitest';
import { SidePanels } from '../src/SidePanels';

afterEach(cleanup);

/** 记录 child 插入拿到的引用 id（真正的接线面断言口径） */
function recordingController() {
  const added: Array<{ kind: string; id: string }> = [];
  const notes: Array<Record<string, unknown>> = [];
  const controller = {
    root: { id: 'root' },
    selectedId: 'root',
    collapsed: new Set<string>(),
    dirty: false,
    updateNote: (_id: string, patch: Record<string, unknown>) => {
      notes.push(patch);
    },
    addEntityChild: (_parent: string, ref: { kind: string; id: string }) => {
      added.push(ref);
      return 'child-1';
    },
    toggleCollapse: () => undefined,
  };
  return { controller, added, notes };
}

/** 收窄助手：断言「此处必非空」（语义与 `!` 相同，但不触发 noNonNullAssertion） */
function must<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw new Error('expected non-null');
  return v;
}

/** 按文本找元素（面板 Tab 的唯一选择口径） */
function byText(nodes: NodeListOf<Element>, text: string): Element {
  const hit = Array.from(nodes).find((el) => el.textContent?.includes(text));
  if (hit === undefined) throw new Error(`no element containing ${text}`);
  return hit;
}

const PANEL_STUBS = {
  assetList: [],
  assetHost: { baseUrl: '/', resolveAsset: (i: { id: string }) => `/${i.id}` } as never,
  setEntities: () => undefined,
  relations: [],
  activeRefKey: null,
  edgeItems: [],
  onUpload: () => undefined,
  onSelectNode: () => undefined,
  onClose: () => undefined,
};

describe('N4（渲染层）：面板 child 分支必须走归一化，不得写 builtin:（CE-05）', () => {
  it('内置图标 + 子分支 → controller 收到的是 data: URL，不是 builtin:<id>', async () => {
    const { controller, added } = recordingController();
    const builtin = must(BUILTIN_ASSET_ITEMS[0]);
    const { container } = render(
      <SidePanels panel="assets" controller={controller as never} {...PANEL_STUBS} />,
    );

    // 切到「内置图标」Tab，选中「子分支」语义，点第一张卡片
    fireEvent.click(byText(container.querySelectorAll('[data-asset-tab]'), '内置图标'));
    fireEvent.click(must(container.querySelector('[data-asset-action="child"]')));
    fireEvent.click(must(container.querySelector('[data-asset-item]')));
    await new Promise((r) => setTimeout(r, 0));

    expect(added).toHaveLength(1);
    // CE-05 的核心断言：文档里绝不能出现 builtin: 引用
    expect(must(added[0]).id.startsWith('builtin:')).toBe(false);
    expect(builtin.id.startsWith('builtin:')).toBe(true); // 前提：内置项的 id 确实是 builtin: 形态
    expect(must(added[0]).id.startsWith('data:')).toBe(true);
  });

  it('icon 语义同样内联（child 与 icon 同口径，不自相矛盾）', async () => {
    const { controller, notes } = recordingController();
    const { container } = render(
      <SidePanels panel="assets" controller={controller as never} {...PANEL_STUBS} />,
    );
    fireEvent.click(byText(container.querySelectorAll('[data-asset-tab]'), '内置图标'));
    fireEvent.click(must(container.querySelector('[data-asset-action="icon"]')));
    fireEvent.click(must(container.querySelector('[data-asset-item]')));
    await new Promise((r) => setTimeout(r, 0));

    expect(notes).toHaveLength(1);
    expect(String(must(notes[0]).icon).startsWith('draw:data:')).toBe(true);
  });
});
