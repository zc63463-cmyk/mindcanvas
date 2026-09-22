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
  candidates,
  onLink,
  onIgnore,
}: {
  entries: readonly HistoryPoolEntry[];
  open: boolean;
  onToggle: () => void;
  /**
   * 可关联的候选文档（`docKey` + 显示名）。
   *
   * 为什么由用户**显式选**而不是按名字猜：`relinkEvidence` 是「用户确认这条旧记录
   * 属于这个工作区」的凭证，一旦写入就无法区分对错。按名字回退匹配会把某条旧记录
   * 绑到**另一条**索引条目上（多个同名文档时尤其容易），
   * 等于给唯一的证据位灌进噪声。故只给「名字完全相同」的候选排序靠前，
   * 由用户点选确定到底是哪一条。
   */
  candidates: readonly { docKey: string; name: string; exact: boolean }[];
  onLink: (entry: HistoryPoolEntry, docKey: string) => void;
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
              <select
                data-fm-history-target
                defaultValue=""
                style={{ ...btnBase, maxWidth: 180 }}
                onChange={(e) => {
                  const picked = e.currentTarget.value;
                  if (picked !== '') onLink(h, picked);
                }}
              >
                <option value="">关联到此工作区…</option>
                {[...candidates]
                  // 路径与旧键完全一致的一条排最前（提示「最可能就是它」），
                  // 但**仍由用户点选**——排序是提示，不是判定。
                  .sort((a, b) => Number(b.name === h.key) - Number(a.name === h.key))
                  .map((c) => (
                    <option key={c.docKey} value={c.docKey}>
                      {(c.name === h.key ? '同名 · ' : '') + c.name}
                    </option>
                  ))}
              </select>
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

/**
 * 降级投影失败可见（§6.3：「投影写入失败 → 该次变更**不可回退**」）。
 *
 * 用户语言里没有「投影」这个概念，所以文案只说后果：旧版本读不到这次的改动。
 * 这不是可选的点缀——没有它，`projectionStatus()` 就没有生产读取方，
 * §6.3 的「必须在回执与验证中可查」在生产链路上不成立。
 */
export function ProjectionFailureNotice({ failed }: { failed: boolean }): React.ReactElement | null {
  if (!failed) return null;
  return (
    <div
      data-fm-projection-failed
      style={{
        margin: '0 12px 8px',
        padding: '6px 8px',
        borderRadius: 6,
        border: `1px solid ${CHROME.warn}`,
        color: CHROME.warn,
        fontSize: CHROME.fontSizeSmall,
      }}
    >
      这次的收藏/最近改动没能同步给旧版本（存储写入失败）；改动本身已保存，稍后可再试。
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
