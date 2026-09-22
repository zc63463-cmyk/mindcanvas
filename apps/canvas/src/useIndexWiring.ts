/**
 * 文件工作台的**索引接线**（P0-D · 从 FileManager.tsx 拆出）。
 *
 * 拆分动因：FileManager.tsx 逼近代码预算的 `bigFiles` 红线（600 行）；
 * 而「迁移 → 登记 → 打开推进 openedAt → 历史池/未迁移反馈」是一条独立的因果链，
 * 与树的渲染无关，放在单独模块里反而更容易读懂。
 *
 * 语义要点：
 * - 迁移是**惰性、分批、幂等、可中断续跑**的，没有一键批量入口；
 * - `openedAt` 只在**用户真的打开**时推进（扫树/刷新面板不算，UD-2）；
 * - 索引是可变对象而非 React state，所以每次写后显式触发一次重渲染。
 */
import { useCallback, useState } from 'react';
import type {
  DocIndex,
  HistoryPoolEntry,
} from './docIndex.js';
import type { TreeNode } from './fileTreeModel.js';
import { docKeyOfEntry, workspaceScopePersisted, type WorkspaceLike } from './FileManagerWiring.js';

/** 迁移批量（每次打开面板推进一批；幂等，重复调不产生重复条目） */
export const MIGRATE_BATCH = 64;

export interface IndexWiring {
  /** 历史池（§6.2.1）：旧记录没有归属证据时的落点，默认折叠 */
  history: HistoryPoolEntry[];
  /** 惰性迁移的失败条目数（>0 → 提示「未迁移」，不伪报完成） */
  migrateFailed: number;
  /**
   * 降级投影是否写失败（§6.3：投影失败 → 该次变更**不可回退**）。
   * 生产读取面：面板据此给出可重试提示，而不是把「已升级」当成「随时可回退」。
   */
  projectionFailed: boolean;
  /** 历史池折叠状态 */
  historyOpen: boolean;
  setHistoryOpen: (updater: (v: boolean) => boolean) => void;
  /** 惰性迁移一批，并刷新历史池/失败计数 */
  runMigration: () => void;
  /** 把树里的文档登记进索引（不推进任何时间） */
  registerDocs: (docs: readonly TreeNode[]) => void;
  /** 用户真的打开某文档：推进 `openedAt` */
  markOpened: (docKey: string, relPath: string | null, name: string) => void;
  /** 索引写后强制重渲染 */
  refresh: () => void;
}

/**
 * `useIndexWiring(index, { useWorkspace, workspace })`
 *
 * `alive` 由调用方给出（`{ current: boolean }`），避免在卸载后写 state。
 */
export function useIndexWiring(
  index: DocIndex | null,
  opts: { useWorkspace: boolean; workspace: WorkspaceLike | null; alive: { current: boolean } },
): IndexWiring {
  const { useWorkspace, workspace, alive } = opts;
  const [history, setHistory] = useState<HistoryPoolEntry[]>([]);
  const [migrateFailed, setMigrateFailed] = useState(0);
  const [projectionFailed, setProjectionFailed] = useState(false);
  const [historyOpen, setHistoryOpenRaw] = useState(false);
  const [, forceRender] = useState(0);
  const refresh = useCallback((): void => forceRender((n) => n + 1), []);

  const syncProjectionState = useCallback((): void => {
    if (!index || !alive.current) return;
    setProjectionFailed(index.projectionStatus().projectionFailed);
  }, [index, alive]);

  const runMigration = useCallback((): void => {
    if (!index) return;
    try {
      const migrated = index.migrate({ batch: MIGRATE_BATCH });
      if (alive.current) {
        setHistory(index.historyPool());
        setMigrateFailed(migrated.failed);
        setProjectionFailed(index.projectionStatus().projectionFailed);
        refresh();
      }
    } catch {
      // 迁移抛错也要让「未迁移」可见：它正是用户唯一能看到的失败信号
      if (alive.current) setMigrateFailed((n) => Math.max(n, 1));
    }
  }, [index, alive, refresh]);

  const registerDocs = useCallback(
    (docs: readonly TreeNode[]): void => {
      if (!index) return;
      const scopeId = useWorkspace && workspace?.scopeId ? workspace.scopeId : null;
      const persisted = workspaceScopePersisted(workspace);
      for (const d of docs) {
        index.registerDoc({
          docKey: docKeyOfEntry(d, scopeId),
          relPath: d.fullPath,
          name: d.name,
          scopeId: scopeId ?? 'browser:local',
          persisted,
          sourceRef: d.wsFile ? { kind: 'disk-handle' } : { kind: 'none' },
          // M9 双写写侧：工作区文件的旧 docId 就是它的相对路径
          // （`openWorkspaceFile` 用 `id: file.path`），登记后才会补写裸句柄键。
          handleId: d.wsFile ? d.fullPath : undefined,
        });
      }
      if (alive.current) {
        setHistory(index.historyPool());
        syncProjectionState();
        refresh();
      }
    },
    [index, useWorkspace, workspace, alive, refresh, syncProjectionState],
  );

  const markOpened = useCallback(
    (docKey: string, relPath: string | null, name: string): void => {
      if (!index) return;
      index.openDoc({ docKey, relPath, name });
      if (alive.current) {
        setHistory(index.historyPool());
        syncProjectionState();
        refresh();
      }
    },
    [index, alive, refresh, syncProjectionState],
  );

  const setHistoryOpen = useCallback((updater: (v: boolean) => boolean): void => {
    setHistoryOpenRaw((v) => updater(v));
  }, []);

  return {
    history,
    migrateFailed,
    projectionFailed,
    historyOpen,
    setHistoryOpen,
    runMigration,
    registerDocs,
    markOpened,
    refresh,
  };
}
