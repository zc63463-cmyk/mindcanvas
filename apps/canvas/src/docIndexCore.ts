/**
 * 索引层的**纯函数与类型**（P0-D 契约面）。
 *
 * 契约：docs/specs/2026-09-19-file-assets-design/shared-contracts.md §4.7（条目形状与键）、
 * §6.2（迁移表 M4–M9 / M11）、§6.2.1（归属证据规则）。
 *
 * 为什么与 `docIndex.ts` 分开：单文件超 600 行会触发代码预算的 `bigFiles` 门禁；
 * 这里只放**不持有状态**的东西（键常量、条目类型、归一化、主键换算、归属证据判据），
 * 索引本体（`DocIndex`：读写 + 迁移 + 降级投影）在 `docIndex.ts`。
 *
 * 不是什么：不做 I/O、不持有索引状态、不展示内部结构。
 */
import { BROWSER_SCOPE_ID, LIBRARY_KEY, type ScopeId, type ScopeState } from '@mindcanvas/react';

// ============================================================ 键

/** 文档索引键（v2） */
export const DOC_INDEX_KEY = 'mindcanvas.docindex.v2';
/** 资产索引键（v2） */
export const ASSET_INDEX_KEY = 'mindcanvas.assetindex.v2';
/** 旧文档库键（M5 的来源，**只读不删**） */
export const LEGACY_LIBRARY_KEY = LIBRARY_KEY;
/** 旧文件收藏键（M6 的来源，键 = `fullPath`） */
export const LEGACY_STARRED_KEY = 'mindcanvas.starred.v1';
/** 旧资产收藏键（M7 的来源，键 = `kind:id`） */
export const LEGACY_ASSET_FAV_KEY = 'mindcanvas.assets.fav';
/** 自由画布最近键（M8 的来源，**不改写**） */
export const LEGACY_CANVAS_RECENT_KEY = 'mindcanvas.canvas.recent.v1';

/** source 快照的保留条数（与包侧 `SOURCE_KEEP` 同值；由 `DocLibrary.replaceAll` 执行） */
export const RECENT_MAX = 8;

/**
 * 浏览器主键的固定前缀（`browser::<docId>`）。
 * 单独导出：`projectLibrary` 要按它判断「这条属于浏览器作用域，没有旧库对应物」。
 */

// ============================================================ 类型（§4.7）

/** 文档索引条目。主键 `docKey`：`ws:<uuid>::研发/架构.mm.md` | `browser::<docId>` */
export interface DocIndexEntry {
  docKey: string;
  scopeId: ScopeId;
  relPath: string | null;
  lineageId: string;
  /** 文件名（末段） */
  name: string;
  /** 文档内部标题（首个 H1），与文件名分开 */
  title: string | null;
  /** 打开历史；**旧条目无真实打开时间时为 null，不回填 mtime**（UD-2） */
  openedAt: number | null;
  /** 最后成功落盘时间（仅展示，不参与「最近」排序） */
  savedAt: number;
  starred: boolean;
  sourceRef: { kind: 'disk-handle' | 'idb-handle' | 'none' };
  relinkEvidence?: { at: number; via: 'user-confirmed' };
  /** 作用域未持久化（disk-session）时写入的条目：下次会话其 scopeId 无效 */
  ephemeral?: true;
  /** 迁移来源键（只追加，不删除） */
  legacyKeys: string[];
}

/** 资产索引条目。主键：`browser:local::assets/a.png` | `<scopeId>::<relPath>` */
export interface AssetIndexEntry {
  assetKey: string;
  scopeId: ScopeId;
  relPath: string | null;
  name: string;
  starred: boolean;
  legacyKeys: string[];
}

/**
 * 历史池条目（§6.2.1）：旧键在当前状态下**没有归属证据**时的落点。
 * 用户语言呈现为「N 条旧记录未关联工作区」→ 展开 → 关联 / 忽略。
 * `kind` 只用于分组呈现，不参与归属判定。
 */
export interface HistoryPoolEntry {
  key: string;
  kind: 'library' | 'starred' | 'asset-fav' | 'handle';
  name: string;
  /** 无真实打开时间时为 null（不编造） */
  openedAt: number | null;
  savedAt: number;
  /**
   * 为什么没自动绑定。用户语言由 `formatHistoryReason` 给出（`FileManagerViews`
   * 的历史池行直接渲染），故这里的取值域必须与实际会产生的态一一对应：
   *   - `no-evidence`       本作用域无「同一目录」证据（含 legacy adoption 新 scope）
   *   - `no-existing-entry` 有证据，但索引里根本没有这条文档（旧库只有文件名，不构成归属）
   *   - `ephemeral-scope`   上次会话的 disk-session，scopeId 已失效
   *   - `no-scope` / `unavailable` 无法解析作用域 / 句柄库不可用
   */
  reason: 'no-scope' | 'no-evidence' | 'no-existing-entry' | 'ephemeral-scope' | 'unavailable';
  legacyKeys: string[];
}

/**
 * 迁移结果。**逐条 try/catch**：失败条目留在旧库、标「未迁移」，
 * 下次调用重新尝试（可中断续跑），而不是把整批标成完成。
 */
export interface MigrateResult {
  /** 本次新迁移（新建或补齐归属）的条目数 */
  migrated: number;
  /** 本次已在索引中且逐字一致（幂等：二次迁移不再改动） */
  unchanged: number;
  /** 本次因结构非法 / 不可用而**未迁移**：仍留在旧库 */
  failed: number;
  /** 迁移结束后历史池条目数 */
  historyPool: number;
}

/** 一次索引变更的结果：投影是否真的写成功（§6.3：写失败 → 该次变更不可回退） */
/** 打开/保存的输入（`docKey` 必填；其余按需覆盖） */
export interface DocInput {
  docKey: string;
  relPath?: string | null;
  name?: string;
  title?: string | null;
  scopeId?: ScopeId;
  sourceRef?: DocIndexEntry['sourceRef'];
}

/** 本模块可见的存储端口（生产 = localStorage；测试可注入故障） */
export interface IndexStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

// ============================================================ 值与键的纯函数

/** 类型谓词：`unknown` → 普通对象（与 docLibrary `isRecord` 同规） */
export function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** 读字符串字段：缺失/类型不符 → 兜底（**容忍缺失字段**） */
export function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

/** 读可空时间戳：`null` 与非法值都保持 `null`（**不回落 mtime**） */
function nullableTs(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** 读必填时间戳：非法 → 0（表示「未记录」，不编造当下） */
export function requiredTs(v: unknown): number {
  return nullableTs(v) ?? 0;
}

/** 字符串数组（丢弃非法元素，**保持顺序**） */
export function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
}

/** 只追加的去重（`legacyKeys` 纪律：不重排、不丢弃） */
export function appendUnique(list: string[], v: string): string[] {
  return list.includes(v) ? list : [...list, v];
}

// ============================================================ 认领的身份形态（DS-10）

/**
 * 旧库里的**两种认领形态**（DS-10 判据 (b') 的「双形态」）：
 *
 * - **明文形态**：旧库行的 `id` 本身就等于认领键。来源是本应用自己的改名/移动
 *   （`relocateEntries:80-83` 把旧 `docKey` 与旧 `relPath` **明文**追加进 `legacyKeys`）。
 * - **前缀形态**：认领键写成 `` `${库键}#${旧键}` ``。来源是 M5/M6 迁移
 *   （`docIndexMigrate.ts:180,246`：`legacyKeys: ['mindcanvas.library.v1#'+key]`）。
 *
 * 为什么必须两种都认（实读实证，不是防御性编码）：`projectStarred` 原先只做明文查找，
 * 于是「M5 迁入后取消收藏且从未改名」的旧键一律被**保守保留**——前缀形态永远不命中。
 * 两个形态是同一件事的两种写法，认领助手必须同时表达，否则两条迁移路径的语义会分叉。
 */
export type ClaimForm = { kind: 'plain'; value: string } | { kind: 'prefixed'; prefix: string; value: string };

/** 把「库键 + 旧键」的两种形态展平成一维待查列表（前缀形态在前，命中即短路） */
export function claimForms(prefix: string, value: string): string[] {
  return [`${prefix}#${value}`, value];
}

/**
 * 这个旧键是否被任一认证形态认领过？
 *
 * `legacyKeys` 是只追加的（`appendUnique` 纪律），故这里只做「包含」判定，
 * 不解释顺序、不做前缀解析——形态由调用方显式给出（见 `ClaimForm`）。
 */
export function isClaimed(legacyKeys: readonly string[], forms: readonly string[]): boolean {
  return forms.some((f) => legacyKeys.includes(f));
}

/** 一条旧库行是否**已被某索引条目认领**（双形态；`prefix` = 该行所属旧库的键） */
export function rowClaimed(
  docs: ReadonlyArray<{ legacyKeys: readonly string[] }>,
  prefix: string,
  rowKey: string,
): boolean {
  const forms = claimForms(prefix, rowKey);
  return docs.some((e) => isClaimed(e.legacyKeys, forms));
}

/**
 * 前缀形态的旧键还原成明文（`mindcanvas.library.v1#研发/架构.mm.md` → `研发/架构.mm.md`）。
 *
 * 只切**第一个** `#`：旧库键自身不含 `#`，而旧键（相对路径 / 文件名）可以含。
 * 不匹配前缀时返回 `null`（调用方据此知道这不是本库的认领键）。
 */
export function stripClaimPrefix(prefix: string, key: string): string | null {
  const head = `${prefix}#`;
  return key.startsWith(head) ? key.slice(head.length) : null;
}

/** 主键 → 显示名（末段文件名） */
export function nameOf(docKey: string): string {
  const idx = docKey.lastIndexOf('::');
  const tail = idx >= 0 ? docKey.slice(idx + 2) : docKey;
  const seg = tail.split('/');
  return seg[seg.length - 1] ?? tail;
}

/**
 * 工作区主键：`ws:<scopeId 主体>::<relPath>`（§4.7 的主键约定）。
 *
 * `browser:local` **不是**工作区身份：传进来一律回落到浏览器主键 `browser::<id>`，
 * 否则会造出 `ws:browser:local::a.mm.md` —— 一个既不是工作区键、也不是浏览器键的
 * 第三形态，同一份文档因此会有两条条目（实测：兼容模式的「最近」列表出现重复行）。
 */
export function wsDocKey(scopeId: ScopeId, relPath: string): string {
  if (scopeId === BROWSER_SCOPE_ID) return browserDocKey(relPath);
  const body = scopeId.startsWith('ws:') ? scopeId.slice(3) : scopeId;
  return `ws:${body}::${relPath}`;
}

/** 浏览器主键：`browser::<docId>` */
export function browserDocKey(docId: string): string {
  return `${BROWSER_SCOPE_ID}::${docId}`;
}

/** 主键 → `relPath`（无 `::` 分段时为 null） */
export function relPathOfKey(docKey: string): string | null {
  const idx = docKey.indexOf('::');
  if (idx < 0) return null;
  const tail = docKey.slice(idx + 2);
  return tail === '' ? null : tail;
}

/** 末段文件名（判定「同名命中」用，§6.2.1） */
export function fileNameOf(pathOrKey: string): string {
  const seg = pathOrKey.split('/');
  return seg[seg.length - 1] ?? pathOrKey;
}

/**
 * 索引条目的**宽容**归一化（与 `docLibrary.ts:52-84` 的 `isRecord`/`isEntry`/`normalize` 同规）：
 * - 缺字段 → 补默认，**不丢条目**（后向兼容）；
 * - 未知字段 → 原样保留（前向兼容：未来版本加的字段不能被本版本写坏）。
 *
 * 两条容易做错的地方：`openedAt` 缺失时**保持 `null`**（不从 `savedAt` 回填）；
 * `legacyKeys` 只追加、不重排。
 */
export function normalizeDocEntry(raw: unknown): DocIndexEntry | null {
  if (!isRecord(raw)) return null;
  const docKey = raw.docKey;
  if (typeof docKey !== 'string' || docKey === '') return null; // 无主键无法索引
  return {
    ...raw, // 未知字段原样保留
    docKey,
    scopeId: str(raw.scopeId, BROWSER_SCOPE_ID),
    relPath: typeof raw.relPath === 'string' ? raw.relPath : null,
    lineageId: str(raw.lineageId, docKey),
    name: str(raw.name, nameOf(docKey)),
    title: typeof raw.title === 'string' ? raw.title : null,
    openedAt: nullableTs(raw.openedAt),
    savedAt: requiredTs(raw.savedAt),
    starred: raw.starred === true,
    sourceRef: normalizeSourceRef(raw.sourceRef),
    legacyKeys: stringArray(raw.legacyKeys),
  };
}

/** 资产条目归一化（同规） */
export function normalizeAssetEntry(raw: unknown): AssetIndexEntry | null {
  if (!isRecord(raw)) return null;
  const assetKey = raw.assetKey;
  if (typeof assetKey !== 'string' || assetKey === '') return null;
  return {
    ...raw,
    assetKey,
    scopeId: str(raw.scopeId, BROWSER_SCOPE_ID),
    relPath: typeof raw.relPath === 'string' ? raw.relPath : null,
    name: str(raw.name, nameOf(assetKey)),
    starred: raw.starred === true,
    legacyKeys: stringArray(raw.legacyKeys),
  };
}

function normalizeSourceRef(v: unknown): DocIndexEntry['sourceRef'] {
  if (isRecord(v)) {
    const kind = v.kind;
    if (kind === 'disk-handle' || kind === 'idb-handle' || kind === 'none') return { kind };
  }
  return { kind: 'none' };
}

/** 当前条目的旧 id（投影回旧结构时用）：工作区用 `relPath`，浏览器用末段 */
export function legacyIdOf(e: DocIndexEntry): string {
  return e.relPath ?? nameOf(e.docKey);
}

/**
 * 「最近」的比较函数（**唯一排序规则**）：
 * 两条都有 `openedAt` → 降序；`null` 一律在末尾（彼此按 `savedAt` 降序）。
 * **不读 mtime**：`DocIndexEntry` 里根本没有 mtime 字段，这是刻意的（UD-2）。
 */
export function compareRecent(a: DocIndexEntry, b: DocIndexEntry): number {
  if (a.openedAt === null && b.openedAt === null) return b.savedAt - a.savedAt;
  if (a.openedAt === null) return 1;
  if (b.openedAt === null) return -1;
  return b.openedAt - a.openedAt;
}

/** 「最近」行的显示文案：`null` → 「未记录打开时间」（不是「刚刚」） */
export function formatRecentWhen(openedAt: number | null, now = Date.now()): string {
  if (openedAt === null) return '未记录打开时间';
  const diff = now - openedAt;
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`;
  return new Date(openedAt).toLocaleDateString('zh-CN');
}

/** 历史池的用户语言（文件面板底部）：用户不处理也不丢 */
export function formatHistoryPool(count: number): string {
  return `${count} 条旧记录未关联工作区`;
}

/** 历史池每一行为什么不能自动绑定（用户语言；`FileManagerViews` 的历史池行消费） */
export function formatHistoryReason(reason: HistoryPoolEntry['reason']): string {
  switch (reason) {
    case 'no-evidence':
      return '无法确认属于当前工作区';
    case 'no-existing-entry':
      return '当前工作区里找不到这份文档';
    case 'ephemeral-scope':
      return '上次临时打开的会话已结束';
    case 'unavailable':
      return '句柄库不可用';
    case 'no-scope':
      return '尚未打开任何工作区';
  }
}

// ============================================================ 归属证据（§6.2.1）

/** 迁移判定所需的最小上下文（测试可注入；生产由 `migrateContextOf` 组装） */
export interface MigrateContext {
  scopeId: ScopeId;
  /** 作用域是否持久（`disk-session` 写入的条目带 `ephemeral: true`） */
  persisted: boolean;
  /** 该作用域是否有历史归属证据 */
  hasHistoryEvidence: boolean;
  /** 若请求恢复旧句柄：IDB 是否可用（不可用 → 句柄条目不进索引） */
  handleStoreAvailable: boolean;
}

/**
 * M5/M6/M7 的**唯一归属判据**（NC-3 要中性化的就是这一个函数）。
 *
 * 返回 `true` 当且仅当：`relPath` 非空、作用域已持久、**且**该作用域有历史归属证据
 * （本次以 `isSameEntry` 建立，或用户显式确认）。
 *
 * 为什么「唯一同名命中」也要返回 false：旧键只是一个路径字符串，
 * 当前目录里恰好有一个同名文件**证明不了它当初就在这儿**（I-13）。
 * 用户随时可以走「关联到此工作区」显式动作——但那必须留下 `relinkEvidence`。
 */
export function hasOwnershipEvidence(ctx: MigrateContext, relPath: string | null): boolean {
  if (relPath === null || relPath === '') return false;
  if (!ctx.persisted) return false;
  return ctx.hasHistoryEvidence;
}

/** 用户确认关联（§6.2.1 的显式动作）：写入 `relinkEvidence`，此后视为证据充分 */
export function grantRelinkEvidence(at: number): { at: number; via: 'user-confirmed' } {
  return { at, via: 'user-confirmed' };
}

/** 注册表条目形状（只读消费 P0-0 的结果；不复制其类型定义） */
export interface RegistryEntryLike {
  scopeId: ScopeId;
  associations: ReadonlyArray<{ via: string }>;
}

/**
 * M11 衔接（**不重做**）：注册表的 legacy adoption 由 P0-0 完成。
 * 本函数只把「该作用域是否以 `isSameEntry`/用户确认建立」翻译成证据位——
 * P0-D 不解析目录身份，只消费 P0-0 的结果。
 *
 * 注意：legacy adoption 新生成的 `scopeId` 只有 `session-only` 记录 → 返回 `false`，
 * 于是 M5–M7 的旧键全部进历史池（§6.2.1 第二行）。
 */
export function evidenceFromRegistry(
  entries: ReadonlyArray<RegistryEntryLike>,
  scopeId: ScopeId,
): boolean {
  const hit = entries.find((e) => e.scopeId === scopeId);
  if (!hit) return false;
  return hit.associations.some((a) => a.via === 'isSameEntry' || a.via === 'user-confirmed');
}

/** 把 P0-0 的运行期身份（`ScopeState`）翻译成迁移上下文 */
export function migrateContextOf(
  scope: ScopeState,
  registry: ReadonlyArray<RegistryEntryLike>,
  handleStoreAvailable: boolean,
): MigrateContext {
  if (scope.kind === 'browser') {
    return {
      scopeId: BROWSER_SCOPE_ID,
      persisted: true,
      // 浏览器素材库作用域唯一，不存在「猜归属」问题（M7 明文可直迁）
      hasHistoryEvidence: true,
      handleStoreAvailable,
    };
  }
  const persisted = scope.kind === 'disk';
  return {
    scopeId: scope.scopeId,
    persisted,
    hasHistoryEvidence: persisted && evidenceFromRegistry(registry, scope.scopeId),
    handleStoreAvailable,
  };
}

/**
 * 收藏键集合：把索引条目的**多个别名**都暴露给 UI。
 *
 * 为什么一个条目要贡献三个键：投影会把 `relPath` 写进旧键（`starred.v1`），
 * 于是「索引侧的身份」与「旧键读取方看到的字符串」必须能互相认出对方，
 * 否则同一份收藏在两侧显示不一致。
 */
export function collectStarredKeys(
  docs: ReadonlyArray<DocIndexEntry>,
  assets: ReadonlyArray<AssetIndexEntry>,
): Set<string> {
  const out = new Set<string>();
  for (const e of docs) {
    if (!e.starred) continue;
    out.add(e.docKey);
    if (e.relPath !== null) out.add(e.relPath);
    for (const k of e.legacyKeys) out.add(k);
  }
  for (const a of assets) {
    if (!a.starred) continue;
    out.add(a.assetKey);
    if (a.relPath !== null) out.add(a.relPath);
  }
  return out;
}
