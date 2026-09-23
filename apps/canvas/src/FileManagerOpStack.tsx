/**
 * P0-A：文件工作台的**当前文档操作反馈栈**（从 `FileManager.tsx` 抽出）。
 *
 * 拆分动因：`FileManager.tsx` 逼近代码预算的 `bigFiles` 红线（600 行）。
 * 这块只是「按状态选一块面板渲染」，与树/搜索/迁移无关。
 *
 * 顺序固定：冲突三选 → 未保存三选 → 部分成功 → 提示条。
 * 状态机保证同时只出现一块，但并列渲染不会互相遮挡（多块同时出现时也能看清）。
 */
import type React from 'react';
import type { WorkspaceFile } from '@mindcanvas/react';
import {
  FileOpNotice,
  PartialSuccessPanel,
  RenameConflictPanel,
  RenameDirtyPanel,
  type RenameConflictChoice,
} from './FileOpPanels.js';
import type { CurrentDocOps } from './currentDocOps.js';

export interface FileManagerOpStackProps {
  /** 改名冲突三选的目标（null = 无冲突） */
  conflict: { file: WorkspaceFile; keepBothName: string } | null;
  onConflictChoose(choice: RenameConflictChoice): void;
  /** 当前文档操作面（null = 旧调用方，不渲染任何 P0-A 反馈） */
  currentDocOps: CurrentDocOps | null;
}

export function FileManagerOpStack({
  conflict,
  onConflictChoose,
  currentDocOps,
}: FileManagerOpStackProps): React.ReactElement {
  return (
    <>
      {conflict !== null && (
        <RenameConflictPanel
          name={conflict.file.name}
          keepBothName={conflict.keepBothName}
          onChoose={onConflictChoose}
        />
      )}
      {currentDocOps?.ui.dirtyChoice != null && (
        <RenameDirtyPanel
          name={currentDocOps.ui.dirtyChoice.name}
          onChoose={currentDocOps.ui.dirtyChoice.apply}
        />
      )}
      {currentDocOps?.ui.partial != null && (
        <PartialSuccessPanel
          createdPath={currentDocOps.ui.partial.createdPath}
          sourcePath={currentDocOps.ui.partial.sourcePath}
          reason={currentDocOps.ui.partial.reason}
          copyHasNewChanges={currentDocOps.ui.partial.copyHasNewChanges}
          /*
            在途禁用判据：`useFileOpController` 的 `PartialPanelState.busy`。
            **不得省略这一行** —— `PartialSuccessPanel` 的 `busy` 有 `= false` 默认值，
            漏传会静默退化成「永不禁用」，`disabled={busy}` 变成常量 false，
            连点两下就能对同一个源文件并发 `removeFileSafe`（提示条还会互相覆盖）。
            这正是本轮修掉的那类「守卫在、判据不在」的空转。
          */
          busy={currentDocOps.ui.partial.busy}
          onChoose={currentDocOps.ui.partial.apply}
        />
      )}
      {currentDocOps != null && (
        <FileOpNotice notice={currentDocOps.ui.notice} onDismiss={currentDocOps.dismissNotice} />
      )}
    </>
  );
}
