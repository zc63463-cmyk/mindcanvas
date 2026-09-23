/**
 * 文档操作 hook —— 打开 / 新建 / 保存 / 另存为 / 切换（含未保存守卫）。
 *
 * 从 `MindmapStage.tsx` 的 `StageContent`（原 1,394 行单函数）中抽出，
 * 属代码结构规范化 T1 的一部分；SAVE-LIFECYCLE 批次接入保存会话（写入顺序与结果归属）。
 *
 * 不是什么：不含自动保存（见 `useAutoSave`）；不含导出（见 `useExportActions`）。
 *
 * MODE-GUARD（包 2）：`applyDoc` 不再自带确认框 —— 它把「真正替换」交给注入的
 * `requestLeave`（App 的三选项决策器：保存并继续 / 放弃修改 / 取消），
 * 打开/新建/最近/文件输入/拖入/工作区等入口因此共用一个离开判定。
 *
 * SAVE-LIFECYCLE：
 * - `applyDoc` 是**显式文档替换**入口 —— 先推进会话令牌再 `setDoc`，旧会话的迟到回调
 *   因此不会回填新文档（令牌推进不依赖延后的 passive effect）；
 * - `handleSave` / `handleSaveAs` 返回 `SaveCompletion`：只在会话+内容归属校验通过时清脏；
 *   `downloaded` 与 `saved` 可区分（下载兜底不代表持久化已确认）；`blocked` 覆盖
 *   同步守卫拒写与「写入忙」两种「本次未发起写入」的情形，均不改动任何状态；
 * - 文件选择器尊重用户手势：会话忙时**不排队等待**（那会丢失 transient activation），
 *   直接拒绝并提示稍后重试。
 *
 * S2G 守卫：`handleSave` 任务开头查同步标记（`canWriteDoc`），不同步拒写并通知（每次）；
 * `handleSaveAs` **不拦**（逃生口：把改动救到新文件）——救出的快照不证明原会话已同步。
 */
import { useCallback } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { DocumentHost, EditorController, FsFileHandle, MindDoc } from '@mindcanvas/react';
import { buildEditable, getFileHandle, setFileHandle, verifyPermission } from '@mindcanvas/react';
import {
  SAVE_BUSY_NOTICE,
  SAVE_FAILED_NOTICE,
  SAVE_METADATA_WARNING,
  SAVE_METADATA_WARNING_DOWNLOAD,
  type RequestLeave,
  type SaveCompletion,
} from '../documentLifecycle.js';
import type { DocumentSaveSession } from './useDocumentSaveSession.js';
import { canWriteDoc, SAVE_BLOCKED_NOTICE } from './saveGuard.js';

export interface DocumentActionsOptions {
  controller: EditorController;
  docHost: DocumentHost;
  doc: MindDoc;
  setDoc: Dispatch<SetStateAction<MindDoc>>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  /** 自动保存 debounce 定时器；手动保存需先取消 pending（不等于取消已开始的 I/O） */
  autoSaveTimer: RefObject<ReturnType<typeof setTimeout> | null>;
  /** 保存会话（同会话串行 / 会话+内容归属校验） */
  session: DocumentSaveSession;
  /** S2G：同步标记（读点②：handleSave 任务开头判定；三写点见 useDocumentSwitch / MindmapStage） */
  syncedSourceRef: RefObject<string | null>;
  /**
   * R2：文档会话令牌的推进口（`hooks/useDocumentToken.ts`）。
   *
   * 语义 = 「一棵树被整体换成了另一棵」。只在**显式文档替换**时调用；普通编辑、保存、
   * 另存为都不推进（保存只回填 `savedSource` / `handle` / `saved` / `ts`，不换文档身份）。
   */
  onDocumentReplaced?: () => void;
  /**
   * 保存未完成的通知渠道（同步守卫拦截 / 写入忙 / **写入失败**）；可选，缺省不通知。
   * 文案由 `documentLifecycle.ts` 的常量区分；取消与过期（stale）静默。
   */
  onBlockedSave?: (msg: string) => void;
  /**
   * 附属记录失败的通知渠道（写盘**已成功**，仅最近列表/句柄回填失败）；可选，缺省不通知。
   * 与 `onBlockedSave` 分开：前者说「没写成」，本项说「写成了，但附属记录没更新」
   * （复核 R4-B：结果、dirty、提示必须一致）。
   */
  onSaveWarning?: (msg: string) => void;
  /**
   * MODE-GUARD：离开决策器（App 注入的三选项确认 + 保存/放弃/取消）。
   *
   * 缺省 undefined → 不做离开保护，直接切换（独立用法/旧测试；生产由 App 注入）。
   * 传入时 `applyDoc` 的返回语义与决策器一致：true = 目标已执行。
   */
  requestLeave?: RequestLeave;
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
  handleSave: () => Promise<SaveCompletion>;
  handleSaveAs: () => Promise<SaveCompletion>;
}

export function useDocumentActions({
  controller,
  docHost,
  doc,
  setDoc,
  fileInputRef,
  autoSaveTimer,
  session,
  syncedSourceRef,
  onDocumentReplaced,
  onBlockedSave,
  onSaveWarning,
  requestLeave,
}: DocumentActionsOptions): DocumentActions {
  /**
   * 句柄落 IndexedDB（FA1-T2）。save 成功 / open 成功都会调用；
   * 失败静默 —— 持久化是增强，不是保存主流程的前置条件。
   */
  const persistHandle = useCallback((docId: string, handle: FsFileHandle | undefined): void => {
    if (handle) void setFileHandle(docId, handle);
  }, []);

  /** 写入忙：拒绝启动（选择器/权限请求需要用户手势，排队等待会丢激活） */
  const refuseBusy = useCallback((): SaveCompletion => {
    onBlockedSave?.(SAVE_BUSY_NOTICE);
    return { kind: 'blocked' };
  }, [onBlockedSave]);

  /** 真正执行文档替换（离开决策通过后调用） */
  const performApplyDoc = useCallback(
    (next: MindDoc): void => {
      // SAVE-LIFECYCLE：显式文档替换 → 推进会话令牌 + 同步换目的地（在旧回调观察到新文档
      // 之前完成）。已开始的 I/O 不撤回，但其完成回调不再回填；未开始的旧任务按 stale 结束。
      session.beginDocument(next.handle);
      // R2：**同一处**推进文档会话令牌 —— 这是「文档被整体替换」的**定义性入口**
      // （打开 / 新建 / 最近 / 文件库 / 工作区 / 拖入 全部经此处）。
      //
      // 为什么必须在这里、而不是只听 `doc.source` 变化：**同内容替换**（重开同一文件、
      // 另一份 source 逐字相同的文档）下 `doc.source` 不变，`useDocumentSwitch` 的
      // effect 不会重跑 —— 靠 source 判据就会把「换了文档」漏成「没换」，旧摘要草稿
      // 于是活到新文档上。本调用点在**替换动作发生时**（无论内容是否相同）推进。
      onDocumentReplaced?.();
      // ── S2G 零窗口（P0-FIX-R1 R1-3）────────────────────────────────────────
      //
      // 旧实现把「reset 树 + 置位 `syncedSourceRef`」留在 `useDocumentSwitch` 的
      // **被动 effect** 里，而 `setDoc(next)` 与那个 effect 之间隔着一次 React 提交：
      // 「打开文档 → 立刻编辑 → Ctrl+S」存在 effect 尚未提交的窗口，整次保存被
      // `saveGuard.canWriteDoc` 拒绝（真实浏览器 5 次跑 4 次命中）。
      //
      // 这里把「树属于新文档」做成与替换**同事务的同步事实**，窗口长度归零。
      //
      // **不能只把置位前移**：那时 `controller.root` 还是旧文档的树，守卫会放行一次
      // 「旧树写进新目的地」的错误保存。所以顺序必须是
      // **parse(next.source) → reset(新树) → 置位**，三者同步、无 await、无 effect 依赖。
      //
      // 解析失败（`editable === null`）时**不置位**：树没能换成新文档，守卫必须继续拦
      // （宁可拒写，也不让旧内容写进新文件）。视图侧（实体表 / 收起 / fit）仍由
      // `useDocumentSwitch` 的 effect 负责 —— 那部分是表现，不该在同步路径里做。
      const parsed = buildEditable(next.source);
      if (parsed.editable !== null) {
        controller.reset(parsed.editable);
        syncedSourceRef.current = next.source;
      } else {
        // 解析不出树 → 树与任何 source 都不同步；显式置 null 使守卫拒写（fail-closed）
        syncedSourceRef.current = null;
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
    },
    [controller, session, setDoc, docHost, onDocumentReplaced, syncedSourceRef],
  );

  const applyDoc = useCallback(
    async (next: MindDoc): Promise<boolean> => {
      // MODE-GUARD：文档替换与模式切换共用同一个离开决策器（三选项 + 保存/放弃/取消）。
      // 决策器内部会先 flush 未提交草稿，并在执行前重新核验 dirty/saving；
      // 未注入决策器（独立用法/旧测试）→ 直接替换（生产由 App 注入）。
      if (requestLeave === undefined) {
        performApplyDoc(next);
        return true;
      }
      return requestLeave(() => performApplyDoc(next));
    },
    [performApplyDoc, requestLeave],
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

  const handleSave = useCallback(async (): Promise<SaveCompletion> => {
    // 无目的地时本次保存需要唤起选择器/权限请求：会话忙则拒绝排队（手势会失效）。
    // 判据与写入一致（都读会话目的地）——不能出现「判定有句柄、写入却弹选择器」的错位。
    if (session.isSaving() && !session.getDestination()) return refuseBusy();
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
    const completion = await session.submit({
      intent: 'manual',
      // S2G 读点②：写盘前同步不变量 —— 不同步拒写（通知每次：用户手势触发，无刷屏问题）
      guard: () => canWriteDoc(syncedSourceRef.current, doc.source),
      capture: () => ({ source: controller.serialize(), content: controller.root }),
      write: async (snapshot) => {
        // 目的地读**会话**（同步事实源）：另存为/打开回填后，排队中的手动保存必须写新目的地，
        // 而不是提交时闭包里的旧 doc.handle（复核 R1 同族）。
        // FA1-T2：无句柄时先尝试从 IndexedDB 取回并请求权限。
        // 这里**必须**在同一个异步流程里用返回值，不能 setDoc 后等下一次渲染 ——
        // 那会读到过期的 handle，白跑一次权限请求。
        // requestPermission 需要 transient user activation，而点击「保存」正是手势。
        let effective = session.getDestination();
        if (!effective) {
          const stored = await getFileHandle(doc.id);
          if (stored && (await verifyPermission(stored, true, true))) effective = stored;
        }
        const outcome = await docHost.save({ ...doc, source: snapshot.source, handle: effective });
        // 句柄写回（FA1-T1）：首次「另存为」拿到 handle 后记住它，
        // 后续 Ctrl+S 直接 createWritable() 静默覆盖，不再唤起系统对话框与覆盖确认。
        // 下载兜底没有句柄，保留原值（不把已有 handle 抹成 undefined）。
        return { result: outcome.result, handle: outcome.handle ?? effective };
      },
      commit: (snapshot, outcome, current) => {
        const nextHandle = outcome.handle ?? doc.handle;
        // 目的地同步推进：本次实际写到哪，后续排队请求就写哪（复核 R1）
        session.setDestination(nextHandle);
        // E 批口径：保存路径不得改写 doc.source（解析输入）——内容快照写入 savedSource
        setDoc((d) => ({
          ...d,
          savedSource: snapshot.source,
          handle: nextHandle,
          saved: true,
          ts: Date.now(),
        }));
        // 写入期间继续编辑 → 磁盘上是旧快照：保持 dirty（后续自动保存写最新内容）
        if (current) controller.markSaved();
        // 附属记录（最近列表 / 句柄持久化）失败**不影响**写盘事实：结果仍是 saved，
        // 失败经 onSaveWarning 独立提示（复核 R4-B）
        let metadataFailed = false;
        try {
          docHost.remember({ ...doc, source: snapshot.source, handle: nextHandle, saved: true, ts: Date.now() });
        } catch {
          metadataFailed = true;
        }
        try {
          persistHandle(doc.id, nextHandle);
        } catch {
          metadataFailed = true;
        }
        // 下载分支不得声称「已写入文件」（第三轮复核口径）
        if (metadataFailed) {
          onSaveWarning?.(
            outcome.result === 'fs' ? SAVE_METADATA_WARNING : SAVE_METADATA_WARNING_DOWNLOAD,
          );
        }
      },
    });
    // 未完成时的可见反馈：守卫拦截 / 写入忙 / 写入失败三态分别有文案；取消与过期静默
    if (completion.kind === 'blocked') onBlockedSave?.(SAVE_BLOCKED_NOTICE);
    if (completion.kind === 'failed') onBlockedSave?.(SAVE_FAILED_NOTICE);
    return completion;
  }, [
    autoSaveTimer,
    controller,
    docHost,
    doc,
    setDoc,
    persistHandle,
    session,
    syncedSourceRef,
    refuseBusy,
    onBlockedSave,
    onSaveWarning,
  ]);

  const handleSaveAs = useCallback(async (): Promise<SaveCompletion> => {
    // 另存为必然唤起选择器：忙时不能排到任意旧 Promise 之后（transient activation 会丢）
    if (session.isSaving()) return refuseBusy();
    const completion = await session.submit({
      intent: 'save-as',
      capture: () => ({ source: controller.serialize(), content: controller.root }),
      write: async (snapshot) => {
        // 显式丢弃 handle → 必然唤起选择器（另存到新路径）。取消/失败都不改目的地。
        return docHost.save({ ...doc, source: snapshot.source, handle: undefined });
      },
      commit: (snapshot, outcome, current) => {
        const nextHandle = outcome.handle ?? session.getDestination();
        // 另存为成功即**同步**换目的地：已入队的 auto/manual 随后写新文件（复核 R1）
        session.setDestination(nextHandle);
        setDoc((d) => ({
          ...d,
          // E 批口径：保存路径不得改写 doc.source（解析输入）——内容快照写入 savedSource
          savedSource: snapshot.source,
          handle: nextHandle,
          saved: true,
          ts: Date.now(),
        }));
        // 另存为期间继续编辑：新文件里是旧快照 → 保持 dirty
        if (current) controller.markSaved();
        // 另存为会换文件：旧 id 的句柄记录要清掉，否则下次载入会指回旧文件。
        // 附属记录失败不影响写盘事实（复核 R4-B）→ 独立附属警告
        try {
          if (outcome.handle) persistHandle(outcome.handle.name ?? doc.id, outcome.handle);
        } catch {
          onSaveWarning?.(
            outcome.result === 'fs' ? SAVE_METADATA_WARNING : SAVE_METADATA_WARNING_DOWNLOAD,
          );
        }
      },
    });
    // 另存为失败要可见（取消/过期静默）
    if (completion.kind === 'failed') onBlockedSave?.(SAVE_FAILED_NOTICE);
    return completion;
  }, [
    controller,
    docHost,
    doc,
    setDoc,
    persistHandle,
    session,
    refuseBusy,
    onBlockedSave,
    onSaveWarning,
  ]);

  return { applyDoc, handleOpen, handleNew, handleSave, handleSaveAs };
}
