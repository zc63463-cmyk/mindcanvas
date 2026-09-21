/**
 * 文档操作 hook —— 打开 / 新建 / 保存 / 另存为 / 切换（含未保存守卫）。
 *
 * 从 `MindmapStage.tsx` 的 `StageContent`（原 1,394 行单函数）中抽出，
 * 属代码结构规范化 T1 的一部分。**纯搬迁，逻辑未改写**。
 *
 * 不是什么：不含自动保存（那是 `StageContent` 内的 effect，依赖 dirty/saved/handle 联动）；
 * 不含导出（见 `useExportActions`）。
 *
 * S2G 守卫：`handleSave` 任务开头查同步标记（`canWriteDoc`），不同步拒写并通知（每次）；
 * `handleSaveAs` **不拦**（逃生口：把改动救到新文件）。
 */
import { useCallback } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { DocumentHost, EditorController, FsFileHandle, MindDoc } from '@mindcanvas/react';
import { getFileHandle, setFileHandle, verifyPermission } from '@mindcanvas/react';
import { canWriteDoc, SAVE_BLOCKED_NOTICE } from './saveGuard.js';

export interface DocumentActionsOptions {
  controller: EditorController;
  docHost: DocumentHost;
  doc: MindDoc;
  setDoc: Dispatch<SetStateAction<MindDoc>>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  /** 自动保存 debounce 定时器；手动保存需先取消 pending */
  autoSaveTimer: RefObject<ReturnType<typeof setTimeout> | null>;
  /** S2G：同步标记（读点②：handleSave 任务开头判定；三写点见 useDocumentSwitch / MindmapStage） */
  syncedSourceRef: RefObject<string | null>;
  /** S2G：守卫拦截通知（每次）；可选，缺省不通知 */
  onBlockedSave?: (msg: string) => void;
  /** 落盘瞬态通知（FA1-T1：驱动顶部「保存中…」指示）；可选，缺省不通知 */
  onSavingChange?: (saving: boolean) => void;
  /**
   * A-D4：未保存修改时的切换确认（宿主提供自定义模态；resolve true = 放弃修改并切换）。
   * 缺省 undefined → **保守策略：视为 false（不切换）**，绝不静默丢数据。
   * 替代 window.confirm —— 它在 IDE webview 中会被静默吞掉（false/undefined 且无 UI）。
   */
  confirmDiscard?: () => Promise<boolean>;
}

export interface DocumentActions {
  /**
   * 切换文档；有未保存修改时弹确认，用户取消则不动。
   *
   * @returns 是否真的切换了。调用方据此决定是否收起自己的浮层/启动页 ——
   *          否则用户在确认框点「取消」后界面已关闭、文档却没换，观感像卡住。
   */
  applyDoc: (next: MindDoc) => Promise<boolean>;
  handleOpen: () => Promise<void>;
  handleNew: () => void;
  handleSave: () => Promise<void>;
  handleSaveAs: () => Promise<void>;
}

export function useDocumentActions({
  controller,
  docHost,
  doc,
  setDoc,
  fileInputRef,
  autoSaveTimer,
  syncedSourceRef,
  onBlockedSave,
  onSavingChange,
  confirmDiscard,
}: DocumentActionsOptions): DocumentActions {
  /** 落盘瞬态：手动保存也走它，避免「自动保存有指示、Ctrl+S 没有」的割裂 */
  const runSave = useCallback(
    async (job: () => Promise<void>): Promise<void> => {
      onSavingChange?.(true);
      try {
        await job();
      } finally {
        onSavingChange?.(false);
      }
    },
    [onSavingChange],
  );

  /**
   * 句柄落 IndexedDB（FA1-T2）。save 成功 / open 成功都会调用；
   * 失败静默 —— 持久化是增强，不是保存主流程的前置条件。
   */
  const persistHandle = useCallback((docId: string, handle: FsFileHandle | undefined): void => {
    if (handle) void setFileHandle(docId, handle);
  }, []);

  const applyDoc = useCallback(
    async (next: MindDoc): Promise<boolean> => {
      // A-D4：未保存守卫走注入式确认器（宿主自定义模态）——不再触碰会被 webview 吞掉的 confirm。
      // 缺省保守 false：宿主未接线时宁可「不切换」，也绝不静默丢数据。
      if (controller.dirty && !((await confirmDiscard?.()) ?? false)) {
        return false;
      }
      setDoc(next);
      docHost.remember(next);
      // FA1-T2：从「最近文档」/文件库切来的文档没有 handle，异步补挂后回填。
      // 权限处于 prompt 时此处拿不到授权（无用户手势），留待下一次点「保存」时补请求。
      // restoreHandle 可选（宿主可不具备 IDB 能力）：缺失则跳过补挂，不阻断切换。
      void docHost.restoreHandle?.(next).then((withHandle) => {
        if (withHandle.handle) {
          setDoc((d) => (d.id === next.id ? { ...d, handle: withHandle.handle } : d));
        }
      });
      return true;
    },
    [controller, setDoc, docHost, confirmDiscard],
  );

  const handleOpen = useCallback(async (): Promise<void> => {
    if (typeof window.showOpenFilePicker === 'function') {
      try {
        const opened = await docHost.open();
        if (opened) {
          await applyDoc(opened);
          return;
        }
        return; // 用户取消 → 不动（不能再弹 file input，否则取消后反而又弹一次）
      } catch {
        // FS Access 抛错（嵌入预览窗不支持 / 权限被拒）→ 隐藏 file input 兜底
      }
    }
    fileInputRef.current?.click();
  }, [docHost, applyDoc, fileInputRef]);

  const handleNew = useCallback((): void => {
    void applyDoc(docHost.create('未命名.mm.md', '# 未命名\n'));
  }, [docHost, applyDoc]);

  const handleSave = useCallback(async (): Promise<void> => {
    await runSave(async () => {
      // S2G 读点②：写盘前同步不变量 —— 不同步拒写（通知每次：用户手势触发，无刷屏问题）
      if (!canWriteDoc(syncedSourceRef.current, doc.source)) {
        onBlockedSave?.(SAVE_BLOCKED_NOTICE);
        return;
      }
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = null;
      }
      const source = controller.serialize();
      // FA1-T2：无句柄时先尝试从 IndexedDB 取回并请求权限。
      // 这里**必须**在同一个异步流程里用返回值，不能 setDoc 后等下一次渲染 ——
      // 那会读到过期的 doc.handle，白跑一次权限请求。
      // requestPermission 需要 transient user activation，而点击「保存」正是手势。
      let effective = doc.handle;
      if (!effective) {
        const stored = await getFileHandle(doc.id);
        if (stored && (await verifyPermission(stored, true, true))) effective = stored;
      }
      const outcome = await docHost.save({ ...doc, source, handle: effective });
      if (outcome.result === 'cancelled') return;
      // 句柄写回（FA1-T1）：首次「另存为」拿到 handle 后记住它，
      // 后续 Ctrl+S 直接 createWritable() 静默覆盖，不再唤起系统对话框与覆盖确认。
      // 下载兜底没有句柄，保留原值（不把已有 handle 抹成 undefined）。
      const nextHandle = outcome.handle ?? effective;
      // E 批口径：保存路径不得改写 doc.source（解析输入）——内容快照写入 savedSource
      setDoc((d) => ({ ...d, savedSource: source, handle: nextHandle, saved: true, ts: Date.now() }));
      controller.markSaved();
      docHost.remember({ ...doc, source, handle: nextHandle, saved: true, ts: Date.now() });
      persistHandle(doc.id, nextHandle);
    });
  }, [runSave, autoSaveTimer, controller, docHost, doc, setDoc, persistHandle, syncedSourceRef, onBlockedSave]);

  const handleSaveAs = useCallback(async (): Promise<void> => {
    await runSave(async () => {
      const source = controller.serialize();
      // 显式丢弃 handle → 必然唤起选择器（另存到新路径）
      const outcome = await docHost.save({ ...doc, source, handle: undefined });
      if (outcome.result === 'cancelled') return;
      setDoc((d) => ({
        ...d,
        // E 批口径：保存路径不得改写 doc.source（解析输入）——内容快照写入 savedSource
        savedSource: source,
        handle: outcome.handle ?? d.handle,
        saved: true,
        ts: Date.now(),
      }));
      controller.markSaved();
      // 另存为会换文件：旧 id 的句柄记录要清掉，否则下次载入会指回旧文件
      if (outcome.handle) persistHandle(outcome.handle.name ?? doc.id, outcome.handle);
    });
  }, [runSave, controller, docHost, doc, setDoc, persistHandle]);

  return { applyDoc, handleOpen, handleNew, handleSave, handleSaveAs };
}
