/**
 * 当前文档的文件操作编排（P0-A ③⑤⑦ · file-management §3.3/§3.4/§3.6/§4）。
 *
 * 为什么单独一层：改名/移动当前文档是**跨三处状态**的动作（会话目的地、当前文档 doc、
 * `workspacePath`），且必须走「租约 → I-14 前置 → host 操作 → 归属复核 → 重绑 →
 * 条件释放」这条固定时序。写在组件里会与渲染状态纠缠，也无法单独测时序。
 *
 * 时序（`shared-contracts` §3.2 的重绑状态机，逐步对齐）：
 *   ① `beginExclusiveOp(intent, target)` —— **任何 await 之前**取得
 *      ├─ `busy-lease`     → 提示「正在处理上一步操作」，零副作用
 *      ├─ `busy-physical`  → 提示「上一份写入还没有结束…」，零副作用
 *      └─ `granted`        → 记下 leaseId / opSeq / sessionToken
 *   ② **I-14 前置**：要求一次 `saved && current`（改名前至少一次成功落盘）。
 *      理由：host 的 rename/move 复制的是**磁盘快照**；若磁盘上是旧内容，新文件里就是旧的，
 *      而租约期间的编辑要等 rebind 后由 auto 补写 —— 用户若在 rebind 前关页面就丢。
 *      把「必须已 saved && current」作为硬前置，直接消除这个窗口。
 *   ③ host 操作（编辑继续；写入被租约挡回 `blocked`）
 *   ④ 每个 await 后复核 `ownsLease`：不符 → 停止且**不写任何状态**
 *   ⑤ `rebindDestination` + 更新 `workspacePath`/`doc`（单一事实源，I-20）
 *   ⑥ `finally` 条件释放（仅当 leaseId 仍是自己的）
 *   ⑦ 若仍 dirty → 立即重排一次 auto（写**新**目的地）
 *
 * 不是什么：不实现租约（在 `DocumentSaveSession`）、不实现 host I/O
 * （在 `DirectoryWorkspaceHost`）、不弹任何对话框（面板负责；本层只返回可判别结果）。
 */
import { useCallback } from 'react';
import type { FileOpOutcome, WorkspaceDir, WorkspaceFile } from '@mindcanvas/react';
import { checkFileName } from '@mindcanvas/react';
import type { FileOpIntent, SaveDestination } from './saveDestination.js';
import type { DocumentSaveSession } from './useDocumentSaveSession.js';

/**
 * 本层需要的 host 面（结构化类型，`DirectoryWorkspaceHost` 天然满足）。
 *
 * 只要 `*Safe` 变体：本层按**四态**分流，不再靠 `catch` 猜「目标到底建成了没有」。
 * 既有会抛错的 `renameFile`/`moveFile`/... 不在此面内 —— 它们仍供兼容模式与旧调用方使用。
 */
export interface SafeWorkspaceHost {
  mounted: boolean;
  name: string | null;
  scopeId?: string | null;
  renameFileSafe(file: WorkspaceFile, newName: string, overwrite?: boolean): Promise<FileOpOutcome<WorkspaceFile>>;
  moveFileSafe(file: WorkspaceFile, targetDirPath: string, overwrite?: boolean): Promise<FileOpOutcome<WorkspaceFile>>;
  removeFileSafe(file: WorkspaceFile): Promise<FileOpOutcome<null>>;
  removeDirSafe(dir: WorkspaceDir): Promise<FileOpOutcome<null>>;
  duplicateFileSafe(file: WorkspaceFile): Promise<FileOpOutcome<WorkspaceFile>>;
  statFile(file: WorkspaceFile): Promise<{ size: number; lastModified: number } | null>;
  resolveCopyName(dirPath: string, name: string): Promise<string>;
}

/** 操作被拒（**未开始**）的原因 —— UI 据此选文案，不猜 */
export type FileOpRefusal =
  | 'busy-lease'
  | 'busy-physical'
  | 'session-replaced'
  /** I-14 未满足：磁盘上没有可信的当前快照（未保存 / 只下载过 / 内容又变过） */
  | 'not-durable'
  | 'invalid-name'
  | 'case-only'
  /** 与源同名 → 零 I/O 取消（不是失败） */
  | 'same-name'
  | 'host-unmounted';

/** 拒绝文案（唯一事实源；面板直接展示，不另写一份） */
export const FILE_OP_REFUSAL_NOTICE: Record<FileOpRefusal, string> = {
  'busy-lease': '正在处理上一步操作，请稍候再试（本次未做任何改动）。',
  'busy-physical': '上一份写入还没有结束，请稍后重试（本次未做任何改动）。',
  'session-replaced': '这份文档已经被替换，操作已取消（本次未做任何改动）。',
  'not-durable': '这份文档还没有保存到磁盘（或内容又变过），先保存一次再改名或移动。',
  'invalid-name': '名字不能为空，也不能包含 / \\ 等字符。',
  'case-only':
    '浏览器的文件接口没有原地改名能力；在大小写不敏感的磁盘上，这两个名字会被视为同一个文件。请改用其他名称，或用系统文件管理器改名。',
  // 同名 = 用户没改名：静默取消，不打扰
  'same-name': '',
  'host-unmounted': '工作区未挂载，无法操作磁盘文件。',
};

/** 失败文案（按错误码；与 `FILE_OP_REFUSAL_NOTICE` 同为唯一事实源，原则 1） */
export const FILE_OP_FAIL_NOTICE: Record<string, string> = {
  'E-PERMISSION': '没有写入权限：请重新授权后重试。',
  'E-NOT-FOUND': '文件已不在磁盘上（可能被外部改名或删除），列表已刷新。',
  'E-QUOTA': '磁盘空间不足，无法完成这次操作。',
  'E-UNAVAILABLE': '当前浏览器或这份目录句柄不支持这个操作。',
  'E-IO': '读写磁盘失败，请重试。',
  'E-EXISTS': '目标位置已有同名文件。',
  'E-ABORT': '操作已取消。',
  'E-UNKNOWN': '操作失败，请重试。',
};

/** 未知码 → 通用文案（不把内部码暴露给用户） */
export function failNoticeOf(code: string): string {
  return FILE_OP_FAIL_NOTICE[code] ?? FILE_OP_FAIL_NOTICE['E-UNKNOWN'] ?? '操作失败，请重试。';
}

/**
 * 一次当前文档文件操作的结果。
 *
 * `partial` 与 `failed` **必须分开**：部分成功时磁盘上有两份，UI 要说「两份」并给三个动作；
 * 说「失败」会掩盖「新位置已经有一份可用的」这个事实（F3 负控锚定的正是这条）。
 */
export type CurrentDocOpResult<T> =
  | { kind: 'done'; value: T; relPath: string }
  | {
      kind: 'partial';
      value: T;
      /** 新位置（已成功写出） */
      relPath: string;
      /** 旧位置（仍在磁盘上）—— 部分成功面板要同时列出两份 */
      sourcePath: string;
      code: string;
      retryable: boolean;
      notice: string;
    }
  | { kind: 'refused'; reason: FileOpRefusal; notice: string }
  | { kind: 'failed'; stage: string; code: string; retryable: boolean; notice: string };

export interface FileOpOrchestration {
  /**
   * 改名。
   *
   * @param sourceFile 源文件（调用方已有它就不用再扫一遍盘；`file` 参数在
   *   移动路径上是必需的，改名路径上只是省一次扫描）。
   * @param overwrite 冲突三选之「替换目标文件」。缺省 false = 目标已存在则失败（E-EXISTS）。
   */
  renameCurrent(
    sourceFile: WorkspaceFile,
    nextName: string,
    overwrite?: boolean,
  ): Promise<CurrentDocOpResult<WorkspaceFile>>;
  moveCurrent(
    file: WorkspaceFile,
    targetDir: string,
    overwrite?: boolean,
  ): Promise<CurrentDocOpResult<WorkspaceFile>>;
  deleteCurrent(file: WorkspaceFile): Promise<CurrentDocOpResult<null>>;
  duplicate(file: WorkspaceFile): Promise<CurrentDocOpResult<WorkspaceFile>>;
}

export interface FileOpOrchestrationOptions {
  session: DocumentSaveSession;
  host: SafeWorkspaceHost;
  /**
   * 当前文档状态**读取**（getter，非快照 —— 判据必须在读的那一刻成立）。
   *
   * `durable` = 已成功落盘且有句柄（`doc.saved && doc.handle`）；
   * `current` = 磁盘上就是屏幕内容（`saved && current` 的 `current` 部分）。
   * 两者分开：`saved && !current` 表示磁盘是旧快照，改名会把旧内容带到新文件。
   */
  readDoc: () => { durable: boolean; current: boolean; dirty: boolean };
  /**
   * 目的地重绑（改名/移动成功后调用）。
   *
   * 分开注入（而不是本层直接改 React state）：落点有三处（会话目的地 / `doc.handle` /
   * `workspacePath`），它们属 Stage 状态。本层只负责「什么时候必须重绑」，
   * 不负责「怎么重绑」—— 但**必须**重绑，否则后续保存仍写旧路径（R-01）。
   */
  onRebound(file: WorkspaceFile): void;
  /** 释放租约后仍 dirty → 立即补写一次（写新目的地；I-18 时序表的最后一行） */
  onAfterRelease?(): void;
  /**
   * F3-部分成功：**源文件仍在磁盘上**时的登记入口（DS-10 裁定 §3）。
   *
   * 编排层是唯一知道「目标已写、源删除失败」的地方（`FileOpOutcome` 的 `partial`
   * 四态判别）；索引层据此把该源键标为「未消解」，降级投影逐行跳过它 ——
   * 因为此刻它是那个仍在盘上的源文件在降级视图里的**唯一代表**。
   *
   * 只在 `partial` 时调用：`ok` 时源必已删（rename/move 成功语义），
   * 那时源行是真正的「被取代」行，该由 (b') 正常回收。
   */
  onPartialSource?(sourcePath: string): void;
  /** 通知出口（可选；面板也会拿到结构化结果自己渲染） */
  onNotice?(msg: string): void;
}

export function useFileOpOrchestration(
  options: FileOpOrchestrationOptions,
): FileOpOrchestration {
  const { session, host, readDoc, onRebound, onAfterRelease, onPartialSource, onNotice } = options;

  /** 拒绝：构造结果 + 通知（文案为空表示静默取消） */
  const refuse = useCallback(
    <T,>(reason: FileOpRefusal): CurrentDocOpResult<T> => {
      const notice = FILE_OP_REFUSAL_NOTICE[reason];
      if (notice !== '') onNotice?.(notice);
      return { kind: 'refused', reason, notice };
    },
    [onNotice],
  );

  /**
   * ① 取租约（**任何 await 之前**）。
   *
   * 返回 `null` 表示被拒；具体原因由拒绝结果承载（调用方按 `reason` 选文案）。
   */
  const begin = useCallback(
    (
      intent: FileOpIntent,
      relPath: string,
    ):
      | { kind: 'granted'; leaseId: number; opSeq: number; token: number }
      | { kind: 'refused'; reason: FileOpRefusal } => {
      const result = session.beginExclusiveOp(intent, { scopeId: host.scopeId ?? '', relPath });
      if (result.kind === 'refused') return { kind: 'refused', reason: result.reason };
      return {
        kind: 'granted',
        leaseId: result.leaseId,
        opSeq: result.opSeq,
        token: session.sessionToken,
      };
    },
    [session, host],
  );

  /** 失败结果（带文案） */
  const fail = useCallback(
    <T,>(stage: string, code: string, retryable: boolean): CurrentDocOpResult<T> => {
      const notice = failNoticeOf(code);
      onNotice?.(notice);
      return { kind: 'failed', stage, code, retryable, notice };
    },
    [onNotice],
  );

  /**
   * I-14 前置判据（改名/移动的硬门槛）。
   *
   * 同时要求 `durable` 与 `current`：
   *  - `!durable`（未保存 / 只下载过）→ 磁盘上没有可信快照，复制过去的是空/旧内容；
   *  - `!current`（磁盘是旧快照）→ 同样把旧内容带到新文件。
   */
  const durable = useCallback((): boolean => {
    const state = readDoc();
    return state.durable && state.current;
  }, [readDoc]);

  /** ⑥ 条件释放 + ⑦ 补写：仅当租约仍是自己的（I-19） */
  const release = useCallback(
    (leaseId: number): void => {
      if (session.leaseIdOf() !== leaseId) return;
      session.endExclusiveOp(leaseId);
      // 租约期间内容可能又变了：立即补写一次（写**新**目的地）
      if (readDoc().dirty) onAfterRelease?.();
    },
    [session, readDoc, onAfterRelease],
  );

  /** ⑤ 重绑 + ⑦ 补写 + ⑥ 条件释放（成功与部分成功共用的收尾） */
  const finish = useCallback(
    (leaseId: number, file: WorkspaceFile, relPath: string): void => {
      // 重绑目的地：改名/移动之后，后续保存必须写新路径（否则旧文件被「复活」，R-01）
      session.rebindDestination(destinationOf(host, file, relPath));
      onRebound(file);
      release(leaseId);
    },
    [session, host, onRebound, release],
  );

  // ---------------------------------------------------------------- ③ 改名

  const renameCurrent = useCallback(
    async (
      sourceFile: WorkspaceFile,
      nextName: string,
      overwrite = false,
    ): Promise<CurrentDocOpResult<WorkspaceFile>> => {
      if (!host.mounted) return refuse<WorkspaceFile>('host-unmounted');
      const name = nextName.trim();
      const problem = checkFileName(name, basenameOf(sourceFile.path));
      // 同名 = 用户没改：零 I/O 静默取消（不是失败，不该弹任何东西）
      if (problem === 'same') return { kind: 'refused', reason: 'same-name', notice: '' };
      if (problem === 'case-only') return refuse<WorkspaceFile>('case-only');
      if (problem !== null) return refuse<WorkspaceFile>('invalid-name');
      // I-14：必须在取租约**之前**判定（未满足就不该占用互斥域）
      if (!durable()) return refuse<WorkspaceFile>('not-durable');

      const lease = begin('rename', sourceFile.path);
      if (lease.kind === 'refused') return refuse<WorkspaceFile>(lease.reason);

      try {
        const outcome = await host.renameFileSafe(sourceFile, name, overwrite);
        if (!ownsLease(session, lease)) return refuse<WorkspaceFile>('session-replaced');
        return settle(lease.leaseId, outcome, fail, finish, sourceFile.path, onPartialSource);
      } finally {
        release(lease.leaseId);
      }
    },
    [host, refuse, durable, begin, fail, finish, release, session, onPartialSource],
  );

  // ---------------------------------------------------------------- ③ 移动

  const moveCurrent = useCallback(
    async (
      file: WorkspaceFile,
      targetDir: string,
      overwrite = false,
    ): Promise<CurrentDocOpResult<WorkspaceFile>> => {
      if (!host.mounted) return refuse<WorkspaceFile>('host-unmounted');
      if (parentOf(file.path) === targetDir) {
        // 同目录 = 零操作（`canDropInto` 已挡；这里再兜一次，避免制造无用副本）
        return { kind: 'refused', reason: 'same-name', notice: '' };
      }
      if (!durable()) return refuse<WorkspaceFile>('not-durable');

      const lease = begin('move', file.path);
      if (lease.kind === 'refused') return refuse<WorkspaceFile>(lease.reason);
      try {
        const outcome = await host.moveFileSafe(file, targetDir, overwrite);
        if (!ownsLease(session, lease)) return refuse<WorkspaceFile>('session-replaced');
        return settle(lease.leaseId, outcome, fail, finish, file.path, onPartialSource);
      } finally {
        release(lease.leaseId);
      }
    },
    [host, refuse, durable, begin, fail, finish, release, session, onPartialSource],
  );

  // ---------------------------------------------------------------- ⑤ 删除当前文档（F2 的 host 段）

  /**
   * 删除当前文档的 host 段。**草稿/脏/组合输入的用户决策在调用方**（离开决策器同族）——
   * 本层只负责「拿到租约 → 删 → 归属复核」，不参与「要不要问用户」。
   */
  const deleteCurrent = useCallback(
    async (file: WorkspaceFile): Promise<CurrentDocOpResult<null>> => {
      if (!host.mounted) return refuse<null>('host-unmounted');
      const lease = begin('delete', file.path);
      if (lease.kind === 'refused') return refuse<null>(lease.reason);
      try {
        const outcome = await host.removeFileSafe(file);
        if (!ownsLease(session, lease)) return refuse<null>('session-replaced');
        if (outcome.kind === 'failed') {
          return fail<null>(outcome.stage, outcome.error.code, outcome.error.retryable);
        }
        if (outcome.kind === 'cancelled') return { kind: 'refused', reason: 'session-replaced', notice: '' };
        return { kind: 'done', value: null, relPath: '' };
      } finally {
        release(lease.leaseId);
      }
    },
    [host, refuse, begin, fail, release, session],
  );

  // ---------------------------------------------------------------- ⑦ 创建副本

  /**
   * 创建副本：读源 → 同目录新建。**不改源、不换目的地**（当前文档仍是原文档）。
   *
   * 与改名/移动的关键区别：没有「删源」步骤，故不存在部分成功 —— 要么建成，要么什么都没变。
   * 也因此**不需要 I-14 前置**（副本内容来自源文件，不依赖「磁盘快照 = 屏幕内容」）。
   */
  const duplicate = useCallback(
    async (file: WorkspaceFile): Promise<CurrentDocOpResult<WorkspaceFile>> => {
      if (!host.mounted) return refuse<WorkspaceFile>('host-unmounted');
      const lease = begin('duplicate', file.path);
      if (lease.kind === 'refused') return refuse<WorkspaceFile>(lease.reason);
      try {
        const outcome = await host.duplicateFileSafe(file);
        if (!ownsLease(session, lease)) return refuse<WorkspaceFile>('session-replaced');
        if (outcome.kind === 'ok') {
          return { kind: 'done', value: outcome.value, relPath: outcome.value.path };
        }
        if (outcome.kind === 'partial') {
          // 副本路径不该出现 partial（它没有删源步骤）；真出现则如实上报，
          // `sourcePath` 填源文件（面板据此列出「两份」）
          return {
            kind: 'partial',
            value: outcome.created,
            relPath: outcome.created.path,
            sourcePath: file.path,
            code: outcome.error.code,
            retryable: outcome.error.retryable,
            notice: failNoticeOf(outcome.error.code),
          };
        }
        if (outcome.kind === 'cancelled') return { kind: 'refused', reason: 'session-replaced', notice: '' };
        return fail<WorkspaceFile>(outcome.stage, outcome.error.code, outcome.error.retryable);
      } finally {
        release(lease.leaseId);
      }
    },
    [host, refuse, begin, fail, release, session],
  );

  return { renameCurrent, moveCurrent, deleteCurrent, duplicate };
}

// ---------------------------------------------------------------- 内部工具

/** 已取得的租约（`begin` 的成功形状） */
type Lease = { leaseId: number; opSeq: number; token: number };

/**
 * 归属复核（I-19）：每个 `await` 之后都要问一次。
 *
 * 三项全查：租约仍是自己的、代次（opSeq）未变、会话令牌未变。
 * 任一项不符 → 停止后续步骤并**不写任何状态**（不写旧文档，也不写新文档）。
 */
function ownsLease(session: DocumentSaveSession, lease: Lease): boolean {
  return session.ownsLease(lease.leaseId, lease.opSeq, lease.token);
}

/** 结果 → `CurrentDocOpResult`（四态分流的唯一位置） */
function settle<T>(
  leaseId: number,
  outcome: FileOpOutcome<T>,
  fail: <U>(stage: string, code: string, retryable: boolean) => CurrentDocOpResult<U>,
  finish: (leaseId: number, file: T, relPath: string) => void,
  sourcePath: string,
  onPartialSource?: (sourcePath: string) => void,
): CurrentDocOpResult<T> {
  if (outcome.kind === 'ok') {
    const relPath = pathOf(outcome.value);
    finish(leaseId, outcome.value, relPath);
    return { kind: 'done', value: outcome.value, relPath };
  }
  if (outcome.kind === 'partial') {
    const relPath = pathOf(outcome.created);
    // F3：源文件**仍在盘上** → 登记为未消解，降级投影据此保留它的代表行
    // （DS-10 裁定 §3；在任何失败/成功分流之前，因为它描述的是磁盘事实）。
    onPartialSource?.(sourcePath);
    // 部分成功**也要重绑**：新文件是用户的目标位置，且已写出（§5.3「当前目的地=新文件」）
    finish(leaseId, outcome.created, relPath);
    return {
      kind: 'partial',
      value: outcome.created,
      relPath,
      sourcePath,
      code: outcome.error.code,
      retryable: outcome.error.retryable,
      notice: failNoticeOf(outcome.error.code),
    };
  }
  if (outcome.kind === 'cancelled') {
    return { kind: 'refused', reason: 'session-replaced', notice: '' };
  }
  return fail<T>(outcome.stage, outcome.error.code, outcome.error.retryable);
}

/** `T` → 相对路径（本层只用 `WorkspaceFile`；`null` 结果走别的分支） */
function pathOf(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'path' in value) {
    const path: unknown = Reflect.get(value, 'path');
    if (typeof path === 'string') return path;
  }
  return '';
}

/** 目的地构造：改名/移动后的新位置（含作用域与相对路径） */
function destinationOf(
  host: SafeWorkspaceHost,
  file: WorkspaceFile,
  relPath: string,
): SaveDestination {
  return {
    kind: 'disk',
    scopeId: host.scopeId ?? '',
    relPath,
    name: file.name,
    handle: file.handle,
  };
}

function basenameOf(path: string): string {
  return path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path;
}

function parentOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

/** 供面板判断「这次操作有没有产出可用文件」 */
export function resultFile<T>(result: CurrentDocOpResult<T>): T | null {
  if (result.kind === 'done') return result.value;
  if (result.kind === 'partial') return result.value;
  return null;
}

/** 供面板判断是否需要显示「部分完成」面板 */
export function isPartial<T>(
  result: CurrentDocOpResult<T>,
): result is Extract<CurrentDocOpResult<T>, { kind: 'partial' }> {
  return result.kind === 'partial';
}
