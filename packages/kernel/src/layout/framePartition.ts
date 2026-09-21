/**
 * 框子树按 `depth` 切分（FO-A3 · 设计 §5.1 布局岛）：**大纲区**与**空间挂载层**的输入契约。
 *
 * 相对框根深度 `d`（框根 `d = 0`）：
 *  - `d ∈ [0, depth]` → 进大纲（`outlineIds`，**前序顺序**即大纲显示顺序）；
 *  - `d === depth + 1` 的每个节点 → 一条挂点（`hangRoots`，锚在 `d === depth` 的那一行）；
 *  - 更深后代整体留在空间层，挂在对应 `spatialRoot` 下（不再细分——它们本就是普通子树）。
 *
 * 纯函数、零副作用、**不搬家**：`spatialRoot` 是原树里的**同一对象引用**，
 * 不复制、不重建 AST、不改 `children`（设计 §0「单一事实源」/ 全保真往返的落点）。
 *
 * 为什么在 `layout/`：它是布局岛的输入形状（B1 据 `outlineIds` 排行、据 `hangRoots`
 * 从挂点侧接出空间子树），不是协议字段访问器（后者见 `protocol/frame.ts`）。
 */
import type { EditableNode } from '../tree/treeOps.js';

/** 一条挂点：`outlineNodeId` = `d === depth` 的大纲行；`spatialRoot` = 其某个 `d === depth + 1` 的孩子（整棵子树属空间层） */
export interface FrameHangRoot {
  outlineNodeId: string;
  spatialRoot: EditableNode;
}

export interface FramePartition {
  /** 框头 + `1..depth` 层节点 id（DFS 前序）；空框（仅框根）也可能只有一项 */
  outlineIds: string[];
  /** `d === depth` 的节点各孩子一条；顺序 = 大纲行顺序 × 原 `children` 顺序 */
  hangRoots: FrameHangRoot[];
}

/**
 * 切分框子树。`depth` 正常由 `clampFrameDepth` 产出（有限整数 ≥ 1）；此处仍兜一层
 * （非有限 → 0，负数/小数 → 收敛到 ≥ 0 的整数），避免脏入参产出半截分区。
 */
export function partitionFrameSubtree(frameRoot: EditableNode, depth: number): FramePartition {
  const depth0 = Number.isFinite(depth) ? Math.max(0, Math.floor(depth)) : 0;
  const outlineIds: string[] = [];
  const hangRoots: FrameHangRoot[] = [];
  const walk = (node: EditableNode, d: number): void => {
    outlineIds.push(node.id);
    if (d === depth0) {
      // 挂点行：每个孩子各一条；不再下行（更深后代随 spatialRoot 整体属空间层）
      for (const child of node.children) hangRoots.push({ outlineNodeId: node.id, spatialRoot: child });
      return;
    }
    for (const child of node.children) walk(child, d + 1);
  };
  walk(frameRoot, 0);
  return { outlineIds, hangRoots };
}
