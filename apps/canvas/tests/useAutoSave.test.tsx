/**
 * useAutoSave 行为测试 —— 编辑流保全（批次 E）判别性守卫；
 * SAVE-LIFECYCLE 批次改接保存会话（`DocumentSaveSession`）。
 *
 * 判别核心：保存成功的写回必须落在 `doc.savedSource`（最近一次成功保存的内容快照），
 * 且**不得改写** `doc.source`（= 本次会话打开/新建时的解析输入）。
 * 若实现回退写 `source`，本文件用例 1 转红 —— 两条阴性对照之一的判据。
 *
 * 另两条本文件锁定的语义：
 * - 会话身份=内容身份匹配时才 `markSaved`（内容已变 → 保持 dirty，见 save-lifecycle.test.tsx）；
 * - S2G 守卫拦截**不闪**「保存中」（guard 在入队前同步判定）。
 *
 * 不测什么：不测真实 FS 落盘（autosave 需真实 FileSystemFileHandle，无头环境无法 seed，
 * 见计划 §1.5-7：不做 verify 脚本）；`docHost` 为契约替身。
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import type { DocumentHost, EditorController, FsFileHandle, MindDoc } from '@mindcanvas/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAVE_FAILED_NOTICE } from '../src/documentLifecycle';
import { makeTextNode } from '@mindcanvas/kernel';
import { useAutoSave } from '../src/hooks/useAutoSave';
import { DocumentSaveSession } from '../src/hooks/useDocumentSaveSession';
import { SAVE_BLOCKED_NOTICE } from '../src/hooks/saveGuard';

/** 最小可用 controller：只实现本 hook 触碰的成员（同 useDocumentActions.test 风格） */
function makeController(over: Partial<EditorController> = {}): EditorController {
  return {
    dirty: true,
    serialize: () => 'SRC',
    markSaved: vi.fn(),
    ...over,
  } as unknown as EditorController;
}

function makeDocHost(over: Partial<DocumentHost> = {}): DocumentHost {
  return {
    save: vi.fn(async () => ({ result: 'fs' as const })),
    ...over,
  } as unknown as DocumentHost;
}

const HANDLE = { name: 'a.mm.md' } as FsFileHandle;

function setup(
  over: {
    controller?: Partial<EditorController>;
    docHost?: Partial<DocumentHost>;
    doc?: Partial<MindDoc>;
    /** S2G：同步标记初值；缺省 = 与 doc.source 同源（现行为） */
    synced?: string | null;
    /** P0-A：租约释放后的补写触发器 */
    flushTick?: number;
  } = {},
) {
  const controller = makeController(over.controller);
  const docHost = makeDocHost(over.docHost);
  const doc: MindDoc = {
    id: 'a.mm.md',
    name: 'a.mm.md',
    source: 'OLD',
    handle: HANDLE,
    saved: true,
    ts: 0,
    ...over.doc,
  };
  const setDoc = vi.fn();
  const autoSaveTimer: RefObject<ReturnType<typeof setTimeout> | null> = { current: null };
  // SAVE-LIFECYCLE：内容身份 = 不可变根引用（测试替身里即 controller.root）
  const session = new DocumentSaveSession({ readContent: () => controller.root });
  const savingLog: boolean[] = [];
  session.subscribe(() => savingLog.push(session.getSavingSnapshot()));
  const onBlockedSave = vi.fn();
  // S2G：mock 增 `syncedSourceRef`（缺省同源 = 现行为，同 S2F 先例）
  const syncedSourceRef: RefObject<string | null> = {
    current: over.synced === undefined ? doc.source : over.synced,
  };
  const view = renderHook(() =>
    useAutoSave({
      controller,
      docHost,
      doc,
      setDoc,
      session,
      autoSaveTimer,
      syncedSourceRef,
      onBlockedSave,
      flushTick: over.flushTick ?? 0,
    }),
  );
  return {
    view,
    controller,
    docHost,
    doc,
    setDoc,
    autoSaveTimer,
    session,
    savingLog,
    syncedSourceRef,
    onBlockedSave,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useAutoSave · 落盘与口径（E 批判别）', () => {
  it('dirty+saved+handle：300ms 后保存，写回 savedSource 且不改写 source', async () => {
    const { controller, docHost, doc, setDoc, autoSaveTimer, savingLog } = setup();
    expect(autoSaveTimer.current).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    // 1) 落盘收到的是新内容（serialize 结果）
    expect(docHost.save).toHaveBeenCalledTimes(1);
    expect(docHost.save).toHaveBeenCalledWith(expect.objectContaining({ source: 'SRC' }));

    // 2) 写回只动 savedSource；source 保持旧值（解析输入不被保存路径击穿）
    expect(setDoc).toHaveBeenCalledTimes(1);
    const firstCall = setDoc.mock.calls.at(0);
    if (firstCall === undefined) throw new Error('setDoc 未被调用');
    const updater = firstCall[0] as (d: MindDoc) => MindDoc;
    const next = updater({ ...doc, source: 'OLD' });
    expect(next.savedSource).toBe('SRC');
    expect(next.source).toBe('OLD');

    // 3) 账目闭环（saving 指示由会话推送：入队 → 完成）
    expect(controller.markSaved).toHaveBeenCalledTimes(1);
    expect(savingLog).toEqual([true, false]);
  });

  it('dirty=false → 不排定时器（save 零调用）', async () => {
    const { docHost, autoSaveTimer } = setup({ controller: { dirty: false } });
    expect(autoSaveTimer.current).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(docHost.save).not.toHaveBeenCalled();
  });

  it('无 handle → 不排（未落盘文档无自动保存）', async () => {
    const { docHost, autoSaveTimer } = setup({ doc: { handle: undefined } });
    expect(autoSaveTimer.current).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(docHost.save).not.toHaveBeenCalled();
  });

  it('saved=false → 不排（新建未保存文档走手动保存）', async () => {
    const { docHost, autoSaveTimer } = setup({ doc: { saved: false } });
    expect(autoSaveTimer.current).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(docHost.save).not.toHaveBeenCalled();
  });

  it('unmount → 清理 pending 定时器（回调不再触发）', async () => {
    const { view, docHost, autoSaveTimer } = setup();
    expect(autoSaveTimer.current).not.toBeNull();
    const id = autoSaveTimer.current;
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

    view.unmount();

    expect(clearSpy).toHaveBeenCalledWith(id);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(docHost.save).not.toHaveBeenCalled();
  });
});

/**
 * S2G：保存侧同步守卫 —— 画布树不属于该文档时拒写（防误写）。
 * 守卫未实现（或判据被中性化）时：写盘照发 / 通知未发 → 本组转红。
 * SAVE-LIFECYCLE 增补：同步拦截发生在入队之前，不得闪「保存中」。
 */
describe('useAutoSave · S2G 同步守卫', () => {
  it('不同步（synced ≠ doc.source）→ 拒写 + 通知恰一次 + 不闪 saving；同 source 再触发不重复通知', async () => {
    const { view, controller, docHost, setDoc, autoSaveTimer, onBlockedSave, savingLog } = setup({
      synced: 'OTHER',
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    // 拒写：不落盘、不 markSaved、不写回；dirty 保持（拦截不改变文档状态）
    expect(docHost.save).not.toHaveBeenCalled();
    expect(controller.markSaved).not.toHaveBeenCalled();
    expect(setDoc).not.toHaveBeenCalled();
    expect(controller.dirty).toBe(true);
    // 通知恰一次（同源去重）
    expect(onBlockedSave).toHaveBeenCalledTimes(1);
    expect(onBlockedSave).toHaveBeenCalledWith(SAVE_BLOCKED_NOTICE);
    // 拦截不闪「保存中」（guard 在入队前判定，saving 零变化）
    expect(savingLog).toEqual([]);

    // 再触发（模拟下一次 dirty 边沿重新排定）→ 同 source 不重复通知、仍不写
    const c = controller as { dirty: boolean };
    c.dirty = false;
    view.rerender();
    c.dirty = true;
    view.rerender();
    expect(autoSaveTimer.current).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(onBlockedSave).toHaveBeenCalledTimes(1);
    expect(docHost.save).not.toHaveBeenCalled();
  });

  it('写入失败 → 可见失败通知 + dirty 保持 + 不重试 + saving 回落（复核 R3）', async () => {
    const { controller, docHost, onBlockedSave, savingLog } = setup({
      docHost: {
        save: vi.fn(async () => {
          throw new Error('disk-full');
        }),
      },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(docHost.save).toHaveBeenCalledTimes(1);
    expect(controller.dirty).toBe(true); // 失败不得清脏
    expect(controller.markSaved).not.toHaveBeenCalled();
    expect(onBlockedSave).toHaveBeenCalledWith(SAVE_FAILED_NOTICE);
    expect(savingLog).toEqual([true, false]);

    // 失败不无限重试：内容未再变化 → 不再排定写入
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(docHost.save).toHaveBeenCalledTimes(1);
  });

  it('用户取消保存 → 静默（不报失败通知）', async () => {
    const { onBlockedSave } = setup({
      docHost: { save: vi.fn(async () => ({ result: 'cancelled' as const })) },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(onBlockedSave).not.toHaveBeenCalled();
  });

  it('置位（ref = doc.source）后 → 写盘恢复', async () => {
    const { view, controller, docHost, syncedSourceRef } = setup({ synced: 'OTHER' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(docHost.save).not.toHaveBeenCalled(); // 先被拦

    // 修复同步（写点语义）后再来一轮（dirty 边沿重排定）
    syncedSourceRef.current = 'OLD';
    const c = controller as { dirty: boolean };
    c.dirty = false;
    view.rerender();
    c.dirty = true;
    view.rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(docHost.save).toHaveBeenCalledTimes(1);
    expect(controller.markSaved).toHaveBeenCalledTimes(1);
  });
});

describe('R1-3：守卫读实时 doc.source（不得被排除出 deps 的字段冻住）', () => {
  /**
   * 背景（P0-FIX-R1 实测定性）：本 hook 的 effect deps 刻意**不含 `doc.source`**
   * （口径纪律：保存写回会误触发文档重建）。deps 排除某字段后，若守卫直接闭包读它，
   * 读到的会是「上一次重排时」的值。
   *
   * 真机命中的是**同族**的另一处（`MindmapStage` 的键位 effect 只依赖 `controller`，
   * 永久捕获首版 `handleSave` → Ctrl+S 的守卫拿旧 `doc.source` 比实时 `syncedSourceRef`
   * → 每次保存被拦）。本 hook 这侧的正确性同样要钉住：换源后守卫必须按**当前** source 判定。
   */
  it('doc.source 换新且 synced 同步后 → 守卫放行、写盘发生（不得沿用旧 source）', async () => {
    const NEW = 'NEW-SOURCE';
    const h = setup({ synced: NEW, doc: { source: NEW } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(h.docHost.save).toHaveBeenCalledTimes(1);
    expect(h.controller.markSaved).toHaveBeenCalledTimes(1);
    expect(h.onBlockedSave).not.toHaveBeenCalled();
  });

  it('对照：ref 与当次 source **不等**时仍须拦（等值判据不得放宽）', async () => {
    const h = setup({ synced: 'OTHER', doc: { source: 'NEW' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(h.docHost.save).not.toHaveBeenCalled();
    expect(h.onBlockedSave).toHaveBeenCalledWith(SAVE_BLOCKED_NOTICE);
  });
});

describe('P0-A · 租约对自动保存的拦截（I-16/I-18）', () => {
  it('★租约期间 auto 提交被挡回 blocked，且**不入队**（saving 不闪）', async () => {
    const h = setup();
    h.session.beginExclusiveOp('rename');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });
    expect(h.docHost.save).not.toHaveBeenCalled();
    // 不入队 → 会话不认为自己「在保存」（saving 不闪）
    expect(h.session.isSaving()).toBe(false);
    expect(h.savingLog.every((v) => v === false)).toBe(true);
  });

  it('★租约挡回时**不发**守卫拦截文案（那是另一类原因，文案不得混用）', async () => {
    const h = setup();
    h.session.beginExclusiveOp('rename');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });
    // blocked 会发 SAVE_BLOCKED_NOTICE；但绝不能声称「写入忙」或「已保存」
    expect(h.onBlockedSave).toHaveBeenCalledWith(SAVE_BLOCKED_NOTICE);
    expect(h.onBlockedSave).not.toHaveBeenCalledWith(SAVE_FAILED_NOTICE);
  });

  it('★释放租约后 flushTick 递增 → 真的补写一次（内容引用未变也生效）', async () => {
    // 这条锚定 onAfterRelease **必须**靠显式触发器：租约期间内容变化的路径上，
    // 补写时 `content` 引用已经稳定（与上次 effect 相同），仅靠 deps 的 content 不会重排，
    // 那条内容就会一直留在内存里（I-18 时序表末行要挡的正是它）。
    const tickRef = { current: 0 };
    // root 用真实节点形状（`EditorController.root` 是 EditableNode，不是任意对象）
    const root = makeTextNode('稳定内容');
    const controller = makeController({ dirty: true, root, serialize: () => 'SRC' });
    const docHost = makeDocHost();
    const doc: MindDoc = {
      id: 'a.mm.md',
      name: 'a.mm.md',
      source: 'OLD',
      handle: HANDLE,
      saved: true,
      ts: 0,
    };
    const setDoc = vi.fn();
    const autoSaveTimer: RefObject<ReturnType<typeof setTimeout> | null> = { current: null };
    const session = new DocumentSaveSession({ readContent: () => controller.root });
    const syncedSourceRef: RefObject<string | null> = { current: 'OLD' };
    const view = renderHook(() =>
      useAutoSave({
        controller,
        docHost,
        doc,
        setDoc,
        session,
        autoSaveTimer,
        syncedSourceRef,
        flushTick: tickRef.current,
      }),
    );

    // 第一次：内容未变（root 引用相同）→ 定时器排定一次，写一次
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });
    expect(docHost.save).toHaveBeenCalledTimes(1);

    // 模拟「租约期间改了内容但被挡回、释放后补写」：root 引用**不变**，只递增 tick
    tickRef.current += 1;
    view.rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });
    // ★必须再写一次：若 flushTick 没进 deps，这里会停在 1 → 转红
    expect(docHost.save).toHaveBeenCalledTimes(2);
  });

  it('★物理写在途时 auto 仍可继续（physicalWrites 只挡新租约，不挡写入本身）', async () => {
    const h = setup();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });
    // 写入结束后计数回落，不会永久卡住后续的 beginExclusiveOp
    expect(h.session.physicalWritesInFlight).toBe(0);
    expect(h.session.beginExclusiveOp('rename').kind).toBe('granted');
  });
});
