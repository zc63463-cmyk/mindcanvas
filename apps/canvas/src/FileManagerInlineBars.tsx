/**
 * 文件工作台的**内联操作条**（A-D3 删除确认 / 新建命名；从 `FileManager.tsx` 抽出）。
 *
 * 拆分动因：`FileManager.tsx` 逼近代码预算的 `bigFiles` 红线（600 行）。
 * 这两条只依赖「待决目标 + 回调」，且都必须内联（原生 confirm/prompt 在 webview
 * 会被静默吞掉，见 `no-native-dialogs.test.ts`）。
 */
import type React from 'react';
import { CHROME } from '@mindcanvas/react';
import type { TreeNode } from './fileTreeModel.js';
import { btnBase, inlineBarStyle, inputStyle } from './fileManagerShared.js';

/** A-D3：删除内联确认条（替代 window.confirm） */
export function DeleteConfirmBar({
  target,
  useWorkspace,
  onConfirm,
  onCancel,
}: {
  target: TreeNode;
  /** 工作区模式：文案说明「会真实删除磁盘文件」 */
  useWorkspace: boolean;
  onConfirm(): void;
  onCancel(): void;
}): React.ReactElement {
  return (
    <div
      data-fm-confirm
      style={{ ...inlineBarStyle, border: `1px solid ${CHROME.warn}`, background: 'rgba(226,75,74,0.08)' }}
    >
      <span style={{ flex: 1 }}>
        删除
        {target.type === 'dir' ? `文件夹「${target.name}」及其全部内容` : `文件「${target.name}」`}？{' '}
        <span style={{ color: CHROME.textMuted }}>
          （{useWorkspace ? '会真实删除磁盘文件' : '所含文档将退回根目录'}）
        </span>
      </span>
      <button
        type="button"
        data-fm-confirm-ok
        style={{ ...btnBase, borderColor: CHROME.warn, color: CHROME.warn }}
        onClick={onConfirm}
      >
        删除
      </button>
      <button type="button" data-fm-confirm-cancel style={btnBase} onClick={onCancel}>
        取消
      </button>
    </div>
  );
}

/** A-D3：新建文件夹内联命名（替代 window.prompt；Enter 提交 / Esc 取消） */
export function NewFolderNameBar({
  parentPath,
  onSubmit,
  onCancel,
}: {
  parentPath: string;
  onSubmit(name: string): void;
  onCancel(): void;
}): React.ReactElement {
  return (
    <div data-fm-name style={{ ...inlineBarStyle, border: `1px solid ${CHROME.panelBorderStrong}` }}>
      <span style={{ color: CHROME.textMuted, whiteSpace: 'nowrap' }}>
        新建文件夹{parentPath === '' ? '' : `于「${parentPath}」`}：
      </span>
      <input
        autoFocus
        data-fm-name-input
        defaultValue="新文件夹"
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter') onSubmit(ev.currentTarget.value);
          if (ev.key === 'Escape') onCancel();
        }}
        style={inputStyle()}
      />
    </div>
  );
}

/** 扫描/工作区错误条 */
export function TreeErrorBar({ message }: { message: string }): React.ReactElement {
  return (
    <div
      style={{
        margin: '0 12px 8px',
        padding: '6px 8px',
        borderRadius: 6,
        border: `1px solid ${CHROME.warn}`,
        color: CHROME.warn,
        fontSize: CHROME.fontSizeSmall,
      }}
    >
      {message}
    </div>
  );
}

/** 头部：标题 + 三个动作（新建文件夹 / 新建导图 / 关闭） */
export function FileManagerHeader({
  onNewFolder,
  onNewDoc,
  onClose,
}: {
  onNewFolder(): void;
  onNewDoc(): void;
  onClose(): void;
}): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '12px 14px',
        borderBottom: `1px solid ${CHROME.panelBorder}`,
      }}
    >
      <span style={{ fontWeight: 600 }}>文件工作台</span>
      <span style={{ flex: 1 }} />
      <button type="button" data-fm-new-folder style={btnBase} onClick={onNewFolder}>
        📁 新建文件夹
      </button>
      <button
        type="button"
        data-fm-new-doc
        style={{ ...btnBase, borderColor: CHROME.neon, color: CHROME.neon }}
        onClick={onNewDoc}
      >
        ＋ 新建导图
      </button>
      <button type="button" data-fm-close style={btnBase} onClick={onClose}>
        关闭
      </button>
    </div>
  );
}

/** 脚注：拖拽与右键操作提示 */
export function FileManagerFooter(): React.ReactElement {
  return (
    <div
      style={{
        padding: '8px 12px',
        borderTop: `1px solid ${CHROME.panelBorder}`,
        fontSize: CHROME.fontSizeSmall,
        color: CHROME.textMuted,
      }}
    >
      拖拽文件到 📁 文件夹即可归位 · 右键文件/文件夹可新建、重命名、删除
    </div>
  );
}
