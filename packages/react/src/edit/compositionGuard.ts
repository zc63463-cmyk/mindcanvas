/**
 * 组合输入（IME）提交边界（MODE-GUARD MG-R1 / MG-R1-B）。
 *
 * 是什么：给「失焦/按键提交」的编辑器一个统一的组合纪律 ——
 * - 组合进行中（`compositionstart` 之后、`compositionend` 之前）**不得提交**：
 *   框里是**未确认的候选串**，提交等于把候选当正文并截断正在输入的文字；
 * - 那次被挡下的提交记为「待提交」，等 `compositionend` 用**已确认**的文字补上
 *   （否则确认文字只留在 DOM 里，编辑器一卸载就丢）。
 *
 * 为什么需要统一一份：提交边界散落在标题 / 描述 / 备注正文 / 背面 Markdown /
 * 自由画布正反面 / 批注等编辑器里，各写一遍容易出现「有的入口挡了、有的没挡」
 * （MG-R1-B 的复核结论）。组件只需在自己的 `onCompositionStart/End` 与
 * 提交函数处各接一行。
 *
 * 不是什么：不做候选窗/输入法本身的事，也不改写提交值（补提交用编辑器当前的原文，
 * 业务校验仍由各编辑器自己的 commit 通道负责）。
 */
import { useCallback, useRef } from 'react';

export interface CompositionCommitGuard {
  /** 绑到编辑控件的 onCompositionStart */
  onCompositionStart: () => void;
  /** 绑到 onCompositionEnd（参数 = 结束时的控件值，即**已确认**文字） */
  onCompositionEnd: (text: string) => void;
  /**
   * 提交边界：`true` = 可以提交；`false` = 组合未结束（已记「待提交」，调用方必须放弃本次提交）。
   */
  allowCommit: () => boolean;
}

/**
 * @param commit 组合结束后补提交用的回调（收到**已确认**文字）
 */
export function useCompositionCommitGuard(commit: (text: string) => void): CompositionCommitGuard {
  const composingRef = useRef(false);
  const pendingRef = useRef(false);

  const onCompositionStart = useCallback((): void => {
    composingRef.current = true;
  }, []);

  const onCompositionEnd = useCallback(
    (text: string): void => {
      composingRef.current = false;
      if (!pendingRef.current) return;
      pendingRef.current = false;
      commit(text); // 补上失焦时被挡下的那次提交（此时文字已确认）
    },
    [commit],
  );

  const allowCommit = useCallback((): boolean => {
    if (!composingRef.current) return true;
    pendingRef.current = true;
    return false;
  }, []);

  return { onCompositionStart, onCompositionEnd, allowCommit };
}
