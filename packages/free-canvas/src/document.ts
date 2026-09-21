import { isNativePlacement } from './guards.js';
import type {
  CanvasViewport,
  McCanvasDocument,
  McCanvasEdge,
  NativeBackPayload,
  NativeFrontPayload,
  NativePlacement,
  NativeShell,
  CardTransform,
  Face,
  EdgeAnchor,
} from './types.js';

/** 对象记录类型谓词（替代 `as` 断言：budget asCast 只减不增） */
function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return isRecord(v) ? v : null;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function normalizeTransform(raw: unknown): CardTransform {
  const o = asRecord(raw) ?? {};
  return {
    x: num(o.x, 0),
    y: num(o.y, 0),
    w: Math.max(40, num(o.w, 200)),
    h: Math.max(40, num(o.h, 160)),
  };
}

function normalizeFront(raw: unknown): NativeFrontPayload {
  const o = asRecord(raw);
  if (o?.contentKind === 'plain') {
    return { contentKind: 'plain', text: str(o.text, '') };
  }
  if (o?.contentKind === 'markdown') {
    return { contentKind: 'markdown', body: str(o.body, '') };
  }
  // 容错：字符串当 markdown
  if (typeof raw === 'string') return { contentKind: 'markdown', body: raw };
  return { contentKind: 'markdown', body: '' };
}

function normalizeBack(raw: unknown): NativeBackPayload | undefined {
  if (raw === undefined || raw === null) return undefined;
  const o = asRecord(raw);
  if (o === null) return { contentKind: 'markdown', body: '' };
  return { contentKind: 'markdown', body: str(o.body, '') };
}

function isShell(v: unknown): v is NativeShell {
  return v === 'sticky-classic' || v === 'card-panel';
}

function normalizeShell(raw: unknown): NativeShell {
  return isShell(raw) ? raw : 'sticky-classic';
}

function normalizeFace(raw: unknown): Face {
  return raw === 'back' ? 'back' : 'front';
}

/** 归一化单条 placement；非 native / 缺 uuid → null（丢弃） */
export function normalizePlacement(raw: unknown): NativePlacement | null {
  const o = asRecord(raw);
  if (o === null) return null;
  if (o.kind !== undefined && o.kind !== 'native') return null;
  const uuid = str(o.placementUuid, '');
  if (uuid === '') return null;
  const now = Date.now();
  const known = new Set([
    'kind',
    'placementUuid',
    'shell',
    'face',
    'front',
    'back',
    'transform',
    'zIndex',
    'createdAt',
    'updatedAt',
  ]);
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (!known.has(k)) extras[k] = v;
  }
  const back = normalizeBack(o.back);
  const face = normalizeFace(o.face);
  const placement: NativePlacement = {
    ...extras,
    kind: 'native',
    placementUuid: uuid,
    shell: normalizeShell(o.shell),
    face: back === undefined ? 'front' : face,
    front: normalizeFront(o.front),
    transform: normalizeTransform(o.transform),
    zIndex: num(o.zIndex, 0),
    createdAt: num(o.createdAt, now),
    updatedAt: num(o.updatedAt, now),
  };
  if (back !== undefined) placement.back = back;
  return placement;
}

function isAnchor(v: unknown): v is EdgeAnchor {
  return v === 'top' || v === 'right' || v === 'bottom' || v === 'left' || v === 'center';
}

function normalizeAnchor(raw: unknown): EdgeAnchor | undefined {
  if (raw === undefined) return undefined;
  return isAnchor(raw) ? raw : 'center';
}

export function normalizeEdge(raw: unknown): McCanvasEdge | null {
  const o = asRecord(raw);
  if (o === null) return null;
  const edgeUuid = str(o.edgeUuid, '');
  const from = str(o.fromPlacementUuid, '');
  const to = str(o.toPlacementUuid, '');
  if (edgeUuid === '' || from === '' || to === '') return null;
  const now = Date.now();
  const known = new Set([
    'edgeUuid',
    'fromPlacementUuid',
    'toPlacementUuid',
    'fromAnchor',
    'toAnchor',
    'label',
    'createdAt',
    'updatedAt',
  ]);
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (!known.has(k)) extras[k] = v;
  }
  const edge: McCanvasEdge = {
    ...extras,
    edgeUuid,
    fromPlacementUuid: from,
    toPlacementUuid: to,
    createdAt: num(o.createdAt, now),
    updatedAt: num(o.updatedAt, now),
  };
  const fa = normalizeAnchor(o.fromAnchor);
  const ta = normalizeAnchor(o.toAnchor);
  if (fa !== undefined) edge.fromAnchor = fa;
  if (ta !== undefined) edge.toAnchor = ta;
  if (typeof o.label === 'string') edge.label = o.label;
  return edge;
}

function normalizeViewport(raw: unknown): CanvasViewport {
  const o = asRecord(raw) ?? {};
  const scale = num(o.scale, 1);
  return {
    panX: num(o.panX, 0),
    panY: num(o.panY, 0),
    scale: scale > 0 ? scale : 1,
  };
}

/**
 * 解析 JSON 文本 → 文档。非法 JSON 抛错；结构容错归一化。
 * 未知顶层键透传。
 */
export function parseCanvasDocument(source: string): McCanvasDocument {
  const parsed: unknown = JSON.parse(source);
  return normalizeDocument(parsed);
}

export function normalizeDocument(raw: unknown): McCanvasDocument {
  const o = asRecord(raw);
  if (o === null) {
    throw new Error('E-CANVAS-DOC: root must be object');
  }
  const now = Date.now();
  const placementsRaw = Array.isArray(o.placements) ? o.placements : [];
  const edgesRaw = Array.isArray(o.edges) ? o.edges : [];
  const placements = placementsRaw
    .map(normalizePlacement)
    .filter((p): p is NativePlacement => p !== null);
  const edges = edgesRaw.map(normalizeEdge).filter((e): e is McCanvasEdge => e !== null);

  const known = new Set([
    'schemaVersion',
    'canvasId',
    'title',
    'placements',
    'edges',
    'viewport',
    'updatedAt',
  ]);
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (!known.has(k)) extras[k] = v;
  }

  return {
    ...extras,
    schemaVersion: 1,
    canvasId: str(o.canvasId, `cv_${now}`),
    title: str(o.title, '未命名画布'),
    placements,
    edges,
    viewport: normalizeViewport(o.viewport),
    updatedAt: num(o.updatedAt, now),
  };
}

/** 序列化（稳定缩进）；保留未知键 */
export function serializeCanvasDocument(doc: McCanvasDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** 断言 placements 全为 native（测试/调试用） */
export function assertNativeOnly(doc: McCanvasDocument): void {
  for (const p of doc.placements) {
    if (!isNativePlacement(p)) throw new Error('non-native placement');
  }
}
