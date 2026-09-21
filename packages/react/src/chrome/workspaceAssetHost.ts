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
 */
import { kindOfFileName, mimeOfFileName, type AssetHost } from './assetHost.js';
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

export class WorkspaceAssetHost implements AssetHost {
  readonly baseUrl: string;
  private fallback: AssetHost;
  /** 工作区用 getter 而非实例：挂载/断开都发生在宿主创建之后 */
  private workspaceOf: () => WorkspaceWriter | null;
  /** 相对路径 → objectURL（会话缓存；刷新后由 listAssets 从磁盘重建） */
  private objectUrls = new Map<string, string>();

  constructor(fallback: AssetHost, workspaceOf: () => WorkspaceWriter | null, baseUrl = '') {
    this.fallback = fallback;
    this.workspaceOf = workspaceOf;
    this.baseUrl = baseUrl;
  }

  /** 当前可用的工作区写入器（未挂载 → null） */
  private ws(): WorkspaceWriter | null {
    const w = this.workspaceOf();
    return w && w.mounted ? w : null;
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
    const items = await this.fallback.listAssets();
    const w = this.ws();
    if (!w) return items;
    // 磁盘资产并进来，并重建 objectURL（否则刷新后缩略图全裂）
    const disk: AssetItem[] = [];
    for (const f of await w.listAssetFiles()) {
      const cached = this.objectUrls.get(f.path);
      if (!cached) {
        const file = await w.readAssetFile(f.path);
        if (file) this.objectUrls.set(f.path, URL.createObjectURL(file));
      }
      disk.push({
        kind: kindOfFileName(f.name),
        id: f.path,
        name: f.name,
        type: (f.name.toLowerCase().split('.').pop() ?? 'bin').slice(0, 8),
      });
    }
    const byId = new Map(items.map((a) => [a.id, a]));
    for (const d of disk) byId.set(d.id, d);
    return [...byId.values()];
  }

  resolveAsset(item: Pick<AssetItem, 'id'>): string {
    const cached = this.objectUrls.get(item.id);
    if (cached) return cached;
    return this.fallback.resolveAsset(item);
  }

  async uploadAsset(file: File, kind?: 'img' | 'draw'): Promise<AssetItem> {
    const resolvedKind = kind ?? kindOfFileName(file.name);
    const w = this.ws();

    // 无工作区 或 该资产适合内联 → 走原宿主（IndexedDB + 小 SVG 内联源码）
    if (!w || !WorkspaceAssetHost.shouldPersistToDisk(file)) {
      const item = await this.fallback.uploadAsset(file, resolvedKind);
      // 必须 await：调用方（面板列表）紧接着就会读 item.svg 来渲染缩略图，
      // 若这里 fire-and-forget，读到的一定是 undefined。
      await this.cacheInline(item, file);
      return item;
    }

    const mime = mimeOfFileName(file.name, file.type);
    const relPath = await w.writeAsset(file.name, await file.arrayBuffer(), mime);
    // 会话内立刻可显示：直接用上传时的 File 建 objectURL（不必回读磁盘）
    const prev = this.objectUrls.get(relPath);
    if (prev) URL.revokeObjectURL(prev);
    this.objectUrls.set(relPath, URL.createObjectURL(file));
    return {
      kind: resolvedKind,
      id: relPath,
      name: file.name,
      type: (file.name.toLowerCase().split('.').pop() ?? 'bin').slice(0, 8),
    };
  }

  /** 小 SVG：记住内联源码，让「设为节点图标」能自包含写进 .mm.md */
  private async cacheInline(item: AssetItem, file: File): Promise<void> {
    if (item.kind !== 'draw' || file.size > INLINE_SVG_LIMIT) return;
    item.svg = await file.text();
  }

  hasAsset(item: Pick<AssetItem, 'kind' | 'id'>): boolean {
    if (this.objectUrls.has(item.id)) return true;
    return this.fallback.hasAsset(item);
  }
}
