/**
 * EdgeLayer —— 自由画布边图层（FC-D：卡间直线 MVP，中心锚）。
 *
 * 世界坐标绘制：SVG 随世界层一起被 viewport transform，卡拖移 / pan / zoom
 * 自动跟随（本层无需感知视口）。线段在卡片之下渲染（中心锚端点自然被卡面遮住一半）。
 * 边选择：`data-fc-edge` + 高亮霓虹；草稿虚线锚点 `data-fc-edge-draft`。
 */
import { useMemo, type CSSProperties } from 'react';
import type { McCanvasEdge, NativePlacement } from '@mindcanvas/free-canvas';
import { CHROME } from '../theme/tokens.js';

/** 画布范围留白（px）：保证线端与草稿手势不出 SVG 边界 */
const EDGE_PAD = 240;

export interface ConnectDraft {
  fromPlacementUuid: string;
  /** 鼠标当前世界坐标 */
  x: number;
  y: number;
}

export interface EdgeLayerProps {
  placements: NativePlacement[];
  edges: McCanvasEdge[];
  selectedEdgeUuid: string | null;
  onSelectEdge: (edgeUuid: string) => void;
  /** 连线草稿（null = 无进行中连线） */
  draft: ConnectDraft | null;
}

function centerOf(p: NativePlacement): { x: number; y: number } {
  return { x: p.transform.x + p.transform.w / 2, y: p.transform.y + p.transform.h / 2 };
}

const svgBase: CSSProperties = {
  position: 'absolute',
  overflow: 'visible',
  pointerEvents: 'none',
};

export function EdgeLayer({
  placements,
  edges,
  selectedEdgeUuid,
  onSelectEdge,
  draft,
}: EdgeLayerProps) {
  // 世界包围盒（含草稿端点）；空画布退化为 1×1
  const box = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const p of placements) {
      xs.push(p.transform.x, p.transform.x + p.transform.w);
      ys.push(p.transform.y, p.transform.y + p.transform.h);
    }
    if (draft !== null) {
      xs.push(draft.x);
      ys.push(draft.y);
    }
    if (xs.length === 0) return { x: 0, y: 0, w: 1, h: 1 };
    const minX = Math.min(...xs) - EDGE_PAD;
    const minY = Math.min(...ys) - EDGE_PAD;
    const maxX = Math.max(...xs) + EDGE_PAD;
    const maxY = Math.max(...ys) + EDGE_PAD;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }, [placements, draft]);

  const centerMap = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const p of placements) m.set(p.placementUuid, centerOf(p));
    return m;
  }, [placements]);

  const draftFrom = draft !== null ? centerMap.get(draft.fromPlacementUuid) : undefined;

  return (
    <svg
      data-fc-edges
      style={{ ...svgBase, left: box.x, top: box.y, width: box.w, height: box.h }}
    >
      {edges.map((e) => {
        const a = centerMap.get(e.fromPlacementUuid);
        const b = centerMap.get(e.toPlacementUuid);
        if (a === undefined || b === undefined) return null;
        const selected = e.edgeUuid === selectedEdgeUuid;
        return (
          <line
            key={e.edgeUuid}
            data-fc-edge
            data-fc-edge-uuid={e.edgeUuid}
            data-fc-edge-selected={selected ? 'true' : undefined}
            x1={a.x - box.x}
            y1={a.y - box.y}
            x2={b.x - box.x}
            y2={b.y - box.y}
            stroke={selected ? CHROME.neon : 'rgba(255,255,255,.38)'}
            strokeWidth={selected ? 2.5 : 1.5}
            style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
            onPointerDown={(ev) => ev.stopPropagation()}
            onClick={(ev) => {
              ev.stopPropagation();
              onSelectEdge(e.edgeUuid);
            }}
          />
        );
      })}
      {draft !== null && draftFrom !== undefined && (
        <line
          data-fc-edge-draft
          x1={draftFrom.x - box.x}
          y1={draftFrom.y - box.y}
          x2={draft.x - box.x}
          y2={draft.y - box.y}
          stroke={CHROME.neon}
          strokeWidth={1.5}
          strokeDasharray="5 4"
        />
      )}
    </svg>
  );
}
