/**
 * 工作区资产宿主（FA2-T4）：把大尺寸资产**真的写进磁盘的 ./assets/**。
 *
 * 背景：此前上传的资产只落 IndexedDB（浏览器内），导出的 .mm.md 一旦脱离本机
 * 就是一堆断链 —— 拷给同事、换台机器、用 Obsidian 打开全都是叉。
 *
 * 分工（按体积）：
 *  - **小 SVG（≤15KB）**：保留内联源码（`AssetItem.svg`），写成 data URL 塞进
 *    note.icon —— 自包含，单文件拷走也能显示（FA1-T5 已有能力）；
 *  - **位图 / 大 SVG（>15KB）**：写进工作区的 `./assets/`，导图里用**相对路径**
 *    `assets/diagram.png` 引用 → 整个文件夹拷到任何机器都能离线浏览。
 *
 * 未挂载工作区时完全退回被包裹的宿主（IndexedDB），行为与之前一致 —— 平滑降级。
 *
 * ── P0-B 增量（全部是加法，既有方法签名一字未改）─────────────────────────────
 *  - **R-07 作用域化缓存键**：`objectUrls` → `ScopedObjectUrls`，键含 `scopeKey`；
 *    两个工作区各有一份 `assets/a.png` 时不再互相覆盖。
 *  - **R-08 三态**：`uploadAssetDetailed` 返回 `written` / `session-only` / `failed`；
 *    `uploadAsset` 保留为薄包装（返回 `.item`，既有调用方零改动）。
 *  - **§4.5.2 同名三选**：`conflict` 选项决定「保留两份 / 显式替换 / 取消」；
 *    **首期不去重**，默认「保留两份」，且**绝不用 `size`+`mtime` 判定同内容**（CE-03）。
 *  - **R-15 五态解析**：`resolveAssetState` 区分 `no-scope` / `missing` /
 *    `wrong-scope` / `external` / `unavailable`，**不回落站点根**。
 *  - **§4.5.4 记账**：写入前捕获 `{scopeKey, epoch}`；写入后若作用域已切换，
 *    调用方据 `isCurrent(捕获值)` 丢弃 UI 回填，但**必须记账**（I-22）。
 *  - **§6.3 释放**：`disposeScope` / `disposeAll` 统一 revoke（R-16）。
 */
import {
  BROWSER_SCOPE_KEY,
  assetEntryKey,
  cacheKeyOf,
  isExternalRef,
  isWorkspaceAssetRef,
  kindOfFileName,
  mimeOfFileName,
  originOfItem,
  uniqueAssetName,
  type AssetConflictChoice,
  type AssetHostV2,
  type AssetResolution,
  type AssetScopeMark,
  type AssetStore,
  type AssetWriteResult,
} from './assetHost.js';
import type { AssetHost } from './assetHost.js';
import { ScopedObjectUrls } from './assetObjectUrls.js';
import { INLINE_SVG_LIMIT } from './assetIcons.js';
import type { AssetItem } from './assetTypes.js';

/** 工作区落盘能力的最小面（结构化类型，`DirectoryWorkspaceHost` 天然满足） */
export interface WorkspaceWriter {
  mounted: boolean;
  writeAsset(name: string, data: ArrayBuffer | string, mime: string): Promise<string>;
  hasAsset(relPath: string): Promise<boolean>;
  listAssetFiles(): Promise<Array<{ path: string; name: string }>>;
  readAssetFile(relPath: string): Promise<File | null>;
}

/**
 * 工作区身份面（P0-0 的 `DirectoryWorkspaceHost` 满足）。
 *
 * 为什么用 **getter 延迟读**而不是构造时快照：挂载 / 断开 / 切换都发生在宿主创建之后，
 * 且上传必须在**写入前**捕获 —— 读的时刻就是契约要的「捕获时」。
 */
export interface WorkspaceScopeSource {
  scopeId: string | null;
  scopeEpoch: number;
}

/** 上传时的同名冲突决策（缺省「保留两份」——安全侧，不改既有文件与引用） */
export interface UploadOptions {
  conflict?: AssetConflictChoice;
  /** 已知引用处数（供冲突面板显示；**不是**「全部引用处」，覆盖范围另标） */
  refCount?: number | null;
  refCoverage?: 'current-doc' | 'unknown';
  /**
   * 「本会话内已逐字节比对过旧文件」的判定结果。**只有显式 `true`** 才允许跳过
   * 「保留两份」；`size`/`mtime` 相同**不得**据此传 `true`（CE-03 / §4.5.2）。
   */
  bytesEqual?: boolean;
}

export class WorkspaceAssetHost implements AssetHostV2 {
  readonly baseUrl: string;
  /** 回退宿主：按 `AssetHostV2` 持有（`AssetHost` 是其超集，故既有调用方照样能传进来） */
  private fallback: AssetHostV2;
  /** 工作区用 getter 而非实例：挂载/断开都发生在宿主创建之后 */
  private workspaceOf: () => WorkspaceWriter | null;
  /** 作用域来源（可选：未接线时按 `browser:local` 处理，行为与升级前一致） */
  private scopeOf: (() => WorkspaceScopeSource) | null;
  /** 作用域感知 objectURL 缓存（R-07 + R-16 + LRU） */
  private urls: ScopedObjectUrls;

  constructor(
    fallback: AssetHost,
    workspaceOf: () => WorkspaceWriter | null,
    baseUrl = '',
    scopeOf: (() => WorkspaceScopeSource) | null = null,
  ) {
    this.fallback = fallback;
    this.workspaceOf = workspaceOf;
    this.scopeOf = scopeOf;
    this.baseUrl = baseUrl;
    this.urls = new ScopedObjectUrls({
      revokeObjectURL: (url) => URL.revokeObjectURL(url),
    });
  }

  /** 当前可用的工作区写入器（未挂载 → null） */
  private ws(): WorkspaceWriter | null {
    const w = this.workspaceOf();
    return w?.mounted === true ? w : null;
  }

  /** **捕获**当前作用域标记。上传必须在写入前调它一次，之后一律用捕获值。 */
  scopeMark(): AssetScopeMark {
    const s = this.scopeOf?.();
    if (!s || s.scopeId === null) return { scopeKey: BROWSER_SCOPE_KEY, epoch: s?.scopeEpoch ?? 0 };
    return { scopeKey: s.scopeId, epoch: s.scopeEpoch };
  }

  /** 该标记是否仍是当前作用域（调用方回填前的校验入口，§6.2） */
  isCurrent(mark: AssetScopeMark): boolean {
    const now = this.scopeMark();
    return now.scopeKey === mark.scopeKey && now.epoch === mark.epoch;
  }

  /**
   * 该资产应该走磁盘还是内联：
   * 只有「小到能内联的 SVG」留作内联，其余（位图、大 SVG）一律落盘。
   */
  static shouldPersistToDisk(file: File): boolean {
    if (kindOfFileName(file.name) !== 'draw') return true;
    return file.size > INLINE_SVG_LIMIT;
  }

  async listAssets(): Promise<AssetItem[]> {
    const mark = this.scopeMark();
    const items = await this.fallback.listAssets();
    const w = this.ws();
    if (!w) return items;
    // 磁盘资产并进来，并重建 objectURL（否则刷新后缩略图全裂）
    const disk: AssetItem[] = [];
    for (const f of await w.listAssetFiles()) {
      const key = cacheKeyOf(mark, f.path);
      if (!this.urls.has(key)) {
        const file = await w.readAssetFile(f.path);
        if (file) this.urls.set(key, URL.createObjectURL(file));
      }
      disk.push({
        kind: kindOfFileName(f.name),
        id: f.path,
        name: f.name,
        type: (f.name.toLowerCase().split('.').pop() ?? 'bin').slice(0, 8),
        // R1-1：磁盘扫描项一律 `workspace-assets`（**读侧**标注，迁移面为零）
        origin: 'workspace-assets',
      });
    }
    // R1-1：合并键 = **复合键（origin + id）**，不是裸 id。
    //
    // 旧实现按 id 合并，磁盘项因此**顶替**同名的浏览器素材库项 ——「浏览器库里的蓝图」
    // 在挂载工作区后就从清单里消失了（N1-ID-COLLISION 的第一跳）。复合键让两者
    // **都是可选中的独立卡片**，卡片 key 也不再相撞。
    // fallback 清单里已显式标注来源的项（新 IdbAssetHost）与本层标注的磁盘项天然分属两个键；
    // 旧宿主（无 origin）的项由 `assetEntryKey` 按 id 形态推断，避免与磁盘项重复列出。
    const byKey = new Map(items.map((a) => [assetEntryKey(a), a]));
    for (const d of disk) byKey.set(assetEntryKey(d), d);
    return [...byKey.values()];
  }

  resolveAsset(item: Pick<AssetItem, 'id'>): string {
    const cached = this.urls.get(cacheKeyOf(this.scopeMark(), item.id));
    if (cached !== null) return cached;
    return this.fallback.resolveAsset(item);
  }

  /**
   * 显式解析状态（R-15）：**不回落站点根**。
   *
   * `no-scope`（未挂载）与 `missing`（挂载了但文件不在）必须分开（I-11）；
   * `external` 是外链，不纳入图库管理，也**不产生** `W-ASSET-MISSING`。
   * 静态打包资产（既非自包含也非 `assets/`）仍按 `baseUrl` 解析 —— 那是应用自带资源，
   * 不属于「站点根回落」那个反例。
   *
   * ── P0-FIX-R1 R1-1：**按来源路由，不按 id 前缀猜** ──
   * `origin === 'browser-idb'` 的项即使 id 是 `assets/` 形态，字节也在浏览器素材库里
   * （`IdbAssetHost`），必须**委托给 fallback** —— 本宿主的 scope 缓存里放着的是磁盘上
   * 同名文件的字节，命中它就会把蓝图静默换成红图（N1.5 实测的根因）。
   * 未标 origin 的项维持旧判据（`isWorkspaceAssetRef` 前缀），兼容面不变。
   */
  resolveAssetState(item: Pick<AssetItem, 'kind' | 'id' | 'origin'>): AssetResolution {
    const id = item.id;
    if (id.startsWith('data:')) return { kind: 'resolved', url: id };
    if (isExternalRef(id)) return { kind: 'unresolved', reason: 'external' };
    const origin = originOfItem(item);
    if (origin === 'browser-idb') return this.originatedBy('browser-idb', item);
    if (origin === 'builtin' || id.startsWith('builtin:')) {
      return { kind: 'resolved', url: `${this.baseUrl}${id}` };
    }
    if (origin !== 'workspace-assets' && !isWorkspaceAssetRef(id)) {
      return { kind: 'resolved', url: this.resolveAsset(item) };
    }
    const cached = this.urls.get(cacheKeyOf(this.scopeMark(), id));
    if (cached !== null) return { kind: 'resolved', url: cached };
    const w = this.ws();
    if (!w) return { kind: 'unresolved', reason: 'no-scope' };
    // 挂载中且缓存未命中：清单已从磁盘重建过 → 磁盘上确实没有这个文件。
    // 这里**不**回落 `baseUrl + id` —— 那会指向站点根下一个不存在的路径（R-15）。
    return { kind: 'unresolved', reason: 'missing' };
  }

  /**
   * 委托给 fallback 宿主解析**它自己存储里的**字节（R1-1）。
   *
   * 关键：**先试五态版**（`IdbAssetHost.resolveAssetState` 会对声明了 `browser-idb`
   * 却无缓存的项返回 `unavailable`，而不是回落一个必然 404 的 `baseUrl + id`）；
   * 旧 fallback 没有该方法时退回字符串版，与升级前同形。
   */
  private originatedBy(
    origin: AssetStore,
    item: Pick<AssetItem, 'kind' | 'id' | 'origin'>,
  ): AssetResolution {
    void origin;
    if (typeof this.fallback.resolveAssetState === 'function') {
      return this.fallback.resolveAssetState(item);
    }
    return { kind: 'resolved', url: this.fallback.resolveAsset(item) };
  }

  /**
   * 写后预热（P0-FIX-R1 R1-2 / `AssetHostV2.primeWorkspaceAsset`）。
   *
   * 归一化落盘绕开了本宿主的 `writeToDisk`，缓存里没有这个文件 → 同会话内新引用解析不到。
   * 这里补上那一跳：读盘 → 建 objectURL → 按**当前** scope 的缓存键登记。
   *
   * 幂等：`ScopedObjectUrls.set` 同键先 revoke 旧值。
   * 失败（无工作区 / 读不到 / 建 URL 抛错）→ `false`，**不抛**——
   * 调用方据此最多少一次预热，绝不因此把已经写成功的插入改判失败。
   */
  async primeWorkspaceAsset(relPath: string): Promise<boolean> {
    const w = this.ws();
    if (!w) return false;
    let file: File | null = null;
    try {
      file = await w.readAssetFile(relPath);
    } catch {
      return false;
    }
    if (file === null) return false;
    try {
      this.urls.set(cacheKeyOf(this.scopeMark(), relPath), URL.createObjectURL(file));
    } catch {
      return false;
    }
    return true;
  }

  /**
   * 上传（三态可判别）。**捕获作用域在写入之前**——`epoch` 可能在写入过程中变化。
   */
  async uploadAssetDetailed(
    file: File,
    kind?: 'img' | 'draw',
    options: UploadOptions = {},
  ): Promise<AssetWriteResult> {
    const mark = this.scopeMark();
    const resolvedKind = kind ?? kindOfFileName(file.name);
    const w = this.ws();

    // 无工作区 或 该资产适合内联 → 走原宿主（IndexedDB + 小 SVG 内联源码）
    if (!w || !WorkspaceAssetHost.shouldPersistToDisk(file)) {
      return this.uploadViaFallback(file, resolvedKind, mark);
    }

    // ── 同名策略（§4.5.2）：首期不去重，一律三选，默认「保留两份」。
    // 判据是**名字是否已占用**（`hasAsset`），不是「内容是否相同」——
    // `size`+`mtime` 不得参与（CE-03）。
    const choice = options.conflict ?? 'keep-both';
    if (await this.diskHas(`assets/${file.name}`)) {
      if (choice === 'cancel') {
        return {
          kind: 'failed',
          error: { code: 'E-ABORT', retryable: false, detail: '用户取消同名冲突' },
        };
      }
      // `keep-both`（默认）→ 分配不冲突的新名；`replace` → 覆盖原名。
      // `bytesEqual === true`（本会话内已逐字节比对过）是**唯一**允许跳过三选的情形。
      if (choice === 'keep-both' && options.bytesEqual !== true) {
        const name = await uniqueAssetName(file.name, (c) => this.diskHas(`assets/${c}`));
        return this.writeToDisk(file, name, resolvedKind, mark);
      }
    }

    return this.writeToDisk(file, file.name, resolvedKind, mark);
  }

  /** 落盘（`name` 已定：原名或「保留两份」的新名） */
  private async writeToDisk(
    file: File,
    name: string,
    resolvedKind: 'img' | 'draw',
    mark: AssetScopeMark,
  ): Promise<AssetWriteResult> {
    const w = this.ws();
    if (!w) {
      return {
        kind: 'session-only',
        item: itemOf(resolvedKind, `assets/${name}`, file.name),
        reason: 'no-workspace',
      };
    }
    const mime = mimeOfFileName(file.name, file.type);
    const data = await file.arrayBuffer();
    let relPath: string;
    try {
      relPath = await w.writeAsset(name, data, mime);
    } catch (e) {
      return { kind: 'failed', error: { code: 'E-IO', retryable: true, detail: detailOf(e) } };
    }
    // 会话内立刻可显示：用上传时的 File 建 objectURL（不必回读磁盘）。
    // 键用**捕获时**的 mark —— `epoch` 可能在这行之前就变了。
    this.urls.set(cacheKeyOf(mark, relPath), URL.createObjectURL(file));
    return {
      kind: 'written',
      item: itemOf(resolvedKind, relPath, file.name),
      store: 'workspace-assets',
      refId: relPath,
      bytes: file.size,
    };
  }
  /**
   * 回退宿主（IndexedDB）：把它的 `AssetItem` 结果翻译成三态。
   *
   * 回退宿主 = `IdbAssetHost`，它**自己**在写失败时降级会话级（内部 catch）。
   * 因此这里的判据是「回退宿主是否声明自己可判别」：声明了 `uploadAssetDetailed`
   * 就用它的三态；没声明（旧宿主）则按「它 resolve 得出 blob → 至少本次会话可用」
   * 如实降级为 `session-only`，**不冒充** `written`。
   */
  private async uploadViaFallback(
    file: File,
    resolvedKind: 'img' | 'draw',
    mark: AssetScopeMark,
  ): Promise<AssetWriteResult> {
    const item = await this.fallback.uploadAsset(file, resolvedKind);
    // 小 SVG：记住内联源码，让「设为节点图标」能自包含写进 .mm.md
    await this.cacheInline(item, file);
    const key = cacheKeyOf(mark, item.id);
    const url = this.fallback.resolveAsset(item);
    if (url.startsWith('blob:')) this.urls.set(key, url);
    if (typeof this.fallback.uploadAssetDetailed === 'function') {
      return this.fallback.uploadAssetDetailed(file, resolvedKind);
    }
    return { kind: 'session-only', item, reason: 'no-workspace' };
  }

  /** 磁盘上是否已有该相对路径（未挂载 → false） */
  private async diskHas(relPath: string): Promise<boolean> {
    const w = this.ws();
    if (!w) return false;
    try {
      return await w.hasAsset(relPath);
    } catch {
      return false;
    }
  }

  /** 既有签名不变：薄包装（契约 §4.5.1「uploadAsset 保留为薄包装」） */
  async uploadAsset(file: File, kind?: 'img' | 'draw'): Promise<AssetItem> {
    const result = await this.uploadAssetDetailed(file, kind);
    if (result.kind === 'failed') throw new Error(result.error.detail ?? result.error.code);
    return result.item;
  }

  /** 小 SVG：记住内联源码，让「设为节点图标」能自包含写进 .mm.md */
  private async cacheInline(item: AssetItem, file: File): Promise<void> {
    if (item.kind !== 'draw' || file.size > INLINE_SVG_LIMIT) return;
    item.svg = await file.text();
  }

  hasAsset(item: Pick<AssetItem, 'kind' | 'id'>): boolean {
    if (this.urls.has(cacheKeyOf(this.scopeMark(), item.id))) return true;
    return this.fallback.hasAsset(item);
  }

  // ── §6.3 释放策略（R-16）

  /** 释放某个作用域的全部 objectURL（`pick` / `detach` / 替换目录） */
  disposeScope(scopeKey: string): number {
    return this.urls.releaseScope(scopeKey);
  }

  /** 释放全部（组件卸载；宿主实例被复用时的兜底） */
  disposeAll(): number {
    return this.urls.releaseAll();
  }

  /** 当前缓存的 URL 数（诊断与测试用） */
  cachedUrlCount(): number {
    return this.urls.size;
  }
}

function itemOf(kind: 'img' | 'draw', id: string, name: string): AssetItem {
  return {
    kind,
    id,
    name,
    type: (name.toLowerCase().split('.').pop() ?? 'bin').slice(0, 8),
    // R1-1：本宿主产出/落盘的项，字节在工作区磁盘上
    origin: 'workspace-assets',
  };
}

function detailOf(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}
