/**
 * note 笔记浮窗（v1.4.0）—— 取代「快速注释向下生长展开」。
 *
 * 一个浮窗，两个区域：
 *   ① 序列区域：`note`（条目列表，取代 qa），可增删改
 *   ② 纯文本区域：`note_text`（一整段），textarea 编辑
 * 两者**共存**于同一浮窗，不是二选一的类型；各自内部滚动，都不占节点空间。
 *
 * 两种呈现模式（缩放适配，2026-09-09）：
 *   - `floating`（屏幕空间 HUD）：宽度固定为最佳可读宽（260，按视口收窄），
 *     字号/内边距**恒定屏幕像素**，绝不乘 `transform.k`；空间不足时翻转到节点上方。
 *     悬停预览、以及小缩放下的编辑态都走这条 —— 保证 k=0.2 也能读、IME 选词框不漂。
 *   - `embedded`（世界空间卡片）：与节点盒严格贴合。在 **k=1 基线**下排版，
 *     由外层 `transform: scale(k)` 统一驱动缩放 —— 每帧只变一处 transform（走合成器），
 *     不再逐像素改嵌套字号，也绕开浏览器最小字号（12px）截断导致的文字撑爆容器。
 *
 * 关于 textarea：使用**非受控**（`defaultValue`），不持 `useState` 草稿。
 * 之前的"受控 + useEffect 同步外部文本"会让 textarea 实例在每次 props 变化时重建、
 * 焦点丢失 → 用户体验是"点击就消失"。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { EditableNode } from '@mindcanvas/kernel';
import { preferredLinkAnchor } from '../edit/textLinks.js';
import { CHROME } from '../theme/tokens.js';
import type { TokenSet } from '../theme/types.js';
import { useCompositionCommitGuard } from '../edit/compositionGuard.js';
import { useDraftSession } from '../edit/draftSessions.js';
import { collectNodeChoices } from './edgeEditorShared.js';
import { EdgeAnchorPicker } from './EdgeAnchorPicker.js';
import {
  EMBEDDED_NOTE_MIN_H,
  EMBEDDED_NOTE_MIN_W,
  EDITING_NOTE_MAX_H,
  EDITING_NOTE_MIN_H,
  EDITING_NOTE_MIN_W,
  FLOATING_NOTE_GAP,
  FLOATING_NOTE_MARGIN,
  FLOATING_NOTE_MAX_H,
  FLOATING_NOTE_MIN_W,
  FLOATING_NOTE_W,
  MIN_KNOWN_VIEWPORT,
  NOTE_FONT_MAX,
  REGION_MAX_H,
  estimateFloatingNoteHeight,
  floatingNoteWidth,
  noteFontSizeOf,
} from './noteSizing.js';
import { MdEditButton, NoteBody } from './NoteBackEditor.js';
import { QaEditor } from './QaEditor.js';
import { TextLinkSpans } from './TextLinkSpans.js';

// 尺寸/字号口径（纯函数 + 常量）已抽到 noteSizing：这里**原样再导出**，外部导入路径不变
export {
  EDITING_NOTE_MAX_H,
  EDITING_NOTE_MIN_H,
  EDITING_NOTE_MIN_W,
  EMBEDDED_NOTE_MIN_H,
  EMBEDDED_NOTE_MIN_W,
  FLOATING_NOTE_GAP,
  FLOATING_NOTE_MARGIN,
  FLOATING_NOTE_MAX_H,
  FLOATING_NOTE_MIN_W,
  FLOATING_NOTE_W,
  NOTE_FONT_MAX,
  NOTE_FONT_MIN,
  estimateFloatingNoteHeight,
  floatingNoteWidth,
  noteFontSizeOf,
} from './noteSizing.js';
/** 编辑态正文输入框的最小高度 */
const EDITING_TEXTAREA_MIN_H = 110;

export type NotePopoverMode = 'floating' | 'embedded';

export interface NotePopoverProps {
  /** 序列区域条目 */
  seq: readonly string[];
  /** 纯文本区域内容 */
  text: string;
  /** 屏幕坐标（floating：节点下方锚点左上角；embedded：卡片左上角） */
  x: number;
  y: number;
  /**
   * embedded 模式的**世界基线宽**（k=1，非屏幕 px）—— 由外层 scale(k) 缩放。
   * floating 模式忽略本值，宽度恒为 `floatingNoteWidth(viewportW)`。
   */
  width?: number;
  /** embedded 模式的**世界基线高**（k=1）；floating 不传 → 按内容自适应 */
  height?: number;
  /**
   * 所属节点在**屏幕**上的宽度（floating 模式据此对齐节点长度）。
   * 不传时退回兜底宽度 `FLOATING_NOTE_W`。
   */
  nodeWidth?: number;
  /**
   * 所属节点的字号（floating 传**屏幕**字号 = 世界字号 × k；embedded 传世界字号）。
   * 笔记字号取 `min(NOTE_FONT_MAX, 该值)` —— 保证**不大于**节点内部字体。
   */
  nodeFontSize?: number;
  /** 呈现模式，缺省 floating（屏幕空间） */
  mode?: NotePopoverMode;
  /** 当前视口缩放 k（embedded 用于 transform；editing 用于判定是否升级为浮窗） */
  scale?: number;
  /** 节点顶边的屏幕 y（floating 翻转判定用；不传则不翻转） */
  anchorTop?: number;
  /** 视口尺寸（floating 边界钳制/翻转用；不传则不做钳制） */
  viewportW?: number;
  viewportH?: number;
  /** 是否固定显示（固定不等于编辑） */
  pinned: boolean;
  /** 是否进入编辑态（仅右键「编辑 note笔记」进入） */
  editing?: boolean;
  token: TokenSet;
  onChangeSeq: (seq: string[]) => void;
  onChangeText: (text: string) => void;
  onClose: () => void;
  /** 预览态点击浮窗后固定 */
  onPin?: () => void;
  /** L1：三态解析用树（缺省 → 链接只做语法渲染） */
  root?: EditableNode;
  /** L1：链接跳转回调（缺省 → 链接只渲染不可点） */
  onJumpToAnchor?: (anchor: string) => void;
  /** P1：背面 markdown 源文（`note.md` 透传；空/缺省 → 无翻面入口）。P1-T1：受控翻面 flipped（缺省 = 内部自持）/ 回传 onFlipChange */
  md?: string;
  flipped?: boolean;
  onFlipChange?: (next: boolean) => void;
  /** P2：背面源文提交（失焦 / Shift+Enter 上抛原文；空文本 → 删 md 键由写回链映射） */
  onChangeMd?: (md: string) => void;
}

export function NotePopover({
  seq,
  text,
  x,
  y,
  width = 260,
  height,
  nodeWidth,
  nodeFontSize,
  mode = 'floating',
  scale = 1,
  anchorTop,
  viewportW,
  viewportH,
  pinned,
  editing = false,
  token,
  onChangeSeq,
  onChangeText,
  onClose,
  onPin,
  root,
  onJumpToAnchor,
  md, flipped, onFlipChange, onChangeMd,
}: NotePopoverProps) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // L3：插入链接（复用 EdgeAnchorPicker；textarea 光标处插入，T-A7 目标有 cid 优先写 cid:）
  const [picker, setPicker] = useState(false);
  const pickerRangeRef = useRef<{ start: number; end: number } | null>(null);
  // P1-T1：翻面态 —— 受控（flipped 传入即宿主持态）或非受控（缺省回退内部 state）；不落盘
  const [selfFlipped, setSelfFlipped] = useState(false);
  const isFlipped = flipped ?? selfFlipped;
  const setFlip = (next: boolean): void => { if (flipped === undefined) setSelfFlipped(next); onFlipChange?.(next); };
  const [mdEditing, setMdEditing] = useState(false); // P2：md 编辑会话态（不落盘；编辑面=背面替代视图）
  // 预览态（editing=false）零开销：不做全树候选收集
  const choices = useMemo(
    () => (editing && root ? collectNodeChoices(root) : []),
    [editing, root],
  );

  /** L3：记录 textarea 光标区间——挂**按钮 pointerdown**（blur 之前），
      失焦可能重置 selection，onClick 时再读就晚了；键盘激活按钮走 openPicker 兜底。 */
  const rememberCaret = (): void => {
    const ta = taRef.current;
    if (ta === null) return;
    pickerRangeRef.current = {
      start: ta.selectionStart ?? ta.value.length,
      end: ta.selectionEnd ?? ta.value.length,
    };
  };

  /** L3：打开候选选择器 */
  const openPicker = (): void => {
    if (pickerRangeRef.current === null) rememberCaret();
    setPicker(true);
  };

  /** L3：候选选中 → 光标处插入 `[显示名](锚)`（锚取目标 cid 优先；显示名取路径末段） */
  const insertLinkAt = (anchor: string): void => {
    setPicker(false);
    const ta = taRef.current;
    if (ta === null) return;
    const choice = choices.find((c) => c.anchor === anchor);
    const labelText = (choice?.label ?? anchor).split(' / ').pop() ?? anchor;
    const target =
      root !== undefined && choice !== undefined
        ? preferredLinkAnchor(root, choice.id, anchor)
        : anchor;
    const snippet = `[${labelText}](${target})`;
    const pos = pickerRangeRef.current ?? { start: ta.value.length, end: ta.value.length };
    const start = Math.min(pos.start, ta.value.length);
    const end = Math.min(pos.end, ta.value.length);
    ta.value = ta.value.slice(0, start) + snippet + ta.value.slice(end);
    const caret = start + snippet.length;
    ta.focus();
    ta.setSelectionRange(caret, caret);
  };

  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  // 编辑态一律用屏幕浮窗：嵌入卡片是布局预留的固定矮槽（120 基线），装不下编辑器；
  // 浮窗位置与字号都稳定（IME 选词框不漂），先给足空间再键入。
  const floating = mode !== 'embedded' || editing || mdEditing; // P2：md 编辑同样升级浮窗
  // P1：翻面仅在「固定卡 + note.md 非空」时启用（§1.2 floating/编辑态不翻）；翻转由面板头
  // 按钮独立驱动（受控 FlipCard 不注入 onFlip——整卡点击 no-op，符合「禁止整卡 onClick 翻面」）。
  const flipActive = !floating && typeof md === 'string' && md.trim() !== '';
  const mdEditActive = isFlipped && !floating && (md ?? '').trim() !== ''; // P2：编辑背面入口

  // 编辑态焦点守卫：进入编辑时若焦点还没落在浮窗内，主动聚焦 textarea。
  // 缩放升级（embedded → floating）会重建浮窗，这一步保证输入框不丢焦点。
  useEffect(() => {
    if (!editing) return;
    const root = rootRef.current;
    if (root && document.activeElement && root.contains(document.activeElement)) return;
    taRef.current?.focus();
  }, [editing, floating]);

  // MG-R1-B：组合未结束时不得提交未确认候选串；结束用确认文字补提交
  const { onCompositionStart, onCompositionEnd, allowCommit } = useCompositionCommitGuard(
    (next) => {
      if (next !== text) onChangeText(next);
    },
  );

  // 简化正文编辑：textarea 非受控（defaultValue），失焦时把 DOM 当前值与 prop.text 对比
  // —— 有差异才回传。这样 props 变化不会重建 textarea 实例，焦点不丢，
  // 也不会出现 props.text 与正在输入的内容打架的情况。
  const onTextBlur = (): void => {
    if (!allowCommit()) return;
    const cur = taRef.current?.value ?? text;
    if (cur !== text) onChangeText(cur);
  };

  // MG-R4：正文草稿的 pending/flush 通道（DOM 无控件可 blur 时——例如面板卸载前——
  // 也能被离开路径提交、被 beforeunload 检出）
  useDraftSession(() => ({
    hasPending: () => {
      const ta = taRef.current;
      return ta !== null && ta.value !== text;
    },
    commit: () => {
      const cur = taRef.current?.value ?? text;
      if (cur !== text) onChangeText(cur);
    },
  }));

  // ---- 屏幕空间定位（floating）：固定宽 + 边界钳制 + 空间不足时翻转到节点上方 ----
  // 视口尺寸尚未观测到（首帧 / 容器隐藏，ViewportController 初值 1）时按"未知"处理：
  // 不做钳制，否则浮窗会被钉在左上角。
  const vw = viewportW !== undefined && viewportW > MIN_KNOWN_VIEWPORT ? viewportW : Number.POSITIVE_INFINITY;
  const vh = viewportH !== undefined && viewportH > MIN_KNOWN_VIEWPORT ? viewportH : Number.POSITIVE_INFINITY;
  // 宽度对齐节点（floating）/ 基线宽（embedded 升级为浮窗时用世界宽 × k）；
  // 编辑态兜到最小编辑宽度（节点太窄没法打字），最后不超出视口。
  const alignW = floatingNoteWidth(nodeWidth ?? width * s, vw);
  const panelW = Math.min(
    editing ? Math.max(alignW, EDITING_NOTE_MIN_W) : alignW,
    Number.isFinite(vw)
      ? Math.max(FLOATING_NOTE_MIN_W, vw - FLOATING_NOTE_MARGIN * 2)
      : Number.POSITIVE_INFINITY,
  );
  // 笔记字号：不大于所属节点字号（下限兜底见 NOTE_FONT_MIN 注释）
  const fontPx = noteFontSizeOf(nodeFontSize);
  const fontMutedPx = Math.max(8, fontPx - 1);
  const floatMaxH = Math.min(
    editing ? EDITING_NOTE_MAX_H : FLOATING_NOTE_MAX_H,
    Math.max(160, vh - FLOATING_NOTE_MARGIN * 2),
  );
  // 翻转判定要按编辑态的真实高度（minHeight）来，不能只看内容估算
  const minEditingH = editing ? Math.min(EDITING_NOTE_MIN_H, floatMaxH) : 0;
  const estimatedH = Math.min(
    floatMaxH,
    Math.max(
      minEditingH,
      estimateFloatingNoteHeight(seq, text, panelW),
    ),
  );
  const roomBelow = vh - FLOATING_NOTE_MARGIN - y;
  const roomAbove = anchorTop !== undefined ? anchorTop - FLOATING_NOTE_GAP : -1;
  const flip = floating && roomBelow < estimatedH && roomAbove > roomBelow;
  const floatX = Number.isFinite(vw)
    ? Math.min(
        Math.max(x, FLOATING_NOTE_MARGIN),
        Math.max(FLOATING_NOTE_MARGIN, vw - panelW - FLOATING_NOTE_MARGIN),
      )
    : x;

  const rootStyle: React.CSSProperties = floating
    ? {
        position: 'absolute',
        left: floatX,
        top: flip ? (anchorTop ?? y) - FLOATING_NOTE_GAP : y,
        width: panelW,
        maxHeight: floatMaxH,
        // 编辑态先给足高度（"先变大再键入"）；预览态按内容自适应
        ...(minEditingH > 0 ? { minHeight: minEditingH } : {}),
        display: 'flex',
        flexDirection: 'column',
        // 编辑态内部区域各自滚动，外层不滚（保持输入框位置稳定）
        overflowY: editing ? 'hidden' : 'auto',
        // 翻转用 translate3d（-100% = 自身高度上移），同时把浮窗提到合成层
        transform: `translate3d(0, ${flip ? '-100%' : '0'}, 0)`,
        boxSizing: 'border-box',
        background: CHROME.panelBg,
        border: `1px solid ${CHROME.panelBorder}`,
        borderRadius: CHROME.radius,
        boxShadow: CHROME.shadow,
        backdropFilter: 'blur(12px)',
        padding: 10,
        zIndex: 70,
        fontFamily: CHROME.fontFamily,
      }
    : {
        // 世界空间：left/top 已是屏幕投影坐标，宽高用**世界基线**，
        // 由一次 transform: scale(k) 统一缩放（合成器驱动，不逐帧重排内部文本）。
        position: 'absolute',
        left: x,
        top: y,
        width: Math.max(EMBEDDED_NOTE_MIN_W, width),
        ...(height === undefined
          ? {}
          : { height: Math.max(EMBEDDED_NOTE_MIN_H, height) }),
        transform: `translate3d(0, 0, 0) scale(${s})`,
        transformOrigin: '0 0',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        background: CHROME.panelBg,
        border: `1px solid ${CHROME.panelBorder}`,
        borderRadius: CHROME.radius,
        boxShadow: CHROME.shadow,
        backdropFilter: 'blur(12px)',
        padding: 10,
        overflow: 'hidden',
        zIndex: 70,
        fontFamily: CHROME.fontFamily,
      };

  // 区域布局：embedded 固定槽内两区平分；floating 预览按内容自适应（各自封顶滚动）；
  // floating 编辑态给足空间 —— 序列区封顶 240，正文区吃掉剩余高度（textarea 拉伸填充）。
  const seqStyle: React.CSSProperties = floating
    ? editing
      ? { flex: '0 1 auto', minHeight: 0, maxHeight: 190, overflowY: 'auto' }
      : { maxHeight: REGION_MAX_H, overflowY: 'auto' }
    : { flex: '1 1 0', minHeight: 0, overflowY: 'auto' };
  const textStyle: React.CSSProperties = floating
    ? editing
      ? { flex: '1 1 0', minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }
      : { maxHeight: REGION_MAX_H, overflowY: 'auto' }
    : { flex: '1 1 0', minHeight: 0, overflowY: 'auto' };

  // P1：两个内容区块（正面「现有区块」，逐字未改）——翻面时装 FlipCard 正面，未启用原样直出（Fragment 透明）。
  const seqRegion = (
    <div data-note-seq style={{ ...seqStyle, marginBottom: 8 }}>
      {editing ? (
        <QaEditor
          items={seq}
          onChange={onChangeSeq}
          token={token}
          title="序列"
          placeholder="新增条目…（回车提交）"
          fontSize={fontPx}
        />
      ) : seq.length === 0 ? null : (
        <>
          <div
            style={{
              color: token.color.annotationAccent,
              fontSize: fontPx,
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            序列
          </div>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {seq.map((item, i) => (
              <li
                key={i}
                style={{
                  color: CHROME.text,
                  fontSize: fontPx,
                  lineHeight: 1.6,
                }}
              >
                <TextLinkSpans text={item} root={root} onJumpToAnchor={onJumpToAnchor} token={token} />
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );

  const textRegion = (
    <div data-note-textarea style={textStyle}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          marginBottom: 4,
        }}
      >
        <span style={{ flex: 1, color: CHROME.textMuted, fontSize: fontPx, fontWeight: 600 }}>
          正文
        </span>
        {editing && root !== undefined && (
          <button
            type="button"
            data-insert-link
            onPointerDown={rememberCaret}
            onClick={openPicker}
            style={{
              border: 'none',
              background: 'transparent',
              color: token.color.linkStroke,
              cursor: 'pointer',
              fontSize: fontMutedPx,
              padding: '0 2px',
            }}
          >
            插入链接
          </button>
        )}
      </div>
      {editing ? (
        <textarea
          ref={taRef}
          defaultValue={text}
          placeholder="整段说明…"
          onCompositionStart={onCompositionStart}
          onCompositionEnd={(e) => onCompositionEnd(e.currentTarget.value)}
          onBlur={onTextBlur}
          onKeyDown={(e) => e.stopPropagation()}
          style={{
            // 编辑态吃掉正文区剩余高度（先给足空间再键入），下限 150 保证可见行数
            flex: 1,
            minHeight: EDITING_TEXTAREA_MIN_H,
            border: `1px solid ${CHROME.panelBorder}`,
            background: 'transparent',
            color: CHROME.text,
            borderRadius: CHROME.radiusSmall,
            padding: '4px 6px',
            fontSize: fontPx,
            fontFamily: CHROME.fontFamily,
            lineHeight: 1.6,
            resize: 'vertical',
            outline: 'none',
          }}
        />
      ) : (
        <div
          style={{
            color: CHROME.text,
            fontSize: fontPx,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {text === '' ? (
            <span style={{ color: CHROME.textMuted }}>（无正文）</span>
          ) : (
            <TextLinkSpans text={text} root={root} onJumpToAnchor={onJumpToAnchor} token={token} />
          )}
        </div>
      )}
    </div>
  );

  return (
    <div
      ref={rootRef}
      data-note-popover
      data-note-pinned={pinned ? 'true' : 'false'}
      data-note-mode={floating ? 'floating' : 'embedded'}
      // 画布手势监听 pointerdown/up；只拦 click 会让点击输入框仍触发画布空白点击，
      // 进而清掉 pinnedNoteId，浮窗立即消失。
      onPointerDown={(e) => {
        e.stopPropagation();
        // 固定必须走 pointerdown：画布本身以 pointer 手势处理点击，不能依赖随后
        // 才可能触发的 click，否则预览浮窗会在状态写回前被悬停逻辑收走。
        if (!pinned) onPin?.();
      }}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onPointerCancel={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
      }}
      style={rootStyle}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 8,
          flex: 'none',
        }}
      >
        <span
          style={{
            flex: 1,
            color: CHROME.text,
            fontSize: fontPx,
            fontWeight: 600,
          }}
        >
          note 笔记
        </span>
        {!pinned && (
          <span style={{ color: CHROME.textMuted, fontSize: fontMutedPx }}>点击固定</span>
        )}
        {mdEditActive && <MdEditButton fontPx={fontPx} onClick={() => setMdEditing(true)} />}
        {flipActive && (
          <button
            type="button"
            data-note-flip
            aria-pressed={isFlipped}
            title={isFlipped ? '翻回正面' : '翻面：查看 markdown 背面'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); setFlip(!isFlipped); }}
            style={{ border: 'none', background: 'transparent', color: CHROME.textMuted, cursor: 'pointer', fontSize: fontPx, lineHeight: 1, padding: 2 }}
          >
            ⟳
          </button>
        )}
        <button
          type="button"
          aria-label="关闭 note笔记"
          onClick={onClose}
          style={{
            border: 'none',
            background: 'transparent',
            color: CHROME.textMuted,
            cursor: 'pointer',
            fontSize: fontPx,
            lineHeight: 1,
            padding: 2,
          }}
        >
          ✕
        </button>
      </div>

      <NoteBody
        mdEditing={mdEditing}
        flipActive={flipActive}
        isFlipped={isFlipped}
        md={md}
        token={token}
        front={<>{seqRegion}{textRegion}</>}
        onJumpToAnchor={onJumpToAnchor}
        onChangeMd={onChangeMd}
        onExitMdEdit={() => setMdEditing(false)}
      />
      {/* L3：候选选择器 portal 到 body —— 浮窗根有 transform（合成器层），
          fixed 遮罩若留在浮窗内会被 transform 困住（遮罩只盖浮窗、点外面无法取消）。 */}
      {picker &&
        root !== undefined &&
        createPortal(
          <EdgeAnchorPicker choices={choices} onPick={insertLinkAt} onClose={() => setPicker(false)} />,
          document.body,
        )}
    </div>
  );
}
