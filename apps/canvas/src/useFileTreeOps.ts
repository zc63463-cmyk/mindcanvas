/**
 * 文件工作台的**目录操作**（P0-D · 从 FileManager.tsx 拆出）。
 *
 * 拆分动因：FileManager.tsx 逼近代码预算的 `bigFiles` 红线（600 行）。
 * 这些操作两条分支（工作区真实磁盘 / 兼容模式虚拟目录）的差别与组件状态无关，
 * 只依赖「宿主 + 库 + 重载回调」。
 *
 * 语义与拆分前**逐行一致**（A-D3 的内联确认条口径不变：删除先置待确认目标，
 * 不用 `window.confirm` —— 它在 webview 里会被静默吞掉）。
 */
import { useCallback } from 'react';
import type { DocLibrary } from '@mindcanvas/react';
import type { TreeNode } from './fileTreeModel.js';
import { canDropInto } from './fileTreeModel.js';
import { NEW_DOC_TEMPLATE } from './fileManagerShared.js';
import type { WorkspaceLike } from './FileManagerWiring.js';

export interface FileTreeOps {
  createDocIn: (dirPath: string) => Promise<void>;
  createDirIn: (parentPath: string, name: string) => Promise<void>;
  doRemove: (node: TreeNode) => Promise<void>;
  commitRename: (node: TreeNode, nextName: string) => Promise<void>;
  dropInto: (node: TreeNode, target: TreeNode) => Promise<void>;
  confirmTarget: (node: TreeNode) => void;
}

export function useFileTreeOps(input: {
  library: DocLibrary;
  workspace: WorkspaceLike | null;
  useWorkspace: boolean;
  tree: readonly TreeNode[];
  onCreate: () => void;
  reload: () => Promise<void>;
  refresh: () => void;
  setDropTarget: (v: string | null) => void;
  setRenamingKey: (v: string | null) => void;
  setPendingDelete: (node: TreeNode | null) => void;
  /**
   * 移动/归位失败的用户可见出口（P1-A ⑥ 起必需）。
   *
   * 为什么必须是**显式回调**而不是就地打一条开发日志：失败需要用户读到
   * （「权限被拒」的恢复路径是重新授权，与「磁盘不可用」不同），
   * 且文案必须来自 `assetNotices` 的唯一事实源（不得在这里拼第二套说法）。
   */
  onMoveFailed: (error: unknown, node: TreeNode) => void;
}): FileTreeOps {
  const {
    library,
    workspace,
    useWorkspace,
    tree,
    onCreate,
    reload,
    refresh,
    setDropTarget,
    setRenamingKey,
    setPendingDelete,
    onMoveFailed,
  } = input;

  const createDocIn = useCallback(
    async (dirPath: string): Promise<void> => {
      if (useWorkspace && workspace) {
        await workspace.createFile(dirPath, '未命名.mm.md', NEW_DOC_TEMPLATE);
        await reload();
        return;
      }
      onCreate();
    },
    [useWorkspace, workspace, reload, onCreate],
  );

  const createDirIn = useCallback(
    async (parentPath: string, name: string): Promise<void> => {
      const trimmed = name.trim();
      if (!trimmed) return;
      if (useWorkspace && workspace) {
        await workspace.createDir(parentPath, trimmed);
        await reload();
        return;
      }
      // 兼容模式：直接维护本地自定义目录集合
      const full = parentPath === '' ? trimmed : `${parentPath}/${trimmed}`;
      library.addFolder(full);
      await reload();
    },
    [useWorkspace, workspace, library, reload],
  );

  /** A-D3：删除确认入口——置入待确认目标（window.confirm 在 webview 会被静默吞掉） */
  const confirmTarget = useCallback(
    (node: TreeNode): void => setPendingDelete(node),
    [setPendingDelete],
  );

  const doRemove = useCallback(
    async (node: TreeNode): Promise<void> => {
      setPendingDelete(null);
      if (useWorkspace && workspace) {
        if (node.type === 'dir' && node.wsDir) await workspace.removeDir(node.wsDir);
        if (node.type === 'doc' && node.wsFile) await workspace.removeFile(node.wsFile);
        await reload();
        return;
      }
      if (node.type === 'dir') {
        library.removeFolder(node.fullPath);
        await reload();
        return;
      }
      if (node.entry) library.remove(node.entry.id);
      await reload();
    },
    [useWorkspace, workspace, library, reload, setPendingDelete],
  );

  const commitRename = useCallback(
    async (node: TreeNode, nextName: string): Promise<void> => {
      const name = nextName.trim();
      setRenamingKey(null);
      if (name === '' || name === node.name) return;
      if (useWorkspace && workspace) {
        if (node.type === 'doc' && node.wsFile) await workspace.renameFile(node.wsFile, name);
        await reload();
        return;
      }
      if (node.entry) library.rename(node.entry.id, name);
      refresh();
    },
    [useWorkspace, workspace, library, reload, refresh, setRenamingKey],
  );

  /**
   * 拖拽归位：落到目标目录（取代旧版「手敲路径字符串」）。
   *
   * P1-A ⑥ 起它同时是**归档的落点入口**（「改为归档」= 移到 `_归档/`）。
   * 因此必须有**可判别的失败出口**：旧实现直接 `await workspace.moveFile(...)`
   * 且在编排器里没有 `catch`（R-02/R-03 登记的缺口），失败会变成
   * **未处理的 Promise 拒绝** —— 用户看不到任何反馈，树也不会刷新
   * （这正是负控 5「失败不留幽灵」要钉住的形态；实测由
   * `file-manager-archive.test.tsx` 的失败路径用例捕获为 unhandled rejection）。
   *
   * 失败时的行为：
   *  - **不**刷新树（磁盘没变，刷了只会让用户以为成功了）；
   *  - 通过 `onMoveFailed` 把错误交给调用方（文案由 `assetNotices` 唯一事实源给）；
   *  - 成功才 `reload()`，因此树里不会出现幽灵条目。
   */
  const dropInto = useCallback(
    async (node: TreeNode, target: TreeNode): Promise<void> => {
      setDropTarget(null);
      if (!canDropInto(node.key, target.fullPath, tree)) return;
      if (useWorkspace && workspace) {
        try {
          if (node.type === 'doc' && node.wsFile) {
            await workspace.moveFile(node.wsFile, target.fullPath);
          }
          await reload();
        } catch (e) {
          onMoveFailed(e, node);
        }
        return;
      }
      if (node.entry) library.move(node.entry.id, target.fullPath);
      refresh();
    },
    [useWorkspace, workspace, library, tree, reload, refresh, setDropTarget, onMoveFailed],
  );

  return { createDocIn, createDirIn, doRemove, commitRename, dropInto, confirmTarget };
}
