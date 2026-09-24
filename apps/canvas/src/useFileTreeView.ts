/**
 * 文件工作台**树视图状态**（P1-A ①②③④⑤）—— 从 `FileManager.tsx` 拆出。
 *
 * 拆分动因：`FileManager.tsx` 现 561 行、`bigFiles` 顶格（4/4），而本轮要加的五项
 * （当前文档高亮、标题搜索、排序依据、roving tabindex、显示其他文件）全部是
 * **树视图的呈现状态**，与「当前文档文件操作编排」（`useFileManagerRouting`）
 * 没有交集。留在主组件里必然破预算（派单书 §3.9）。
 *
 * 边界：本 hook **不**做 I/O、不触碰索引写入、不持有树数据本身（树由调用方载入
 * 并经 `tree` 传进来）。它只回答「树该怎么呈现」。
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  OTHER_FILES_KEY,
  SORT_LABEL,
  filterTree,
  findNode,
  sortTree,
  withOtherFiles,
  type OtherFileItem,
  type SortMode,
  type TreeNode,
} from './fileTreeModel.js';
import {
  intentFor,
  reconcileFocus,
  visibleRows as flattenVisible,
  type VisibleRow,
} from './fileTreeKeyboard.js';
import type { DocIndex, DocIndexEntry } from './docIndex.js';

export interface TreeViewOptions {
  /** 已载入的树（工作区扫描 / DocLibrary 虚拟目录） */
  tree: readonly TreeNode[];
  /** 索引层（②标题搜索读它的 `title`；null → 标题搜索不生效） */
  index: DocIndex | null;
  /** 当前文档完整路径（①高亮与状态行） */
  currentPath: string | null;
}

export interface TreeView {
  query: string;
  setQuery: (q: string) => void;
  sortMode: SortMode;
  setSortMode: (m: SortMode) => void;
  /** 排序依据的显示名（列头/工具条写明依据，§6） */
  sortLabel: string;
  showOtherFiles: boolean;
  setShowOtherFiles: (v: boolean) => void;
  /** 不支持打开的文件项数（分组标题用；0 → 不渲染分组） */
  otherFileCount: number;
  /** 已施加排序 + 其他文件分组 + 搜索过滤的树（渲染直接消费） */
  viewTree: TreeNode[];
  /** 仅在「全部目录」视图生效的提示（供空态文案判断） */
  hasQuery: boolean;
  expanded: ReadonlySet<string>;
  setExpanded: (key: string, open: boolean) => void;
  toggle: (key: string) => void;
  /** ④ roving tabindex */
  focusedKey: string | null;
  setFocusedKey: (key: string) => void;
  focusRow: (key: string) => void;
  visibleRows: () => VisibleRow[];
  /** 行 DOM 注册（roving tabindex 的「真的聚焦」那一半） */
  registerRow: (key: string, el: HTMLElement | null) => void;
  keyIntent: (key: string, rows: readonly VisibleRow[]) => ReturnType<typeof intentFor>;
  /** ① 当前文档节点（在 viewTree 里按完整路径找） */
  currentNode: TreeNode | null;
}

/**
 * 树视图状态 hook。
 *
 * **扩展 `expanded` 的既有语义**（「其他文件」分组的展开态也记在同一个 Set 里）：
 * 为什么复用而不是另开一个 state：分组的折叠/展开与目录**是同一件事**，
 * 分成两份状态就会出现「搜索时分组被强制展开、搜索后退回旧值」这类两套真值不一致。
 * 保留 key 带 `\u0000`，与真实路径不可能相撞。
 */
export function useFileTreeView(opts: TreeViewOptions): TreeView {
  const { tree, index, currentPath } = opts;
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('name');
  const [showOtherFiles, setShowOtherFiles] = useState(false);
  const [expanded, setExpandedRaw] = useState<Set<string>>(() => new Set(['']));
  const [focusedKey, setFocusedKeyRaw] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());

  const setExpanded = useCallback((key: string, open: boolean): void => {
    setExpandedRaw((prev) => {
      const next = new Set(prev);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const toggle = useCallback(
    (key: string): void => {
      setExpandedRaw((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    [],
  );

  /**
   * ② 标题搜索：把索引层**既有**的 `title` 贴到节点上（不新扫描、不读盘）。
   *
   * 一次性 O(n) 建表（索引条目数 ≤ 树里文档数），避免在 `filterTree` 的递归里
   * 对每个节点做一次线性查找（那会把搜索变成 O(n²)）。
   */
  const titlesByPath = useMemo((): Map<string, string> => {
    const out = new Map<string, string>();
    if (!index) return out;
    const docs: DocIndexEntry[] = index.listDocs();
    for (const e of docs) {
      if (e.relPath !== null && typeof e.title === 'string' && e.title !== '') {
        out.set(e.relPath, e.title);
      }
    }
    return out;
  }, [index]);

  /** ⑤ 扫描结果里被排除的项（`unopenable`），按开关决定是否成组 */
  const otherFiles = useMemo((): OtherFileItem[] => {
    const out: OtherFileItem[] = [];
    const walk = (nodes: readonly TreeNode[]): void => {
      for (const n of nodes) {
        if (n.unopenable === true) out.push({ fullPath: n.fullPath, name: n.name, path: n.path });
        if (n.children.length > 0) walk(n.children);
      }
    };
    walk(tree);
    return out;
  }, [tree]);

  /**
   * 树 → 呈现（③排序 → ②标题贴附 → ⑤其他文件 → ②搜索过滤）。
   *
   * 顺序有讲究：排序必须在**过滤前**（过滤保留祖先链，先过滤会改变同级集合，
   * 让排序在子集上算一遍、在全集上又不一样）。贴标题在过滤前（过滤要读它）。
   */
  const viewTree = useMemo((): TreeNode[] => {
    const withTitles = titlesByPath.size === 0 ? tree : attachTitles(tree, titlesByPath);
    // 排序对**副本**做（sortTree 原地改数组；直接改会污染 tree 的引用比较）
    const sorted = sortTree(cloneTree(withTitles), sortMode);
    // ⑤ 分组**只在开关打开时**才挂进树：关闭时这些项根本不出现
    // （`file-management.md` §2.3 的「开关打开后灰显列出」是唯一入口）
    const grouped = showOtherFiles ? withOtherFiles(sorted, otherFiles) : sorted;
    // 分组默认折叠：搜索期强制展开（与目录同一规则），其余按 expanded 判定
    return filterTree(grouped, query);
  }, [tree, titlesByPath, sortMode, otherFiles, showOtherFiles, query]);

  /**
   * ④ 可见行展平。搜索期所有目录视为展开（与渲染同一条规则：
   * `open = expanded.has(key) || query !== ''`）——两处必须同源，
   * 否则键盘能走到看不见的行（或走不到看得见的行）。
   */
  const visibleRows = useCallback((): VisibleRow[] => {
    const effective =
      query.trim() === ''
        ? expanded
        : new Set([...expanded, ...collectDirKeys(viewTree)]);
    return flattenVisible(viewTree, effective);
  }, [viewTree, expanded, query]);

  const keyIntent = useCallback(
    (key: string, rows: readonly VisibleRow[]) =>
      intentFor(key, { rows, focusedKey, inRenameInput: false }),
    [focusedKey],
  );

  /** 焦点行 DOM 引用：roving tabindex 的另一半（状态改了还要真的聚焦） */
  const focusRow = useCallback((key: string): void => {
    const el = rowRefs.current.get(key);
    if (el) el.focus();
  }, []);

  const registerRow = useCallback((key: string, el: HTMLElement | null): void => {
    if (el === null) rowRefs.current.delete(key);
    else rowRefs.current.set(key, el);
  }, []);

  const setFocusedKey = useCallback((key: string): void => setFocusedKeyRaw(key), []);

  /**
   * 焦点收敛：节点消失（删除/移动/折叠）时把焦点挪到邻近行，
   * 绝不留下「全树 tabIndex 都是 -1」的死状态（键盘用户会彻底失去入口）。
   */
  const rows = visibleRows();
  const prevRowsRef = useRef<readonly VisibleRow[]>(rows);
  const reconciled = reconcileFocus(rows, focusedKey, prevRowsRef.current);
  prevRowsRef.current = rows;
  if (reconciled !== focusedKey && reconciled !== null) {
    // 渲染期直接改：这是**派生**状态（焦点归属），不是用户事件的结果；
    // 用 effect 会让「已消失的焦点」多存在一帧，键盘用户会看到闪烁的假高亮。
    setFocusedKeyRaw(reconciled);
  }

  const currentNode = useMemo((): TreeNode | null => {
    if (currentPath === null) return null;
    const hit = findNode(viewTree, `doc:${currentPath}`);
    return hit;
  }, [viewTree, currentPath]);

  return {
    query,
    setQuery,
    sortMode,
    setSortMode,
    sortLabel: SORT_LABEL[sortMode],
    showOtherFiles,
    setShowOtherFiles,
    otherFileCount: otherFiles.length,
    viewTree,
    hasQuery: query.trim() !== '',
    expanded,
    setExpanded,
    toggle,
    focusedKey: reconciled,
    setFocusedKey,
    focusRow,
    visibleRows,
    registerRow,
    keyIntent,
    currentNode,
  };
}

/** 浅克隆树（避免 `sortTree` 原地排序污染载入的树引用） */
function cloneTree(nodes: readonly TreeNode[]): TreeNode[] {
  return nodes.map((n) => ({ ...n, children: cloneTree(n.children) }));
}

/** 把索引里的 `title` 贴到对应文档节点（按 `relPath` 命中；缺省不改） */
function attachTitles(nodes: readonly TreeNode[], titles: ReadonlyMap<string, string>): TreeNode[] {
  return nodes.map((n) => {
    const title = n.type === 'doc' ? titles.get(n.fullPath) : undefined;
    const children = n.children.length > 0 ? attachTitles(n.children, titles) : n.children;
    if (title === undefined && children === n.children) return n;
    return { ...n, children, ...(title === undefined ? {} : { title }) };
  });
}

/** 全部目录 key（搜索期强制展开用） */
function collectDirKeys(nodes: readonly TreeNode[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (n.type !== 'dir') continue;
    // 「其他文件」分组不被搜索强制展开：它不是目录，是提示性分组
    if (n.key !== OTHER_FILES_KEY) out.push(n.key);
    out.push(...collectDirKeys(n.children));
  }
  return out;
}
