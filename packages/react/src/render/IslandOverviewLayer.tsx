/**
 * IO-1/IO-2 · 岛级远观总览渲染层（SVG）+ IO-UX 视觉升级。
 *
 * 挂载：MapView 变换 `<g>` 内、Section 层之后、树线层之前。
 *
 * 视觉（远观地标，非线框草稿）：
 * - **实底深色面板** + 色相描边（实线；与虚线自由边区分）+ 左侧色条；
 * - 标题栏半透明色带；成员数 / ⊞ 嵌套用胶囊角标；
 * - 迷你子卡：更深实底、实线描边、钳在父内容区；
 * - 尺寸一律 ×1/k **屏稳**；色板键复用 SECTION_PALETTE.chip。
 *
 * 交互不变：选中 / 标题拖中心 / 双击聚焦；迷你 stopPropagation。
 */
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Box, SectionColor } from '@mindcanvas/kernel';
import {
  clampBoundsInside,
  estimateTextWidth,
  type IslandOverviewCard,
  screenStableSize,
  truncateWithEllipsis,
} from './islandOverview.js';
import { SECTION_PALETTE, type SectionPaletteEntry } from './sectionFrames.js';

export interface IslandOverviewLayerProps {
  cards: readonly IslandOverviewCard[];
  k: number;
  selectedRootId?: string | null;
  onSelect?: (rootId: string) => void;
  onTitlePointerDown?: (rootId: string, e: ReactPointerEvent<SVGGElement>) => void;
  onFocus?: (rootId: string) => void;
}

/** 屏幕目标尺寸（px；世界值 = 本值 / k） */
const TITLE_FONT_PX = 14;
const BADGE_FONT_PX = 11;
const TITLE_ROW_H_PX = 32;
const MIN_CARD_W_PX = 148;
const MIN_CARD_H_PX = 52;
const RADIUS_PX = 12;
const BAR_W_PX = 5;
const PAD_X_PX = 12;

const MIN_NESTED_W_PX = 80;
const MIN_NESTED_H_PX = 32;
const NESTED_TITLE_FONT_PX = 12;
const NESTED_BADGE_FONT_PX = 10;
const NESTED_TITLE_ROW_H_PX = 24;
const NESTED_RADIUS_PX = 8;
const NESTED_BAR_W_PX = 3;
const NESTED_PAD_X_PX = 8;
const MINI_INSET_PX = 10;

/** 远观面板：深色实底（Section 的 8% tint 在暗画布上几乎不可见） */
const BODY_FILL = 'rgba(22, 24, 31, 0.94)';
const BODY_FILL_NESTED = 'rgba(12, 14, 18, 0.96)';
const HEADER_SCRIM = 'rgba(255, 255, 255, 0.04)';

function paletteOf(color: string | undefined): SectionPaletteEntry {
  const entry = color !== undefined ? SECTION_PALETTE[color as SectionColor] : undefined;
  return entry ?? SECTION_PALETTE.slate;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** 把 #rrggbb 转成带 alpha 的描边/底 tint（未知格式回落原色） */
function chipAlpha(chip: string, a: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(chip)) return chip;
  const r = Number.parseInt(chip.slice(1, 3), 16);
  const g = Number.parseInt(chip.slice(3, 5), 16);
  const b = Number.parseInt(chip.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/** 右上胶囊角标（成员数 / ⊞）；`xRight` = 胶囊右缘 */
function BadgePill({
  xRight,
  yMid,
  label,
  chip,
  k,
  fontPx,
  testId,
}: {
  xRight: number;
  yMid: number;
  label: string;
  chip: string;
  k: number;
  fontPx: number;
  testId?: string;
}) {
  const inv = (px: number): number => screenStableSize(px, k);
  const fs = inv(fontPx);
  const padX = inv(7);
  const h = inv(fontPx + 6);
  const tw = label.length * fs * 0.62;
  const w = tw + padX * 2;
  const x = xRight - w;
  const y = yMid - h / 2;
  return (
    <g data-island-overview-badge={testId} pointerEvents="none">
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={h / 2}
        fill={chipAlpha(chip, 0.18)}
        stroke={chipAlpha(chip, 0.35)}
        strokeWidth={inv(1)}
      />
      <text
        x={x + w / 2}
        y={yMid}
        dominantBaseline="central"
        textAnchor="middle"
        fontSize={fs}
        fontWeight={600}
        fill={chip}
      >
        {label}
      </text>
    </g>
  );
}

function badgeWidth(label: string, k: number, fontPx: number): number {
  const inv = (px: number): number => screenStableSize(px, k);
  return label.length * inv(fontPx) * 0.62 + inv(7) * 2;
}

function MiniCardView({
  mini,
  parentId,
  safe,
  k,
  selected,
  onSelect,
  onTitlePointerDown,
  onFocus,
}: {
  mini: IslandOverviewCard;
  parentId: string;
  safe: Box;
  k: number;
  selected: boolean;
  onSelect?: (rootId: string) => void;
  onTitlePointerDown?: (rootId: string, e: ReactPointerEvent<SVGGElement>) => void;
  onFocus?: (rootId: string) => void;
}) {
  const palette = paletteOf(mini.color);
  const inv = (px: number): number => screenStableSize(px, k);
  const natural: Box = {
    x: mini.bounds.x,
    y: mini.bounds.y,
    w: Math.max(mini.bounds.w, inv(MIN_NESTED_W_PX)),
    h: Math.max(mini.bounds.h, inv(MIN_NESTED_H_PX)),
  };
  const placed = clampBoundsInside(safe, natural, 0);
  if (placed.w <= 0 || placed.h <= 0) return null;
  const shrink = clamp(Math.min(1, placed.w / natural.w, placed.h / natural.h), 0.5, 1);
  const { x, y, w, h } = placed;
  const barW = inv(NESTED_BAR_W_PX) * shrink;
  const titleH = Math.min(inv(NESTED_TITLE_ROW_H_PX) * shrink, h);
  const padX = inv(NESTED_PAD_X_PX) * shrink;
  const titleX = x + barW + padX;
  // IO-UX2：预留按**实际在场**角标动态算（更深 ⊞ 在底行，与标题行无碰撞）——
  // 固定 36px 预留会把迷你标题挤成硬裁半字。
  const countFont = inv(NESTED_BADGE_FONT_PX) * shrink;
  const reserve = estimateTextWidth(String(mini.memberCount), countFont) + inv(8) * shrink;
  const titleW = Math.max(0, x + w - padX - reserve - titleX);
  const titleText = truncateWithEllipsis(mini.title, titleW, inv(NESTED_TITLE_FONT_PX) * shrink);
  const clipId = `io-mini-clip-${parentId}-${mini.rootId}`.replace(/[^\w-]/g, '_');
  const stroke = selected ? palette.chip : chipAlpha(palette.chip, 0.55);
  return (
    <g
      data-island-overview-nested={mini.rootId}
      data-parent-island={parentId}
      data-member-count={mini.memberCount}
      data-nested-count={mini.nestedCount}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onFocus?.(mini.rootId);
      }}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={titleX} y={y} width={titleW} height={titleH} />
        </clipPath>
      </defs>
      <rect
        data-island-overview-mini-body={mini.rootId}
        x={x}
        y={y}
        width={w}
        height={h}
        rx={inv(NESTED_RADIUS_PX) * shrink}
        fill={BODY_FILL_NESTED}
        stroke={stroke}
        strokeWidth={inv(selected ? 2 : 1.25) * shrink}
        onPointerDown={(e) => {
          e.stopPropagation();
          onSelect?.(mini.rootId);
        }}
      >
        <title>{`${mini.title} · ${mini.memberCount} 个成员（嵌套岛）`}</title>
      </rect>
      <rect
        x={x + inv(1) * shrink}
        y={y + inv(1) * shrink}
        width={Math.max(0, w - inv(2) * shrink)}
        height={Math.max(0, titleH - inv(1) * shrink)}
        rx={inv(NESTED_RADIUS_PX - 1) * shrink}
        fill={chipAlpha(palette.chip, 0.12)}
        pointerEvents="none"
      />
      <rect
        x={x}
        y={y + inv(NESTED_RADIUS_PX) * 0.45 * shrink}
        width={barW}
        height={Math.max(0, h - inv(NESTED_RADIUS_PX) * shrink)}
        rx={barW / 2}
        fill={palette.chip}
        pointerEvents="none"
      />
      <g
        data-island-overview-mini-titlebar={mini.rootId}
        style={{ cursor: onTitlePointerDown ? 'grab' : 'pointer' }}
        onPointerDown={(e) => {
          e.stopPropagation();
          onSelect?.(mini.rootId);
          onTitlePointerDown?.(mini.rootId, e);
        }}
      >
        <rect
          x={x}
          y={y}
          width={w}
          height={titleH}
          rx={inv(NESTED_RADIUS_PX) * shrink}
          fill="transparent"
        />
        <text
          x={titleX}
          y={y + titleH / 2}
          dominantBaseline="central"
          fontSize={inv(NESTED_TITLE_FONT_PX) * shrink}
          fontWeight={600}
          fill="#e8eaef"
          clipPath={`url(#${clipId})`}
          pointerEvents="none"
        >
          {titleText}
        </text>
      </g>
      <text
        data-island-overview-mini-members={mini.rootId}
        x={x + w - padX}
        y={y + titleH / 2}
        dominantBaseline="central"
        textAnchor="end"
        fontSize={inv(NESTED_BADGE_FONT_PX) * shrink}
        fontWeight={600}
        fill={palette.chip}
        pointerEvents="none"
      >
        {mini.memberCount}
      </text>
      {mini.nestedCount > 0 && (
        <text
          data-island-overview-mini-deeper={mini.rootId}
          x={titleX}
          y={y + h - inv(NESTED_BADGE_FONT_PX) * shrink}
          dominantBaseline="central"
          fontSize={inv(NESTED_BADGE_FONT_PX) * shrink}
          fill={chipAlpha(palette.chip, 0.85)}
          pointerEvents="none"
        >
          {`⊞ ${mini.nestedCount}`}
        </text>
      )}
    </g>
  );
}

function CardView({
  card,
  index,
  k,
  selectedRootId,
  onSelect,
  onTitlePointerDown,
  onFocus,
}: {
  card: IslandOverviewCard;
  index: number;
  k: number;
  selectedRootId?: string | null;
  onSelect?: (rootId: string) => void;
  onTitlePointerDown?: (rootId: string, e: ReactPointerEvent<SVGGElement>) => void;
  onFocus?: (rootId: string) => void;
}) {
  const selected = selectedRootId === card.rootId;
  const palette = paletteOf(card.color);
  const inv = (px: number): number => screenStableSize(px, k);
  const { x, y } = card.bounds;
  const barW = inv(BAR_W_PX);
  const titleH = inv(TITLE_ROW_H_PX);
  const padX = inv(PAD_X_PX);
  const miniCount = card.nestedCards?.length ?? 0;
  const minH =
    miniCount > 0
      ? titleH + inv(MINI_INSET_PX) * 2 + inv(MIN_NESTED_H_PX) * miniCount
      : inv(MIN_CARD_H_PX);
  const w = Math.max(card.bounds.w, inv(MIN_CARD_W_PX));
  const h = Math.max(card.bounds.h, minH);
  const titleX = x + barW + padX;
  const badgeRight = x + w - padX;
  // IO-UX2：徽章预留按**实际在场**胶囊计算（成员必在；⊞ 按 nestedCount 有无）+ 8px 尾缝——
  // 固定 72px 的「双胶囊最坏预留」会把无 ⊞ 的卡标题区白白挤掉（用户截图「已落地主/明确不种」硬裁根因之一）。
  const memberBadgeW = badgeWidth(String(card.memberCount), k, BADGE_FONT_PX);
  const nestedBadgeW =
    card.nestedCount > 0 ? badgeWidth(`⊞${card.nestedCount}`, k, BADGE_FONT_PX) : 0;
  const reserve = memberBadgeW + (nestedBadgeW > 0 ? nestedBadgeW + inv(6) : 0) + inv(8);
  const titleW = Math.max(0, badgeRight - reserve - titleX);
  // 可见文本超宽 → 「…」收尾（clipPath 仍是估算误差的硬兜底）；全文仍在 body <title>。
  const titleText = truncateWithEllipsis(card.title, titleW, inv(TITLE_FONT_PX));
  const clipId = `io-clip-${index}-${card.rootId.replace(/[^\w-]/g, '_')}`;
  const stroke = selected ? palette.chip : chipAlpha(palette.chip, 0.5);
  return (
    <g
      data-island-overview={card.rootId}
      data-member-count={card.memberCount}
      data-nested-count={card.nestedCount}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onFocus?.(card.rootId);
      }}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={titleX} y={y} width={titleW} height={titleH} />
        </clipPath>
      </defs>
      {/* 外圈轻 tint：色相氛围，不靠虚线 */}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={inv(RADIUS_PX)}
        fill={chipAlpha(palette.chip, 0.07)}
        pointerEvents="none"
      />
      <rect
        data-island-overview-body={card.rootId}
        x={x}
        y={y}
        width={w}
        height={h}
        rx={inv(RADIUS_PX)}
        fill={BODY_FILL}
        stroke={stroke}
        strokeWidth={inv(selected ? 2.25 : 1.5)}
        onPointerDown={() => onSelect?.(card.rootId)}
      >
        <title>{`${card.title} · ${card.memberCount} 个成员`}</title>
      </rect>
      {/* 标题栏色带 */}
      <rect
        x={x + inv(1)}
        y={y + inv(1)}
        width={Math.max(0, w - inv(2))}
        height={titleH - inv(1)}
        rx={inv(RADIUS_PX - 1)}
        fill={chipAlpha(palette.chip, 0.14)}
        pointerEvents="none"
      />
      <rect
        x={x + inv(1)}
        y={y + inv(1)}
        width={Math.max(0, w - inv(2))}
        height={titleH - inv(1)}
        rx={inv(RADIUS_PX - 1)}
        fill={HEADER_SCRIM}
        pointerEvents="none"
      />
      <rect
        x={x}
        y={y + inv(RADIUS_PX) * 0.55}
        width={barW}
        height={Math.max(0, h - inv(RADIUS_PX) * 1.1)}
        rx={barW / 2}
        fill={palette.chip}
        pointerEvents="none"
      />
      <g
        data-island-overview-titlebar={card.rootId}
        style={{ cursor: onTitlePointerDown ? 'grab' : 'pointer' }}
        onPointerDown={(e) => {
          onSelect?.(card.rootId);
          onTitlePointerDown?.(card.rootId, e);
        }}
      >
        <rect x={x} y={y} width={w} height={titleH} rx={inv(RADIUS_PX)} fill="transparent" />
        <text
          x={titleX}
          y={y + titleH / 2}
          dominantBaseline="central"
          fontSize={inv(TITLE_FONT_PX)}
          fontWeight={600}
          fill="#f0f2f7"
          clipPath={`url(#${clipId})`}
          pointerEvents="none"
        >
          {titleText}
        </text>
      </g>
      {/* 右上：从右往左 成员胶囊 → ⊞ 胶囊 */}
      <BadgePill
        xRight={badgeRight}
        yMid={y + titleH / 2}
        label={String(card.memberCount)}
        chip={palette.chip}
        k={k}
        fontPx={BADGE_FONT_PX}
        testId={`members-${card.rootId}`}
      />
      <text
        data-island-overview-members={card.rootId}
        x={badgeRight}
        y={y + titleH / 2}
        opacity={0}
        fontSize={1}
        pointerEvents="none"
      >
        {card.memberCount}
      </text>
      {card.nestedCount > 0 && (
        <>
          <BadgePill
            xRight={badgeRight - badgeWidth(String(card.memberCount), k, BADGE_FONT_PX) - inv(6)}
            yMid={y + titleH / 2}
            label={`⊞${card.nestedCount}`}
            chip={palette.chip}
            k={k}
            fontPx={BADGE_FONT_PX}
            testId={`nested-${card.rootId}`}
          />
          <text
            data-island-overview-nested-count={card.rootId}
            x={titleX}
            y={y + titleH / 2}
            opacity={0}
            fontSize={1}
            pointerEvents="none"
          >
            {`⊞ ${card.nestedCount}`}
          </text>
        </>
      )}
      {card.nestedCards !== undefined &&
        card.nestedCards.length > 0 &&
        (() => {
          const inset = inv(MINI_INSET_PX);
          const safe: Box = {
            x: x + inset,
            y: y + titleH + inset,
            w: Math.max(0, w - inset * 2),
            h: Math.max(0, h - titleH - inset * 2),
          };
          return card.nestedCards.map((mini) => (
            <MiniCardView
              key={mini.rootId}
              mini={mini}
              parentId={card.rootId}
              safe={safe}
              k={k}
              selected={selectedRootId === mini.rootId}
              onSelect={onSelect}
              onTitlePointerDown={onTitlePointerDown}
              onFocus={onFocus}
            />
          ));
        })()}
    </g>
  );
}

export function IslandOverviewLayer({
  cards,
  k,
  selectedRootId,
  onSelect,
  onTitlePointerDown,
  onFocus,
}: IslandOverviewLayerProps) {
  return (
    <g data-island-overview-layer="" data-layer="island-overview">
      {cards.map((card, i) => (
        <CardView
          key={card.rootId}
          card={card}
          index={i}
          k={k}
          selectedRootId={selectedRootId}
          onSelect={onSelect}
          onTitlePointerDown={onTitlePointerDown}
          onFocus={onFocus}
        />
      ))}
    </g>
  );
}
