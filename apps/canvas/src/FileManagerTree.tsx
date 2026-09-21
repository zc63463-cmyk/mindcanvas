/**
 * FileManagerTree —— 文件工作台左侧树的行渲染（A-D3 自 FileManager.tsx 拆出，纯渲染搬迁）。
 *
 * 拆分动因：FileManager.tsx 逼近 bigFiles 红线（600 行），而递归行渲染与主组件状态
 * 只需「值 + 回调」接线。状态与回调全部经 ctx 透传（不含任何自有状态），
 * `data-dir-row` / `data-doc-row` / `data-doc-star` / `data-rename-input` 等 DOM 属性与拆分前一致。
 */
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { CHROME } from '@mindcanvas/react';
import type { DocEntry, WorkspaceFile } from '@mindcanvas/react';
import { canDropInto, findNode, type TreeNode } from './fileTreeModel.js';
import { formatRelative, inputStyle, rowBtn, type MenuState } from './fileManagerShared.js';

/** 行渲染上下文：与 FileManager 内部状态的接线面（值 + 原样透传的回调） */
export interface FileManagerTreeCtx {
  tree: readonly TreeNode[];
  expanded: ReadonlySet<string>;
  query: string;
  dropTarget: string | null;
  dragKey: string | null;
  renamingKey: string | null;
  starredKeys: ReadonlySet<string>;
  toggle: (key: string) => void;
  setDropTarget: Dispatch<SetStateAction<string | null>>;
  setDragKey: Dispatch<SetStateAction<string | null>>;
  setMenu: (menu: MenuState) => void;
  dropInto: (node: TreeNode, target: TreeNode) => void;
  commitRename: (node: TreeNode, nextName: string) => void;
  setRenamingKey: (key: string | null) => void;
  toggleStar: (key: string, e: { stopPropagation: () => void }) => void;
  onOpenFile: (file: WorkspaceFile) => void;
  onOpenEntry: (entry: DocEntry) => void;
}

export function FileManagerTree({
  nodes,
  depth,
  ctx,
}: {
  nodes: readonly TreeNode[];
  depth: number;
  ctx: FileManagerTreeCtx;
}): ReactNode {
  return nodes.map((n) => {
    const pad = 8 + depth * 14;
    const open = ctx.expanded.has(n.key) || ctx.query.trim() !== '';
    if (n.type === 'dir') {
      const isDrop = ctx.dropTarget === n.key;
      return (
        <div key={n.key}>
          <div
            data-dir-row
            data-dir-path={n.fullPath}
            data-drop-active={isDrop || undefined}
            onDragOver={(e) => {
              if (!ctx.dragKey || !canDropInto(ctx.dragKey, n.fullPath, ctx.tree)) return;
              e.preventDefault();
              ctx.setDropTarget(n.key);
            }}
            onDragLeave={() => ctx.setDropTarget((p) => (p === n.key ? null : p))}
            onDrop={(e) => {
              e.preventDefault();
              const key = ctx.dragKey;
              ctx.setDragKey(null);
              if (!key) return;
              const dragged = findNode(ctx.tree, key);
              if (dragged) void ctx.dropInto(dragged, n);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              ctx.setMenu({ key: n.key, x: e.clientX, y: e.clientY });
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: `5px 8px 5px ${pad}px`,
              borderRadius: 6,
              background: isDrop ? CHROME.neonSoft : undefined,
              outline: isDrop ? `1px dashed ${CHROME.neon}` : undefined,
            }}
          >
            <button
              type="button"
              onClick={() => ctx.toggle(n.key)}
              style={{ ...rowBtn, flex: 1 }}
              title={n.fullPath}
            >
              <span style={{ color: CHROME.textMuted }}>{open ? '▾' : '▸'}</span>
              <span>{isDrop ? '📂' : '📁'}</span>
              <span>{n.name}</span>
            </button>
          </div>
          {open && <FileManagerTree nodes={n.children} depth={depth + 1} ctx={ctx} />}
        </div>
      );
    }

    const renaming = ctx.renamingKey === n.key;
    return (
      <div
        key={n.key}
        data-doc-row
        data-doc-name={n.name}
        draggable={!renaming}
        onDragStart={() => ctx.setDragKey(n.key)}
        onDragEnd={() => {
          ctx.setDragKey(null);
          ctx.setDropTarget(null);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          ctx.setMenu({ key: n.key, x: e.clientX, y: e.clientY });
        }}
        style={{ paddingLeft: pad + 14 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px' }}>
          {renaming ? (
            <input
              autoFocus
              data-rename-input
              defaultValue={n.name}
              onBlur={(ev) => void ctx.commitRename(n, ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter') ev.currentTarget.blur();
                if (ev.key === 'Escape') ctx.setRenamingKey(null);
              }}
              style={inputStyle()}
            />
          ) : (
            <>
              <button
                type="button"
                data-doc-star
                onClick={(e) => ctx.toggleStar(n.fullPath || n.key, e)}
                style={{
                  background: 'none',
                  border: 'none',
                  color:
                    ctx.starredKeys.has(n.fullPath) || ctx.starredKeys.has(n.key)
                      ? '#eab308'
                      : CHROME.textMuted,
                  cursor: 'pointer',
                  padding: '0 2px',
                  fontSize: 13,
                }}
                title={
                  ctx.starredKeys.has(n.fullPath) || ctx.starredKeys.has(n.key)
                    ? '取消收藏'
                    : '加为星标'
                }
              >
                {ctx.starredKeys.has(n.fullPath) || ctx.starredKeys.has(n.key) ? '★' : '☆'}
              </button>
              <button
                type="button"
                onClick={() =>
                  n.wsFile
                    ? ctx.onOpenFile(n.wsFile)
                    : n.entry
                      ? ctx.onOpenEntry(n.entry)
                      : undefined
                }
                title={n.stale ? '源码快照已过期，打开时需重新选文件' : n.fullPath}
                style={{ ...rowBtn, flex: 1 }}
              >
                <span>📄</span>
                <span>{n.name}</span>
                {n.stale && <span style={{ color: CHROME.textMuted }}> ↻</span>}
              </button>
              <span style={{ fontSize: CHROME.fontSizeSmall, color: CHROME.textMuted }}>
                {formatRelative(n.ts)}
              </span>
            </>
          )}
        </div>
      </div>
    );
  });
}
