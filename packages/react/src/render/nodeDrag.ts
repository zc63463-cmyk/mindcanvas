/**
 * 节点拖拽重排规划器（M5-T5，纯函数、零 React 零 DOM）：
 * 拖拽悬停 → 目标节点 → 插入位置判定（before/after/child）→ 生成 move-node TreeOp。
 * 环检测（目标在拖拽节点子树内 = 非法，会产生环）、自拖、根目标约束均在此判定。
 * 最终落树仍走 kernel moveNode（applyOp）——本模块只出计划，不直接改树。
 */
import type { LayoutNode, LayoutResult, TreeOp } from '@mindcanvas/kernel';

/** 插入位置模式 */
export type DropMode = 'before' | 'after' | 'child';

/** 拖放计划（MapView 据此渲染提示并在松手时执行 op） */
export interface DropPlan {
  targetId: string;
  mode: DropMode;
  /** 合法落点（非自身/非子树/目标有父等）；false 时 op = null 且渲染拒绝反馈 */
  valid: boolean;
  op: Extract<TreeOp, { type: 'move-node' }> | null;
}

/**
 * 按目标盒与指针世界坐标判定插入模式（M5-T5 悬停带）：
 * - 目标盒顶 25% → before（作为目标前一个兄弟）
 * - 目标盒底 25% → after（作为目标后一个兄弟）
 * - 中段 → child（作为目标子节点）
 */
export function dropModeFor(
  box: { x: number; y: number; w: number; h: number },
  pt: { x: number; y: number },
): DropMode {
  if (pt.y < box.y + box.h * 0.25) return 'before';
  if (pt.y > box.y + box.h * 0.75) return 'after';
  return 'child';
}

/** 目标是否位于 dragId 的子树内（沿 parentId 链上溯；含自身——调用方应先行排除自拖） */
export function isDescendantOf(layout: LayoutResult, ancestorId: string, id: string): boolean {
  const parentMap = new Map<string, string | null>();
  for (const n of layout.nodes) parentMap.set(n.node.id, n.parentId);
  let cur: string | null = id;
  while (cur !== null && cur !== undefined) {
    if (cur === ancestorId) return true;
    cur = parentMap.get(cur) ?? null;
  }
  return false;
}

/**
 * 生成拖放计划：合法 → 对应 move-node op（before/after 需目标有父——根只能作为 child 目标）。
 * 非法（自拖 / 目标在自身子树 → 环）→ valid=false，op=null（松手拒绝 + 视觉反馈）。
 */
export function planDrop(
  layout: LayoutResult,
  dragId: string,
  targetId: string,
  mode: DropMode,
): DropPlan {
  const invalid = (): DropPlan => ({ targetId, mode, valid: false, op: null });
  if (targetId === dragId) return invalid(); // 自拖
  if (isDescendantOf(layout, dragId, targetId)) return invalid(); // 落到自身子树 → 环

  const target = layout.nodes.find((n) => n.node.id === targetId);
  if (!target) return invalid();

  if (mode === 'child') {
    return {
      targetId,
      mode,
      valid: true,
      op: {
        type: 'move-node',
        id: dragId,
        targetParentId: targetId,
        index: target.children.length,
      },
    };
  }
  // before / after：目标必须是某父节点的子（根节点无兄弟位）
  if (target.parentId === null) return invalid();
  const parent = layout.nodes.find((n) => n.node.id === target.parentId);
  const idx = parent?.children.findIndex((c) => c.node.id === targetId) ?? -1;
  if (!parent || idx < 0) return invalid();
  return {
    targetId,
    mode,
    valid: true,
    op: {
      type: 'move-node',
      id: dragId,
      targetParentId: target.parentId,
      index: idx + (mode === 'after' ? 1 : 0),
    },
  };
}

/** 拖拽中应排除的节点 id 集（拖拽节点自身 + 其子树——不可作为落点目标） */
export function dragExcludedIds(layout: LayoutResult, dragId: string): Set<string> {
  const out = new Set<string>();
  const walk = (ln: LayoutNode): void => {
    out.add(ln.node.id);
    for (const c of ln.children) walk(c);
  };
  const drag = layout.nodes.find((n) => n.node.id === dragId);
  if (drag) walk(drag);
  return out;
}
