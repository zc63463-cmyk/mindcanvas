/**
 * 边右键菜单项（R4-1；从宿主下沉：纯函数可测）。
 *
 * 分工与 `contextMenuItems.ts`（节点菜单）同款：数据在 react、渲染在宿主
 * （EdgeDraftLayer 持 `ContextMenu`）。动作经 `EdgeMenuActions` 注入——
 * 缺省的回调 → 对应项**禁用**（宿主按能力增量接线：R4-2 反向、R4-4 级联）。
 *
 * 禁用矩阵（测试钉死，edge-context-items.test.ts）：
 * - manual 存在 → 重挂**不禁用**（R2 起重挂与 manual 正交——重挂改锚、manual 是几何）
 * - 源/靶任一未解析 → 反向 / 复制一条 仍可用（数据操作不依赖锚解析）
 * - 对称 / 未注册 rel → 反向仍可用（R4-A2：rel 不变 + 提示，不阻断）
 * - invalidAt 有无 → 「失效（可恢复）」/「恢复」动态文案
 */
import type { LinkDir } from '@mindcanvas/kernel';
import type { ContextMenuItem } from '../chrome/ContextMenu.js';

/** 菜单事实（渲染端无关的纯数据；宿主从 FreeEdge + schema 派生） */
export interface EdgeContextFacts {
  key: string;
  rel: string;
  dir: LinkDir;
  invalidAt?: string;
  /** 人工锁定几何存在（R3-1：此时 routingSide/Opp 失效，但重挂仍可用） */
  hasManual: boolean;
  /** 源锚已解析到节点 */
  sourceResolved: boolean;
  /** 靶锚已解析到节点 */
  targetResolved: boolean;
  /** rel 已注册（relationSchema.getConfig 命中） */
  relRegistered: boolean;
  /** rel 为对称关系（isSymmetric） */
  relSymmetric: boolean;
}

/** 动作袋（宿主注入；缺省 = 对应菜单项禁用） */
export interface EdgeContextMenuActions {
  onEdit?: () => void;
  onReattach?: (side: 'from' | 'to') => void;
  onReverse?: () => void;
  onDuplicate?: () => void;
  onToggleInvalid?: () => void;
  onDelete?: () => void;
}

/** 菜单分区（顺序即渲染顺序） */
const SEC = {
  common: '常用',
  anchor: '锚与方向',
} as const;

export function edgeContextItems(
  facts: EdgeContextFacts,
  actions: EdgeContextMenuActions,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  items.push({
    label: '编辑',
    section: SEC.common,
    disabled: actions.onEdit === undefined || undefined,
    onSelect: actions.onEdit,
  });
  items.push({
    label: facts.invalidAt !== undefined ? '恢复' : '失效（可恢复）',
    section: SEC.common,
    disabled: actions.onToggleInvalid === undefined || undefined,
    onSelect: actions.onToggleInvalid,
  });
  items.push({
    label: '删除',
    section: SEC.common,
    danger: true,
    disabled: actions.onDelete === undefined || undefined,
    onSelect: actions.onDelete,
  });
  items.push({
    label: '重挂源锚',
    section: SEC.anchor,
    // R4-A5/禁用矩阵：重挂与 manual 正交——manual 存在也不禁用
    disabled: actions.onReattach === undefined || undefined,
    onSelect: actions.onReattach !== undefined ? () => actions.onReattach?.('from') : undefined,
  });
  items.push({
    label: '重挂靶锚',
    section: SEC.anchor,
    disabled: actions.onReattach === undefined || undefined,
    onSelect: actions.onReattach !== undefined ? () => actions.onReattach?.('to') : undefined,
  });
  items.push({
    label: '反向',
    section: SEC.anchor,
    // 反向是数据操作：dangling / 对称 / 未注册 rel 都不禁用（R4-A2 提示不阻断）
    disabled: actions.onReverse === undefined || undefined,
    onSelect: actions.onReverse,
  });
  items.push({
    label: '复制一条',
    section: SEC.anchor,
    disabled: actions.onDuplicate === undefined || undefined,
    onSelect: actions.onDuplicate,
  });
  return items;
}
