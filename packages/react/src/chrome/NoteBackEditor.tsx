/**
 * P2 · 节点卡背面编辑：`note.md` 源文的 **textarea + 预览双态** 编辑器（设计稿 §7）。
 *
 * 本文件承载三件 P2 新 UI（NotePopover 600 行守线：编辑器与提取的接线块不内联）：
 *   ① `NoteBackEditor` —— 编辑器本体：源文 textarea（**非受控** `defaultValue`，防 IME/焦点
 *      抖动——同 NotePopover 正文区做法）+「源文 / 预览」**单窗双态**切换（预览复用
 *      `CardBackMarkdown` 同源渲染，零新解析）；锚点 `data-note-md-editor` / `data-note-md-mode`。
 *   ② `MdEditButton` —— 背面态 header 的「编辑背面」入口（`data-note-md-edit`；
 *      渲染条件由调用方判定：仅 `isFlipped && md 非空 && !floating`；`pointerdown`
 *      stopPropagation 纪律同 ⟳）。
 *   ③ `NoteBody` —— 提取自 NotePopover 的面板主体三态渲染块（正面直出 / 翻卡 /
 *      md 编辑面），DOM 与提取前逐字一致（P1 钉不受影响）。
 *
 * 提交纪律（**对齐 DescBlock 实测口径**，见 P2 报告 §P2-1 抄录）：
 *   - 失焦提交（`onBlur`）、`Shift+Enter` 提交、`Esc` 取消；**Enter 换行**（不拦截）。
 *   - 提交上抛**原文（不 trim）**：markdown 前导空白有意义；「空文本 = 删除 md 键」
 *     由写回链判定（`md.trim() === '' → { md: undefined }`，本组件不碰文档）。
 *   - 无改动的写盘防护（对比当前 md）由接线层执行（同正文区「未改动则不提交」纪律）。
 *
 * 双态切换的焦点纪律：切换按钮 `pointerdown` **preventDefault**——按钮取焦会先让
 * textarea 失焦（触发提交并退出），预览就没得看；抑制默认后切换不改变焦点，
 * textarea 卸载亦不触发 blur（React 卸载不派发 onBlur），编辑态得以停在预览上。
 */
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { CHROME } from '../theme/tokens.js';
import type { TokenSet } from '../theme/types.js';
import { CardBackMarkdown } from './CardBackMarkdown.js';
import { FlipCard } from './FlipCard.js';

/** 源文编辑字号（与 CardBackMarkdown 渲染字号同源：预览 / 源文视觉一致） */
const MD_FONT = CHROME.fontSizeSmall;
/** 等宽字体栈（与 CardBackMarkdown 的代码块样式同款） */
const MD_FONT_FAMILY = 'ui-monospace, Consolas, monospace';

export interface NoteBackEditorProps {
  /** 初始源文（非受控 textarea 的 defaultValue；双态切换的基准快照） */
  md: string;
  token: TokenSet;
  /** 提交（失焦 / Shift+Enter；上抛 textarea 当前原文，不 trim——判定在写回链） */
  onCommit?: (md: string) => void;
  /** 取消（Esc；不提交） */
  onCancel?: () => void;
  /** 预览态内部锚跳转（与 CardBackMarkdown 同款回调；缺省 → 锚只渲染不可点） */
  onJumpToAnchor?: (anchor: string) => void;
}

export function NoteBackEditor({
  md,
  token,
  onCommit,
  onCancel,
  onJumpToAnchor,
}: NoteBackEditorProps) {
  // 双态：'source' = textarea 编辑源文；'preview' = CardBackMarkdown 渲染同一草稿
  const [mode, setMode] = useState<'source' | 'preview'>('source');
  // 切换时从 textarea 摘出的草稿快照（预览渲染 + 切回源文的挂载初值）
  const [draft, setDraft] = useState(md);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // 进入 / 切回源文态：聚焦并把光标移到末尾（同 DescBlock 进入编辑纪律；
  // 切到预览态时不聚焦任何东西——预览是阅读面）。
  useEffect(() => {
    if (mode !== 'source') return;
    const ta = taRef.current;
    if (ta === null) return;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, [mode]);

  /** 提交（失焦 / Shift+Enter）：上抛 textarea 当前原文 */
  const commit = (): void => {
    onCommit?.(taRef.current?.value ?? draft);
  };

  /** 切到预览：先记录当前草稿；切回源文：textarea 以最新草稿重新挂载 */
  const toggleMode = (): void => {
    if (mode === 'source') {
      setDraft(taRef.current?.value ?? draft);
      setMode('preview');
    } else {
      setMode('source');
    }
  };

  return (
    <div
      data-note-md-editor
      data-note-md-mode={mode}
      style={{ flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4, flex: 'none' }}>
        <span style={{ flex: 1, color: CHROME.textMuted, fontSize: MD_FONT, fontWeight: 600 }}>
          note.md 源文
        </span>
        <button
          type="button"
          data-note-md-toggle
          title={mode === 'source' ? '预览渲染效果' : '回到源文编辑'}
          // 抑制默认：按钮取焦会先让 textarea 失焦（=误触发提交并退出编辑），
          // 预览切换必须保持焦点不动（详见文件头注释）。
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          onClick={(e) => {
            e.stopPropagation();
            toggleMode();
          }}
          style={{
            border: 'none',
            background: 'transparent',
            color: token.color.linkStroke,
            cursor: 'pointer',
            fontSize: MD_FONT,
            padding: '0 2px',
          }}
        >
          {mode === 'source' ? '预览' : '源文'}
        </button>
      </div>
      {mode === 'source' ? (
        <textarea
          ref={taRef}
          data-note-md-input
          defaultValue={draft}
          placeholder="markdown 源文…（Shift+Enter 完成，Enter 换行）"
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && e.shiftKey) {
              // Shift+Enter：提交（同 DescBlock 的「完成」键位；Enter 留给换行）
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancel?.();
            }
          }}
          style={{
            flex: 1,
            minHeight: 0,
            border: `1px solid ${CHROME.panelBorder}`,
            background: 'transparent',
            color: CHROME.text,
            borderRadius: CHROME.radiusSmall,
            padding: '4px 6px',
            fontSize: MD_FONT,
            fontFamily: MD_FONT_FAMILY,
            lineHeight: 1.6,
            resize: 'none',
            outline: 'none',
          }}
        />
      ) : (
        <div
          data-note-md-preview
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            border: `1px solid ${CHROME.panelBorder}`,
            borderRadius: CHROME.radiusSmall,
            padding: '4px 6px',
          }}
        >
          <CardBackMarkdown md={draft} token={token} onJumpToAnchor={onJumpToAnchor} />
        </div>
      )}
    </div>
  );
}

/**
 * 「编辑背面」入口（背面态 header；条件由调用方判定）。
 * 子元素文本 = 按钮名（与 `title` 互为完整表达）；`pointerdown` 纪律同 ⟳ 翻面按钮。
 */
export function MdEditButton({ fontPx, onClick }: { fontPx: number; onClick: () => void }) {
  return (
    <button
      type="button"
      data-note-md-edit
      title="编辑背面 markdown 源文"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
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
      编辑背面
    </button>
  );
}

export interface NoteBodyProps {
  /** md 编辑态（mdEditing）——优先于翻卡渲染（编辑面即背面替代视图） */
  mdEditing: boolean;
  /**
   * 翻卡是否启用（由调用方按 `!floating && md 非空` 判定；false = 正面两区块直出）。
   * 调用方在 mdEditing 时不会同时传 true（mdEditing → floating → 翻卡门自然关闭）。
   */
  flipActive: boolean;
  isFlipped: boolean;
  /** 背面源文（mdEditing / flipActive 时用于渲染；undefined = 无背面） */
  md: string | undefined;
  token: TokenSet;
  /** 正面内容（序列 + 正文两区块合体；调用方构造；提取前后 DOM 逐字一致） */
  front: ReactNode;
  onJumpToAnchor?: ((anchor: string) => void) | undefined;
  /** 写回源文（**对比当前 md：有改动才上抛**——无谓写盘防护同正文区「未改动则不提交」纪律） */
  onChangeMd?: (md: string) => void;
  /** 退出 md 编辑态（提交/取消后；不写回） */
  onExitMdEdit: () => void;
}

/**
 * 面板主体三态渲染（自 NotePopover 提取，守 600 行线）：
 *   md 编辑面（NoteBackEditor，替代视图）→ 受控 no-op 翻卡（FlipCard）→ 正面两区块直出。
 * 「提交 → 对比 → 写回 → 退出」整链在此收口（调用方只掏两个回调）。
 */
export function NoteBody({
  mdEditing,
  flipActive,
  isFlipped,
  md,
  token,
  front,
  onJumpToAnchor,
  onChangeMd,
  onExitMdEdit,
}: NoteBodyProps) {
  if (mdEditing) {
    return (
      <NoteBackEditor
        md={md ?? ''}
        token={token}
        onCommit={(next) => {
          if (next !== md) onChangeMd?.(next);
          onExitMdEdit();
        }}
        onCancel={onExitMdEdit}
        onJumpToAnchor={onJumpToAnchor}
      />
    );
  }
  if (!flipActive) return <>{front}</>;
  return (
    <FlipCard
      flipped={isFlipped}
      interactive={false}
      title="note 笔记"
      style={{ flex: '1 1 0', minHeight: 0 }}
      front={front}
      back={
        <div
          data-note-back-scroll
          onKeyDown={(e) => e.stopPropagation()}
          style={{ flex: '1 1 0', minHeight: 0, overflowY: 'auto' }}
        >
          <CardBackMarkdown md={md ?? ''} token={token} onJumpToAnchor={onJumpToAnchor} />
        </div>
      }
    />
  );
}
