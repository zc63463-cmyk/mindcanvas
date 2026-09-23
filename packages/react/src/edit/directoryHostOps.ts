/**
 * P0-A：目录宿主的 `*Safe` 文件原语（`directoryHost.ts` 的 P0-A 增量部分）。
 *
 * 为什么单独一层：`directoryHost.ts` 已逼近代码预算的 `bigFiles` 红线（600 行）。
 * 这几个方法只依赖「根目录句柄 + 路径工具 + 错误类型」，与宿主的扫描/身份逻辑无关，
 * 因此以**模块级函数**形态抽出，由宿主方法一行转发（既有调用面不变）。
 *
 * 为什么必须有 `*Safe`：移动/改名 = 「复制到目标 → 删源」，**不是原子操作**。
 * 旧实现下「目标已建、删源失败」只能靠 `catch` 收到一个异常，调用方无从知道目标是否
 * 已经建成（R-02 孤儿副本；R-03 无用户可见通道）。`partial` 这一态把这个事实显式化。
 */
import {
  type FileOpOutcome,
  type FileStatSnapshot,
  duplicateName,
  failFileOp,
  partialFileOp,
  toFileOpError,
  uniqueCopyName,
} from './fileOps.js';
import {
  isFileEntry,
  type FsDirectoryHandle,
  type WorkspaceDir,
  type WorkspaceFile,
} from './directoryTypes.js';

/** 宿主提供的内部能力（由 `DirectoryWorkspaceHost` 注入，避免把类再切一遍） */
export interface SafeHostEnv {
  /** 取根句柄（未挂载时抛错） */
  requireRoot(): FsDirectoryHandle;
  /** 按路径取目录（逐级 getDirectoryHandle） */
  dirAt(root: FsDirectoryHandle, path: string, create?: boolean): Promise<FsDirectoryHandle>;
  /** 读文件文本 */
  readFile(file: WorkspaceFile): Promise<string>;
  /** 写文件文本 */
  writeFile(file: WorkspaceFile, text: string): Promise<void>;
  /** 取尺寸/时间戳（读不到回落 {0,0}） */
  statOf(handle: WorkspaceFile['handle']): Promise<{ ts: number; size: number }>;
  /** 目录内唯一文件名（静默加序号；既有语义） */
  uniqueName(dir: FsDirectoryHandle, name: string): Promise<string>;
  /** 使扫描缓存失效 */
  invalidateTree(): void;
}

/** 路径拼接：根目录下 path 为 ''，不再产生前导斜杠 */
export function joinPath(parent: string, name: string): string {
  return parent === '' ? name : `${parent}/${name}`;
}

/** 取所在目录路径（根目录直属文件 → ''） */
export function parentOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

/** 取文件尺寸/时间戳快照（部分成功后的「外部修改复查」用；读不到 → null = 不可复查） */
export async function statFileOf(
  env: SafeHostEnv,
  file: WorkspaceFile,
): Promise<FileStatSnapshot | null> {
  const { ts, size } = await env.statOf(file.handle);
  if (ts === 0 && size === 0) return null;
  return { size, lastModified: ts };
}

/**
 * 改名（安全变体）：读旧内容 → 建新文件 → 删旧。
 *
 * @param overwrite `false`（缺省）= 不静默加序号也不覆盖，同名直接走 `uniqueName`；
 *   由 UI 走冲突三选后带明确的 `overwrite` 重入。
 */
export async function renameFileSafeOp(
  env: SafeHostEnv,
  file: WorkspaceFile,
  newName: string,
  overwrite = false,
): Promise<FileOpOutcome<WorkspaceFile>> {
  let text: string;
  try {
    text = await env.readFile(file);
  } catch (e) {
    return failFileOp('read', e);
  }
  return writeThenRemoveSource(env, parentOf(file.path), newName, text, file, overwrite);
}

/** 移动（安全变体）：复制到目标目录 → 删源 */
export async function moveFileSafeOp(
  env: SafeHostEnv,
  file: WorkspaceFile,
  targetDirPath: string,
  overwrite = false,
): Promise<FileOpOutcome<WorkspaceFile>> {
  if (parentOf(file.path) === targetDirPath) {
    // 同目录「移动」是空操作：不制造副本、不删源
    return { kind: 'ok', value: file };
  }
  let text: string;
  try {
    text = await env.readFile(file);
  } catch (e) {
    return failFileOp('read', e);
  }
  return writeThenRemoveSource(env, targetDirPath, file.name, text, file, overwrite);
}

/**
 * 「复制到目标 → 删源」的共同步骤（改名与移动只差目标目录与目标名）。
 *
 * 分步结果归因：
 *  - 目标写入失败 → `failed('write')`，**源未动**（磁盘上仍只有原件，可安全重试）；
 *  - 源删除失败 → `partial`（两份都在；这是必须让用户看见的事实，不是普通失败）。
 */
async function writeThenRemoveSource(
  env: SafeHostEnv,
  targetDirPath: string,
  targetName: string,
  text: string,
  source: WorkspaceFile,
  overwrite: boolean,
): Promise<FileOpOutcome<WorkspaceFile>> {
  let created: WorkspaceFile;
  try {
    const dir = await env.dirAt(env.requireRoot(), targetDirPath);
    if (typeof dir.getFileHandle !== 'function' || typeof dir.removeEntry !== 'function') {
      return { kind: 'failed', stage: 'write', error: toFileOpError(unavailableError('目录句柄不可写')) };
    }
    const finalName = overwrite ? targetName : await env.uniqueName(dir, targetName);
    const handle = await dir.getFileHandle(finalName, { create: true });
    created = {
      kind: 'file',
      name: finalName,
      path: joinPath(targetDirPath, finalName),
      handle,
      ts: Date.now(),
      size: text.length,
    };
    await env.writeFile(created, text);
  } catch (e) {
    return failFileOp('write', e);
  }
  env.invalidateTree();
  try {
    await removeSource(env, source);
  } catch (e) {
    // 目标已建成、源还在 → 两份。**不得**降级成 failed：目标确实写了
    // （用户能在新位置打开），说「移动失败」会掩盖磁盘现状。
    return partialFileOp(created, e);
  }
  env.invalidateTree();
  return { kind: 'ok', value: created };
}

/**
 * 删除源文件（内部）：`removeEntry` **可选**能力必须显式判定。
 *
 * 旧 `removeFile` 写的是 `await dir.removeEntry?.(...)` —— 能力缺失时整句变成
 * `await undefined`，**静默成功**：UI 以为删掉了，磁盘上文件还在。
 * 这里把能力缺失变成 `E-UNAVAILABLE`。
 */
async function removeSource(env: SafeHostEnv, file: WorkspaceFile): Promise<void> {
  const dir = await env.dirAt(env.requireRoot(), parentOf(file.path));
  if (typeof dir.removeEntry !== 'function') throw unavailableError('目录句柄不支持删除');
  await dir.removeEntry(file.name);
}

/** 删除文件（安全变体）：能力缺失 → `E-UNAVAILABLE`；权限被拒 → `E-PERMISSION` */
export async function removeFileSafeOp(
  env: SafeHostEnv,
  file: WorkspaceFile,
): Promise<FileOpOutcome<null>> {
  try {
    await removeSource(env, file);
  } catch (e) {
    return deleteFailure(e);
  }
  env.invalidateTree();
  return { kind: 'ok', value: null };
}

/** 递归删除目录（安全变体）：同 `removeFileSafeOp`，能力缺失不再静默成功 */
export async function removeDirSafeOp(
  env: SafeHostEnv,
  dir: WorkspaceDir,
): Promise<FileOpOutcome<null>> {
  try {
    const parent = await env.dirAt(env.requireRoot(), parentOf(dir.path));
    if (typeof parent.removeEntry !== 'function') throw unavailableError('目录句柄不支持删除');
    await parent.removeEntry(dir.name, { recursive: true });
  } catch (e) {
    return deleteFailure(e);
  }
  env.invalidateTree();
  return { kind: 'ok', value: null };
}

/**
 * 创建副本（§3.5）：**读源 → 同目录新建**，源一字不改。
 *
 * 与移动/改名的关键区别：没有「删源」这一步，所以不存在部分成功 ——
 * 要么新文件建成，要么什么都没变。副本沿用同一批 `assets/...` 引用（不复制二进制）。
 */
export async function duplicateFileSafeOp(
  env: SafeHostEnv,
  file: WorkspaceFile,
): Promise<FileOpOutcome<WorkspaceFile>> {
  let text: string;
  try {
    text = await env.readFile(file);
  } catch (e) {
    return failFileOp('read', e);
  }
  const parentPath = parentOf(file.path);
  try {
    const dir = await env.dirAt(env.requireRoot(), parentPath);
    if (typeof dir.getFileHandle !== 'function') {
      return { kind: 'failed', stage: 'write', error: toFileOpError(unavailableError('目录句柄不可写')) };
    }
    const name = await duplicateName(file.name, async (candidate) => {
      try {
        await dir.getFileHandle?.(candidate);
        return true;
      } catch {
        return false;
      }
    });
    const handle = await dir.getFileHandle(name, { create: true });
    const copy: WorkspaceFile = {
      kind: 'file',
      name,
      path: joinPath(parentPath, name),
      handle,
      ts: Date.now(),
      size: text.length,
    };
    await env.writeFile(copy, text);
    env.invalidateTree();
    return { kind: 'ok', value: copy };
  } catch (e) {
    return failFileOp('write', e);
  }
}

/** 带序号的目标名（冲突三选之「保留两份」） */
export async function resolveCopyNameOp(
  env: SafeHostEnv,
  dirPath: string,
  name: string,
): Promise<string> {
  const dir = await env.dirAt(env.requireRoot(), dirPath);
  return uniqueCopyName(name, async (candidate) => {
    if (typeof dir.getFileHandle !== 'function') return false;
    try {
      await dir.getFileHandle(candidate);
      return true;
    } catch {
      return false;
    }
  });
}

/** 能力缺失错误对象（显式，不再靠可选调用静默成功） */
function unavailableError(message: string): Error {
  return Object.assign(new Error(message), { name: 'NotSupportedError' });
}

/** 删除失败 → 按错误码归因（权限 → `permission` 阶段，其余 → `delete`） */
function deleteFailure(e: unknown): Extract<FileOpOutcome<null>, { kind: 'failed' }> {
  const error = toFileOpError(e);
  return { kind: 'failed', stage: error.code === 'E-PERMISSION' ? 'permission' : 'delete', error };
}

// `isFileEntry` 重导出给宿主侧使用（避免宿主再从 directoryTypes 多引一次）
export { isFileEntry };
