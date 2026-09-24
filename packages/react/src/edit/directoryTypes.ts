/**
 * 目录句柄的类型声明（FA2-T1）。
 *
 * 与 `save.ts` 里的 `FsFileHandle` 同源思路：**声明到全局 Window**，
 * 让 `window.showDirectoryPicker` 可直接查、可补全，调用方零 `as` 断言。
 */
import type { FsFileHandle, FsWritable } from './save.js';

/** 目录句柄（FileSystemDirectoryHandle 的最小可用面） */
export interface FsDirectoryHandle {
  name?: string;
  kind?: 'directory';
  /** 列举目录项（异步迭代器；部分实现只给 entries/values） */
  entries?: () => AsyncIterableIterator<[string, FsEntryHandle]>;
  values?: () => AsyncIterableIterator<FsEntryHandle>;
  /** 取/建子目录 */
  getDirectoryHandle?: (name: string, opts?: { create?: boolean }) => Promise<FsDirectoryHandle>;
  /** 取/建文件 */
  getFileHandle?: (name: string, opts?: { create?: boolean }) => Promise<FsFileHandle>;
  /** 删除项（递归删目录） */
  removeEntry?: (name: string, opts?: { recursive?: boolean }) => Promise<void>;
  /** 权限（Chromium） */
  queryPermission?: (desc?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (desc?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
  /**
   * 目录同一性比较（Chromium）。
   * 缺失或抛错时**必须**按「无法判定」处理（保守降级，不得按名称猜测）——
   * 见 docs/specs/2026-09-19-file-assets-contract-close/contract-delta.md CD-02。
   */
  isSameEntry?: (other: unknown) => Promise<boolean>;
}

/** 目录项句柄 = 文件或目录 */
export type FsEntryHandle = (FsFileHandle & { kind?: 'file' }) | FsDirectoryHandle;

/** 目录写入器（建文件用的最小面） */
export interface FsDirWritable extends FsWritable {}

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      id?: string;
      mode?: 'read' | 'readwrite';
      startIn?: unknown;
    }) => Promise<FsDirectoryHandle>;
  }
}

/** 工作区里的一个节点（文件树的一项） */
export interface WorkspaceFile {
  kind: 'file';
  /** 文件名（含扩展名） */
  name: string;
  /** 相对工作区根目录的路径，`/` 分隔（根目录直属文件即文件名本身） */
  path: string;
  handle: FsFileHandle;
  /** 最后修改时间（读不到时回落 0，不阻塞渲染） */
  ts: number;
  /** 字节大小（读不到时回落 0） */
  size: number;
  /**
   * P1-A ⑤：本应用**不打开**的文件（非 `.mm.md`/`.md`，或 `.` 开头的隐藏文件）。
   *
   * 只在 `scan({ includeOtherFiles: true })` 时出现。带此标记的文件**只有**一个
   * 用途：在「显示其他文件」分组里灰显列出（点击给提示）。所有写路径
   * （打开/改名/移动/删除）都不得把它当成可操作目标 —— 缺省 `undefined` = 正常文件。
   */
  unopenable?: true;
}

/** 工作区里的一个目录 */
export interface WorkspaceDir {
  kind: 'dir';
  name: string;
  /** 相对路径；根为 '' */
  path: string;
  handle: FsDirectoryHandle;
  children: WorkspaceNode[];
}

export type WorkspaceNode = WorkspaceFile | WorkspaceDir;

/** 运行时窄化：目录项是不是文件（有 getFile 的当文件） */
export function isFileEntry(e: FsEntryHandle): e is FsFileHandle & { kind?: 'file' } {
  return typeof Reflect.get(e, 'getFile') === 'function' || Reflect.get(e, 'kind') === 'file';
}

/** 运行时窄化：目录项是不是目录 */
export function isDirEntry(e: FsEntryHandle): e is FsDirectoryHandle {
  return typeof Reflect.get(e, 'getDirectoryHandle') === 'function';
}

/** 是否值得收进工作区文件的扩展名（.mm.md / .md） */
export function isWorkspaceDocName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.mm.md') || lower.endsWith('.md');
}
