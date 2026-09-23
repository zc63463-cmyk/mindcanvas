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
import { beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceWriter } from '@mindcanvas/react';
import { normalizeForInsert, inlineRefOf, builtinInlineRef, fileNameOfAsset } from '@mindcanvas/react';
import type { AssetHost, AssetItem } from '@mindcanvas/react';

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
    const result = await normalizeForInsert(browserBlueprint('fresh.png'), { workspace: w }, blueHost);
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
    const result = await normalizeForInsert(browserBlueprint('big.png'), { workspace: null }, blueHost);
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
    expect(fileNameOfAsset({ kind: 'img', id: 'assets/sub/a.png', name: 'whatever', type: 'png' })).toBe('a.png');
    expect(fileNameOfAsset({ kind: 'img', id: 'builtin:star', name: '星标', type: 'svg' })).toBe('星标');
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
import { render, cleanup, fireEvent } from '@testing-library/react';
import { afterEach } from 'vitest';
import { BUILTIN_ASSET_ITEMS } from '@mindcanvas/react';
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

const PANEL_STUBS = {
  assetList: [],
  assetHost: { baseUrl: '/', resolveAsset: (i: { id: string }) => '/' + i.id } as never,
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
    const builtin = BUILTIN_ASSET_ITEMS[0]!;
    const { container } = render(
      <SidePanels panel="assets" controller={controller as never} {...PANEL_STUBS} />,
    );

    // 切到「内置图标」Tab，选中「子分支」语义，点第一张卡片
    fireEvent.click(
      Array.from(container.querySelectorAll('[data-asset-tab]')).find((el) =>
        el.textContent?.includes('内置图标'),
      )!,
    );
    fireEvent.click(container.querySelector('[data-asset-action="child"]')!);
    fireEvent.click(container.querySelector('[data-asset-item]')!);
    await new Promise((r) => setTimeout(r, 0));

    expect(added).toHaveLength(1);
    // CE-05 的核心断言：文档里绝不能出现 builtin: 引用
    expect(added[0]!.id.startsWith('builtin:')).toBe(false);
    expect(builtin.id.startsWith('builtin:')).toBe(true); // 前提：内置项的 id 确实是 builtin: 形态
    expect(added[0]!.id.startsWith('data:')).toBe(true);
  });

  it('icon 语义同样内联（child 与 icon 同口径，不自相矛盾）', async () => {
    const { controller, notes } = recordingController();
    const { container } = render(
      <SidePanels panel="assets" controller={controller as never} {...PANEL_STUBS} />,
    );
    fireEvent.click(
      Array.from(container.querySelectorAll('[data-asset-tab]')).find((el) =>
        el.textContent?.includes('内置图标'),
      )!,
    );
    fireEvent.click(container.querySelector('[data-asset-action="icon"]')!);
    fireEvent.click(container.querySelector('[data-asset-item]')!);
    await new Promise((r) => setTimeout(r, 0));

    expect(notes).toHaveLength(1);
    expect(String(notes[0]!.icon).startsWith('draw:data:')).toBe(true);
  });
});
