/**
 * 文件工作台（FA2-T2）—— 从「420px 居中玩具弹窗」升级为专业文档抽屉 / 宽幅工作台。
 *
 * 三种形态：
 *  - `variant='drawer'`：左侧滑出抽屉（320px），像 VS Code 资源管理器；
 *  - `variant='wide'`：沉浸式宽幅模态（680px），适合批量整理。
 *
 * 交互要点：
 *  - 顶部常驻搜索（文件名 / 路径实时过滤，保留目录层级）；
 *  - 真实树：展开折叠记忆、右键菜单（新建导图 / 新建文件夹 / 重命名 / 删除）、
 *    **拖拽文件到文件夹图标**即完成归位 —— 旧版「手动敲路径字符串」的交互已彻底移除；
 *  - 面包屑展示物理路径，状态指示区分 `🟢 本地磁盘已同步` / `📝 未保存`；
 *  - 未挂载工作区时降级为 `DocLibrary` 虚拟目录（同一套树，落点换成 localStorage）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BROWSER_SCOPE_ID,
  CHROME,
  type DocEntry,
  type DocLibrary,
  type WorkspaceDir,
  type WorkspaceFile,
  type WorkspaceNode,
} from '@mindcanvas/react';
import {
  allDirs,
  breadcrumbOf,
  canDropInto,
  filterTree,
  findNode,
  sortTree,
  treeFromLibrary,
  treeFromWorkspace,
  type TreeNode,
} from './fileTreeModel.js';
import { ContextMenu } from './FileManagerContextMenu.js';
import { FlatDocRow, StorageBar, ViewTabs, type FileManagerTab } from './FileManagerChrome.js';
import { FileManagerTree, type FileManagerTreeCtx } from './FileManagerTree.js';
import {
  NEW_DOC_TEMPLATE,
  SEP,
  btnBase,
  collectDocs,
  formatRelative,
  inlineBarStyle,
  inputStyle,
  rowBtn,
  useStarredKeys,
  type MenuState,
} from './fileManagerShared.js';
import {
  type DocIndex,
  type HistoryPoolEntry,
  RECENT_MAX,
  browserDocKey,
  formatHistoryPool,
  formatRecentWhen,
  wsDocKey,
} from './docIndex.js';

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
function workspaceScopePersisted(workspace: WorkspaceLike | null): boolean {
  return workspace?.scopeState?.persisted === true;
}

export interface FileManagerProps {
  library: DocLibrary;
  /**
   * 索引层（P0-D 的唯一索引写入口）。**收藏与「最近」都读它**，
   * `library` 只保留目录树与兼容模式的打开路径（本轮不改旧键读写语义）。
   * 缺省（旧调用方/测试）→ 收藏退化为只读旧键，绝不产生第二写入口。
   */
  index?: DocIndex | null;
  /** 工作区宿主；null = 兼容模式（走 DocLibrary 虚拟目录） */
  workspace: WorkspaceLike | null;
  /** 兼容模式：打开库条目 */
  onOpenEntry: (entry: DocEntry) => void;
  /** 工作区模式：打开真实文件 */
  onOpenFile: (file: WorkspaceFile) => void;
  onCreate: () => void;
  onClose: () => void;
  /** 「打开本地文件夹」→ 触发 showDirectoryPicker 挂载流程 */
  onPickWorkspace?: () => void;
  /** 断开工作区（回到兼容模式） */
  onDetachWorkspace?: () => void;
  /** 当前文档的相对路径（面包屑用） */
  currentPath?: string | null;
  /** 当前文档是否有未保存修改（📝 指示） */
  dirty?: boolean;
  /** 形态：抽屉 / 宽幅模态 */
  variant?: 'drawer' | 'wide';
}

export function FileManager({
  library,
  index = null,
  workspace,
  onOpenEntry,
  onOpenFile,
  onCreate,
  onClose,
  onPickWorkspace,
  onDetachWorkspace,
  currentPath = null,
  dirty = false,
  variant = 'wide',
}: FileManagerProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']));
  const [query, setQuery] = useState('');
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [tab, setTab] = useState<FileManagerTab>('tree');
  /** A-D3：待删除确认目标（内联确认条；替代被 webview 静默吞掉的 window.confirm） */
  const [pendingDelete, setPendingDelete] = useState<TreeNode | null>(null);
  /** A-D3：新建文件夹内联命名目标（替代 window.prompt）；node 供将来在行内锚定输入用 */
  const [namingTarget, setNamingTarget] = useState<{ parentPath: string; node?: TreeNode } | null>(
    null,
  );
  const { starredKeys, toggleStar } = useStarredKeys(index);
  /**
   * 历史池（§6.2.1）：旧记录**没有归属证据**时的落点。默认折叠，展开后可逐条
   * 「关联到此工作区」或「忽略」；用户不处理也不丢（旧键与 `legacyKeys` 都保留）。
   */
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryPoolEntry[]>([]);
  /** 惰性迁移的可见结果：失败条目数（>0 时提示「未迁移」，不伪报完成） */
  const [migrateFailed, setMigrateFailed] = useState(0);

  const [, forceRender] = useState(0);
  const refresh = useCallback((): void => forceRender((n) => n + 1), []);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const useWorkspace = workspace !== null && workspace.mounted;

  /** 载入树：工作区走真实扫描，兼容模式走 DocLibrary */
  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    // P0-D：惰性迁移（分批、幂等、可中断续跑）。**没有一键批量入口**——
    // 每次打开文件面板按批推进；失败条目留在旧库并计数（不伪报完成）。
    //
    // 放在树加载**之前**且各自 try：旧库损坏时 `treeFromLibrary` 会抛，
    // 但「N 条未迁移」这条反馈必须仍然可见（它正是用户唯一能看到的失败信号）。
    if (index) {
      try {
        const migrated = index.migrate({ batch: 64 });
        if (aliveRef.current) {
          setHistory(index.historyPool());
          setMigrateFailed(migrated.failed);
        }
      } catch {
        if (aliveRef.current) setMigrateFailed((n) => Math.max(n, 1));
      }
    }
    try {
      const next = useWorkspace && workspace
        ? treeFromWorkspace(await workspace.scan(true))
        : treeFromLibrary(library);
      if (aliveRef.current) {
        // 树里的文档补上索引身份（「最近」与收藏要按稳定身份认，见 docKeyOfEntry）
        setTree(sortTree(next));
        void refreshIndexDocs(collectDocs(next));
      }
    } catch (e) {
      if (aliveRef.current) setError(e instanceof Error ? e.message : '扫描工作区失败');
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [useWorkspace, workspace, library, index]);

  /**
   * 把树里的文档登记进索引（**不推进任何时间**，只建立身份）。
   *
   * 为什么不在打开时统一推进 `openedAt`：`openedAt` 的语义是**用户真的打开了它**
   * （UD-2），扫树/刷新面板不算打开。真实的打开动作在 `onOpenEntry` / `onOpenFile`
   * 里推进（见 `markOpened`），这里只保证条目存在、身份可认。
   */
  const refreshIndexDocs = useCallback(
    async (docs: readonly TreeNode[]): Promise<void> => {
      if (!index) return;
      const scopeId = useWorkspace && workspace?.scopeId ? workspace.scopeId : null;
      const persisted = workspaceScopePersisted(workspace);
      for (const d of docs) {
        const docKey = docKeyOfEntry(d, scopeId);
        index.registerDoc({
          docKey,
          relPath: d.fullPath,
          name: d.name,
          scopeId: scopeId ?? 'browser:local',
          persisted,
          sourceRef: d.wsFile ? { kind: 'disk-handle' } : { kind: 'none' },
        });
      }
      if (aliveRef.current) {
        setHistory(index.historyPool());
        // 索引是**可变对象**（不是 React state）：登记后必须显式触发重渲染，
        // 否则「最近」/「收藏」两个视图仍用旧的 memo 结果，表现为「面板里空着」。
        refresh();
      }
    },
    [index, useWorkspace, workspace, refresh],
  );

  /** 用户**真的打开**了某文档：推进 `openedAt`（「最近」的唯一排序依据） */
  const markOpened = useCallback(
    (docKey: string, relPath: string | null, name: string): void => {
      if (!index) return;
      index.openDoc({ docKey, relPath, name });
      setHistory(index.historyPool());
      refresh();
    },
    [index, refresh],
  );

  // 首次挂载 + 工作区挂载状态变化时重新载入
  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useMemo(() => filterTree(tree, query), [tree, query]);

  const toggle = (key: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const closeMenu = useCallback((): void => setMenu(null), []);

  // ---------------------------------------------------------------- 操作

  /** 新建导图：工作区落到目标目录；兼容模式走上层 onCreate */
  const createDocIn = async (dirPath: string): Promise<void> => {
    if (useWorkspace && workspace) {
      await workspace.createFile(dirPath, '未命名.mm.md', NEW_DOC_TEMPLATE);
      await reload();
      return;
    }
    onCreate();
  };

  const createDirIn = async (parentPath: string, name: string): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (useWorkspace && workspace) {
      await workspace.createDir(parentPath, trimmed);
      await reload();
      return;
    }
    // 兼容模式：直接维护本地自定义目录集合
    const full = parentPath === '' ? trimmed : `${parentPath}/${trimmed}`;
    library.addFolder(full);
    await reload();
  };

  /** A-D3：删除确认入口——置入待确认目标（window.confirm 在 webview 会被静默吞掉） */
  const confirmTarget = (node: TreeNode): void => setPendingDelete(node);

  /** 删除主体（确认条点「删除」后调用；逻辑与拆分前逐行一致） */
  const doRemove = async (node: TreeNode): Promise<void> => {
    setPendingDelete(null);
    if (useWorkspace && workspace) {
      if (node.type === 'dir' && node.wsDir) await workspace.removeDir(node.wsDir);
      if (node.type === 'doc' && node.wsFile) await workspace.removeFile(node.wsFile);
      await reload();
      return;
    }
    if (node.type === 'dir') {
      library.removeFolder(node.fullPath);
      await reload();
      return;
    }
    if (node.entry) library.remove(node.entry.id);
    await reload();
  };

  const commitRename = async (node: TreeNode, nextName: string): Promise<void> => {
    const name = nextName.trim();
    setRenamingKey(null);
    if (name === '' || name === node.name) return;
    if (useWorkspace && workspace) {
      if (node.type === 'doc' && node.wsFile) await workspace.renameFile(node.wsFile, name);
      await reload();
      return;
    }
    if (node.entry) library.rename(node.entry.id, name);
    refresh();
  };

  /** 拖拽归位：落到目标目录（取代旧版「手敲路径字符串」） */
  const dropInto = async (node: TreeNode, target: TreeNode): Promise<void> => {
    setDropTarget(null);
    if (!canDropInto(node.key, target.fullPath, tree)) return;
    if (useWorkspace && workspace) {
      if (node.type === 'doc' && node.wsFile) await workspace.moveFile(node.wsFile, target.fullPath);
      await reload();
      return;
    }
    if (node.entry) library.move(node.entry.id, target.fullPath);
    refresh();
  };

  // ---------------------------------------------------------------- 渲染

  const menuNode = menu ? findNode(tree, menu.key) : null;
  const widths = variant === 'drawer' ? 320 : 680;

  const allDocs = useMemo(() => collectDocs(tree), [tree]);

  /** 打开入口的唯一包装：**推进 `openedAt`**（真实打开才推进，UD-2） */
  const openNode = useCallback(
    (node: TreeNode): void => {
      if (index) {
        const scopeId = useWorkspace && workspace?.scopeId ? workspace.scopeId : null;
        markOpened(docKeyOfEntry(node, scopeId), node.fullPath, node.name);
      }
      if (node.wsFile) onOpenFile(node.wsFile);
      else if (node.entry) onOpenEntry(node.entry);
    },
    [index, useWorkspace, workspace, markOpened, onOpenFile, onOpenEntry],
  );

  const treeCtx: FileManagerTreeCtx = {
    tree,
    expanded,
    query,
    dropTarget,
    dragKey,
    renamingKey,
    starredKeys,
    toggle,
    setDropTarget,
    setDragKey,
    setMenu,
    dropInto,
    commitRename,
    setRenamingKey,
    toggleStar,
    onOpenFile: (file) => {
      const node = allDocs.find((d) => d.wsFile === file);
      if (node) openNode(node);
      else onOpenFile(file);
    },
    onOpenEntry: (entry) => {
      const node = allDocs.find((d) => d.entry === entry);
      if (node) openNode(node);
      else onOpenEntry(entry);
    },
  };

  /** 树节点查询（「最近」/「收藏」两个视图共用） */
  const matchQuery = useCallback(
    (rows: readonly TreeNode[]): TreeNode[] => {
      if (!query.trim()) return [...rows];
      const q = query.trim().toLowerCase();
      return rows.filter(
        (d) => d.name.toLowerCase().includes(q) || d.fullPath.toLowerCase().includes(q),
      );
    },
    [query],
  );

  /**
   * 「最近」：**唯一入口**，按 `openedAt` 降序（索引层的 `compareRecent`），
   * `openedAt === null` 排末尾并显示「未记录打开时间」——**不回落 mtime**（UD-2）。
   *
   * 无索引（旧调用方）时退化为按树里的 `ts` 排序，仅用于保持旧测试/降级可用；
   * 生产路径由 MindmapStage 注入索引，走上面那条。
   */
  const recentRows = useMemo(() => {
    if (!index) {
      return matchQuery([...allDocs].sort((a, b) => b.ts - a.ts)).map((d) => ({
        key: d.key,
        node: d,
        when: formatRelative(d.ts),
        starred: starredKeys.has(d.fullPath) || starredKeys.has(d.key),
        starKey: d.fullPath || d.key,
      }));
    }
    const nodes = new Map(allDocs.map((d) => [d.key, d]));
    return index
      .recentDocs(RECENT_MAX)
      .flatMap((e) => {
        const node =
          nodes.get(`doc:${e.relPath ?? ''}`) ??
          nodes.get(`doc:${e.docKey}`) ??
          (e.relPath !== null ? nodes.get(`doc:${e.relPath}`) : undefined);
        if (!node) return []; // 索引里有、当前树里没有（已删/别的作用域）→ 不在本视图展示
        return [
          {
            key: node.key,
            node,
            when: formatRecentWhen(e.openedAt),
            starred: e.starred || starredKeys.has(node.fullPath) || starredKeys.has(node.key),
            starKey: node.fullPath || node.key,
          },
        ];
      })
      .filter((r) => matchQuery([r.node]).length > 0);
  }, [index, allDocs, matchQuery, starredKeys]);

  /** 收藏：按索引的稳定身份判定（`docKey` / `relPath` / 旧键三个别名都认） */
  const starredRows = useMemo(() => {
    const list = allDocs
      .filter((d) => starredKeys.has(d.fullPath) || starredKeys.has(d.key))
      .sort((a, b) => b.ts - a.ts);
    return matchQuery(list).map((d) => ({
      key: d.key,
      node: d,
      when: formatRelative(d.ts),
      starred: true,
      starKey: d.fullPath || d.key,
    }));
  }, [allDocs, starredKeys, matchQuery]);

  return (
    <div
      data-file-manager
      data-variant={variant}
      style={{
        width: widths,
        maxHeight: variant === 'drawer' ? '100%' : '76vh',
        display: 'flex',
        flexDirection: 'column',
        background: CHROME.bg,
        border: `1px solid ${CHROME.panelBorder}`,
        borderRadius: CHROME.radius,
        boxShadow: CHROME.shadow,
        color: CHROME.text,
        fontFamily: CHROME.fontFamily,
        fontSize: CHROME.fontSize,
        overflow: 'hidden',
      }}
    >
      {/* 头部：标题 + 操作 + 关闭 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 14px',
          borderBottom: `1px solid ${CHROME.panelBorder}`,
        }}
      >
        <span style={{ fontWeight: 600 }}>文件工作台</span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          data-fm-new-folder
          style={btnBase}
          onClick={() => setNamingTarget({ parentPath: '' })}
        >
          📁 新建文件夹
        </button>
        <button
          type="button"
          data-fm-new-doc
          style={{
            ...btnBase,
            borderColor: CHROME.neon,
            color: CHROME.neon,
          }}
          onClick={() => {
            setMenu(null);
            void createDocIn('');
          }}
        >
          ＋ 新建导图
        </button>
        <button
          type="button"
          data-fm-close
          style={btnBase}
          onClick={onClose}
        >
          关闭
        </button>
      </div>

      <StorageBar
        mounted={useWorkspace}
        name={workspace?.name ?? null}
        onPick={onPickWorkspace}
        onDetach={onDetachWorkspace}
      />

      <ViewTabs tab={tab} starredCount={starredKeys.size} onChange={setTab} />

      {/* 搜索：文件名 / 路径实时过滤 */}
      <div style={{ padding: '8px 12px' }}>
        <input
          data-fm-search
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索文件名或路径…"
          style={{ ...inputStyle(), width: '100%', boxSizing: 'border-box' }}
        />
      </div>

      {/* 面包屑 + 当前文档状态 */}
      <div
        data-fm-breadcrumb
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '0 12px 8px',
          fontSize: CHROME.fontSizeSmall,
          color: CHROME.textMuted,
          flexWrap: 'wrap',
        }}
      >
        {useWorkspace && <span>📁 {workspace?.name}</span>}
        {breadcrumbOf(currentPath).map((seg, i) => (
          <span key={`${i}-${seg}`}>
            <span style={{ opacity: 0.6 }}> › </span>
            <span style={{ color: CHROME.text }}>{seg}</span>
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <span data-doc-status style={{ color: dirty ? CHROME.warn : CHROME.neon }}>
          {dirty ? '📝 未保存' : currentPath ? '🟢 本地磁盘已同步' : ''}
        </span>
      </div>

      {/* A-D3：删除内联确认条（替代 window.confirm——webview 下会被静默吞掉） */}
      {pendingDelete !== null && (
        <div
          data-fm-confirm
          style={{
            ...inlineBarStyle,
            border: `1px solid ${CHROME.warn}`,
            background: 'rgba(226,75,74,0.08)',
          }}
        >
          <span style={{ flex: 1 }}>
            删除{pendingDelete.type === 'dir' ? `文件夹「${pendingDelete.name}」及其全部内容` : `文件「${pendingDelete.name}」`}？{' '}
            <span style={{ color: CHROME.textMuted }}>
              （{useWorkspace ? '会真实删除磁盘文件' : '所含文档将退回根目录'}）
            </span>
          </span>
          <button
            type="button"
            data-fm-confirm-ok
            style={{ ...btnBase, borderColor: CHROME.warn, color: CHROME.warn }}
            onClick={() => void doRemove(pendingDelete)}
          >
            删除
          </button>
          <button
            type="button"
            data-fm-confirm-cancel
            style={btnBase}
            onClick={() => setPendingDelete(null)}
          >
            取消
          </button>
        </div>
      )}

      {/* A-D3：新建文件夹内联命名（替代 window.prompt；Enter 提交 / Esc 取消） */}
      {namingTarget !== null && (
        <div
          data-fm-name
          style={{ ...inlineBarStyle, border: `1px solid ${CHROME.panelBorderStrong}` }}
        >
          <span style={{ color: CHROME.textMuted, whiteSpace: 'nowrap' }}>
            新建文件夹{namingTarget.parentPath === '' ? '' : `于「${namingTarget.parentPath}」`}：
          </span>
          <input
            autoFocus
            data-fm-name-input
            defaultValue="新文件夹"
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') {
                const name = ev.currentTarget.value;
                setNamingTarget(null);
                void createDirIn(namingTarget.parentPath, name);
              }
              if (ev.key === 'Escape') setNamingTarget(null);
            }}
            style={inputStyle()}
          />
        </div>
      )}

      {error && (
        <div
          style={{
            margin: '0 12px 8px',
            padding: '6px 8px',
            borderRadius: 6,
            border: `1px solid ${CHROME.warn}`,
            color: CHROME.warn,
            fontSize: CHROME.fontSizeSmall,
          }}
        >
          {error}
        </div>
      )}

      {/* 树状 / 平铺内容区域 */}
      <div data-fm-tree style={{ overflow: 'auto', flex: 1, padding: '2px 0 8px' }}>
        {loading ? (
          <div style={{ padding: 20, textAlign: 'center', color: CHROME.textMuted }}>扫描中…</div>
        ) : tab === 'tree' ? (
          filtered.length === 0 ? (
            <div style={{ padding: '28px 12px', textAlign: 'center', color: CHROME.textMuted }}>
              {query !== '' ? `没有匹配「${query}」的文件。` : '还没有文档。点「＋ 新建导图」开始。'}
            </div>
          ) : (
            <FileManagerTree nodes={filtered} depth={0} ctx={treeCtx} />
          )
        ) : tab === 'recent' ? (
          recentRows.length === 0 ? (
            <div style={{ padding: '28px 12px', textAlign: 'center', color: CHROME.textMuted }}>
              {query !== '' ? `没有匹配「${query}」的文件。` : '暂无最近打开的文档。'}
            </div>
          ) : (
            recentRows.map(({ key, node, when, starred, starKey }) => (
              <FlatDocRow
                key={key}
                name={node.name}
                path={node.path}
                when={when}
                starred={starred}
                onToggleStar={(e) => toggleStar(starKey, e)}
                onOpen={() => openNode(node)}
              />
            ))
          )
        ) : starredRows.length === 0 ? (
          <div style={{ padding: '28px 12px', textAlign: 'center', color: CHROME.textMuted }}>
            {query !== '' ? `没有匹配「${query}」的收藏。` : '暂无收藏导图。在文档条目上点击 ☆ 即可加入收藏。'}
          </div>
        ) : (
          starredRows.map(({ key, node, when, starKey }) => (
            <FlatDocRow
              key={key}
              name={node.name}
              path={node.path}
              when={when}
              starred
              onToggleStar={(e) => toggleStar(starKey, e)}
              onOpen={() => openNode(node)}
            />
          ))
        )}
      </div>

      {/*
        §6.2.1 历史池：**用户语言**呈现（不暴露「索引」「作用域」这类内部概念）。
        默认折叠；展开后可逐条「关联到此工作区」或「忽略」。
        没有归属证据的旧记录**不自动绑定**，但用户不处理也不丢（旧键原样保留）。
      */}
      {index && history.length > 0 && (
        <div
          data-fm-history
          style={{
            borderTop: `1px solid ${CHROME.panelBorder}`,
            padding: '6px 12px',
            fontSize: CHROME.fontSizeSmall,
            color: CHROME.textMuted,
          }}
        >
          <button
            type="button"
            data-fm-history-toggle
            style={{ ...rowBtn, color: CHROME.textMuted }}
            onClick={() => setHistoryOpen((v) => !v)}
          >
            <span>{historyOpen ? '▾' : '▸'}</span>
            <span>{formatHistoryPool(history.length)}</span>
          </button>
          {historyOpen && (
            <div data-fm-history-list style={{ paddingLeft: 14 }}>
              {history.map((h) => (
                <div
                  key={`${h.kind}:${h.key}`}
                  data-fm-history-row
                  data-history-key={h.key}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}
                >
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {h.name}
                  </span>
                  <span style={{ flex: 'none' }}>
                    {formatRecentWhen(h.openedAt)}
                  </span>
                  <button
                    type="button"
                    data-fm-history-link
                    style={btnBase}
                    onClick={() => {
                      const scopeId = useWorkspace && workspace?.scopeId ? workspace.scopeId : null;
                      const target =
                        allDocs.find((d) => d.fullPath === h.key) ??
                        allDocs.find((d) => d.name === h.name);
                      if (!target || !index) return;
                      index.relink(h.key, docKeyOfEntry(target, scopeId));
                      setHistory(index.historyPool());
                    }}
                  >
                    关联到此工作区
                  </button>
                  <button
                    type="button"
                    data-fm-history-ignore
                    style={btnBase}
                    onClick={() => {
                      index.ignoreLegacy(h.key);
                      setHistory(index.historyPool());
                    }}
                  >
                    忽略
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 迁移失败可见：不把「未迁移」伪报成完成（逐条 try/catch 的失败计数） */}
      {index && migrateFailed > 0 && (
        <div
          data-fm-migrate-failed
          style={{
            margin: '0 12px 8px',
            padding: '6px 8px',
            borderRadius: 6,
            border: `1px solid ${CHROME.warn}`,
            color: CHROME.warn,
            fontSize: CHROME.fontSizeSmall,
          }}
        >
          {migrateFailed} 条旧记录本次未迁移（已保留在原位置，下次打开会再试）。
        </div>
      )}

      <div
        style={{
          padding: '8px 12px',
          borderTop: `1px solid ${CHROME.panelBorder}`,
          fontSize: CHROME.fontSizeSmall,
          color: CHROME.textMuted,
        }}
      >
        拖拽文件到 📁 文件夹即可归位 · 右键文件/文件夹可新建、重命名、删除
      </div>

      {/* 右键菜单 */}
      {menu && menuNode && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          isDir={menuNode.type === 'dir'}
          onClose={closeMenu}
          onNewDoc={() => void createDocIn(menuNode.type === 'dir' ? menuNode.fullPath : menuNode.path)}
          onNewDir={() => {
            closeMenu();
            setNamingTarget({
              parentPath: menuNode.type === 'dir' ? menuNode.fullPath : menuNode.path,
            });
          }}
          onRename={() => {
            closeMenu();
            setRenamingKey(menu.key);
          }}
          onDelete={() => {
            closeMenu();
            confirmTarget(menuNode);
          }}
        />
      )}
    </div>
  );
}

/** 供外部（MindmapStage）计算「移动到」候选目录 */
export { allDirs };
export { SEP };
export { NEW_DOC_TEMPLATE, formatRelative };
