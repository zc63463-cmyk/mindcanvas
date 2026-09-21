/**
 * 文件工作台的顶部展示块（FA2-T2 · 从 FileManager.tsx 拆出）。
 *
 * - `StorageBar`：存储位置条（工作区已连接 / 浏览器本地存储 + 切换与断开）
 * - `ViewTabs`：目录 / 最近 / 收藏 三视图切换
 *
 * 二者都是纯展示，不持有状态；拆出后主组件只保留数据与交互逻辑。
 */
import type React from 'react';
import { CHROME } from '@mindcanvas/react';
import { btnBase, formatRelative } from './fileManagerShared.js';

export type FileManagerTab = 'tree' | 'recent' | 'starred';

/** 存储位置条：平稳切换，消除未连接工作区的突兀警报 */
export function StorageBar({
  mounted,
  name,
  onPick,
  onDetach,
}: {
  mounted: boolean;
  name: string | null;
  onPick?: () => void;
  onDetach?: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        borderBottom: `1px solid ${CHROME.panelBorder}`,
        fontSize: CHROME.fontSizeSmall,
        background: 'rgba(255,255,255,0.02)',
      }}
    >
      {mounted ? (
        <span
          data-ws-mounted
          style={{
            color: CHROME.neon,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontWeight: 500,
          }}
        >
          🟢 工作区已连接 · 📁 {name}
        </span>
      ) : (
        <span
          style={{
            color: CHROME.text,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontWeight: 500,
          }}
        >
          💾 浏览器本地存储
        </span>
      )}
      <span style={{ flex: 1 }} />
      {onPick && (
        <button
          type="button"
          data-pick-workspace
          style={{
            ...btnBase,
            borderColor: mounted ? CHROME.panelBorder : CHROME.neon,
            color: mounted ? CHROME.text : CHROME.neon,
          }}
          onClick={onPick}
        >
          {mounted ? '切换本地目录…' : '打开本地文件夹…'}
        </button>
      )}
      {mounted && onDetach && (
        <button type="button" style={btnBase} onClick={onDetach}>
          断开
        </button>
      )}
    </div>
  );
}

const TAB_DEFS: ReadonlyArray<{ key: FileManagerTab; label: string }> = [
  { key: 'tree', label: '📂 全部目录' },
  { key: 'recent', label: '🕒 最近修改' },
  { key: 'starred', label: '⭐ 收藏星标' },
];

/** 视图分类筛选 Tab */
export function ViewTabs({
  tab,
  starredCount,
  onChange,
}: {
  tab: FileManagerTab;
  starredCount: number;
  onChange: (t: FileManagerTab) => void;
}) {
  return (
    <div
      data-fm-tabs
      style={{
        display: 'flex',
        gap: 6,
        padding: '4px 12px 0',
        borderBottom: `1px solid ${CHROME.panelBorder}`,
      }}
    >
      {TAB_DEFS.map((t) => {
        const active = tab === t.key;
        const label =
          t.key === 'starred' && starredCount > 0 ? `${t.label} (${starredCount})` : t.label;
        return (
          <button
            key={t.key}
            type="button"
            data-tab={t.key}
            onClick={() => onChange(t.key)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: active ? `2px solid ${CHROME.neon}` : '2px solid transparent',
              color: active ? CHROME.text : CHROME.textMuted,
              cursor: 'pointer',
              padding: '6px 10px',
              fontSize: CHROME.fontSizeSmall,
              fontFamily: CHROME.fontFamily,
              fontWeight: active ? 600 : 400,
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** 平铺文档行（「最近修改」/「收藏星标」视图共用） */
export function FlatDocRow({
  name,
  path,
  ts,
  starred,
  onToggleStar,
  onOpen,
}: {
  name: string;
  path: string;
  ts: number;
  starred: boolean;
  onToggleStar: (e: React.MouseEvent) => void;
  onOpen: () => void;
}) {
  return (
    <div
      data-flat-doc
      data-doc-name={name}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.03)',
        cursor: 'pointer',
      }}
      onClick={onOpen}
    >
      <button
        type="button"
        onClick={onToggleStar}
        style={{
          background: 'none',
          border: 'none',
          color: starred ? '#eab308' : CHROME.textMuted,
          cursor: 'pointer',
          padding: 0,
          fontSize: 14,
        }}
        title={starred ? '取消收藏' : '加为星标'}
      >
        {starred ? '★' : '☆'}
      </button>
      <span>📄</span>
      <span
        style={{
          flex: 1,
          color: CHROME.text,
          fontWeight: 500,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </span>
      {path && (
        <span
          style={{
            fontSize: 11,
            color: CHROME.textMuted,
            background: 'rgba(255,255,255,0.06)',
            padding: '2px 6px',
            borderRadius: 4,
          }}
        >
          📁 {path}
        </span>
      )}
      <span style={{ fontSize: CHROME.fontSizeSmall, color: CHROME.textMuted, flex: 'none' }}>
        {formatRelative(ts)}
      </span>
    </div>
  );
}
