/**
 * 资产宿主契约（P0 资产来源宿主化）：图库清单/解析/上传/存在性判定全部走宿主注入。
 * 每导图一个资产空间：资产 id 为「导图相对路径」（如 demo-assets/x.svg），
 * 渲染层经 host.resolveAsset 拼成可加载 URL；上传持久化由宿主实现（真实 FS/HTTP 属宿主职责）。
 * 当前实现：DemoAssetHost（打包 demo 资产 + objectURL 会话级上传——浏览器沙箱无法落盘，持久化留给真实宿主）。
 */
import type { AssetItem, AssetStore } from './assetTypes.js';
import type { FileOpError } from '../edit/fileOps.js';
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

// ================================================================ P0-B：同名策略（契约 §4.5.2）

/**
 * 同名冲突时用户的选择（契约 §4.5.2 的三选）。
 *
 * **首期不做去重**：同名一律进冲突三选，默认焦点 `keep-both`。
 * 「同内容跳过」只有一种合法情形——本会话内已完整读取旧文件字节并与新字节逐字节相同，
 * 且调用方显式给出 `bytesEqual` 依据；**`size` + `mtime` 不构成该依据**（CE-03）。
 */
export type AssetConflictChoice = 'keep-both' | 'replace' | 'cancel';

/** 三选的默认焦点：安全侧（不覆盖、不影响既有引用） */
export const DEFAULT_ASSET_CONFLICT_CHOICE: AssetConflictChoice = 'keep-both';

/** 冲突三选的动作顺序（UI 渲染次序的唯一事实源；Record 键序不可依赖） */
export const ASSET_CONFLICT_ORDER = ['keep-both', 'replace', 'cancel'] as const;

/** 三选的用户可见文案（`acceptance-and-backlog.md` §4.5.2 原文） */
export const ASSET_CONFLICT_LABEL: Record<AssetConflictChoice, string> = {
  'keep-both': '保留两份',
  replace: '显式替换',
  cancel: '取消',
};

/**
 * 同名冲突描述（供冲突面板渲染）。
 *
 * `refCount` 是**已知**引用处数，不是「全部引用处」——它来自当前可得的引用扫描，
 * 因此面板必须写明覆盖范围（I-6），不得把它呈现成「没有其他地方引用」。
 */
export interface AssetConflict {
  name: string;
  /** 已存在文件的字节数（未知 → null；**不参与**「同内容」判定） */
  existingBytes: number | null;
  /** 新文件字节数 */
  incomingBytes: number;
  /** 已知引用处数（覆盖范围见 `refCoverage`） */
  refCount: number | null;
  /** 该 `refCount` 的覆盖范围（P0-B 只做 `current-doc` / `unknown`；完整扫描在 P1-B） */
  refCoverage: 'current-doc' | 'unknown';
}

/**
 * 「保留两份」的目标名：`diagram.png` → `diagram 2.png`。
 *
 * **与文档副本命名（`fileOps.uniqueCopyName`）分开**：那条路径为 `.mm.md`/`.md`
 * 处理复合扩展名（`架构.mm.md` → `架构 2.mm.md`），资产是普通单扩展名，
 * 且命名冲突的语义面不同（资产不去冲突就静默不写；文档新建仍静默加序号）。
 */
export function copyNameFor(name: string, index: number): string {
  if (index <= 1) return name;
  const dot = name.lastIndexOf('.');
  if (dot > 0) return `${name.slice(0, dot)} ${index}${name.slice(dot)}`;
  return `${name} ${index}`;
}

/**
 * 找一个未被占用的「保留两份」名字。
 *
 * @param taken 已占用探测（生产传 `hasAsset`；测试传集合）。**必须实际探测**——
 *              不能靠「目录里只有一个同名」推断，因为不可读目录会让探测失败。
 */
export async function uniqueAssetName(
  name: string,
  taken: (candidate: string) => Promise<boolean> | boolean,
  max = 1000,
): Promise<string> {
  for (let i = 2; i < max; i++) {
    const candidate = copyNameFor(name, i);
    if (!(await taken(candidate))) return candidate;
  }
  return copyNameFor(name, max);
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

// ================================================================ P0-B：三态、作用域与可携带性

/**
 * 资产落点（契约 §4.5.1）。回答「它写到了哪」——**不回答**「多可靠 / 能不能带走」（I-12）。
 *
 * 定义在 `assetTypes.ts`（`AssetItem.origin` 要用它，而本模块要用 `AssetItem` ——
 * 就地定义会成环）。这里再导出，既有调用方的导入路径与语义都不变。
 */
export type { AssetStore } from './assetTypes.js';

/**
 * 可携带性（契约 §4.5.1、I-12）：由 `store` 决定，**不由本次写入成功决定**。
 *
 * 三者**不可互相冒充**：`browser-local` 永远不得被说成「换机器还在」；
 * 只有 `folder-relative`（且用户确实把整个文件夹拷走）与 `self-contained` 才可携带。
 */
export type AssetPortability = 'folder-relative' | 'browser-local' | 'self-contained';

/** `store` → `portability` 的唯一映射（禁止各处手写，避免同一 store 出现两种说法） */
export function portabilityOfStore(store: AssetStore): AssetPortability {
  if (store === 'workspace-assets') return 'folder-relative';
  if (store === 'browser-idb') return 'browser-local';
  return 'self-contained';
}

/**
 * 资产在库内的稳定键（勘误 E-3 / §4.7.1）= 收藏键去掉 `kind:` 前缀之后的整体。
 * 三种形态：`assets/<rel>` / `builtin:<id>` / data URL。**不含作用域**——
 * 作用域由 `scopeId` 单独携带，两者合成才是索引层主键。
 */
export function assetKeyOf(item: Pick<AssetItem, 'id'>): string {
  return item.id;
}

/** 资产收藏键（`mindcanvas.assets.fav` 的元素形状；勘误 E-2：kind ∈ {'img','draw'}） */
export function assetFavKey(kind: 'img' | 'draw', assetKey: string): string {
  return `${kind}:${assetKey}`;
}

/**
 * 存储来源（`AssetItem.origin`）的单点推断（P0-FIX-R1 R1-1）。
 *
 * **只在没标 origin 时用**：标了就以标的为准。为什么不一律按 id 猜——同一字符串
 * `assets/a.png` 既可能是磁盘上的文件，也可能是浏览器素材库里的上传项，**从 id 推不出来**。
 *
 * 推断规则限定在**确实由 id 决定**的两种形态：
 *  - `builtin:` 前缀 / `source === 'builtin'` → `builtin`（自包含，I-5）；
 *  - `assets/<rel>` 形态 → `workspace-assets`（I-4 的磁盘引用形态）。
 *
 * 其余（裸名、宿主自定义前缀）返回 `null` —— **不猜**。解析层拿到 `null` 时退回
 * 「先本宿主、再 fallback」的旧路径，与升级前行为一致（可选面的兼容纪律）。
 */
export function originOfItem(item: Pick<AssetItem, 'id' | 'source' | 'origin'>): AssetStore | null {
  if (item.origin !== undefined) return item.origin;
  if (item.source === 'builtin' || item.id.startsWith('builtin:')) return 'builtin';
  if (isWorkspaceAssetRef(item.id)) return 'workspace-assets';
  return null;
}

/**
 * 清单**条目键**：复合键 = `origin + id`（P0-FIX-R1 R1-1）。
 *
 * 为什么不能用 `id` 单键：挂载工作区后，「浏览器素材库的 `assets/a.png`（蓝）」与
 * 「磁盘的 `assets/a.png`（红）」必须**同时**在清单里、都能被点选——用 id 去重必然
 * 让其中一个消失（旧实现是磁盘项顶替浏览器项，这正是 N1-ID-COLLISION 的第一跳）。
 *
 * 同一 id 但不同 origin 的两项因此得到两个不同的键；卡片 `key` 与清单去重共用它。
 * `origin` 缺失（旧宿主/测试替身）时退化为纯 id —— 行为与升级前一致。
 */
export function assetEntryKey(item: Pick<AssetItem, 'id' | 'source' | 'origin'>): string {
  const origin = originOfItem(item);
  if (origin === null) return item.id;
  return `${origin}\u0000${item.id}`;
}

/**
 * 本地持久性（契约 §1.7 的第二个维度）。
 *
 * 与 `AssetPortability` 分开的理由：`browser-idb` **本机持久**但**不可携带** ——
 * 初版把两者混成一个 `persisted` 字段，直接诱导出「`persisted` = 换机器还在」的错误陈述。
 */
export type AssetDurability = 'filesystem' | 'browser-storage' | 'session-only';

export function durabilityOfStore(store: AssetStore | null): AssetDurability {
  if (store === 'workspace-assets') return 'filesystem';
  if (store === 'browser-idb') return 'browser-storage';
  return 'session-only';
}

/** 会话级降级原因（契约 §4.5.1 的 `AssetWriteResult.session-only.reason` 取值域） */
export type AssetSessionReason = 'idb-failed' | 'fs-unavailable' | 'no-workspace' | 'declined';

/**
 * 上传结果（契约 §4.5.1）：**三态可判别**（R-08）。
 *
 * 此前 IDB 写失败被 `catch` 后仍返回同一个 `AssetItem`（`idbAssetHost.ts:146-150`），
 * 上层无从区分「写进了磁盘」「只在内存里」「彻底失败」——UI 因此必然把
 * 「显示成功」当成「保存成功」。三态是这条的**结构性**修法，不靠调用方猜。
 */
export type AssetWriteResult =
  /** 本次写入成功。`store`/`bytes` 是事实；**不**等于可携带（I-12） */
  | { kind: 'written'; item: AssetItem; store: AssetStore; refId: string; bytes: number | null }
  /** 仅本次会话可用：objectURL 在，但没有写入任何持久存储 */
  | { kind: 'session-only'; item: AssetItem; reason: AssetSessionReason }
  /** 失败（含用户取消：`code: 'E-ABORT'`） */
  | { kind: 'failed'; error: FileOpError };

/**
 * 显式解析状态（契约 §4.5.1）。**五态 `unresolved` 理由必须分开**（I-11）：
 * 把 `no-scope`（没打开工作区）与 `missing`（工作区里没这个文件）混为一谈，
 * 会让用户去「重新定位」一个其实完好的引用。
 */
export type AssetResolution =
  | { kind: 'resolved'; url: string }
  | { kind: 'pending'; reason: 'scope-loading' | 'listing' }
  | {
      kind: 'unresolved';
      reason: 'no-scope' | 'missing' | 'wrong-scope' | 'external' | 'unavailable';
    };

/**
 * 作用域标记（契约 §6.2 的 `Scoped<T>`）。
 *
 * `epoch` 是**会话代**：挂载 / 断开 / `scopeId` 变化时 +1。
 * 所有异步结果都必须携带**计算时**的作用域——上传尤其要在**写入前**捕获，
 * 因为 `epoch` 可能在写入过程中变化（§4.5.4 的 `unconfirmed` 就是这么来的）。
 */
export interface AssetScopeMark {
  scopeKey: string;
  epoch: number;
}

/**
 * 无工作区时的唯一作用域（浏览器素材库）。与 P0-D 索引层的 `browser:local` 同口径
 * —— 在这里集中定义，避免两个宿主各写一份字符串。
 */
export const BROWSER_SCOPE_KEY = 'browser:local';

/** 无工作区时 IdbAssetHost 的作用域标记（`epoch` 由调用方覆盖） */
export function browserScopeMark(epoch = 0): AssetScopeMark {
  return { scopeKey: BROWSER_SCOPE_KEY, epoch };
}

/** 作用域标记 → 缓存键前缀（`objectUrls` 的键 = 该前缀 + 资产路径，R-07 的修法） */
export function cacheKeyOf(mark: AssetScopeMark, id: string): string {
  return `${mark.scopeKey}::${id}`;
}

/**
 * 外部引用判定（契约 §1.5.1 的解析规则表）：`http(s):`、`//`、`../` 等
 * **不属于任何工作区作用域**，也不算「缺失」（不产生 `W-ASSET-MISSING`）。
 */
export function isExternalRef(id: string): boolean {
  const lower = id.toLowerCase();
  return (
    lower.startsWith('http:') ||
    lower.startsWith('https:') ||
    lower.startsWith('//') ||
    lower.startsWith('../') ||
    lower.startsWith('./')
  );
}

/** 自包含引用（I-5）：`builtin:<id>` 与 data URL **不属于任何作用域** */
export function isSelfContainedRef(id: string): boolean {
  return id.startsWith('builtin:') || id.startsWith('data:');
}

/**
 * 磁盘资产引用：`assets/<rel>`（相对**工作区根**，I-4）。
 * 其余形态（自包含 / 外部 / 其他）都不是磁盘资产。
 */
export function isWorkspaceAssetRef(id: string): boolean {
  return id.startsWith('assets/') && !isSelfContainedRef(id) && !isExternalRef(id);
}

/**
 * P0-B 增量宿主面（契约 §4.5.1 的 `AssetHostV2`）。
 *
 * **不改 `AssetHost` 既有方法签名**：全部是可选增量方法，缺省时调用方退回原契约
 * （`resolveAsset` 的字符串形态 / `uploadAsset` 的 `AssetItem` 形态）——这样
 * 「未升级的宿主」与「已升级的宿主」能共存，且既有调用方零改动。
 */
export interface AssetHostV2 extends AssetHost {
  /** 与 `uploadAsset` 同实现但结果可判别；`uploadAsset` 保留为薄包装（返回 `.item`） */
  uploadAssetDetailed?(file: File, kind?: 'img' | 'draw'): Promise<AssetWriteResult>;
  /** 显式解析状态；缺省时渲染层退回 `resolveAsset` 的字符串契约 */
  resolveAssetState?(item: Pick<AssetItem, 'kind' | 'id' | 'origin'>): AssetResolution;
  /** 作用域标记；用于把跨工作区串图变成可诊断事实 */
  scopeMark?(): AssetScopeMark;
  /**
   * 写后预热（P0-FIX-R1 R1-2，契约 §4.9 的「归一化后立刻可解析」）。
   *
   * **要解决的问题**：归一化把字节直接写进 `<workspace>/assets/`（`assetInsert.writeNormalized`
   * 走的是 `WorkspaceWriter`，不是本宿主的 `writeToDisk`），于是宿主**不知道**刚多了一个文件，
   * scope 缓存的 URL 也没登记。同一会话内新引用因此解析不到（渲染端 miss → 断图），
   * 而重开后反而正常（挂载期 `listAssets` 会把磁盘字节预热进缓存）—— 差异全在这里。
   *
   * 实现约定（`WorkspaceAssetHost`）：
   *  - 读盘 `w.readAssetFile(relPath)` → `urls.set(cacheKeyOf(scopeMark(), relPath), objectURL)`；
   *  - **幂等**：`ScopedObjectUrls.set` 自带旧值 revoke，重复调用不会泄漏；
   *  - 无工作区 / 读失败 → 返回 `false`，**不得**把已成功的插入改判 `refused`
   *    （磁盘事实成立，降级为 best-effort，与 P0-B 同口径）。
   *
   * **只在写后调用**：渲染路径**不得**碰它（否则每次渲染都触发 I/O）。
   */
  primeWorkspaceAsset?(relPath: string): Promise<boolean>;
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
      // R1-1：上传落本宿主的内存/IDB 面 → 读侧来源即 `browser-idb`
      origin: 'browser-idb',
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
