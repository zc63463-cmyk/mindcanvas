/**
 * FrameOutline —— 成框节点的**框壳 + 框内可写大纲**（FO-B2 · 设计 §4.3–4.5 / §5.1）。
 *
 * 是什么（一个框根 = 一个浮层）：
 * - **框壳**：外壳尺寸 = 大纲包围盒 + padding（设计 §5.1），圆角面板视觉；
 * - **大纲行** = `partitionFrameSubtree` 的大纲层（`d ∈ [0, depth]`，含框头），行盒**直接取
 *   B1 岛产出**（`boxOf` → `layout.nodes` 盒表）——组件不重算布局，屏幕位置与画布几何同源；
 *   FO-C1：框内行（`d ≥ 1`）是**紧凑行**——盒高由内核 `frameRowMetrics` 按固定内容列宽
 *   折行算出（pad + LINE_H × 行数），故正文用 `whiteSpace: normal` **完整换行**显示：
 *   既没有 nowrap/ellipsis 裁切，也不再把行画成节点卡（少圆角、小内边距、无卡底/阴影）。
 * - 单击行 = 选中；双击 text 行 = 既有内联编辑入口（`onEditStart` → controller.startEdit，
 *   输入框由画布既有 `NodeTextOverlay` 按同一盒定位；编辑态本组件让位自身文本，防双层）；
 * - image/entity 行 = **只读占位**（设计 §4.3：一期不改 url / ref）；
 * - 结构键与 `edit/keys.ts` 对齐（Tab=建子 / Enter=建同级 / Shift+Tab=缩进 / Ctrl+Shift+Tab=反缩进），
 *   一律转发宿主（`onFrameKey`）→ controller；**跨 depth 边界的改层级由 controller 层守卫 no-op**
 *   （FO-B1 `crossesFrameDepthBoundary`）——本组件不重复判定，避免两套口径漂移；
 * - 幕布注释（FO-FIX2）：行内**不渲染**「注释 …」旁侧预览（与行下 DescBlock 内容同源、重复）；
 *   注释仍由既有幕布体系显示（DescBlock / 附属区，高度经宿主 rowAuxH 预留），
 *   Shift+Enter → `onDescEdit`（复用既有幕布描述编辑，勿新 WYSIWYG）。
 *
 * 不是什么：
 * - 不画深层空间节点（`d > depth` 仍是画布节点盒，可正常选中/拖拽）；
 * - 不做框内 ▸ 折叠（§5.2 一期不做，避免与文档 collapsed 分叉）；
 * - 不接管 Ctrl+D `OutlinePanel`（那份仍**只读**）；
 * - 不实现拖拽改层级（跨 depth 一期 no-op，同层留给后续）。
 */
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Box, EditableNode } from '@mindcanvas/kernel';
import {
  FRAME_OUTLINE_ROW_GAP,
  FRAME_OUTLINE_ROW_PAD_X,
  FRAME_OUTLINE_ROW_PAD_Y,
  FRAME_SHELL_PAD,
  LINE_H,
  frameOf,
  partitionFrameSubtree,
} from '@mindcanvas/kernel';
import { nodeTitle } from '../search/search.js';
import type { TokenSet } from '../theme/types.js';

/** 结构键动作（与 `edit/keys.ts` 的 `EDITOR_KEY_BINDINGS` 逐项对齐） */
export type FrameKeyAction = 'add-child' | 'add-sibling' | 'indent' | 'outdent';

/**
 * 外壳内边距（世界 px）：外壳尺寸 = 大纲包围盒 + padding（设计 §5.1）。
 *
 * FO-C2 起**事实源在内核**（`layout/frameLayout.ts`）：同一个常量既算这里画出来的壳，
 * 又算基座布局里成框根占的体积（`createFrameShellMeasure`）——两者必须逐像素一致，
 * 否则「占位」与「画出来的框」错位（多留白或压邻）。此处转出保持既有导入点。
 */
export { FRAME_SHELL_PAD };

export interface FrameOutlineProps {
  /** 框根（持 `note.frame`）；非框 → 渲染 null */
  frameRoot: EditableNode;
  /** 布局盒查询（B1 岛产出：`layout.nodes` 的 nodeId → box） */
  boxOf: (id: string) => Box | undefined;
  /** 世界 → 屏幕（与其余 overlay 同口径：screen = world × k + t） */
  transform: { k: number; x: number; y: number };
  token: TokenSet;
  selectedId?: string | null;
  /** 正在内联编辑的节点 id（该行让位自身文本） */
  editingId?: string | null;
  onSelect: (id: string) => void;
  /** 双击 text 行 → 既有编辑态（实体行不触发） */
  onEditStart?: (id: string) => void;
  /** 结构键 → 宿主映射到 controller（见 `frameKeyAction` 的键位口径） */
  onFrameKey?: (id: string, action: FrameKeyAction) => void;
  /** 「注释」入口 / Shift+Enter → 既有幕布描述编辑 */
  onDescEdit?: (id: string) => void;
  /**
   * 视口裁剪（世界矩形；缺省不裁）：**整框**行都不在视口（含外扩）→ 不渲染。
   * §5.4 一期不为框做虚拟化，这里只做「整框出屏不建 DOM」；壳尺寸仍按全量行盒算。
   */
  view?: { x: number; y: number; w: number; h: number };
}

/**
 * 键事件 → 结构动作（纯函数；与 `edit/keys.ts` 同判据：
 * alt 忽略、ctrl/meta 组合优先、裸键要求无修饰）。
 */
export function frameKeyAction(e: {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): FrameKeyAction | null {
  if (e.altKey) return null;
  if (e.ctrlKey || e.metaKey) return e.shiftKey && e.key === 'Tab' ? 'outdent' : null;
  if (e.shiftKey) return e.key === 'Tab' ? 'indent' : null;
  if (e.key === 'Tab') return 'add-child';
  if (e.key === 'Enter') return 'add-sibling';
  return null;
}

/** 一行：节点 + 相对框根深度（框头 = 0）+ 是否挂点行（`d === depth` 且尚有孩子） */
interface FrameRow {
  node: EditableNode;
  rel: number;
  hang: boolean;
}

/**
 * 大纲行（前序，含框头）：与 `partitionFrameSubtree` **同一次判据**——
 * 挂点行（`rel === depth`）不下行，其孩子整棵属空间层。
 */
function outlineRows(frameRoot: EditableNode, depth: number): FrameRow[] {
  const hangIds = new Set(
    partitionFrameSubtree(frameRoot, depth).hangRoots.map((h) => h.outlineNodeId),
  );
  const rows: FrameRow[] = [];
  const walk = (node: EditableNode, rel: number): void => {
    rows.push({ node, rel, hang: hangIds.has(node.id) });
    if (rel === depth) return;
    for (const child of node.children) walk(child, rel + 1);
  };
  walk(frameRoot, 0);
  return rows;
}

/** 行/壳内指针事件不外泄：不让画布起 pan / 节点拖拽 / 悬停浮窗 */
function stopPointer(e: { stopPropagation: () => void }): void {
  e.stopPropagation();
}

/** 视口外扩（世界 px）：防边缘闪烁——与画布裁剪同量级 */
const FRAME_CULL_MARGIN = 120;

/** 行盒与视口矩形相交（含外扩） */
function boxInView(box: Box, view: { x: number; y: number; w: number; h: number }): boolean {
  return (
    box.x + box.w >= view.x - FRAME_CULL_MARGIN &&
    box.x <= view.x + view.w + FRAME_CULL_MARGIN &&
    box.y + box.h >= view.y - FRAME_CULL_MARGIN &&
    box.y <= view.y + view.h + FRAME_CULL_MARGIN
  );
}

export function FrameOutline({
  frameRoot,
  boxOf,
  transform,
  token,
  selectedId = null,
  editingId = null,
  onSelect,
  onEditStart,
  onFrameKey,
  onDescEdit,
  view,
}: FrameOutlineProps) {
  const spec = frameOf(frameRoot.note);
  if (spec === undefined) return null; // 非框（读侧形态非法亦同）→ 不画
  const rows = outlineRows(frameRoot, spec.depth);

  const placed: Array<FrameRow & { box: Box }> = [];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let inView = view === undefined;
  for (const row of rows) {
    const box = boxOf(row.node.id);
    if (box === undefined) continue; // 布局未覆盖（如被折叠隐藏）→ 跳过该行
    placed.push({ ...row, box });
    if (box.x < minX) minX = box.x;
    if (box.y < minY) minY = box.y;
    if (box.x + box.w > maxX) maxX = box.x + box.w;
    if (box.y + box.h > maxY) maxY = box.y + box.h;
    if (!inView && view !== undefined && boxInView(box, view)) inView = true;
  }
  if (placed.length === 0) return null; // 无行可画 → 不留空壳
  if (!inView) return null; // 整框出屏（含外扩）→ 不建 DOM；壳尺寸仍按全量行盒算

  const { k, x, y } = transform;
  const shellX = (minX - FRAME_SHELL_PAD) * k + x;
  const shellY = (minY - FRAME_SHELL_PAD) * k + y;
  const shellW = (maxX - minX + FRAME_SHELL_PAD * 2) * k;
  const shellH = (maxY - minY + FRAME_SHELL_PAD * 2) * k;
  /** 选中落在框内（含框头）→ 框壳高亮（与节点选中同一叙事） */
  const active = placed.some((p) => p.node.id === selectedId);

  const fontPx = token.font.size * k;
  // 行内左右内边距 = 内核折行口径常量（**不是** token.spacing.padX）：
  // 换行可用宽 = 行宽 - 2×本值，DOM 与 frameRowMetrics 必须同值，否则展示/编辑折行错位。
  const padX = FRAME_OUTLINE_ROW_PAD_X * k;

  const handleKey = (e: ReactKeyboardEvent, id: string): void => {
    // Shift+Enter：切到幕布描述编辑（与 keys.ts 的 desc 席位同语义）
    if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.metaKey && onDescEdit !== undefined) {
      e.preventDefault();
      e.stopPropagation();
      onDescEdit(id);
      return;
    }
    const action = frameKeyAction(e);
    if (action === null || onFrameKey === undefined) return;
    // 拦在本组件内：不让同一次按键再落到窗口级快捷键（避免双建节点）
    e.preventDefault();
    e.stopPropagation();
    onFrameKey(id, action);
  };

  return (
    <div
      data-frame-shell
      data-frame-root={frameRoot.id}
      style={{
        position: 'absolute',
        left: shellX,
        top: shellY,
        width: shellW,
        height: shellH,
        boxSizing: 'border-box',
        border: `${Math.max(1, 1.5 * k)}px solid ${
          active ? token.color.selection : token.color.linkStroke
        }`,
        borderRadius: token.radius.panel * k,
        background: token.color.entityFill,
        // 壳本体不吃指针：padding 区域的点击/平移仍归画布；只有行接事件
        pointerEvents: 'none',
      }}
    >
      {placed.map((row) => {
        const isEntity = row.node.type === 'entity';
        const isEditing = editingId === row.node.id;
        const desc = typeof row.node.note?.desc === 'string' ? row.node.note.desc : '';
        const label = nodeTitle(row.node) || '（无文本）';
        return (
          <div
            key={row.node.id}
            data-frame-row
            data-frame-node={row.node.id}
            data-frame-depth={row.rel}
            data-frame-hang={row.hang ? 'true' : 'false'}
            {...(isEntity ? { 'data-frame-placeholder': 'true' } : {})}
            tabIndex={0}
            onPointerDown={stopPointer}
            onPointerMove={stopPointer}
            onPointerUp={stopPointer}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(row.node.id);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (isEntity) return; // 只读占位：一期不改 url / ref（设计 §4.3）
              onEditStart?.(row.node.id);
            }}
            onKeyDown={(e) => handleKey(e, row.node.id)}
            style={{
              position: 'absolute',
              left: row.box.x * k + x - shellX,
              top: row.box.y * k + y - shellY,
              width: row.box.w * k,
              height: row.box.h * k,
              boxSizing: 'border-box',
              display: 'flex',
              // 正文与注释提示同一条基线：有 desc 的行按**正文行首**对齐（附属区在其下方），
              // 无 desc 的紧凑行/框头行则整体居中（行盒 = 正文高时等价于同一位置）。
              alignItems: desc === '' ? 'center' : 'flex-start',
              gap: FRAME_OUTLINE_ROW_GAP * k,
              padding: `${FRAME_OUTLINE_ROW_PAD_Y * k}px ${padX}px`,
              // 弱化「节点卡」：小圆角（不再用 h/2 胶囊），无卡底、无整卡阴影
              borderRadius: Math.min(token.radius.node, 3 * k),
              // 选中行：内描边环（不换底色——行底色本就是壳底的半透明实体色）
              boxShadow:
                row.node.id === selectedId
                  ? `inset 0 0 0 ${Math.max(1, k)}px ${token.color.selection}`
                  : 'none',
              outline: 'none',
              cursor: 'pointer',
              pointerEvents: 'auto',
              color: token.color.text,
              fontFamily: token.font.family,
            }}
          >
            {isEditing ? null : (
              <span
                data-frame-row-text
                style={{
                  flex: '1 1 auto',
                  minWidth: 0,
                  // FO-C1：正文**完整换行**显示 —— 不设 height/overflow，无 ellipsis，
                  // 行盒高由内核 frameRowMetrics（pad + LINE_H×行数）决定，两者同口径。
                  // `overflowWrap: anywhere` 对齐 wrapText 的「超宽 token 硬切」。
                  lineHeight: `${LINE_H * k}px`,
                  whiteSpace: 'normal',
                  overflowWrap: 'anywhere',
                  fontSize: fontPx,
                  fontWeight: row.rel === 0 ? token.font.weightRoot : token.font.weight,
                  color: isEntity ? token.color.entityText : token.color.text,
                }}
              >
                {label}
              </span>
            )}
            {/* 幕布注释（note.desc）：不在行内渲染预览（FO-FIX2）——由既有 DescBlock/附属区
                画在行下（高度经宿主 rowAuxH → estimateDescHeight 预留）；Shift+Enter → onDescEdit */}
          </div>
        );
      })}
    </div>
  );
}
