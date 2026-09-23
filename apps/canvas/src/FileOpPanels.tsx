/**
 * 文件操作的**反馈面板**（P0-A ⑥ · file-management §5.2/§5.3、acceptance F3/L3/L4）。
 *
 * 交付三块内联 UI（全部走内联 —— `no-native-dialogs.test.ts` 禁止 window.confirm/prompt）：
 *  ① 冲突三选：目标已存在 → 「保留两份 / 替换目标文件 / 取消」（§5.2②）；
 *  ② 部分成功三选：目标已建、源删除失败 → 「重试删除原文件 / 保留两份 / 撤销新副本」（§5.3）；
 *  ③ 失败/拒绝提示条：错误码 → 文案的唯一映射（原则 1：随本操作交付，不外挂 P0-C）。
 *
 * 判别要点（F3 负控锚定）：
 *  - `partial` **不得**按 `failed` 呈现：必须出现「两份」说明与三个动作；
 *  - 「重试删除原文件」**只删源、不重建目标**（重建会覆盖新副本内容）；
 *  - 「撤销新副本」**有条件**：副本已被编辑/写入过 → 拒绝直接删除（L3）；
 *  - 删源前必须复查外部修改（L4）：`{size,lastModified}` 不一致 → 不删。
 *
 * 不是什么：不做 I/O、不持有跨渲染状态（面板由父组件按结果驱动）。
 */
import type React from 'react';
import { CHROME } from '@mindcanvas/react';
import { btnBase, inlineBarStyle } from './fileManagerShared.js';

/** 冲突三选（§5.2②）。默认焦点「保留两份」——不静默替换是默认安全侧。 */
export type RenameConflictChoice = 'keep-both' | 'replace' | 'cancel';

export interface RenameConflictPanelProps {
  /** 目标目录里已有的那个名字 */
  name: string;
  /** 「保留两份」的最终名字（调用方用 `uniqueCopyName` 算好） */
  keepBothName: string;
  onChoose: (choice: RenameConflictChoice) => void;
}

export function RenameConflictPanel({
  name,
  keepBothName,
  onChoose,
}: RenameConflictPanelProps): React.ReactElement {
  return (
    <div
      data-fm-conflict
      style={{
        ...inlineBarStyle,
        border: `1px solid ${CHROME.warn}`,
        background: 'rgba(226,75,74,0.08)',
        display: 'block',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        目标文件夹里已有「{name}」
      </div>
      <div style={{ color: CHROME.textMuted, marginBottom: 6 }}>
        两者的文件名相同，内容可能不同。
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          data-fm-conflict-keep
          autoFocus
          style={{ ...btnBase, borderColor: CHROME.neon, color: CHROME.neon }}
          onClick={() => onChoose('keep-both')}
        >
          保留两份（改为 {keepBothName}）
        </button>
        <button
          type="button"
          data-fm-conflict-replace
          style={{ ...btnBase, borderColor: CHROME.warn, color: CHROME.warn }}
          onClick={() => onChoose('replace')}
        >
          替换目标文件
        </button>
        <button type="button" data-fm-conflict-cancel style={btnBase} onClick={() => onChoose('cancel')}>
          取消
        </button>
      </div>
      <div style={{ color: CHROME.warn, marginTop: 6 }}>
        ⚠ 替换会覆盖目标文件的全部内容，不可撤销。
      </div>
    </div>
  );
}

/** 部分成功的动作（§5.3 线框：三个动作 + 稍后处理；L3 追加「放弃改动并删除」） */
export type PartialChoice =
  | 'retry-delete'
  | 'keep-both'
  | 'undo-copy'
  /** L3 保护分支：副本已被编辑过，用户显式放弃那些改动后才删 */
  | 'discard-copy-changes'
  | 'later';

export interface PartialSuccessPanelProps {
  /** 新位置（已成功写出） */
  createdPath: string;
  /** 旧位置（仍在磁盘上） */
  sourcePath: string;
  /** 失败原因文案（来自错误码映射） */
  reason: string;
  /**
   * 副本是否已有新改动（L3）。
   *
   * `true` → 「撤销新副本」**不得**直接执行（会丢改动），只提供
   * 「放弃这些改动并删除副本」或「保留两份」。
   */
  copyHasNewChanges: boolean;
  /** 是否仍在写/读（禁用按钮，避免重复点击） */
  busy?: boolean;
  onChoose: (choice: PartialChoice) => void;
}

export function PartialSuccessPanel({
  createdPath,
  sourcePath,
  reason,
  copyHasNewChanges,
  busy = false,
  onChoose,
}: PartialSuccessPanelProps): React.ReactElement {
  return (
    <div
      data-fm-partial
      style={{
        ...inlineBarStyle,
        border: `1px solid ${CHROME.warn}`,
        background: 'rgba(226,75,74,0.08)',
        display: 'block',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        ⚠ 已在新位置创建「{createdPath}」，但原文件删除失败。
      </div>
      <div style={{ marginBottom: 4 }}>现在磁盘上有两份：</div>
      <div style={{ color: CHROME.textMuted, marginBottom: 2 }}>• {createdPath}（新，当前编辑的是这一份）</div>
      <div style={{ color: CHROME.textMuted, marginBottom: 6 }}>• {sourcePath}（旧，仍占用原名）</div>
      <div style={{ color: CHROME.textMuted, marginBottom: 6 }}>原因：{reason}</div>

      {copyHasNewChanges && (
        <div data-fm-partial-copy-dirty style={{ color: CHROME.warn, marginBottom: 6 }}>
          这份副本已有新的改动，删除会丢失它们。
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          data-fm-partial-retry
          disabled={busy}
          style={btnBase}
          onClick={() => onChoose('retry-delete')}
        >
          重试删除原文件
        </button>
        <button type="button" data-fm-partial-keep style={btnBase} onClick={() => onChoose('keep-both')}>
          保留两份
        </button>
        {/*
          L3 保护分支：无新改动 → 直接给「撤销新副本」；
          有新改动 → **不给**直接删除，只给必须显式确认的「放弃这些改动并删除副本」。
          无条件删除副本会让「副本的新内容仍在」这条断言转红 —— 那是本分支存在的理由。
        */}
        {copyHasNewChanges ? (
          <button
            type="button"
            data-fm-partial-discard-copy
            disabled={busy}
            style={{ ...btnBase, borderColor: CHROME.warn, color: CHROME.warn }}
            onClick={() => onChoose('discard-copy-changes')}
          >
            放弃这些改动并删除副本
          </button>
        ) : (
          <button
            type="button"
            data-fm-partial-undo
            disabled={busy}
            style={{ ...btnBase, borderColor: CHROME.warn, color: CHROME.warn }}
            onClick={() => onChoose('undo-copy')}
          >
            撤销新副本
          </button>
        )}
        <button type="button" data-fm-partial-later style={btnBase} onClick={() => onChoose('later')}>
          稍后处理
        </button>
      </div>
    </div>
  );
}

/**
 * 当前文档改名前的「有未保存修改」三选（§5.2⑤）。
 *
 * 为什么单独一块：改名复制的是**磁盘快照**；有未保存修改时先保存才不会丢。
 * 三个动作与离开决策器同族语义（保存并继续 / 放弃修改 / 取消），但**不改离开决策器**
 * （本轮排除项）—— 这里是操作自己的前置确认。
 */
export type RenameDirtyChoice = 'save-then-rename' | 'discard-then-rename' | 'cancel';

export interface RenameDirtyPanelProps {
  name: string;
  onChoose: (choice: RenameDirtyChoice) => void;
}

export function RenameDirtyPanel({ name, onChoose }: RenameDirtyPanelProps): React.ReactElement {
  return (
    <div
      data-fm-rename-dirty
      style={{ ...inlineBarStyle, border: `1px solid ${CHROME.warn}`, display: 'block' }}
    >
      <div style={{ marginBottom: 6 }}>
        改名会把磁盘上的内容复制到新文件。「{name}」还有未保存的修改，先保存才不会丢。
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          data-fm-rename-dirty-save
          autoFocus
          style={{ ...btnBase, borderColor: CHROME.neon, color: CHROME.neon }}
          onClick={() => onChoose('save-then-rename')}
        >
          保存并改名
        </button>
        <button
          type="button"
          data-fm-rename-dirty-discard
          style={btnBase}
          onClick={() => onChoose('discard-then-rename')}
        >
          放弃修改并改名
        </button>
        <button type="button" data-fm-rename-dirty-cancel style={btnBase} onClick={() => onChoose('cancel')}>
          取消
        </button>
      </div>
    </div>
  );
}

/**
 * 失败/拒绝提示条（错误码 → 文案的唯一映射入口）。
 *
 * 文案为空（如「与源同名」的静默取消）→ 不渲染：**没有反馈就是正确反馈**。
 */
export function FileOpNotice({
  notice,
  onDismiss,
}: {
  notice: string | null;
  onDismiss?: () => void;
}): React.ReactElement | null {
  if (notice === null || notice === '') return null;
  return (
    <div
      data-fm-op-notice
      style={{
        ...inlineBarStyle,
        border: `1px solid ${CHROME.warn}`,
        color: CHROME.warn,
      }}
    >
      <span style={{ flex: 1 }}>{notice}</span>
      {onDismiss && (
        <button type="button" data-fm-op-notice-dismiss style={btnBase} onClick={onDismiss}>
          知道了
        </button>
      )}
    </div>
  );
}
