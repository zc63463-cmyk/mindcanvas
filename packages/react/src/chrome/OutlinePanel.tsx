/**
 * OutlinePanel —— Ctrl+D 大纲面板（批次 3）。
 * 左中玻璃浮层：递归渲染树；▸/▾ 折叠展开（onToggle）；点击条目 → onSelect(id)；
 * selectedId 高亮（画布选择 → 大纲同步）。视觉值全部来自 CHROME。
 */
import type { EditableNode } from '@mindcanvas/kernel';
import { CHROME } from '../theme/tokens.js';
import { nodeTitle } from '../search/search.js';

export interface OutlinePanelProps {
  root: EditableNode;
  collapsed: ReadonlySet<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}

function Row({
  node,
  depth,
  collapsed,
  selectedId,
  onSelect,
  onToggle,
}: {
  node: EditableNode;
  depth: number;
  collapsed: ReadonlySet<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(node.id);
  const isActive = node.id === selectedId;

  return (
    <div>
      <div
        data-outline-item
        data-active={isActive}
        onClick={() => onSelect(node.id)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '3px 6px',
          paddingLeft: 6 + depth * 14,
          borderRadius: 6,
          cursor: 'pointer',
          background: isActive ? CHROME.neonSoft : 'transparent',
          color: isActive ? CHROME.neon : CHROME.text,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        {hasChildren ? (
          <span
            data-outline-toggle
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.id);
            }}
            style={{
              width: 12,
              flex: 'none',
              textAlign: 'center',
              color: CHROME.textMuted,
              cursor: 'pointer',
              fontSize: CHROME.fontSizeSmall,
            }}
          >
            {isCollapsed ? '▸' : '▾'}
          </span>
        ) : (
          <span style={{ width: 12, flex: 'none' }} />
        )}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', fontSize: CHROME.fontSize }}>
          {nodeTitle(node) || '（无文本）'}
        </span>
      </div>
      {hasChildren && !isCollapsed && (
        <div>
          {node.children.map((c) => (
            <Row
              key={c.id}
              node={c}
              depth={depth + 1}
              collapsed={collapsed}
              selectedId={selectedId}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function OutlinePanel({
  root,
  collapsed,
  selectedId,
  onSelect,
  onToggle,
}: OutlinePanelProps) {
  return (
    <div
      data-outline-panel
      style={{
        position: 'absolute',
        left: 18,
        top: 76,
        width: 230,
        maxHeight: '60vh',
        overflowY: 'auto',
        background: CHROME.panelBg,
        border: `1px solid ${CHROME.panelBorder}`,
        borderRadius: CHROME.radius,
        boxShadow: CHROME.shadow,
        backdropFilter: 'blur(14px) saturate(1.3)',
        color: CHROME.text,
        fontFamily: CHROME.fontFamily,
        padding: 8,
        zIndex: 4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 6px 8px' }}>
        <span style={{ color: CHROME.neon, fontWeight: 600, fontSize: CHROME.fontSize }}>大纲</span>
        <span style={{ flex: 1 }} />
        <span style={{ color: CHROME.textMuted, fontSize: CHROME.fontSizeSmall }}>
          点击定位节点
        </span>
      </div>
      <Row
        node={root}
        depth={0}
        collapsed={collapsed}
        selectedId={selectedId}
        onSelect={onSelect}
        onToggle={onToggle}
      />
    </div>
  );
}
