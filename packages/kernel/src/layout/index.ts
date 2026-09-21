/**
 * layout 模块入口：布局引擎（六布局 + 裁剪 + 关系边 + 度量注入 + 默认实现 + 内置注册）。
 * relations 因本地 EntityRef/Box 与 protocol/mindmap 重名，以显式命名导出（避免 export * 冲突）。
 */
export * from './inline.js';
export * from './wrap.js';
export * from './mindmap.js';
export * from './layouts.js';
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
  type OverlapPair,
  type SeparateOptions,
  type SeparateStats,
} from './separate.js';
export {
  collectNodes,
  findLinkCrossings,
  LINK_CLEAR_MARGIN,
  NodeIndex,
  pickClearGeometry,
  polylineBox,
  polylineHitsBox,
  segmentHitsRect,
  type LinkClearOptions,
  type LinkGeometry,
} from './linkClear.js';
export * from './nodeLayout.js';
export * from './cull.js';
export * from './fit.js';
export * from './minimap.js';
export * from './measure.js';
export * from './builtin.js';
export {
  normalizeRel,
  collectRelRefs,
  resolveRelTargets,
  buildRelGeometries,
  type RelEntry,
  type ResolvedRel,
  type RelGeometry,
} from './relations.js';
export {
  projectIslands,
  layoutIslands,
  type ValidatedCenterSpec,
  type IslandSourceKind,
  type LayoutIsland,
  type BoundaryLink,
  type IslandDiagnostic,
  type IslandProjection,
  type Bounds,
  type IslandLayoutOptions,
  type IslandLayoutResult,
} from './islands.js';
