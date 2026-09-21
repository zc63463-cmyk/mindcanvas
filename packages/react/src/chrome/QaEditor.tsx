/**
 * QaEditor —— 快速注释编辑区（R15：查看 / 新增 / 编辑 / 删除）。
 * 归属翻转卡面板；写回经 controller.updateNote({ qa })（TreeOp update-node patch.note）。
 * 玻璃 chrome 风格（CHROME）+ annotationAccent 强调（令牌，K3 纪律）。
 */
import { useState } from 'react';
import { CHROME } from '../theme/tokens.js';
import type { TokenSet } from '../theme/types.js';

export interface QaEditorProps {
  /** 当前 qa 条目（note.qa，YAML 数组） */
  items: readonly string[];
  /** 写回（整组替换；空数组 = 清空） */
  onChange: (qa: string[]) => void;
  token: TokenSet;
  /**
   * 区域标题，缺省「快速注释」。
   * v1.4.0 起本编辑器也承担「节点注释 · 序列区域」的编辑 —— 两者形态相同
   * （都是可增删改的字符串列表），故复用而非另写一个。
   */
  title?: string;
  /** 新增输入框的占位文案 */
  placeholder?: string;
  /**
   * 字号（缺省 chrome 小字号）。
   * 由 note 浮窗传入：笔记字号不得大于所属节点字号，编辑器（编辑态）需同步。
   */
  fontSize?: number;
}

export function QaEditor({
  items,
  onChange,
  token,
  title = '快速注释',
  placeholder = '新增注释…（回车提交）',
  fontSize,
}: QaEditorProps) {
  const fs = fontSize ?? CHROME.fontSizeSmall;
  const [value, setValue] = useState('');
  const add = (): void => {
    const text = value.trim();
    if (text === '') return;
    onChange([...items, text]);
    setValue('');
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            color: token.color.annotationAccent,
            fontSize: fs,
            fontWeight: 600,
          }}
        >
          {title}
        </span>
        <span
          style={{
            background: token.color.annotationBadge,
            color: token.color.annotationAccent,
            borderRadius: 8,
            padding: '0 6px',
            fontSize: Math.max(8, fs - 1),
            lineHeight: '14px',
          }}
        >
          {items.length}
        </span>
      </div>
      {items.map((q, i) => (
        <div
          key={`${i}:${q}`}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 6,
            background: token.color.annotationBadge,
            borderLeft: `2px solid ${token.color.annotationAccent}`,
            borderRadius: 4,
            padding: '4px 6px',
            fontSize: fs,
            lineHeight: 1.5,
            color: CHROME.text,
          }}
        >
          <input
            aria-label="编辑注释"
            defaultValue={q}
            onBlur={(e) => {
              const next = e.currentTarget.value.trim();
              if (next === q) return;
              onChange(
                next === ''
                  ? items.filter((_, j) => j !== i)
                  : items.map((item, j) => (j === i ? next : item)),
              );
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                e.currentTarget.value = q;
                e.currentTarget.blur();
              }
            }}
            style={{
              flex: 1,
              minWidth: 0,
              border: 'none',
              background: 'transparent',
              color: CHROME.text,
              fontSize: fs,
              lineHeight: 1.5,
              fontFamily: CHROME.fontFamily,
              outline: 'none',
              padding: 0,
            }}
          />
          <button
            aria-label="删除注释"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            style={{
              border: 'none',
              background: 'transparent',
              color: token.color.annotationAccent,
              cursor: 'pointer',
              fontSize: fs,
              lineHeight: 1,
              padding: 2,
            }}
          >
            ✕
          </button>
        </div>
      ))}
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation(); // 关键：输入框内不触发画布全局快捷键（Tab/Enter 等）
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          } else if (e.key === 'Escape') {
            setValue('');
          }
        }}
        style={{
          border: `1px solid ${CHROME.panelBorder}`,
          background: 'transparent',
          color: CHROME.text,
          borderRadius: CHROME.radiusSmall,
          padding: '4px 8px',
          fontSize: fs,
          fontFamily: CHROME.fontFamily,
          outline: 'none',
        }}
      />
    </div>
  );
}
