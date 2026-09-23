/**
 * 保存目的地归属（复核 R1）——「另存为 → 排队写入」必须写新文件。
 *
 * 判别核心：
 * - 另存为成功后，**同步**把会话目的地换成新句柄；已入队的 auto/manual 在真正开始时读目的地，
 *   不能使用入队时闭包里的旧句柄（否则后续编辑被写回旧文件，且当前句柄被回退成旧句柄）；
 * - 另存为取消/失败不改目的地；
 * - 同会话实际写入最大并发恒为 1（目的地换了也不许并行）。
 *
 * 夹具用真实 EditorController + 真实会话协调器 + 两个保存 hook + React 文档状态；
 * 宿主写入是可控 Promise（记录目的句柄与文本），不声称操作系统选择器或真实磁盘。
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
import {
  SAVE_FAILED_NOTICE,
  SAVE_METADATA_WARNING,
  type SaveCompletion,
} from '../src/documentLifecycle';
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

const OLD_HANDLE = { name: 'old.mm.md' } as FsFileHandle;
const NEW_HANDLE = { name: 'new.mm.md' } as FsFileHandle;
const SOURCE = '# 初始\n';

interface WriteRecord {
  handle: FsFileHandle | undefined;
  source: string;
}

function makeHarness(options: { rememberThrows?: boolean } = {}) {
  const root = makeTextNode('初始');
  const controller = new EditorController(root);
  const session = new DocumentSaveSession({ readContent: () => controller.root });
  const writes: WriteRecord[] = [];
  const gates: Array<ReturnType<typeof deferred<SaveOutcome>>> = [];
  const notice = vi.fn();
  let inFlight = 0;
  let maxConcurrent = 0;
  const save = vi.fn((doc: MindDoc): Promise<SaveOutcome> => {
    inFlight += 1;
    maxConcurrent = Math.max(maxConcurrent, inFlight);
    writes.push({ handle: doc.handle, source: doc.source });
    const gate = deferred<SaveOutcome>();
    gates.push(gate);
    return gate.promise.finally(() => {
      inFlight -= 1;
    });
  });
  const remember = options.rememberThrows
    ? vi.fn((): void => {
        throw new Error('recent-document-metadata-failed');
      })
    : vi.fn();
  const docHost = { remember, save } as unknown as DocumentHost;
  const autoSaveTimer: { current: ReturnType<typeof setTimeout> | null } = { current: null };
  const syncedSourceRef: { current: string | null } = { current: SOURCE };
  const initial: MindDoc = {
    id: 'old.mm.md',
    name: 'old.mm.md',
    source: SOURCE,
    handle: OLD_HANDLE,
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
  return {
    view,
    controller,
    session,
    root,
    writes,
    gates,
    save,
    notice,
    maxConcurrent: (): number => maxConcurrent,
  };
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

describe('保存目的地 · 另存为与排队写入（复核 R1）', () => {
  it('另存为 → 排队 auto：第二次写新文件、含最新编辑、当前句柄不回退、并发为 1', async () => {
    const h = makeHarness();
    const { view } = h;

    // 编辑 A → 另存为（写盘挂起，目的地此时仍是旧文件）
    act(() => {
      h.controller.updateText(h.root.id, '快照 A');
    });
    view.rerender();
    act(() => {
      void view.result.current.actions.handleSaveAs();
    });
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]?.handle).toBeUndefined(); // 另存为强制唤起选择器（显式丢 handle）

    // 另存为未完成时继续编辑 → auto 入队
    act(() => {
      h.controller.updateText(h.root.id, '最新编辑 B');
    });
    view.rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(h.writes).toHaveLength(1); // 严格串行：不越过已开始的另存为

    await act(async () => {
      h.gates[0]?.resolve({ result: 'fs', handle: NEW_HANDLE });
      await Promise.resolve();
    });
    expect(h.writes).toHaveLength(2);
    expect(h.writes[1]?.handle).toBe(NEW_HANDLE);
    expect(h.writes[1]?.source).toContain('最新编辑 B');

    await act(async () => {
      h.gates[1]?.resolve({ result: 'fs', handle: NEW_HANDLE });
      await Promise.resolve();
    });
    expect(view.result.current.doc.handle).toBe(NEW_HANDLE);
    expect(h.session.getDestination()).toBe(NEW_HANDLE);
    expect(h.controller.dirty).toBe(false);
    expect(h.maxConcurrent()).toBe(1);
  });

  it('另存为 → 排队 manual：同样写新文件（同族风险一并覆盖）', async () => {
    const h = makeHarness();
    const { view } = h;
    let manualCompletion: SaveCompletion | null = null;

    act(() => {
      h.controller.updateText(h.root.id, '另存为期间的编辑');
    });
    view.rerender();
    act(() => {
      void view.result.current.actions.handleSaveAs();
    });
    act(() => {
      void view.result.current.actions.handleSave().then((c) => {
        manualCompletion = c;
      });
    });
    expect(h.writes).toHaveLength(1);

    await act(async () => {
      h.gates[0]?.resolve({ result: 'fs', handle: NEW_HANDLE });
      await Promise.resolve();
    });
    expect(h.writes).toHaveLength(2);
    expect(h.writes[1]?.handle).toBe(NEW_HANDLE);
    await act(async () => {
      h.gates[1]?.resolve({ result: 'fs', handle: NEW_HANDLE });
      await Promise.resolve();
    });
    expect(manualCompletion).toEqual({ kind: 'saved', current: true });
    expect(h.maxConcurrent()).toBe(1);
  });

  it('另存为取消：目的地不变，后续 auto 仍写原文件', async () => {
    const h = makeHarness();
    const { view } = h;

    act(() => {
      h.controller.updateText(h.root.id, '编辑一');
    });
    view.rerender();
    act(() => {
      void view.result.current.actions.handleSaveAs();
    });
    await act(async () => {
      h.gates[0]?.resolve({ result: 'cancelled' });
      await Promise.resolve();
    });

    expect(h.session.getDestination()).toBe(OLD_HANDLE);
    expect(h.controller.dirty).toBe(true);

    // 取消后再编辑 → auto 用原目的地
    act(() => {
      h.controller.updateText(h.root.id, '编辑二');
    });
    view.rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(h.writes).toHaveLength(2);
    expect(h.writes[1]?.handle).toBe(OLD_HANDLE);
  });

  it('附属记录失败（remember 抛错）：写盘事实成立 → saved/current、dirty 清、只发附属警告、后续保存可用（复核 R4-B）', async () => {
    const h = makeHarness({ rememberThrows: true });
    const { view } = h;

    act(() => {
      h.controller.updateText(h.root.id, '第一次编辑');
    });
    view.rerender();
    let first: SaveCompletion | null = null;
    await act(async () => {
      const pending = view.result.current.actions.handleSave();
      h.gates[0]?.resolve({ result: 'fs', handle: OLD_HANDLE });
      first = await pending;
    });

    // 结果与 dirty 一致：写盘成功 → saved/current:true 且清脏（不再伪装成「写入未完成」）
    expect(first).toEqual({ kind: 'saved', current: true });
    expect(h.controller.dirty).toBe(false);
    expect(view.result.current.doc.savedSource).toContain('第一次编辑');
    // 提示准确：附属警告，而非失败文案
    expect(h.notice).toHaveBeenCalledWith(SAVE_METADATA_WARNING);
    expect(h.notice).not.toHaveBeenCalledWith(SAVE_FAILED_NOTICE);

    // 后续保存仍可用（dirty 能再次置位并成功写盘）
    act(() => {
      h.controller.updateText(h.root.id, '第二次编辑');
    });
    view.rerender();
    expect(h.controller.dirty).toBe(true);
    let second: SaveCompletion | null = null;
    await act(async () => {
      const pending = view.result.current.actions.handleSave();
      h.gates[1]?.resolve({ result: 'fs', handle: OLD_HANDLE });
      second = await pending;
    });
    expect(second).toEqual({ kind: 'saved', current: true });
    expect(h.controller.dirty).toBe(false);
    expect(h.writes).toHaveLength(2);
    expect(h.writes[1]?.source).toContain('第二次编辑');
  });

  it('另存为失败：目的地不变 + 可见失败通知', async () => {
    const h = makeHarness();
    const { view } = h;

    act(() => {
      h.controller.updateText(h.root.id, '待另存为的内容');
    });
    view.rerender();
    act(() => {
      void view.result.current.actions.handleSaveAs();
    });
    await act(async () => {
      h.gates[0]?.reject(new Error('picker-failed'));
      await Promise.resolve();
    });

    expect(h.session.getDestination()).toBe(OLD_HANDLE);
    expect(h.notice).toHaveBeenCalledWith(SAVE_FAILED_NOTICE);
  });
});

describe('P0-A · 目的地单一事实源（I-20）与租约的交互', () => {
  it('rebindDestination 换作用域/相对路径，且 getDestination 与 getDestinationInfo 描述同一事实', () => {
    const session = new DocumentSaveSession({ readContent: () => null });
    session.rebindDestination({
      kind: 'disk',
      scopeId: 'ws:aaa',
      relPath: '研发/架构.mm.md',
      name: '架构.mm.md',
      handle: OLD_HANDLE,
    });
    // 两个读入口必须同源（不得「新方法与旧字段」各存一份）
    expect(session.getDestination()).toBe(OLD_HANDLE);
    expect(session.getDestinationInfo()).toEqual({
      kind: 'disk',
      relPath: '研发/架构.mm.md',
      name: '架构.mm.md',
      durable: true,
    });
  });

  it('setDestination（兼容写入口）归一化为同一字段：信息随之更新', () => {
    const session = new DocumentSaveSession({ readContent: () => null });
    session.rebindDestination({
      kind: 'disk',
      scopeId: 'ws:aaa',
      relPath: '旧路径.mm.md',
      name: '旧路径.mm.md',
      handle: OLD_HANDLE,
    });
    session.setDestination(NEW_HANDLE);
    expect(session.getDestination()).toBe(NEW_HANDLE);
    // 换了句柄 → 相对路径也必须跟着换（不能留着旧路径）
    expect(session.getDestinationInfo().relPath).toBe('new.mm.md');
  });

  it('setDestination 传同一句柄 → 保住作用域与相对路径（不被空值冲掉）', () => {
    const session = new DocumentSaveSession({ readContent: () => null });
    session.rebindDestination({
      kind: 'disk',
      scopeId: 'ws:aaa',
      relPath: '研发/架构.mm.md',
      name: '架构.mm.md',
      handle: OLD_HANDLE,
    });
    session.setDestination(OLD_HANDLE);
    expect(session.getDestinationInfo().relPath).toBe('研发/架构.mm.md');
    expect(session.getDestinationInfo().kind).toBe('disk');
  });

  it('setDestination(undefined) → kind=none 且 durable=false（改名/移动的 I-14 前置判据）', () => {
    const session = new DocumentSaveSession({ readContent: () => null });
    session.setDestination(undefined);
    expect(session.getDestination()).toBeUndefined();
    expect(session.getDestinationInfo()).toEqual({
      kind: 'none',
      relPath: null,
      name: null,
      durable: false,
    });
  });

  it('★改名重绑后：后续 auto 写新目的地（R-01 的正例）', async () => {
    const h = makeHarness();
    const { view } = h;
    // 模拟改名成功后的重绑（生产由 MindmapStage.onRebound 完成）
    h.session.rebindDestination({
      kind: 'disk',
      scopeId: 'ws:aaa',
      relPath: '架构设计.mm.md',
      name: '架构设计.mm.md',
      handle: NEW_HANDLE,
    });
    act(() => {
      h.controller.updateText(h.root.id, '改名后的编辑');
    });
    view.rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]?.handle).toBe(NEW_HANDLE);
    expect(h.writes[0]?.source).toContain('改名后的编辑');
  });

  it('★租约期间 auto 不写盘；释放后补写（含补写用的 flushTick 通道）', async () => {
    const h = makeHarness();
    const { view } = h;
    const lease = h.session.beginExclusiveOp('rename');
    expect(lease.kind).toBe('granted');

    act(() => {
      h.controller.updateText(h.root.id, '租约期间的编辑');
    });
    view.rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });
    // 租约挡回了入口：零写入（不是靠清定时器）
    expect(h.writes).toHaveLength(0);

    if (lease.kind === 'granted') h.session.endExclusiveOp(lease.leaseId);
    act(() => {
      h.controller.updateText(h.root.id, '释放后的编辑');
    });
    view.rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });
    expect(h.writes).toHaveLength(1);
  });
});
