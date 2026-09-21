/**
 * ContextMenu —— 节点右键菜单（批次 2）。
 * 绝对定位在 (x,y)；菜单项 { label, onSelect?, danger?, disabled?, section?, hint?, page? }。
 * 点击项 → onSelect + onClose；Esc / 点击遮罩（外部）→ onClose。
 * v1.8.1：支持分区标题（section 变化处渲染小标题 + 分隔线）与快捷键提示（hint，右对齐 kbd）。
 * v1.8.2（T6）：支持**菜单内翻页** `page` —— 方向型 / 参数型动作收进子页（首行恒为「‹ 返回」），
 *   与环「同一外圈换页」同语义：不占首屏行、不加深操作深度。折叠行 label 自带当前值（如「生长方向：向右」）。
 * 视觉值全部来自 CHROME（组件内零颜色字面量）。
 */
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { CHROME } from '../theme/tokens.js';

/** 菜单与视口边缘的安全边距（px） */
const EDGE_PAD = 8;

export interface ContextMenuItem {
  label: string;
  /** 提交动作。**翻页项**（`page` 非空）可省略——点击即进入子页，不关闭菜单 */
  onSelect?: () => void;
  /** 危险操作（删除）：红色语义 */
  danger?: boolean;
  /** 禁用态（置灰、不可点；如根节点不可切断） */
  disabled?: boolean;
  /** 分区标题（v1.8.1）：与上一项 section 不同 → 渲染标题与分隔线 */
  section?: string;
  /** 快捷键提示（如 Tab / F2 / Shift+Enter）：行内右侧 kbd 样式 */
  hint?: string;
  /**
   * v1.8.2 菜单内**翻页**：点击该项把列表替换为该子页（行尾渲染 `›`），
   * 子页首行恒为「‹ 返回」（点击 / ← / Backspace 回上一页）。
   * 用途：方向型（四向）/ 参数型（长度预设）动作——不占首屏行。
   */
  page?: ContextMenuItem[];
}

export interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/** 快捷键提示样式（行内右侧 kbd；与 ShortcutHelpPanel 的 kbd 视觉同族） */
const HINT_STYLE: CSSProperties = {
  fontSize: CHROME.fontSizeSmall,
  color: CHROME.textMuted,
  border: `1px solid ${CHROME.panelBorderStrong}`,
  borderRadius: 4,
  padding: '0 5px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  /** v1.8.2 翻页栈：空 = 首屏；末项 = 当前子页（存 title 供「返回」行显示来源） */
  const [pages, setPages] = useState<ReadonlyArray<{ title: string; items: ContextMenuItem[] }>>([]);
  const list = pages.length > 0 ? (pages[pages.length - 1]?.items ?? items) : items;
  const back = (): void => setPages((p) => p.slice(0, -1));

  /**
   * 视口钳制（T6 真浏览器实测）：节点贴近底/右边时右键，菜单会顶出屏幕、下面的行点不到。
   * 渲染后按实测尺寸把菜单收进视口（与环锚点钳制同旨）；翻页改变高度后自动重钳。
   */
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const nx = Math.max(EDGE_PAD, Math.min(x, window.innerWidth - r.width - EDGE_PAD));
    const ny = Math.max(EDGE_PAD, Math.min(y, window.innerHeight - r.height - EDGE_PAD));
    setPos((prev) => (prev.x === nx && prev.y === ny ? prev : { x: nx, y: ny }));
  }, [x, y, list]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // Esc = 一键关闭（右键菜单的通用肌肉记忆）；返回上一页用「‹ 返回」行 / ← / Backspace
        onClose();
        return;
      }
      if ((e.key === 'ArrowLeft' || e.key === 'Backspace') && pages.length > 0) {
        e.preventDefault();
        setPages((p) => p.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, pages.length]);

  return (
    <div
      data-menu-backdrop
      onPointerDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
      style={{ position: 'absolute', inset: 0, zIndex: 30 }}
    >
      <div
        ref={ref}
        role="menu"
        aria-label="节点菜单"
        data-context-menu
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          left: pos.x,
          top: pos.y,
          minWidth: 168,
          maxHeight: 'calc(100vh - 16px)',
          overflowY: 'auto',
          background: CHROME.panelBg,
          border: `1px solid ${CHROME.panelBorder}`,
          borderRadius: CHROME.radius,
          boxShadow: CHROME.shadow,
          backdropFilter: 'blur(14px) saturate(1.3)',
          color: CHROME.text,
          fontFamily: CHROME.fontFamily,
          fontSize: CHROME.fontSize,
          padding: 4,
          zIndex: 31,
        }}
      >
        {pages.length > 0 && (
          <div
            role="menuitem"
            data-menu-back
            onClick={(e) => {
              e.stopPropagation();
              back();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              padding: '6px 10px',
              borderRadius: 6,
              cursor: 'pointer',
              color: CHROME.textMuted,
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,.06)';
            }}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <span style={{ flex: 1 }}>‹ 返回</span>
            <span style={HINT_STYLE}>{pages[pages.length - 1]?.title}</span>
          </div>
        )}
        {list.map((item, i) => {
          const newSection = item.section !== undefined && item.section !== list[i - 1]?.section;
          return (
            <Fragment key={`${i}-${item.label}`}>
              {newSection && (
                <div
                  data-menu-section
                  style={{
                    padding: i === 0 ? '4px 10px 3px' : '9px 10px 3px',
                    marginTop: i === 0 ? 0 : 2,
                    borderTop: i === 0 ? undefined : `1px solid ${CHROME.panelBorder}`,
                    fontSize: CHROME.fontSizeSmall,
                    color: CHROME.textMuted,
                    letterSpacing: '.4px',
                  }}
                >
                  {item.section}
                </div>
              )}
              <div
                role="menuitem"
                data-menu-item
                data-menu-disabled={item.disabled === true ? 'true' : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  if (item.disabled === true) return;
                  if (item.page !== undefined) {
                    // 翻页项：不关闭菜单，列表替换为子页（与环「同一外圈换页」同语义）
                    setPages((p) => [...p, { title: item.label, items: item.page ?? [] }]);
                    return;
                  }
                  item.onSelect?.();
                  onClose();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  padding: '6px 10px',
                  borderRadius: 6,
                  cursor: item.disabled === true ? 'default' : 'pointer',
                  color: item.disabled === true
                    ? CHROME.textMuted
                    : item.danger
                      ? CHROME.warn
                      : CHROME.text,
                  opacity: item.disabled === true ? 0.55 : 1,
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={(e) => {
                  if (item.disabled === true) return;
                  e.currentTarget.style.background = 'rgba(255,255,255,.06)';
                }}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.hint !== undefined && <span style={HINT_STYLE}>{item.hint}</span>}
                {item.page !== undefined && <span style={{ color: CHROME.textMuted }}>›</span>}
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
