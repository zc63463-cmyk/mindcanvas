/**
 * 当前文档操作面（P0-A）—— `FileManager` 与其拆分子模块共用的**类型**。
 *
 * 为什么单独一层：`FileManager.tsx` 是这些模块的组装点，若类型定义留在它里面，
 * 拆出的 `useFileManagerRouting` / `FileManagerOpStack` 就要反向 import 组装点，
 * 形成循环依赖（dependency-cruiser `no-circular` 会拦）。
 */
import type { WorkspaceFile } from '@mindcanvas/react';
import type { PartialChoice, RenameDirtyChoice } from './FileOpPanels.js';

/**
 * P0-A：当前文档操作面（由 `useFileOpController` + `useCurrentDocDeleteFlow` 组装）。
 *
 * 为什么用「回调包」而不是把 hook 塞进面板：面板只该渲染，不该知道租约/目的地。
 */
export interface CurrentDocOps {
  /** 当前文档的相对路径（判断「是不是当前文档」） */
  currentPath: string | null;
  /** UI 待决状态（三块面板 + 提示） */
  ui: {
    dirtyChoice: { name: string; apply: (choice: RenameDirtyChoice) => void } | null;
    partial:
      | {
          createdPath: string;
          sourcePath: string;
          reason: string;
          copyHasNewChanges: boolean;
          apply: (choice: PartialChoice) => void;
        }
      | null;
    notice: string | null;
  };
  /** 改名（含冲突三选：目标已存在时由面板先问，再带 overwrite 重入） */
  rename(file: WorkspaceFile, nextName: string, overwrite?: boolean): Promise<void>;
  /** 移动 */
  move(file: WorkspaceFile, targetDir: string): Promise<void>;
  /** 创建副本 */
  duplicate(file: WorkspaceFile): Promise<void>;
  /** 删除（F2 流程，含确认条） */
  delete(file: WorkspaceFile): Promise<void>;
  /** 冲突三选：先算「保留两份」的名字 */
  resolveConflictName(dirPath: string, name: string): Promise<string>;
  dismissNotice(): void;
}
