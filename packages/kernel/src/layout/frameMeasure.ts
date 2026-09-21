/**
 * 框内大纲行**专用度量**（FO-C1 · 修正案 §1「框内 text = 紧凑大纲行」）。
 *
 * 为什么独立于 `nodeLayout.ts`：画布节点卡是**内容驱动**宽高（宽随最长行撑开、
 * 高含资产预览区/附属区），而框内大纲行要的是**固定内容列宽 + 自动换行 + 高度随行数**
 * 的紧凑形态。对大纲行直接复用节点卡度量（`displayMetrics` / 宿主注入的 `measure`）
 * 正是用户实测的偏差来源——行像节点卡、正文被单行 ellipsis 裁切。
 *
 * 折行**复用** `wrap.ts` 的 `wrapText`（不另写一套折行算法）：渲染（CSS 换行）与
 * 编辑态（textarea）都以本文件的产出为盒高事实源，提交后行盒与展示同口径。
 *
 * ── 常量取值理由 ───────────────────────────────────────────────────────────
 * - `FRAME_OUTLINE_CONTENT_W = 220`：固定内容列宽（**与 `TITLE_MAX_TEXT` 解耦**：
 *   后者是节点卡的内容驱动折行上限 260，两者互不影响）。取节点卡上限（260）与
 *   编辑态最小可用宽（140）之间——比节点卡窄以保「紧凑」，又不至于两三个字一行：
 *   按内核估算度量（CJK 12px / 窄字符 7px）单行 ≈ 18 个汉字或 31 个半角字符；
 *   缩进最深 2 级（36px）后仍有 ≈ 15 个汉字。
 * - `FRAME_OUTLINE_ROW_PAD_*`：行盒内边距；**折行可用宽 = 行宽 - 2×PAD_X**，
 *   渲染 padding 与编辑态内边距同源（同值不同口径会让展示/编辑折行不一致）。
 * - `FRAME_OUTLINE_PLACEHOLDER_H`：image/entity 扁占位高（1 行文本 + 内边距），
 *   不跑 `nodeLayout` 的 `ASSET_H`(96) 资产预览高。
 * - `FRAME_OUTLINE_MIN_W`：`CONTENT_W - rel×FRAME_ROW_INDENT` 的下限（深层缩进兜底）。
 * - `FRAME_OUTLINE_ROW_GAP`：行内多元素（正文/附属提示）的横向间隙（渲染 flex `gap` 同源）。
 *
 * ── 幕布注释（FO-FIX2）────────────────────────────────────────────────────
 * 行内**不再**渲染「注释 …」旁侧 chip，正文折行可用宽也**不再**为它扣列
 * （曾有的 `FRAME_OUTLINE_DESC_CHIP_W` / `hasFrameDescChip` 已删除）。
 * 幕布注释仍由既有幕布体系显示与编辑：DescBlock/附属区画在行下（高度经宿主
 * `rowAuxH → estimateDescHeight` 预留），Shift+Enter / 既有入口进 `onDescEdit`。
 */
import type { EditableNode } from '../tree/treeOps.js';
import { defaultCharMeasure, type CharMeasure } from './measure.js';
import { LINE_H } from './nodeLayout.js';
import { wrapText } from './wrap.js';

/** 大纲行缩进（每级相对深度，px） */
export const FRAME_ROW_INDENT = 18;
/**
 * 框内大纲**内容列宽**（世界 px，k=1）：固定列宽——行宽**不随**最长未折行字串撑开
 * （口径见文件头；C2 的框壳体积以本列宽为准）。
 */
export const FRAME_OUTLINE_CONTENT_W = 220;
/** 行盒左右内边距（世界 px）：折行可用宽 = 行宽 - 2×本值 */
export const FRAME_OUTLINE_ROW_PAD_X = 8;
/** 行盒上下内边距（世界 px）：text 行高 = 2×本值 + LINE_H × 行数 */
export const FRAME_OUTLINE_ROW_PAD_Y = 3;
/** image/entity 占位行高（世界 px）：扁 = 1 行文本 + 上下内边距 */
export const FRAME_OUTLINE_PLACEHOLDER_H = LINE_H + FRAME_OUTLINE_ROW_PAD_Y * 2;
/** 行最小宽度（深层缩进后仍可读/可编辑） */
export const FRAME_OUTLINE_MIN_W = 80;
/** 行内正文与附属提示类元素之间的横向间隙（渲染 flex `gap` 与本值同源） */
export const FRAME_OUTLINE_ROW_GAP = 6;

export interface FrameRowMetrics {
  /** 行宽（世界 px）= 固定内容列宽 - 缩进（同级右缘对齐） */
  w: number;
  /** 行高（世界 px）= text 行：pad×2 + LINE_H×行数；占位行：扁常量高 */
  h: number;
  /** 折行结果（text 行；占位行为空）——展示与编辑态高度的唯一事实源 */
  lines: string[];
  /** 是否扁占位行（image/entity：不跑资产预览高） */
  placeholder: boolean;
}

/** 行宽：固定内容列宽 - 缩进（相对深度收敛：非有限 → 0，负数/小数 → ≥0 整数） */
export function frameRowWidth(rel: number): number {
  const d = Number.isFinite(rel) ? Math.max(0, Math.floor(rel)) : 0;
  return Math.max(FRAME_OUTLINE_MIN_W, FRAME_OUTLINE_CONTENT_W - d * FRAME_ROW_INDENT);
}

/** 是否扁占位行（image/entity；一期只读，不改 url / ref） */
export function isFramePlaceholderRow(node: EditableNode): boolean {
  return node.type === 'image' || node.type === 'entity';
}

/**
 * 正文折行可用宽（world px）：行宽 - 左右内边距。
 *
 * FO-FIX2 起可用宽**不再依赖节点内容**（曾为行内「注释」chip 扣列，chip 已删）。
 * `_node` 参数仅为调用面稳定保留——`frame-layout.test.ts` 用「不同 node 同宽」锁这条回归，
 * 若有人把 desc 扣列加回来会先红在这里。
 */
export function frameRowTextWidth(_node: EditableNode, rel: number): number {
  return Math.max(1, frameRowWidth(rel) - FRAME_OUTLINE_ROW_PAD_X * 2);
}

/**
 * 框内大纲行度量（纯函数）：text 行按内容宽折行、高度随行数；image/entity 扁占位。
 *
 * @param textMeasure 字符度量（宿主注入 DOM 精确度量；缺省内核估算 `defaultCharMeasure`）
 */
export function frameRowMetrics(
  node: EditableNode,
  rel: number,
  textMeasure: CharMeasure = defaultCharMeasure,
): FrameRowMetrics {
  const w = frameRowWidth(rel);
  if (isFramePlaceholderRow(node)) {
    return { w, h: FRAME_OUTLINE_PLACEHOLDER_H, lines: [], placeholder: true };
  }
  const lines = wrapText(node.text ?? '', frameRowTextWidth(node, rel), textMeasure);
  return {
    w,
    h: FRAME_OUTLINE_ROW_PAD_Y * 2 + LINE_H * lines.length,
    lines,
    placeholder: false,
  };
}
