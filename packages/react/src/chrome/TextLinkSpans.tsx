/**
 * TextLinkSpans —— 只读态行内链接渲染（L1 文本区域链接 Phase 1）。
 *
 * 把纯文本按 parseTextLinks 拆为 spans：文本段原样输出、链接段渲染为
 * `span[data-text-link=锚原文][data-link-state=三态]`：
 *   - well-formed + 宿主注入回调 → 可点击（点击上报锚原文，宿主负责展开/定位/选中）；
 *   - dangling / stale → 幽灵态（T-A5：虚线 + title 原因 + 不可跳，与 W-SECTION-DANGLING 同哲学）；
 *   - 缺省不注入回调 → 只渲染不可点（向 EdgeEditor.choices 的缺省纪律看齐）。
 *
 * **零包裹容器**（Fragment 直出）——不改变既有行内排版 / 换行 / measure 口径；
 * **编辑态不在本组件范围**（T-A3：textarea 保持纯文本，一行不动）。
 */
import { useMemo } from 'react';
import type { EditableNode } from '@mindcanvas/kernel';
import { parseTextLinks } from '../edit/textLinks.js';
import { CHROME } from '../theme/tokens.js';
import type { TokenSet } from '../theme/types.js';

export interface TextLinkSpansProps {
  text: string;
  /** 三态解析用树（缺省 → 只做语法渲染，data-link-state=unknown） */
  root?: EditableNode;
  /** 跳转回调（缺省 → 链接只渲染不可点） */
  onJumpToAnchor?: (anchor: string) => void;
  token: TokenSet;
}

/** 幽灵态 title（可解释性：保留原值 + 说明为什么不可跳） */
function ghostTitle(state: string, reason: string | undefined): string {
  const tail = reason === undefined ? '' : `（${reason}）`;
  return state === 'stale' ? `链接不确定：目标不唯一${tail}` : `链接失效：目标不存在${tail}`;
}

export function TextLinkSpans({ text, root, onJumpToAnchor, token }: TextLinkSpansProps) {
  const spans = useMemo(() => parseTextLinks(text, root), [text, root]);
  return (
    <>
      {spans.map((span) => {
        if (span.kind === 'text') return span.text;
        const ghost = span.state === 'dangling' || span.state === 'stale';
        const clickable = span.state === 'well-formed' && onJumpToAnchor !== undefined;
        return (
          <span
            key={span.start}
            data-text-link={span.anchorText}
            data-link-state={span.state ?? 'unknown'}
            title={ghost ? ghostTitle(span.state ?? '', span.reason) : undefined}
            // 链接触发的按下不冒泡：宿主容器（NotePopover 浮窗根）的 onPointerDown 会
            // 「点击固定」→ 预览浮窗（floating）被固定卡（embedded）替换、DOM 重建 →
            // up/click 丢失（实测根因：预览浮窗里点链接要两次才生效）。
            // 点链接 = 跳转意图，不承担「固定浮窗」职责。
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              // 链接点击不冒泡（如 DescBlock 的 收起/展开 onToggle 不被误触）
              e.stopPropagation();
              if (clickable) onJumpToAnchor(span.anchorText ?? '');
            }}
            style={{
              // well-formed 用引用竖线同源色（有链接感）；幽灵态弱化 + 虚线下划线
              color: ghost ? CHROME.textMuted : token.color.linkStroke,
              textDecorationLine: 'underline',
              textDecorationStyle: ghost ? 'dashed' : 'solid',
              textUnderlineOffset: 2,
              cursor: clickable ? 'pointer' : 'default',
            }}
          >
            {span.label}
          </span>
        );
      })}
    </>
  );
}
