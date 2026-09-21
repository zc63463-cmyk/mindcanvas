/**
 * 单帧调度器（dirty-flag + 单帧合批）+ 动画模式 ——「禁永续 rAF / 轮询 tick」的落地实现。
 * 空闲时零活动：仅在 request() 被触发后调度一帧，帧内合批执行全部回调后立即休眠；
 * 交互期间多次变更合并为一次渲染，保证空闲 CPU ≈ 0（硬验收）。
 *
 * 动画模式（M5-T1）：animate() 期间链式调度帧（每帧 request 下一帧），
 * 动画结束 / 中断 / 取消后立即回归休眠（不再申请 rAF）——「动画结束 3 秒内 rAF 归零」由链式
 * 自终止保证：最后一帧不调度下一帧。新动画打断旧动画时，从当前插值位置继续（不跳回起点）。
 */
export interface FrameSchedulerOptions {
  /** 调度一帧的底层 API（默认 requestAnimationFrame；测试注入可控实现） */
  raf?: (cb: () => void) => number;
  /** 取消帧（默认 cancelAnimationFrame；测试注入需一致） */
  rafCancel?: (id: number) => void;
  /** 当前时间（默认 performance.now；测试注入可控时钟） */
  now?: () => number;
}

/** 动画进度映射（t ∈ [0,1]，注入外部即实现任意缓动） */
export type EasingFn = (t: number) => number;

/** 线性 */
export function linear(t: number): number {
  return t;
}

/** 缓出三次（默认：进场快、落点缓——位置过渡的标准选择） */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** 缓出二次（较轻的减速） */
export function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** 缓入缓出二次（视图/透明度等对称过渡） */
export function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** 通用插值：默认数值 lerp；可注入任意类型（坐标对 / 数组 / 对象） */
export type LerpFn<T> = (from: T, to: T, t: number) => T;

export function lerpNumber(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export interface AnimateOptions<T> {
  /** 起点值 */
  from: T;
  /** 终点值 */
  to: T;
  /** 时长（ms；≤0 视为立即完成一帧） */
  duration: number;
  /** 缓动（缺省 easeOutCubic） */
  easing?: EasingFn;
  /** 插值（缺省 = 数值 lerp；多值动画（坐标 Map 等）注入自定义实现） */
  interpolate?: LerpFn<T>;
  /** 每帧回调（value = 当前插值结果；t = 未缓动进度 0..1） */
  onFrame: (value: T, t: number) => void;
  /** 完成回调（仅在自然完成时触发；被新动画打断 / cancel 不触发） */
  onDone?: () => void;
}

/** 内部动画状态（存 unknown，对外 animate<T> 保持泛型安全；TS 逆变约束：onFrame 收 unknown） */
interface ActiveAnim {
  from: unknown;
  to: unknown;
  easing: EasingFn;
  interpolate: LerpFn<unknown>;
  onFrame: (value: unknown, t: number) => void;
  onDone?: () => void;
  start: number;
  duration: number;
}

export class FrameScheduler {
  private rafId: number | null = null;
  /** 动画链的独立帧 id（与 dirty-flag 帧互不干扰；动画结束即置 null） */
  private animFrameId: number | null = null;
  private callbacks = new Set<() => void>();
  /**
   * 命名动画槽（M5-T3）：不同槽可并发（如节点位置过渡 + 视口动画同时进行）；
   * 同名槽调用 = 打断续接（从当前插值位置继续）。无动画时零 rAF。
   */
  private anims = new Map<string, ActiveAnim>();
  private opts: Required<FrameSchedulerOptions>;

  constructor(opts: FrameSchedulerOptions = {}) {
    this.opts = {
      raf: opts.raf ?? ((cb) => requestAnimationFrame(cb)),
      rafCancel: opts.rafCancel ?? ((id) => cancelAnimationFrame(id)),
      now: opts.now ?? (() => performance.now()),
    };
  }

  /** 挂起回调 + 调度一帧；同一帧内的多次 request 合并为一次 rAF */
  request(cb?: () => void): void {
    if (cb) this.callbacks.add(cb);
    if (this.rafId === null) {
      // 同步 rAF 注入（测试/SSR）下 flush 立即执行 → raf 返回 undefined → 帧仍视为已消费
      const id = this.opts.raf(() => this.flush());
      this.rafId = typeof id === 'number' ? id : null;
    }
  }

  /** 帧内回调登记（与 request 等价，语义为"本帧合批执行一次"） */
  onFrame(cb: () => void): void {
    this.request(cb);
  }

  /** 是否有已挂起未执行的帧 / 活动动画（空闲判据：false 即零活动） */
  get hasPending(): boolean {
    return this.rafId !== null || this.animFrameId !== null;
  }

  /** 是否有进行中的动画（供调用方判断可中断性） */
  get animating(): boolean {
    return this.anims.size > 0;
  }

  /**
   * 启动 / 打断动画（链式 rAF 逐帧推进，自然完成后立即休眠）。
   * - name 缺省 = 'default'（单槽语义，与 M5-T1 一致）；多槽并发用不同 name
   * - 可中断：同名已存在动画时，新动画 from 取当前插值位置（不跳回起点；旧 onDone 不触发）
   */
  animate<T>(opts: AnimateOptions<T>, name = 'default'): void {
    const now = this.opts.now();
    const easing = opts.easing ?? easeOutCubic;
    const interpolate = (opts.interpolate ?? lerpNumber) as LerpFn<unknown>;
    const prev = this.anims.get(name);
    // 打断旧动画：从当前插值位置继续（旧 onDone 不触发）
    const from = prev
      ? (interpolate(prev.from, prev.to, prev.easing(progressOf(prev, now))) as T)
      : opts.from;
    this.anims.set(name, {
      from,
      to: opts.to,
      easing,
      interpolate,
      onFrame: opts.onFrame as (value: unknown, t: number) => void,
      onDone: opts.onDone,
      start: now,
      duration: Math.max(0, opts.duration),
    });
    this.kickAnim();
  }

  /** 中断动画（不触发 onDone）；name 缺省 = 全部。指定名仅取消该槽 */
  cancelAnim(name?: string): void {
    if (name === undefined) this.anims.clear();
    else this.anims.delete(name);
    if (this.anims.size === 0 && this.animFrameId !== null) {
      this.opts.rafCancel(this.animFrameId);
      this.animFrameId = null;
    }
  }

  private kickAnim(): void {
    if (this.animFrameId !== null) return;
    const id = this.opts.raf(() => this.animTick());
    this.animFrameId = typeof id === 'number' ? id : null;
  }

  private animTick(): void {
    this.animFrameId = null;
    if (this.anims.size === 0) return;
    const now = this.opts.now();
    const done: string[] = [];
    for (const [name, a] of this.anims) {
      const t = progressOf(a, now);
      const eased = a.easing(t);
      a.onFrame(a.interpolate(a.from, a.to, eased), t);
      if (t >= 1) done.push(name);
    }
    // 自然完成：移除槽位后若再无活动动画 → 不调度下一帧（立即休眠，空闲 rAF ≈ 0）
    for (const name of done) {
      const a = this.anims.get(name);
      this.anims.delete(name);
      a?.onDone?.();
    }
    if (this.anims.size > 0) this.kickAnim();
  }

  private flush(): void {
    this.rafId = null;
    const cbs = [...this.callbacks];
    this.callbacks.clear();
    for (const cb of cbs) cb();
  }

  /** 组件卸载时取消挂起帧与全部动画 */
  dispose(): void {
    if (this.rafId !== null) {
      this.opts.rafCancel(this.rafId);
      this.rafId = null;
    }
    if (this.animFrameId !== null) {
      this.opts.rafCancel(this.animFrameId);
      this.animFrameId = null;
    }
    this.callbacks.clear();
    this.anims.clear();
  }
}

/** 未钳制进度（调用方在 t>=1 时结束；easing 输入保持 [0,1] 外不越界） */
function progressOf(a: ActiveAnim, now: number): number {
  if (a.duration <= 0) return 1;
  const t = (now - a.start) / a.duration;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
