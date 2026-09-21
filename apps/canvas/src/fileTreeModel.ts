/**
 * 文件工作区的**统一树模型**（FA2-T2）。
 *
 * 两种数据源 → 同一种树：
 *  - 工作区模式：`DirectoryWorkspaceHost.scan()` 返回的真实磁盘树；
 *  - 兼容模式：`DocLibrary`（localStorage 元数据索引，虚拟目录）。
 *
 * 为什么要在组件之外单独建这层：渲染逻辑（展开/折叠/搜索/拖拽）对两种源是**同一套**，
 * 只有「增删改移动」的落点不同。把这层抽出来后，UI 只认 `TreeNode`，
 * 也就能在无浏览器的情况下直接测树构建与过滤（不必渲染 React）。
 */
import type { DocEntry, DocLibrary, WorkspaceDir, WorkspaceFile, WorkspaceNode } from '@mindcanvas/react';

/** 统一树节点：目录或文档 */
export interface TreeNode {
  type: 'dir' | 'doc';
  /** 唯一 key（目录用 path，文档用 id） */
  key: string;
  name: string;
  /** 目录路径（文档为**所在目录**的路径，根为 ''） */
  path: string;
  /** 文档自身的完整路径（工作区模式 = 相对根路径；兼容模式 = id） */
  fullPath: string;
  ts: number;
  children: TreeNode[];
  /** 工作区模式下的真实句柄；兼容模式为 null */
  wsDir: WorkspaceDir | null;
  wsFile: WorkspaceFile | null;
  /** 兼容模式：源码快照已被配额剥掉（打开需重新选文件） */
  stale: boolean;
  /** 兼容模式的库条目（重命名/移动/删除要用） */
  entry: DocEntry | null;
}

const SEP = '/';

/** 工作区真实树 → 统一树 */
export function treeFromWorkspace(nodes: readonly WorkspaceNode[], parentPath = ''): TreeNode[] {
  return nodes.map((n) =>
    n.kind === 'dir'
      ? {
          type: 'dir' as const,
          key: `dir:${n.path}`,
          name: n.name,
          path: parentPath,
          fullPath: n.path,
          ts: 0,
          children: treeFromWorkspace(n.children, n.path),
          wsDir: n,
          wsFile: null,
          stale: false,
          entry: null,
        }
      : {
          type: 'doc' as const,
          key: `doc:${n.path}`,
          name: n.name,
          path: parentPath,
          fullPath: n.path,
          ts: n.ts,
          children: [],
          wsDir: null,
          wsFile: n,
          stale: false,
          entry: null,
        },
  );
}

/** DocLibrary 的虚拟目录 → 统一树（兼容模式） */
export function treeFromLibrary(library: DocLibrary): TreeNode[] {
  const entries = library.list();
  /** path → 节点（逐层建目录） */
  const dirs = new Map<string, TreeNode>();

  const ensureDir = (path: string): TreeNode | null => {
    if (path === '') return null;
    const hit = dirs.get(path);
    if (hit) return hit;
    const segs = path.split(SEP);
    const name = segs[segs.length - 1] ?? path;
    const parentPath = segs.slice(0, -1).join(SEP);
    const node: TreeNode = {
      type: 'dir',
      key: `dir:${path}`,
      name,
      path: parentPath,
      fullPath: path,
      ts: 0,
      children: [],
      wsDir: null,
      wsFile: null,
      stale: false,
      entry: null,
    };
    dirs.set(path, node);
    const parent = ensureDir(parentPath);
    if (parent) parent.children.push(node);
    return node;
  };

  const roots: TreeNode[] = [];
  // 预先建立所有目录节点（包括空目录）
  for (const f of library.folders()) {
    ensureDir(f);
  }

  for (const e of entries) {
    const folder = typeof e.folder === 'string' ? e.folder : '';
    const doc: TreeNode = {
      type: 'doc',
      key: `doc:${e.id}`,
      name: e.name,
      path: folder,
      fullPath: e.id,
      ts: e.ts,
      children: [],
      wsDir: null,
      wsFile: null,
      stale: e.source === undefined,
      entry: e,
    };
    const parent = ensureDir(folder);
    if (parent) parent.children.push(doc);
    else roots.push(doc);
  }
  // 建目录时可能先建了子目录、后建父目录 → 只有「父路径为根」的才进 roots
  for (const d of dirs.values()) {
    if (d.path === '') roots.push(d);
  }
  return sortTree(roots);
}

/** 目录在前、同名按中文友好排序（递归） */
export function sortTree(nodes: TreeNode[]): TreeNode[] {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  });
  for (const n of nodes) n.children = sortTree(n.children);
  return nodes;
}

/**
 * 关键字过滤：命中文档保留其**祖先链**，命中目录保留整棵子树。
 * 直接 filter 文档会把层级拍平 —— 那等于把刚建好的目录结构又打回原形。
 */
export function filterTree(nodes: readonly TreeNode[], query: string): TreeNode[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...nodes];
  const walk = (list: readonly TreeNode[]): TreeNode[] => {
    const out: TreeNode[] = [];
    for (const n of list) {
      if (n.type === 'doc') {
        if (n.name.toLowerCase().includes(q) || n.fullPath.toLowerCase().includes(q)) out.push(n);
        continue;
      }
      if (n.name.toLowerCase().includes(q)) {
        out.push(n);
        continue;
      }
      const children = walk(n.children);
      if (children.length > 0) out.push({ ...n, children });
    }
    return out;
  };
  return walk(nodes);
}

/** 递归找节点（按 key） */
export function findNode(nodes: readonly TreeNode[], key: string): TreeNode | null {
  for (const n of nodes) {
    if (n.key === key) return n;
    const hit = findNode(n.children, key);
    if (hit) return hit;
  }
  return null;
}

/** 全部目录（供「移动到…」/ 移动目标校验用） */
export function allDirs(nodes: readonly TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  for (const n of nodes) {
    if (n.type === 'dir') {
      out.push(n);
      out.push(...allDirs(n.children));
    }
  }
  return out;
}

/** 面包屑：把相对路径拆成逐级片段（`研发/架构.mm.md` → ['研发','架构.mm.md']） */
export function breadcrumbOf(relPath: string | null): string[] {
  if (!relPath) return [];
  return relPath.split(SEP).filter((s) => s.length > 0);
}

/**
 * 拖拽合法性：不能把目录拖进自己的后代（会造成环 / 路径自吞）。
 * 工作区模式下 moveFile 只处理文件，但兼容模式的目录树同样要防。
 */
export function canDropInto(dragKey: string, targetPath: string, tree: readonly TreeNode[]): boolean {
  const dragged = findNode(tree, dragKey);
  if (!dragged) return false;
  if (dragged.type === 'doc') return dragged.path !== targetPath;
  // 目录：目标不能是自己或自己的后代
  if (dragged.fullPath === targetPath) return false;
  return !targetPath.startsWith(`${dragged.fullPath}${SEP}`);
}
