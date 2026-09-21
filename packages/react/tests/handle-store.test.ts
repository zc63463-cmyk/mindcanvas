// @vitest-environment jsdom
/**
 * FA1-T2：句柄跨会话持久化（IndexedDB 结构化克隆）。
 *
 * 锁死的行为：
 *  1. set → get 往返能拿回可用句柄（不可 JSON 序列化的东西也能存）；
 *  2. IDB 里塞进垃圾数据时 get 返回 null，而不是把垃圾当句柄交给保存流程；
 *  3. verifyPermission 默认**不主动请求**权限（无用户手势时请求必被浏览器拒）；
 *     只有显式 request=true 时才走 requestPermission。
 *
 * 关于 IDB 替身：真实 `FileSystemFileHandle` 是浏览器原生对象，可被结构化克隆；
 * 但 JS 测试替身上的**方法无法被克隆**（fake-indexeddb 会抛 DataCloneError）。
 * 因此往返用例用**按引用存储**的内存 IDB 替身（验证本模块的键/校验/容错逻辑），
 * 垃圾数据用例仍走 fake-indexeddb（验证真实读取路径的窄化谓词）。
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteFileHandle,
  getFileHandle,
  setFileHandle,
  verifyPermission,
} from '../src/edit/handleStore.js';
import type { FsFileHandle } from '../src/edit/save.js';

const DB_NAME = 'mindcanvas-handles';
const STORE = 'handles';

/** 按引用存储的内存 IDB 替身（不克隆，故方法能保留） */
const memStore = new Map<string, unknown>();

type FakeRequest = {
  result: unknown;
  error: unknown;
  onsuccess: null | (() => void);
  onerror: null | (() => void);
  onupgradeneeded: null | (() => void);
};

/** 值请求（get/put 返回）：result = 命中值，随后触发 onsuccess */
function valueReq(value: unknown): FakeRequest {
  const r: FakeRequest = {
    result: value,
    error: null,
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
  };
  queueMicrotask(() => r.onsuccess?.());
  return r;
}

/** 打开库请求：result = 假 DB，随后触发 onupgradeneeded + onsuccess */
function openReq(): FakeRequest {
  const r: FakeRequest = {
    result: undefined,
    error: null,
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
  };
  queueMicrotask(() => {
    const db = {
      objectStoreNames: { contains: (n: string) => n === STORE },
      createObjectStore: () => undefined,
      transaction: () => ({
        objectStore: () => ({
          put: (v: unknown, k: string) => {
            memStore.set(k, v);
            return valueReq(undefined);
          },
          get: (k: string) => valueReq(memStore.get(k)),
          delete: (k: string) => valueReq(memStore.delete(k)),
        }),
        set oncomplete(fn: () => void) {
          queueMicrotask(fn);
        },
        set onerror(_fn: () => void) {
          /* 内存实现不会失败 */
        },
      }),
    } as unknown as IDBDatabase;
    r.result = db;
    r.onupgradeneeded?.();
    r.onsuccess?.();
  });
  return r;
}

function installMemoryIndexedDB(): void {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = {
    open: () => openReq(),
  } as unknown as IDBFactory;
}

/** 真实（可解析）的 fake-indexeddb，用于需要真实读路径的用例 */
function installFakeIndexedDB(): void {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
}

beforeEach(() => {
  memStore.clear();
  installMemoryIndexedDB();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function handle(name = 'a.mm.md'): FsFileHandle {
  return {
    name,
    async createWritable() {
      return { async write() {}, async close() {} };
    },
  };
}

/** 带权限 API 的句柄替身 */
function handleWithPermission(state: PermissionState) {
  const queryPermission = vi.fn(async () => state);
  const requestPermission = vi.fn(async () => 'granted' as PermissionState);
  return {
    ...handle('p.mm.md'),
    queryPermission,
    requestPermission,
  } as unknown as FsFileHandle & {
    queryPermission: typeof queryPermission;
    requestPermission: typeof requestPermission;
  };
}

describe('handleStore：往返与容错', () => {
  it('set → get 拿回可用句柄（含 createWritable）', async () => {
    const h = handle();
    await setFileHandle('a.mm.md', h);
    const got = await getFileHandle('a.mm.md');
    expect(got).not.toBeNull();
    expect(typeof got?.createWritable).toBe('function');
  });

  it('同 id 重复 set = 覆盖（同键 put 语义），不产生重复记录', async () => {
    await setFileHandle('a.mm.md', handle('first.mm.md'));
    await setFileHandle('a.mm.md', handle('second.mm.md'));
    expect((await getFileHandle('a.mm.md'))?.name).toBe('second.mm.md');
    expect(memStore.size).toBe(1);
  });

  it('不同 id 互不干扰', async () => {
    await setFileHandle('a.mm.md', handle('a.mm.md'));
    await setFileHandle('b.mm.md', handle('b.mm.md'));
    expect((await getFileHandle('a.mm.md'))?.name).toBe('a.mm.md');
    expect((await getFileHandle('b.mm.md'))?.name).toBe('b.mm.md');
  });

  it('未存过的 id → null（不抛）', async () => {
    expect(await getFileHandle('nope.mm.md')).toBeNull();
  });

  it('delete：删后 get 为 null', async () => {
    await setFileHandle('gone.mm.md', handle());
    await deleteFileHandle('gone.mm.md');
    expect(await getFileHandle('gone.mm.md')).toBeNull();
  });

  it('IDB 里是垃圾数据（非句柄）→ null，不把垃圾透出去', async () => {
    installFakeIndexedDB();
    // 直接写脏记录：模拟旧版本 schema / 手动改库 / 数据损坏
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE);
      };
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ not: 'a handle' }, 'dirty.mm.md');
      tx.oncomplete = () => resolve();
    });
    expect(await getFileHandle('dirty.mm.md')).toBeNull();
  });

  it('indexedDB 不可用（隐私模式）→ 静默降级，不抛（保存主流程不受影响）', async () => {
    const real = globalThis.indexedDB;
    (globalThis as { indexedDB?: IDBFactory }).indexedDB = undefined;
    await expect(setFileHandle('x.mm.md', handle())).resolves.toBeUndefined();
    expect(await getFileHandle('x.mm.md')).toBeNull();
    globalThis.indexedDB = real;
  });
});

describe('verifyPermission：权限策略', () => {
  it('granted → true，且不发起请求', async () => {
    const h = handleWithPermission('granted');
    expect(await verifyPermission(h, true)).toBe(true);
    expect(h.requestPermission).not.toHaveBeenCalled();
  });

  it('prompt + 默认不请求 → false（页面加载态不弹窗）', async () => {
    const h = handleWithPermission('prompt');
    expect(await verifyPermission(h, true)).toBe(false);
    expect(h.requestPermission).not.toHaveBeenCalled();
  });

  it('prompt + request=true（用户点保存的手势）→ 发起请求并按结果返回', async () => {
    const h = handleWithPermission('prompt');
    expect(await verifyPermission(h, true, true)).toBe(true);
    expect(h.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
  });

  it('denied + request=true → 请求后仍 denied → false', async () => {
    const h = handleWithPermission('denied');
    h.requestPermission.mockResolvedValue('denied');
    expect(await verifyPermission(h, true, true)).toBe(false);
  });

  it('老浏览器无权限 API → 假定可写（错误留给 createWritable 兜底）', async () => {
    expect(await verifyPermission(handle(), true)).toBe(true);
  });

  it('权限 API 抛错 → false，不把异常冒泡进保存流程', async () => {
    const broken = {
      ...handle(),
      queryPermission: async () => {
        throw new Error('boom');
      },
    } as unknown as FsFileHandle;
    expect(await verifyPermission(broken, true)).toBe(false);
  });

  it('readWrite=false → 以 read 模式查询（只读场景不索要写权限）', async () => {
    const h = handleWithPermission('granted');
    await verifyPermission(h, false);
    expect(h.queryPermission).toHaveBeenCalledWith({ mode: 'read' });
  });
});
