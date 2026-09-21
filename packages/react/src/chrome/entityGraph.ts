/**
 * 实体关系图谱数据层（F1：导图↔关系图联动）：
 * - collectEntityRelations：文档内实体引用聚合（ref / 标题 / 引用它的导图节点列表）——
 *   导出为公共 API，主仓 RelationGraph 可消费同一数据源（六合一定位）
 * - radialLayout：确定性径向布局（星型：中心实体、周围引用节点均匀分布）——纯函数可测，
 *   实体量超阈值再切力导向（T8 同款降级思维，首期不引入迭代求解）
 */
import { refKey, type EditableNode, type Entity, type EntityRef } from '@mindcanvas/kernel';

/** 引用某实体的导图节点 */
export interface EntityRelationNode {
  nodeId: string;
  /** 节点文本（实体节点无文本 → 用 ref.id 兜底显示） */
  text: string;
}

/** 实体关系：一个实体 + 文档内所有引用它的节点 */
export interface EntityRelation {
  ref: EntityRef;
  kind: string;
  /** 实体标题（entities 解析结果；缺失 → ref.id 兜底） */
  title: string;
  refNodes: EntityRelationNode[];
}

/** 文档内实体引用聚合（前序遍历；按引用数降序） */
export function collectEntityRelations(
  editable: EditableNode,
  entities: Map<string, Entity>,
): EntityRelation[] {
  const byKey = new Map<string, EntityRelation>();
  const walk = (n: EditableNode): void => {
    if (n.type === 'entity' && n.ref) {
      const key = refKey(n.ref);
      let r = byKey.get(key);
      if (!r) {
        const ent = entities.get(key);
        r = { ref: n.ref, kind: n.ref.kind, title: ent?.title ?? n.ref.id, refNodes: [] };
        byKey.set(key, r);
      }
      r.refNodes.push({ nodeId: n.id, text: n.text ?? n.ref.id });
    }
    for (const c of n.children) walk(c);
  };
  walk(editable);
  return [...byKey.values()].sort((a, b) => b.refNodes.length - a.refNodes.length);
}

/** 圆周均匀分布点（起点顶部，顺时针；count=0 → 空） */
export function radialLayout(count: number, radius: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    pts.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
  }
  return pts;
}
