/**
 * useDocumentActions 行为测试
 *
 * 为什么测它：`StageContent` 有 1,781 行（MindmapStage.tsx:351-2131）、管着 10 个面板，
 * 是全项目最大的组件，且 apps 层此前零测试。抽出 hook 后，这部分逻辑终于可测。
 * 本文件锁住的行为，就是后续继续拆分 StageContent 时的回归基线。
 *
 * 不测什么：不测导出（见 useExportActions，依赖 Blob/URL/alert）；
 * 不测自动保存（已抽为 hooks/useAutoSave，见 useAutoSave.test.tsx）。
 */
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { makeTextNode } from '@mindcanvas/kernel';
import type { RefObject } from 'react';
import type {
  DocumentHost,
  EditorController,
  FsFileHandle,
  MindDoc,
  SaveOutcome,
} from '@mindcanvas/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDocumentActions } from '../src/hooks/useDocumentActions';
import { DocumentSaveSession } from '../src/hooks/useDocumentSaveSession';
import { SAVE_BLOCKED_NOTICE } from '../src/hooks/saveGuard';
import {
  SAVE_BUSY_NOTICE,
  SAVE_FAILED_NOTICE,
  SAVE_METADATA_WARNING,
  type RequestLeave,
  type SaveCompletion,
} from '../src/documentLifecycle';
import { UnsavedPrompt } from '../src/UnsavedPrompt.js';

/** 最小可用的 controller：只实现本 hook 触碰的成员 */
function makeController(over: Partial<EditorController> = {}): EditorController {
  return {
    dirty: false,
    serialize: () => 'SRC',
    markSaved: vi.fn(),
    ...over,
  } as unknown as EditorController;
}

/** 保存结果（FA1-T1 起 DocumentHost.save 回传 result + handle） */
function fsOk(handle?: FsFileHandle): { result: 'fs'; handle?: FsFileHandle } {
  return handle ? { result: 'fs', handle } : { result: 'fs' };
}

function makeDocHost(over: Partial<DocumentHost> = {}): DocumentHost {
  return {
    remember: vi.fn(),
    open: vi.fn(async () => null),
    create: vi.fn((name: string) => ({ name, source: '', saved: false })),
    save: vi.fn(async () => fsOk()),
    restoreHandle: vi.fn(async (d: MindDoc) => d),
    ...over,
  } as unknown as DocumentHost;
}

/** 最小可用文件句柄（保存走句柄写回时会调用 createWritable：形状必须完整，不用 `{}` 顶替） */
const HANDLE: FsFileHandle = {
  name: 'a.mm.md',
  createWritable: async () => ({
    write: async () => undefined,
    close: async () => undefined,
  }),
};

const baseDoc: MindDoc = {
  id: 'a.mm.md',
  name: 'a.mm.md',
  source: 'X',
  saved: true,
  handle: HANDLE,
  ts: 0,
};

/**
 * 把 setDoc 的调用「求值」成最终状态。
 * 组件里大量用函数式更新 `setDoc((d) => …)`，而测试里 setDoc 是 vi.fn() ——
 * 不手动调用 updater 就永远只看到一个函数，断言不到真实写入的字段。
 */
function applied(setDoc: ReturnType<typeof vi.fn>, prev: MindDoc): unknown[] {
  return setDoc.mock.calls.map((c) => (typeof c[0] === 'function' ? c[0](prev) : c[0]));
}

function setup(over: {
  controller?: Partial<EditorController>;
  docHost?: Partial<DocumentHost>;
  doc?: Partial<MindDoc>;
  /** MODE-GUARD：离开决策器（默认：直接执行目标并返回 true，等价「无保护」） */
  requestLeave?: RequestLeave;
  /** S2G：同步标记初值；缺省 = 与 doc.source 同源（现行为） */
  synced?: string | null;
} = {}) {
  const controller = makeController(over.controller);
  const docHost = makeDocHost(over.docHost);
  const doc = { ...baseDoc, ...over.doc };
  const setDoc = vi.fn();
  const fileInputRef = { current: null } as RefObject<HTMLInputElement | null>;
  const autoSaveTimer: RefObject<ReturnType<typeof setTimeout> | null> = { current: null };
  const onBlockedSave = vi.fn();
  // 附属记录失败（写盘已成功）的独立通知渠道
  const onSaveWarning = vi.fn();
  // S2G：mock 增 `syncedSourceRef`（缺省同源 = 现行为，同 S2F 先例）
  const syncedSourceRef: RefObject<string | null> = {
    current: over.synced === undefined ? doc.source : over.synced,
  };
  // SAVE-LIFECYCLE：保存会话（同会话串行 + 会话/内容归属校验）；
  // 目的地按生产接线由 doc.handle 初始化（渲染层由 useAutoSave 的同步 effect 维护）
  const session = new DocumentSaveSession({ readContent: () => controller.root });
  session.setDestination(doc.handle);
  const { result } = renderHook(() =>
    useDocumentActions({
      controller,
      docHost,
      doc,
      setDoc,
      fileInputRef,
      autoSaveTimer,
      session,
      syncedSourceRef,
      onBlockedSave,
      onSaveWarning,
      requestLeave: over.requestLeave,
    }),
  );
  return {
    result,
    controller,
    docHost,
    doc,
    setDoc,
    fileInputRef,
    autoSaveTimer,
    session,
    syncedSourceRef,
    onBlockedSave,
    onSaveWarning,
  };
}

afterEach(() => {
  cleanup(); // 组件级渲染（UnsavedPrompt 用例）随用例卸载
  vi.restoreAllMocks();
  vi.unstubAllGlobals(); // handleOpen 用例注入的 window.showOpenFilePicker 随用例回收
});

/**
 * MODE-GUARD：`applyDoc` 不再自带确认框 —— 它把「真正替换」交给注入的 `requestLeave`
 * （App 的三选项决策器）。缺省未注入时直接替换（独立用法/旧测试）。
 */
describe('useDocumentActions · applyDoc（离开决策器接管）', () => {
  /** 假决策器：`allow=true` 时执行目标并返回 true（等价用户选择「保存/放弃并继续」） */
  const allowLeave = (): RequestLeave =>
    vi.fn(async (perform: () => void | Promise<void>) => {
      await perform();
      return true;
    }) as unknown as RequestLeave;

  it('干净 → 决策器仍被调用（决策器自行判断是否直接放行）', async () => {
    const { result, docHost, setDoc } = setup({
      controller: { dirty: false },
      requestLeave: allowLeave(),
    });
    const next = { ...baseDoc, name: 'b.mm.md' };

    await act(async () => {
      await result.current.applyDoc(next);
    });

    expect(setDoc).toHaveBeenCalledWith(next);
    expect(docHost.remember).toHaveBeenCalledWith(next);
  });

  it('决策器拒绝（用户取消）→ 不切换、不记住', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => {
      throw new Error('native confirm() 被调用');
    });
    const requestLeave = vi.fn(async () => false) as unknown as RequestLeave;
    const { result, docHost, setDoc } = setup({ controller: { dirty: true }, requestLeave });

    let ok: boolean | null = null;
    await act(async () => {
      ok = await result.current.applyDoc({ ...baseDoc, name: 'b.mm.md' });
    });

    expect(ok).toBe(false);
    expect(requestLeave).toHaveBeenCalledTimes(1);
    expect(setDoc).not.toHaveBeenCalled();
    expect(docHost.remember).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('决策器放行 → 正常切换', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => {
      throw new Error('native confirm() 被调用');
    });
    const { result, setDoc } = setup({
      controller: { dirty: true },
      requestLeave: allowLeave(),
    });
    const next = { ...baseDoc, name: 'b.mm.md' };

    await act(async () => {
      await result.current.applyDoc(next);
    });

    expect(setDoc).toHaveBeenCalledWith(next);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('未注入决策器（独立用法）→ 直接替换（不静默加锁）', async () => {
    const { result, setDoc } = setup({ controller: { dirty: true } });
    const next = { ...baseDoc, name: 'b.mm.md' };

    await act(async () => {
      await expect(result.current.applyDoc(next)).resolves.toBe(true);
    });

    expect(setDoc).toHaveBeenCalledWith(next);
  });
});

describe('useDocumentActions · handleSave', () => {
  it('保存前取消 pending 的自动保存定时器', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { result, autoSaveTimer } = setup();
    autoSaveTimer.current = setTimeout(() => {}, 10_000);

    await act(async () => {
      await result.current.handleSave();
    });

    expect(clearSpy).toHaveBeenCalled();
    expect(autoSaveTimer.current).toBeNull();
  });

  it('保存成功 → 写入 source/saved/ts 并 markSaved + remember', async () => {
    const { result, controller, docHost, setDoc } = setup({
      controller: { serialize: () => 'NEW-SRC' },
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(docHost.save).toHaveBeenCalledWith(expect.objectContaining({ source: 'NEW-SRC' }));
    expect(controller.markSaved).toHaveBeenCalled();
    expect(setDoc).toHaveBeenCalled();
    expect(docHost.remember).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'NEW-SRC', saved: true }),
    );
  });

  it('用户取消保存对话框 → 不动（不 markSaved、不 setDoc）', async () => {
    const { result, controller, setDoc, docHost } = setup({
      docHost: { save: vi.fn(async (): Promise<SaveOutcome> => ({ result: 'cancelled' })) },
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(controller.markSaved).not.toHaveBeenCalled();
    expect(setDoc).not.toHaveBeenCalled();
    expect(docHost.remember).not.toHaveBeenCalled();
  });
});

/**
 * FA1-T1：句柄闭环 —— 首次保存拿到 handle 后必须写回 doc。
 * 这是「第二次 Ctrl+S 不再弹系统覆盖确认」的唯一前提：
 * doc.handle 一直是 undefined 的话，每次都会重新唤起 showSaveFilePicker。
 */
describe('useDocumentActions · 句柄闭环（FA1-T1）', () => {
  it('保存返回的 handle 写回 doc（后续保存静默落盘的前提）', async () => {
    const handle = { name: 'a.mm.md' } as FsFileHandle;
    const { result, setDoc } = setup({ docHost: { save: vi.fn(async () => fsOk(handle)) } });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(applied(setDoc, baseDoc)).toContainEqual(
      expect.objectContaining({ handle, saved: true }),
    );
  });

  it('无 handle 的保存结果（下载兜底）→ 不把已有 handle 抹成 undefined', async () => {
    const existing = { name: 'a.mm.md' } as FsFileHandle;
    const prev = { ...baseDoc, handle: existing };
    const { result, setDoc } = setup({
      doc: { handle: existing },
      docHost: { save: vi.fn(async () => fsOk()) },
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(applied(setDoc, prev)).toContainEqual(expect.objectContaining({ handle: existing }));
  });

  it('另存为 → 用新路径的 handle 覆盖旧的', async () => {
    const fresh = { name: 'b.mm.md' } as FsFileHandle;
    const { result, setDoc } = setup({ docHost: { save: vi.fn(async () => fsOk(fresh)) } });

    await act(async () => {
      await result.current.handleSaveAs();
    });

    expect(applied(setDoc, baseDoc)).toContainEqual(
      expect.objectContaining({ handle: fresh, saved: true }),
    );
  });

  it('切换文档后异步补挂句柄（restoreHandle 回填 setDoc）', async () => {
    const stored = { name: 'a.mm.md' } as FsFileHandle;
    const { result, setDoc } = setup({
      docHost: { restoreHandle: vi.fn(async (d: MindDoc) => ({ ...d, handle: stored })) },
    });

    await act(async () => {
      await result.current.applyDoc({ ...baseDoc });
    });

    expect(applied(setDoc, baseDoc)).toContainEqual(expect.objectContaining({ handle: stored }));
  });

  it('宿主不提供 restoreHandle（可选能力）→ 切换不报错', async () => {
    const { result, setDoc } = setup({
      docHost: { restoreHandle: undefined } as unknown as Partial<DocumentHost>,
    });

    await act(async () => {
      await expect(result.current.applyDoc({ ...baseDoc })).resolves.toBe(true);
    });
    expect(setDoc).toHaveBeenCalled();
  });
});

describe('useDocumentActions · handleNew / handleOpen', () => {
  it('handleNew 以内置模板创建文档', async () => {
    const { result, docHost } = setup();

    await act(async () => {
      result.current.handleNew();
    });

    expect(docHost.create).toHaveBeenCalledWith('未命名.mm.md', '# 未命名\n');
    expect(docHost.remember).toHaveBeenCalled();
  });

  it('handleOpen 打开成功 → 走 applyDoc 切换', async () => {
    // 实现契约（打开健壮性）：FS Access 可用才走 docHost.open；不可用直接 file input 兜底
    vi.stubGlobal('showOpenFilePicker', vi.fn());
    const opened = { ...baseDoc, name: 'opened.mm.md' };
    const { result, docHost, setDoc } = setup({
      docHost: { open: vi.fn(async () => opened) },
    });

    await act(async () => {
      await result.current.handleOpen();
    });

    expect(setDoc).toHaveBeenCalledWith(opened);
    expect(docHost.remember).toHaveBeenCalledWith(opened);
  });

  it('handleOpen 用户取消（open 返回 null）→ 不再弹 file input（避免取消后二次打扰）', async () => {
    vi.stubGlobal('showOpenFilePicker', vi.fn());
    const click = vi.fn();
    const { result, fileInputRef } = setup(); // 默认 open → null
    fileInputRef.current = { click } as unknown as HTMLInputElement;

    await act(async () => {
      await result.current.handleOpen();
    });

    expect(click).not.toHaveBeenCalled();
  });

  it('handleOpen FS 抛错（嵌入预览窗/权限被拒）→ 兜底点击隐藏 file input', async () => {
    vi.stubGlobal('showOpenFilePicker', vi.fn());
    const click = vi.fn();
    const { result, fileInputRef } = setup({
      docHost: {
        open: vi.fn(async () => {
          throw new Error('fs-denied');
        }),
      },
    });
    fileInputRef.current = { click } as unknown as HTMLInputElement;

    await act(async () => {
      await result.current.handleOpen();
    });

    expect(click).toHaveBeenCalled();
  });

  it('handleOpen 打开失败且浏览器无 FS API → 兜底点击隐藏 file input', async () => {
    const click = vi.fn();
    const { result, fileInputRef } = setup({
      docHost: { open: vi.fn(async () => null) },
    });
    fileInputRef.current = { click } as unknown as HTMLInputElement;

    await act(async () => {
      await result.current.handleOpen();
    });

    // jsdom 没有 showOpenFilePicker → 应走兜底
    expect(click).toHaveBeenCalled();
  });
});

describe('useDocumentActions · handleSaveAs', () => {
  it('另存为时清掉 handle（触发重新选择位置）', async () => {
    const { result, docHost } = setup();

    await act(async () => {
      await result.current.handleSaveAs();
    });

    expect(docHost.save).toHaveBeenCalledWith(expect.objectContaining({ handle: undefined }));
  });
});

/**
 * E 批（编辑流保全）：保存写回口径 —— `source` 冻结为「打开/新建时的解析输入」，
 * 成功保存的内容快照写入 `savedSource`。若实现回退改写 `source`，本组转红。
 */
describe('useDocumentActions · 保存写回口径（E 批：source 冻结）', () => {
  it('handleSave：写回 savedSource、source 保持打开时内容不变', async () => {
    const { result, setDoc, docHost } = setup({ controller: { serialize: () => 'NEW-SRC' } });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(applied(setDoc, baseDoc)).toContainEqual(
      expect.objectContaining({ savedSource: 'NEW-SRC', source: 'X', saved: true }),
    );
    // 回归钉：remember 契约 = 「传入即内容」——快照仍应是新内容
    expect(docHost.remember).toHaveBeenCalledWith(expect.objectContaining({ source: 'NEW-SRC' }));
  });

  it('handleSaveAs：同口径（写回 savedSource、source 不动）', async () => {
    const fresh = { name: 'b.mm.md' } as FsFileHandle;
    const { result, setDoc } = setup({
      controller: { serialize: () => 'NEW-SRC' },
      docHost: { save: vi.fn(async () => fsOk(fresh)) },
    });

    await act(async () => {
      await result.current.handleSaveAs();
    });

    expect(applied(setDoc, baseDoc)).toContainEqual(
      expect.objectContaining({ savedSource: 'NEW-SRC', source: 'X' }),
    );
  });
});

/**
 * MODE-GUARD：UnsavedPrompt 由两按钮**升级**为三选项（保存并继续 / 放弃修改 / 取消）。
 * 键盘纪律：默认焦点在非破坏性选项；Enter 只激活聚焦按钮；Esc / 遮罩 = 取消。
 */
describe('UnsavedPrompt · 三选项模态（MODE-GUARD）', () => {
  it('open=false → 不渲染任何内容', () => {
    const onChoice = vi.fn();
    const { container } = render(<UnsavedPrompt open={false} onChoice={onChoice} />);
    expect(container.querySelector('[data-unsaved-prompt]')).toBeNull();
  });

  it('三选项各自 dispatch save / discard / cancel', () => {
    const onChoice = vi.fn();
    const { container } = render(<UnsavedPrompt open onChoice={onChoice} />);

    fireEvent.click(container.querySelector('[data-unsaved-save]') as HTMLElement);
    expect(onChoice).toHaveBeenLastCalledWith('save');
    fireEvent.click(container.querySelector('[data-unsaved-discard]') as HTMLElement);
    expect(onChoice).toHaveBeenLastCalledWith('discard');
    fireEvent.click(container.querySelector('[data-unsaved-cancel]') as HTMLElement);
    expect(onChoice).toHaveBeenLastCalledWith('cancel');
  });

  it('遮罩按下 / Esc → 取消（保守：绝不误当作确认或放弃）', () => {
    const onChoice = vi.fn();
    const { container } = render(<UnsavedPrompt open onChoice={onChoice} />);
    fireEvent.pointerDown(container.querySelector('[data-unsaved-backdrop]') as HTMLElement);
    expect(onChoice).toHaveBeenLastCalledWith('cancel');

    onChoice.mockClear();
    const card = container.querySelector('[data-unsaved-prompt]') as HTMLElement;
    fireEvent.keyDown(card, { key: 'Escape' });
    expect(onChoice).toHaveBeenCalledWith('cancel');
  });

  it('默认焦点在非破坏性选项；Enter 只激活聚焦按钮；Tab 在模态内循环', () => {
    const onChoice = vi.fn();
    const { container } = render(<UnsavedPrompt open onChoice={onChoice} />);
    const card = container.querySelector('[data-unsaved-prompt]') as HTMLElement;
    const save = container.querySelector('[data-unsaved-save]') as HTMLElement;

    expect(document.activeElement).toBe(save); // 默认聚焦「保存并继续」（非破坏性）

    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onChoice).toHaveBeenCalledWith('save');

    onChoice.mockClear();
    fireEvent.keyDown(card, { key: 'Tab' }); // save → 循环到 cancel
    expect(document.activeElement).toBe(container.querySelector('[data-unsaved-cancel]'));
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onChoice).toHaveBeenCalledWith('cancel');
  });

  it('busy → 显示进行中文案但**不制造死按钮**；取消仍可操作；notice 可见', () => {
    const onChoice = vi.fn();
    const { container } = render(
      <UnsavedPrompt open busy notice="已发起下载，但下载不证明文件已落盘" onChoice={onChoice} />,
    );
    const save = container.querySelector('[data-unsaved-save]') as HTMLButtonElement;

    expect(save.getAttribute('aria-busy')).toBe('true');
    expect(save.textContent).toContain('正在保存');
    expect(save.disabled).toBe(false); // 等待收束由决策器处理，按钮保持可点
    fireEvent.click(save);
    expect(onChoice).toHaveBeenCalledWith('save');
    expect(container.querySelector('[data-unsaved-notice]')?.textContent).toContain('已发起下载');

    fireEvent.click(container.querySelector('[data-unsaved-cancel]') as HTMLElement);
    expect(onChoice).toHaveBeenCalledWith('cancel');
  });

  it('层级高于自由画布工具栏（200）与 App 浮标（500），背景不可穿透', () => {
    const { container } = render(<UnsavedPrompt open onChoice={vi.fn()} />);
    const backdrop = container.querySelector('[data-unsaved-backdrop]') as HTMLElement;
    expect(Number(backdrop.style.zIndex)).toBeGreaterThan(500);
    // 卡片内的 pointerdown 不冒泡到遮罩（不会「点卡片 = 取消」）
    const onChoice = vi.fn();
    cleanup();
    const second = render(<UnsavedPrompt open onChoice={onChoice} />);
    fireEvent.pointerDown(
      second.container.querySelector('[data-unsaved-prompt]') as HTMLElement,
    );
    expect(onChoice).not.toHaveBeenCalled();
  });

  it('关闭后焦点恢复到打开前的元素', () => {
    const { container, rerender } = render(
      <div>
        <button type="button" data-outside>
          外部
        </button>
        <UnsavedPrompt open={false} onChoice={vi.fn()} />
      </div>,
    );
    const outside = container.querySelector('[data-outside]') as HTMLButtonElement;
    outside.focus();
    expect(document.activeElement).toBe(outside);

    rerender(
      <div>
        <button type="button" data-outside>
          外部
        </button>
        <UnsavedPrompt open onChoice={vi.fn()} />
      </div>,
    );
    rerender(
      <div>
        <button type="button" data-outside>
          外部
        </button>
        <UnsavedPrompt open={false} onChoice={vi.fn()} />
      </div>,
    );
    expect(document.activeElement).toBe(outside);
  });
});

/**
 * S2G：保存侧同步守卫 —— `handleSave` 不同步拒写并通知；`handleSaveAs` 放行（逃生口）。
 * 守卫未实现（或判据被中性化）时：写盘照发 / 通知未发 → 本组转红。
 */
describe('useDocumentActions · S2G 同步守卫', () => {
  it('handleSave 不同步 → 拒写 + 通知；savedSource/markSaved/remember 均不动', async () => {
    const { result, controller, docHost, setDoc, onBlockedSave } = setup({
      synced: 'OTHER',
      controller: { serialize: () => 'NEW-SRC' },
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(docHost.save).not.toHaveBeenCalled();
    expect(controller.markSaved).not.toHaveBeenCalled();
    expect(setDoc).not.toHaveBeenCalled();
    expect(docHost.remember).not.toHaveBeenCalled();
    expect(onBlockedSave).toHaveBeenCalledTimes(1);
    expect(onBlockedSave).toHaveBeenCalledWith(SAVE_BLOCKED_NOTICE);
  });

  it('handleSave 同步（ref = doc.source）→ 照常写盘、零通知（现行为钉）', async () => {
    const { result, docHost, onBlockedSave } = setup();

    await act(async () => {
      await result.current.handleSave();
    });

    expect(docHost.save).toHaveBeenCalledTimes(1);
    expect(onBlockedSave).not.toHaveBeenCalled();
  });

  it('handleSaveAs 在「不同步」下放行（逃生口：把改动救到新文件）', async () => {
    const fresh = { name: 'b.mm.md' } as FsFileHandle;
    const { result, docHost, onBlockedSave } = setup({
      synced: 'OTHER',
      docHost: { save: vi.fn(async () => fsOk(fresh)) },
    });

    await act(async () => {
      await result.current.handleSaveAs();
    });

    expect(docHost.save).toHaveBeenCalledWith(expect.objectContaining({ handle: undefined }));
    expect(onBlockedSave).not.toHaveBeenCalled();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ok) => {
    resolve = ok;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * SAVE-LIFECYCLE：手动保存 / 另存为的结果可判别与写入协调。
 *
 * 判别核心：
 * - 结果区分 `saved` / `downloaded` / `cancelled` / `blocked` / `stale`；
 * - 写入期间继续编辑 → `{ saved, current:false }`：savedSource 记实际写出快照，但**不清脏**；
 * - 显式文档替换（applyDoc）推进会话令牌 → 未开始的请求 stale、进行中的完成零回填；
 * - 文件选择器尊重手势：会话忙时不排队（blocked + 提示），避免丢 transient activation。
 */
describe('useDocumentActions · SAVE-LIFECYCLE 结果与协调', () => {
  it('同步保存成功 → { kind:saved, current:true }', async () => {
    const { result } = setup({ doc: { id: 'a.mm.md' } });
    let completion: SaveCompletion | null = null;

    await act(async () => {
      completion = await result.current.handleSave();
    });

    expect(completion).toEqual({ kind: 'saved', current: true });
  });

  it('下载兜底 → { kind:downloaded }（与 saved 可判别）', async () => {
    const { result } = setup({
      doc: { id: 'a.mm.md' },
      docHost: { save: vi.fn(async () => ({ result: 'download' as const })) },
    });
    let completion: SaveCompletion | null = null;

    await act(async () => {
      completion = await result.current.handleSave();
    });

    expect(completion).toEqual({ kind: 'downloaded', current: true });
  });

  it('手动保存成功 → 会话目的地同步为新句柄（不等重渲）', async () => {
    const fresh = { name: 'b.mm.md' } as FsFileHandle;
    const { result, session } = setup({
      doc: { id: 'a.mm.md' },
      docHost: { save: vi.fn(async () => fsOk(fresh)) },
    });

    await act(async () => {
      await result.current.handleSave();
    });
    expect(session.getDestination()).toBe(fresh);
  });

  it('附属记录失败（remember 抛错）→ 结果仍 saved，写盘照常回填，只发附属警告（复核 R4-B）', async () => {
    const { result, controller, setDoc, doc, onBlockedSave, onSaveWarning } = setup({
      doc: { id: 'a.mm.md' },
      docHost: {
        save: vi.fn(async () => fsOk()),
        remember: vi.fn((): void => {
          throw new Error('recent-document-metadata-failed');
        }),
      },
    });
    let completion: SaveCompletion | null = null;

    await act(async () => {
      completion = await result.current.handleSave();
    });

    // 写盘成功 → 不得降级为 failed（否则与已清 dirty、提示文案三者矛盾）
    expect(completion).toEqual({ kind: 'saved', current: true });
    expect(controller.markSaved).toHaveBeenCalledTimes(1);
    expect(applied(setDoc, doc)).toContainEqual(
      expect.objectContaining({ savedSource: 'SRC', saved: true }),
    );
    expect(onBlockedSave).not.toHaveBeenCalled();
    expect(onSaveWarning).toHaveBeenCalledWith(SAVE_METADATA_WARNING);
  });

  it('手动保存写入失败 → { kind:failed } + 失败通知；不 markSaved / 不 setDoc（复核 R3）', async () => {
    const { result, controller, docHost, setDoc, onBlockedSave } = setup({
      doc: { id: 'a.mm.md' },
      docHost: {
        save: vi.fn(async () => {
          throw new Error('disk-full');
        }),
      },
    });
    let completion: SaveCompletion | null = null;

    await act(async () => {
      completion = await result.current.handleSave();
    });

    expect(completion).toEqual({ kind: 'failed' });
    expect(controller.markSaved).not.toHaveBeenCalled();
    expect(setDoc).not.toHaveBeenCalled();
    expect(docHost.remember).not.toHaveBeenCalled();
    expect(onBlockedSave).toHaveBeenCalledWith(SAVE_FAILED_NOTICE);
  });

  it('另存为失败 → { kind:failed } + 失败通知，目的地不变（取消/失败不换目标）', async () => {
    const { result, session, setDoc, onBlockedSave } = setup({
      doc: { id: 'a.mm.md' },
      docHost: {
        save: vi.fn(async () => {
          throw new Error('picker-failed');
        }),
      },
    });
    const before = session.getDestination();
    let completion: SaveCompletion | null = null;

    await act(async () => {
      completion = await result.current.handleSaveAs();
    });

    expect(completion).toEqual({ kind: 'failed' });
    expect(session.getDestination()).toBe(before);
    expect(setDoc).not.toHaveBeenCalled();
    expect(onBlockedSave).toHaveBeenCalledWith(SAVE_FAILED_NOTICE);
  });

  it('写入期间继续编辑 → { saved, current:false }：记快照但不 markSaved', async () => {
    const gate = deferred<{ result: 'fs' }>();
    const { result, setDoc, doc, controller } = setup({
      controller: { serialize: () => 'SNAP-A', dirty: true, root: makeTextNode('内容 A') },
      doc: { id: 'a.mm.md' },
      docHost: { save: vi.fn(() => gate.promise) },
    });
    let completion: SaveCompletion | null = null;

    await act(async () => {
      const pending = result.current.handleSave();
      // 写入等待期间内容身份变化（继续编辑）
      (controller as unknown as { root: unknown }).root = makeTextNode('内容 B');
      gate.resolve({ result: 'fs' });
      completion = await pending;
    });

    expect(completion).toEqual({ kind: 'saved', current: false });
    expect(controller.markSaved).not.toHaveBeenCalled();
    // 磁盘上确实是 SNAP-A：快照照记（保持 dirty 由会话负责），但不得清脏
    expect(applied(setDoc, doc)).toContainEqual(expect.objectContaining({ savedSource: 'SNAP-A' }));
  });

  it('另存为写入期间继续编辑 → { saved, current:false }：新文件里是旧快照，保持 dirty', async () => {
    const gate = deferred<{ result: 'fs'; handle?: FsFileHandle }>();
    const { result, setDoc, doc, controller } = setup({
      controller: { serialize: () => 'SNAP-A', dirty: true, root: makeTextNode('内容 A') },
      doc: { id: 'a.mm.md' },
      docHost: { save: vi.fn(() => gate.promise) },
    });
    let completion: SaveCompletion | null = null;

    await act(async () => {
      const pending = result.current.handleSaveAs();
      // 写入等待期间继续编辑
      (controller as unknown as { root: unknown }).root = makeTextNode('内容 B');
      gate.resolve({ result: 'fs', handle: { name: 'new.mm.md' } as FsFileHandle });
      completion = await pending;
    });

    expect(completion).toEqual({ kind: 'saved', current: false });
    expect(controller.markSaved).not.toHaveBeenCalled();
    expect(applied(setDoc, doc)).toContainEqual(expect.objectContaining({ savedSource: 'SNAP-A' }));
  });

  it('applyDoc 推进会话：未开始的手动保存 stale、进行中的完成零回填', async () => {
    const gate = deferred<{ result: 'fs' }>();
    const save = vi.fn(() => gate.promise);
    const { result, docHost, setDoc } = setup({ doc: { id: 'a.mm.md' }, docHost: { save } });
    let first: SaveCompletion | null = null;
    let second: SaveCompletion | null = null;

    await act(async () => {
      void result.current.handleSave().then((c) => {
        first = c;
      });
      void result.current.handleSave().then((c) => {
        second = c;
      });
      // 显式文档替换：会话令牌推进（第二个请求尚未开始 → 直接 stale）
      await result.current.applyDoc({ ...baseDoc, id: 'b.mm.md', source: 'Y' });
      gate.resolve({ result: 'fs' });
      await flush();
    });

    expect(second).toEqual({ kind: 'stale' });
    expect(first).toEqual({ kind: 'stale' });
    expect(docHost.save).toHaveBeenCalledTimes(1);
    // 只有 applyDoc 的切换写回；旧会话的 savedSource 不得回填
    expect(applied(setDoc, baseDoc)).toContainEqual(expect.objectContaining({ source: 'Y' }));
    expect(applied(setDoc, baseDoc)).not.toContainEqual(
      expect.objectContaining({ savedSource: expect.anything() }),
    );
  });

  it('会话忙 + 无句柄 → 拒绝启动（不写盘、不排队、提示稍后重试）', async () => {
    const gate = deferred<{ result: 'fs' }>();
    const save = vi.fn(() => gate.promise);
    const { result, docHost, onBlockedSave } = setup({
      doc: { id: 'a.mm.md', handle: undefined },
      docHost: { save },
    });
    let second: SaveCompletion | null = null;

    await act(async () => {
      void result.current.handleSave(); // 第一发：无句柄但会话空闲 → 进入写入（挂起）
      second = await result.current.handleSave(); // 第二发：忙 + 无句柄 → 不得排队
    });

    expect(second).toEqual({ kind: 'blocked' });
    expect(save).toHaveBeenCalledTimes(1);
    expect(onBlockedSave).toHaveBeenCalledWith(SAVE_BUSY_NOTICE);

    await act(async () => {
      gate.resolve({ result: 'fs' });
      await flush();
    });
    expect(docHost.remember).toHaveBeenCalled();
  });

  it('会话忙 + 另存为 → 拒绝启动选择器（不调用 save、提示稍后重试）', async () => {
    const gate = deferred<{ result: 'fs' }>();
    const save = vi.fn(() => gate.promise);
    const { result, onBlockedSave } = setup({ doc: { id: 'a.mm.md' }, docHost: { save } });
    let saveAs: SaveCompletion | null = null;

    await act(async () => {
      void result.current.handleSave(); // 占住会话（挂起）
      saveAs = await result.current.handleSaveAs();
    });

    expect(saveAs).toEqual({ kind: 'blocked' });
    expect(save).toHaveBeenCalledTimes(1);
    expect(onBlockedSave).toHaveBeenCalledWith(SAVE_BUSY_NOTICE);

    await act(async () => {
      gate.resolve({ result: 'fs' });
      await flush();
    });
  });
});
