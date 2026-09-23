/**
 * 离开决策器矩阵（MODE-GUARD Task 1）—— 假 leave port，覆盖计划「决策规则」全部分支。
 *
 * 判别核心：
 * - 干净且无 I/O → 直接执行目标；否则三选项模态（保存并继续 / 放弃修改 / 取消）；
 * - 保存只认 `saved,current=true` + 实时复核 `isDirty()/isSaving()`；
 * - `downloaded` 不自动离开（保留取消/显式放弃）；
 * - 取消后迟到的保存完成不得执行原目标；重复点击不覆盖 resolver/目标；
 * - 一次只处理一个请求；端口注销后未就绪不放行。
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushActiveDraft, subscribeCompositionEnd } from '../src/draftFlush';
import type { DocumentLeavePort, SaveCompletion } from '../src/documentLifecycle';
import {
  LEAVE_BLOCKED_NOTICE,
  LEAVE_CANCELLED_NOTICE,
  LEAVE_COMPOSITION_DEFERRED_NOTICE,
  LEAVE_COMPOSITION_NOTICE,
  LEAVE_DOWNLOAD_NOTICE,
  LEAVE_FAILED_NOTICE,
  LEAVE_SAVE_AGAIN_NOTICE,
  LEAVE_SAVING_NOTICE,
  LEAVE_STALE_NOTICE,
  useUnsavedTransition,
} from '../src/hooks/useUnsavedTransition';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ok) => {
    resolve = ok;
  });
  return { promise, resolve };
}

/** 假端口：状态由用例显式控制（save 默认同步返回 saved/current:true） */
function makePort(over: Partial<DocumentLeavePort> = {}): DocumentLeavePort {
  return {
    flushEdits: () => true,
    isDirty: () => false,
    isSaving: () => false,
    waitForIdle: async () => undefined,
    save: async (): Promise<SaveCompletion> => ({ kind: 'saved', current: true }),
    ...over,
  };
}

function setup(port: DocumentLeavePort) {
  const view = renderHook(() => useUnsavedTransition());
  let unregister: () => void = () => undefined;
  act(() => {
    unregister = view.result.current.registerPort(port);
  });
  return { view, unregister: () => act(() => unregister()) };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('离开决策器 · 干净与直接执行', () => {
  it('干净且无 I/O → 直接执行目标并返回 true（不开模态）', async () => {
    const perform = vi.fn();
    const { view } = setup(makePort());

    let ok: boolean | null = null;
    await act(async () => {
      ok = await view.result.current.requestLeave(perform);
    });

    expect(ok).toBe(true);
    expect(perform).toHaveBeenCalledTimes(1);
    expect(view.result.current.prompt).toBeNull();
  });

  it('未登记端口（未就绪）→ 不放行、不执行目标', async () => {
    const view = renderHook(() => useUnsavedTransition());
    const perform = vi.fn();

    let ok: boolean | null = null;
    await act(async () => {
      ok = await view.result.current.requestLeave(perform);
    });

    expect(ok).toBe(false);
    expect(perform).not.toHaveBeenCalled();
  });

  it('端口注销后 → 不再放行（旧 Stage 清理不注销新 Stage：按身份判定）', async () => {
    const portA = makePort();
    const portB = makePort();
    const { view, unregister } = setup(portA);

    // 新 Stage 登记 B，随后旧 Stage 的清理函数才被调用（乱序卸载）
    act(() => {
      view.result.current.registerPort(portB);
    });
    unregister();

    const perform = vi.fn();
    await act(async () => {
      await view.result.current.requestLeave(perform);
    });
    // B 仍在登记 → 干净端口可直接放行（若旧清理误注销，这里会因未就绪而 false）
    expect(perform).toHaveBeenCalledTimes(1);
  });
});

describe('离开决策器 · 三选项', () => {
  it('dirty → 打开模态；取消 = 不执行目标 + 保持文档', async () => {
    const perform = vi.fn();
    const { view } = setup(makePort({ isDirty: () => true }));

    let pending: Promise<boolean> | null = null;
    act(() => {
      pending = view.result.current.requestLeave(perform);
    });
    expect(view.result.current.prompt).not.toBeNull();
    expect(perform).not.toHaveBeenCalled();

    act(() => {
      view.result.current.choose('cancel');
    });
    expect(await pending).toBe(false);
    expect(perform).not.toHaveBeenCalled();
    expect(view.result.current.prompt).toBeNull();
  });

  it('dirty → 放弃：停止排定新的自动保存（suppressPendingAuto）+ 执行目标', async () => {
    const perform = vi.fn();
    const suppress = vi.fn();
    const { view } = setup(
      makePort({ isDirty: () => true, suppressPendingAuto: suppress }),
    );

    let pending: Promise<boolean> | null = null;
    act(() => {
      pending = view.result.current.requestLeave(perform);
    });
    await act(async () => {
      view.result.current.choose('discard');
    });

    expect(suppress).toHaveBeenCalledTimes(1);
    expect(perform).toHaveBeenCalledTimes(1);
    expect(await pending).toBe(true);
  });

  it('dirty → 放弃：写入进行中先等收束（waitForIdle）再离开', async () => {
    const perform = vi.fn();
    const gate = deferred<void>();
    let saving = true;
    const port = makePort({
      isDirty: () => true,
      isSaving: () => saving,
      waitForIdle: () => gate.promise.then(() => undefined),
    });
    const { view } = setup(port);

    let pending: Promise<boolean> | null = null;
    act(() => {
      pending = view.result.current.requestLeave(perform);
    });
    expect(view.result.current.prompt?.busy).toBe(true);

    act(() => {
      view.result.current.choose('discard');
    });
    expect(perform).not.toHaveBeenCalled(); // 收束前不得离开

    saving = false;
    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    expect(perform).toHaveBeenCalledTimes(1);
    expect(await pending).toBe(true);
  });

  it('dirty → 保存成功（saved,current=true）且复核通过 → 执行目标', async () => {
    const perform = vi.fn();
    const port = makePort({ isDirty: () => true, save: async () => ({ kind: 'saved', current: true }) });
    const { view } = setup(port);

    let pending: Promise<boolean> | null = null;
    act(() => {
      pending = view.result.current.requestLeave(perform);
    });
    let saved = false;
    // 保存成功后端口报告干净（真实端口：markSaved 已清脏）
    (port as { isDirty: () => boolean }).isDirty = () => false;
    await act(async () => {
      view.result.current.choose('save');
      saved = true;
    });

    expect(saved).toBe(true);
    expect(perform).toHaveBeenCalledTimes(1);
    expect(await pending).toBe(true);
  });

  it('保存成功但复核发现仍 dirty（保存期间继续编辑）→ 不离开 + 再保存提示', async () => {
    const perform = vi.fn();
    const { view } = setup(
      makePort({ isDirty: () => true, save: async () => ({ kind: 'saved', current: true }) }),
    );

    let pending: Promise<boolean> | null = null;
    act(() => {
      pending = view.result.current.requestLeave(perform);
    });
    await act(async () => {
      view.result.current.choose('save');
    });

    expect(perform).not.toHaveBeenCalled();
    expect(view.result.current.prompt?.notice).toBe(LEAVE_SAVE_AGAIN_NOTICE);
    // 之后仍可显式放弃离开
    await act(async () => {
      view.result.current.choose('discard');
    });
    expect(perform).toHaveBeenCalledTimes(1);
    expect(await pending).toBe(true);
  });

  it('saved,current=false → 不离开 + 再保存提示', async () => {
    const perform = vi.fn();
    const { view } = setup(
      makePort({ isDirty: () => true, save: async () => ({ kind: 'saved', current: false }) }),
    );

    act(() => {
      void view.result.current.requestLeave(perform);
    });
    await act(async () => {
      view.result.current.choose('save');
    });

    expect(perform).not.toHaveBeenCalled();
    expect(view.result.current.prompt?.notice).toBe(LEAVE_SAVE_AGAIN_NOTICE);
  });

  it('downloaded → **不自动离开**，给出下载提示并保留放弃入口', async () => {
    const perform = vi.fn();
    const { view } = setup(
      makePort({ isDirty: () => true, save: async () => ({ kind: 'downloaded', current: true }) }),
    );

    let pending: Promise<boolean> | null = null;
    act(() => {
      pending = view.result.current.requestLeave(perform);
    });
    await act(async () => {
      view.result.current.choose('save');
    });

    expect(perform).not.toHaveBeenCalled();
    expect(view.result.current.prompt?.notice).toBe(LEAVE_DOWNLOAD_NOTICE);

    await act(async () => {
      view.result.current.choose('discard');
    });
    expect(perform).toHaveBeenCalledTimes(1);
    expect(await pending).toBe(true);
  });

  it.each([
    ['failed', 'failed' as const, LEAVE_FAILED_NOTICE],
    ['blocked', 'blocked' as const, LEAVE_BLOCKED_NOTICE],
    ['cancelled', 'cancelled' as const, LEAVE_CANCELLED_NOTICE],
    ['stale', 'stale' as const, LEAVE_STALE_NOTICE],
  ])('保存结果 %s → 不离开 + 对应提示', async (_name, kind, notice) => {
    const perform = vi.fn();
    const { view } = setup(makePort({ isDirty: () => true, save: async () => ({ kind }) }));

    act(() => {
      void view.result.current.requestLeave(perform);
    });
    await act(async () => {
      view.result.current.choose('save');
    });

    expect(perform).not.toHaveBeenCalled();
    expect(view.result.current.prompt?.notice).toBe(notice);
  });

  it('flush 失败（组合未结束）→ 不弹模态、非模态提示 + 暂缓；组合结束后自动续跑', async () => {
    const perform = vi.fn();
    let composing = true;
    const port = makePort({
      isDirty: () => true,
      flushEdits: () => !composing,
    });
    const { view } = setup(port);

    let pending: Promise<boolean> | null = null;
    act(() => {
      pending = view.result.current.requestLeave(perform);
    });
    // 不弹模态：模态聚焦会让编辑器失焦 → 把未确认候选串当正文提交（MG-R1）
    expect(view.result.current.prompt).toBeNull();
    expect(view.result.current.blockedNotice).toBe(LEAVE_COMPOSITION_DEFERRED_NOTICE);
    expect(perform).not.toHaveBeenCalled();

    // 组合结束 → 自动续跑（此时草稿已 flush、端口干净）→ 直接执行目标
    composing = false;
    (port as { isDirty: () => boolean }).isDirty = () => false;
    await act(async () => {
      document.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      await Promise.resolve();
    });
    expect(perform).toHaveBeenCalledTimes(1);
    expect(await pending).toBe(true);
    expect(view.result.current.blockedNotice).toBeNull();
  });

  it('组合暂缓期间：第二次请求被拒（单请求），组合结束后原请求续跑', async () => {
    const perform = vi.fn();
    const second = vi.fn();
    let composing = true;
    const port = makePort({
      isDirty: () => true,
      flushEdits: () => !composing,
    });
    const { view } = setup(port);

    act(() => {
      void view.result.current.requestLeave(perform);
    });
    let secondOk: boolean | null = null;
    await act(async () => {
      secondOk = await view.result.current.requestLeave(second);
    });
    expect(secondOk).toBe(false);
    expect(second).not.toHaveBeenCalled();

    composing = false;
    (port as { isDirty: () => boolean }).isDirty = () => false;
    await act(async () => {
      document.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      await Promise.resolve();
    });
    expect(perform).toHaveBeenCalledTimes(1);
  });

  it('组合暂缓期间取消/卸载：解绑组合监听，迟到 compositionend 不再续跑', async () => {
    const perform = vi.fn();
    const port = makePort({ isDirty: () => true, flushEdits: () => false });
    const { view } = setup(port);

    act(() => {
      void view.result.current.requestLeave(perform);
    });
    expect(perform).not.toHaveBeenCalled();

    await act(async () => {
      view.unmount(); // 决策器卸载（切到别的 App 壳 / 测试清理）
      await Promise.resolve();
    });
    await act(async () => {
      document.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      await Promise.resolve();
    });
    expect(perform).not.toHaveBeenCalled(); // 失效请求不得因迟到事件续跑
  });
});

describe('离开决策器 · 单请求与迟到回调', () => {
  it('重复点击：第二次直接拒绝，不覆盖目标；只执行第一个目标', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { view } = setup(makePort({ isDirty: () => true }));

    let pendingA: Promise<boolean> | null = null;
    let pendingB: Promise<boolean> | null = null;
    act(() => {
      pendingA = view.result.current.requestLeave(first);
      pendingB = view.result.current.requestLeave(second);
    });

    expect(view.result.current.prompt).not.toBeNull();
    expect(await pendingB).toBe(false);

    await act(async () => {
      view.result.current.choose('discard');
    });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(await pendingA).toBe(true);
  });

  it('保存挂起期间取消：迟到的保存完成不得执行原目标', async () => {
    const gate = deferred<SaveCompletion>();
    const perform = vi.fn();
    const { view } = setup(makePort({ isDirty: () => true, save: () => gate.promise }));

    let pending: Promise<boolean> | null = null;
    act(() => {
      pending = view.result.current.requestLeave(perform);
    });
    act(() => {
      view.result.current.choose('save');
    });
    expect(view.result.current.prompt?.busy).toBe(true);

    act(() => {
      view.result.current.choose('cancel');
    });
    expect(await pending).toBe(false);

    await act(async () => {
      gate.resolve({ kind: 'saved', current: true });
      await gate.promise;
    });
    expect(perform).not.toHaveBeenCalled();
    expect(view.result.current.prompt).toBeNull();
  });

  it('打开时已有写入在跑：点「保存并继续」先等收束再写，成功后离开（不给死按钮）', async () => {
    const gate = deferred<void>();
    const save = vi.fn(async (): Promise<SaveCompletion> => ({ kind: 'saved', current: true }));
    let dirty = true;
    let saving = true;
    const { view } = setup(
      makePort({
        isDirty: () => dirty,
        isSaving: () => saving,
        waitForIdle: () => gate.promise.then(() => undefined),
        save,
      }),
    );
    const perform = vi.fn();

    let pending: Promise<boolean> | null = null;
    act(() => {
      pending = view.result.current.requestLeave(perform);
    });
    expect(view.result.current.prompt?.busy).toBe(true);
    expect(view.result.current.prompt?.notice).toBe(LEAVE_SAVING_NOTICE);

    act(() => {
      view.result.current.choose('save');
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(save).not.toHaveBeenCalled(); // 先等已开始的 I/O 收束

    saving = false;
    dirty = false;
    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(perform).toHaveBeenCalledTimes(1);
    expect(await pending).toBe(true);
  });

  it('保存进行中重复点「保存并继续」→ 只发起一次保存', async () => {
    const gate = deferred<SaveCompletion>();
    const save = vi.fn(() => gate.promise);
    const perform = vi.fn();
    let dirty = true;
    const { view } = setup(makePort({ isDirty: () => dirty, save }));

    act(() => {
      void view.result.current.requestLeave(perform);
    });
    act(() => {
      view.result.current.choose('save');
    });
    act(() => {
      view.result.current.choose('save');
    });

    expect(save).toHaveBeenCalledTimes(1);
    dirty = false; // 真实端口：保存成功即 markSaved 清脏
    await act(async () => {
      gate.resolve({ kind: 'saved', current: true });
      await gate.promise;
    });
    expect(perform).toHaveBeenCalledTimes(1);
  });
});

describe('草稿 flush · 组合跟踪（MG-R1）', () => {
  it('冷启动：任何 flush 之前就已 compositionstart → 首次 flush 必须为 false', () => {
    const input = document.createElement('textarea');
    document.body.append(input);
    input.focus();
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));

    // 跟踪在模块加载时就装好，不依赖「先调用一次 flush」预热。
    // 组合分支沿用既有布尔契约：严格返回 false
    expect(flushActiveDraft()).toBe(false);

    // 组合结束后返回 'ok'（MG-R4-B 起 ok 用字面量表示，'failed' 才是提交失败）
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    expect(flushActiveDraft()).toBe('ok');
    input.remove();
  });

  it('组合结束后通知订阅者（决策器据此自动续跑）', () => {
    const seen = vi.fn();
    const off = subscribeCompositionEnd(seen);
    document.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    document.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    expect(seen).toHaveBeenCalledTimes(1); // 解绑后不再回调
  });
});

describe('离开决策器 · 端口归属（MG-R2）', () => {
  it('待选择时注销端口 → 请求结算 false 且模态关闭（Promise 不悬挂）', async () => {
    const perform = vi.fn();
    const { view, unregister } = setup(makePort({ isDirty: () => true }));

    let settled: boolean | null = null;
    act(() => {
      void view.result.current.requestLeave(perform).then((ok) => {
        settled = ok;
      });
    });
    expect(view.result.current.prompt).not.toBeNull();

    await act(async () => {
      unregister();
      await Promise.resolve();
    });
    expect(settled).toBe(false);
    expect(view.result.current.prompt).toBeNull();
    expect(perform).not.toHaveBeenCalled();
  });

  it('保存进行中注销端口 → 迟到的 saved,current=true 不执行旧目标、不改写提示', async () => {
    const gate = deferred<SaveCompletion>();
    const perform = vi.fn();
    let dirty = true;
    const { view, unregister } = setup(
      makePort({ isDirty: () => dirty, save: () => gate.promise }),
    );

    act(() => {
      void view.result.current.requestLeave(perform);
    });
    act(() => {
      view.result.current.choose('save');
    });

    await act(async () => {
      unregister();
      await Promise.resolve();
    });
    dirty = false;
    await act(async () => {
      gate.resolve({ kind: 'saved', current: true });
      await Promise.resolve();
    });

    expect(perform).not.toHaveBeenCalled();
    expect(view.result.current.prompt).toBeNull(); // 旧完成不得给新状态写提示
  });

  it('保存进行中被新端口替换 → 旧目标零执行，新端口请求可用', async () => {
    const gate = deferred<SaveCompletion>();
    const perform = vi.fn();
    const { view } = setup(makePort({ isDirty: () => true, save: () => gate.promise }));

    act(() => {
      void view.result.current.requestLeave(perform);
    });
    act(() => {
      view.result.current.choose('save');
    });
    act(() => {
      view.result.current.registerPort(makePort()); // 新 Stage 登记（替换）
    });
    await act(async () => {
      gate.resolve({ kind: 'saved', current: true });
      await Promise.resolve();
    });
    expect(perform).not.toHaveBeenCalled();

    // 新端口上的请求照常工作（旧请求失效不得牵连新端口）
    const nextPerform = vi.fn();
    let ok: boolean | null = null;
    await act(async () => {
      ok = await view.result.current.requestLeave(nextPerform);
    });
    expect(ok).toBe(true);
    expect(nextPerform).toHaveBeenCalledTimes(1);
  });

  it('等待已开始写入收束中被替换 → 迟到结果不得执行旧目标', async () => {
    const idle = deferred<void>();
    const perform = vi.fn();
    let saving = true;
    const { view } = setup(
      makePort({
        isDirty: () => true,
        isSaving: () => saving,
        waitForIdle: () => idle.promise,
      }),
    );

    act(() => {
      void view.result.current.requestLeave(perform);
    });
    act(() => {
      view.result.current.choose('save');
    });
    act(() => {
      view.result.current.registerPort(makePort()); // 等待期间端口被替换
    });

    saving = false;
    await act(async () => {
      idle.resolve();
      await idle.promise;
    });
    expect(perform).not.toHaveBeenCalled();
  });

  it('决策器卸载 → 未执行目标的请求结算 false（不悬挂）', async () => {
    const perform = vi.fn();
    const { view } = setup(makePort({ isDirty: () => true }));

    let settled: boolean | null = null;
    act(() => {
      void view.result.current.requestLeave(perform).then((ok) => {
        settled = ok;
      });
    });

    await act(async () => {
      view.unmount();
      await Promise.resolve();
    });
    expect(settled).toBe(false);
    expect(perform).not.toHaveBeenCalled();
  });

  it('同一端口对象重复登记（新代次）→ 旧请求结算 false、模态关闭、新请求可用', async () => {
    const view = renderHook(() => useUnsavedTransition());
    let dirty = true;
    const samePort = makePort({ isDirty: () => dirty });
    act(() => {
      view.result.current.registerPort(samePort);
    });

    let settled: boolean | null = null;
    act(() => {
      void view.result.current.requestLeave(vi.fn()).then((ok) => {
        settled = ok;
      });
    });
    expect(view.result.current.prompt).not.toBeNull();

    // 同一对象再次登记 = 新代次 → 旧代次请求必须结束（否则永远 owns()=false 却占着互斥）
    await act(async () => {
      view.result.current.registerPort(samePort);
      await Promise.resolve();
    });
    expect(settled).toBe(false);
    expect(view.result.current.prompt).toBeNull();

    // 新代次上请求照常可用
    dirty = false;
    const perform = vi.fn();
    let ok: boolean | null = null;
    await act(async () => {
      ok = await view.result.current.requestLeave(perform);
    });
    expect(ok).toBe(true);
    expect(perform).toHaveBeenCalledTimes(1);
  });

  it('旧 Stage 的清理晚于新 Stage 登记 → 既不清端口也不结束新请求', async () => {
    const view = renderHook(() => useUnsavedTransition());
    let oldCleanup: () => void = () => undefined;
    act(() => {
      oldCleanup = view.result.current.registerPort(makePort({ isDirty: () => true }));
    });
    act(() => {
      view.result.current.registerPort(makePort()); // 新 Stage 登记
    });

    const perform = vi.fn();
    let ok: boolean | null = null;
    await act(async () => {
      ok = await view.result.current.requestLeave(perform);
    });
    await act(async () => {
      oldCleanup(); // 迟到的旧清理
      await Promise.resolve();
    });
    expect(ok).toBe(true);
    expect(perform).toHaveBeenCalledTimes(1);
    expect(view.result.current.ready).toBe(true); // 新端口仍就绪
  });
});

describe('离开决策器 · 异步目标（MG-R3）', () => {
  it('异步目标执行期间保留互斥：第二次请求 false 且零执行；完成后解锁', async () => {
    const gate = deferred<void>();
    const second = vi.fn();
    const { view } = setup(makePort());

    let first: Promise<boolean> | null = null;
    act(() => {
      first = view.result.current.requestLeave(() => gate.promise);
    });
    let secondOk: boolean | null = null;
    await act(async () => {
      secondOk = await view.result.current.requestLeave(second);
    });
    expect(secondOk).toBe(false);
    expect(second).not.toHaveBeenCalled();

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    expect(await first).toBe(true);

    // 目标收束后互斥释放：后续请求正常可用
    const third = vi.fn();
    let thirdOk: boolean | null = null;
    await act(async () => {
      thirdOk = await view.result.current.requestLeave(third);
    });
    expect(thirdOk).toBe(true);
    expect(third).toHaveBeenCalledTimes(1);
  });

  it('异步目标失败 → 结算 false 且解锁（后续请求不被悬挂挡住）', async () => {
    const failing = vi.fn(async () => {
      throw new Error('目标失败');
    });
    const { view } = setup(makePort());

    let ok: boolean | null = null;
    await act(async () => {
      ok = await view.result.current.requestLeave(failing);
    });
    expect(ok).toBe(false);

    const next = vi.fn();
    let nextOk: boolean | null = null;
    await act(async () => {
      nextOk = await view.result.current.requestLeave(next);
    });
    expect(nextOk).toBe(true);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('目标执行导致 Stage 注销（正常切换）→ 结算 true，不误判为失败', async () => {
    const view = renderHook(() => useUnsavedTransition());
    let unregister: () => void = () => undefined;
    act(() => {
      unregister = view.result.current.registerPort(makePort());
    });

    let ok: boolean | null = null;
    await act(async () => {
      ok = await view.result.current.requestLeave(() => {
        unregister(); // 切换成功 → 旧 Stage 卸载并注销端口
      });
    });
    expect(ok).toBe(true);
    expect(view.result.current.prompt).toBeNull();
  });
});

/**
 * P0-A：离开决策器与**文件操作**的共用通道（F2 同族）。
 *
 * 本轮**不改**决策器（排除项），所以这里只钉住两件事：
 *  ① 决策器的 `flushEdits` 与 F2 用的是**同一族**信号 —— `'composing'` 暂缓、
 *     `'failed'` 保留草稿，两者对「组合/草稿失败」的处理必须一致（不得一个放行一个拦住）；
 *  ② 租约期间 `isSaving()` 为假的语义边界：租约不是「在保存」，但提交确实被挡回 ——
 *     决策器据此走的仍是「干净则直接执行」那条路（文件操作自己会拒绝）。
 */
describe('P0-A · 离开决策器与文件操作同族的信号一致', () => {
  it('★组合未结束：决策器暂缓（非模态），与 F2 的 composing 分支同判', async () => {
    const port = makePort({ flushEdits: () => 'composing' as const });
    const { view } = setup(port);
    let switched = false;
    await act(async () => {
      void view.result.current.requestLeave(() => {
        switched = true;
      });
    });
    // 不弹模态（模态聚焦会把未确认候选串当正文提交）
    expect(view.result.current.prompt).toBeNull();
    expect(view.result.current.blockedNotice).toBe(LEAVE_COMPOSITION_DEFERRED_NOTICE);
    expect(switched).toBe(false);
  });

  it('★草稿提交失败：保留草稿、不离开，与 F2 的 draft-failed 分支同判', async () => {
    const port = makePort({ flushEdits: () => 'failed' as const });
    const { view } = setup(port);
    let switched = false;
    await act(async () => {
      void view.result.current.requestLeave(() => {
        switched = true;
      });
    });
    expect(switched).toBe(false);
    // 与 F2 一致：草稿失败的请求保持活动（可修正后重试），模态带可读提示
    expect(view.result.current.prompt?.notice).toBeTruthy();
  });

  it('干净且无 I/O → 直接执行目标（与文件操作无关的路径不受 P0-A 影响）', async () => {
    const { view } = setup(makePort());
    let switched = false;
    await act(async () => {
      await view.result.current.requestLeave(() => {
        switched = true;
      });
    });
    expect(switched).toBe(true);
  });

  it('★租约不改变决策器判据：isSaving 为假即视为「无 I/O」（文件操作自行拒绝）', async () => {
    // 语义边界：租约不是「在保存」。决策器不该因为租约存在就把用户锁在文档里；
    // 真正的互斥由文件操作自己的 beginExclusiveOp 负责（P0-A 的租约）。
    const port = makePort({ isDirty: () => true, isSaving: () => false });
    const { view } = setup(port);
    await act(async () => {
      void view.result.current.requestLeave(() => undefined);
    });
    // dirty 且无 I/O → 三选模态（而不是被租约误判成「正在保存」）
    expect(view.result.current.prompt).not.toBeNull();
    expect(view.result.current.prompt?.busy).toBe(false);
  });
});
