/**
 * 索引层的**迁移算法**（M4–M9；M11 只衔接）。
 *
 * 契约：shared-contracts §6.2（迁移表）、§6.2.1（归属证据规则）、§6.3（降级投影）。
 *
 * 为什么单独成文件：单文件超 600 行会触发代码预算的 `bigFiles` 门禁。
 * 这里不持有状态——全部状态经 `DocIndexState` 显式传入（`docIndex.ts` 的类实例天然满足），
 * 于是迁移逻辑可以独立阅读与测试，而「唯一写入口」仍然是 `DocIndex` 上的方法。
 */
import { BROWSER_SCOPE_ID } from '@mindcanvas/react';
import {
  LEGACY_ASSET_FAV_KEY,
  LEGACY_CANVAS_RECENT_KEY,
  LEGACY_LIBRARY_KEY,
  LEGACY_STARRED_KEY,
  appendUnique,
  browserDocKey,
  fileNameOf,
  hasOwnershipEvidence,
  isRecord,
  nameOf,
  requiredTs,
  str,
} from './docIndexCore.js';
import type {
  AssetIndexEntry,
  DocIndexEntry,
  HistoryPoolEntry,
  MigrateContext,
  MigrateResult,
} from './docIndexCore.js';

/**
 * 迁移需要的最小状态面（`DocIndex` 实例天然满足）。
 * 显式列出而不是 `DocIndex`：避免本文件反向依赖类文件（会成环），
 * 也让「迁移碰了哪些状态」一眼可见。
 */
export interface DocIndexState {
  docs: DocIndexEntry[];
  assets: AssetIndexEntry[];
  cursors: Record<string, string[]>;
  projectionFailed: boolean;
  history: HistoryPoolEntry[];
  wrote: boolean;
  ctxOf(): MigrateContext;
  getDoc(docKey: string): DocIndexEntry | undefined;
  adoptDoc(input: {
    docKey: string;
    relPath: string | null;
    name: string;
    legacyKey: string;
    savedAt: number;
    starred: boolean;
    scopeId: string;
    sourceRef: DocIndexEntry['sourceRef'];
    ephemeral?: true;
  }): 'new' | 'unchanged';
  makeLineageId(): string;
  readJSON(key: string): { kind: 'absent' | 'ok' | 'corrupt'; value?: unknown };
  persist(): boolean;
  project(indexWritten: boolean): boolean;
}

  /**
   * 惰性迁移：每次调用处理**一批**（默认 `batch` 条），幂等、可中断续跑。
   *
   * 没有「一键批量入口」——调用方（文件面板挂载 / 打开某文档）按需调用；
   * 中断后下次从旧键重新判定，不依赖任何「已迁移」标记位。
   *
   * M11（legacy adoption）由 P0-0 完成，这里只**衔接**：读「当前作用域是否有历史证据」
   * 并据此分流（见 `migrateContextOf`），不重做目录身份解析。
   */
export function runMigration(index: DocIndexState, opts?: { batch?: number }): MigrateResult {
    const batch = opts?.batch ?? 64;
    const ctx = index.ctxOf();
    const result: MigrateResult = { migrated: 0, unchanged: 0, failed: 0, historyPool: 0 };
    // 已处理过的标识（持久化，见 `cursors` 注释）
    const done = (key: string): Set<string> => new Set(index.cursors[key] ?? []);
    const pool: HistoryPoolEntry[] = [];

    // ---- M5：mindcanvas.library.v1 → DocIndexEntry（分批惰性、逐条 try/catch）
    const libRead = index.readJSON(LEGACY_LIBRARY_KEY);
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
          // 同一个旧键可能已经以**别的身份**存在于索引里（兼容模式打开过它 → `browser::`）。
          // 那时不能再造一条 `ws:` 条目——同一份文档两条身份 = 「最近」出现重复行。
          // 只认领到既有条目上（补 legacyKeys）。
          //
          // **必须限定当前作用域**：否则「本区有证据」会变成把他区同名条目标成本区
          // 历史键的凭据（评审 R2-3）。`browser:local` 就是它自己的作用域，
          // 故兼容模式那一路仍然命中。
          const existing = index.docs.find(
            (e) =>
              e.scopeId === ctx.scopeId &&
              (e.relPath === key || e.legacyKeys.includes(`${LEGACY_LIBRARY_KEY}#${key}`)),
          );
          if (existing === undefined) {
            // 没有既有条目：`library.v1` 的 `id` 只是**文件名**，不是目录身份。
            // 凭「唯一同名命中 + 本区有历史」就造 `ws:<uuid>::<文件名>`，
            // 等于把同名命中当归属证据（§6.2.1 明文禁止）；`openedAt` 也只能编造。
            // → 一律进历史池，由用户显式关联（`relink`）。
            pool.push({
              key,
              kind: 'library',
              name,
              openedAt: null, // 旧库只有访问时间，没有真实打开时间 → 不编造（UD-2）
              savedAt: ts,
              // 无证据（§6.2.1）与「本区有证据但索引里没有这条文档」在用户看来
              // 都只能靠显式「关联到此工作区」解决；作用域已失效（ephemeral）
              // 则连关联都无意义，要分别标注。
              reason: !ctx.persisted
                ? 'ephemeral-scope'
                : existing === undefined && !ctx.hasHistoryEvidence
                  ? 'no-evidence'
                  : 'no-existing-entry',
              legacyKeys: [`${LEGACY_LIBRARY_KEY}#${key}`],
            });
            continue;
          }
          const outcome = index.adoptDoc({
            docKey: existing.docKey,
            relPath: existing.relPath ?? key,
            name: existing.name,
            legacyKey: `${LEGACY_LIBRARY_KEY}#${key}`,
            // 旧库的访问时间是**真值**：既有条目若是刚在这次会话登记出来的
            // （`registerDoc` 把 savedAt 记成 now），应当由旧库的 ts 覆盖，
            // 否则「最近」会把一个旧文档显示成本次会话才动过。
            savedAt: ts,
            starred: false,
            scopeId: existing.scopeId,
            sourceRef: existing.sourceRef,
            ...(existing.ephemeral === true || !ctx.persisted
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
    const starRead = index.readJSON(LEGACY_STARRED_KEY);
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
          // M6 明文：「只有该键能按 docKey **精确命中**索引条目时才迁移」。
          //
          // 关键限定（§6.2.1 第 1 行 + 第 5 行）：**精确命中本身不是归属证据**。
          // 命中条目必须
          //   ① 属于**当前作用域**（`scopeId === ctx.scopeId`）——索引里另一工作区的
          //      同名条目不能替当前作用域认领这条旧收藏；
          //   ② 不是 `ephemeral`（上次会话的 disk-session，scopeId 本次已无效）；
          //   ③ 该作用域本次以 isSameEntry / 用户确认建立（`hasOwnershipEvidence`）。
          // 少任何一条就退到「证据不足」→ 历史池：宁可让用户显式关联，
          // 也不能把「恰好同名」当成「就是它」。
          // 两道命中都要**同时**满足作用域条件：`docKey` 分支也必须查作用域
          // （`ws:OTHER::x` 是另一工作区的条目，不能替当前作用域认领这条旧键）。
          const hit = index.docs.find(
            (e) => e.scopeId === ctx.scopeId && (e.docKey === key || e.relPath === key),
          );
          const bound = hit !== undefined && hit.ephemeral !== true;
          if (!bound || !hasOwnershipEvidence(ctx, hit.relPath ?? key)) {
            pool.push({
              key,
              kind: 'starred',
              name: fileNameOf(key),
              openedAt: null,
              savedAt: 0,
              reason: hit !== undefined && hit.ephemeral === true ? 'ephemeral-scope' : 'no-evidence',
              legacyKeys: [`${LEGACY_STARRED_KEY}#${key}`],
            });
            continue;
          }
          const outcome = index.adoptDoc({
            docKey: hit.docKey,
            relPath: hit.relPath ?? key,
            name: hit.name,
            legacyKey: `${LEGACY_STARRED_KEY}#${key}`,
            // M6 不带时间：收藏迁移沿用条目自己的 savedAt（0 = 「别动既有时间」）
            savedAt: 0,
            starred: true,
            scopeId: hit.scopeId,
            sourceRef: hit.sourceRef,
            ephemeral: hit.ephemeral,
          });
          if (outcome === 'new') result.migrated += 1;
          else result.unchanged += 1;
        } catch {
          result.failed += 1;
        }
      }
    }

    // ---- M7：mindcanvas.assets.fav（键 = `kind:id`）→ AssetIndexEntry.starred
    //
    // 键的真实形态是 `` `${a.kind}:${a.id}` ``，`a.kind ∈ {'img','draw'}`
    // （`packages/react/src/chrome/assetTypes.ts:7`；写入点 `AssetPanel.tsx:151/367`），
    // `a.id` 是**资产 id**：`assets/<rel>` / `builtin:<id>` / data URL
    // （shared-contracts §1.5 的 `AssetRef.id` 取值）。
    //
    // 归属判定（§6.2 M7 + §6.2.1）：
    //   - `builtin:` / `data:` → 自包含引用，**不属于任何作用域**（I-5）→ 可直接迁移；
    //   - `assets/<rel>` → 磁盘项：需 `(scopeId, relPath)` 且该作用域本次已证明同一目录
    //     → 否则（含唯一同名命中）进历史池。**绝不能**靠猜前缀决定。
    const favRead = index.readJSON(LEGACY_ASSET_FAV_KEY);
    const favRaw = favRead.value;
    if (favRead.kind === 'ok' && Array.isArray(favRaw)) {
      const seen = done(LEGACY_ASSET_FAV_KEY);
      const pending = favRaw.filter((k) => typeof k !== 'string' || !seen.has(k));
      for (const key of pending.slice(0, batch)) {
        try {
          const parsed = parseAssetFavKey(key);
          if (parsed === null) {
            result.failed += 1; // 切不出合法 `kind:id`：不迁移、不猜归属、不删旧键
            continue;
          }
          const { assetId, selfContained } = parsed;
          // `existing` 必须限定在当前作用域内：他区的同名资产不得被本区旧键认领。
          // 否则本条目永远命中「已存在」分支，「无证据 → 历史池」分支不可达
          // （评审 R2 中风险项：M7 跨作用域复用）。
          const ownScope = (a: AssetIndexEntry): boolean =>
            selfContained ? a.scopeId === BROWSER_SCOPE_ID : ctx.persisted && a.scopeId === ctx.scopeId;
          const existing = index.assets.find(
            (a) => ownScope(a) && (a.assetKey === assetId || a.legacyKeys.includes(key)),
          );
          if (existing !== undefined) {
            if (existing.starred) {
              result.unchanged += 1;
            } else {
              index.assets = index.assets.map((a) =>
                a === existing
                  ? { ...a, starred: true, legacyKeys: appendUnique(a.legacyKeys, key) }
                  : a,
              );
              result.migrated += 1;
            }
            continue;
          }
          const relPath = selfContained ? null : assetId;
          if (!selfContained && !hasOwnershipEvidence(ctx, relPath)) {
            pool.push({
              key,
              kind: 'asset-fav',
              name: nameOf(assetId),
              openedAt: null,
              savedAt: 0,
              reason: 'no-evidence',
              legacyKeys: [`${LEGACY_ASSET_FAV_KEY}#${key}`],
            });
            continue;
          }
          index.assets = [
            ...index.assets,
            {
              assetKey: assetId,
              scopeId: BROWSER_SCOPE_ID,
              relPath,
              name: nameOf(assetId),
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
    const recentRead = index.readJSON(LEGACY_CANVAS_RECENT_KEY);
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
          const prev = index.getDoc(docKey);
          if (prev) {
            if (prev.legacyKeys.includes(LEGACY_CANVAS_RECENT_KEY)) {
              result.unchanged += 1; // 幂等：二次迁移不再改动
            } else {
              index.docs = index.docs.map((e) =>
                e.docKey === docKey
                  ? { ...e, legacyKeys: appendUnique(e.legacyKeys, LEGACY_CANVAS_RECENT_KEY) }
                  : e,
              );
              result.migrated += 1;
            }
            continue;
          }
          index.docs = [
            ...index.docs,
            {
              docKey,
              scopeId: BROWSER_SCOPE_ID,
              relPath: null,
              lineageId: index.makeLineageId(),
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

    // ---- M9：`mindcanvas-handles` 的双读 + 双写（§6.2）。
    //
    //  读侧：包侧 `getFileHandle(docId)` 已经是「新键未命中 → 读旧键」，
    //        P0-D 不改它（改它属于包 / P0-A 的范围）。
    //  写侧：规范要求「命中后**同时**写新键（`file-handle.v1:<docKey>` 富记录）
    //        与旧键（裸句柄）」。富记录键**在包侧尚不存在**——
    //        `packages/react/src/edit/handleStore.ts` 只有单键 `docId`，
    //        没有富记录 API。在 P0-D 里凭空造一个「读旧键再写回同一个旧键」
    //        的镜像**不是双写**（它没有写任何新键，纯属空转），
    //        只会制造「写侧已实现」的假象。故此处**不实现**，
    //        如实记为未完成项：M9 写侧依赖包侧富记录 API（不由本包提供）。
    //
    // 索引侧仍然登记旧 `docId`（`noteHandleId`），保留给包侧将来消费。

    // ---- M11：注册表 legacy adoption 由 P0-0 完成，这里只承接其证据位
    //      （`migrateContextOf` → `hasOwnershipEvidence`），不重做身份解析。

    // 推进进度（走完全部旧键就归零，下次从头做一遍幂等复核）
    index.cursors[LEGACY_LIBRARY_KEY] = progress(
      done(LEGACY_LIBRARY_KEY),
      idsOf(libRaw),
      batch,
    );
    index.cursors[LEGACY_STARRED_KEY] = progress(
      done(LEGACY_STARRED_KEY),
      stringsOf(starRaw),
      batch,
    );
    index.cursors[LEGACY_ASSET_FAV_KEY] = progress(
      done(LEGACY_ASSET_FAV_KEY),
      stringsOf(favRaw),
      batch,
    );
    index.cursors[LEGACY_CANVAS_RECENT_KEY] = progress(
      done(LEGACY_CANVAS_RECENT_KEY),
      idsOf(recentRaw),
      batch,
    );

    // 同一旧键可能同时出现在多个旧库（如 `library.v1` 与 `starred.v1` 都有它）：
    // 历史池按 key 去重，否则用户会看到同一条记录出现两次。
    index.history = [...new Map(pool.map((h) => [h.key, h])).values()];
    result.historyPool = index.history.length;
    index.wrote = true;
    const written = index.persist();
    const projected = index.project(written);
    index.projectionFailed = !projected;
    return result;
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

/**
 * 解析旧资产收藏键 `` `${kind}:${id}` `` → `{ assetId, selfContained }`。
 *
 * `kind` 的取值域是 `AssetItem.kind`（`'img' | 'draw'`，见 `assetTypes.ts:7`）。
 * 非法输入返回 `null`（调用方记为未迁移，**不猜归属**）：
 * 旧实现把前缀猜成 `idb:` / `disk:`，于是一切真实键都走「无证据」分支，
 * 「磁盘项需 (scopeId, relPath) 且已证明同一目录」在生产上根本不可达。
 *
 * `id` 自身可含 `:`（`builtin:<id>` / `data:image/svg+xml;…`），
 * 所以只切**第一个**冒号，其余原样保留。
 */
export function parseAssetFavKey(
  key: string,
): { kind: 'img' | 'draw'; assetId: string; selfContained: boolean } | null {
  const sep = key.indexOf(':');
  if (sep <= 0) return null;
  const kind = key.slice(0, sep);
  if (kind !== 'img' && kind !== 'draw') return null;
  const assetId = key.slice(sep + 1);
  if (assetId === '') return null;
  // I-5：self-contained 引用不属于任何工作区作用域
  const selfContained = assetId.startsWith('builtin:') || assetId.startsWith('data:');
  return { kind, assetId, selfContained };
}
