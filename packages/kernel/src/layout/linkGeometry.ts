/**
 * 连线几何（自 `mindmap.ts` 按职责抽出；实现逐字保留，接口向后兼容）。
 *
 * 为什么单独成模块：`mindmap.ts` 长期贴着 600 行预算线（拆分前 631），而「端点/控制点/
 * 折线航点」这套几何与树的布局算法（构建 / 放置 / 缓存）没有耦合：渲染与碰撞检测共用
 * 同一份曲线公式，单独放一处更便于被其它结构布局复用。
 *
 * 输入形状用**结构类型** `LinkAnchor`（只要一个 `box`），不 import `mindmap.ts` 的
 * `LayoutNode` —— 反向 import 会与 `mindmap.ts` 的再导出形成循环，
 * 而 depcruise 的 `no-circular` 把类型边也算在内。`LayoutNode` 结构上满足本类型，
 * 调用点零改造。
 *
 * 兼容：`mindmap.ts` 原样再导出本模块的全部符号（含 `Point` / `BezierControls` /
 * `LinkBuilder` 类型），既有 `from './mindmap.js'` 的引用不需要改。
 */

/** 连线几何需要的最小盒（与 `Box` 结构一致：x/y 左上角 + w/h 尺寸） */
export interface LinkAnchor {
  box: { x: number; y: number; w: number; h: number };
}

/** 二维点（连线折线 / 碰撞采样共用） */
export interface Point {
  x: number;
  y: number;
}

/** 三次贝塞尔的四个控制点（起点 / 两个控制点 / 终点） */
export interface BezierControls {
  sx: number;
  sy: number;
  c1x: number;
  c1y: number;
  c2x: number;
  c2y: number;
  ex: number;
  ey: number;
}

/** 紧凑三次贝塞尔（curvature 归一化弧高；支持左右双向） */
export function compactBezier(
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  curvature = 0.4,
): string {
  const dx = Math.abs(ex - sx) * curvature;
  const dy = Math.abs(ey - sy) * curvature;
  const dir = ex >= sx ? 1 : -1;
  return `M ${sx} ${sy} C ${sx + dir * dx} ${sy + dy / 2}, ${ex - dir * dx} ${ey - dy / 2}, ${ex} ${ey}`;
}

/**
 * 父→子贝塞尔的控制点（**渲染与碰撞检测共用的唯一几何来源**）。
 *
 * 与 {@link bezierLink} / {@link compactBezier} 逐值一致：端点贴父/子左右缘，
 * 控制点取中点偏移。碰撞检测采样这条曲线，渲染输出这条曲线的 path——
 * 两者若各写一份，避让算出来的「安全带」就可能与真正画出来的线不一致。
 */
export function bezierControls(
  parent: LinkAnchor,
  child: LinkAnchor,
  curvature = 0.4,
): BezierControls {
  const fromRight = child.box.x > parent.box.x;
  const sx = fromRight ? parent.box.x + parent.box.w : parent.box.x;
  const ex = fromRight ? child.box.x : child.box.x + child.box.w;
  const sy = parent.box.y + parent.box.h / 2;
  const ey = child.box.y + child.box.h / 2;
  const dx = Math.abs(ex - sx) * curvature;
  const dy = Math.abs(ey - sy) * curvature;
  const dir = ex >= sx ? 1 : -1;
  return {
    sx,
    sy,
    c1x: sx + dir * dx,
    c1y: sy + dy / 2,
    c2x: ex - dir * dx,
    c2y: ey - dy / 2,
    ex,
    ey,
  };
}

/** 把 {@link BezierControls} 转成 SVG path（与 compactBezier 同公式） */
export function bezierPath(c: BezierControls): string {
  return `M ${c.sx} ${c.sy} C ${c.c1x} ${c.c1y}, ${c.c2x} ${c.c2y}, ${c.ex} ${c.ey}`;
}

/** 三次贝塞尔采样为折线（连线穿越检测用；缺省 16 段足够贴合曲线） */
export function sampleBezier(c: BezierControls, segments = 16): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const d = 3 * u * t * t;
    const e = t * t * t;
    out.push({
      x: a * c.sx + b * c.c1x + d * c.c2x + e * c.ex,
      y: a * c.sy + b * c.c1y + d * c.c2y + e * c.ey,
    });
  }
  return out;
}

// 注：`LinkBuilder` 与 `bezierLink` 留在 `mindmap.ts` —— 它们的参数类型带 `LayoutNode`
// （组织图梁线要用 `parent.children`），放在这里会迫使本模块反向 import 类型形成循环。
// 调用方从 `mindmap.js` 导入的路径与语义完全不变。

/** 正交折线 → SVG path（轴对齐航点，拐角圆角 r，借鉴 markvault-js waypointsToSVGPath） */
export function orthogonalPath(pts: Array<{ x: number; y: number }>, r = 5): string {
  if (pts.length < 2) return '';
  if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const next = pts[i + 1];
    const inLen = Math.abs(curr.x - prev.x) + Math.abs(curr.y - prev.y) || 1;
    const outLen = Math.abs(next.x - curr.x) + Math.abs(next.y - curr.y) || 1;
    const rr = Math.min(r, inLen / 2, outLen / 2);
    const inD = {
      x: curr.x === prev.x ? 0 : (curr.x - prev.x) / Math.abs(curr.x - prev.x),
      y: curr.y === prev.y ? 0 : (curr.y - prev.y) / Math.abs(curr.y - prev.y),
    };
    const outD = {
      x: next.x === curr.x ? 0 : (next.x - curr.x) / Math.abs(next.x - curr.x),
      y: next.y === curr.y ? 0 : (next.y - curr.y) / Math.abs(next.y - curr.y),
    };
    d += ` L ${curr.x - inD.x * rr} ${curr.y - inD.y * rr}`;
    d += ` Q ${curr.x} ${curr.y}, ${curr.x + outD.x * rr} ${curr.y + outD.y * rr}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

/** 组织图梁线的航点（向下）：父底中心 → 共享梁（beamY）→ 子顶中心 */
export function orgBeamPoints(parent: LinkAnchor, child: LinkAnchor, beamY: number): Point[] {
  return [
    { x: parent.box.x + parent.box.w / 2, y: parent.box.y + parent.box.h },
    { x: parent.box.x + parent.box.w / 2, y: beamY },
    { x: child.box.x + child.box.w / 2, y: beamY },
    { x: child.box.x + child.box.w / 2, y: child.box.y },
  ];
}

/** 组织图梁线：父底中心垂直下 → 共享梁（beamY）水平 → 子顶中心垂直下 */
export function orgBeamLink(parent: LinkAnchor, child: LinkAnchor, beamY: number): string {
  return orthogonalPath(orgBeamPoints(parent, child, beamY));
}

/** 组织图梁线的航点（向上）：父顶中心 → 共享梁（beamY）→ 子底中心 */
export function orgBeamPointsUp(parent: LinkAnchor, child: LinkAnchor, beamY: number): Point[] {
  return [
    { x: parent.box.x + parent.box.w / 2, y: parent.box.y },
    { x: parent.box.x + parent.box.w / 2, y: beamY },
    { x: child.box.x + child.box.w / 2, y: beamY },
    { x: child.box.x + child.box.w / 2, y: child.box.y + child.box.h },
  ];
}

/**
 * 组织架构连线（向上生长版；G6′ 四向生长）。
 * 与 orgBeamLink 镜像：起点取父**顶边**中点、终点取子**底边**中点。
 * beamY 落在父顶边与子底边之间（由调用方按 direction 计算）。
 */
export function orgBeamLinkUp(parent: LinkAnchor, child: LinkAnchor, beamY: number): string {
  return orthogonalPath(orgBeamPointsUp(parent, child, beamY));
}
