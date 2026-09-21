import type { McCanvasDocument, NativePlacement, NativeShell } from './types.js';

/** 宿主 crypto 的局部结构化类型：不引 DOM lib / @types/node，保持 headless 纯净 */
interface CryptoLike {
  randomUUID?: () => string;
}

function newId(prefix: string): string {
  const host = globalThis as { crypto?: CryptoLike };
  const uuid = host.crypto?.randomUUID?.();
  if (typeof uuid === 'string' && uuid !== '') {
    return `${prefix}_${uuid}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createCanvasId(): string {
  return newId('cv');
}

export function createPlacementUuid(): string {
  return newId('pl');
}

export function createEdgeUuid(): string {
  return newId('ed');
}

const DEFAULT_SIZE: Record<NativeShell, { w: number; h: number }> = {
  'sticky-classic': { w: 200, h: 160 },
  'card-panel': { w: 280, h: 200 },
};

export interface CreateNativeOpts {
  shell: NativeShell;
  x: number;
  y: number;
  zIndex?: number;
  title?: string;
}

/** 落一张原生卡（默认无 back；markdown 空正文） */
export function createNativePlacement(opts: CreateNativeOpts): NativePlacement {
  const now = Date.now();
  const size = DEFAULT_SIZE[opts.shell];
  const text =
    opts.title ??
    (opts.shell === 'sticky-classic' ? '便签' : '面板');
  return {
    kind: 'native',
    placementUuid: createPlacementUuid(),
    shell: opts.shell,
    face: 'front',
    front: { contentKind: 'markdown', body: text },
    transform: { x: opts.x, y: opts.y, w: size.w, h: size.h },
    zIndex: opts.zIndex ?? 0,
    createdAt: now,
    updatedAt: now,
  };
}

/** 空画布文档 */
export function createEmptyDocument(title = '未命名画布'): McCanvasDocument {
  const now = Date.now();
  return {
    schemaVersion: 1,
    canvasId: createCanvasId(),
    title,
    placements: [],
    edges: [],
    viewport: { panX: 0, panY: 0, scale: 1 },
    updatedAt: now,
  };
}
