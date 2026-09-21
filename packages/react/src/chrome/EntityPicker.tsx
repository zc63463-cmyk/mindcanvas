/**
 * EntityPicker —— 实体选择器（M1：画布侧实体入口）。
 * `@` 触发 / 实体节点编辑共用：kind 徽章行 + 搜索 + 候选列表 + 新建项（输入即新 id）
 * + 清除引用（实体 → 纯文本）。候选由宿主注入（demo 用已解析实体 + 登记项）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CHROME } from '../theme/tokens.js';

export interface EntityCandidate {
  kind: string;
  id: string;
  title: string;
}

export interface EntityPickerProps {
  /** 可选实体类型（来自 kind 注册表） */
  kinds: readonly string[];
  /** 候选实体（宿主注入） */
  candidates: readonly EntityCandidate[];
  /** 初始查询串（`@` 后输入的内容） */
  initialQuery?: string;
  /** 初始 kind（编辑既有实体时预选） */
  initialKind?: string;
  /** 当前引用的 id（编辑既有实体时 → 显示「转为纯文本」入口） */
  currentId?: string | null;
  onPick: (ref: { kind: string; id: string } | null) => void;
  onClose: () => void;
}

export function EntityPicker({
  kinds,
  candidates,
  initialQuery = '',
  initialKind,
  currentId = null,
  onPick,
  onClose,
}: EntityPickerProps) {
  const [kind, setKind] = useState(initialKind ?? kinds[0] ?? 'issue');
  const [query, setQuery] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 候选：当前 kind 内按查询串过滤（id/标题均参与）
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return candidates
      .filter((c) => c.kind === kind)
      .filter(
        (c) => q === '' || c.id.toLowerCase().includes(q) || c.title.toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [candidates, kind, query]);

  const canCreate = query.trim() !== '';

  return (
    <div
      data-entity-picker
      style={{
        position: 'absolute',
        right: 18,
        top: 76,
        width: 260,
        background: CHROME.panelBg,
        border: `1px solid ${CHROME.panelBorder}`,
        borderRadius: CHROME.radius,
        boxShadow: CHROME.shadow,
        backdropFilter: 'blur(14px) saturate(1.3)',
        color: CHROME.text,
        fontFamily: CHROME.fontFamily,
        padding: 8,
        zIndex: 5,
      }}
    >
      {/* kind 徽章行 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '0 2px 8px' }}>
        {kinds.map((k) => (
          <span
            key={k}
            data-kind={k}
            onClick={() => setKind(k)}
            style={{
              padding: '2px 6px',
              borderRadius: 5,
              cursor: 'pointer',
              fontSize: CHROME.fontSizeSmall,
              fontWeight: 600,
              color: k === kind ? CHROME.neon : CHROME.textMuted,
              background: k === kind ? CHROME.panelBorder : undefined,
            }}
          >
            @{k}
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <span
          data-picker-close
          onClick={onClose}
          style={{ color: CHROME.textMuted, cursor: 'pointer', fontSize: CHROME.fontSize }}
        >
          ×
        </span>
      </div>

      <input
        ref={inputRef}
        data-picker-input
        value={query}
        placeholder={`搜索或新建 ${kind}…`}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
            return;
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            // Enter：优先选中首个候选；无候选且有输入 → 新建
            if (list.length > 0) onPick({ kind, id: list[0]!.id });
            else if (canCreate) onPick({ kind, id: query.trim() });
          }
        }}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          background: 'transparent',
          border: `1px solid ${CHROME.panelBorderStrong}`,
          borderRadius: CHROME.radiusSmall,
          color: CHROME.text,
          fontFamily: CHROME.fontFamily,
          fontSize: CHROME.fontSizeSmall,
          padding: '4px 8px',
          outline: 'none',
        }}
      />

      <div style={{ marginTop: 6, maxHeight: 260, overflowY: 'auto' }}>
        {list.map((c) => (
          <div
            key={c.id}
            data-picker-item
            data-current={c.id === currentId || undefined}
            onClick={() => onPick({ kind: c.kind, id: c.id })}
            style={{
              padding: '4px 6px',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: CHROME.fontSizeSmall,
              color: c.id === currentId ? CHROME.neon : CHROME.text,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {c.title}
            <span style={{ color: CHROME.textMuted, marginLeft: 6 }}>{c.id}</span>
          </div>
        ))}
        {list.length === 0 && !canCreate && (
          <div style={{ color: CHROME.textMuted, fontSize: CHROME.fontSizeSmall, padding: '6px' }}>
            无匹配的 {kind}；输入内容可新建引用
          </div>
        )}
        {/* N4：转义提示（写纯文本 @ 内容的出口） */}
        {!canCreate && (
          <div
            style={{ color: CHROME.textMuted, fontSize: CHROME.fontSizeSmall, padding: '4px 6px' }}
          >
            在节点里输入 <span style={{ color: CHROME.neon }}>@@文本</span> 可写纯文本 @ 内容
          </div>
        )}
        {/* 新建项：输入即新 id（demo 无远端实体源时的主要路径） */}
        {canCreate && (
          <div
            data-picker-create
            onClick={() => onPick({ kind, id: query.trim() })}
            style={{
              padding: '4px 6px',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: CHROME.fontSizeSmall,
              color: CHROME.neon,
            }}
          >
            ＋ 新建 {kind}：{query.trim()}
          </div>
        )}
        {/* 清除引用：实体节点 → 纯文本 */}
        {currentId !== null && (
          <div
            data-picker-clear
            onClick={() => onPick(null)}
            style={{
              marginTop: 4,
              padding: '4px 6px',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: CHROME.fontSizeSmall,
              color: CHROME.warn,
              borderTop: `1px solid ${CHROME.panelBorder}`,
            }}
          >
            ✕ 清除引用（转为纯文本节点）
          </div>
        )}
      </div>
    </div>
  );
}
