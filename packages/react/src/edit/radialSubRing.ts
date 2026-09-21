/**
 * ② 二级环（外圈子环）· 数据与几何（v1.8.2）
 * ══════════════════════════════════════════════════════════════════════
 * 从 `radialActions.ts` 抽出（守 600 行预算）：席位池 / 外环配置 / 几何派生 / 命中判定。
 * 状态机留在 `radialActions.ts`——本文件只 type-import 类型，无运行时循环。
 */
import type { RadialGeometry } from './radialTypes.js';

/** 归一化到 [0, 360)（本地副本：避免与 radialActions 形成运行时循环） */
function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

// ─────────────────────── ② 二级环（外圈子环，v1.8.2） ───────────────────────

/**
 * 二级（外圈）动作项：**无 slot** —— 席位由角度顺序决定（数据序 = 角度序）。
 * 与一级同规范：16px stroke 图标路径。
 */
export interface RadialSubItem {
  id: string;
  label: string;
  hint?: string;
  icon: string[];
  /** 灰显不可选（条件不满足）——**不抽席**：顺序/角度保持稳定（marking 记忆） */
  disabled?: boolean;
  /**
   * 该席是「翻页席」：提交时切到指定页（`ctx.sub.pages` 的索引），不产出动作。
   * 用于方向型动作（升为中心 → 方向页）与页内「返回」（`opensPage: 0`）——仍属二级深度。
   */
  opensPage?: number;
}

/**
 * 二级候选池（B2 静态表初版）：「打开完整菜单」**恒为兜底末席**（渐进披露出口）。
 * 席位数 N ∈ {4,5,6} 由此表按序裁剪（与 `/radial.html` 沙盒滑杆一致）。
 */
export const RADIAL_SUB_POOL_V1: readonly RadialSubItem[] = [
  { id: 'sub:edit-desc', label: '编辑描述', hint: 'Shift+Enter', icon: ['M3.5 5h9', 'M3.5 8h6', 'M3.5 11h9'] },
  { id: 'sub:edit-note', label: '编辑笔记', icon: ['M4 3.5h8v9H4z', 'M6 6.5h4', 'M6 9h2.5'] },
  { id: 'sub:hub', label: '升级为出线枢纽', icon: ['M8 12.5V4', 'M5 7l3-3 3 3', 'M3.5 13h9'] },
  { id: 'sub:copy-center', label: '复制中心编号', icon: ['M6 3.5h6.5v6.5', 'M3.5 6h6.5v6.5h-6.5z'] },
  { id: 'sub:collapse', label: '折叠 / 展开', hint: 'Space', icon: ['M3.5 6.5h9', 'M3.5 9.5h9'] },
  { id: 'sub:more-menu', label: '打开完整菜单', hint: '右键', icon: ['M4.4 8h.01', 'M8 8h.01', 'M11.6 8h.01'] },
];

/** 席位裁剪：N=4/5/6 各取一版（首几席按池序，「打开完整菜单」恒为末席） */
export function radialSubItemsFor(seats: number): readonly RadialSubItem[] {
  const pool = RADIAL_SUB_POOL_V1;
  const last = pool.length - 1;
  const idx = seats <= 4 ? [0, 1, 2, last] : seats === 5 ? [0, 1, 2, 3, last] : [0, 1, 2, 3, 4, last];
  const out: RadialSubItem[] = [];
  for (const i of idx) {
    const it = pool[i];
    if (it && out.length < seats) out.push(it);
  }
  return out;
}

export interface RadialSubConfig {
  /** 外环带宽（px） */
  band: number;
  /** 与主环外缘的留缝（px） */
  gapPx: number;
}

export const RADIAL_SUB_DEFAULTS: RadialSubConfig = { band: 24, gapPx: 6 };

/** 外环命中宽容（px）——与一级 hitSlack 同旨（Fitts） */
const SUB_HIT_SLACK = 6;

export interface SubRingGeometry {
  cx: number;
  cy: number;
  innerR: number;
  outerR: number;
  band: number;
  /** 首席起始角（= 缺口终点，顺时针铺开） */
  startDeg: number;
  /** 每席跨度（度）= 可用弧 / count */
  spanDeg: number;
  count: number;
  /** 缺口中心角（与主环同源，供渲染缺口虚线） */
  gapCenterDeg: number;
  /** 缺口宽度（度） */
  gapWidthDeg: number;
}

/** 由主环几何派生外圈几何：沿**可用弧**（360° − 缺口）均分，缺口朝节点角语义继承 */
export function subRingOf(
  geo: RadialGeometry,
  count: number,
  cfg?: Partial<RadialSubConfig>,
): SubRingGeometry {
  const band = cfg?.band ?? RADIAL_SUB_DEFAULTS.band;
  const gapPx = cfg?.gapPx ?? RADIAL_SUB_DEFAULTS.gapPx;
  const innerR = geo.cfg.outerR + gapPx;
  const n = Math.max(1, count);
  return {
    cx: geo.cx,
    cy: geo.cy,
    innerR,
    outerR: innerR + band,
    band,
    startDeg: geo.cfg.gapCenterDeg + geo.cfg.gapWidthDeg / 2,
    spanDeg: (360 - geo.cfg.gapWidthDeg) / n,
    count: n,
    gapCenterDeg: geo.cfg.gapCenterDeg,
    gapWidthDeg: geo.cfg.gapWidthDeg,
  };
}

/** 席位中心角（浮标定位用） */
export function subSeatCenterDeg(sub: SubRingGeometry, i: number): number {
  return sub.startDeg + sub.spanDeg * i + sub.spanDeg / 2;
}

/** 屏幕坐标 → 子环席位（null = 未命中：不在外环带 / 落在缺口取消带 / 界外） */
export function hitSubSeat(sub: SubRingGeometry, x: number, y: number): number | null {
  const r = Math.hypot(x - sub.cx, y - sub.cy);
  if (r < sub.innerR - SUB_HIT_SLACK || r > sub.outerR + SUB_HIT_SLACK) return null;
  const a = norm360((Math.atan2(y - sub.cy, x - sub.cx) * 180) / Math.PI);
  const i = Math.floor(norm360(a - sub.startDeg) / sub.spanDeg);
  return i >= 0 && i < sub.count ? i : null;
}

/** 主环带命中（B3：level 2 时点击/悬停内圈 = 降级返回一级） */
export function hitInnerRing(geo: RadialGeometry, x: number, y: number): boolean {
  const r = Math.hypot(x - geo.cx, y - geo.cy);
  return r >= geo.cfg.innerR - SUB_HIT_SLACK && r <= geo.cfg.outerR + SUB_HIT_SLACK;
}
