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
  /**
   * P1-A ⑤：**不支持打开**的文件（非 `.mm.md`/`.md`，或 `.` 开头的隐藏文件）。
   *
   * 这类节点只在「显示其他文件」开关打开后出现在树里，且**不可打开**：
   * 点击给提示而非静默（`file-management.md` §2.3）。缺省 `undefined` = 正常文档，
   * 因此既有代码路径（打开/改名/删除/拖拽）对它的存在零感知。
   */
  unopenable?: true;
  /**
   * P1-A ②：文档内部标题（首个 H1），来自 docIndex **既有** `title` 字段。
   * 由调用方（FileManager）从索引读入后贴到节点上；无索引 → undefined（不新扫描）。
   */
  title?: string | null;
}

const SEP = '/';

/**
 * P1-A ⑤：「其他文件」分组的**保留 key**。
 * 用它记折叠状态；与任何真实路径都不可能相同（真实 path 不含 `\u0000`），
 * 故不会与目录 key 冲突。
 */
export const OTHER_FILES_KEY = 'other:\u0000';

/** P1-A ⑤：「其他文件」分组的显示名（`file-management.md` §5.1 线框原文） */
export function otherFilesLabel(count: number): string {
  return `其他文件（${count} 项，本应用不打开）`;
}

/** P1-A ⑤：不支持文件被点击时的提示（§2.3 原文『非导图文件，本应用不打开』） */
export const UNOPENABLE_NOTICE = '非导图文件，本应用不打开。';

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
          // P1-A ⑤：扫描带回来的「不打开」标记原样透传（缺省 undefined = 正常文档）
          ...(n.unopenable === true ? { unopenable: true as const } : {}),
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

/**
 * P1-A ③：排序依据。
 *
 * - `name`（缺省）：目录在前 + 中文友好 `localeCompare` —— **既有语义，逐字保留**；
 * - `mtime`：目录仍在前，同级按 `ts` 降序（最近修改在前）。
 *
 * 仅作用于「全部目录」视图（`file-management.md` §6）：「最近」固定按 `openedAt`，
 * 由索引层的 `compareRecent` 排序，**不经过本函数**（UD-2 不可动摇）。
 */
export type SortMode = 'name' | 'mtime';

/** 排序依据的显示名（列头写明依据，§6 原文要求） */
export const SORT_LABEL: Record<SortMode, string> = {
  name: '名称',
  mtime: '最近修改',
};

/** 目录在前、同级按 `mode` 排序（递归） */
export function sortTree(nodes: TreeNode[], mode: SortMode = 'name'): TreeNode[] {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    if (mode === 'mtime') {
      // 时间不可用时（目录的 ts 恒为 0）退回名称，避免同级出现随机顺序
      if (a.ts !== b.ts) return b.ts - a.ts;
    }
    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  });
  for (const n of nodes) n.children = sortTree(n.children, mode);
  return nodes;
}

/**
 * 关键字过滤：命中文档保留其**祖先链**，命中目录保留整棵子树。
 * 直接 filter 文档会把层级拍平 —— 那等于把刚建好的目录结构又打回原形。
 *
 * P1-A ②：文档命中加一路**内部标题**（`n.title`，来自 docIndex 既有字段）。
 * 范围明示在搜索框文案里（『仅搜索已记录的文档』）——未索引文档没有 `title`，
 * 自然不参与标题命中，且**不为此新增任何扫描**（派单书 §3.4）。
 */
export function filterTree(nodes: readonly TreeNode[], query: string): TreeNode[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...nodes];
  const walk = (list: readonly TreeNode[]): TreeNode[] => {
    const out: TreeNode[] = [];
    for (const n of list) {
      if (n.type === 'doc') {
        if (
          n.name.toLowerCase().includes(q) ||
          n.fullPath.toLowerCase().includes(q) ||
          (typeof n.title === 'string' && n.title.toLowerCase().includes(q))
        ) {
          out.push(n);
        }
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

/** 一个「其他文件」分组项（P1-A ⑤）：文件 + 它所属的目录路径 */
export interface OtherFileItem {
  fullPath: string;
  name: string;
  path: string;
}

/**
 * P1-A ⑤：把不支持的文件**合并成一棵虚拟子树**挂到树的指定位置。
 *
 * 语义（`file-management.md` §2.3 / §5.1）：
 *  - 只有开关打开时才调用本函数（关闭 = 这些项根本不进树）；
 *  - 分组**默认折叠**（调用方把它当作一个未展开的目录）；
 *  - 点在根层（与真实目录同级）——线框里它就在这个位置。
 *
 * 纯函数：不读盘、不改输入。传入的 items 由调用方从**同一次扫描结果**里筛出
 * （不新增扫描）。
 */
export function withOtherFiles(nodes: readonly TreeNode[], items: readonly OtherFileItem[]): TreeNode[] {
  if (items.length === 0) return [...nodes];
  // ① 先把不支持打开的文件从主树里**摘掉**：它们只在分组里出现一次。
  //    不摘会出现同一文件两个入口（主树里一个可拖拽/可右键的行 + 分组里一个灰行），
  //    而主树那个行还会走正常打开路径 —— 与 §2.3「本应用不打开」直接矛盾。
  const stripped = stripUnopenable(nodes);
  const group: TreeNode = {
    type: 'dir',
    key: OTHER_FILES_KEY,
    name: otherFilesLabel(items.length),
    path: '',
    fullPath: OTHER_FILES_KEY,
    ts: 0,
    children: items.map((it) => ({
      type: 'doc' as const,
      key: `otherdoc:${it.fullPath}`,
      name: it.name,
      path: it.path,
      fullPath: it.fullPath,
      ts: 0,
      children: [],
      wsDir: null,
      wsFile: null,
      stale: false,
      entry: null,
      unopenable: true as const,
    })),
    wsDir: null,
    wsFile: null,
    stale: false,
    entry: null,
  };
  // 分组排在真实目录**之后**：它是「顺带列出」的补充信息，不该顶掉主目录的视线
  return [...stripped, group];
}

/**
 * 递归摘除 `unopenable` 节点（含空目录保留语义：只摘文件，目录照旧）。
 * 纯函数：不改输入，返回新数组（未命中时返回原引用，避免无谓重渲染）。
 */
function stripUnopenable(nodes: readonly TreeNode[]): TreeNode[] {
  let changed = false;
  const out: TreeNode[] = [];
  for (const n of nodes) {
    if (n.unopenable === true) {
      changed = true;
      continue;
    }
    if (n.children.length === 0) {
      out.push(n);
      continue;
    }
    const children = stripUnopenable(n.children);
    if (children === n.children) {
      out.push(n);
      continue;
    }
    changed = true;
    out.push({ ...n, children });
  }
  // 未命中时返回原数组的**浅拷贝**（不用 `as` 保留 `readonly` → 可变）：
  // 断言会破坏「零 asCast」的代码预算，而浅拷贝的成本可以忽略
  // （调用方本就要把结果喂给 `filterTree` 生成新数组）。
  return changed ? out : [...nodes];
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
