/**
 * 「最近打开」与「收藏星标」两个平铺视图的**行解析**（P1-A · 从 `FileManager.tsx` 拆出）。
 *
 * 拆分动因：`FileManager.tsx` 逼近 `bigFiles` 红线（600 行）。这两块只依赖
 * 「树 + 索引 + 搜索口径」，与树的渲染和当前文档编排无关。
 *
 * 语义（P0-D 定稿，本轮**不改**）：
 * - 「最近」是**唯一入口**，按 `openedAt` 降序（索引层 `compareRecent`），
 *   `openedAt === null` 排末尾并显示「未记录打开时间」——**不回落 mtime**（UD-2）；
 * - 无索引（旧调用方）时退化为按树里的 `ts` 排序，仅供降级与旧测试；
 * - 收藏按索引的稳定身份判定（`docKey` / `relPath` / 旧键三个别名都认）。
 *
 * P1-A ② 增量：搜索口径加一路**内部标题**（与树视图同一份 `matchQuery`，
 * 避免「树能搜到标题、最近搜不到」两套口径）。
 */
import { useCallback, useMemo } from 'react';
import type { DocIndex, DocIndexEntry } from './docIndex.js';
import { RECENT_MAX } from './docIndex.js';
import {
  nodeIndex,
  rowFromIndexEntry,
  rowFromNode,
} from './FileManagerWiring.js';
import type { FlatRow } from './FileManagerViews.js';
import { formatRelative } from './fileManagerShared.js';
import type { TreeNode } from './fileTreeModel.js';

export function useFlatDocRows(input: {
  index: DocIndex | null;
  allDocs: readonly TreeNode[];
  starredKeys: ReadonlySet<string>;
  hasQuery: boolean;
  query: string;
}): { recentRows: FlatRow[]; starredRows: FlatRow[] } {
  const { index, allDocs, starredKeys, hasQuery, query } = input;

  /** 树节点查询（「最近」/「收藏」两个视图共用；②标题搜索同一口径） */
  const matchQuery = useCallback(
    (rows: readonly TreeNode[]): TreeNode[] => {
      if (!hasQuery) return [...rows];
      const q = query.trim().toLowerCase();
      return rows.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.fullPath.toLowerCase().includes(q) ||
          (typeof d.title === 'string' && d.title.toLowerCase().includes(q)),
      );
    },
    [hasQuery, query],
  );

  const recentRows = useMemo((): FlatRow[] => {
    if (!index) {
      // 无索引（旧调用方）：退化为按树里的 ts 排序，仅供降级与旧测试使用。
      // 生产路径由 MindmapStage 注入索引（走下面那条，按 openedAt）。
      return matchQuery([...allDocs].sort((a, b) => b.ts - a.ts)).map((d) =>
        rowFromNode(d, formatRelative(d.ts), starredKeys.has(d.fullPath) || starredKeys.has(d.key)),
      );
    }
    const byKey = nodeIndex(allDocs);
    // 显式标注：`recentDocs` 的返回类型在包外声明文件里，闭包内需要窄化类型
    const recent: DocIndexEntry[] = index.recentDocs(RECENT_MAX);
    return recent.flatMap((e) => {
      const row = rowFromIndexEntry(e, byKey, starredKeys, matchQuery);
      return row === null ? [] : [row];
    });
  }, [index, allDocs, matchQuery, starredKeys]);

  const starredRows = useMemo((): FlatRow[] => {
    return matchQuery(
      allDocs
        .filter((d) => starredKeys.has(d.fullPath) || starredKeys.has(d.key))
        .sort((a, b) => b.ts - a.ts),
    ).map((d) => rowFromNode(d, formatRelative(d.ts), true));
  }, [allDocs, starredKeys, matchQuery]);

  return { recentRows, starredRows };
}
