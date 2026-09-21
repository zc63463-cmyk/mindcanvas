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
import { isRegistryRecord } from './workspaceScope.js';
import type { RegistryReadResult, WorkspaceRegistryRecord } from './workspaceScope.js';

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

// ============================================================ P0-0-2 工作区注册表
//
// 为什么是**新键**（CE-02）：身份记录必须与裸句柄分开存。把 `{handle, scopeId, v}`
// 之类的包装对象写进既有的 `'workspace-root'` 会让旧版本读不回工作区（它的
// `isDirectoryHandle` 谓词要求对象上直接有 `getDirectoryHandle`）。因此：
//   - `'workspace-root'`          永远只放**裸**目录句柄（既有语义不变）；
//   - `'workspace-registry.v1'`   单键单记录，存全部身份条目。
//
// 为什么读必须**四态**（R2）：既有 `getRaw()` 在 `catch` 后返回 `null`，把
// 「存储故障」与「键不存在」折叠成同一种结果；注册表路径若复用它，会在读不到库时
// 误触发 legacy adoption 并**写坏一个其实存在的数据**。故新增可报告失败的读原语。
//
// 为什么写必须**事务内 RMW**（R3）：若允许调用方在事务外构造完整记录再写入，
// 两个并发调用各自读到同一旧记录、各自合并、各自写回 → 后写覆盖先写（丢更新）。
// 依赖 IDB 规范「重叠 scope 的 readwrite 事务按创建顺序串行」；模块内的
// `writeChain` 另保证**本页**并发调用的「开库 → 建事务」顺序稳定（跨上下文仍以
// 事务串行为准——这也是测试里需要两个独立模块实例的原因）。

/** 工作区注册表键（新键；`'workspace-root'` 永远保持裸句柄，见 CE-02） */
export const WORKSPACE_REGISTRY_KEY = 'workspace-registry.v1';

/** 裸句柄键（`WORKSPACE_ROOT_KEY`）的处置，与注册表变更**在同一事务内**提交 */
export type LegacyHandleIntent =
  | { kind: 'unchanged' }
  | { kind: 'write'; handle: FsDirectoryHandle }
  | { kind: 'delete' };

/**
 * 注册表变更函数：在**事务内**基于事务内读到的结果计算新记录。
 * 返回值语义：
 * - 合法记录      → 写入
 * - `'unchanged'` → 本次不写注册表键（只处置裸句柄）
 * - `'conflict'`  → 事务读到的状态与阶段 1 基线不一致 → **不写任何键**，交调用方重新解析
 *
 * **禁止**在 mutate 内 `await` 任何非 IDB 的 Promise（`isSameEntry` 比较必须在事务外，I-25）。
 */
export type RegistryMutate = (prev: RegistryReadResult) => WorkspaceRegistryRecord | 'unchanged' | 'conflict';

export type RegistryWriteResult =
  | { kind: 'ok'; record: WorkspaceRegistryRecord | null } // null = 本次未写注册表
  | { kind: 'conflict' } // 状态已变，未写任何键
  | { kind: 'failed'; reason: 'unavailable' | 'aborted' | 'invalid' };

/**
 * 读原语：**可报告失败**（**不得**复用 `getRaw()`——它把存储故障折叠成 `null`）。
 * - `req.onerror`             → `unavailable`
 * - `req.result === undefined` → `empty`（键不存在是 empty 的唯一情形）
 * - 其余（**包括已存的 `null`**）→ `{kind:'ok', value}`，由 `classifyRaw` 判定
 *   （`null` 过不了 `isRegistryRecord` → `corrupt`；不得折叠成 `empty`）
 */
async function getRawResult(
  key: string,
): Promise<{ kind: 'ok'; value: unknown } | { kind: 'empty' } | { kind: 'unavailable' }> {
  type RawResult = { kind: 'ok'; value: unknown } | { kind: 'empty' } | { kind: 'unavailable' };
  try {
    const conn = await db();
    return await new Promise<RawResult>((resolve) => {
      let settled = false;
      const settle = (r: RawResult): void => {
        if (!settled) {
          settled = true;
          resolve(r);
        }
      };
      try {
        const req = conn.transaction(STORE, 'readonly').objectStore(STORE).get(key);
        req.onsuccess = () =>
          settle(req.result === undefined ? { kind: 'empty' } : { kind: 'ok', value: req.result });
        req.onerror = () => settle({ kind: 'unavailable' });
      } catch {
        settle({ kind: 'unavailable' });
      }
    });
  } catch {
    return { kind: 'unavailable' };
  }
}

/** 四态判定：unavailable / empty / corrupt / ok（corrupt 不删除、不修复、不覆盖） */
function classifyRaw(
  raw: { kind: 'ok'; value: unknown } | { kind: 'empty' } | { kind: 'unavailable' },
): RegistryReadResult {
  if (raw.kind === 'unavailable') return { kind: 'unavailable' };
  if (raw.kind === 'empty') return { kind: 'empty' };
  return isRegistryRecord(raw.value) ? { kind: 'ok', record: raw.value } : { kind: 'corrupt' };
}

/** 读注册表：四态见上；**永不抛** */
export async function readWorkspaceRegistry(): Promise<RegistryReadResult> {
  return classifyRaw(await getRawResult(WORKSPACE_REGISTRY_KEY));
}

/** 本页串行链：保证「开库 → 建事务」顺序稳定（跨上下文仍以 IDB 事务串行为准） */
let writeChain: Promise<unknown> = Promise.resolve();

/**
 * **单事务 read-modify-write**。同一 `readwrite` 事务内依次完成：
 * ① `get(WORKSPACE_REGISTRY_KEY)` → 判定（ok / empty / corrupt）；
 * ② 读失败 → 直接 `failed('unavailable')`，**不执行** mutate、不写任何键；
 * ③ 调用 `mutate(prev)`（**同步**；返回 Promise 会因过不了记录校验而被判 `invalid`）；
 * ④ `isRegistryRecord` 校验返回值，非法 → `tx.abort()` + `failed('invalid')`（**拒绝写入**）；
 * ⑤ 写注册表键（除非 `'unchanged'`）；
 * ⑥ 按 `legacy` 写 / 删 / 不动裸句柄键（同一事务）；
 * ⑦ `tx.oncomplete` → `ok`；`tx.onerror` / 异常 → `failed('aborted')`。
 * `mutate` 返回 `'conflict'` → `{kind:'conflict'}`，**不写任何键**。
 *
 * 不抛；失败经 `failed` 暴露；请求/事务各路径**只结算一次**（不悬挂、不重复结算）。
 */
export function writeWorkspaceRegistry(
  mutate: RegistryMutate,
  legacy: LegacyHandleIntent,
): Promise<RegistryWriteResult> {
  const op = writeChain.then(() => runRegistryWrite(mutate, legacy));
  writeChain = op.then(
    () => undefined,
    () => undefined,
  );
  return op;
}

async function runRegistryWrite(mutate: RegistryMutate, legacy: LegacyHandleIntent): Promise<RegistryWriteResult> {
  let conn: IDBDatabase;
  try {
    conn = await db();
  } catch {
    return { kind: 'failed', reason: 'unavailable' };
  }
  return await new Promise<RegistryWriteResult>((resolve) => {
    let settled = false;
    const settle = (r: RegistryWriteResult): void => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    let tx: IDBTransaction;
    try {
      tx = conn.transaction(STORE, 'readwrite');
    } catch {
      settle({ kind: 'failed', reason: 'unavailable' });
      return;
    }
    let written: WorkspaceRegistryRecord | null = null;
    const abortWith = (r: RegistryWriteResult): void => {
      try {
        tx.abort();
      } catch {
        // 事务可能已收束；以 settle 的结果为准
      }
      settle(r);
    };

    tx.oncomplete = () => settle({ kind: 'ok', record: written });
    tx.onabort = () => settle({ kind: 'failed', reason: 'aborted' });
    tx.onerror = () => settle({ kind: 'failed', reason: 'aborted' });

    let req: IDBRequest;
    try {
      req = tx.objectStore(STORE).get(WORKSPACE_REGISTRY_KEY);
    } catch {
      abortWith({ kind: 'failed', reason: 'aborted' });
      return;
    }
    req.onerror = () => abortWith({ kind: 'failed', reason: 'unavailable' });
    req.onsuccess = () => {
      try {
        const raw = req.result;
        const prev: RegistryReadResult =
          raw === undefined
            ? { kind: 'empty' }
            : isRegistryRecord(raw)
              ? { kind: 'ok', record: raw }
              : { kind: 'corrupt' };
        const next = mutate(prev);
        if (next === 'conflict') {
          settle({ kind: 'conflict' }); // 未写任何键；事务自然收束
          return;
        }
        if (next !== 'unchanged') {
          if (!isRegistryRecord(next)) {
            abortWith({ kind: 'failed', reason: 'invalid' });
            return;
          }
          tx.objectStore(STORE).put(next, WORKSPACE_REGISTRY_KEY);
          written = next;
        }
        if (legacy.kind === 'write') tx.objectStore(STORE).put(legacy.handle, WORKSPACE_ROOT_KEY);
        else if (legacy.kind === 'delete') tx.objectStore(STORE).delete(WORKSPACE_ROOT_KEY);
      } catch {
        abortWith({ kind: 'failed', reason: 'aborted' });
      }
    };
  });
}
