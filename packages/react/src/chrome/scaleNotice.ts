/**
 * 规模提示（T8 降级策略 L4）：图过大时向用户提示降级状态。
 * 纯函数（阈值与文案集中管理，便于测试与后续文案调整）。
 */

/** 激进简化提示阈值（> 20K：L1 激进 LOD 已生效） */
export const SCALE_NOTICE_LARGE = 20000;
/** 必须降级提示阈值（> 50K：建议折叠/换 Canvas 后端） */
export const SCALE_NOTICE_HUGE = 50000;

/** 节点数 → 提示文案（null = 无需提示） */
export function scaleNoticeFor(totalNodes: number): string | null {
  if (totalNodes > SCALE_NOTICE_HUGE) {
    return `图过大（${totalNodes.toLocaleString()} 节点）：已切换 Canvas 渲染，建议折叠深层分支以保持流畅`;
  }
  if (totalNodes > SCALE_NOTICE_LARGE) {
    return `图较大（${totalNodes.toLocaleString()} 节点）：已启用激进简化渲染`;
  }
  return null;
}
