/**
 * 画布 overlay 组件集合（从 `MapView.tsx` 拆出，属代码结构规范化 T2）
 *
 * 这三者共同点：都是**屏幕坐标定位**的浮层，锚定节点在世界坐标中的位置，
 * 经 viewport 变换换算到屏幕。与 SVG 画布内的内容（节点/连线）职责不同——
 * 画布内的是可缩放矢量内容，overlay 是常驻尺寸的 HTML 交互层（输入框、滚动区）。
 *
 * 不是什么：不含画布本体（节点渲染、连线路由、指针手势），那些仍在 `MapView`。
 *
 * 拆分性质：纯搬迁，逻辑未改写。
 */
import type { ReactElement } from 'react';
import type { EditableNode, LayoutResult } from '@mindcanvas/kernel';
import { DescBlock, estimateDescHeight } from '../chrome/DescBlock.js';
import { estimateCommentAreaHeight, GrowthCommentPanel } from '../chrome/GrowthCommentPanel.js';
import { estimateNoteAreaHeight } from '../chrome/NoteGrowthPanel.js';
import { nodeAuxiliaryRegions } from './nodeAuxiliary.js';
import { OverlayEditor } from '../edit/OverlayEditor.js';
import type { TokenSet } from '../theme/types.js';
import type { ViewportController } from './viewport.js';

/** DescOverlays 所需的最小布局节点形态（避免与 LayoutResult 具体类型耦合） */
interface LayoutNodeLike {
  node: { id: string; note?: { desc?: unknown } };
  box: { x: number; y: number; w: number; h: number };
  /** 层级（描述区字号 / 行高按它差分） */
  depth: number;
}

/**
 * 幕布描述 overlay 集合（v1.3.0）：遍历**视口内**布局节点，凡 note.desc 非空（或正在编辑）
 * 都在其本体下方渲染引用块。
 *
 * 描述**常驻可见**，内容完整换行显示，超过软上限由描述区内部滚动 ——
 * 没有展开/收缩状态（2026-09-04 简化：此前有 descExpandedIds + expandedNodeIds
 * 两套状态，组合复杂并导致过几何重叠问题）。
 *
 * 性能（v1.3.0 编辑深度优化）：只遍历 visibleNodes（视口裁剪结果），
 * 原实现遍历全量 layout.nodes —— 10K 节点图会为不可见节点创建上万个 div。
 */
export function DescOverlays({
  visible,
  viewport,
  token,
  descEditingId,
  onCommit,
  onCancel,
  fixedNoteIds = new Set(),
  expandedId = null,
  root,
  onJumpToAnchor,
}: {
  /** 视口裁剪后的节点（性能：不遍历全量 layout.nodes —— 10K 图会渲染上万个 div） */
  visible: readonly LayoutNodeLike[];
  viewport: ViewportController;
  token: TokenSet;
  descEditingId: string | null;
  onCommit?: (id: string, text: string) => void;
  onCancel?: () => void;
  /** 固定 note 笔记占据节点最下方的布局区，描述需避开该区。 */
  fixedNoteIds?: ReadonlySet<string>;
  /** 快速注释也占用附属区，描述必须排在它之前。 */
  expandedId?: string | null;
  /** L1：三态解析用树（缺省 → 链接只做语法渲染） */
  root?: EditableNode;
  /** L1：链接跳转回调（缺省 → 链接只渲染不可点） */
  onJumpToAnchor?: (anchor: string) => void;
}) {
  const { k, x, y } = viewport.transform;
  const out: ReactElement[] = [];
  for (const ln of visible) {
    const raw = ln.node.note?.desc;
    const desc = typeof raw === 'string' ? raw : '';
    const isEditing = descEditingId === ln.node.id;
    // 编辑态即使文本为空也要渲染（新建描述的占位）
    if (desc === '' && !isEditing) continue;
    // 高度口径必须与 createDescMeasure **严格一致**：
    //   两者都要把 editing 纳入（同一节点在编辑时 measure 已预留编辑区高度）。
    //   若这里漏传 editing，编辑中的节点本体高度与描述区高度就会错位。
    const dh = estimateDescHeight(desc, isEditing);
    // 编辑中的节点**也有槽位** —— measure 已为其预留（见 createDescMeasure 的
    // descEditingId 参数），描述区画在节点盒内的下半部，节点自己扩张给出编辑区。
    // （早期版本 `hasSlot = desc !== ''` 会让新建描述的编辑框浮出在节点下方，
    //   既不"扩张"也会遮挡邻居。）
    const hasSlot = desc !== '' || isEditing;
    const regions = nodeAuxiliaryRegions(ln.box.h, {
      descHeight: hasSlot ? dh : 0,
      qaHeight: expandedId === ln.node.id ? commentAreaH : 0,
      fixedNoteHeight: fixedNoteIds.has(ln.node.id) ? estimateNoteAreaHeight() : 0,
    });
    const descRegion = regions.desc;
    if (!descRegion) continue;
    out.push(
      <DescBlock
        key={ln.node.id}
        text={desc}
        editing={isEditing}
        token={token}
        x={ln.box.x * k + x}
        y={(ln.box.y + descRegion.y) * k + y}
        width={ln.box.w * k}
        height={dh * k}
        scale={k}
        depth={ln.depth}
        onCommit={(t) => onCommit?.(ln.node.id, t)}
        onCancel={() => onCancel?.()}
        root={root}
        onJumpToAnchor={onJumpToAnchor}
      />,
    );
  }
  return <>{out}</>;
}

/**
 * 展开态注释区高度（定值，与布局 measure 注入共用）。
 * 导出：MapView 侧的布局计算同样需要它，两边必须同一个值。
 */
export const commentAreaH = estimateCommentAreaHeight();

/** 展开节点注释区 overlay：锚定节点本体下方（屏幕坐标），与 SVG 连体 + 内置滚动 */
export function ExpandCommentOverlay({
  expandedId,
  layout,
  viewport,
  token,
  onChange,
  onClose,
  fixedNoteIds = new Set(),
}: {
  expandedId: string;
  layout: LayoutResult;
  viewport: ViewportController;
  token: TokenSet;
  onChange: (qa: string[]) => void;
  onClose: () => void;
  fixedNoteIds?: ReadonlySet<string>;
}) {
  const ln = layout.nodes.find((n) => n.node.id === expandedId);
  if (!ln) return null;
  const qa = ln.node.note?.qa;
  const items = Array.isArray(qa) ? (qa as string[]) : [];
  if (items.length === 0) return null;
  const { k, x, y } = viewport.transform;
  const desc = typeof ln.node.note?.desc === 'string' ? ln.node.note.desc : '';
  const regions = nodeAuxiliaryRegions(ln.box.h, {
    descHeight: desc === '' ? 0 : estimateDescHeight(desc),
    qaHeight: commentAreaH,
    fixedNoteHeight: fixedNoteIds.has(expandedId) ? estimateNoteAreaHeight() : 0,
  });
  const qaRegion = regions.qa;
  if (!qaRegion) return null;
  const sx = ln.box.x * k + x;
  const sy = (ln.box.y + qaRegion.y) * k + y;
  const sw = ln.box.w * k;
  const sh = commentAreaH * k;
  return (
    <GrowthCommentPanel
      items={items}
      onChange={onChange}
      onClose={onClose}
      token={token}
      x={sx}
      y={sy}
      width={sw}
      height={sh}
      scale={k}
    />
  );
}

/** 节点文本内联编辑 overlay（绝对定位 input；Enter 提交 / Esc 取消 / blur 提交
 *  v1.3.0：Shift+Enter 切到描述编辑，经 onDescEditRequest 上报
 *  FO-C1：框内大纲行传 `wrap` → 换行 textarea（宽度 = 行盒宽、高度随内容） */
export function NodeTextOverlay({
  editingId,
  layout,
  viewport,
  token,
  wrap = false,
  onCommit,
  onCancel,
  onDescEditRequest,
  onTabGrow,
}: {
  editingId: string;
  layout: LayoutResult;
  viewport: ViewportController;
  token: TokenSet;
  /** FO-C1：该节点是框内大纲行（紧凑折行行盒）→ 换行编辑模式 */
  wrap?: boolean;
  onCommit?: (id: string, text: string) => void;
  onCancel?: () => void;
  onDescEditRequest?: (id: string) => void;
  /** G10：编辑态 Tab → 提交 (editingId, text) 并建子节点 */
  onTabGrow?: (id: string, text: string) => void;
}) {
  const ln = layout.nodes.find((n) => n.node.id === editingId);
  if (!ln || !onCommit) return null;
  const { k, x, y } = viewport.transform;
  const sx = ln.box.x * k + x;
  const sy = ln.box.y * k + y;
  const sw = ln.box.w * k;
  const sh = ln.box.h * k;
  const initial = ln.node.type === 'text' ? (ln.node.text ?? '') : '';
  return (
    <OverlayEditor
      x={sx}
      y={sy}
      w={sw}
      h={sh}
      initial={initial}
      token={token}
      depth={ln.depth}
      root={ln.depth === 0}
      scale={k}
      wrap={wrap}
      onCommit={(t) => onCommit(editingId, t)}
      onCancel={() => onCancel?.()}
      // v1.3.0：主题编辑态 Shift+Enter → 切换到该节点的描述编辑（幕布语义）
      onRequestDesc={onDescEditRequest ? () => onDescEditRequest(editingId) : undefined}
      // G10：Tab → 提交并建子节点（未注入时不启用，Tab 走浏览器默认行为）
      onTabGrow={onTabGrow ? (t) => onTabGrow(editingId, t) : undefined}
    />
  );
}
