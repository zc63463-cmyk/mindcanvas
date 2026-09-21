/**
 * 连线避障（linkClear）：树连线不得从别的节点盒上穿过去。
 *
 * 背景：四向分叉后子节点被推到父的四周，**连线为了够到它会横穿中间的兄弟子树**
 * （右侧组被 anchored 子树挡住 → 贝塞尔一路穿过去；下方组梁线的横段压过别支）。
 * 盒不相交 ≠ 画面干净——线压盒同样是「重叠」。
 *
 * 做法：**不动节点，只换连线**。
 * 早期版本用「把挡道子树推开」来做，实测越推越糟（推出这条线的一段，往往正好落进
 * 同一条线的另一段或其它连线，200 例随机树上推动上万次、穿越反增）。
 * 现改为：在**同族几何**里挑一条干净的——梁线换共享梁的 y，贝塞尔换弓向/弓高；
 * 默认几何本来就干净时**逐值返回默认**（多数文档因此零视觉变化）。
 *
 * 零依赖、零 DOM，可独立测试。
 */
import type { Box, LayoutNode, Point } from './mindmap.js';

/** 连线几何：SVG path + 同源折线（折线即避障判定用的那条线） */
export interface LinkGeometry {
  path: string;
  points: Point[];
}

/** 连线折线：由调用方按（父, 子）给出，与渲染 path 同源 */
export type LinkPoints = (parent: LayoutNode, child: LayoutNode) => readonly Point[];

export interface LinkClearOptions {
  /** 连线与节点盒之间要求的最小净空（px）。缺省 {@link LINK_CLEAR_MARGIN} */
  margin?: number;
  /** 单轮/单链最多推动次数（防病态输入把整棵树推飞）。缺省 32 */
  maxPushes?: number;
}

/**
 * 「走廊排斥 ↔ 盒重叠消解」交替的最大轮次。
 *
 * 推开挡道子树可能引入新的盒重叠，消解又可能把兄弟推回走廊——两者相互牵制，
 * 必须交替；到达上限时最后执行的是**盒重叠消解**（零重叠优先于零穿越）。
 */
export const LINK_CLEAR_ROUNDS = 4;

/** 连线与节点盒的净空（px）：略小于 V_GAP，够看清不贴边即可 */
export const LINK_CLEAR_MARGIN = 6;

/** 线段是否穿过轴对齐矩形（slab / Liang-Barsky 裁剪） */
export function segmentHitsRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  if (Math.abs(dx) < 1e-9) {
    if (x1 < rx || x1 > rx + rw) return false;
  } else {
    let ta = (rx - x1) / dx;
    let tb = (rx + rw - x1) / dx;
    if (ta > tb) {
      const tmp = ta;
      ta = tb;
      tb = tmp;
    }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return false;
  }
  if (Math.abs(dy) < 1e-9) {
    if (y1 < ry || y1 > ry + rh) return false;
  } else {
    let ta = (ry - y1) / dy;
    let tb = (ry + rh - y1) / dy;
    if (ta > tb) {
      const tmp = ta;
      ta = tb;
      tb = tmp;
    }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return false;
  }
  return true;
}

/** 盒（外扩 margin）是否被折线穿过；返回首个命中的线段下标，-1 = 未命中 */
export function polylineHitsBox(pts: readonly Point[], box: Box, margin = 0): number {
  if (pts.length < 2) return -1;
  const rx = box.x - margin;
  const ry = box.y - margin;
  const rw = box.w + margin * 2;
  const rh = box.h + margin * 2;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a === undefined || b === undefined) continue;
    if (segmentHitsRect(a.x, a.y, b.x, b.y, rx, ry, rw, rh)) return i;
  }
  return -1;
}

/** 折线包围盒 */
export function polylineBox(pts: readonly Point[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (pts.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * 节点空间索引：按格分桶，避免「每根连线 × 全部节点」的 O(n²) 粗筛。
 *
 * 只读用途——本模块**不移动任何节点**，索引可整轮复用。
 */
export class NodeIndex {
  private readonly buckets = new Map<string, LayoutNode[]>();

  constructor(
    nodes: readonly LayoutNode[],
    private readonly cell = 160,
  ) {
    for (const n of nodes) this.insert(n);
  }

  private insert(n: LayoutNode): void {
    const c = this.cell;
    const x0 = Math.floor(n.box.x / c);
    const x1 = Math.floor((n.box.x + n.box.w) / c);
    const y0 = Math.floor(n.box.y / c);
    const y1 = Math.floor((n.box.y + n.box.h) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = `${cx}:${cy}`;
        const arr = this.buckets.get(k);
        if (arr) arr.push(n);
        else this.buckets.set(k, [n]);
      }
    }
  }

  /** 与给定矩形可能相交的节点（粗筛，去重） */
  query(box: Box, margin = 0): LayoutNode[] {
    const c = this.cell;
    const out: LayoutNode[] = [];
    const seen = new Set<LayoutNode>();
    const x0 = Math.floor((box.x - margin) / c);
    const x1 = Math.floor((box.x + box.w + margin) / c);
    const y0 = Math.floor((box.y - margin) / c);
    const y1 = Math.floor((box.y + box.h + margin) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const arr = this.buckets.get(`${cx}:${cy}`);
        if (!arr) continue;
        for (const n of arr) {
          if (seen.has(n)) continue;
          seen.add(n);
          out.push(n);
        }
      }
    }
    return out;
  }
}

/** 收集一棵树的所有节点（前序） */
export function collectNodes(root: LayoutNode): LayoutNode[] {
  const out: LayoutNode[] = [];
  const stack: LayoutNode[] = [root];
  while (stack.length > 0) {
    const n = stack.pop();
    if (n === undefined) continue;
    out.push(n);
    for (const c of n.children) stack.push(c);
  }
  return out;
}

/**
 * 在候选几何里挑一条**不压节点盒**的；都压则挑压得最少的；都不可用则回退首个（默认几何）。
 *
 * 候选按「越靠前越接近默认」排列：默认几何干净时第一个就命中 → 逐值返回默认，
 * 绝大多数文档的连线与启用避障前完全一致。
 */
export function pickClearGeometry(
  candidates: readonly LinkGeometry[],
  index: NodeIndex,
  fromId: string,
  toId: string,
  margin = LINK_CLEAR_MARGIN,
): LinkGeometry {
  const first = candidates[0];
  if (first === undefined) throw new Error('候选几何为空');
  let best = first;
  let bestHits = Infinity;
  for (const cand of candidates) {
    const box = polylineBox(cand.points);
    let hits = 0;
    for (const n of index.query(box, margin)) {
      if (n.node.id === fromId || n.node.id === toId) continue;
      if (polylineHitsBox(cand.points, n.box, margin) >= 0) hits++;
    }
    if (hits === 0) return cand; // 干净 → 直接采用（含默认几何）
    if (hits < bestHits) {
      bestHits = hits;
      best = cand;
    }
  }
  return best;
}

/**
 * 路由走廊排斥：**路由走廊**（连线折线包围盒 + margin；区别于 clearParentEdges 的
 * 「出边走廊」与 clamp 闸门的「梁位带」）里若躺着**目标节点的兄弟**，
 * 把那棵兄弟子树沿位移更小的方向推出走廊。
 *
 * 适用面刻意收窄到「兄弟挡道」——这是四向分叉最高频的穿越
 * （up/down 组与 anchored 兄弟抢父节点上/下方的同一片空间），也最容易收敛：
 * 兄弟本来就该纵向堆叠，推出走廊后由盒消解恢复堆叠间距。
 * 更深/更远的阻塞者涉及全局重排，交由梁线换画法（beamVariants 障碍采样）处理。
 *
 * @returns 实际推动次数
 */
export function clearLinkCorridors(
  root: LayoutNode,
  linkPoints: LinkPoints,
  opts: LinkClearOptions = {},
): number {
  const margin = opts.margin ?? LINK_CLEAR_MARGIN;
  const maxPushes = opts.maxPushes ?? 32;
  let pushes = 0;

  const walk = (ln: LayoutNode): void => {
    if (pushes >= maxPushes) return;
    for (const child of ln.children) {
      if (pushes >= maxPushes) return;
      const pts = linkPoints(ln, child);
      if (pts.length >= 2) {
        const corridor = inflate(polylineBox(pts), margin);
        for (const b of ln.children) {
          if (pushes >= maxPushes) return;
          if (b === child) continue;
          if (!boxesOverlapInflated(corridor, b.box, 0)) continue;
          // 沿位移更小的方向把整棵兄弟子树推出走廊
          const right = corridor.x + corridor.w - b.box.x;
          const left = corridor.x - (b.box.x + b.box.w);
          const down = corridor.y + corridor.h - b.box.y;
          const up = corridor.y - (b.box.y + b.box.h);
          let dx = 0;
          let dy = 0;
          let best = Infinity;
          for (const [d, axis] of [
            [right, 'x'],
            [left, 'x'],
            [down, 'y'],
            [up, 'y'],
          ] as const) {
            const mag = Math.abs(d);
            if (mag < best) {
              best = mag;
              dx = axis === 'x' ? d : 0;
              dy = axis === 'y' ? d : 0;
            }
          }
          if (dx === 0 && dy === 0) continue;
          translateOut(b, dx, dy);
          pushes++;
        }
      }
      walk(child);
      if (pushes >= maxPushes) return;
    }
  };
  walk(root);
  return pushes;
}

/** 盒外扩 */
function inflate(b: Box, margin: number): Box {
  return { x: b.x - margin, y: b.y - margin, w: b.w + margin * 2, h: b.h + margin * 2 };
}

/** 两盒相交（a 已含自身外扩） */
function boxesOverlapInflated(a: Box, b: Box, margin: number): boolean {
  return (
    a.x < b.x + b.w + margin &&
    b.x < a.x + a.w + margin &&
    a.y < b.y + b.h + margin &&
    b.y < a.y + a.h + margin
  );
}

/** 刚体平移子树 */
function translateOut(ln: LayoutNode, dx: number, dy: number): void {
  ln.box.x += dx;
  ln.box.y += dy;
  for (const c of ln.children) translateOut(c, dx, dy);
}

/**
 * 全树连线穿越扫描（诊断 / 测试用）：返回被连线穿过的节点。
 *
 * 复杂度 O(连线数 × 节点数)，定位为诊断工具，不进入生产热路径。
 */
export function findLinkCrossings(
  root: LayoutNode,
  linkPoints: (parent: LayoutNode, child: LayoutNode) => readonly Point[],
  margin = 0,
): Array<{ from: LayoutNode; to: LayoutNode; node: LayoutNode }> {
  const all = collectNodes(root);
  const index = new NodeIndex(all);
  const out: Array<{ from: LayoutNode; to: LayoutNode; node: LayoutNode }> = [];
  const walk = (ln: LayoutNode): void => {
    for (const child of ln.children) {
      const pts = linkPoints(ln, child);
      if (pts.length >= 2) {
        for (const n of index.query(polylineBox(pts), margin)) {
          if (n === ln || n === child) continue;
          if (polylineHitsBox(pts, n.box, margin) >= 0) {
            out.push({ from: ln, to: child, node: n });
          }
        }
      }
      walk(child);
    }
  };
  walk(root);
  return out;
}
