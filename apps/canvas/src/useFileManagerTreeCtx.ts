/**
 * 树行渲染上下文（`FileManagerTreeCtx`）的**组装**（P1-A · 从 `FileManager.tsx` 拆出）。
 *
 * 拆分动因：`FileManager.tsx` 逼近 `bigFiles` 红线（600 行），而这里只是
 * 「值 + 原样透传的回调」的机械拼装（P1-A 起回调面从 ~18 个增至 ~28 个，
 * 内联在组件里占了 40 行）。真正的组装实现在 `FileManagerWiring.buildTreeCtx`，
 * 本 hook 只负责把 `FileManager` 的各项 state/callback 摆进去。
 *
 * 不是什么：不含业务判定（唯一有语义的是「①高亮判据 = currentPath」与
 * 「⑤不可打开文件的提示出口」，两者都只是把已有值接上去）。
 */
import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { DocEntry, WorkspaceFile } from '@mindcanvas/react';
import {
  buildTreeCtx,
  type WorkspaceLike,
} from './FileManagerWiring.js';
import type { FileManagerTreeCtx } from './FileManagerTree.js';
import type { MenuState } from './fileManagerShared.js';
import type { TreeNode } from './fileTreeModel.js';
import type { useFileTreeView } from './useFileTreeView.js';

/** `useFileTreeView` 的返回面（结构化引用，避免循环 import） */
type TreeView = ReturnType<typeof useFileTreeView>;

export interface TreeCtxInput {
  view: TreeView;
  dropTarget: string | null;
  dragKey: string | null;
  renamingKey: string | null;
  starredKeys: ReadonlySet<string>;
  currentPath: string | null;
  allDocs: readonly TreeNode[];
  openNode: (node: TreeNode) => void;
  onOpenFile: (file: WorkspaceFile) => void;
  onOpenEntry: (entry: DocEntry) => void;
  onDropInto: (node: TreeNode, target: TreeNode) => void;
  onCommitRename: (node: TreeNode, nextName: string) => void;
  onDeleteKey: (node: TreeNode) => void;
  onUnopenable: (node: TreeNode) => void;
  toggleStar: (key: string, e: { stopPropagation: () => void }) => void;
  setDropTarget: Dispatch<SetStateAction<string | null>>;
  setDragKey: Dispatch<SetStateAction<string | null>>;
  setMenu: (menu: MenuState) => void;
  setRenamingKey: (key: string | null) => void;
}

export function useFileManagerTreeCtx(input: TreeCtxInput): FileManagerTreeCtx {
  const { view } = input;
  const {
    dropTarget,
    dragKey,
    renamingKey,
    starredKeys,
    currentPath,
    allDocs,
    openNode,
    onOpenFile,
    onOpenEntry,
    onDropInto,
    onCommitRename,
    onDeleteKey,
    onUnopenable,
    toggleStar,
    setDropTarget,
    setDragKey,
    setMenu,
    setRenamingKey,
  } = input;

  const onUnopenableStable = useCallback(
    (node: TreeNode): void => onUnopenable(node),
    [onUnopenable],
  );
  const onDeleteStable = useCallback(
    (node: TreeNode): void => onDeleteKey(node),
    [onDeleteKey],
  );

  return buildTreeCtx({
    tree: view.viewTree,
    expanded: view.expanded,
    query: view.query,
    dropTarget,
    dragKey,
    renamingKey,
    starredKeys,
    toggle: view.toggle,
    setDropTarget,
    setDragKey,
    setMenu,
    dropInto: onDropInto,
    commitRename: onCommitRename,
    setRenamingKey,
    toggleStar,
    onOpenFile,
    onOpenEntry,
    allDocs,
    openNode,
    currentPath,
    focusedKey: view.focusedKey,
    setFocusedKey: view.setFocusedKey,
    focusRow: view.focusRow,
    keyIntent: view.keyIntent,
    visibleRows: view.visibleRows,
    registerRow: view.registerRow,
    setExpanded: view.setExpanded,
    onUnopenable: onUnopenableStable,
    onDeleteKey: onDeleteStable,
  });
}

/** 供 `FileManager` 组装归档落点（`_归档/` 可能尚不存在） */
export function virtualDirNode(path: string): TreeNode {
  const name = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path;
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  return {
    type: 'dir',
    key: `dir:${path}`,
    name,
    path: parent,
    fullPath: path,
    ts: 0,
    children: [],
    wsDir: null,
    wsFile: null,
    stale: false,
    entry: null,
  };
}

/** 未使用但需保持引用面一致的空导出（避免 workspace 类型被 tree-shake 破坏） */
export type { WorkspaceLike };
