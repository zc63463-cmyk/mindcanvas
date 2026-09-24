/**
 * 文件工作台的**内容区分发**（P1-A · 从 `FileManager.tsx` 拆出）。
 *
 * 拆分动因：`FileManager.tsx` 逼近 `bigFiles` 红线（600 行），而这块是三个视图
 * （全部目录 / 最近打开 / 收藏星标）的**空态与列表分发**，只依赖「值 + 回调」。
 *
 * P1-A ④：树视图的容器 `role="tree"` 在这里挂（行是 `role="treeitem"`，
 * 见 `FileManagerTree`）。空态与加载态**不是** tree —— 给空态挂 `role="tree"`
 * 会让读屏在「没有条目」时说出一棵空树，反而制造噪音。
 */
import type React from 'react';
import { CHROME } from '@mindcanvas/react';
import { FlatDocList, type FlatRow } from './FileManagerViews.js';
import { FileManagerTree, type FileManagerTreeCtx } from './FileManagerTree.js';
import type { TreeNode } from './fileTreeModel.js';
import type { FileManagerTab } from './FileManagerChrome.js';

export interface TreePaneProps {
  loading: boolean;
  tab: FileManagerTab;
  viewTree: readonly TreeNode[];
  hasQuery: boolean;
  query: string;
  treeCtx: FileManagerTreeCtx;
  recentRows: readonly FlatRow[];
  starredRows: readonly FlatRow[];
  onToggleStar: (key: string, e: { stopPropagation: () => void }) => void;
  onOpen: (node: TreeNode) => void;
}

export function TreePane({
  loading,
  tab,
  viewTree,
  hasQuery,
  query,
  treeCtx,
  recentRows,
  starredRows,
  onToggleStar,
  onOpen,
}: TreePaneProps): React.ReactElement {
  return (
    <div data-fm-tree style={{ overflow: 'auto', flex: 1, padding: '2px 0 8px' }}>
      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: CHROME.textMuted }}>扫描中…</div>
      ) : tab === 'tree' ? (
        viewTree.length === 0 ? (
          <div style={{ padding: '28px 12px', textAlign: 'center', color: CHROME.textMuted }}>
            {hasQuery ? `没有匹配「${query}」的文件。` : '还没有文档。点「＋ 新建导图」开始。'}
          </div>
        ) : (
          /*
           * ④ 树容器语义：`role="tree"` 只在这一层。行的方向键处理挂在行上
           * （`FileManagerTree` 的 `onRowKeyDown`），容器不重复实现一套键位
           * （派单书 §3.5：同一套规则不得有两份实现）。
           */
          <div
            data-fm-tree-root
            role="tree"
            aria-label="文件与文件夹"
            aria-multiselectable={false}
            style={{ outline: 'none' }}
          >
            <FileManagerTree nodes={viewTree} depth={0} ctx={treeCtx} />
          </div>
        )
      ) : tab === 'recent' ? (
        <FlatDocList
          rows={recentRows}
          emptyText={hasQuery ? `没有匹配「${query}」的文件。` : '暂无最近打开的文档。'}
          onToggleStar={onToggleStar}
          onOpen={onOpen}
        />
      ) : (
        <FlatDocList
          rows={starredRows}
          emptyText={
            hasQuery
              ? `没有匹配「${query}」的收藏。`
              : '暂无收藏导图。在文档条目上点击 ☆ 即可加入收藏。'
          }
          onToggleStar={onToggleStar}
          onOpen={onOpen}
        />
      )}
    </div>
  );
}
