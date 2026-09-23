/**
 * 文件操作的结果类型与错误码（P0-A）。
 *
 * 解决的是什么（审计 R-02 / R-03 / R-09）：
 *  - 现状 `renameFile` / `moveFile` / `removeFile` / `removeDir` 只有「成功返回」与
 *    「抛异常」两种出口。抛异常把三类**语义完全不同**的结果压成一类：
 *    ① 用户取消；② 失败（读取/写入/删除/权限，各有不同恢复路径）；
 *    ③ **部分成功**（移动 = 复制到目标 + 删源，目标已建、删源失败 → 磁盘上两份）。
 *    调用方只能靠 `try/catch` 猜，于是 R-02（孤儿副本无回滚无上报）与
 *    R-03（所有失败无用户可见通道）就是这么来的。
 *  - 本模块给出**可判别**的出口：`FileOpOutcome<T>` 四态 + `FileOpErrorCode` 错误码。
 *    UI 按 `kind` 分流（四种走势各有自己的文案与动作），按 `code` 选文案。
 *
 * 分层纪律（acceptance-and-backlog §5.1 原则 3）：公共结果类型必须放在合法共享层
 * （`packages/react/src/edit/**`）并经 `index.ts` 再导出 —— 不得放在 `apps/canvas`
 * 后要求包反向依赖应用（`.dependency-cruiser.js` 现在不拦该方向，属真实风险）。
 *
 * 不是什么：不做 I/O、不持有状态、不弹任何对话框。全部是纯函数 + 类型。
 */

/**
 * 文件操作错误码（contracts §4.4）。
 *
 * 为什么是这八个：它们各自对应**不同的用户动作**，合并任两个都会让 UI 无法给出正确恢复路径
 * （例：`E-NOT-FOUND` 该「刷新树」，`E-PERMISSION` 该「重新授权」，两者不可合并）。
 */
export type FileOpErrorCode =
  /** 权限被拒/被撤回：恢复路径是「重新授权」或「重新选择文件夹」 */
  | 'E-PERMISSION'
  /** 目标不存在（已被外部删除/改名）：恢复路径是「刷新列表」 */
  | 'E-NOT-FOUND'
  /** 目标已存在（不静默加序号的原语路径）：恢复路径是走冲突三选 */
  | 'E-EXISTS'
  /** 配额不足：恢复路径是「清理后重试」 */
  | 'E-QUOTA'
  /**
   * 目录句柄不具备该能力（如缺 `removeEntry`）。**这是 `removeEntry?.` 静默成功的替代**：
   * 能力缺失必须显式失败，不得当作删除成功（`directoryHost.ts` 旧 `:326,334`）。
   */
  | 'E-UNAVAILABLE'
  /** 用户取消（AbortError）：**不是故障**，UI 静默、不改任何状态 */
  | 'E-ABORT'
  /** I/O 层错误（读写抛错、磁盘不可用） */
  | 'E-IO'
  /** 未归类 */
  | 'E-UNKNOWN';

/** 文件操作失败的结构化描述（contracts §4.4） */
export interface FileOpError {
  code: FileOpErrorCode;
  /** 面向开发者的原始信息（`error.name` / `message`）；**UI 不得直接展示** */
  detail?: string;
  /** 是否值得重试（`E-ABORT` 与 `E-NOT-FOUND` 为 false：重试必然同样结果） */
  retryable: boolean;
}

/** 失败发生在哪一步 —— 决定 UI 说「读取失败」还是「替换失败」 */
export type FileOpFailStage = 'read' | 'write' | 'delete' | 'permission';

/**
 * 文件操作结果（contracts §4.4）。四态必须可判别：
 *
 * - `ok`：完全成功；
 * - `cancelled`：用户主动取消（选择器 / 确认）→ 零副作用，UI 静默；
 * - `partial`：**目标已建、源删除失败** → 磁盘上两份。`created` 是**已成功写出**的新文件，
 *   它必须能成为新的当前目的地（用户的目标就是「把它放到那里」）。
 *   `sourceRetained: true` 是类型级的显式事实：源还在，调用方不得假设已搬走。
 * - `failed`：未达成的**任一步**；`stage` 说明是哪一步（避免把「读取失败」说成「移动失败」）。
 */
export type FileOpOutcome<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'cancelled'; stage: 'picker' | 'confirm' }
  | { kind: 'partial'; created: T; sourceRetained: true; error: FileOpError }
  | { kind: 'failed'; stage: FileOpFailStage; error: FileOpError };

/**
 * 全部错误码（顺序即 UI 文案表的顺序；`satisfies` 保证新增码必须同步补文案与测试）。
 *
 * 为什么导出这张表而不是让各处散落字面量：`FILE_OP_NOTICE` 的完备性由类型系统钉住
 * （漏一个码 → `Record<FileOpErrorCode, string>` 编译失败），
 * `file-ops.test.ts` 再对两个集合做等值断言 —— 双重保险。
 */
export const FILE_OP_ERROR_CODES = [
  'E-PERMISSION',
  'E-NOT-FOUND',
  'E-EXISTS',
  'E-QUOTA',
  'E-UNAVAILABLE',
  'E-ABORT',
  'E-IO',
  'E-UNKNOWN',
] as const satisfies readonly FileOpErrorCode[];

/**
 * 错误码 → 是否值得重试。
 *
 * 三个 `false` 的理由各不相同，但都成立：
 *  - `E-ABORT`：用户已经选择了取消，重试 = 再次打扰用户；
 *  - `E-NOT-FOUND`：对象已不在，重试同一路径必然再次失败（恢复路径是「刷新」而非「重试」）；
 *  - `E-UNAVAILABLE`：能力缺失是环境事实（浏览器未实现该 API），重试不会让 API 出现。
 * 其余按「换个时机/授权后可能成功」记为可重试。
 */
export function isRetryable(code: FileOpErrorCode): boolean {
  return code !== 'E-ABORT' && code !== 'E-NOT-FOUND' && code !== 'E-UNAVAILABLE';
}

/**
 * 任意抛错 → `FileOpError`。
 *
 * `detail` 只取 `name` / `message` 两个字符串字段，**不做 `as` 断言**（代码预算 `asCast` 为 0）；
 * 非对象抛错（`throw 'x'`）回落 `String(e)`。
 */
export function toFileOpError(error: unknown): FileOpError {
  const code = classifyFileOpError(error);
  const detail = detailOf(error);
  return detail === undefined ? { code, retryable: isRetryable(code) } : { code, detail, retryable: isRetryable(code) };
}

/** 抛错 → 错误码（`name` 优先于 `message`：DOMException 的 name 才是语义字段） */
export function classifyFileOpError(error: unknown): FileOpErrorCode {
  const name = stringFieldOf(error, 'name');
  if (name === 'AbortError') return 'E-ABORT';
  if (name === 'NotFoundError') return 'E-NOT-FOUND';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'E-PERMISSION';
  if (name === 'QuotaExceededError') return 'E-QUOTA';
  if (name === 'TypeMismatchError' || name === 'InvalidModificationError') return 'E-EXISTS';
  if (name === 'NotSupportedError') return 'E-UNAVAILABLE';
  // name 不足以判定时再看 message（本仓宿主替身与部分浏览器实现只给 message）
  const message = stringFieldOf(error, 'message');
  if (message !== undefined) {
    const lower = message.toLowerCase();
    if (lower.includes('abort')) return 'E-ABORT';
    if (lower.includes('not found') || lower.includes('不存在')) return 'E-NOT-FOUND';
    if (lower.includes('permission') || lower.includes('denied') || lower.includes('权限')) {
      return 'E-PERMISSION';
    }
    if (lower.includes('quota')) return 'E-QUOTA';
  }
  return 'E-IO';
}

/**
 * 失败结果构造器（`*Safe` 内部统一从这里出口，避免各处手写 `retryable` 算错）。
 */
export function failFileOp<T>(
  stage: FileOpFailStage,
  error: unknown,
): Extract<FileOpOutcome<T>, { kind: 'failed' }> {
  return { kind: 'failed', stage, error: toFileOpError(error) };
}

/** 部分成功构造器（目标已建、删源失败） */
export function partialFileOp<T>(
  created: T,
  error: unknown,
): Extract<FileOpOutcome<T>, { kind: 'partial' }> {
  return { kind: 'partial', created, sourceRetained: true, error: toFileOpError(error) };
}

/**
 * 结果 → 供 UI 判断的最小事实包（**唯一**的「这次操作发生了什么」判据）。
 *
 * 存在的理由：UI（FileManager 的部分成功面板、树里的「重复」标记、当前文档目的地重绑）
 * 都要问同一组问题，分散写 `outcome.kind === 'partial' && ...` 迟早出现分歧。
 */
export interface FileOpFacts {
  /** 是否完全成功 */
  succeeded: boolean;
  /** 是否部分完成（目标已建、源仍在 → 磁盘上两份） */
  partial: boolean;
  /** 是否用户取消（零副作用，UI 应静默） */
  cancelled: boolean;
  /** 失败时的错误码；非失败为 null */
  errorCode: FileOpErrorCode | null;
  /** 是否值得重试 */
  retryable: boolean;
}

export function fileOpFacts<T>(outcome: FileOpOutcome<T>): FileOpFacts {
  switch (outcome.kind) {
    case 'ok':
      return { succeeded: true, partial: false, cancelled: false, errorCode: null, retryable: false };
    case 'cancelled':
      return { succeeded: false, partial: false, cancelled: true, errorCode: null, retryable: false };
    case 'partial':
      return {
        succeeded: false,
        partial: true,
        cancelled: false,
        errorCode: outcome.error.code,
        retryable: outcome.error.retryable,
      };
    case 'failed':
      return {
        succeeded: false,
        partial: false,
        cancelled: false,
        errorCode: outcome.error.code,
        retryable: outcome.error.retryable,
      };
  }
}

/** 取成功值；`ok` 之外 → null（调用方据此分支，不必先窄化） */
export function fileOpValue<T>(outcome: FileOpOutcome<T>): T | null {
  return outcome.kind === 'ok' ? outcome.value : null;
}

/** 部分成功时也把 `created` 算作可用产物（目的地重绑需要它） */
export function fileOpCreated<T>(outcome: FileOpOutcome<T>): T | null {
  if (outcome.kind === 'ok') return outcome.value;
  if (outcome.kind === 'partial') return outcome.created;
  return null;
}

// ---------------------------------------------------------------- 文件名前置校验（§3.3）

/** 文件名问题的判别结果（`FileOpErrorCode` 之外的 UI 前置校验面） */
export type FileNameProblem =
  /** 空 / 仅空白 */
  | 'empty'
  /** 含 `/` 或 `\`（路径分隔符，会把文件写到别处） */
  | 'separator'
  /** 含控制字符（不可见，落盘后无法在系统文件管理器里正常操作） */
  | 'control'
  /** 与源名完全相同（大小写敏感相等）→ 零 I/O 直接取消 */
  | 'same'
  /**
   * 仅大小写不同 → **拒绝**（不是「加序号」）。
   * 理由：浏览器文件接口没有原地改名能力，实现是「复制后删除」；在大小写不敏感的磁盘上
   * `Note.mm.md` 与 `note.mm.md` 是同一个文件，复制后删除会把自己删掉。
   * 现状 `uniqueName` 会静默产出 `note 2.mm.md`（`directoryHost.ts:352-365`）—— 明确不要。
   */
  | 'case-only'
  /** 合法 */
  | null;

/**
 * 改名/新建名的前置校验（file-management §3.3「前置校验」全部四条）。
 *
 * 纯函数：`prevName` 为 `null` 时跳过与源名的比较（新建路径）。
 */
export function checkFileName(next: string, prevName: string | null): FileNameProblem {
  if (next.trim() === '') return 'empty';
  if (next.includes('/') || next.includes('\\')) return 'separator';
  if (hasControlChar(next)) return 'control';
  if (prevName === null) return null;
  if (next === prevName) return 'same';
  if (next.toLowerCase() === prevName.toLowerCase()) return 'case-only';
  return null;
}

/** 是否含控制字符（含 DEL）。用码位比较而非正则：正则字面量里写控制字符会触发 lint 规则 */
function hasControlChar(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code !== undefined && (code < 0x20 || code === 0x7f)) return true;
  }
  return false;
}

/**
 * 同名冲突时「保留两份」的目标名（`架构.mm.md` → `架构 2.mm.md`）。
 *
 * 与 `directoryHost.splitExt` 同口径：`.mm.md` 是**复合扩展名**，`lastIndexOf('.')`
 * 会切出 `架构.mm 2.md`（应用认不出这是导图）。
 *
 * @param taken 已占用的名字判定（生产传 `dir.getFileHandle` 探测；测试传集合）
 */
export async function uniqueCopyName(
  name: string,
  taken: (candidate: string) => Promise<boolean> | boolean,
  max = 1000,
): Promise<string> {
  const { base, ext } = splitDocExt(name);
  let candidate = name;
  for (let i = 2; i < max; i++) {
    if (!(await taken(candidate))) return candidate;
    candidate = `${base} ${i}${ext}`;
  }
  return candidate;
}

/** 拆 `base` / `ext`，`.mm.md` 视为一个整体扩展名（与 directoryHost 同口径） */
export function splitDocExt(name: string): { base: string; ext: string } {
  for (const ext of ['.mm.md', '.md']) {
    if (name.toLowerCase().endsWith(ext)) {
      const base = name.slice(0, name.length - ext.length);
      if (base.length > 0) return { base, ext: name.slice(base.length) };
    }
  }
  const dot = name.lastIndexOf('.');
  if (dot > 0) return { base: name.slice(0, dot), ext: name.slice(dot) };
  return { base: name, ext: '' };
}

/** 副本文件名（§3.5「创建副本」：`架构.mm.md` → `架构 副本.mm.md`，同名再加序号） */
export async function duplicateName(
  name: string,
  taken: (candidate: string) => Promise<boolean> | boolean,
): Promise<string> {
  const { base, ext } = splitDocExt(name);
  const first = `${base} 副本${ext}`;
  if (!(await taken(first))) return first;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} 副本 ${i}${ext}`;
    if (!(await taken(candidate))) return candidate;
  }
  return `${base} 副本 ${1000}${ext}`;
}

/**
 * 外部修改复查（F3 / L4）：`{size, lastModified}` 快照是否仍然一致。
 *
 * 为什么必须复查：部分成功状态下「重试删除原始」删的是**源文件**；用户在应用外改了它
 * （别的编辑器保存过）时，直接删会丢掉那些改动。`size` + `lastModified` 是这一步可用的
 * 唯一廉价证据 —— 注意它**只能**用来决定「要不要停下来问」，不能用它判定「内容相同」
 * （`shared-contracts.md` §4.5.2：`size`+`mtime` 不得当作内容等价）。
 *
 * 指针快照缺失（`null` / 读不到）→ 视为**不可复查** → 保守不删。
 */
export interface FileStatSnapshot {
  size: number;
  lastModified: number;
}

export function statUnchanged(
  before: FileStatSnapshot | null,
  after: FileStatSnapshot | null,
): boolean {
  if (before === null || after === null) return false;
  return before.size === after.size && before.lastModified === after.lastModified;
}

// ---------------------------------------------------------------- 内部工具

function stringFieldOf(value: unknown, key: 'name' | 'message'): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  if (!(key in value)) return undefined;
  const field: unknown = Reflect.get(value, key);
  return typeof field === 'string' ? field : undefined;
}

function detailOf(error: unknown): string | undefined {
  const name = stringFieldOf(error, 'name');
  const message = stringFieldOf(error, 'message');
  if (name !== undefined && message !== undefined) return `${name}: ${message}`;
  if (message !== undefined) return message;
  if (name !== undefined) return name;
  if (error === undefined || error === null) return undefined;
  return String(error);
}
