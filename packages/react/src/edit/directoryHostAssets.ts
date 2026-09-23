/**
 * T4：工作区 `./assets/` 的资产落盘原语（从 `directoryHost.ts` 抽出）。
 *
 * 为什么单独一层：`directoryHost.ts` 已逼近代码预算的 `bigFiles` 红线（600 行）。
 * 这几块只依赖「根句柄 + 路径工具 + 目录遍历」，与宿主的扫描/身份/`*Safe` 逻辑无关，
 * 故以模块级函数抽出，由宿主方法一行转发（既有调用面不变）。
 */
import { ASSETS_DIR, SCAN_SKIP_DIRS } from './directoryHostConstants.js';
import {
  isDirEntry,
  isFileEntry,
  type FsDirectoryHandle,
  type FsEntryHandle,
  type WorkspaceFile,
} from './directoryTypes.js';

/** 宿主提供的内部能力（避免把类再切一遍） */
export interface AssetHostEnv {
  requireRoot(): FsDirectoryHandle;
  dirAt(root: FsDirectoryHandle, path: string, create?: boolean): Promise<FsDirectoryHandle>;
  statOf(handle: WorkspaceFile['handle']): Promise<{ ts: number; size: number }>;
}

/** 遍历目录项：优先 values()，退回 entries()（不同 Chromium 版本实现不同） */
export async function* iterateDir(dir: FsDirectoryHandle): AsyncGenerator<FsEntryHandle> {
  if (typeof dir.values === 'function') {
    yield* dir.values();
    return;
  }
  if (typeof dir.entries === 'function') {
    for await (const [, entry] of dir.entries()) yield entry;
  }
}

/** 确保 `./assets/` 存在（不存在则创建） */
async function ensureAssetsDir(env: AssetHostEnv, root: FsDirectoryHandle): Promise<FsDirectoryHandle> {
  if (typeof root.getDirectoryHandle !== 'function') throw new Error('目录句柄不可写');
  return root.getDirectoryHandle(ASSETS_DIR, { create: true });
}

/**
 * 资产写进工作区的 `./assets/`（真实磁盘文件，非 IndexedDB）。
 *
 * @returns 相对工作区根的路径（如 `assets/diagram.png`）——
 *          导图里就用它引用 → 整个文件夹拷走也能离线浏览。
 */
export async function writeAssetOp(
  env: AssetHostEnv,
  name: string,
  data: ArrayBuffer | string,
  mime: string,
): Promise<string> {
  const root = env.requireRoot();
  const assets = await ensureAssetsDir(env, root);
  if (typeof assets.getFileHandle !== 'function') throw new Error('目录句柄不可写');
  const handle = await assets.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(
    typeof data === 'string' ? new Blob([data], { type: mime }) : new Blob([data], { type: mime }),
  );
  await writable.close();
  return `${ASSETS_DIR}/${name}`;
}

/**
 * 读取 `./assets/` 下的资产（供刷新后重建 objectURL 缓存）。
 * 不是导图文件，故不受 `isWorkspaceDocName` 限制 —— 这里是**显式按路径取**。
 */
export async function readAssetFileOp(env: AssetHostEnv, relPath: string): Promise<File | null> {
  try {
    const segs = relPath.split('/').filter((s) => s.length > 0);
    const fileName = segs.pop();
    if (fileName === undefined) return null;
    const dir = await env.dirAt(env.requireRoot(), segs.join('/'));
    if (typeof dir.getFileHandle !== 'function') return null;
    const handle = await dir.getFileHandle(fileName);
    return (await handle.getFile?.()) ?? null;
  } catch {
    return null;
  }
}

/** 列出 `./assets/` 下的全部资产（刷新后用于恢复图库） */
export async function listAssetFilesOp(env: AssetHostEnv): Promise<WorkspaceFile[]> {
  try {
    const root = env.requireRoot();
    if (typeof root.getDirectoryHandle !== 'function') return [];
    const assets = await root.getDirectoryHandle(ASSETS_DIR);
    const out: WorkspaceFile[] = [];
    for await (const entry of iterateDir(assets)) {
      if (!isFileEntry(entry)) continue;
      const rawName = Reflect.get(entry, 'name');
      if (typeof rawName !== 'string') continue;
      const { ts, size } = await env.statOf(entry);
      out.push({
        kind: 'file',
        name: rawName,
        path: `${ASSETS_DIR}/${rawName}`,
        handle: entry,
        ts,
        size,
      });
    }
    return out;
  } catch {
    return []; // assets/ 还没建过 → 视为空
  }
}

/** 资产是否已存在于磁盘（避免重复写入） */
export async function hasAssetOp(env: AssetHostEnv, relPath: string): Promise<boolean> {
  try {
    const segs = relPath.split('/').filter((s) => s.length > 0);
    const fileName = segs.pop();
    if (fileName === undefined) return false;
    const dir = await env.dirAt(env.requireRoot(), segs.join('/'));
    if (typeof dir.getFileHandle !== 'function') return false;
    await dir.getFileHandle(fileName);
    return true;
  } catch {
    return false;
  }
}

// `SCAN_SKIP_DIRS` / `isDirEntry` 仅为保持与本模块职责相邻的可见性（宿主侧仍各自引用）
void SCAN_SKIP_DIRS;
void isDirEntry;
