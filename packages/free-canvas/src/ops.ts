import { createEdgeUuid } from './factory.js';
import { nativeBackEnabled } from './guards.js';
import type {
  EdgeAnchor,
  McCanvasDocument,
  McCanvasEdge,
  NativeBackPayload,
  NativeFrontPayload,
  NativePlacement,
} from './types.js';

function touch(doc: McCanvasDocument): McCanvasDocument {
  return { ...doc, updatedAt: Date.now() };
}

function mapPlacement(
  doc: McCanvasDocument,
  uuid: string,
  fn: (p: NativePlacement) => NativePlacement,
): McCanvasDocument {
  let found = false;
  const placements = doc.placements.map((p) => {
    if (p.placementUuid !== uuid) return p;
    found = true;
    return fn(p);
  });
  if (!found) return doc;
  return touch({ ...doc, placements });
}

/** 切换正反面（无 back 时 no-op） */
export function toggleFace(doc: McCanvasDocument, placementUuid: string): McCanvasDocument {
  return mapPlacement(doc, placementUuid, (p) => {
    if (!nativeBackEnabled(p.back)) return p;
    const face = p.face === 'front' ? 'back' : 'front';
    return { ...p, face, updatedAt: Date.now() };
  });
}

/** 设置面 */
export function setFace(
  doc: McCanvasDocument,
  placementUuid: string,
  face: 'front' | 'back',
): McCanvasDocument {
  return mapPlacement(doc, placementUuid, (p) => {
    if (face === 'back' && !nativeBackEnabled(p.back)) return p;
    return { ...p, face, updatedAt: Date.now() };
  });
}

/** 添加背面（已有则保留 body）；默认翻到背面 */
export function addBack(
  doc: McCanvasDocument,
  placementUuid: string,
  body = '',
): McCanvasDocument {
  return mapPlacement(doc, placementUuid, (p) => {
    const back: NativeBackPayload = p.back ?? { contentKind: 'markdown', body };
    return { ...p, back, face: 'back', updatedAt: Date.now() };
  });
}

export function patchFront(
  doc: McCanvasDocument,
  placementUuid: string,
  front: NativeFrontPayload,
): McCanvasDocument {
  return mapPlacement(doc, placementUuid, (p) => ({
    ...p,
    front,
    updatedAt: Date.now(),
  }));
}

export function patchBack(
  doc: McCanvasDocument,
  placementUuid: string,
  body: string,
): McCanvasDocument {
  return mapPlacement(doc, placementUuid, (p) => {
    if (!nativeBackEnabled(p.back)) return p;
    return {
      ...p,
      back: { contentKind: 'markdown', body },
      updatedAt: Date.now(),
    };
  });
}

export function movePlacement(
  doc: McCanvasDocument,
  placementUuid: string,
  x: number,
  y: number,
): McCanvasDocument {
  return mapPlacement(doc, placementUuid, (p) => ({
    ...p,
    transform: { ...p.transform, x, y },
    updatedAt: Date.now(),
  }));
}

export function resizePlacement(
  doc: McCanvasDocument,
  placementUuid: string,
  w: number,
  h: number,
): McCanvasDocument {
  return mapPlacement(doc, placementUuid, (p) => ({
    ...p,
    transform: {
      ...p.transform,
      w: Math.max(40, w),
      h: Math.max(40, h),
    },
    updatedAt: Date.now(),
  }));
}

export function upsertPlacement(
  doc: McCanvasDocument,
  placement: NativePlacement,
): McCanvasDocument {
  const i = doc.placements.findIndex((p) => p.placementUuid === placement.placementUuid);
  const placements =
    i < 0
      ? [...doc.placements, placement]
      : doc.placements.map((p, idx) => (idx === i ? placement : p));
  return touch({ ...doc, placements });
}

/** 删卡并级联删边 */
export function removePlacement(doc: McCanvasDocument, placementUuid: string): McCanvasDocument {
  const placements = doc.placements.filter((p) => p.placementUuid !== placementUuid);
  if (placements.length === doc.placements.length) return doc;
  const edges = doc.edges.filter(
    (e) => e.fromPlacementUuid !== placementUuid && e.toPlacementUuid !== placementUuid,
  );
  return touch({ ...doc, placements, edges });
}

export interface AddEdgeOpts {
  fromPlacementUuid: string;
  toPlacementUuid: string;
  fromAnchor?: EdgeAnchor;
  toAnchor?: EdgeAnchor;
  label?: string;
}

export function addEdge(doc: McCanvasDocument, opts: AddEdgeOpts): McCanvasDocument {
  if (opts.fromPlacementUuid === opts.toPlacementUuid) return doc;
  const ids = new Set(doc.placements.map((p) => p.placementUuid));
  if (!ids.has(opts.fromPlacementUuid) || !ids.has(opts.toPlacementUuid)) return doc;
  const now = Date.now();
  const edge: McCanvasEdge = {
    edgeUuid: createEdgeUuid(),
    fromPlacementUuid: opts.fromPlacementUuid,
    toPlacementUuid: opts.toPlacementUuid,
    createdAt: now,
    updatedAt: now,
  };
  if (opts.fromAnchor !== undefined) edge.fromAnchor = opts.fromAnchor;
  if (opts.toAnchor !== undefined) edge.toAnchor = opts.toAnchor;
  if (opts.label !== undefined) edge.label = opts.label;
  return touch({ ...doc, edges: [...doc.edges, edge] });
}

export function removeEdge(doc: McCanvasDocument, edgeUuid: string): McCanvasDocument {
  const edges = doc.edges.filter((e) => e.edgeUuid !== edgeUuid);
  if (edges.length === doc.edges.length) return doc;
  return touch({ ...doc, edges });
}

export function setViewport(
  doc: McCanvasDocument,
  viewport: McCanvasDocument['viewport'],
): McCanvasDocument {
  return touch({ ...doc, viewport: { ...viewport } });
}
