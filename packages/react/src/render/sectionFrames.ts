/**
 * Section 空间分区 · 纯几何视图模型（v1.5.0 Phase 1 · T3）。
 *
 * 与 MapView 的边界：本模块零 React、零 DOM——输入为解析后的 Section + 取盒函数，
 * 输出可直接渲染的帧模型；node 环境可测（与 sceneBuilder 同一可测性风格）。
 *
 * 几何规约：
 * - frame.bounds = 成员盒 AABB 外扩（左右下 SECTION_PADDING；上侧额外容纳标题栏）
 * - 取盒经调用方注入的 boxOf（MapView 包装 renderBoxOf）——中心拖拽预览偏移自动跟随
 * - 成员缺盒（折叠隐藏/未布局）跳过；全部缺盒 → 不产出 frame（父级折叠整岛藏起）
 * - dangling/stale → ghost（无几何，由渲染层停靠视口角落，D3 幽灵态）
 */
import { sectionColorOf } from '@mindcanvas/kernel';
import type { Box, ResolvedSection, SectionColor } from '@mindcanvas/kernel';

/** 框体外扩（左右下三侧） */
export const SECTION_PADDING = 24;
/** 标题栏高度（上侧外扩 = 标题栏 + 小间距） */
export const SECTION_TITLE_H = 28;

export interface SectionPaletteEntry {
  /** 背景填充（低透明度） */
  fill: string;
  /** 描边（中透明度） */
  stroke: string;
  /** 色点/徽标实色 */
  chip: string;
}

/** 六色 token → 渲染色值（KIND_META 同款 hex 惯例） */
export const SECTION_PALETTE: Record<SectionColor, SectionPaletteEntry> = {
  blue: { fill: 'rgba(59,130,246,0.08)', stroke: 'rgba(59,130,246,0.45)', chip: '#3b82f6' },
  amber: { fill: 'rgba(217,119,6,0.10)', stroke: 'rgba(217,119,6,0.45)', chip: '#d97706' },
  green: { fill: 'rgba(47,158,68,0.08)', stroke: 'rgba(47,158,68,0.45)', chip: '#2f9e44' },
  violet: { fill: 'rgba(103,65,217,0.08)', stroke: 'rgba(103,65,217,0.45)', chip: '#6741d9' },
  rose: { fill: 'rgba(230,73,128,0.08)', stroke: 'rgba(230,73,128,0.45)', chip: '#e64980' },
  slate: { fill: 'rgba(100,116,139,0.08)', stroke: 'rgba(100,116,139,0.45)', chip: '#64748b' },
};

/** 正常帧（well-formed）：AABB + 标题栏 + 成员计数 + 折叠态 */
export interface SectionFrame {
  kind: 'frame';
  id: string;
  /** 子树根（= center id，D1）——折叠/拖拽挂点 */
  rootId: string;
  title: string;
  color: SectionColor;
  /** 世界坐标：成员 AABB 外扩后的框体 */
  bounds: Box;
  /** 子树成员总数（含折叠隐藏者；折叠时徽标显示 +N） */
  memberCount: number;
  collapsed: boolean;
}

/** 幽灵帧（dangling/stale）：无几何，数据无损待清理（D3） */
export interface SectionGhost {
  kind: 'ghost';
  id: string;
  title: string;
  color: SectionColor;
  state: 'dangling' | 'stale';
  reason?: string;
}

export type SectionView = SectionFrame | SectionGhost;

export interface BuildSectionViewsArgs {
  resolved: readonly ResolvedSection[];
  /** root 节点标题（spec.title 缺省时回退） */
  titleOf: (rootId: string) => string;
  /** 子树成员 id 清单（岛成员优先，内容树子树兜底；含折叠隐藏者） */
  memberIdsOf: (rootId: string) => readonly string[];
  /** 预览感知取盒（MapView 的 renderBoxOf 包装）；无盒 → 该成员不参与 AABB */
  boxOf: (nodeId: string) => Box | undefined;
  collapsedIds: ReadonlySet<string>;
  padding?: number;
}

export function buildSectionViews(args: BuildSectionViewsArgs): SectionView[] {
  const pad = args.padding ?? SECTION_PADDING;
  const topPad = SECTION_TITLE_H + 6;
  const out: SectionView[] = [];
  for (const r of args.resolved) {
    const color = sectionColorOf(r.spec);
    const title = r.spec.title ?? (r.rootId !== undefined ? args.titleOf(r.rootId) : r.spec.id);
    if (r.state !== 'well-formed' || r.rootId === undefined) {
      out.push({
        kind: 'ghost',
        id: r.spec.id,
        title,
        color,
        state: r.state === 'stale' ? 'stale' : 'dangling',
        ...(r.reason !== undefined ? { reason: r.reason } : {}),
      });
      continue;
    }
    const memberIds = args.memberIdsOf(r.rootId);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let found = 0;
    for (const id of memberIds) {
      const b = args.boxOf(id);
      if (!b) continue;
      found++;
      if (b.x < minX) minX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.x + b.w > maxX) maxX = b.x + b.w;
      if (b.y + b.h > maxY) maxY = b.y + b.h;
    }
    // 成员全部不可见（父级折叠把整岛藏起/未布局）→ 不画框（诊断仍由 kernel 层产出）
    if (found === 0) continue;
    out.push({
      kind: 'frame',
      id: r.spec.id,
      rootId: r.rootId,
      title,
      color,
      bounds: {
        x: minX - pad,
        y: minY - topPad,
        w: maxX - minX + pad * 2,
        h: maxY - minY + topPad + pad,
      },
      memberCount: memberIds.length,
      collapsed: args.collapsedIds.has(r.rootId),
    });
  }
  return out;
}
