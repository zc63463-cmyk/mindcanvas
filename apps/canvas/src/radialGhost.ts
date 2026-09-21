/**
 * 幽灵预览几何（v1.8.0 Phase 3 ①）——纯函数：四向落点 + 视口内收（设计决策 A1）。
 *
 * - 间距与布局同源：水平 H_GAP(64) / 垂直 V_GAP(14)（世界单位 × 当前缩放 k）——
 *   「看到幽灵的落点 ≈ 提交后新节点的落点」；方向由调用方按 addChild 命令同源推断。
 * - 盒尺寸 = 源节点盒尺寸（近似：新节点宽度不可知，不做真实测宽——YAGNI）。
 * - 贴视口边缘向内收（EDGE_PAD）；视口过小时取尽力值。
 */
import { type GrowDir, H_GAP, V_GAP } from '@mindcanvas/kernel';

export interface GhostBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 源节点盒：客户端坐标 + 当前缩放（MapViewApi.nodeBox 的返回值） */
export interface SourceNodeBox {
  x: number;
  y: number;
  w: number;
  h: number;
  k: number;
}

/** 视口安全边距（px） */
const EDGE_PAD = 8;

/** 幽灵盒 = 源节点盒在 dir 侧隔布局间距；视口边缘内收 */
export function ghostBoxOf(node: SourceNodeBox, dir: GrowDir, vw: number, vh: number): GhostBox {
  const gapX = H_GAP * node.k;
  const gapY = V_GAP * node.k;
  let x = node.x;
  let y = node.y;
  if (dir === 'right') x = node.x + node.w + gapX;
  else if (dir === 'left') x = node.x - node.w - gapX;
  else if (dir === 'down') y = node.y + node.h + gapY;
  else y = node.y - node.h - gapY;
  return {
    x: Math.min(Math.max(x, EDGE_PAD), Math.max(EDGE_PAD, vw - node.w - EDGE_PAD)),
    y: Math.min(Math.max(y, EDGE_PAD), Math.max(EDGE_PAD, vh - node.h - EDGE_PAD)),
    w: node.w,
    h: node.h,
  };
}
