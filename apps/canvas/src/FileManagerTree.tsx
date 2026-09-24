/**
 * FileManagerTree —— 文件工作台左侧树的行渲染（A-D3 自 FileManager.tsx 拆出，纯渲染搬迁）。
 *
 * 拆分动因：FileManager.tsx 逼近 bigFiles 红线（600 行），而递归行渲染与主组件状态
 * 只需「值 + 回调」接线。状态与回调全部经 ctx 透传（不含任何自有状态），
 * `data-dir-row` / `data-doc-row` / `data-doc-star` / `data-rename-input` 等 DOM 属性与拆分前一致。
 *
 * P1-A ④ 增量（a11y 与键盘语义，`file-management.md` §6）：
 *  - 树容器 `role="tree"`（在 FileManager 侧），行 `role="treeitem"` +
 *    `aria-level`/`aria-expanded`/`aria-selected`；
 *  - **roving tabindex**：只有焦点行 `tabIndex=0`，其余 `-1`（Tab 一次进树）；
 *  - 当前文档 `aria-current="true"`，判据是**完整路径/docKey**而非文件名（负控 2）；
 *  - 键位判定在 `fileTreeKeyboard.intentFor`（纯函数，可单测），本组件只接线意图；
 *  - **焦点在重命名输入框内时全部让位**：输入框自己的 `onKeyDown` 吞掉方向键
 *    （负控 1；不挂 window 级监听 —— R1-3 教训）。
 */
import type {
  Dispatch,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  SetStateAction,
} from 'react';
import { CHROME } from '@mindcanvas/react';
import type { DocEntry, WorkspaceFile } from '@mindcanvas/react';
import { canDropInto, findNode, OTHER_FILES_KEY, type TreeNode } from './fileTreeModel.js';
import type { TreeKeyIntent, VisibleRow } from './fileTreeKeyboard.js';
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
  /** P1-A ①：当前文档的**完整路径**（高亮与 aria-current 的唯一判据） */
  currentPath: string | null;
  /** P1-A ④：持有 roving tabindex 的行 key */
  focusedKey: string | null;
  setFocusedKey: (key: string) => void;
  /** 焦点迁移后把 DOM 焦点也带过去（roving tabindex 的另一半） */
  focusRow: (key: string) => void;
  /** P1-A ④：纯函数键位判定（注入以便 `FileManagerTree` 不反向依赖模型） */
  keyIntent: (key: string, rows: readonly VisibleRow[]) => TreeKeyIntent;
  /** P1-A ④：当前可见行序列（每次渲染现算，避免闭包冻住展开态） */
  visibleRows: () => VisibleRow[];
  /** P1-A ④：把行 DOM 注册进 ref 表（roving tabindex 的「真的聚焦」那一半） */
  registerRow: (key: string, el: HTMLElement | null) => void;
  setExpanded: (key: string, open: boolean) => void;
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
  /** P1-A ⑤：不支持的文件被点击 → 提示（不打开、不静默） */
  onUnopenable: (node: TreeNode) => void;
  /** P1-A ④ `Delete` 键：删除该节点（复用既有确认条/当前文档 F2 分流） */
  onDeleteKey: (node: TreeNode) => void;
}

/** 目录行的 key（「其他文件」是虚拟分组，用保留 key） */
function isOtherFilesGroup(node: TreeNode): boolean {
  return node.key === OTHER_FILES_KEY;
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
    const focused = ctx.focusedKey === n.key;
    // roving tabindex：只有焦点行可 Tab 到；焦点行始终存在（见 FileManager 的收敛逻辑）
    const tabIndex = focused ? 0 : -1;
    const unopenable = n.unopenable === true;

    if (n.type === 'dir') {
      const isDrop = ctx.dropTarget === n.key;
      const group = isOtherFilesGroup(n);
      return (
        <div key={n.key} role="none">
          <div
            data-dir-row
            data-dir-path={n.fullPath}
            data-other-files-group={group || undefined}
            data-drop-active={isDrop || undefined}
            role="treeitem"
            aria-level={depth + 1}
            aria-expanded={open}
            aria-selected={focused}
            tabIndex={tabIndex}
            ref={(el) => ctx.registerRow(n.key, el)}
            onFocus={() => ctx.setFocusedKey(n.key)}
            onKeyDown={(e) => onRowKeyDown(e, n, ctx)}
            onDragOver={(e) => {
              if (group || !ctx.dragKey || !canDropInto(ctx.dragKey, n.fullPath, ctx.tree)) return;
              e.preventDefault();
              ctx.setDropTarget(n.key);
            }}
            onDragLeave={() => ctx.setDropTarget((p) => (p === n.key ? null : p))}
            onDrop={(e) => {
              e.preventDefault();
              if (group) return; // 虚拟分组不是真实落点
              const key = ctx.dragKey;
              ctx.setDragKey(null);
              if (!key) return;
              const dragged = findNode(ctx.tree, key);
              if (dragged) void ctx.dropInto(dragged, n);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              // 虚拟分组没有可操作目标（新建/改名/删除都对它无意义）
              if (group) return;
              ctx.setMenu({ key: n.key, x: e.clientX, y: e.clientY });
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: `5px 8px 5px ${pad}px`,
              borderRadius: 6,
              background: isDrop ? CHROME.neonSoft : undefined,
              ...(isDrop
                ? { outline: `1px dashed ${CHROME.neon}` }
                : focused
                  ? { outline: `1px solid ${CHROME.panelBorderStrong}` }
                  : {}),
            }}
          >
            <button
              type="button"
              onClick={() => ctx.toggle(n.key)}
              tabIndex={-1}
              style={{ ...rowBtn, flex: 1 }}
              title={group ? undefined : n.fullPath}
            >
              <span style={{ color: CHROME.textMuted }}>{open ? '▾' : '▸'}</span>
              <span>{isDrop ? '📂' : group ? '📄' : '📁'}</span>
              <span style={group ? { color: CHROME.textMuted } : undefined}>{n.name}</span>
            </button>
          </div>
          {open && <FileManagerTree nodes={n.children} depth={depth + 1} ctx={ctx} />}
        </div>
      );
    }

    const renaming = ctx.renamingKey === n.key;
    // P1-A ①：高亮判据 = **完整路径**，不按文件名（负控 2：同名不同目录不得同时高亮）
    const isCurrent = !unopenable && ctx.currentPath !== null && ctx.currentPath === n.fullPath;
    return (
      <div
        key={n.key}
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={focused}
        aria-current={isCurrent ? 'true' : undefined}
        tabIndex={tabIndex}
        data-doc-row
        data-doc-name={n.name}
        // 完整相对路径：同名不同目录的判别要靠它
        // （只按 `data-doc-name` 取行会在 F5 场景里命中两份，无法区分）
        data-doc-path={n.fullPath}
        data-doc-current={isCurrent || undefined}
        data-doc-unopenable={unopenable || undefined}
        ref={(el) => ctx.registerRow(n.key, el)}
        onFocus={() => ctx.setFocusedKey(n.key)}
        onKeyDown={(e) => onRowKeyDown(e, n, ctx)}
        draggable={!renaming && !unopenable}
        onDragStart={() => {
          if (unopenable) return; // 不可打开的文件也不参与归位拖拽
          ctx.setDragKey(n.key);
        }}
        onDragEnd={() => {
          ctx.setDragKey(null);
          ctx.setDropTarget(null);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (unopenable) return; // §2.3：这些文件本应用不处理，不给操作入口
          ctx.setMenu({ key: n.key, x: e.clientX, y: e.clientY });
        }}
        style={{
          paddingLeft: pad + 14,
          ...(isCurrent
            ? { background: CHROME.neonSoft, boxShadow: `inset 2px 0 0 ${CHROME.neon}` }
            : {}),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px' }}>
          {renaming ? (
            <input
              autoFocus
              data-rename-input
              defaultValue={n.name}
              onBlur={(ev) => void ctx.commitRename(n, ev.target.value)}
              /*
               * 负控 1：焦点在重命名输入框内 → 全部键位让位给输入。
               * 拦截点**必须**在这里（输入框自身的按键层），不得挂 window 监听
               * （R1-3 教训：window 闭包会读到陈旧状态）。
               */
              onKeyDown={(ev) => {
                if (ev.key === 'Enter') {
                  ev.currentTarget.blur();
                  return;
                }
                if (ev.key === 'Escape') {
                  ev.stopPropagation();
                  ctx.setRenamingKey(null);
                  return;
                }
                // 方向键 / Home / End / Delete / F2 一律留在输入框里（光标移动 / 删字符）
                if (
                  ev.key.startsWith('Arrow') ||
                  ev.key === 'Home' ||
                  ev.key === 'End' ||
                  ev.key === 'Delete' ||
                  ev.key === 'F2'
                ) {
                  ev.stopPropagation();
                }
              }}
              style={inputStyle()}
            />
          ) : (
            <>
              <button
                type="button"
                data-doc-star
                tabIndex={-1}
                disabled={unopenable}
                onClick={(e) => ctx.toggleStar(n.fullPath || n.key, e)}
                style={{
                  background: 'none',
                  border: 'none',
                  color:
                    ctx.starredKeys.has(n.fullPath) || ctx.starredKeys.has(n.key)
                      ? '#eab308'
                      : CHROME.textMuted,
                  cursor: unopenable ? 'default' : 'pointer',
                  padding: '0 2px',
                  fontSize: 13,
                  opacity: unopenable ? 0.35 : 1,
                }}
                title={
                  unopenable
                    ? undefined
                    : ctx.starredKeys.has(n.fullPath) || ctx.starredKeys.has(n.key)
                      ? '取消收藏'
                      : '加为星标'
                }
              >
                {ctx.starredKeys.has(n.fullPath) || ctx.starredKeys.has(n.key) ? '★' : '☆'}
              </button>
              <button
                type="button"
                tabIndex={-1}
                data-doc-open
                // P1-A ⑤：灰显不可打开；点击给提示（不静默、也不尝试打开）
                onClick={() => {
                  if (unopenable) {
                    ctx.onUnopenable(n);
                    return;
                  }
                  if (n.wsFile) ctx.onOpenFile(n.wsFile);
                  else if (n.entry) ctx.onOpenEntry(n.entry);
                }}
                title={
                  unopenable
                    ? '非导图文件，本应用不打开'
                    : n.stale
                      ? '源码快照已过期，打开时需重新选文件'
                      : n.fullPath
                }
                style={{
                  ...rowBtn,
                  flex: 1,
                  cursor: unopenable ? 'not-allowed' : 'pointer',
                  opacity: unopenable ? 0.45 : 1,
                }}
              >
                <span>📄</span>
                <span>{n.name}</span>
                {n.stale && <span style={{ color: CHROME.textMuted }}> ↻</span>}
              </button>
              {isCurrent && (
                <span
                  data-doc-current-badge
                  style={{
                    fontSize: CHROME.fontSizeSmall,
                    color: CHROME.neon,
                    whiteSpace: 'nowrap',
                  }}
                >
                  ◀ 当前
                </span>
              )}
              {!unopenable && (
                <span style={{ fontSize: CHROME.fontSizeSmall, color: CHROME.textMuted }}>
                  {formatRelative(n.ts)}
                </span>
              )}
            </>
          )}
        </div>
      </div>
    );
  });
}

/**
 * 行级键位处理（④）。
 *
 * 这里**不做**键位判定 —— 那是 `fileTreeKeyboard.intentFor` 的职责（纯函数，可单测）。
 * 本函数只把意图翻译成 ctx 上的调用。输入框已 `stopPropagation`，键到不了这里；
 * 万一某条路径漏了，让位规则的唯一真值仍在输入框层（不复制第二份判定）。
 */
function onRowKeyDown(e: ReactKeyboardEvent, node: TreeNode, ctx: FileManagerTreeCtx): void {
  const handled = [
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'Home',
    'End',
    'Enter',
    'F2',
    'Delete',
  ];
  if (!handled.includes(e.key)) return;
  e.preventDefault();
  const intent = ctx.keyIntent(e.key, ctx.visibleRows());
  switch (intent.kind) {
    case 'focus':
      ctx.setFocusedKey(intent.key);
      ctx.focusRow(intent.key);
      return;
    case 'expand':
      ctx.setExpanded(intent.key, true);
      return;
    case 'collapse':
      ctx.setExpanded(intent.key, false);
      return;
    case 'open':
      if (node.unopenable === true) ctx.onUnopenable(node);
      else if (node.wsFile) ctx.onOpenFile(node.wsFile);
      else if (node.entry) ctx.onOpenEntry(node.entry);
      return;
    case 'rename':
      if (node.unopenable !== true) ctx.setRenamingKey(node.key);
      return;
    case 'delete':
      if (node.unopenable !== true) ctx.onDeleteKey(node);
      return;
    default:
      return;
  }
}
