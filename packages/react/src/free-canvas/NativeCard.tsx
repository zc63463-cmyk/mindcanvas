/**
 * NativeCard —— 自由画布原生卡（FC-C：整卡 CSS 3D 翻面 + 添加背面 + 当前面编辑）。
 *
 * 3D 契约（与导图 `chrome/FlipCard` 同款 CSS）：外层定位卡（perspective 900）→
 * 内层 `preserve-3d` + `rotateY(180deg)`（0.45s 缓动）→ front/back 两 face
 * （`backface-visibility: hidden`）。锚点 `data-flip-state={face}`。
 * **自写**不包 FlipCard：两壳皮肤与其内建玻璃 face 样式冲突，且 face 需由 doc 字符串驱动
 * 而非布尔翻转态（理由见 FC-C 报告）。
 *
 * 编辑口径（对齐 DescBlock / NoteBackEditor 实测口径）：
 *   - 非受控 textarea（defaultValue，防 IME/焦点抖动）；进入编辑 focus + 光标到末尾
 *   - 失焦提交 / Shift+Enter 提交 / Esc 取消；Enter 换行（不拦截）；提交上抛原文不 trim
 *   - 「无改动不上抛」由本组件对比当前面文本；退出编辑由宿主 actions.closeEdit 收口
 *
 * FC-D：`tool === 'connect'` 时卡片手势让位给连线（pointerdown 从本卡启动，不拖移/不编辑）。
 */
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { nativeBackEnabled, type Face, type NativeFrontPayload, type NativePlacement } from '@mindcanvas/free-canvas';
import { useCompositionCommitGuard } from '../edit/compositionGuard.js';
import { CHROME } from '../theme/tokens.js';
import type { CanvasTool } from './toolTypes.js';

/** 拖拽判定阈值（px）：小于视为单纯点选 */
export const DRAG_SLOP = 3;
/** 翻面动效（与 FlipCard 同款 easing） */
const FLIP_EASING = 'cubic-bezier(.2,.7,.3,1)';
const FLIP_MS = 450;

export interface CanvasCardActions {
  select: (placementUuid: string) => void;
  /** 拖移提交（世界坐标） */
  move: (placementUuid: string, x: number, y: number) => void;
  /** 请求进入某面编辑（双击 / 菜单） */
  requestEdit: (placementUuid: string, face: Face) => void;
  /** 退出编辑态 */
  closeEdit: (placementUuid: string) => void;
  /** 翻面（无 back no-op） */
  toggleFace: (placementUuid: string) => void;
  /** 添加背面（模型层 face 切到 back；随后进入编辑） */
  addBack: (placementUuid: string) => void;
  commitFront: (placementUuid: string, front: NativeFrontPayload) => void;
  commitBack: (placementUuid: string, body: string) => void;
  remove: (placementUuid: string) => void;
  /** 右键菜单（宿主渲染；坐标为客户端坐标） */
  openMenu: (placementUuid: string, clientX: number, clientY: number) => void;
  /** 连线工具：从该卡启动一条连线（屏幕坐标） */
  beginConnect: (placementUuid: string, clientX: number, clientY: number) => void;
}

export interface NativeCardProps {
  placement: NativePlacement;
  /** 当前视口缩放：屏幕位移 → 世界位移换算用 */
  scale: number;
  selected: boolean;
  /** 当前正在编辑的面（null = 非编辑态） */
  editingFace: Face | null;
  /** 当前工具（connect 时卡片手势让位给连线） */
  tool: CanvasTool;
  actions: CanvasCardActions;
}

const STICKY_SKIN: CSSProperties = {
  background: 'linear-gradient(180deg, #fff7cf, #ffeaa2)',
  color: '#4b3f1d',
  border: '1px solid rgba(173,143,61,.45)',
  borderRadius: 6,
  boxShadow: '0 6px 18px rgba(0,0,0,.30)',
};

const PANEL_SKIN: CSSProperties = {
  background: CHROME.panelBgStrong,
  color: CHROME.text,
  border: `1px solid ${CHROME.panelBorder}`,
  borderRadius: CHROME.radius,
  boxShadow: CHROME.shadow,
  backdropFilter: 'blur(14px) saturate(1.3)',
  WebkitBackdropFilter: 'blur(14px) saturate(1.3)',
};

/** 面基座：3D 背面隐藏 + 绝对铺满（皮肤在其上叠加） */
const FACE_BASE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  boxSizing: 'border-box',
  padding: 10,
};

const bodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontSize: CHROME.fontSize,
  lineHeight: 1.5,
};

interface DragState {
  pointerId: number;
  fromX: number;
  fromY: number;
  /** 按下瞬间的世界坐标（拖拽全程以此为基准，避免累计误差） */
  originX: number;
  originY: number;
}

/** 面文本编辑器（非受控；口径同 NoteBackEditor） */
function FaceEditor({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const ta = taRef.current;
    if (ta === null) return;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, []);
  // MG-R1：统一的组合提交边界（失焦被挡 → 组合结束后用已确认文字补提交）
  const { onCompositionStart, onCompositionEnd, allowCommit } = useCompositionCommitGuard(
    (text) => {
      onCommit(text);
    },
  );
  const commit = () => {
    // 组合未结束时框里是**未确认的候选串**，blur（点工具栏 / 模态抢焦点 / 点到别处）
    // 不得把它当正文提交 —— 提交等于截断正在输入的文字。
    if (!allowCommit()) return;
    onCommit(taRef.current?.value ?? initial);
  };
  return (
    <textarea
      ref={taRef}
      data-fc-editor
      defaultValue={initial}
      placeholder="输入内容…（Shift+Enter 完成，Enter 换行）"
      onPointerDown={(e) => e.stopPropagation()}
      onCompositionStart={onCompositionStart}
      onCompositionEnd={(e) => onCompositionEnd(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && e.shiftKey) {
          // Shift+Enter：提交（同 DescBlock / NoteBackEditor 键位；Enter 留给换行）
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      style={{
        flex: 1,
        minHeight: 0,
        width: '100%',
        boxSizing: 'border-box',
        border: '1px solid rgba(0,0,0,.22)',
        borderRadius: CHROME.radiusSmall,
        padding: '4px 6px',
        background: 'rgba(255,255,255,.22)',
        color: 'inherit',
        fontFamily: 'ui-monospace, Consolas, monospace',
        fontSize: CHROME.fontSizeSmall,
        lineHeight: 1.6,
        resize: 'none',
        outline: 'none',
      }}
    />
  );
}

function frontTextOf(placement: NativePlacement): string {
  const front = placement.front;
  return front.contentKind === 'plain' ? front.text : front.body;
}

export function NativeCard({ placement, scale, selected, editingFace, tool, actions }: NativeCardProps) {
  const dragRef = useRef<DragState | null>(null);
  const [hovered, setHovered] = useState(false);
  const uuid = placement.placementUuid;
  const { x, y, w, h } = placement.transform;
  const backEnabled = nativeBackEnabled(placement.back);
  const frontText = frontTextOf(placement);
  const backText = placement.back?.body ?? '';

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation(); // 卡片手势不启动宿主 pan
    if (tool === 'connect') {
      // 连线工具：卡片不拖移，从本卡启动连线
      actions.select(uuid);
      actions.beginConnect(uuid, e.clientX, e.clientY);
      return;
    }
    actions.select(uuid);
    dragRef.current = {
      pointerId: e.pointerId,
      fromX: e.clientX,
      fromY: e.clientY,
      originX: x,
      originY: y,
    };
    const onMoveEv = (ev: PointerEvent) => {
      const cur = dragRef.current;
      if (cur === null || ev.pointerId !== cur.pointerId) return;
      const dx = ev.clientX - cur.fromX;
      const dy = ev.clientY - cur.fromY;
      if (Math.hypot(dx, dy) < DRAG_SLOP) return;
      actions.move(uuid, cur.originX + dx / scale, cur.originY + dy / scale);
    };
    const onUpEv = (ev: PointerEvent) => {
      const cur = dragRef.current;
      if (cur === null || ev.pointerId !== cur.pointerId) return;
      dragRef.current = null;
      window.removeEventListener('pointermove', onMoveEv);
      window.removeEventListener('pointerup', onUpEv);
      window.removeEventListener('pointercancel', onUpEv);
    };
    window.addEventListener('pointermove', onMoveEv);
    window.addEventListener('pointerup', onUpEv);
    window.addEventListener('pointercancel', onUpEv);
  };

  /** 双击 = 编辑当前面（不翻面）；点在编辑框内 / 连线工具下不触发 */
  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (tool === 'connect') return;
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('[data-fc-editor]') != null) return;
    actions.requestEdit(uuid, placement.face);
  };

  const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    actions.openMenu(uuid, e.clientX, e.clientY);
  };

  const commitFrontEdit = (next: string) => {
    if (next !== frontText) {
      const front: NativeFrontPayload =
        placement.front.contentKind === 'plain'
          ? { contentKind: 'plain', text: next }
          : { contentKind: 'markdown', body: next };
      actions.commitFront(uuid, front);
    }
    actions.closeEdit(uuid);
  };

  const commitBackEdit = (next: string) => {
    if (next !== backText) actions.commitBack(uuid, next);
    actions.closeEdit(uuid);
  };

  const skin = placement.shell === 'sticky-classic' ? STICKY_SKIN : PANEL_SKIN;
  const flipped = placement.face === 'back';

  return (
    <div
      data-fc-card
      data-fc-uuid={uuid}
      data-fc-shell={placement.shell}
      data-fc-face={placement.face}
      data-flip-state={placement.face}
      onPointerDown={onPointerDown}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        perspective: 900,
        zIndex: placement.zIndex,
        ...(selected ? { outline: `2px solid ${CHROME.neon}`, outlineOffset: 2 } : null),
      }}
    >
      <div
        data-fc-flip-stage
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          transformStyle: 'preserve-3d',
          transition: `transform ${FLIP_MS}ms ${FLIP_EASING}`,
          transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}
      >
        <div data-fc-face="front" style={{ ...FACE_BASE, ...skin }}>
          {editingFace === 'front' ? (
            <FaceEditor initial={frontText} onCommit={commitFrontEdit} onCancel={() => actions.closeEdit(uuid)} />
          ) : (
            <div data-fc-front style={bodyStyle}>
              {frontText}
            </div>
          )}
        </div>
        {(backEnabled || editingFace === 'back') && (
          <div data-fc-face="back" style={{ ...FACE_BASE, ...skin, transform: 'rotateY(180deg)' }}>
            {editingFace === 'back' ? (
              <FaceEditor
                initial={backText}
                onCommit={commitBackEdit}
                onCancel={() => actions.closeEdit(uuid)}
              />
            ) : (
              <div data-fc-back-body style={bodyStyle}>
                {backText}
              </div>
            )}
          </div>
        )}
      </div>
      {backEnabled && (
        <button
          type="button"
          data-fc-flip
          title="翻面"
          aria-label="翻面"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            actions.toggleFace(uuid);
          }}
          style={{
            position: 'absolute',
            right: 6,
            top: 6,
            width: 22,
            height: 22,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `1px solid ${CHROME.panelBorder}`,
            borderRadius: 999,
            background: CHROME.panelBgStrong,
            color: CHROME.text,
            fontSize: 12,
            lineHeight: 1,
            cursor: 'pointer',
            opacity: hovered ? 1 : 0,
            transition: 'opacity .15s ease',
            backdropFilter: 'blur(8px)',
            zIndex: 2,
          }}
        >
          ⟳
        </button>
      )}
    </div>
  );
}
