/**
 * 玻璃翻卡组件（设计报告「翻卡适配评估」交互具象化）：
 * 点击翻转 3D rotateY，正面展示摘要、背面展示详情（节点 note）。
 * 视觉：深色半透明 + 霓虹强调（CHROME 恒定）；可受控也可自持状态。
 * P1 收尾：`interactive`（缺省 true）——false 去按钮语义（受控 no-op 宿主用）；锚点始终输出。
 */
import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { CHROME } from '../theme/tokens.js';

/** 翻卡动效（glass 主题 motion 气质） */
const FLIP_EASING = 'cubic-bezier(.2,.7,.3,1)';

export interface FlipCardProps {
  front: ReactNode;
  back: ReactNode;
  /** 受控翻转态（缺省自持） */
  flipped?: boolean;
  onFlip?: (flipped: boolean) => void;
  /**
   * 交互开关（缺省 true = 点击/键盘可翻）。false：不渲染 role/aria/tabIndex/键盘与整卡点击，
   * cursor 也不给 pointer —— 供「受控 no-op」宿主（如固定 note 面板，翻转由面板头按钮驱动）。
   */
  interactive?: boolean;
  width?: number;
  height?: number;
  title?: string;
  style?: CSSProperties;
}

export function FlipCard({
  front,
  back,
  flipped: contrl,
  onFlip,
  interactive = true,
  width,
  height,
  title,
  style,
}: FlipCardProps) {
  const [self, setSelf] = useState(false);
  const isFlipped = contrl ?? self;
  const set = (v: boolean) => {
    if (contrl === undefined) setSelf(v);
    onFlip?.(v);
  };
  const handleKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      set(!isFlipped);
    }
  };
  const face: CSSProperties = {
    position: 'absolute',
    inset: 0,
    backfaceVisibility: 'hidden',
    WebkitBackfaceVisibility: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    borderRadius: CHROME.radiusSmall,
    overflow: 'hidden',
    border: `1px solid ${CHROME.panelBorder}`,
    background: CHROME.panelBg,
    boxShadow: CHROME.shadow,
    transition: `transform 0.45s ${FLIP_EASING}`,
  };
  return (
    <div
      data-flip-card
      data-flip-state={isFlipped ? 'back' : 'front'}
      role={interactive ? 'button' : undefined}
      aria-pressed={interactive ? isFlipped : undefined}
      aria-label={interactive ? title : undefined}
      onClick={interactive ? () => set(!isFlipped) : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? handleKey : undefined}
      style={{
        width,
        height,
        perspective: 900,
        cursor: interactive ? 'pointer' : undefined,
        ...style,
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          transformStyle: 'preserve-3d',
        }}
      >
        <div style={{ ...face, transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}>
          {front}
        </div>
        <div
          style={{
            ...face,
            transform: isFlipped ? 'rotateY(0deg)' : 'rotateY(-180deg)',
            borderColor: CHROME.neon,
          }}
        >
          {back}
        </div>
      </div>
    </div>
  );
}
