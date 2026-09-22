/**
 * SAVE-LIFECYCLE 回归（审计 P0-A：保存完成误清「写入开始后」的编辑）。
 *
 * 本文件断言的是**正确保护行为**（不是审计特征测试的「通过=问题存在」）：
 * 1) 写入开始后继续编辑 → 该次写入完成不得清脏；随后自动写入最新快照，仅最新快照成功后才清脏；
 * 2) 写入期间切文档（含同名同内容重新打开）→ 迟到回调不得回填、不得 markSaved；
 * 3) 卸载 → 已发出的 I/O 迟到完成不得触碰任何状态；
 * 4) 写入失败 → dirty 保持、无未处理 rejection、不无限重试；
 * 5) 选中/折叠（内容恒定）→ 不得让正常保存永久无法清脏（防「过度拦截」反向回归）。
 *
 * 判别纪律：内容身份用「不可变根引用」而不是文件名 / doc.source / dirty 布尔 / 渲染 epoch；
 * 会话身份用「显式文档替换推进的令牌」而不是 doc.id。修复前本文件为红灯（3/4 失败）；
 * 红→绿证据与阴性对照见 `docs/dispatch/2026-09-18-save-lifecycle-report.md`。
 *
 * 接线更新说明（红→绿之间）：夹具由旧签名（controller+docHost+onSavingChange）改为
 * 通过 `DocumentSaveSession` 接线，并在「切文档」用例中显式调用 `beginDocument()`
 * 模拟产品路径 `applyDoc`；断言语义不变。
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { makeTextNode } from '@mindcanvas/kernel';
import {
  EditorController,
  type DocumentHost,
  type FsFileHandle,
  type MindDoc,
  type SaveOutcome,
} from '@mindcanvas/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentSaveSession } from '../src/hooks/useDocumentSaveSession';
import { useAutoSave } from '../src/hooks/useAutoSave';

/** 手工闸门 Promise：写入「已开始但未完成」的窗口由用例精确控制 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((ok, bad) => {
    resolve = ok;
    reject = bad;
  });
  return { promise, resolve, reject };
}

const HANDLE = { name: 'a.mm.md' } as FsFileHandle;

/** 可控延迟宿主：记录每次收到的文本；完成时机由用例 resolve 闸门 */
function makeDeferredHost() {
  const writes: string[] = [];
  const gates: Array<ReturnType<typeof deferred<SaveOutcome>>> = [];
  const save = vi.fn((doc: MindDoc): Promise<SaveOutcome> => {
    writes.push(doc.source);
    const gate = deferred<SaveOutcome>();
    gates.push(gate);
    return gate.promise;
  });
  return { host: { save } as unknown as DocumentHost, writes, gates, save };
}

function makeDoc(over: Partial<MindDoc> = {}): MindDoc {
  return {
    id: 'a.mm.md',
    name: 'a.mm.md',
    source: '# 初始\n',
    handle: HANDLE,
    saved: true,
    ts: 0,
    ...over,
  };
}

interface Mounted {
  view: {
    rerender: (props: { doc: MindDoc }) => void;
    unmount: () => void;
  };
  session: DocumentSaveSession;
  setDoc: ReturnType<typeof vi.fn>;
  onBlockedSave: ReturnType<typeof vi.fn>;
  autoSaveTimer: RefObject<ReturnType<typeof setTimeout> | null>;
  syncedSourceRef: RefObject<string | null>;
}

function mount(opts: { controller: EditorController; docHost: DocumentHost; doc: MindDoc }): Mounted {
  const setDoc = vi.fn();
  const onBlockedSave = vi.fn();
  const autoSaveTimer: RefObject<ReturnType<typeof setTimeout> | null> = { current: null };
  const syncedSourceRef: RefObject<string | null> = { current: opts.doc.source };
  const session = new DocumentSaveSession({ readContent: () => opts.controller.root });
  const view = renderHook(
    (props: { doc: MindDoc }) =>
      useAutoSave({
        controller: opts.controller,
        docHost: opts.docHost,
        doc: props.doc,
        setDoc,
        session,
        autoSaveTimer,
        syncedSourceRef,
        onBlockedSave,
      }),
    { initialProps: { doc: opts.doc } },
  );
  return { view, session, setDoc, onBlockedSave, autoSaveTimer, syncedSourceRef };
}

/** 显式文档替换（等价产品路径 applyDoc）：先推进会话令牌 + 换目的地，再更新文档 */
function replaceDocument(h: Mounted, next: MindDoc): void {
  h.session.beginDocument(next.handle);
  h.view.rerender({ doc: next });
}

beforeEach(() => {
  vi.useFakeTimers();
  // canvas 套件 pretendToBeVisual:false（无 rAF）——真实 EditorController 需要调度桩
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 16) as unknown as number,
  );
  vi.stubGlobal('cancelAnimationFrame', (h: number) => {
    clearTimeout(h);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('SAVE-LIFECYCLE · 慢写窗口（P0-A 核心回归）', () => {
  it('A 写中改 B：A 完成不清脏；auto 继续写 B；仅 B 成功后清脏', async () => {
    const root = makeTextNode('初始');
    const controller = new EditorController(root);
    const { host, writes, gates } = makeDeferredHost();
    const doc = makeDoc();
    const { view } = mount({ controller, docHost: host, doc });

    // 1) 首次编辑 → 300ms debounce → 写入 A（挂起）
    act(() => {
      controller.updateText(root.id, '快照 A');
    });
    view.rerender({ doc });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(gates).toHaveLength(1);
    expect(writes[0]).toContain('快照 A');

    // 2) 写入等待期间继续编辑 → B（屏幕内容已不是 A）
    act(() => {
      controller.updateText(root.id, '后来的编辑 B');
    });
    view.rerender({ doc });
    expect(controller.dirty).toBe(true);

    // 3) A 完成：不得清脏（否则未落盘内容被标成已保存）
    await act(async () => {
      gates[0]?.resolve({ result: 'fs', handle: HANDLE });
      await Promise.resolve();
    });
    view.rerender({ doc });
    expect(controller.dirty).toBe(true);

    // 4) 自动保存仍要安排下一次写入，且写的是最新快照 B
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(gates).toHaveLength(2);
    expect(writes[1]).toContain('后来的编辑 B');

    // 5) B 成功 → 这次才允许清脏
    await act(async () => {
      gates[1]?.resolve({ result: 'fs', handle: HANDLE });
      await Promise.resolve();
    });
    view.rerender({ doc });
    expect(controller.dirty).toBe(false);
    expect(gates).toHaveLength(2);

    controller.dispose();
  });

  it('写盘期间仅选中/折叠（内容恒定）→ 完成仍清脏（防过度拦截）', async () => {
    const root = makeTextNode('初始');
    const controller = new EditorController(root);
    const { host, gates } = makeDeferredHost();
    const doc = makeDoc();
    const { view } = mount({ controller, docHost: host, doc });

    act(() => {
      controller.updateText(root.id, '唯一编辑');
    });
    view.rerender({ doc });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(gates).toHaveLength(1);

    // 瞬时状态变化：选中 + 折叠（不改内容，不得被当成编辑版本）
    act(() => {
      controller.select(root.id);
      controller.toggleCollapse(root.id);
    });
    view.rerender({ doc });

    await act(async () => {
      gates[0]?.resolve({ result: 'fs', handle: HANDLE });
      await Promise.resolve();
    });
    view.rerender({ doc });
    expect(controller.dirty).toBe(false);

    controller.dispose();
  });

  it('写入失败：dirty 保持、不 markSaved、不重试（saving 回落到 false）', async () => {
    const root = makeTextNode('初始');
    const controller = new EditorController(root);
    const { host, gates } = makeDeferredHost();
    const doc = makeDoc();
    const { view, setDoc, session } = mount({ controller, docHost: host, doc });
    const savingLog: boolean[] = [];
    session.subscribe(() => savingLog.push(session.getSavingSnapshot()));

    act(() => {
      controller.updateText(root.id, '会失败的编辑');
    });
    view.rerender({ doc });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(gates).toHaveLength(1);

    // 宿主写入失败（reject）→ 不得产生未处理 rejection（submit 契约：永不 reject）
    await act(async () => {
      gates[0]?.reject(new Error('disk-full'));
      await Promise.resolve();
    });
    view.rerender({ doc });

    expect(controller.dirty).toBe(true);
    expect(setDoc).not.toHaveBeenCalled();
    expect(savingLog).toEqual([true, false]);

    // 失败不无限重试：不新排写入（内容未再变化）
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(gates).toHaveLength(1);

    controller.dispose();
  });
});

describe('SAVE-LIFECYCLE · 迟到回调归属', () => {
  it('写中切文档：旧文档回调不得回填新文档、不得 markSaved', async () => {
    const root = makeTextNode('初始');
    const controller = new EditorController(root);
    const { host, gates } = makeDeferredHost();
    const docA = makeDoc();
    const h = mount({ controller, docHost: host, doc: docA });

    act(() => {
      controller.updateText(root.id, 'A 的编辑');
    });
    h.view.rerender({ doc: docA });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(gates).toHaveLength(1);

    // 显式文档替换（产品路径 applyDoc）→ 新文档 B
    const docB = makeDoc({ id: 'b.mm.md', name: 'b.mm.md', source: '# B\n', ts: 1 });
    replaceDocument(h, docB);
    h.setDoc.mockClear();

    // A 的写入此刻才完成 → 属于旧会话
    await act(async () => {
      gates[0]?.resolve({ result: 'fs', handle: HANDLE });
      await Promise.resolve();
    });
    h.view.rerender({ doc: docB });

    expect(h.setDoc).not.toHaveBeenCalled();
    expect(controller.dirty).toBe(true);

    controller.dispose();
  });

  it('同名且同内容重新打开：旧会话结果仍 stale（令牌判身份，不比对 id/source）', async () => {
    const root = makeTextNode('初始');
    const controller = new EditorController(root);
    const { host, writes, gates } = makeDeferredHost();
    const doc = makeDoc();
    const h = mount({ controller, docHost: host, doc: doc });

    act(() => {
      controller.updateText(root.id, '第一次会话的编辑');
    });
    h.view.rerender({ doc });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(gates).toHaveLength(1);

    // 重新打开「同一份文件」：id 与 source 完全相同，但会话与树都是新的
    const reopened = makeDoc({ ts: 1 });
    const freshRoot = makeTextNode('初始');
    controller.reset(freshRoot);
    replaceDocument(h, reopened);
    h.setDoc.mockClear();

    await act(async () => {
      gates[0]?.resolve({ result: 'fs', handle: HANDLE });
      await Promise.resolve();
    });
    h.view.rerender({ doc: reopened });

    // 旧会话迟到完成：零回填（否则新文档的 savedSource 会被旧内容污染）
    expect(h.setDoc).not.toHaveBeenCalled();

    // 新会话仍能正常保存（令牌推进没有把新会话一起废掉）
    act(() => {
      controller.updateText(freshRoot.id, '重新打开后的编辑');
    });
    h.view.rerender({ doc: reopened });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(gates).toHaveLength(2);
    expect(writes[1]).toContain('重新打开后的编辑');
    await act(async () => {
      gates[1]?.resolve({ result: 'fs', handle: HANDLE });
      await Promise.resolve();
    });
    h.view.rerender({ doc: reopened });
    expect(controller.dirty).toBe(false);

    controller.dispose();
  });

  it('写中切文档：旧会话写入**失败** → stale（不是 failed）、不发失败通知', async () => {
    const root = makeTextNode('初始');
    const controller = new EditorController(root);
    const { host, gates } = makeDeferredHost();
    const docA = makeDoc();
    const h = mount({ controller, docHost: host, doc: docA });

    act(() => {
      controller.updateText(root.id, 'A 的编辑');
    });
    h.view.rerender({ doc: docA });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(gates).toHaveLength(1);

    const docB = makeDoc({ id: 'b.mm.md', name: 'b.mm.md', source: '# B\n', ts: 1 });
    replaceDocument(h, docB);
    h.setDoc.mockClear();
    h.onBlockedSave.mockClear();

    await act(async () => {
      gates[0]?.reject(new Error('disk-full'));
      await Promise.resolve();
    });
    h.view.rerender({ doc: docB });

    // 旧会话失败：零回填、零通知（不得说成「新文档保存失败」）
    expect(h.setDoc).not.toHaveBeenCalled();
    expect(h.onBlockedSave).not.toHaveBeenCalled();
    expect(controller.dirty).toBe(true);

    controller.dispose();
  });

  it('卸载：已发出的写入迟到完成 → 零副作用', async () => {
    const root = makeTextNode('初始');
    const controller = new EditorController(root);
    const { host, gates } = makeDeferredHost();
    const doc = makeDoc();
    const h = mount({ controller, docHost: host, doc });

    act(() => {
      controller.updateText(root.id, '卸载前的编辑');
    });
    h.view.rerender({ doc });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(gates).toHaveLength(1);

    // 卸载 = 会话作废（产品路径由 useDocumentSaveSession 的 dispose 触发）
    h.session.dispose();
    h.view.unmount();

    await act(async () => {
      gates[0]?.resolve({ result: 'fs', handle: HANDLE });
      await Promise.resolve();
    });

    expect(h.setDoc).not.toHaveBeenCalled();
    expect(controller.dirty).toBe(true);

    controller.dispose();
  });
});

/**
 * 协调器本体单测（不挂 React）：串行 / auto 合并 / 显式优先 / blocked / waitForIdle。
 * 这些是 Task 2「先锁定会话切换失效、排队串行、auto 合并、finally 状态归属」的判别钉。
 */
describe('DocumentSaveSession · 队列与状态语义（单测）', () => {
  interface Gate {
    promise: Promise<SaveOutcome>;
    resolve: (value: SaveOutcome) => void;
  }

  function makeSessionHarness(
    initialContent: unknown = 'A',
    onCommitError?: (error: unknown) => void,
  ) {
    let live = initialContent;
    const session = onCommitError
      ? new DocumentSaveSession({ readContent: () => live, onCommitError })
      : new DocumentSaveSession({ readContent: () => live });
    const starts: string[] = [];
    const gates: Gate[] = [];
    const commits: Array<{ source: string; current: boolean }> = [];
    const request = (intent: 'auto' | 'manual' | 'save-as', content: unknown) => ({
      intent,
      capture: () => ({ source: `S:${String(content)}`, content }),
      write: (snapshot: { source: string }): Promise<SaveOutcome> => {
        starts.push(snapshot.source);
        const gate = deferred<SaveOutcome>();
        gates.push(gate);
        return gate.promise;
      },
      commit: (snapshot: { source: string }, _outcome: SaveOutcome, current: boolean) => {
        commits.push({ source: snapshot.source, current });
      },
    });
    return {
      session,
      request,
      starts,
      gates,
      commits,
      setLive: (v: unknown) => {
        live = v;
      },
    };
  }

  const fs = (): SaveOutcome => ({ result: 'fs', handle: HANDLE });

  /** 冲刷微任务队列（fake timers 下 setTimeout(0) 不会自行触发，故用 advanceTimersByTimeAsync(0)） */
  async function settle(): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  it('同会话串行：第二次写入在第一次完成后才开始', async () => {
    const h = makeSessionHarness();
    const first = h.session.submit(h.request('manual', 'A'));
    const second = h.session.submit(h.request('manual', 'B'));
    expect(h.starts).toEqual(['S:A']);
    expect(h.session.isSaving()).toBe(true);

    h.gates[0]?.resolve(fs());
    await settle();
    expect(h.starts).toEqual(['S:A', 'S:B']);
    h.setLive('B'); // 第二次写的就是当前内容 → 允许清脏
    h.gates[1]?.resolve(fs());
    expect(await first).toEqual({ kind: 'saved', current: true });
    expect(await second).toEqual({ kind: 'saved', current: true });
    expect(h.session.isSaving()).toBe(false);
  });

  it('auto 合并：队列中的 auto 被最新请求取代（不重复写旧快照）', async () => {
    const h = makeSessionHarness();
    const holder = h.session.submit(h.request('manual', 'A'));
    const auto1 = h.session.submit(h.request('auto', 'B1'));
    const auto2 = h.session.submit(h.request('auto', 'B2'));

    expect(await auto1).toEqual({ kind: 'stale' });
    h.gates[0]?.resolve(fs());
    await settle();
    expect(h.starts).toEqual(['S:A', 'S:B2']);
    h.gates[1]?.resolve(fs());
    // 合并后写的是 B2，但屏幕内容仍是 A（模拟「队列里的快照已过时」）→ 不得清脏
    expect(await auto2).toEqual({ kind: 'saved', current: false });
    expect(await holder).toEqual({ kind: 'saved', current: true });
  });

  it('显式请求优先于尚未开始的 auto（不越过已开始的写入）', async () => {
    const h = makeSessionHarness();
    const holder = h.session.submit(h.request('manual', 'A'));
    void h.session.submit(h.request('auto', 'B'));
    const explicit = h.session.submit(h.request('manual', 'C'));

    h.gates[0]?.resolve(fs());
    await settle();
    // 已开始的 A 不被打断；下一个跑的是显式 C（auto B 让位但不丢）
    expect(h.starts).toEqual(['S:A', 'S:C']);
    h.gates[1]?.resolve(fs());
    await settle();
    expect(h.starts).toEqual(['S:A', 'S:C', 'S:B']);
    h.gates[2]?.resolve(fs());
    // explicit 写的是 C，屏幕内容仍是 A → current:false；holder 写的就是 A → current:true
    expect(await explicit).toEqual({ kind: 'saved', current: false });
    expect(await holder).toEqual({ kind: 'saved', current: true });
  });

  it('blocked（守卫拒绝）不入队、不闪 saving、零 commit', async () => {
    const h = makeSessionHarness();
    const savingLog: boolean[] = [];
    h.session.subscribe(() => savingLog.push(h.session.getSavingSnapshot()));

    const blocked = await h.session.submit({ ...h.request('manual', 'A'), guard: () => false });

    expect(blocked).toEqual({ kind: 'blocked' });
    expect(h.starts).toEqual([]);
    expect(h.commits).toEqual([]);
    expect(savingLog).toEqual([]);
  });

  it('waitForIdle 只等已开始 I/O；beginDocument 让未开始任务 stale', async () => {
    const h = makeSessionHarness();
    const inFlight = h.session.submit(h.request('manual', 'A'));
    let idle = false;
    const waiting = h.session.waitForIdle().then(() => {
      idle = true;
    });
    await settle();
    expect(idle).toBe(false);

    h.gates[0]?.resolve(fs());
    await waiting;
    expect(idle).toBe(true);
    expect(await inFlight).toEqual({ kind: 'saved', current: true });

    // 新会话：未开始的任务直接 stale；进行中的完成也 stale（不 commit）
    const holds = h.session.submit(h.request('manual', 'X'));
    const queued = h.session.submit(h.request('auto', 'Y'));
    h.session.beginDocument(HANDLE);
    expect(await queued).toEqual({ kind: 'stale' });
    expect(h.starts).toEqual(['S:A', 'S:X']);
    h.gates[1]?.resolve(fs());
    expect(await holds).toEqual({ kind: 'stale' });
    expect(h.commits.map((c) => c.source)).toEqual(['S:A']);
  });

  it('异常边界 · guard 抛错：按 blocked 收口，不逃逸、不入队', async () => {
    const h = makeSessionHarness();
    const blocked = await h.session.submit({
      ...h.request('manual', 'A'),
      guard: () => {
        throw new Error('guard boom');
      },
    });
    expect(blocked).toEqual({ kind: 'blocked' });
    expect(h.starts).toEqual([]);
    expect(h.session.isSaving()).toBe(false);
  });

  it('异常边界 · capture 抛错：该请求 failed，后续排队请求照常完成', async () => {
    const h = makeSessionHarness();
    const first = h.session.submit({
      ...h.request('manual', 'A'),
      capture: () => {
        throw new Error('capture boom');
      },
    });
    const second = h.session.submit(h.request('manual', 'B'));

    expect(await first).toEqual({ kind: 'failed' });
    expect(h.starts).toEqual(['S:B']);
    h.gates[0]?.resolve(fs());
    expect(await second).toEqual({ kind: 'saved', current: false });
  });

  it('异常边界 · readContent 抛错：保守按内容已变（commit 收到 current=false）', async () => {
    const session = new DocumentSaveSession({
      readContent: () => {
        throw new Error('read boom');
      },
    });
    const commit = vi.fn();
    const completion = await session.submit({
      intent: 'manual',
      capture: () => ({ source: 'S:X', content: 'X' }),
      write: async () => ({ result: 'fs' as const }),
      commit,
    });

    expect(completion).toEqual({ kind: 'saved', current: false });
    expect(commit).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'S:X' }),
      expect.anything(),
      false,
    );
    session.dispose();
  });

  it('异常边界 · commit 抛错：结果按**写盘事实**收口(saved)，附属异常经 onCommitError 暴露，队列不悬挂（复核 R4/R4-B）', async () => {
    const commitError = vi.fn();
    const h = makeSessionHarness('A', commitError);
    const first = h.session.submit({
      ...h.request('manual', 'A'),
      commit: () => {
        throw new Error('host remember failed');
      },
    });
    const second = h.session.submit(h.request('manual', 'B'));

    h.gates[0]?.resolve(fs());
    // 写盘成功 → 不降级为 failed（否则「结果说失败、dirty 已清、提示说未标记已保存」矛盾）
    expect(await first).toEqual({ kind: 'saved', current: true });
    expect(commitError).toHaveBeenCalledTimes(1);
    await settle();
    expect(h.starts).toEqual(['S:A', 'S:B']);
    h.gates[1]?.resolve(fs());
    expect(await second).toEqual({ kind: 'saved', current: false });
    expect(h.session.isSaving()).toBe(false);
    // 首请求的 commit 抛错（夹具记录未被调用）；第二请求正常回填
    expect(h.commits.map((c) => c.source)).toEqual(['S:B']);
  });

  it('异常边界 · write 抛错：failed 且队列继续；旧会话的同类失败按 stale', async () => {
    const h = makeSessionHarness();
    const failing = h.session.submit({
      intent: 'manual',
      capture: () => ({ source: 'S:A', content: 'A' }),
      write: async () => {
        throw new Error('write boom');
      },
      commit: vi.fn(),
    });
    expect(await failing).toEqual({ kind: 'failed' });

    // 旧会话失败（先替换再 reject）→ stale
    const session2 = new DocumentSaveSession({ readContent: () => 'A' });
    const gate = deferred<SaveOutcome>();
    const stale = session2.submit({
      intent: 'manual',
      capture: () => ({ source: 'S:A', content: 'A' }),
      write: () => gate.promise,
      commit: vi.fn(),
    });
    session2.beginDocument(undefined);
    gate.reject(new Error('late boom'));
    expect(await stale).toEqual({ kind: 'stale' });
    session2.dispose();
  });
});
