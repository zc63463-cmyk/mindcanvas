/**
 * GrowthCommentPanel —— 节点"向下生长"展开后的注释内容区（取代 popover 形态）。
 *
 * 形态：紧贴选中节点下方、与节点连体（背景由上层 SVG 注释区 rect 提供，本组件透明，
 * 视觉上节点像往下长出了一块）。参与布局：上层 measure 已把展开节点加宽加高，
 * 布局自动把其他节点推开——本组件只是填充让出的屏幕区域。
 *
 * 缩放一致性（关键）：
 * - 注释区 rect 是 SVG 世界坐标，随视口 k 缩放；本组件是 HTML 层。
 * - 若内容用固定像素，缩小视图时内容会溢出/被裁，放大视图时又显得过小——
 *   即"文字被遮挡/错位"。因此内部所有尺寸与字号都乘 scale（= 视口 k），
 *   与 SVG 注释区严格对齐，任意缩放级别都完整显示、无裁剪。
 *
 * 行为：
 * - 内置滚动：条目区 max-height + overflow-y auto（滑轨；多条目时上下滑动）
 * - 行内编辑：双击条目进入；Enter 提交 / Esc 取消 / blur 提交；空文本视为取消
 * - 增删：+ 添加 / ✕ 删除；写回经 onChange（上层 → controller.updateNote → TreeOp → history）
 * - × 关闭：onClose（委托上层收起；单一展开）
 * - 生长动画：外层以 max-height + opacity 过渡（从 0 长到目标高度）
 *
 * 坐标与尺寸由上层按视口换算后传入（屏幕坐标 + 尺寸 + scale），组件不参与位置决策。
 */
import { useEffect, useRef, useState } from 'react';
import { CHROME } from '../theme/tokens.js';
import type { TokenSet } from '../theme/types.js';

export interface GrowthCommentPanelProps {
  items: readonly string[];
  onChange: (qa: string[]) => void;
  onClose: () => void;
  token: TokenSet;
  /** 屏幕坐标（注释区左上角，已由上层按节点 + 本体高换算） */
  x: number;
  y: number;
  width: number;
  /** 注释区高度（含滚动区；由布局 COMMENT_AREA_H 决定，屏幕 px） */
  height: number;
  /** 视口缩放 k（内容随地图缩放，与 SVG 注释区对齐；缺省 1） */
  scale?: number;
}

export const GCP_ROW_H = 18;
export const GCP_INPUT_H = 26;
export const GCP_MAX_ROWS = 4;
export const GCP_HEADER_H = 24;
export const GCP_PAD = 6;
/** 展开态节点固定加宽值（用户选择：固定加宽到定值） */
export const GROW_EXPAND_W = 220;

export function GrowthCommentPanel({
  items,
  onChange,
  onClose,
  token,
  x,
  y,
  width,
  height,
  scale = 1,
}: GrowthCommentPanelProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState('');
  const [mounted, setMounted] = useState(false); // 生长动画起始态（max-height 0 / opacity 0）
  const inputRef = useRef<HTMLInputElement | null>(null);
  const addRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // 生长动画：挂载后下一帧还原 → max-height 从 0 过渡到目标
  useEffect(() => {
    const t = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(t);
  }, []);

  useEffect(() => {
    if (editingIndex !== null) inputRef.current?.select();
  }, [editingIndex]);
  useEffect(() => {
    if (adding) addRef.current?.focus();
  }, [adding]);
  useEffect(() => {
    if (editingIndex !== null && editingIndex >= items.length) setEditingIndex(null);
  }, [items, editingIndex]);

  const startEdit = (i: number): void => {
    setEditingIndex(i);
    setDraft(items[i] ?? '');
  };
  const commitEdit = (): void => {
    if (editingIndex === null) return;
    const text = draft.trim();
    const next = items.map((q, j) => (j === editingIndex ? text || q : q)).filter((q) => q !== '');
    onChange(next);
    setEditingIndex(null);
  };
  const startAdd = (): void => {
    setAdding(true);
    setAddDraft('');
  };
  const commitAdd = (): void => {
    const text = addDraft.trim();
    if (text === '') {
      setAdding(false);
      return;
    }
    onChange([...items, text]);
    setAddDraft('');
  };
  const stopBubble = (e: React.SyntheticEvent): void => {
    e.stopPropagation();
  };

  if (items.length === 0) return null;

  // 缩放后的内部尺寸（与视口 k 对齐，避免缩小裁剪 / 放大过小）
  const s = scale;
  const pad = GCP_PAD * s;
  const gap = 2 * s;
  const headerH = GCP_HEADER_H * s;
  const rowH = GCP_ROW_H * s;
  const inputH = GCP_INPUT_H * s;
  const scrollMax = GCP_MAX_ROWS * GCP_ROW_H * s;
  const small = CHROME.fontSizeSmall * s;

  return (
    <div
      data-grow-comment
      role="region"
      aria-label="快速注释"
      onPointerDown={stopBubble}
      onClick={stopBubble}
      style={{
        position: 'absolute',
        top: y,
        left: x,
        width,
        height,
        background: 'transparent',
        padding: `0 ${pad}px`,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap,
        fontFamily: CHROME.fontFamily,
        color: CHROME.text,
        overflow: 'hidden',
        maxHeight: mounted ? height : 0,
        opacity: mounted ? 1 : 0,
        transition: `max-height 160ms ${token.motion.easing}, opacity 160ms ${token.motion.easing}`,
        pointerEvents: 'auto',
      }}
    >
      {/* 头部：标题 + 计数 + 关闭 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6 * s,
          height: headerH,
          padding: `0 ${4 * s}px`,
          flex: 'none',
        }}
      >
        <span style={{ color: token.color.annotationAccent, fontSize: small, fontWeight: 600 }}>
          快速注释
        </span>
        <span
          style={{
            background: token.color.annotationBadge,
            color: token.color.annotationAccent,
            borderRadius: 8 * s,
            padding: `0 ${6 * s}px`,
            fontSize: 10 * s,
            lineHeight: `${14 * s}px`,
            fontWeight: 600,
          }}
        >
          {items.length}
        </span>
        <span style={{ flex: 1 }} />
        <button
          aria-label="关闭快速注释"
          data-gcp-close
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          style={{
            border: 'none',
            background: 'transparent',
            color: CHROME.textMuted,
            cursor: 'pointer',
            fontSize: 14 * s,
            lineHeight: 1,
            padding: 0,
            width: 18 * s,
            height: 18 * s,
          }}
        >
          ×
        </button>
      </div>
      {/* 条目列表：内置滚动 */}
      <div
        ref={listRef}
        data-gcp-scroll
        style={{
          flex: '1 1 0',
          minHeight: 0,
          maxHeight: scrollMax,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap,
          paddingRight: 2 * s,
        }}
      >
        {items.map((q, i) =>
          editingIndex === i ? (
            <input
              key={`${i}:editing`}
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitEdit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setEditingIndex(null);
                }
              }}
              onBlur={commitEdit}
              data-gcp-input-editing
              style={{
                height: rowH,
                border: `1px solid ${token.color.annotationAccent}`,
                background: 'rgba(0,0,0,.2)',
                color: CHROME.text,
                borderRadius: 4 * s,
                padding: `0 ${6 * s}px`,
                fontSize: small,
                fontFamily: CHROME.fontFamily,
                outline: 'none',
                flex: 'none',
              }}
            />
          ) : (
            <div
              key={i}
              onDoubleClick={(e) => {
                e.stopPropagation();
                startEdit(i);
              }}
              data-gcp-item={i}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 6 * s,
                background: token.color.annotationBadge,
                borderLeft: `${2 * s}px solid ${token.color.annotationAccent}`,
                borderRadius: 4 * s,
                padding: `${3 * s}px ${6 * s}px`,
                minHeight: rowH,
                fontSize: small,
                lineHeight: 1.35,
                color: CHROME.text,
                cursor: 'text',
                flex: 'none',
              }}
              title={q}
            >
              <span style={{ flex: 1, minWidth: 0, whiteSpace: 'normal', wordBreak: 'break-word' }}>
                {q}
              </span>
              <button
                aria-label="删除注释"
                data-gcp-delete
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(items.filter((_, j) => j !== i));
                }}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: token.color.annotationAccent,
                  cursor: 'pointer',
                  fontSize: 12 * s,
                  lineHeight: 1,
                  padding: 0,
                  flex: 'none',
                  marginTop: 2 * s,
                }}
              >
                ✕
              </button>
            </div>
          ),
        )}
      </div>
      {/* 添加输入 */}
      <div style={{ flex: 'none', height: inputH, paddingBottom: pad }}>
        {adding ? (
          <input
            ref={addRef}
            value={addDraft}
            onChange={(e) => setAddDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                commitAdd();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setAdding(false);
                setAddDraft('');
              }
            }}
            onBlur={commitAdd}
            placeholder="写下批注…（回车提交）"
            data-gcp-input-adding
            style={{
              width: '100%',
              height: inputH,
              border: `1px solid ${token.color.annotationAccent}`,
              background: 'rgba(0,0,0,.2)',
              color: CHROME.text,
              borderRadius: 4 * s,
              padding: `0 ${8 * s}px`,
              fontSize: small,
              fontFamily: CHROME.fontFamily,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              startAdd();
            }}
            aria-label="新增注释"
            data-gcp-add
            style={{
              width: '100%',
              height: inputH,
              border: `1px dashed ${token.color.annotationAccent}`,
              background: 'transparent',
              color: token.color.annotationAccent,
              borderRadius: 4 * s,
              padding: `0 ${8 * s}px`,
              fontSize: small,
              fontFamily: CHROME.fontFamily,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4 * s,
              boxSizing: 'border-box',
            }}
          >
            + 添加批注
          </button>
        )}
      </div>
    </div>
  );
}

/** 注释区布局高度（定值：头部 + 4 行滚动 + 输入 + 内边距）——与 measure 展开注入共用 */
export function estimateCommentAreaHeight(): number {
  return GCP_HEADER_H + GCP_MAX_ROWS * GCP_ROW_H + GCP_INPUT_H + GCP_PAD * 2;
}
