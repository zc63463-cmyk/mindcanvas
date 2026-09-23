/**
 * 文档保存会话 —— 会话身份 + 写入调度（SAVE-LIFECYCLE 包 1 核心）。
 *
 * 解决的是什么（审计 P0-A）：
 * 1) **写入开始后继续编辑**：保存完成只把「实际写出的快照」记为已保存；若此刻会话内的
 *    内容身份已变，保持 dirty 并让后续自动保存继续写最新快照 —— 绝不无条件 `markSaved()`。
 * 2) **迟到回调污染新文档**：每次显式文档替换（打开/新建/最近/演示/工作区）推进会话令牌；
 *    旧的进行中 I/O 完成时令牌不匹配 → 零 `commit`、零通知、零 saving 变化。
 * 3) **同会话写入竞争**：同一会话的实际写盘严格串行；队列中的自动请求合并到最新快照；
 *    显式（手动/另存为）请求插入到尚未开始的自动请求之前，但不越过**已开始**的写入。
 *
 * 身份口径（计划 Global Constraints）：
 * - 会话身份 = 本类内部单调递增的令牌，**不用** 文件名 / `doc.source` / dirty 布尔 / 渲染 epoch；
 * - 内容身份 = 调用方提供的不可变引用（导图 = `controller.root`，自由画布 = 模型对象），
 *   只随内容变化；同值回退允许保守保持 dirty，但绝不误清；
 * - **保存目的地** = 本会话当前写盘目标句柄。它必须**同步**更新（另存为成功、打开/补挂句柄、
 *   文档替换）—— 已入队的请求在真正开始时读它，而不是读入队时的 React 闭包，
 *   否则「另存为 → 排队 auto」会把后续编辑写回旧文件（复核 R1）。
 *
 * 异常边界（复核 R4 / R4-B）：`guard` / `readContent` / `capture` / `write` / `commit` 任一抛错
 * 都必须让**该请求**收口并继续消费队列，且不产生 unhandled rejection。结果类型只表达
 * **写盘事实**：写盘未成功/未确认 → `failed`（commit 不会执行 → dirty 保持原样）；
 * 写盘成功（含下载兜底）→ `saved` / `downloaded`，附属回填异常经 `onCommitError` 独立暴露，
 * 不把结果降级为 failed（否则结果、dirty、提示三者互相矛盾）。
 *
 * 与包 2 的交接：`isSaving()` / `waitForIdle()` 已可接入 `DocumentLeavePort`（见
 * `../documentLifecycle.ts`）；`flushEdits` 与 App 层离开登记由包 2 实现。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { FsFileHandle, SaveOutcome } from '@mindcanvas/react';
import type { SaveCompletion, SaveIntent } from '../documentLifecycle.js';
import type { FileOpIntent, OpLeaseResult, SaveDestination } from './saveDestination.js';
import { type DestinationInfo, destinationInfoOf } from './saveDestination.js';

/** 一次写入的快照：写盘文本 + 内容身份（在任务真正开始时捕获，故合并后取到的是最新快照） */
export interface SaveSnapshot {
  source: string;
  /** 内容身份（不可变引用）；只随内容变化，不含选中/折叠等瞬时状态 */
  content: unknown;
}

/** 一次保存请求（由调用方提供宿主适配；会话只负责顺序与结果归属） */
export interface SaveRequest {
  intent: SaveIntent;
  /** 同步守卫：false → 立即 blocked（任务不入队、不闪 saving、不改变任何状态） */
  guard?: () => boolean;
  /** 队列轮到本任务时捕获快照；null → 无可写内容（按 stale 结束） */
  capture: () => SaveSnapshot | null;
  /** 实际写盘（宿主 I/O） */
  write: (snapshot: SaveSnapshot) => Promise<SaveOutcome>;
  /**
   * 成功且会话仍有效时的回填（只回填**实际写出的快照**）。
   *
   * `current=false` 表示写入期间内容已被继续编辑：此时可记录 `savedSource`（磁盘确为该
   * 快照），但**不得**清 dirty —— 由后续自动保存写最新快照。
   */
  commit: (snapshot: SaveSnapshot, outcome: SaveOutcome, current: boolean) => void;
}

interface QueueEntry {
  token: number;
  request: SaveRequest;
  resolve: (completion: SaveCompletion) => void;
}

export class DocumentSaveSession {
  /** 会话令牌：显式文档替换推进；保存元数据回填不推进 */
  private token = 0;
  /** 尚未开始的请求（只可能属于当前会话；替换/卸载时整体作废） */
  private queue: QueueEntry[] = [];
  /** 已开始写入的令牌（null = 当前无进行中写入） */
  private inFlight: number | null = null;
  /**
   * 当前会话的保存目的地（**唯一存储位**，I-20）。
   *
   * 内部用归一化的 `SaveDestination`，`getDestination()` 再把它折回 `FsFileHandle`——
   * 这样「新方法与旧字段」不会各存一份（旧实现的 `destination` 只有句柄，
   * 无法表达「这份文档在工作区里的哪个相对路径」，于是改名后目的地无从更新 → R-01）。
   */
  private dest: SaveDestination = { kind: 'none' };
  private draining = false;
  private saving = false;
  private listeners = new Set<() => void>();
  private idleWaiters: Array<() => void> = [];
  private readonly readContent: () => unknown;
  /** 附属回填（commit）异常的通知端口：写盘已成功，仅在渲染层需要提示时使用 */
  private readonly onCommitError: ((error: unknown) => void) | undefined;

  // ---------------------------------------------------------------- P0-A：操作租约
  /**
   * 跨会话物理写计数（I-17）：write 开始 +1、其 `finally` -1，**不随 token 推进而归零**。
   *
   * 为什么不能复用 `waitForIdle()`：它只等**当前会话**已开始的 I/O。被替换会话
   * （切文档/关闭）已发出的物理写不在其范围内却仍在动磁盘。于是存在真实竞态：
   * 「等待空闲 → 新保存进入 → rename 复制旧快照 → 删源」（`shared-contracts` §3.5.1）。
   */
  private physicalWrites = 0;
  /** 当前租约持有者；null = 无租约。**单租约**：同一时刻只允许一个文件操作。 */
  private lease: { leaseId: number; opSeq: number; intent: FileOpIntent } | null = null;
  private leaseSeq = 0;
  /** 全局单调递增的操作代次（每次成功 `beginExclusiveOp` +1；每个 await 后的归属校验用） */
  private opSeqCounter = 0;

  constructor(options: {
    readContent: () => unknown;
    /**
     * commit（附属回填）抛错时的通知入口；可选。
     *
     * 语义：写盘已经成功，结果仍是 `saved` / `downloaded`；本回调只用于把
     * 「附属步骤未完成」暴露给界面，**不改变**结果类型（复核 R4-B）。
     */
    onCommitError?: (error: unknown) => void;
  }) {
    this.readContent = options.readContent;
    this.onCommitError = options.onCommitError;
  }

  /**
   * 兼容写入口（I-20）：把句柄归一化为 `SaveDestination` 后写**同一字段**。
   *
   * 既有 4 处调用点（`useDocumentActions.ts:201,264`、`useAutoSave.ts:89`、
   * `useFreeCanvasDocument.ts:134`）行为不变 —— 它们只传句柄，无法表达作用域/相对路径，
   * 故归一化为 `browser`（有句柄时按 disk 记，路径未知）。**改名/移动必须用
   * `rebindDestination`**：只有它能同时更新「作用域 + 相对路径 + 句柄」。
   */
  setDestination(handle: FsFileHandle | undefined): void {
    if (handle === undefined) {
      // 保留已有 disk 目的地？不：既有语义是「显式设置目的地」，
      // 传 undefined 表示「当前没有可写句柄」（下载兜底 / 新建未保存）。
      this.dest = { kind: 'none' };
      return;
    }
    const current = this.dest;
    if (current.kind === 'disk' && current.handle === handle) return; // 同句柄：保住 scopeId/relPath
    this.dest = { kind: 'disk', scopeId: '', relPath: handle.name ?? '', name: handle.name ?? '', handle };
  }

  /** 当前保存目的地句柄（排队请求写盘时的唯一句柄来源；兼容读入口） */
  getDestination(): FsFileHandle | undefined {
    return this.dest.kind === 'disk' ? this.dest.handle : undefined;
  }

  /**
   * 目的地重绑（I-20）：**唯一**能同时更新「作用域 + 相对路径 + 句柄」的入口。
   *
   * 改名/移动成功后必须调用它，否则后续保存仍写旧句柄 ——
   * 旧路径已被删除（或已不是当前文档），写入会把旧文件「复活」（R-01）。
   */
  rebindDestination(next: SaveDestination): void {
    this.dest = next;
  }

  /** 目的地信息（供 UI 显示「保存到哪里」）；与 `getDestination()` 描述同一事实 */
  getDestinationInfo(): DestinationInfo {
    return destinationInfoOf(this.dest);
  }

  // ---------------------------------------------------------------- P0-A：租约 API

  /** 跨会话物理写计数（诊断与测试用；产品判据在 `beginExclusiveOp` 内部） */
  get physicalWritesInFlight(): number {
    return this.physicalWrites;
  }

  /** 当前租约（诊断/测试用） */
  get leaseInfo(): { leaseId: number; opSeq: number; intent: FileOpIntent } | null {
    return this.lease === null ? null : { ...this.lease };
  }

  /**
   * 取得操作租约（I-16）：与保存队列**共用同一互斥域**，不新造第二个锁对象。
   *
   * 取得时机：在任何 `await` 之前、UI 校验通过之后立即取得；需要用户手势的步骤
   * （选择器/确认框）必须在取得租约**之前**完成，避免长占租约等手势。
   *
   * 拒绝而不是等待（I-17）：静默等待会让用户在无反馈中卡住；用户可重试。
   */
  beginExclusiveOp(
    intent: FileOpIntent,
    target?: { scopeId: string; relPath: string },
  ): OpLeaseResult {
    if (this.lease !== null) return { kind: 'refused', reason: 'busy-lease' };
    // 物理写静默：含被替换会话的 I/O（waitForIdle 覆盖不到，见 physicalWrites 注释）
    if (this.physicalWrites > 0) return { kind: 'refused', reason: 'busy-physical' };
    // 目标作用域与本会话目的地不一致 → 这次操作不属于当前会话（迟到回调场景）
    if (target !== undefined) {
      const info = this.getDestinationInfo();
      if (info.kind === 'disk' && info.relPath !== null && this.dest.kind === 'disk') {
        if (this.dest.scopeId !== '' && this.dest.scopeId !== target.scopeId) {
          return { kind: 'refused', reason: 'session-replaced' };
        }
      }
    }
    this.leaseSeq += 1;
    this.opSeqCounter += 1;
    this.lease = { leaseId: this.leaseSeq, opSeq: this.opSeqCounter, intent };
    return { kind: 'granted', leaseId: this.lease.leaseId, opSeq: this.lease.opSeq };
  }

  /**
   * 释放租约（I-19）：**只有持有者能释放**。
   *
   * 非持有者调用是静默 no-op —— 这正是「条件释放」的实现位：
   * 调用方必须写 `if (session.leaseIdOf(op) === leaseId) session.endExclusiveOp(leaseId)`，
   * 否则一个 `finally` 会解开**后续请求**持有的租约（L2 负控锚定的就是这条）。
   */
  endExclusiveOp(leaseId: number): void {
    if (this.lease === null || this.lease.leaseId !== leaseId) return;
    this.lease = null;
  }

  /** 当前租约 id（调用方 `finally` 里的条件释放判据；null = 无租约） */
  leaseIdOf(): number | null {
    return this.lease?.leaseId ?? null;
  }

  /** 每个 `await` 之后的归属校验（I-19）：租约仍在、会话令牌未变、代次未变 */
  ownsLease(leaseId: number, opSeq: number, token: number): boolean {
    return this.lease !== null && this.lease.leaseId === leaseId && this.lease.opSeq === opSeq && this.token === token;
  }

  /** 租约期间 `submit` 一律 blocked（不入队、不闪 saving、零状态变化） */
  private blockedByLease(): boolean {
    return this.lease !== null;
  }

  /** useSyncExternalStore 订阅：保存中转瞬态（当前会话活动任务） */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSavingSnapshot = (): boolean => this.saving;

  /** 当前令牌（测试与诊断用；产品逻辑不应据此做身份判断） */
  get sessionToken(): number {
    return this.token;
  }

  /**
   * 显式文档替换：推进会话令牌并把目的地换成新文档的句柄。旧会话**尚未开始**的任务立即
   * 按 `stale` 结束；已发出的 I/O 不声称能撤回 —— 其完成回调因令牌不匹配而零副作用。
   *
   * P0-A：文档被替换 → **租约随之作废**（I-19「会话被替换」分支）。host 操作若已开始，
   * 其完成回调因 `ownsLease` 失败而不回填任何状态（不写旧文档、也不写新文档）。
   */
  beginDocument(handle: FsFileHandle | undefined, destination?: SaveDestination): void {
    this.token += 1;
    // 目的地：优先用调用方给的完整目的地（含 scopeId/relPath）；否则按句柄归一化
    if (destination !== undefined) this.dest = destination;
    else this.setDestination(handle);
    this.lease = null;
    const dropped = this.queue;
    this.queue = [];
    for (const entry of dropped) entry.resolve({ kind: 'stale' });
    this.publish();
  }

  /**
   * 当前会话是否有活动任务（进行中写入或在队请求）。
   *
   * 语义边界（包 2 交接）：这里只反映**当前会话**。被替换会话（切文档/卸载）已发出的物理
   * I/O 不在此列 —— 它无法撤回，会后台跑完且不再回填任何状态。
   */
  isSaving(): boolean {
    return this.queue.length > 0 || this.inFlight === this.token;
  }

  /**
   * 等当前会话已开始的 I/O 完成；不自动开始新的文件选择器。
   *
   * 不等待被替换会话的物理 I/O（见 `isSaving()` 的语义边界）——调用方若要表达「页面上
   * 不再有本次文档的写入」，用本方法；若要表达「磁盘上没有未结束的写」，本方法不足。
   */
  waitForIdle(): Promise<void> {
    if (!this.isSaving()) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  /** 提交一次保存请求。返回的 Promise 永不 reject（失败经 `failed` 结果暴露）。 */
  submit(request: SaveRequest): Promise<SaveCompletion> {
    // P0-A：租约期间一律 blocked（不入队、不闪 saving、零状态变化）。
    //
    // 这是「取消 auto 定时器 + 赌没有新保存」的替代：定时器被清除后，**内容再变化会重新
    // 排定新的自动保存**（`useAutoSave.ts` 的 deps 含 `content`），于是
    // 「等待空闲 → 新保存进入 → rename 复制旧快照 → 删源」的竞态仍然成立。
    // 只有让**写入入口本身**在租约期间拒绝，才真正关闭它。
    if (this.blockedByLease()) return Promise.resolve({ kind: 'blocked' });
    // guard 抛错按「拒绝写盘」收口，不让异常逃出 submit（复核 R4）
    let allowed = true;
    if (request.guard !== undefined) {
      try {
        allowed = request.guard();
      } catch {
        allowed = false;
      }
    }
    if (!allowed) {
      return Promise.resolve({ kind: 'blocked' });
    }
    return new Promise<SaveCompletion>((resolve) => {
      const entry: QueueEntry = { token: this.token, request, resolve };
      if (request.intent === 'auto') {
        // 自动请求合并：队列中尚未开始的 auto 被最新请求取代（它将在轮到时空取最新快照）
        const autoIndex = this.queue.findIndex((q) => q.request.intent === 'auto');
        if (autoIndex >= 0) {
          const superseded = this.queue.splice(autoIndex, 1);
          for (const old of superseded) old.resolve({ kind: 'stale' });
        }
        this.queue.push(entry);
      } else {
        // 显式请求（手动/另存为）优先于尚未开始的自动请求；不越过已开始的写入
        const autoIndex = this.queue.findIndex((q) => q.request.intent === 'auto');
        if (autoIndex >= 0) this.queue.splice(autoIndex, 0, entry);
        else this.queue.push(entry);
      }
      this.publish();
      void this.drain();
    });
  }

  /**
   * 组件卸载：停止待发任务（按 `stale` 结束）；进行中的 I/O 无法撤回，
   * 但其完成回调因令牌失效而不回填任何状态。
   */
  dispose(): void {
    this.token += 1;
    this.lease = null;
    const dropped = this.queue;
    this.queue = [];
    for (const entry of dropped) entry.resolve({ kind: 'stale' });
    this.inFlight = null;
    this.listeners.clear();
    this.saving = false;
    this.settleIdle();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const entry = this.queue.shift();
        if (entry === undefined) break;
        if (entry.token !== this.token) {
          entry.resolve({ kind: 'stale' });
          continue;
        }
        this.inFlight = entry.token;
        this.publish();
        // 捕获快照：异常按失败收口（此时会话刚校验过，归属判定在下面统一做）
        let snapshot: SaveSnapshot | null = null;
        try {
          snapshot = entry.request.capture();
        } catch {
          snapshot = null;
        }
        // 实际写盘：异常不得逃逸（逃逸会让请求悬挂 + 队列停摆，复核 R4）
        //
        // P0-A（I-17）：物理写计数在 write 前后 ±1，且在**本任务的 finally 语义**里收口
        // —— 无论成功、失败还是会话已被替换，计数都要回落（否则会永久卡住 beginExclusiveOp）。
        let outcome: SaveOutcome | null = null;
        let writeFailed = false;
        if (snapshot !== null) {
          this.physicalWrites += 1;
          try {
            outcome = await entry.request.write(snapshot);
          } catch {
            writeFailed = true;
          } finally {
            this.physicalWrites -= 1;
          }
        }
        this.inFlight = null;
        this.publish();
        // 会话归属：**成功与失败一视同仁** —— 旧会话的迟到结果一律 stale（复核 R2：
        // 切文档/卸载后的 reject 不得返回 failed，更不得触发当前会话的失败通知）
        if (entry.token !== this.token) {
          entry.resolve({ kind: 'stale' });
          continue;
        }
        if (snapshot === null || writeFailed || outcome === null) {
          entry.resolve({ kind: 'failed' });
          continue;
        }
        if (outcome.result === 'cancelled') {
          entry.resolve({ kind: 'cancelled' });
          continue;
        }
        // 内容归属：写入期间继续编辑 → 保留 dirty（由后续自动保存写最新快照）。
        // 读内容身份抛错 → 保守按「内容已变」处理，绝不因此误清脏。
        let current = false;
        try {
          current = Object.is(this.readContent(), snapshot.content);
        } catch {
          current = false;
        }
        // 附属回填（savedSource/handle/remember/持久化）：抛错不得让请求悬挂，也不得把
        // **已成功的写盘**降级为 failed（否则「结果说失败、dirty 已清、提示说未标记已保存」
        // 三者矛盾，复核 R4-B）。结果按写盘事实收口，异常经 onCommitError 独立暴露。
        try {
          entry.request.commit(snapshot, outcome, current);
        } catch (error) {
          this.onCommitError?.(error);
        }
        entry.resolve(
          outcome.result === 'download' ? { kind: 'downloaded', current } : { kind: 'saved', current },
        );
      }
    } finally {
      this.draining = false;
      this.inFlight = null;
      this.publish();
    }
  }

  private publish(): void {
    const next = this.isSaving();
    if (next !== this.saving) {
      this.saving = next;
      for (const listener of this.listeners) {
        try {
          listener();
        } catch {
          // 订阅者（渲染层）异常不得中断写入队列（复核 R4 同类边界）
        }
      }
    }
    this.settleIdle();
  }

  private settleIdle(): void {
    if (this.isSaving() || this.idleWaiters.length === 0) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const waiter of waiters) waiter();
  }
}

export interface DocumentSaveSessionHandle {
  session: DocumentSaveSession;
  /** 当前会话是否有活动保存任务（「保存中…」指示的唯一事实源） */
  saving: boolean;
}

/**
 * React 接入：为单个 Stage 创建一个稳定的保存会话。
 *
 * `readContent` 经 ref 转发 —— 渲染闭包可能陈旧，但完成时机需要读**当前**内容身份。
 * 卸载时 `dispose()`：待发任务取消，迟到回调不再触碰组件状态。
 */
export function useDocumentSaveSession(options: {
  readContent: () => unknown;
  /** 附属回填异常的通知入口（可选）；见 `DocumentSaveSession` 构造参数说明 */
  onCommitError?: (error: unknown) => void;
}): DocumentSaveSessionHandle {
  const readContentRef = useRef(options.readContent);
  readContentRef.current = options.readContent;
  const onCommitErrorRef = useRef(options.onCommitError);
  onCommitErrorRef.current = options.onCommitError;
  const [session] = useState(
    () =>
      new DocumentSaveSession({
        readContent: () => readContentRef.current(),
        onCommitError: (error) => onCommitErrorRef.current?.(error),
      }),
  );
  const saving = useSyncExternalStore(session.subscribe, session.getSavingSnapshot);
  useEffect(() => {
    return () => {
      session.dispose();
    };
  }, [session]);
  return { session, saving };
}
