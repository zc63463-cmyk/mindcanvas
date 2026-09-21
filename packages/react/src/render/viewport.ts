/**
 * 视口控制器：pan/zoom 变换 + 屏幕↔世界坐标互转 + dirty 通知（经 FrameScheduler 单帧合批）。
 * 「按需渲染」入口：任何变换变更只做一次脏标记，由调度器合批转发订阅者（React 渲染），
 * 空闲时无任何 rAF/timer 活动（禁永续轮询）。
 * M5-T3：animateTo / fitBoundsAnimated —— 聚焦跳转/适配视图平滑平移缩放（视口动画槽 'viewport'，
 * 与节点位置过渡槽 'default' 并发互不干扰；用户手动 pan/zoom 时自动打断视口动画）。
 */
import { worldViewportRect, type Rect } from '@mindcanvas/kernel';
import { FrameScheduler, easeInOutQuad, linear } from './scheduler.js';
import {
  PAN_INERTIA_TAU,
  PAN_SAMPLE_WINDOW,
  VIEWPORT_ANIM_MS,
  ZOOM_BOUNCE_MS,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_OVERSHOOT,
} from './motion.js';

export interface Transform {
  /** 缩放系数（世界 1px = 屏幕 k px） */
  k: number;
  /** 平移（屏幕坐标空间：世界点 w 的屏幕位置 = w*k + x） */
  x: number;
  y: number;
}

export interface WorldPoint {
  x: number;
  y: number;
}

/** 视口动画槽名（与节点过渡 'default' 槽隔离，可并发） */
const VIEWPORT_ANIM_SLOT = 'viewport';

/** 拖拽速度采样（MapView 每帧 pan 增量 + 时间戳） */
export interface PanSample {
  t: number;
  dx: number;
  dy: number;
}

/**
 * 由最近采样窗估计松手速度（px/ms）：窗口内总位移 / 总时长。
 * 纯函数（M5-T4 惯性触发判定；MapView 在 pointerup 时调用）。
 */
export function estimatePanVelocity(samples: readonly PanSample[]): { vx: number; vy: number } {
  const recent = samples.slice(-PAN_SAMPLE_WINDOW);
  if (recent.length < 2) return { vx: 0, vy: 0 };
  const dt = recent[recent.length - 1]!.t - recent[0]!.t;
  if (dt <= 0) return { vx: 0, vy: 0 };
  let dx = 0;
  let dy = 0;
  for (const s of recent) {
    dx += s.dx;
    dy += s.dy;
  }
  return { vx: dx / dt, vy: dy / dt };
}

export class ViewportController {
  transform: Transform = { k: 1, x: 0, y: 0 };
  viewW = 1;
  viewH = 1;

  private epoch = 0;
  private listeners = new Set<() => void>();
  private frame: FrameScheduler;
  private broadcasting = false;

  constructor(frame: FrameScheduler) {
    this.frame = frame;
  }

  /** 订阅渲染通知（React useSyncExternalStore 用） */
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** 快照：版本号（每次脏标记 +1）——变化即触发 re-render */
  getSnapshot = (): number => this.epoch;

  setSize(w: number, h: number): void {
    if (w > 0) this.viewW = w;
    if (h > 0) this.viewH = h;
    this.notify();
  }

  /** 屏幕坐标增量平移（px）；手动操作打断视口动画 */
  panBy(dx: number, dy: number): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return; // 非有限增量护栏（NaN 污染 transform 永久化）
    this.frame.cancelAnim(VIEWPORT_ANIM_SLOT);
    this.applyPan(dx, dy);
  }

  /** 平移增量应用（不打断动画——惯性滑行内部使用） */
  private applyPan(dx: number, dy: number): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.transform.x += dx;
    this.transform.y += dy;
    this.notify();
  }

  /**
   * 以屏幕点 (sx, sy) 为锚缩放（factor>1 放大）；世界锚点保持不动（M5-T4 光标锚点）。
   * 越界软回弹：允许短暂超出硬边界（弹性余量 ZOOM_OVERSHOOT）后平滑回弹至边界，而非硬停。
   */
  zoomAt(sx: number, sy: number, factor: number): void {
    // 有限性护栏：捏合双指距离为 0 时 factor = 0/0 = NaN，两个越界比较对 NaN 均为
    // false → applyZoom(NaN) → transform.k 永久 NaN（translate(NaN NaN) scale(NaN) 的实测根因）
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(factor) || factor <= 0) {
      return;
    }
    this.frame.cancelAnim(VIEWPORT_ANIM_SLOT);
    const t = this.transform;
    const k = t.k > 0 ? t.k : 1;
    const raw = k * factor;
    if (raw > ZOOM_MAX || raw < ZOOM_MIN) {
      // 越界：先弹性超调（上限 ×overshoot / 下限 ÷overshoot），再回弹到硬边界
      const overshootK = raw > ZOOM_MAX ? ZOOM_MAX * ZOOM_OVERSHOOT : ZOOM_MIN / ZOOM_OVERSHOOT;
      this.applyZoom(sx, sy, overshootK);
      const clampedK = raw > ZOOM_MAX ? ZOOM_MAX : ZOOM_MIN;
      this.animateTo(this.zoomTarget(sx, sy, clampedK), ZOOM_BOUNCE_MS);
    } else {
      this.applyZoom(sx, sy, raw);
    }
  }

  /** 以锚点应用新 k（锚点世界坐标不动） */
  private applyZoom(sx: number, sy: number, nextK: number): void {
    const t = this.transform;
    const k = t.k > 0 ? t.k : 1;
    t.x = sx - ((sx - t.x) / k) * nextK;
    t.y = sy - ((sy - t.y) / k) * nextK;
    t.k = nextK;
    this.notify();
  }

  /** 以锚点计算目标变换（锚点世界坐标不动） */
  private zoomTarget(sx: number, sy: number, nextK: number): Transform {
    const t = this.transform;
    const k = t.k > 0 ? t.k : 1;
    return { k: nextK, x: sx - ((sx - t.x) / k) * nextK, y: sy - ((sy - t.y) / k) * nextK };
  }

  /**
   * 拖拽惯性滑行（M5-T4）：指数衰减速度（时间常数 τ），约 3τ 后静止。
   * 在 'viewport' 动画槽内推进——用户滚轮/再次拖拽自动打断。
   */
  animateInertia(vx: number, vy: number): void {
    if (vx === 0 && vy === 0) return;
    const TAU = PAN_INERTIA_TAU;
    const D = TAU * 3;
    let lastFactor = 0;
    // 解析位移因子 f(t) = 1 - e^(-t/τ)：总滑行 ≈ v·τ；逐帧应用增量 → 速度指数衰减缓停
    this.frame.animate(
      {
        from: 0,
        to: 1,
        duration: D,
        easing: linear,
        onFrame: (f) => {
          const factor = 1 - Math.exp((-f * D) / TAU);
          const df = factor - lastFactor;
          lastFactor = factor;
          if (df > 0) this.applyPan(vx * TAU * df, vy * TAU * df);
        },
      },
      VIEWPORT_ANIM_SLOT,
    );
  }

  /** 重置为初始视图 */
  reset(k = 1, x = 0, y = 0): void {
    this.frame.cancelAnim(VIEWPORT_ANIM_SLOT);
    this.transform = { k, x, y };
    this.notify();
  }

  /** 打断进行中的视口动画（用户接管 pan/zoom 前调用；不影响其他动画槽） */
  cancelAnim(): void {
    this.frame.cancelAnim(VIEWPORT_ANIM_SLOT);
  }

  /**
   * 平滑变换到目标（M5-T3）：平移 + 缩放同时插值（聚焦跳转 / 适配视图 / Ctrl+0）。
   * 可中断续接：进行中再次调用 → 从当前插值位置继续；手动 pan/zoom 自动打断。
   */
  animateTo(target: Transform, durationMs: number): void {
    // 起点净化：当前变换若已含 NaN（历史污染），以此为插值起点会让**每一帧**都产出
    // NaN → 与 notify 自愈互相打架、错误持续刷屏。非有限起点回落原点；目标非有限直接放弃。
    const cur = this.transform;
    const from: Transform = Number.isFinite(cur.x) && Number.isFinite(cur.y) && Number.isFinite(cur.k)
      ? { ...cur }
      : { k: 1, x: 0, y: 0 };
    if (
      !Number.isFinite(target.x) ||
      !Number.isFinite(target.y) ||
      !Number.isFinite(target.k) ||
      target.k <= 0
    ) {
      return;
    }
    this.frame.animate(
      {
        from,
        to: { ...target },
        duration: durationMs,
        easing: easeInOutQuad,
        interpolate: lerpTransform,
        onFrame: (t) => {
          this.transform = { ...t };
          this.notify();
        },
      },
      VIEWPORT_ANIM_SLOT,
    );
  }

  /**
   * 世界包围盒适配屏幕（fit）——平滑版（M5-T3）。
   * 计算目标变换后经 animateTo 插值；内容空/宽高为 0 时直接跳过。
   */
  fitBoundsAnimated(
    b: { minX: number; minY: number; maxX: number; maxY: number },
    pad = 60,
    durationMs?: number,
  ): void {
    const target = this.fitTransform(b, pad);
    if (target === null) return;
    this.animateTo(target, durationMs ?? (this.viewW > 10 ? VIEWPORT_ANIM_MS : 0));
  }

  /** 计算 fit 目标变换（纯计算；内容空/宽高为 0 → null） */
  fitTransform(
    b: { minX: number; minY: number; maxX: number; maxY: number },
    pad = 60,
  ): Transform | null {
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    if (!(w > 0 && h > 0)) return null;
    const k = clamp(
      Math.min((this.viewW - pad * 2) / w, (this.viewH - pad * 2) / h),
      ZOOM_MIN,
      ZOOM_MAX,
    );
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    return { k, x: this.viewW / 2 - cx * k, y: this.viewH / 2 - cy * k };
  }

  /** 世界包围盒适配屏幕（fit；瞬间——初始挂载等场景）；成功则调度渲染 */
  fitBounds(b: { minX: number; minY: number; maxX: number; maxY: number }, pad = 60): void {
    const target = this.fitTransform(b, pad);
    if (target === null) return;
    this.transform = target;
    this.notify();
  }

  /** 屏幕点 → 世界点 */
  toWorld(sx: number, sy: number): WorldPoint {
    const { k, x, y } = this.transform;
    const kk = k > 0 ? k : 1;
    return { x: (sx - x) / kk, y: (sy - y) / kk };
  }

  /** 世界可见矩形（kernel cull 消费） */
  worldRect(margin = 0): Rect {
    const r = worldViewportRect(this.transform, this.viewW, this.viewH);
    return {
      x: r.x - margin,
      y: r.y - margin,
      w: r.w + margin * 2,
      h: r.h + margin * 2,
    };
  }

  /** 脏标记 + 单帧合批广播：同帧多次变更 → epoch 立即更新但仅广播一次（React 单帧单渲） */
  private notify(): void {
    // 自愈（v1.7.1）：任何入口漏进来的非有限值在广播前重置回原点——
    // NaN transform 会永久污染（NaN 参与后续所有运算），渲染层表现为整幅图飞出画布。
    // 重置时**必须连视口动画一起取消**：进行中的动画每帧从（可能已污染的）插值状态
    // 写回 NaN，与自愈形成「写坏 → 重置 → 再写坏」的死循环（实测错误持续刷屏的根因）。
    const t = this.transform;
    if (!Number.isFinite(t.x) || !Number.isFinite(t.y) || !Number.isFinite(t.k) || t.k <= 0) {
      this.frame.cancelAnim(VIEWPORT_ANIM_SLOT);
      this.transform = { k: 1, x: 0, y: 0 };
    }
    this.epoch += 1;
    if (this.broadcasting) return;
    this.broadcasting = true;
    this.frame.request(() => {
      this.broadcasting = false;
      for (const l of [...this.listeners]) l();
    });
  }
}

/** 变换插值：k/x/y 线性（缓动由调度器 easeInOutQuad 提供） */
function lerpTransform(from: Transform, to: Transform, t: number): Transform {
  return {
    k: from.k + (to.k - from.k) * t,
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
  };
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
