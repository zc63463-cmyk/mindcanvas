/**
 * 主题切换控件：三主题一键切换（ADR-0003 决策 1）。
 * 切换即换令牌（ThemeContext.setTheme）——组件零重挂载；高亮玻璃霓虹态。
 */
import type { ThemeId } from '../theme/types.js';
import { useTheme } from '../theme/ThemeContext.js';
import { CHROME } from '../theme/tokens.js';

const THEME_LABELS: Array<{ id: ThemeId; label: string }> = [
  { id: 'classic', label: '经典' },
  { id: 'sticker', label: '贴纸' },
  { id: 'glass', label: '玻璃' },
];

export function ThemeSwitcher() {
  const { token, setTheme } = useTheme();
  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        background: CHROME.panelBg,
        border: `1px solid ${CHROME.panelBorder}`,
        borderRadius: CHROME.radiusSmall,
        padding: 3,
      }}
    >
      {THEME_LABELS.map(({ id, label }) => {
        const active = token.id === id;
        return (
          <button
            key={id}
            onClick={() => setTheme(id)}
            aria-pressed={active}
            style={{
              border: 'none',
              background: active ? CHROME.neonSoft : 'transparent',
              color: active ? CHROME.neon : CHROME.textMuted,
              borderRadius: CHROME.radiusSmall - 2,
              padding: '4px 12px',
              fontSize: CHROME.fontSizeSmall,
              fontFamily: CHROME.fontFamily,
              cursor: 'pointer',
              boxShadow: active ? `inset 0 0 0 1px ${CHROME.neon}` : 'none',
              transition: 'background 0.2s ease, color 0.2s ease',
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
