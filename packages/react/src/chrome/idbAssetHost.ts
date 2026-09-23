/**
 * IdbAssetHost —— IndexedDB 持久化资产宿主（P0-2）。
 * 解决 DemoAssetHost「上传即会话级幻觉」：objectURL + 内存清单刷新全丢，
 * 文档内 @img/@draw 引用沦为永久悬空（W-ASSET-MISSING）。
 *
 * 设计：
 * - 上传资产（File → ArrayBuffer）落 IndexedDB（浏览器内本地优先，符合 spec「真实持久化属宿主职责」）
 * - resolveAsset 同步契约不变：清单加载（listAssets）时预热 objectURL 缓存；
 *   上传时即建缓存；未命中（静态打包资产）回落 baseUrl + id
 * - 同名上传 = 替换语义（同 id put 覆盖，清单去重）
 * - 静态清单（打包 demo 资产）与 IDB 清单并集，同 id 时 IDB 优先
 *
 * ── P0-B 增量 ────────────────────────────────────────────────────────────
 * - **R-08 三态**：`putRecord` 失败时**不再静默**返回同一个 `AssetItem`
 *   （旧 `:146-150`），而是由 `uploadAssetDetailed` 如实给出
 *   `session-only` + `reason: 'idb-failed'`；`uploadAsset` 保留为薄包装。
 * - **可携带性**：IDB 落点的 `store = 'browser-idb'`、`portability = 'browser-local'`，
 *   由 `portabilityOfStore` 单点推导（禁止各处手写，避免同一 store 两种说法）。
 * - **缓存键作用域化**：`objectUrls` → 键含 scopeKey（与工作区宿主同一缓存实现）。
 * - **§6.3 释放**：`disposeScope` / `disposeAll`。
 */
import {
  BROWSER_SCOPE_KEY,
  assetEntryKey,
  cacheKeyOf,
  kindOfFileName,
  mimeOfFileName,
  portabilityOfStore,
} from './assetHost.js';
import type {
  AssetHostV2,
  AssetResolution,
  AssetScopeMark,
  AssetWriteResult,
} from './assetHost.js';
import { ScopedObjectUrls } from './assetObjectUrls.js';
import { INLINE_SVG_LIMIT } from './assetIcons.js';
import type { AssetItem } from './assetTypes.js';

/** IDB 库名/store 名（每导图一个资产空间 = 每库一份；当前单文档应用共用一库） */
const DB_NAME = 'mindcanvas-assets';
const STORE = 'assets';

/** IDB 记录：meta + 二进制一体（listAssets 一次 getAll 拿全量） */
interface AssetRecord {
  id: string;
  kind: 'img' | 'draw';
  name: string;
  type: string;
  mime: string;
  data: ArrayBuffer;
  /**
   * 小 SVG 的源码（FA1-T5）：< 15KB 额外存一份文本，
   * 使「设为节点图标」能把图标内联进 .mm.md（脱离 IndexedDB 也自包含显示）。
   */
  svg?: string;
}

/**
 * IDB 记录字段白名单（P0-FIX-R1 R1-1）。
 *
 * **存在的唯一理由**：`AssetItem.origin` 是**运行时读侧概念**，不得落到任何持久面。
 * 旧实现在 `putRecord` 处写「记录形状」，但构造用的是 `{ ...item, mime, data }` ——
 * 展开表达式不受 TS 多余属性检查约束，给 `AssetItem` 加字段就会**静默写进 IndexedDB**
 * （实测：加 `origin` 后记录里立刻多出该字段）。这里改成显式列字段，把这件事钉死。
 */
function toRecordFields(item: AssetItem): AssetRecord {
  const fields: AssetRecord = {
    id: item.id,
    kind: item.kind,
    name: item.name,
    type: item.type,
    mime: '',
    data: new ArrayBuffer(0),
  };
  // 小 SVG 的源码是**内容**（要持久化）；origin 是**读侧标注**（不持久化）——两者分开对待
  if (typeof item.svg === 'string') fields.svg = item.svg;
  return fields;
}

/** 未知协议形状窄化（读侧容错；与 centers.ts isRec 同款谓词模式，零断言） */
function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** getAll 结果的运行期校验（IDB 返回 any——谓词收窄，不用类型断言：预算纪律只减不增）。
 *  只校验身份字段（id/kind）：fake-indexeddb 的结构克隆不保证 data 的 ArrayBuffer 身份，
 *  严格 instanceof 会把合法记录误判为空（P0-2 持久化测试实证）。 */
function isAssetRecordArray(v: unknown): v is AssetRecord[] {
  return (
    Array.isArray(v) &&
    v.every((r) => isRec(r) && typeof r.id === 'string' && typeof r.kind === 'string')
  );
}

export class IdbAssetHost implements AssetHostV2 {
  readonly baseUrl: string;
  /** 静态打包清单（构造注入；resolve 回落 baseUrl+id） */
  private staticItems: AssetItem[];
  /** 全量清单缓存（静态 + IDB 并集；listAssets 首次加载后就绪） */
  private items: AssetItem[] | null = null;
  /** 作用域感知 objectURL 缓存（P0-B：键含 scopeKey + 统一 revoke + LRU） */
  private urls: ScopedObjectUrls;
  /** 作用域来源（可选：浏览器素材库是唯一作用域，未接线时按 `browser:local`） */
  private scopeOf: (() => AssetScopeMark) | null;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(staticItems: AssetItem[] = [], baseUrl = '/', scopeOf: (() => AssetScopeMark) | null = null) {
    this.staticItems = [...staticItems];
    this.baseUrl = baseUrl;
    this.scopeOf = scopeOf;
    this.urls = new ScopedObjectUrls({
      revokeObjectURL: (url) => URL.revokeObjectURL(url),
    });
  }

  /**
   * 作用域标记。浏览器素材库**只有唯一作用域**（`browser:local`），
   * 故 `scopeKey` 恒定；`epoch` 由注入源给出（用于「写入已完成但作用域已切换」的记账）。
   */
  scopeMark(): AssetScopeMark {
    return this.scopeOf?.() ?? { scopeKey: BROWSER_SCOPE_KEY, epoch: 0 };
  }

  /** 释放某个作用域的全部 objectURL（浏览器宿主只有 `browser:local`） */
  disposeScope(scopeKey: string): number {
    return this.urls.releaseScope(scopeKey);
  }

  /** 释放全部（组件卸载） */
  disposeAll(): number {
    return this.urls.releaseAll();
  }

  /** 当前缓存的 URL 数（诊断与测试用） */
  cachedUrlCount(): number {
    return this.urls.size;
  }

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
    });
    return this.dbPromise;
  }

  private async putRecord(record: AssetRecord): Promise<void> {
    const db = await this.db();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record, record.id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('indexedDB put failed'));
    });
  }

  private async allRecords(): Promise<AssetRecord[]> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => {
        const rows: unknown = req.result ?? [];
        resolve(isAssetRecordArray(rows) ? rows : []);
      };
      req.onerror = () => reject(req.error ?? new Error('indexedDB getAll failed'));
    });
  }

  async listAssets(): Promise<AssetItem[]> {
    if (this.items) return [...this.items];
    const mark = this.scopeMark();
    const idbItems: AssetItem[] = [];
    try {
      for (const rec of await this.allRecords()) {
        // R1-1：**读侧**标注存储来源 —— IDB 记录一律 `browser-idb`。
        // 迁移面为零：现有记录没有 origin 字段，来源由这里在读取时补上。
        const item: AssetItem = {
          kind: rec.kind,
          id: rec.id,
          name: rec.name,
          type: rec.type,
          origin: 'browser-idb',
        };
        if (typeof rec.svg === 'string') item.svg = rec.svg;
        idbItems.push(item);
        // 预热 objectURL：让同步 resolveAsset 在清单加载后立即可用（接口零变更）
        const key = cacheKeyOf(mark, rec.id);
        if (!this.urls.has(key)) {
          this.urls.set(key, URL.createObjectURL(new Blob([rec.data], { type: rec.mime })));
        }
      }
    } catch {
      // IDB 不可用（隐私模式等）：降级为纯静态清单，上传仍可用（会话级）
    }
    // 并集：静态打底，IDB 覆盖同 id（上传替换打包资产的场景）
    // R1-1：去重键按 origin 归一（静态项缺 origin 时由 `assetEntryKey` 按 id 推断），
    // 避免「静态项无 origin / IDB 项有 origin」被误判成两个不同条目而重复列出同一张图。
    const byId = new Map(this.staticItems.map((a) => [assetEntryKey(a), a]));
    for (const a of idbItems) byId.set(assetEntryKey(a), a);
    this.items = [...byId.values()];
    return [...this.items];
  }

  resolveAsset(item: Pick<AssetItem, 'kind' | 'id'>): string {
    const url = this.urls.get(cacheKeyOf(this.scopeMark(), item.id));
    if (url !== null) return url;
    return this.baseUrl + item.id;
  }

  /**
   * 显式解析状态（P0-FIX-R1 R1-1）：**本宿主只认浏览器素材库的字节**。
   *
   * `origin === 'workspace-assets'` 的项**不在此解析** —— 它在磁盘上，字节得问工作区宿主。
   * 返回 `unresolved/unavailable` 而不是空串：调用方据此**委托**下一跳，而不是拿到一个
   * 必然 404 的 `baseUrl + id`（那正是 N1.5「蓝图字节被红图顶替」的入口之一）。
   *
   * 未标 origin 的项（旧调用方、纯静态 demo 资产）行为与升级前一致：命中预热缓存就返回
   * objectURL，否则回落 `baseUrl + id`（静态打包资产的合法回落，R-15 禁的是**工作区**引用
   * 回落站点根，不是这一条）。
   */
  resolveAssetState(item: Pick<AssetItem, 'kind' | 'id' | 'origin'>): AssetResolution {
    if (item.origin === 'workspace-assets') {
      return { kind: 'unresolved', reason: 'unavailable' };
    }
    const url = this.urls.get(cacheKeyOf(this.scopeMark(), item.id));
    if (url !== null) return { kind: 'resolved', url };
    if (item.origin === 'browser-idb') {
      // 声明了来源却无字节：它**不在磁盘上**，回落 baseUrl 只会拿到站点根下的 404
      return { kind: 'unresolved', reason: 'unavailable' };
    }
    return { kind: 'resolved', url: this.baseUrl + item.id };
  }

  /**
   * 上传（**三态可判别**，R-08）。旧实现在 `putRecord` 失败时 `catch` 掉错误
   * 并返回同一个 `AssetItem`，上层无法区分「写进了 IDB」与「只在内存里」。
   *
   * `session-only.reason = 'idb-failed'` 是**唯一**的「写失败但本次可用」出口，
   * 对应 A3 的「仅本次会话」徽章与「没有写入持久存储」文案。
   */
  async uploadAssetDetailed(file: File, kind?: 'img' | 'draw'): Promise<AssetWriteResult> {
    const mark = this.scopeMark();
    const item: AssetItem = {
      kind: kind ?? kindOfFileName(file.name),
      id: `assets/${file.name}`,
      name: file.name,
      type: (file.name.toLowerCase().split('.').pop() ?? 'bin').slice(0, 8),
      // R1-1：上传落 IDB → 读侧来源即 `browser-idb`（**内存项**标注；不随记录持久化）
      origin: 'browser-idb',
    };
    const data = await file.arrayBuffer();
    const mime = mimeOfFileName(file.name, file.type);
    // FA1-T5：小 SVG 额外留一份源码（内联自包含的前提；大图不塞文本，避免库膨胀）
    const svg =
      item.kind === 'draw' && file.size <= INLINE_SVG_LIMIT ? await file.text() : undefined;
    if (svg !== undefined) item.svg = svg;

    let persisted = true;
    try {
      // 显式列字段（非 `{...item}`）：`origin` 是运行时读侧概念，**不得**写进 IndexedDB
      await this.putRecord({ ...toRecordFields(item), mime, data });
    } catch {
      // 持久化失败：**如实降级**（不再冒充成功）——objectURL 已建，本次会话内可用
      persisted = false;
    }
    const key = cacheKeyOf(mark, item.id);
    this.urls.set(key, URL.createObjectURL(new Blob([data], { type: mime })));
    // 替换语义：清单同 id 去重（null 清单 = 尚未 listAssets，仅并入静态）
    // R1-1：按**条目键**去重，使「浏览器库的 a.png」与「磁盘的 a.png」能共存（复合键）
    const base = this.items ?? [...this.staticItems];
    const itemKey = assetEntryKey(item);
    this.items = [...base.filter((a) => assetEntryKey(a) !== itemKey), item];

    if (!persisted) return { kind: 'session-only', item, reason: 'idb-failed' };
    return {
      kind: 'written',
      item,
      store: 'browser-idb',
      refId: item.id,
      bytes: file.size,
    };
  }

  /** 既有签名不变：薄包装（契约 §4.5.1「uploadAsset 保留为薄包装」） */
  async uploadAsset(file: File, kind?: 'img' | 'draw'): Promise<AssetItem> {
    const result = await this.uploadAssetDetailed(file, kind);
    if (result.kind === 'failed') throw new Error(result.error.detail ?? result.error.code);
    return result.item;
  }

  hasAsset(item: Pick<AssetItem, 'kind' | 'id'>): boolean {
    return (this.items ?? this.staticItems).some((a) => a.kind === item.kind && a.id === item.id);
  }
}

/** `store` → `portability` 在此再导出，供调用方单点取用（避免各处手写映射） */
export { portabilityOfStore };
