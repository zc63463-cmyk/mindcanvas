// @vitest-environment jsdom
/**
 * P0-A ①：操作租约（contracts §3.5、acceptance L1/L2）。
 *
 * 判别核心 —— 六类时序逐条钉住：
 *  1. 无写入时租约立即授予（granted）；
 *  2. **租约期间 `submit` 一律 blocked 且不入队**（L1 负控的锚点：去掉租约后此断言必须转红）；
 *  3. 租约期间内容变化 → 重新排定 auto 后**仍然** blocked（证明「只清定时器」不够）；
 *  4. `physicalWritesInFlight > 0` → `busy-physical` 拒绝（I-17；与 `busy-lease` 可区分）；
 *  5. 每个 await 后的归属校验：会话被替换 / 代次变化 → `ownsLease` 失败、零回填；
 *  6. 条件释放：非持有者 `endExclusiveOp` 是 no-op（L2 负控的锚点）。
 *
 * 夹具是真实 `DocumentSaveSession` + 真实 React 文档状态；宿主写入是可控 Promise
 * （不声称操作系统选择器或真实磁盘 —— 那属 M 层）。
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { makeTextNode } from '@mindcanvas/kernel';
import {
  EditorController,
  type DocumentHost,
  type FsFileHandle,
  type MindDoc,
  type SaveOutcome,
} from '@mindcanvas/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutoSave } from '../src/hooks/useAutoSave';
import { useDocumentActions } from '../src/hooks/useDocumentActions';
import { DocumentSaveSession } from '../src/hooks/useDocumentSaveSession';

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
const SOURCE = '# 初始\n';

function makeHarness() {
  const root = makeTextNode('初始');
  const controller = new EditorController(root);
  const session = new DocumentSaveSession({ readContent: () => root });
  const gates: Array<ReturnType<typeof deferred<SaveOutcome>>> = [];
  const handle = { name: 'a.mm.md' } as FsFileHandle;
  const save = vi.fn((): Promise<SaveOutcome> => {
    const gate = deferred<SaveOutcome>();
    gates.push(gate);
    return gate.promise;
  });
  const docHost = { remember: vi.fn(), save } as unknown as DocumentHost;
  const autoSaveTimer: { current: ReturnType<typeof setTimeout> | null } = { current: null };
  const syncedSourceRef: { current: string | null } = { current: SOURCE };
  const notice = vi.fn();
  const initial: MindDoc = {
    id: 'a.mm.md',
    name: 'a.mm.md',
    source: SOURCE,
    handle,
    saved: true,
    ts: 0,
  };
  const view = renderHook(() => {
    const [doc, setDoc] = useState(initial);
    const common = { controller, docHost, doc, setDoc, session, autoSaveTimer, syncedSourceRef };
    useAutoSave({ ...common, onBlockedSave: notice });
    const actions = useDocumentActions({
      ...common,
      fileInputRef: { current: null },
      onBlockedSave: notice,
      onSaveWarning: notice,
    });
    return { doc, actions };
  });
  return { view, controller, session, gates, save, notice, handle, autoSaveTimer, syncedSourceRef };
}

/** 便捷：提交一个最小 auto 请求，返回其 completion */
function submitAuto(session: DocumentSaveSession): Promise<string> {
  return session
    .submit({
      intent: 'auto',
      capture: () => ({ source: '# x\n', content: {} }),
      write: async () => ({ result: 'fs' as const, handle: HANDLE }),
      commit: () => {},
    })
    .then((c) => c.kind);
}

beforeEach(() => {
  vi.useFakeTimers();
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

describe('租约 · 授予与拒绝（I-16 / I-17）', () => {
  it('无在途写入 → 立即授予，返回 leaseId 与 opSeq', () => {
    const session = new DocumentSaveSession({ readContent: () => null });
    const r = session.beginExclusiveOp('rename');
    expect(r.kind).toBe('granted');
    if (r.kind !== 'granted') throw new Error('期望 granted');
    expect(r.leaseId).toBeGreaterThan(0);
    expect(r.opSeq).toBeGreaterThan(0);
    expect(session.leaseIdOf()).toBe(r.leaseId);
  });

  it('已有租约 → busy-lease（单租约：不重入）', () => {
    const session = new DocumentSaveSession({ readContent: () => null });
    expect(session.beginExclusiveOp('rename').kind).toBe('granted');
    const second = session.beginExclusiveOp('move');
    expect(second).toEqual({ kind: 'refused', reason: 'busy-lease' });
  });

  it('★物理写在途 → busy-physical（**不得**静默等待；I-17）', async () => {
    const session = new DocumentSaveSession({ readContent: () => null });
    const pending = session.submit({
      intent: 'auto',
      capture: () => ({ source: '# x\n', content: {} }),
      write: () => deferred<SaveOutcome>().promise, // 永不 resolve：写一直"在途"
      commit: () => {},
    });
    // 让 drain 推进到 write 已开始
    await Promise.resolve();
    await Promise.resolve();
    expect(session.physicalWritesInFlight).toBe(1);
    const r = session.beginExclusiveOp('rename');
    expect(r).toEqual({ kind: 'refused', reason: 'busy-physical' });
    // 物理写结束后恢复可授予（计数在 finally 收口，不会永久卡住）
    expect(session.physicalWritesInFlight).toBe(1);
    void pending;
  });

  it('★★跨会话物理写：切文档后旧会话的写入仍在途 → 仍须 busy-physical（I-17 的真正边界）', async () => {
    // 这条是本负控的核心：`waitForIdle()` 只看**当前会话**，被替换会话已发出的物理写
    // 不在其范围内却仍在动磁盘。若把判据写成 `isSaving()`（即「当会话有活动任务」），
    // 切文档后计数会被绕过 —— 于是「等待空闲 → 新保存进入 → rename 复制旧快照 → 删源」
    // 的竞态重新成立。physicalWritesInFlight 不随 token 推进归零，正是为了覆盖这一段。
    const session = new DocumentSaveSession({ readContent: () => null });
    const gate = deferred<SaveOutcome>();
    const pending = session.submit({
      intent: 'auto',
      capture: () => ({ source: '# 旧会话\n', content: {} }),
      write: () => gate.promise,
      commit: () => {},
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(session.physicalWritesInFlight).toBe(1);

    // 用户切到另一篇文档：会话令牌推进，旧会话的任务不再是「当前会话的活动任务」
    session.beginDocument(HANDLE);
    expect(session.isSaving()).toBe(false); // ← waitForIdle 在这一刻就返回了
    // 但磁盘上的写还没结束，故租约必须仍被拒
    expect(session.physicalWritesInFlight).toBe(1);
    expect(session.beginExclusiveOp('rename')).toEqual({
      kind: 'refused',
      reason: 'busy-physical',
    });

    // 旧 I/O 收束后计数回落 → 可授予（不永久卡住）
    gate.resolve({ result: 'fs', handle: HANDLE });
    await pending;
    expect(session.physicalWritesInFlight).toBe(0);
    expect(session.beginExclusiveOp('rename').kind).toBe('granted');
  });

  it('物理写计数在写入失败时同样回落（否则永久卡住 beginExclusiveOp）', async () => {
    const session = new DocumentSaveSession({ readContent: () => null });
    const done = session.submit({
      intent: 'auto',
      capture: () => ({ source: '# x\n', content: {} }),
      write: async () => {
        throw new Error('disk-failed');
      },
      commit: () => {},
    });
    await done;
    expect(session.physicalWritesInFlight).toBe(0);
    expect(session.beginExclusiveOp('rename').kind).toBe('granted');
  });

  it('★租约期间 submit 一律 blocked 且**不入队**（L1 负控锚点）', async () => {
    const session = new DocumentSaveSession({ readContent: () => null });
    session.beginExclusiveOp('rename');
    expect(await submitAuto(session)).toBe('blocked');
    // 不入队：isSaving() 不因被挡回的请求而变 true（saving 不闪）
    expect(session.isSaving()).toBe(false);
    expect(session.getSavingSnapshot()).toBe(false);
  });

  it('租约期间 manual / save-as 同样 blocked（同一互斥域，不弹选择器）', async () => {
    const session = new DocumentSaveSession({ readContent: () => null });
    session.beginExclusiveOp('rename');
    const write = vi.fn(async () => ({ result: 'fs' as const, handle: HANDLE }));
    for (const intent of ['manual', 'save-as'] as const) {
      const c = await session.submit({
        intent,
        capture: () => ({ source: '# x\n', content: {} }),
        write,
        commit: () => {},
      });
      expect(c).toEqual({ kind: 'blocked' });
    }
    // 选择器一次都没被唤起（写入函数零调用）
    expect(write).not.toHaveBeenCalled();
  });

  it('释放后 submit 恢复可用', async () => {
    const session = new DocumentSaveSession({ readContent: () => null });
    const r = session.beginExclusiveOp('rename');
    if (r.kind !== 'granted') throw new Error('期望 granted');
    session.endExclusiveOp(r.leaseId);
    expect(await submitAuto(session)).toBe('saved');
  });
});

describe('★租约 · 条件释放（I-19；L2 负控锚点）', () => {
  it('非持有者 endExclusiveOp 是 no-op（不解开别人的租约）', () => {
    const session = new DocumentSaveSession({ readContent: () => null });
    const first = session.beginExclusiveOp('rename');
    if (first.kind !== 'granted') throw new Error('期望 granted');
    // 模拟「迟到的旧请求」拿到一个过期 leaseId 后无条件释放
    session.endExclusiveOp(first.leaseId + 999);
    // 首租约仍在 —— 这正是条件释放要保护的
    expect(session.leaseIdOf()).toBe(first.leaseId);
    expect(session.beginExclusiveOp('move')).toEqual({ kind: 'refused', reason: 'busy-lease' });
  });

  it('★旧请求的无条件 finally 释放不得解开新请求的租约（L2 反例）', () => {
    const session = new DocumentSaveSession({ readContent: () => null });
    const stale = session.beginExclusiveOp('rename');
    if (stale.kind !== 'granted') throw new Error('期望 granted');
    session.endExclusiveOp(stale.leaseId);
    const fresh = session.beginExclusiveOp('move');
    if (fresh.kind !== 'granted') throw new Error('期望 granted');
    // 迟到的旧 finally 用**旧** leaseId 释放 → 必须解不开新租约
    session.endExclusiveOp(stale.leaseId);
    expect(session.leaseIdOf()).toBe(fresh.leaseId);
  });

  it('持有者释放 → 租约清空', () => {
    const session = new DocumentSaveSession({ readContent: () => null });
    const r = session.beginExclusiveOp('delete');
    if (r.kind !== 'granted') throw new Error('期望 granted');
    session.endExclusiveOp(r.leaseId);
    expect(session.leaseIdOf()).toBeNull();
    expect(session.leaseInfo).toBeNull();
  });
});

describe('★租约 · 归属校验（I-19：每个 await 之后复查）', () => {
  it('ownsLease：租约仍在 + 令牌未变 + 代次未变 → true', () => {
    const session = new DocumentSaveSession({ readContent: () => null });
    const token = session.sessionToken;
    const r = session.beginExclusiveOp('rename');
    if (r.kind !== 'granted') throw new Error('期望 granted');
    expect(session.ownsLease(r.leaseId, r.opSeq, token)).toBe(true);
  });

  it('会话被替换（token 变）→ ownsLease 失败（迟到回调零回填）', () => {
    const session = new DocumentSaveSession({ readContent: () => null });
    const token = session.sessionToken;
    const r = session.beginExclusiveOp('rename');
    if (r.kind !== 'granted') throw new Error('期望 granted');
    session.beginDocument(HANDLE);
    expect(session.ownsLease(r.leaseId, r.opSeq, token)).toBe(false);
    // 切文档后租约作废（新会话不继承旧操作的租约）
    expect(session.leaseIdOf()).toBeNull();
  });

  it('代次不匹配（opSeq 变）→ ownsLease 失败', () => {
    const session = new DocumentSaveSession({ readContent: () => null });
    const token = session.sessionToken;
    const first = session.beginExclusiveOp('rename');
    if (first.kind !== 'granted') throw new Error('期望 granted');
    session.endExclusiveOp(first.leaseId);
    session.beginExclusiveOp('move');
    // 用旧 opSeq 校验：租约 id 已不同、opSeq 也已推进
    expect(session.ownsLease(first.leaseId, first.opSeq, token)).toBe(false);
  });

  it('目标作用域与会话目的地不一致 → session-replaced（拒绝跨会话操作）', () => {
    const session = new DocumentSaveSession({ readContent: () => null });
    session.rebindDestination({
      kind: 'disk',
      scopeId: 'ws:aaa',
      relPath: 'a.mm.md',
      name: 'a.mm.md',
      handle: HANDLE,
    });
    const r = session.beginExclusiveOp('rename', { scopeId: 'ws:bbb', relPath: 'a.mm.md' });
    expect(r).toEqual({ kind: 'refused', reason: 'session-replaced' });
    // 同作用域则正常授予
    expect(
      session.beginExclusiveOp('rename', { scopeId: 'ws:aaa', relPath: 'a.mm.md' }).kind,
    ).toBe('granted');
  });

  it('已释放的租约 → ownsLease 失败（不能拿旧租约继续写状态）', () => {
    const session = new DocumentSaveSession({ readContent: () => null });
    const token = session.sessionToken;
    const r = session.beginExclusiveOp('rename');
    if (r.kind !== 'granted') throw new Error('期望 granted');
    session.endExclusiveOp(r.leaseId);
    expect(session.ownsLease(r.leaseId, r.opSeq, token)).toBe(false);
  });
});

describe('★租约 · 与自动保存的交互（L1：租约期间内容变化仍不入队）', () => {
  it('租约期间编辑 → auto 定时器到期 → submit 被 blocked 且零写入', async () => {
    const h = makeHarness();
    expect(h.session.beginExclusiveOp('rename').kind).toBe('granted');

    act(() => {
      h.controller.updateText(h.controller.root.id, '租约期间的编辑');
    });
    h.view.rerender();
    // 内容变化会重新排定 auto（deps 含 content）—— 正是「只清定时器」挡不住的路径
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });
    // 写入函数零调用：租约挡回了入口（不是靠清定时器）
    expect(h.save).not.toHaveBeenCalled();
    // dirty 保持（内容确实还没落盘）
    expect(h.controller.dirty).toBe(true);
  });

  it('★释放租约后，dirty 内容由下一次 auto 补写（内容不丢）', async () => {
    const h = makeHarness();
    const r = h.session.beginExclusiveOp('rename');
    if (r.kind !== 'granted') throw new Error('期望 granted');

    act(() => {
      h.controller.updateText(h.controller.root.id, '租约期间的编辑');
    });
    h.view.rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });
    expect(h.save).not.toHaveBeenCalled();

    // 释放后重新排定一次 auto（内容在租约期间已变，deps 已满足；这里再编辑一次触发）
    h.session.endExclusiveOp(r.leaseId);
    act(() => {
      h.controller.updateText(h.controller.root.id, '释放后的编辑');
    });
    h.view.rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });
    expect(h.save).toHaveBeenCalledTimes(1);
  });

  it('租约期间 Ctrl+S（manual）→ blocked，零写入、dirty 不变、saving 不闪', async () => {
    const h = makeHarness();
    act(() => {
      h.controller.updateText(h.controller.root.id, '待保存');
    });
    h.view.rerender();
    const granted = h.session.beginExclusiveOp('rename');
    if (granted.kind !== 'granted') throw new Error('期望 granted');

    let completion = '';
    await act(async () => {
      completion = (await h.view.result.current.actions.handleSave()).kind;
    });
    expect(completion).toBe('blocked');
    expect(h.save).not.toHaveBeenCalled();
    expect(h.controller.dirty).toBe(true);
    expect(h.session.getSavingSnapshot()).toBe(false);
  });

  it('租约期间另存为 → blocked（不弹选择器：save 零调用）', async () => {
    const h = makeHarness();
    h.session.beginExclusiveOp('rename');
    let completion = '';
    await act(async () => {
      completion = (await h.view.result.current.actions.handleSaveAs()).kind;
    });
    expect(completion).toBe('blocked');
    expect(h.save).not.toHaveBeenCalled();
  });
});
