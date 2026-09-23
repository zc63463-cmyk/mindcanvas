/**
 * 文件工作台的**当前文档文件操作控制面**（P0-A ⑥·⑤·⑦）。
 *
 * 为什么单独一层：`useFileTreeOps` 管的是「兼容/工作区两分支的普通增删改」，
 * 而本层管的是**当前文档**改名/移动/删除/副本的完整时序，以及三块内联反馈面板的状态机。
 * 两者状态不同、可测性诉求不同；混在一起会让 `useFileTreeOps` 变成第二个上帝模块。
 *
 * 分工：
 *  - **非当前文档**的树操作仍走 `useFileTreeOps`（本轮不改其语义）；
 *  - **当前文档**走本层 —— 只有它需要重绑会话目的地并同步 `workspacePath`。
 *
 * L4 外部修改复查的**正确做法**：部分成功时把源文件的 `{size,lastModified}` 快照记在
 * 面板状态里；用户点「重试删除原文件」时**重新读一次**再比对。
 * 绝不能拿同一个快照和自己比（那样永远「未变」，复查形同虚设）。
 */
import { useCallback, useState } from 'react';
import type { FileOpOutcome, WorkspaceDir, WorkspaceFile } from '@mindcanvas/react';
import { statUnchanged, uniqueCopyName } from '@mindcanvas/react';
import type { PartialChoice, RenameDirtyChoice } from './FileOpPanels.js';
import {
  FILE_OP_FAIL_NOTICE,
  type CurrentDocOpResult,
  type FileOpOrchestration,
  failNoticeOf,
} from './hooks/useFileOpOrchestration.js';
import type { FileStatSnapshot } from '@mindcanvas/react';

/** 面板需要的宿主面（`*Safe` 变体 + 目录探测 + 扫描） */
export interface OpWorkspaceHost {
  mounted: boolean;
  name: string | null;
  scopeId?: string | null;
  scan(force?: boolean): Promise<unknown[]>;
  statFile(file: WorkspaceFile): Promise<FileStatSnapshot | null>;
  resolveCopyName(dirPath: string, name: string): Promise<string>;
  removeFileSafe(file: WorkspaceFile): Promise<FileOpOutcome<null>>;
  removeDirSafe(dir: WorkspaceDir): Promise<FileOpOutcome<null>>;
}

/** 部分成功面板的状态（含 L4 复查所需的源快照与动作入口） */
export interface PartialPanelState {
  /** 新位置（已成功写出） */
  createdPath: string;
  /** 旧位置（仍在磁盘上） */
  sourcePath: string;
  /** 失败原因文案（错误码映射） */
  reason: string;
  /**
   * 副本是否已有新改动（L3）。`true` → 不提供「撤销新副本」的直接入口，
   * 只提供「放弃这些改动并删除副本」。
   */
  copyHasNewChanges: boolean;
  /**
   * L4：操作完成时记下的源文件快照。
   *
   * 「重试删除原文件」时**重新读一次**再比对 —— 不一致就不删
   * （用户可能在应用外改过源文件，删掉会丢那些改动）。
   */
  sourceSnapshot: FileStatSnapshot | null;
  /** 面板动作入口（在状态里带上回调，避免渲染期再拼装） */
  apply(choice: PartialChoice): void;
}

/** UI 待决状态（三块面板 + 提示条） */
export interface FileOpUiState {
  /** 改名/移动前「有未保存修改」三选（§5.2⑤） */
  dirtyChoice: { name: string; apply: (choice: RenameDirtyChoice) => void } | null;
  /** 部分成功面板（§5.3） */
  partial: PartialPanelState | null;
  /** 提示文案；null = 无，'' = 静默取消（不渲染） */
  notice: string | null;
}

export interface FileOpController {
  ui: FileOpUiState;
  /** 改名当前文档（先做 dirty 前置 → 执行） */
  requestRename(file: WorkspaceFile, nextName: string): Promise<void>;
  /** 移动当前文档（部分成功会打开面板） */
  requestMove(file: WorkspaceFile, targetDir: string): Promise<void>;
  /** 删除当前文档的 host 段（草稿/脏决策由调用方先行完成） */
  requestDelete(file: WorkspaceFile): Promise<void>;
  /** 创建副本（§3.5） */
  requestDuplicate(file: WorkspaceFile): Promise<void>;
  /** 冲突三选：目标已存在时由调用方带 `overwrite` 重入 */
  resolveConflictChoice(apply: () => Promise<void>): Promise<void>;
  dismissNotice(): void;
}

export interface FileOpControllerOptions {
  host: OpWorkspaceHost | null;
  orchestration: FileOpOrchestration;
  /** 当前文档是否有未保存修改（getter，非快照） */
  isDirty(): boolean;
  /** 当前文档的相对路径（判断「是不是当前文档」；null = 非工作区文档） */
  currentPath(): string | null;
  /** 「保存并改名/移动」分支要发起的保存；返回是否真的保存成功 */
  saveNow(): Promise<boolean>;
  /** 「放弃修改」分支：抑制待发自动保存 */
  suppressPendingAuto?(): void;
  /** 成功后刷新树 */
  reload(): Promise<void>;
}

export function useFileOpController(options: FileOpControllerOptions): FileOpController {
  const { host, orchestration, isDirty, currentPath, saveNow, suppressPendingAuto, reload } = options;
  const [ui, setUi] = useState<FileOpUiState>({ dirtyChoice: null, partial: null, notice: null });

  const setNotice = useCallback((notice: string | null): void => {
    setUi((prev) => ({ ...prev, notice }));
  }, []);

  /**
   * 结果 → UI（唯一分流点）。
   *
   * `partial` 不在本函数里开面板：它的面板需要「源快照」等额外事实，
   * 由发起移动的那条路径组装（见 `requestMove`）。本函数只负责
   * 「done 静默 / failed 出提示 / refused 按文案是否为空决定是否打扰」。
   */
  const absorb = useCallback(
    (result: CurrentDocOpResult<unknown>): void => {
      if (result.kind === 'done') {
        setNotice(null);
        return;
      }
      if (result.kind === 'partial') return; // 面板由调用方开
      if (result.kind === 'failed') {
        setNotice(result.notice);
        return;
      }
      if (result.notice !== '') setNotice(result.notice);
    },
    [setNotice],
  );

  // ---------------------------------------------------------------- 部分成功的四个动作（§5.3 + L3/L4）
  //
  // 定义在 `runMove` **之前**：后者构造面板状态时需要把 `resolvePartial` 包进 `apply`，
  // 而 `const` 不提升 —— 用 ref 转发会把依赖图搞脏，直接前置更清楚。

  const resolvePartial = useCallback(
    async (choice: PartialChoice, state: PartialPanelState): Promise<void> => {
      const close = (notice: string | null): void => {
        setUi((prev) => ({ ...prev, partial: null, notice }));
      };
      if (host === null) {
        close(null);
        return;
      }
      if (choice === 'later') {
        // 关闭提示；「待处理清单」是 P1-A 范围，本轮**不自动重试**
        close(null);
        return;
      }
      if (choice === 'keep-both') {
        close('已保留两份；旧文件仍在原位置，可在树里手动删除。');
        return;
      }
      if (choice === 'undo-copy' || choice === 'discard-copy-changes') {
        // L3：只有显式「放弃这些改动」才允许删副本；`undo-copy` 由面板保证
        // 只在 `copyHasNewChanges === false` 时可达（面板不给直接入口）。
        if (choice === 'discard-copy-changes') suppressPendingAuto?.();
        const created = findIn(await host.scan(true), state.createdPath);
        if (created === null) {
          close('副本已不在磁盘上，未做任何改动。');
          return;
        }
        const removed = await host.removeFileSafe(created);
        if (removed.kind === 'ok') {
          close('已撤销新副本；这份文档回到原来的位置。');
          await reload();
        } else {
          // 撤销本身失败 → 如实说「两份都在，请手动处理」（不假装成功）
          close('两份都在，撤销没有完成，请手动处理。');
        }
        return;
      }
      // retry-delete：**只重试删源，不重建目标**（重建会覆盖新副本内容）
      const source = findIn(await host.scan(true), state.sourcePath);
      if (source === null) {
        close(FILE_OP_FAIL_NOTICE['E-NOT-FOUND'] ?? '文件已不在磁盘上。');
        await reload();
        return;
      }
      // L4：删源前**重新读一次**源状态并与操作时快照比对。
      // 不一致 → 不删，转「保留两份」（用户可能在应用外改过它）。
      const now = await host.statFile(source);
      if (!statUnchanged(state.sourceSnapshot, now)) {
        close('原文件已被外部修改（或无法复查），未删除；已转为「保留两份」。');
        await reload();
        return;
      }
      const removed = await host.removeFileSafe(source);
      if (removed.kind === 'ok') {
        close('已删除原文件，现在只剩新位置那一份。');
      } else {
        close('删除原文件仍未成功；两份都在，请稍后重试或手动处理。');
      }
      await reload();
    },
    [host, suppressPendingAuto, reload],
  );

  // ---------------------------------------------------------------- 执行（dirty 决策之后）

  const runRename = useCallback(
    async (file: WorkspaceFile, nextName: string): Promise<void> => {
      const result = await orchestration.renameCurrent(file, nextName);
      absorb(result);
      if (result.kind === 'done' || result.kind === 'partial') await reload();
    },
    [orchestration, absorb, reload],
  );

  const runMove = useCallback(
    async (file: WorkspaceFile, targetDir: string): Promise<void> => {
      const result = await orchestration.moveCurrent(file, targetDir);
      absorb(result);
      if (result.kind === 'partial') {
        // L4：记下**操作完成时**的源快照，供「重试删除原文件」比对
        const snapshot = await host?.statFile({ ...file, path: result.sourcePath } as WorkspaceFile);
        await reload();
        const state: PartialPanelState = {
          createdPath: result.relPath,
          sourcePath: result.sourcePath,
          reason: failNoticeOf(result.code),
          // L3 保护判据：当前文档就是新副本**且**有未保存改动
          copyHasNewChanges: isDirty() && currentPath() === result.relPath,
          sourceSnapshot: snapshot ?? null,
          apply: (choice) => {
            void resolvePartial(choice, state);
          },
        };
        setUi((prev) => ({ ...prev, partial: state }));
      } else if (result.kind === 'done') {
        await reload();
      }
    },
    [orchestration, absorb, host, isDirty, currentPath, reload, resolvePartial],
  );

  /**
   * §5.2⑤：当前文档有未保存修改时，改名/移动前先三选。
   *
   * 为什么需要：host 的 rename/move 复制的是**磁盘快照**；有未保存修改时
   * 直接改名会把旧内容带到新文件（I-14 会在编排层拒绝，但用户会收到一个
   * 「先保存一次」的提示而无从选择 —— 这里给出三条明确出路）。
   */
  const withDirtyGuard = useCallback(
    (file: WorkspaceFile, run: () => Promise<void>): void => {
      const isCurrent = currentPath() === file.path;
      if (!isCurrent || !isDirty()) {
        void run();
        return;
      }
      setUi((prev) => ({
        ...prev,
        notice: null,
        dirtyChoice: {
          name: file.name,
          apply: (choice: RenameDirtyChoice) => {
            setUi((p) => ({ ...p, dirtyChoice: null }));
            if (choice === 'cancel') return;
            if (choice === 'discard-then-rename') suppressPendingAuto?.();
            void (async () => {
              if (choice === 'save-then-rename') {
                // 保存未成功 → **不改名**（不冒险把未保存内容留在旧文件里）
                if (!(await saveNow())) return;
              }
              await run();
            })();
          },
        },
      }));
    },
    [currentPath, isDirty, suppressPendingAuto, saveNow],
  );

  const requestRename = useCallback(
    async (file: WorkspaceFile, nextName: string): Promise<void> => {
      if (host === null) return;
      withDirtyGuard(file, () => runRename(file, nextName));
    },
    [host, withDirtyGuard, runRename],
  );

  const requestMove = useCallback(
    async (file: WorkspaceFile, targetDir: string): Promise<void> => {
      if (host === null) return;
      withDirtyGuard(file, () => runMove(file, targetDir));
    },
    [host, withDirtyGuard, runMove],
  );

  // ---------------------------------------------------------------- 删除与副本

  const requestDelete = useCallback(
    async (file: WorkspaceFile): Promise<void> => {
      const result = await orchestration.deleteCurrent(file);
      absorb(result);
      if (result.kind === 'done') await reload();
    },
    [orchestration, absorb, reload],
  );

  const requestDuplicate = useCallback(
    async (file: WorkspaceFile): Promise<void> => {
      const result = await orchestration.duplicate(file);
      absorb(result);
      if (result.kind === 'done') await reload();
    },
    [orchestration, absorb, reload],
  );

  /**
   * 冲突三选：目标已存在时，调用方先用 `resolveCopyName` 算好「保留两份」的名字，
   * 再把选中的动作包成 `apply` 传进来。
   */
  const resolveConflictChoice = useCallback(
    async (apply: () => Promise<void>): Promise<void> => {
      await apply();
    },
    [],
  );

  const dismissNotice = useCallback((): void => setNotice(null), [setNotice]);

  return {
    ui,
    requestRename,
    requestMove,
    requestDelete,
    requestDuplicate,
    resolveConflictChoice,
    dismissNotice,
  };
}

/** 按相对路径找 host 上的文件（部分成功面板的动作需要句柄） */
function findIn(nodes: readonly unknown[], relPath: string): WorkspaceFile | null {
  for (const raw of nodes) {
    if (typeof raw !== 'object' || raw === null) continue;
    const node = raw as { kind?: string; path?: string; children?: unknown[] };
    if (node.kind === 'file' && node.path === relPath) return raw as WorkspaceFile;
    if (node.kind === 'dir' && Array.isArray(node.children)) {
      const hit = findIn(node.children, relPath);
      if (hit !== null) return hit;
    }
  }
  return null;
}

/** 冲突三选时算出「保留两份」的名字（面板展示最终名用） */
export async function conflictKeepBothName(
  host: OpWorkspaceHost,
  dirPath: string,
  name: string,
): Promise<string> {
  const taken = await host.resolveCopyName(dirPath, name);
  // `resolveCopyName` 返回可用名：与输入不同即说明原名已被占用
  return taken !== name ? taken : uniqueCopyName(name, () => true);
}

/** 面板状态里「apply」的类型（供组件 props 使用） */
export type PartialApply = (choice: PartialChoice) => void;
