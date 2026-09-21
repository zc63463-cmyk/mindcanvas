/**
 * ShortcutHelpPanel —— 快捷键帮助面板（`?` 打开）。
 * 玻璃卡片居中遮罩；列出 EDITOR_KEY_BINDINGS（key + label）。
 * v1.8.2（T7）：追加**② 二级环席位清单**（标签从派生模型 `subRingPagesFor` 取——
 * 与环/菜单同一份定义，改席位就不会漏改帮助面板）。
 * Esc / × / 点击遮罩 → onClose。视觉值全部来自 CHROME（组件内零颜色字面量）。
 */
import { useEffect } from 'react';
import { CHROME } from '../theme/tokens.js';
import { EDITOR_KEY_BINDINGS } from '../edit/keys.js';
import { subRingPagesFor } from '../edit/contextMenuItems.js';

/** 典型节点（非根 / 非中心 / 无 cid）的二级页席位——帮助面板只做「清单展示」 */
const SUB_PAGES = subRingPagesFor({
  isRoot: false,
  isCenter: false,
  hasCid: false,
  isHub: false,
  hasDesc: true,
  hasNote: true,
});
const SUB_SEAT_LABELS: readonly string[] = (SUB_PAGES[0] ?? []).map((it) => it.label);
const SUB_DIR_PAGE: string = (SUB_PAGES[1] ?? []).map((it) => it.label).join(' / ');

/** kbd 视觉（快捷键列与席位序号共用） */
const KBD_STYLE = {
  background: 'rgba(255,255,255,.06)',
  border: `1px solid ${CHROME.panelBorderStrong}`,
  borderRadius: 4,
  padding: '1px 7px',
  fontSize: CHROME.fontSizeSmall,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  minWidth: 64,
  textAlign: 'center',
  color: CHROME.text,
} as const;

export interface ShortcutHelpPanelProps {
  onClose: () => void;
}

export function ShortcutHelpPanel({ onClose }: ShortcutHelpPanelProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      data-help-backdrop
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,.45)',
        zIndex: 20,
      }}
    >
      <div
        role="dialog"
        aria-label="快捷键帮助"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 340,
          maxHeight: '70vh',
          overflowY: 'auto',
          background: CHROME.panelBg,
          border: `1px solid ${CHROME.panelBorder}`,
          borderRadius: CHROME.radius,
          boxShadow: CHROME.shadow,
          backdropFilter: 'blur(14px) saturate(1.3)',
          color: CHROME.text,
          fontFamily: CHROME.fontFamily,
          fontSize: CHROME.fontSizeSmall,
          padding: 16,
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 12,
          }}
        >
          <span style={{ color: CHROME.neon, fontWeight: 600, fontSize: CHROME.fontSize }}>
            快捷键
          </span>
          <span style={{ color: CHROME.textMuted, fontSize: CHROME.fontSizeSmall }}>
            {EDITOR_KEY_BINDINGS.length} 项
          </span>
          <span style={{ flex: 1 }} />
          <button
            aria-label="关闭快捷键帮助"
            data-help-close
            onClick={onClose}
            style={{
              border: 'none',
              background: 'transparent',
              color: CHROME.textMuted,
              cursor: 'pointer',
              fontSize: 14,
              lineHeight: 1,
              padding: 0,
              width: 18,
              height: 18,
            }}
          >
            ×
          </button>
        </div>
        {/* 一个 action 可有多条绑定（如 help：`?` 与 Alt+方向键）——key 必须复合唯一 */}
        {EDITOR_KEY_BINDINGS.map((b) => (
          <div
            key={`${b.action}:${b.key}`}
            data-shortcut-row
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '5px 2px',
              borderBottom: `1px solid ${CHROME.panelBorder}`,
            }}
          >
            <kbd style={KBD_STYLE}>{b.key}</kbd>
            <span style={{ color: CHROME.text, flex: 1 }}>{b.label}</span>
          </div>
        ))}

        {/* ② 二级环席位清单（T7）：标签来自派生模型 —— 与环/菜单同一份定义 */}
        <div style={{ marginTop: 14, marginBottom: 4, color: CHROME.neon, fontWeight: 600 }}>② 二级环席位</div>
        <div style={{ color: CHROME.textMuted, marginBottom: 6, lineHeight: 1.5 }}>
          一级环高亮「更多」→ 停顿 450ms（或 Enter / 点击）展开；条件不满足的席位灰显（锁着，不抽席）
        </div>
        {SUB_SEAT_LABELS.map((label, i) => (
          <div key={label} data-sub-seat style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 2px' }}>
            <kbd style={{ ...KBD_STYLE, minWidth: 22 }}>{i + 1}</kbd>
            <span data-sub-seat-label style={{ color: CHROME.text, flex: 1 }}>
              {label}
            </span>
          </div>
        ))}
        <div style={{ color: CHROME.textMuted, marginTop: 6, lineHeight: 1.5 }}>
          方向页（升为中心 › Enter）：{SUB_DIR_PAGE}
        </div>
      </div>
    </div>
  );
}
