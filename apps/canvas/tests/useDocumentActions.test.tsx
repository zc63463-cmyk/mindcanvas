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
import type { RefObject } from 'react';
import type { DocumentHost, EditorController, FsFileHandle, MindDoc } from '@mindcanvas/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDocumentActions } from '../src/hooks/useDocumentActions';
import { SAVE_BLOCKED_NOTICE } from '../src/hooks/saveGuard';
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

const baseDoc: MindDoc = { name: 'a.mm.md', source: 'X', saved: true, handle: {} };

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
  /** A-D4：未保存切换确认的注入式问询器（替代 window.confirm） */
  confirmDiscard?: () => Promise<boolean>;
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
  // S2G：mock 增 `syncedSourceRef`（缺省同源 = 现行为，同 S2F 先例）
  const syncedSourceRef: RefObject<string | null> = {
    current: over.synced === undefined ? doc.source : over.synced,
  };
  const { result } = renderHook(() =>
    useDocumentActions({
      controller,
      docHost,
      doc,
      setDoc,
      fileInputRef,
      autoSaveTimer,
      syncedSourceRef,
      onBlockedSave,
      confirmDiscard: over.confirmDiscard,
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
    syncedSourceRef,
    onBlockedSave,
  };
}

afterEach(() => {
  cleanup(); // 组件级渲染（UnsavedPrompt 用例）随用例卸载
  vi.restoreAllMocks();
  vi.unstubAllGlobals(); // handleOpen 用例注入的 window.showOpenFilePicker 随用例回收
});

describe('useDocumentActions · applyDoc', () => {
  it('无未保存修改时直接切换并记住文档', async () => {
    const { result, docHost, setDoc } = setup({ controller: { dirty: false } });
    const next = { ...baseDoc, name: 'b.mm.md' };

    await act(async () => {
      await result.current.applyDoc(next);
    });

    expect(setDoc).toHaveBeenCalledWith(next);
    expect(docHost.remember).toHaveBeenCalledWith(next);
  });

  // A-D4：未保存确认改注入式确认器（confirmDiscard）——window.confirm 在 webview 会被静默吞掉。
  // 每例都把 window.confirm 换成会抛错的 spy：实现只要回退到原生对话框即失败。
  it('dirty + 确认器返回 false → 不切换、不记住、不触碰 window.confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => {
      throw new Error('native confirm() 被调用');
    });
    const confirmDiscard = vi.fn(async () => false);
    const { result, docHost, setDoc } = setup({ controller: { dirty: true }, confirmDiscard });

    await act(async () => {
      await result.current.applyDoc({ ...baseDoc, name: 'b.mm.md' });
    });

    expect(confirmDiscard).toHaveBeenCalledTimes(1);
    expect(setDoc).not.toHaveBeenCalled();
    expect(docHost.remember).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('dirty + 确认器返回 true → 正常切换', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => {
      throw new Error('native confirm() 被调用');
    });
    const confirmDiscard = vi.fn(async () => true);
    const { result, setDoc } = setup({ controller: { dirty: true }, confirmDiscard });
    const next = { ...baseDoc, name: 'b.mm.md' };

    await act(async () => {
      await result.current.applyDoc(next);
    });

    expect(confirmDiscard).toHaveBeenCalledTimes(1);
    expect(setDoc).toHaveBeenCalledWith(next);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('dirty 且未注入确认器 → 保守返回 false（绝不静默丢数据）', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => {
      throw new Error('native confirm() 被调用');
    });
    const { result, setDoc } = setup({ controller: { dirty: true } });

    await act(async () => {
      await expect(result.current.applyDoc({ ...baseDoc, name: 'b.mm.md' })).resolves.toBe(false);
    });

    expect(setDoc).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('不 dirty → 不调用确认器，直接切换', async () => {
    const confirmDiscard = vi.fn(async () => true);
    const { result, setDoc } = setup({ controller: { dirty: false }, confirmDiscard });
    const next = { ...baseDoc, name: 'b.mm.md' };

    await act(async () => {
      await result.current.applyDoc(next);
    });

    expect(confirmDiscard).not.toHaveBeenCalled();
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
      docHost: { save: vi.fn(async () => ({ result: 'cancelled' })) },
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
 * A-D4：UnsavedPrompt 是「未保存切换确认」的载体（替代 window.confirm）。
 * 两按钮语义（决策 A1）：放弃修改并切换 / 取消；键盘语义与 LenBubble 一致（Enter 确认 / Esc 取消）。
 */
describe('UnsavedPrompt · 两按钮模态（A-D4）', () => {
  it('open=false → 不渲染任何内容', () => {
    const onSettle = vi.fn();
    const { container } = render(<UnsavedPrompt open={false} onSettle={onSettle} />);
    expect(container.querySelector('[data-unsaved-prompt]')).toBeNull();
  });

  it('点「放弃修改并切换」→ settle(true)', () => {
    const onSettle = vi.fn();
    const { container } = render(<UnsavedPrompt open onSettle={onSettle} />);
    fireEvent.click(container.querySelector('[data-unsaved-ok]')!);
    expect(onSettle).toHaveBeenCalledWith(true);
  });

  it('点「取消」→ settle(false)', () => {
    const onSettle = vi.fn();
    const { container } = render(<UnsavedPrompt open onSettle={onSettle} />);
    fireEvent.click(container.querySelector('[data-unsaved-cancel]')!);
    expect(onSettle).toHaveBeenCalledWith(false);
  });

  it('Enter = 确认 / Esc = 取消', () => {
    const onSettle = vi.fn();
    const { container } = render(<UnsavedPrompt open onSettle={onSettle} />);
    const card = container.querySelector('[data-unsaved-prompt]')!;
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onSettle).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(card, { key: 'Escape' });
    expect(onSettle).toHaveBeenLastCalledWith(false);
  });

  it('点背板（模态之外）→ settle(false)（保守：绝不误当作确认）', () => {
    const onSettle = vi.fn();
    const { container } = render(<UnsavedPrompt open onSettle={onSettle} />);
    fireEvent.pointerDown(container.querySelector('[data-unsaved-backdrop]')!);
    expect(onSettle).toHaveBeenCalledWith(false);
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
