/**
 * 自动保存 hook —— GH-T3 逻辑从 `MindmapStage.tsx` 抽出；SAVE-LIFECYCLE 批次改接保存会话。
 *
 * - 仅对「已落盘且带句柄」的文档生效（saved + handle）；
 * - debounce 300ms：**内容身份（`controller.root` 不可变引用）变化即重排**，不依赖
 *   dirty 的 false→true 边沿 —— 慢写期间继续编辑也能安排后续写入（审计 P0-A）；
 * - 写入经 `DocumentSaveSession.submit`：同会话串行、auto 合并到最新快照、完成时按
 *   会话 + 内容归属决定是否清脏（写出的快照 ≠ 当前内容 → 保持 dirty）；
 * - S2G 守卫：写盘前的同步不变量在 `guard` 里同步判定 —— 拦截时任务不入队、
 *   不闪「保存中」，且每 doc.source 只通知一次（dirty 保持，不自动重试）；
 * - 失败由会话归为 `failed`（dirty 保持、无未处理 rejection，由手动保存兜底）。
 *
 * 口径纪律（E 批沿用）：保存路径不得改写 `doc.source` —— 它是「本次会话打开/新建时的
 * 内容（解析输入）」，改写会误触发文档重建 effect（reset 清掉选中/编辑中/Undo/折叠态）。
 * 内容快照一律写 `savedSource`。
 *
 * 与 `useDocumentActions` 的关系：手动保存会先取消本 hook 排定的 pending 定时器
 * （共享 `autoSaveTimer` ref）；**取消待发定时器不等于取消已开始的 I/O**。
 */
import { useEffect, useRef } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { DocumentHost, EditorController, MindDoc } from '@mindcanvas/react';
import { SAVE_FAILED_NOTICE } from '../documentLifecycle.js';
import type { DocumentSaveSession } from './useDocumentSaveSession.js';
import { canWriteDoc, SAVE_BLOCKED_NOTICE } from './saveGuard.js';

export interface AutoSaveOptions {
  controller: EditorController;
  docHost: DocumentHost;
  doc: MindDoc;
  setDoc: Dispatch<SetStateAction<MindDoc>>;
  /** 保存会话（同会话串行 / 结果归属校验；见 useDocumentSaveSession） */
  session: DocumentSaveSession;
  /** debounce 定时器（与 useDocumentActions 共享：手动保存前需取消 pending） */
  autoSaveTimer: RefObject<ReturnType<typeof setTimeout> | null>;
  /** S2G：同步标记（读点①：写盘前判定；三写点见 useDocumentSwitch / MindmapStage） */
  syncedSourceRef: RefObject<string | null>;
  /**
   * P0-A：外部补写触发器。递增即重排一次自动保存（内容引用未变时也生效）。
   *
   * 用途：租约释放后的补写 —— 租约期间内容变了但所有 submit 都被挡回且不入队，
   * 那条内容不在任何定时器里，必须由外部显式触发。缺省 0（无此需求）。
   */
  flushTick?: number;
  /**
   * 保存未完成的通知渠道（同步守卫拦截 / 写入忙 / **写入失败**）；可选，缺省不通知。
   * 三者对调用方的共同语义是「本次未成功落盘」，文案由各自常量区分：
   * `SAVE_BLOCKED_NOTICE`（守卫）/ `SAVE_BUSY_NOTICE`（忙）/ `SAVE_FAILED_NOTICE`（失败）。
   */
  onBlockedSave?: (msg: string) => void;
}

export function useAutoSave({
  controller,
  docHost,
  doc,
  setDoc,
  session,
  autoSaveTimer,
  syncedSourceRef,
  onBlockedSave,
  flushTick = 0,
}: AutoSaveOptions): void {
  // S2G：拦截通知去重（每 doc.source 一次）——防定时器反复触发刷屏
  const blockedNoticeForRef = useRef<string | null>(null);
  // 内容身份：不可变根引用（选中/折叠/重渲不改变它，只有编辑才换对象）
  const content = controller.root;

  // 保存目的地同步（**次级机制**）：doc.handle 变化（打开/补挂/另存为回填/下载兜底）时跟随。
  // 主机制是各 commit 里的同步 `setDestination` —— 已入队请求读目的地，不依赖本 effect。
  useEffect(() => {
    session.setDestination(doc.handle);
  }, [session, doc.handle]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: deps 锁定内容身份 + 落盘前提（doc 身份字段）；行为由 useAutoSave.test / save-lifecycle.test 判别
  useEffect(() => {
    if (!controller.dirty || !doc.saved || !doc.handle) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    const timer = setTimeout(() => {
      autoSaveTimer.current = null;
      void session
        .submit({
          intent: 'auto',
          // S2G 读点①：写盘前同步不变量 —— 画布树不属于该文档 → 拒写（dirty 保持，不自动重试）
          guard: () => canWriteDoc(syncedSourceRef.current, doc.source),
          capture: () => ({ source: controller.serialize(), content: controller.root }),
          write: async (snapshot) => {
            // 目的地读**会话**（同步事实源）：另存为成功后已入队的 auto 必须写新文件，
            // 而不是入队时闭包里的旧句柄（复核 R1）
            const target = session.getDestination();
            const outcome = await docHost.save({ ...doc, source: snapshot.source, handle: target });
            // 下载兜底没有句柄：保留原目的地（不把已有句柄抹成 undefined）
            return { result: outcome.result, handle: outcome.handle ?? target };
          },
          commit: (snapshot, outcome, current) => {
            const nextHandle = outcome.handle ?? doc.handle;
            session.setDestination(nextHandle);
            setDoc((d) => ({
              ...d,
              // 保存路径不得改写 doc.source（E 批口径）：快照写入 savedSource
              savedSource: snapshot.source,
              handle: nextHandle,
              ts: Date.now(),
            }));
            // 写出的快照已不是当前内容 → 保持 dirty（后续自动保存继续写最新快照）
            if (current) controller.markSaved();
          },
        })
        .then((completion) => {
          // 写入失败必须让用户看见（dirty 保持，不自动重试）；取消/过期静默
          if (completion.kind === 'failed') {
            onBlockedSave?.(SAVE_FAILED_NOTICE);
            return;
          }
          if (completion.kind !== 'blocked') return;
          if (blockedNoticeForRef.current === doc.source) return;
          blockedNoticeForRef.current = doc.source;
          onBlockedSave?.(SAVE_BLOCKED_NOTICE);
        });
    }, 300);
    autoSaveTimer.current = timer;
    return () => {
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, controller.dirty, doc.saved, doc.id, doc.handle, flushTick]);
}
