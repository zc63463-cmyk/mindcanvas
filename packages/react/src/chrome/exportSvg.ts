/**
 * SVG 导出（GH-T4）：当前文档全图 → 独立 SVG 字符串（保持主题令牌；复用渲染侧 nodeCardStyle/buildLinkPath）。
 * view 缺省 = 布局 bounds 外扩 40px（全图导出）。
 */
import {
  filterVisibleLinks,
  isBoxInView,
  type EditableNode,
  type GrowDir,
  type LayoutResult,
  readBeamAt,
  readHubFlag,
} from '@mindcanvas/kernel';
import {
  buildLinkPath,
  computeBranchIndex,
  fontOf,
  horizontalBeamMap,
  hubArrowTip,
  nodeCardStyle,
  verticalBeamMap,
  visualRankOf,
  type LinkGeom,
} from '../render/geometry.js';
import { collectDeclaredGrowDir } from '../render/growDir.js';
import type { TokenSet } from '../theme/index.js';

export interface ExportSvgOptions {
  /** 世界坐标可见区域（缺省 = 全图 bounds 外扩） */
  view?: { x: number; y: number; w: number; h: number };
  title?: string;
  /** G6″（A6/T23）：跨岛父子连接——导出补线（虚线；端点盒缺失时跳过，不误连） */
  boundaryLinks?: ReadonlyArray<{ fromId: string; toId: string }>;
}

export function exportSvg(
  layout: LayoutResult,
  token: TokenSet,
  opts: ExportSvgOptions = {},
): string {
  const b = layout.bounds;
  const view = opts.view ?? {
    x: b.minX - 40,
    y: b.minY - 40,
    w: b.maxX - b.minX + 80,
    h: b.maxY - b.minY + 80,
  };
  const boxes = new Map(layout.nodes.map((n) => [n.node.id, n.box]));
  const visibleLinks = filterVisibleLinks(layout.links, boxes, view, 64);
  const visibleNodes = layout.nodes.filter((n) => isBoxInView(n.box, view, 64));
  const branchIndex = computeBranchIndex(layout.nodes);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r(view.x)} ${r(view.y)} ${r(view.w)} ${r(view.h)}" ` +
      `width="${r(view.w)}" height="${r(view.h)}"` +
      (opts.title ? `><title>${esc(opts.title)}</title>` : '>'),
  );
  parts.push(
    `<rect x="${r(view.x)}" y="${r(view.y)}" width="${r(view.w)}" height="${r(view.h)}" fill="${esc(token.color.canvas)}"/>`,
  );

  // 连线（复用渲染侧 path 构建；不传分支色 → 默认连线色）。
  // G6′：垂直连线共享梁——与渲染侧同款分组（verticalBeamMap + 声明方向），导出形状与画布一致。
  // v1.7.0：hub（note.hub）左右组共享竖梁（horizontalBeamMap，与画布同形）+ 出线箭头
  const docRoot = layout.nodes.find((n) => n.depth === 0)?.node;
  const growDirOf = docRoot ? collectDeclaredGrowDir(docRoot) : new Map<string, GrowDir>();
  const hubOf = new Map<string, boolean>();
  const noteOf = new Map<string, EditableNode['note']>();
  const walkHub = (n: EditableNode): void => {
    hubOf.set(n.id, readHubFlag(n.note));
    noteOf.set(n.id, n.note);
    for (const c of n.children) walkHub(c);
  };
  if (docRoot) walkHub(docRoot);
  // v1.11.0：梁比例位（note.beamAt[dir]）——导出梁位与画布同源（缺省 0.5 = 中点）
  const beamAtOf = (fromId: string, dir: GrowDir, gap: number): number =>
    readBeamAt(noteOf.get(fromId), dir, gap);
  const linkGeoms: Array<LinkGeom & { dir?: GrowDir }> = [];
  for (const l of visibleLinks) {
    const from = boxes.get(l.fromId);
    const to = boxes.get(l.toId);
    if (!from || !to) continue;
    linkGeoms.push({ fromId: l.fromId, from, to, dir: growDirOf.get(l.toId) });
  }
  const beamYs = verticalBeamMap(linkGeoms, (g) => g.dir, beamAtOf);
  const beamXs = horizontalBeamMap(
    linkGeoms,
    (g) => hubOf.get(g.fromId) === true,
    (g) => g.dir,
    beamAtOf,
  );
  // 出线箭头（左入右出、上入下出）：实心三角 path——与画布/sceneBuilder 同形，无需 marker defs
  for (const g of linkGeoms) {
    const isHub = hubOf.get(g.fromId) === true;
    const p = buildLinkPath(token, g.from, g.to, undefined, {
      beamY: beamYs.get(g),
      beamX: beamXs.get(g),
      hub: isHub,
      dir: g.dir,
    });
    parts.push(
      `<path d="${esc(p.d)}" fill="none" stroke="${esc(p.stroke)}" stroke-width="${r(p.width)}"/>`,
    );
    const tip = hubArrowTip(g.from, g.to, g.dir, {
      hub: isHub,
      beamX: beamXs.get(g),
      beamY: beamYs.get(g),
    });
    if (tip !== null) {
      parts.push(`<path d="${esc(tip)}" fill="${esc(p.stroke)}" stroke="none"/>`);
    }
  }

  // G6″（A6/T23）：跨岛父子连接补线——与 MapView 渲染侧同款虚线样式（6 4 / 0.55）。
  // 按【两端点包围盒】裁剪（E8 同款教训：两端都在视口外但曲线中段穿过时不误删）。
  for (const l of opts.boundaryLinks ?? []) {
    const from = boxes.get(l.fromId);
    const to = boxes.get(l.toId);
    if (!from || !to) continue; // 端点不在布局（盒缺失）→ 跳过，不误连到原点
    const sx = Math.min(from.x, to.x);
    const sy = Math.min(from.y, to.y);
    const span = {
      x: sx,
      y: sy,
      w: Math.max(from.x + from.w, to.x + to.w) - sx,
      h: Math.max(from.y + from.h, to.y + to.h) - sy,
    };
    if (!isBoxInView(span, view, 64)) continue;
    const p = buildLinkPath(token, from, to);
    parts.push(
      `<path d="${esc(p.d)}" fill="none" stroke="${esc(p.stroke)}" stroke-width="${r(p.width)}" ` +
        `stroke-dasharray="6 4" opacity="0.55"><title>跨岛父子连接（升格中心 · parent_link: show）</title></path>`,
    );
  }

  // 节点卡（nodeCardStyle 同款主题取值；全量文本——导出不套 LOD 省略）
  for (const n of visibleNodes) {
    const palette =
      token.color.branches[branchIndex.get(n.node.id) ?? 0] ?? token.color.branches[0]!;
    const entityKind = n.node.type === 'entity' ? (n.node.ref?.kind ?? null) : null;
    // DEPTH-VIS-1：与画布同源（rank 决定卡样式、fontOf 决定字号字重）—— 导出即所见
    const style = nodeCardStyle(token, palette, visualRankOf(n.depth), entityKind);
    const { size: fontSize, weight: fontWeight } = fontOf(token, n.depth);
    const bx = n.box;
    parts.push(`<g transform="translate(${r(bx.x)} ${r(bx.y)})">`);
    parts.push(
      `<rect width="${r(bx.w)}" height="${r(bx.h)}" rx="${r(style.radius)}" fill="${esc(style.fill)}" ` +
        `stroke="${esc(style.stroke)}" stroke-width="${r(style.strokeWidth)}"/>`,
    );
    parts.push(
      `<text x="${r(bx.w / 2)}" y="${r(bx.h / 2)}" text-anchor="middle" dominant-baseline="central" ` +
        `font-family="${esc(token.font.family)}" font-size="${fontSize}" ` +
        `font-weight="${fontWeight}" fill="${esc(style.text)}">` +
        `${esc(n.node.text ?? '')}</text>`,
    );
    parts.push('</g>');
  }
  parts.push('</svg>');
  return parts.join('');
}

function r(v: number): string {
  return Math.round(v * 10) / 10 + '';
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
