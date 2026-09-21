/**
/**
 * graphJsonAdapter —— 将 graph.json (图引擎编译产物) 适配为 mindcanvas 渲染模型。
 *
 * 转换策略：
 * 1. 结构化骨架：
 *    - 依据 in_degree === 0 的母材/源头节点作为森林中心 (CenterSpec) 或主干根节点；
 *    - 沿着因果边深度优先生成树状子节点 (以首次访问为准，避免多亲节点导致树破坏)；
 * 2. 语义关系边：
 *    - 所有跨分支因果边、双子边 (twin)、反向/环向边，统一收敛至 root.note.edges (文档级自由边，符合 ADR-0008)；
 *    - 端点使用 @kind:id 实体锚或 node: 路径锚，由内核解析为运行时自由连线。
 */
import type { EditableNode } from '../tree/treeOps.js';
import { newId } from '../tree/treeOps.js';
import type { CenterSpec, GrowDir } from '../layout/forest.js';

export interface GraphJsonNode {
  id: string;
  label: string;
  level?: string;
  kind: string;
  file_path?: string;
  metadata?: Record<string, unknown>;
}

export interface GraphJsonEdge {
  from: string;
  to: string;
  kind: string;
  direction?: 'fwd' | 'back' | 'both';
  metadata?: Record<string, unknown>;
}

export interface GraphJsonIndices {
  descendants?: Record<string, string[]>;
  ancestors?: Record<string, string[]>;
  in_degree?: Record<string, number>;
  topological_order?: string[];
}

export interface GraphJsonPayload {
  version: string;
  domain: string;
  source_hash: string;
  nodes: GraphJsonNode[];
  edges: GraphJsonEdge[];
  indices: GraphJsonIndices;
}

export interface DocEdgePayload {
  from: string;
  to: string;
  rel: string;
  dir?: 'fwd' | 'back' | 'both';
  label?: string;
  note?: string;
  source?: 'imported' | 'inferred' | 'manual';
}

export interface AdapterResult {
  /** 整体合成导图根节点 (含 root.note.edges) */
  root: EditableNode;
  /** 适合 layoutForest 渲染的多中心清单 */
  centers: CenterSpec[];
  /** 提取的全部文档级自由边 */
  edges: DocEdgePayload[];
}

/** FIX-008: 树结构跳过的边类型（双子/断口只走文档级自由边，避免双份呈现） */
const TREE_SKIP_KINDS = new Set(['twin', 'fracture']);

export function graphJsonToMindmap(graph: GraphJsonPayload): AdapterResult {
  const nodeMap = new Map<string, GraphJsonNode>();
  for (const n of graph.nodes) {
    nodeMap.set(n.id, n);
  }

  // 1. 建立有向邻接表 (from -> {to, kind}[])
  const adj = new Map<string, { to: string; kind: string }[]>();
  for (const e of graph.edges) {
    const list = adj.get(e.from) ?? [];
    list.push({ to: e.to, kind: e.kind });
    adj.set(e.from, list);
  }

  // 2. 识别根节点 (in_degree === 0 的节点)
  const inDegree = graph.indices.in_degree ?? {};
  let rootIds = graph.nodes
    .filter((n) => (inDegree[n.id] ?? 0) === 0)
    .map((n) => n.id);

  if (rootIds.length === 0 && graph.nodes.length > 0) {
    // 若存在全图强连通环导致无入度为 0 节点，按拓扑序或首节点兜底
    const fallback = graph.indices.topological_order?.[0] ?? graph.nodes[0]?.id;
    rootIds = fallback === undefined ? [] : [fallback];
  }

  const visited = new Set<string>();

  // 辅助函数：递归构建树节点
  function buildTreeNode(nodeId: string): EditableNode | null {
    const data = nodeMap.get(nodeId);
    if (!data) return null;

    visited.add(nodeId);

    const children: EditableNode[] = [];
    const outgoing = adj.get(nodeId) ?? [];
    for (const item of outgoing) {
      // FIX-008: 双子/断口边只走文档级自由边，不进入树结构
      if (TREE_SKIP_KINDS.has(item.kind)) continue;
      const targetId = item.to;
      if (!visited.has(targetId)) {
        const childNode = buildTreeNode(targetId);
        if (childNode) {
          children.push(childNode);
        }
      }
    }

    return {
      id: newId(),
      type: 'entity',
      text: data.label,
      ref: { kind: data.kind || 'concept', id: data.id },
      note: {
        one_liner: data.level ? `[${data.level}] ${data.label}` : data.label,
        ...(data.metadata ?? {}),
      },
      children,
    };
  }

  // 3. 构建多中心 (CenterSpec[])
  const centers: CenterSpec[] = [];
  const primaryRoots: EditableNode[] = [];
  const DEFAULT_CENTER_DIR: GrowDir = 'right';

  for (const rootId of rootIds) {
    const tree = buildTreeNode(rootId);
    if (tree) {
      primaryRoots.push(tree);
      centers.push({
        node: tree,
        dir: DEFAULT_CENTER_DIR,
      });
    }
  }

  // 若仍有孤立或环中未被主根覆盖的节点，作为独立中心补齐
  for (const n of graph.nodes) {
    if (!visited.has(n.id)) {
      const remainingTree = buildTreeNode(n.id);
      if (remainingTree) {
        primaryRoots.push(remainingTree);
        centers.push({
          node: remainingTree,
          dir: DEFAULT_CENTER_DIR,
        });
      }
    }
  }

  // 4. 将所有边转换为 root.note.edges
  const edges: DocEdgePayload[] = graph.edges.map((e) => {
    const fromNode = nodeMap.get(e.from);
    const toNode = nodeMap.get(e.to);
    const fromRef = fromNode ? `@${fromNode.kind}:${fromNode.id}` : e.from;
    const toRef = toNode ? `@${toNode.kind}:${toNode.id}` : e.to;

    return {
      from: fromRef,
      to: toRef,
      rel: e.kind,
      dir: e.direction ?? 'fwd',
      label: typeof e.metadata?.label === 'string' ? e.metadata.label : undefined,
      source: 'imported',
    };
  });

  // 5. 合成单个全局 Root 节点以便于统一保存为 .mm.md
  const domainLabel = graph.domain ? `${graph.domain.toUpperCase()} 知识拓扑` : '知识拓扑图';
  const rootNode: EditableNode = {
    id: newId(),
    type: 'text',
    text: domainLabel,
    note: {
      edges,
    },
    children: primaryRoots,
  };

  return {
    root: rootNode,
    centers,
    edges,
  };
}
