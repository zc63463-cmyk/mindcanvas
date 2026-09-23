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
import { BROWSER_SCOPE_ID, type ScopeId } from '@mindcanvas/react';
import {
  ASSET_INDEX_KEY,
  DOC_INDEX_KEY,
  appendUnique,
  browserDocKey,
  collectStarredKeys,
  compareRecent,
  legacyIdOf,
  grantRelinkEvidence,
  isRecord,
  nameOf,
  normalizeAssetEntry,
  normalizeDocEntry,
  relPathOfKey,
} from './docIndexCore.js';
import { runMigration } from './docIndexMigrate.js';
import {
  type RelocateInput,
  defaultIndexStore,
  defaultLineageId,
  relocateEntries,
  stripEphemeral,
} from './docIndexSupport.js';
import { projectLibrary, projectStarred } from './docIndexProject.js';
import type {
  AssetIndexEntry,
  DocIndexEntry,
  DocInput,
  HistoryPoolEntry,
  IndexStore,
  MigrateContext,
  MigrateResult,
} from './docIndexCore.js';

export * from './docIndexCore.js';

// ============================================================ 索引本体

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
    this.store = opts?.store ?? defaultIndexStore();
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

  /**
   * 收藏键集合（纯函数 `collectStarredKeys` 的实例包装，见 `docIndexCore.ts`）。
   *
   * UI 用 `docKey` **或** `relPath` **或** 旧式 `fullPath` 判定星标：
   * 三个别名都进集合是刻意的——投影把 `relPath` 写进旧键之后，
   * 两侧（索引与旧键读取方）必须能互相识别。
   */
  starredKeys(): Set<string> {
    return collectStarredKeys(this.docs, this.assets);
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
  openDoc(input: DocInput, at = this.nowMs()): void {
    const relPath = input.relPath === undefined ? relPathOfKey(input.docKey) : input.relPath;
    this.mutate((prev) => {
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
  saveDoc(input: DocInput, at = this.nowMs()): void {
    const relPath = input.relPath === undefined ? relPathOfKey(input.docKey) : input.relPath;
    this.mutate((prev) => {
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
  }): void {
    this.mutate((prev) => {
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

  /**
   * 文档**改名/移动**：把一条已存在的索引条目搬到新路径，**身份（含收藏）随行**。
   *
   * 纯计算部分在 `docIndexSupport.relocateEntries`（`bigFiles` 预算）；
   * 本方法只负责「找旧条目 → 计算新数组 → 落盘」。
   *
   * 为什么必须有它（F5）：`docKey` 是 `ws:<scopeId>::<relPath>`，路径一变键就变。
   * 若改名后仍走 `registerDoc`，新路径会被当成**从没见过的文档**建条目 ——
   * 收藏（记在旧 `docKey` 上）就此失联。详见 `relocateEntries` 的注释。
   *
   * 与 `registerDoc` 的分工：`registerDoc` = 「第一次见到」；本方法 = 「换了名字/位置」。
   */
  relocateDoc(input: RelocateInput): void {
    const result = relocateEntries(this.docs, input, {
      makeLineageId: this.makeLineageId,
      now: this.nowMs,
    });
    if (!result.moved) {
      // 旧条目不存在 → 退化为首次登记（不制造假血统）
      this.registerDoc(input);
      return;
    }
    this.docs = result.docs;
    this.wrote = true;
    this.persist();
  }

  /** 收藏/取消收藏（按**稳定身份** `docKey`；`relPath` 变了收藏不丢） */
  setStarred(docKey: string, starred: boolean, at = this.nowMs()): void {
    this.mutate((prev) => {
      if (!prev) {
        const created = this.freshEntry(docKey, relPathOfKey(docKey), { docKey }, at);
        return { ...created, starred };
      }
      return { ...prev, starred };
    }, docKey);
    // 用户显式碰过这条 → 记下它当前的旧 id 写法，供投影区分
    // 「用户取消收藏」与「这条还没迁移」（见 `claimKey` 注释）
    const entry = this.getDoc(docKey);
    if (entry !== undefined) this.claimKey(docKey, legacyIdOf(entry));
  }

  /**
   * 把某个键登记为「已被索引认领」（写进目标条目的 `legacyKeys`）。
   *
   * 为什么收藏写入要记这个：降级投影需要区分两种 `starred === false`
   * ——「用户显式取消收藏」（该从旧键移除）与「这条还没迁移」（绝不能动旧键）。
   * 用户一碰收藏就留下认领痕迹，两者即可判定。见 `docIndexProject.projectStarred`。
   */
  private claimKey(docKey: string, key: string): void {
    this.docs = this.docs.map((e) =>
      e.docKey === docKey ? { ...e, legacyKeys: appendUnique(e.legacyKeys, key) } : e,
    );
  }

  /**
   * 收藏的**路径别名**入口（供文件面板按行主键切换收藏）：
   * 先按 `docKey` 找，再按 `relPath` 找（旧键通过 `legacyKeys` 命中），
   * 都没命中 → 以该键为 `relPath` 建新条目（浏览器模式无工作区时的常见情形）。
   */
  setStarredByPath(pathKey: string, starred: boolean, at = this.nowMs()): void {
    const hit =
      this.getDoc(pathKey) ??
      this.docs.find((e) => e.relPath === pathKey) ??
      this.docs.find((e) => e.legacyKeys.includes(pathKey));
    if (hit) {
      this.setStarred(hit.docKey, starred, at);
      // 记录路径别名：用户显式操作过的键 = 已被认领（投影据此判定「取消收藏」）
      this.claimKey(hit.docKey, pathKey);
      return;
    }
    const docKey = pathKey.includes('::') ? pathKey : browserDocKey(pathKey);
    this.mutate((prev) => {
      const base = prev ?? this.freshEntry(docKey, relPathOfKey(docKey) ?? pathKey, { docKey }, at);
      return {
        ...base,
        relPath: base.relPath ?? pathKey,
        starred,
        legacyKeys: appendUnique(base.legacyKeys, pathKey),
      };
    }, docKey);
  }

  /** 某路径是否已收藏（UI 判定星标：`docKey` / `relPath` / 旧键三个别名都认） */
  isStarred(pathKey: string): boolean {
    return this.starredKeys().has(pathKey);
  }

  /** 资产收藏（M4/M7 的写路径） */
  setAssetStarred(assetKey: string, starred: boolean): void {
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
    this.commit();
  }

  /**
   * 用户显式「关联到此工作区」（§6.2.1 的唯一合法绑定动作）：写入 `relinkEvidence`，
   * 此后该键视为证据充分——**必须由用户动作触发**，迁移永不自行调用。
   *
   * 两道拒绝（`relinkEvidence` 是不可撤销为假的凭证，宁可不写也不写错）：
   * ① 目标必须**已在索引里**（用户从候选列表点选既有文档）——不允许边关联边新建身份；
   * ② 目标必须属于**当前作用域**——跨作用域关联等于伪造归属证据。
   */
  relink(legacyKey: string, docKey: string, at = this.nowMs()): boolean {
    if (!this.history.some((h) => h.key === legacyKey)) return false;
    const target = this.getDoc(docKey);
    if (target === undefined) return false;
    if (target.scopeId !== this.ctxOf().scopeId) return false;
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
    this.commit();
    return true; // 两道拒绝已在上方返回 false；到这里绑定已写入（投影成败由 projectionStatus 查）
  }

  /** 用户「忽略」一条历史池记录：只从**呈现**移除（旧键与 `legacyKeys` 保留，不处理也不丢） */
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

  // ---------------------------------------------------------------- 内部
  // 下面的成员同时构成 `DocIndexState`（`docIndexMigrate.ts` 以显式接口消费，
  // 而不是反向 import 本类——那会成环，也会把「迁移碰了哪些状态」藏起来）。

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
        // **不推进 openedAt**：迁移不是打开（否则会编造打开时间，UD-2）。
        // `savedAt`：迁移带来的旧库访问时间**是真值**，可以覆盖既有条目的占位值
        // （`registerDoc` 会把本次会话的登记时刻写进 savedAt，那不是「上次动过它的时间」）。
        // 但迁移**不带** savedAt 时（M6/M8 沿用条目自身），绝不改动既有时间。
        savedAt: input.savedAt > 0 ? input.savedAt : prev.savedAt,
        starred: prev.starred || input.starred,
        relPath: prev.relPath ?? input.relPath,
        name: prev.name || input.name,
        legacyKeys: appendUnique(prev.legacyKeys, input.legacyKey),
      };
      if (
        prev.savedAt === next.savedAt &&
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
  ): void {
    const prev = this.getDoc(docKey);
    const next = compute(prev);
    this.docs = prev
      ? this.docs.map((e) => (e.docKey === docKey ? next : e))
      : [...this.docs, next];
    this.commit();
  }

  /**
   * 本次变更的统一收尾：写索引 → 写投影 → 记下「是否可回退」。
   * 四个写路径（`mutate` / `setAssetStarred` / `relink` / `migrate`）共用，
   * 避免任何一处漏写投影而静默破坏 R-B。
   */
  private commit(): boolean {
    const written = this.persist();
    const projected = this.project(written);
    this.wrote = true;
    this.projectionFailed = !projected;
    return projected;
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
   * **降级投影**（§6.3 R-B）的委托入口：三张投影表的实现在 `docIndexProject.ts`。
   *
   * 契约要点（那里有完整说明）：每次变更后重新写出旧版本能读懂的形状，
   * 使升级后的收藏/最近**真的**能在旧结构里读到（不是「旧键还在」）；
   * 返回 `false` = 该次变更不可回退，记入 `projectionFailed` 供
   * `projectionStatus()` 上报（生产读取方在 `useIndexWiring`）。
   */
  project(indexWritten: boolean): boolean {
    if (!indexWritten) return false;
    return projectLibrary(this) && projectStarred(this);
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


