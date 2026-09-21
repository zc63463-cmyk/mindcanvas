/**
 * 未保存离开确认模态 —— MODE-GUARD 批次由「放弃/取消」两按钮**明确升级**为三选项：
 * 「保存并继续 / 放弃修改 / 取消」。
 *
 * 为什么用自定义模态：IDE 内嵌 webview 会静默吞掉 confirm（返回 false/undefined 且无 UI），
 * 「未保存保护」会成为无法完成的死路；顺带解决原生弹窗不可样式化的问题（M3 裁决脉络）。
 *
 * 语义与键盘纪律：
 * - 三选项分别 dispatch `save` / `discard` / `cancel`；遮罩按下 = 取消（保守，绝不误当作确认）；
 * - 默认焦点在**非破坏性**选项「保存并继续」；Enter 只激活**当前聚焦**按钮
 *   （不再沿用旧框「任意 Enter 都放弃」的键盘处理）；
 * - Esc = 取消；Tab 在模态内循环（焦点约束），关闭后焦点恢复到打开前的元素；
 * - `busy`（保存/等待中）时禁用「保存并继续」以防重复提交，取消仍可操作；
 * - 层级 600：高于自由画布工具栏（200）与 App 浮标（500），背景不可穿透点击。
 *
 * 不是什么：不是纯搬迁（按钮语义已扩展）；不弹原生窗口；不自行保存（决策由调用方执行）。
 */
import { useEffect, useRef, type CSSProperties } from 'react';
import type { LeaveChoice } from './documentLifecycle.js';

export interface UnsavedPromptProps {
  open: boolean;
  /** 过程提示（保存失败/下载/组合未结束…）；null = 默认文案 */
  notice?: string | null;
  /** 保存或等待进行中：禁用「保存并继续」，取消仍可操作 */
  busy?: boolean;
  /** 用户选择：save = 保存并继续；discard = 放弃修改并离开；cancel = 留下 */
  onChoice: (choice: LeaveChoice) => void;
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

const discardStyle: CSSProperties = {
  ...btnStyle,
  border: '1px solid rgba(226,75,74,.55)',
  background: 'rgba(226,75,74,.16)',
  color: '#f2b8b5',
};

const saveStyle: CSSProperties = {
  ...btnStyle,
  border: '1px solid rgba(64,196,180,.6)',
  background: 'rgba(64,196,180,.18)',
  color: '#bdf3ec',
};

export function UnsavedPrompt({ open, notice = null, busy = false, onChoice }: UnsavedPromptProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const saveBtnRef = useRef<HTMLButtonElement | null>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  // 焦点恢复：**打开瞬间**（渲染期）记下当前焦点 —— 焦点随后就会进模态，事后再读已经晚了。
  // 关闭后还回去（元素已卸载则无操作）。
  if (open && !wasOpenRef.current) {
    wasOpenRef.current = true;
    prevFocusRef.current =
      typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  } else if (!open && wasOpenRef.current) {
    wasOpenRef.current = false;
  }

  useEffect(() => {
    if (!open) {
      const prev = prevFocusRef.current;
      prevFocusRef.current = null;
      if (prev !== null && prev.isConnected) prev.focus();
      return;
    }
    // 只靠 autoFocus 不够：真实浏览器在 click 派发结束后会执行「聚焦被点元素」的默认动作，
    // 把焦点从模态里抢回触发按钮（无头实测）。effect 晚于该默认动作 → 这里再聚焦一次才可靠。
    saveBtnRef.current?.focus();
  }, [open]);

  // 键盘纪律挂在 document（capture）：焦点即使被点走也不会漏键；同时挡住画布快捷键链。
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const cycle = (backward: boolean): void => {
      const card = cardRef.current;
      if (card === null) return;
      const items = Array.from(card.querySelectorAll('button'));
      if (items.length === 0) return;
      const current = document.activeElement;
      const index = items.findIndex((el) => el === current);
      const next =
        index === -1
          ? (saveBtnRef.current ?? items[0])
          : items[(index + (backward ? items.length - 1 : 1)) % items.length];
      next?.focus();
    };
    const onKey = (e: KeyboardEvent): void => {
      e.stopPropagation(); // 模态打开期间不进画布快捷键链
      if (e.key === 'Tab') {
        e.preventDefault();
        cycle(e.shiftKey);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onChoice('cancel');
        return;
      }
      if (e.key === 'Enter') {
        // 只激活聚焦按钮（默认聚焦「保存并继续」）——不把 Enter 一律当成放弃
        const el = document.activeElement;
        if (el instanceof HTMLButtonElement && cardRef.current?.contains(el) === true) {
          e.preventDefault();
          el.click();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onChoice]);

  if (!open) return null;

  return (
    <div
      data-unsaved-backdrop
      onPointerDown={() => onChoice('cancel')}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 600, // 高于自由画布工具栏（200）与 App 浮标（500）：不能被遮挡或穿透
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(0,0,0,.45)',
      }}
    >
      <div
        ref={cardRef}
        data-unsaved-prompt
        role="dialog"
        aria-modal="true"
        aria-label="未保存的修改"
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          width: 360,
          padding: '14px 16px',
          borderRadius: 11,
          color: '#e4f2ef',
          background: 'rgba(13,19,21,.92)',
          border: '1px solid rgba(255,255,255,.14)',
          boxShadow: '0 10px 30px rgba(0,0,0,.5)',
          font: '12.5px/1.5 system-ui, -apple-system, sans-serif',
        }}
      >
        <span>当前文档有未保存的修改，如何处理？</span>
        {notice !== null && (
          <span data-unsaved-notice style={{ color: '#f2b8b5' }}>
            {notice}
          </span>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" data-unsaved-cancel style={btnStyle} onClick={() => onChoice('cancel')}>
            取消
          </button>
          <button
            type="button"
            data-unsaved-discard
            style={discardStyle}
            onClick={() => onChoice('discard')}
          >
            放弃修改
          </button>
          {/* 默认焦点在非破坏性选项：Enter = 保存后继续。
              busy 时**不置 disabled** —— 保存中/等待收束时用户点它应当「等一等再写」，
              而不是得到一个按不动的死按钮；重复提交由决策器的单请求标记拦住。 */}
          <button
            ref={saveBtnRef}
            type="button"
            data-unsaved-save
            data-unsaved-save-busy={busy ? '' : undefined}
            aria-busy={busy}
            style={busy ? { ...saveStyle, opacity: 0.75, cursor: 'progress' } : saveStyle}
            autoFocus
            onClick={() => onChoice('save')}
          >
            {busy ? '正在保存…' : '保存并继续'}
          </button>
        </div>
      </div>
    </div>
  );
}
