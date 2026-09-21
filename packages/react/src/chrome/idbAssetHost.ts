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
 */
import { mimeOfFileName, kindOfFileName } from './assetHost.js';
import { INLINE_SVG_LIMIT } from './assetIcons.js';
import type { AssetItem } from './assetTypes.js';
import type { AssetHost } from './assetHost.js';

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

export class IdbAssetHost implements AssetHost {
  readonly baseUrl: string;
  /** 静态打包清单（构造注入；resolve 回落 baseUrl+id） */
  private staticItems: AssetItem[];
  /** 全量清单缓存（静态 + IDB 并集；listAssets 首次加载后就绪） */
  private items: AssetItem[] | null = null;
  /** 资产 id → objectURL（listAssets 预热 / uploadAsset 即建；会话内缓存） */
  private objectUrls = new Map<string, string>();
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(staticItems: AssetItem[] = [], baseUrl = '/') {
    this.staticItems = [...staticItems];
    this.baseUrl = baseUrl;
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
    const idbItems: AssetItem[] = [];
    try {
      for (const rec of await this.allRecords()) {
        const item: AssetItem = { kind: rec.kind, id: rec.id, name: rec.name, type: rec.type };
        if (typeof rec.svg === 'string') item.svg = rec.svg;
        idbItems.push(item);
        // 预热 objectURL：让同步 resolveAsset 在清单加载后立即可用（接口零变更）
        if (!this.objectUrls.has(rec.id)) {
          this.objectUrls.set(
            rec.id,
            URL.createObjectURL(new Blob([rec.data], { type: rec.mime })),
          );
        }
      }
    } catch {
      // IDB 不可用（隐私模式等）：降级为纯静态清单，上传仍可用（会话级）
    }
    // 并集：静态打底，IDB 覆盖同 id（上传替换打包资产的场景）
    const byId = new Map(this.staticItems.map((a) => [a.id, a]));
    for (const a of idbItems) byId.set(a.id, a);
    this.items = [...byId.values()];
    return [...this.items];
  }

  resolveAsset(item: Pick<AssetItem, 'kind' | 'id'>): string {
    const url = this.objectUrls.get(item.id);
    if (url) return url;
    return this.baseUrl + item.id;
  }

  async uploadAsset(file: File, kind?: 'img' | 'draw'): Promise<AssetItem> {
    const item: AssetItem = {
      kind: kind ?? kindOfFileName(file.name),
      id: `assets/${file.name}`,
      name: file.name,
      type: (file.name.toLowerCase().split('.').pop() ?? 'bin').slice(0, 8),
    };
    const data = await file.arrayBuffer();
    const mime = mimeOfFileName(file.name, file.type);
    // FA1-T5：小 SVG 额外留一份源码（内联自包含的前提；大图不塞文本，避免库膨胀）
    const svg =
      item.kind === 'draw' && file.size <= INLINE_SVG_LIMIT ? await file.text() : undefined;
    if (svg !== undefined) item.svg = svg;
    try {
      await this.putRecord({ ...item, mime, data });
    } catch {
      // 持久化失败：降级会话级（objectURL 已建，本次会话内可用）
    }
    const prevUrl = this.objectUrls.get(item.id);
    if (prevUrl !== undefined) URL.revokeObjectURL(prevUrl);
    this.objectUrls.set(item.id, URL.createObjectURL(new Blob([data], { type: mime })));
    // 替换语义：清单同 id 去重（null 清单 = 尚未 listAssets，仅并入静态）
    const base = this.items ?? [...this.staticItems];
    this.items = [...base.filter((a) => a.id !== item.id), item];
    return item;
  }

  hasAsset(item: Pick<AssetItem, 'kind' | 'id'>): boolean {
    return (this.items ?? this.staticItems).some((a) => a.kind === item.kind && a.id === item.id);
  }
}
