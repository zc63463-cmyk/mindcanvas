/**
 * 文件工作台的右键菜单（FA2-T2 · 从 FileManager.tsx 拆出）。
 *
 * 行为：定位在光标处，点击空白关闭；「新建文件夹」只在目录节点上出现。
 */
import { useEffect } from 'react';
import { CHROME } from '@mindcanvas/react';
import { menuItem } from './fileManagerShared.js';

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
}: {
  x: number;
  y: number;
  isDir: boolean;
  onClose: () => void;
  onNewDoc: () => void;
  onNewDir: () => void;
  onRename: () => void;
  onDelete: () => void;
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
