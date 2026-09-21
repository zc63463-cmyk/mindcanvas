/**
 * 最近文档下拉（从 `MindmapStage` 抽出，T1 结构治理续）。
 *
 * 文档栏「最近」按钮弹出的列表：读 `docHost.recent()`，点击切换到该导图。
 * 切换本身走 `applyDoc`（有未保存修改时弹确认）—— 这个守卫在调用方，不在本组件。
 *
 * 不是什么：不含新建/打开/保存动作（那些在文档栏），也不含持久化
 * （`recent()` 由 DocLibrary 派生，见 `document.ts`）。
 */
import { CHROME, type MindDoc } from '@mindcanvas/react';

export interface RecentDocMenuProps {
  /** 最近文档列表（新在前） */
  recent: readonly MindDoc[];
  /** 选中某条（组件会先关菜单再回调，与原行为一致） */
  onPick: (doc: MindDoc) => void;
  /** 关闭菜单 */
  onClose: () => void;
}

export function RecentDocMenu({ recent, onPick, onClose }: RecentDocMenuProps) {
  return (
    <div
      data-recent-menu
      style={{
        position: 'absolute',
        left: 12,
        top: 44,
        zIndex: 3,
        minWidth: 200,
        background: CHROME.panelBg,
        border: `1px solid ${CHROME.panelBorder}`,
        borderRadius: CHROME.radius,
        boxShadow: CHROME.shadow,
        backdropFilter: 'blur(12px)',
        padding: 6,
      }}
    >
      {recent.length === 0 ? (
        <div
          style={{
            color: CHROME.textMuted,
            fontSize: CHROME.fontSizeSmall,
            padding: '4px 6px',
          }}
        >
          暂无最近文档
        </div>
      ) : (
        recent.map((d) => (
          <div
            key={d.id}
            data-recent-doc
            onClick={() => {
              onClose();
              onPick(d);
            }}
            style={{
              padding: '4px 6px',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: CHROME.fontSizeSmall,
              color: CHROME.text,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {d.name}
          </div>
        ))
      )}
    </div>
  );
}
