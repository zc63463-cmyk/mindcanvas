/**
 * MapView：渲染核心主体（dirty-flag 按需渲染 + 视口裁剪 + LOD）。
 * 调度纪律（硬验收：空闲 CPU ≈ 0，禁永续 rAF）：
 * - 视口变换（pan/zoom/fit）→ notify() → 脏标记 ∈ FrameScheduler（单帧 rAF，帧内合批；同帧多次变更只渲染一次）
 * - 无交互时零 rAF / 零 timer 挂起——空闲零活动
 * - 数据更改（新 layout）→ 派生 memo 重算 + epoch 触发一帧
 * 组件/几何分离：几何与命中检测在 geometry.ts（纯函数），本组件只做组装。
 */

import { hasNote, noteOf } from '@mindcanvas/kernel';
import type { CharMeasure, EditableNode, Entity, GrowDir } from '@mindcanvas/kernel';
import { readBeamAt, readHubFlag } from '@mindcanvas/kernel';
import {
  type Box,
  type BoundaryLink,
  buildBoxIndex,
  collectFrameRoots,
  filterVisibleLinks,
  frameOf,
  isBoxInView,
  type LayoutNode,
  type LayoutResult,
  partitionFrameSubtree,
  queryBoxIndex,
  type TreeOp,
} from '@mindcanvas/kernel';
import {
  type ReactElement,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { DescBlock, estimateDescHeight } from '../chrome/DescBlock.js';
import { FrameOutline, type FrameKeyAction } from '../chrome/FrameOutline.js';
import { FLOATING_NOTE_GAP, NotePopover } from '../chrome/NotePopover.js';
import { estimateNoteAreaHeight } from '../chrome/NoteGrowthPanel.js';
import { estimateCommentAreaHeight, GrowthCommentPanel } from '../chrome/GrowthCommentPanel.js';
import { OverlayEditor } from '../edit/OverlayEditor.js';
import { useTheme } from '../theme/ThemeContext.js';
import type { TokenSet } from '../theme/types.js';
import { createSvgBackend, type RenderBackend } from './backend.js';
import { CanvasSurface } from './canvasBackend.js';
import { type CharMeasureOf, createDisplayMetricsFn } from './domMeasure.js';
import { cubicMidNormal, EdgeLabel } from './EdgeLabel.js';
import type { EdgeRouteEntry } from './FreeEdgeLayer.js';
import { type EdgeManual, FreeEdgeLayer } from './FreeEdgeLayer.js';
import {
  FreeEdgeLabelLayer,
  FreeEdgeLabelStore,
  type FreeEdgeLabelSpec,
} from './EdgeLabelLayer.js';
import { collectFreeEdges, type EdgeEndpoints, type FreeEdge } from './freeEdges.js';
import {
  refineFreeEdgeEndpoints,
  type OverviewCardIndex,
} from './freeEdgeFrameAnchor.js';
import {
  buildIslandOverviewCards,
  hasOverviewIslands,
  type IslandOverviewCard,
  islandOverviewMemberIdsOf,
  overviewActive,
} from './islandOverview.js';
import { IslandOverviewLayer } from './IslandOverviewLayer.js';
import { containedMemberIds } from './islandNesting.js';
import { stableByKeys } from './stableArray.js';
import { CULL_QUANT, quantizeRect } from './viewportQuant.js';
import { collectDeclaredGrowDir } from './growDir.js';
import {
  beamDragBadge,
  beamDragRail,
  buildBeamHandles,
  type BeamCommit,
  type BeamDir,
  type BeamDragState,
  type BeamHandle,
} from './beamDrag.js';

/** 无枢纽文档的空梁映射/把手（模块级常量：同一实例，避免 useMemo 依赖抖动） */
const EMPTY_BEAM_MAP: ReadonlyMap<object, number> = new Map();
const EMPTY_LINKS: readonly never[] = [];
const EMPTY_HANDLES: readonly BeamHandle[] = [];
import { fixedNotePanelsOf, noteLodFor } from './fixedNotePanels.js';
import type { LodLevel } from './geometry.js';
import {
  buildLinkPath,
  computeBranchIndex,
  fontOf,
  lodFor,
  lodSkipText,
  nodeCardStyle,
  nodeHitTest,
  horizontalBeamMap,
  visualRankOf,
  hubArrowTip,
  verticalBeamMap,
} from './geometry.js';
import {
  NODE_ANIM_MAX_NODES,
  NODE_ANIM_MS,
  PAN_INERTIA_TRIGGER,
  PAN_SAMPLE_WINDOW,
  prefersReducedMotion,
  VIEWPORT_ANIM_MS,
} from './motion.js';
import { nextNodeInDirection, revealTargetInViewport, type NavDir } from './navigateDirection.js';
import { NodeG } from './NodeG.js';
import { nodeAuxiliaryRegions } from './nodeAuxiliary.js';
import { SectionLayer } from './SectionLayer.js';
import { SummaryLayer } from './SummaryLayer.js';
import { buildSummaryViews, type SummaryView } from './summaryFrames.js';
import { buildSectionViews, type SectionView } from './sectionFrames.js';
import { buildSectionMembership } from './sectionMembership.js';
import { type DropMode, dropModeFor, planDrop } from './nodeDrag.js';
import { commentAreaH, DescOverlays, ExpandCommentOverlay, NodeTextOverlay } from './overlays.js';
import { PinchTracker } from './pinch.js';
import { buildSceneFromLayout, resolveBackend } from './sceneBuilder.js';
import { FrameScheduler } from './scheduler.js';
import { lerpNodeFrame, type NodeFrame, toNodeFrame } from './transition.js';
import { hitNodeAt, useMapGestures, worldPointOf } from './useMapGestures.js';
import {
  dropGlyph,
  dropHint,
  senseDropTarget,
  type DropBox,
  type DropTarget,
} from './dropSensing.js';
import { estimatePanVelocity, type PanSample, ViewportController } from './viewport.js';

export interface MapViewProps {
  layout: LayoutResult;
  /**
   * G6′复审修复：完整文档树根（controller.root）。
   * 文档级自由边（root.note.edges）收集与 FreeEdgeLayer 折叠祖先解析必须读完整内容树——
   * 森林/多中心投影下 layout.nodes 存在多个 depth===0 几何根（甚至不含文档根本身），
   * 不能从布局结果推断文档根。缺省回退首个几何根（旧单树布局下二者一致，兼容既有调用方）。
   */
  documentRoot?: EditableNode;
  /**
   * G6″（A3-2/G3）：跨岛父子连接（真实父子关系跨岛、且中心条目 parent_link: 'show'）。
   * 不参与自动布局，仅渲染为虚线连接（与树线/自由边视觉区分）。
   * 已知边界：Canvas 模式不渲染（与自由边同类限制），含本功能文档的 Canvas 门禁归 A6。
   */
  boundaryLinks?: readonly BoundaryLink[];
  /**
   * G6″（A4）：岛根 id → 岛成员 id 列表（含岛根自身）。
   * 中心拖动的实时整岛预览据此平移全部成员（节点卡、本地树线、跨岛线端点、附属区定位）。
   */
  islandMembers?: ReadonlyMap<string, readonly string[]>;
  /**
   * 嵌套升格：祖先中心 → 非切断子孙中心。
   * Section AABB 与父岛拖动预览并入子孙岛成员（包容语义）。
   */
  nestedCenterIdsByRoot?: ReadonlyMap<string, readonly string[]>;
  entities: Map<string, Entity>;
  /** DOM 精确字符度量（T3 注入；随主题字体切换）。`charOf` 缺省时即全档共用的那一把 */
  char: CharMeasure;
  /**
   * 档位字符度量（MEASURE-RANK 可选）：`createRankedCharMeasure(token.font)` 产出。
   * 给了 → 展示度量按 `depth` 分档（与布局 `createNodeMeasure(char, entities, charOf)` **同一份**，
   * 盒与字号同源）；缺省 → 恒用 `char`（旧行为逐像素不变）。
   */
  charOf?: CharMeasureOf;
  /** 外部控制柄（fit / zoomBy） */
  apiRef?: RefObject<MapViewApi | null>;
  /** 渲染后端强制（C2）：'canvas' → 大图模式（场景树 → 2D 画布，交互走坐标命中）；缺省 'svg' */
  forceBackend?: 'svg' | 'canvas';
  /** 每帧渲染统计（T5 性能验证 / 性能面板） */
  onStats?: (s: MapStats) => void;
  /** 节点点击（hit-test：点击非拖拽时命中可见节点；mods.shift 供「Shift+点击两节点连线」） */
  onNodeClick?: (node: LayoutNode, mods?: { shift: boolean; sx: number; sy: number }) => void;
  /** 点击画布空白（未命中节点）：取消选中 / 收起放大展开 */
  onBlankClick?: () => void;

  // ---- 节点注释浮窗（v1.4.0）----
  /** 当前悬停的节点 id（由本组件内部命中检测维护） */
  onNoteHover?: (id: string | null) => void;
  /** 固定显示的 note 笔记节点 id（null = 无） */
  pinnedNoteId?: string | null;
  /** 可同时固定多个节点注释 */
  pinnedNoteIds?: readonly string[];
  /** 处于编辑态的已固定 note 笔记 */
  editingNoteIds?: readonly string[];
  /** P1-T1：翻面中的固定 note 笔记 id（受控；宿主持有；缺省 → 面板内部态，现行为） */
  flippedNoteIds?: readonly string[];
  /** P1-T1：翻面意图回传（宿主据此写回 flippedNoteIds） */
  onToggleNoteFlip?: (id: string, next: boolean) => void;
  /** 注释写回：序列区域 */
  onNoteChangeSeq?: (id: string, seq: string[]) => void;
  /** 注释写回：纯文本区域 */
  onNoteChangeText?: (id: string, text: string) => void;
  /** P2：注释写回：背面 markdown 源文（固定卡渲染位透传；空文本语义由宿主映射） */
  onNoteChangeMd?: (id: string, md: string) => void;
  /** 关闭 note 笔记（点 x 或点空白） */
  onNoteClose?: (id?: string) => void;
  onNotePin?: (id: string) => void;
  /** 节点右键（hit-test；空白处命中 null；带屏幕坐标） */
  onNodeContext?: (node: LayoutNode | null, sx: number, sy: number) => void;
  /** 选中节点 id（高亮；null = 无） */
  selectedId?: string | null;
  /** 正在编辑的节点 id（渲染文本内联输入框） */
  editingId?: string | null;
  onEditCommit?: (id: string, text: string) => void;
  onEditCancel?: () => void;
  /**
   * G10：编辑态 Tab —— 提交 (id, text) 后建子节点并进入新节点编辑。
   * 未注入时 Tab 不启用连续生长（向后兼容）。
   */
  onEditTabGrow?: (id: string, text: string) => void;
  /** G6′：中心节点 id 集合（这些节点拖拽 = 移动坐标而非改树结构） */
  centerIds?: ReadonlySet<string>;
  /**
   * ROOT-DRAG-1：「**可拖中心**」集合 = 有 center 条目（collectCenters well-formed）的真实中心。
   *
   * 与 centerIds 的分工（防再次混用）：
   * - centerIds = **布局岛根**集合（含虚拟根岛；供 hasOverviewIslands / 岛表 / 命中口径）；
   * - 本表只管「拖拽 = 移动坐标」的三处判定：Section 标题栏拖起守卫 / 手势层 isCenter /
   *   中心预览门控。虚拟根岛没有 center 条目 —— 拖它不得写 note（否则静默把文档根
   *   升格为中心，绕过 planPromoteCenter 的 is-root 守卫，见 ROOT-DRAG-1 任务书）。
   * 缺省回退 centerIds（向后兼容：既有调用方行为逐位不变）。
   */
  centerEntryIds?: ReadonlySet<string>;
  /**
   * C4：中心角标标题（nodeId → title 文本，如「中心（doc#cid）」；数据源 = collectCenters）。
   * **渲染条件即「本表含该 id」**——不用 centerIds（它含布局输出所需的「根岛根」，
   * 会误标文档根）。不传 → 不渲染任何角标（向后兼容）。
   */
  centerTitles?: ReadonlyMap<string, string>;
  /** G6′：中心拖拽结束 —— (id, 世界 dx, 世界 dy) */
  onCenterMove?: (id: string, worldDx: number, worldDy: number) => void;
  /**
   * v1.7.0：拖共享梁松手 —— 单字段提交（单条 undo；拖拽中不落盘）。
   * v1.11.0 双把手：`commit.kind='lens'`（梁中段）写 `lens[dir]`；`'bias'`（主干）写
   * `beamAt[dir]`（≈0.5 删键）。
   */
  onBeamChange?: (fromId: string, commit: BeamCommit) => void;
  /** 双击节点请求进入编辑（仅 text 类型命中回调；由上层决定 select+startEdit） */
  onEditStart?: (id: string) => void;
  /**
   * FO-B2：框内大纲的结构键（Tab=建子 / Enter=建同级 / Shift+Tab=缩进 / Ctrl+Shift+Tab=反缩进，
   * 与 `edit/keys.ts` 对齐）→ 由上层映射到 controller；跨 depth 边界的改层级由 controller
   * 守卫 no-op（kernel `crossesFrameDepthBoundary`，B1 已合入）。
   */
  onFrameKey?: (id: string, action: FrameKeyAction) => void;
  /** 折叠集合（缺省无折叠） */
  collapsedIds?: ReadonlySet<string>;
  onToggleCollapse?: (id: string) => void;
  /** v1.5.0 Section：幽灵态（dangling）一键清理——从根 note.sections 移除该条目（T4 接线） */
  onRemoveSection?: (sectionId: string) => void;
  /** 展开态节点 id（快速注释"生长"：节点向下变宽变高参与布局；null = 无展开） */
  expandedId?: string | null;
  /** 点击节点展开/收起（由上层决定 expandedId） */
  onToggleExpand?: (id: string) => void;
  /** 写回展开节点（或选中节点）的 note.qa 数组 */
  onQaChange?: (id: string, qa: string[]) => void;
  /** 资产基础 URL（透传给 NodeG：@img/@draw 实体渲染 <image> 预览时拼接；缺省不渲染） */
  assetBaseUrl?: string;
  /** 资产 URL 宿主解析（P0-1，透传 NodeG）：优先于 assetBaseUrl 拼接；undefined 回落拼接 */
  resolveAssetUrl?: (ref: { kind: string; id: string }) => string | undefined;
  /**
   * 节点拖拽重排落点（M5-T5）：拖拽松手时给出 move-node op（由上层经 controller.apply 执行，
   * 保证 undo/redo 正确）；非法落点（成环/自拖/根目标）不会触发本回调。
   */
  onNodeMove?: (op: Extract<TreeOp, { type: 'move-node' }>) => void;
  /**
   * 文件拖入/粘贴到画布（P1 上传管线）：由上层经资产宿主上传后插入 @img 引用。
   * 缺省 = 忽略（拖放/粘贴文件不响应）。
   */
  onAssetFiles?: (files: File[]) => void;
  /**
   * 带落点语义的素材投放（FA2-T3）：拖放时按光标所处区域判定
   * `icon`（文本核心）/ `media`（上下边缘）/ `child`（右侧桩）/ `free`（空白）。
   * 提供本回调时优先于 `onAssetFiles`；未提供的老调用方行为不变。
   */
  onAssetDrop?: (files: File[], target: DropTarget) => void;
  /** 选中自由边 key（E3 边编辑高亮；null = 无） */
  selectedEdgeKey?: string | null;
  /** R4-5：多选集合（批量高亮；与 selectedEdgeKey 并存） */
  selectedEdgeKeys?: readonly string[];
  /** 点击自由边（E2 选中回调；带屏幕坐标供浮窗锚定） */
  onEdgeClick?: (edge: FreeEdge, sx: number, sy: number, withShift?: boolean) => void;
  /** R4-1：右键自由边（关系模式；同 onEdgeClick 同族加法） */
  onEdgeContext?: (edge: FreeEdge, sx: number, sy: number) => void;
  /**
   * Issue #3：手动调整连线（拖端点 / bend 控制点）→ 回写 manual。
   * manual = null 表示「恢复自动优化」（清空人工锁定）。
   */
  onEdgeManualChange?: (edge: FreeEdge, manual: EdgeManual | null) => void;
  /**
   * 路由结果回调（Opp 精确翻转用）：给出「边 key → 实际渲染的 RouteResult」。
   * 上层据此用 inferBowSide 判断某条边当前鼓向哪一侧（auto 模式下光看数据无从得知）。
   */
  onEdgeRoutes?: (routes: ReadonlyMap<string, EdgeRouteEntry>) => void;
  /** 左键/右键树自然线（父→子连线）→ 编辑关系内容（存子节点 note.via；E6） */
  onTreeEdgeEdit?: (childId: string, sx: number, sy: number) => void;
  /** 连接手柄拖拽松手（E6 图操作）：目标命中 → 建边；未命中 → null（上层开创建器） */
  onEdgeConnect?: (fromId: string, toId: string | null, sx: number, sy: number) => void;
  /**
   * E8：关系模式（模式隔离）。关闭 = 浏览态——画布只呈现已有关系，不暴露任何连线入口：
   * 无连接手柄、树边不可右键编辑、自由边只读（点击穿透，不弹编辑器）。
   * 开启 = 关系编辑态——手柄 / 树边右键 / 边的点击编辑全部激活。
   */
  relationMode?: boolean;
  // ---------- v1.3.0 幕布描述（note.desc）----------
  /** 正在编辑描述的节点 id（Shift+Enter 进入；null = 无） */
  descEditingId?: string | null;
  /** 提交描述文本（空串 = 删除描述） */
  onDescCommit?: (id: string, text: string) => void;
  /** 取消描述编辑 */
  onDescCancel?: () => void;
  /** L1：文本区域链接跳转（锚原文 → 宿主解析 + 展开祖先 + 定位 + 选中；缺省 → 链接只渲染不可点） */
  onJumpToAnchor?: (anchor: string) => void;
  /** v1.3.0：主题文本编辑态按 Shift+Enter → 请求切到该节点描述编辑 */
  onDescEditRequest?: (id: string) => void;
}

export interface MapViewApi {
  fit(): void;
  zoomBy(factor: number): void;
  /** 重置缩放（k=1 居中于原点） */
  resetZoom(): void;
  /** 定位节点：保持当前 k，将节点中心平移到视口中心 */
  focusNode(id: string): void;
  /**
   * 几何导航（A 档）：按**视觉方向**取最近的可见节点。
   *
   * 与 `EditorController.navigate`（可见前序线性导航）的分工：后者保留给大纲式场景，
   * 键盘方向键走本方法——↕ 不再钻子树（旧语义要穿完整棵子树才换到下一个兄弟）、
   * ↔ 不再与 ↕ 同义；左右双翼下方向语义恒定（几何方向，与树层级无关）。
   * 目标不在视口内时做**最小推入**（只挪到刚可见；不居中、不改 k）。
   * 本方法**不写选中态**（只算目标 + 必要时推视口）——选中由宿主 `controller.select` 写入。
   *
   * @returns 目标节点 id；无候选（方向尽头 / 过斜 / 源不可见）→ null
   */
  navigateFrom(id: string, dir: NavDir): string | null;
  /** 节点盒右上角的**客户端坐标**（v1.8.0：环形菜单锚点；节点不存在 → null） */
  nodeCorner(id: string): { x: number; y: number } | null;
  /**
   * 节点盒客户端矩形 + 当前缩放 k（v1.8.0 Phase 3：幽灵预览按布局常量折算屏幕间距；节点不存在 → null）
   */
  nodeBox(id: string): { x: number; y: number; w: number; h: number; k: number } | null;
  /** 可见子树全部节点盒（客户端坐标，含自身；未知 id → 空数组）——「删除预告」描边用 */
  subtreeBoxes(id: string): Array<{ id: string; x: number; y: number; w: number; h: number }>;
}

export interface MapStats {
  epoch: number;
  totalNodes: number;
  visibleNodes: number;
  visibleLinks: number;
  lod: LodLevel;
  /**
   * R5-3：当前渲染后端。'canvas' = 大图自动降级（>5 万可见节点；纯树文档）——
   * 树线标签与 note 角标不渲染（实测损失清单见 canvas-degrade.test.tsx），
   * 宿主据此给一次「已进入大图模式」提示。**材料字段**：后端变化必然触发一次上报。
   */
  backend: 'svg' | 'canvas';
  viewMs: number;
}

/** 裁剪外扩（世界 px；缓冲防边缘闪烁） */
const CULL_MARGIN = 128;
/**
 * B-P1：节点数 ≥ 此值时才建网格索引（裁剪 + 命中粗筛）。
 * 小图零回归：低于阈值走原线性路径，既有 jsdom 夹具与契约测试不受影响。
 */
const INDEX_MIN_NODES = 1000;
/**
 * B-P3：`onStats` 上报节流间隔（ms）—— ≥ 此间隔且**材料字段**变化才回调，防父壳每帧重渲。
 * 面板是诊断用，允许语义微调（选项见计划 §B-P3）。
 */
const STATS_THROTTLE_MS = 200;
/** 空折叠集常量。
 * 原先写 `collapsedIds ?? new Set()` —— 每次渲染都造一个新 Set，
 * 会让 `FreeEdgeLayer` 的路由 useMemo 依赖失效，**每次重渲染都把全部边重算一遍路由**
 * （100 条边 ≈ 0.5s），并且路由回调会自我触发形成死循环。此处固定为空集单例。
 */
const EMPTY_COLLAPSED: ReadonlySet<string> = new Set();
const EMPTY_SECTION_VIEWS: readonly SectionView[] = [];
/**
 * FE-FRAME-1：Section 帧模型 + 贴框索引（成员集 / bounds）。
 * FE-FRAME-1.1 起本表 = **B 层**（取盒建帧）产物：成员索引来自 A 层 sectionMembership
 * （成员公式唯一出口，与画框同源），bounds 索引在 B 层随 animBoxes/centerPreview 重建。
 */
interface SectionData {
  views: readonly SectionView[];
  memberIndex: ReadonlyMap<string, ReadonlySet<string>>;
  boundsIndex: ReadonlyMap<string, Box>;
}
const EMPTY_SECTION_DATA: SectionData = {
  views: EMPTY_SECTION_VIEWS,
  memberIndex: new Map(),
  boundsIndex: new Map(),
};
/** IO-1：空卡表 / 空 id 集单例（memo 依赖稳定；总览未激活时零分配） */
const EMPTY_ISLAND_CARDS: readonly IslandOverviewCard[] = [];
/** S4：空括线视图单例（无摘要 / 全体降级时零分配、零层级） */
const EMPTY_SUMMARY_VIEWS: readonly SummaryView[] = [];
const EMPTY_OVERVIEW_CARDS: OverviewCardIndex = [];
const EMPTY_ID_SET: ReadonlySet<string> = new Set();
/** IO-1：双击卡聚焦进岛时的 fit 外扩（屏幕 px） */
const ISLAND_FOCUS_PAD = 60;

/** 避障障碍条目（节点 id + 世界坐标盒；动画期按 id 排除端点自身，见 FreeEdgeLayer 注释） */
export interface EdgeObstacleEntry {
  id: string;
  box: Box;
}

/**
 * P2-1 · 边避障障碍集决策（纯函数，可单测）。
 * 动画进行中（animating）或低 LOD（非 full）→ 传空数组关闭寻路：
 * routeAesthetic 自动走 S 形/直连快路径，成本从 O(E×锚点×曲率×采样×障碍) 降到 O(E)；
 * 动画是瞬态过渡，路由观感让步帧率，动画结束回到全速路由。
 */
export function edgeObstaclesOf(
  layout: { nodes: readonly { node: { id: string }; box: Box }[] },
  lod: LodLevel,
  animating: boolean,
): readonly EdgeObstacleEntry[] {
  if (animating || lod !== 'full') return [];
  return layout.nodes.map((ln) => ({ id: ln.node.id, box: ln.box }));
}

export function MapView({
  layout,
  documentRoot,
  boundaryLinks,
  islandMembers,
  nestedCenterIdsByRoot,
  entities,
  char,
  charOf,
  apiRef,
  forceBackend,
  onStats,
  onNodeClick,
  onBlankClick,
  onNoteHover,
  pinnedNoteId = null,
  pinnedNoteIds,
  editingNoteIds,
  flippedNoteIds,
  onToggleNoteFlip,
  onNoteChangeSeq,
  onNoteChangeText,
  onNoteChangeMd,
  onNoteClose,
  onNotePin,
  selectedId,
  editingId,
  onEditCommit,
  onEditCancel,
  onEditTabGrow,
  centerIds,
  centerEntryIds,
  centerTitles,
  onCenterMove,
  onBeamChange,
  collapsedIds,
  onToggleCollapse,
  onRemoveSection,
  expandedId,
  onToggleExpand,
  onQaChange,
  onNodeContext,
  onEditStart,
  onFrameKey,
  assetBaseUrl,
  resolveAssetUrl,
  onNodeMove,
  onAssetFiles,
  onAssetDrop,
  selectedEdgeKey,
  selectedEdgeKeys,
  onEdgeClick,
  onEdgeContext,
  onEdgeManualChange,
  onEdgeRoutes,
  onTreeEdgeEdit,
  onEdgeConnect,
  relationMode = false,
  descEditingId = null,
  onDescCommit,
  onDescCancel,
  onJumpToAnchor,
  onDescEditRequest,
}: MapViewProps) {
  const { token } = useTheme();
  // E8 模式隔离：连线入口总闸（回调以 ref 形式参与渲染分支——避免闭包陈旧）
  const relationModeRef = useRef(relationMode);
  relationModeRef.current = relationMode;

  // 渲染基础设施：单帧调度器 + 视口（挂载一次，卸载即清）
  const frameRef = useRef<FrameScheduler | null>(null);
  if (frameRef.current === null) frameRef.current = new FrameScheduler();
  const frame = frameRef.current;
  const viewportRef = useRef<ViewportController | null>(null);
  if (viewportRef.current === null) viewportRef.current = new ViewportController(frame);
  const viewport = viewportRef.current;

  // 节点位置过渡（M5-T2）：布局变化时旧→新坐标插值；anim 非空 = 过渡进行中
  const [anim, setAnim] = useState<NodeFrame | null>(null);
  const prevLayoutRef = useRef<LayoutResult | null>(null);

  // 节点拖拽重排（M5-T5）：pointerdown 命中节点启动；moved 后跟随光标 + 悬停目标提示
  // v1.7.0：共享梁拖拽状态（预览叠层消费；逻辑在 useMapGestures/beamDrag）
  const [beamDrag, setBeamDrag] = useState<BeamDragState | null>(null);
  // v1.7.0：梁悬停方向（容器光标 ns/ew-resize 的依据；null = 非梁区域）
  const [beamHoverDir, setBeamHoverDir] = useState<BeamDir | null>(null);
  const [nodeDrag, setNodeDrag] = useState<{
    nodeId: string;
    pointerId: number;
    startX: number;
    startY: number;
    dx: number;
    dy: number;
    moved: boolean;
    targetId: string | null;
    mode: DropMode;
    valid: boolean;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const didInitialFit = useRef(false);
  const onStatsRef = useRef(onStats);
  onStatsRef.current = onStats;
  const onNodeClickRef = useRef(onNodeClick);
  const onBlankClickRef = useRef(onBlankClick);
  const onNoteHoverRef = useRef(onNoteHover);
  onNoteHoverRef.current = onNoteHover;
  const onNoteCloseRef = useRef(onNoteClose);
  onNoteCloseRef.current = onNoteClose;
  /** 悬停中的节点 + 指针屏幕坐标（供预览定位；指针移动时更新坐标） */
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  /**
   * 悬停预览是独立浮窗；固定 note 笔记由布局预留区渲染，不在这里处理。
   */
  /**
   * note 的缩放档位（与几何 LOD 是两套：几何 LOD 管文本/命中区，这里管 note DOM 生不生成）。
   *   full  → 固定卡片 + 悬停浮窗
   *   badge → 只留角标，悬停仍以屏幕浮窗预览
   *   none  → note DOM 全剔除（正在编辑的除外，见下）
   */
  const noteLod = noteLodFor(viewport.transform.k);
  /**
   * 悬停预览恒为**屏幕空间浮窗**（宽度/字号固定，不随 k 缩放）——
   * 此前宽度取 `box.w * k`，画布缩小到 0.4 时浮窗被压成细条、文字撑爆容器。
   * anchorTop 供浮窗在空间不足时翻转到节点上方。
   */
  const noteTargets = useMemo(() => {
    const pinnedIds = pinnedNoteIds ?? (pinnedNoteId ? [pinnedNoteId] : []);
    const targets: { id: string; ln: LayoutNode; pinned: false }[] = [];
    if (hover && !pinnedIds.includes(hover.id)) {
      const ln = layout.nodes.find((n) => n.node.id === hover.id);
      if (ln && hasNote(ln.node)) targets.push({ id: hover.id, ln, pinned: false });
    }
    // 鸟瞰档：连悬停预览也不生成（DOM 与视觉噪点一起剔除）
    if (noteLod === 'none') return [];
    return targets.map(({ id, ln, pinned }) => {
      const { k, x: tx, y: ty } = viewport.transform;
      return {
        id,
        data: noteOf(ln.node),
        pinned,
        x: ln.box.x * k + tx,
        y: (ln.box.y + ln.box.h) * k + ty + FLOATING_NOTE_GAP,
        anchorTop: ln.box.y * k + ty,
        // 浮窗宽度对齐节点、字号不大于节点字号（屏幕口径：世界值 × k）
        nodeWidth: ln.box.w * k,
        nodeFontSize: nodeFontOf(token, ln.depth) * k,
      };
    });
  }, [pinnedNoteId, pinnedNoteIds, hover, layout, viewport.transform, noteLod, token]);
  const fixedNoteIds = useMemo(
    () => new Set(pinnedNoteIds ?? (pinnedNoteId ? [pinnedNoteId] : [])),
    [pinnedNoteId, pinnedNoteIds],
  );
  const editingNoteIdSet = useMemo(() => new Set(editingNoteIds), [editingNoteIds]);
  // P1-T1：翻面集合 —— 缺省 undefined（= 面板内部态，现行为）；传入即受控
  const flippedNoteIdSet = useMemo(
    () => (flippedNoteIds === undefined ? undefined : new Set(flippedNoteIds)),
    [flippedNoteIds],
  );
  const view = viewport.worldRect(CULL_MARGIN);
  /**
   * 固定卡片只在 full 档位生成（badge/none 档位不挂载大卡片，只留角标）。
   *
   * 唯一例外：**正在编辑**的面板在任何档位都保留 —— 编辑态会自动升级为屏幕浮窗
   * （见 NotePopover 的 NOTE_EDIT_FLOAT_K），否则用户缩一下画布就会丢掉正在输入的内容。
   */
  const fixedNotePanels = useMemo(() => {
    if (noteLod !== 'full' && editingNoteIdSet.size === 0) return [];
    const panels = fixedNotePanelsOf(
      layout,
      fixedNoteIds,
      editingNoteIdSet,
      view,
      viewport.transform,
      estimateNoteAreaHeight(),
    );
    return noteLod === 'full' ? panels : panels.filter((p) => p.editing);
  }, [editingNoteIdSet, fixedNoteIds, layout, view, viewport.transform, noteLod]);
  onNodeClickRef.current = onNodeClick;
  onBlankClickRef.current = onBlankClick;
  const onNodeContextRef = useRef(onNodeContext);
  onNodeContextRef.current = onNodeContext;
  const onEditCommitRef = useRef(onEditCommit);
  onEditCommitRef.current = onEditCommit;
  const onEditCancelRef = useRef(onEditCancel);
  onEditCancelRef.current = onEditCancel;
  const onEditTabGrowRef = useRef(onEditTabGrow);
  onEditTabGrowRef.current = onEditTabGrow;
  const onCenterMoveRef = useRef(onCenterMove);
  onCenterMoveRef.current = onCenterMove;
  const onBeamChangeRef = useRef(onBeamChange);
  onBeamChangeRef.current = onBeamChange;
  const onToggleCollapseRef = useRef(onToggleCollapse);
  onToggleCollapseRef.current = onToggleCollapse;
  const onToggleExpandRef = useRef(onToggleExpand);
  onToggleExpandRef.current = onToggleExpand;

  /**
   * B-P2：NodeG memo 的 props 稳定化（引用恒定才算「props 稳定」）——
   * ① 折叠回调：ref 转发 + 传 id（NodeG 用自己的节点 id 调用），原先每渲染新建闭包 → memo 永不命中；
   */
  const handleToggleCollapse = useCallback((id: string) => onToggleCollapseRef.current?.(id), []);

  /** ② resolveAssetUrl：app 层常传内联 lambda → 经 ref 转发后引用恒定（B-P2） */
  const resolveAssetUrlRef = useRef(resolveAssetUrl);
  resolveAssetUrlRef.current = resolveAssetUrl;
  const resolveAssetUrlStable = useCallback(
    (assetRef: { kind: string; id: string }) => resolveAssetUrlRef.current?.(assetRef),
    [],
  );

  /** B-P3：缩放手势进行中（pinch 由 useMapGestures 上报；wheel 由本组件 handler 上报 + 空闲释放） */
  const [zoomGestureActive, setZoomGestureActive] = useState(false);
  const gestureReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleGestureRelease = useCallback((): void => {
    if (gestureReleaseTimerRef.current) clearTimeout(gestureReleaseTimerRef.current);
    gestureReleaseTimerRef.current = setTimeout(() => {
      gestureReleaseTimerRef.current = null;
      setZoomGestureActive(false);
    }, 120); // wheel 是离散事件（无「结束」信号）：空闲 120ms 视为手势结束
  }, []);
  const markZoomGesture = useCallback(
    (active: boolean): void => {
      if (active) {
        setZoomGestureActive(true);
        return;
      }
      scheduleGestureRelease(); // pinch 抬手：统一走延迟释放（与 wheel 同路径，避免抖动）
    },
    [scheduleGestureRelease],
  );
  /** B-P3：滚轮缩放「开始 + 续期」—— 每个 wheel 事件续期，最后一个事件后 120ms 才解冻 LOD */
  const markWheelZoom = useCallback((): void => {
    setZoomGestureActive(true);
    scheduleGestureRelease();
  }, [scheduleGestureRelease]);
  const onQaChangeRef = useRef(onQaChange);
  onQaChangeRef.current = onQaChange;
  const onEditStartRef = useRef(onEditStart);
  onEditStartRef.current = onEditStart;
  const onFrameKeyRef = useRef(onFrameKey);
  onFrameKeyRef.current = onFrameKey;
  const onNodeMoveRef = useRef(onNodeMove);
  onNodeMoveRef.current = onNodeMove;
  const onAssetFilesRef = useRef(onAssetFiles);
  onAssetFilesRef.current = onAssetFiles;
  const onAssetDropRef = useRef(onAssetDrop);
  onAssetDropRef.current = onAssetDrop;
  // 可见节点镜像（供 senseAt 读取；见其注释里的 TDZ 说明）
  const visibleNodesRef = useRef<readonly (typeof layout.nodes)[number][]>([]);
  const onEdgeClickRef = useRef(onEdgeClick);
  onEdgeClickRef.current = onEdgeClick;
  const onEdgeManualChangeRef = useRef(onEdgeManualChange);
  onEdgeManualChangeRef.current = onEdgeManualChange;
  // Opp 精确翻转：用 ref 承接，避免上层传内联函数导致路由结果回调每次渲染都变
  const onEdgeRoutesRef = useRef(onEdgeRoutes);
  onEdgeRoutesRef.current = onEdgeRoutes;
  // 必须是稳定引用 —— FreeEdgeLayer 的 useEffect 依赖它；
  // 若每渲染都换新函数，会「回调 → 上层 setState → 重渲染 → 再回调」形成死循环。
  const handleRoutesChange = useCallback((routes: ReadonlyMap<string, EdgeRouteEntry>) => {
    onEdgeRoutesRef.current?.(routes);
  }, []);
  // R5-2：自由边标签宿主存储 —— 收集面（FreeEdgeLayer）与渲染面（标签层）解耦。
  // set 引用短路 + 订阅面收敛到 FreeEdgeLabelLayer：标签随路由每帧变化（动画期）时
  // 只有几条 EdgeLabel 重渲，MapView 不整树重渲（与 viewport / controller store 同款纪律）。
  const freeLabelStoreRef = useRef<FreeEdgeLabelStore | null>(null);
  if (freeLabelStoreRef.current === null) freeLabelStoreRef.current = new FreeEdgeLabelStore();
  const freeLabelStore = freeLabelStoreRef.current;
  // 同理必须是稳定引用 —— FreeEdgeLayer 的 layout effect 依赖它
  const handleEdgeLabels = useCallback(
    (labels: readonly FreeEdgeLabelSpec[]) => {
      freeLabelStore.set(labels);
    },
    [freeLabelStore],
  );
  // Issue #3：屏幕坐标 → 世界坐标（拖 handle 定位；需扣掉容器偏移）
  const toWorld = useCallback(
    (sx: number, sy: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      return viewport.toWorld(sx - (rect?.left ?? 0), sy - (rect?.top ?? 0));
    },
    [viewport],
  );
  const onTreeEdgeEditRef = useRef(onTreeEdgeEdit);
  onTreeEdgeEditRef.current = onTreeEdgeEdit;
  const onEdgeConnectRef = useRef(onEdgeConnect);
  onEdgeConnectRef.current = onEdgeConnect;
  // v1.3.0 幕布描述回调 ref（避免闭包陈旧）
  const onDescCommitRef = useRef(onDescCommit);
  onDescCommitRef.current = onDescCommit;
  const onDescCancelRef = useRef(onDescCancel);
  onDescCancelRef.current = onDescCancel;
  const onDescEditRequestRef = useRef(onDescEditRequest);
  onDescEditRequestRef.current = onDescEditRequest;
  // L1 文本区域链接跳转回调 ref（同款纪律）
  const onJumpToAnchorRef = useRef(onJumpToAnchor);
  onJumpToAnchorRef.current = onJumpToAnchor;

  // E6：连接手柄拖拽（图操作）——选中节点手柄按下 → 引导线跟随 + 悬停目标高亮 → 松手建边
  const [connectDrag, setConnectDrag] = useState<{
    sourceId: string;
    x: number;
    y: number;
    hoverId: string | null;
  } | null>(null);

  // 自由边数据（E5：文档级标注边——root note.edges；锚存路径，会话内解析）
  // E8：几何根以 depth===0 定位（原用 layout.nodes[0] 假定有序——折叠路由会算错祖先）
  const geometricRoot = useMemo(() => layout.nodes.find((n) => n.depth === 0)?.node, [layout]);
  // G6′复审修复：文档根 ≠ 几何根。森林/多中心投影下 layout.nodes 可有多个 depth===0
  // 几何根（layoutForest 甚至不输出文档根），collectFreeEdges 与 FreeEdgeLayer 的折叠
  // 祖先解析必须读【完整内容树】。显式 documentRoot 优先；缺省回退首个几何根
  // （旧单树布局下二者一致，兼容既有调用方与测试——MindmapStage 等产品壳必须显式传入）。
  const rootNode = documentRoot ?? geometricRoot;
  const freeEdges = useMemo(() => (rootNode ? collectFreeEdges(rootNode) : []), [rootNode]);

  // G6′ 用户回归：声明方向覆盖几何判据。全树声明方向（自身显式 ?? 最近显式祖先；岛默认
  // 不充当声明——中心节点特化）——铺宽的上分支组外侧子节点虽与父盒无 x 重叠，仍必须从
  // 父顶边中心出发梁线；而均衡模式下根左侧的无声明子节点不被岛 'right' 顶死右缘（否则
  // 连线横穿中心节点），回退几何自适应贴左缘。
  const growDirOf = useMemo(
    () => (rootNode ? collectDeclaredGrowDir(rootNode) : new Map<string, GrowDir>()),
    [rootNode],
  );
  // v1.7.0：出线枢纽标记（note.hub）——其左右组连线渲染为共享竖梁 bus 线型
  const hubInfo = useMemo(() => {
    const m = new Map<string, boolean>();
    let any = false;
    const w = (n: EditableNode): void => {
      const h = readHubFlag(n.note);
      m.set(n.id, h);
      if (h) any = true;
      for (const c of n.children) w(c);
    };
    if (rootNode) w(rootNode);
    return { map: m, any };
  }, [rootNode]);
  const hubOf = hubInfo.map;
  // 无枢纽文档（绝大多数）的快速门：跳过每帧 O(链接数) 的横向梁映射/把手构建
  const hasHubNodes = hubInfo.any;

  // 文件拖入画布高亮（P1）
  const [fileDragActive, setFileDragActive] = useState(false);
  // FA2-T3：拖放落点预览（松手前即可预知会被设成图标/插图/子分支/自由节点）
  const [dropPreview, setDropPreview] = useState<{
    target: DropTarget;
    sx: number;
    sy: number;
  } | null>(null);

  /**
   * 落点判定（FA2-T3）：世界坐标 → 命中哪个节点、落在它的哪一块。
   *
   * 用 ref 读 visibleNodes 而非闭包：本函数在组件靠前处定义，
   * 而 `visibleNodes` 要到下面才声明（TDZ）—— 直接引用会编译不过。
   * ref 每渲染同步，读到的始终是当前帧的可见节点。
   */
  const senseAt = useCallback(
    (e: { clientX: number; clientY: number }, el: Element | null): DropTarget | null => {
      if (!el) return null;
      const w = worldPointOf(e, el, viewport);
      const boxes = visibleNodesRef.current.map((ln) => ({
        id: ln.node.id,
        box: { x: ln.box.x, y: ln.box.y, w: ln.box.w, h: ln.box.h } satisfies DropBox,
      }));
      return senseDropTarget(boxes, w);
    },
    [viewport],
  );

  // 渲染后端（M5-T7）：SVG 适配器——连线等原语经后端绘制，为未来 Canvas 切换预留
  const backendRef = useRef<RenderBackend | null>(null);
  if (backendRef.current === null) backendRef.current = createSvgBackend();
  const backend = backendRef.current;

  const epoch = useSyncExternalStore(viewport.subscribe, viewport.getSnapshot);

  // 尺寸观测（ResizeObserver → 视口脏标记 → 单帧渲染；jsdom/SSR 无 RO 时跳过）
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) viewport.setSize(e.contentRect.width, e.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewport]);

  // 派生数据：分支索引 / 盒表 / 渲染度量（layout 或字符度量变化时重建）
  // MEASURE-RANK：度量按 depth 取档（与布局同一份 charOf）——盒与渲染字号不看两套口径
  const charFor = useCallback(
    (depth: number): CharMeasure => (charOf === undefined ? char : charOf(visualRankOf(depth))),
    [char, charOf],
  );
  const derived = useMemo(() => {
    const metric = createDisplayMetricsFn(char, entities, charOf);
    const branchIndex = computeBranchIndex(layout.nodes);
    const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
    const metrics = new Map<string, ReturnType<typeof metric>>();
    for (const ln of layout.nodes) {
      boxes.set(ln.node.id, ln.box);
      metrics.set(ln.node.id, metric(ln.node, ln.depth));
    }
    return { boxes, metrics, branchIndex, metricFn: metric };
  }, [layout, char, charOf, entities]);

  /**
   * B-P2：节点卡样式缓存（键 = 色板索引|档位|实体类型）——style 引用稳定是 NodeG memo 命中的前提
   * （原先每渲染 nodeCardStyle 都新建对象 → memo 永不命中）。换主题时随 token 重建。
   */
  const cardStyleCache = useMemo(
    () => new Map<string, ReturnType<typeof nodeCardStyle>>(),
    [token],
  );

  // E7 审查：节点 id → node 索引（树边 overlay 每帧查 child 标注，避免 O(links×nodes) 扫描）
  const nodeByIdx = useMemo(() => {
    const m = new Map<string, EditableNode>();
    for (const ln of layout.nodes) m.set(ln.node.id, ln.node);
    return m;
  }, [layout]);

  /**
   * FO-B2：框视图（框壳 + 框内大纲）——数据 = 文档树（框根 + `partitionFrameSubtree` 大纲层）
   * + B1 岛产出的盒表（`derived.boxes`）；本层**不重算布局**，行位置与画布几何同源。
   *
   * 跳过四种情形：框根被用户折叠（§5.2 整岛隐藏，仍以普通节点卡呈现）；落在别的框大纲层里的
   * 嵌套框（设计 §3.3 一期禁止，按普通行渲染）；无合法 `node.frame`；行盒不在布局中。
   */
  const frameViews = useMemo(() => {
    if (!rootNode) return [];
    const out: { root: EditableNode; depth: number; rows: string[] }[] = [];
    const claimed = new Set<string>();
    for (const f of collectFrameRoots(rootNode)) {
      if (claimed.has(f.id)) continue;
      const spec = frameOf(f.note);
      if (spec === undefined) continue;
      if (collapsedIds?.has(f.id) ?? false) continue;
      const rows = partitionFrameSubtree(f, spec.depth).outlineIds.filter((id) =>
        derived.boxes.has(id),
      );
      if (rows.length === 0) continue;
      for (const id of rows) claimed.add(id);
      out.push({ root: f, depth: spec.depth, rows });
    }
    return out;
  }, [rootNode, collapsedIds, derived]);

  /** 框内大纲行 id：这些节点不再画节点卡（由 FrameOutline 的行承载；空间层节点仍走节点卡） */
  const frameRowIds = useMemo(() => {
    const ids = new Set<string>();
    for (const v of frameViews) for (const id of v.rows) ids.add(id);
    return ids;
  }, [frameViews]);

  // 视口变换渲染（render body 内：每次 epoch 变化重算可见集合——单帧触发）
  // A2：大图（>LOD_AUTO_NODES）自动激进 LOD（T8 降级策略 L1 接线）
  // B-P3：缩放手势期**冻结 LOD** —— 手势中跨越阈值会让整图文案/结构反复重排（可见抖动）；
  //        手势结束再按实时 k 切换一次。平移不改 k，LOD 天然稳定 → 平移不进入冻结（计划 §1 第 7 条）。
  // MEASURE-RANK 后续：LOD 滞回 —— 回传上一档，进出档取不同阈值（k 停在 0.5/0.26 附近时
  // 密叶文字不再随 ±0.001 抖动反复进出）。首帧 prev = null → 无滞回（旧行为逐值不变）。
  const frozenLodRef = useRef<LodLevel | null>(null);
  const lodLive = lodFor(viewport.transform.k, layout.nodes.length, frozenLodRef.current);
  if (!zoomGestureActive) frozenLodRef.current = lodLive;
  const lod: LodLevel = zoomGestureActive ? (frozenLodRef.current ?? lodLive) : lodLive;

  // IO-1（B-P3 同款冻结）：缩放手势期「总览判定用的 k」也取冻结值（与 LOD 同一开关）——
  // 手势中跨越 K_OVERVIEW 会让整层卡片反复建/拆（远观整屏重排）；松手再切一次档。
  const frozenKRef = useRef(viewport.transform.k);
  if (!zoomGestureActive) frozenKRef.current = viewport.transform.k;
  const overviewK = zoomGestureActive ? frozenKRef.current : viewport.transform.k;
  // C2：Canvas 模式（强制 或 >CANVAS_AUTO_NODES 自动降级）——场景树构建（世界坐标）。
  // A6/T23 门禁在 resolveBackend：显式 forceBackend='svg' 压过自动降级（不静默丢岛/边）。
  // ⚠️ 声明提前到总览判定之前：Canvas 分支不渲染 SVG 层（含总览卡），若总览档仍隐藏成员，
  // 会出现「成员消失、无卡承接」的空画布 —— 故 Canvas 下总览整体退让（PROBE 已知边界，
  // 产品壳对含岛文档已强制 SVG，见 MindmapStage 的 forceBackend）。
  const useCanvas = resolveBackend(forceBackend, layout.nodes.length) === 'canvas';
  // D2：「有岛」唯一口径 = centerIds 非空（无中心文档即使挂空岛表也不得进入总览）
  const overview = overviewActive(overviewK, hasOverviewIslands(centerIds)) && !useCanvas;

  // E8：连线避障的障碍集（全量节点盒 + id）。
  // 低 LOD（缩小视图）传空数组关闭寻路——与树边命中区/chip 的 `lod === 'full'` 门控同一策略：
  // 缩小时单条边只占几个像素，寻路无视觉收益，而成本随节点数增长。
  // P2-1：动画期（animating）同样置空 → 路由走 S 形/直连快路径，并配合 FreeEdgeLayer
  // fastRouting 跳过交叉检测/跳线，避免动画每帧触发 O(E×A×C×S×O) + O(E²×P²) 的重算。
  const animating = anim !== null;
  const edgeObstacles = useMemo(
    () => edgeObstaclesOf(layout, lod, animating),
    [layout, lod, animating],
  );
  const start = performance.now();
  // 渲染盒 = 动画帧优先（M5-T2 过渡中）/ 布局盒（静止）
  const animBoxes = anim?.boxes;

  /**
   * ROOT-DRAG-1：拖拽/预览的中心判据（单一出口）。缺省回退 centerIds —— 未接线宿主行为不变；
   * 产品壳传 centerEntryIds（仅真实中心）→ 虚拟根岛不可拖、不写 note（见 centerEntryIds 注释）。
   */
  const dragCenters = centerEntryIds ?? centerIds;

  // G6″（A4）：中心岛拖动实时预览——拖动位移（屏幕 px）按当前缩放换算为世界位移，
  // 成员盒在唯一出口 renderBoxOf 上统一平移（节点卡/树线端点/裁剪/附属区派生自动跟随）。
  // 预览是纯会话态：不写 note、不进 history；提交/取消由手势层负责（design §7）。
  // ROOT-DRAG-1：门控用 dragCenters（虚拟根岛不产生预览——拖它根本进不了拖拽管线）。
  const centerPreview = useMemo(() => {
    if (!nodeDrag?.moved || !dragCenters?.has(nodeDrag.nodeId) || !islandMembers) return null;
    // 包容语义：父岛拖动预览并移子孙岛成员（切断岛不在 nested 表内）
    const memberList =
      nestedCenterIdsByRoot !== undefined
        ? containedMemberIds(nodeDrag.nodeId, islandMembers, nestedCenterIdsByRoot)
        : (islandMembers.get(nodeDrag.nodeId) ?? []);
    if (memberList.length === 0) return null;
    const k = viewport.transform.k > 0 ? viewport.transform.k : 1;
    return { dx: nodeDrag.dx / k, dy: nodeDrag.dy / k, members: new Set(memberList) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeDrag, dragCenters, islandMembers, nestedCenterIdsByRoot, viewport.transform.k]);

  const renderBoxOf = (id: string, fallback: Box): Box => {
    const base = animBoxes?.get(id) ?? fallback;
    if (centerPreview && centerPreview.members.has(id)) {
      return { ...base, x: base.x + centerPreview.dx, y: base.y + centerPreview.dy };
    }
    return base;
  };

  // E8：自由边端点取盒（稳定引用）——路由缓存的前提之一，但**单靠此处不足**。
  // G-P4 注释对齐（详见 docs/dispatch/2026-09-12-freeedge-routing-recompute-plan.md）：
  // 让 pan 不再逐帧重算的真正链路 = visibleFreeEdges 内容键稳定（G-P1）+ 裁剪窗口量化（G-P2）
  // → 路由重算频率 ≤ 每 256px 一次；仅动画逐帧变化时才回到逐帧重算。
  const edgeBoxOf = useCallback(
    (id: string): Box | undefined => {
      const b = derived.boxes.get(id);
      return b ? renderBoxOf(id, b) : undefined;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [derived, animBoxes],
  );

  // v1.5.0 Section 空间分区（T3）：解析根 note.sections → 帧模型（背景层，位于连线/节点之下）。
  // 纯渲染投影：不进 layout.nodes（不参与节点裁剪）、不污染 layout.bounds（fit 无回归）。
  // FE-FRAME-1.1 两级 memo（分层见 sectionMembership.ts 头注释）：
  // · A · sectionMembership（成员清单/标题/贴框索引）—— deps 只有文档与岛表：动画与中心
  //   拖拽预览期**零重算**（不再每帧 walk(contentRoot) + 重算成员公式）；
  // · B · sectionData（取盒建帧 + bounds 索引）—— 跟 derived / animBoxes / centerPreview
  //   逐帧重建，框随预览与布局动画实时跟随（与节点/连线同一数据源）。
  // 成员公式仍是唯一出口：B 的画框 memberIdsOf 与 refineEndpoints 的贴框索引同取 A 层产物。
  const sectionMembership = useMemo(
    () => buildSectionMembership({ rootNode, islandMembers, nestedCenterIdsByRoot }),
    [rootNode, islandMembers, nestedCenterIdsByRoot],
  );

  const sectionData = useMemo((): SectionData => {
    const { resolved, titleOf, memberIdsOf, memberIndex } = sectionMembership;
    if (resolved.length === 0) return EMPTY_SECTION_DATA;
    const views = buildSectionViews({
      resolved,
      titleOf,
      memberIdsOf,
      boxOf: (id) => {
        const b = derived.boxes.get(id);
        return b ? renderBoxOf(id, b) : undefined;
      },
      collapsedIds: collapsedIds ?? EMPTY_COLLAPSED,
    });
    // 贴框索引 bounds 侧：只登记**成框**（kind==='frame'）的 section——bounds 取帧上已算好的
    // 盒（已跟 centerPreview/anim）；未成框 section（成员全无盒）不进 bounds → F4 不提升。
    // （成员侧索引来自 A 层：与画框 memberIdsOf 同一结果，杜绝「索引与框体漂移」。）
    const boundsIndex = new Map<string, Box>();
    for (const v of views) {
      if (v.kind !== 'frame') continue;
      boundsIndex.set(v.id, v.bounds);
    }
    return { views, memberIndex, boundsIndex };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionMembership, derived, collapsedIds, animBoxes, centerPreview]);
  const sectionViews = sectionData.views;

  // ---------------- S4：摘要括线视图（变换 g 内，节点层之下） ----------------
  // 见下方 `summaryViews`（依赖 `cullBoxes`，故就近定义在它之后）。

  // ---------------- IO-1：岛级远观总览（k < K_OVERVIEW 且有中心岛） ----------------
  // 卡 VM 走纯函数（islandOverview.ts）：标题（Section 优先）/ 计数 / 屏稳尺寸由图层负责；
  // bounds 与 Section 帧同口径（成员盒并集外扩），取盒经 renderBoxOf → 布局动画与中心
  // 拖拽预览自动跟随（deps 与 sectionViews 同源）。总览未激活时零计算、零分配。
  const islandCards = useMemo(() => {
    if (!overview || centerIds === undefined || islandMembers === undefined || islandMembers.size === 0) {
      return EMPTY_ISLAND_CARDS;
    }
    const sectionByRootId = new Map<string, { title: string; color?: string }>();
    for (const v of sectionViews) {
      if (v.kind === 'frame') sectionByRootId.set(v.rootId, { title: v.title, color: v.color });
    }
    return buildIslandOverviewCards({
      centerIds,
      membersByRoot: islandMembers,
      ...(nestedCenterIdsByRoot !== undefined ? { nestedCenterIdsByRoot } : {}),
      sectionByRootId,
      // 无 Section 的中心 → 中心节点文本（实体节点回退到 @kind:id，与 Section 标题链同口径）
      titleOf: (id) => {
        const n = nodeByIdx.get(id);
        if (n === undefined) return id;
        if (n.type === 'text') return n.text !== undefined && n.text !== '' ? n.text : id;
        if (n.type === 'entity' && n.ref) return `@${n.ref.kind}:${n.ref.id}`;
        return id;
      },
      boxOf: (id) => {
        const b = derived.boxes.get(id);
        return b ? renderBoxOf(id, b) : undefined;
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    overview,
    centerIds,
    islandMembers,
    nestedCenterIdsByRoot,
    sectionViews,
    nodeByIdx,
    derived,
    animBoxes,
    centerPreview,
  ]);

  /**
   * FE-FRAME-1 · F5：总览卡贴卡索引（扁平数组，迷你在前、父卡在后 —— 顺序匹配即迷你优先）。
   * 成员 = 与建卡同源解算（islandOverviewMemberIdsOf）；bounds = 卡 VM bounds（与建卡同源）。
   * 迷你卡的屏稳最小尺寸放大发生在图层内部（IslandOverviewLayer），锚点仍按 VM bounds 取
   * （设计 F5：「图层无 placed 缓存则用 VM bounds」；本批不做屏稳几何复刻）。
   */
  const overviewCardIndex: OverviewCardIndex = useMemo(() => {
    if (!overview || islandCards.length === 0 || islandMembers === undefined) {
      return EMPTY_OVERVIEW_CARDS;
    }
    const out: { rootId: string; bounds: Box; memberIds: ReadonlySet<string> }[] = [];
    for (const card of islandCards) {
      for (const mini of card.nestedCards ?? []) {
        out.push({
          rootId: mini.rootId,
          bounds: mini.bounds,
          memberIds: new Set(
            islandOverviewMemberIdsOf(mini.rootId, islandMembers, nestedCenterIdsByRoot),
          ),
        });
      }
      out.push({
        rootId: card.rootId,
        bounds: card.bounds,
        memberIds: new Set(
          islandOverviewMemberIdsOf(card.rootId, islandMembers, nestedCenterIdsByRoot),
        ),
      });
    }
    return out;
  }, [overview, islandCards, islandMembers, nestedCenterIdsByRoot]);

  /**
   * FE-FRAME-1：FreeEdgeLayer 的**解析后提升**钩子（设计 §4 方案 A 的闭包版）。
   * 只改端点盒（F8：身份/命中/菜单不动）；无 Section 且无总览时恒等返回原 eps
   * （引用不变 → 路由缓存 key 与下游引用稳定）。
   * 引用稳定性：deps 全部为 memo 产物 —— pan / hover / 选中重渲染不改变引用
   * （与 boxOf 同款纪律，防路由整表重算）。
   */
  const refineEndpoints = useCallback(
    (edge: FreeEdge, eps: EdgeEndpoints): EdgeEndpoints => {
      // 两端语义已含在 eps.fromId / toId（F1 用解析后有效 id）；edge 仅作签名占位。
      void edge;
      return refineFreeEdgeEndpoints(eps, {
        overview,
        overviewCards: overviewCardIndex,
        sectionMembers: sectionData.memberIndex,
        sectionBounds: sectionData.boundsIndex,
      });
    },
    [overview, overviewCardIndex, sectionData],
  );

  /**
   * 总览要隐藏的节点集：**有卡的岛**的成员解算结果并集（与建卡同源解算函数）。
   * 只藏「有卡代理」的成员 —— 不产生「成员消失、却无卡承接」的空洞（成功标准 §8-1/§8-5）。
   */
  const islandHiddenIds = useMemo(() => {
    if (!overview || islandCards.length === 0 || islandMembers === undefined) return EMPTY_ID_SET;
    const ids = new Set<string>();
    for (const card of islandCards) {
      for (const id of islandOverviewMemberIdsOf(card.rootId, islandMembers, nestedCenterIdsByRoot)) {
        ids.add(id);
      }
    }
    return ids;
  }, [overview, islandCards, islandMembers, nestedCenterIdsByRoot]);

  /** 有卡的 root 集合（Section chrome 避让 D10：同一 root 不再画 Section 标题/框） */
  const islandCardRoots = useMemo(() => {
    const ids = new Set<string>();
    for (const card of islandCards) ids.add(card.rootId);
    return ids;
  }, [islandCards]);

  // Section 选中态（会话态；T5 接 Esc/空白退出三件套）
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  // 总览卡选中态（会话态，不落盘不进 history；与 Section 选中同层，Esc / 点卡外退出）
  const [selectedIslandRootId, setSelectedIslandRootId] = useState<string | null>(null);

  // v1.5.0 Section 标题栏拖拽（T4）：等价于「按住中心节点本体」——注入同一 nodeDrag，
  // 后续 pointermove/pointerup 由既有手势层接管（centerPreview 实时预览 + 单次 onCenterMove 提交
  // + Esc 零调用，全部沿用 mapview-center-drag 既有语义，零新写回通道）。
  // D1 守卫：root 非 center（手写 YAML 可能）→ 不启动拖拽（否则退化为节点重排，语义错误）。
  // ROOT-DRAG-1：判据必须是**有 center 条目**的真实中心（dragCenters）——根锚 Section 的
  // 标题此前因「虚拟根岛在 centerIds 里」被放行，拖放即由宿主 upsert 出根 center 条目
  // （静默升格，绕过 is-root 守卫）。
  const handleSectionTitlePointerDown = (
    rootId: string,
    e: ReactPointerEvent<SVGGElement>,
  ): void => {
    if (!dragCenters?.has(rootId)) return;
    viewport.cancelAnim();
    setNodeDrag({
      nodeId: rootId,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      dx: 0,
      dy: 0,
      moved: false,
      targetId: null,
      mode: 'child',
      valid: false,
    });
    e.stopPropagation();
  };
  // A4：节点卡（NodeG）直接读 ln.box——预览成员在此产出偏移副本（浅拷贝，children 引用共享）。
  // B-P1：可见集过滤走网格索引（节点数 ≥ INDEX_MIN_NODES 时）——索引粗筛 + 原 isBoxInView 精判，
  //        输出与线性路径同序同集；小图（低于阈值）保持原线性路径（零回归）。
  const cullBoxes = useMemo(
    () => layout.nodes.map((n) => renderBoxOf(n.node.id, n.box)),
    [layout, animBoxes, centerPreview],
  );
  // ---------------- S4：摘要括线视图（变换 g 内，节点层之下） ----------------
  // 纯渲染投影：不进 layout.nodes、不改 bounds、不参与命中。
  //
  // 依赖口径（S4-R2 修复）：成员带与摘要盒都取**动画帧盒** —— 直接复用上面的
  // `cullBoxes`（它就是 `layout.nodes.map(renderBoxOf(…))`，与 layout.nodes **同序同长**），
  // 而不是再包一层 renderBoxOf 调用。这样：
  //   ① 闭包不引用 renderBoxOf → 不产生新的 useExhaustiveDependencies；
  //   ② 取盒出口仍是同一个 renderBoxOf（含动画帧盒 + 中心拖拽预览平移），语义与修复前一致。
  // 无 satellites（无摘要 / 全部降级 / 该布局路径不承诺）→ 零计算、零分配、零层级。
  const summaryViews = useMemo(() => {
    const sats = layout.satellites;
    if (sats === undefined || sats.length === 0) return EMPTY_SUMMARY_VIEWS;
    return buildSummaryViews({
      root: rootNode,
      satellites: sats,
      nodes: layout.nodes.map((ln, i) => {
        const box = cullBoxes[i];
        return box === undefined ? ln : { ...ln, box };
      }),
    });
  }, [layout, rootNode, cullBoxes]);
  const cullIndex = useMemo(
    () => (cullBoxes.length >= INDEX_MIN_NODES ? buildBoxIndex(cullBoxes) : null),
    [cullBoxes],
  );
  const visibleNodes = useMemo(() => {
    const picked: LayoutNode[] = [];
    if (cullIndex) {
      for (const i of queryBoxIndex(cullIndex, view)) {
        const ln = layout.nodes[i];
        const box = cullBoxes[i];
        if (ln && box && isBoxInView(box, view, CULL_MARGIN)) picked.push(ln);
      }
    } else {
      layout.nodes.forEach((ln, i) => {
        const box = cullBoxes[i];
        if (box && isBoxInView(box, view, CULL_MARGIN)) picked.push(ln);
      });
    }
    return picked
      // IO-1：总览档不画岛内成员 NodeG（含中心本体卡）——同时从命中集剔除，
      // 否则「看不见的节点」仍会吃掉点击/悬停（D5；命中与绘制同源纪律）。
      .filter((ln) => !islandHiddenIds.has(ln.node.id))
      .map((ln) => {
        if (!centerPreview || !centerPreview.members.has(ln.node.id)) return ln;
        return {
          ...ln,
          box: { ...ln.box, x: ln.box.x + centerPreview.dx, y: ln.box.y + centerPreview.dy },
        };
      });
    // view 用 primitive：viewport.transform 是原地 mutate 的稳定引用，进 deps 等于永不失效（§1 第 6 条）
  }, [layout, cullBoxes, cullIndex, view.x, view.y, view.w, view.h, centerPreview, islandHiddenIds]);
  /** B-P1：命中粗筛索引（建在 visibleNodes 上、跨帧复用；低于阈值 → null = 原线性路径） */
  const hitIndex = useMemo(
    () =>
      visibleNodes.length >= INDEX_MIN_NODES ? buildBoxIndex(visibleNodes.map((v) => v.box)) : null,
    [visibleNodes],
  );
  visibleNodesRef.current = visibleNodes;
  // 淡出中的被删节点（ghost）：仅动画期间存在，参与裁剪但不计入 stats
  const visibleGhosts =
    anim?.ghosts.filter((g) =>
      isBoxInView(animBoxes?.get(g.node.id) ?? g.box, view, CULL_MARGIN),
    ) ?? [];
  const visibleLinks = filterVisibleLinks(layout.links, derived.boxes, view, CULL_MARGIN);

  // G6′ 垂直连线共享梁：up/down 方向组共用一条水平梁（与内核 makeLinkByDir 公式一致）。
  // 每帧以当前（动画期 = 插值）盒重算分组 → 梁随节点动画同步；O(n)，与逐帧路径构建同阶。
  // dir：声明方向（growDirOf）——声明 up/down 时无视 x 重叠与否，一律并入垂直组。
  const visibleLinkGeoms = visibleLinks.flatMap((ln) => {
    // IO-1：总览档岛内树边不画（两端都在被隐藏的岛成员内）。跨岛边界边不在本表
    // （boundaryLinks 独立渲染，D5 要求保留）；只藏单端的连线不存在（成员覆盖全树），
    // 判「两端」而非「任一端」是防未来出现非岛节点时误删其连线。
    if (islandHiddenIds.size > 0 && islandHiddenIds.has(ln.fromId) && islandHiddenIds.has(ln.toId)) {
      return [];
    }
    const fb = derived.boxes.get(ln.fromId);
    const tb = derived.boxes.get(ln.toId);
    if (!fb || !tb) return [];
    return [
      {
        ln,
        fromId: ln.fromId,
        from: renderBoxOf(ln.fromId, fb),
        to: renderBoxOf(ln.toId, tb),
        dir: growDirOf.get(ln.toId),
      },
    ];
  });
  // v1.11.0：梁比例位读取（note.beamAt[dir] + PAD 钳制）——渲染梁位与把手同源（同一回调）
  const beamAtOf = useCallback(
    (fromId: string, dir: BeamDir, gap: number): number =>
      readBeamAt(nodeByIdx.get(fromId)?.note, dir, gap),
    [nodeByIdx],
  );
  const linkBeamYs = verticalBeamMap(visibleLinkGeoms, (g) => g.dir, beamAtOf);
  const linkBeamXs = hasHubNodes
    ? horizontalBeamMap(
        visibleLinkGeoms,
        (g) => hubOf.get(g.fromId) === true,
        (g) => g.dir,
        beamAtOf,
      )
    : EMPTY_BEAM_MAP;
  // v1.7.0：hub 共享梁把手（命中测试 + 拖拽映射的输入；每帧随插值盒重建）
  const hubLinks = hasHubNodes
    ? visibleLinkGeoms.filter((g) => hubOf.get(g.fromId) === true)
    : EMPTY_LINKS;
  const beamHandles = hasHubNodes
    ? buildBeamHandles(hubLinks, (l) => linkBeamYs.get(l) ?? linkBeamXs.get(l), beamAtOf)
    : EMPTY_HANDLES;

  // G6″（A3-2/G3）：跨岛父子连接可见性——两端盒都在布局中（投影 owner 覆盖全树）才可画；
  // 端点盒缺失（如父端被折叠隐藏，布局不含该节点）时跳过，不误连到原点。
  // 折叠祖先锚定路由（既有折叠端点策略）归后续工作包接入。
  const visibleBoundaryLinks = useMemo(() => {
    if (!boundaryLinks || boundaryLinks.length === 0) return [];
    const inView = (b: Box): boolean =>
      b.x + b.w >= view.x - CULL_MARGIN &&
      b.x <= view.x + view.w + CULL_MARGIN &&
      b.y + b.h >= view.y - CULL_MARGIN &&
      b.y <= view.y + view.h + CULL_MARGIN;
    return boundaryLinks.filter((l) => {
      const fb = derived.boxes.get(l.fromId);
      const tb = derived.boxes.get(l.toId);
      if (!fb || !tb) return false;
      const sx = Math.min(fb.x, tb.x);
      const sy = Math.min(fb.y, tb.y);
      return inView({
        x: sx,
        y: sy,
        w: Math.max(fb.x + fb.w, tb.x + tb.w) - sx,
        h: Math.max(fb.y + fb.h, tb.y + tb.h) - sy,
      });
    });
  }, [boundaryLinks, derived, view.x, view.y, view.w, view.h]);

  // 性能（E7 审查）：自由边视口裁剪。
  // E8 修复（用户反馈②「连线丢失」）：原按【端点】裁剪——长边两端都在视口外、但曲线中段
  //   穿过视口时，两端判定皆 false → 整条边被误删（视觉上「连线凭空消失」）。
  //   改为按【两端点包围盒】裁剪：边跨越视口即渲染，与曲线实际覆盖范围一致。
  // 必须 memo 化：这是 FreeEdgeLayer 路由 useMemo 的依赖项之一。
  // 若不 memo，任何重渲染（hover / 选中 / 面板开关）都会产出新数组，
  // 导致**全部边重算路由**（100 条边 ≈ 0.5s），并使路由回调自我触发成死循环。
  // 依赖取 view 的原始数值而非 view 对象 —— view 由 viewport.worldRect() 每次新建。
  // G-P1（自由边路由治理）：出口经 stableByKeys 按 edge.key 稳定化 —— 平移只改裁剪窗口、
  // 成员未变时返回上一引用，下游 FreeEdgeLayer 路由 memo 不再被击穿（详见本 memo 内注释）。
  // G-P2：裁剪窗口再量化到 CULL_QUANT 网格（外扩超集）—— 窗口只在跨网格线时变化，
  // 配合 G-P1 后重算频率从「每帧可能」降到「每 256px 至多一次」（计划 G-P2；可独立回退）。
  const freeView = quantizeRect(view, CULL_QUANT);
  // R5 修复（跨文档整层消失）：稳定化必须带**来源换代检查**——`FreeEdge.key` 是位置键
  // （`e${index}`），换文档后「边数相同且非零」时 key 序列逐项相等，stableByKeys 会返回
  // **旧文档的边对象**（sourceId/targetId 已不指向本代次节点 → 端点盒全落空 → 整层不渲染）。
  // 代次标识取 `rootNode` —— 它正是 collectFreeEdges 的输入（见 :634-635 的自由边数据）：
  // 平移/缩放不换 rootNode（G-P1/G-P9 的零重算保证不受影响），打开/切换文档必然换代。
  const freeEdgesStableRef = useRef<{
    source: EditableNode | undefined;
    arr: readonly FreeEdge[];
  } | null>(null);
  const visibleFreeEdges = useMemo(() => {
    if (freeEdges.length === 0) return freeEdges;
    const next = freeEdges.filter((e) => {
      const sb = e.sourceId !== null ? derived.boxes.get(e.sourceId) : undefined;
      const tb = e.targetId !== null ? derived.boxes.get(e.targetId) : undefined;
      if (!sb && !tb) return true; // ghost / 端点未解析：数量少，恒渲染
      const inView = (b: Box): boolean =>
        b.x + b.w >= freeView.x - CULL_MARGIN &&
        b.x <= freeView.x + freeView.w + CULL_MARGIN &&
        b.y + b.h >= freeView.y - CULL_MARGIN &&
        b.y <= freeView.y + freeView.h + CULL_MARGIN;
      if (sb && tb) return inView(spanBoxOf(sb, tb));
      // 仅一端有盒（ghost 靶点）：按该端点判定
      return inView(sb ?? tb!);
    });
    const prev = freeEdgesStableRef.current;
    const sameSource = prev !== null && prev.source === rootNode;
    const arr = sameSource ? stableByKeys(prev.arr, next, (e) => e.key) : next;
    freeEdgesStableRef.current = { source: rootNode, arr };
    return arr;
  }, [freeEdges, rootNode, derived, freeView.x, freeView.y, freeView.w, freeView.h]);

  // C2：Canvas 场景树构建（世界坐标）——`useCanvas` 声明提前到总览判定之前（见上）
  const canvasScene = useCanvas
    ? buildSceneFromLayout({
        nodes: visibleNodes.map((ln) => ({
          id: ln.node.id,
          box: renderBoxOf(ln.node.id, ln.box),
          depth: ln.depth,
          text: ln.node.text ?? null,
          isEntity: ln.node.type === 'entity',
          entityKind: ln.node.type === 'entity' ? (ln.node.ref?.kind ?? null) : null,
          childCount: ln.node.children.length,
          collapsed: collapsedIds?.has(ln.node.id) ?? false,
          selected: selectedId === ln.node.id,
        })),
        links: visibleLinks.flatMap((l) => {
          const from = renderBoxOf(
            l.fromId,
            derived.boxes.get(l.fromId) ?? { x: 0, y: 0, w: 0, h: 0 },
          );
          const to = renderBoxOf(l.toId, derived.boxes.get(l.toId) ?? { x: 0, y: 0, w: 0, h: 0 });
          return [{ fromId: l.fromId, from, to, toId: l.toId, dir: growDirOf.get(l.toId) }];
        }),
        branchColorOf: (id: string) => token.color.branches[derived.branchIndex.get(id) ?? 0],
        // v1.11.0：Canvas 后端梁位与 SVG 同源（up/down 共享梁吃 beamAt；hub 竖梁同缺省）
        beamAtOf,
        token,
      })
    : null;
  const viewMs = performance.now() - start;

  const root = useMemo(() => layout.nodes.find((n) => n.depth === 0), [layout]);
  const draggedLn = nodeDrag ? layout.nodes.find((n) => n.node.id === nodeDrag.nodeId) : undefined;

  // 首次尺寸就绪后自动适配。
  // 依赖 epoch（尺寸就绪经 setSize→notify→epoch+1）：初始挂载时 viewW 尚为 1，
  // 若不监听 epoch，RO 到达后该 effect 不会重跑，fit 将被永久跳过。
  useEffect(() => {
    if (viewport.viewW > 10 && !didInitialFit.current) {
      didInitialFit.current = true;
      viewport.fitBounds(layout.bounds);
    }
  }, [viewport, layout, epoch]);

  // 布局变化 → 节点位置过渡（M5-T2）：旧坐标 → 新坐标插值 + 新增淡入/删除淡出。
  // useLayoutEffect 保证无「跳变首帧」；动画由 FrameScheduler 链式 rAF 驱动，结束后立即休眠。
  // 大图保护（> NODE_ANIM_MAX_NODES）或系统「减少动态」→ 跳过动画直接落位（prev 快照仍更新）。
  useLayoutEffect(() => {
    const prev = prevLayoutRef.current;
    prevLayoutRef.current = layout;
    if (!prev || prev === layout) return;
    if (
      prev.nodes.length > NODE_ANIM_MAX_NODES ||
      layout.nodes.length > NODE_ANIM_MAX_NODES ||
      prefersReducedMotion()
    ) {
      return;
    }
    frame.animate({
      from: toNodeFrame(prev.nodes),
      to: toNodeFrame(layout.nodes),
      duration: NODE_ANIM_MS,
      interpolate: lerpNodeFrame,
      onFrame: (nf) => setAnim(nf),
      onDone: () => setAnim(null),
    });
  }, [layout, frame]);

  // 拖拽期间：Esc 取消拖拽 + 全局禁用文本选择（M5-T5）；结束后恢复
  useEffect(() => {
    if (!nodeDrag) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setNodeDrag(null);
    };
    window.addEventListener('keydown', onKey);
    const prevSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.userSelect = prevSelect;
    };
  }, [nodeDrag]);

  // E6：连接拖拽全局跟踪（move 更新引导线；up 命中目标 → onEdgeConnect；Esc 取消）
  useEffect(() => {
    if (!connectDrag) return;
    const toWorld = (cx: number, cy: number): { x: number; y: number } => {
      const rect = containerRef.current?.getBoundingClientRect();
      return rect ? viewport.toWorld(cx - rect.left, cy - rect.top) : { x: 0, y: 0 };
    };
    const onMove = (e: PointerEvent): void => {
      const w = toWorld(e.clientX, e.clientY);
      let hoverId: string | null = null;
      for (let i = layout.nodes.length - 1; i >= 0; i--) {
        const ln = layout.nodes[i]!;
        if (ln.node.id === connectDrag.sourceId) continue;
        if (nodeHitTest(ln.box, w.x, w.y, 6)) {
          hoverId = ln.node.id;
          break;
        }
      }
      setConnectDrag((c) => (c ? { ...c, x: w.x, y: w.y, hoverId } : c));
    };
    const onUp = (e: PointerEvent): void => {
      const w = toWorld(e.clientX, e.clientY);
      let target: string | null = null;
      for (let i = layout.nodes.length - 1; i >= 0; i--) {
        const ln = layout.nodes[i]!;
        if (ln.node.id === connectDrag.sourceId) continue;
        if (nodeHitTest(ln.box, w.x, w.y, 6)) {
          target = ln.node.id;
          break;
        }
      }
      setConnectDrag(null);
      onEdgeConnectRef.current?.(connectDrag.sourceId, target, e.clientX, e.clientY);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setConnectDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectDrag, viewport, layout]);

  // 拖拽排除集：拖拽节点自身 + 其子树（不可作为落点目标）——子树悬停需可见反馈（warn），
  // 因此仅排除自身（子树目标仍可命中，由 planDrop 判非法 → 拒绝反馈）
  const dragExcluded = useMemo(() => (nodeDrag ? new Set([nodeDrag.nodeId]) : null), [nodeDrag]);

  // 视图变化 → 对外上报统计（T5 性能面板）。
  // 触发只绑定 epoch/layout（稳定值）；渲染体实时值经 ref 快照读取——
  // 避免把每帧变化的 viewMs/数组 identity 放入 deps 造成无限 setState 循环。
  const statsRef = useRef<MapStats>({
    epoch: 0,
    totalNodes: 0,
    visibleNodes: 0,
    visibleLinks: 0,
    lod: 'full',
    backend: 'svg',
    viewMs: 0,
  });
  statsRef.current = {
    epoch,
    totalNodes: layout.nodes.length,
    visibleNodes: visibleNodes.length,
    visibleLinks: visibleLinks.length,
    lod,
    backend: useCanvas ? 'canvas' : 'svg',
    viewMs,
  };
  /**
   * B-P3：对外上报**节流**（≥200ms 且材料字段变化才回调）——
   * 原先每 epoch（每帧）回调新对象 → 父壳（PerfPanel 常显，2000+ 行）每帧重渲。
   * 材料字段 = totalNodes / visibleNodes / visibleLinks / lod / **backend（R5-3）**；
   * `viewMs` 每帧都变（渲染计时噪声）故**不**作触发条件，仅作 payload 携带（面板诊断用）。
   */
  const lastStatsAtRef = useRef(0);
  const lastStatsRef = useRef<MapStats | null>(null);
  const statsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    /** 材料字段是否实质变化（viewMs 每帧噪声，不计入触发条件） */
    const differs = (a: MapStats | null, b: MapStats): boolean =>
      a === null ||
      a.totalNodes !== b.totalNodes ||
      a.visibleNodes !== b.visibleNodes ||
      a.visibleLinks !== b.visibleLinks ||
      a.lod !== b.lod ||
      a.backend !== b.backend;
    const emit = (payload: MapStats): void => {
      lastStatsAtRef.current = performance.now();
      lastStatsRef.current = payload;
      onStatsRef.current?.(payload);
    };
    if (!differs(lastStatsRef.current, statsRef.current)) return;
    const elapsed = performance.now() - lastStatsAtRef.current;
    if (elapsed >= STATS_THROTTLE_MS) {
      emit(statsRef.current);
      return;
    }
    // 窗口内：合并到窗口末尾补报一次（否则「最后一次手势」的统计会永远不上报）；
    // 补报前**重新比对当前值** —— 瞬态差异（首帧噪声）收敛回原值时不补报。
    if (statsTimerRef.current) return;
    statsTimerRef.current = setTimeout(() => {
      statsTimerRef.current = null;
      if (differs(lastStatsRef.current, statsRef.current)) emit(statsRef.current);
    }, STATS_THROTTLE_MS - elapsed);
    return () => {
      if (statsTimerRef.current) {
        clearTimeout(statsTimerRef.current);
        statsTimerRef.current = null;
      }
    };
    // R5-3：useCanvas 是显式触发 dep——后端切换（svg↔canvas）不在 epoch/layout/lod 之中，
    // 加它让「后端变化必然补报一次」（材料字段语义，见 differs 的 backend 项）。
  }, [epoch, layout, lod, useCanvas]);

  // 外部 API（fit / zoomBy / resetZoom / focusNode——M5-T3 全部平滑动画）
  useEffect(() => {
    const api: MapViewApi = {
      fit: () => viewport.fitBoundsAnimated(layout.bounds),
      zoomBy: (f) => viewport.zoomAt(viewport.viewW / 2, viewport.viewH / 2, f),
      resetZoom: () =>
        viewport.animateTo(
          { k: 1, x: viewport.viewW / 2, y: viewport.viewH / 2 },
          VIEWPORT_ANIM_MS,
        ),
      focusNode: (id) => {
        const ln = layout.nodes.find((n) => n.node.id === id);
        if (!ln) return;
        const { k } = viewport.transform;
        const cx = ln.box.x + ln.box.w / 2;
        const cy = ln.box.y + ln.box.h / 2;
        // 保持当前 k，将节点中心平移到视口中心（平移 + 缩放同时插值）
        viewport.animateTo(
          { k, x: viewport.viewW / 2 - cx * k, y: viewport.viewH / 2 - cy * k },
          VIEWPORT_ANIM_MS,
        );
      },
      // 几何导航（A 档）：目标由纯函数算出（navigateDirection，独立单测），
      // 这里只做「算目标 + 必要时最小推入视口」；选中态由宿主写入（本层不碰 controller）。
      navigateFrom: (id, dir) => {
        const target = nextNodeInDirection(layout.nodes, id, dir);
        if (target === null) return null;
        const ln = layout.nodes.find((n) => n.node.id === target);
        if (ln) {
          const reveal = revealTargetInViewport(viewport, ln.box);
          if (reveal !== null) viewport.animateTo(reveal, VIEWPORT_ANIM_MS);
        }
        return target;
      },
      nodeCorner: (id) => {
        const ln = layout.nodes.find((n) => n.node.id === id);
        const rect = containerRef.current?.getBoundingClientRect();
        if (!ln || !rect) return null;
        const { k, x, y } = viewport.transform;
        // 世界（盒右上角）→ 容器屏幕：screen = world * k + t（toWorld 的逆）
        return { x: rect.left + (ln.box.x + ln.box.w) * k + x, y: rect.top + ln.box.y * k + y };
      },
      nodeBox: (id) => {
        const ln = layout.nodes.find((n) => n.node.id === id);
        const rect = containerRef.current?.getBoundingClientRect();
        if (!ln || !rect) return null;
        const { k, x, y } = viewport.transform;
        return {
          x: rect.left + ln.box.x * k + x,
          y: rect.top + ln.box.y * k + y,
          w: ln.box.w * k,
          h: ln.box.h * k,
          k,
        };
      },
      subtreeBoxes: (id) => {
        const rootLn = layout.nodes.find((n) => n.node.id === id);
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rootLn || !rect) return [];
        const { k, x, y } = viewport.transform;
        const left = rect.left;
        const top = rect.top;
        const out: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
        const walk = (ln: LayoutNode): void => {
          out.push({
            id: ln.node.id,
            x: left + ln.box.x * k + x,
            y: top + ln.box.y * k + y,
            w: ln.box.w * k,
            h: ln.box.h * k,
          });
          for (const c of ln.children) walk(c);
        };
        walk(rootLn);
        return out;
      },
    };
    if (apiRef) apiRef.current = api;
    return () => {
      if (apiRef) apiRef.current = null;
    };
  }, [viewport, layout, apiRef]);

  // 卸载清理：取消挂起帧（空闲零活动的收尾）
  useEffect(() => () => frame.dispose(), [frame]);

  // ---------- 交互：pan（拖拽 + 惯性阻尼）/ zoom（滚轮 + 越界回弹）/ fit（双击）/ 点选 ----------
  // 画布手势：四个处理器（Down / Move / Up / Cancel）与 pinch / dragRef 状态
  // 全部由 useMapGestures 承载（T2 第 3 小步，渐进迁移完成）。
  const { pinch, dragRef, onPointerDown, onPointerMove, onPointerUp, onPointerCancel } =
    useMapGestures({
      viewport,
      layout,
      visibleNodes,
      hitIndex,
      nodeDrag,
      setNodeDrag,
      dragExcluded,
      onNodeMove: (op) => onNodeMoveRef.current?.(op),
      // G6′：中心拖拽 = 移动坐标（带动子树），而非改树结构
      // ROOT-DRAG-1：判据用 dragCenters —— 虚拟根岛（布局岛根但无 center 条目）不得进入
      // 中心拖拽管线（否则命中排除谓词会把它当中心放行，拖放即写根 center 条目）。
      isCenter: dragCenters ? (id) => dragCenters.has(id) : undefined,
      onCenterMove: (id, wdx, wdy) => onCenterMoveRef.current?.(id, wdx, wdy),
      // v1.7.0：共享梁拖拽（把手/状态/提交）；v1.11.0：命中分裂 + 单字段提交
      beamHandles,
      beamDrag,
      setBeamDrag,
      onBeamChange: onBeamChangeRef.current,
      onBeamHover: setBeamHoverDir,
      onGestureActive: markZoomGesture, // B-P3：pinch 起止 → 冻结/解冻 LOD
      onNodeClick: (ln, info) => onNodeClickRef.current?.(ln, info),
      onBlankClick: () => onBlankClickRef.current?.(),
      onNodeHover: (id, at) => {
        setHover((prev) =>
          prev?.id === id ? prev : id === null ? null : { id, x: at.x, y: at.y });
        onNoteHoverRef.current?.(id);
      },
    });
  const wheelRef = useRef<HTMLDivElement | null>(null);
  // A4：拖岛期冻结滚轮缩放（design §7 首版策略：k 恒定 → 预览位移与提交位移口径一致）
  const nodeDragRef = useRef(nodeDrag);
  nodeDragRef.current = nodeDrag;
  useEffect(() => {
    const el = wheelRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (nodeDragRef.current) return; // 拖岛中：忽略缩放，避免预览/提交位移换算歧义
      markWheelZoom(); // B-P3：滚轮缩放手势开始并续期（空闲 120ms 自动释放）
      const rect = el.getBoundingClientRect();
      // M5-T4：滚轮以光标为锚（zoomAt 锚点保持世界坐标不动）+ 越界软回弹
      viewport.zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0016));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [viewport, markWheelZoom]);

  // A4：拖岛取消路径（design §7 / T11）——Esc / window blur 时恢复原图：
  // 仅清预览状态（nodeDrag），不回调 onCenterMove → 不写 note、不进 history、不置 dirty。
  // pointercancel / 第二指 pinch 已由 useMapGestures 的 onPointerDown/Cancel 覆盖。
  useEffect(() => {
    if (!nodeDrag) return;
    const cancel = (): void => setNodeDrag(null);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        cancel();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', cancel);
    };
  }, [nodeDrag, setNodeDrag]);

  // v1.5.0 T5：Section 选中态退出三件套（Esc / 画布空白点击 / 再次点击同框）。
  // 选中是纯会话态（不落盘、不进 history）——退出同样零副作用。
  // 「再次点击」由 onSelect 收到同 id 时 toggle 实现（见 SectionLayer 的 onSelect 接线）。
  useEffect(() => {
    if (selectedSectionId === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setSelectedSectionId(null);
      }
    };
    const onDown = (e: PointerEvent): void => {
      // 点击落在 Section 本体（frame/titlebar/折叠钮）由该元素自行处置，不在此清除
      const t = e.target;
      if (t instanceof Element && t.closest('[data-section-id]')) return;
      setSelectedSectionId(null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [selectedSectionId]);

  // IO-1：总览卡选中态退出三件套（Esc / 点击卡外 / 再次点击同卡 toggle）——与 Section 选中同款，
  // 纯会话态（不落盘、不进 history）；放大回 k≥0.35 总览退出时一并清空（层已不在，不留悬挂态）。
  useEffect(() => {
    if (!overview) setSelectedIslandRootId(null);
  }, [overview]);
  useEffect(() => {
    if (selectedIslandRootId === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setSelectedIslandRootId(null);
      }
    };
    const onDown = (e: PointerEvent): void => {
      const t = e.target;
      if (t instanceof Element && t.closest('[data-island-overview]')) return;
      setSelectedIslandRootId(null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [selectedIslandRootId]);

  /**
   * IO-1：双击总览卡 → 聚焦进岛（D8 的「至少一种聚焦」入口）。
   * 目标变换 = fitTransform(卡 bounds, ISLAND_FOCUS_PAD)，但 **k 封顶 1**：
   * 小岛 fit 会算出很大的 k（聚焦不是怼脸）；成功后 k 越过 K_OVERVIEW → 总览自动退出、
   * 既有节点/Section 渲染恢复（成功标准 §8-5）。
   */
  const handleIslandFocus = (rootId: string): void => {
    // IO-2：迷你子卡不是顶层卡表的元素（N2 仍不出顶层卡）——查找需含一级 nestedCards。
    const card =
      islandCards.find((c) => c.rootId === rootId) ??
      islandCards.flatMap((c) => c.nestedCards ?? []).find((m) => m.rootId === rootId);
    if (card === undefined) return;
    const b = card.bounds;
    const target = viewport.fitTransform(
      { minX: b.x, minY: b.y, maxX: b.x + b.w, maxY: b.y + b.h },
      ISLAND_FOCUS_PAD,
    );
    if (target === null) return;
    const kk = Math.min(target.k, 1);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    viewport.animateTo(
      { k: kk, x: viewport.viewW / 2 - cx * kk, y: viewport.viewH / 2 - cy * kk },
      VIEWPORT_ANIM_MS,
    );
  };

  if (root === undefined) return null;

  // 渲染出口自愈（v1.7.1）：非有限变换回原点——任何入口漏进 viewport 的 NaN
  // 都不会把 `<g transform>` 渲染成 translate(NaN NaN)（整幅图飞出画布的实测症状）。
  // 注意：HMR 无法热替换类实例方法，viewport 的入口护栏需整页刷新后生效。
  const kRaw = viewport.transform.k;
  const xRaw = viewport.transform.x;
  const yRaw = viewport.transform.y;
  const k = Number.isFinite(kRaw) && kRaw > 0 ? kRaw : 1;
  const x = Number.isFinite(xRaw) ? xRaw : 0;
  const y = Number.isFinite(yRaw) ? yRaw : 0;
  // R5-2：树线标注（chip）渲染收集——统一进节点层之上的「edge-labels」层
  // （渲染循环里 push；层序契约与理由见渲染块开头注释）
  const treeEdgeLabels: Array<{
    key: string;
    ax: number;
    ay: number;
    nx: number;
    ny: number;
    text: string;
    stroke: string;
  }> = [];
  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: token.color.canvas,
      }}
    >
      <div
        ref={wheelRef}
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: token.color.canvasGlow,
          // 光标三态：画布平移 grabbing ＞ 梁拖拽 ns/ew ＞ 梁悬停 ns/ew ＞ grab。
          // 梁悬停期间拖拽中不触发 hover 回调，由 beamDrag 状态接棒保持 resize 光标
          cursor:
            dragRef.current
              ? 'grabbing'
              : beamDrag !== null
                ? beamDrag.handle.dir === 'up' || beamDrag.handle.dir === 'down'
                  ? 'ns-resize'
                  : 'ew-resize'
                : beamHoverDir !== null
                  ? beamHoverDir === 'up' || beamHoverDir === 'down'
                    ? 'ns-resize'
                    : 'ew-resize'
                  : 'grab',
          touchAction: 'none',
          // 拖拽文件进画布时的高亮提示（P1 上传管线）
          outline: fileDragActive ? `2px dashed ${token.color.selection}` : undefined,
          outlineOffset: -6,
        }}
        // 文件拖入 → 上传图库（P1）：dragover 阻止默认以允许 drop；drop 透传文件列表
        onDragOver={(e) => {
          if (e.dataTransfer?.types.includes('Files')) {
            e.preventDefault();
            if (!fileDragActive) setFileDragActive(true);
            // FA2-T3：拖动过程中实时判定落点（松手前就能看到会被插成什么）
            const target = senseAt(e, e.currentTarget);
            setDropPreview(target ? { target, sx: e.clientX, sy: e.clientY } : null);
          }
        }}
        onDragLeave={() => {
          setFileDragActive(false);
          setDropPreview(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setFileDragActive(false);
          const files = Array.from(e.dataTransfer?.files ?? []);
          if (files.length === 0) {
            setDropPreview(null);
            return;
          }
          // 落点感知：优先带坐标的语义投放；上层没接就退回原「只上传图库」行为
          const sensed = senseAt(e, e.currentTarget);
          setDropPreview(null);
          if (onAssetDropRef.current) onAssetDropRef.current(files, sensed ?? { action: 'free', nodeId: null });
          else onAssetFilesRef.current?.(files);
        }}
        // 粘贴图片/文件 → 上传图库
        onPaste={(e) => {
          const files = Array.from(e.clipboardData?.files ?? []);
          if (files.length > 0) {
            e.preventDefault();
            onAssetFilesRef.current?.(files);
          }
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        // v1.7.1：指针离画布 → 清梁悬停（否则 resize 光标残留到下次进入）
        onPointerLeave={() => setBeamHoverDir(null)}
        onContextMenu={(e) => {
          e.preventDefault();
          const w = worldPointOf(e, e.currentTarget, viewport);
          // 命中节点 → 传该节点；空白 → 传 null（两条分支合并为一）
          const ln = hitNodeAt(visibleNodes, w, undefined, hitIndex);
          onNodeContextRef.current?.(ln, e.clientX, e.clientY);
        }}
        onDoubleClick={(e) => {
          // 双击：**只**处理「命中 text 节点 → 进入编辑」；空白 / 非 text 节点 → 无操作。
          //
          // v1.8.10 用户裁决 B：空白分支此前会 fitBoundsAnimated（跳回全图）——「随手在空白
          // 双击就把视图重置」是编辑流里的干扰源。适配视图的显式入口仍在：工具栏「适配视图」/ Ctrl+0。
          const w = worldPointOf(e, e.currentTarget, viewport);
          const ln = hitNodeAt(visibleNodes, w, undefined, hitIndex);
          if (ln && ln.node.type === 'text') onEditStartRef.current?.(ln.node.id);
        }}
      >
        {/* C2：Canvas 模式（forceBackend 或 >CANVAS_AUTO_NODES）——场景树 → 2D 画布；SVG 层让位。
            交互不依赖 DOM 元素：pointer 命中走坐标（nodeHitTest），编辑浮层为容器层 div */}
        {useCanvas ? (
          canvasScene !== null && (
            <CanvasSurface
              scene={canvasScene}
              width={viewport.viewW}
              height={viewport.viewH}
              transform={{ x, y, k }}
            />
          )
        ) : (
          <svg
            width={viewport.viewW}
            height={viewport.viewH}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              userSelect: 'none',
              WebkitUserSelect: 'none',
            }}
          >
            <g transform={`translate(${x} ${y}) scale(${k})`}>
              {/* R5-2 层序契约（绘制序 = 文档序 = 自下而上）：
                    sections → tree-links → free-edges → nodes → edge-labels → ghosts → drag。
                  为什么：① 标签是**信息层**——落在节点盒范围内被盖住即失效（本批修复：
                  树线标注与自由边标签统一上提到 edge-labels 层）；② 命中区（自由边宽透明
                  描边 / 树边命中区）是**交互层**——必须在节点之下，上提会抢节点点击。
                  每层带 data-layer 标记，顺序由 mapview-layer-order.test.tsx 契约测试钉死。 */}
              {/* v1.5.0 Section 背景层：永在连线/节点之下（T3）。逐框 isBoxInView 自裁剪
                  （view 已含 CULL_MARGIN）；Canvas 模式不经 SVG 分支 → 自动降级不渲染。 */}
              {sectionViews.length > 0 && (
                <SectionLayer
                  views={sectionViews.filter((v) =>
                    v.kind === 'ghost'
                      ? true
                      : // IO-1 D10：有总览卡的 root 不再画 Section chrome（避免双标题；
                        // 标题/色/计数已由总览卡承接）
                        isBoxInView(v.bounds, view, 0) && !islandCardRoots.has(v.rootId),
                  )}
                  view={view}
                  k={k}
                  selectedId={selectedSectionId}
                  // T5 退出三件套之一：再次点击同框 → 取消选中（toggle）
                  onSelect={(id) =>
                    setSelectedSectionId((prev) => (prev === id ? null : id))
                  }
                  onToggleCollapse={
                    onToggleCollapseRef.current
                      ? (id) => onToggleCollapseRef.current?.(id)
                      : undefined
                  }
                  onRemoveGhost={onRemoveSection}
                  onTitlePointerDown={handleSectionTitlePointerDown}
                />
              )}
              {/* IO-1 岛级远观总览（k < K_OVERVIEW 且有中心岛）：一岛一卡承接 Section chrome。
                  成员 NodeG / 岛内树边已在上游按 islandHiddenIds 跳过；岛间梁（tree-links 层）
                  与自由边仍画在卡之上（成功标准 §8-2）。交互：标题带拖 = 中心拖，双击 = 聚焦。 */}
              {overview && islandCards.length > 0 && (
                <IslandOverviewLayer
                  cards={islandCards}
                  k={k}
                  selectedRootId={selectedIslandRootId}
                  onSelect={(rootId) =>
                    setSelectedIslandRootId((prev) => (prev === rootId ? null : rootId))
                  }
                  onTitlePointerDown={handleSectionTitlePointerDown}
                  onFocus={handleIslandFocus}
                />
              )}
              {/* S4 摘要括线层：层序 = sections 之后、tree-links 之前。
                  括线是「树线的延伸」，必须在节点卡之下（盖上节点卡即回归）；
                  括线自身 pointer-events:none → 命中/选择逻辑零改动。
                  Canvas 模式不经本 SVG 分支 → 与 SectionLayer 同边界自动降级。 */}
              {summaryViews.length > 0 && (
                <SummaryLayer views={summaryViews} token={token} selectedId={selectedId} />
              )}
              <g data-layer="tree-links">
                {visibleLinkGeoms.map((g) => {
                  const { ln, from, to, dir } = g;
                  const palette = token.color.branches[derived.branchIndex.get(ln.toId) ?? 0];
                  // 连线随节点同步插值：端点取动画帧盒（防「节点动、线不动」脱节）；
                  // 垂直连线取方向组共享梁高（up/down 组内同一条水平梁）；
                  // hub 的左右组取共享竖梁 x（horizontalBeamMap，与内核 beamXVariants 同形）
                  const hub = hubOf.get(ln.fromId) === true;
                  const p = buildLinkPath(token, from, to, palette, {
                    beamY: linkBeamYs.get(g),
                    beamX: linkBeamXs.get(g),
                    hub,
                    dir,
                  });
                  // hub 出线箭头（左入右出、上入下出）：实心三角 path——两种 backend 通吃
                  const tip = hubArrowTip(from, to, dir, {
                    hub,
                    beamX: linkBeamXs.get(g),
                    beamY: linkBeamYs.get(g),
                  });
                  // E7 审查修复：关系属性可见——chip 显示 label ?? rel ?? via（只填 rel 也可见）；
                  // note/完整属性走 hover <title>
                  const childNode = nodeByIdx.get(ln.toId);
                  const ann = childNode?.note?.edge as
                    | { rel?: string; label?: string; note?: string; style?: { color?: string } }
                    | undefined;
                  const annObj = typeof ann === 'object' && ann !== null ? ann : undefined;
                  const via =
                    typeof childNode?.note?.via === 'string' ? (childNode.note.via as string) : '';
                  const labelText = annObj?.label ?? annObj?.rel ?? via;
                  const chipStroke = annObj?.style?.color ?? p.stroke;
                  // 性能：cubicMidNormal 含正则解析——仅标注树边计算（无标注 = 无标签，跳过热路径）
                  const mid = labelText !== '' ? cubicMidNormal(p.d) : null;
                  // R5-2：标注（chip）收集到 edge-labels 层（节点层之上）——本层不再渲染，
                  // 修「标签落在节点盒范围时被节点遮挡」。key 与树边渲染 key 同源。
                  if (labelText !== '' && mid !== null) {
                    treeEdgeLabels.push({
                      key: `${ln.fromId}->${ln.toId}`,
                      ax: mid.x,
                      ay: mid.y,
                      nx: mid.nx,
                      ny: mid.ny,
                      text: labelText,
                      stroke: chipStroke,
                    });
                  }
                  return (
                    // A6 冒烟修复：path 是 SVG d 字符串——两条几何形状相同的边会产出
                    // 相同 d → React 重复 key 警告。改用端点 id（一对节点间至多一条树边）。
                    <g key={`${ln.fromId}->${ln.toId}`}>
                      {backend.render(
                        backend.link({
                          d: p.d,
                          stroke: p.stroke,
                          strokeWidth: p.width,
                          tipD: tip ?? undefined,
                        }),
                      ) as ReactElement}
                      {/* 仅右键触发编辑（左键保持画布平移，蒋指导反馈①）；hover <title> 呈现全部属性。
                        性能：低 LOD（缩小时）跳过命中区/chip——10px 透明命中区在缩小视图无交互价值且翻倍 DOM
                        E8：且仅在关系模式下挂载——浏览态树边不可编辑 */}
                      {onTreeEdgeEditRef.current && lod === 'full' && relationModeRef.current && (
                        <path
                          data-tree-edge-hit
                          data-tree-edge-child={ln.toId}
                          d={p.d}
                          fill="none"
                          stroke="transparent"
                          strokeWidth={10}
                          style={{ pointerEvents: 'stroke' }}
                          onContextMenu={(e) => {
                            // 阻断冒泡：防止容器 onContextMenu 同时弹节点菜单（双浮窗冲突）
                            e.preventDefault();
                            e.stopPropagation();
                            onTreeEdgeEditRef.current?.(ln.toId, e.clientX, e.clientY);
                          }}
                        >
                          <title>
                            {[annObj?.rel ?? '（树形关系）', annObj?.note ?? '']
                              .filter(Boolean)
                              .join('\n')}
                          </title>
                        </path>
                      )}
                      {/* R5-2：标注 chip 已收集至 edge-labels 层（渲染循环上方 push）——
                          本层保留命中区（悬停/右键编辑），层级不得上提。 */}
                    </g>
                  );
                })}
                {/* v1.7.0：梁拖拽预览叠层——梁线随指针移动 + 像素徽标；节点在松手提交后由布局权威重排
                    v1.11.0：lens = 梁跟手（徽标「层距 Npx」）/ bias = 比例位映射（徽标「主干 Npx」） */}
                {beamDrag !== null &&
                  (() => {
                    const h = beamDrag.handle;
                    const rail = beamDragRail(beamDrag);
                    const vertical = h.dir === 'up' || h.dir === 'down';
                    return (
                      <g style={{ pointerEvents: 'none' }}>
                        <line
                          x1={vertical ? h.lo - 8 : rail}
                          y1={vertical ? rail : h.lo - 8}
                          x2={vertical ? h.hi + 8 : rail}
                          y2={vertical ? rail : h.hi + 8}
                          stroke={token.color.selection}
                          strokeWidth={2}
                          strokeDasharray="4 3"
                        />
                        <text
                          x={beamDrag.curW.x + 12}
                          y={beamDrag.curW.y - 10}
                          fontSize={12}
                          fill={token.color.selection}
                        >
                          {beamDragBadge(beamDrag)}
                        </text>
                      </g>
                    );
                  })()}
                {/* G6″（A3-2/G3）：跨岛父子连接（虚线，与树线/自由边视觉区分；不参与布局、不可交互）。
                    仅 SVG 后端——Canvas 模式不渲染（与自由边同类已知边界），含本功能文档的门禁归 A6。 */}
                {!useCanvas &&
                  visibleBoundaryLinks.map((l) => {
                    const fb = derived.boxes.get(l.fromId);
                    const tb = derived.boxes.get(l.toId);
                    if (!fb || !tb) return null;
                    const p = buildLinkPath(
                      token,
                      renderBoxOf(l.fromId, fb),
                      renderBoxOf(l.toId, tb),
                    );
                    return (
                      <path
                        key={`boundary-${l.fromId}-${l.toId}`}
                        data-boundary-link
                        d={p.d}
                        fill="none"
                        stroke={p.stroke}
                        strokeWidth={p.width}
                        strokeDasharray="6 4"
                        opacity={0.55}
                        style={{ pointerEvents: 'none' }}
                      >
                        <title>跨岛父子连接（升格中心 · parent_link: show）</title>
                      </path>
                    );
                  })}
              </g>
              {/* E5：自由边叠加层（树形之上的文档级标注边；仅 SVG 后端） */}
              {!useCanvas && visibleFreeEdges.length > 0 && rootNode && (
                <FreeEdgeLayer
                  edges={visibleFreeEdges}
                  // E8 P0：端点无盒必须返回 undefined（原退化成零盒 → 边被拉向世界原点，视觉「位置不对」）
                  boxOf={edgeBoxOf}
                  // FE-FRAME-1：解析后提升 —— 跨 Section 贴框 / 总览贴卡（只改端点盒，边身份不变）
                  refineEndpoints={refineEndpoints}
                  root={rootNode}
                  collapsed={collapsedIds ?? EMPTY_COLLAPSED}
                  token={token}
                  selectedKey={selectedEdgeKey}
                  selectedKeys={selectedEdgeKeys}
                  onSelect={(edge, sx, sy, withShift) =>
                    onEdgeClickRef.current?.(edge, sx, sy, withShift)
                  }
                  onEdgeContext={onEdgeContext}
                  interactive={relationMode}
                  // E8：避障路由（低 LOD 时为空数组 → 自动退化为原贝塞尔）
                  obstacles={edgeObstacles}
                  // Issue #3：手动覆盖（拖端点 / bend；双击 bend 恢复自动优化）
                  toWorld={toWorld}
                  onManualChange={(edge, manual) => onEdgeManualChangeRef.current?.(edge, manual)}
                  onRoutesChange={handleRoutesChange}
                  // P2-1：动画期跳过交叉检测/跳线（配合 obstacles 置空，降载至 O(E)）
                  fastRouting={animating}
                  // R5-2：标签描述符收集 → edge-labels 层（节点之上；本层不渲染标签）
                  onLabelsChange={handleEdgeLabels}
                />
              )}
              <g data-layer="nodes">
                {visibleNodes.map((ln) => {
                  // FO-B2：框内大纲行（含框头）让位给 FrameOutline 浮层——两者同盒，
                  // 同时画会出现「节点卡 + 行文本」双层。
                  if (frameRowIds.has(ln.node.id)) return null;
                  const m = derived.metrics.get(ln.node.id);
                  if (!m) return null;
                  // 附属区（快速注释 / 固定 note 笔记）从节点盒底部生长，正文只画剩余高度。
                  const branchIdx = derived.branchIndex.get(ln.node.id) ?? 0;
                  const palette = token.color.branches[branchIdx] ?? token.color.branches[0]!;
                  const entityKind = ln.node.type === 'entity' ? (ln.node.ref?.kind ?? null) : null;
                  // DEPTH-VIS-1：三档视觉 rank（root / branch / leaf）—— depth 0 独立成档
                  const rank = visualRankOf(ln.depth);
                  // B-P2：样式按缓存键取稳定引用（同键 ⇒ 同值；引用稳定是 memo 命中的前提）
                  const styleKey = `${branchIdx}|${rank}|${entityKind ?? ''}`;
                  let style = cardStyleCache.get(styleKey);
                  if (!style) {
                    style = nodeCardStyle(token, palette, rank, entityKind);
                    cardStyleCache.set(styleKey, style);
                  }
                  // A4：中心岛拖动 = 整岛偏移预览（成员已在原位平移渲染）——
                  // 不走「单节点置灰 + 浮空克隆」的改结构拖拽表现
                  const isDragged = nodeDrag?.nodeId === ln.node.id && !centerPreview;
                  return (
                    // A6 冒烟修复：列表项是无 key 的 <> Fragment → React missing-key 警告。
                    // key 必须挂在 Fragment上（NodeG 内层 key 不替代列表项 key）。
                    <Fragment key={ln.node.id}>
                    <NodeG
                      node={ln}
                      style={style}
                      metrics={m}
                      token={token}
                      depth={ln.depth}
                      root={ln.depth === 0}
                      chipX={entityKind !== null ? chipXOf(m, charFor(ln.depth)) : null}
                      // 编辑态不画 SVG 文字：内联编辑器（NodeTextOverlay）是浮在节点盒上的
                      // <input>，两层文字会同时可见并互相穿插——
                      // 暗色主题下编辑器底色只有 7% 不透明度（entityFill:
                      // rgba(255,255,255,.07)），底下的 SVG 文字会直接透出来。
                      // 编辑时让 <input> 独占文字层，节点盒本体仍照常绘制（提供底色）。
                      noText={lodSkipText(lod, ln.depth) || ln.node.id === editingId}
                      selected={selectedId === ln.node.id}
                      hasChildren={ln.node.children.length > 0}
                      collapsed={collapsedIds?.has(ln.node.id) ?? false}
                      onToggleCollapse={
                        ln.node.children.length > 0 && ln.depth > 0 ? handleToggleCollapse : undefined
                      }
                      // expanded 仅代表快速注释展开；固定 note 笔记由独立 HTML 卡片绘制，
                      // 仍通过 bodyHeight 让出布局空间，但不能触发节点内的整块附属背景。
                      expanded={expandedId === ln.node.id}
                      bodyHeight={nodeAuxiliaryRegions(ln.box.h, {
                        qaHeight: expandedId === ln.node.id ? commentAreaH : 0,
                        fixedNoteHeight: fixedNoteIds.has(ln.node.id) ? estimateNoteAreaHeight() : 0,
                      }).body.h}
                      assetBaseUrl={assetBaseUrl}
                      resolveAssetUrl={resolveAssetUrlStable}
                      // 拖拽中：原节点置灰（透明度降），浮空克隆跟随光标；落点目标高亮（合法/拒绝）
                      anim={
                        isDragged
                          ? {
                              x: ln.box.x,
                              y: ln.box.y,
                              w: ln.box.w,
                              h: ln.box.h,
                              opacity: 0.45,
                              scale: 1,
                            }
                          : animBoxes?.get(ln.node.id)
                      }
                      dragTarget={
                        nodeDrag?.moved && nodeDrag.targetId === ln.node.id
                          ? nodeDrag.valid
                            ? 'valid'
                            : 'invalid'
                          : undefined
                      }
                    />
                    {/* v1.4.0：有节点注释的标记（右上角小圆点）—— 没有它用户无从发现
                        哪些节点挂着注释（注释本身不占节点空间、不显示在节点盒里）。 */}
                    {hasNote(ln.node) &&
                      noteLod !== 'none' &&
                      (noteLod === 'badge' || !lodSkipText(lod, ln.depth)) && (
                      <circle
                        data-note-badge={ln.node.id}
                        cx={ln.box.x + ln.box.w - 5}
                        cy={ln.box.y + 5}
                        r={3}
                        fill={token.color.annotationAccent ?? '#BA7517'}
                      />
                    )}
                    {/* C4：中心角标（左上角小圆点）——升格后「看得见」（此前除菜单/拖拽行为外
                        无任何指示）。落点分侧：右上=note 角标、右中=折叠钮，本件占左上。
                        渲染条件吃 centerTitles（= collectCenters 的真实中心事实）——**不能用
                        centerIds**：它含布局输出所需的「根岛根」，会把文档根误标为中心。
                        pointerEvents: 'none' 不参与命中（不抢节点点击/拖拽）；
                        title 携带 doc#cid（跨文件引用寻址的同一身份）。
                        画在 SVG 节点层 → Canvas 大图模式不渲染（损失清单见 canvas-degrade.test.tsx）。 */}
                    {centerTitles?.has(ln.node.id) && (
                      <g data-center={ln.node.id} pointerEvents="none">
                        <circle
                          cx={ln.box.x + 5}
                          cy={ln.box.y + 5}
                          r={3}
                          fill={token.color.selection ?? '#534ab7'}
                        />
                        <title>{centerTitles.get(ln.node.id)}</title>
                      </g>
                    )}
                    </Fragment>
                  );
                })}
              </g>
              {/* R5-2：边标签层——树线标注 + 自由边标签统一在此渲染：节点层之上（不被
                  节点盒遮挡，修「标签落进节点范围即失效」）、ghost 层之下。命中区不在本层
                  （留 free-edges 层——交互层级不得随标签上提；契约测试含反例钉）。 */}
              <g data-layer="edge-labels">
                {treeEdgeLabels.map((l) => (
                  <g key={l.key} data-tree-edge-label>
                    <EdgeLabel
                      ax={l.ax}
                      ay={l.ay}
                      nx={l.nx}
                      ny={l.ny}
                      text={l.text}
                      stroke={l.stroke}
                      token={token}
                    />
                  </g>
                ))}
                {/* 自由边标签：订阅 store（收集面见 FreeEdgeLayer.onLabelsChange + 本文件
                    freeLabelStore）——订阅面收敛在本组件，标签随路由每帧变化不重渲 MapView */}
                <FreeEdgeLabelLayer store={freeLabelStore} token={token} />
              </g>
              {/* 淡出中的被删节点（M5-T2 ghost）：动画期间随帧淡出，结束后随 anim 清空移除 */}
              {visibleGhosts.length > 0 && (
                <g data-ghost-group data-layer="ghosts">
                  {visibleGhosts.map((g) => {
                    const a = animBoxes?.get(g.node.id);
                    if (!a) return null;
                    const m =
                      derived.metrics.get(g.node.id) ?? derived.metricFn(g.node, g.depth);
                    const palette =
                      token.color.branches[derived.branchIndex.get(g.node.id) ?? 0] ??
                      token.color.branches[0]!;
                    const entityKind = g.node.type === 'entity' ? (g.node.ref?.kind ?? null) : null;
                    const style = nodeCardStyle(token, palette, visualRankOf(g.depth), entityKind);
                    return (
                      <NodeG
                        key={`ghost-${g.node.id}`}
                        node={g}
                        style={style}
                        metrics={m}
                        token={token}
                        depth={g.depth}
                        root={g.depth === 0}
                        chipX={entityKind !== null ? chipXOf(m, charFor(g.depth)) : null}
                        noText={lodSkipText(lod, g.depth)}
                        hasChildren={g.node.children.length > 0}
                        collapsed={collapsedIds?.has(g.node.id) ?? false}
                        anim={a}
                      />
                    );
                  })}
                </g>
              )}
              {/* M5-T5：拖拽浮空克隆（跟随光标，置顶） */}
              {/* A4：中心岛拖动不走浮空克隆（整岛已在原位偏移预览） */}
              {nodeDrag?.moved && draggedLn && !centerPreview && (
                <g data-drag-layer data-layer="drag" style={{ pointerEvents: 'none' }}>
                  <g data-drag-clone>
                    <NodeG
                      node={draggedLn}
                      style={nodeCardStyle(
                        token,
                        token.color.branches[derived.branchIndex.get(draggedLn.node.id) ?? 0] ??
                          token.color.branches[0]!,
                        visualRankOf(draggedLn.depth),
                        draggedLn.node.type === 'entity'
                          ? (draggedLn.node.ref?.kind ?? null)
                          : null,
                      )}
                      metrics={
                        derived.metrics.get(draggedLn.node.id) ??
                        derived.metricFn(draggedLn.node, draggedLn.depth)
                      }
                      token={token}
                      depth={draggedLn.depth}
                      root={draggedLn.depth === 0}
                      chipX={
                        draggedLn.node.type === 'entity' && draggedLn.node.ref?.kind
                          ? chipXOf(
                              derived.metrics.get(draggedLn.node.id) ??
                                derived.metricFn(draggedLn.node, draggedLn.depth),
                              charFor(draggedLn.depth),
                            )
                          : null
                      }
                      noText={lodSkipText(lod, draggedLn.depth)}
                      hasChildren={draggedLn.node.children.length > 0}
                      collapsed={collapsedIds?.has(draggedLn.node.id) ?? false}
                      assetBaseUrl={assetBaseUrl}
                      resolveAssetUrl={resolveAssetUrlStable}
                      anim={{
                        x: draggedLn.box.x + nodeDrag.dx / k,
                        y: draggedLn.box.y + nodeDrag.dy / k,
                        w: draggedLn.box.w,
                        h: draggedLn.box.h,
                        opacity: 0.85,
                        scale: 1,
                      }}
                    />
                  </g>
                  {/* 落点指示器：child → 目标虚线环；before/after → 目标边缘插入线（合法 selection / 拒绝 warn） */}
                  {nodeDrag.targetId &&
                    (() => {
                      const t = layout.nodes.find((n) => n.node.id === nodeDrag.targetId);
                      if (!t) return null;
                      const stroke = nodeDrag.valid ? token.color.selection : token.color.warn;
                      if (nodeDrag.mode === 'child') {
                        return (
                          <g data-drop-indicator>
                            <rect
                              x={t.box.x - 4}
                              y={t.box.y - 4}
                              width={t.box.w + 8}
                              height={t.box.h + 8}
                              rx={token.radius.node + 4}
                              fill="none"
                              stroke={stroke}
                              strokeWidth={2}
                              strokeDasharray="5 3"
                            />
                          </g>
                        );
                      }
                      const iy = nodeDrag.mode === 'before' ? t.box.y - 5 : t.box.y + t.box.h + 5;
                      return (
                        <g data-drop-indicator>
                          <line
                            x1={t.box.x - 6}
                            y1={iy}
                            x2={t.box.x + t.box.w + 6}
                            y2={iy}
                            stroke={stroke}
                            strokeWidth={2}
                          />
                        </g>
                      );
                    })()}
                </g>
              )}
              {/* E7：连接手柄（选中节点；加大命中区 + 卡外偏移；拖拽中悬停目标高亮）
                E8：仅关系模式挂载——浏览态不暴露连线入口 */}
              {!useCanvas &&
                selectedId != null &&
                relationModeRef.current &&
                (() => {
                  const ln = layout.nodes.find((n) => n.node.id === selectedId);
                  if (!ln) return null;
                  const box = renderBoxOf(ln.node.id, ln.box);
                  const hx = ln.side === -1 ? box.x - 6 : box.x + box.w + 6;
                  const hy = box.y + box.h / 2;
                  const hover = connectDrag?.hoverId
                    ? layout.nodes.find((n) => n.node.id === connectDrag.hoverId)
                    : null;
                  return (
                    <g data-connect-handle-group>
                      {connectDrag && hover && (
                        <rect
                          data-connect-target
                          x={hover.box.x - 5}
                          y={hover.box.y - 5}
                          width={hover.box.w + 10}
                          height={hover.box.h + 10}
                          rx={token.radius.node + 5}
                          fill="none"
                          stroke={token.color.selection}
                          strokeWidth={2}
                          strokeDasharray="5 3"
                          style={{ pointerEvents: 'none' }}
                        />
                      )}
                      {connectDrag && (
                        <line
                          data-connect-guide
                          x1={hx}
                          y1={hy}
                          x2={connectDrag.x}
                          y2={connectDrag.y}
                          stroke={token.color.selection}
                          strokeWidth={1.5}
                          strokeDasharray="4 4"
                          style={{ pointerEvents: 'none' }}
                        />
                      )}
                      <circle
                        data-connect-handle-hit
                        cx={hx}
                        cy={hy}
                        r={16}
                        fill="transparent"
                        style={{ cursor: 'crosshair' }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          viewport.cancelAnim();
                          const rect = containerRef.current?.getBoundingClientRect();
                          const w = rect
                            ? viewport.toWorld(e.clientX - rect.left, e.clientY - rect.top)
                            : { x: hx, y: hy };
                          setConnectDrag({ sourceId: selectedId, x: w.x, y: w.y, hoverId: null });
                        }}
                      />
                      <circle
                        data-connect-handle
                        cx={hx}
                        cy={hy}
                        r={8}
                        fill={token.color.selection}
                        stroke={token.color.canvas}
                        strokeWidth={2}
                        style={{ pointerEvents: 'none' }}
                      />
                    </g>
                  );
                })()}
            </g>
          </svg>
        )}
        {/* 文本内联编辑 overlay：屏幕坐标定位（F2 → editingId） */}
        {editingId != null && (
          <NodeTextOverlay
            // G10：key 强制随 editingId 重建。Tab 生长时 editingId 在同一事件内
            // 从旧节点直接切到新节点（无 null 中间态被渲染），若不重建则
            // OverlayEditor 的 useState(initial) 不会重置，输入框会残留上一节点文本。
            // （已由 tests/edit-tab-grow.test.tsx 变异验证：去掉 key 该测试即红。）
            key={editingId}
            editingId={editingId}
            layout={layout}
            viewport={viewport}
            token={token}
            onCommit={onEditCommitRef.current}
            onCancel={onEditCancelRef.current}
            // FO-C1：框内大纲行 → 换行编辑（textarea，宽度 = 行盒宽、高度随内容）。
            // 判据与框内行渲染同源（frameRowIds）——两层不会对同一行给出不同编辑形态。
            wrap={frameRowIds.has(editingId)}
            // v1.3.0：主题编辑态 Shift+Enter → 切到该节点描述编辑
            onDescEditRequest={(id) => onDescEditRequestRef.current?.(id)}
            onTabGrow={onEditTabGrowRef.current}
          />
        )}
        {/* 快速注释"生长"：展开节点在下方渲染注释区（连体 + 内置滚动；锚定节点屏幕位置） */}
        {expandedId != null && (
          <ExpandCommentOverlay
            expandedId={expandedId}
            layout={layout}
            viewport={viewport}
            token={token}
            fixedNoteIds={fixedNoteIds}
            onChange={(qa) => onQaChangeRef.current?.(expandedId, qa)}
            onClose={() => onToggleExpandRef.current?.(expandedId)}
          />
        )}
        {/* FO-B2：成框节点 = 框壳 + 框内可写大纲。层序：本层在**描述块/内联编辑之下**
            （同盒叠加时注释与输入框要可见可点），在 SVG 画布之上（覆盖节点卡让位区）。
            行盒取 B1 岛产出；深层空间节点不在此层，仍是画布节点卡。 */}
        {frameViews.map((frameView) => (
          <FrameOutline
            key={frameView.root.id}
            frameRoot={frameView.root}
            // 行盒取「与画布节点卡同一口径」的盒（含布局过渡插值 / 中心拖拽预览），
            // 否则布局动画期行与卡会错位（行是 HTML 浮层，不走 SVG 变换）
            boxOf={(id) => {
              const box = derived.boxes.get(id);
              return box === undefined ? undefined : renderBoxOf(id, box);
            }}
            transform={{ k, x, y }}
            token={token}
            selectedId={selectedId ?? null}
            editingId={editingId ?? null}
            // 选中复用既有节点点击通道（含「再点一次放大展开」的既有语义），不新开选择状态
            onSelect={(id) => {
              const ln = layout.nodes.find((n) => n.node.id === id);
              if (ln) onNodeClickRef.current?.(ln, { shift: false, sx: 0, sy: 0 });
            }}
            onEditStart={(id) => onEditStartRef.current?.(id)}
            onFrameKey={(id, action) => onFrameKeyRef.current?.(id, action)}
            // 注释入口复用既有幕布 desc 编辑通道（Shift+Enter/浮动描述块同一状态）
            onDescEdit={(id) => onDescEditRequestRef.current?.(id)}
            // 整框出屏不建 DOM（§5.4：一期不为框做虚拟化，只裁整框）
            view={view}
          />
        ))}

        {/* v1.3.0 幕布描述：视口内凡有 note.desc 的节点在下方渲染引用块（完整换行，超长内部滚动） */}
        <DescOverlays
          visible={visibleNodes}
          viewport={viewport}
          token={token}
          descEditingId={descEditingId}
          fixedNoteIds={fixedNoteIds}
          expandedId={expandedId}
          onCommit={(id, t) => onDescCommitRef.current?.(id, t)}
          onCancel={() => onDescCancelRef.current?.()}
          root={rootNode}
          onJumpToAnchor={(a) => onJumpToAnchorRef.current?.(a)}
        />

        {/* 悬停预览不影响布局；点击后转为节点内的固定 note 笔记。 */}
        {noteTargets.map((noteTarget) => (
          <NotePopover
            key={noteTarget.id}
            seq={noteTarget.data.seq}
            text={noteTarget.data.text}
            mode="floating"
            x={noteTarget.x}
            y={noteTarget.y}
            anchorTop={noteTarget.anchorTop}
            viewportW={viewport.viewW}
            viewportH={viewport.viewH}
            // 宽度对齐节点长度；字号不大于节点内部字体（屏幕口径：世界值 × k）
            nodeWidth={noteTarget.nodeWidth}
            nodeFontSize={noteTarget.nodeFontSize}
            pinned={noteTarget.pinned}
            editing={false}
            token={token}
            onChangeSeq={(seq) => onNoteChangeSeq?.(noteTarget.id, seq)}
            onChangeText={(text) => onNoteChangeText?.(noteTarget.id, text)}
            onClose={() => onNoteCloseRef.current?.(noteTarget.id)}
            onPin={() => onNotePin?.(noteTarget.id)}
            root={rootNode}
            onJumpToAnchor={(a) => onJumpToAnchorRef.current?.(a)}
          />
        ))}
        {fixedNotePanels.map((panel) => (
          <NotePopover
            key={panel.id}
            seq={panel.data.seq}
            text={panel.data.text}
            md={panel.md}
            flipped={flippedNoteIdSet?.has(panel.id)}
            onFlipChange={(next) => onToggleNoteFlip?.(panel.id, next)}
            pinned
            editing={panel.editing}
            token={token}
            // 世界空间卡片：基线尺寸 + 一次 scale(k)（不逐帧改内部字号）
            mode="embedded"
            scale={panel.k}
            x={panel.x}
            y={panel.y}
            width={panel.worldWidth}
            height={panel.worldHeight}
            // 世界口径：卡片宽度本就是节点基线宽；字号同样不大于节点字号
            nodeFontSize={nodeFontOf(token, panel.depth)}
            onChangeSeq={(seq) => onNoteChangeSeq?.(panel.id, seq)}
            onChangeText={(text) => onNoteChangeText?.(panel.id, text)}
            onChangeMd={(md) => onNoteChangeMd?.(panel.id, md)}
            onClose={() => onNoteCloseRef.current?.(panel.id)}
            root={rootNode}
            onJumpToAnchor={(a) => onJumpToAnchorRef.current?.(a)}
          />
        ))}
      {/* FA2-T3：拖放落点预览 —— 松手前就能看到会被插成图标 / 插图 / 子分支 / 自由节点。
          position:fixed 直接用 clientX/clientY，省去一层坐标换算。 */}
      {dropPreview && (
        <div
          data-drop-preview
          data-drop-action={dropPreview.target.action}
          data-drop-node={dropPreview.target.nodeId ?? ''}
          style={{
            position: 'fixed',
            left: dropPreview.sx + 14,
            top: dropPreview.sy + 14,
            zIndex: 90,
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 10px',
            borderRadius: 999,
            background: token.color.annotationBadge,
            border: `1px dashed ${token.color.selection}`,
            color: token.color.text,
            fontFamily: token.font.family,
            fontSize: token.font.sizeLeaf,
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ color: token.color.selection }}>{dropGlyph(dropPreview.target.action)}</span>
          <span>{dropHint(dropPreview.target.action)}</span>
        </div>
      )}
      </div>
    </div>
  );
}

/**
 * 节点正文字号（世界 px，k=1）：三档随 rank —— 与 NodeG 走同一出口 fontOf（DEPTH-VIS-1）。
 * note 浮窗/卡片据此封顶自己的字号（笔记不得大于所属节点字体）。
 */
function nodeFontOf(token: TokenSet, depth: number): number {
  return fontOf(token, depth).size;
}

/** 实体 kind chip 起点（contentX - kindW - 6；与内核 displayMetrics 排版一致） */
function chipXOf(m: { contentX: number; kindLabel: string | null }, char: CharMeasure): number {
  if (!m.kindLabel) return 0;
  return m.contentX - (char(m.kindLabel) + 10) - 6;
}

/** 两盒的包围盒（并集；边跨度裁剪用——覆盖连线经过的全部区域） */
function spanBoxOf(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

/** 三次贝塞尔 d 串 → t=0.5 中点（树边标签 chip 锚定） */
