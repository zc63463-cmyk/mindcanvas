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
 *
 * P0-0 起：内存替身升级为 **v3**（暂存 / 失败中止 / 提交发布 / abort 丢弃 / 互斥结算），
 * 并抽取到 `tests/helpers/memoryIdb.ts` 供 handle-store / directory-host / counterexamples
 * 三个入口共用（G0 勘误：「抽到反例文件可导入的位置或等价复制均可」）。
 * **原有 15 个用例的断言不得改动**，只改它们引用的 helper 名字。
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WORKSPACE_REGISTRY_KEY,
  deleteDirectoryHandle,
  deleteFileHandle,
  getDirectoryHandle,
  getFileHandle,
  readWorkspaceRegistry,
  setDirectoryHandle,
  setFileHandle,
  verifyPermission,
  writeWorkspaceRegistry,
} from '../src/edit/handleStore.js';
import type { RegistryMutate } from '../src/edit/handleStore.js';
import type { FsDirectoryHandle } from '../src/edit/directoryTypes.js';
import type { FsFileHandle } from '../src/edit/save.js';
import type { RegistryReadResult, WorkspaceRegistryRecord } from '../src/edit/workspaceScope.js';
import {
  emptyRec,
  expectThreeUpdates,
  legalAppend,
  loadTwoInstances,
  makeBarrier,
} from './helpers/registryConcurrency.js';
import { fail, installMemoryIndexedDB, memStore, resetFixture, st } from './helpers/memoryIdb.js';

const DB_NAME = 'mindcanvas-handles';
const STORE = 'handles';

/** 真实（可解析）的 fake-indexeddb，用于需要真实读路径的用例 */
function installFakeIndexedDB(): void {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
}

beforeEach(() => {
  installMemoryIndexedDB();
  resetFixture();
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

/** 目录句柄替身：带 `getDirectoryHandle` 以满足 `isDirectoryHandle` 谓词 */
function dirHandle(name: string): FsDirectoryHandle {
  return { name, kind: 'directory', getDirectoryHandle: async () => dirHandle(name) } as FsDirectoryHandle;
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

describe('handleStore：工作区注册表（单事务 RMW）', () => {
  /** 构造一个合法注册表记录（便于断言） */
  const rec = (ids: readonly string[]): WorkspaceRegistryRecord => ({
    v: 1,
    activeScopeId: ids[ids.length - 1] ?? null,
    entries: ids.map((s, i) => ({
      scopeId: s,
      handle: dirHandle(s),
      label: s,
      lastSeenAt: i + 1,
      state: i === ids.length - 1 ? ('active' as const) : ('dormant' as const),
      associations: [{ at: 1, via: 'isSameEntry' as const }],
    })),
  });

  it('R3：RMW 往返 —— mutate 在事务内基于**事务读到的**旧记录计算', async () => {
    await writeWorkspaceRegistry(() => rec(['ws:1']), { kind: 'write', handle: dirHandle('A') });
    let seen: RegistryReadResult | null = null;
    const out = await writeWorkspaceRegistry(
      (prev) => {
        seen = prev;
        return prev.kind === 'ok' ? rec(['ws:1', 'ws:2']) : rec(['ws:2']);
      },
      { kind: 'unchanged' },
    );
    expect(seen).not.toBeNull();
    expect((seen as unknown as RegistryReadResult).kind).toBe('ok'); // 事务内读到了上一次的写入
    expect(out).toMatchObject({ kind: 'ok' });
    const got = await readWorkspaceRegistry();
    expect(got.kind === 'ok' && got.record.entries.map((e) => e.scopeId)).toEqual(['ws:1', 'ws:2']);
  });

  it('R3：并发两次 RMW 不丢更新（事务串行 + 事务内读）', async () => {
    await writeWorkspaceRegistry(() => rec(['ws:a']), { kind: 'unchanged' });
    const append = (id: string) => (prev: RegistryReadResult): WorkspaceRegistryRecord => {
      const base = prev.kind === 'ok' ? prev.record : rec([]);
      // ★G0 勘误：追加必须保持合法——旧条目一律转 dormant 后再追加新 active（与生产 upsertEntry、
      // §5 legalAppend 同规）。旧版保留旧 active 会形成「两个 active」，被 isRegistryRecord 判 invalid →
      // 正例在正确实现下必红（与 CR2-4A 同类问题）。
      return {
        ...base,
        entries: [...base.entries.map((e) => ({ ...e, state: 'dormant' as const })), ...rec([id]).entries],
        activeScopeId: id,
      };
    };
    const [r1, r2] = await Promise.all([
      writeWorkspaceRegistry(append('ws:b'), { kind: 'unchanged' }),
      writeWorkspaceRegistry(append('ws:c'), { kind: 'unchanged' }),
    ]);
    expect(r1).toMatchObject({ kind: 'ok' }); // ★G0 勘误：两次都必须被接受（不得是 invalid）
    expect(r2).toMatchObject({ kind: 'ok' });
    const got = await readWorkspaceRegistry();
    const ids = got.kind === 'ok' ? got.record.entries.map((e) => e.scopeId).sort() : [];
    expect(ids).toEqual(['ws:a', 'ws:b', 'ws:c']); // 两次变更都保留
  });

  it('R1：注册表变更与裸句柄删除在同一事务（detach 原子）', async () => {
    await writeWorkspaceRegistry(() => rec(['ws:1']), { kind: 'write', handle: dirHandle('A') });
    expect(await getDirectoryHandle()).not.toBeNull();
    const out = await writeWorkspaceRegistry(
      (prev) =>
        prev.kind === 'ok'
          ? {
              ...prev.record,
              activeScopeId: null,
              entries: prev.record.entries.map((e) => ({ ...e, state: 'dormant' as const })),
            }
          : 'unchanged',
      { kind: 'delete' },
    );
    expect(out).toMatchObject({ kind: 'ok' });
    expect(await getDirectoryHandle()).toBeNull(); // 裸键已删
    const got = await readWorkspaceRegistry();
    expect(got.kind === 'ok' && got.record.activeScopeId).toBeNull(); // 注册表已 dormant
    expect(got.kind === 'ok' && got.record.entries).toHaveLength(1); // 条目未删
  });

  it('R1 负向：第 1 条写成功、第 2 条失败 → 两键都保持旧值（原子回滚，CR2-2）', async () => {
    await writeWorkspaceRegistry(() => rec(['ws:old']), { kind: 'write', handle: dirHandle('OLD') });
    const commitsBefore = st.commitCount;

    fail.writeAt = 2; // 第 1 个写请求成功（暂存），第 2 个失败 → 中止
    const out = await writeWorkspaceRegistry(() => rec(['ws:new']), { kind: 'write', handle: dirHandle('NEW') });
    fail.writeAt = 0;

    expect(out).toEqual({ kind: 'failed', reason: 'aborted' }); // Promise 收束
    expect(st.commitCount).toBe(commitsBefore); // oncomplete 未触发
    const got = await readWorkspaceRegistry();
    expect(got.kind === 'ok' && got.record.entries.map((e) => e.scopeId)).toEqual(['ws:old']); // 注册表回滚
    expect((await getDirectoryHandle())?.name).toBe('OLD'); // 裸键回滚
  });

  it('R1 负向：第 1 条写成功、第 2 条是删除且失败 → 两键都保持旧值', async () => {
    await writeWorkspaceRegistry(() => rec(['ws:old']), { kind: 'write', handle: dirHandle('OLD') });
    fail.writeAt = 2;
    const out = await writeWorkspaceRegistry(
      // ★CR2-4A：必须先构造**合法**记录（条目转 dormant + activeScopeId=null），
      // 否则会被 isRegistryRecord 判为 invalid 而在到达 delete 请求前就中止，
      // 命不中「第二次 delete 失败」这个窗口。
      (prev) =>
        prev.kind === 'ok'
          ? {
              ...prev.record,
              activeScopeId: null,
              entries: prev.record.entries.map((e) => ({ ...e, state: 'dormant' as const })),
            }
          : 'unchanged',
      { kind: 'delete' },
    );
    fail.writeAt = 0;
    expect(out).toEqual({ kind: 'failed', reason: 'aborted' });
    expect(await getDirectoryHandle()).not.toBeNull(); // 删除被回滚
    const got = await readWorkspaceRegistry();
    expect(got.kind === 'ok' && got.record.activeScopeId).toBe('ws:old');
  });

  it('CR2-2：mutate 抛错 → 中止，两键不变', async () => {
    await writeWorkspaceRegistry(() => rec(['ws:old']), { kind: 'write', handle: dirHandle('OLD') });
    const out = await writeWorkspaceRegistry(() => {
      throw new Error('boom');
    }, { kind: 'delete' });
    expect(out).toEqual({ kind: 'failed', reason: 'aborted' });
    expect((await getDirectoryHandle())?.name).toBe('OLD');
    const got = await readWorkspaceRegistry();
    expect(got.kind === 'ok' && got.record.entries).toHaveLength(1);
  });

  it('R2：键不存在 → empty（仅此一种情形；已存 null 是 corrupt，不是 empty）', async () => {
    expect((await readWorkspaceRegistry()).kind).toBe('empty');
    // ★G0 勘误：`null` 是「键存在但值非法」，不是「键不存在」——不得折叠成 empty
    memStore.set(WORKSPACE_REGISTRY_KEY, null);
    expect((await readWorkspaceRegistry()).kind).toBe('corrupt');
  });

  it('R2：结构非法 → corrupt，且不删除、不修复', async () => {
    memStore.set(WORKSPACE_REGISTRY_KEY, { not: 'a registry' });
    expect((await readWorkspaceRegistry()).kind).toBe('corrupt');
    expect((await readWorkspaceRegistry()).kind).toBe('corrupt');
    expect(memStore.has(WORKSPACE_REGISTRY_KEY)).toBe(true);
  });

  it('R2：IDB 打开失败 → unavailable（**不得**折叠成 empty）', async () => {
    fail.open = true;
    expect((await readWorkspaceRegistry()).kind).toBe('unavailable');
    fail.open = false;
  });

  it('R2：读取失败 → unavailable', async () => {
    fail.read = true;
    expect((await readWorkspaceRegistry()).kind).toBe('unavailable');
    fail.read = false;
  });

  it('R2：unavailable 时 mutate 不执行、任何键都不写', async () => {
    fail.read = true;
    let called = false;
    const out = await writeWorkspaceRegistry(
      (prev) => {
        called = true;
        return prev.kind === 'ok' ? prev.record : rec([]);
      },
      { kind: 'write', handle: dirHandle('A') },
    );
    fail.read = false;
    expect(out).toEqual({ kind: 'failed', reason: 'unavailable' });
    expect(called).toBe(false);
    expect(await getDirectoryHandle()).toBeNull();
  });

  it('R3：mutate 返回非法记录 → 拒绝写入（failed:invalid），旧记录不被破坏', async () => {
    await writeWorkspaceRegistry(() => rec(['ws:1']), { kind: 'unchanged' });
    const out = await writeWorkspaceRegistry(
      () => ({ v: 1, activeScopeId: 'ws:ghost', entries: [] }) as unknown as WorkspaceRegistryRecord,
      { kind: 'unchanged' },
    );
    expect(out).toEqual({ kind: 'failed', reason: 'invalid' });
    const got = await readWorkspaceRegistry();
    expect(got.kind === 'ok' && got.record.entries).toHaveLength(1);
  });

  it('回归：既有裸句柄接口语义不变（set/get/delete 仍可用）', async () => {
    await setDirectoryHandle(dirHandle('A'));
    expect((await getDirectoryHandle())?.name).toBe('A');
    await deleteDirectoryHandle();
    expect(await getDirectoryHandle()).toBeNull();
  });

  it('CR2-4C（NC-7a）：mutate 返回 Promise（非同步记录）→ 拒绝写入，不落任何键', async () => {
    await writeWorkspaceRegistry(() => rec(['ws:old']), { kind: 'write', handle: dirHandle('OLD') });
    const out = await writeWorkspaceRegistry(
      // 故意返回一个 Promise：类型上非法，运行期必须被当作「非法记录」拒绝
      (() => Promise.resolve(rec(['ws:new']))) as unknown as RegistryMutate,
      { kind: 'delete' },
    );
    expect(out).toEqual({ kind: 'failed', reason: 'invalid' });
    expect((await getDirectoryHandle())?.name).toBe('OLD'); // 裸键未动
    const got = await readWorkspaceRegistry();
    expect(got.kind === 'ok' && got.record.entries.map((e) => e.scopeId)).toEqual(['ws:old']);
  });
});

describe('NC-5（入口 1）：并发回归 —— 正式套件的一部分，必须 PASS/退出 0', () => {
  it('★NC-5 并发回归：两个独立实例并发 RMW → 三条更新全部保留', async () => {
    const { A, B } = await loadTwoInstances();
    await A.writeWorkspaceRegistry(() => legalAppend(emptyRec(), 'ws:a', 1), { kind: 'unchanged' });

    const append = (id: string) => (prev: RegistryReadResult): WorkspaceRegistryRecord =>
      legalAppend(prev.kind === 'ok' ? prev.record : emptyRec(), id, 9);

    // ★G0 勘误：两实例并发也是受控交错（barrier 两侧同时放行）——与入口 3「完全相同调用方」
    // 和 §6.1「两实例 + 受控交错」口径一致；中性化对照才能保持「只变实现」的单一变量属性。
    const barrier = makeBarrier(2);
    const fire = (h: typeof A, id: string) =>
      (async () => {
        await barrier();
        return h.writeWorkspaceRegistry(append(id), { kind: 'unchanged' });
      })();
    const [r1, r2] = await Promise.all([fire(A, 'ws:b'), fire(B, 'ws:c')]);
    expect(r1).toMatchObject({ kind: 'ok' }); // ★ 两次都必须是 ok（不得是 invalid）
    expect(r2).toMatchObject({ kind: 'ok' });

    const got = await A.readWorkspaceRegistry();
    expect(got.kind).toBe('ok');
    if (got.kind !== 'ok') throw new Error('unreachable');
    expectThreeUpdates(got.record);
  });
});
