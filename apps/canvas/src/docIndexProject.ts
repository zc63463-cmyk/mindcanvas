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
export function projectLibrary(index: ProjectionState): boolean {
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

      // 索引无条目、旧结构也没有（或本就不合法）→ **不写**：
      // `replaceAll([])` 会把旧结构抹成空，既丢数据又白搭一次写。
      // 这不是失败（没有东西要写），故返回 true。
      if (rows.length === 0) return true;

      new DocLibrary().replaceAll(rows);
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

