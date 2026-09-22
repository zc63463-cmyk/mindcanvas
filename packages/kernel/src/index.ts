/**
 * @mindcanvas/kernel 入口。
 * K2 后：protocol（事实源）+ entity + registry + plugin + tree（编辑树 + TreeOp）+ layout（布局引擎）。
 */

/** K0 占位常量：内核包身份标识（apps/canvas 组合入口依赖链路冒烟；K1 后可移除） */

export {
  REGISTERED_KINDS,
  KIND_META,
  KIND_FALLBACK_COLOR,
  SECTION_COLORS,
  DEFAULT_SECTION_COLOR,
  validateId,
  stripOrgPrefix,
} from './protocol/types.js';

export {
  makeSectionId,
  removeSection,
  sectionColorOf,
  sectionsOf,
  upsertSection,
} from './protocol/section.js';

// 摘要节点（XMind 式概要）S1：summary_of 范围锚的读写访问器
export {
  removeSummaryOf,
  summaryOf,
  upsertSummaryOf,
} from './protocol/summary.js';

// 子树框编辑（FO-A1/A2）：成框 = 写 note.frame 元数据，不新增 EditableNode.type
export {
  canCreateFrame,
  clampFrameDepth,
  clearFrame,
  frameOf,
  normalizeFrameDepth,
  relativeDepth,
  setFrame,
  subtreeMaxRelativeDepth,
} from './protocol/frame.js';

export type {
  RegisteredKind,
  EntityRef,
  Entity,
  UnresolvedReason,
  MindNode,
  Note,
  Diagnostic,
  ParseResult,
  FrameSpec,
  SectionColor,
  SectionSpec,
  SummarySpec,
} from './protocol/types.js';

export type { FrameDenyReason } from './protocol/frame.js';

// 子树框编辑（FO-A3）：按 depth 切分大纲区 / 空间挂载层（布局岛输入契约，纯函数不搬家）
export { partitionFrameSubtree } from './layout/framePartition.js';
export type { FrameHangRoot, FramePartition } from './layout/framePartition.js';

// 子树框编辑（FO-B1）：框布局岛（大纲区 + 挂点 + 空间层复用现有布局）、岛展开、跨 depth 守卫
// （FO-C2：框壳 AABB 体积 —— `FRAME_SHELL_PAD` / `frameShellSize` / `createFrameShellMeasure`）
export {
  FRAME_HANG_GAP,
  FRAME_HANG_SIBLING_GAP,
  FRAME_ROW_GAP,
  FRAME_ROW_INDENT,
  FRAME_SHELL_PAD,
  collectFrameRoots,
  createFrameShellMeasure,
  crossesFrameDepthBoundary,
  expandFrameIslands,
  frameLayerOf,
  framePrunedCollapsed,
  frameShellGeometry,
  frameShellSize,
  layoutFrameIsland,
} from './layout/frameLayout.js';
export type {
  FrameIslandArgs,
  FrameIslandLayout,
  FrameIslandOptions,
  FrameLayer,
  FrameRowOptions,
  FrameShellGeometry,
} from './layout/frameLayout.js';

// 子树框编辑（FO-C1）：框内大纲行紧凑度量（固定内容列宽 + 自动换行 + 占位扁高）
// （FO-FIX2：行内「注释」chip 已删 —— FRAME_OUTLINE_DESC_CHIP_W / hasFrameDescChip 一并移除）
export {
  FRAME_OUTLINE_CONTENT_W,
  FRAME_OUTLINE_MIN_W,
  FRAME_OUTLINE_PLACEHOLDER_H,
  FRAME_OUTLINE_ROW_GAP,
  FRAME_OUTLINE_ROW_PAD_X,
  FRAME_OUTLINE_ROW_PAD_Y,
  frameRowMetrics,
  frameRowTextWidth,
  frameRowWidth,
  isFramePlaceholderRow,
} from './layout/frameMeasure.js';
export type { FrameRowMetrics } from './layout/frameMeasure.js';

export const kernelPlaceholder = '@mindcanvas/kernel';

export {
  isUnresolved,
  resolveAll,
} from './entity/entity.js';
export type { Resolver } from './entity/entity.js';

export {
  BUILTIN_LAYOUT_KINDS,
  registerBuiltinLayouts,
} from './layout/builtin.js';
export type { LayoutInput } from './layout/builtin.js';

export {
  filterVisibleLinks,
  isBoxInView,
  worldViewportRect,
} from './layout/cull.js';
export type {
  LinkEndpoint,
  Transform2D,
} from './layout/cull.js';

export {
  buildBoxIndex,
  DEFAULT_CELL_SIZE,
  queryBoxIndex,
} from './layout/spatialIndex.js';
export type { BoxIndex } from './layout/spatialIndex.js';

export { fitIntoView } from './layout/fit.js';
export type {
  FitOptions,
  FitTransform,
  Rect,
  Viewport,
} from './layout/fit.js';

export {
  inlineWidth,
  stripInline,
  tokenizeInline,
} from './layout/inline.js';
export type {
  InlineToken,
  InlineType,
} from './layout/inline.js';

export {
  getLayout,
  isLayoutKind,
  layoutFishbone,
  layoutLogic,
  layoutOrg,
  layoutTimeline,
} from './layout/layouts.js';
export type {
  LayoutFunc,
  LayoutKind,
} from './layout/layouts.js';

// D2′ 分支布局（思想分叉）；从 layouts.ts 拆出以避免该文件越过 600 行预算线
export {
  collectDirByNodeId,
  layoutMindmapBranched,
  linkGeometry,
} from './layout/branching.js';
export {
  BEAM_AT_DEFAULT,
  BEAM_AT_EPS,
  BEAM_AT_PAD,
  beamRailBetween,
  clampBeamAt,
  readBeamAt,
  readBeamAtMap,
  readHubFlag,
  readLensMap,
  readLinkLen,
} from './layout/beamSide.js';
export type { BranchLayoutOptions } from './layout/layouts.js';

// 碰撞消解（四向分叉的重叠兜底）：自底向上子树刚性分离 + 全树重叠扫描
export {
  boxesIntersect,
  clearParentEdges,
  findOverlaps,
  overlapXOf,
  overlapYOf,
  separateTree,
  subtreeBoxOf,
  PARENT_EDGE_ROUNDS,
  SEPARATE_MARGIN,
  SEPARATE_MAX_ROUNDS,
} from './layout/separate.js';
export type { OverlapPair, SeparateOptions, SeparateStats } from './layout/separate.js';

// 连线避障：树连线不得压在别的节点盒上（换几何，不动节点）
export {
  collectNodes,
  findLinkCrossings,
  LINK_CLEAR_MARGIN,
  NodeIndex,
  pickClearGeometry,
  polylineBox,
  polylineHitsBox,
  segmentHitsRect,
} from './layout/linkClear.js';
export type { LinkClearOptions, LinkGeometry } from './layout/linkClear.js';

// G6′ 森林布局：多中心各自局部布局 → 平移 → 合并
export {
  GROW_DIR_LABEL,
  layoutForest,
  LAYOUT_KIND_BY_DIR,
} from './layout/forest.js';
export { GROW_DIR_VALUES, isGrowDir } from './layout/mindmap.js';
export type { CenterSpec, GrowDir } from './layout/forest.js';

export {
  layoutIslands,
  projectIslands,
} from './layout/islands.js';
export type {
  Bounds,
  BoundaryLink,
  IslandDiagnostic,
  IslandLayoutOptions,
  IslandLayoutResult,
  IslandProjection,
  IslandSourceKind,
  LayoutIsland,
  ValidatedCenterSpec,
} from './layout/islands.js';

export {
  defaultCharMeasure,
  defaultMeasure,
} from './layout/measure.js';
export type { CharMeasure } from './layout/measure.js';

export {
  __subtreeHeightCache,
  annotateTree,
  bezierControls,
  bezierLink,
  bezierPath,
  buildLayoutTree,
  collectLayout,
  compactBezier,
  H_GAP,
  orgBeamPoints,
  orgBeamPointsUp,
  sampleBezier,
  layoutBounds,
  LayoutCache,
  layoutMindmap,
  orgBeamLink,
  orthogonalPath,
  placeSubtree,
  subtreeHeightCached,
  V_GAP,
} from './layout/mindmap.js';
export type {
  BezierControls,
  Box,
  LayoutNode,
  LayoutOptions,
  LayoutResult,
  LinkBuilder,
  MeasureFn,
  Point,
  SatelliteHook,
} from './layout/mindmap.js';

// 摘要卫星（S3）：钩子 + 几何常量（S4 括线渲染复用同一口径）。
// `satelliteHook` 注入 `layoutMindmap` / `layoutLogic` / `layoutForest` 的 `satellite` 选项；
// 未注入 = 无卫星行为（与旧输出逐位等价）。
export {
  buildSatellitePlan,
  EMPTY_PLAN,
  satelliteHook,
  SUMMARY_BRACKET_GAP,
  SUMMARY_STEM_GAP,
} from './layout/satellite.js';
export type { SatellitePlan, SatelliteSpec } from './layout/satellite.js';
export { NO_SATELLITE_HOOK } from './layout/mindmap.js';

export {
  minimapNodeRects,
  minimapPointToWorld,
  minimapRects,
} from './layout/minimap.js';
export type { MinimapRects } from './layout/minimap.js';

export {
  cachedMetrics,
  displayMetrics,
  LINE_H,
  NODE_ICON_GAP,
  NODE_ICON_SIZE,
  nodeIcon,
  TITLE_MAX_ENTITY,
  TITLE_MAX_IMAGE,
  TITLE_MAX_TEXT,
} from './layout/nodeLayout.js';
export type { DisplayMetrics } from './layout/nodeLayout.js';

export {
  buildRelGeometries,
  collectRelRefs,
  normalizeRel,
  resolveRelTargets,
} from './layout/relations.js';
export type {
  RelEntry,
  RelGeometry,
  ResolvedRel,
} from './layout/relations.js';

export {
  tokenize,
  wrapText,
} from './layout/wrap.js';

export { Plugin } from './plugin/plugin.js';

export { GOLDEN_CASES } from './protocol/goldenCases.js';
export type { GoldenCase } from './protocol/goldenCases.js';

export {
  parseMm,
  tryParseRef,
} from './protocol/parser.js';

export {
  serializeMm,
  verifyRoundTrip,
} from './protocol/serializer.js';

export {
  refKey,
  unresolvedEntity,
} from './protocol/types.js';

export { safeHref } from './protocol/uri.js';

export {
  hasNote,
  nodeAtPath,
  noteOf,
  pathOfNode,
} from './protocol/note.js';
export type { NodeNoteData, NodePath } from './protocol/note.js';

export { registerBuiltinKinds } from './registry/builtin.js';

export { ChannelRegistry } from './registry/channel.js';
export type { Channel } from './registry/channel.js';

export { createKernelRegistries } from './registry/index.js';
export type { KernelRegistries } from './registry/index.js';

export { KindRegistry } from './registry/kind.js';
export type { KindMeta } from './registry/kind.js';

export { LayoutRegistry } from './registry/layout.js';
export type { LayoutAlgorithm } from './registry/layout.js';

export {
  parseLinkAnchor,
  buildCidIndex,
  resolveGroups,
  resolveLinkAnchor,
  resolveLinks,
} from './registry/note-anchor.js';
export type {
  AnchorResolution,
  AnchorResolutionState,
  LinkAnchor,
  LinkDir,
  ResolvedGroup,
  ResolvedGroupMember,
  ResolvedLink,
} from './registry/note-anchor.js';

// 摘要范围锚三态解析（S1）：同父 + 顺序 + S 不在范围内；dangling/stale 只诊断不删数据
export {
  W_SUMMARY_DANGLING,
  collectSummaryDiagnostics,
  resolveSummaries,
} from './registry/summary-anchor.js';
export type { ResolvedSummary, SummaryDiagnostic } from './registry/summary-anchor.js';

export { planReferenceMigration } from './registry/anchor-migrate.js';
export type {
  AnchorRef,
  AnchorUpdate,
  ReferenceConflict,
  ReferenceDiagnostic,
  ReferenceMigrationPlan,
} from './registry/anchor-migrate.js';

export {
  W_SECTION_DANGLING,
  resolveSections,
  collectSectionDiagnostics,
} from './registry/section-anchor.js';
export type { ResolvedSection, SectionDiagnostic } from './registry/section-anchor.js';

export { NoteKeyRegistry } from './registry/note-key.js';
export type { NoteKeyHandler } from './registry/note-key.js';

export { Registry } from './registry/registry.js';
export type { UnregisterHandle } from './registry/registry.js';

export { RendererRegistry } from './registry/renderer.js';

export { SemanticsRegistry } from './registry/semantics.js';
export type { SemRoleMapping } from './registry/semantics.js';

export { History } from './tree/history.js';

export {
  applyOp,
  invertOp,
  OpHistory,
} from './tree/tree-op.js';
export type {
  EntityRefInput,
  NodePatch,
  RecordedOp,
  TreeOp,
} from './tree/tree-op.js';
export type { RecordedBatch, TransactionResult } from './tree/tree-op.js';

export {
  addChild,
  astToEditable,
  collapseFromLevel,
  collectRefs,
  depthOf,
  descendantCount,
  duplicateNode,
  editableToAst,
  findNode,
  firstChildId,
  getNode,
  isInSubtree,
  makeEntityNode,
  makeImageNode,
  makeTextNode,
  MAX_TREE_DEPTH,
  moveNode,
  newId,
  nextSiblingId,
  nodeByPath,
  parentIdOf,
  pathOf,
  prevSiblingId,
  removeNode,
  searchNodes,
  updateNode,
  walkNodes,
} from './tree/treeOps.js';
export type {
  EditableNode,
  NodeLocation,
} from './tree/treeOps.js';

export {
  graphJsonToMindmap,
} from './adapters/graphJsonAdapter.js';
export type {
  GraphJsonPayload,
  GraphJsonNode,
  GraphJsonEdge,
  GraphJsonIndices,
  AdapterResult,
  DocEdgePayload,
} from './adapters/graphJsonAdapter.js';
