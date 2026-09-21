/**
 * 玻璃面板基座（chrome 通用容器）：深色半透明 + 霓虹描边（ADR-0003 决策 3 恒定玻璃气质）。
 * 视觉值全部来自 theme/tokens.ts 的 CHROME——组件内零颜色字面量。
 */
import type { CSSProperties, ReactNode } from 'react';
import { CHROME } from '../theme/tokens.js';

export interface GlassCardProps {
  children: ReactNode;
  /** 强调态（霓虹描边；如翻卡展开/选中） */
  accent?: boolean;
  style?: CSSProperties;
  onClick?: () => void;
}

export function GlassCard({ children, accent, style, onClick }: GlassCardProps) {
  return (
    <div
      onClick={onClick}
      style={{
        background: CHROME.panelBg,
        border: `1px solid ${accent ? CHROME.panelBorderStrong : CHROME.panelBorder}`,
        borderRadius: CHROME.radius,
        boxShadow: CHROME.shadow,
        color: CHROME.text,
        fontFamily: CHROME.fontFamily,
        fontSize: CHROME.fontSize,
        backdropFilter: 'blur(14px) saturate(1.3)',
        WebkitBackdropFilter: 'blur(14px) saturate(1.3)',
        transition: 'border-color 0.2s ease',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
