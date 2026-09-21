/**
 * 文件句柄持久化（FA1-T2）：跨会话保持 `FileSystemFileHandle`。
 *
 * 为什么需要：`FileSystemFileHandle` 是**不可 JSON 序列化**的结构化克隆对象，
 * localStorage（`DocLibrary`）存不了它。于是「刷新页面 / 从最近文档载入」之后
 * 文档一律丧失句柄 → 自动保存守卫 `!doc.handle` 空转，用户被迫重新选一次路径。
 *
 * 解法：IndexedDB 原生支持结构化克隆，可以直接把 handle 原样存进去。
 * 取回后权限可能处于 `prompt`（浏览器安全策略：不能凭一次手势永久授权），
 * 所以提供 `verifyPermission()`：已授权直接 true，`prompt` 时**不主动弹窗**
 * （那会在页面加载时弹出莫名其妙的权限框），留待用户下一次手势时再请求。
 */
import type { FsDirectoryHandle } from './directoryTypes.js';
import type { FsFileHandle } from './save.js';

/** IDB 库名 / 对象仓库名 */
const DB_NAME = 'mindcanvas-handles';
const STORE = 'handles';

/**
 * 句柄的权限查询/请求接口。
 *
 * 独立声明而非挂在 `FsFileHandle` 上：这是较新的 Chromium 能力，
 * 老浏览器 / jsdom 测试替身没有这两个方法 —— 可选成员让调用方零改造。
 */
export interface PermissionAware {
  queryPermission?: (desc?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (desc?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
}

/** 运行时窄化：IDB 取出的值不可信，先确认它长得像句柄（有 createWritable 函数） */
function isFileHandle(v: unknown): v is FsFileHandle {
  return (
    typeof v === 'object' && v !== null && typeof Reflect.get(v, 'createWritable') === 'function'
  );
}

/** 运行时窄化：目录句柄（有 getDirectoryHandle；无 createWritable） */
function isDirectoryHandle(v: unknown): v is FsDirectoryHandle {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof Reflect.get(v, 'getDirectoryHandle') === 'function'
  );
}

/** 通用读写（文件句柄与目录句柄共用同一 store，只是 key 前缀不同） */
async function putRaw(key: string, value: unknown): Promise<void> {
  try {
    const conn = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = conn.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('indexedDB put failed'));
    });
  } catch {
    // 隐私模式 / 配额不足：句柄持久化失败不阻断主流程
  }
}

async function getRaw(key: string): Promise<unknown> {
  try {
    const conn = await db();
    return await new Promise((resolve, reject) => {
      const req = conn.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('indexedDB get failed'));
    });
  } catch {
    return null;
  }
}

/**
 * 工作区根目录句柄的存储 key（FA2-T1）。
 *
 * 与文件句柄同库不同键：文件句柄以 docId 为 key（可能上百条），
 * 目录句柄全局只有一个，用固定 key，清理时互不干扰。
 */
export const WORKSPACE_ROOT_KEY = 'workspace-root';

/** 存工作区根目录句柄（刷新后免重复选目录） */
export async function setDirectoryHandle(handle: FsDirectoryHandle): Promise<void> {
  await putRaw(WORKSPACE_ROOT_KEY, handle);
}

/** 读工作区根目录句柄（无 / 数据损坏 → null） */
export async function getDirectoryHandle(): Promise<FsDirectoryHandle | null> {
  const v = await getRaw(WORKSPACE_ROOT_KEY);
  return isDirectoryHandle(v) ? v : null;
}

/** 清除工作区（用户主动断开目录时调用） */
export async function deleteDirectoryHandle(): Promise<void> {
  try {
    const conn = await db();
    await new Promise<void>((resolve) => {
      const tx = conn.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(WORKSPACE_ROOT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // 清理失败无副作用
  }
}

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
  });
}

/** 存句柄（以 docId 为 key；同 id 覆盖） */
export async function setFileHandle(docId: string, handle: FsFileHandle): Promise<void> {
  try {
    const conn = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = conn.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(handle, docId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('indexedDB put failed'));
    });
  } catch {
    // 隐私模式 / 配额不足：句柄持久化失败不阻断保存主流程（降级为本次会话内可用）
  }
}

/** 读句柄（无记录 / IDB 不可用 → null） */
export async function getFileHandle(docId: string): Promise<FsFileHandle | null> {
  try {
    const conn = await db();
    const value: unknown = await new Promise((resolve, reject) => {
      const req = conn.transaction(STORE, 'readonly').objectStore(STORE).get(docId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('indexedDB get failed'));
    });
    return isFileHandle(value) ? value : null;
  } catch {
    return null;
  }
}

/** 删除句柄（文档从库中移除时同步清理，避免 IDB 无限增长） */
export async function deleteFileHandle(docId: string): Promise<void> {
  try {
    const conn = await db();
    await new Promise<void>((resolve) => {
      const tx = conn.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(docId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // 清理失败无副作用
  }
}

/**
 * 权限校验：`granted` → true；`prompt` 时按 `request` 决定是否请求。
 *
 * 默认 `request = false`：页面加载/切文档属于**无用户手势**上下文，
 * 此时调 requestPermission() 会被浏览器直接拒绝（需 transient user activation），
 * 白白抛错。真正的请求留到用户点「保存」时（那时必有手势）。
 */
export async function verifyPermission(
  handle: FsFileHandle | FsDirectoryHandle,
  readWrite = true,
  request = false,
): Promise<boolean> {
  const mode = readWrite ? 'readwrite' : 'read';
  // 文件句柄与目录句柄都有这两个可选方法：运行时用 `in` 探测，不做类型断言。
  // 老浏览器 / jsdom 替身没有权限 API：假定可写，错误留到 createWritable 时兜底
  if (!('queryPermission' in handle) || typeof handle.queryPermission !== 'function') return true;
  try {
    if ((await handle.queryPermission({ mode })) === 'granted') return true;
    if (!request || !('requestPermission' in handle)) return false;
    if (typeof handle.requestPermission !== 'function') return false;
    return (await handle.requestPermission({ mode })) === 'granted';
  } catch {
    return false;
  }
}
