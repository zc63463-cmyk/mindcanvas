/**
 * 自由画布工具条（FC-B）：选择 / 便签 / 面板。
 * 视觉沿用 chrome CHROME 玻璃令牌；按钮锚点 data-fc-tool 供集成与测试使用。
 */
import type { CSSProperties } from 'react';
import { CHROME } from '../theme/tokens.js';
import type { CanvasTool } from './toolTypes.js';

export interface ToolbarProps {
  tool: CanvasTool;
  onTool: (tool: CanvasTool) => void;
}

const ITEMS: ReadonlyArray<{ id: CanvasTool; label: string }> = [
  { id: 'select', label: '选择' },
  { id: 'sticky', label: '便签' },
  { id: 'panel', label: '面板' },
  { id: 'connect', label: '连线' },
];

const barStyle: CSSProperties = {
  position: 'absolute',
  left: 12,
  top: 12,
  zIndex: 100,
  display: 'flex',
  gap: 6,
  padding: 5,
  background: CHROME.panelBg,
  border: `1px solid ${CHROME.panelBorder}`,
  borderRadius: CHROME.radiusSmall,
  backdropFilter: 'blur(14px) saturate(1.3)',
  WebkitBackdropFilter: 'blur(14px) saturate(1.3)',
  boxShadow: CHROME.shadow,
};

function buttonStyle(active: boolean): CSSProperties {
  return {
    padding: '4px 10px',
    fontFamily: CHROME.fontFamily,
    fontSize: CHROME.fontSizeSmall,
    color: active ? CHROME.bg : CHROME.text,
    background: active ? CHROME.neon : 'transparent',
    border: `1px solid ${active ? CHROME.neon : CHROME.panelBorder}`,
    borderRadius: CHROME.radiusSmall - 2,
    cursor: 'pointer',
  };
}

export function Toolbar({ tool, onTool }: ToolbarProps) {
  return (
    <div data-fc-toolbar style={barStyle}>
      {ITEMS.map((it) => (
        <button
          key={it.id}
          type="button"
          data-fc-tool={it.id}
          aria-pressed={tool === it.id}
          onClick={() => onTool(it.id)}
          style={buttonStyle(tool === it.id)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
