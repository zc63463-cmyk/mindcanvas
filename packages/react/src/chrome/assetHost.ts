/**
 * 资产宿主契约（P0 资产来源宿主化）：图库清单/解析/上传/存在性判定全部走宿主注入。
 * 每导图一个资产空间：资产 id 为「导图相对路径」（如 demo-assets/x.svg），
 * 渲染层经 host.resolveAsset 拼成可加载 URL；上传持久化由宿主实现（真实 FS/HTTP 属宿主职责）。
 * 当前实现：DemoAssetHost（打包 demo 资产 + objectURL 会话级上传——浏览器沙箱无法落盘，持久化留给真实宿主）。
 */
import type { AssetItem } from './assetTypes.js';
import { INLINE_SVG_LIMIT } from './assetIcons.js';

/** 文件扩展名 → 资产 kind（未知 → img） */
export function kindOfFileName(name: string): 'img' | 'draw' {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return ext === 'svg' ? 'draw' : 'img';
}

/** 图片扩展名 → MIME（N-6 兜底依据 + IdbAssetHost 构造 Blob 用，单一事实源） */
export const IMAGE_EXT_MIME: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
};

/** 是否图片文件：file.type 可能为空（Windows 部分注册表状态/未知来源拖拽），扩展名兜底判定 */
export function isImageFileName(name: string): boolean {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return ext in IMAGE_EXT_MIME;
}

/** 文件 MIME：file.type 优先，扩展名兜底，最终 octet-stream（保证 Blob 可构造可加载） */
export function mimeOfFileName(name: string, fileType: string): string {
  if (fileType) return fileType;
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return IMAGE_EXT_MIME[ext] ?? 'application/octet-stream';
}

export interface AssetHost {
  /** 图库资产清单（宿主可异步：HTTP/FS 目录扫描） */
  listAssets(): Promise<AssetItem[]>;
  /** 资产 → 可加载 URL（相对导图根路径 → 平台 URL / objectURL）；
   *  参数只依赖 id（Pick 收窄）：渲染层可直接传 EntityRef 适配（P0-1 渲染接线） */
  resolveAsset(item: Pick<AssetItem, 'id'>): string;
  /** 上传资产（拖拽/粘贴文件 → 图库）；返回新资产项 */
  uploadAsset(file: File, kind?: 'img' | 'draw'): Promise<AssetItem>;
  /** 资产存在性（同步判定：demo host 查清单；HTTP 宿主可先返回 true 由渲染层兜底） */
  hasAsset(item: Pick<AssetItem, 'kind' | 'id'>): boolean;
  /** 资产 base URL（透传给渲染层 assetBaseUrl） */
  baseUrl: string;
}

/**
 * 会话级 demo 宿主：打包清单 + objectURL 上传（不落盘；真实持久化 = 换宿主实现）。
 *
 * 与 `IdbAssetHost` 的差异只在持久化介质：两者对「小 SVG 留一份源码」的处理一致，
 * 否则换宿主会让「设为节点图标」的内联能力凭空消失。
 */
export class DemoAssetHost implements AssetHost {
  readonly baseUrl: string;
  private items: AssetItem[];
  /** 上传资产 id → objectURL（会话有效；刷新即失效，文档标注） */
  private objectUrls = new Map<string, string>();

  constructor(items: AssetItem[], baseUrl = '/') {
    this.items = [...items];
    this.baseUrl = baseUrl;
  }

  async listAssets(): Promise<AssetItem[]> {
    return [...this.items];
  }

  resolveAsset(item: Pick<AssetItem, 'kind' | 'id'>): string {
    const blob = this.objectUrls.get(item.id);
    if (blob) return blob;
    return this.baseUrl + item.id;
  }

  async uploadAsset(file: File, kind?: 'img' | 'draw'): Promise<AssetItem> {
    const item: AssetItem = {
      kind: kind ?? kindOfFileName(file.name),
      id: `assets/${file.name}`,
      name: file.name,
      type: (file.name.toLowerCase().split('.').pop() ?? 'bin').slice(0, 8),
    };
    // FA1-T5：小 SVG 留一份源码（与 IdbAssetHost 同口径，换宿主不丢内联能力）
    if (item.kind === 'draw' && file.size <= INLINE_SVG_LIMIT) {
      item.svg = await file.text();
    }
    // 替换语义：同 id 覆盖旧 objectURL（revoke 防泄漏）+ 清单去重（原实现会 push 重复项）
    const prevUrl = this.objectUrls.get(item.id);
    if (prevUrl) URL.revokeObjectURL(prevUrl);
    this.objectUrls.set(item.id, URL.createObjectURL(file));
    this.items = [...this.items.filter((a) => a.id !== item.id), item];
    return item;
  }

  hasAsset(item: Pick<AssetItem, 'kind' | 'id'>): boolean {
    return this.items.some((a) => a.kind === item.kind && a.id === item.id);
  }
}
