/**
 * 编辑会话的 pending / flush 通道（MODE-GUARD MG-R4）。
 *
 * 解决的是什么：有的编辑器会把「已改动但尚未提交」的内容放在**自己的组件状态**里，
 * 此时 DOM 里没有可获得焦点的控件可 blur（典型：`NoteBackEditor` 的预览态 —— 切到预览
 * 后 textarea 卸载，React 卸载不派发 onBlur）。只按 `document.activeElement` 推断
 * 「有没有未提交草稿」，这类草稿会被判成没有 → 离开保护放行、`beforeunload` 也不拦。
 *
 * 是什么：一张**仅覆盖挂载期**的会话登记表。编辑器挂载时登记
 * `{ hasPending, commit }`，离开路径（`flushActiveDraft`）与 `beforeunload`
 * （`hasPendingDraft`）各问一句即可；卸载即注销（`useDraftSession` 保证）。
 *
 * 不是什么：**不是草稿持久化框架** —— 没有存储、没有跨会话恢复、没有历史栈；
 * 会话只活在组件挂载期内，`commit()` 也只走组件**既有**的提交通道（不绕过业务校验）。
 */
import { useEffect, useRef } from 'react';

export interface DraftSession {
  /** 当前是否有未提交内容（组件自己判定：能读到自己的状态与控件值，不依赖 DOM 焦点） */
  hasPending(): boolean;
  /** 提交未提交内容（走组件既有 commit 通道；无待提交时应为空操作） */
  commit(): void;
}

const sessions = new Set<DraftSession>();

/** 登记一个编辑会话；返回注销函数（组件卸载时必须调用） */
export function registerDraftSession(session: DraftSession): () => void {
  sessions.add(session);
  return () => {
    sessions.delete(session);
  };
}

/** 是否有任何登记会话持有未提交内容（beforeunload 判据之一） */
export function hasPendingDraftSession(): boolean {
  for (const session of [...sessions]) {
    if (session.hasPending()) return true;
  }
  return false;
}

/**
 * 提交所有登记会话的未提交内容（离开路径用）。
 *
 * 失败语义（MG-R4-B）：某个会话 `commit()` 抛错时**继续尝试其它会话**（能提交的先保住），
 * 但把失败**如实上报** —— 返回 `'failed'` 而不是被 catch 掉后报成功：
 * 否则「草稿没进模型 + 模型本来干净」会被干净路径放行，离开时那份草稿就丢了。
 * 失败会话的 `hasPending()` 仍为 true（我们不改它的状态），调用方设法让它重试。
 *
 * @returns `'ok'` = 没有待提交内容或全部提交成功；`'failed'` = 至少一个会话提交失败
 */
export function commitDraftSessions(): 'ok' | 'failed' {
  let failed = false;
  for (const session of [...sessions]) {
    if (!session.hasPending()) continue;
    try {
      session.commit();
    } catch {
      // 单个会话提交失败不阻塞其它会话，也不把「离开」变成崩溃 —— 但事实要带回给调用方
      failed = true;
    }
  }
  return failed ? 'failed' : 'ok';
}

/** 当前登记的会话数（测试 / 诊断用） */
export function draftSessionCount(): number {
  return sessions.size;
}

/**
 * 组件侧接线：登记一个会话（挂载期内有效）。
 * 入参是**工厂**：每次读取都拿到最新的 props/state 闭包，避免登记时捕获旧值。
 */
export function useDraftSession(build: () => DraftSession): void {
  const buildRef = useRef(build);
  buildRef.current = build;
  useEffect(
    () =>
      registerDraftSession({
        hasPending: () => buildRef.current().hasPending(),
        commit: () => {
          buildRef.current().commit();
        },
      }),
    [],
  );
}
