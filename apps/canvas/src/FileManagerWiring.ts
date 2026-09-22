/**
 * 文件工作台的**接线适配面**（P0-D · 从 FileManager.tsx 拆出）。
 *
 * 拆分动因：FileManager.tsx 逼近代码预算的 `bigFiles` 红线（600 行）。
 * 这里放三样与渲染无关、但主组件与外部都要用的东西：
 * ① 工作区宿主的最小面（`WorkspaceLike`，测试注入替身用）；
 * ② 树节点 → 索引稳定身份（`docKeyOfEntry`）与其上下文判据；
 * ③ `FlatRow`（平铺列表行）的解析函数。
 *
 * 不是什么：不持有状态、不渲染、不做迁移（迁移在 `docIndex.ts` / `docIndexMigrate.ts`）。
 */
import {
  BROWSER_SCOPE_ID,
  type DocEntry,
  type WorkspaceDir,
  type WorkspaceFile,
  type WorkspaceNode,
} from '@mindcanvas/react';
import type { Dispatch, SetStateAction } from 'react';
import type { FileManagerTreeCtx } from './FileManagerTree.js';
import type { MenuState } from './fileManagerShared.js';
import { browserDocKey, formatRecentWhen, wsDocKey } from './docIndex.js';
import type { DocIndexEntry } from './docIndex.js';
import type { TreeNode } from './fileTreeModel.js';
import type { FlatRow } from './FileManagerViews.js';

/**
 * 工作区能力的最小面（结构化类型，`DirectoryWorkspaceHost` 天然满足）。
 * 收窄到 UI 真正用到的成员，测试可直接注入替身，无需浏览器 FS。
 */
export interface WorkspaceLike {
  mounted: boolean;
  name: string | null;
  /**
   * 工作区身份（P0-0 的 `DirectoryWorkspaceHost` 已提供）。
   * 索引主键要以它作前缀；缺省（旧替身）按「浏览器/兼容模式」处理。
   */
  scopeId?: string | null;
  /** 运行期身份形态；`persisted === false` → 索引条目带 `ephemeral` */
  scopeState?: { kind: string; persisted: boolean };
  scan(force?: boolean): Promise<WorkspaceNode[]>;
  createFile(dirPath: string, name: string, text: string): Promise<WorkspaceFile>;
  createDir(parentPath: string, name: string): Promise<WorkspaceDir>;
  renameFile(file: WorkspaceFile, name: string): Promise<WorkspaceFile>;
  removeFile(file: WorkspaceFile): Promise<void>;
  removeDir(dir: WorkspaceDir): Promise<void>;
  moveFile(file: WorkspaceFile, targetDirPath: string): Promise<WorkspaceFile>;
}

/**
 * 树节点 → 稳定索引身份（`docKey`）。
 *
 * 工作区：`ws:<scopeId 主体>::<relPath>`；浏览器/兼容模式：`browser::<docId>`。
 * `fullPath` 在兼容模式就是旧库 id，在工作区就是相对路径——两种身份的差别全在这里翻译。
 *
 * `browser:local` 是**浏览器作用域**（不是磁盘工作区的 `ws:` 身份）：
 * 它的主键必须是 `browser::<id>`，套 `ws:` 前缀会得到
 * `ws:browser:local::a.mm.md` 这种谁也对不上的键（实测踩过：
 * 同一个文档因此同时存在两条条目，「最近」列表出现重复行）。
 */
export function docKeyOfEntry(node: TreeNode, scopeId: string | null): string {
  if (scopeId === null || scopeId === BROWSER_SCOPE_ID) return browserDocKey(node.fullPath);
  return wsDocKey(scopeId, node.fullPath);
}

/**
 * 作用域是否持久（决定索引条目带不带 `ephemeral`）。
 * `disk-session`（身份不跨刷新）→ false，该类条目的 `scopeId` 下次会话无效。
 */
export function workspaceScopePersisted(workspace: WorkspaceLike | null): boolean {
  return workspace?.scopeState?.persisted === true;
}

/**
 * 索引条目 → 平铺列表行（在**当前树**里找对应节点）。
 *
 * 找不到就返回 null：索引里有、当前树里没有（已删 / 属于别的作用域）的条目
 * 不该出现在本视图里（否则点了打不开）。`matchQuery` 由调用方传入以复用搜索口径。
 */
export function rowFromIndexEntry(
  e: DocIndexEntry,
  byKey: ReadonlyMap<string, TreeNode>,
  starredKeys: ReadonlySet<string>,
  matchQuery: (nodes: readonly TreeNode[]) => TreeNode[],
): FlatRow | null {
  const node =
    byKey.get(`doc:${e.relPath ?? ''}`) ??
    byKey.get(`doc:${e.docKey}`) ??
    (e.relPath !== null ? byKey.get(`doc:${e.relPath}`) : undefined);
  if (!node) return null;
  if (matchQuery([node]).length === 0) return null;
  return {
    key: node.key,
    node,
    when: formatRecentWhen(e.openedAt),
    starred: e.starred || starredKeys.has(node.fullPath) || starredKeys.has(node.key),
    starKey: node.fullPath || node.key,
  };
}

/** 树节点 → 平铺列表行（兼容模式与「收藏」视图共用；时间按调用方给的格式化器） */
export function rowFromNode(
  node: TreeNode,
  when: string,
  starred: boolean,
): FlatRow {
  return { key: node.key, node, when, starred, starKey: node.fullPath || node.key };
}

/**
 * 树行渲染上下文（`FileManagerTreeCtx`）的组装。
 *
 * 放在这里而不是主组件：它只是「值 + 原样透传的回调」的机械拼装，
 * 且打开入口要按「节点 → 是否已在树里」分流（树内走 `openNode` 以推进 `openedAt`）。
 */
export function buildTreeCtx(input: {
  tree: readonly TreeNode[];
  expanded: ReadonlySet<string>;
  query: string;
  dropTarget: string | null;
  dragKey: string | null;
  renamingKey: string | null;
  starredKeys: ReadonlySet<string>;
  toggle: (key: string) => void;
  setDropTarget: Dispatch<SetStateAction<string | null>>;
  setDragKey: Dispatch<SetStateAction<string | null>>;
  setMenu: (menu: MenuState) => void;
  dropInto: (node: TreeNode, target: TreeNode) => void;
  commitRename: (node: TreeNode, nextName: string) => void;
  setRenamingKey: (key: string | null) => void;
  toggleStar: (key: string, e: { stopPropagation: () => void }) => void;
  onOpenFile: (file: WorkspaceFile) => void;
  onOpenEntry: (entry: DocEntry) => void;
  allDocs: readonly TreeNode[];
  openNode: (node: TreeNode) => void;
}): FileManagerTreeCtx {
  return {
    tree: input.tree,
    expanded: input.expanded,
    query: input.query,
    dropTarget: input.dropTarget,
    dragKey: input.dragKey,
    renamingKey: input.renamingKey,
    starredKeys: input.starredKeys,
    toggle: input.toggle,
    setDropTarget: input.setDropTarget,
    setDragKey: input.setDragKey,
    setMenu: input.setMenu,
    dropInto: input.dropInto,
    commitRename: input.commitRename,
    setRenamingKey: input.setRenamingKey,
    toggleStar: input.toggleStar,
    // 打开入口在树内先解析到节点，才能推进 openedAt（UD-2）；
    // 找不到节点（如工作区文件不在当前树）时原样透传，不吞掉打开动作。
    onOpenFile: (file) => {
      const node = input.allDocs.find((d) => d.wsFile === file);
      if (node) input.openNode(node);
      else input.onOpenFile(file);
    },
    onOpenEntry: (entry) => {
      const node = input.allDocs.find((d) => d.entry === entry);
      if (node) input.openNode(node);
      else input.onOpenEntry(entry);
    },
  };
}

/** 索引条目 → 树节点查询表（`doc:<key>` 两种拼法都要能命中） */
export function nodeIndex(tree: readonly TreeNode[]): Map<string, TreeNode> {
  const out = new Map<string, TreeNode>();
  for (const d of flatten(tree)) {
    out.set(d.key, d);
    if (d.fullPath !== '') out.set(`doc:${d.fullPath}`, d);
  }
  return out;
}

function flatten(nodes: readonly TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  for (const n of nodes) {
    out.push(n);
    if (n.children.length > 0) out.push(...flatten(n.children));
  }
  return out;
}
