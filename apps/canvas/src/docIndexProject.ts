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
 * ③ `mindcanvas-handles` 旧 `docId` 键 ← 裸句柄（见 `docIndex.ts` 的 `mirrorHandles`）。
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
export function projectLibrary(index: ProjectionState): number {
    try {
      const prevRead = index.readJSON(LEGACY_LIBRARY_KEY);
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
export function projectStarred(index: ProjectionState, orphanCount: number): boolean {
    try {
      const prevRead = index.readJSON(LEGACY_STARRED_KEY);
      const prevKeys =
        prevRead.kind === 'ok' && Array.isArray(prevRead.value)
          ? prevRead.value.filter((k): k is string => typeof k === 'string')
          : [];
      const indexedLegacyKeys = new Set(index.docs.filter((e) => e.starred).map(legacyIdOf));
      // 被显式取消收藏的键：曾经在旧集合里、现在索引里有条目但 starred=false
      const explicitlyUnstarred = new Set(
        index.docs.filter((e) => !e.starred).map(legacyIdOf),
      );
      const out = new Set<string>();
      for (const k of prevKeys) {
        if (indexedLegacyKeys.has(k)) out.add(k);
        else if (!explicitlyUnstarred.has(k)) out.add(k); // 孤儿/历史池项：保留
      }
      for (const k of indexedLegacyKeys) out.add(k);
      index.store.set(LEGACY_STARRED_KEY, JSON.stringify([...out]));
      // orphanCount 仅用于让调用方读懂「为什么是并集而不是覆盖」，不影响结果
      void orphanCount;
      return true;
    } catch {
      return false;
    }
  }

