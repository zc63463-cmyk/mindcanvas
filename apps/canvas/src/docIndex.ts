/**
 * 索引层（P0-D）：**唯一索引写入口**。
 *
 * 契约：docs/specs/2026-09-19-file-assets-design/shared-contracts.md §4.7（条目形状与键）、
 * §6.2（迁移表 M4–M9 / M11）、§6.2.1（归属证据规则）、§6.3（降级投影）。
 *
 * 解决的问题：收藏按 `fullPath` 存（改名即丢）、「最近」混用 mtime 与访问时间（违反 UD-2）、
 * 无法表达血统、无归属证据规则、「删掉新键即回退」的说法不成立。
 *
 * 不是什么：
 * - 不做文件操作（改名/移动/删除属 P0-A）；不改 `.mm.md` / `.mc.canvas.json` 格式；
 * - **不删除任何旧键**（DS-10 由主控决定）——迁移只追加，旧键保留为「用户不处理也不丢」的兜底；
 * - 不向用户展示索引内部结构：历史池的用户语言由 FileManager 底部承担。
 *
 * 三条容易做错的纪律，实现里逐条对上：
 * ① **`openedAt` 只由真实打开推进，`savedAt` 不参与「最近」排序**；`openedAt === null` 排末尾
 *    且显示「未记录打开时间」——**绝不回落 mtime**（UD-2）；
 * ② **唯一同名命中 ≠ 归属证据**（§6.2.1）：无历史证据的作用域下旧键只进历史池；
 * ③ **降级投影必须让旧结构真读到新数据**（§6.3 / I-21）：不能以「旧键还在」冒充回退。
 */
import {
  BROWSER_SCOPE_ID,
  DocLibrary,
  LIBRARY_KEY,
  type FsFileHandle,
  type ScopeId,
  type ScopeState,
  getFileHandle,
  setFileHandle,
} from '@mindcanvas/react';

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
  /** 为什么没自动绑定（用户语言在 UI 层再包一层） */
  reason: 'no-scope' | 'no-evidence' | 'ephemeral-scope' | 'unavailable';
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
export interface IndexChangeResult {
  /** 本次变更涉及的条目（无命中时为空数组） */
  entries: DocIndexEntry[];
  /** 索引键是否写成功 */
  written: boolean;
  /** 降级投影是否全部写出成功；false = 本次变更**不可回退**（可重试） */
  projected: boolean;
}

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
function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** 读字符串字段：缺失/类型不符 → 兜底（**容忍缺失字段**） */
function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

/** 读可空时间戳：`null` 与非法值都保持 `null`（**不回落 mtime**） */
function nullableTs(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** 读必填时间戳：非法 → 0（表示「未记录」，不编造当下） */
function requiredTs(v: unknown): number {
  return nullableTs(v) ?? 0;
}

/** 字符串数组（丢弃非法元素，**保持顺序**） */
function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
}

/** 只追加的去重（`legacyKeys` 纪律：不重排、不丢弃） */
function appendUnique(list: string[], v: string): string[] {
  return list.includes(v) ? list : [...list, v];
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

// ============================================================ 索引本体

function defaultStore(): IndexStore {
  return {
    get: (key) => localStorage.getItem(key),
    set: (key, value) => localStorage.setItem(key, value),
  };
}

/**
 * 文档索引。**唯一写入口**：`openDoc`/`saveDoc`/`setStarred`/`registerDoc`/`migrate`/`relink`
 * 是全部写路径；投影写入也在这里，没有「直接写 localStorage」的第二条路。
 */
export class DocIndex {
  private docs: DocIndexEntry[] = [];
  private assets: AssetIndexEntry[] = [];
  /** 历史池：不写盘，由 `migrate` 依旧键重算（旧键原样保留 = 用户不处理也不丢） */
  private history: HistoryPoolEntry[] = [];
  private readonly store: IndexStore;
  private readonly nowMs: () => number;
  private readonly makeLineageId: () => string;
  private readonly ctxOf: () => MigrateContext;
  /** 本次会话内是否已发生新写入（R-A / R-B 的分界依据，§6.3） */
  private wrote = false;
  /** 最近一次投影写入失败（§6.3：该次变更不可回退，必须可查） */
  private projectionFailed = false;
  /** 已证明存在、且句柄可取的旧 `docId`（M9 双写的写侧输入） */
  private handleIds = new Set<string>();
  /**
   * 惰性迁移进度：旧键 → **已处理过的条目标识集合**（随索引一起写盘）。
   *
   * 为什么是**标识集合**而不是下标（实测踩过）：投影会调用
   * `DocLibrary.replaceAll`，它按 `ts` 降序把旧库数组**重排**。若进度用下标，
   * 第二次 `migrate` 读到的数组顺序已经变了，同一个下标指向的是**另一条**记录——
   * 表现为「批量推进了两格，实际只迁移了一条，另一条被跳过」。
   * 用标识（`id` / 收藏键）就没有这个问题：顺序无关。
   *
   * 进度集合只是**批处理节流**，不是「已迁移」的判定：幂等由 `docKey` upsert 负责，
   * 进度丢失最多重跑一遍（不产生重复条目）。
   */
  private cursors: Record<string, string[]> = {};

  constructor(opts?: {
    store?: IndexStore;
    now?: () => number;
    makeLineageId?: () => string;
    ctx?: () => MigrateContext;
  }) {
    this.store = opts?.store ?? defaultStore();
    this.nowMs = opts?.now ?? (() => Date.now());
    this.makeLineageId = opts?.makeLineageId ?? defaultLineageId;
    this.ctxOf =
      opts?.ctx ??
      (() => ({
        scopeId: BROWSER_SCOPE_ID,
        persisted: true,
        hasHistoryEvidence: false,
        handleStoreAvailable: typeof indexedDB !== 'undefined',
      }));
    this.reload();
  }

  // ---------------------------------------------------------------- 读

  /** 全部文档条目（原始顺序；排序只在视图层按 `compareRecent` 做） */
  listDocs(): DocIndexEntry[] {
    return this.docs;
  }

  listAssets(): AssetIndexEntry[] {
    return this.assets;
  }

  getDoc(docKey: string): DocIndexEntry | undefined {
    return this.docs.find((e) => e.docKey === docKey);
  }

  /**
   * **「最近」的唯一入口**（§4.7）：按 `openedAt` 降序，`null` 排末尾，
   * **绝不回落 mtime**（UD-2）。上限由调用方给（文件面板用 `RECENT_MAX`）。
   */
  recentDocs(limit = Number.POSITIVE_INFINITY): DocIndexEntry[] {
    return [...this.docs].sort(compareRecent).slice(0, limit);
  }

  /** 收藏（稳定身份 = `docKey`；路径变化不影响，P0-A 改路径后仍连续） */
  starredDocs(): DocIndexEntry[] {
    return this.docs.filter((e) => e.starred);
  }

  /**
   * 收藏键集合：UI 用 `docKey` **或** `relPath` **或** 旧式 `fullPath` 判定星标。
   * 三个别名都进集合是刻意的：投影把 `relPath` 写进旧键之后，
   * 两侧（索引与旧键读取方）必须能互相识别。
   */
  starredKeys(): Set<string> {
    const out = new Set<string>();
    for (const e of this.docs) {
      if (!e.starred) continue;
      out.add(e.docKey);
      if (e.relPath !== null) out.add(e.relPath);
      for (const k of e.legacyKeys) out.add(k);
    }
    for (const a of this.assets) {
      if (!a.starred) continue;
      out.add(a.assetKey);
      if (a.relPath !== null) out.add(a.relPath);
    }
    return out;
  }

  /** 历史池（§6.2.1）：由最近一次 `migrate` 重算 */
  historyPool(): HistoryPoolEntry[] {
    return this.history;
  }

  /**
   * 降级投影的可查状态（回执 / 验证用，不面向用户）：
   * - `wroteNewData`：本会话是否已产生新写入（true = 回退属 R-B，必须靠投影才不丢）
   * - `projectionFailed`：最近一次投影是否写失败（该次变更**不可回退**）
   */
  projectionStatus(): { wroteNewData: boolean; projectionFailed: boolean } {
    return { wroteNewData: this.wrote, projectionFailed: this.projectionFailed };
  }

  // ---------------------------------------------------------------- 写

  /**
   * 文档**被打开**：推进 `openedAt`（`savedAt` 不动——打开不是保存）。
   * 作用域未持久 → 条目带 `ephemeral: true`。
   */
  openDoc(input: DocInput, at = this.nowMs()): IndexChangeResult {
    const relPath = input.relPath === undefined ? relPathOfKey(input.docKey) : input.relPath;
    return this.mutate((prev) => {
      const base = prev ?? this.freshEntry(input.docKey, relPath, input, at);
      return this.ephemeralized({
        ...base,
        openedAt: at,
        savedAt: prev?.savedAt ?? base.savedAt,
        name: input.name ?? base.name,
        title: input.title === undefined ? base.title : input.title,
        relPath,
        scopeId: input.scopeId ?? base.scopeId,
        sourceRef: input.sourceRef ?? base.sourceRef,
      });
    }, input.docKey);
  }

  /**
   * 文档**成功落盘**：推进 `savedAt`（仅展示），**不触碰 `openedAt`**。
   *
   * 这是 UD-2 的另一半：保存不改变「最近」的次序——否则每次 Ctrl+S 都会把文档
   * 顶到「最近」顶部，「最近修改」冒充「最近打开」。
   */
  saveDoc(input: DocInput, at = this.nowMs()): IndexChangeResult {
    const relPath = input.relPath === undefined ? relPathOfKey(input.docKey) : input.relPath;
    return this.mutate((prev) => {
      const base = prev ?? this.freshEntry(input.docKey, relPath, input, at);
      return this.ephemeralized({
        ...base,
        openedAt: prev?.openedAt ?? base.openedAt, // 不推进打开时间
        savedAt: at,
        name: input.name ?? base.name,
        title: input.title === undefined ? base.title : input.title,
        relPath,
        scopeId: input.scopeId ?? base.scopeId,
        sourceRef: input.sourceRef ?? base.sourceRef,
      });
    }, input.docKey);
  }

  /**
   * 用**当前作用域**登记一个真实存在的文档（工作区打开/保存 / 兼容模式保存时调用）。
   * 作用域未持久（disk-session）→ 条目带 `ephemeral: true`（下次会话 scopeId 无效）。
   *
   * 时间语义：`openedAt` 取 `openedAt` 入参（仅在调用方确实打开了它时给），
   * `savedAt` 取 `savedAt` 入参；两者缺省都不推进。
   */
  registerDoc(input: {
    docKey: string;
    relPath: string | null;
    name: string;
    scopeId: ScopeId;
    persisted: boolean;
    sourceRef: DocIndexEntry['sourceRef'];
    /** 传入即推进打开时间（真实打开）；缺省保持原值 */
    openedAt?: number;
    /** 传入即推进保存时间（真实落盘）；缺省保持原值 */
    savedAt?: number;
    /** 能取到裸句柄的旧 docId（M9 双写的写侧输入） */
    handleId?: string;
  }): IndexChangeResult {
    if (input.handleId !== undefined) this.handleIds.add(input.handleId);
    return this.mutate((prev) => {
      const base = prev ?? this.freshEntry(input.docKey, input.relPath, input, this.nowMs());
      const next: DocIndexEntry = {
        ...base,
        scopeId: input.scopeId,
        relPath: input.relPath,
        name: input.name,
        sourceRef: input.sourceRef,
        openedAt: input.openedAt ?? base.openedAt,
        savedAt: input.savedAt ?? base.savedAt,
      };
      return input.persisted ? stripEphemeral(next) : { ...next, ephemeral: true as const };
    }, input.docKey);
  }

  /** 收藏/取消收藏（按**稳定身份** `docKey`；`relPath` 变了收藏不丢） */
  setStarred(docKey: string, starred: boolean, at = this.nowMs()): IndexChangeResult {
    return this.mutate((prev) => {
      if (!prev) {
        const created = this.freshEntry(docKey, relPathOfKey(docKey), { docKey }, at);
        return { ...created, starred };
      }
      return { ...prev, starred };
    }, docKey);
  }

  /**
   * 收藏的**路径别名**入口（供文件面板按行主键切换收藏）：
   * 先按 `docKey` 找，再按 `relPath` 找（旧键通过 `legacyKeys` 命中），
   * 都没命中 → 以该键为 `relPath` 建新条目（浏览器模式无工作区时的常见情形）。
   */
  setStarredByPath(pathKey: string, starred: boolean, at = this.nowMs()): IndexChangeResult {
    const hit =
      this.getDoc(pathKey) ??
      this.docs.find((e) => e.relPath === pathKey) ??
      this.docs.find((e) => e.legacyKeys.includes(pathKey));
    if (hit) return this.setStarred(hit.docKey, starred, at);
    const docKey = pathKey.includes('::') ? pathKey : browserDocKey(pathKey);
    const created = this.mutate((prev) => {
      const base = prev ?? this.freshEntry(docKey, relPathOfKey(docKey) ?? pathKey, { docKey }, at);
      return { ...base, relPath: base.relPath ?? pathKey, starred };
    }, docKey);
    return created;
  }

  /** 某路径是否已收藏（UI 判定星标：`docKey` / `relPath` / 旧键三个别名都认） */
  isStarred(pathKey: string): boolean {
    return this.starredKeys().has(pathKey);
  }

  /** 资产收藏（M4/M7 的写路径） */
  setAssetStarred(assetKey: string, starred: boolean): IndexChangeResult {
    const prev = this.assets.find((a) => a.assetKey === assetKey);
    const entry: AssetIndexEntry = prev
      ? { ...prev, starred }
      : {
          assetKey,
          scopeId: BROWSER_SCOPE_ID,
          relPath: relPathOfKey(assetKey),
          name: nameOf(assetKey),
          starred,
          legacyKeys: [],
        };
    this.assets = prev
      ? this.assets.map((a) => (a.assetKey === assetKey ? entry : a))
      : [...this.assets, entry];
    this.wrote = true;
    const written = this.persist();
    const projected = this.project(written);
    this.projectionFailed = !projected;
    return { entries: [], written, projected };
  }

  /**
   * 用户显式「关联到此工作区」（§6.2.1 的唯一合法绑定动作）：写入 `relinkEvidence`，
   * 此后该键视为证据充分——**必须由用户动作触发**，迁移永不自行调用。
   */
  relink(legacyKey: string, docKey: string, at = this.nowMs()): boolean {
    const hit = this.history.find((h) => h.key === legacyKey);
    if (!hit) return false;
    if (this.getDoc(docKey) === undefined) return false;
    this.docs = this.docs.map((e) =>
      e.docKey === docKey
        ? {
            ...e,
            relinkEvidence: grantRelinkEvidence(at),
            legacyKeys: appendUnique(e.legacyKeys, legacyKey),
          }
        : e,
    );
    this.history = this.history.filter((h) => h.key !== legacyKey);
    this.wrote = true;
    const written = this.persist();
    const projected = this.project(written);
    this.projectionFailed = !projected;
    return projected;
  }

  /**
   * 用户「忽略」一条历史池记录：只从**呈现**里移除（旧键与 `legacyKeys` 都保留）。
   * 忽略是可撤销的呈现操作，不是删除——「用户不处理也不丢」。
   */
  ignoreLegacy(legacyKey: string): void {
    this.history = this.history.filter((h) => h.key !== legacyKey);
  }

  // ---------------------------------------------------------------- 迁移（M4–M9；M11 只衔接）

  /**
   * 惰性迁移：每次调用处理**一批**（默认 `batch` 条），幂等、可中断续跑。
   *
   * 没有「一键批量入口」——调用方（文件面板挂载 / 打开某文档）按需调用；
   * 中断后下次从旧键重新判定，不依赖任何「已迁移」标记位。
   *
   * M11（legacy adoption）由 P0-0 完成，这里只**衔接**：读「当前作用域是否有历史证据」
   * 并据此分流（见 `migrateContextOf`），不重做目录身份解析。
   */
  migrate(opts?: { batch?: number }): MigrateResult {
    const batch = opts?.batch ?? 64;
    const ctx = this.ctxOf();
    const result: MigrateResult = { migrated: 0, unchanged: 0, failed: 0, historyPool: 0 };
    // 已处理过的标识（持久化，见 `cursors` 注释）
    const done = (key: string): Set<string> => new Set(this.cursors[key] ?? []);
    const pool: HistoryPoolEntry[] = [];

    // ---- M5：mindcanvas.library.v1 → DocIndexEntry（分批惰性、逐条 try/catch）
    const libRead = this.readJSON(LEGACY_LIBRARY_KEY);
    const libRaw = libRead.value;
    if (libRead.kind === 'ok' && Array.isArray(libRaw)) {
      const seen = done(LEGACY_LIBRARY_KEY);
      const pending = libRaw.filter(
        (item) => !(isRecord(item) && typeof item.id === 'string' && seen.has(item.id)),
      );
      for (const item of pending.slice(0, batch)) {
        try {
          if (!isRecord(item) || typeof item.id !== 'string' || item.id === '') {
            result.failed += 1; // 单条非法：不迁移、不删除
            continue;
          }
          const key = item.id;
          const name = str(item.name, key);
          const ts = requiredTs(item.ts);
          if (!hasOwnershipEvidence(ctx, key)) {
            // 证据不足（含**唯一同名命中**、legacy adoption 新 scope、ephemeral）→ 历史池
            pool.push({
              key,
              kind: 'library',
              name,
              openedAt: null, // 旧库只有访问时间，没有真实打开时间 → 不编造（UD-2）
              savedAt: ts,
              reason: ctx.persisted ? 'no-evidence' : 'ephemeral-scope',
              legacyKeys: [`${LEGACY_LIBRARY_KEY}#${key}`],
            });
            continue;
          }
          // 同一个旧键可能已经以**浏览器身份**存在于索引里（兼容模式打开过它）。
          // 那时不能再造一条 `ws:` 条目——同一份文档两条身份 = 「最近」出现重复行。
          // 只认领到既有条目上（补 legacyKeys）。
          const existing = this.docs.find(
            (e) => e.relPath === key || e.legacyKeys.includes(`${LEGACY_LIBRARY_KEY}#${key}`),
          );
          const outcome = this.adoptDoc({
            docKey: existing?.docKey ?? wsDocKey(ctx.scopeId, key),
            relPath: existing?.relPath ?? key,
            name: existing?.name ?? name,
            legacyKey: `${LEGACY_LIBRARY_KEY}#${key}`,
            savedAt: existing?.savedAt ?? ts,
            starred: false,
            scopeId: existing?.scopeId ?? ctx.scopeId,
            sourceRef: existing?.sourceRef ?? { kind: 'disk-handle' },
            ...(existing?.ephemeral === true || !ctx.persisted
              ? { ephemeral: true as const }
              : {}),
          });
          if (outcome === 'new') result.migrated += 1;
          else result.unchanged += 1;
        } catch {
          result.failed += 1;
        }
      }
    } else if (libRead.kind === 'corrupt' || (libRead.kind === 'ok' && libRaw !== undefined)) {
      result.failed += 1; // 键在但读不出/结构非法：不删、不修、记为未迁移
    }

    // ---- M6：mindcanvas.starred.v1（键 = fullPath）→ DocIndexEntry.starred
    const starRead = this.readJSON(LEGACY_STARRED_KEY);
    const starRaw = starRead.value;
    if (starRead.kind === 'ok' && Array.isArray(starRaw)) {
      const seen = done(LEGACY_STARRED_KEY);
      const pending = starRaw.filter((k) => typeof k !== 'string' || !seen.has(k));
      for (const key of pending.slice(0, batch)) {
        try {
          if (typeof key !== 'string' || key === '') {
            result.failed += 1;
            continue;
          }
          // M6 明文：「只有该键能按 docKey **精确命中**索引条目时才迁移」
          const exact = this.docs.find((e) => e.docKey === key || e.relPath === key);
          if (exact === undefined && !hasOwnershipEvidence(ctx, key)) {
            pool.push({
              key,
              kind: 'starred',
              name: fileNameOf(key),
              openedAt: null,
              savedAt: 0,
              reason: 'no-evidence',
              legacyKeys: [`${LEGACY_STARRED_KEY}#${key}`],
            });
            continue;
          }
          const outcome = this.adoptDoc({
            docKey: exact?.docKey ?? wsDocKey(ctx.scopeId, key),
            relPath: exact?.relPath ?? key,
            name: exact?.name ?? fileNameOf(key),
            legacyKey: `${LEGACY_STARRED_KEY}#${key}`,
            savedAt: exact?.savedAt ?? 0,
            starred: true,
            scopeId: exact?.scopeId ?? ctx.scopeId,
            sourceRef: exact?.sourceRef ?? { kind: 'none' },
            ephemeral: exact?.ephemeral,
          });
          if (outcome === 'new') result.migrated += 1;
          else result.unchanged += 1;
        } catch {
          result.failed += 1;
        }
      }
    }

    // ---- M7：mindcanvas.assets.fav（键 = `kind:id`）→ AssetIndexEntry.starred
    const favRead = this.readJSON(LEGACY_ASSET_FAV_KEY);
    const favRaw = favRead.value;
    if (favRead.kind === 'ok' && Array.isArray(favRaw)) {
      const seen = done(LEGACY_ASSET_FAV_KEY);
      const pending = favRaw.filter((k) => typeof k !== 'string' || !seen.has(k));
      for (const key of pending.slice(0, batch)) {
        try {
          if (typeof key !== 'string' || !key.includes(':')) {
            result.failed += 1;
            continue;
          }
          const sep0 = key.indexOf(':');
          const id0 = sep0 < 0 ? key : key.slice(sep0 + 1);
          const existing = this.assets.find(
            (a) => a.assetKey === key || a.assetKey === id0 || a.legacyKeys.includes(key),
          );
          if (existing) {
            void id0;
            if (existing.starred) {
              result.unchanged += 1;
            } else {
              this.assets = this.assets.map((a) =>
                a.assetKey === key
                  ? { ...a, starred: true, legacyKeys: appendUnique(a.legacyKeys, key) }
                  : a,
              );
              result.migrated += 1;
            }
            continue;
          }
          // 浏览器素材库项可直接迁移（作用域唯一）；磁盘项需 `(scopeId, relPath)` 且
          // 该作用域已证明同一目录——否则（含唯一同名命中）进历史池。
          // 旧键格式是 `kind:id`（如 `idb:a.png` / `disk:assets/b.png`；
          // 见 shared-contracts §6.1 的 `mindcanvas.assets.fav` = `kind:id`），
          // `id` 本身不含 `:` —— 用 `split(':')` 切一次，**不**把 `kind:` 当成 assetKey 前缀。
          const sep = key.indexOf(':');
          const kind = key.slice(0, sep);
          const id = key.slice(sep + 1);
          // §6.2 M7：`browser:local` 项可直接迁移（作用域唯一）；磁盘项需 `(scopeId, relPath)`
          // 且该作用域当前已证明同一目录 → 否则（含唯一同名命中）进历史池。
          const isBrowserItem = kind === 'idb' || kind === 'browser';
          const relPath = kind === 'disk' ? id : null;
          if (!isBrowserItem && !hasOwnershipEvidence(ctx, relPath)) {
            pool.push({
              key,
              kind: 'asset-fav',
              name: nameOf(key),
              openedAt: null,
              savedAt: 0,
              reason: 'no-evidence',
              legacyKeys: [`${LEGACY_ASSET_FAV_KEY}#${key}`],
            });
            continue;
          }
          // 新 assetKey 用**已归一化的路径**，不是旧的 `kind:id` 字面量：
          // 把 `disk:` 前缀带进新键会让它永远匹配不上真实的 `(scopeId, relPath)`。
          // `idb:` 项保留其规范 id（素材在 IndexedDB 里就叫这个 id）；
          // `disk:` 项丢掉旧前缀（真实身份是工作区内的相对路径）。
          const assetKey = isBrowserItem ? key : id === '' ? key : id;
          this.assets = [
            ...this.assets,
            {
              assetKey,
              scopeId: BROWSER_SCOPE_ID,
              relPath: relPath ?? null,
              name: nameOf(assetKey),
              starred: true,
              legacyKeys: [key],
            },
          ];
          result.migrated += 1;
        } catch {
          result.failed += 1;
        }
      }
    }

    // ---- M8：mindcanvas.canvas.recent.v1 → DocIndexEntry（scopeId='browser:local'）
    //      **不改写该键**；单条损坏跳过。
    const recentRead = this.readJSON(LEGACY_CANVAS_RECENT_KEY);
    const recentRaw = recentRead.value;
    if (recentRead.kind === 'ok' && Array.isArray(recentRaw)) {
      const seen = done(LEGACY_CANVAS_RECENT_KEY);
      const pending = recentRaw.filter(
        (item) => !(isRecord(item) && typeof item.id === 'string' && seen.has(item.id)),
      );
      for (const item of pending.slice(0, batch)) {
        try {
          if (!isRecord(item) || typeof item.id !== 'string' || item.id === '') {
            result.failed += 1;
            continue;
          }
          const docKey = browserDocKey(item.id);
          const prev = this.getDoc(docKey);
          if (prev) {
            if (prev.legacyKeys.includes(LEGACY_CANVAS_RECENT_KEY)) {
              result.unchanged += 1; // 幂等：二次迁移不再改动
            } else {
              this.docs = this.docs.map((e) =>
                e.docKey === docKey
                  ? { ...e, legacyKeys: appendUnique(e.legacyKeys, LEGACY_CANVAS_RECENT_KEY) }
                  : e,
              );
              result.migrated += 1;
            }
            continue;
          }
          this.docs = [
            ...this.docs,
            {
              docKey,
              scopeId: BROWSER_SCOPE_ID,
              relPath: null,
              lineageId: this.makeLineageId(),
              name: str(item.name, item.id),
              title: null,
              // 自由画布的 ts 是保存时间，不是打开时间 → 不回填（UD-2）
              openedAt: null,
              savedAt: requiredTs(item.ts),
              starred: false,
              sourceRef: { kind: 'none' },
              legacyKeys: [LEGACY_CANVAS_RECENT_KEY],
            },
          ];
          result.migrated += 1;
        } catch {
          result.failed += 1;
        }
      }
    }

    // ---- M9：旧 `docId` 裸句柄键（双读 + 双写）。
    //      读侧（新键未命中 → 读旧键）在包侧既有 `getFileHandle`；
    //      写侧在此：把**本会话已知可取的句柄**补写到旧 `docId` 键，使回退版本仍可用。
    void this.mirrorHandles();

    // ---- M11：注册表 legacy adoption 由 P0-0 完成，这里只承接其证据位
    //      （`migrateContextOf` → `hasOwnershipEvidence`），不重做身份解析。

    // 推进进度（走完全部旧键就归零，下次从头做一遍幂等复核）
    this.cursors[LEGACY_LIBRARY_KEY] = progress(
      done(LEGACY_LIBRARY_KEY),
      idsOf(libRaw),
      batch,
    );
    this.cursors[LEGACY_STARRED_KEY] = progress(
      done(LEGACY_STARRED_KEY),
      stringsOf(starRaw),
      batch,
    );
    this.cursors[LEGACY_ASSET_FAV_KEY] = progress(
      done(LEGACY_ASSET_FAV_KEY),
      stringsOf(favRaw),
      batch,
    );
    this.cursors[LEGACY_CANVAS_RECENT_KEY] = progress(
      done(LEGACY_CANVAS_RECENT_KEY),
      idsOf(recentRaw),
      batch,
    );

    this.history = pool;
    result.historyPool = pool.length;
    this.wrote = true;
    const written = this.persist();
    const projected = this.project(written);
    this.projectionFailed = !projected;
    return result;
  }

  // ---------------------------------------------------------------- 内部

  /** 登记（或补齐）一条迁移来的旧条目；幂等：已存在且逐字一致 → `'unchanged'` */
  private adoptDoc(input: {
    docKey: string;
    relPath: string | null;
    name: string;
    legacyKey: string;
    savedAt: number;
    starred: boolean;
    scopeId: ScopeId;
    sourceRef: DocIndexEntry['sourceRef'];
    ephemeral?: true;
  }): 'new' | 'unchanged' {
    const prev = this.getDoc(input.docKey);
    if (prev) {
      const next: DocIndexEntry = {
        ...prev,
        // **不推进 openedAt / savedAt**：迁移不是打开也不是保存（否则会编造打开时间）
        starred: prev.starred || input.starred,
        relPath: prev.relPath ?? input.relPath,
        name: prev.name || input.name,
        legacyKeys: appendUnique(prev.legacyKeys, input.legacyKey),
      };
      if (
        prev.starred === next.starred &&
        prev.relPath === next.relPath &&
        prev.name === next.name &&
        prev.legacyKeys.length === next.legacyKeys.length
      ) {
        return 'unchanged'; // 幂等：二次迁移结果逐字一致
      }
      this.docs = this.docs.map((e) => (e.docKey === input.docKey ? next : e));
      return 'new';
    }
    const entry: DocIndexEntry = {
      docKey: input.docKey,
      scopeId: input.scopeId,
      relPath: input.relPath,
      lineageId: this.makeLineageId(),
      name: input.name,
      title: null,
      openedAt: null, // ← 旧条目**没有真实打开时间**：保持 null，绝不回落 mtime（UD-2）
      savedAt: input.savedAt,
      starred: input.starred,
      sourceRef: input.sourceRef,
      legacyKeys: [input.legacyKey],
      ...(input.ephemeral === true ? { ephemeral: true as const } : {}),
    };
    this.docs = [...this.docs, entry];
    return 'new';
  }

  /** 组装一条新条目 */
  private freshEntry(
    docKey: string,
    relPath: string | null,
    input: DocInput,
    at: number,
  ): DocIndexEntry {
    const ctx = this.ctxOf();
    return {
      docKey,
      scopeId: input.scopeId ?? ctx.scopeId,
      relPath,
      lineageId: this.makeLineageId(),
      name: input.name ?? nameOf(docKey),
      title: input.title ?? null,
      openedAt: null,
      savedAt: at,
      starred: false,
      sourceRef: input.sourceRef ?? { kind: 'none' },
      legacyKeys: [],
    };
  }

  /** 按当前作用域持久性决定 `ephemeral`（`persisted:false` → 置位；`true` → 清除） */
  private ephemeralized(e: DocIndexEntry): DocIndexEntry {
    return this.ctxOf().persisted ? stripEphemeral(e) : { ...e, ephemeral: true as const };
  }

  /** 单条变更的统一出口：写索引 → 写投影 → 返回可查结果 */
  private mutate(
    compute: (prev: DocIndexEntry | undefined) => DocIndexEntry,
    docKey: string,
  ): IndexChangeResult {
    const prev = this.getDoc(docKey);
    const next = compute(prev);
    this.docs = prev
      ? this.docs.map((e) => (e.docKey === docKey ? next : e))
      : [...this.docs, next];
    this.wrote = true;
    const written = this.persist();
    const projected = this.project(written);
    this.projectionFailed = !projected;
    return { entries: [next], written, projected };
  }

  /** 写索引键；失败返回 false（条目仍在内存视图里，调用方据此提示） */
  private persist(): boolean {
    try {
      this.store.set(DOC_INDEX_KEY, JSON.stringify({ entries: this.docs, cursors: this.cursors }));
      this.store.set(ASSET_INDEX_KEY, JSON.stringify(this.assets));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * **降级投影**（§6.3 R-B）：把索引写成旧版本能读懂的形状。返回是否全部成功。
   *
   * 三张投影表：
   * ① `mindcanvas.library.v1` ← `{id,name,ts,folder,tags,source?}`，`ts = max(openedAt,savedAt)`，
   *    `source` 仍只留 8 条（复用 `DocLibrary.replaceAll` 的既有降级：配额满先剥 source）；
   * ② `mindcanvas.starred.v1` ← 旧式键集合（`fullPath` 或旧 id）；
   * ③ `mindcanvas-handles` 旧 `docId` 键 ← 裸 `FsFileHandle`（见 `mirrorHandles`）。
   *
   * **不是**「旧键还在」：三张都在每次变更后重新写出，
   * 因此升级后新增的收藏/最近在旧版本里真的读得到。
   *
   * 失败不影响主流程（与既有 `putRaw` 容错一致），但该次变更**不可回退** →
   * 记 `projectionFailed`，经 `projectionStatus()` 在回执与验证里可查。
   */
  private project(indexWritten: boolean): boolean {
    if (!indexWritten) return false;
    const orphans = this.projectLibrary();
    return this.projectStarred(orphans);
  }

  /**
   * 投影①：旧文档库。
   *
   * **必须与旧库求并集**，理由：旧库里的条目多数**没有**索引对应项
   * （没有历史证据 → 进历史池，§6.2.1），整体覆盖会把它们从旧结构里抹掉——
   * 那就成了「升级即丢历史」，与「用户不处理也不丢」直接冲突。
   * 索引这一侧是权威：同 id 时以索引的 `{name,ts}` 对齐（升级后的新数据必须在旧结构里可见），
   * 旧库独有字段（`tags` / 未知字段）与 `source` 快照原样保留。
   *
   * `ts = max(openedAt, savedAt)`（§6.3 明文）；source 仍只留 8 条，
   * 由 `DocLibrary.replaceAll` 的既有降级规则执行。
   */
  private projectLibrary(): number {
    try {
      const prevRead = this.readJSON(LEGACY_LIBRARY_KEY);
      const prevList =
        prevRead.kind === 'ok' && Array.isArray(prevRead.value)
          ? prevRead.value.filter(isRecord)
          : [];
      const byId = new Map<string, Record<string, unknown>>();
      for (const item of prevList) {
        const id = item.id;
        if (typeof id === 'string' && id !== '') byId.set(id, item);
      }
      let orphans = 0;

      const rows: Array<{
        id: string;
        name: string;
        ts: number;
        folder: string;
        tags: string[];
        source?: string;
        [k: string]: unknown;
      }> = [];
      const seen = new Set<string>();

      for (const e of this.docs) {
        // `library.v1` 是**工作区/兼容模式的旧格式**：只有能表达为「路径 → 文档」的
        // 条目才投影进去。浏览器作用域的条目（如 `browser:local::c1` 的自由画布）
        // 没有旧格式对应物——硬塞一个 `id: c1` 会在下一次迁移时被 M5 读成
        // 「工作区里有一份 c1.mm.md」，凭空造出一条重复条目（实测踩过）。
        if (e.scopeId === BROWSER_SCOPE_ID && e.relPath === null) continue;
        const id = legacyIdOf(e);
        const prev = byId.get(id);
        seen.add(id);
        const row: Record<string, unknown> = prev === undefined ? {} : { ...prev };
        row.id = id;
        row.name = e.name;
        row.ts = Math.max(e.openedAt ?? 0, e.savedAt);
        row.folder = typeof row.folder === 'string' ? row.folder : '';
        row.tags = Array.isArray(row.tags) ? row.tags : [];
        // 索引没有源码快照的概念：source 沿用旧库快照（首保存前不该凭空消失）
        rows.push(row as (typeof rows)[number]);
      }

      // 旧库中索引没有对应项的条目：原样保留（不进索引 = 没被认领，但也不能被抹掉）
      for (const [id, item] of byId) {
        if (seen.has(id)) continue;
        orphans += 1;
        rows.push(item as (typeof rows)[number]);
      }

      // 索引无条目、旧结构也没有（或本就不合法）→ **不写**：
      // `replaceAll([])` 会把旧结构抹成空，既丢数据又白搭一次写。
      if (rows.length === 0) return orphans;

      new DocLibrary().replaceAll(rows);
      return orphans;
    } catch {
      return 0;
    }
  }

  /**
   * 投影②：旧收藏键集合（`fullPath` 或旧 id）。
   *
   * **必须与旧集合求并集**：无法归属到索引的旧收藏（→ 历史池）不在 `docs` 里，
   * 只写索引一侧会把它们悄悄取消收藏。旧集合 + 索引收藏 = 不丢。
   * 索引侧「取消收藏」的表达是：该键**不在**索引收藏集里，且它也不是旧集合里的孤儿项。
   */
  private projectStarred(orphanCount: number): boolean {
    try {
      const prevRead = this.readJSON(LEGACY_STARRED_KEY);
      const prevKeys =
        prevRead.kind === 'ok' && Array.isArray(prevRead.value)
          ? prevRead.value.filter((k): k is string => typeof k === 'string')
          : [];
      const indexedLegacyKeys = new Set(this.docs.filter((e) => e.starred).map(legacyIdOf));
      // 被显式取消收藏的键：曾经在旧集合里、现在索引里有条目但 starred=false
      const explicitlyUnstarred = new Set(
        this.docs.filter((e) => !e.starred).map(legacyIdOf),
      );
      const out = new Set<string>();
      for (const k of prevKeys) {
        if (indexedLegacyKeys.has(k)) out.add(k);
        else if (!explicitlyUnstarred.has(k)) out.add(k); // 孤儿/历史池项：保留
      }
      for (const k of indexedLegacyKeys) out.add(k);
      this.store.set(LEGACY_STARRED_KEY, JSON.stringify([...out]));
      // orphanCount 仅用于让调用方读懂「为什么是并集而不是覆盖」，不影响结果
      void orphanCount;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * M9 的**写侧**（双写）：把本会话已知可取的裸句柄补写到旧 `docId` 键。
   * 旧键仍是裸 `FsFileHandle`，回退版本据此仍能写回原文件。
   */
  private async mirrorHandles(): Promise<void> {
    for (const id of this.handleIds) {
      try {
        const handle: FsFileHandle | null = await getFileHandle(id);
        if (handle) await setFileHandle(id, handle);
      } catch {
        // 句柄双写是增强：失败不阻断（旧裸键仍在，读侧双读不受影响）
      }
    }
  }

  /**
   * 读一个 JSON 键。**四态分开**：`absent` / `ok` / `corrupt`。
   *
   * 为什么不能把「键不存在」与「解析不了」折叠成同一个值：迁移要区分
   * 「没有旧数据要迁」与「有旧数据但读不出来（记为未迁移）」——
   * 折叠后前者会被误报成失败，后者会被静默当成无事发生。损坏的数据
   * **不删、不修**（§6.1）。
   */
  private readJSON(key: string): { kind: 'absent' | 'ok' | 'corrupt'; value?: unknown } {
    try {
      const raw = this.store.get(key);
      if (raw === null) return { kind: 'absent' };
      return { kind: 'ok', value: JSON.parse(raw) as unknown };
    } catch {
      return { kind: 'corrupt' };
    }
  }

  private reload(): void {
    const docRead = this.readJSON(DOC_INDEX_KEY);
    const docRaw = docRead.value;
    // 兼容两种落盘形状：裸数组（早期写入）与 { entries, cursors }（可续跑游标）
    const rawEntries = Array.isArray(docRaw)
      ? docRaw
      : isRecord(docRaw) && Array.isArray(docRaw.entries)
        ? docRaw.entries
        : [];
    this.docs = rawEntries.flatMap((raw) => {
      const e = normalizeDocEntry(raw);
      return e === null ? [] : [e];
    });
    this.cursors = {};
    if (isRecord(docRaw) && isRecord(docRaw.cursors)) {
      for (const [k, v] of Object.entries(docRaw.cursors)) {
        if (Array.isArray(v)) {
          this.cursors[k] = v.filter((x): x is string => typeof x === 'string');
        }
      }
    }
    const assetRead = this.readJSON(ASSET_INDEX_KEY);
    const assetRaw = assetRead.value;
    this.assets = assetRead.kind === 'ok' && Array.isArray(assetRaw)
      ? assetRaw.flatMap((raw) => {
          const e = normalizeAssetEntry(raw);
          return e === null ? [] : [e];
        })
      : [];
  }
}

/** 旧条目标识（`id`；非法项返回 null 并保留为「未处理」，由逐条 try/catch 记 failed） */
function idsOf(v: unknown): string[] {
  return Array.isArray(v)
    ? v.flatMap((item) => (isRecord(item) && typeof item.id === 'string' ? [item.id] : []))
    : [];
}

/** 字符串数组（收藏键） */
function stringsOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
}

/**
 * 推进进度集合：加入本次**实际进入批次**的标识；全部处理完则清空
 * （下次从头做一遍幂等复核，而不是永久不再看这些旧键）。
 */
function progress(seen: Set<string>, all: string[], batch: number): string[] {
  const pending = all.filter((k) => !seen.has(k));
  if (pending.length === 0) return []; // 已全部处理过 → 归零重跑一遍
  const merged = new Set(seen);
  for (const k of pending.slice(0, batch)) merged.add(k);
  if (merged.size >= all.length) return []; // 走完全部 → 归零
  return [...merged];
}

function stripEphemeral(e: DocIndexEntry): DocIndexEntry {
  if (e.ephemeral !== true) return e;
  const { ephemeral: _drop, ...rest } = e;
  return rest;
}

function defaultLineageId(): string {
  const c = globalThis.crypto;
  try {
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  } catch {
    // 源抛错同样走回退（jsdom 等环境不得成为硬依赖）
  }
  return `lin-${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}
