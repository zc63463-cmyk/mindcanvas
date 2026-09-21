/**
 * 未保存切换确认模态（A-D4）—— 替代 window.confirm。
 *
 * 为什么：IDE 内嵌 webview 会静默吞掉 confirm（返回 false/undefined 且无 UI），
 * 「放弃未保存修改并切换」会成为无法完成的死路；顺带解决原生弹窗不可样式化的问题
 * （与 LenBubble 同一裁决脉络：M3）。
 *
 * 语义（决策 A1：两按钮、语义等价替换，不做「保存后再切换」第三条路径）：
 *  - 「放弃修改并切换」→ settle(true)；「取消」/ 点遮罩 / Esc → settle(false)；
 *  - Enter = 确认（主按钮 autoFocus；keydown 在卡片上 stopPropagation，不进画布快捷键链——与 LenBubble 一致）。
 */
import type { CSSProperties } from 'react';

export interface UnsavedPromptProps {
  open: boolean;
  /** settle(true) = 放弃修改并切换；settle(false) = 取消（不切换） */
  onSettle: (ok: boolean) => void;
}

const btnStyle: CSSProperties = {
  padding: '5px 12px',
  borderRadius: 7,
  border: '1px solid rgba(255,255,255,.18)',
  background: 'transparent',
  color: '#e4f2ef',
  font: 'inherit',
  cursor: 'pointer',
};

const okStyle: CSSProperties = {
  ...btnStyle,
  border: '1px solid rgba(226,75,74,.55)',
  background: 'rgba(226,75,74,.16)',
  color: '#f2b8b5',
};

export function UnsavedPrompt({ open, onSettle }: UnsavedPromptProps) {
  if (!open) return null;
  return (
    <div
      data-unsaved-backdrop
      onPointerDown={() => onSettle(false)}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 70, // 在文件管理器（60）之上：从文件库触发的切换确认要压住它
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(0,0,0,.45)',
      }}
    >
      <div
        data-unsaved-prompt
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation(); // 不进画布快捷键链（与 LenBubble 同语义）
          if (e.key === 'Enter') onSettle(true);
          if (e.key === 'Escape') onSettle(false);
        }}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          width: 320,
          padding: '14px 16px',
          borderRadius: 11,
          color: '#e4f2ef',
          background: 'rgba(13,19,21,.92)',
          border: '1px solid rgba(255,255,255,.14)',
          boxShadow: '0 10px 30px rgba(0,0,0,.5)',
          font: '12.5px/1.5 system-ui, -apple-system, sans-serif',
        }}
      >
        <span>当前文档有未保存的修改，确定放弃并切换？</span>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" data-unsaved-cancel style={btnStyle} onClick={() => onSettle(false)}>
            取消
          </button>
          {/* 焦点说明：模态是用户刚触发的直接操作入口 → 聚焦主按钮是预期行为（Enter 确认）。
              原 biome-ignore 抑制是 no-op（该处并不触发 noAutofocus），2026-09-13 清理。 */}
          <button type="button" data-unsaved-ok autoFocus style={okStyle} onClick={() => onSettle(true)}>
            放弃修改并切换
          </button>
        </div>
      </div>
    </div>
  );
}
