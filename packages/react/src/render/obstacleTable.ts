/**
 * G-P3：障碍集预构建表（自由边路由整表重算的内层分配优化）。
 *
 * 旧实现每条边都跑
 *   `obstacles.filter((o) => o.id !== fromId && o.id !== toId).map((o) => o.box)`
 * —— 两次 O(N) 遍历 + 两个新数组；整表重算成本 ≈ E×N×2。
 * 本表把「盒数组」与「id → 下标」构建一次，`without()` 只做一次 O(N) 的整数比较过滤；
 * 端点不在障碍集时**零拷贝复用**（动画期/幽灵边的常见情形）。
 *
 * G-P3b：在此基础上加**索引粗筛** `near()`（大图时）—— 见下方保守界推导。
 *
 * 语义等价（含顺序——routeAesthetic 对障碍顺序敏感）由 `freeedge-equivalence.test.ts` 钉死：
 * `without(f, t)` 与 `obstacles.filter((o) => o.id !== f && o.id !== t).map((o) => o.box)`
 * 逐项相同。前提：障碍集内 id 唯一（生产方 `edgeObstaclesOf` 由 layout.nodes 映射而来）。
 */
import type { Box } from '@mindcanvas/kernel';
import { buildBoxIndex, queryBoxIndex } from '@mindcanvas/kernel';

/** G-P3b：建索引的障碍数阈值（与 MapView.INDEX_MIN_NODES 同口径） */
export const OBSTACLE_INDEX_MIN_NODES = 1000;

export interface ObstacleTable {
  /** 预构建盒数组（与输入同序；routeAesthetic 顺序敏感，不得重排） */
  readonly boxes: readonly Box[];
  /** 排除两端点后的障碍数组（端点不在障碍集 → 复用 boxes 引用，零分配） */
  without(fromId: string, toId: string): readonly Box[];
  /**
   * G-P3b 索引粗筛：返回「a↔b 间任意候选曲线可能触及」的障碍子集（升序同序、已排除端点）；
   * 无索引 / 粗筛收益不足（子集 ≥ 60%）→ null（调用方回退 `without` 完整路径）。
   *
   * 保守界推导（读自 edgeRouting.ts 常量，保证**结果逐位等价**）：
   *  - 候选曲线 = hull(p0, c1, c2, p3)：锚点在两端盒边上（⊆ span(a,b)）；
   *    控制点沿弦 ≤ 0.65·chord、法向 bow = 0.75·|c|·chord ≤ 0.9975·chord（MAX_ABS_C = 1.33）；
   *    语义 S 形快路径延伸 ext = max(0.4·chord, 20)。
   *  - ⇒ 曲线距 span(a,b) 的最大外扩 ≤ 1.65·chord + pad(3)。
   *  - chord ≤ centerDist + halfDiag(a) + halfDiag(b)；走廊集另需 span(中心) ± 180。
   *  - ⇒ R = 2·chordMax + 210 ≥ 1.65·chord + 180 + 3（余量 ≥ 27）。窗口外的障碍
   *    不可能与任何候选曲线相交、不在走廊集内 → 不参与任何判定分支。
   */
  near(a: Box, b: Box, fromId: string, toId: string): readonly Box[] | null;
}

/** 空表单例（无障碍场景复用，避免每次新建对象） */
export const EMPTY_OBSTACLE_TABLE: ObstacleTable = {
  boxes: [],
  without: () => [],
  near: () => null,
};

export function buildObstacleTable(
  obstacles: readonly { id: string; box: Box }[],
  opts?: { indexMinNodes?: number; cellSize?: number },
): ObstacleTable {
  if (obstacles.length === 0) return EMPTY_OBSTACLE_TABLE;
  const boxes = obstacles.map((o) => o.box);
  const idxOf = new Map<string, number>();
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    if (o) idxOf.set(o.id, i);
  }
  const index =
    obstacles.length >= (opts?.indexMinNodes ?? OBSTACLE_INDEX_MIN_NODES)
      ? buildBoxIndex(boxes, opts?.cellSize)
      : null;
  return {
    boxes,
    without(fromId, toId) {
      const i1 = idxOf.get(fromId);
      const i2 = idxOf.get(toId);
      if (i1 === undefined && i2 === undefined) return boxes;
      return boxes.filter((_box, i) => i !== i1 && i !== i2);
    },
    near(a, b, fromId, toId) {
      if (!index) return null;
      const halfDiag = (x: Box): number => Math.hypot(x.w, x.h) / 2;
      const centerDist = Math.hypot(
        a.x + a.w / 2 - (b.x + b.w / 2),
        a.y + a.h / 2 - (b.y + b.h / 2),
      );
      const R = 2 * (centerDist + halfDiag(a) + halfDiag(b)) + 210;
      const x0 = Math.min(a.x, b.x) - R;
      const y0 = Math.min(a.y, b.y) - R;
      const x1 = Math.max(a.x + a.w, b.x + b.w) + R;
      const y1 = Math.max(a.y + a.h, b.y + b.h) + R;
      const picked = queryBoxIndex(index, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      // 粗筛收益不足（子集 ≥ 60%）→ 回退完整路径（长边窗口 ≈ 全图，查询成本白付但无负收益）
      if (picked.length * 5 >= boxes.length * 3) return null;
      const i1 = idxOf.get(fromId);
      const i2 = idxOf.get(toId);
      const out: Box[] = [];
      for (const i of picked) {
        if (i === i1 || i === i2) continue;
        const box = boxes[i];
        if (box) out.push(box);
      }
      return out;
    },
  };
}
