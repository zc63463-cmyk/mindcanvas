/**
 * 动画常量集中管理（M5 纪律：动画时长/缓动不散落组件，与 theme token.motion 分工：
 * token.motion = chrome/CSS 过渡令牌；本文件 = JS 动画时长常量 + 系统级判定）。
 */

/** 节点位置过渡时长（ms）——折叠/展开、增删、缩进/反缩进 */
export const NODE_ANIM_MS = 240;

/** 视口动画时长（ms）——聚焦跳转 / 适配视图 / 边界回弹 */
export const VIEWPORT_ANIM_MS = 280;

/** 新节点淡入起点缩放（0.8 → 1） */
export const NODE_FADE_IN_SCALE = 0.8;

/** 删除节点淡出终点缩放（1 → 0.8） */
export const NODE_FADE_OUT_SCALE = 0.8;

/**
 * 节点位置过渡的最大规模（节点数）。超过则跳过动画直接落位——大图保护：
 * 动画需每帧重渲全部可见节点，节点越多帧率越不稳；阈值内保证动画帧率 ≥ 50fps 的工程余量。
 */
export const NODE_ANIM_MAX_NODES = 3000;

// ---------- 缩放平移手感（M5-T4） ----------

/** 缩放硬边界（滚轮/双击越界后软回弹；fit 亦受此约束） */
export const ZOOM_MIN = 0.15;
export const ZOOM_MAX = 4;

/** 越界弹性余量系数：允许短暂超出边界的倍数（上限 ×1.3 / 下限 ÷1.3），随后回弹 */
export const ZOOM_OVERSHOOT = 1.3;

/** 边界回弹时长（ms） */
export const ZOOM_BOUNCE_MS = 130;

/** 拖拽惯性触发速度阈值（px/ms；松手速度低于此则直接静止） */
export const PAN_INERTIA_TRIGGER = 0.8;

/** 拖拽惯性指数衰减时间常数 τ（ms）——总滑行距离 ≈ v₀·τ，约 3τ 后基本静止 */
export const PAN_INERTIA_TAU = 240;

/** 拖拽速度采样窗口（最近 N 个采样点参与估计） */
export const PAN_SAMPLE_WINDOW = 3;

/** 系统「减少动态」偏好（SSR/无 matchMedia 环境视为未开启） */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
