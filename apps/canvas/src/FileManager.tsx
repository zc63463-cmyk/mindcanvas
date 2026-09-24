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
import { CHROME, classifyFileOpError, type DocEntry, type DocLibrary, type WorkspaceFile } from '@mindcanvas/react';
import {
  UNOPENABLE_NOTICE,
  allDirs,
  findNode,
  treeFromLibrary,
  treeFromWorkspace,
  type TreeNode,
} from './fileTreeModel.js';
import { useFileTreeView } from './useFileTreeView.js';
import { associationPort, useFileArchive } from './useFileArchive.js';
import { BreadcrumbBar, TreeNoticeBar, TreeToolbar } from './FileManagerTreeTools.js';
import { TreePane } from './FileManagerTreePane.js';
import { useFlatDocRows } from './useFlatDocRows.js';
import { useFileManagerTreeCtx, virtualDirNode } from './useFileManagerTreeCtx.js';
import { FileManagerHistories } from './FileManagerHistories.js';
import { AssociateWorkspacePanel } from './AssociateWorkspacePanel.js';
import { ContextMenu } from './FileManagerContextMenu.js';
import { StorageBar, ViewTabs, type FileManagerTab } from './FileManagerChrome.js';
import { docKeyOfEntry, type WorkspaceLike } from './FileManagerWiring.js';
import { useIndexWiring } from './useIndexWiring.js';
import { useFileTreeOps } from './useFileTreeOps.js';
import { failNoticeOf } from './hooks/useFileOpOrchestration.js';
import { useFileManagerRouting } from './useFileManagerRouting.js';
import type { CurrentDocOps } from './currentDocOps.js';
import { FileManagerOpStack } from './FileManagerOpStack.js';
import {
  DeleteConfirmBar,
  FileManagerHeader,
  NewFolderNameBar,
  TreeErrorBar,
} from './FileManagerInlineBars.js';

// 既有调用方（FileManagerModal / 测试）从这里取这些符号：保持在原位置可见，
// 拆分只搬家不改进口（否则所有消费点都要改路径，纯属噪音）。
export type { WorkspaceLike } from './FileManagerWiring.js';
export { docKeyOfEntry } from './FileManagerWiring.js';
import type { FileManagerTreeCtx } from './FileManagerTree.js';
import {
  NEW_DOC_TEMPLATE,
  SEP,
  collectDocs,
  formatRelative,
  inputStyle,
  useStarredKeys,
  type MenuState,
} from './fileManagerShared.js';
import type { DocIndex } from './docIndex.js';

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

// P0-A：当前文档操作面（类型定义在 `currentDocOps.ts`，避免拆分子模块反向 import 造成环）
export type { CurrentDocOps } from './currentDocOps.js';

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
        // 树里的文档补上索引身份（「最近」与收藏要按稳定身份认，见 docKeyOfEntry）。
        // 排序**不在这里**做：P1-A ③ 起排序依据是用户可选状态，统一由
        // `useFileTreeView` 施加（否则会出现「载入排一次、切依据再排一次」两处规则）。
        setTree(next);
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

  /**
   * P1-A ⑤：切换「显示其他文件」后重扫一次（带 `includeOtherFiles`）。
   * 必须重扫而不是前端筛：不支持的文件在**扫描阶段**就被过滤掉，前端没有原料；
   * 同一遍遍历完成（`scan(force, { includeOtherFiles })`），无第二遍扫描。
   */
  const rescan = useCallback(
    async (includeOtherFiles: boolean): Promise<void> => {
      if (!useWorkspace || !workspace) return;
      setLoading(true);
      try {
        const next = treeFromWorkspace(await workspace.scan(true, { includeOtherFiles }));
        if (aliveRef.current) setTree(next);
      } catch (e) {
        if (aliveRef.current) setError(e instanceof Error ? e.message : '扫描工作区失败');
      } finally {
        if (aliveRef.current) setLoading(false);
      }
    },
    [useWorkspace, workspace],
  );

  /**
   * P1-A ⑤/⑥：树侧内联提示（不可打开文件的点击提示、归档拒绝/完成说明）。
   * 不复用 `currentDocOps.ui.notice`：那条通道属于当前文档操作，生命周期不同；
   * 两者共用渲染位置（`role="status"`）但判据独立（见 `TreeNoticeBar` 注释）。
   */
  const [treeNotice, setTreeNotice] = useState<string | null>(null);

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
      // 移动/归位失败（含归档落点）的用户可见出口：文案经 `classifyFileOpError` →
      // `failNoticeOf` 取唯一事实源（逐码给恢复路径）；失败不刷新树 → 无幽灵条目（负控 5）。
      onMoveFailed: (e, node) => {
        setTreeNotice(`「${node.name}」${failNoticeOf(classifyFileOpError(e))}`);
      },
    });

  // ---------------------------------------------------------------- P0-A：当前文档操作路由
  //
  // 实现已抽到 `useFileManagerRouting.ts`（`bigFiles` 预算）：
  // 只有**当前文档**走租约/目的地重绑，其余节点保持既有语义。
  const {
    conflict,
    onConflictChoose,
    requestDelete,
    commitRenameRouted,
    dropIntoRouted,
  } = useFileManagerRouting({
    currentDocOps,
    allDocs,
    commitRename,
    dropInto,
    confirmTarget,
    setPendingDelete,
    setRenamingKey,
    setDropTarget,
  });

  // ---------------------------------------------------------------- P1-A：树视图状态（①②③④⑤）
  //
  // 实现已抽到 `useFileTreeView.ts`（`bigFiles` 预算）：排序依据、标题搜索、
  // 「显示其他文件」、roving tabindex 的焦点状态全部在那里；本组件只接线。
  const view = useFileTreeView({
    tree,
    index,
    currentPath,
  });

  /** P1-A ⑥：「改为归档」—— 删除确认条旁 + 右键菜单两个入口调同一 `archive.request`（§3.2） */
  const archive = useFileArchive({
    useWorkspace,
    moveToDir: (node, targetDir) => {
      const target = findNode(tree, `dir:${targetDir}`) ?? virtualDirNode(targetDir);
      void dropIntoRouted(node, target);
    },
    onNotice: setTreeNotice,
  });

  /** rider-B：人工关联面板的宿主端口（读四态 + 单事务写回；不碰裸句柄键） */
  const assocPort = useMemo(() => associationPort(), []);

  /** P1-A ④ `Delete` 键：与右键菜单删除**同一分流**，不新写第二条删除规则 */
  const deleteByKey = useCallback((node: TreeNode): void => requestDelete(node), [requestDelete]);

  // 树行渲染上下文：回调面较宽，组装抽到 `useFileManagerTreeCtx`（bigFiles 预算）
  const treeCtx: FileManagerTreeCtx = useFileManagerTreeCtx({
    view,
    dropTarget,
    dragKey,
    renamingKey,
    starredKeys,
    currentPath,
    allDocs,
    openNode,
    onOpenFile,
    onOpenEntry,
    onDropInto: dropIntoRouted,
    onCommitRename: commitRenameRouted,
    onDeleteKey: deleteByKey,
    onUnopenable: (node) => setTreeNotice(`${node.name}：${UNOPENABLE_NOTICE}`),
    toggleStar,
    setDropTarget,
    setDragKey,
    setMenu,
    setRenamingKey,
  });

  /**
   * 「创建副本」入口（§3.5）。用局部常量而不是内联三元 —— 内联写法会为了窄化
   * `menuNode.wsFile` 而引入一次 `as`（代码预算 `asCast` 为 0）。
   */
  const dupFile = menuNode?.wsFile ?? null;
  const dupOps = currentDocOps;
  const duplicateHandler =
    dupOps === null || dupFile === null
      ? undefined
      : (): void => {
          closeMenu();
          void dupOps.duplicate(dupFile);
        };

  // 「最近」/「收藏」两个平铺视图的行解析已抽到 `useFlatDocRows`（bigFiles 预算）
  const { recentRows, starredRows } = useFlatDocRows({
    index,
    allDocs,
    starredKeys,
    hasQuery: view.hasQuery,
    query: view.query,
  });

  /** 提示位的内容（树侧优先于当前文档操作侧；两者可能同时存在） */
  const visibleNotice = treeNotice ?? currentDocOps?.ui.notice ?? null;

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
      {/* 头部：标题 + 操作 + 关闭 —— 已抽到 FileManagerInlineBars */}
      <FileManagerHeader
        onNewFolder={() => setNamingTarget({ parentPath: '' })}
        onNewDoc={() => {
          setMenu(null);
          void createDocIn('');
        }}
        onClose={onClose}
      />

      {/* rider-B：人工关联面板挂在作用域区（见 useFileArchive.associationPort） */}
      <StorageBar
        mounted={useWorkspace}
        name={workspace?.name ?? null}
        onPick={onPickWorkspace}
        onDetach={onDetachWorkspace}
        associate={
          useWorkspace ? (
            <AssociateWorkspacePanel
              read={assocPort.read}
              write={assocPort.write}
              onNotice={setTreeNotice}
            />
          ) : undefined
        }
      />

      <ViewTabs tab={tab} starredCount={starredKeys.size} onChange={setTab} />

      {/* 搜索：文件名 / 路径实时过滤 */}
      <div style={{ padding: '8px 12px' }}>
        <input
          data-fm-search
          value={view.query}
          onChange={(e) => view.setQuery(e.target.value)}
          // P1-A ②：范围明示 —— 标题只对**已索引**文档生效（§6 原文文案）
          placeholder="搜索文件名、路径或标题…（标题仅搜索已记录的文档）"
          aria-label="搜索文件名、路径或标题"
          style={{ ...inputStyle(), width: '100%', boxSizing: 'border-box' }}
        />
      </div>

      {/* P1-A ③/⑤：树工具条（仅「全部目录」—— 排序不动「最近」，§3.3） */}
      {tab === 'tree' && (
        <TreeToolbar
          sortMode={view.sortMode}
          onSortMode={view.setSortMode}
          sortLabel={view.sortLabel}
          showOtherFiles={view.showOtherFiles}
          onShowOtherFiles={(on) => {
            view.setShowOtherFiles(on);
            void rescan(on);
          }}
          otherFileCount={view.otherFileCount}
          showToggle={useWorkspace}
        />
      )}

      {/* P1-A ①/⑤/⑥：树侧内联提示 `role="status"`；与操作侧共用位置、判据独立 */}
      {visibleNotice !== null && (
        <TreeNoticeBar
          notice={visibleNotice}
          onDismiss={() => {
            setTreeNotice(null);
            currentDocOps?.dismissNotice();
          }}
        />
      )}

      {/* 面包屑 + 当前文档状态（①：状态行 `role="status"`，§6 无障碍） */}
      <BreadcrumbBar
        workspaceName={useWorkspace ? (workspace?.name ?? null) : null}
        currentPath={currentPath}
        dirty={dirty}
      />

      {/* A-D3：删除内联确认条 —— 已抽到 FileManagerInlineBars */}
      {pendingDelete !== null && (
        <DeleteConfirmBar
          target={pendingDelete}
          useWorkspace={useWorkspace}
          onConfirm={() => void doRemove(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
          /* ⑥ 删除确认条旁的次要动作：改为归档（§3.6），与右键菜单同一编排（§3.2） */
          onArchive={
            archive.canArchive(pendingDelete)
              ? () => {
                  const node = pendingDelete;
                  setPendingDelete(null);
                  archive.request(node);
                }
              : undefined
          }
        />
      )}

      {/* P0-A：当前文档操作的四块内联反馈（⑥）—— 已抽到 FileManagerOpStack */}
      <FileManagerOpStack
        conflict={conflict}
        onConflictChoose={onConflictChoose}
        currentDocOps={currentDocOps}
      />

      {/* A-D3：新建文件夹内联命名 —— 已抽到 FileManagerInlineBars */}
      {namingTarget !== null && (
        <NewFolderNameBar
          parentPath={namingTarget.parentPath}
          onSubmit={(name) => {
            setNamingTarget(null);
            void createDirIn(namingTarget.parentPath, name);
          }}
          onCancel={() => setNamingTarget(null)}
        />
      )}

      {error && <TreeErrorBar message={error} />}

      {/* 树状 / 平铺内容区域 —— 三视图分发已抽到 FileManagerTreePane */}
      <TreePane
        loading={loading}
        tab={tab}
        viewTree={view.viewTree}
        hasQuery={view.hasQuery}
        query={view.query}
        treeCtx={treeCtx}
        recentRows={recentRows}
        starredRows={starredRows}
        onToggleStar={toggleStar}
        onOpen={openNode}
      />

      {/* §6.2.1 历史池 + 迁移/投影反馈 + 底注；rider-C：关联目标只能由用户点选 */}
      <FileManagerHistories
        index={index}
        history={history}
        historyOpen={historyOpen}
        onToggleHistory={() => setHistoryOpen((v) => !v)}
        candidates={allDocs.map((d) => ({
          docKey: docKeyOfEntry(d, useWorkspace && workspace?.scopeId ? workspace.scopeId : null),
          name: d.fullPath,
        }))}
        onRelink={(legacyKey, targetKey) => {
          index?.relink(legacyKey, targetKey);
          refresh();
        }}
        onIgnore={(legacyKey) => {
          index?.ignoreLegacy(legacyKey);
          refresh();
        }}
        migrateFailed={migrateFailed}
        projectionFailed={projectionFailed}
      />

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
          onDuplicate={duplicateHandler}
          // ⑥「改为归档」：与删除确认条旁的次要动作**同一编排**（§3.2）
          onArchive={
            menuNode.type === 'doc' && archive.canArchive(menuNode)
              ? () => {
                  closeMenu();
                  archive.request(menuNode);
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
