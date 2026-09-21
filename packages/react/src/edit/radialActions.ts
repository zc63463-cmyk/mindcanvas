/**
 * 环形快捷操作（Radial Menu）· 纯逻辑层 —— v1.8.0 Phase 1
 * ══════════════════════════════════════════════════════════════════════
 * 与 beamDrag.ts 同先例：本模块只做「几何 / 命中 / 键盘漫游 / 时序状态机」，
 * 零 React、零 DOM、零依赖——可在 node 里直接跑，渲染与事件接线在组件层（Phase 2）。
 *
 * 设计要点（设计评审结论）：
 *
 * 1. **marking menu 双通道**：Alt 按住 ≥ RADIAL_HOLD_MS → 环浮现（可见菜单通道）；
 *    Alt+方向键「快击」（阈值内）→ 产出 pre-dir 效果，交还既有「预方向」语义
 *    （专家肌肉记忆零破坏）。慢按=菜单、快击=手势——同一按键的两种熟练度。
 *
 * 2. **方向键直映射扇区**（ArrowUp→上、ArrowRight→右…），不做环形轮转：
 *    直映射可盲操（marking 语义）；轮转依赖当前位置、需要计数，是反模式。
 *
 * 3. **命中区宽容**：距锚点 [deadR, outerR+hitSlack] 的整个环带都算命中（innerR 只影响
 *    观感，内孔仍按角度归属扇区）；缺口（gap）朝**所依附的节点角**（环挂在节点盒右上角，
 *    节点在锚点左下 → 缺口中心 135°）——既是视觉上的「依附开口」，也是取消带。
 *
 * 4. **动作源单一**：环上动作与右键菜单同源（Phase 2 由 contextMenuItemsFor 过滤生成）；
 *    本文件内置 V1 一等动作表 RADIAL_ITEMS_V1 作为默认。
 *
 * 角度约定：度数制；0° = 屏幕正右（+x），顺时针为正（屏幕 y 向下）。
 * 于是：上 = 270°（≡ -90°）、右 = 0°、下 = 90°、左 = 180°；缺口中心 = 135°（左下）。
 */

import {
  hitInnerRing,
  hitSubSeat,
  radialSubItemsFor,
  subRingOf,
  type RadialSubConfig,
  type RadialSubItem,
} from './radialSubRing.js';


// ─────────────────────────── 类型 ───────────────────────────

/** 槽位（四向；与 kernel GrowDir 的前四值同构——本模块保持零依赖故本地定义） */
export type RadialSlotKey = 'up' | 'right' | 'down' | 'left';

export interface RadialItem {
  /** 稳定 id（Phase 2：与右键菜单项 id 对齐，保证「同一动作源、两个渲染器」） */
  id: string;
  slot: RadialSlotKey;
  /** 浮动说明主文案 */
  label: string;
  /** 键提示（如 Tab / Del），可选 */
  hint?: string;
  /** 危险操作（渲染红色语义；提交前可加二次确认） */
  danger?: boolean;
  /** 置灰：不可高亮、不可提交 */
  disabled?: boolean;
  /** 16×16 stroke 图标：path `d` 数组（渲染层直接铺 <path>，linecap=round） */
  icon: readonly string[];
}

/**
 * 几何类型（`RadialGeometryConfig` / `RadialGeometry`）在**中立模块** `radialTypes.ts`：
 * 外圈几何（`radialSubRing.ts`）与状态机都需要它们，放这里会与 subRing 形成 depcruise 依赖环。
 * 此处 import（本文件自用）+ re-export（公开 API 与既有 import 路径不变）。
 */
import type { RadialGeometry, RadialGeometryConfig } from './radialTypes.js';
export type { RadialGeometry, RadialGeometryConfig } from './radialTypes.js';

/** 环的锚点：所选节点盒的右上角（屏幕坐标） */
export interface RadialOrigin {
  /** 所属节点（Phase 2 用于定位与提交上下文） */
  nodeId: string;
  cx: number;
  cy: number;
}

export type RadialPhase = 'idle' | 'arming' | 'ring' | 'pre-dir';

export interface RadialState {
  phase: RadialPhase;
  origin: RadialOrigin | null;
  altDownAt: number;
  highlight: RadialSlotKey | null;
  /**
   * 层级（v1.8.2 ② 二级环）：1 = 主环；2 = 外圈子环展开中（origin 保留，两环同场景渲染）。
   * 缺省 1——既有构造（含测试）无需改动。
   */
  level?: 1 | 2;
  /** 进二级时的父槽位（'left' = 「更多」）；level 1 时 null */
  parentSlot?: RadialSlotKey | null;
  /** 二级高亮席位下标（数据序 = 角度序）；仅 level 2 有意义 */
  subIndex?: number | null;
  /** 二级当前页（0 = 主席位页；>0 = 方向/子页）；仅 level 2 有意义 */
  subPage?: number;
}

export type RadialEvent =
  | { t: 'alt-down'; now: number; origin: RadialOrigin }
  | { t: 'alt-up' }
  | { t: 'tick'; now: number }
  | { t: 'arrow'; key: string }
  | { t: 'hover'; x: number; y: number }
  | { t: 'click'; x: number; y: number }
  | { t: 'confirm' }
  | { t: 'cancel' };

export type RadialEffect =
  | { kind: 'none' }
  /** 快击通道：交还既有预方向（Phase 2 接入 keys.ts / 控制器） */
  | { kind: 'pre-dir'; dir: RadialSlotKey }
  | { kind: 'open' }
  | { kind: 'commit'; itemId: string; slot: RadialSlotKey }
  | { kind: 'close' };

export interface RadialReduceCtx {
  /** 几何配置（缺省 RADIAL_GEOMETRY_DEFAULTS） */
  cfg?: Partial<RadialGeometryConfig>;
  /** 按住阈值覆盖（预览调参用）；缺省 RADIAL_HOLD_MS */
  holdMs?: number;
  /**
   * ② 二级环（沙盒启用；**缺省不启用** → 行为与既有版本完全一致，画布零影响）。
   * 启用后：一级「更多」的提交不再产出 commit 效果，而是**下钻**（外圈浮现）。
   */
  sub?: {
    /** 主页席位数（0 = 不启用）；提供 `pages` 时以 `pages[0].length` 为准 */
    seats: number;
    /** 外环配置（带宽 / 留缝） */
    cfg?: Partial<RadialSubConfig>;
    /**
     * 多页席位（可选）：`pages[0]` = 主页，其余页由「翻页席」`opensPage` 进入；
     * 页内末席惯例放一个 `opensPage: 0` 的「返回」。缺省 = 单页 `radialSubItemsFor(seats)`。
     */
    pages?: readonly (readonly RadialSubItem[])[];
  };
}

// ─────────────────────────── 常量 ───────────────────────────

/** 按住多久算「菜单通道」（毫秒）；快于此阈值内的 Alt+方向键 = 预方向（手势通道） */
export const RADIAL_HOLD_MS = 250;

/** 四向槽位（顺时针自上方起）：命中顺序稳定，渲染同此顺序 */
export const RADIAL_SLOTS: ReadonlyArray<{ key: RadialSlotKey; centerDeg: number }> = [
  { key: 'up', centerDeg: 270 },
  { key: 'right', centerDeg: 0 },
  { key: 'down', centerDeg: 90 },
  { key: 'left', centerDeg: 180 },
];

/** 槽位半宽（度）：4 槽均分 360°，中心 ±45° 为归属范围（半开区间） */
const SLOT_HALF_DEG = 45;

export const RADIAL_GEOMETRY_DEFAULTS: RadialGeometryConfig = {
  innerR: 26,
  outerR: 52,
  deadR: 16,
  gapCenterDeg: 135, // 缺口朝节点（锚点=节点右上角，节点在锚点左下）
  gapWidthDeg: 64,
  hitSlack: 10,
};

export const RADIAL_IDLE: RadialState = { phase: 'idle', origin: null, altDownAt: 0, highlight: null };


// ② 二级环的数据/几何在同目录 `radialSubRing.ts`（守 600 行预算）；此处再导出，保持对外 API 不变
export {
  hitInnerRing,
  hitSubSeat,
  RADIAL_SUB_DEFAULTS,
  RADIAL_SUB_POOL_V1,
  radialSubItemsFor,
  subRingOf,
  subSeatCenterDeg,
} from './radialSubRing.js';
export type { RadialSubConfig, RadialSubItem, SubRingGeometry } from './radialSubRing.js';

/** V1 一等动作：新建（上）/ 编辑（右）/ 删除（下，danger）/ 更多（左，渐进披露） */
export const RADIAL_ITEMS_V1: readonly RadialItem[] = [
  { id: 'add-child', slot: 'up', label: '新建子节点', hint: 'Tab', icon: ['M8 3.5v9', 'M3.5 8h9'] },
  {
    id: 'edit-text',
    slot: 'right',
    label: '编辑文本',
    hint: 'F2',
    icon: ['M4.2 11.8 5 9.2l5.6-5.6a1.35 1.35 0 0 1 1.9 1.9L6.9 11.1l-2.7.7Z'],
  },
  {
    id: 'delete',
    slot: 'down',
    label: '删除节点',
    hint: 'Del',
    danger: true,
    icon: ['M4 5.2h8', 'M6.6 5.2V3.6h2.8v1.6', 'M5.2 5.2l.6 7.2h4.4l.6-7.2'],
  },
  {
    id: 'more',
    slot: 'left',
    label: '更多操作…',
    hint: '右键',
    icon: ['M4.4 8h.01', 'M8 8h.01', 'M11.6 8h.01'],
  },
];

// ─────────────────────────── 角度工具 ───────────────────────────

/** 归一化到 [0, 360) */
function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** 角度 a 是否在 [start, start+span)（度，环绕安全） */
function inArc(a: number, start: number, span: number): boolean {
  return norm360(a - start) < norm360(span);
}

/** 槽位角度区间（半开：对角线归起始侧，消除边界歧义） */
function slotRange(slot: { centerDeg: number }): { start: number; span: number } {
  return { start: slot.centerDeg - SLOT_HALF_DEG, span: SLOT_HALF_DEG * 2 };
}

// ─────────────────────────── 几何 / 命中 / 渲染弧 ───────────────────────────

export function radialGeometryFor(
  cx: number,
  cy: number,
  cfg?: Partial<RadialGeometryConfig>,
): RadialGeometry {
  return { cx, cy, cfg: { ...RADIAL_GEOMETRY_DEFAULTS, ...cfg } };
}

/** 由状态取锚点构建几何（idle / 无锚点 → null） */
export function radialGeometryOf(
  state: RadialState,
  cfg?: Partial<RadialGeometryConfig>,
): RadialGeometry | null {
  if (!state.origin) return null;
  return radialGeometryFor(state.origin.cx, state.origin.cy, cfg);
}

/**
 * 屏幕坐标 → 槽位（null = 未命中：死区 / 超出外缘+宽容 / 落在缺口取消带）。
 */
export function hitTest(geo: RadialGeometry, x: number, y: number): RadialSlotKey | null {
  const { cfg } = geo;
  const r = Math.hypot(x - geo.cx, y - geo.cy);
  if (r < cfg.deadR || r > cfg.outerR + cfg.hitSlack) return null;
  const a = norm360((Math.atan2(y - geo.cy, x - geo.cx) * 180) / Math.PI);
  if (inArc(a, cfg.gapCenterDeg - cfg.gapWidthDeg / 2, cfg.gapWidthDeg)) return null;
  for (const s of RADIAL_SLOTS) {
    const { start, span } = slotRange(s);
    if (inArc(a, start, span)) return s.key;
  }
  return null;
}

/** 方向键 → 槽位（直映射；无匹配 → null） */
export function slotForArrowKey(key: string): RadialSlotKey | null {
  switch (key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowRight':
      return 'right';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    default:
      return null;
  }
}

/**
 * 可见弧段（供渲染层画环）：槽位区间扣掉缺口后的片段（度）。
 * 4 槽 + 单缺口（< 90°）⇒ 每槽至多剩一段，缺口只可能切到缺口相邻的两槽。
 */
export function visibleArcs(
  geo: RadialGeometry,
): Array<{ key: RadialSlotKey; startDeg: number; spanDeg: number }> {
  const gapStart = geo.cfg.gapCenterDeg - geo.cfg.gapWidthDeg / 2;
  const gapEnd = gapStart + geo.cfg.gapWidthDeg;
  const out: Array<{ key: RadialSlotKey; startDeg: number; spanDeg: number }> = [];
  for (const s of RADIAL_SLOTS) {
    const { start, span } = slotRange(s);
    if (inArc(gapStart, start, span)) {
      const left = norm360(gapStart - start); // 缺口切走区间末尾
      if (left > 1) out.push({ key: s.key, startDeg: start, spanDeg: left });
    } else if (inArc(gapEnd, start, span)) {
      const left = norm360(start + span - gapEnd); // 缺口切走区间开头
      if (left > 1) out.push({ key: s.key, startDeg: gapEnd, spanDeg: left });
    } else {
      out.push({ key: s.key, startDeg: start, spanDeg: span });
    }
  }
  return out;
}

/** 槽位 → 可用动作（disabled 视同无） */
export function itemAt(items: readonly RadialItem[], slot: RadialSlotKey): RadialItem | null {
  return items.find((it) => it.slot === slot && !it.disabled) ?? null;
}

// ─────────────────────────── 时序状态机 ───────────────────────────

const NONE: RadialEffect = { kind: 'none' };

// ── ② 二级环：reduce 分派辅助（`ctx.sub` 缺省时全部走原路径 → 画布零影响） ──

/** 主页席位数（提供 `pages` 时以主页长度为准） */
const subSeatsOf = (ctx: RadialReduceCtx): number => ctx.sub?.pages?.[0]?.length ?? ctx.sub?.seats ?? 0;

/** 当前页号（负数夹到 0；越界由 `subItemsOf` 夹回末页） */
const subPageOf = (state: RadialState): number => Math.max(0, state.subPage ?? 0);

/** 二级当前页席位（缺省单页 = `radialSubItemsFor(seats)`） */
function subItemsOf(state: RadialState, ctx: RadialReduceCtx): readonly RadialSubItem[] {
  const pages = ctx.sub?.pages;
  if (pages && pages.length > 0) {
    const p = Math.min(subPageOf(state), pages.length - 1);
    return pages[p] ?? [];
  }
  const seats = subSeatsOf(ctx);
  return seats > 0 ? radialSubItemsFor(seats) : [];
}

/** 轮转一格并跳过灰显席（全灰 → null） */
function nextEnabled(items: readonly RadialSubItem[], from: number | null, step: number): number | null {
  const n = items.length;
  if (n === 0) return null;
  let idx = from === null ? (step > 0 ? 0 : n - 1) : (from + step + n) % n;
  for (let k = 0; k < n; k++) {
    if (!items[idx]?.disabled) return idx;
    idx = (idx + step + n) % n;
  }
  return null;
}

/** 一级提交统一出口：命中「更多」且二级启用 → **下钻**（保留 origin，两环同场景渲染） */
function commitLevel1(
  state: RadialState,
  item: RadialItem,
  ctx: RadialReduceCtx,
): { state: RadialState; effect: RadialEffect } {
  if (item.id === 'more' && subSeatsOf(ctx) > 0) {
    return {
      state: { ...state, level: 2, parentSlot: item.slot, subIndex: null, subPage: 0, highlight: item.slot },
      effect: NONE,
    };
  }
  return { state: RADIAL_IDLE, effect: { kind: 'commit', itemId: item.id, slot: item.slot } };
}

/** 二级席位统一出口：灰显/空席 → null；翻页席 → 切页；其余 → 提交 */
function commitSubOrPage(
  state: RadialState,
  idx: number | null,
  ctx: RadialReduceCtx,
): { state: RadialState; effect: RadialEffect } | null {
  const items = subItemsOf(state, ctx);
  const it = idx !== null ? items[idx] : undefined;
  if (!it || it.disabled) return null;
  if (it.opensPage !== undefined) {
    return { state: { ...state, subPage: it.opensPage, subIndex: null }, effect: NONE };
  }
  return {
    state: RADIAL_IDLE,
    effect: { kind: 'commit', itemId: it.id, slot: state.parentSlot ?? 'left' },
  };
}

/**
 * 环状态机（纯函数）。
 *
 * 相位流转：
 *   idle --alt-down--> arming --tick(≥hold)--> ring --alt-up(有高亮)--> commit
 *                        |                      |--alt-up(无高亮)/cancel--> close
 *                        |--arrow(快击)--> pre-dir --alt-up--> idle（环不浮现）
 *   ring 内：arrow/悬停 → 高亮；click/confirm → 立即提交或取消。
 *
 * 「快击 vs 慢按」由相位承载——alt-down 后的定时器驱动 tick；箭头先于 tick 到达即快击。
 */
export function radialReduce(
  state: RadialState,
  event: RadialEvent,
  items: readonly RadialItem[],
  ctx: RadialReduceCtx = {},
): { state: RadialState; effect: RadialEffect } {
  const hold = ctx.holdMs ?? RADIAL_HOLD_MS;
  switch (event.t) {
    case 'alt-down': {
      if (state.phase !== 'idle') return { state, effect: NONE };
      return {
        state: { phase: 'arming', origin: event.origin, altDownAt: event.now, highlight: null },
        effect: NONE,
      };
    }
    case 'tick': {
      if (state.phase === 'arming' && event.now - state.altDownAt >= hold) {
        return { state: { ...state, phase: 'ring' }, effect: { kind: 'open' } };
      }
      return { state, effect: NONE };
    }
    case 'arrow': {
      const dir = slotForArrowKey(event.key);
      if (dir === null) return { state, effect: NONE };
      if (state.phase === 'arming' || state.phase === 'pre-dir') {
        // 快击通道：不浮现环，交还预方向（连续按可改方向，与既有语义一致）
        return { state: { ...state, phase: 'pre-dir' }, effect: { kind: 'pre-dir', dir } };
      }
      if (state.phase === 'ring') {
        if ((state.level ?? 1) === 2) {
          // 二级：←/↑ 逆时针、→/↓ 顺时针（数据序 = 角度序；**跳过灰显席**）
          const sub2 = subItemsOf(state, ctx);
          if (sub2.length === 0) return { state, effect: NONE };
          const step = dir === 'left' || dir === 'up' ? -1 : 1;
          return {
            state: { ...state, subIndex: nextEnabled(sub2, state.subIndex ?? null, step) },
            effect: NONE,
          };
        }
        const next = itemAt(items, dir) ? dir : null;
        return { state: { ...state, highlight: next }, effect: NONE };
      }
      return { state, effect: NONE };
    }
    case 'hover': {
      if (state.phase !== 'ring') return { state, effect: NONE };
      const geo = radialGeometryOf(state, ctx.cfg);
      if (!geo) return { state, effect: NONE };
      if ((state.level ?? 1) === 2) {
        const sub2 = subItemsOf(state, ctx);
        if (sub2.length === 0) return { state, effect: NONE };
        const sub = subRingOf(geo, sub2.length, ctx.sub?.cfg);
        const i = hitSubSeat(sub, event.x, event.y);
        return { state: { ...state, subIndex: i !== null && !sub2[i]?.disabled ? i : null }, effect: NONE };
      }
      const slot = hitTest(geo, event.x, event.y);
      const next = slot !== null && itemAt(items, slot) ? slot : null;
      return { state: { ...state, highlight: next }, effect: NONE };
    }
    case 'click': {
      if (state.phase !== 'ring') return { state, effect: NONE };
      const geo = radialGeometryOf(state, ctx.cfg);
      if ((state.level ?? 1) === 2 && geo) {
        const sub2 = subItemsOf(state, ctx);
        if (sub2.length === 0) return { state, effect: NONE };
        const sub = subRingOf(geo, sub2.length, ctx.sub?.cfg);
        const i = hitSubSeat(sub, event.x, event.y);
        if (i !== null) {
          // 点中席位：灰显 → 无效（保持）；翻页席 → 切页；其余 → 提交
          return commitSubOrPage(state, i, ctx) ?? { state, effect: NONE };
        }
        if (hitInnerRing(geo, event.x, event.y)) {
          const p = subPageOf(state);
          if (p > 0) {
            // B4：子页里点内圈 = 回上一页（不降级）
            return { state: { ...state, subPage: p - 1, subIndex: null }, effect: NONE };
          }
          // B3：主页里点内圈 = 降级返回一级（松 Alt 仍未提交，环保持）
          return { state: { ...state, level: 1, parentSlot: null, subIndex: null, subPage: 0 }, effect: NONE };
        }
        return { state: RADIAL_IDLE, effect: { kind: 'close' } };
      }
      const slot = geo ? hitTest(geo, event.x, event.y) : null;
      const item = slot !== null ? itemAt(items, slot) : null;
      if (item) return commitLevel1(state, item, ctx);
      return { state: RADIAL_IDLE, effect: { kind: 'close' } };
    }
    case 'confirm': {
      if (state.phase !== 'ring') return { state, effect: NONE };
      if ((state.level ?? 1) === 2) {
        // Enter：提交高亮席；翻页席 = 进页（Enter 是「进页」的推荐键）
        return commitSubOrPage(state, state.subIndex ?? null, ctx) ?? { state, effect: NONE };
      }
      const item = state.highlight !== null ? itemAt(items, state.highlight) : null;
      if (item) return commitLevel1(state, item, ctx);
      return { state: RADIAL_IDLE, effect: { kind: 'close' } };
    }
    case 'alt-up': {
      if (state.phase === 'ring') {
        if ((state.level ?? 1) === 2) {
          // 二级：有高亮席 = 提交；翻页席 / 灰显 / 无高亮 → 收起
          // （松键语义 = 提交或关闭；进页请用 Enter 或点击——避免「松手后环悬空」）
          const items2 = subItemsOf(state, ctx);
          const si = state.subIndex ?? null;
          const it = si !== null ? items2[si] : undefined;
          if (it && !it.disabled && it.opensPage === undefined) {
            return {
              state: RADIAL_IDLE,
              effect: { kind: 'commit', itemId: it.id, slot: state.parentSlot ?? 'left' },
            };
          }
          return { state: RADIAL_IDLE, effect: { kind: 'close' } };
        }
        const item = state.highlight !== null ? itemAt(items, state.highlight) : null;
        if (item) return commitLevel1(state, item, ctx);
        return { state: RADIAL_IDLE, effect: { kind: 'close' } };
      }
      // arming（轻按 Alt 没等到悬浮）/ pre-dir（已走手势通道）→ 静默复位
      return { state: RADIAL_IDLE, effect: NONE };
    }
    case 'cancel': {
      if (state.phase === 'ring') return { state: RADIAL_IDLE, effect: { kind: 'close' } };
      return { state: RADIAL_IDLE, effect: NONE };
    }
    default:
      return { state, effect: NONE };
  }
}
