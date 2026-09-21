/**
 * 连线渲染组件（按 token.lineStyle.language 分支——彩色曲线/任意曲线/柔和贝塞尔）。
 * 路径与颜色结论来自 geometry.buildLinkPath（纯函数），组件只做投影。
 */
export interface LinkGProps {
  d: string;
  stroke: string;
  width: number;
}

export function LinkG({ d, stroke, width }: LinkGProps) {
  return (
    <path
      d={d}
      fill="none"
      stroke={stroke}
      strokeWidth={(width + 0.2).toFixed(2)}
      strokeLinecap="round"
    />
  );
}
