/**
 * 索引层的**降级投影**（§6.3 R-B 的答案）。
 *
 * 契约：shared-contracts §6.3（版本回退策略）、I-21（「旧键还在」≠「新数据可回退」）。
 *
 * 为什么单独成文件：单文件超 600 行会触发代码预算的 `bigFiles` 门禁。
 * 状态经 `ProjectionState` 显式传入（`DocIndex` 实例天然满足）。
 *
 * 三张投影表（每次变更后都重新写出，旧版本据此**真的读得到**新数据）：
 * ① `mindcanvas.library.v1` ← `{id,name,ts,folder,tags,source?}`，`ts = max(openedAt,savedAt)`；
 * ② `mindcanvas.starred.v1` ← 旧式键集合；
 */
import { BROWSER_SCOPE_ID, DocLibrary } from '@mindcanvas/react';
import {
  LEGACY_LIBRARY_KEY,
  LEGACY_STARRED_KEY,
  isRecord,
  legacyIdOf,
} from './docIndexCore.js';
import type { DocIndexEntry } from './docIndexCore.js';

/** 投影需要的最小状态面（`DocIndex` 实例天然满足） */
export interface ProjectionState {
  docs: ReadonlyArray<DocIndexEntry>;
  readJSON(key: string): { kind: 'absent' | 'ok' | 'corrupt'; value?: unknown };
  store: { set(key: string, value: string): void };
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
export function projectLibrary(index: ProjectionState): boolean {
    try {
      const prevRead = index.readJSON(LEGACY_LIBRARY_KEY);
      // 旧库里**每一行**都要留底：合法的进 `byId` 参与对齐，非法的（`null`、
      // 缺 `id`、非对象）原样排在末尾。此前这里 `filter(isRecord)` + 只收集有 `id`
      // 的行，等于让投影把尚未迁移的畸形行**静默删掉**——而 `registerDoc` 每次
      // 打开文档都会走一遍投影，于是「升级即丢历史」。
      const prevList = prevRead.kind === 'ok' && Array.isArray(prevRead.value) ? prevRead.value : [];
      const byId = new Map<string, Record<string, unknown>>();
      const opaqueRows: unknown[] = [];
      for (const item of prevList) {
        const id = isRecord(item) ? item.id : undefined;
        if (isRecord(item) && typeof id === 'string' && id !== '') byId.set(id, item);
        else opaqueRows.push(item);
      }
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

      for (const e of index.docs) {
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
        rows.push(item as (typeof rows)[number]);
      }
      // 无法表达的畸形行：原样附着在末尾，确保「不处理也不丢」。
      for (const item of opaqueRows) rows.push(item as (typeof rows)[number]);

      // 索引无条目、旧结构也没有（或本就不合法）→ **不写**：
      // `replaceAll([])` 会把旧结构抹成空，既丢数据又白搭一次写。
      // 这不是失败（没有东西要写），故返回 true。
      if (rows.length === 0) return true;

      const lib = new DocLibrary();
      lib.replaceAll(rows);

      // **写后回读校验**（N-1）。为什么不靠 `replaceAll` 抛错：包侧
      // `DocLibrary.save`（`docLibrary.ts:107-119`）是两层 try/catch 自吞——
      // 配额失败时**不抛、不返回、不说**，只把整表丢掉；于是「沿用既有静默降级」
      // 与「失败能被 `projectionFailed` 捕获」不可能同源成立（施工方 §4.5 已自陈，
      // 复核 §7 N-1 用 `Storage.prototype.setItem` 打桩确证：`projectionFailed` 会**谎报 false**）。
      // `replaceAll` 的返回值在本包授权内也改不了（跨包契约，主控裁定归属 apps/canvas）。
      // 唯一能在本包内成立的判据是**把真值读回来比对**。
      //
      // 必须用 `DocLibrary.list()`（`:122`）这个**公开读取面**：不重造包侧序列化，
      // 读到什么就以什么为准。`index` 上虽然挂着 `store`，但那是**索引键**的端口，
      // 不是旧库的读取方——用 `store.get(LEGACY_LIBRARY_KEY)` 等于本包自己解析
      // 旧库格式，与「投影只经公开读取面验真」的意图相反。
      //
      // 比对**行集合**（`rows`），不只是索引条目：`rows` 含保留的孤儿行与无法表达的
      // 畸形行，它们同样是「不处理也不丢」的承诺对象——只比索引条目会让
      // 「畸形行被写丢」这条路径漏检。
      //
      // 口径说明（**`list()` 与 `rows` 的形状差是刻意的，不是 bug**）：
      // `list()` 走 `load()` → `filter(isEntry).map(normalize)`，只返回**结构化合法**的
      // `DocEntry` 并按 `ts` 降序；`rows` 里那些畸形行（`null` / 缺 `id`）**本来就读不出来**。
      // 所以不能天真地要求「读回条数 === rows.length」——那会让**任何**含畸形行的
      // 旧库被误判成投影失败（实测：修复初版即如此，healthy 路径也报 failed）。
      //
      // **只比 `id` 集合是不够的**（实测踩过）：`saveDoc(ts=1200)` 写失败时，
      // 落盘的还是旧行 `ts=1111` —— `id` 集合完全一致，但「本次变更不可回退」
      // 这一事实必须被抓到。故比对**投影真正携带的字段**（§6.3 的三项：
      // `id` / `name` / `ts = max(openedAt, savedAt)`）。
      // 不展开比对 `folder`/`tags`/`source`：`DocLibrary` 的 `normalize`/`cleanFolder`
      // 是包内私有（本包拿不到），逐个字段比会把包侧归一化细节复制进本包——
      // 那是跨包耦合，主控裁定 N-1 的修法不得动包侧契约。
      // `id`/`name`/`ts` 是投影**必须**写对的三个字段，足以判定「写进去了没有」。
      const expected = new Map<string, { name: string; ts: number }>();
      for (const r of rows) {
        if (isRecord(r) && typeof r.id === 'string' && r.id !== '') {
          expected.set(r.id, { name: String(r.name), ts: Number(r.ts) });
        }
      }
      const read = lib.list();
      if (read.length !== expected.size) return false; // 整表没写进去 / 多写 / 少写
      for (const e of read) {
        const want = expected.get(e.id);
        if (want === undefined) return false; // 读回一条本次没打算写的 id
        if (e.name !== want.name) return false; // 行内容被改写
        // `ts` 必须已是数值：`persistSorted` 只排序不投影，故这里就是写出去的值
        if (e.ts !== want.ts) return false; // 写失败留下的陈旧行（如 saveDoc 没推进 ts）
      }
      return true;
    } catch {
      return false; // 写失败：调用方据此置 projectionFailed（§6.3「不可回退且可查」）
    }
  }

  /**
   * 投影②：旧收藏键集合（`fullPath` 或旧 id）。
   *
   * **必须与旧集合求并集，且只移除「已被索引认领」的取消项**：
   * - 无法归属到索引的旧收藏（→ 历史池）不在 `docs` 里，只写索引一侧会把它们悄悄取消收藏；
   * - 更隐蔽的一种：**尚未迁移**的旧键也不能移除（否则投影反过来破坏迁移的输入）。
   * 详见函数内 `claimedByIndex` 的注释。
   */
export function projectStarred(index: ProjectionState): boolean {
  try {
    const prevRead = index.readJSON(LEGACY_STARRED_KEY);
    const prevKeys =
      prevRead.kind === 'ok' && Array.isArray(prevRead.value)
        ? prevRead.value.filter((k): k is string => typeof k === 'string')
        : [];
    /** 索引侧「当前确实已收藏」的键（旧 id 形态）：用户现在要看到的收藏 */
    const indexedKeys = new Set(index.docs.filter((e) => e.starred).map(legacyIdOf));
    /** 迁移**认领过**的旧键（写进了某条目的 `legacyKeys`） */
    const claimed = new Set(index.docs.flatMap((e) => e.legacyKeys));
    /**
     * 未认领的旧键一律保留。两类都在这里：
     * ① 历史池里的记录（用户不处理也不丢）；
     * ② **尚未迁移**的键 —— 这一条是硬要求：`registerDoc`/`openDoc` 会先于 `migrate()`
     *    登记条目，如果那时就按「索引里没收藏 → 从旧集合删掉」处理，
     *    投影会**反过来删掉迁移的输入**（实测：`mindcanvas.starred.v1` 被清空，
     *    M6 之后读到空数组，一条收藏都迁不过来）。
     * 认领过的键若已不再收藏，才是真正的「用户取消收藏」→ 不移入结果集。
     */
    const out = new Set<string>();
    for (const k of prevKeys) {
      if (!claimed.has(k) || indexedKeys.has(k)) out.add(k);
    }
    for (const k of indexedKeys) out.add(k);
    index.store.set(LEGACY_STARRED_KEY, JSON.stringify([...out]));
    return true;
  } catch {
    return false;
  }
}

