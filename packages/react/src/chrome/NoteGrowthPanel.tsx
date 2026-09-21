/** 固定 note 笔记：节点向下生长后填充其布局预留区。 */
import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { EditableNode } from '@mindcanvas/kernel';
import { preferredLinkAnchor } from '../edit/textLinks.js';
import { CHROME } from '../theme/tokens.js';
import type { TokenSet } from '../theme/types.js';
import { collectNodeChoices } from './edgeEditorShared.js';
import { EdgeAnchorPicker } from './EdgeAnchorPicker.js';
import { QaEditor } from './QaEditor.js';
import { TextLinkSpans } from './TextLinkSpans.js';

const NOTE_HEADER_H = 24;
const NOTE_REGION_H = 78;
const NOTE_PAD = 6;

/** 固定 note 笔记与节点主体之间的布局间距（世界坐标）。 */
export const FIXED_NOTE_GAP = 12;
/** 固定预览卡片的紧凑稳定高度（世界坐标）；内容区域自身可滚动。 */
export const FIXED_NOTE_CARD_HEIGHT = 120;

/** 固定高度让多个 note 笔记的布局稳定，超出内容在区内滚动。 */
export function estimateNoteAreaHeight(): number {
  return FIXED_NOTE_GAP + FIXED_NOTE_CARD_HEIGHT;
}

export interface NoteGrowthPanelProps {
  seq: readonly string[];
  text: string;
  editing: boolean;
  token: TokenSet;
  x: number;
  y: number;
  width: number;
  height: number;
  scale?: number;
  onChangeSeq: (seq: string[]) => void;
  onChangeText: (text: string) => void;
  onClose: () => void;
  /** L1：三态解析用树（缺省 → 链接只做语法渲染） */
  root?: EditableNode;
  /** L1：链接跳转回调（缺省 → 链接只渲染不可点） */
  onJumpToAnchor?: (anchor: string) => void;
}

export function NoteGrowthPanel({
  seq,
  text,
  editing,
  token,
  x,
  y,
  width,
  height,
  scale = 1,
  onChangeSeq,
  onChangeText,
  onClose,
  root,
  onJumpToAnchor,
}: NoteGrowthPanelProps) {
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  // L3：插入链接（复用 EdgeAnchorPicker；textarea 光标处插入，T-A7 目标有 cid 优先写 cid:）
  const [picker, setPicker] = useState(false);
  const pickerRangeRef = useRef<{ start: number; end: number } | null>(null);
  // 预览态（editing=false）零开销：不做全树候选收集
  const choices = useMemo(
    () => (editing && root ? collectNodeChoices(root) : []),
    [editing, root],
  );
  /** L3：记录 textarea 光标区间——挂按钮 pointerdown（blur 之前），失焦可能重置 selection */
  const rememberCaret = (): void => {
    const ta = textRef.current;
    if (ta === null) return;
    pickerRangeRef.current = {
      start: ta.selectionStart ?? ta.value.length,
      end: ta.selectionEnd ?? ta.value.length,
    };
  };
  const openPicker = (): void => {
    if (pickerRangeRef.current === null) rememberCaret();
    setPicker(true);
  };
  const insertLinkAt = (anchor: string): void => {
    setPicker(false);
    const ta = textRef.current;
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
  const s = scale;
  const stop = (e: React.SyntheticEvent): void => e.stopPropagation();
  const commitText = (): void => {
    const next = textRef.current?.value ?? text;
    if (next !== text) onChangeText(next);
  };
  const section = {
    flex: '1 1 0',
    minHeight: 0,
    overflowY: 'auto',
    fontSize: CHROME.fontSizeSmall * s,
  } as const;

  return (
    <div
      data-note-growth-panel
      data-note-editing={editing ? 'true' : 'false'}
      role="region"
      aria-label="note 笔记"
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onClick={stop}
      style={{
        position: 'absolute', left: x, top: y, width, height, boxSizing: 'border-box',
        padding: `${NOTE_PAD * s}px`, display: 'flex', flexDirection: 'column', gap: NOTE_PAD * s,
        overflow: 'hidden', pointerEvents: 'auto', zIndex: 65, fontFamily: CHROME.fontFamily,
        color: CHROME.text,
      }}
    >
      <div style={{ height: NOTE_HEADER_H * s, display: 'flex', alignItems: 'center', flex: 'none' }}>
        <span style={{ flex: 1, color: token.color.annotationAccent, fontSize: CHROME.fontSizeSmall * s, fontWeight: 600 }}>
          note 笔记
        </span>
        <button
          type="button"
          aria-label="关闭 note笔记"
          onClick={onClose}
          style={{ border: 'none', background: 'transparent', color: CHROME.textMuted, cursor: 'pointer', fontSize: 14 * s, padding: 0 }}
        >
          x
        </button>
      </div>
      <div data-note-growth-seq style={section}>
        {editing ? (
          <QaEditor items={seq} onChange={onChangeSeq} token={token} title="序列" placeholder="新增条目..." />
        ) : seq.length > 0 ? (
          <ol style={{ margin: 0, paddingLeft: 18 * s }}>
            {seq.map((item, index) => (
              <li key={`${index}:${item}`} style={{ lineHeight: 1.5 }}>
                <TextLinkSpans text={item} root={root} onJumpToAnchor={onJumpToAnchor} token={token} />
              </li>
            ))}
          </ol>
        ) : <span style={{ color: CHROME.textMuted }}>无序列</span>}
      </div>
      <div data-note-growth-text style={section}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 3 * s }}>
          <span style={{ flex: 1, color: CHROME.textMuted, fontSize: CHROME.fontSizeSmall * s, fontWeight: 600 }}>正文</span>
          {editing && root !== undefined && (
            <button
              type="button"
              data-insert-link
              onPointerDown={rememberCaret}
              onClick={openPicker}
              style={{ border: 'none', background: 'transparent', color: token.color.linkStroke, cursor: 'pointer', fontSize: CHROME.fontSizeSmall * s, padding: '0 2px' }}
            >
              插入链接
            </button>
          )}
        </div>
        {editing ? (
          <textarea
            ref={textRef}
            defaultValue={text}
            placeholder="整段说明..."
            onBlur={commitText}
            onKeyDown={(e) => e.stopPropagation()}
            style={{ width: '100%', minHeight: 42 * s, boxSizing: 'border-box', border: `1px solid ${CHROME.panelBorder}`, background: 'transparent', color: CHROME.text, borderRadius: CHROME.radiusSmall, padding: `${3 * s}px ${5 * s}px`, fontSize: CHROME.fontSizeSmall * s, fontFamily: CHROME.fontFamily, resize: 'none', outline: 'none' }}
          />
        ) : (
          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5 }}>
            {text === '' ? (
              <span style={{ color: CHROME.textMuted }}>无正文</span>
            ) : (
              <TextLinkSpans text={text} root={root} onJumpToAnchor={onJumpToAnchor} token={token} />
            )}
          </div>
        )}
      </div>
      {/* L3：候选选择器 portal 到 body（面板根无 transform，但保持与 NotePopover 同款纪律） */}
      {picker &&
        root !== undefined &&
        createPortal(
          <EdgeAnchorPicker choices={choices} onPick={insertLinkAt} onClose={() => setPicker(false)} />,
          document.body,
        )}
    </div>
  );
}
