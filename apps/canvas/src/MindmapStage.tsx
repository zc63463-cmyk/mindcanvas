/**
 * MindmapStage：apps/canvas 组合入口（= kernel 数据管线 + react 渲染器 + chrome 壳 + 编辑器闭环）。
 * - 编辑器：EditorController（全部编辑经 TreeOp + OpHistory），useEditor 驱动重渲
 * - 快捷键：6 个必做 + 保存（Ctrl+S）+ 折叠（Space）——经 matchEditorKey 分发
 * - 玻璃 chrome 恒定（K3 决策 3）；性能面板消费 MapView stats
 */

import {
  hasNote,
  nodeAtPath,
  pathOfNode,
  type NodePath,
} from '@mindcanvas/kernel';
import type { EditableNode, Entity, GrowDir, Note, TreeOp } from '@mindcanvas/kernel';
import {
  DEFAULT_SECTION_COLOR,
  makeSectionId,
  removeSection,
  upsertSection,
} from '@mindcanvas/kernel';
import { findNode, getNode, LayoutCache, REGISTERED_KINDS, refKey } from '@mindcanvas/kernel';
// L1：文本区域链接跳转（锚解析 + 三态）
import { parseLinkAnchor, resolveLinkAnchor } from '@mindcanvas/kernel';
import type {
  AssetHost,
  AssetItem,
  Center,
  DocumentHost,
  EdgeManual,
  EdgeRouteEntry,
  FreeEdge,
  MapStats,
  MindDoc,
  ResolvedSection,
  WorkspaceFile,
} from '@mindcanvas/react';
import {
  AssetPanel,
  anchorOfNode,
  appendEdge,
  assetDiagnostics,
  buildEditable,
  buildEntities,
  createSummary,
  CHROME,
  collapsedAncestors,
  collectEntityRelations,
  collectFreeEdges,
  collectNodeChoices,
  createRankedCharMeasure,
  createReactRegistries,
  DemoPlugin,
  DocLibrary,
  EditorController,
  EdgeHealthBar,
  edgeHealthOf,
  EntityGraphPanel,
  EntityPicker,
  exportPng,
  exportSvg,
  FlipCard,
  formatNote,
  getNodeLabel,
  IdbAssetHost,
  installBeforeUnload,
  isEscapedEntityInput,
  isImageFileName,
  isMindDocFile,
  DirectoryWorkspaceHost,
  WorkspaceAssetHost,
  idsMeasureKey,
  LocalDocHost,
  LocalEntityStore,
  layoutDemo,
  buildIslandView,
  collectCenters,
  findEntityNodeId,
  ensureNodeCid,
  planPromoteCenter,
  resolveSections,
  upsertCenter,
  MapView,
  matchEditorKey,
  matchPreDirKey,
  itemAt,
  RADIAL_ITEMS_V1,
  submenuItemsFor,
  OutlinePanel,
  PluginHost,
  QaEditor,
  planCutTreeEdge,
  SearchPanel,
  ShortcutHelpPanel,
  scaleNoticeFor,
  summarizeReferenceDiagnostics,
  inferChildDir,
  searchMind,
  setFrameDepth,
  ThemeProvider,
  ThemeSwitcher,
  unescapeEntityInput,
  useEditor,
  useTheme,
} from '@mindcanvas/react';
import {
  type CSSProperties,
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushActiveDraft, hasPendingDraft } from './draftFlush.js';
import {
  SAVE_METADATA_WARNING,
  type DocumentLeavePort,
  type RequestLeave,
  type SaveCompletion,
} from './documentLifecycle.js';
import { useLeavePortRegistration } from './hooks/useDocumentLeaveRegistration.js';
import gatewaySource from './demo/gateway.mm.md?raw';
import { useAutoSave } from './hooks/useAutoSave.js';
import { useCanvasDegradeNotice } from './hooks/useCanvasDegradeNotice.js';
import { useDocumentActions } from './hooks/useDocumentActions.js';
import { useDocumentSaveSession } from './hooks/useDocumentSaveSession.js';
import { useDocumentSwitch } from './hooks/useDocumentSwitch.js';
import { nodeById, useEdgeActions } from './hooks/useEdgeActions.js';
import { EdgeDraftLayer, type EdgeContextMenuState } from './EdgeDraftLayer.js';
import { FileManagerModal } from './FileManagerModal.js';
import { NodeContextMenu } from './NodeContextMenu.js';
import { RecentDocMenu } from './RecentDocMenu.js';
import { useEntityPick } from './hooks/useEntityPick.js';
import { useExportActions } from './hooks/useExportActions.js';
import { RadialStageOverlay, useRadialStage } from './hooks/useRadialStage.js';
import { layoutBoxCenterOf } from './layoutBoxCenter.js';
import { makeCenterActions, makeDescActions, makeNoteActions, makeSummaryActions } from './nodeMenuBags.js';
import { useDocumentToken } from './hooks/useDocumentToken.js';
import { useSummaryHop } from './hooks/useSummaryHop.js';
import { IS_TEST_BUILD } from './testBuild.js';
import { ghostBoxOf } from './radialGhost.js';
import { LenBubble } from './LenBubble.js';
import { FrameDepthBubble } from './FrameDepthBubble.js';
import { applyLen } from './lenEdit.js';
import { applyBeamCommit } from './beamEdit.js';
import { PerfPanel } from './PerfPanel.js';
import { SidePanels } from './SidePanels.js';
import { StartupScreen } from './StartupScreen.js';

/** gateway 实体标题表（缺口 → unresolved 演示；同 gateway.mm.md refs） */
const GATEWAY_TITLES: Record<string, { title: string; status?: string }> = {
  'doc:docs/01-architecture.md': { title: '01 · 架构设计', status: 'published' },
  'doc:docs/07-entity-ref-protocol.md': { title: '07 · 实体引用协议', status: 'published' },
  'doc:docs/09-knowledge-canvas-and-conventions.md': {
    title: '09 · 知识画布与约定',
    status: 'published',
  },
  'issue:1': { title: '门户显示优化', status: 'open' },
  'issue:6': { title: '解析链路验证', status: 'open' },
  'issue:8': { title: 'K3 渲染层', status: 'open' },
  'milestone:门户显示优化': { title: '门户显示优化里程碑', status: 'open' },
  'idea:forge-inbox:2': { title: '灵感：只读先行', status: 'open' },
  'img:demo-assets/demo-diagram.svg': { title: '演示架构图', status: 'ready' },
  'draw:demo-assets/board.svg': { title: '白板草稿', status: 'ready' },
};

/** 图库资产清单（P0 起由资产宿主注入：首期 = 打包 demo 资产；真实 FS/HTTP 宿主属宿主实现） */
const DEMO_ASSETS: AssetItem[] = [
  { kind: 'img', id: 'demo-assets/demo-diagram.svg', name: 'demo-diagram.svg', type: 'svg' },
  { kind: 'draw', id: 'demo-assets/board.svg', name: 'board.svg', type: 'svg' },
];

/** 折叠状态持久化 key（localStorage；v2 = 路径制，v1 为 id 制已弃用） */
const COLLAPSE_KEY = 'mindcanvas.collapsed.v2';

/** C+1：自由画布入口透传（App 模式态；缺省不影响导图任何行为） */
export interface MindmapStageProps {
  onOpenFreeCanvas?: () => void;
  /**
   * MODE-GUARD：App 注入的离开决策器（模式切换与文档替换共用）。
   * 缺省 = 不做离开保护（独立用法/旧测试）；生产由 App 注入。
   */
  requestLeave?: RequestLeave;
  /** MODE-GUARD：把本 Stage 的 leave port 登记到 App */
  registerLeavePort?: (port: DocumentLeavePort | null) => () => void;
}

function StageInner({ onOpenFreeCanvas, requestLeave, registerLeavePort }: MindmapStageProps) {
  const { token } = useTheme();
  const [stats, setStats] = useState<MapStats | null>(null);
  const [pluginActive, setPluginActive] = useState(false);
  const apiRef = useRef<MapViewApi | null>(null);

  // 六注册表（T3 实装）+ 插件宿主：组合点 = kernel + [plugins]
  const regs = useMemo(() => createReactRegistries(), []);
  const hostRef = useRef<PluginHost | null>(null);
  if (hostRef.current === null) hostRef.current = new PluginHost();
  const host = hostRef.current;

  // 挂载样例插件（T5 演示组合能力）；卸载时自注销 + 清理 DOM
  useEffect(() => {
    const demo = new DemoPlugin(regs);
    void host.load(demo).then(() => setPluginActive(true));
    return () => {
      void host.unload(demo).then(() => setPluginActive(false));
    };
  }, [regs, host]);

  // ---------- B1 多文档：文档宿主 + 当前文档（初始 = 内置 gateway 快照） ----------
  const docHostRef = useRef<DocumentHost | null>(null);
  if (docHostRef.current === null) docHostRef.current = new LocalDocHost();
  const docHost = docHostRef.current;
  const [doc, setDoc] = useState<MindDoc>(() => ({
    ...docHost.create('gateway.mm.md', gatewaySource),
    saved: true,
  }));
  const [docMenuOpen, setDocMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 数据管线：parseMm → astToEditable → entities（T3；B1：随当前文档 source 重解析）
  // entities 为 state：图库插入 @img/@draw 引用后动态扩展（key = `${kind}:${id}`）
  const data = useMemo(() => buildEditable(doc.source), [doc.source]);
  const { editable, refs } = data;
  const [entities, setEntities] = useState<Map<string, Entity>>(() =>
    buildEntities(refs, GATEWAY_TITLES),
  );

  // A5：命令拒绝/事务失败的告警（4s 自动消退；与中心诊断条同样「宁可不写也不错写」）
  // R1-4：声明在 controller 构造之前——锚迁移冲突回调（R1-1）直接复用本通道
  const [commandNotice, setCommandNotice] = useState<string | null>(null);

  // 编辑器：controller 随初始树创建一次；所有编辑经 controller（TreeOp）
  // 折叠持久化：localStorage（key 按 demo 文件定名；打开新文件时 controller.reset 清空写回）
  const controllerRef = useRef<EditorController | null>(null);
  // S2G：保存侧同步守卫的同步标记（写点①：下方 controller 创建处；其余写点见 useDocumentSwitch）
  const syncedSourceRef = useRef<string | null>(null);
  if (controllerRef.current === null && editable) {
    controllerRef.current = new EditorController(editable, {
      // R1-4：管线内锚迁移冲突（apply 路径）→ 命令告警条；applyTransaction 路径
      // 的冲突由各调用方经 result.error 上报（切断/接回等已有通道）
      onAnchorConflict: setCommandNotice,
      storage: {
        load: () => {
          try {
            return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '[]') as number[][];
          } catch {
            return [];
          }
        },
        save: (paths) => localStorage.setItem(COLLAPSE_KEY, JSON.stringify(paths)),
      },
    });
    syncedSourceRef.current = doc.source; // S2G 写点①：controller 按当前树创建 = 确定同步
  }
  const controller = useEditor(controllerRef.current ?? (null as unknown as EditorController));
  // ⚠️ 已知违反 React Hooks 规则（早退位于 Hook 之前）—— biome useHookAtTopLevel 已降级为 warn。
  //
  // 为什么保留早退：controller **确实可能为 null** —— 见上方 151 行
  // `if (controllerRef.current === null && editable)`，当数据管线解析失败（editable 为 null）时
  // controller 即为 null。此时若继续往下执行，后续 31 处 Hook（如 481 行 useMemo 读
  // `controller.root`、647 行 `controller.dirty`）会直接 TypeError → 白屏崩溃。
  // 早退在此处可让页面降级为空白，而非抛错。
  //
  // 正确修复（P2，需重构）：把 StageInner 拆成「数据加载层」+「渲染层」两个组件——
  // 外层在 editable/controller 为 null 时直接返回错误提示，内层接收**非 null** 的
  // controller 后，所有 Hook 无条件调用。这是 React 官方推荐的解法。

  // ---------- S2 启动页：有最近文档时先进入口，而非直接打开内置示例 ----------
  // 初值只算一次：有最近文档 → 显示启动页；没有（全新用户）→ 沿用内置示例。
  const [showStartup, setShowStartup] = useState(() => docHost.recent().length > 0);

  // MODE-GUARD：启动页 / 解析失败态也要登记 leave port，否则模式切换会被「未就绪」挡住。
  // - 启动页：尚无可编辑内容（文件未被内存改写）→ 干净端口，允许直接切换；
  // - 解析失败：若该文档从未落盘（拖入/粘贴导入的源文解析失败），存在只在内存里的内容 →
  //   只有用户显式「放弃修改」才离开，不默认当作可安全丢弃。
  const needsFallbackLeavePort = showStartup || !controller;
  useLeavePortRegistration(needsFallbackLeavePort ? registerLeavePort : undefined, () => ({
    flushEdits: () => true,
    isDirty: () => !showStartup && !doc.saved,
    isSaving: () => false,
    waitForIdle: () => Promise.resolve(),
    // 无 controller 无法序列化：保存不可用（用户仍可显式放弃或取消）
    save: (): Promise<SaveCompletion> => Promise.resolve({ kind: 'failed' }),
  }));

  // 启动页优先于其它分支：它不读画布状态，controller 是否就绪都无关。
  // 放在全部 Hook 之后（useState 是最后一个 Hook），Hook 调用数恒定。
  if (showStartup) {
    return (
      <StartupScreen
        recent={docHost.recent()}
        onOpenRecent={(d) => {
          // 这里**不需要** applyDoc 的未保存守卫，理由（2026-09-03 复核）：
          // 启动页只在冷启动出现一次（初值 = 有最近文档），此时用户尚未编辑任何内容
          // —— 不存在"可丢失的未保存修改"；applyDoc 在 StageContent 里（本分支早退拿不到）。
          // ⚠️ 「不需要守卫」≠「不需要同步」：controller 已在本组件随初始树建立（见上方
          // controllerRef 段），三条出口 setDoc 直通 = 「StageContent 挂载前 doc 已换」——
          // 树同步由 useDocumentSwitch 的状态判据兜住（首挂不同源 → 补做 reset；S2F [1.8.19]）。
          setDoc(d);
          docHost.remember(d); // 刷新 ts，下次启动仍是它排第一
          setShowStartup(false);
        }}
        onNew={() => {
          setDoc(docHost.create('未命名.mm.md', '# 未命名\n'));
          setShowStartup(false);
        }}
        onUseSample={() => setShowStartup(false)}
        onOpenFreeCanvas={onOpenFreeCanvas}
      />
    );
  }

  // 解析失败降级：controller 为 null 说明数据管线解析失败（editable 为 null）。
  // 此早退位于本组件全部 Hook 之后，Hook 调用数恒定 —— 符合 React Hooks 规则（ADR-0007）。
  // 渲染层 StageContent 接收非 null 的 controller，其内 21 个 Hook 得以无条件调用。
  if (!controller) {
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
          color: CHROME.text,
          fontFamily: CHROME.fontFamily,
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 15, marginBottom: 8 }}>文档解析失败</div>
          <div style={{ fontSize: 12, color: CHROME.textMuted }}>
            {doc.name} 无法解析为可编辑树，请检查 .mm.md 语法。
          </div>
        </div>
      </div>
    );
  }

  return (
    <StageContent
      token={token}
      stats={stats}
      setStats={setStats}
      pluginActive={pluginActive}
      apiRef={apiRef}
      docHost={docHost}
      doc={doc}
      setDoc={setDoc}
      docMenuOpen={docMenuOpen}
      setDocMenuOpen={setDocMenuOpen}
      fileInputRef={fileInputRef}
      data={data}
      editable={editable}
      refs={refs}
      entities={entities}
      setEntities={setEntities}
      controllerRef={controllerRef}
      syncedSourceRef={syncedSourceRef}
      controller={controller}
      commandNotice={commandNotice}
      setCommandNotice={setCommandNotice}
      requestLeave={requestLeave}
      registerLeavePort={registerLeavePort}
    />
  );
}

/** 数据管线的返回形态（避免引入新导入） */
type EditableData = ReturnType<typeof buildEditable>;

interface StageContentProps {
  token: ReturnType<typeof useTheme>['token'];
  stats: MapStats | null;
  setStats: Dispatch<SetStateAction<MapStats | null>>;
  pluginActive: boolean;
  apiRef: RefObject<MapViewApi | null>;
  docHost: DocumentHost;
  doc: MindDoc;
  setDoc: Dispatch<SetStateAction<MindDoc>>;
  docMenuOpen: boolean;
  setDocMenuOpen: Dispatch<SetStateAction<boolean>>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  data: EditableData;
  editable: EditableData['editable'];
  refs: EditableData['refs'];
  entities: Map<string, Entity>;
  setEntities: Dispatch<SetStateAction<Map<string, Entity>>>;
  controllerRef: RefObject<EditorController | null>;
  /** S2G：保存侧同步守卫的同步标记（三写点：创建处 / switch 两分支） */
  syncedSourceRef: RefObject<string | null>;
  /** 非 null —— 由 StageInner 早退保证 */
  controller: EditorController;
  /** A5 命令告警（R1-4 状态提升至 StageInner：锚迁移冲突回调在 controller 构造处闭包） */
  commandNotice: string | null;
  setCommandNotice: Dispatch<SetStateAction<string | null>>;
  /** MODE-GUARD：离开决策器（App 注入；模式切换与文档替换共用同一个判定） */
  requestLeave?: RequestLeave;
  /** MODE-GUARD：把本 Stage 的 leave port 登记到 App */
  registerLeavePort?: (port: DocumentLeavePort | null) => () => void;
}

/**
 * StageContent —— 渲染层（ADR-0007）。
 *
 * 从 StageInner 拆出：接收**非 null** 的 controller，其后所有 Hook 无条件调用，
 * 消除原先「早退位于 Hook 中间」导致的 21 处 useHookAtTopLevel 违规。
 * 本组件内仍保留 `if (!layout) return null`，但它位于全部 Hook 之后（合规）。
 */
function StageContent({
  token,
  stats,
  setStats,
  pluginActive,
  apiRef,
  docHost,
  doc,
  setDoc,
  docMenuOpen,
  setDocMenuOpen,
  fileInputRef,
  data,
  editable,
  refs,
  entities,
  setEntities,
  controllerRef,
  syncedSourceRef,
  controller,
  commandNotice,
  setCommandNotice,
  requestLeave,
  registerLeavePort,
}: StageContentProps) {
  // M1 实体 picker：候选宿主 —— 为 useDocumentSwitch 首挂登记提前声明（原「实体候选」区仅剩使用）
  const entityHostRef = useRef<LocalEntityStore | null>(null);
  if (entityHostRef.current === null) entityHostRef.current = new LocalEntityStore();
  const entityHost = entityHostRef.current;
  // 展开态节点 id（单一展开；点击有 qa 节点展开，再点/其他节点收起）——为 useDocumentSwitch 提前声明
  const [expandedQaId, setExpandedQaId] = useState<string | null>(null);

  // SAVE-LIFECYCLE：保存会话（同会话写入串行 + 会话/内容归属校验）。
  // 「保存中…」指示由会话推送 —— 旧会话的迟完成不会隐藏新会话正在保存的状态。
  // 声明位置：早于 useDocumentSwitch / useDocumentActions / useAutoSave（三者都要用它）。
  const { session: saveSession, saving } = useDocumentSaveSession({
    readContent: () => controller.root,
    // 附属回填（commit）异常：写盘已成功，仅提示「附属步骤未完成」（复核 R4-B）
    onCommitError: () => setCommandNotice(SAVE_METADATA_WARNING),
  });

  // R2：文档会话令牌 —— 「当前这棵树是从哪次文档加载来的」的会话身份。
  // 声明位置必须在 useDocumentSwitch 之前（它要拿到 bump 句柄）。
  // 判据是**替换事件**而非内容：同内容替换（重开同一文件）同样推进令牌 → 旧草稿必失效。
  const { token: documentToken, bump: bumpDocumentToken } = useDocumentToken();

  /**
   * 测试观测口的**实例归属**（仅测试构建有意义，见下方注册块）。
   * 卸载时据此判断「全局入口是否仍属于我」，避免一个实例删掉另一个实例的入口。
   */
  const installedHandleRef = useRef<MindcanvasSummaryHostHandle | null>(null);

  // B1 文档切换（迁至 hooks/useDocumentSwitch；纯搬迁：动作顺序 / deps / 首挂跳过逐字保留）。
  // 调用点留在原位 —— 保证 useDocumentSwitch 的 effect 注册在 useAutoSave 之前
  // （切换时 reset 先执行，autosave 随后读到 dirty=false 早退）。
  // 注意：保存路径不得改写 doc.source（解析输入）——见 docs/dispatch/2026-09-13-edit-flow-session-integrity-plan.md
  useDocumentSwitch({
    doc,
    editable,
    refs,
    entities,
    entityHost,
    gatewayTitles: GATEWAY_TITLES,
    controllerRef,
    syncedSourceRef,
    session: saveSession,
    setEntities,
    setExpandedQaId,
    apiRef,
  });

  // GH-T2：折叠定位自动展开（F1 边界）——定位前展开目标祖先折叠，避免 focusNode no-op
  const focusNode = (id: string): void => {
    for (const a of collapsedAncestors(controller.root, controller.collapsed, id))
      controller.setCollapsed(a, false);
    controller.select(id);
    apiRef.current?.focusNode(id);
  };

  // L1：文本区域链接跳转（T-A4）——锚解析 → 唯一命中 → 复用 focusNode（展开祖先 + 选中 + 定位）。
  // 非 well-formed（dangling/stale）不动作：幽灵态在渲染层已不可点，这里是第二道闸；
  // 实体锚（语法 well-formed 但无 nodeId）经 findEntityNodeId 落到树中节点；不自动打开 note 浮窗。
  const jumpToAnchor = (anchorText: string): void => {
    const anchor = parseLinkAnchor(anchorText);
    if (!anchor) return;
    const res = resolveLinkAnchor(controller.root, anchor);
    if (res.state !== 'well-formed') return;
    const id =
      res.nodeId ?? (anchor.kind === 'entity' ? findEntityNodeId(controller.root, anchor.target) : null);
    if (!id) return;
    focusNode(id);
  };

  // 文档操作（打开/新建/保存/另存为）与导出已抽至 hooks/：
  //   useDocumentActions —— 依赖 autoSaveTimer，在其定义之后调用（见下）
  //   useExportActions   —— 依赖 layout，在 layout 之后调用（见下）
  // GH-T4：全图 SVG 导出（下载 .svg；主题令牌保持）

  // GH-T3：自动保存（debounce 300ms；仅已落盘文档；手动 Ctrl+S 取消 pending；失败静默由手动保存兜底）
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 文档操作（打开/新建/保存/另存为）—— 依赖 autoSaveTimer，故在其定义之后调用
  const { applyDoc, handleOpen, handleNew, handleSave, handleSaveAs } = useDocumentActions({
    controller,
    docHost,
    doc,
    setDoc,
    fileInputRef,
    autoSaveTimer,
    session: saveSession,
    syncedSourceRef,
    // R2：显式文档替换（打开/新建/最近/文件库/工作区/拖入）都要让会话态草稿失效。
    // 放在**替换动作发生处**（performApplyDoc）而不是只听 `doc.source` 变化：
    // 同内容替换（重开同一文件）source 逐字相同，靠 source 判据会漏掉。
    onDocumentReplaced: bumpDocumentToken,
    onBlockedSave: setCommandNotice,
    // 写盘成功但附属记录失败 → 独立附属警告（不能显示「未标记已保存」，复核 R4-B）
    onSaveWarning: setCommandNotice,
    // MODE-GUARD：打开/新建/最近/拖入/工作区等替换入口统一走离开决策器
    requestLeave,
  });

  // GH-T3：自动保存 —— 逻辑已抽至 hooks/useAutoSave（debounce 300ms；仅已落盘文档；
  // 手动 Ctrl+S 取消 pending；失败静默由手动保存兜底；口径：写回 savedSource，不碰 doc.source）
  useAutoSave({
    controller,
    docHost,
    doc,
    setDoc,
    session: saveSession,
    autoSaveTimer,
    syncedSourceRef,
    onBlockedSave: setCommandNotice,
  });

  // MODE-GUARD：把本 Stage 的离开端口登记到 App（模式切换与文档替换共用同一判定）。
  // 端口方法读实时状态；`suppressPendingAuto` 供「放弃修改并离开」停止排定新的自动保存。
  useLeavePortRegistration(registerLeavePort, () => ({
    flushEdits: flushActiveDraft,
    isDirty: () => controller.dirty,
    isSaving: () => saveSession.isSaving(),
    waitForIdle: () => saveSession.waitForIdle(),
    save: () => handleSave(),
    suppressPendingAuto: () => {
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = null;
      }
    },
  }));

  // 选中节点：单一来源 = controller.selectedId + 从当前树取节点（编辑后引用自动刷新，
  // 避免点选时的快照引用陈旧导致 QaEditor/QuickCommentPanel 读不到新 note）
  const selected =
    controller.selectedId !== null ? nodeById(controller.root, controller.selectedId) : null;

  // F1：实体关系数据（随树/实体表自动刷新）+ 画布选中实体 → 面板高亮联动
  const relations = useMemo(
    () => collectEntityRelations(controller.root, entities),
    [controller.root, entities],
  );
  const activeRefKey = selected?.type === 'entity' && selected.ref ? refKey(selected.ref) : null;

  // M1 实体 picker：{ 目标节点, 查询串, 当前引用（编辑既有实体） }；null = 关闭
  const [picker, setPicker] = useState<{
    nodeId: string;
    query: string;
    current: { kind: string; id: string } | null;
  } | null>(null);
  // 候选：当前文档实体（优先，文档内最新为准）+ 历史候选（N1 store，跨文档复用）；
  // 资产类走图库，不进 picker（entityHost 已于上方声明）
  const entityCandidates = useMemo(() => {
    const merged = new Map<string, { kind: string; id: string; title: string }>();
    for (const e of entities.values()) {
      if (e.kind === 'img' || e.kind === 'draw') continue;
      merged.set(`${e.kind}:${e.id}`, { kind: e.kind, id: e.id, title: e.title ?? e.id });
    }
    for (const r of entityHost.list()) {
      const key = `${r.kind}:${r.id}`;
      if (!merged.has(key)) merged.set(key, { kind: r.kind, id: r.id, title: r.title });
    }
    return [...merged.values()];
  }, [entities, entityHost]);
  // 实体引用的选取动作（选中即登记：写回 + 补表 + 记库 + 关 picker + 选中节点）
  const pickEntity = useEntityPick({
    controller,
    setEntities,
    entityHost,
    docName: doc.name,
    onDone: (nodeId) => {
      setPicker(null);
      controller.select(nodeId);
    },
  });

  const pickKinds = useMemo(() => REGISTERED_KINDS.filter((k) => k !== 'img' && k !== 'draw'), []);

  // 批次 2：? 快捷键帮助面板 + 节点右键菜单（{ 节点, 屏幕坐标 }；null = 关闭）
  const [helpOpen, setHelpOpen] = useState(false);
  // 文件管理器（文档库 UI）：独立于 `panel` 单态——它是模态浮层，不是侧面板
  const [fileManagerOpen, setFileManagerOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  // v1.8.1：「出线长度 › 自定义…」数值气泡（取代原生 prompt——裁决 M3）
  const [lenBubble, setLenBubble] = useState<{
    id: string;
    x: number;
    y: number;
    current: number | null;
  } | null>(null);
  // FO-UI1：框深度数值步进气泡（取代「改框深度…」的原生 prompt——webview 会静默吞掉）
  const [frameDepthBubble, setFrameDepthBubble] = useState<{
    id: string;
    x: number;
    y: number;
    current: number;
    max: number;
  } | null>(null);
  /**
   * PG 式预方向（会话级易失：不落文档，刷新即失；Tab/Enter 生长时才固化进 note.dir）。
   * 用 ref 持有：keydown 的 effect 依赖只有 controller，若用 state 会因闭包陷阱
   * 永远读到首次渲染的空 Map（实测「设了方向但 Tab 不生效」的根因）。
   * 另存一份 state 仅用于触发重渲染以显示提示徽标。
   */
  const preDirsRef = useRef<ReadonlyMap<string, GrowDir>>(new Map());
  const [preDirHint, setPreDirHint] = useState<{ id: string; dir: GrowDir } | null>(null);
  useEffect(() => {
    if (preDirHint === null) return;
    const timer = setTimeout(() => setPreDirHint(null), 2500);
    return () => clearTimeout(timer);
  }, [preDirHint]);

  /**
   * ② 二级环（T5）：节点动作袋（描述 / 笔记 / 中心）——与右键菜单**同一份闭包**。
   * 袋在函数体后段构建（依赖其后的 host 回调 state），此处以 ref 承接：
   * `getSubModel` 只在 Alt 按下（会话开始）时读，届时已就绪。
   */
  const nodeBagsRef = useRef<Parameters<typeof submenuItemsFor>[2] | null>(null);

  // v1.8.0 Phase 2：环形快捷操作（按住 Alt ≥250ms 出环）——与预方向共用键位，
  // 「快击=手势 / 慢按=菜单」由状态机相位分层；动作与既有命令同路径（单一动作源）。
  const radial = useRadialStage({
    getSelectedId: () => controller.selectedId,
    // ② 二级环：席位与页来自派生模型（条件灰显 / 动态文案 / 翻页定义都不在接线层重写）
    getSubModel: (id) => {
      const bags = nodeBagsRef.current;
      return bags ? submenuItemsFor(controller, id, bags) : null;
    },
    getAnchor: (id) => apiRef.current?.nodeCorner(id) ?? null,
    setPreDir: (id, dir) => {
      preDirsRef.current = new Map(preDirsRef.current).set(id, dir);
      setPreDirHint({ id, dir });
    },
    actions: {
      addChild: (id) => {
        // 与 Tab 生长同一条路径（预方向 → 兄弟多数/父方向推断 → 固化 note.dir）
        const parent = getNode(controller.root, id);
        const dir = preDirsRef.current.get(id) ?? (parent ? inferChildDir(parent) : null);
        const newId = controller.addChild(id, undefined, dir ? { dir } : undefined);
        controller.select(newId);
        controller.startEdit(newId);
      },
      editText: (id) => controller.startEdit(id),
      removeNode: (id) => {
        // 环内二次确认气泡即确认步骤（不再叠 window.confirm）
        controller.removeNode(id);
        controller.select(null);
      },
      openMenu: (id, x, y) => setCtxMenu({ nodeId: id, x, y }),
    },
  });
  // 键处理 effect 依赖只有 [controller]（历史原因带 eslint-disable）——经 ref 读，稳且零 lint 噪声
  const radialKeyRef = useRef(radial.handleKey);
  radialKeyRef.current = radial.handleKey;

  // ① 幽灵预览（Phase 3）：高亮「新建」→ 落点幽灵（方向与 addChild 命令同源）；
  //    高亮「删除」→ 可见子树红虚描边。环开期间节点/视口被守卫冻结，按高亮派生一次即稳定。
  const radialPreview = useMemo(() => {
    const none: {
      ghost: { x: number; y: number; w: number; h: number; label: string } | null;
      dangerBoxes: Array<{ x: number; y: number; w: number; h: number }>;
    } = { ghost: null, dangerBoxes: [] };
    const sel = controller.selectedId;
    if (radial.state.phase !== 'ring' || radial.state.highlight === null || sel === null) return none;
    const item = itemAt(RADIAL_ITEMS_V1, radial.state.highlight);
    if (item?.id === 'add-child') {
      const nb = apiRef.current?.nodeBox(sel);
      if (!nb) return none;
      const parent = getNode(controller.root, sel);
      const dir = preDirsRef.current.get(sel) ?? (parent ? inferChildDir(parent) : null) ?? 'right';
      return {
        ghost: { ...ghostBoxOf(nb, dir, window.innerWidth, window.innerHeight), label: '新节点' },
        dangerBoxes: [],
      };
    }
    if (item?.id === 'delete') {
      return { ghost: null, dangerBoxes: apiRef.current?.subtreeBoxes(sel) ?? [] };
    }
    return none;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 环开期间布局冻结；高亮/选中变化即可重派生
  }, [radial.state.phase, radial.state.highlight, controller.selectedId]);

  // v1.3.0 幕布描述（note.desc）：正在编辑描述的节点 id + 已展开全文的节点集合
  const [descEditingId, setDescEditingId] = useState<string | null>(null);
  /**
   * S2 摘要两跳草稿：第一跳（菜单「创建摘要…」）登记的**范围起点**。
   *
   * 只存 id 不存坐标（与 linkDraft 不同）：第二跳是「点画布上的节点」，不需要浮层锚点。
   * 第二跳在 `onNodeClick` **首判**完成（与 E7 Shift 两连跳同族，计划 S-A4——不用
   * LinkCreator 候选面板）；点空白 / Esc / **文档替换** / 卸载均清草稿。
   *
   * R2：状态机**不再写在本组件里**，而是关在 `hooks/useSummaryHop.ts` —— 生产与测试
   * 消费同一份实现（此前测试内联复刻了一份，真实接线的回归无人守）。
   * R2 修复点：复位信号 = `documentToken`（文档替换事件），**不是** `controller` 身份
   * （切文档走 `reset` 复用同一 controller，身份不变 → 旧实现永不清理）。
   */
  const summaryHop = useSummaryHop({
    controller,
    setCommandNotice,
    draftResetToken: documentToken,
  });
  /**
   * 固定显示的 note 笔记：悬停只是预览，点击固定后保持只读。
   *
   * ⚠️ 存**索引路径**而不是节点 id：`buildEditable` 每次解析都会经 `astToEditable`
   * **重新生成 id** —— 若存 id，一编辑写回（文档重新解析）之前记的 id 就失效了，
   * 表现为"note 笔记一编辑就消失"。路径不受重新解析影响。
   */
  const [pinnedNotePaths, setPinnedNotePaths] = useState<NodePath[]>([]);
  const [editingNotePaths, setEditingNotePaths] = useState<NodePath[]>([]);
  /** 由路径换算出当前的节点 id（文档重建后自动跟上新 id） */
  const pinnedNoteIds = useMemo(
    () => pinnedNotePaths.map((path) => nodeAtPath(controller.root, path)?.id).filter(Boolean) as string[],
    [pinnedNotePaths, controller.root],
  );
  const editingNoteIds = useMemo(
    () => editingNotePaths.map((path) => nodeAtPath(controller.root, path)?.id).filter(Boolean) as string[],
    [editingNotePaths, controller.root],
  );
  const pinnedNoteIdSet = useMemo(() => new Set(pinnedNoteIds), [pinnedNoteIds]);
  const setPinnedNotePath = (path: NodePath, editing = false): void => {
    setPinnedNotePaths((prev) =>
      prev.some((p) => JSON.stringify(p) === JSON.stringify(path)) ? prev : [...prev, path],
    );
    if (editing) {
      setEditingNotePaths((prev) =>
        prev.some((p) => JSON.stringify(p) === JSON.stringify(path)) ? prev : [...prev, path],
      );
    }
  };

  // P1-T1：翻面态提升宿主 —— 会话态集合（不落盘；不顺手清——承 onBlankClick「不静默关面板」裁决口径）
  const [flippedNoteIds, setFlippedNoteIds] = useState<Set<string>>(() => new Set());
  /** Set → 数组（引用稳定化：仅集合变化时更新；MapView prop 形态 = readonly string[]） */
  const flippedNoteIdList = useMemo(() => [...flippedNoteIds], [flippedNoteIds]);
  const toggleNoteFlip = (id: string, next: boolean): void => {
    setFlippedNoteIds((prev) => {
      if (prev.has(id) === next) return prev; // 幂等：同值重复调用 → 原引用（不产生状态更新）
      const out = new Set(prev);
      if (next) out.add(id);
      else out.delete(id);
      return out;
    });
  };

  // E8：关系模式（模式隔离）——浏览态只呈现关系，关系态才暴露连线入口
  // （连接手柄 / Shift+点两节点 / 树边右键编辑 / 边点击编辑 / 右键「连线到…」）
  const [relationMode, setRelationMode] = useState(false);
  // R4-1：边右键菜单状态（渲染在 EdgeDraftLayer）
  const [edgeMenu, setEdgeMenu] = useState<EdgeContextMenuState | null>(null);

  // E5：画布级标注边——连线创建器（右键「连线到…」）+ 边编辑浮窗（点击边弹出）
  // 边存 root note.edges（文档级，非节点属性）；锚存路径，会话内解析
  const [linkDraft, setLinkDraft] = useState<{ sourceId: string; x: number; y: number } | null>(
    null,
  );
  // E6：树自然线关系内容编辑（note.via）+ 拖拽连接由 MapView 回调直驱
  const [treeEdgeEdit, setTreeEdgeEdit] = useState<{
    childId: string;
    x: number;
    y: number;
  } | null>(null);
  // 边（free edge）状态与操作的单一归属（T1 结构治理续，见 hooks/useEdgeActions）
  const edgeActions = useEdgeActions(controller);
  // 边编辑浮层用：TS 无法对 obj.prop 跨表达式收窄类型，取局部 const 让守卫生效
  const selEdgeOpen = edgeActions.selEdge;

  // E4：语义边行（面板哑渲染；文本 = 节点文本 / 实体锚名 / 原始锚文本兜底）
  const edgeItems = useMemo(() => {
    const textOf = (id: string): string => {
      const n = nodeById(controller.root, id);
      if (!n) return '';
      if (n.type === 'entity' && n.ref) return `@${n.ref.kind}:${n.ref.id}`;
      return n.text ?? '';
    };
    return edgeActions.freeEdges.map((e) => ({
      key: e.key,
      rel: e.rel,
      dir: e.dir,
      sourceId: e.sourceId ?? '',
      sourceText: e.sourceId ? textOf(e.sourceId) || e.from : e.from,
      targetId: e.targetId,
      targetText: e.targetId ? textOf(e.targetId) : e.to,
      // R0-3：锚定三态透传 → 面板按状态分区（悬空/陈旧不再与正常行混排）
      state: e.state,
      // R2-3：两端原始锚文本（重挂 picker 排除另一端防自关联）
      from: e.from,
      to: e.to,
      ...(e.invalidAt !== undefined ? { invalidAt: e.invalidAt } : {}),
      ...(e.source !== undefined ? { source: e.source } : {}),
    }));
  }, [edgeActions.freeEdges, controller.root]);

  // 批次 3：Ctrl+F 搜索面板 / Ctrl+D 大纲面板
  // S1：侧面板互斥收口——单态管理（search/outline/assets/relation），移动端不再浮层堆叠
  const [panel, setPanel] = useState<null | 'search' | 'outline' | 'assets' | 'relation'>(null);
  const togglePanel = (p: NonNullable<typeof panel>): void =>
    setPanel((cur) => (cur === p ? null : p));
  const searchOpen = panel === 'search';
  const outlineOpen = panel === 'outline';

  // FA2-T1：本地目录工作区（Obsidian 式「打开一个文件夹」）。
  // 挂载后文档读写直接走磁盘句柄，摆脱 localStorage 的 8 篇源码快照上限。
  const workspaceRef = useRef<DirectoryWorkspaceHost | null>(null);
  if (workspaceRef.current === null) workspaceRef.current = new DirectoryWorkspaceHost();
  const workspace = workspaceRef.current;
  const [workspaceReady, setWorkspaceReady] = useState(false);
  /** 当前文档在工作区内的相对路径（面包屑用；非工作区文档为 null） */
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);

  // 刷新页面后自动恢复上次的工作区（仅限已授权 granted 的句柄）
  useEffect(() => {
    let alive = true;
    void workspace.restore().then((ok) => {
      if (alive) setWorkspaceReady(ok);
    });
    return () => {
      alive = false;
    };
  }, [workspace]);

  /** 打开工作区里的真实文件：读磁盘内容 → 经 applyDoc 切换（带未保存守卫） */
  const openWorkspaceFile = useCallback(
    async (file: WorkspaceFile): Promise<boolean> => {
      const source = await workspace.readFile(file);
      setWorkspacePath(file.path);
      // handle 直接带上：后续 Ctrl+S / 自动保存走 createWritable() 静默写回磁盘
      return applyDoc({
        id: file.path,
        name: file.name,
        source,
        handle: file.handle,
        saved: true,
        ts: file.ts || Date.now(),
      });
    },
    [workspace, applyDoc],
  );

  /** 「打开本地文件夹」：唤起选择器（此处必有用户手势）并挂载 */
  const pickWorkspace = useCallback((): void => {
    void workspace.pick().then((ok) => {
      setWorkspaceReady(ok !== null);
    });
  }, [workspace]);

  /** 断开工作区：回到 localStorage 兼容模式 */
  const detachWorkspace = useCallback((): void => {
    void workspace.detach().then(() => {
      setWorkspaceReady(false);
      setWorkspacePath(null);
    });
  }, [workspace]);

  // 批次 4：Ctrl+Shift+A 图库面板（资产实体化；点资产 → 插入 @img/@draw 引用到选中节点下）
  // 图库资产宿主（P0）：清单/解析/上传全部经宿主注入；demo 宿主 = 打包资产 + objectURL 会话上传
  const assetHostRef = useRef<AssetHost | null>(null);
  // FA2-T4：包一层工作区宿主 —— 挂载工作区后大资产写进磁盘 ./assets/（相对路径引用），
  // 未挂载时完全退回 IndexedDB（行为不变）。用 getter 传工作区：挂载发生在宿主创建之后。
  if (assetHostRef.current === null) {
    assetHostRef.current = new WorkspaceAssetHost(
      new IdbAssetHost(DEMO_ASSETS, '/'),
      () => workspace,
    );
  }
  const assetHost = assetHostRef.current;

  // 文档库（文件管理的索引层）：只登记已落盘的文档，
  // 新建未保存的不进库（否则关掉就留下一堆空条目）。
  const libraryRef = useRef<DocLibrary | null>(null);
  if (libraryRef.current === null) {
    const lib = new DocLibrary();
    lib.ensurePresetFolders();
    libraryRef.current = lib;
  }
  const library = libraryRef.current;

  // 文档落盘 → 登记进文档库（文件管理的索引来源）。
  // 只在 saved 时登记：新建未保存的文档不进库，否则关掉就留下一堆空条目。
  // E 批口径：快照读 savedSource（最近一次成功保存的内容）；保存路径不得改写 doc.source ——
  // 见 docs/dispatch/2026-09-13-edit-flow-session-integrity-plan.md
  useEffect(() => {
    if (doc.saved) {
      library.upsert({
        id: doc.id,
        name: doc.name,
        source: doc.savedSource ?? doc.source,
        folder: doc.id === 'gateway.mm.md' ? '示例导图' : undefined,
      });
    }
  }, [doc.id, doc.name, doc.savedSource, doc.source, doc.saved, library]);
  // 异步清单（宿主可换 HTTP/FS 实现）；插入/上传后由 Stage 更新本地副本
  const [assetList, setAssetList] = useState<AssetItem[]>([]);

  // 图库上传（P1-1）：上传按钮 / 面板拖拽 / 画布 drop 共用的「入清单」原语（不插节点）
  const uploadToGallery = useCallback(async (file: File) => {
    const item = await assetHost.uploadAsset(file);
    setAssetList((prev) => (prev.some((a) => a.id === item.id) ? prev : [...prev, item]));
    return item;
  }, [assetHost]);

  // B3：失效诊断入解析层——parse 诊断 + 资产缺失诊断（清单更新后自动重算）
  const allDiags = useMemo(
    () => [...data.diagnostics, ...assetDiagnostics(refs, assetList)],
    [data, refs, assetList],
  );

  // R0-2：边健康度（观测先行）——随树重算；坏边计数/明细供诊断条呈现（全健康不渲染）
  const edgeHealth = useMemo(() => edgeHealthOf(controller.root), [controller.root]);
  // R6-S1b：畸形项行（口径单一来源：edgeHealthOf.problems 过滤 malformed——面板不扫原始数组）
  const malformedRows = useMemo(
    () => edgeHealth.problems.filter((p) => p.malformed === true).map((p) => p.index),
    [edgeHealth],
  );

  useEffect(() => {
    let alive = true;
    void assetHost.listAssets().then((list) => {
      if (alive) setAssetList(list);
    });
    return () => {
      alive = false;
    };
  }, [assetHost]);

  const assetOpen = panel === 'assets';
  // F1：实体关系图谱面板（Ctrl+Shift+R）
  const relationOpen = panel === 'relation';

  // 主题字体度量 → 布局（树 / 折叠 / 展开 / 主题字体任一变化重排）
  // 关键：依赖 controller.root（不可变引用）而非 controller（引用稳定）——编辑后布局必须重算
  //
  // MEASURE-RANK：按**视觉档**分档度量（root/branch/leaf 三档字号，字重无关）。
  // 叶卡不再用 branch 字号量（白边约 25% 的根源），整体盒随之收紧 → fit k 回升、
  // LOD 文字更晚被省。`charOf` 与传给 MapView 的是**同一份**（观察/命中与绘制同源）。
  const charOf = useMemo(() => createRankedCharMeasure(token.font), [token.font]);
  const char = useMemo(() => charOf('branch'), [charOf]);
  // M5-T6 增量布局：缓存实例跨编辑复用（折叠/度量键变化时内核自动作废重算，结果恒等于全量）
  const layoutCacheRef = useRef<LayoutCache | null>(null);
  if (layoutCacheRef.current === null) layoutCacheRef.current = new LayoutCache();

  // G6″：文档级中心标注 → 布局岛视图（A3-2：specs + 跨岛边界边 + 中心诊断）。
  // 无标注时 specs 为 null，回退既有的单树 layoutMindmap 路径（行为完全不变）。
  const islandView = useMemo(
    () => buildIslandView(controller.root, collectCenters(controller.root)),
    [controller.root],
  );
  const centerSpecs = islandView.specs;

  /** G6′：中心节点 id 集合（MapView 据此把拖拽解释为「移动坐标」而非改树结构）。
   *  与布局同源（islandView.specs = projectIslands 投影结果）——布局忽略的
   *  中心不得进入手势，否则深层中心「能拖但布局不认」，拖拽变成无效写坐标。 */
  const centerIds = useMemo(() => {
    const s = new Set<string>();
    for (const c of centerSpecs ?? []) s.add(c.node.id);
    return s;
  }, [centerSpecs]);

  /**
   * ROOT-DRAG-1：「**可拖中心**」= 有 center 条目的 well-formed 中心（不含文档根）。
   *
   * 与 centerIds 的分工：centerIds = 布局岛根（含虚拟根岛，供布局/命中/总览口径）；
   * 本表只管「拖拽 = 移动坐标」的判定与提交校验 —— 虚拟根岛没有 center 条目，
   * 拖它/拖根锚 Section 标题不得写 note（此前经 handleCenterMove 的 at 兜底分支
   * 新建根条目 = 静默升格，绕过 planPromoteCenter 的 is-root 守卫）。
   * 契约见 docs/dispatch/2026-09-17-root-drag-guard-dispatch-prompt.md。
   */
  const centerEntryIds = useMemo(() => {
    const s = new Set<string>();
    for (const c of collectCenters(controller.root)) {
      if (c.nodeId !== null && c.state === 'well-formed' && c.nodeId !== controller.root.id) {
        s.add(c.nodeId);
      }
    }
    return s;
  }, [controller.root]);

  /** C4：中心角标标题（nodeId → 「中心（doc#cid）」；无 cid 旧数据只写「中心」）。
   *  依赖 controller.root（不可变引用）：升格/降格/改名后 root 换代 → 标题重算。
   *  本表**即角标渲染条件**（真实中心事实；不用 centerIds——它含布局输出所需的根岛根）；
   *  仅 well-formed 中心进入（与布局/拖拽同源纪律：布局忽略的中心不标角标）。 */
  const centerTitles = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of collectCenters(controller.root)) {
      if (c.nodeId === null || c.state !== 'well-formed') continue;
      m.set(c.nodeId, c.cid ? `中心（${doc.name}#${c.cid}）` : '中心');
    }
    return m;
  }, [controller.root, doc.name]);

  const layout = useMemo(
    () =>
      layoutDemo(
        controller.root,
        entities,
        char,
        controller.collapsed,
        expandedQaId,
        layoutCacheRef.current!,
        // 度量语义键：字体/实体规模/展开态/描述编辑目标任一变化 → 键变 → 缓存作废（结果恒等于全量）
        //
        // descEditingId **必须入键**（2026-09-04 修正）：早期为了"进入/退出编辑零重排"
        // 刻意不入键，代价是新建描述时 measure 不预留编辑区 → 节点盒不扩张、
        // 编辑框只能浮出在节点下方（用户反馈：按 Shift+Enter 看不到节点长出编辑区）。
        //
        // 修正后的重排成本：**进入/退出编辑各一次**（用户主动操作，可接受）；
        // 键入过程中 descEditingId 不变 → 键不变 → 不重排。
        // 这与当初"避免每敲一字就重排"的诉求并不冲突。
        //
        // MEASURE-RANK：键必须含**分档字号全量**（sizeRoot / sizeLeaf / 三档字重）——
        // 度量自本批起按视觉档分档，只盯 size 会在换主题（如 size/leaf 同时变）时漏判。
        `${token.font.family}|${token.font.size}|${token.font.sizeRoot ?? ''}|${token.font.sizeLeaf}|${token.font.weight}|${token.font.weightRoot}|${token.font.weightLeaf ?? ''}|${entities.size}|${expandedQaId ?? ''}|${descEditingId ?? ''}|${idsMeasureKey(pinnedNoteIdSet)}`,
        // 让正在编辑描述的节点在布局里预留编辑区（节点自己扩张，而不是浮出遮挡）
        descEditingId,
        pinnedNoteIdSet,
        centerSpecs,
        // 档位度量：与 MapView charOf 同一份（布局盒 = 渲染字号同一事实源）
        charOf,
      ).layout,
    [
      controller.root,
      entities,
      char,
      charOf,
      controller.collapsed,
      expandedQaId,
      token.font,
      descEditingId,
      pinnedNoteIdSet,
      centerSpecs,
    ],
  );

  /**
   * 提交节点文本（Enter / Tab 共用）。
   * 返回 true 表示已转入实体 picker（`@` 查询）——调用方不应再做后续动作。
   */
  const commitNodeText = (id: string, text: string): boolean => {
    const t = text.trim();
    // N4：转义输入（@@ / \@）→ 落为纯文本 @ 内容（不触发 picker）
    if (isEscapedEntityInput(t)) {
      controller.commitEdit(id, unescapeEntityInput(t));
      return false;
    }
    // M1：以 @ 开头 → 不落文本，转实体 picker（查询串 = @ 后内容）
    if (t.startsWith('@')) {
      controller.cancelEdit();
      setPicker({ nodeId: id, query: t.slice(1).trim(), current: null });
      return true;
    }
    controller.commitEdit(id, text);
    return false;
  };

  /**
   * G6′：中心拖拽落库。
   *
   * 起点取 note 里的既有坐标；若中心尚未落过坐标（自动排列中），
   * 则用它在当前布局里的位置作为起点 —— 否则第一次拖动会瞬移到原点附近。
   */
  const handleCenterMove = useCallback(
    (id: string, worldDx: number, worldDy: number) => {
      const centers = collectCenters(controller.root);
      const nested = islandView.nestedCenterIdsByRoot.get(id) ?? [];
      const moveIds = [id, ...nested];
      let note = controller.root.note;
      let touched = false;
      for (const moveId of moveIds) {
        const cur = centers.find((c) => c.nodeId === moveId);
        // ROOT-DRAG-1：无既有 center 条目 → 跳过（虚拟根岛等）。此前 `at` 兜底会为根
        // 新建条目 = 静默升格（绕过 is-root 守卫）——此处为提交层兜底，禁止再写。
        if (cur === undefined) continue;
        const at = cur.at;
        const ln = layout.nodes.find((n) => n.node.id === moveId);
        const baseX = cur.pos?.x ?? (ln ? ln.box.x + ln.box.w / 2 : 0);
        const baseY = cur.pos?.y ?? (ln ? ln.box.y + ln.box.h / 2 : 0);
        note = upsertCenter(note, at, {
          x: baseX + worldDx,
          y: baseY + worldDy,
        });
        touched = true;
      }
      // ROOT-DRAG-1：全部跳过（零写入）→ 早退：不触碰 note、不产生 history 条目。
      // 必要性：守卫引入后 `note` 保持 undefined 成为可达运行态（根无 note 时旧式
      // `note.centers` 会 TypeError）——本函数要求「跳过 = 零副作用」，而非崩溃或空写。
      if (!touched) return;
      controller.updateNote(controller.root.id, { centers: note?.centers ?? undefined });
    },
    [controller, layout, islandView.nestedCenterIdsByRoot],
  );

  // A5（G2）：切断并独立——命令层 planCutTreeEdge 产出事务 ops（move + detached + 引用迁移），
  // applyTransaction 原子提交；pos 取当前布局盒中心，防切断后首次落位跳变。
  // PROMOTE-SEED-1：取点抽到共享 layoutBoxCenterOf（与升格落点同口径；行为不变）。
  const handleCutTreeEdge = useCallback(
    (childId: string) => {
      const pos = layoutBoxCenterOf(layout, childId);
      const plan = planCutTreeEdge(controller.root, childId, { pos });
      if (!plan.ok) {
        setCommandNotice(plan.error.message);
        return;
      }
      // R0-4：迁移诊断不再被吞——「本来就是坏」的引用保留原值时给用户可见提示（不阻断）
      if (plan.diagnostics.length > 0) setCommandNotice(summarizeReferenceDiagnostics(plan.diagnostics) ?? null);
      const result = controller.applyTransaction(plan.ops);
      if (!result.ok) setCommandNotice(`切断未提交：${result.error.message}`);
    },
    // R1-4：setCommandNotice 现为 props 透传（状态提升至 StageInner）→ 进依赖数组
    [controller, layout, setCommandNotice],
  );

  // A5：命令拒绝/事务失败的告警状态声明已上移至 controller 构造之前（R1-4 锚迁移冲突复用）
  // ② 二级环（T5）：动作袋构建一次，右键菜单与环席位消费**同一份**（单一动作源，防两处漂移）
  const nodeBagHost = {
    setDescEditingId,
    setPinnedNotePath,
    onAttachError: setCommandNotice,
    // PROMOTE-SEED-1：升格落点 = 升格前布局盒中心（无盒 → undefined → 不传 pos）。
    // nodeBagHost 每次渲染重建（无 memo），闭包捕获当帧 layout，无陈旧引用。
    layoutPosOf: (id: string) => layoutBoxCenterOf(layout, id),
    // S2：摘要第一跳——登记范围起点并提示点选末成员（第二跳在 onNodeClick 首判完成）
    onStartSummary: (id: string) => {
      summaryHop.start(id);
    },
  };
  const nodeBags = {
    descActions: makeDescActions(nodeBagHost),
    noteActions: makeNoteActions(controller, nodeBagHost),
    centerActions: makeCenterActions(controller, doc.name, nodeBagHost),
    summaryActions: makeSummaryActions(nodeBagHost),
  };
  nodeBagsRef.current = nodeBags; // 渲染期同步进 ref（`getSubModel` 到 Alt 按下才读）

  /**
   * S2：第二跳——以草稿起点与本次点中的节点为范围建摘要。
   *
   * R2 起本组件**不再自持状态机**：实现与判据（含同步消费闸门）在
   * `hooks/useSummaryHop.ts` —— 生产与测试消费同一份，杜绝「测试测的是复刻体」。
   */
  const completeSummaryAt = summaryHop.completeAt;

  useEffect(() => {
    if (commandNotice === null) return;
    const timer = setTimeout(() => setCommandNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [commandNotice]);

  // R5-3：Canvas 自动降级提示——stats.backend 由 MapView 上报（已并入材料字段：
  // 后端变化必然触发一次上报，节流窗口内补报）。同一文档只提示一次；切文档后重新允许。
  useCanvasDegradeNotice({ backend: stats?.backend, docId: doc.id, notify: setCommandNotice });

  /**
   * v1.5.0 Section 写入管线（T4）。
   *
   * D1 裁决：Section ⇒ center（不变量）。三条路径统一保证「root 锚落 cid + center 条目存在」：
   * - onMark（已是 center）：复用 center 条目既有 cid → 只写 sections，单条 undo；
   *   退化情形（手写 YAML 的 center 无 cid）补分配并同批写回节点 note（仍单条 undo）；
   * - onPromoteAndMark（非 center）：复用 planPromoteCenter 的 cid 分配 + center 条目，
   *   再把 sections 并入**同一批 ops 的 root note patch**（一次 Ctrl+Z 撤回整件事）；
   * - onUnmark：只删 sections 条目，**不动树、不动 center**（降格是独立动作，仍归「取消中心」）。
   *
   * 全程走 controller.applyTransaction / updateNote（TreeOp + OpHistory），与 center 写入通道同构。
   */
  const sectionActions = useMemo(() => {
    return {
      sectionOf: (id: string): string | undefined => {
        const at = anchorOfNode(controller.root, id);
        if (!at) return undefined;
        return resolveSections(controller.root).find((s: ResolvedSection) => s.rootId === id)?.spec
          .id;
      },
      onMark: (id: string): void => {
        const at = anchorOfNode(controller.root, id);
        if (!at) return;
        // D1 守卫：非 center 不得直接标记（手写 YAML 可能造出这种态，此处不放大）
        const center = collectCenters(controller.root).find((c: Center) => c.at === at);
        if (!center) return;
        const root = controller.root;
        const node = getNode(root, id);
        let rootNote: Note = root.note ?? {};
        let nodeNote: Note | undefined = node?.note;
        let cid = center.cid;
        if (cid === undefined) {
          const ensured = ensureNodeCid(rootNote, nodeNote);
          rootNote = ensured.rootNote;
          nodeNote = ensured.nodeNote;
          cid = ensured.cid;
        }
        const labeled = upsertSection(rootNote, {
          id: makeSectionId(),
          root: `cid:${cid}`,
          color: DEFAULT_SECTION_COLOR,
          ...(node ? { title: getNodeLabel(root, id) } : {}),
        });
        // cid 是新分配的 → 节点 note 也要落库（两条 update-node 同批，单条 undo）
        if (nodeNote !== node?.note) {
          const ops: TreeOp[] = [
            { type: 'update-node', id: root.id, patch: { note: labeled } },
            { type: 'update-node', id, patch: { note: nodeNote } },
          ];
          const result = controller.applyTransaction(ops);
          if (!result.ok) setCommandNotice(`Section 未提交：${result.error.message}`);
          return;
        }
        controller.updateNote(root.id, { sections: labeled.sections ?? undefined });
      },
      onPromoteAndMark: (id: string): void => {
        // PROMOTE-SEED-1：与 onPromote 同口径——升格前布局盒中心作落点；无盒不传 pos
        const pos = layoutBoxCenterOf(layout, id);
        const plan = planPromoteCenter(controller.root, id, {
          dir: 'right',
          ...(pos !== undefined ? { pos } : {}),
        });
        if (!plan.ok) {
          setCommandNotice(plan.error.message);
          return;
        }
        // 合并：把 sections 并入 plan 中已存在的 root update-node patch（单条 undo）
        const ops: TreeOp[] = plan.ops.map((op: TreeOp): TreeOp => {
          if (op.type !== 'update-node' || op.id !== controller.root.id) return op;
          const note = op.patch.note ?? {};
          const labeled = upsertSection(note, {
            id: makeSectionId(),
            root: `cid:${plan.cid}`,
            color: DEFAULT_SECTION_COLOR,
            title: getNodeLabel(controller.root, id),
          });
          return { ...op, patch: { ...op.patch, note: labeled } };
        });
        const result = controller.applyTransaction(ops);
        if (!result.ok) setCommandNotice(`Section 未提交：${result.error.message}`);
      },
      onUnmark: (id: string): void => {
        const sec = resolveSections(controller.root).find(
          (s: ResolvedSection) => s.rootId === id,
        );
        if (!sec) return;
        const next = removeSection(controller.root.note, sec.spec.id);
        controller.updateNote(controller.root.id, { sections: next.sections ?? undefined });
      },
    };
    // PROMOTE-SEED-1：onPromoteAndMark 读 layout 取落点 → layout 进依赖（防陈旧槽位）
  }, [controller, setCommandNotice, layout]);

  // 导出（SVG / PNG）—— 依赖 layout，故在其定义之后调用
    // A6/T23：boundaryLinks 补线随导出（islandView.boundaryLinks 已按 parent_link 过滤）
    // S4：root 随导出 → 摘要括线进 SVG/PNG（与画布同源几何；无摘要文档零差异）
    const { handleExport, handleExportPng } = useExportActions({
      layout,
      token,
      docName: doc.name,
      boundaryLinks: islandView.boundaryLinks,
      root: controller.root,
      onNotice: setCommandNotice, // A-D2：PNG 降级提示走命令告警条（替代被 webview 静默吞掉的 alert）
    });

    // A6/T23 Canvas 门禁：含中心岛（跨岛父子连接）或自由边的文档仅 SVG 后端完整支持
    // → 显式 forceBackend='svg' 压过 >50K 自动 Canvas 降级，不静默丢岛/边；
    //   纯树文档保持既有降级策略（Canvas 大图性能路径）不变。
    //
    // 验收入口（VERIFY-CANVAS）：`?backend=canvas` / `?backend=svg` 显式指定后端，
    // 供真浏览器矩阵核对 Canvas 纯树后端的身份与渲染（自动降级阈值 5 万节点在浏览器里不可达）。
    // 纯只读覆盖：**无参数时上面两条门禁逐字不变**，也不进任何产品 UI。
    const forceBackend = useMemo<'svg' | 'canvas' | undefined>(() => {
      if (centerSpecs !== null) return 'svg';
      if (edgeActions.freeEdges.length > 0) return 'svg';
      const forced =
        typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('backend');
      if (forced === 'canvas' || forced === 'svg') return forced;
      return undefined;
    }, [centerSpecs, edgeActions.freeEdges]);

  // 全局快捷键（editing 时输入框自行拦截；此处只处理画布层）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (controller.editingId !== null) return; // 输入框内：stopPropagation 已在 OverlayEditor
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return; // 搜索/批注输入框内不触发画布快捷键
      // v1.8.0：环形菜单状态机优先（Alt 蓄力/出环中的方向键漫游、Enter/Esc、二次确认）——未消费落回既有键位
      if (radialKeyRef.current(e)) return;
      const sel = controller.selectedId;
      // 预方向：Alt+方向键（会话级预设；生长时 Tab/Enter 才把它固化进新节点 note.dir）。
      // 快捷键清单见 ShortcutHelpPanel（'?'）；事后改向走右键「生长方向」。
      const preDir = matchPreDirKey(e);
      if (preDir !== null) {
        if (!sel) return;
        e.preventDefault();
        preDirsRef.current = new Map(preDirsRef.current).set(sel, preDir);
        setPreDirHint({ id: sel, dir: preDir }); // 视觉反馈：让用户看见「已设方向」
        return;
      }
      const act = matchEditorKey(e);
      if (!act) return;
      switch (act.type) {
        case 'add-child':
          if (!sel) return;
          e.preventDefault();
          {
            // 生长固化：预方向 → 否则按兄弟多数/父方向推断 → 都没有则不写（走继承）
            const parent = getNode(controller.root, sel);
            const dir = preDirsRef.current.get(sel) ?? (parent ? inferChildDir(parent) : null);
            const id = controller.addChild(sel, undefined, dir ? { dir } : undefined);
            controller.select(id);
            controller.startEdit(id);
          }
          return;
        case 'add-sibling': {
          if (!sel) return;
          e.preventDefault();
          // G6′ 触发一致性：同级生长也走推断（参照兄弟的显式方向参与多数票）
          const loc = findNode(controller.root, sel);
          const sibDir = loc ? inferChildDir(loc.parent) : null;
          const id = controller.addSibling(sel, undefined, sibDir ? { dir: sibDir } : undefined);
          if (id !== null) {
            controller.select(id);
            controller.startEdit(id);
          }
          return;
        }
        case 'delete':
          if (!sel) return;
          e.preventDefault();
          // 直删（裁决 M2：原生 confirm 退役——IDE 内嵌 webview 会**静默吞掉**原生对话框：
          // 不是「弹窗被拒」而是 confirm 恒返回 false → 表现为「不弹气泡也删不掉」）。
          // 撤销（Ctrl+Z）兜底；根节点由 controller.removeNode 守卫（返回 false，不动）。
          controller.removeNode(sel);
          controller.select(null);
          return;
        case 'edit':
          if (!sel) return;
          e.preventDefault();
          controller.startEdit(sel);
          return;
        case 'desc': {
          // Shift+Enter：切换「主题 ↔ 描述」编辑（幕布 Shift+Enter 语义）
          if (!sel) return;
          e.preventDefault();
          if (descEditingId === sel) {
            // 已在描述编辑 → 回到主题文本编辑
            setDescEditingId(null);
            controller.startEdit(sel);
          } else {
            // 进入描述编辑（无描述 = 新建；有描述 = 编辑）
            controller.cancelEdit();
            setDescEditingId(sel);
          }
          return;
        }
        case 'collapse':
          if (!sel) return;
          e.preventDefault();
          controller.toggleCollapse(sel);
          return;
        case 'undo':
          e.preventDefault();
          controller.undo();
          return;
        case 'redo':
          e.preventDefault();
          controller.redo();
          return;
        case 'save':
          e.preventDefault();
          void handleSave();
          return;
        case 'open':
          e.preventDefault();
          void handleOpen();
          return;
        case 'new':
          e.preventDefault();
          handleNew();
          return;
        case 'indent':
          if (!sel) return;
          e.preventDefault();
          controller.indent(sel);
          return;
        case 'outdent':
          if (!sel) return;
          e.preventDefault();
          controller.outdent(sel);
          return;
        case 'navigate': {
          if (!sel) return;
          e.preventDefault();
          // 几何导航（A 档）：按视觉方向取最近可见节点——↕ 不再穿子树、↔ 不再与 ↕ 同义；
          // 目标不可见时由 MapView 内部最小推入视口（不居中、不改 k）。选中态在此写入。
          const target = apiRef.current?.navigateFrom(sel, act.dir) ?? null;
          if (target !== null) controller.select(target);
          return;
        }
        case 'fold':
          if (!sel) return;
          e.preventDefault();
          controller.setCollapsed(sel, true);
          return;
        case 'unfold':
          if (!sel) return;
          e.preventDefault();
          controller.setCollapsed(sel, false);
          return;
        case 'reset-zoom':
          e.preventDefault();
          apiRef.current?.resetZoom();
          return;
        case 'help':
          e.preventDefault();
          setHelpOpen((v) => !v);
          return;
        case 'search':
          e.preventDefault();
          togglePanel('search');
          return;
        case 'outline':
          e.preventDefault();
          togglePanel('outline');
          return;
        case 'assets':
          e.preventDefault();
          togglePanel('assets');
          return;
        case 'relation':
          e.preventDefault();
          togglePanel('relation');
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller]);

  // beforeunload 守卫：未保存变更 / 未提交草稿 / 写入进行中 时拦截离开（T2 + MODE-GUARD）。
  // 原生能力，不在 unload 里弹自定义异步模态（浏览器不允许）。
  useEffect(
    () =>
      installBeforeUnload(
        () => controller.dirty || saveSession.isSaving() || hasPendingDraft(),
      ),
    [controller, saveSession],
  );

  // E3：边编辑/连线创建浮窗 Esc 关闭
  useEffect(() => {
    if (!linkDraft && !edgeActions.edgeSel && !treeEdgeEdit) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setLinkDraft(null);
        edgeActions.setEdgeSel(null);
        edgeActions.clearEdgeMulti();
        setTreeEdgeEdit(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [linkDraft, edgeActions.edgeSel, treeEdgeEdit, edgeActions.clearEdgeMulti]);

  // S2：摘要草稿的清理（Esc；空白点击在 onBlankClick；文档替换/卸载在 useSummaryHop 内部）。
  //
  // 为什么与上面的连线浮窗分开：那条 effect 的依赖是「浮窗开着」的布尔组合，
  // 且清的是连线状态；摘要草稿是独立等待态，混进去会让连线 Esc 语义被摘要牵连。
  // Esc 判定走 hook 的同步真理源（不受渲染时机影响）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') summaryHop.cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [summaryHop]);

  /**
   * R3-(b)：**真实挂载**测试观测口（**仅测试构建**，见 `testBuild.ts`）。
   *
   * 为什么需要：`summary-two-hop.test.tsx` 驱动的是 `useSummaryHop`（生产与测试共同消费
   * 的 hook），但它本身不挂载 `MindmapStage` —— 「`onNodeClick` 首判真的接在前面」
   * 这条装配契约没有证据。本句柄把**已挂载的真实实例**（同一 controller / 同一 hook /
   * 同一布局）暴露给测试，让测试走真实节点卡命中 + 真实菜单 + 真实点击派发，
   * 而不是复刻链路（复刻体改了生产不会红）。
   *
   * ## 隔离（S2 收口要求）
   *
   * 整个块被 `IS_TEST_BUILD` 包住，而它是**构建期常量**：生产 `vite build` 注入
   * `false` → Rollup 判死并 tree-shake → 生产产物中既无注册语句也无该全局名。
   * 不用 `NODE_ENV`、也不用 `typeof window` 冒充隔离（前者本仓未明确判断，
   * 后者在浏览器生产环境同样为真）。
   *
   * ## 归属（按实例）
   *
   * 注册时把**本实例写下的句柄**存进 `installedHandleRef`；清理时只有当前全局值
   * 仍 === 本实例句柄才删除。多实例（测试里先后 render 两个 Stage）并存时，
   * 先卸载的那个不会误删后挂载实例的入口。
   *
   * ## 只读观测 vs 操作入口（两类要分清）
   *
   * - `observe`：纯读快照与只读事实（草稿、令牌、选中、根）——测试据此断言生产事实；
   * - `actions`：会**改变文档状态**的真实入口（`replaceDoc` 经生产 `applyDoc`，
   *   `undo/redo` 经生产 `controller`）。它们不是旁路：调用它们与用户操作走同一条
   *   生产代码路径。
   *
   * 写法：**渲染期直接刷新**（不是 effect）—— handle 读的是当帧最新值，effect 版本会
   * 因依赖数组变化频繁跑 cleanup，留下「删除→重建」空窗，测试在空窗里读到 undefined。
   */
  if (IS_TEST_BUILD && typeof window !== 'undefined') {
    const handle: MindcanvasSummaryHostHandle = {
      observe: {
        summaryDraft: summaryHop.draft,
        hasDraft: summaryHop.hasDraft,
        documentToken,
        selectedId: controller.selectedId,
        root: controller.root,
        layoutReady: layout !== null,
      },
      actions: {
        undo: () => controller.undo(),
        redo: () => controller.redo(),
        /**
         * 直接经生产的 `applyDoc` 替换文档。
         *
         * 为什么需要它而不是只走「最近」菜单：**同内容替换**（重开同一文件）下
         * `doc` 换了但树逐字相同 —— 本入口让测试能构造「文档整体换了」这一事件，
         * 从而把 R2 的判据（替换事件令牌 vs 内容比较）真正区分开。
         */
        replaceDoc: (next: MindDoc) => applyDoc(next),
      },
    };
    installedHandleRef.current = handle;
    window.__mindcanvasSummaryHost = handle;
  }
  // 卸载清理：**按实例归属**——只有全局值仍是本实例写的句柄时才删，
  // 避免「一个实例卸载删掉另一个实例的入口」（多实例并存的测试场景）。
  useEffect(
    () => () => {
      if (IS_TEST_BUILD && installedHandleRef.current !== null) {
        if (window.__mindcanvasSummaryHost === installedHandleRef.current) {
          delete window.__mindcanvasSummaryHost;
        }
        installedHandleRef.current = null;
      }
    },
    [],
  );

  if (!layout) return null;

  const selectedTitle =
    selected?.type === 'entity' ? (selected.ref?.id ?? '') : (selected?.text ?? '');
  const noteSections = selected?.note ? formatNote(selected.note) : [];

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {/* 工具条：玻璃 chrome（恒定）+ 保存/dirty 指示 */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 16px',
          borderRadius: CHROME.radius,
          background: CHROME.panelBg,
          border: `1px solid ${CHROME.panelBorder}`,
          boxShadow: CHROME.shadow,
          backdropFilter: 'blur(14px) saturate(1.3)',
          color: CHROME.text,
          fontFamily: CHROME.fontFamily,
          fontSize: CHROME.fontSize,
          zIndex: 2,
        }}
      >
        <span style={{ color: CHROME.neon, fontWeight: 600, letterSpacing: 0.5 }}>mindcanvas</span>
        <span style={{ color: CHROME.textMuted }}>·</span>
        <ThemeSwitcher />
        <span
          title="插件运行时（T5 样例：DemoPlugin 已注册 session kind / ai_role 语义键 / qa-badge 渲染器）"
          style={{
            color: pluginActive ? CHROME.neon : CHROME.textMuted,
            fontSize: CHROME.fontSizeSmall,
          }}
        >
          {pluginActive ? '◆ 插件已载' : '◆ 纯文本版'}
        </span>
        <span
          data-save-state
          style={{
            color: saving ? CHROME.neon : controller.dirty ? CHROME.warn : CHROME.textMuted,
            fontSize: CHROME.fontSizeSmall,
            minWidth: 34,
            transition: 'color .18s ease',
          }}
          title={
            saving
              ? '正在写入磁盘'
              : controller.dirty
                ? '有未保存变更（300ms 后自动落盘）'
                : doc.handle
                  ? `已保存到 ${doc.name}`
                  : '已保存（尚未绑定文件）'
          }
        >
          {saving ? '保存中…' : controller.dirty ? '● 未保存' : '✓ 已保存'}
        </span>
        <button
          onClick={() => apiRef.current?.fit()}
          style={{
            border: `1px solid ${CHROME.panelBorderStrong}`,
            background: 'transparent',
            color: CHROME.text,
            borderRadius: CHROME.radiusSmall,
            padding: '4px 12px',
            fontSize: CHROME.fontSizeSmall,
            fontFamily: CHROME.fontFamily,
            cursor: 'pointer',
          }}
        >
          适配视图
        </button>
        <button
          onClick={() => togglePanel('assets')}
          style={{
            border: `1px solid ${CHROME.panelBorderStrong}`,
            background: 'transparent',
            color: assetOpen ? CHROME.neon : CHROME.text,
            borderRadius: CHROME.radiusSmall,
            padding: '4px 12px',
            fontSize: CHROME.fontSizeSmall,
            fontFamily: CHROME.fontFamily,
            cursor: 'pointer',
          }}
        >
          图库
        </button>
        <button
          onClick={() => togglePanel('relation')}
          style={{
            border: `1px solid ${CHROME.panelBorderStrong}`,
            background: 'transparent',
            color: relationOpen ? CHROME.neon : CHROME.text,
            borderRadius: CHROME.radiusSmall,
            padding: '4px 12px',
            fontSize: CHROME.fontSizeSmall,
            fontFamily: CHROME.fontFamily,
            cursor: 'pointer',
          }}
        >
          关系
        </button>
        {/* E8：模式隔离——浏览 / 关系编辑 二分态（连线入口仅在关系态暴露） */}
        <button
          data-relation-mode
          onClick={() => {
            const next = !relationMode;
            setRelationMode(next);
            // 退出关系态 → 收起所有关系编辑浮窗（避免浮窗悬空在浏览态）
            if (!next) {
              setLinkDraft(null);
              edgeActions.setEdgeSel(null);
              edgeActions.clearEdgeMulti();
              setTreeEdgeEdit(null);
            }
          }}
          title={
            relationMode
              ? '关系模式（编辑中）：拖手柄连线 · Shift+点两节点连线 · 右键树边编辑 · 点击连线编辑。点击切回浏览模式'
              : '浏览模式：画布只呈现已有关系。点击切到关系模式后可添加/编辑连线'
          }
          style={{
            border: `1px solid ${relationMode ? CHROME.neon : CHROME.panelBorderStrong}`,
            background: relationMode ? CHROME.neonSoft : 'transparent',
            color: relationMode ? CHROME.neon : CHROME.text,
            borderRadius: CHROME.radiusSmall,
            padding: '4px 12px',
            fontSize: CHROME.fontSizeSmall,
            fontFamily: CHROME.fontFamily,
            cursor: 'pointer',
          }}
        >
          {relationMode ? '✦ 关系模式' : '○ 浏览模式'}
        </button>
        <button
          onClick={() => {
            controller.undo();
          }}
          disabled={!controller.canUndo}
          style={btnStyle(controller.canUndo)}
        >
          ↶
        </button>
        <button
          onClick={() => {
            controller.redo();
          }}
          disabled={!controller.canRedo}
          style={btnStyle(controller.canRedo)}
        >
          ↷
        </button>
        <button
          onClick={() => {
            void handleSave();
          }}
          style={{
            border: 'none',
            background: CHROME.neonSoft,
            color: CHROME.neon,
            borderRadius: CHROME.radiusSmall,
            padding: '4px 14px',
            fontSize: CHROME.fontSizeSmall,
            fontFamily: CHROME.fontFamily,
            cursor: 'pointer',
          }}
        >
          保存
        </button>
      </div>

      <MapView
        layout={layout}
        // G6′复审修复：自由边/折叠路由必须读完整文档树（森林布局有多个几何根）
        documentRoot={controller.root}
        // v1.7.0：拖共享梁松手 → 写 lens[dir]（单条 undo；其余方向键保留，
        // 子节点自身 len 的覆盖关系由内核口径保证）
        // v1.11.0 双把手：主干（bias）写 beamAt[dir]——单字段分流见 beamEdit.applyBeamCommit
        onBeamChange={(fromId, commit) => applyBeamCommit(controller, fromId, commit)}
        boundaryLinks={islandView.boundaryLinks}
          // A6/T23 门禁：岛/自由边文档强制 SVG（见上方 forceBackend memo）
          forceBackend={forceBackend}
        entities={entities}
        char={char}
        // MEASURE-RANK：展示度量按视觉档分档（与上面 layoutDemo 的 charOf 同一份）
        charOf={charOf}
        // assetBaseUrl = 导图根 URL（demo 资产 id 已含「demo-assets/」相对导图前缀）
        assetBaseUrl="/"
        // P0-1 渲染接线：上传资产（objectURL）只有宿主能解析，NodeG 优先走宿主
        resolveAssetUrl={(ref) => assetHost.resolveAsset(ref)}
        apiRef={apiRef}
        onStats={setStats}
        relationMode={relationMode}
        onNodeClick={(ln, mods) => {
          // S2：摘要两跳草稿的**首判**——必须先于 Shift 连线 / note 固定 / 选择逻辑，
          // 否则第二跳会被当成普通选择而吞掉（草稿永远完不成）。
          // 判据与 E7 同族（`onNodeClick` 首分支），但不消费 shift：Shift 连线的既有
          // 路径在草稿为空时逐字不变（交互互斥靠草稿闸门，不改 mods 语义）。
          // 闸门走 hook 的同步真理源：同一事件循环内的第二次点击不会重复建摘要。
          if (summaryHop.hasDraft()) {
            const done = completeSummaryAt(ln.node.id);
            // 无论成功或被拒（跨父/根/倒序），本次点击都**不**参与选择——
            // 被拒时提示已给、草稿保留，等下一次合法点击或 Esc。
            if (done) return;
          }
          // E7：Shift+点击两节点连线——已选中 A 时 Shift+点 B → 建边并开编辑器
          // E8：仅关系模式下生效（浏览态 Shift+点不建边）
          if (
            mods?.shift &&
            relationMode &&
            controller.selectedId &&
            controller.selectedId !== ln.node.id
          ) {
            const fromId = controller.selectedId;
            const from = edgeActions.anchorById.get(fromId) ?? anchorOfNode(controller.root, fromId) ?? '';
            const to =
              edgeActions.anchorById.get(ln.node.id) ?? anchorOfNode(controller.root, ln.node.id) ?? '';
            if (from && to) {
              edgeActions.connectEdge(from, to, 'relates-to', mods.sx, mods.sy);
              controller.select(ln.node.id);
              return;
            }
          }
          // 有 note 笔记的节点：点击即固定展示（悬停只是预览）—— 记路径，不是 id
          if (hasNote(ln.node)) {
            const path = pathOfNode(controller.root, ln.node.id);
            if (path) setPinnedNotePath(path);
          }
          // 点击已选中的节点 → 切换「放大展开」：描述区浮出在节点下方，
          // 不占布局、不受节点盒尺寸限制，注释可完整换行阅读。
          // （此前这里是"取消选中"——但取消选中改用点画布空白处，
          //   把"再点一次"这个天然的第二动作让给更常用的放大展开。）
          if (controller.selectedId === ln.node.id) {
            controller.select(null);
            setExpandedQaId(null);
            return;
          }
          controller.select(ln.node.id);
          const qa = ln.node.note?.qa;
          setExpandedQaId(Array.isArray(qa) && (qa as string[]).length > 0 ? ln.node.id : null);
        }}
        onBlankClick={() => {
          // 点画布空白：**只**取消选中 + 收起「放大展开」（后者是选中态的附属面板）。
          //
          // v1.8.10 用户裁决：不再顺手清 pinnedNotePaths / editingNotePaths —— 那是**用户显式
          // 打开的面板**（不属于选中态），此前会被静默关掉：正在输入的笔记内容直接消失
          // （「丢失正在编辑的内容」的另一条真凶）。关闭路径仍完整：卡片 × → onNoteClose。
          //
          // S2：摘要草稿属**未完成的交互**（不是用户显式打开的面板）→ 点空白即取消，
          // 与 Esc 同语义（任务书 §六 5）。判定走 hook 的同步真理源。
          summaryHop.cancel();
          controller.select(null);
          setExpandedQaId(null);
        }}
        onNodeContext={(node, sx, sy) => {
          // 右键：命中节点 → 选中并弹菜单；空白 → 关菜单
          if (node === null) {
            setCtxMenu(null);
            return;
          }
          controller.select(node.node.id);
          setCtxMenu({ nodeId: node.node.id, x: sx, y: sy });
        }}
        pinnedNoteIds={pinnedNoteIds}
        editingNoteIds={editingNoteIds}
        flippedNoteIds={flippedNoteIdList}
        onToggleNoteFlip={toggleNoteFlip}
        onNoteChangeSeq={(id, seq) =>
          controller.updateNote(id, seq.length > 0 ? { note: seq } : { note: undefined })
        }
        onNoteChangeText={(id, text) =>
          controller.updateNote(id, text === '' ? { note_text: undefined } : { note_text: text })
        }
        // P2：背面源文写回（空文本 → 删 md 键；不 trim 存储值，只 trim 判空）
        onNoteChangeMd={(id, md) =>
          controller.updateNote(id, md.trim() === '' ? { md: undefined } : { md })
        }
        onNoteClose={(id) => {
          if (!id) {
            setPinnedNotePaths([]);
            setEditingNotePaths([]);
            return;
          }
          setPinnedNotePaths((prev) =>
            prev.filter((path) => nodeAtPath(controller.root, path)?.id !== id),
          );
          setEditingNotePaths((prev) =>
            prev.filter((path) => nodeAtPath(controller.root, path)?.id !== id),
          );
        }}
        onNotePin={(id) => {
          const path = pathOfNode(controller.root, id);
          if (path) setPinnedNotePath(path);
        }}
        selectedId={controller.selectedId}
        editingId={controller.editingId}
        onEditCommit={(id, text) => {
          commitNodeText(id, text);
        }}
        onEditCancel={() => controller.cancelEdit()}
        // G10：编辑态 Tab = 提交 + 建子节点（连续录入不打断）
        onEditTabGrow={(id, text) => {
          // 输入 @ 已转入实体 picker —— 此时不应再建子节点
          if (commitNodeText(id, text)) return;
          // G6′ 触发一致性：与键盘 Tab 生长同一套方向固化（预方向 → 兄弟多数/父方向）
          const pre = preDirsRef.current.get(id);
          const n = getNode(controller.root, id);
          const d = pre ?? (n ? inferChildDir(n) : null);
          const newId = controller.addChild(id, undefined, d ? { dir: d } : undefined);
          controller.select(newId);
          controller.startEdit(newId);
        }}
        // G6′：中心拖拽 = 移动坐标（带动整棵子树），其余节点仍是改树结构
        centerIds={centerIds}
        // ROOT-DRAG-1：可拖中心（仅真实条目）——虚拟根岛不参与拖拽/提交
        centerEntryIds={centerEntryIds}
        centerTitles={centerTitles}
        // 嵌套包容：Section AABB / 父岛拖动预览并入子孙岛；切断岛不参与。
        // 提交层 handleCenterMove 同步平移子孙中心坐标。
        islandMembers={islandView.membersByRoot}
        nestedCenterIdsByRoot={islandView.nestedCenterIdsByRoot}
        onCenterMove={handleCenterMove}
        // v1.5.0 Section 幽灵态（dangling）一键清理——从根 note.sections 移除该条目（数据无损前提下的显式动作）
        onRemoveSection={(sectionId) => {
          const next = removeSection(controller.root.note, sectionId);
          controller.updateNote(controller.root.id, { sections: next.sections ?? undefined });
        }}
        onEditStart={(id) => {
          controller.select(id);
          // M1：实体节点 → 直接开 picker 改引用（而非文本编辑）
          const n = nodeById(controller.root, id);
          if (n?.type === 'entity' && n.ref) {
            setPicker({
              nodeId: id,
              query: n.text ?? '',
              current: { kind: n.ref.kind, id: n.ref.id },
            });
            return;
          }
          controller.startEdit(id);
        }}
        // FO-B2：框内大纲结构键 —— 与 keys.ts 的 matchEditorKey 分发同一批 controller 调用
        // （Tab=建子 / Enter=建同级 / Shift+Tab=缩进 / Ctrl+Shift+Tab=反缩进）。
        // 跨 depth 边界的改层级由 controller 守卫 no-op（B1 kernel crossesFrameDepthBoundary），
        // 此处不做二次判定。
        onFrameKey={(id, action) => {
          if (action === 'add-child') {
            // 生长固化与全局 Tab 同口径：预方向 → 邻居推断 → 都不写（走继承）
            const parent = getNode(controller.root, id);
            const dir = preDirsRef.current.get(id) ?? (parent ? inferChildDir(parent) : null);
            const child = controller.addChild(id, undefined, dir ? { dir } : undefined);
            controller.select(child);
            controller.startEdit(child);
            return;
          }
          if (action === 'add-sibling') {
            const loc = findNode(controller.root, id);
            const sibDir = loc ? inferChildDir(loc.parent) : null;
            const sib = controller.addSibling(id, undefined, sibDir ? { dir: sibDir } : undefined);
            if (sib !== null) {
              controller.select(sib);
              controller.startEdit(sib);
            }
            return;
          }
          if (action === 'indent') {
            controller.indent(id);
            return;
          }
          controller.outdent(id);
        }}
        collapsedIds={controller.collapsed}
        onToggleCollapse={(id) => controller.toggleCollapse(id)}
        expandedId={expandedQaId}
        onToggleExpand={(id) => {
          // × 关闭 / 收起：把该节点从展开态摘除
          setExpandedQaId((prev) => (prev === id ? null : prev));
          controller.select(null);
        }}
        onQaChange={(id, qa) => controller.updateNote(id, { qa })}
        selectedEdgeKey={edgeActions.edgeSel?.key ?? null}
        selectedEdgeKeys={edgeActions.edgeMultiSel}
        onEdgeClick={(edge, sx, sy, withShift) => {
          // R4-5：Shift+点边 → 多选切换；普通点 → 单选（既有行为不变）
          if (withShift) edgeActions.toggleEdgeMulti(edge.key);
          else edgeActions.setEdgeSel({ key: edge.key, x: sx, y: sy });
        }}
        onEdgeContext={(edge, sx, sy) => {
          edgeActions.setEdgeSel({ key: edge.key, x: sx, y: sy });
          setEdgeMenu({ edge, x: sx, y: sy });
        }}
        // Issue #3：手动覆盖 —— 拖拽端点 / bend 后写入 manual，恢复自动优化传 null
        onEdgeManualChange={(edge, manual) => edgeActions.writeEdgeManual(edge.index, manual)}
        onEdgeRoutes={edgeActions.handleEdgeRoutes}
        onTreeEdgeEdit={(childId, sx, sy) => setTreeEdgeEdit({ childId, x: sx, y: sy })}
        onEdgeConnect={(fromId, toId, sx, sy) => {
          // E6 拖拽连接：命中目标 → 以默认 rel 建边并立即开编辑器（图操作体验）；未命中 → 开创建器选目标
          if (!toId) {
            setLinkDraft({ sourceId: fromId, x: sx, y: sy });
            return;
          }
          const from = edgeActions.anchorById.get(fromId) ?? anchorOfNode(controller.root, fromId) ?? '';
          const to = edgeActions.anchorById.get(toId) ?? anchorOfNode(controller.root, toId) ?? '';
          if (!from || !to) return;
          edgeActions.connectEdge(from, to, 'relates-to', sx, sy);
        }}
        onNodeMove={(op) => {
          // 节点拖拽重排（M5-T5）：全部经 move-node TreeOp + OpHistory → undo/redo 正确
          controller.apply(op);
        }}
        onAssetFiles={(files) => {
          // GH-T1：.mm.md/.md 拖入/粘贴 → 打开文档；图片 → 上传图库并插入 @img 引用（P1）
          const docFiles = files.filter((f) => isMindDocFile(f.name));
          if (docFiles.length > 0) {
            const f = docFiles[0]!;
            void (async () => {
              await applyDoc(docHost.create(f.name, await f.text()));
            })();
            return;
          }
          // 文件拖入/粘贴 → 上传图库并插入 @img 引用（P1）：宿主上传 → 清单并集 → 选中节点下插入（无选中 = 根）
          // N-6：file.type 可能为空（系统拖拽）→ isImageFileName 扩展名兜底
          const images = files.filter((f) => f.type.startsWith('image/') || isImageFileName(f.name));
          if (images.length === 0) return;
          void (async () => {
            for (const file of images) {
              const item = await uploadToGallery(file);
              const parentId = controller.selectedId ?? controller.root.id;
              const id = controller.addEntityChild(parentId, { kind: item.kind, id: item.id });
              setEntities((prev) => {
                const next = new Map(prev);
                next.set(`${item.kind}:${item.id}`, {
                  kind: item.kind,
                  id: item.id,
                  title: item.name,
                  status: 'ready',
                  ref: null,
                });
                return next;
              });
              controller.select(id);
            }
          })();
        }}
        // v1.3.0 幕布描述（note.desc）
        descEditingId={descEditingId}
        onDescEditRequest={(id) => {
          // 主题文本编辑态按 Shift+Enter → 切到描述编辑（幕布「切换主题与描述」）
          controller.cancelEdit();
          setDescEditingId(id);
        }}
        onDescCommit={(id, text) => {
          // 空串 = 删除描述（note.desc 键置 undefined）
          controller.updateNote(id, text === '' ? { desc: undefined } : { desc: text });
          setDescEditingId(null);
        }}
        onDescCancel={() => setDescEditingId(null)}
        // L1：文本区域链接跳转（desc/note/note_text 内链接点击 → 解析 + 展开 + 定位 + 选中）
        onJumpToAnchor={jumpToAnchor}
      />

      <PerfPanel stats={stats} />

      {/* A5：命令拒绝/事务失败告警条（置顶居中，4s 消退） */}
      {commandNotice !== null && (
        <div
          style={{
            position: 'absolute',
            top: 64,
            left: '50%',
            transform: 'translateX(-50%)',
            maxWidth: 460,
            padding: '8px 14px',
            borderRadius: 8,
            background: 'rgba(226, 75, 74, 0.14)',
            border: '1px solid rgba(226, 75, 74, 0.5)',
            color: '#e24b4a',
            fontFamily: 'inherit',
            fontSize: 12,
            lineHeight: 1.6,
            zIndex: 5,
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          ⚠ {commandNotice}
        </div>
      )}

      {/* 预方向提示（PG 式「预设-固化」的可见反馈）：设了方向必须看得见，
          否则用户无法判断快捷键是否生效（实测无反馈 = 等于没实现）。 */}
      {preDirHint !== null && (
        <div
          data-testid="pre-dir-hint"
          style={{
            position: 'absolute',
            left: '50%',
            top: 16,
            transform: 'translateX(-50%)',
            padding: '8px 14px',
            borderRadius: 8,
            background: 'rgba(64, 128, 255, 0.14)',
            border: '1px solid rgba(64, 128, 255, 0.5)',
            color: '#2f6fed',
            fontFamily: 'inherit',
            fontSize: 12,
            lineHeight: 1.6,
            zIndex: 6,
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          预方向：{PRE_DIR_LABEL_CN[preDirHint.dir]} —— 按 Tab 生长即固化到该节点
        </div>
      )}

      {/* G6″（A3-2）：中心诊断警示条（宁可不写也不错写——坏锚/重复中心的原因在此可见）。
          自适应高度随条目数增长；不做交互（定位/跳转归后续工作包）。 */}
      {islandView.diagnostics.length > 0 && (
        <div
          style={{
            position: 'absolute',
            left: 16,
            bottom: 178,
            maxWidth: 420,
            padding: '8px 12px',
            borderRadius: 'var(--mc-radius, 8px)',
            background: 'rgba(186, 117, 23, 0.12)',
            border: '1px solid rgba(186, 117, 23, 0.45)',
            color: 'var(--mc-warning, #BA7517)',
            fontFamily: 'inherit',
            fontSize: 12,
            lineHeight: 1.6,
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          <div style={{ fontWeight: 600 }}>
            ⚠ 中心标注诊断：{islandView.diagnostics.length} 条（已安全忽略）
          </div>
          {islandView.diagnostics.slice(0, 3).map((d, i) => (
            <div key={`${d.code}-${i}`} style={{ wordBreak: 'break-word' }}>
              · {d.message}
              {d.at !== null ? `（${d.at}）` : ''}
            </div>
          ))}
          {islandView.diagnostics.length > 3 && (
            <div>… 其余 {islandView.diagnostics.length - 3} 条略</div>
          )}
        </div>
      )}

      {/* R0-2：边健康度诊断条（数据健康语义，独立于上方中心诊断条——R0-A1）。
          中心诊断条 bottom:178 向上生长且高度自适应：同时可见时抬到其最大展开
          （标题 + 3 明细 + 其余略 ≈ 112px）之上，避免堆叠遮挡。 */}
      <EdgeHealthBar
        health={edgeHealth}
        bottom={islandView.diagnostics.length > 0 ? 292 : 178}
        onOpen={() => setPanel('relation')}
      />

      {/* B1 文档栏：名称 + 未保存标记 + 新建/打开/最近/保存/另存为（左上角玻璃条） */}
      <div
        style={{
          position: 'absolute',
          left: 12,
          top: 10,
          zIndex: 3,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          background: CHROME.panelBg,
          border: `1px solid ${CHROME.panelBorder}`,
          borderRadius: CHROME.radius,
          boxShadow: CHROME.shadow,
          backdropFilter: 'blur(12px)',
          padding: '4px 8px',
          fontSize: CHROME.fontSizeSmall,
          color: CHROME.text,
        }}
      >
        <span
          data-doc-name
          title={doc.name}
          style={{
            maxWidth: 150,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontWeight: 600,
            color: CHROME.neon,
          }}
        >
          {doc.name}
        </span>
        <span
          data-doc-dirty={saving ? undefined : controller.dirty || undefined}
          style={{
            color: saving ? CHROME.neon : CHROME.warn,
            fontSize: CHROME.fontSizeSmall,
            opacity: saving || controller.dirty ? 1 : 0,
            transition: 'opacity .18s ease',
          }}
          title={saving ? '正在写入磁盘' : '未保存修改'}
        >
          {saving ? '⟳' : '●'}
        </span>
        <DocBtn label="新建" onClick={handleNew} />
        <DocBtn label="打开" onClick={() => void handleOpen()} />
        <DocBtn label="最近" onClick={() => setDocMenuOpen((v) => !v)} />
        <DocBtn label="保存" onClick={() => void handleSave()} />
        <DocBtn label="另存为" onClick={() => void handleSaveAs()} />
        <DocBtn label="导出" onClick={handleExport} />
        <DocBtn label="导出 PNG" onClick={() => void handleExportPng()} />
        <DocBtn
          label="文件管理"
          onClick={() => {
            setDocMenuOpen(false);
            setFileManagerOpen(true);
          }}
        />
      </div>
      {/* 最近文档下拉（B1）—— 已抽到 RecentDocMenu */}
      {docMenuOpen && (
        <RecentDocMenu
          recent={docHost.recent()}
          onPick={(d) => void applyDoc(d)}
          onClose={() => setDocMenuOpen(false)}
        />
      )}
      {/* FS Access 不支持的浏览器：打开兜底（隐藏 file input） */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".mm.md,.md,text/markdown"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          await applyDoc(docHost.create(f.name, await f.text()));
        }}
      />

      {/* T8 降级策略 L4：规模提示（>20K 激进简化 / >50K 建议折叠） */}
      {scaleNoticeFor(layout.nodes.length) !== null && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: 10,
            transform: 'translateX(-50%)',
            zIndex: 3,
            background: CHROME.panelBg,
            border: `1px solid ${CHROME.warn}`,
            color: CHROME.warn,
            borderRadius: CHROME.radius,
            boxShadow: CHROME.shadow,
            backdropFilter: 'blur(10px)',
            fontSize: CHROME.fontSizeSmall,
            padding: '6px 14px',
            pointerEvents: 'none',
          }}
        >
          {scaleNoticeFor(layout.nodes.length)}
        </div>
      )}

      {/* E8：关系模式操作提示（非阻塞；浏览态不出现） */}
      {relationMode && (
        <div
          data-relation-hint
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 12,
            transform: 'translateX(-50%)',
            zIndex: 3,
            background: CHROME.panelBg,
            border: `1px solid ${CHROME.panelBorder}`,
            color: CHROME.textMuted,
            borderRadius: CHROME.radius,
            boxShadow: CHROME.shadow,
            backdropFilter: 'blur(10px)',
            fontSize: CHROME.fontSizeSmall,
            padding: '5px 12px',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          关系模式：选中节点后拖右侧手柄连线 · Shift+点两节点连线 · 右键树边/连线编辑
        </div>
      )}

      {/* B3 诊断条：parse 诊断 + W-ASSET-MISSING（左下角，非阻塞） */}
      {allDiags.length > 0 && (
        <div
          data-diagnostics
          style={{
            position: 'absolute',
            left: 12,
            bottom: 12,
            zIndex: 3,
            maxWidth: 320,
            background: CHROME.panelBg,
            border: `1px solid ${CHROME.warn}`,
            color: CHROME.warn,
            borderRadius: CHROME.radius,
            boxShadow: CHROME.shadow,
            backdropFilter: 'blur(10px)',
            fontSize: CHROME.fontSizeSmall,
            padding: '6px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            pointerEvents: 'none',
          }}
        >
          {allDiags.map((d, i) => (
            <div key={`${d.code}-${i}`}>
              {d.code}：{d.message}
            </div>
          ))}
        </div>
      )}

      {/* 玻璃翻卡：点选节点 → 翻转查看 note + qa 编辑（R15）；侧面板打开时让位（同区域互斥） */}
      <div
        style={{
          position: 'absolute',
          right: 18,
          top: 76,
          width: 244,
          height: 260,
          zIndex: 2,
          visibility: panel !== null ? 'hidden' : undefined,
        }}
      >
        <FlipCard
          key={selected?.id ?? 'empty'}
          width={244}
          height={260}
          title={selected ? selectedTitle || '节点' : '节点笔记'}
          front={
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ color: CHROME.textMuted, fontSize: CHROME.fontSizeSmall }}>
                {selected ? 'NODE' : 'FLIPCARD'}
              </span>
              <span
                style={{
                  color: CHROME.text,
                  fontWeight: 600,
                  fontSize: 13,
                  lineHeight: 1.4,
                  overflow: 'hidden',
                }}
              >
                {selected ? selectedTitle || '（实体）' : '点击画布节点查看笔记'}
              </span>
              <span
                style={{
                  color: CHROME.textMuted,
                  fontSize: CHROME.fontSizeSmall,
                  marginTop: 'auto',
                }}
              >
                {selected
                  ? selected.note
                    ? '点击翻转查看详情'
                    : '该节点无笔记'
                  : '正面：节点摘要'}
              </span>
            </div>
          }
          back={
            <div
              style={{
                padding: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                overflow: 'hidden',
              }}
            >
              {/* R1/M2a：实体节点翻卡背面 = 引用详情（kind/id/标题；与关系面板同源） */}
              {selected?.type === 'entity' && selected.ref && (
                <div
                  data-flip-entity
                  style={{
                    padding: '6px 8px',
                    borderRadius: 6,
                    border: `1px solid ${CHROME.panelBorder}`,
                    fontSize: CHROME.fontSizeSmall,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ color: CHROME.neon, fontWeight: 600 }}>@{selected.ref.kind}</span>
                  <span style={{ color: CHROME.text, marginLeft: 6 }}>
                    {entities.get(refKey(selected.ref))?.title ?? selected.ref.id}
                  </span>
                  <span style={{ color: CHROME.textMuted, marginLeft: 6 }}>
                    （右键节点可改引用 / 在关系图中显示）
                  </span>
                </div>
              )}
              <span style={{ color: CHROME.neon, fontSize: CHROME.fontSizeSmall, fontWeight: 600 }}>
                NOTE
              </span>
              {noteSections.length === 0 ? (
                <span style={{ color: CHROME.textMuted, fontSize: CHROME.fontSizeSmall }}>
                  （该节点无笔记）
                </span>
              ) : (
                noteSections.map((s) => (
                  <div key={s.key} style={{ fontSize: CHROME.fontSizeSmall, lineHeight: 1.5 }}>
                    <span style={{ color: CHROME.neon, marginRight: 6 }}>{s.label}</span>
                    <span style={{ color: CHROME.text }}>{s.value}</span>
                  </div>
                ))
              )}
              {selected && (
                <QaEditor
                  items={qaItemsOf(selected)}
                  token={token}
                  onChange={(qa) => controller.updateNote(selected.id, { qa })}
                />
              )}
            </div>
          }
        />
      </div>

      {/* v1.8.0 Phase 2：环形快捷操作覆盖层（环/浮标/死区提示/二次确认）；
          Phase 3 ①：幽灵预览（高亮「新建」落点）与删除预告（高亮「删除」子树描边） */}
      <RadialStageOverlay radial={radial} ghost={radialPreview.ghost} dangerBoxes={radialPreview.dangerBoxes} />

      {/* 批次 2：节点右键菜单 —— 已抽到 NodeContextMenu */}
      {ctxMenu !== null && (
        <NodeContextMenu
          ctxMenu={ctxMenu}
          controller={controller}
          relationMode={relationMode}
          centerActions={nodeBags.centerActions} // 描述 / 笔记的袋仍由 nodeBags 供给**环**（getSubModel）
          setPicker={setPicker}
          setPanel={setPanel}
          setLinkDraft={setLinkDraft}
          onRequestLenCustom={(id, x, y, current) => setLenBubble({ id, x, y, current })}
          // FO-UI1：改框深度交数值步进气泡（值经 setFrameDepth → 同一撤销栈）
          onRequestFrameDepth={(id, x, y, current, max) =>
            setFrameDepthBubble({ id, x, y, current, max })
          }
          sectionActions={sectionActions}
          // S2：摘要入口（「创建摘要…」= 两跳交互的第一跳）；菜单关闭后进入等待态，
          // 第二跳由上面的 onNodeClick 首判完成。
          summaryActions={nodeBags.summaryActions}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* v1.8.1：出线长度数值气泡（取代原生 prompt——裁决 M3） */}
      {lenBubble !== null && (
        <LenBubble
          x={lenBubble.x}
          y={lenBubble.y}
          initial={lenBubble.current}
          onCommit={(v) => {
            applyLen(controller, lenBubble.id, v);
            setLenBubble(null);
          }}
          onCancel={() => setLenBubble(null)}
        />
      )}

      {/* FO-UI1：框深度数值步进气泡（取代「改框深度…」的原生 prompt） */}
      {frameDepthBubble !== null && (
        <FrameDepthBubble
          x={frameDepthBubble.x}
          y={frameDepthBubble.y}
          current={frameDepthBubble.current}
          max={frameDepthBubble.max}
          onCommit={(depth) => {
            setFrameDepth(controller, frameDepthBubble.id, depth); // 同一 undo 栈（内核再 clamp）
            setFrameDepthBubble(null);
          }}
          onCancel={() => setFrameDepthBubble(null)}
        />
      )}

      {/* E7 树边标注 + E5 连线创建器 / 边编辑浮窗 —— 已抽到 EdgeDraftLayer */}
      <EdgeDraftLayer
        controller={controller}
        edgeActions={edgeActions}
        treeEdgeEdit={treeEdgeEdit}
        linkDraft={linkDraft}
        onCloseTreeEdge={() => setTreeEdgeEdit(null)}
        onCloseLinkDraft={() => setLinkDraft(null)}
        onCutTreeEdge={handleCutTreeEdge}
        edgeMenu={edgeMenu}
        onCloseEdgeMenu={() => setEdgeMenu(null)}
        onNotice={setCommandNotice}
      />

      {/* 批次 2：? 快捷键帮助面板 */}
      {helpOpen && <ShortcutHelpPanel onClose={() => setHelpOpen(false)} />}

      {/* 文件管理器（含遮罩与打开策略）—— 已抽到 FileManagerModal */}
      {fileManagerOpen && (
        <FileManagerModal
          library={library}
          workspace={workspaceReady ? workspace : null}
          applyDoc={applyDoc}
          handleOpen={handleOpen}
          handleNew={handleNew}
          openWorkspaceFile={openWorkspaceFile}
          onPickWorkspace={pickWorkspace}
          onDetachWorkspace={detachWorkspace}
          currentPath={workspacePath}
          dirty={controller.dirty}
          onClose={() => setFileManagerOpen(false)}
        />
      )}

      {/* 批次 3：Ctrl+F 富文本搜索面板（选中 + 定位） */}
      {/* S1：侧面板簇（搜索 / 大纲 / 图库 / 关系图谱，互斥单态）——已抽到 SidePanels */}
      <SidePanels
        panel={panel}
        controller={controller}
        assetList={assetList}
        assetHost={assetHost}
        setEntities={setEntities}
        relations={relations}
        activeRefKey={activeRefKey}
        edgeItems={edgeItems}
        malformedRows={malformedRows}
        choices={edgeActions.nodeChoices}
        onReattachEdge={(key, side, anchor) =>
          edgeActions.reattachEdge(Number(key.slice(1)), side, anchor)
        }
        onDeleteEdge={(key) => edgeActions.deleteEdge(Number(key.slice(1)))}
        onUpload={(files) => {
          // P1-1 图库上传入口：按钮/面板拖拽 → 仅入图库清单（使用 = 点击资产插入）
          void (async () => {
            for (const file of files) {
              if (file.type.startsWith('image/') || isImageFileName(file.name)) {
                await uploadToGallery(file);
              }
            }
          })();
        }}
        onSelectNode={(id) => {
          setExpandedQaId(null);
          focusNode(id);
        }}
        onClose={() => setPanel(null)}
      />

      {/* M1 实体 picker：@ 触发插入 / 实体节点编辑改引用（选中回传经 controller.setEntityRef） */}
      {picker && (
        <EntityPicker
          kinds={pickKinds}
          candidates={entityCandidates}
          initialQuery={picker.query}
          initialKind={picker.current?.kind}
          currentId={picker.current?.id ?? null}
          onPick={(ref) => pickEntity(picker.nodeId, ref)}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

/** 读 note.qa（YAML 数组；非数组/缺失 → 空） */
/** 文档栏按钮（B1：玻璃条内的小按钮；hover 高亮） */
function DocBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <span
      onClick={onClick}
      style={{
        padding: '2px 6px',
        borderRadius: 5,
        cursor: 'pointer',
        color: CHROME.textMuted,
        fontWeight: 500,
        fontSize: CHROME.fontSizeSmall,
        userSelect: 'none',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = CHROME.neon;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = CHROME.textMuted;
      }}
    >
      {label}
    </span>
  );
}

/**
 * 节点「放大展开」状态的持久化（常驻）。
 *
 * 为什么存 localStorage 而不是文档：展开态是**视图状态**，写进 .mm.md 会污染
 * 事实源（每次展开都要触发保存，还会把个人视图偏好塞进共享文件）。
 * 节点 id 全局唯一（`nd<ts><seq>`），所以可以按 id 记录，不绑定文档。
 *
 * 读写都吞异常：localStorage 被禁用/写满时退化为"仅本次会话有效"，不影响主流程。
 */
const EXPANDED_NODES_KEY = 'mindcanvas.expandedNodes.v1';

function readExpandedNodes(): string[] {
  try {
    const raw = localStorage.getItem(EXPANDED_NODES_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

function writeExpandedNodes(ids: ReadonlySet<string>): void {
  try {
    if (ids.size === 0) localStorage.removeItem(EXPANDED_NODES_KEY);
    else localStorage.setItem(EXPANDED_NODES_KEY, JSON.stringify([...ids]));
  } catch {
    // localStorage 禁用/满 → 静默，展开态退化为仅本次会话有效
  }
}

function qaItemsOf(node: EditableNode): string[] {
  const qa = node.note?.qa;
  return Array.isArray(qa) ? (qa as string[]) : [];
}

/** 右键菜单项（新建/编辑/层级/折叠/删除；根节点禁用新建同级/反缩进/删除） */

/** 按 id 从树中取节点（undefined = 未选中/已删除） */

function btnStyle(enabled: boolean): CSSProperties {
  return {
    border: 'none',
    background: 'transparent',
    color: enabled ? CHROME.text : CHROME.panelBorder,
    fontSize: CHROME.fontSize,
    cursor: enabled ? 'pointer' : 'default',
    padding: '0 4px',
  };
}

/** 预方向中文名（提示条用） */
const PRE_DIR_LABEL_CN: Readonly<Record<GrowDir, string>> = {
  up: '向上',
  down: '向下',
  left: '向左',
  right: '向右',
};

export default function MindmapStage({
  onOpenFreeCanvas,
  requestLeave,
  registerLeavePort,
}: MindmapStageProps = {}) {
  return (
    <ThemeProvider>
      <StageInner
        onOpenFreeCanvas={onOpenFreeCanvas}
        requestLeave={requestLeave}
        registerLeavePort={registerLeavePort}
      />
    </ThemeProvider>
  );
}

/** MapView api 结构（避免 import 链；与 react MapViewApi 对齐） */
type MapViewApi = {
  fit(): void;
  zoomBy(f: number): void;
  resetZoom(): void;
  focusNode(id: string): void;
  /** 几何导航：视觉方向就近可见节点（无候选 → null；目标不可见时内部最小推入视口） */
  navigateFrom(id: string, dir: 'up' | 'down' | 'left' | 'right'): string | null;
  /** v1.8.0：节点盒右上角客户端坐标（环形菜单锚点） */
  nodeCorner(id: string): { x: number; y: number } | null;
  /** v1.8.0 Phase 3：节点盒客户端矩形 + 缩放 k（幽灵预览） */
  nodeBox(id: string): { x: number; y: number; w: number; h: number; k: number } | null;
  /** v1.8.0 Phase 3：可见子树全部节点盒（删除预告描边） */
  subtreeBoxes(id: string): Array<{ id: string; x: number; y: number; w: number; h: number }>;
};
