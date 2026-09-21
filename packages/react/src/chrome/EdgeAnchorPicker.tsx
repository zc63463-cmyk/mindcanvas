/**
 * EdgeAnchorPicker（R2-1）：重挂锚点的候选选择器。
 *
 * - 候选来自 collectNodeChoices（与 anchorOfNode 同一套 #N 消歧规则，零新逻辑）
 * - excludeAnchor：排除「选中后使 from === to」的候选（R2-A5 防数据自关联）
 * - Esc / 点遮罩取消；面板内 pointerDown stopPropagation（比照 EdgeEditor:106，
 *   防点击穿透启动画布 pan 手势或关闭浮层）
 * - 纯选择器：不做任何写操作，结果经 onPick(anchor) 交由调用方走唯一写路径
 */
import { useEffect, useMemo, useState } from 'react';
import { CHROME } from '../theme/tokens.js';

export interface EdgeAnchorChoice {
  id: string;
  label: string;
  anchor: string;
}

export function EdgeAnchorPicker({
  choices,
  onPick,
  onClose,
  excludeAnchor,
}: {
  choices: readonly EdgeAnchorChoice[];
  onPick: (anchor: string) => void;
  onClose: () => void;
  /** 排除项：当前另一端的锚（防自关联）；缺省不排 */
  excludeAnchor?: string;
}) {
  const [query, setQuery] = useState('');

  // Esc 取消（window 级：picker 常覆盖在浮窗/面板之上）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return choices.filter(
      (c) =>
        c.anchor !== excludeAnchor &&
        (q === '' || c.label.toLowerCase().includes(q) || c.anchor.toLowerCase().includes(q)),
    );
  }, [choices, excludeAnchor, query]);

  return (
    <div
      data-edge-anchor-cancel
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgba(0,0,0,0.25)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: CHROME.fontFamily,
      }}
    >
      <div
        data-edge-anchor-panel
        // 面板内的指针/点击不冒泡到遮罩（防画布手势穿透）
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 260,
          maxHeight: 320,
          display: 'flex',
          flexDirection: 'column',
          background: CHROME.panelBg,
          border: `1px solid ${CHROME.panelBorder}`,
          borderRadius: CHROME.radius,
          boxShadow: CHROME.shadow,
          backdropFilter: 'blur(14px) saturate(1.3)',
          color: CHROME.text,
          overflow: 'hidden',
        }}
      >
        <input
          data-edge-anchor-filter
          autoFocus
          placeholder="过滤节点…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            margin: 8,
            padding: '5px 8px',
            borderRadius: 6,
            border: `1px solid ${CHROME.panelBorder}`,
            background: 'rgba(255,255,255,0.04)',
            color: CHROME.text,
            fontSize: CHROME.fontSizeSmall,
            outline: 'none',
          }}
        />
        <div style={{ overflowY: 'auto', padding: '0 8px 8px' }}>
          {visible.length === 0 ? (
            <div
              data-edge-anchor-empty
              style={{
                color: CHROME.textMuted,
                fontSize: CHROME.fontSizeSmall,
                padding: '10px 4px',
                textAlign: 'center',
              }}
            >
              无候选节点
            </div>
          ) : (
            visible.map((c) => (
              <div
                key={c.id}
                data-edge-anchor-option={c.anchor}
                onClick={() => onPick(c.anchor)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 8px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: CHROME.fontSizeSmall,
                }}
              >
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.label}
                </span>
                <span
                  style={{
                    color: CHROME.textMuted,
                    fontSize: 10.5,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: 120,
                  }}
                >
                  {c.anchor}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
