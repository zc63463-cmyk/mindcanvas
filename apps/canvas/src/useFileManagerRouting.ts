/**
 * 文件工作台的**当前文档操作路由**（P0-A · 从 `FileManager.tsx` 拆出）。
 *
 * 拆分动因：`FileManager.tsx` 逼近代码预算的 `bigFiles` 红线（600 行），
 * 而这块（分流 + 冲突三选状态）只依赖「当前文档判定 + 既有树操作 + 编排控制器」，
 * 与渲染无关。
 *
 * 为什么必须分流（而不是让 `useFileTreeOps` 全部改走 `*Safe`）：只有**当前文档**
 * 需要租约、I-14 前置与目的地重绑；其他节点的普通操作保持既有语义不变
 * （既有用例对它们有断言，见 acceptance §4「必须一起核对的既有断言边界」）。
 */
import { useCallback, useState } from 'react';
import type { WorkspaceFile } from '@mindcanvas/react';
import type { RenameConflictChoice } from './FileOpPanels.js';
import type { CurrentDocOps } from './currentDocOps.js';
import type { TreeNode } from './fileTreeModel.js';

interface ConflictState {
  file: WorkspaceFile;
  /** 用户选择的最终名（保留两份时是序号名，替换时是原名） */
  reapply(name: string, overwrite: boolean): void;
  keepBothName: string;
}

export interface FileManagerRouting {
  /** 改名冲突三选状态；null = 无冲突 */
  conflict: ConflictState | null;
  onConflictChoose(choice: RenameConflictChoice): void;
  isCurrentDoc(file: WorkspaceFile): boolean;
  /** 改名入口（路由到编排或既有 commitRename） */
  requestRename(file: WorkspaceFile, name: string): void;
  /** 删除入口（当前文档走 F2，其余走既有确认条） */
  requestDelete(node: TreeNode): void;
  /** 树内联改名的路由包装（`FileManagerTree` 只认 `(node, name)`） */
  commitRenameRouted(node: TreeNode, nextName: string): void;
  /** 拖拽归位：当前文档走重绑编排（新目的地），其余走既有 moveFile */
  dropIntoRouted(node: TreeNode, target: TreeNode): void;
}

export function useFileManagerRouting(input: {
  currentDocOps: CurrentDocOps | null;
  allDocs: readonly TreeNode[];
  commitRename(node: TreeNode, nextName: string): Promise<void>;
  dropInto(node: TreeNode, target: TreeNode): Promise<void>;
  confirmTarget(node: TreeNode): void;
  setPendingDelete(node: TreeNode | null): void;
  setRenamingKey(key: string | null): void;
  setDropTarget(v: string | null): void;
}): FileManagerRouting {
  const {
    currentDocOps,
    allDocs,
    commitRename,
    dropInto,
    confirmTarget,
    setPendingDelete,
    setRenamingKey,
    setDropTarget,
  } = input;
  const [conflict, setConflict] = useState<ConflictState | null>(null);

  const isCurrentDoc = useCallback(
    (file: WorkspaceFile): boolean =>
      currentDocOps !== null && currentDocOps.currentPath === file.path,
    [currentDocOps],
  );

  const requestRename = useCallback(
    (file: WorkspaceFile, name: string): void => {
      if (currentDocOps === null || !isCurrentDoc(file)) {
        const node = allDocs.find((d) => d.wsFile === file);
        if (node) void commitRename(node, name);
        return;
      }
      void (async () => {
        const dirPath = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
        const keepBoth = await currentDocOps.resolveConflictName(dirPath, name);
        if (keepBoth === name) {
          // 无冲突：直接改名
          void currentDocOps.rename(file, name);
          return;
        }
        // 目标已存在 → 冲突三选（不静默加序号、不静默覆盖，§5.2②）
        setConflict({
          file,
          keepBothName: keepBoth,
          reapply: (finalName, overwrite) => void currentDocOps.rename(file, finalName, overwrite),
        });
      })();
    },
    [currentDocOps, isCurrentDoc, commitRename, allDocs],
  );

  const onConflictChoose = useCallback(
    (choice: RenameConflictChoice): void => {
      const current = conflict;
      setConflict(null);
      if (current === null || choice === 'cancel') return; // 取消 → 零 I/O
      // 「保留两份」→ 用序号名且不覆盖；「替换目标文件」→ 原名 + overwrite
      if (choice === 'keep-both') current.reapply(current.keepBothName, false);
      else current.reapply(current.file.name, true);
    },
    [conflict],
  );

  const requestDelete = useCallback(
    (node: TreeNode): void => {
      if (currentDocOps !== null && node.wsFile && isCurrentDoc(node.wsFile)) {
        setPendingDelete(null);
        void currentDocOps.delete(node.wsFile);
        return;
      }
      confirmTarget(node);
    },
    [currentDocOps, isCurrentDoc, confirmTarget, setPendingDelete],
  );

  const commitRenameRouted = useCallback(
    (node: TreeNode, nextName: string): void => {
      if (currentDocOps !== null && node.wsFile && isCurrentDoc(node.wsFile)) {
        setRenamingKey(null);
        const name = nextName.trim();
        if (name === '' || name === node.name) return; // 与源同名 → 零 I/O 取消
        requestRename(node.wsFile, name);
        return;
      }
      void commitRename(node, nextName);
    },
    [currentDocOps, isCurrentDoc, requestRename, commitRename, setRenamingKey],
  );

  const dropIntoRouted = useCallback(
    (node: TreeNode, target: TreeNode): void => {
      setDropTarget(null);
      if (currentDocOps !== null && node.wsFile && isCurrentDoc(node.wsFile)) {
        void currentDocOps.move(node.wsFile, target.fullPath);
        return;
      }
      void dropInto(node, target);
    },
    [currentDocOps, isCurrentDoc, dropInto, setDropTarget],
  );

  return {
    conflict,
    onConflictChoose,
    isCurrentDoc,
    requestRename,
    requestDelete,
    commitRenameRouted,
    dropIntoRouted,
  };
}
