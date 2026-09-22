/**
 * 索引层本体（P0-D）：**唯一索引写入口**。
 *
 * 契约：docs/specs/2026-09-19-file-assets-design/shared-contracts.md §4.7（条目形状与键）、
 * §6.2（迁移表 M4–M9 / M11）、§6.2.1（归属证据规则）、§6.3（降级投影）。
 * 键常量、条目类型、归一化、主键换算与归属证据判据在 `docIndexCore.ts`（此处再导出，
 * 调用方与测试仍只认 `docIndex.js` 一个入口）。
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
  type FsFileHandle,
  type ScopeId,
  getFileHandle,
  setFileHandle,
} from '@mindcanvas/react';
import {
  ASSET_INDEX_KEY,
  DOC_INDEX_KEY,
  appendUnique,
  browserDocKey,
  compareRecent,
  grantRelinkEvidence,
  isRecord,
  nameOf,
  normalizeAssetEntry,
  normalizeDocEntry,
  relPathOfKey,
} from './docIndexCore.js';
import { runMigration } from './docIndexMigrate.js';
import { projectLibrary, projectStarred } from './docIndexProject.js';
import type {
  AssetIndexEntry,
  DocIndexEntry,
  DocInput,
  HistoryPoolEntry,
  IndexChangeResult,
  IndexStore,
  MigrateContext,
  MigrateResult,
} from './docIndexCore.js';

export * from './docIndexCore.js';

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
  docs: DocIndexEntry[] = [];
  assets: AssetIndexEntry[] = [];
  /** 历史池：不写盘，由 `migrate` 依旧键重算（旧键原样保留 = 用户不处理也不丢） */
  history: HistoryPoolEntry[] = [];
  readonly store: IndexStore;
  private readonly nowMs: () => number;
  readonly makeLineageId: () => string;
  readonly ctxOf: () => MigrateContext;
  /** 本次会话内是否已发生新写入（R-A / R-B 的分界依据，§6.3） */
  wrote = false;
  /** 最近一次投影写入失败（§6.3：该次变更不可回退，必须可查） */
  projectionFailed = false;
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
  cursors: Record<string, string[]> = {};

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
   * **没有「一键批量入口」**——调用方（文件面板挂载 / 打开某文档）按需调用；
   * 中断后下次从旧键重新判定，不依赖任何「已迁移」标记位。
   *
   * 算法在 `docIndexMigrate.ts`（超长文件拆出）；本方法只做委托，
   * 「唯一写入口」仍然是本类：调用方仍然只 `index.migrate()`。
   */
  migrate(opts?: { batch?: number }): MigrateResult {
    return runMigration(this, opts);
  }

  // ---------------------------------------------------------------- 迁移模块的状态面
  //
  // 这些成员是 `DocIndexState` 的实现细节：`docIndexMigrate.ts` 以显式接口消费，
  // 而不是反向 import 本类（那会成环，也会把「迁移碰了哪些状态」藏起来）。


  // ---------------------------------------------------------------- 内部

  /** 登记（或补齐）一条迁移来的旧条目；幂等：已存在且逐字一致 → `'unchanged'` */
  adoptDoc(input: {
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
  ephemeralized(e: DocIndexEntry): DocIndexEntry {
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
  persist(): boolean {
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
  project(indexWritten: boolean): boolean {
    if (!indexWritten) return false;
    const orphans = projectLibrary(this);
    return projectStarred(this, orphans);
  }

  /**
   * M9 的**写侧**（双写）：把本会话已知可取的裸句柄补写到旧 `docId` 键。
   * 旧键仍是裸 `FsFileHandle`，回退版本据此仍能写回原文件。
   */
  async mirrorHandles(): Promise<void> {
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
  readJSON(key: string): { kind: 'absent' | 'ok' | 'corrupt'; value?: unknown } {
    try {
      const raw = this.store.get(key);
      if (raw === null) return { kind: 'absent' };
      // `JSON.parse` 返回 `any`：显式标注为 `unknown` 再交给调用方窄化，
      // 不用类型断言（债务预算的 asCast 只减不增）。
      const value: unknown = JSON.parse(raw);
      return { kind: 'ok', value };
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
