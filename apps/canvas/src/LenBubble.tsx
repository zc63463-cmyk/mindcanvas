/**
 * 出线长度 · 数值气泡（v1.8.1 菜单梳理）：右键「出线长度 › 自定义…」的值输入，
 * 取代原生 prompt（裁决 M3——原生弹窗阻塞、不可样式化、部分 webview 受限）。
 * Enter 提交（下限 14，与内核「非法忽略」同口径）/ Esc 或点外部取消。
 */
import { useState } from 'react';

export interface LenBubbleProps {
  /** 气泡位置（客户端坐标；= 原右键菜单位置） */
  x: number;
  y: number;
  /** 当前生效值（null = 缺省 → 输入框预填 32） */
  initial: number | null;
  onCommit: (len: number) => void;
  onCancel: () => void;
}

/** 下限与内核读取侧同口径（14 = V_GAP/SEPARATE_MARGIN 家族） */
const MIN_LEN = 14;

export function LenBubble({ x, y, initial, onCommit, onCancel }: LenBubbleProps) {
  const [text, setText] = useState(initial !== null ? String(initial) : '32');
  const parsed = Math.round(Number(text));
  const valid = text.trim() !== '' && Number.isFinite(parsed) && parsed >= MIN_LEN;
  return (
    <div
      data-len-backdrop
      onPointerDown={onCancel}
      style={{ position: 'fixed', inset: 0, zIndex: 40 }}
    >
      <div
        data-len-bubble
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          left: x,
          top: y,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          borderRadius: 11,
          color: '#e4f2ef',
          background: 'rgba(13,19,21,.9)',
          border: '1px solid rgba(255,255,255,.14)',
          boxShadow: '0 10px 30px rgba(0,0,0,.5)',
          font: '12.5px/1.4 system-ui, -apple-system, sans-serif',
          whiteSpace: 'nowrap',
        }}
      >
        <span>出线长度</span>
        <input
          // 焦点说明：气泡是用户刚点开的直接操作入口 → 聚焦输入框是预期行为
          // （原 biome-ignore 抑制是 no-op：该处并不触发 noAutofocus，2026-09-13 清理）
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation(); // 不进画布快捷键链
            if (e.key === 'Enter' && valid) onCommit(parsed);
            if (e.key === 'Escape') onCancel();
          }}
          style={{
            width: 64,
            font: 'inherit',
            color: 'inherit',
            textAlign: 'right',
            background: 'rgba(255,255,255,.06)',
            border: '1px solid rgba(255,255,255,.18)',
            borderRadius: 7,
            padding: '3px 7px',
            outline: 'none',
          }}
        />
        <span style={{ color: '#9fb4b8' }}>px（≥{MIN_LEN}）</span>
      </div>
    </div>
  );
}
