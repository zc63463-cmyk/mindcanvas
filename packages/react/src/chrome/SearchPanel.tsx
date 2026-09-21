/**
 * SearchPanel —— Ctrl+F 富文本搜索面板（批次 3）。
 * 顶部居中浮层：输入即搜；↑/↓ 或 Enter/Shift+Enter 轮换激活项；点击结果或再次 Enter 跳转选中；
 * Esc → onClose。视觉值全部来自 CHROME。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CHROME } from '../theme/tokens.js';
import type { SearchHit } from '../search/search.js';

export interface SearchPanelProps {
  /** 搜索实现（外部注入：searchMind(root, q)） */
  search: (query: string) => SearchHit[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function SearchPanel({ search, onSelect, onClose }: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  // B-P6：检索结果按 [query, search] memo —— search 是全树 walk（O(全树)），
  // 原先渲染体内直算：父组件每帧重渲、甚至 ↑/↓ 的 setActive 都会重跑一次。
  // deps 含 search 引用 → 注入方须提供稳定闭包（SidePanels 已用 useCallback 固定）。
  const results = useMemo(() => (query.trim() ? search(query) : []), [query, search]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const resetQuery = (q: string): void => {
    setQuery(q);
    setActive(0);
  };

  const jump = (dir: 1 | -1): void => {
    if (results.length === 0) return;
    setActive((a) => (a + dir + results.length) % results.length);
  };

  const goActive = (): void => {
    const hit = results[active];
    if (hit) onSelect(hit.id);
    onClose();
  };

  return (
    <div
      data-search-backdrop
      onPointerDown={onClose}
      style={{ position: 'absolute', inset: 0, zIndex: 25 }}
    >
      <div
        role="dialog"
        aria-label="搜索"
        data-search-panel
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: 56,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 400,
          background: CHROME.panelBg,
          border: `1px solid ${CHROME.panelBorder}`,
          borderRadius: CHROME.radius,
          boxShadow: CHROME.shadow,
          backdropFilter: 'blur(14px) saturate(1.3)',
          color: CHROME.text,
          fontFamily: CHROME.fontFamily,
          overflow: 'hidden',
          zIndex: 26,
        }}
      >
        <input
          ref={inputRef}
          data-search-input
          value={query}
          placeholder="搜索标题 / 笔记 / 批注…（Esc 关闭，Enter 跳转）"
          onChange={(e) => resetQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault();
              if (results.length === 0) return;
              if (e.shiftKey) jump(-1);
              else goActive();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              jump(1);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              jump(-1);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: CHROME.text,
            fontFamily: CHROME.fontFamily,
            fontSize: CHROME.fontSize,
            padding: '10px 14px',
            borderBottom: `1px solid ${CHROME.panelBorder}`,
          }}
        />
        <div style={{ maxHeight: 320, overflowY: 'auto', padding: 4 }}>
          {query.trim() === '' ? (
            <div
              style={{
                padding: '10px 14px',
                color: CHROME.textMuted,
                fontSize: CHROME.fontSizeSmall,
              }}
            >
              输入关键词搜索画布节点（含笔记与批注）
            </div>
          ) : results.length === 0 ? (
            <div
              style={{
                padding: '10px 14px',
                color: CHROME.textMuted,
                fontSize: CHROME.fontSizeSmall,
              }}
            >
              无匹配
            </div>
          ) : (
            results.map((r, i) => (
              <div
                key={r.id}
                role="option"
                aria-selected={i === active}
                data-search-result
                data-active={i === active}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(r.id);
                  onClose();
                }}
                onMouseEnter={() => setActive(i)}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: i === active ? 'rgba(255,255,255,.08)' : 'transparent',
                }}
              >
                <div
                  style={{
                    fontSize: CHROME.fontSize,
                    color: CHROME.text,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {r.label}
                </div>
                <div
                  style={{
                    fontSize: CHROME.fontSizeSmall,
                    color: CHROME.textMuted,
                    marginTop: 2,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {r.pathLabel}
                </div>
                <div
                  style={{
                    fontSize: CHROME.fontSizeSmall,
                    color: CHROME.neon,
                    marginTop: 2,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {r.snippet}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
