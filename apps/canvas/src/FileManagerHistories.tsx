/**
 * 文件工作台底部的**历史池 + 迁移/投影反馈 + 底注**（P1-A · 从 `FileManager.tsx` 拆出）。
 *
 * 拆分动因：`FileManager.tsx` 逼近 `bigFiles` 红线（600 行）。这块只依赖
 * 「索引 + 值 + 回调」，与树渲染和当前文档编排无关。
 *
 * P1-A rider-C（P0-D-report :405 的弱匹配债务）：历史池的关联目标**必须由用户
 * 直接指定**。旧实现的「先 `fullPath === h.key`，再 `name === h.name`」弱匹配已
 * 移除 —— 在多份同名文档时它可能绑定到**非用户所指**的那一条，而
 * `relinkEvidence` 是**不可撤销为假**的凭证（`docIndex.relink` 一旦写入，
 * 无法区分对错）。本组件只把用户点选的两个键原样交出去：
 *  - `fullPath` 精确命中仍保留为**候选排序提示**（「最可能就是它」排最前），
 *    但**仍由用户点选** —— 排序是提示，不是判定；
 *  - `name` 相等**不再**参与任何判定。
 */
import type React from 'react';
import { FileManagerFooter } from './FileManagerInlineBars.js';
import {
  HistoryPool,
  MigrateFailedNotice,
  ProjectionFailureNotice,
} from './FileManagerViews.js';
import type { DocIndex, HistoryPoolEntry } from './docIndex.js';

export interface FileManagerHistoriesProps {
  index: DocIndex | null;
  history: readonly HistoryPoolEntry[];
  historyOpen: boolean;
  onToggleHistory: () => void;
  /**
   * 可关联的候选（`docKey` + 显示名）。**没有** `exact` 之外的判定语义：
   * 名字只用于排序提示，绝不用于自动绑定。
   */
  candidates: readonly { docKey: string; name: string }[];
  onRelink: (legacyKey: string, targetKey: string) => void;
  onIgnore: (legacyKey: string) => void;
  migrateFailed: number;
  projectionFailed: boolean;
}

export function FileManagerHistories({
  index,
  history,
  historyOpen,
  onToggleHistory,
  candidates,
  onRelink,
  onIgnore,
  migrateFailed,
  projectionFailed,
}: FileManagerHistoriesProps): React.ReactElement {
  return (
    <>
      {index && (
        <HistoryPool
          entries={history}
          open={historyOpen}
          onToggle={onToggleHistory}
          candidates={candidates}
          onLink={(h, targetKey) => onRelink(h.key, targetKey)}
          onIgnore={(h) => onIgnore(h.key)}
        />
      )}
      <MigrateFailedNotice count={migrateFailed} />
      <ProjectionFailureNotice failed={projectionFailed} />
      <FileManagerFooter />
    </>
  );
}
