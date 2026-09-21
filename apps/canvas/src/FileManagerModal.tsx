/**
 * 文件工作台的挂载层（FA2-T2）。
 *
 * 三件事合在这里：
 * ① 形态容器：`drawer` 左侧贴边滑出（无遮罩，可继续操作画布）；`wide` 居中模态（带遮罩）；
 * ② **打开策略**：工作区文件 → 读磁盘内容后 applyDoc（带未保存守卫）；
 *    兼容模式条目有源码快照 → applyDoc；只剩元数据 → 走「重新选文件」；
 * ③ 关闭语义：点击遮罩 / Esc 关闭，内层拦截冒泡。
 *
 * 为什么策略也放进来：它是"从文件工作台打开文档"的完整语义，放主函数里
 * 会让文件管理的逻辑再次分裂到两处（上一轮拆边时就吃过这个亏）。
 */
import { useEffect } from 'react';
import type { DocEntry, DocLibrary, MindDoc, WorkspaceFile } from '@mindcanvas/react';
import { FileManager, type WorkspaceLike } from './FileManager.js';

export interface FileManagerModalProps {
  library: DocLibrary;
  /** 目录工作区宿主；null/未挂载 → 兼容模式 */
  workspace: WorkspaceLike | null;
  /**
   * 切换到某文档；**返回是否真的切换了**。
   * 用户若在未保存确认框点「取消」则返回 false —— 此时保持浮层打开，
   * 否则会出现「界面关了但文档没换」的观感。
   */
  applyDoc: (doc: MindDoc) => Promise<boolean>;
  /** 条目无源码快照时：让用户重新选文件（内部同样经守卫） */
  handleOpen: () => Promise<void>;
  /** 新建文档（兼容模式；工作区模式由 FileManager 直接落盘） */
  handleNew: () => void;
  /** 工作区：打开真实文件（读内容 → applyDoc） */
  openWorkspaceFile: (file: WorkspaceFile) => Promise<boolean>;
  /** 「打开本地文件夹」：触发 showDirectoryPicker 并挂载 */
  onPickWorkspace?: () => void;
  /** 断开工作区 */
  onDetachWorkspace?: () => void;
  /** 当前文档的相对路径（面包屑） */
  currentPath?: string | null;
  /** 当前文档是否 dirty */
  dirty?: boolean;
  /** 形态：抽屉 / 宽幅模态 */
  variant?: 'drawer' | 'wide';
  onClose: () => void;
}

export function FileManagerModal({
  library,
  workspace,
  applyDoc,
  handleOpen,
  handleNew,
  openWorkspaceFile,
  onPickWorkspace,
  onDetachWorkspace,
  currentPath = null,
  dirty = false,
  variant = 'wide',
  onClose,
}: FileManagerModalProps) {
  // Esc 关闭（抽屉形态下没有遮罩可点，键盘是唯一的快速退出）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const panel = (
    <FileManager
      library={library}
      workspace={workspace}
      currentPath={currentPath}
      dirty={dirty}
      variant={variant}
      onOpenEntry={async (entry: DocEntry) => {
        // 只剩元数据（旧条目被配额剥掉 source）→ 重新选文件。
        // 这条路径同样可能丢弃未保存修改，所以走 handleOpen（内部经 applyDoc 守卫）。
        if (entry.source === undefined) {
          onClose();
          void handleOpen();
          return;
        }
        const switched = await applyDoc({
          id: entry.id,
          name: entry.name,
          source: entry.source,
          saved: true,
          ts: entry.ts,
        });
        if (switched) onClose();
      }}
      onOpenFile={async (file: WorkspaceFile) => {
        const switched = await openWorkspaceFile(file);
        if (switched) onClose();
      }}
      onCreate={() => {
        onClose();
        handleNew();
      }}
      onPickWorkspace={onPickWorkspace}
      onDetachWorkspace={onDetachWorkspace}
      onClose={onClose}
    />
  );

  if (variant === 'drawer') {
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 60,
          display: 'flex',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            pointerEvents: 'auto',
            display: 'flex',
            maxHeight: '100%',
            padding: 12,
          }}
        >
          {panel}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 60,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(0,0,0,.45)',
      }}
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()}>{panel}</div>
    </div>
  );
}
