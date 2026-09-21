/**
 * 离开决策器（MODE-GUARD Task 1；复核返修 MG-R1/R2/R3）—— 一次离开请求、三选项决策与异步状态。
 *
 * 是什么：
 * - `requestLeave(perform)`：先 flush 未提交草稿 → 干净且无 I/O 直接执行目标；
 *   否则打开应用层三选项模态（保存并继续 / 放弃修改 / 取消）等用户决策；
 * - **单请求互斥持续到目标执行完或失败**（MG-R3）：异步 `perform` 期间后续点击一律 false，
 *   目标成功/失败都解锁，失败不悬挂；「因目标执行而卸载 Stage」不等于请求失败；
 * - 请求绑定**端口登记代次**（MG-R2）：端口注销、被替换或决策器卸载时，
 *   尚未执行目标的请求立即结算 false（迟到 wait/save 不得执行旧目标、不得改写新提示）；
 * - 组合输入未结束时**不弹模态**（MG-R1）：模态聚焦会让编辑器失焦并把未确认候选串当正文提交；
 *   改为非模态提示 + 暂缓请求，`compositionend` 后自动继续；
 * - 决策后**重新核验**实时 `isDirty()` / `isSaving()`：一次 `saved,current=true` 不是永久通行证；
 * - 取消后迟到的保存完成**不得**执行原目标（每次续跑前比对活动请求身份与端口代次）；
 * - `download` 只证明已触发下载 → 不自动离开，保留取消/显式放弃入口。
 *
 * 不是什么：
 * - 不存文档内容、不实现保存队列（复用包 1 协调器）、不弹原生 confirm；
 * - 不负责 App 与 Stage 的登记（见 `useDocumentLeaveRegistration`），也不做草稿持久化。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeCompositionEnd } from '../draftFlush.js';
import type {
  DocumentLeavePort,
  FlushOutcome,
  FlushResult,
  LeaveChoice,
  RequestLeave,
  SaveCompletion,
} from '../documentLifecycle.js';

export interface LeavePromptState {
  /** 过程提示（保存失败/下载/内容又变/组合未结束）；null = 默认文案 */
  notice: string | null;
  /** 保存或等待进行中：显示进行中文案，取消仍可操作 */
  busy: boolean;
}

export interface UnsavedTransition {
  /** 当前是否有 Stage 登记了 leave port（App 据此禁用模式入口，避免「缺省即放行」短窗口） */
  ready: boolean;
  /** 非 null = 三选项模态应显示 */
  prompt: LeavePromptState | null;
  /** 非模态提示（组合未结束 → 请求已暂缓，完成输入后自动继续）；null = 无 */
  blockedNotice: string | null;
  requestLeave: RequestLeave;
  choose: (choice: LeaveChoice) => void;
  /** Stage 登记/注销端口；返回的清理函数按**身份**判定，旧 Stage 不会注销新 Stage */
  registerPort: (port: DocumentLeavePort | null) => () => void;
}

interface PortRegistration {
  port: DocumentLeavePort;
  /** 登记代次：同一端口对象被重新登记也会 +1；异步回调用它判归属 */
  gen: number;
}

interface ActiveRequest {
  port: DocumentLeavePort;
  /** 发起时的端口代次（MG-R2：代次不匹配 = 端口已失效，迟到回调零副作用） */
  gen: number;
  perform: () => void | Promise<void>;
  pending: Promise<boolean>;
  resolve: (ok: boolean) => void;
  settled: boolean;
  invalidated: boolean;
  /** 保存已发起：重复点「保存并继续」不再重复提交 */
  saving: boolean;
  /** 目标已开始执行（MG-R3）：此后端口注销不再判为失败（正常切换会卸载 Stage） */
  executing: boolean;
  /** 组合暂缓中的解绑句柄（请求结束必须解绑，避免失效的组合状态残留） */
  stopDefer?: () => void;
}

export const LEAVE_COMPOSITION_NOTICE =
  '正在输入（输入法组合未结束）：请先完成候选输入，再选择保存或放弃。';
/** 组合未结束导致请求被暂缓（非模态提示；完成输入后自动继续） */
export const LEAVE_COMPOSITION_DEFERRED_NOTICE =
  '正在输入（输入法组合未结束）：请先完成候选输入，完成前不会离开，也不会提交候选文字。';
/** 草稿提交抛错（MG-R4-B）：保留草稿、不离开；取消后可修正重试，或显式放弃 */
export const LEAVE_DRAFT_FAILED_NOTICE =
  '有未提交的草稿无法写入（提交失败）：请取消后修正再试，或选择放弃修改并离开。';
export const LEAVE_SAVE_AGAIN_NOTICE =
  '保存期间内容又有变化：请再次保存，或选择放弃修改并离开。';
export const LEAVE_DOWNLOAD_NOTICE =
  '已发起下载，但下载不证明文件已落盘：请确认文件已保存，或选择放弃修改并离开。';
export const LEAVE_SAVING_NOTICE = '正在保存…';
export const LEAVE_SETTLING_NOTICE = '正在收束已开始的写入…';
export const LEAVE_FAILED_NOTICE = '保存未完成（写入失败或未获确认）：可重试，或选择放弃修改并离开。';
export const LEAVE_BLOCKED_NOTICE = '保存被拦截（内容与文档不同步或写入忙）：可重试，或选择放弃修改并离开。';
export const LEAVE_CANCELLED_NOTICE = '已取消保存：可重试，或选择放弃修改并离开。';
export const LEAVE_STALE_NOTICE = '保存请求已过期（文档或会话已变化）：请重试，或选择放弃修改并离开。';

/** 保存结果 → 模态内提示（saved 分支由调用方另行处理） */
export function completionNotice(completion: SaveCompletion): string {
  if (completion.kind === 'downloaded') return LEAVE_DOWNLOAD_NOTICE;
  if (completion.kind === 'failed') return LEAVE_FAILED_NOTICE;
  if (completion.kind === 'blocked') return LEAVE_BLOCKED_NOTICE;
  if (completion.kind === 'cancelled') return LEAVE_CANCELLED_NOTICE;
  if (completion.kind === 'stale') return LEAVE_STALE_NOTICE;
  return LEAVE_SAVE_AGAIN_NOTICE; // saved 但 current=false：内容又变
}

/**
 * `flushEdits()` 返回值归一化（MG-R4-B）：新版端口返回 `'ok' | 'composing' | 'failed'`，
 * 旧实现/测试替身返回布尔（`true` → ok，`false` → composing）—— 两者都要正确处理。
 */
function flushOutcomeOf(outcome: FlushResult): FlushOutcome {
  if (outcome === true) return 'ok';
  if (outcome === false) return 'composing';
  return outcome;
}

/** flush 未通过（非 ok）时的模态提示：IME 暂缓与提交失败要说清楚是哪种 */
function flushBlockedNotice(outcome: FlushOutcome): string {
  return outcome === 'failed' ? LEAVE_DRAFT_FAILED_NOTICE : LEAVE_COMPOSITION_NOTICE;
}

export function useUnsavedTransition(): UnsavedTransition {
  const portRef = useRef<PortRegistration | null>(null);
  const activeRef = useRef<ActiveRequest | null>(null);
  const genSeq = useRef(0);
  const mountedRef = useRef(true);
  const [ready, setReady] = useState(false);
  const [prompt, setPrompt] = useState<LeavePromptState | null>(null);
  const [blockedNotice, setBlockedNotice] = useState<string | null>(null);

  /** 请求归属：仍是当前活动请求、未被失效、端口代次未变 */
  const owns = useCallback(
    (request: ActiveRequest): boolean =>
      activeRef.current === request &&
      !request.invalidated &&
      portRef.current?.gen === request.gen,
    [],
  );

  /** 结束请求（只结算一次）；清模态/非模态提示与暂缓订阅 */
  const settle = useCallback((request: ActiveRequest, ok: boolean): void => {
    request.stopDefer?.();
    request.stopDefer = undefined;
    if (activeRef.current === request) {
      activeRef.current = null;
      if (mountedRef.current) {
        setPrompt(null);
        setBlockedNotice(null);
      }
    }
    if (request.settled) return;
    request.settled = true;
    request.invalidated = true;
    request.resolve(ok);
  }, []);

  /**
   * 端口失效（注销 / 被替换 / 决策器卸载）→ 尚未开始执行目标的请求结算 false。
   * 目标**已开始执行**的不动：正常切换会卸载 Stage（注销），此时应由执行结果决定成败。
   */
  const abandon = useCallback(
    (match: { port: DocumentLeavePort; gen: number } | null): void => {
      const request = activeRef.current;
      if (request === null || request.executing) return;
      if (match !== null && (request.port !== match.port || request.gen !== match.gen)) return;
      settle(request, false);
    },
    [settle],
  );

  const registerPort = useCallback(
    (port: DocumentLeavePort | null): (() => void) => {
      const previous = portRef.current;
      if (port === null) {
        if (previous !== null) {
          portRef.current = null;
          setReady(false);
          abandon(previous);
        }
        return () => undefined;
      }
      if (previous !== null) {
        // 每次登记都产生新代次 → 旧代次上尚未执行目标的请求必须结束，否则它永远
        // owns()=false 却仍占着 activeRef（模态不关、Promise 不结算、后续入口全被拒）。
        // 同一对象重复登记也走这里（MG-R2-B）：代次语义与幂等策略保持一致 —— 以「新代次生效」为准。
        abandon(previous);
      }
      const gen = ++genSeq.current;
      portRef.current = { port, gen };
      setReady(true);
      return () => {
        // 身份判定：旧 Stage 的清理不得注销刚挂载的新 Stage（也不得结束新 Stage 的请求）
        if (portRef.current?.gen !== gen) return;
        portRef.current = null;
        setReady(false);
        abandon({ port, gen });
      };
    },
    [abandon],
  );

  /** 执行目标动作并结束请求（目标抛错 = 未达成，返回 false）；互斥保留到目标收束 */
  const runTarget = useCallback(
    async (request: ActiveRequest): Promise<boolean> => {
      if (!owns(request)) return false;
      request.executing = true; // 目标即将执行：此后端口注销不再判为失败
      setPrompt(null);
      setBlockedNotice(null);
      try {
        // 同步目标（常规 setMode/applyModel）：调用返回即「执行完」→ 立刻收束互斥，
        // 不把释放推迟一个微任务（否则同一 tick 的后续入口点击会被吞掉）。
        const outcome: void | Promise<void> = request.perform();
        if (!(outcome instanceof Promise)) {
          settle(request, true);
          return true;
        }
        // 异步目标：互斥保留到它成功/失败为止（MG-R3）
        await outcome;
        settle(request, true);
        return true;
      } catch {
        settle(request, false);
        return false;
      }
    },
    [owns, settle],
  );

  /**
   * 推进请求：flush → （干净且无 I/O）执行目标 / （组合未结束）暂缓 / 否则开模态。
   * 可能是首次推进，也可能是组合结束后的自动续跑。
   */
  const continueRef = useRef<((request: ActiveRequest) => Promise<void>) | null>(null);
  const continueRequest = useCallback(
    async (request: ActiveRequest): Promise<void> => {
      if (!owns(request)) return;
      const { port } = request;
      const flush = flushOutcomeOf(port.flushEdits());
      if (flush === 'composing') {
        // 组合未结束：不弹模态（模态聚焦会让编辑器失焦 → 把未确认候选串当正文提交）。
        // 非模态提示 + 暂缓；compositionend 后自动续跑。
        if (mountedRef.current) setBlockedNotice(LEAVE_COMPOSITION_DEFERRED_NOTICE);
        request.stopDefer?.();
        request.stopDefer = subscribeCompositionEnd(() => {
          request.stopDefer = undefined;
          // 延到本次 compositionend **派发结束之后**再续跑：编辑器自己的 compositionend
          // 处理器（React 合成事件，冒泡阶段）晚于本 capture 监听，先清组合态，
          // 续跑时的 blur 提交才不会被编辑器判成「组合未结束」而拒绝。
          void Promise.resolve().then(() => continueRef.current?.(request));
        });
        return;
      }
      if (flush === 'failed') {
        // 草稿提交抛错（MG-R4-B）：保留草稿、目标零执行，给可修正后重试的模态提示。
        // 这不是 IME 事件 —— **不能**挂在 compositionend 上等一个永远不会到来的信号；
        // 请求保持活动（互斥不释放）直到用户取消/放弃/修正后重试。
        if (mountedRef.current) {
          setBlockedNotice(null);
          setPrompt({ notice: LEAVE_DRAFT_FAILED_NOTICE, busy: false });
        }
        return;
      }
      if (!port.isDirty() && !port.isSaving()) {
        await runTarget(request);
        return;
      }
      const saving = port.isSaving();
      if (mountedRef.current) {
        setBlockedNotice(null);
        setPrompt({ notice: saving ? LEAVE_SAVING_NOTICE : null, busy: saving });
      }
    },
    [owns, runTarget],
  );
  continueRef.current = continueRequest;

  const requestLeave = useCallback(
    async (perform: () => void | Promise<void>): Promise<boolean> => {
      // 一次只处理一个离开请求（含正在执行的目标）：连续点击不同入口直接拒绝，不覆盖目标
      if (activeRef.current !== null) return false;
      const reg = portRef.current;
      // 未就绪不放行：入口按钮应已禁用（不制造「port 缺省即离开」的短窗口）
      if (reg === null) return false;

      let resolve!: (ok: boolean) => void;
      const pending = new Promise<boolean>((ok) => {
        resolve = ok;
      });
      const request: ActiveRequest = {
        port: reg.port,
        gen: reg.gen,
        perform,
        pending,
        resolve,
        settled: false,
        invalidated: false,
        saving: false,
        executing: false,
      };
      activeRef.current = request;
      try {
        await continueRequest(request);
      } catch {
        // 端口方法（flushEdits/isDirty/isSaving）抛错：结束本次请求而不是留下悬挂互斥
        // （否则后续入口点击会被永久拒绝）；用户可重试。
        settle(request, false);
      }
      return pending;
    },
    [continueRequest, settle],
  );

  const saveRequest = useCallback(
    async (request: ActiveRequest): Promise<void> => {
      if (request.saving) return; // 重复提交保护（同一次请求只发起一次保存）
      const { port } = request;
      request.saving = true;
      try {
        // 组合未结束 / 草稿提交失败：不发起保存（避免提交未确认候选串或丢掉未写入的草稿）
        const firstFlush = flushOutcomeOf(port.flushEdits());
        if (firstFlush !== 'ok') {
          setPrompt({ notice: flushBlockedNotice(firstFlush), busy: false });
          return;
        }
        // 已开始的 I/O 未收束（例如自动保存正好在跑）：先等它完成再写，避免与它抢同一文件。
        // 这段时间不给「保存并继续」上 disabled —— 用户点了就等，不制造死按钮。
        if (port.isSaving()) {
          setPrompt({ notice: LEAVE_SETTLING_NOTICE, busy: true });
          try {
            await port.waitForIdle();
          } catch {
            /* 等待异常不阻塞重试路径 */
          }
          if (!owns(request)) return; // 端口注销/替换/卸载 → 迟到结果零副作用
          // 等待期间可能又出现未提交草稿 / 再次变脏 → 重新 flush 后继续
          const againFlush = flushOutcomeOf(port.flushEdits());
          if (againFlush !== 'ok') {
            setPrompt({ notice: flushBlockedNotice(againFlush), busy: false });
            return;
          }
        }
        setPrompt({ notice: LEAVE_SAVING_NOTICE, busy: true });
        let completion: SaveCompletion;
        try {
          completion = await port.save();
        } catch {
          completion = { kind: 'failed' };
        }
        // 用户在保存期间取消/替换了请求、或端口已失效 → 迟到的完成不得执行原目标
        if (!owns(request)) return;
        if (completion.kind === 'saved' && completion.current) {
          // 重新核验（不能缓存一次 saved/current=true 当通行证）
          if (port.isDirty() || port.isSaving()) {
            setPrompt({ notice: LEAVE_SAVE_AGAIN_NOTICE, busy: port.isSaving() });
            return;
          }
          await runTarget(request);
          return;
        }
        // downloaded / current=false / cancelled / blocked / failed / stale：不离开（可重试）
        setPrompt({ notice: completionNotice(completion), busy: false });
      } finally {
        request.saving = false; // 结束/失败后允许重试（成功分支的请求已作废，无副作用）
      }
    },
    [owns, runTarget],
  );

  const discardRequest = useCallback(
    async (request: ActiveRequest): Promise<void> => {
      const { port } = request;
      // 不再排定新的自动保存（已开始的 I/O 不撤回，先等它收束）
      port.suppressPendingAuto?.();
      if (port.isSaving()) {
        setPrompt({ notice: LEAVE_SETTLING_NOTICE, busy: true });
        try {
          await port.waitForIdle();
        } catch {
          /* 等待异常不阻塞放弃 */
        }
        if (!owns(request)) return; // 端口注销/替换/卸载 → 迟到结果零副作用
      }
      // 等待期间可能又出现未提交草稿：再 flush 一次。
      // 组合未结束 → 仍然拦住（不截断正在组合的文字）；草稿提交**失败** → 允许继续：
      // 「放弃修改」是用户对这份草稿的显式处置，不能因为写不回去就把用户锁在文档里。
      const discardFlush = flushOutcomeOf(port.flushEdits());
      if (discardFlush === 'composing') {
        setPrompt({ notice: LEAVE_COMPOSITION_NOTICE, busy: false });
        return;
      }
      await runTarget(request);
    },
    [owns, runTarget],
  );

  const choose = useCallback(
    (choice: LeaveChoice): void => {
      const request = activeRef.current;
      if (request === null) return;
      if (choice === 'cancel') {
        settle(request, false);
        return;
      }
      if (choice === 'discard') {
        void discardRequest(request).catch(() => settle(request, false));
        return;
      }
      void saveRequest(request).catch(() => settle(request, false));
    },
    [discardRequest, saveRequest, settle],
  );

  // 决策器卸载：未执行目标的请求结算 false（Promise 不悬挂，迟到回调无宿主）
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abandon(null);
    };
  }, [abandon]);

  return { ready, prompt, blockedNotice, requestLeave, choose, registerPort };
}
