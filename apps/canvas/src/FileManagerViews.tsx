/**
 * 文件工作台的**列表视图与研究池**（P0-D · 从 FileManager.tsx 拆出）。
 *
 * 拆分动因：FileManager.tsx 逼近代码预算的 `bigFiles` 红线（600 行），
 * 而这三块（「最近打开」平铺列表 / 「收藏星标」平铺列表 / 旧记录历史池）
 * 都只依赖「值 + 回调」，不持有主组件状态。
 *
 * 语义要点（P0-D）：
 * - 「最近打开」的 `when` 由调用方按 `openedAt` 格式化：`null` → 「未记录打开时间」，
 *   **不回落 mtime**（UD-2）；
 * - 历史池用**用户语言**（「N 条旧记录未关联工作区」），不暴露索引/作用域等内部概念；
 *   用户「忽略」只影响呈现，旧键与 `legacyKeys` 都保留（不处理也不丢）。
 */
import { CHROME } from '@mindcanvas/react';
import { FlatDocRow } from './FileManagerChrome.js';
import type { HistoryPoolEntry } from './docIndex.js';
import type { TreeNode } from './fileTreeModel.js';
import { btnBase, rowBtn } from './fileManagerShared.js';
import { formatHistoryPool, formatRecentWhen } from './docIndex.js';

/** 平铺列表的一行（已解析好的节点 + 显示文案 + 收藏键） */
export interface FlatRow {
  key: string;
  node: TreeNode;
  when: string;
  starred: boolean;
  starKey: string;
}

/** 空态文案（与树视图同一套措辞，只换主语） */
function Empty({ text }: { text: string }): React.ReactElement {
  return (
    <div style={{ padding: '28px 12px', textAlign: 'center', color: CHROME.textMuted }}>{text}</div>
  );
}

/** 「最近打开」/「收藏星标」共用的平铺列表 */
export function FlatDocList({
  rows,
  emptyText,
  onToggleStar,
  onOpen,
}: {
  rows: readonly FlatRow[];
  emptyText: string;
  onToggleStar: (key: string, e: { stopPropagation: () => void }) => void;
  onOpen: (node: TreeNode) => void;
}): React.ReactElement {
  if (rows.length === 0) return <Empty text={emptyText} />;
  return (
    <>
      {rows.map(({ key, node, when, starred, starKey }) => (
        <FlatDocRow
          key={key}
          name={node.name}
          path={node.path}
          when={when}
          starred={starred}
          onToggleStar={(e) => onToggleStar(starKey, e)}
          onOpen={() => onOpen(node)}
        />
      ))}
    </>
  );
}

/**
 * 历史池（§6.2.1）：默认折叠；展开后可逐条「关联到此工作区」或「忽略」。
 * `onLink` 未提供时不渲染关联按钮（无法判定目标时宁可不给动作）。
 */
export function HistoryPool({
  entries,
  open,
  onToggle,
  onLink,
  onIgnore,
}: {
  entries: readonly HistoryPoolEntry[];
  open: boolean;
  onToggle: () => void;
  onLink: (entry: HistoryPoolEntry) => void;
  onIgnore: (entry: HistoryPoolEntry) => void;
}): React.ReactElement | null {
  if (entries.length === 0) return null;
  return (
    <div
      data-fm-history
      style={{
        borderTop: `1px solid ${CHROME.panelBorder}`,
        padding: '6px 12px',
        fontSize: CHROME.fontSizeSmall,
        color: CHROME.textMuted,
      }}
    >
      <button
        type="button"
        data-fm-history-toggle
        style={{ ...rowBtn, color: CHROME.textMuted }}
        onClick={onToggle}
      >
        <span>{open ? '▾' : '▸'}</span>
        <span>{formatHistoryPool(entries.length)}</span>
      </button>
      {open && (
        <div data-fm-history-list style={{ paddingLeft: 14 }}>
          {entries.map((h) => (
            <div
              key={`${h.kind}:${h.key}`}
              data-fm-history-row
              data-history-key={h.key}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}
            >
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.name}</span>
              <span style={{ flex: 'none' }}>{formatRecentWhen(h.openedAt)}</span>
              <button
                type="button"
                data-fm-history-link
                style={btnBase}
                onClick={() => onLink(h)}
              >
                关联到此工作区
              </button>
              <button
                type="button"
                data-fm-history-ignore
                style={btnBase}
                onClick={() => onIgnore(h)}
              >
                忽略
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 迁移失败可见（不把「未迁移」伪报成完成） */
export function MigrateFailedNotice({ count }: { count: number }): React.ReactElement | null {
  if (count <= 0) return null;
  return (
    <div
      data-fm-migrate-failed
      style={{
        margin: '0 12px 8px',
        padding: '6px 8px',
        borderRadius: 6,
        border: `1px solid ${CHROME.warn}`,
        color: CHROME.warn,
        fontSize: CHROME.fontSizeSmall,
      }}
    >
      {count} 条旧记录本次未迁移（已保留在原位置，下次打开会再试）。
    </div>
  );
}
