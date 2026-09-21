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

/** 收藏星标集合（localStorage 持久化；供 FileManager 与未来视图复用） */
export function useStarredKeys(): {
  starredKeys: Set<string>;
  toggleStar: (key: string, e: { stopPropagation: () => void }) => void;
} {
  const [starredKeys, setStarredKeys] = useState<Set<string>>(loadStarred);
  const toggleStar = useCallback((key: string, e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    setStarredKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(STARRED_KEY, JSON.stringify([...next]));
      } catch {
        // 隐私模式/配额满：忽略，仅内存态生效
      }
      return next;
    });
  }, []);
  return { starredKeys, toggleStar };
}
