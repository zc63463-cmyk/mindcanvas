/**
 * PROMOTE-SEED-1：布局盒中心取点（升格落点 / 切断落点共用单点）。
 *
 * 「升格为独立岛」与「切断并独立」都要求新岛落在**动作前该节点的可视邻域**，
 * 否则无坐标岛会被 layoutForest 排到森林自动槽（y≈0 右端）造成视觉跳变。
 * 两处若各写一遍 `{ x: box.x + w/2, y: box.y + h/2 }` 容易漂移——统一为本模块。
 *
 * 未命中（折叠隐藏 / 未入 layout）→ undefined：调用方**不得**回落 (0,0)，
 * 应走既有历史吸附（center_pos）或交由自动排布（协议口径）。
 */

/** 只依赖 nodes[].{node.id, box} 的最小结构——避免把 React 层类型引入纯取点 */
export interface LayoutBoxLike {
  readonly node: { readonly id: string };
  readonly box: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  };
}

export interface LayoutLike {
  readonly nodes: readonly LayoutBoxLike[];
}

export function layoutBoxCenterOf(
  layout: LayoutLike,
  nodeId: string,
): { x: number; y: number } | undefined {
  const ln = layout.nodes.find((n) => n.node.id === nodeId);
  if (ln === undefined) return undefined;
  return { x: ln.box.x + ln.box.w / 2, y: ln.box.y + ln.box.h / 2 };
}
