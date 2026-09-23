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
import { useCallback, useRef, useState } from 'react';
import type { FileOpOutcome, WorkspaceDir, WorkspaceFile, WorkspaceNode } from '@mindcanvas/react';
import { statUnchanged } from '@mindcanvas/react';
import type { PartialChoice, RenameDirtyChoice } from './FileOpPanels.js';
import {
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
  scan(force?: boolean): Promise<WorkspaceNode[]>;
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
  /**
   * 这一块面板的动作是否**正在执行**（在途禁用判据）。
   *
   * 为什么判据必须由本状态机给出、不能留给面板猜：`resolvePartial` 是 `async`
   * 且**可重入** —— 「重试删除原文件」要 `await host.scan(true)` + `statFile`
   * + `removeFileSafe` 三次 I/O，期间这块面板一直挂在屏幕上。用户连点两次，
   * 两条流程会**并发**对同一个源文件 `removeFileSafe`，并在两次
   * `onPartialResolved` 与两次 `close()` 上互相覆盖提示条（第二次还会对着
   * 已删掉的源报「仍未成功」）。面板拿不到任何 in-flight 事实，
   * 唯一能钉住它的地方是这里。此前 `busy` 只存在于面板 props 里、
   * **全仓无一处传入**（`grep -rn "busy=" apps/canvas/src`），
   * 于是 `disabled={busy}` 恒等于 `disabled={false}` —— 守卫在，判据不在。
   *
   * 语义边界：这是**在途**（in-flight）判据，与 `App.tsx:68` 的 `disabled={!ready}`、
   * `useUnsavedTransition` 的 `busy` 同类；**不是**能力判据
   * （`MindmapStage.tsx` 的 `canUndo/canRedo`：「现在能不能做」）。
   * 两者不得共用同一个状态位，更不得合并判定。
   */
  busy: boolean;
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
  /**
   * 改名当前文档（先做 dirty 前置 → 执行）。
   * `overwrite=true` 只在冲突三选选「替换目标文件」时传入（§5.2②）。
   */
  requestRename(file: WorkspaceFile, nextName: string, overwrite?: boolean): Promise<void>;
  /** 移动当前文档（部分成功会打开面板） */
  requestMove(file: WorkspaceFile, targetDir: string): Promise<void>;
  /**
   * 删除当前文档的 host 段（草稿/脏决策由调用方先行完成）。
   *
   * 返回结构化结果（而不是 void）：F2 流程要按 `done` / `failed` 分流
   * —— 成功才关闭文档，失败必须保留当前文档与目的地。
   */
  requestDelete(file: WorkspaceFile): Promise<CurrentDocOpResult<null>>;
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
  /**
   * F3-部分成功的**消解**入口（DS-10 §3）。四条出路处理完那一对文件后调用：
   * - 「保留两份」：这一对就此确定，源文件是用户要留下的 → 源行不再是「未消解」，
   *   它转正为普通旧行（若此后源被认领为「被取代」，由 (b') 正常判定）；
   * - 「撤销新副本」成功：源文件回到唯一地位 → 同上消解；
   * - 「重试删除原文件」**成功**：源已不在盘上 → 源行是真正的被取代行 → 消解；
   * - 「重试删除原文件」**仍失败**：**不**消解 —— 源文件还在，代表还得留着。
   */
  onPartialResolved?(sourcePath: string): void;
  /** 成功后刷新树 */
  reload(): Promise<void>;
}

export function useFileOpController(options: FileOpControllerOptions): FileOpController {
  const {
    host,
    orchestration,
    isDirty,
    currentPath,
    saveNow,
    suppressPendingAuto,
    onPartialResolved,
    reload,
  } = options;
  const [ui, setUi] = useState<FileOpUiState>({ dirtyChoice: null, partial: null, notice: null });

  /**
   * 面板动作的**在途标记**（`PartialPanelState.busy` 的真值来源）。
   *
   * 用 ref 而不是 state：这里读的是「现在这一刻有没有流程在跑」，用于**重入判定**，
   * 必须在同一次 tick 内立刻可见（`setState` 是异步的，连点两下会在同一 tick
   * 里都读到旧值 → 两道守卫形同虚设）。渲染用的 `busy` 走 `setPanelBusy`。
   *
   * 与 `App.tsx:125 busy={prompt?.busy ?? false}`（`useUnsavedTransition` 自己在
   * hook 内判定）是**两套独立的判定**：离开决策器的在途态与文件操作的在途态
   * 生命周期不同，本轮只统一**呈现**，**不合并判定**。
   */
  const panelBusyRef = useRef(false);
  /**
   * 渲染用的在途态。
   *
   * 只取 setter：真值一律从 `panelBusyRef` 经 `PartialPanelState.busy` 的 **getter**
   * 读（见 `runMove` 里构造 `state` 处）。把值本身留在闭包里是上一版的错 ——
   * `state` 只在面板打开时构造一次，取值会冻住那一帧的 `false`，
   * `disabled={busy}` 就又变回常量。setter 的作用只是**触发一次重渲染**，
   * 让 getter 有机会被重新读到。
   */
  const [, setPanelBusy] = useState(false);
  const beginPanelBusy = useCallback((): boolean => {
    if (panelBusyRef.current) return false; // 已有流程在跑 → 拒绝重入
    panelBusyRef.current = true;
    setPanelBusy(true);
    return true;
  }, []);
  const endPanelBusy = useCallback((): void => {
    panelBusyRef.current = false;
    setPanelBusy(false);
  }, []);

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

  /**
   * 面板动作的**顺序执行体**（无重入保护；闸门在 `resolvePartial`）。
   *
   * 拆出来的理由：`return` 散落在五个分支里（含两处 `await` 之后的早退），
   * 用 `try/finally` 包整段才能保证**每条**出路都释放在途标记 ——
   * 漏一条就会把面板永久钉死在 disabled 上。
   *
   * 定义在 `resolvePartial` **之前**：后者要在闭包里捕获它，而 `const` 不提升。
   */
  const resolvePartialInner = useCallback(
    async (choice: PartialChoice, state: PartialPanelState): Promise<void> => {
      const close = (notice: string | null): void => {
        setUi((prev) => ({ ...prev, partial: null, notice }));
      };
      if (host === null) {
        close(null);
        return;
      }
      if (choice === 'later') {
        // 关闭提示；「待处理清单」是 P1-A 范围，本轮**不自动重试**。
        // **不消解**：这一对文件还没被处理，源文件仍在盘上，代表必须继续留着。
        close(null);
        return;
      }
      if (choice === 'keep-both') {
        // 这一对就此定案：用户明确要留下源文件 → 消解（源行不再需要特殊保留）
        onPartialResolved?.(state.sourcePath);
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
          // 副本撤掉了，文档回到原位置（源文件是唯一一份）→ 消解
          onPartialResolved?.(state.sourcePath);
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
        // 源已不在盘上（用户手动删了 / 外部删了）→ 代表不必再留
        onPartialResolved?.(state.sourcePath);
        /**
         * P0-C ②：这里此前是 `FILE_OP_FAIL_NOTICE['E-NOT-FOUND'] ?? '文件已不在磁盘上。'`
         * —— 同一错误码的**第二套说法**（兜底串与表内文案同码不同形）。
         * 那个 `??` 分支其实**不可达**（`FILE_OP_FAIL_NOTICE` 是 `Record<string, string>`，
         * 取键结果不会是 `undefined`），所以它一直是「看着像防护、实为死代码」的
         * 分叉温床：谁哪天把表收窄成部分映射，用户就会突然看到第二句话。
         * 现在直接查唯一事实源，兜底需求由 `failNoticeOf` 统一承担（它取 `E-UNKNOWN` 字节）。
         */
        close(failNoticeOf('E-NOT-FOUND'));
        await reload();
        return;
      }
      // L4：删源前**重新读一次**源状态并与操作时快照比对。
      // 不一致 → 不删，转「保留两份」（用户可能在应用外改过它）。
      const now = await host.statFile(source);
      if (!statUnchanged(state.sourceSnapshot, now)) {
        // 源文件被外部改动，用户很可能想留着它 → 与「保留两份」同义，消解
        onPartialResolved?.(state.sourcePath);
        close('原文件已被外部修改（或无法复查），未删除；已转为「保留两份」。');
        await reload();
        return;
      }
      const removed = await host.removeFileSafe(source);
      if (removed.kind === 'ok') {
        // 源真的删掉了 → 消解：此后该源行是真正的被取代行，(b') 可正常回收
        onPartialResolved?.(state.sourcePath);
        close('已删除原文件，现在只剩新位置那一份。');
      } else {
        // **仍失败 → 不消解**：源文件还在盘上，它的代表行必须继续保留。
        close('删除原文件仍未成功；两份都在，请稍后重试或手动处理。');
      }
      await reload();
    },
    [host, suppressPendingAuto, onPartialResolved, reload],
  );

  /**
   * 面板动作的**重入闸门**（在途禁用判据的执行侧）。
   *
   * 面板上 `disabled={busy}` 是**呈现侧**的防线：挡住「同一帧里连点两下」。
   * 但 `busy` 从 `setState` 到重渲染之间隔着一个 tick，这期间第二次点击仍可能
   * 落到同一个 handler 上；且面板已有的测试/其它代码可以直接调 `apply`。
   * 所以判据必须在**这里**再钉一次 ——「呈现一致」与「行为安全」是两件事，
   * 只有后者能保证不并发删同一个源文件。
   */
  const resolvePartial = useCallback(
    async (choice: PartialChoice, state: PartialPanelState): Promise<void> => {
      if (!beginPanelBusy()) return;
      try {
        await resolvePartialInner(choice, state);
      } finally {
        endPanelBusy();
      }
    },
    [beginPanelBusy, endPanelBusy, resolvePartialInner],
  );

  // ---------------------------------------------------------------- 执行（dirty 决策之后）

  const runRename = useCallback(
    async (file: WorkspaceFile, nextName: string, overwrite: boolean): Promise<void> => {
      const result = await orchestration.renameCurrent(file, nextName, overwrite);
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
        const source = host === null ? null : findIn(await host.scan(true), result.sourcePath);
        const snapshot = source === null ? null : await host?.statFile(source);
        await reload();
        const state: PartialPanelState = {
          createdPath: result.relPath,
          sourcePath: result.sourcePath,
          reason: failNoticeOf(result.code),
          // L3 保护判据：当前文档就是新副本**且**有未保存改动
          copyHasNewChanges: isDirty() && currentPath() === result.relPath,
          sourceSnapshot: snapshot ?? null,
          /**
           * 在途判据 —— **必须是 getter，不能在构造时取值**。
           *
           * 这里是本修复最容易写错的地方（第一版就错在这）：`state` 在
           * **面板打开的那一刻**构造一次，而 `busy` 是在**动作执行期间**才变 true。
           * 写成 `busy: panelBusy` 会把打开时那一帧的 `false` 冻进闭包，
           * 于是 `disabled={busy}` 依旧是常量 false —— 换了个地方重现同一个空转。
           * getter 每次读 `panelBusyRef`（ref 的读取在同 tick 内立即生效），
           * 面板在途重渲染时就能看到 true。
           */
          get busy(): boolean {
            return panelBusyRef.current;
          },
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
    async (file: WorkspaceFile, nextName: string, overwrite = false): Promise<void> => {
      if (host === null) return;
      withDirtyGuard(file, () => runRename(file, nextName, overwrite));
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
    async (file: WorkspaceFile): Promise<CurrentDocOpResult<null>> => {
      const result = await orchestration.deleteCurrent(file);
      absorb(result);
      if (result.kind === 'done') await reload();
      return result;
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

/**
 * 按相对路径找 host 上的文件（部分成功面板的动作需要句柄）。
 *
 * 用**结构窄化**而不是 `as`：只认「有 kind/path/handle 的 file 节点」与
 * 「有 children 的 dir 节点」，不满足形状的输入直接跳过（代码预算 `asCast` 为 0）。
 */
function findIn(nodes: readonly WorkspaceNode[], relPath: string): WorkspaceFile | null {
  for (const node of nodes) {
    if (node.kind === 'file') {
      if (node.path === relPath) return node;
      continue;
    }
    const hit = findIn(node.children, relPath);
    if (hit !== null) return hit;
  }
  return null;
}

/** 冲突三选时算出「保留两份」的名字（面板展示最终名用） */
export async function conflictKeepBothName(
  host: OpWorkspaceHost,
  dirPath: string,
  name: string,
): Promise<string> {
  // `resolveCopyName` **本身就是「保留两份」的求解器**：它内部已跑过唯一名循环，
  // 返回的是最终可用名 —— 空闲时**原样返回入参**，冲突时返回 `… 2 …`（见
  // `directoryHostOps.resolveCopyNameOp` 与契约测试 `directory-host.test.ts:505-506`）。
  // 因此这里直接采用它，不得再叠加一次取名。
  //
  // 旧实现的判据是**反的**（`taken !== name ? taken : uniqueCopyName(name, () => true)`）：
  //  - 真冲突时 `taken` 已是 `name 2.ext`，原样返回正确；
  //  - **无冲突**时 `taken === name`，旧代码却把它当「原名被占用」，转而调
  //    `uniqueCopyName(name, () => true)` —— 谓词恒真 ⇒ 每个候选都被判「已占用」⇒
  //    循环跑到上限，返回 `name 999.ext`。调用方再据「keepBoth ≠ name」误判为冲突，
  //    于是「把文档改到空闲名字」也会弹三选，且确认后被改成 `… 999.mm.md`。
  return host.resolveCopyName(dirPath, name);
}

/** 面板状态里「apply」的类型（供组件 props 使用） */
export type PartialApply = (choice: PartialChoice) => void;
