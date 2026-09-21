/**
 * note 浮窗的尺寸/字号口径（自 NotePopover 抽出，守其 600 行线；语义与抽出前逐字一致）。
 *
 * 为什么单列：这些是**纯函数 + 常量**（无状态、无 DOM），被浮窗定位、面板档位与
 * 高度估算共用；留在 NotePopover 里会让那个文件持续膨胀。
 * NotePopover 仍原样再导出这些符号，外部导入路径不变。
 */
import { CHROME } from '../theme/tokens.js';

/** 单个区域的最大高度（超出内部滚动，浮窗整体不被撑爆） */
export const REGION_MAX_H = 160;

/** 节点宽度未知时的兜底宽度（屏幕 px） */
export const FLOATING_NOTE_W = 260;
/**
 * 悬浮预览的最小宽度：宽度**对齐节点**，只有节点窄到装不下文字时才兜到这里。
 * 再窄中文会一字一行，等同于被"压成细条"。
 */
export const FLOATING_NOTE_MIN_W = 120;
/** 悬浮预览与视口边缘的安全间距 */
export const FLOATING_NOTE_MARGIN = 10;
/** 悬浮预览与节点之间的间距 */
export const FLOATING_NOTE_GAP = 8;
/** 悬浮预览整体高度上限（超出内部滚动，不遮全屏） */
export const FLOATING_NOTE_MAX_H = 320;
/** 视口尺寸可信下限：小于它视为"尚未观测"，不做边界钳制/翻转 */
export const MIN_KNOWN_VIEWPORT = 50;
/** 嵌入卡片的最小基线宽/高（世界 px）—— 极小缩放下防止渲染溃缩成一条线 */
export const EMBEDDED_NOTE_MIN_W = 120;
export const EMBEDDED_NOTE_MIN_H = 72;
/**
 * note 正文字号上限（= chrome 小字号）—— 笔记是节点的附注，视觉上不能盖过节点正文。
 */
export const NOTE_FONT_MAX = CHROME.fontSizeSmall;
/**
 * note 正文字号下限（可读底线）。
 *
 * 字号取 min(上限, 所属节点字号)；但小缩放下节点自身在屏幕上只有几 px（本来就已不可读），
 * 此时若严格跟随就没人看得清笔记 —— 兜到这个下限。也就是说：
 * 只有在「节点字号本身已经小到读不了」时，笔记字号才会反过来大于节点字号。
 */
export const NOTE_FONT_MIN = 9;
/**
 * 编辑态浮窗最小高度：**先给足空间再键入**（与 DescBlock 的 DESC_EDIT_MIN_LINES
 * 同一交互纪律）——矮面板里打两行就看不见自己在写什么。
 */
export const EDITING_NOTE_MIN_H = 300;
/** 编辑态浮窗高度上限（视口再大也不遮全屏，超出由区域内部滚动） */
export const EDITING_NOTE_MAX_H = 460;
/**
 * 编辑态浮窗最小宽度：宽度平时对齐节点，但节点太窄时（比如 120px 的叶子）
 * 编辑框里连半句话都放不下 —— 编辑是可用性优先的场景，兜到这个宽度。
 */
export const EDITING_NOTE_MIN_W = 320;

/**
 * 悬浮预览宽度：**与节点长度对齐**（`nodeWidth` = 节点屏幕宽），
 * 只有节点窄到装不下内容时才兜到 `FLOATING_NOTE_MIN_W`；最后不超出视口。
 *
 * 不固定 260 的原因：固定值会让窄节点的浮窗明显比节点宽一大截，视觉上"飘"在节点外。
 */
export function floatingNoteWidth(nodeWidth: number, viewportW: number): number {
  const base = nodeWidth > 0 ? nodeWidth : FLOATING_NOTE_W;
  const w = Math.max(base, FLOATING_NOTE_MIN_W);
  if (viewportW > MIN_KNOWN_VIEWPORT) {
    return Math.max(FLOATING_NOTE_MIN_W, Math.min(w, viewportW - FLOATING_NOTE_MARGIN * 2));
  }
  return w;
}

/** 笔记字号：不大于所属节点字号，但不低于可读底线 */
export function noteFontSizeOf(nodeFontSize: number | undefined): number {
  if (nodeFontSize === undefined || !Number.isFinite(nodeFontSize)) return NOTE_FONT_MAX;
  return Math.min(NOTE_FONT_MAX, Math.max(NOTE_FONT_MIN, nodeFontSize));
}

/**
 * 悬浮浮窗的内容高度估算（翻转判定的输入；不要求精确，够做方向决策即可）。
 */
export function estimateFloatingNoteHeight(
  seq: readonly string[],
  text: string,
  width: number,
): number {
  const charsPerLine = Math.max(8, Math.floor(width / 12));
  const textLines = Math.max(1, Math.ceil(text.length / charsPerLine));
  const seqH = seq.length === 0 ? 0 : Math.min(REGION_MAX_H, 22 + seq.length * 22);
  const textH = Math.min(REGION_MAX_H, 22 + textLines * 20);
  return Math.min(FLOATING_NOTE_MAX_H, 40 + seqH + (seqH > 0 ? 8 : 0) + textH);
}
