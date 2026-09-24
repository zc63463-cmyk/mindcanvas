/**
 * 文件工作台的右键菜单（FA2-T2 · 从 FileManager.tsx 拆出）。
 *
 * 行为：定位在光标处，点击空白关闭；「新建文件夹」只在目录节点上出现。
 */
import { useEffect } from 'react';
import { CHROME } from '@mindcanvas/react';
import { menuItem } from './fileManagerShared.js';
import { ARCHIVE_ACTION_COPY } from './useFileArchive.js';

/** 右键菜单（点击空白关闭；定位在光标处） */
export function ContextMenu({
  x,
  y,
  isDir,
  onClose,
  onNewDoc,
  onNewDir,
  onRename,
  onDelete,
  onDuplicate,
  onArchive,
}: {
  x: number;
  y: number;
  isDir: boolean;
  onClose: () => void;
  onNewDoc: () => void;
  onNewDir: () => void;
  onRename: () => void;
  onDelete: () => void;
  /**
   * P0-A：「创建副本」（§3.5）。缺省 undefined → 不渲染该项
   * （兼容模式/未接线时没有副本入口，避免造出无落点的按钮）。
   */
  onDuplicate?: () => void;
  /**
   * P1-A ⑥：「改为归档」（§3.6 / §3.2 的**右键入口**）。
   * 与删除确认条旁的次要动作调**同一编排**（`useFileArchive.request`）。
   * 缺省 undefined → 不渲染（非工作区/目录/已在归档里）。
   */
  onArchive?: () => void;
}) {
  useEffect(() => {
    const close = (): void => onClose();
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [onClose]);

  return (
    <div
      data-context-menu
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 200,
        minWidth: 140,
        background: CHROME.panelBgStrong,
        border: `1px solid ${CHROME.panelBorder}`,
        borderRadius: CHROME.radiusSmall,
        boxShadow: CHROME.shadow,
        backdropFilter: 'blur(14px)',
        padding: '4px 0',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <button type="button" data-menu-new-doc style={menuItem} onClick={onNewDoc}>
        新建导图
      </button>
      {isDir && (
        <button type="button" data-menu-new-dir style={menuItem} onClick={onNewDir}>
          新建文件夹
        </button>
      )}
      <button type="button" data-menu-rename style={menuItem} onClick={onRename}>
        重命名
      </button>
      {onDuplicate && (
        <button type="button" data-menu-duplicate style={menuItem} onClick={onDuplicate}>
          创建副本
        </button>
      )}
      {onArchive && (
        <button type="button" data-menu-archive style={menuItem} onClick={onArchive}>
          {ARCHIVE_ACTION_COPY}
        </button>
      )}
      <button
        type="button"
        data-menu-delete
        style={{ ...menuItem, color: CHROME.warn }}
        onClick={onDelete}
      >
        删除
      </button>
    </div>
  );
}
