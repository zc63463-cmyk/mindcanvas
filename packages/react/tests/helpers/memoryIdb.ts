/**
 * 内存 IDB 替身 v3：支持 **abort 与原子回滚**（计划 §4.2，供三个入口共用）。
 *
 * 相对 v2 的关键修正（CR2-2）：
 * - 写请求**暂存**（staged），`oncomplete` 时才发布到 memStore；`abort` 时**丢弃**；
 * - 任一请求失败**自动 abort**，不再「读取失败后继续 put 并提交」；
 * - 支持 `tx.abort()` 主动中止与 `onabort`；
 * - `oncomplete` / `onabort` **互斥结算**（只触发其一）；
 * - `fail.writeAt = N` 让**第 N 个**写请求失败，从而命中原 v2 覆盖不到的窗口：
 *   「第一条写已执行、第二条失败」时两键都不变。
 *
 * 另对齐三条既有语义：① 一次事务可多次 put/delete；② `get()` 的 `result` 在
 * `onsuccess` 时才可读；③ 事务按创建顺序串行（重叠 scope 的 readwrite 串行）。
 *
 * **共享态挂在 `globalThis`**：使 `vi.resetModules()` 后的多个模块实例共用同一个
 * 「数据库」与同一条事务串行链——这是 CR2-4 要求「两个独立调用方共用数据库但不共享
 * `writeChain`」的前提（真实 IDB 的串行是**每库**的，不是每模块的）。
 *
 * 说明：这是**计划用夹具**。实现时若与真实 IDB 行为不符，以真实行为为准校准；
 * **不得**为了让测试变绿而放宽生产断言（见 review-receipt.md §7）。
 * G0 勘误：由 handle-store.test.ts 内联替身抽取为本 helper，供
 * handle-store.test.ts / directory-host.test.ts / counterexamples 共同导入。
 */

interface FakeReq {
  result: unknown;
  error: unknown;
  onsuccess: null | (() => void);
  onerror: null | ((e: unknown) => void);
  onupgradeneeded: null | (() => void);
}

export interface FakeIdbState {
  mem: Map<string, unknown>;
  /** `read` = 所有读失败；`readKey` = 只让某个键的读失败（CR2-3：只注入注册表读取错误，裸键仍可读） */
  fail: { open: boolean; read: boolean; readKey: string | null; writeAt: number };
  txChain: { p: Promise<void> };
  /** 已提交事务计数：用于断言「失败时 oncomplete 未触发」 */
  commitCount: number;
}

const g = globalThis as unknown as { __fakeIdb?: FakeIdbState };
function ensureIdbState(): FakeIdbState {
  const cur = g.__fakeIdb;
  if (cur !== undefined) return cur;
  const fresh: FakeIdbState = {
    mem: new Map<string, unknown>(),
    fail: { open: false, read: false, readKey: null, writeAt: 0 },
    txChain: { p: Promise.resolve() },
    commitCount: 0,
  };
  g.__fakeIdb = fresh;
  return fresh;
}
export const st: FakeIdbState = ensureIdbState();
export const memStore = st.mem;
export const fail = st.fail;

const STORE = 'handles';

/** 一次事务：v3 —— 暂存 + 失败中止 + 提交发布 + abort 丢弃 */
function makeTx() {
  const tasks: Array<() => void> = [];
  const staged: Array<() => void> = [];
  let writeCount = 0;
  let settled: 'complete' | 'abort' | null = null;
  let abortRequested = false;

  const finish = (kind: 'complete' | 'abort'): void => {
    if (settled !== null) return; // 互斥结算
    settled = kind;
    if (kind === 'complete') {
      st.commitCount += 1;
      tx.oncomplete?.();
    } else {
      tx.onabort?.();
    }
  };

  const request = (run: (req: FakeReq) => void): FakeReq => {
    const req: FakeReq = {
      result: undefined,
      error: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    };
    tasks.push(() => run(req));
    return req;
  };

  const failWrite = (req: FakeReq): void => {
    writeCount += 1;
    if (fail.writeAt !== writeCount) return;
    req.error = new Error(`write #${writeCount} failed`);
    abortRequested = true;
    req.onerror?.(req.error);
    tx.onerror?.(req.error);
  };

  const tx = {
    error: null as unknown,
    oncomplete: null as null | (() => void),
    onabort: null as null | (() => void),
    onerror: null as null | ((e: unknown) => void),
    /** 主动中止（生产代码在 mutate 抛错 / 记录非法时调用） */
    abort(): void {
      abortRequested = true;
    },
    objectStore: () => ({
      put: (v: unknown, k: string) =>
        request((req) => {
          failWrite(req);
          if (req.error !== null) return;
          staged.push(() => memStore.set(k, v));
          req.onsuccess?.();
        }),
      delete: (k: string) =>
        request((req) => {
          failWrite(req);
          if (req.error !== null) return;
          staged.push(() => memStore.delete(k));
          req.onsuccess?.();
        }),
      get: (k: string) =>
        request((req) => {
          if (fail.read || fail.readKey === k) {
            req.error = new Error(`read failed: ${k}`);
            abortRequested = true;
            req.onerror?.(req.error);
            tx.onerror?.(req.error);
            return;
          }
          req.result = memStore.get(k);
          req.onsuccess?.();
        }),
    }),
  };

  st.txChain.p = st.txChain.p.then(
    () =>
      new Promise<void>((resolve) => {
        // 先让当前同步块把本事务的操作登记完，再按登记顺序执行
        queueMicrotask(() => {
          // 索引循环：`get` 的 onsuccess 里新登记的 put 也会在同一事务内执行
          for (let i = 0; i < tasks.length && !abortRequested; i++) tasks[i]?.();
          if (abortRequested) {
            staged.length = 0; // 回滚：丢弃全部暂存
            finish('abort');
          } else {
            for (const op of staged) op(); // 提交：发布
            finish('complete');
          }
          resolve();
        });
      }),
  );
  return tx;
}

function openReq(): FakeReq {
  const r: FakeReq = { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
  queueMicrotask(() => {
    if (fail.open) {
      r.error = new Error('open failed');
      r.onerror?.(r.error);
      return;
    }
    r.result = {
      objectStoreNames: { contains: (n: string) => n === STORE },
      createObjectStore: () => undefined,
      transaction: () => makeTx(),
    };
    r.onupgradeneeded?.();
    r.onsuccess?.();
  });
  return r;
}

export function installMemoryIndexedDB(): void {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = {
    open: () => openReq(),
  } as unknown as IDBFactory;
}

/** 每个用例前重置共享态（含 commitCount 与串行链） */
export function resetFixture(): void {
  memStore.clear();
  fail.open = false;
  fail.read = false;
  fail.readKey = null;
  fail.writeAt = 0;
  st.commitCount = 0;
  st.txChain.p = Promise.resolve();
}
