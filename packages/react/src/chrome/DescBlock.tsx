/**
 * DescBlock —— 幕布风格「描述」块（v1.3.0）。
 *
 * 语义（对齐幕布官方 mubu.com/help/20）：描述是对某一主题的**解释和说明**，
 * 显示在节点下方，纯文本，支持自动收缩（默认一行 / 点击展开全文）。
 * 与 GrowthCommentPanel（快速注释 qa：点击展开的多条目列表）是**两套并存**的机制。
 *
 * 视觉：引用块形态——左侧竖线 + 缩进 + 小字号 + 弱化色（与节点本体区分层级）。
 *
 * 缩放一致性：所有尺寸/字号 × scale，与 SVG 节点盒严格对齐（参考 GrowthCommentPanel 纪律）。
 *
 * 编辑：Shift+Enter 进入（上层快捷键分发）；textarea 内 Enter 换行、
 *      Shift+Enter 提交并返回主题、Esc 取消、blur 提交；空文本 = 删除描述。
 */
import { useEffect, useRef, useState } from 'react';
import type { EditableNode } from '@mindcanvas/kernel';
import { useCompositionCommitGuard } from '../edit/compositionGuard.js';
import { useDraftSession } from '../edit/draftSessions.js';
import { CHROME } from '../theme/tokens.js';
import type { TokenSet } from '../theme/types.js';
import { TextLinkSpans } from './TextLinkSpans.js';

export interface DescBlockProps {
  /** 描述文本（多行以 \n 分隔） */
  text: string;
  /** 是否处于编辑态（textarea 覆盖） */
  editing?: boolean;
  /**
   * 是否按完整内容渲染（true = 换行完整显示）。描述区现在**始终**显示，
   * 这个开关仅用于区分"渲染区"与"编辑区（textarea 单行）"，不再表示展开状态。
   */
  expanded?: boolean;
  token: TokenSet;
  /** 屏幕坐标（描述区左上角，由上层按节点 + 本体高换算） */
  x: number;
  y: number;
  width: number;
  /** 描述区高度（由 estimateDescHeight 决定，屏幕 px） */
  height: number;
  /** 视口缩放 k（内容随地图缩放，与 SVG 对齐；缺省 1） */
  scale?: number;
  /**
   * 节点层级（决定描述区字号 / 行高）：≥2 视为叶子，用小一号。
   * 缺省 0 —— 保持旧调用点（只渲染、不参与 measure 的场景）行为不变。
   */
  depth?: number;
  /**
   * 浮出**视觉**（实体背景 + 圆角 + 阴影 + 高层级），让描述区看起来是一张浮起的卡片。
   *
   * ⚠️ 这是**视觉开关，不是布局语义** —— 上层在两种场景下会打开它：
   *   ① 没有预留高度的新建编辑：真·浮出，不占布局，代价是遮挡邻居
   *   ② 节点放大展开：measure **已**为该节点加高（占布局、挤压相邻节点），
   *      只是沿用浮出卡片的外观 —— 卡片画在预留出来的那块空间里。
   * 所以不要看到 floating 就以为它不影响布局，有没有预留高度由上层决定。
   */
  floating?: boolean;
  /** 点击描述区 → 切换展开/收缩 */
  onToggle?: () => void;
  /** 提交文本（空串 = 删除描述） */
  onCommit?: (text: string) => void;
  /** 取消编辑 */
  onCancel?: () => void;
  /** L1：三态解析用树（缺省 → 链接只做语法渲染，data-link-state=unknown） */
  root?: EditableNode;
  /** L1：链接跳转回调（缺省 → 链接只渲染不可点） */
  onJumpToAnchor?: (anchor: string) => void;
}

/** 描述区行高（世界 px，k=1）—— 不随层级差分（理由见 descFontSize 注释） */
export const DESC_LINE_H = 15;
/**
 * 描述区字号（世界 px，k=1）—— 随层级差分，与节点本体的 size / sizeLeaf 同向。
 *
 * 此前统一硬编码 10，导致根节点与叶子节点的描述字号一模一样、缺少视觉层级
 * （friction-log #2）。注释整体比正文小一档，避免喧宾夺主。
 *
 * ⚠️ **只差分字号，不差分行高**：布局 measure（createDescMeasure）只拿得到
 * EditableNode —— 它没有 depth 字段，measure 无法按层级算高度。
 * 若行高随 depth 变而 measure 不变，节点盒预留高度就会与描述区实际高度错位。
 * 故行高恒为 DESC_LINE_H，层级差异只体现在字号（叶子字小、行距略松，无错位风险）。
 */
export const DESC_FONT_SIZE = 10;
export const DESC_FONT_SIZE_LEAF = 8.5;

/** 按层级取描述区字号：根/分支 10，叶子 8.5 */
export function descFontSize(depth: number): number {
  return depth >= 2 ? DESC_FONT_SIZE_LEAF : DESC_FONT_SIZE;
}
/** 描述区上下内边距 */
export const DESC_PAD = 5;
/** 左侧引用竖线宽度 */
export const DESC_BAR_W = 2;
/** 竖线后的文字缩进 */
export const DESC_INDENT = 8;
/**
 * 展开态最多显示行数（超出内置滚动，不丢内容）。
 *
 * 2026-09-03 friction-log #1（用户反馈「注释内容会被裁剪」）：原值 6 太紧，
 * 稍长的描述就要靠滚动才能看全，观感上等同于被裁掉。放宽到 12 —— 覆盖绝大多数
 * 描述长度；仍超出的走内置滚动（overflowY: auto），内容不丢失。
 * 继续加大会让展开态节点过高、挤压相邻布局，故取 12 而非不限。
 */
/**
 * 描述区行数**软上限**（2026-09-04 简化）。
 *
 * 设计（用户拍板）：幕布注释回归**节点盒内部**，内容完整换行显示，
 * 篇幅超过这个上限后由描述区**内部滚动** —— 不再有展开/收起状态，
 * 也不再有"点击节点放大展开"的附属块。
 *
 * 好处：节点高度可预测（不会因一篇长注释吃掉半个画布），
 * 内容也永远完整可见（滚动即可），且不需要维护任何展开状态集合。
 *
 * 历史：这里曾经有 DESC_MAX_LINES(12) + DESC_EXPAND_MAX_LINES(16/40) 两套上限
 * 配合展开态使用，正是状态组合复杂导致了一系列几何问题。现在只剩一个。
 */
export const DESC_SOFT_MAX_LINES = 16;
/**
 * 编辑态预留行数（交互时序关键常量）：进入编辑时**立即**分配这块高度，再让用户键入。
 *
 * 背景（用户反馈）：原实现按 text 内容反推高度 → 编辑态 text 仍为空 → 只给 1 行，
 * 用户开始打字时输入框是折叠的，看不见自己在打什么。正确时序应是「先变大 → 再键入 → 空则回退**：
 *   ① 进入编辑 → measure 预留 DESC_EDIT_MIN_LINES 行高度（节点"先生长一行"）
 *   ② 用户键入 → 高度已在，输入过程始终可见
 *   ③ 无内容提交/取消 → 上层回退到非编辑态高度（收缩一行）
 * 布局 measure 与 overlay 必须共用同一函数且都传入 editing 标志，否则节点本体与描述区会错位。

 */
export const DESC_EDIT_MIN_LINES = 1; // 编辑态预留一行（同 collapsed 高度，避免"键入后才变大"）

/**
 * 编辑态描述区的最小宽度。
 *
 * 进入编辑时 desc 通常为空 → 按内容算宽得 0 → 节点盒宽度只剩标题宽度，
 * 输入框窄得没法打字。故编辑态兜一个最小宽度，让编辑区可用。
 */
export const DESC_EDIT_MIN_W = 140;

/**
 * 描述区高度估算（布局 measure 与 overlay 共用，必须一致）。
 *
 * 描述区**始终显示**（无展开态），高度 = min(内容行数, 软上限) 行。
 * 超过软上限的部分不撑高节点，由描述区内部滚动。
 *
 * @param editing 编辑态时直接返回预留高度 —— 编辑态的占位必须在内容输入**之前**
 *   就存在，否则会出现"键入后才变大、打字时看不见"（见 DESC_EDIT_MIN_LINES 注释）。
 *
 * ⚠️ 不要引入 depth 差分：布局 measure（createDescMeasure）拿不到 depth
 * （EditableNode 无该字段），按层级算高会与 measure 预留的高度错位。
 */
export function estimateDescHeight(text: string, editing = false): number {
  // 编辑态：立即预留固定编辑空间（先变大再键入）
  if (editing) return DESC_EDIT_MIN_LINES * DESC_LINE_H + DESC_PAD * 2;
  if (text === '') return 0;
  // 性能：字符计数替代 split('\n')，数到上限即提前退出（避免为超长描述建临时数组）
  const lines = countLines(text, DESC_SOFT_MAX_LINES);
  return lines * DESC_LINE_H + DESC_PAD * 2;
}

/**
 * 描述区需要的宽度（最长一行 + 内边距 + 引用竖线与缩进）。
 *
 * 幕布语义：描述是**轻量单行文本**，**不自动折行** —— 长了就把节点盒横向撑开，
 * 只有用户显式输入 `\n` 才换到第二行（这就是「一般撑长，除非主动换行」）。
 * 故宽度取**最长的一行**，而不是按节点宽度折行后的高度。
 */
export function estimateDescWidth(text: string, char: (s: string) => number): number {
  if (text === '') return 0;
  let max = 0;
  for (const line of text.split('\n')) {
    const w = char(line);
    if (w > max) max = w;
  }
  return max + DESC_PAD * 2 + DESC_BAR_W + DESC_INDENT;
}

/** 数换行符个数（=行数-1），最多数到 cap 行即提前退出（性能：不扫描全文、不建数组） */
function countLines(text: string, cap: number): number {
  if (text === '') return 1;
  let lines = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      lines++;
      if (lines >= cap) return cap;
    }
  }
  return lines;
}

export function DescBlock({
  text,
  editing = false,
  expanded = true,
  token,
  x,
  y,
  width,
  height,
  scale = 1,
  depth = 0,
  floating = false,
  onToggle,
  onCommit,
  onCancel,
  root,
  onJumpToAnchor,
}: DescBlockProps) {
  const s = scale;
  const [draft, setDraft] = useState(text);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // 进入编辑态：同步草稿并聚焦（光标移到末尾）
  useEffect(() => {
    if (editing) {
      setDraft(text);
      const ta = taRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    }
  }, [editing, text]);

  // MG-R1-B：组合未结束时不得提交未确认候选串；结束用确认文字补提交
  const { onCompositionStart, onCompositionEnd, allowCommit } = useCompositionCommitGuard(
    (next) => {
      onCommit?.(next.trim());
    },
  );

  const commit = (): void => {
    if (!allowCommit()) return;
    onCommit?.(draftRef.current.trim());
  };

  // MG-R4：编辑态草稿的 pending/flush 通道（编辑中被卸载/隐藏时也能被提交与检出）
  useDraftSession(() => ({
    hasPending: () => editing && draftRef.current.trim() !== textRef.current,
    commit: () => {
      onCommit?.(draftRef.current.trim());
    },
  }));

  if (!editing && text === '') return null;

  const pad = DESC_PAD * s;
  const barW = DESC_BAR_W * s;
  const indent = DESC_INDENT * s;
  // 字号随层级差分（friction-log #2）：根/分支 10、叶子 8.5。
  // 行高恒为 DESC_LINE_H —— 与 estimateDescHeight 的预留高度严格同口径，避免错位。
  const fontSize = descFontSize(depth) * s;
  const lineH = DESC_LINE_H * s;
  const barColor = token.color.linkStroke ?? CHROME.panelBorder;

  return (
    <div
      data-desc-block
      data-desc-expanded={expanded ? 'true' : 'false'}
      data-desc-editing={editing ? 'true' : 'false'}
      data-desc-floating={floating ? 'true' : 'false'}
      onClick={(e) => {
        e.stopPropagation();
        if (!editing) onToggle?.();
      }}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        height,
        boxSizing: 'border-box',
        padding: `${pad}px ${pad}px ${pad}px ${pad + barW + indent}px`,
        fontFamily: CHROME.fontFamily,
        overflow: 'hidden',
        cursor: editing ? 'text' : 'pointer',
        pointerEvents: 'auto',
        userSelect: editing ? 'text' : 'none',
        // 浮出模式（无预留高度的新建编辑）：加实体背景 + 圆角 + 阴影 + 高层级，
        // 确保覆盖相邻节点内容时依然清晰可读（不占布局 → 零重排的代价是视觉遮挡）。
        ...(floating
          ? {
              background: CHROME.panelBg ?? 'rgba(20,22,28,.97)',
              borderRadius: 6 * s,
              zIndex: 60,
              border: `1px solid ${token.color.linkStroke ?? CHROME.panelBorder}`,
            }
          : null),
      }}
      title={editing ? undefined : expanded ? '点击收起描述' : '点击展开全文描述'}
    >
      {/* 左侧引用竖线（引用块视觉核心） */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: pad,
          top: pad,
          bottom: pad,
          width: barW,
          background: barColor,
          borderRadius: barW / 2,
          opacity: 0.75,
        }}
      />
      {editing ? (
        <textarea
          ref={taRef}
          data-desc-input
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={(e) => onCompositionEnd(e.currentTarget.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && e.shiftKey) {
              // Shift+Enter：提交并返回主题（幕布「切换主题与描述」语义）
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancel?.();
            }
          }}
          onBlur={commit}
          placeholder="输入描述…（Shift+Enter 完成，Enter 换行）"
          // 关键（mubu 深度反馈）：编辑态强制 textarea 视觉单行——「打字时折叠」。
          // 内部 value 仍可装多行（按 Enter 输入 \n），但视觉只显示一行（nowrap + ellipsis + overflow:hidden），
          // 防止键入后输入框撑高造成 measure 重算抖动（"键入后才变大"反模式）。
          style={
            {
              width: '100%',
              height: '100%',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: CHROME.text,
              fontFamily: CHROME.fontFamily,
              fontSize,
              // 固定像素行高：与 estimateDescHeight 的预留高度严格一致，
              // 不随字号变（否则叶子会留白、与 measure 错位）
              lineHeight: `${lineH}px`,
              resize: 'none',
              padding: 0,
              margin: 0,
              display: 'block',
              whiteSpace: 'pre',
              textOverflow: 'ellipsis',
              overflow: 'hidden',
            } as React.CSSProperties
          }
        />
      ) : (
        <div
          data-desc-text
          style={{
            // 轻量文本：字号比节点正文小（随层级差分，见 descFontSize）
            fontSize,
            // 固定像素行高：与布局预留高度严格一致
            lineHeight: `${lineH}px`,
            color: CHROME.textMuted,
            // pre = 保留显式换行、但**不自动折行** —— 长了横向撑开节点盒，
            // 与幕布一致（自动折行会让短描述也占好几行，把树撑得稀疏）。
            whiteSpace: 'pre',
            overflow: 'auto',
            textOverflow: 'ellipsis',
            maxHeight: '100%',
            // 展开态超出行数上限时内置滚动（内容不丢，节点高度可控）
            overflowY: expanded ? 'auto' : 'hidden',
            // 让滚动条细但可辨识 —— 否则内容溢出时没有任何提示，
            // 用户会以为"就这些了"，其实是下面还有。
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(140,140,140,.5) transparent',
          }}
        >
          {/* L1：只读态行内链接（编辑态 textarea 分支不动；无链接时直出原文） */}
          <TextLinkSpans text={text} root={root} onJumpToAnchor={onJumpToAnchor} token={token} />
        </div>
      )}
    </div>
  );
}
