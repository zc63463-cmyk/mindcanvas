import { noteOf } from '@mindcanvas/kernel';
import type { Box } from '@mindcanvas/kernel';
import { nodeAuxiliaryRegions } from './nodeAuxiliary.js';
import { FIXED_NOTE_GAP } from '../chrome/NoteGrowthPanel.js';

/**
 * note 在**缩放维度**上的显示分级（与 geometry.ts 的 LodLevel 是两套东西：
 * LodLevel 管的是「文本/命中区等几何细节」，这里管的是「note 相关 DOM 生不生成」）。
 *
 * - full    (k ≥ 0.65)  ：固定卡片完整渲染 + 悬停浮窗
 * - badge   (0.35~0.65)：固定卡片不生成，只留节点角标；悬停仍以**屏幕浮窗**预览
 * - none    (k < 0.35)  ：note 相关 DOM 全部不生成（鸟瞰视图，剔除视觉噪点）
 */
export type NoteLod = 'full' | 'badge' | 'none';

/** 完整渲染固定 note 卡片的最小缩放 */
export const NOTE_LOD_FULL_K = 0.65;
/** 保留角标（仍可悬停预览）的最小缩放；低于此值 note DOM 全剔除 */
export const NOTE_LOD_BADGE_K = 0.35;

/**
 * 按视口缩放判定 note 显示档位。
 *
 * 非有限值 / 非正值（初始化瞬间的脏值）按 full 处理 —— 退化为改动前的旧行为，
 * 不会因为一帧的脏 k 把用户已固定的 note 卡片整体藏起来。
 */
export function noteLodFor(k: number): NoteLod {
  if (!Number.isFinite(k) || k <= 0) return 'full';
  if (k >= NOTE_LOD_FULL_K) return 'full';
  if (k >= NOTE_LOD_BADGE_K) return 'badge';
  return 'none';
}

export interface FixedNotePanelData {
  id: string;
  data: ReturnType<typeof noteOf>;
  editing: boolean;
  /** 屏幕坐标（面板左上角） */
  x: number;
  y: number;
  /**
   * 世界坐标基线宽度（k=1）。
   *
   * 渲染侧在 k=1 下完成排版，再由外层 `transform: scale(k)` 统一缩放 —— 而不是把
   * 每个字号/内边距逐帧乘 k。这样滚轮时只有一处 transform 变化（走合成器），
   * 也避开浏览器最小字号限制（12px 截断）导致的文字撑爆容器。
   */
  worldWidth: number;
  /** 世界坐标基线高度（k=1），同 worldWidth */
  worldHeight: number;
  /** 生成这份数据时的视口缩放（渲染侧据此做 transform 与最小尺寸保护） */
  k: number;
  /**
   * 节点层级（上层据此取节点正文字号 —— 笔记字号不得大于所属节点字号）。
   * 缺省 0：无层级信息的调用方按分支字号处理。
   */
  depth: number;
  /**
   * P1：背面 markdown 源文（`node.note.md` 透传；未知类型/缺省 → ''）。
   * 只承载数据、不做解析——渲染在 chrome/CardBackMarkdown。
   */
  md: string;
}

interface LayoutNodeLike {
  node: { id: string; note?: unknown };
  box: Box;
  depth?: number;
}

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** P1：`note.md` 读取（未知类型容忍：非字符串/缺省 → ''，不抛不诊断） */
function noteMdOf(node: { note?: unknown }): string {
  const note = node.note;
  if (note === null || typeof note !== 'object') return '';
  if (!('md' in note)) return '';
  const md = note.md;
  return typeof md === 'string' ? md : '';
}

/**
 * 固定 note 笔记仅为视口内节点生成 HTML 面板。
 * 一次扫描建立 id 索引，避免每个固定项重新遍历全量 layout.nodes。
 *
 * 只产出几何，不做 LOD 判断 —— 是否生成由上层按 `noteLodFor(k)` 决定
 * （上层在 badge/none 档位直接不调用本函数，避免无谓扫描）。
 */
export function fixedNotePanelsOf<T extends LayoutNodeLike>(
  layout: { nodes: readonly T[] },
  fixedIds: ReadonlySet<string>,
  editingIds: ReadonlySet<string>,
  visibleWorld: Box,
  transform: { k: number; x: number; y: number },
  fixedNoteHeight: number,
): FixedNotePanelData[] {
  if (fixedIds.size === 0) return [];
  const nodesById = new Map<string, T>();
  for (const node of layout.nodes) nodesById.set(node.node.id, node);

  const panels: FixedNotePanelData[] = [];
  for (const id of fixedIds) {
    const ln = nodesById.get(id);
    // 初次挂载时 ResizeObserver 尚未给出容器尺寸；此时不裁剪，避免固定面板首帧消失。
    const hasViewportSize = visibleWorld.w > 0 && visibleWorld.h > 0;
    if (!ln || (hasViewportSize && !intersects(ln.box, visibleWorld))) continue;
    const region = nodeAuxiliaryRegions(ln.box.h, { fixedNoteHeight }).fixedNote;
    if (!region) continue;
    panels.push({
      id,
      data: noteOf(ln.node as never),
      editing: editingIds.has(id),
      x: ln.box.x * transform.k + transform.x,
      y: (ln.box.y + region.y + Math.min(FIXED_NOTE_GAP, region.h)) * transform.k + transform.y,
      worldWidth: ln.box.w,
      worldHeight: Math.max(0, region.h - FIXED_NOTE_GAP),
      k: transform.k,
      depth: ln.depth ?? 0,
      md: noteMdOf(ln.node),
    });
  }
  return panels;
}
