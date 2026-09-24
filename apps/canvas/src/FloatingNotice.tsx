/**
 * 舞台浮动提示条的**统一组件**（P1-A rider-A · P0-C-review §7-a）。
 *
 * 为什么抽成组件（派单书 §3.6 的「倾向把浮动条组件挪出 MindmapStage」）：
 * `MindmapStage.tsx` 3220 行、`bigFiles` 顶格（4/4），四条浮条各自 20+ 行内联样式
 * 是持续膨胀的来源之一。挪出来后：
 *  - 位置与消退策略的唯一事实源在 `floatingNotices.ts`（组件只消费）；
 *  - 四条浮条的**几何一致性**由「同一个组件」保证，而不是靠人肉对齐四份拷贝。
 *
 * 消退定时器在**本组件**注册（而不是消费方）：`ms` 由槽位给出，
 * 内容一变就重置计时（`useEffect` 依赖 `children`/`token`），与
 * `MindmapStage` 原有的 `[commandNotice]` 依赖语义逐字一致。
 *
 * 不是什么：不决定「显示什么」（文案来自各自的唯一事实源：`assetNotices` /
 * `scaleNotice`）；不持有业务状态（`children === null` 由消费方决定不渲染）。
 */
import { useEffect } from 'react';
import type React from 'react';
import {
  dismissMsOf,
  floatingBaseStyle,
  floatingSlotStyle,
  floatingToneStyle,
  FLOATING_SLOTS,
  type FloatingSlot,
  type NoticeTone,
} from './floatingNotices.js';

export interface FloatingNoticeProps {
  /** 槽位（决定位置与消退策略） */
  slot: FloatingSlot;
  /** 覆盖槽位的语义类别（缺省取槽位自带 tone） */
  tone?: NoticeTone;
  /** 供几何断言与测试定位 */
  testId?: string;
  /** 可选额外 data 属性（如 `data-asset-notice`），保持既有选择器不变 */
  dataAttrs?: Record<string, string | undefined>;
  /** 点击关闭（缺省不响应点击） */
  onClick?: () => void;
  /** 消退触发（`auto` 槽位到点时调用；`manual` 槽位永不调用） */
  onDismiss?: () => void;
  children: React.ReactNode;
}

export function FloatingNotice({
  slot,
  tone,
  testId,
  dataAttrs,
  onClick,
  onDismiss,
  children,
}: FloatingNoticeProps): React.ReactElement {
  const ms = dismissMsOf(slot);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `children` 入 deps 是刻意的
  // —— 内容一变即重置消退计时（与既有 `[commandNotice]` 依赖语义逐字一致）。
  useEffect(() => {
    if (ms === null || !onDismiss) return;
    const timer = setTimeout(onDismiss, ms);
    return () => clearTimeout(timer);
  }, [ms, onDismiss, children]);

  const visual = floatingToneStyle(tone ?? FLOATING_SLOTS[slot].tone);
  const clickable = onClick !== undefined;

  return (
    <div
      {...dataAttrs}
      data-floating-notice={slot}
      data-testid={testId}
      onClick={onClick}
      style={{
        ...floatingSlotStyle(slot),
        ...floatingBaseStyle(),
        ...visual,
        // 可点击时收回 `pointer-events: none`（基础样式默认不挡画布交互）
        ...(clickable ? { pointerEvents: 'auto' as const, cursor: 'pointer' } : {}),
      }}
    >
      {children}
    </div>
  );
}
