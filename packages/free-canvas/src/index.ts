/**
 * @mindcanvas/free-canvas —— 自由画布 headless 模型（零 React）。
 */
export type {
  CanvasViewport,
  CardTransform,
  EdgeAnchor,
  Face,
  McCanvasDocument,
  McCanvasEdge,
  NativeBackPayload,
  NativeFrontPayload,
  NativePlacement,
  NativeShell,
} from './types.js';
export { CANVAS_FILE_EXT, isCanvasFileName } from './types.js';

export { isNativePlacement, nativeBackEnabled, nativeBackHasContent } from './guards.js';

export {
  createCanvasId,
  createEdgeUuid,
  createEmptyDocument,
  createNativePlacement,
  createPlacementUuid,
} from './factory.js';

export {
  assertNativeOnly,
  normalizeDocument,
  normalizeEdge,
  normalizePlacement,
  parseCanvasDocument,
  serializeCanvasDocument,
} from './document.js';

export {
  addBack,
  addEdge,
  movePlacement,
  patchBack,
  patchFront,
  removeEdge,
  removePlacement,
  resizePlacement,
  setFace,
  setViewport,
  toggleFace,
  upsertPlacement,
} from './ops.js';
export type { AddEdgeOpts } from './ops.js';

export {
  clampScale,
  MAX_SCALE,
  MIN_SCALE,
  panBy,
  screenToWorld,
  viewportCssTransform,
  worldToScreen,
  zoomAt,
} from './viewport.js';
