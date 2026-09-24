/**
 * 文件工作台的**树工具条与树侧提示**（P1-A ③⑤ —— 从 `FileManager.tsx` 拆出）。
 *
 * 拆分动因：`FileManager.tsx` 逼近 `bigFiles` 红线（600 行），而这块只依赖
 * 「值 + 回调」（排序依据、其他文件开关、提示文案），与树的载入和当前文档编排无关。
 *
 * 语义要点：
 * - 工具条**只在「全部目录」视图渲染**（§3.3：排序依据仅作用于全部目录，
 *   「最近」固定 `openedAt`；UDE-2 已确认，不可动摇）；
 * - 列头**写明当前依据**（§6 原文要求），故 `sortLabel` 是必填 prop 而非可选装饰；
 * - 提示条用 `role="status"`（§6 无障碍要求：状态条用 status）。
 */
import type React from 'react';
import { CHROME } from '@mindcanvas/react';
import { btnBase, inlineBarStyle } from './fileManagerShared.js';
import { breadcrumbOf, type SortMode } from './fileTreeModel.js';

export interface TreeToolbarProps {
  sortMode: SortMode;
  onSortMode: (mode: SortMode) => void;
  /** 当前依据的显示名（列头写明依据，§6） */
  sortLabel: string;
  /** 「显示其他文件」开关（仅工作区模式可用） */
  showOtherFiles: boolean;
  onShowOtherFiles: (on: boolean) => void;
  /** 被过滤掉的文件数（0 → 不显示计数） */
  otherFileCount: number;
  /** 兼容模式没有「被过滤掉的文件」概念 → 不渲染该开关 */
  showToggle: boolean;
}

export function TreeToolbar({
  sortMode,
  onSortMode,
  sortLabel,
  showOtherFiles,
  onShowOtherFiles,
  otherFileCount,
  showToggle,
}: TreeToolbarProps): React.ReactElement {
  return (
    <div
      data-fm-tree-tools
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 12px 8px',
        fontSize: CHROME.fontSizeSmall,
        color: CHROME.textMuted,
      }}
    >
      {/* ⑤ 列头**写明依据**：标签本身就是当前排序依据，调完立刻可核对 */}
      <label data-fm-sort style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span>排序：</span>
        <select
          data-fm-sort-select
          aria-label="排序依据"
          value={sortMode}
          onChange={(e) => onSortMode(e.currentTarget.value === 'mtime' ? 'mtime' : 'name')}
          style={{ ...btnBase, padding: '2px 6px' }}
        >
          <option value="name">名称（目录在前）</option>
          <option value="mtime">最近修改</option>
        </select>
      </label>
      <span data-fm-sort-active style={{ opacity: 0.75 }}>
        当前依据：{sortLabel}
      </span>
      <span style={{ flex: 1 }} />
      {showToggle && (
        <label
          data-fm-show-other
          style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
        >
          <input
            data-fm-show-other-input
            type="checkbox"
            checked={showOtherFiles}
            onChange={(e) => onShowOtherFiles(e.currentTarget.checked)}
          />
          <span>显示其他文件</span>
          {otherFileCount > 0 && <span>（{otherFileCount}）</span>}
        </label>
      )}
    </div>
  );
}

/**
 * 树侧内联提示（`role="status"`）。
 *
 * 与当前文档操作的提示（`currentDocOps.ui.notice`）**共用同一个位置**但判据独立：
 * 树侧的提示（不可打开文件的点击说明、归档拒绝/完成）不随当前文档操作的结果清除。
 * 两者同时存在时树侧优先（它是用户刚刚触发的那一下）。
 */
export function TreeNoticeBar({
  notice,
  onDismiss,
}: {
  notice: string;
  onDismiss: () => void;
}): React.ReactElement {
  return (
    <div
      data-fm-tree-notice
      role="status"
      aria-live="polite"
      style={{
        ...inlineBarStyle,
        border: `1px solid ${CHROME.panelBorderStrong}`,
        color: CHROME.text,
      }}
    >
      <span style={{ flex: 1 }}>{notice}</span>
      <button type="button" data-fm-tree-notice-close style={btnBase} onClick={onDismiss}>
        知道了
      </button>
    </div>
  );
}

/**
 * 面包屑 + 当前文档状态行（P1-A ①）。
 *
 * P1-A 增量：状态行加 `role="status"` + `aria-live="polite"`（§6 无障碍要求：
 * 「状态条用 `role="status"` 用于保存中/失败提示」）—— 读屏用户在保存态变化时
 * 无需手动去翻也能听到。
 *
 * 判据未变：`dirty` prop 沿用既有来源（同一条同时用于当前行标识与头部状态，
 * §5.1 的说明）。
 */
export function BreadcrumbBar({
  workspaceName,
  currentPath,
  dirty,
}: {
  /** 已连接工作区名（null = 兼容模式，不显示 📁 段） */
  workspaceName: string | null;
  currentPath: string | null;
  dirty: boolean;
}): React.ReactElement {
  return (
    <div
      data-fm-breadcrumb
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 12px 8px',
        fontSize: CHROME.fontSizeSmall,
        color: CHROME.textMuted,
        flexWrap: 'wrap',
      }}
    >
      {workspaceName !== null && <span>📁 {workspaceName}</span>}
      {breadcrumbOf(currentPath).map((seg, i, segs) => (
        // key 用「累积路径前缀」而非数组下标：同名段（a/a.mm.md 的两段 'a'）下标会撞，
        // 前缀全路径天然唯一，也免去 noArrayIndexKey 告警
        <span key={segs.slice(0, i + 1).join('/')}>
          <span style={{ opacity: 0.6 }}> › </span>
          <span style={{ color: CHROME.text }}>{seg}</span>
        </span>
      ))}
      <span style={{ flex: 1 }} />
      <span
        data-doc-status
        role="status"
        aria-live="polite"
        style={{ color: dirty ? CHROME.warn : CHROME.neon }}
      >
        {dirty ? '📝 未保存' : currentPath ? '🟢 本地磁盘已同步' : ''}
      </span>
    </div>
  );
}
