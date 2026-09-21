/**
 * 自动保存 hook —— GH-T3 逻辑从 `MindmapStage.tsx` 抽出（纯搬迁 + 口径修正）。
 *
 * - 仅对「已落盘且带句柄」的文档生效（saved + handle）；dirty 变化触发；
 * - debounce 300ms；再次触发时重置计时器；
 * - 保存成功后写回 `savedSource`（最近一次成功保存的内容快照）+ handle + ts 并
 *   markSaved()；失败静默（由手动保存兜底）。
 * - S2G 守卫：写盘（serialize）前先查同步标记 `syncedSourceRef`（`canWriteDoc`）——
 *   画布树不属于该文档时不写、不 markSaved（dirty 保持）；通知每 doc.source 一次。
 *
 * 口径修正（E 批）：保存路径不得改写 `doc.source` —— 它是「本次会话打开/新建时的
 * 内容（解析输入）」，改写会误触发文档重建 effect（reset 清掉选中/编辑中/Undo/折叠态，
 * 即「页面回正刷新」根因）。内容快照一律写 `savedSource`。
 * 详见 docs/dispatch/2026-09-13-edit-flow-session-integrity-plan.md。
 *
 * 与 `useDocumentActions` 的关系：手动保存会先取消本 hook 排定的 pending 定时器
 * （共享 `autoSaveTimer` ref）。抽 hook 前这段逻辑在 `StageContent` 的内联 effect 里
 * （原 MindmapStage.tsx:445-471）。
 */
import { useEffect, useRef } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { DocumentHost, EditorController, MindDoc } from '@mindcanvas/react';
import { canWriteDoc, SAVE_BLOCKED_NOTICE } from './saveGuard.js';

export interface AutoSaveOptions {
  controller: EditorController;
  docHost: DocumentHost;
  doc: MindDoc;
  setDoc: Dispatch<SetStateAction<MindDoc>>;
  /** debounce 定时器（与 useDocumentActions 共享：手动保存前需取消 pending） */
  autoSaveTimer: RefObject<ReturnType<typeof setTimeout> | null>;
  /** S2G：同步标记（读点①：写盘前判定；三写点见 useDocumentSwitch / MindmapStage） */
  syncedSourceRef: RefObject<string | null>;
  /** S2G：守卫拦截通知（每 doc.source 一次）；可选，缺省不通知 */
  onBlockedSave?: (msg: string) => void;
  /** 落盘中转瞬态通知（FA1-T1：驱动「保存中…」指示）；可选，缺省不通知 */
  onSavingChange?: (saving: boolean) => void;
}

export function useAutoSave({
  controller,
  docHost,
  doc,
  setDoc,
  autoSaveTimer,
  syncedSourceRef,
  onBlockedSave,
  onSavingChange,
}: AutoSaveOptions): void {
  // S2G：拦截通知去重（每 doc.source 一次）——防定时器反复触发刷屏
  const blockedNoticeForRef = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 纯搬迁段——deps 刻意保留自 MindmapStage（原 eslint-disable 注释），行为由 useAutoSave.test 判别
  useEffect(() => {
    if (!controller.dirty || !doc.saved || !doc.handle) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      autoSaveTimer.current = null;
      // S2G 读点①：写盘前同步不变量 —— 画布树不属于该文档 → 拒写（dirty 保持，不自动重试）
      if (!canWriteDoc(syncedSourceRef.current, doc.source)) {
        if (blockedNoticeForRef.current !== doc.source) {
          blockedNoticeForRef.current = doc.source;
          onBlockedSave?.(SAVE_BLOCKED_NOTICE);
        }
        return;
      }
      const source = controller.serialize();
      onSavingChange?.(true);
      void docHost
        .save({ ...doc, source })
        .then((outcome) => {
          if (outcome.result !== 'cancelled') {
            setDoc((d) => ({
              ...d,
              // 保存路径不得改写 doc.source（E 批口径修正）：快照写入 savedSource
              savedSource: source,
              handle: outcome.handle ?? d.handle,
              ts: Date.now(),
            }));
            controller.markSaved();
          }
        })
        .finally(() => onSavingChange?.(false));
    }, 300);
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller.dirty, doc.saved, doc.id]);
}
