/**
 * edgeRouting —— 连线智能避障路由（纯函数，零 DOM，可单测）。
 *
 * 背景（用户反馈）：原 `buildFreeEdgePath` 只是在两端点间拉一条「恒定法向弓高」的三次贝塞尔，
 * 全程不感知路径上的其他节点卡片 → 连线直接穿过节点。GD 2009（Wybrow/Marriott/Stuckey，
 * libavoid 作者）明确指出这类做法属 "ad-hoc heuristics ... even routes that pass through other objects"。
 *
 * 选型（历经三代，仅第三代保留）：
 *   ① 网格 A* + 走廊裁剪 + 拉绳简化 + 圆角平滑（react-flow-smart-edge 同款路线）—— 已移除。
 *      输出正交折线与思维导图曲线审美冲突；且长边走廊会撑爆网格（实测 300 边 873ms）。
 *   ② trunk 主干折线（markvault 风格）—— 已移除。折角生硬，避障靠反复重试撑开通道。
 *   ③ 曲率自适应单贝塞尔（当前，见 routeAesthetic）：枚举「锚点对 × 曲率档位」，
 *      按美学评分取优，输出单条三次贝塞尔。
 * 另：未采用 libavoid 的「正交可见性图」，理由见
 * docs/research/2026-08-31-edge-routing-algorithm-research.md —— 直角折线与曲线审美冲突，
 * 且移植成本约 2000 行。
 *
 * 设计要点（性能与回归控制）：
 * - 空旷直连：走廊内无障碍 → 直接连直线，完全跳过枚举（大多数边零成本）
 * - 走廊裁剪：先对「中心连线 ± corridorMargin」内的障碍粗筛否决，再对全量障碍复核
 * - 早停：按 |曲率| 升序枚举，命中优质解即停，兼顾观感与性能
 * - 降级：所有组合均穿障 → 直线直穿（SBGN：crossing boundary only twice），绝不空白
 */
import type { Box } from '@mindcanvas/kernel';

/** 障碍物（世界坐标矩形） */
export interface RouteObstacle extends Box {}

/** 路由结果 */
export interface RouteResult {
  /** SVG path d */
  d: string;
  /** 折线顶点（世界坐标，已简化） */
  points: readonly { x: number; y: number }[];
  /** true = 靠"弯曲"真的绕了行；false = 直连（空旷/通畅）或降级直穿 */
  routed: boolean;
  /**
   * R3-4：仅在「forceSide 指定了侧 且 走到直穿降级（本文件尾部 fallback）」时置位
   * ——routed:false 的两种含义（空旷直连 / 降级直穿）不可区分（语义被大量测试
   * 依赖，R3-A4 不动），本标志让「用户指定侧无解被静默降级」变得可见。
   */
  forcedSideFallback?: boolean;
  /** 路径中点（标签锚点） */
  mid: { x: number; y: number };
  /** 中点处单位法向（标签生长方向） */
  nx: number;
  ny: number;
}

export const DEFAULT_CORRIDOR_MARGIN = 180;

/**
 * 「是否受阻」判定所用外扩——必须显著小于布局的兄弟间距（内核 V_GAP = 14），
 * 否则相邻节点的外扩盒子会把中间通道整个堵死，导致相邻节点之间也走无谓的大绕行。
 * 这里只判定"线是否擦到卡片"；与卡片的视觉净距不由此外扩保证，而是由锚点选择与曲率绕行自然产生。
 */
export const DEFAULT_BLOCK_PADDING = 3;
/** 通畅性检测的贝塞尔采样数 */
const CLEAR_SAMPLES = 24;

// ---------- 基础几何 ----------

/**
 * 线段是否与矩形（含外扩）相交。
 * 先做 AABB 粗筛，再用 Liang-Barsky 参数化裁剪做精确判定（含线段完全在矩形内的情形）。
 */
export function segmentIntersectsRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r: RouteObstacle,
  pad = 0,
): boolean {
  const minX = r.x - pad;
  const maxX = r.x + r.w + pad;
  const minY = r.y - pad;
  const maxY = r.y + r.h + pad;
  // AABB 粗筛
  if (Math.max(x1, x2) < minX || Math.min(x1, x2) > maxX) return false;
  if (Math.max(y1, y2) < minY || Math.min(y1, y2) > maxY) return false;
  // 端点在内 → 相交
  if (x1 >= minX && x1 <= maxX && y1 >= minY && y1 <= maxY) return true;
  if (x2 >= minX && x2 <= maxX && y2 >= minY && y2 <= maxY) return true;
  // Liang-Barsky 线段 vs 矩形裁剪
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return clip(-dx, x1 - minX) && clip(dx, maxX - x1) && clip(-dy, y1 - minY) && clip(dy, maxY - y1);
}

/** 折线是否与任一障碍（含外扩）相交 */
export function polylineHitsObstacle(
  pts: readonly { x: number; y: number }[],
  obstacles: readonly RouteObstacle[],
  pad = 0,
): boolean {
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    for (const o of obstacles) {
      if (segmentIntersectsRect(a.x, a.y, b.x, b.y, o, pad)) return true;
    }
  }
  return false;
}

/** 三次贝塞尔采样为折线（通畅性检测 / 中点法向共用） */
export function sampleCubic(
  p0: { x: number; y: number },
  c1: { x: number; y: number },
  c2: { x: number; y: number },
  p3: { x: number; y: number },
  n = CLEAR_SAMPLES,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const w0 = u * u * u;
    const w1 = 3 * u * u * t;
    const w2 = 3 * u * t * t;
    const w3 = t * t * t;
    out.push({
      x: w0 * p0.x + w1 * c1.x + w2 * c2.x + w3 * p3.x,
      y: w0 * p0.y + w1 * c1.y + w2 * c2.y + w3 * p3.y,
    });
  }
  return out;
}

/**
 * 点到矩形的净空距离（落在矩形内时返回 0）。
 *
 * 用于「净空成本」：衡量路径离最近卡片有多远 —— 这是"贴着节点群挤过去"与
 * "绕到节点群外侧"之间最直接的区别，比"是否相交"多了一个距离维度。
 */
export function pointClearance(p: { x: number; y: number }, r: RouteObstacle): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

// ---------- 走廊与网格 ----------

/** 只保留与「两端点包围盒 + margin」相交的障碍（宽相位筛选） */
export function corridorObstacles(
  p0: { x: number; y: number },
  p3: { x: number; y: number },
  margin: number,
  obstacles: readonly RouteObstacle[],
): RouteObstacle[] {
  const minX = Math.min(p0.x, p3.x) - margin;
  const maxX = Math.max(p0.x, p3.x) + margin;
  const minY = Math.min(p0.y, p3.y) - margin;
  const maxY = Math.max(p0.y, p3.y) + margin;
  return obstacles.filter(
    (o) => o.x <= maxX && o.x + o.w >= minX && o.y <= maxY && o.y + o.h >= minY,
  );
}

// ═══════════════════════════════════════════════════════════════════
// 曲率自适应贝塞尔路由（外围绕行优先）
//
// 设计目标（纠正此前「最短路径优先」的错误）：
//   图绘制美学实证给出的优先级为
//     最小化交叉 > 最小化弯曲 > 最大化对称 >…> 最短边长（末位）
//   且研究记录的用户偏好是把组件放在图 outer face（外层面）。
//
// 故本路由的优化顺序为：不穿节点 → 走外围 → 少交叉 → 少弯曲 → 短路径。
// 输出**单条三次贝塞尔曲线**（与 XMind / Miro / MindManager 一致），
// 而非多段折线 —— Gestalt good continuation 主张平滑连续轮廓优于锯齿折线。
// ═══════════════════════════════════════════════════════════════════

/**
 * 曲率档位：负 / 正分别朝连线法向的两侧鼓。
 * 0 = 直线（可能穿过节点群）；绝对值越大越往外绕。
 */
export const DEFAULT_CURVATURE_STEPS: readonly number[] = [
  -2.0, -1.5, -1.0, -0.7, -0.45, -0.25, 0, 0.25, 0.45, 0.7, 1.0, 1.5, 2.0,
];

/** 美学评分权重（分值越低越好） */
export interface AestheticWeights {
  /** 与已有边交叉的罚分（最高优先级，对应"最小化交叉"） */
  crossing?: number;
  /** 朝障碍质心方向鼓（内凸）的罚分 —— 鼓励外绕 */
  inward?: number;
  /**
   * 「净空不足」罚分：采样点距最近卡片小于 clearTarget 的占比。
   *
   * 这是对用户「又走中心了」反馈的根本修复。「是否相交」是个布尔量，抓不到
   * 「不碰任何卡片、却贴着节点群从缝隙里挤过去」这种形态 —— 那正是投诉的样子。
   * 净空成本补上了这个距离维度：离卡片越近罚分越重，于是绕到节点群外侧
   * 天然优于从缝里穿过（侧边优先）。
   *
   * 取值域 [0, 权重]，与 bend 必须同量级，否则 bend 拉不住它（见 bend 注释）。
   */
  clearance?: number;
  /**
   * 曲率绝对值罚分 —— 鼓励平缓。
   *
   * **必须与 clearance 同量级**：clearance 项取值域是 [0, clearance]，
   * bend 项取值域是 [0, bend × 2]（曲率档位最大 |c| = 2）。bend 过小则
   * "把曲率拉满"总能靠改善净空赚回更多分，结果是弧高 150% 弦长的巨型弧。
   */
  bend?: number;
  /** 路径长度罚分 —— 末位，权重最低 */
  length?: number;
}

/**
 * 沿盒子四边均匀取锚点候选（跳过角点，角点在视觉上不如边上的点自然）。
 *
 * 对应 XMind「端点沿主题边缘滑动寻找 best connection position」与
 * tldraw 的归一化锚点思路；此处直接产出世界坐标便于评分。
 *
 * @param box 目标盒
 * @param perSide 每条边的采样数（默认 3）
 * @param avoidCorners 距角点的内缩比例（默认 0.15，避免取到角上）
 */
export function edgeAnchorCandidates(
  box: Box,
  perSide = 3,
  avoidCorners = 0.15,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  if (box.w <= 0 || box.h <= 0) return [{ x: box.x, y: box.y }];
  const inset = avoidCorners; // 归一化内缩
  for (let i = 0; i < perSide; i++) {
    // 沿边均匀分布，并用 inset 把端点从角上往里收
    const t = (i + 1) / (perSide + 1);
    const tx = box.x + box.w * (inset + t * (1 - 2 * inset));
    const ty = box.y + box.h * (inset + t * (1 - 2 * inset));
    out.push({ x: tx, y: box.y }); // 上边
    out.push({ x: tx, y: box.y + box.h }); // 下边
    out.push({ x: box.x, y: ty }); // 左边
    out.push({ x: box.x + box.w, y: ty }); // 右边
  }
  return out;
}

/** 由锚点对 + 曲率生成三次贝塞尔（返回控制点、采样点、中点、法向） */
export function bezierFromAnchors(
  p0: { x: number; y: number },
  p3: { x: number; y: number },
  curvature: number,
): {
  c1: { x: number; y: number };
  c2: { x: number; y: number };
  d: string;
  mid: { x: number; y: number };
  nx: number;
  ny: number;
} {
  const dx = p3.x - p0.x;
  const dy = p3.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = len * curvature;
  // 法向（垂直于连线方向）
  const nxu = (-dy / len) * bow;
  const nyu = (dx / len) * bow;
  const c1 = { x: p0.x + dx * 0.35 + nxu, y: p0.y + dy * 0.35 + nyu };
  const c2 = { x: p0.x + dx * 0.65 + nxu, y: p0.y + dy * 0.65 + nyu };
  const mid = {
    x: 0.125 * p0.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * p3.x,
    y: 0.125 * p0.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * p3.y,
  };
  // 曲线在中点的切向 → 法向（归一：优先朝上，次优先朝右）
  const tx = p3.x + c2.x - c1.x - p0.x;
  const ty = p3.y + c2.y - c1.y - p0.y;
  const tl = Math.hypot(tx, ty) || 1;
  let nx = -ty / tl;
  let ny = tx / tl;
  if (ny > 0 || (Math.abs(ny) < 0.15 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  return {
    c1,
    c2,
    d: `M ${p0.x} ${p0.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p3.x} ${p3.y}`,
    mid,
    nx,
    ny,
  };
}

/**
 * 语义锚点对（P0 · 锚点语义化）：按「源→靶」的相对位置产出稳定的书签位锚点 + 进出方向。
 *
 * 参照成熟产品（React Flow 端口 / markvault 树形「父右中点→子左中点」/ Obsidian 边缘珠子）：
 * 锚点是语义端口、落在卡片边中点上，而不是随目标中心方向漂移的对角交点。
 *
 * 规则：
 * - 水平主导（|dx| ≥ |dy|）→ 源右缘/左缘中点 → 靶左缘/右缘中点，进出方向沿水平轴相对；
 * - 垂直主导 → 源下缘/上缘中点 → 靶上缘/下缘中点，进出方向沿垂直轴相对。
 *
 * `stagger`（平行错位）：第 N 条平行入边沿外侧轴反向错位，步长 = 盒边长 × 0.0625
 *  （实现为 `盒边长 × 0.125 / 2` 的半档——防错位后锚点出盒内缩；测试按 0.0625 断言）。
 * 多条边指向同一节点时不再在同一个点扇形炸开（Obsidian 平行入边观感）。
 */
export function semanticAnchorPair(
  a: Box,
  b: Box,
  stagger = 0,
): { p0: { x: number; y: number }; dir0: { x: number; y: number }; p3: { x: number; y: number }; dir3: { x: number; y: number } } {
  const acx = a.x + a.w / 2;
  const acy = a.y + a.h / 2;
  const bcx = b.x + b.w / 2;
  const bcy = b.y + b.h / 2;
  const dx = bcx - acx;
  const dy = bcy - acy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    // 水平主导：进出水平，错位沿垂直轴（两侧反向）
    const forward = dx >= 0;
    const off = (stagger * a.h * 0.125) / 2;
    const p0 = { x: forward ? a.x + a.w : a.x, y: acy + off };
    const p3 = { x: forward ? b.x : b.x + b.w, y: bcy - off };
    return {
      p0,
      dir0: { x: forward ? 1 : -1, y: 0 },
      p3,
      dir3: { x: forward ? -1 : 1, y: 0 },
    };
  }
  // 垂直主导：进出垂直，错位沿水平轴（两侧反向）
  const forward = dy >= 0;
  const off = (stagger * a.w * 0.125) / 2;
  const p0 = { x: acx + off, y: forward ? a.y + a.h : a.y };
  const p3 = { x: bcx - off, y: forward ? b.y : b.y + b.h };
  return {
    p0,
    dir0: { x: 0, y: forward ? 1 : -1 },
    p3,
    dir3: { x: 0, y: forward ? -1 : 1 },
  };
}

/**
 * 端点切向 S 形三次贝塞尔（P0 · 规范形状语言）。
 *
 * 与 bezierFromAnchors（法向弓）的区别：控制点由端点**进出方向**决定 —— 平出平入，
 * 曲线以相切方式离开/进入卡片（markvault computeDirectBezier 同款；React Flow bezier 左出右进语义）。
 *
 * 控制点 = 端点 ± 方向 × max(弦距 × beta, 20)。输出与 bezierFromAnchors 相同形状对象
 * （c1/c2/d/mid/nx/ny），使调用方可以无缝替换。
 */
export function tangentSBezier(
  p0: { x: number; y: number },
  dir0: { x: number; y: number },
  p3: { x: number; y: number },
  dir3: { x: number; y: number },
  beta = 0.4,
): {
  c1: { x: number; y: number };
  c2: { x: number; y: number };
  d: string;
  mid: { x: number; y: number };
  nx: number;
  ny: number;
} {
  const dx = p3.x - p0.x;
  const dy = p3.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  const ext = Math.max(len * beta, 20);
  const c1 = { x: p0.x + dir0.x * ext, y: p0.y + dir0.y * ext };
  const c2 = { x: p3.x - dir3.x * ext, y: p3.y - dir3.y * ext };
  const mid = {
    x: 0.125 * p0.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * p3.x,
    y: 0.125 * p0.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * p3.y,
  };
  // 与 bezierFromAnchors 同款法向（归一：优先朝上，次优先朝右）
  const tx = p3.x + c2.x - c1.x - p0.x;
  const ty = p3.y + c2.y - c1.y - p0.y;
  const tl = Math.hypot(tx, ty) || 1;
  let nx = -ty / tl;
  let ny = tx / tl;
  if (ny > 0 || (Math.abs(ny) < 0.15 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  return {
    c1,
    c2,
    d: `M ${p0.x} ${p0.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p3.x} ${p3.y}`,
    mid,
    nx,
    ny,
  };
}

/** 归一化落点（0–1，相对盒）→ 进出方向（该落点所在边的主轴方向；中心回落量水平右向）。
 *  P1-3：手动端点方向沿「落点所在边」推断——与语义锚的边中点语义同族，不再回退到
 *  对角交点式漂移。 */
export function sideDirOf(norm: { x: number; y: number }): { x: number; y: number } {
  const px = norm.x - 0.5;
  const py = norm.y - 0.5;
  if (px === 0 && py === 0) return { x: 1, y: 0 };
  if (Math.abs(px) >= Math.abs(py)) return px >= 0 ? { x: 1, y: 0 } : { x: -1, y: 0 };
  return py >= 0 ? { x: 0, y: 1 } : { x: 0, y: -1 };
}

/**
 * 手动锁定路径的锚点组装（P1-3 · 手动形状语言与自动路由统一）。
 *
 * 契约（对标自动路由 semanticAnchorPair + tangentSBezier 同款）：
 * - 未拖端点（manual.from/to 缺省）→ 落点 + 进出方向 = 语义锚（贴边中点，而非旧实现
 *   的「盒中心拉线」——首次拖 bend 不会让曲线从卡片中心起跳）；
 * - manual.from/to 覆盖落点（归一化归一坐标），进出方向随落点所在边推断（sideDirOf）；
 * - 返回的 p0/d0/p3/d3 供 manualBezier 生成相切基形。
 */
export function manualAnchors(
  from: Box,
  to: Box,
  mf?: { x: number; y: number },
  mt?: { x: number; y: number },
): {
  p0: { x: number; y: number };
  dir0: { x: number; y: number };
  p3: { x: number; y: number };
  dir3: { x: number; y: number };
} {
  const sem = semanticAnchorPair(from, to);
  const p0 = mf ? { x: from.x + from.w * mf.x, y: from.y + from.h * mf.y } : sem.p0;
  const p3 = mt ? { x: to.x + to.w * mt.x, y: to.y + to.h * mt.y } : sem.p3;
  const dir0 = mf ? sideDirOf(mf) : sem.dir0;
  const dir3 = mt ? sideDirOf(mt) : sem.dir3;
  return { p0, dir0, p3, dir3 };
}

/**
 * 带侧向弓的相切三次贝塞尔（P1-3 · 手动锁定专用形状）。
 *
 * 与 tangentSBezier 的关系：curvature=0 时输出与其逐位一致（相切基形）；
 * curvature ≠ 0 时两个控制点沿**弦法向** (-dy, dx) 平移 `chord × curvature`——
 * 曲线整体侧弓而端点仍相切。弯度量级与原「法向弓」（bezierFromAnchors）一致：
 * mid 侧移 = 0.75 × chord × curvature，因此 bend 拖拽映射（c = 垂距/(0.75×chord)）
 * 与 EdgeHandles 的 bend 点显示公式无需改动。
 */
export function manualBezier(
  p0: { x: number; y: number },
  dir0: { x: number; y: number },
  p3: { x: number; y: number },
  dir3: { x: number; y: number },
  curvature = 0,
  beta = 0.4,
): {
  c1: { x: number; y: number };
  c2: { x: number; y: number };
  d: string;
  mid: { x: number; y: number };
  nx: number;
  ny: number;
} {
  const dx = p3.x - p0.x;
  const dy = p3.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  const ext = Math.max(len * beta, 20);
  let c1 = { x: p0.x + dir0.x * ext, y: p0.y + dir0.y * ext };
  let c2 = { x: p3.x - dir3.x * ext, y: p3.y - dir3.y * ext };
  if (curvature !== 0) {
    const off = len * curvature;
    // 弦法向 (-dy, dx)：正 curvature → 控制点向 (-dy, dx) 侧平移（与旧法向弓同向）
    const sx = -dy / len;
    const sy = dx / len;
    c1 = { x: c1.x + sx * off, y: c1.y + sy * off };
    c2 = { x: c2.x + sx * off, y: c2.y + sy * off };
  }
  const mid = {
    x: 0.125 * p0.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * p3.x,
    y: 0.125 * p0.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * p3.y,
  };
  // 与 tangentSBezier 同款法向（归一：优先朝上，次优先朝右）
  const tx = p3.x + c2.x - c1.x - p0.x;
  const ty = p3.y + c2.y - c1.y - p0.y;
  const tl = Math.hypot(tx, ty) || 1;
  let nx = -ty / tl;
  let ny = tx / tl;
  if (ny > 0 || (Math.abs(ny) < 0.15 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  return {
    c1,
    c2,
    d: `M ${p0.x} ${p0.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p3.x} ${p3.y}`,
    mid,
    nx,
    ny,
  };
}

/**
 * R5-1 补：从**路由折线顶点**直接推断鼓向（`RouteResult.points`；EdgeEditor 的首选来源）。
 *
 * 为什么另开一条而不是继续解析 d：d 里可能有**折线跳桥**（pathWithJumps 注入 4 个顶点，
 * 其中 rise/fall 离弦 = radius）——「完全无弓的直线 + 跳线」会被读成有侧（R5-1 形态漂移；
 * 实测：同一条水平直线，桥 d → 'right'，顶点 → 'auto'）。
 * 顶点来自路由结果（`applyLineJumps` 只改写 d、不改 points）→ 跳线桥天然不进判定。
 *
 * 约定与 `inferBowSide` 分支② 逐位一致：cross(弦, 顶点偏移) > 0 → 'right'；
 * 顶点不足 3 / 共线 / 退化弦 → 'auto'。
 */
export function inferBowSideFromPoints(
  points: readonly { x: number; y: number }[],
): 'left' | 'right' | 'auto' {
  if (points.length < 3) return 'auto';
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return 'auto';
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  if (Math.hypot(dx, dy) < 1e-6) return 'auto';
  let best = 0;
  for (let i = 1; i + 1 < points.length; i++) {
    const p = points[i];
    if (p === undefined) continue;
    // 与 inferBowSide 分支① 同一款法向偏移符号约定：cross(弦, 顶点偏移) > 0 → right
    const nOffset = (p.x - first.x) * -dy + (p.y - first.y) * dx;
    if (Math.abs(nOffset) > Math.abs(best)) best = nOffset;
  }
  if (Math.abs(best) < 1e-6) return 'auto';
  return best > 0 ? 'right' : 'left';
}

/**
 * 从 path d 推断连线当前鼓向：'left' / 'right' / 'auto'（无法判断时）。
 *
 * 用于「Opp」一键反向操作 —— 当 routingSide 未显式设置、靠算法自动选择时，
 * 需要知道当前到底选了哪一侧才能翻到另一边。
 *
 * 实现：从 M..C 路径里取第一个控制点 c1，量它相对弦（p0→p3）法向的偏移方向。
 * 按 bezierFromAnchors 的约定：正曲率 → 控制点向（-dy, dx）方向偏移 → 对水平 L→R 连线为向下 →
 * 视觉上是「右侧」（绕到右边）；负曲率为「左侧」。
 */
export function inferBowSide(d: string): 'left' | 'right' | 'auto' {
  // ① 严格单 C 段（主路径 d）——既有行为逐位不变（回归钉）
  const m = d.match(
    /^M (-?[\d.]+) (-?[\d.]+) C (-?[\d.]+) (-?[\d.]+), (-?[\d.]+) (-?[\d.]+), (-?[\d.]+) (-?[\d.]+)$/,
  );
  if (m) {
    const v = m.slice(1).map(Number) as number[];
    const x0 = v[0]!;
    const y0 = v[1]!;
    const c1x = v[2]!;
    const c1y = v[3]!;
    const x3 = v[6]!;
    const y3 = v[7]!;
    if (Math.hypot(x3 - x0, y3 - y0) < 1e-6) return 'auto';
    // 控制点相对弦法向 (-dy, dx) 的偏移分量
    const nOffset = (c1x - x0) * -(y3 - y0) + (c1y - y0) * (x3 - x0);
    if (Math.abs(nOffset) < 1e-6) return 'auto';
    return nOffset > 0 ? 'right' : 'left';
  }
  // ② R3-2 多段路径（折线主体 + 可能的跳线桥）——委托顶点版（R5-1 补）：
  //    跳线桥不属于「鼓」（其顶点离弦仅 radius），桥在场时按**顶点**判定更准；
  //    字符串里桥与主体的区分不可靠 —— 顶点集天然不含桥，见 inferBowSideFromPoints。
  //    历史 C 形态路径（人工/旧数据）同样经 onPathPointsOf 落此分支。
  return inferBowSideFromPoints(onPathPointsOf(d));
}

/** 从 path d 提取全部「在路径上」的点（M 起点 + L 端点 + C 端点；控制点不在路径上，剔除）。
 *  C 形态为历史/人工路径保留（R5-1 起跳线折线化、不再产 C）；坐标对之间容忍逗号。 */
function onPathPointsOf(d: string): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  const re = /([MLC])((?:\s*,?\s*-?[\d.]+)+)/g;
  let mt: RegExpExecArray | null = re.exec(d);
  while (mt !== null) {
    const cmd = mt[1];
    const raw = mt[2];
    if (cmd === undefined || raw === undefined) return [];
    const nums = raw.match(/-?[\d.]+/g)?.map(Number) ?? [];
    // M/L 在路径上的点是唯一一对；C 是第三对（前两对是控制点）
    const idx = cmd === 'C' ? 2 : 0;
    const x = nums[idx * 2];
    const y = nums[idx * 2 + 1];
    if (x === undefined || y === undefined || Number.isNaN(x) || Number.isNaN(y)) return [];
    out.push({ x, y });
    mt = re.exec(d);
  }
  return out;
}

/** 线段是否跨越（用于交叉计数；共线/重合不计） */
function segmentsCross(
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
): boolean {
  const d = (
    p: { x: number; y: number },
    q: { x: number; y: number },
    r: { x: number; y: number },
  ): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = d(a1, a2, b1);
  const d2 = d(a1, a2, b2);
  const d3 = d(b1, b2, a1);
  const d4 = d(b1, b2, a2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// ═══════════════════════════════════════════════════════════════════
// Line jumps 跳线（Issue #4）—— 交叉可读
//
// 设计：交叉无法完全避免时，不强求消除，而是让交叉**可读**。
// 在被跨越的那条线（under）上，于交点处绘制一个跨越小桥（hop，折线梯形：
// 抬起 → 平行跨过 → 落回），明确「哪条在上、哪条在下」。参照 Miro 的 Line jumps；
// 但因 Miro 仅支持 straight / orthogonal 线型，曲线需自绘（此处实现）。
// R5-1：hop 形态由贝塞尔拱弧折线化为 M/L-only 的梯形桥（单几何形态贯穿全链路）。
// ═══════════════════════════════════════════════════════════════════

/**
 * 跳线应用纯函数（P2-1 · 从 FreeEdgeLayer useMemo 抽出，供 fastRouting 门控）。
 *
 * - 单条边 / 无交叉（crossings 为空）→ 返回原 map（零拷贝，fast 路径零开销）
 * - 有交叉 → under 边（先路由）的 route.d 经 pathWithJumps 注入折线跳，其余边原样
 * 交叉仅由 route.points（p0–mid–p3 三点折线）求交——精度足够且成本远低于全曲线采样。
 */
export function applyLineJumps<T extends { route: RouteResult }>(
  routes: ReadonlyMap<string, T>,
): ReadonlyMap<string, T> {
  if (routes.size < 2) return routes;
  const orderedKeys = [...routes.keys()];
  const polys = orderedKeys.map((k) => routes.get(k)!.route.points);
  const crossings = findCrossings(polys);
  if (crossings.length === 0) return routes;
  // 按「被跨越的边」归组跳线点
  const jumpsByKey = new Map<string, { x: number; y: number }[]>();
  for (const c of crossings) {
    const key = orderedKeys[c.under];
    if (!key) continue;
    const arr = jumpsByKey.get(key) ?? [];
    arr.push({ x: c.x, y: c.y });
    jumpsByKey.set(key, arr);
  }
  const out = new Map(routes);
  for (const [key, jps] of jumpsByKey) {
    const entry = out.get(key)!;
    out.set(key, {
      ...entry,
      route: { ...entry.route, d: pathWithJumps(entry.route.points, jps) },
    });
  }
  return out;
}

/** 一条边与另一条边的交叉点（含上下关系） */
export interface EdgeCrossing {
  x: number;
  y: number;
  /** 位于下方的边（应绘制跳线弧）在多段线数组中的索引 */
  under: number;
  /** 位于上方的边的索引 */
  over: number;
}

/**
 * 折线的轴对齐包围盒（broad phase 用）。
 * 空折线返回原点退化盒——后续逐段精算会因无段而立即结束，不影响正确性。
 */
function bboxOf(pts: readonly { x: number; y: number }[]): BBox {
  if (pts.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 两包围盒是否重叠（含相切）。不重叠 → 两折线绝不可能相交 */
function bboxOverlap(a: BBox, b: BBox): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

/**
 * 计算所有边两两之间的交叉点。
 * 上下关系由数组顺序决定：索引大者绘制在后 → 位于上方。
 *
 * 复杂度：朴素实现是 O(E² × P²)（E=边数，P=每边折线点数），
 * 实测 400 边即耗时 ~155ms（远超一帧 16ms 预算）。
 *
 * 优化：**broad phase 包围盒预筛** —— 先算各折线 AABB（O(E×P)，只算一次），
 * 边对比较前先判 AABB 是否重叠，不重叠则整对跳过 O(P²) 的逐段精算。
 * 空间上远离的边对（占绝大多数）因此降到 O(1)。
 * **不改变结果**：AABB 不重叠是「不可能相交」的充分条件，只筛掉必然无交的对。
 *
 * @param polylines 各边的折线（世界坐标），按绘制顺序排列
 */
export function findCrossings(
  polylines: readonly (readonly { x: number; y: number }[])[],
): EdgeCrossing[] {
  const out: EdgeCrossing[] = [];
  // 预计算「折线 + 包围盒 + 原索引」，随后用 for...of 遍历而非下标访问——
  // 在 noUncheckedIndexedAccess 下，下标访问每项都要 `!`，会凭空增加非空断言债务。
  const items = polylines.map((pts, idx) => ({ pts, box: bboxOf(pts), idx }));
  for (const ai of items) {
    for (const bi of items) {
      // 上三角：索引大者绘制在后 → 位于上方（under/over 依此判定）
      if (bi.idx <= ai.idx) continue;
      // broad phase：包围盒不重叠 → 不可能相交，整对跳过 O(P²) 的逐段精算
      if (!bboxOverlap(ai.box, bi.box)) continue;
      const a = ai.pts;
      const b = bi.pts;
      for (let m = 0; m + 1 < a.length; m++) {
        for (let n = 0; n + 1 < b.length; n++) {
          const p = segIntersectPoint(a[m]!, a[m + 1]!, b[n]!, b[n + 1]!);
          if (p) out.push({ x: p.x, y: p.y, under: ai.idx, over: bi.idx });
        }
      }
    }
  }
  return out;
}

/** 求两线段交点（不平行且在线段范围内时返回交点，否则 null） */
function segIntersectPoint(
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
): { x: number; y: number } | null {
  const r = { x: a2.x - a1.x, y: a2.y - a1.y };
  const s = { x: b2.x - b1.x, y: b2.y - b1.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((b1.x - a1.x) * s.y - (b1.y - a1.y) * s.x) / denom;
  const u = ((b1.x - a1.x) * r.y - (b1.y - a1.y) * r.x) / denom;
  // 严格落在两条线段内部（留 epsilon 避免端点误判）
  if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null;
  return { x: a1.x + r.x * t, y: a1.y + r.y * t };
}

/**
 * 在折线上插入折线跳（梯形桥）：位于交叉点处「跨过去」的小桥。
 *
 * 实现：在每个跳线点处，沿路径方向前后各留 `radius` 距离（enter/exit），
 * 于 enter 处沿法向抬起、跨过 2r 后落回 exit —— 抬升高度 = radius、平台段与路径平行。
 * R5-1：形态由「贝塞尔拱弧」改为「折线梯形桥」，产出路径只含 M/L。
 *
 * @param pts 原始折线
 * @param jumpPoints 跳线点（通常取 EdgeCrossing 中 under === 本边索引的那些）
 * @param radius 折线跳半径（默认 5；语义 = 前后各留 r + 抬升高度）
 */
export function pathWithJumps(
  pts: readonly { x: number; y: number }[],
  jumpPoints: readonly { x: number; y: number }[],
  radius = 5,
): string {
  if (pts.length === 0) return '';
  if (pts.length === 1 || jumpPoints.length === 0) {
    return (
      `M ${pts[0]!.x} ${pts[0]!.y}` +
      pts
        .slice(1)
        .map((p) => ` L ${p.x} ${p.y}`)
        .join('')
    );
  }
  // 收集每段上的跳线点（按沿程参数 t 排序）
  type Jump = { seg: number; t: number; x: number; y: number };
  const jumps: Jump[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const segLen = Math.hypot(dx, dy);
    if (segLen < 1e-9) continue;
    for (const jp of jumpPoints) {
      // 跳线点在该段上的投影参数
      const t = ((jp.x - a.x) * dx + (jp.y - a.y) * dy) / (segLen * segLen);
      if (t <= 0.02 || t >= 0.98) continue;
      // 点到线段的距离应足够小（确实落在这条线上）
      const px = a.x + dx * t;
      const py = a.y + dy * t;
      if (Math.hypot(jp.x - px, jp.y - py) > Math.max(1.5, radius)) continue;
      jumps.push({ seg: i, t, x: px, y: py });
    }
  }
  jumps.sort((u, v) => (u.seg === v.seg ? u.t - v.t : u.seg - v.seg));

  let d = `M ${pts[0]!.x} ${pts[0]!.y}`;
  let ji = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const segLen = Math.hypot(dx, dy) || 1;
    const ux = dx / segLen;
    const uy = dy / segLen;
    // 法向（跳线抬起方向）：统一取 (-uy, ux)
    const nxp = -uy;
    const nyp = ux;
    while (ji < jumps.length && jumps[ji]!.seg === i) {
      const j = jumps[ji]!;
      // 沿路径方向的距离参数
      const dist = j.t * segLen;
      const r = Math.min(radius, dist, segLen - dist);
      if (r < 1) {
        ji++;
        continue;
      }
      const enter = { x: j.x - ux * r, y: j.y - uy * r };
      const exit = { x: j.x + ux * r, y: j.y + uy * r };
      // R5-1 折线跳（梯形桥）：enter → 沿法向抬起 r → 沿路径走完 2r → 落回 exit。
      // 与旧贝塞尔拱弧同一语义（前后各留 r、抬升高度 = radius），但产出只含 M/L ——
      // 单几何形态贯穿路由 → 渲染 → 判定（inferBowSide）→ 导出。
      const rise = { x: enter.x + nxp * r, y: enter.y + nyp * r };
      const fall = { x: exit.x + nxp * r, y: exit.y + nyp * r };
      d +=
        ` L ${enter.x} ${enter.y}` +
        ` L ${rise.x} ${rise.y}` +
        ` L ${fall.x} ${fall.y}` +
        ` L ${exit.x} ${exit.y}`;
      ji++;
    }
    d += ` L ${b.x} ${b.y}`;
  }
  return d;
}

/**
 * 曲率自适应贝塞尔路由（外围绕行优先）—— 新主入口。
 *
 * 与旧 routeEdge（trunk 折线 + A* 最短路径）的根本区别：优化目标不是「路径最短」，
 * 而是按图绘制美学优先级排序：
 *     不穿节点 → 走外围 → 少交叉 → 少弯曲 → 短路径
 *
 * 做法：枚举「锚点对 × 曲率档位」，对每个组合生成单条三次贝塞尔，采样检测穿障，
 * 对不穿障者按美学评分排序取优。全部组合均穿障时**降级为直线直穿**（SBGN
 * crossing boundary only twice）——一条明确穿过卡片的直线，优于看似绕开、实际仍穿障的折线。
 *
 * @param a 源盒
 * @param b 靶盒
 * @param obstacles 障碍集（不含源/靶自身）
 * @param existingPolylines 已路由的其它边（世界坐标折线），用于交叉罚分
 * @param opts 选项
 */
export function routeAesthetic(
  a: Box,
  b: Box,
  obstacles: readonly RouteObstacle[],
  existingPolylines: readonly (readonly { x: number; y: number }[])[] = [],
  opts: {
    curvatureSteps?: readonly number[];
    weights?: AestheticWeights;
    /** 每条边的锚点采样数（默认 3 → 每盒 12 个候选） */
    anchorsPerSide?: number;
    /** 穿障检测外扩（默认 DEFAULT_BLOCK_PADDING） */
    blockPadding?: number;
    /** 贝塞尔采样数（默认 20，兼顾精度与成本） */
    samples?: number;
    /**
     * 强制绕行侧 —— 对标 markvault-js 的 forceSide（我此前缺失、值得学的一点）。
     *
     * 定义（面向「源 → 靶」的行进方向）：
     *   'left'  = 鼓向左侧（曲率 ≤ 0）
     *   'right' = 鼓向右侧（曲率 ≥ 0）
     *
     * 指定后只在该侧枚举曲率，**优先于评分自动选择** —— 让用户一键定向，不必拖 bend 控制点。
     * 该侧无解 → 由本函数尾部的【直穿降级】兜底（绝不空白，见「直穿降级：所有组合均穿障时…」
     * 一段；R3-4 起该情形经 RouteResult.forcedSideFallback 显式上报，不再静默）。
     * 另：dir/routingSide 是渲染端语义（R3-A3 契约）——dir 的 fwd↔back 切换由
     * useEdgeActions.setEdgeDir 保形（交换 manual 两端 + 翻转 routingSide）。
     */
    forceSide?: 'left' | 'right';
    /**
     * 「走廊集」的外扩半径（默认 DEFAULT_CORRIDOR_MARGIN）。
     * 距两端点中心连线该距离内的障碍才算"挡在路上"，参与内凸判定与拥挤判定。
     */
    corridorMargin?: number;
    /**
     * 目标净空（世界 px）：连线与卡片之间期望留出的空白，低于它即罚分。
     * 默认约 3 倍节点高（与布局的兄弟间距同尺度）—— 这是"侧边优先"的力度旋钮：
     * 调大 → 连线更坚持绕到开阔的外侧；调小 → 容许从较窄的缝里穿过。
     */
    clearTarget?: number;
    /**
     * 语义锚优先（P0，默认 true）：以「书签位锚点 + 平出平入 S 形」为默认形状语言；
     * 只有显著绕行时才进入 12 锚点 × 曲率档的贪心枚举。false = 回到逐边贪心（测试旁路）。
     */
    semantic?: boolean;
    /** 平行错位步数（P0）：第 N 条平行入边的锚点沿外侧轴反向错位（见 semanticAnchorPair） */
    anchorStagger?: number;
  } = {},
  /** 空旷区域（走廊内无障碍）时是否优先直连（默认 true：能直连就不做无谓弯曲） */
  preferStraight = true,
): RouteResult {
  const steps = opts.curvatureSteps ?? DEFAULT_CURVATURE_STEPS;
  const semanticOpt = opts.semantic ?? true;
  const anchorStagger = opts.anchorStagger ?? 0;
  const w: Required<AestheticWeights> = {
    crossing: opts.weights?.crossing ?? 12,
    inward: opts.weights?.inward ?? 8,
    // 净空罚分（侧边优先的核心）：权重需显著 —— 否则"贴着节点群挤过去"的路径
    // 因长度短、曲率小而胜出。设 14（高于 length，低于 crossing/inward）。
    clearance: opts.weights?.clearance ?? 14,
    // 曲率罚分：**必须与 clearance 同量级**，否则 bend 完全拉不住净空项。
    //
    // 两者取值域：clearance 项 ∈ [0, 14]，bend 项 ∈ [0, bend × 2]（最大 |c| = 2）。
    // 此前 bend=0.4 → 域只有 [0, 0.8]，比净空项小一个数量级：
    // "把曲率拉满"总能靠改善净空赚回 5~13 分，却只付出 0.8 分代价 ——
    // 结果每条被挡的边都撑出 |c|≈2、弧高 150% 弦长的巨型弧，与树线交叉数翻倍。
    // 取 2.5 后 bend 域为 [0, 5]，与净空收益同量级，两个旋钮才都真正生效。
    bend: opts.weights?.bend ?? 2.5,
    length: opts.weights?.length ?? 0.5,
  };

  const blockPad = opts.blockPadding ?? DEFAULT_BLOCK_PADDING;
  const samples = opts.samples ?? 20;

  const aAnchors = edgeAnchorCandidates(a, opts.anchorsPerSide ?? 3);
  const bAnchors = edgeAnchorCandidates(b, opts.anchorsPerSide ?? 3);

  // —— 障碍分层 ——
  // ① 走廊集 corridorSet：距「两端点中心连线」corridorMargin 内的障碍 —— 用于粗筛快速否决。
  //
  //    注意：不能用两端点盒的包围盒来筛 —— 那条带子只有节点高度那么高，
  //    中间的节点簇会被整片漏掉（表现为「从节点簇中间的缝隙直穿而过而评分看不出问题」）。
  //
  // ② 贴缝集 nearBand：直线弦两侧 bandHalf（约一个节点高）内的障碍。
  //
  //    必须把"撞上卡片"和"贴着卡片走"分开看：
  //      · 撞上（blockPad 内）→ 没得选，必须绕；
  //      · 没撞上但贴着走（bandHalf 内）→ **有得选**：直穿缝隙 or 绕到外侧。
  //    后者正是用户反馈的「走中心」形态，理应由评分去权衡。
  //    此前只判"有没有撞上"，于是穿缝隙的边一律直接走直线 —— corridor / bend
  //    两个权重完全没机会参与（实测四组参数结果一模一样）。
  //
  // ③ 全量集 obstacles：最终避障复核（曲率大时曲线鼓到包围盒之外，①看不到）。
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const corridorSet = corridorObstacles(
    ac,
    bc,
    opts.corridorMargin ?? DEFAULT_CORRIDOR_MARGIN,
    obstacles,
  );
  const nearObstacles = corridorSet;

  // 目标净空：约 3 倍节点高。与"净空罚分"用同一个尺度，保证快路径与评分口径一致。
  const clearTarget = opts.clearTarget ?? Math.max(80, ((a.h + b.h) / 2) * 3);

  // 贴缝：直线离某些卡片不足目标净空 —— 即"要从节点群中间挤过去"。
  // 这类边不能走快路径，必须交给评分去权衡"直穿"还是"绕外侧"。
  const nearBand = corridorSet.filter((o) =>
    segmentIntersectsRect(ac.x, ac.y, bc.x, bc.y, o, clearTarget),
  );
  const threading = nearBand.length > 0;

  // 障碍质心（用于"内凸"判定）：只取**贴着路径的**障碍。
  // 用 corridorSet 全集会掺入远离路径的旁支节点，把质心拽到无关方向，
  // 结果"绕开真障碍"的一侧反被判为内凸而罚分 —— 方向判断彻底失效。
  const centroid = threading
    ? {
        x: nearBand.reduce((s, o) => s + o.x + o.w / 2, 0) / nearBand.length,
        y: nearBand.reduce((s, o) => s + o.y + o.h / 2, 0) / nearBand.length,
      }
    : null;

  let best: {
    score: number;
    bez: ReturnType<typeof bezierFromAnchors>;
    p0: { x: number; y: number };
    p3: { x: number; y: number };
    c: number;
    crossings: number;
    inward: number;
    tightRatio: number;
  } | null = null;

  const straightLen =
    Math.hypot(b.x + b.w / 2 - (a.x + a.w / 2), b.y + b.h / 2 - (a.y + a.h / 2)) || 1;

  // 外层：锚点对（按端点距离升序，便于早停 —— 近的锚点通常更自然）
  const pairs: { p0: { x: number; y: number }; p3: { x: number; y: number }; dist: number }[] = [];
  for (const p0 of aAnchors) {
    for (const p3 of bAnchors) {
      pairs.push({ p0, p3, dist: Math.hypot(p3.x - p0.x, p3.y - p0.y) });
    }
  }
  pairs.sort((u, v) => u.dist - v.dist);
  // P0 · 语义锚对前置：书签位锚点（右缘/左缘/下缘/上缘中点）是「默认形状语言」的第一候选。
  // 不加距离剪枝（见上）。
  const considered = pairs;
  // 平行错位（P0）：stagger > 0 时语义锚对不在 12 候选内，需显式前置；
  // stagger = 0 时它必然已在 12 候选内（右缘中点是候选的子集），无需重复插入。
  const sem = semanticOpt ? semanticAnchorPair(a, b, anchorStagger) : null;
  if (sem && !pairs.some((q) =>
    Math.abs(q.p0.x - sem.p0.x) < 1e-6 &&
    Math.abs(q.p0.y - sem.p0.y) < 1e-6 &&
    Math.abs(q.p3.x - sem.p3.x) < 1e-6 &&
    Math.abs(q.p3.y - sem.p3.y) < 1e-6,
  )) {
    considered.unshift({ p0: sem.p0, p3: sem.p3, dist: Math.hypot(sem.p3.x - sem.p0.x, sem.p3.y - sem.p0.y) });
  }

  // preferStraight 快路径：最近锚点对的直线本身畅通（不穿障、不与已有边交叉）→ 直接直连。
  //
  // 意图：关系线只有在"确实需要绕"的时候才弯。直线通畅时画一条弧线属于无谓装饰，
  // 既增加视觉噪声也违背「最短路径」直觉。两种情况不启用：
  //   · forceSide —— 用户已明确指定绕行方向，直线不满足该约束；
  //   · threading —— 直线要从节点缝里挤过去时不走快路径，交给下层的走廊穿越罚分
  //     去权衡"直穿"还是"绕外侧"（否则永远直穿，权重形同虚设）。
  // 直连候选：P0 平行错位时改用「错位后的语义锚对」直线（多条平行入边错开而非重叠）；
  // 否则仍取最近锚点对（保持既有直连行为）。
  const straightPair =
    semanticOpt && anchorStagger > 0 && sem ? { p0: sem.p0, p3: sem.p3 } : pairs[0]!;
  if (preferStraight && !opts.forceSide && !threading && pairs.length > 0) {
    const p0 = straightPair.p0;
    const p3 = straightPair.p3;
    if (!polylineHitsObstacle([p0, p3], obstacles, blockPad)) {
      let cross = 0;
      for (const other of existingPolylines) {
        for (let j = 0; j + 1 < other.length; j++) {
          if (segmentsCross(p0, p3, other[j]!, other[j + 1]!)) cross++;
        }
      }
      if (cross === 0) {
        const mid = { x: (p0.x + p3.x) / 2, y: (p0.y + p3.y) / 2 };
        const dx = p3.x - p0.x;
        const dy = p3.y - p0.y;
        const dl = Math.hypot(dx, dy) || 1;
        let nx = -dy / dl;
        let ny = dx / dl;
        if (ny > 0 || (Math.abs(ny) < 0.15 && nx < 0)) {
          nx = -nx;
          ny = -ny;
        }
        return {
          d: `M ${p0.x} ${p0.y} L ${p3.x} ${p3.y}`,
          points: [p0, p3],
          routed: false,
          mid,
          nx,
          ny,
        };
      }
    }
  }

  // P0 · 语义 S 形快路径：直连被挡、但「书签位锚点 + 平出平入 S 形」即可绕开时直接采用。
  //
  // 目的：让"轻微错位即可绕"的边保持统一的规范形状（两端相切、小曲率），
  // 而不是被 12 锚点 × 曲率档的贪心枚举扭出异形弧。threading（贴缝）与 forceSide
  // （用户显式定侧）时不走快路径 —— 分别交给评分权衡外绕 vs 直穿、交由用户定侧。
  if (semanticOpt && sem && !opts.forceSide && !threading) {
    const bzs = tangentSBezier(sem.p0, sem.dir0, sem.p3, sem.dir3);
    const spts = sampleCubic(sem.p0, bzs.c1, bzs.c2, sem.p3, samples);
    let scross = 0;
    for (const other of existingPolylines) {
      for (let i = 0; i + 1 < spts.length && scross === 0; i++) {
        const a1 = spts[i];
        const a2 = spts[i + 1];
        for (let j = 0; a1 && a2 && j + 1 < other.length; j++) {
          const b1 = other[j];
          const b2 = other[j + 1];
          if (b1 && b2 && segmentsCross(a1, a2, b1, b2)) {
            scross++;
            break;
          }
        }
      }
      if (scross > 0) break;
    }
    if (scross === 0 && !polylineHitsObstacle(spts, obstacles, blockPad)) {
      return {
        d: bzs.d,
        points: [sem.p0, bzs.mid, sem.p3],
        routed: false,
        mid: bzs.mid,
        nx: bzs.nx,
        ny: bzs.ny,
      };
    }
  }

  // 曲率档处理（三处约束）：
  // ① forceSide：只保留用户指定侧（left → c ≤ 0；right → c ≥ 0）—— 严格定向，
  //    该侧无解则由下方「直穿降级」兜底（与 markvault 的 forceSide → routeSide 行为一致）。
  // ② 按 |c| 升序：先试平缓曲率（视觉更自然），命中即早停，兼顾观感与性能。
  // ③ 弧高上限：mid 偏移 = 0.75 × chord × |c|，限制它**不超过弦长本身**
  //    （即 0.75 × |c| ≤ 1 → |c| ≤ 1.33）。
  //    越过这条线后曲线看起来是"甩出去绕一大圈"，而不是"把两点连起来" ——
  //    那既不是侧边优先，也不是避障，只是把线丢到远处（实测出现弧高 150% 弦长的巨型弧）。
  const MAX_ABS_C = 1.33;
  const byAbs = (arr: readonly number[]): number[] =>
    [...arr].sort((u, v) => Math.abs(u) - Math.abs(v));
  const orderedSteps = byAbs(
    (opts.forceSide
      ? steps.filter((c) => (opts.forceSide === 'left' ? c <= 0 : c >= 0))
      : steps
    ).filter((c) => Math.abs(c) <= MAX_ABS_C),
  );

  for (const { p0, p3 } of considered) {
    const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y) || 1;
    for (const c of orderedSteps) {
      const bez = bezierFromAnchors(p0, p3, c);
      // 采样整条曲线，检测是否穿障
      const pts = sampleCubic(p0, bez.c1, bez.c2, p3, samples);
      // 两级避障：① 包围盒粗筛快速否决（绝大多数候选在此夭折）；
      // ② 全量障碍复核 —— 不可省。曲率较大时曲线会鼓到两盒包围盒之外，
      //    粗筛看不到外侧的障碍，只靠 ① 会产出"看似绕开、实则穿障"的路径
      //    （表现：大弧穿过了远处的卡片）。
      if (polylineHitsObstacle(pts, nearObstacles, blockPad)) continue;
      if (polylineHitsObstacle(pts, obstacles, blockPad)) continue;

      // —— 美学评分（越低越好）——
      // 1) 交叉：与已路由边的折线求交
      let crossings = 0;
      for (const other of existingPolylines) {
        for (let i = 0; i + 1 < pts.length; i++) {
          for (let j = 0; j + 1 < other.length; j++) {
            if (segmentsCross(pts[i]!, pts[i + 1]!, other[j]!, other[j + 1]!)) crossings++;
          }
        }
      }
      // 2) 内凸：曲线中点朝障碍质心方向偏移 → 罚分（鼓励外绕）
      let inward = 0;
      if (centroid) {
        const lineMid = { x: (p0.x + p3.x) / 2, y: (p0.y + p3.y) / 2 };
        const toCx = centroid.x - lineMid.x;
        const toCy = centroid.y - lineMid.y;
        const cl = Math.hypot(toCx, toCy) || 1;
        // 曲线中点相对直线中点的位移在"质心方向"上的投影（按弦长归一化）
        inward = ((bez.mid.x - lineMid.x) * toCx + (bez.mid.y - lineMid.y) * toCy) / (cl * chord);
        if (inward < 0) inward = 0; // 外凸不奖励，仅惩罚内凸
      }
      // 3) 净空罚分（侧边优先的核心）：采样点「离最近卡片不足 clearTarget」的占比。
      //
      //    用户的「又走中心了」本质是：线没撞上任何卡片，却贴着节点群从缝隙里挤过去。
      //    早前的「走廊穿越占比」抓不到这种形态 —— 缝隙一宽，沿弦的走廊占比照样很低，
      //    于是评分认为这条线很好。改用路径规划里的标准 clearance 成本：
      //    直接量每个采样点离最近卡片有多远，低于目标净空就罚分。
      //    这样"绕到节点群外侧"天然优于"从缝里穿过去"，且与节点间距尺度一致。
      let tight = 0;
      for (const q of pts) {
        let minD = Infinity;
        for (const o of nearObstacles) {
          const d = pointClearance(q, o);
          if (d < minD) minD = d;
        }
        if (minD <= clearTarget) tight++;
      }
      const tightRatio = pts.length > 0 ? tight / pts.length : 0;

      const score =
        w.crossing * crossings +
        w.inward * inward +
        w.clearance * tightRatio +
        w.bend * Math.abs(c) +
        w.length * (chord / straightLen);
      if (!best || score < best.score) {
        best = { score, bez, p0, p3, c, crossings, inward, tightRatio };
      }
    }
    // 早停：已找到「无交叉 + 不内凸 + 曲率温和」的解即可收工，无需再枚举更远的锚点对。
    //
    // 判据**不能**用净空占比：它随 |c| 单调递增地改善，按 |c| 升序枚举时一旦写进早停，
    // 就等于"一路加大曲率直到净空达标才停" —— 评分被完全架空，clearance / bend
    // 两个权重变成死旋钮（实测四组参数结果一模一样）。
    // 改用 |c| 上界：命中的是"就近那条平缓弧"，被挡住的边则交给评分去权衡。
    if (best && best.crossings === 0 && best.inward === 0 && Math.abs(best.c) <= 0.45) break;
  }

  if (best) {
    return {
      d: best.bez.d,
      points: [best.p0, best.bez.mid, best.p3],
      // routed = 是否真的靠"弯曲"绕行（曲率为 0 即直连，未做绕障）
      routed: Math.abs(best.c) > 0.01,
      mid: best.bez.mid,
      nx: best.bez.nx,
      ny: best.bez.ny,
    };
  }

  // 直穿降级：所有组合均穿障 → 取最近锚点对连直线（SBGN：crossing boundary only twice）
  const straight = considered[0] ?? {
    p0: { x: a.x + a.w / 2, y: a.y + a.h / 2 },
    p3: { x: b.x + b.w / 2, y: b.y + b.h / 2 },
  };
  const mid = { x: (straight.p0.x + straight.p3.x) / 2, y: (straight.p0.y + straight.p3.y) / 2 };
  const dx = straight.p3.x - straight.p0.x;
  const dy = straight.p3.y - straight.p0.y;
  const dl = Math.hypot(dx, dy) || 1;
  let nx = -dy / dl;
  let ny = dx / dl;
  if (ny > 0 || (Math.abs(ny) < 0.15 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  return {
    d: `M ${straight.p0.x} ${straight.p0.y} L ${straight.p3.x} ${straight.p3.y}`,
    points: [straight.p0, straight.p3],
    routed: false,
    mid,
    nx,
    ny,
    // R3-4：仅在用户指定了侧时，这次降级才是「指定侧无解」——需要显式反馈；
    // 无 forceSide 的普通降级/空旷直连不置位（防全量误报）
    ...(opts.forceSide !== undefined ? { forcedSideFallback: true as const } : {}),
  };
}
