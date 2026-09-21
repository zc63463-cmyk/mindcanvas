/**
 * Section 空间分区渲染层（v1.5.0 Phase 1 · T3）。
 *
 * 挂载：MapView 变换 <g> 的**第一个子元素**（连线层与节点层之下，背景永在最底）。
 * Canvas 模式（useCanvas）不经过 SVG 分支 → 自动降级不渲染（已知限制，见协议 v1.5）。
 *
 * 交互（Phase 1 范围）：
 * - 折叠钮：复用节点级 toggleCollapse（D2 会话态，不落盘）
 * - 标题栏/背景点击 → onSelect（选中态描边实化）；Esc/空白退出由上层手势负责
 * - 标题栏拖拽移动整岛 = center 拖拽管线（T4 接线，本层只暴露 onTitlePointerDown）
 * - ghost（dangling/stale）：灰虚线 chip 停靠视口左上，「移除」按钮交 onRemoveGhost
 */
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Box } from '@mindcanvas/kernel';
import {
  SECTION_PALETTE,
  SECTION_TITLE_H,
  type SectionFrame,
  type SectionGhost,
  type SectionView,
} from './sectionFrames.js';

export interface SectionLayerProps {
  views: readonly SectionView[];
  /** 视口世界矩形（ghost 停靠定位；frame 的逐框裁剪在上层完成） */
  view: Box;
  /** 当前缩放（ghost chip 尺寸按 1/k 换算保持屏幕恒定） */
  k: number;
  selectedId?: string | null;
  onSelect?: (sectionId: string | null) => void;
  onToggleCollapse?: (rootId: string) => void;
  onRemoveGhost?: (sectionId: string) => void;
  /** T4：标题栏拖拽接 center 管线（pointerdown 转发 rootId 与事件） */
  onTitlePointerDown?: (rootId: string, e: ReactPointerEvent<SVGGElement>) => void;
}

const FRAME_RX = 14;
const TITLE_PAD_X = 12;
const CHIP_DOT_R = 5;

function FrameView({
  frame,
  selected,
  onSelect,
  onToggleCollapse,
  onTitlePointerDown,
}: {
  frame: SectionFrame;
  selected: boolean;
  onSelect?: (id: string | null) => void;
  onToggleCollapse?: (rootId: string) => void;
  onTitlePointerDown?: (rootId: string, e: ReactPointerEvent<SVGGElement>) => void;
}) {
  const palette = SECTION_PALETTE[frame.color];
  const { x, y, w } = frame.bounds;
  const badge = frame.collapsed ? `+${frame.memberCount - 1}` : `${frame.memberCount}`;
  return (
    <g data-section-id={frame.id} data-section-root={frame.rootId}>
      <rect
        x={x}
        y={y}
        width={frame.bounds.w}
        height={frame.bounds.h}
        rx={FRAME_RX}
        fill={palette.fill}
        stroke={palette.stroke}
        strokeWidth={selected ? 2 : 1.5}
        strokeDasharray={selected ? undefined : '6 4'}
        onPointerDown={() => onSelect?.(frame.id)}
      />
      {/* 标题栏（框顶内侧横条）：色点 + 标题 + 成员徽标 + 折叠钮；即拖拽热区 */}
      <g
        data-section-titlebar={frame.id}
        style={{ cursor: onTitlePointerDown ? 'grab' : undefined }}
        onPointerDown={(e) => {
          onSelect?.(frame.id);
          onTitlePointerDown?.(frame.rootId, e);
        }}
      >
        <rect
          x={x + 1}
          y={y + 1}
          width={w - 2}
          height={SECTION_TITLE_H}
          rx={FRAME_RX - 2}
          fill="transparent"
        />
        <circle cx={x + TITLE_PAD_X + CHIP_DOT_R} cy={y + SECTION_TITLE_H / 2 + 1} r={CHIP_DOT_R} fill={palette.chip} />
        <text
          x={x + TITLE_PAD_X + CHIP_DOT_R * 2 + 6}
          y={y + SECTION_TITLE_H / 2 + 1}
          dominantBaseline="central"
          fontSize={13}
          fontWeight={600}
          fill={palette.chip}
        >
          {frame.title}
        </text>
        <text
          x={x + w - TITLE_PAD_X - 28}
          y={y + SECTION_TITLE_H / 2 + 1}
          dominantBaseline="central"
          textAnchor="end"
          fontSize={11}
          fill={palette.chip}
          opacity={0.8}
        >
          {badge}
        </text>
        {onToggleCollapse && (
          <g
            data-section-fold={frame.id}
            style={{ cursor: 'pointer' }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onToggleCollapse(frame.rootId);
            }}
          >
            <rect x={x + w - TITLE_PAD_X - 20} y={y + 4} width={20} height={20} rx={4} fill="transparent" />
            <text
              x={x + w - TITLE_PAD_X - 10}
              y={y + SECTION_TITLE_H / 2 + 1}
              dominantBaseline="central"
              textAnchor="middle"
              fontSize={14}
              fontWeight={700}
              fill={palette.chip}
            >
              {frame.collapsed ? '+' : '−'}
            </text>
          </g>
        )}
      </g>
    </g>
  );
}

function GhostChip({
  ghost,
  x,
  y,
  k,
  onRemove,
}: {
  ghost: SectionGhost;
  x: number;
  y: number;
  k: number;
  onRemove?: (id: string) => void;
}) {
  // 屏幕恒定尺寸：世界单位 = 像素 / k
  const inv = 1 / (k > 0 ? k : 1);
  const w = 240 * inv;
  const h = 30 * inv;
  return (
    <g data-section-ghost={ghost.id}>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={8 * inv}
        fill="rgba(100,116,139,0.06)"
        stroke="rgba(100,116,139,0.5)"
        strokeWidth={1.2 * inv}
        strokeDasharray={`${5 * inv} ${4 * inv}`}
      />
      <text x={x + 10 * inv} y={y + h / 2} dominantBaseline="central" fontSize={12 * inv} fill="#64748b">
        {`⚠ ${ghost.title}（锚已失效，数据保留）`}
      </text>
      {onRemove && (
        <g
          data-section-ghost-remove={ghost.id}
          style={{ cursor: 'pointer' }}
          onPointerDown={(e) => {
            e.stopPropagation();
            onRemove(ghost.id);
          }}
        >
          <rect x={x + w - 26 * inv} y={y + 4 * inv} width={22 * inv} height={22 * inv} fill="transparent" />
          <text
            x={x + w - 15 * inv}
            y={y + h / 2}
            dominantBaseline="central"
            textAnchor="middle"
            fontSize={13 * inv}
            fill="#64748b"
          >
            ✕
          </text>
        </g>
      )}
    </g>
  );
}

export function SectionLayer({
  views,
  view,
  k,
  selectedId,
  onSelect,
  onToggleCollapse,
  onRemoveGhost,
  onTitlePointerDown,
}: SectionLayerProps) {
  const inv = 1 / (k > 0 ? k : 1);
  let ghostY = view.y + 12 * inv;
  return (
    <g data-section-layer="" data-layer="sections">
      {views.map((v) => {
        if (v.kind === 'frame') {
          return (
            <FrameView
              key={v.id}
              frame={v}
              selected={selectedId === v.id}
              onSelect={onSelect}
              onToggleCollapse={onToggleCollapse}
              onTitlePointerDown={onTitlePointerDown}
            />
          );
        }
        const chip = (
          <GhostChip key={v.id} ghost={v} x={view.x + 12 * inv} y={ghostY} k={k} onRemove={onRemoveGhost} />
        );
        ghostY += 38 * inv;
        return chip;
      })}
    </g>
  );
}
