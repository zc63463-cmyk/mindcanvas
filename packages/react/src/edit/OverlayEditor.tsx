/**
 * OverlayEditor —— 节点文本内联编辑（F2 进入 / Enter 提交 / Esc 取消 / blur 提交）。
 * 绝对定位在节点盒上方（屏幕坐标由 MapView 计算）；输入框事件 stopPropagation
 * 防止冒泡到全局快捷键（避免输入时误触 Tab/Enter 新建）。
 * G10：注入 onTabGrow 后，编辑态 Tab = 提交 + 建子节点（连续录入），不再只是拦截。
 *
 * 视觉口径（K4 后补）：与 NodeG 保持一致
 * - 字号 / 字重：随 depth 走（叶 sizeLeaf / 分支 size；根 weightRoot）
 * - 垂直居中：lineHeight = 节点盒高
 * - 选中态：selection 描边 + 柔和 inset 阴影 + 节点同底色（与玻璃主题一致）
 * - 全选：setSelectionRange（不再 execCommand 避免遗留高亮）
 *
 * 换行模式（FO-C1 · `wrap`）：框内大纲行是**紧凑折行**行（行盒 = pad + LINE_H×行数），
 * 单行 input + `lineHeight = 盒高` 会把多行文本压成一行。此时改用 `<textarea>`：
 * 宽度 = 行盒宽（≈ 行内容宽）、自动换行、高度随内容增高（最小 = 行盒高），行高固定
 * `LINE_H`（与 `FrameOutline` 的正文行同口径 → 展示与编辑不错位）。
 * **提交纪律完全不变**：Enter 提交 / Esc 取消 / blur 提交 / Shift+Enter 切描述 / Tab 生长。
 */
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { FRAME_OUTLINE_ROW_PAD_X, FRAME_OUTLINE_ROW_PAD_Y, LINE_H } from '@mindcanvas/kernel';
import type { TokenSet } from '../theme/types.js';

export interface OverlayEditorProps {
  x: number;
  y: number;
  w: number;
  h: number;
  initial: string;
  token: TokenSet;
  /** 节点深度（决定字号字重） */
  depth: number;
  /** 是否根节点（决定字重） */
  root: boolean;
  /** 视口缩放（k）：所有边框/阴影按 k 缩放保持比例 */
  scale: number;
  /**
   * FO-C1：换行编辑模式（框内大纲行）——textarea + 自动换行 + 高度随内容。
   * 缺省 false = 节点卡单行 input（`lineHeight = 盒高`，现行为不变）。
   */
  wrap?: boolean;
  onCommit: (text: string) => void;
  onCancel: () => void;
  /**
   * v1.3.0：Shift+Enter 请求切换到「描述编辑」（幕布「切换主题与描述」语义）。
   * 未注入时 Shift+Enter 退化为普通提交（向后兼容既有行为）。
   */
  onRequestDesc?: () => void;
  /**
   * G10：编辑态 Tab = 提交当前文本 + 建子节点（连续录入不打断）。
   * 由上层统一完成「提交 → 建子 → 进入新节点编辑」——本组件不自行 commit，
   * 避免与上层重复调用 updateText 而在 undo 栈里留下两条记录。
   * 未注入时 Tab 退化为浏览器默认焦点跳转（向后兼容）。
   */
  onTabGrow?: (text: string) => void;
}

export function OverlayEditor({
  x,
  y,
  w,
  h,
  initial,
  token,
  depth,
  root,
  scale,
  wrap = false,
  onCommit,
  onCancel,
  onRequestDesc,
  onTabGrow,
}: OverlayEditorProps) {
  const [value, setValue] = useState(initial);
  const escapedRef = useRef(false);
  const committedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapRef = useRef<HTMLTextAreaElement | null>(null);

  // 节点本体口径：叶 = sizeLeaf / 分支 = size；根 = weightRoot
  const isLeaf = depth >= 2;
  const fontSize = (isLeaf ? token.font.sizeLeaf : token.font.size) * scale;
  const fontWeight = root ? token.font.weightRoot : token.font.weight;
  // 行高：节点卡 = 盒高（与 NodeG LINE_H 视觉等价：单行占满盒高）；
  // 换行模式 = LINE_H（与 FrameOutline 正文行同口径 → 展示/编辑逐行对齐）
  const lineHeight = wrap ? LINE_H * scale : h;
  // 边距：节点卡内 padding 8px 跟节点 contentX 一致；框内行用内核折行口径常量
  // （折行宽 = 行宽 - 2×padX，必须与 frameRowMetrics 同值）；边框随 k 缩放
  const padX = (wrap ? FRAME_OUTLINE_ROW_PAD_X : 8) * scale;
  const padY = wrap ? FRAME_OUTLINE_ROW_PAD_Y * scale : 0;
  const borderW = 1.5 * scale;
  const shadowBlur = 6 * scale;
  const insetBlur = 2 * scale;

  useEffect(() => {
    const el = wrap ? wrapRef.current : inputRef.current;
    if (!el) return;
    el.focus();
    // 全选便于覆盖输入（避免 execCommand 副作用；用原生 selection API）
    try {
      el.setSelectionRange(0, value.length);
    } catch {
      /* number 类型 input 才抛——我们用的是 text，忽略 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 换行模式：高度随内容（最小 = 行盒高 h）。写法上先置 auto 再量 scrollHeight，
   * 否则 textarea 只会越长越高（无法随删字回缩）。DOM 无布局引擎（jsdom）时
   * scrollHeight = 0 → 退化为 h，不虚构高度。
   * 注意：`height` 由本 effect 掌握，style 里只给 `minHeight`，避免 React 重渲染打架。
   */
  useEffect(() => {
    if (!wrap) return;
    const el = wrapRef.current;
    if (el === null) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(h, el.scrollHeight)}px`;
  }, [wrap, h, value]);

  const commit = (text: string): void => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit(text);
  };

  const cancel = (): void => {
    if (committedRef.current) return;
    escapedRef.current = true;
    onCancel();
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    e.stopPropagation(); // 关键：拦截全局快捷键（Tab/Enter 不新建）
    // v1.3.0：Shift+Enter = 切换「主题 → 描述」编辑（幕布语义），优先于提交。
    // 原实现把 Shift+Enter 也当 Enter 提交，"切换主题与描述" 快捷键因此在编辑态失效。
    if (e.key === 'Tab' && onTabGrow) {
      // G10：提交 + 建子节点。单行 input 不需要 Tab 缩进，原本拦掉它只换来
      // 浏览器默认焦点跳转。置 committedRef 防止随后卸载触发 onBlur 二次提交。
      e.preventDefault();
      committedRef.current = true;
      onTabGrow(value);
      return;
    }
    if (e.key === 'Enter' && e.shiftKey && onRequestDesc) {
      e.preventDefault();
      commit(value); // 先落盘主题文本（防丢失），再切到描述编辑
      onRequestDesc();
      return;
    }
    // 换行模式：Enter 仍是**提交**（不是插入换行）——与节点编辑纪律逐项一致；
    // 换行由宽度自动折行产生，不需要用户敲回车。
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };

  const handleBlur = (): void => {
    if (!escapedRef.current) commit(value);
  };

  /** 两种模式共用的控件外观（定位 / 底色 / 字体 / 描边 / 阴影） */
  const shared = {
    position: 'absolute',
    left: x,
    top: y,
    width: w,
    boxSizing: 'border-box',
    // 边角对齐节点：节点圆角随尺度变换（≤8 截断 8 防内凹）
    borderRadius: Math.min(token.radius.node, h / 2),
    // 背景：实体节点基色（跨主题统一，作为编辑器独立控件底色；焦点在编辑器而非节点）
    background: token.color.entityFill,
    // 文字：节点文本色
    color: token.color.text,
    // 字体 / 字号 / 字重
    fontFamily: token.font.family,
    fontSize,
    fontWeight,
    lineHeight: `${lineHeight}px`,
    // 选中描边：selection 令牌色 + 1.5px 按 k 缩放
    border: `${borderW}px solid ${token.color.selection}`,
    outline: 'none',
    // 柔和焦点阴影：外发光 + 内陷（玻璃气质「按下去」感）
    boxShadow: `0 0 ${shadowBlur}px ${token.color.selection}55, inset 0 ${insetBlur}px ${insetBlur * 2}px rgba(0,0,0,0.35)`,
    // 输入框内文字"无感全选"：caret 用 selection 色
    caretColor: token.color.selection,
  } as const;

  if (wrap) {
    return (
      <textarea
        ref={wrapRef}
        data-overlay-editor="wrap"
        rows={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        spellCheck={false}
        autoComplete="off"
        style={{
          ...shared,
          // 初始/最小高度 = 行盒高；实际高度由上方 effect 按内容增高
          minHeight: h,
          padding: `${padY}px ${padX}px`,
          // 自动换行（不是 nowrap/ellipsis）：与展示态同宽同折行
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          overflow: 'hidden',
          resize: 'none',
          display: 'block',
        }}
      />
    );
  }

  return (
    <input
      ref={inputRef}
      data-overlay-editor="single"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      spellCheck={false}
      autoComplete="off"
      style={{
        ...shared,
        height: h,
        // 垂直居中（lineHeight = h 让浏览器自动 baseline 居中）
        padding: `0 ${padX}px`,
      }}
    />
  );
}
