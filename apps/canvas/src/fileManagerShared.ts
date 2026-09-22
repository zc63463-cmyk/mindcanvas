/**
 * 文件工作台的共享样式与纯工具函数（FA2-T2 · 从 FileManager.tsx 拆出）。
 *
 * 拆分动因：FileManager.tsx 逼近 900 行，其中样式常量表与 3 个纯函数
 * （子树文档收集 / 相对时间 / 输入框样式）与组件状态无关，
 * 留在原地只稀释主组件的可读性。这里同时保留给未来 ContextMenu 复用。
 */
import { useCallback, useState } from 'react';
import type React from 'react';
import { CHROME } from '@mindcanvas/react';
import type { TreeNode } from './fileTreeModel.js';

export const SEP = '/';
export const NEW_DOC_TEMPLATE = '# 未命名\n';

export const rowBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  width: '100%',
  textAlign: 'left',
  background: 'none',
  border: 'none',
  color: CHROME.text,
  cursor: 'pointer',
  fontFamily: CHROME.fontFamily,
  fontSize: CHROME.fontSize,
  padding: 0,
};

export const menuItem: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  background: 'none',
  border: 'none',
  color: CHROME.text,
  cursor: 'pointer',
  fontFamily: CHROME.fontFamily,
  fontSize: CHROME.fontSizeSmall,
  padding: '5px 10px',
};

export const btnBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  background: 'none',
  border: `1px solid ${CHROME.panelBorder}`,
  borderRadius: CHROME.radiusSmall,
  color: CHROME.text,
  cursor: 'pointer',
  fontFamily: CHROME.fontFamily,
  fontSize: CHROME.fontSizeSmall,
  padding: '4px 10px',
  whiteSpace: 'nowrap',
};

/** 内联操作条（A-D3：删除确认 / 新建命名的公共外观；各自再覆写 border/background） */
export const inlineBarStyle: React.CSSProperties = {
  margin: '0 12px 8px',
  padding: '6px 8px',
  borderRadius: 6,
  fontSize: CHROME.fontSizeSmall,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

/** 递归收集子树内所有文档节点 */
export function collectDocs(nodes: readonly TreeNode[]): TreeNode[] {
  const result: TreeNode[] = [];
  for (const n of nodes) {
    if (n.type === 'doc') result.push(n);
    if (n.children && n.children.length > 0) result.push(...collectDocs(n.children));
  }
  return result;
}

export function inputStyle(flex = 1): React.CSSProperties {
  return {
    flex,
    background: CHROME.panelBg,
    border: `1px solid ${CHROME.panelBorderStrong}`,
    borderRadius: 6,
    color: CHROME.text,
    padding: '4px 8px',
    fontFamily: CHROME.fontFamily,
    fontSize: CHROME.fontSizeSmall,
  };
}

/** 时间戳 → 中文相对时间（>30 天回落到绝对日期） */
export function formatRelative(ts: number): string {
  if (ts <= 0) return '—';
  const diff = Date.now() - ts;
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

/** 右键菜单状态 */
export interface MenuState {
  key: string;
  x: number;
  y: number;
}

const STARRED_KEY = 'mindcanvas.starred.v1';

/** 从 localStorage 读收藏集合（损坏/不可用时返回空集，不抛） */
function loadStarred(): Set<string> {
  try {
    const raw = localStorage.getItem(STARRED_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

/**
 * `useStarredKeys` 消费的索引面（`DocIndex` 天然满足；测试可注入替身）。
 *
 * 只需三个方法：读全部收藏键、判定单个键、按路径键切换。
 */
export interface StarredIndexPort {
  starredKeys(): Set<string>;
  isStarred(key: string): boolean;
  setStarredByPath(key: string, starred: boolean): unknown;
}

/**
 * 收藏星标集合（**P0-D：读写索引层**，不再直接读写 `mindcanvas.starred.v1`）。
 *
 * 为什么换数据源：旧键按 `fullPath` 存，改名即丢；索引按**稳定身份**（`docKey`）存，
 * 路径变化不影响连续性（P0-A 的改名/移动依赖这一点）。旧键由索引层的降级投影
 * 同步写出，因此旧版本读到的仍是同一份收藏（§6.3 / I-21）。
 *
 * `index` 由 FileManager 注入（唯一索引写入口在 `docIndex.ts`）。**缺省时不写任何键**：
 * 回落到直接写旧键会绕开降级投影，造成两侧漂移——宁可只读旧值，也不产生第二写入口。
 */
export function useStarredKeys(index?: StarredIndexPort | null): {
  starredKeys: Set<string>;
  toggleStar: (key: string, e: { stopPropagation: () => void }) => void;
} {
  const [starredKeys, setStarredKeys] = useState<Set<string>>(() =>
    index ? index.starredKeys() : loadStarred(),
  );
  const toggleStar = useCallback(
    (key: string, e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      if (!index) return; // 无索引：只读旧键，不产生第二写入口
      index.setStarredByPath(key, !index.isStarred(key));
      setStarredKeys(index.starredKeys());
    },
    [index],
  );
  return { starredKeys, toggleStar };
}
