/**
 * MODE-GUARD 离开保护 · 原编辑入口矩阵（MG-R1-B / MG-R4 的正式回归）
 *
 * 为什么单列一文件：复核指出「提交边界」此前只落在被探针点名的两个组件上
 * （自由画布面 / 标题），而原计划的入口矩阵还有**描述、备注正文、背面 Markdown、
 * 批注**等 blur 提交的编辑器；另有「预览态草稿」这类 DOM 里没有可 blur 控件的
 * 隐藏草稿（MG-R4）。这里按矩阵逐项钉住两条语义：
 *   ① 组合输入未结束时失焦**不得提交**未确认候选串；
 *   ② `compositionend` 后**已确认**文字必须被提交（否则文字只留在 DOM 里，卸载即丢）。
 * 另加 MG-R4 的会话通道：预览态草稿必须被 `hasPendingDraft()` 看见、被 `flushActiveDraft()` 提交，
 * 且组件卸载后不得留下失效会话。
 *
 * 边界（如实）：本文件是 jsdom 组件级矩阵，不覆盖 OS 级输入法候选框；真实焦点链路
 * （入口点击造成的失焦）在真浏览器旅程 D/E 与 App 层用例中验证。
 */
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import {
  DescBlock,
  GrowthCommentPanel,
  NotePopover,
  OverlayEditor,
  draftSessionCount,
  glassToken,
  hasPendingDraftSession,
  registerDraftSession,
} from '@mindcanvas/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushActiveDraft, hasPendingDraft } from '../src/draftFlush';
import {
  LEAVE_DRAFT_FAILED_NOTICE,
  useUnsavedTransition,
} from '../src/hooks/useUnsavedTransition';
import type { DocumentLeavePort } from '../src/documentLifecycle';

beforeEach(() => {
  // canvas 套件 pretendToBeVisual:false（无 rAF）——部分面板组件用 rAF 调度
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
});

const must = <E extends Element>(el: E | null, what: string): E => {
  if (el === null) throw new Error(`缺少元素：${what}`);
  return el;
};

/** 原生焦点转移：真实浏览器里「点离开入口」就是这样让编辑框失焦的（不依赖 fireEvent.click 是否转移焦点） */
const blurByFocusShift = (): void => {
  const away = document.createElement('button');
  document.body.append(away);
  act(() => {
    away.focus();
  });
  away.remove();
};

const CANDIDATE = '尚未确认的候选文字';
const CONFIRMED = '已确认的文字';

describe('编辑入口矩阵 · 组合未结束不得提交候选串（MG-R1-B）', () => {
  it('标题（OverlayEditor）：组合中失焦不提交；组合结束提交确认文字', () => {
    const onCommit = vi.fn();
    const { container } = render(
      <OverlayEditor
        x={0}
        y={0}
        w={120}
        h={24}
        initial="原题"
        token={glassToken}
        depth={1}
        root={false}
        scale={1}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    const input = must(container.querySelector('[data-overlay-editor]'), '标题编辑器');

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: CANDIDATE } });
    blurByFocusShift();
    expect(onCommit).not.toHaveBeenCalled();

    // 输入法确认：控件值先变成确认文字，随后 compositionend
    fireEvent.change(input, { target: { value: CONFIRMED } });
    fireEvent.compositionEnd(input, { data: CONFIRMED });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(CONFIRMED);
  });

  it('描述（DescBlock）：组合中失焦不提交；组合结束提交确认文字', () => {
    const onCommit = vi.fn();
    const { container } = render(
      <DescBlock
        text="原描述"
        editing
        token={glassToken}
        x={0}
        y={0}
        width={160}
        height={30}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    const ta = must(container.querySelector('[data-desc-input]'), '描述输入框');

    fireEvent.compositionStart(ta);
    fireEvent.change(ta, { target: { value: CANDIDATE } });
    blurByFocusShift();
    expect(onCommit).not.toHaveBeenCalled();

    // 输入法确认：控件值先变成确认文字，随后 compositionend
    fireEvent.change(ta, { target: { value: CONFIRMED } });
    fireEvent.compositionEnd(ta, { data: CONFIRMED });
    expect(onCommit).toHaveBeenCalledWith(CONFIRMED);
  });

  it('备注正文（NotePopover）：组合中失焦不提交；组合结束提交确认文字', () => {
    const onChangeText = vi.fn();
    const { container } = render(
      <NotePopover
        seq={[]}
        text="原正文"
        x={0}
        y={0}
        token={glassToken}
        pinned
        editing
        onChangeSeq={vi.fn()}
        onChangeText={onChangeText}
        onClose={vi.fn()}
      />,
    );
    const ta = must(container.querySelector('textarea'), '正文输入框');

    fireEvent.compositionStart(ta);
    fireEvent.change(ta, { target: { value: CANDIDATE } });
    blurByFocusShift();
    expect(onChangeText).not.toHaveBeenCalled();

    // 输入法确认：控件值先变成确认文字，随后 compositionend
    fireEvent.change(ta, { target: { value: CONFIRMED } });
    fireEvent.compositionEnd(ta, { data: CONFIRMED });
    expect(onChangeText).toHaveBeenCalledWith(CONFIRMED);
  });

  it('背面 Markdown（NotePopover → NoteBackEditor）：组合中失焦不提交；组合结束写回确认文字', () => {
    const onChangeMd = vi.fn();
    const { container } = render(
      <NotePopover
        seq={[]}
        text="正文"
        x={0}
        y={0}
        token={glassToken}
        mode="embedded"
        md="## 原背面"
        flipped
        pinned
        onChangeSeq={vi.fn()}
        onChangeText={vi.fn()}
        onChangeMd={onChangeMd}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(must(container.querySelector('[data-note-md-edit]'), '编辑背面按钮'));
    const ta = must(container.querySelector('[data-note-md-input]'), '背面源文输入框');

    fireEvent.compositionStart(ta);
    fireEvent.change(ta, { target: { value: CANDIDATE } });
    blurByFocusShift();
    expect(onChangeMd).not.toHaveBeenCalled();

    // 输入法确认：控件值先变成确认文字，随后 compositionend
    fireEvent.change(ta, { target: { value: CONFIRMED } });
    fireEvent.compositionEnd(ta, { data: CONFIRMED });
    expect(onChangeMd).toHaveBeenCalledWith(CONFIRMED);
  });

  it('批注（GrowthCommentPanel 新增框）：组合中失焦不提交；组合结束写入确认文字', () => {
    const onChange = vi.fn();
    const { container } = render(
      <GrowthCommentPanel
        items={['第一条']}
        onChange={onChange}
        onClose={vi.fn()}
        token={glassToken}
        x={0}
        y={0}
        width={200}
        height={120}
      />,
    );
    fireEvent.click(must(container.querySelector('[data-gcp-add]'), '新增批注入口'));
    const input = must(container.querySelector('[data-gcp-input-adding]'), '新增批注输入框');

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: CANDIDATE } });
    blurByFocusShift();
    expect(onChange).not.toHaveBeenCalled();

    // 输入法确认：控件值先变成确认文字，随后 compositionend
    fireEvent.change(input, { target: { value: CONFIRMED } });
    fireEvent.compositionEnd(input, { data: CONFIRMED });
    expect(onChange).toHaveBeenCalledWith(['第一条', CONFIRMED]);
  });
});

describe('编辑会话通道 · 预览态草稿（MG-R4）', () => {
  it('切到预览后草稿仍在：beforeunload 看得见，离开路径能提交它', async () => {
    const onChangeMd = vi.fn();
    const { container } = render(
      <NotePopover
        seq={[]}
        text="正文"
        x={0}
        y={0}
        token={glassToken}
        mode="embedded"
        md="## 原背面"
        flipped
        pinned
        onChangeSeq={vi.fn()}
        onChangeText={vi.fn()}
        onChangeMd={onChangeMd}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(must(container.querySelector('[data-note-md-edit]'), '编辑背面按钮'));
    const ta = must(container.querySelector('[data-note-md-input]'), '背面源文输入框');
    fireEvent.change(ta, { target: { value: '## 改后的背面' } });

    // 切预览：textarea 卸载（React 卸载不派发 onBlur）→ 草稿只活在组件状态里
    fireEvent.click(must(container.querySelector('[data-note-md-toggle]'), '预览按钮'));
    expect(container.querySelector('[data-note-md-input]')).toBeNull();
    expect(onChangeMd).not.toHaveBeenCalled();

    // ① beforeunload 判据必须看见它
    expect(hasPendingDraft()).toBe(true);

    // ② 离开路径 flush 必须提交它（干净路径不再放行）
    const view = renderHook(() => useUnsavedTransition());
    const port: DocumentLeavePort = {
      flushEdits: flushActiveDraft,
      isDirty: () => onChangeMd.mock.calls.length > 0,
      isSaving: () => false,
      waitForIdle: async () => undefined,
      save: async () => ({ kind: 'saved', current: true }),
    };
    act(() => {
      view.result.current.registerPort(port);
    });
    const perform = vi.fn();
    await act(async () => {
      void view.result.current.requestLeave(perform);
      await Promise.resolve();
    });

    expect(onChangeMd).toHaveBeenCalledWith('## 改后的背面'); // 草稿被提交（模型不再是旧文本）
    expect(perform).not.toHaveBeenCalled(); // 提交后变脏 → 必须先过三选项决策
    view.unmount();
  });

  it('组件卸载后会话注销（不留失效会话影响后续判断）', () => {
    const view = render(
      <NotePopover
        seq={[]}
        text="正文"
        x={0}
        y={0}
        token={glassToken}
        mode="embedded"
        md="## 原背面"
        flipped
        pinned
        onChangeSeq={vi.fn()}
        onChangeText={vi.fn()}
        onChangeMd={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(draftSessionCount()).toBeGreaterThan(0);
    view.unmount();
    expect(draftSessionCount()).toBe(0);
    expect(hasPendingDraft()).toBe(false);
  });
});

/**
 * MG-R4-B：草稿提交**失败**的传递与恢复。
 *
 * 判别核心：提交抛错不得被吞成「没有草稿」——
 * 模型本来干净 + 草稿只在会话里时，吞掉异常会让干净路径直接放行（草稿随卸载丢失）。
 * 正确语义：保留草稿、目标零执行、给出可修正后重试的可见提示；非 IME 错误不等待
 * 不会到来的 compositionend；用户可取消或显式放弃。
 */
describe('编辑会话通道 · 提交失败与恢复（MG-R4-B）', () => {
  /** 干净模型 + 端口：所有判定都压在「会话通道」上（模型侧无脏可依） */
  function cleanPort(): DocumentLeavePort {
    return {
      flushEdits: flushActiveDraft,
      isDirty: () => false,
      isSaving: () => false,
      waitForIdle: async () => undefined,
      save: async () => ({ kind: 'saved', current: true }),
    };
  }

  async function leaveOnce(view: { result: { current: ReturnType<typeof useUnsavedTransition> } }, perform: () => void): Promise<void> {
    await act(async () => {
      void view.result.current.requestLeave(perform);
      await Promise.resolve();
    });
  }

  it('提交抛错 → 目标零执行、草稿保留、模态给出可修正提示（不等待 compositionend）', async () => {
    const unregister = registerDraftSession({
      hasPending: () => true,
      commit: () => {
        throw new Error('draft writeback failed');
      },
    });
    const view = renderHook(() => useUnsavedTransition());
    act(() => {
      view.result.current.registerPort(cleanPort());
    });

    const perform = vi.fn();
    await leaveOnce(view, perform);

    expect(perform).not.toHaveBeenCalled(); // 干净模型也不再放行
    expect(view.result.current.prompt?.notice).toBe(LEAVE_DRAFT_FAILED_NOTICE);
    expect(view.result.current.blockedNotice).toBeNull(); // 不是 IME 暂缓，不该挂等待
    expect(hasPendingDraftSession()).toBe(true); // 草稿还在（可在编辑器里修正）

    view.unmount(); // 卸载结算未决请求（不悬挂）
    unregister();
  });

  it('部分会话失败：成功的照常写入，失败会话保留 → 汇总为失败不放行', async () => {
    const okCommit = vi.fn();
    const un1 = registerDraftSession({ hasPending: () => true, commit: okCommit });
    const un2 = registerDraftSession({
      hasPending: () => true,
      commit: () => {
        throw new Error('one session failed');
      },
    });
    const view = renderHook(() => useUnsavedTransition());
    act(() => {
      view.result.current.registerPort(cleanPort());
    });

    const perform = vi.fn();
    await leaveOnce(view, perform);

    expect(okCommit).toHaveBeenCalledTimes(1); // 能提交的先保住（不被失败会话打断）
    expect(perform).not.toHaveBeenCalled(); // 但失败事实必须汇总 → 不离开
    expect(view.result.current.prompt?.notice).toBe(LEAVE_DRAFT_FAILED_NOTICE);

    view.unmount();
    un1();
    un2();
  });

  it('修正后重试成功：取消 → 修好 → 第二次离开正常执行目标', async () => {
    let broken = true;
    let committed = 0;
    const unregister = registerDraftSession({
      hasPending: () => true,
      commit: () => {
        if (broken) throw new Error('temporary failure');
        committed += 1;
      },
    });
    const view = renderHook(() => useUnsavedTransition());
    act(() => {
      view.result.current.registerPort(cleanPort());
    });

    const firstPerform = vi.fn();
    await leaveOnce(view, firstPerform);
    expect(firstPerform).not.toHaveBeenCalled();
    expect(view.result.current.prompt?.notice).toBe(LEAVE_DRAFT_FAILED_NOTICE);

    // 用户取消（互斥释放），在编辑器里修正后重试
    act(() => {
      view.result.current.choose('cancel');
    });
    expect(view.result.current.prompt).toBeNull();
    broken = false;

    const perform = vi.fn();
    let ok: boolean | null = null;
    await act(async () => {
      ok = await view.result.current.requestLeave(perform);
    });
    expect(ok).toBe(true);
    expect(committed).toBe(1);
    expect(perform).toHaveBeenCalledTimes(1);

    view.unmount();
    unregister();
  });

  it('提交成功但尚未重渲染（hasPending 仍 true）→ 不误判失败，正常执行目标', async () => {
    // 真实场景：commit 只把值交给上层（异步 state），组件 this tick 仍报 hasPending=true
    const commit = vi.fn();
    const unregister = registerDraftSession({ hasPending: () => true, commit });
    const view = renderHook(() => useUnsavedTransition());
    act(() => {
      view.result.current.registerPort(cleanPort());
    });

    const perform = vi.fn();
    let ok: boolean | null = null;
    await act(async () => {
      ok = await view.result.current.requestLeave(perform);
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(ok).toBe(true);
    expect(perform).toHaveBeenCalledTimes(1); // 失败只由「抛错」判定，不复查 hasPending

    view.unmount();
    unregister();
  });

  it('放弃修改：提交失败也允许显式放弃（不把用户锁死在文档里）', async () => {
    const unregister = registerDraftSession({
      hasPending: () => true,
      commit: () => {
        throw new Error('still failing');
      },
    });
    const view = renderHook(() => useUnsavedTransition());
    act(() => {
      view.result.current.registerPort({ ...cleanPort(), isDirty: () => true });
    });

    const perform = vi.fn();
    await leaveOnce(view, perform);
    expect(perform).not.toHaveBeenCalled();
    expect(view.result.current.prompt?.notice).toBe(LEAVE_DRAFT_FAILED_NOTICE);

    act(() => {
      view.result.current.choose('discard');
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(perform).toHaveBeenCalledTimes(1); // 显式放弃 = 用户对草稿的处置，放行

    view.unmount();
    unregister();
  });
});
