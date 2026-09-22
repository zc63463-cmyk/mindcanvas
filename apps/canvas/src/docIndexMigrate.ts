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
  wsDocKey,
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
  mirrorHandles(): void;
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
          const existing = index.docs.find(
            (e) => e.relPath === key || e.legacyKeys.includes(`${LEGACY_LIBRARY_KEY}#${key}`),
          );
          const outcome = index.adoptDoc({
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
          // M6 明文：「只有该键能按 docKey **精确命中**索引条目时才迁移」
          const exact = index.docs.find((e) => e.docKey === key || e.relPath === key);
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
          const outcome = index.adoptDoc({
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
    const favRead = index.readJSON(LEGACY_ASSET_FAV_KEY);
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
          const existing = index.assets.find(
            (a) => a.assetKey === key || a.assetKey === id0 || a.legacyKeys.includes(key),
          );
          if (existing) {
            void id0;
            if (existing.starred) {
              result.unchanged += 1;
            } else {
              index.assets = index.assets.map((a) =>
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
          index.assets = [
            ...index.assets,
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

    // ---- M9：旧 `docId` 裸句柄键（双读 + 双写）。
    //      读侧（新键未命中 → 读旧键）在包侧既有 `getFileHandle`；
    //      写侧在此：把**本会话已知可取的句柄**补写到旧 `docId` 键，使回退版本仍可用。
    void index.mirrorHandles();

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

    index.history = pool;
    result.historyPool = pool.length;
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
