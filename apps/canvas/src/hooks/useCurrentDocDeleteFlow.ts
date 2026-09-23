/**
 * 删除当前文档的 **F2 流程**（P0-A ⑤ · file-management §4、acceptance §3 F2）。
 *
 * 为什么单独一层：删除当前文档必须同时处理三件事 —— **草稿/组合输入**、**未保存模型**、
 * **在途写入** —— 而这三件事的判定顺序不能乱（与离开决策器同族的通道，但
 * **不改离开决策器本身**，那是本轮的排除项）。
 *
 * §4 的流程图逐步对齐：
 *   ⓪ 取操作租约：`busy-lease` / `busy-physical` → 提示，**零副作用**
 *   ① 草稿提交（`flushEdits`，复用离开决策器同一通道 `draftFlush.ts:89-113`）
 *      ├─ `'composing'` → 暂缓：提示『输入法正在输入，请先结束输入』，`compositionend` 后自动续跑
 *      └─ `'failed'`    → 保留草稿、中止删除、提示可修正后重试
 *   ② 在途写入：本租约期间写入已被挡回，故此处只需确认 `isSaving()` 为假
 *      （取租约前已有写入 → 已被 `busy-physical` 拒绝）
 *   ③ dirty 判定（getter，非快照）
 *      ├─ 不脏 → 进入 ④
 *      └─ 脏   → 三选：『保存后删除』/『放弃修改并删除』/『取消』
 *   ④ 确认条（对象名 + 是否当前文档 + 不可撤销声明）
 *      ├─ 取消 → 零副作用（文档、草稿、目的地**全部不变**）
 *      └─ 确认 → host 删除
 *                 ├─ 成功 → 关闭当前文档、回空白态
 *                 └─ 失败 → 保留当前文档与目的地；错误提示 + 重试
 *   ⑤ finally：条件释放租约
 *
 * **决策边界（§4「明确定义的边界」）**：
 *  - 『放弃修改并删除』= 用户**显式**放弃：此分支下不得再自动保存
 *    （复用 `suppressPendingAuto()`），且删除后文档进入「已关闭」而非「未保存状态」——
 *    不能再出现一个指向已删文件的 dirty 会话。本层用 `onClosed()` 表达这个不可逆转换；
 *  - 「不提供撤销」：真正的原子撤销需要把内容留在内存并重建文件，属新能力且易与
 *    「未保存」语义混淆（DS-13 设计者建议）—— 本层**不实现**假撤销承诺。
 *
 * 不是什么：不实现 `flushEdits`（在 `draftFlush.ts`）、不做 host I/O（在编排层）、
 * 不弹原生对话框（面板渲染内联确认条）。
 */
import { useCallback, useRef, useState } from 'react';
import type { WorkspaceFile } from '@mindcanvas/react';
import { subscribeCompositionEnd } from '../draftFlush.js';
import type { FlushOutcome, FlushResult } from '../documentLifecycle.js';
import type { FileOpController } from '../useFileOpController.js';
import type { CurrentDocOpResult, FileOpRefusal } from './useFileOpOrchestration.js';

/** F2 的待决状态（面板据此渲染；null = 无待决） */
export type DeletePending =
  /** 脏 → 三选（保存后删除 / 放弃修改并删除 / 取消） */
  | { kind: 'dirty'; name: string; isCurrent: boolean }
  /** 组合未结束 → 非模态提示 + 暂缓（`compositionend` 后自动续跑） */
  | { kind: 'composing'; name: string }
  /** 草稿提交失败 → 保留草稿、中止删除（可修正后重试） */
  | { kind: 'draft-failed'; name: string }
  /** 确认条（零副作用出口在这一档） */
  | { kind: 'confirm'; name: string; isCurrent: boolean; isDir: boolean }
  /** 拒绝（busy-lease / busy-physical）：提示 + 不进入任何后续 */
  | { kind: 'refused'; name: string; reason: FileOpRefusal; notice: string };

export type DeleteChoice = 'save-then-delete' | 'discard-then-delete' | 'cancel';

/** F2 流程对外暴露的最小面（面板只认这些） */
export interface CurrentDocDeleteFlow {
  pending: DeletePending | null;
  /** 提示文案（与 pending 分开：组合暂缓与草稿失败都要有可读提示） */
  notice: string | null;
  /** 入口：用户点了某个节点的「删除」 */
  request(target: DeleteTarget): Promise<void>;
  /** 三选/确认的动作入口 */
  choose(choice: DeleteChoice | 'confirm' | 'cancel'): void;
  dismiss(): void;
}

export interface DeleteTarget {
  name: string;
  /** 是否当前正在编辑的文档 */
  isCurrent: boolean;
  /** 是否目录 */
  isDir: boolean;
  /** 真正执行删除（成功 → 调用方负责关闭文档/刷新树） */
  perform: () => Promise<CurrentDocOpResult<unknown>>;
}

export interface DeleteFlowOptions {
  /**
   * ⓪ 取操作租约（`shared-contracts` §3.5.2）。
   *
   * 由调用方注入而不是本层直接持有 session 的原因：租约的目标要带
   * `{scopeId, relPath}`，而这两个事实属调用方（当前文档的作用域与路径）。
   * 返回 `false` + `reason` 表示被拒（零副作用）。
   */
  acquireLease(target: DeleteTarget): { ok: true; release: () => void } | { ok: false; reason: FileOpRefusal };
  /** 草稿提交（离开决策器同一通道） */
  flushEdits(): FlushResult;
  /** 实时脏判定（getter，非快照） */
  isDirty(): boolean;
  /** 实时写入判定（本租约期间恒为假；取租约前已有写入会被 busy-physical 拒绝） */
  isSaving(): boolean;
  /** 用户选择「保存后删除」时的保存；返回是否真的成功 */
  saveNow(): Promise<boolean>;
  /** 「放弃修改并删除」→ 停止排定新的自动保存（不影响已开始的 I/O） */
  suppressPendingAuto?(): void;
  /**
   * 删除**成功**后关闭当前文档（回空白态）。
   *
   * 这是「已关闭」而非「未保存」的不可逆转换：调用方必须在这里把会话切走
   * （`beginDocument(undefined)` 同族），否则会留下一个指向已删文件的 dirty 会话。
   * **失败分支不得调用它**（保留当前文档与目的地）。
   */
  onClosed?(): void;
  /** 失败/拒绝提示出口 */
  onNotice?(msg: string): void;
}

/** F2 文案（唯一事实源；与流程图的『』逐字一致） */
export const DELETE_NOTICE = {
  composing: '输入法正在输入，请先结束输入。',
  draftFailed: '有未提交的草稿无法写入（提交失败）：请先修正，再试删除。',
  busyLease: '正在处理上一步操作，请稍候再试（本次未做任何改动）。',
  busyPhysical: '上一份写入还没有结束，请稍后重试（本次未做任何改动）。',
  cancelled: '',
} as const;

/** `flushEdits` 返回值归一化（旧式布尔：`true`→ok、`false`→composing） */
function flushOutcomeOf(outcome: FlushResult): FlushOutcome {
  if (outcome === true) return 'ok';
  if (outcome === false) return 'composing';
  return outcome;
}

export function useCurrentDocDeleteFlow(options: DeleteFlowOptions): CurrentDocDeleteFlow {
  const {
    acquireLease,
    flushEdits,
    isDirty,
    isSaving,
    saveNow,
    suppressPendingAuto,
    onClosed,
    onNotice,
  } = options;
  const [pending, setPending] = useState<DeletePending | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** 当前目标（ref：组合结束后的自动续跑要拿到它，且不应触发重渲染） */
  const targetRef = useRef<DeleteTarget | null>(null);
  const stopDeferRef = useRef<(() => void) | null>(null);
  /**
   * ⓪ 已取得的租约释放句柄。
   *
   * 生命周期：`request` 成功后持有 → 删除成功/失败/取消时**条件释放**（`finally` 语义）。
   * 组合暂缓期间**继续持有**：用户一旦结束输入就自动续跑，此刻若已释放会让
   * 另一个操作插进来，删除就不再基于稳定状态。
   */
  const releaseRef = useRef<(() => void) | null>(null);

  const notify = useCallback(
    (msg: string): void => {
      setNotice(msg);
      onNotice?.(msg);
    },
    [onNotice],
  );

  const clearDefer = useCallback((): void => {
    stopDeferRef.current?.();
    stopDeferRef.current = null;
  }, []);

  /** 条件释放：幂等，且只在仍持有租约时释放一次 */
  const releaseLease = useCallback((): void => {
    const release = releaseRef.current;
    releaseRef.current = null;
    release?.();
  }, []);

  /**
   * ①③④ 推进：草稿 → 在途 → dirty → 确认条（租约已在 `request` 里取到）。
   */
  const advance = useCallback(
    (target: DeleteTarget): void => {
      targetRef.current = target;
      // ① 草稿提交（与离开决策器同族：组合未结束必须暂缓，不得截断候选串）
      const flush = flushOutcomeOf(flushEdits());
      if (flush === 'composing') {
        setPending({ kind: 'composing', name: target.name });
        notify(DELETE_NOTICE.composing);
        // `compositionend` 后自动续跑（用户不必再点一次）；**租约继续持有**
        clearDefer();
        stopDeferRef.current = subscribeCompositionEnd(() => {
          stopDeferRef.current = null;
          // 延到 compositionend 派发结束之后再续跑（编辑器自己的处理器晚于捕获监听）
          void Promise.resolve().then(() => {
            const still = targetRef.current;
            if (still !== null) advance(still);
          });
        });
        return;
      }
      if (flush === 'failed') {
        // 保留草稿、中止删除、提示可修正后重试（与 IME 无关，**不挂在 compositionend 上**）
        setPending({ kind: 'draft-failed', name: target.name });
        notify(DELETE_NOTICE.draftFailed);
        releaseLease();
        return;
      }
      // ② 在途写入：本租约期间恒为假，但仍显式判定（若为真说明时序被破坏）
      if (isSaving()) {
        const msg = DELETE_NOTICE.busyPhysical;
        setPending({ kind: 'refused', name: target.name, reason: 'busy-physical', notice: msg });
        notify(msg);
        releaseLease();
        return;
      }
      // ③ dirty 判定 → 三选；不脏直接进确认条
      if (isDirty()) {
        setPending({ kind: 'dirty', name: target.name, isCurrent: target.isCurrent });
        setNotice(null);
        return;
      }
      setPending({
        kind: 'confirm',
        name: target.name,
        isCurrent: target.isCurrent,
        isDir: target.isDir,
      });
      setNotice(null);
    },
    [flushEdits, isSaving, isDirty, notify, clearDefer, releaseLease],
  );

  const request = useCallback(
    async (target: DeleteTarget): Promise<void> => {
      clearDefer();
      // ⓪ 取租约（**任何 await 之前**；被拒则零副作用，不进入任何后续分支）
      const lease = acquireLease(target);
      if (!lease.ok) {
        targetRef.current = target;
        const msg = lease.reason === 'busy-physical' ? DELETE_NOTICE.busyPhysical : DELETE_NOTICE.busyLease;
        setPending({ kind: 'refused', name: target.name, reason: lease.reason, notice: msg });
        notify(msg);
        return;
      }
      releaseRef.current = lease.release;
      advance(target);
    },
    [acquireLease, advance, clearDefer, notify],
  );

  /** ④ 执行删除（确认条之后）；无论成败都条件释放租约 */
  const runDelete = useCallback(
    async (target: DeleteTarget): Promise<void> => {
      setPending(null);
      try {
        const result = await target.perform();
        if (result.kind === 'done') {
          // 成功 → 关闭当前文档（「已关闭」而非「未保存」）
          if (target.isCurrent) onClosed?.();
          setNotice(null);
          return;
        }
        if (result.kind === 'partial') {
          // 目录递归删除不该产生 partial；出现则如实提示（不静默）
          setNotice('删除没有完全完成，请检查磁盘上的残留内容。');
          return;
        }
        if (result.kind === 'failed') {
          // 失败 → **保留当前文档与目的地**；错误提示 + 可重试
          notify(result.notice);
          return;
        }
        if (result.notice !== '') notify(result.notice);
      } finally {
        releaseLease();
      }
    },
    [onClosed, notify, releaseLease],
  );

  const choose = useCallback(
    (choice: DeleteChoice | 'confirm' | 'cancel'): void => {
      const target = targetRef.current;
      const current = pending;
      if (current === null) return;

      if (choice === 'cancel') {
        clearDefer();
        setPending(null);
        // 取消 → 零副作用：文档、草稿、目的地全部不变（草稿已提交进模型，这是**保留**）
        setNotice(null);
        releaseLease();
        return;
      }
      if (choice === 'confirm') {
        if (current.kind !== 'confirm' || target === null) return;
        void runDelete(target);
        return;
      }
      if (current.kind !== 'dirty' || target === null) return;
      if (choice === 'discard-then-delete') {
        // 『放弃修改并删除』= 显式放弃：此分支下**不得**再自动保存
        suppressPendingAuto?.();
        void runDelete(target);
        return;
      }
      // save-then-delete：保存成功才删（保存失败 → 不删，提示可重试）
      void (async () => {
        try {
          const saved = await saveNow();
          if (!saved) {
            notify('保存没有成功，删除已中止；可修正后重试。');
            return;
          }
          await runDelete(target);
        } finally {
          // 保存失败分支已 return；只有成功路径会在 runDelete 里释放，
          // 这里兜住「保存抛错」的路径（租约不得泄漏）
          if (releaseRef.current !== null) releaseLease();
        }
      })();
    },
    [pending, clearDefer, runDelete, suppressPendingAuto, saveNow, notify, releaseLease],
  );

  const dismiss = useCallback((): void => {
    clearDefer();
    setPending(null);
    setNotice(null);
    releaseLease();
  }, [clearDefer, releaseLease]);

  return { pending, notice, request, choose, dismiss };
}

/** 从控制器取出删除执行器（与 `useFileOpController` 的删除段对接） */
export function performFrom(
  controller: FileOpController,
  file: WorkspaceFile,
): () => Promise<CurrentDocOpResult<null>> {
  return () => controller.requestDelete(file);
}
