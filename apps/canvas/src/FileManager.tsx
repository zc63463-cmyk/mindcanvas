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
import { CHROME, type DocEntry, type DocLibrary, type WorkspaceFile } from '@mindcanvas/react';
import {
  allDirs,
  breadcrumbOf,
  filterTree,
  findNode,
  sortTree,
  treeFromLibrary,
  treeFromWorkspace,
  type TreeNode,
} from './fileTreeModel.js';
import { ContextMenu } from './FileManagerContextMenu.js';
import { StorageBar, ViewTabs, type FileManagerTab } from './FileManagerChrome.js';
import {
  FlatDocList,
  HistoryPool,
  MigrateFailedNotice,
  ProjectionFailureNotice,
} from './FileManagerViews.js';
import {
  buildTreeCtx,
  docKeyOfEntry,
  nodeIndex,
  rowFromIndexEntry,
  rowFromNode,
  type WorkspaceLike,
} from './FileManagerWiring.js';
import { useIndexWiring } from './useIndexWiring.js';
import { useFileTreeOps } from './useFileTreeOps.js';
import {
  FileOpNotice,
  PartialSuccessPanel,
  RenameConflictPanel,
  RenameDirtyPanel,
  type PartialChoice,
  type RenameConflictChoice,
  type RenameDirtyChoice,
} from './FileOpPanels.js';

// 既有调用方（FileManagerModal / 测试）从这里取这些符号：保持在原位置可见，
// 拆分只搬家不改进口（否则所有消费点都要改路径，纯属噪音）。
export type { WorkspaceLike } from './FileManagerWiring.js';
export { docKeyOfEntry } from './FileManagerWiring.js';
import { FileManagerTree, type FileManagerTreeCtx } from './FileManagerTree.js';
import {
  NEW_DOC_TEMPLATE,
  SEP,
  btnBase,
  collectDocs,
  formatRelative,
  inlineBarStyle,
  inputStyle,
  useStarredKeys,
  type MenuState,
} from './fileManagerShared.js';
import { type DocIndex, RECENT_MAX } from './docIndex.js';

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
  /**
   * P0-A：当前文档的文件操作（改名/移动/删除/副本）。缺省 undefined → 面板只做树操作，
   * 不使用租约与目的地重绑（旧调用方/测试零改动）。
   */
  currentDocOps?: CurrentDocOps | null;
}

/**
 * P0-A：当前文档操作面（由 `useFileOpController` + `useCurrentDocDeleteFlow` 组装）。
 *
 * 为什么用「回调包」而不是把 hook 塞进面板：面板只该渲染，不该知道租约/目的地。
 */
export interface CurrentDocOps {
  /** 当前文档的相对路径（判断「是不是当前文档」） */
  currentPath: string | null;
  /** UI 待决状态（三块面板 + 提示） */
  ui: {
    dirtyChoice: { name: string; apply: (choice: RenameDirtyChoice) => void } | null;
    partial:
      | {
          createdPath: string;
          sourcePath: string;
          reason: string;
          copyHasNewChanges: boolean;
          apply: (choice: PartialChoice) => void;
        }
      | null;
    notice: string | null;
  };
  /** 改名（含冲突三选：目标已存在时由面板先问，再带 overwrite 重入） */
  rename(file: WorkspaceFile, nextName: string, overwrite?: boolean): Promise<void>;
  /** 移动 */
  move(file: WorkspaceFile, targetDir: string): Promise<void>;
  /** 创建副本 */
  duplicate(file: WorkspaceFile): Promise<void>;
  /** 删除（F2 流程，含确认条） */
  delete(file: WorkspaceFile): Promise<void>;
  /** 冲突三选：先算「保留两份」的名字 */
  resolveConflictName(dirPath: string, name: string): Promise<string>;
  dismissNotice(): void;
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
  currentDocOps = null,
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
  /** P0-A：改名冲突三选（目标已存在）；null = 无冲突 */
  const [conflict, setConflict] = useState<{
    file: WorkspaceFile;
    dirPath: string;
    name: string;
    keepBothName: string;
    /** 带最终名重入（`overwrite=true` 表示用户选了「替换目标文件」） */
    reapply: (name: string, overwrite: boolean) => void;
  } | null>(null);
  /** A-D3：新建文件夹内联命名目标（替代 window.prompt）；node 供将来在行内锚定输入用 */
  const [namingTarget, setNamingTarget] = useState<{ parentPath: string; node?: TreeNode } | null>(
    null,
  );
  const { starredKeys, toggleStar } = useStarredKeys(index);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const useWorkspace = workspace?.mounted === true;

  // P0-D：索引接线（迁移 / 登记 / 打开推进 openedAt / 历史池与未迁移反馈）
  const {
    history,
    migrateFailed,
    projectionFailed,
    historyOpen,
    setHistoryOpen,
    runMigration,
    registerDocs,
    markOpened,
    refresh,
  } = useIndexWiring(index, { useWorkspace, workspace, alive: aliveRef });

  /** 载入树：工作区走真实扫描，兼容模式走 DocLibrary */
  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    // P0-D：惰性迁移（分批、幂等、可中断续跑）。**没有一键批量入口**——
    // 每次打开文件面板按批推进；失败条目留在旧库并计数（不伪报完成）。
    //
    // 放在树加载**之前**且各自 try：旧库损坏时 `treeFromLibrary` 会抛，
    // 但「N 条未迁移」这条反馈必须仍然可见（它正是用户唯一能看到的失败信号）。
    if (index) runMigration();
    try {
      const next = useWorkspace && workspace
        ? treeFromWorkspace(await workspace.scan(true))
        : treeFromLibrary(library);
      if (aliveRef.current) {
        // 树里的文档补上索引身份（「最近」与收藏要按稳定身份认，见 docKeyOfEntry）
        setTree(sortTree(next));
        registerDocs(collectDocs(next));
      }
    } catch (e) {
      if (aliveRef.current) setError(e instanceof Error ? e.message : '扫描工作区失败');
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [useWorkspace, workspace, library, index, runMigration, registerDocs]);

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
  // 新建/删除/重命名/拖拽归位的实现集中在 `useFileTreeOps`：
  // 工作区模式落真实磁盘句柄，兼容模式落 DocLibrary 虚拟目录，两条分支的
  // 差别只在这里；渲染层只拿回调。
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

  const { createDocIn, createDirIn, doRemove, commitRename, dropInto, confirmTarget } =
    useFileTreeOps({
      library,
      workspace,
      useWorkspace,
      tree,
      onCreate,
      reload,
      refresh,
      setDropTarget,
      setRenamingKey,
      setPendingDelete,
    });

  // ---------------------------------------------------------------- P0-A：当前文档操作路由
  //
  // 为什么在这里分流（而不是让 useFileTreeOps 全部改走 *Safe）：只有**当前文档**需要
  // 租约、I-14 前置与目的地重绑；其他节点的普通操作保持既有语义不变
  // （既有用例对它们有断言，见 acceptance §4「必须一起核对的既有断言边界」）。
  const isCurrentDoc = useCallback(
    (file: WorkspaceFile): boolean => currentDocOps !== null && currentDocOps.currentPath === file.path,
    [currentDocOps],
  );

  /** 改名/Save 的统一入口：冲突三选由面板先问，再带 overwrite 重入 */
  const requestRename = useCallback(
    (file: WorkspaceFile, name: string): void => {
      if (currentDocOps === null || !isCurrentDoc(file)) {
        const node = allDocs.find((d) => d.wsFile === file);
        if (node) void commitRename(node, name);
        return;
      }
      void (async () => {
        const dirPath = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
        const keepBoth = await currentDocOps.resolveConflictName(dirPath, name);
        if (keepBoth === name) {
          // 无冲突：直接改名
          void currentDocOps.rename(file, name);
          return;
        }
        // 目标已存在 → 冲突三选（不静默加序号、不静默覆盖，§5.2②）
        setConflict({
          file,
          dirPath,
          name,
          keepBothName: keepBoth,
          reapply: (finalName, overwrite) => void currentDocOps.rename(file, finalName, overwrite),
        });
      })();
    },
    [currentDocOps, isCurrentDoc, commitRename, allDocs],
  );

  const keepBothResolved = conflict?.keepBothName ?? '';
  const onConflictChoose = useCallback(
    (choice: RenameConflictChoice): void => {
      const current = conflict;
      setConflict(null);
      if (current === null || choice === 'cancel') return; // 取消 → 零 I/O
      // 「保留两份」→ 用序号名且不覆盖；「替换目标文件」→ 原名 + overwrite
      if (choice === 'keep-both') current.reapply(keepBothResolved, false);
      else current.reapply(current.name, true);
    },
    [conflict, keepBothResolved],
  );

  /** 删除入口：当前文档走 F2 流程（草稿/组合/三选），其余走既有确认条 */
  const requestDelete = useCallback(
    (node: TreeNode): void => {
      if (currentDocOps !== null && node.wsFile && isCurrentDoc(node.wsFile)) {
        setPendingDelete(null);
        void currentDocOps.delete(node.wsFile);
        return;
      }
      confirmTarget(node);
    },
    [currentDocOps, isCurrentDoc, confirmTarget],
  );

  /**
   * 树内联改名的**路由包装**（`FileManagerTree` 只认 `(node, name)`）。
   *
   * 当前文档 → 走 `requestRename`（冲突三选 + I-14 + 目的地重绑）；
   * 其余 → 既有 `commitRename`（语义与断言都不动）。
   */
  const commitRenameRouted = useCallback(
    (node: TreeNode, nextName: string): void => {
      if (currentDocOps !== null && node.wsFile && isCurrentDoc(node.wsFile)) {
        setRenamingKey(null);
        const name = nextName.trim();
        if (name === '' || name === node.name) return; // 与源同名 → 零 I/O 取消
        requestRename(node.wsFile, name);
        return;
      }
      void commitRename(node, nextName);
    },
    [currentDocOps, isCurrentDoc, requestRename, commitRename],
  );

  /** 拖拽归位：当前文档走重绑编排（新目的地），其余走既有 moveFile */
  const dropIntoRouted = useCallback(
    (node: TreeNode, target: TreeNode): void => {
      setDropTarget(null);
      if (currentDocOps !== null && node.wsFile && isCurrentDoc(node.wsFile)) {
        void currentDocOps.move(node.wsFile, target.fullPath);
        return;
      }
      void dropInto(node, target);
    },
    [currentDocOps, isCurrentDoc, dropInto, setDropTarget],
  );

  // 树行渲染上下文：值 + 原样透传的回调（组装逻辑在同名适配模块，见 FileManagerWiring）
  const treeCtx: FileManagerTreeCtx = buildTreeCtx({
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
    dropInto: dropIntoRouted,
    commitRename: commitRenameRouted,
    setRenamingKey,
    toggleStar,
    onOpenFile,
    onOpenEntry,
    allDocs,
    openNode,
  });

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
      // 无索引（旧调用方）：退化为按树里的 ts 排序，仅供降级与旧测试使用。
      // 生产路径由 MindmapStage 注入索引（走下面那条，按 openedAt）。
      return matchQuery([...allDocs].sort((a, b) => b.ts - a.ts)).map((d) =>
        rowFromNode(d, formatRelative(d.ts), starredKeys.has(d.fullPath) || starredKeys.has(d.key)),
      );
    }
    const byKey = nodeIndex(allDocs);
    return index
      .recentDocs(RECENT_MAX)
      .flatMap((e) => {
        const row = rowFromIndexEntry(e, byKey, starredKeys, matchQuery);
        return row === null ? [] : [row];
      });
  }, [index, allDocs, matchQuery, starredKeys]);

  /** 收藏：按索引的稳定身份判定（`docKey` / `relPath` / 旧键三个别名都认） */
  const starredRows = useMemo(() => {
    return matchQuery(
      allDocs
        .filter((d) => starredKeys.has(d.fullPath) || starredKeys.has(d.key))
        .sort((a, b) => b.ts - a.ts),
    ).map((d) => rowFromNode(d, formatRelative(d.ts), true));
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

      {/*
        P0-A：当前文档操作的四块内联反馈（⑥）。
        顺序固定：冲突三选 → 未保存三选 → 部分成功 → 提示条；
        同时只会出现一块（状态机保证），但并列渲染不会互相遮挡。
      */}
      {conflict !== null && (
        <RenameConflictPanel
          name={conflict.name}
          keepBothName={conflict.keepBothName}
          onChoose={onConflictChoose}
        />
      )}
      {currentDocOps?.ui.dirtyChoice != null && (
        <RenameDirtyPanel
          name={currentDocOps.ui.dirtyChoice.name}
          onChoose={currentDocOps.ui.dirtyChoice.apply}
        />
      )}
      {currentDocOps?.ui.partial != null && (
        <PartialSuccessPanel
          createdPath={currentDocOps.ui.partial.createdPath}
          sourcePath={currentDocOps.ui.partial.sourcePath}
          reason={currentDocOps.ui.partial.reason}
          copyHasNewChanges={currentDocOps.ui.partial.copyHasNewChanges}
          onChoose={currentDocOps.ui.partial.apply}
        />
      )}
      {currentDocOps != null && (
        <FileOpNotice notice={currentDocOps.ui.notice} onDismiss={currentDocOps.dismissNotice} />
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
          <FlatDocList
            rows={recentRows}
            emptyText={
              query !== '' ? `没有匹配「${query}」的文件。` : '暂无最近打开的文档。'
            }
            onToggleStar={toggleStar}
            onOpen={openNode}
          />
        ) : (
          <FlatDocList
            rows={starredRows}
            emptyText={
              query !== ''
                ? `没有匹配「${query}」的收藏。`
                : '暂无收藏导图。在文档条目上点击 ☆ 即可加入收藏。'
            }
            onToggleStar={toggleStar}
            onOpen={openNode}
          />
        )}
      </div>

      {/*
        §6.2.1 历史池：**用户语言**呈现（不暴露「索引」「作用域」这类内部概念）。
        默认折叠；展开后可逐条「关联到此工作区」或「忽略」。
        没有归属证据的旧记录**不自动绑定**，但用户不处理也不丢（旧键原样保留）。
      */}
      {index && (
        <HistoryPool
          entries={history}
          open={historyOpen}
          onToggle={() => setHistoryOpen((v) => !v)}
          candidates={allDocs.map((d) => ({
            docKey: docKeyOfEntry(d, useWorkspace && workspace?.scopeId ? workspace.scopeId : null),
            name: d.fullPath,
            // 「同名」只是给用户的排序提示（把最可能的一条排在前面），
            // **不**据此自动绑定：`exact` 在选择前无对应旧记录，故这里恒为 false 之外
            // 的语义由 HistoryPool 内部按 `h.key` 比较得出（见该组件注释）。
            exact: false,
          }))}
          onLink={(h, targetKey) => {
            // 用户显式点选的 `docKey` —— 这里不做任何名字回退匹配，
            // 避免给不可撤销的 `user-confirmed` 证据灌进错误绑定
            index.relink(h.key, targetKey);
            refresh();
          }}
          onIgnore={(h) => {
            index.ignoreLegacy(h.key);
            refresh();
          }}
        />
      )}

      <MigrateFailedNotice count={migrateFailed} />
      <ProjectionFailureNotice failed={projectionFailed} />

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
            // 当前文档 → F2 流程（租约 + 草稿/组合 + 三选）；其余 → 既有内联确认条
            requestDelete(menuNode);
          }}
          onDuplicate={
            currentDocOps !== null && menuNode.wsFile
              ? () => {
                  closeMenu();
                  void currentDocOps.duplicate(menuNode.wsFile as WorkspaceFile);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

/** 供外部（MindmapStage）计算「移动到」候选目录 */
export { allDirs };
export { SEP };
export { NEW_DOC_TEMPLATE, formatRelative };
