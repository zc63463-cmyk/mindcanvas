/**
 * mindcanvas Canvas Document v1 —— 自由画布事实源类型（对齐 markvault native 子集）。
 * 规格：docs/specs/2026-09-15-free-canvas-spec.md
 */

export type Face = 'front' | 'back';

export type NativeShell = 'sticky-classic' | 'card-panel';

export type NativeFrontPayload =
  | { contentKind: 'plain'; text: string }
  | { contentKind: 'markdown'; body: string };

export type NativeBackPayload = { contentKind: 'markdown'; body: string };

export interface CardTransform {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NativePlacement {
  kind: 'native';
  placementUuid: string;
  shell: NativeShell;
  face: Face;
  front: NativeFrontPayload;
  back?: NativeBackPayload;
  transform: CardTransform;
  zIndex: number;
  createdAt: number;
  updatedAt: number;
  /** 未知键透传槽（normalize 时并入） */
  [key: string]: unknown;
}

export type EdgeAnchor = 'top' | 'right' | 'bottom' | 'left' | 'center';

export interface McCanvasEdge {
  edgeUuid: string;
  fromPlacementUuid: string;
  toPlacementUuid: string;
  fromAnchor?: EdgeAnchor;
  toAnchor?: EdgeAnchor;
  label?: string;
  createdAt: number;
  updatedAt: number;
  [key: string]: unknown;
}

export interface CanvasViewport {
  panX: number;
  panY: number;
  scale: number;
}

export interface McCanvasDocument {
  schemaVersion: 1;
  canvasId: string;
  title: string;
  placements: NativePlacement[];
  edges: McCanvasEdge[];
  viewport: CanvasViewport;
  updatedAt: number;
  [key: string]: unknown;
}

export const CANVAS_FILE_EXT = '.mc.canvas.json';

export function isCanvasFileName(name: string): boolean {
  return name.toLowerCase().endsWith(CANVAS_FILE_EXT);
}
