/**
 * 递归布局岛投影（G1 已批准语义）：
 * 已升格后代不随祖先移动；每节点由**最近的升格祖先**控制；
 * 任意深度节点可升格；根自身可作为中心条目（不重复投影）。
 *
 * 是什么：
 * - `projectIslands`：对文档树做**单次 DFS**，把升格节点从父岛投影中剔除、
 *   为其开新岛（其普通后代归它，嵌套升格同理）；产出不可变投影副本、
 *   全树 owner 映射、跨岛边界边与结构化诊断。
 * - `layoutIslands`：把各岛交给现成的 `layoutForest` 布局（一行布局算法不自己写），
 *   有 pos 的岛根中心精确落在 pos（与 forest.ts 平移口径一致），无 pos 的按岛
 *   宽度横向自动排开；另按 owner 映射登记每岛包围盒。
 *
 * 不是什么：
 * - 不做锚解析（`state` 三态由调用方 resolveLinkAnchor 得出，本模块只消费结果）
 * - 不做「是否回退单树布局」的判断（调用方依据有效中心数自行决定）
 * - 不修改源树任何节点：投影只新建副本（可复用未变节点壳，children 变更才浅拷贝；
 *   F4 起对"与上次产出逐项同一"的节点进一步复用上次壳——岛根身份跨编辑稳定，
 *   是岛级缓存命中的前提）
 * - 不渲染 boundaryLinks（由渲染层画）；LayoutCache 接线在 forest.ts（本模块只做投影/组装）
 */
import type { AnchorResolutionState } from '../registry/note-anchor.js';
import type { EditableNode } from '../tree/treeOps.js';
import { layoutForest, type CenterSpec, type GrowDir } from './forest.js';
import type { LayoutCache, LayoutNode, LinkGeometry, MeasureFn } from './mindmap.js';

/** 调用方传入的已校验中心：锚解析已完成，本模块只消费解析结果 */
export interface ValidatedCenterSpec {
  /** 中心节点 id；null = 锚未命中节点（跳过 + 诊断） */
  nodeId: string | null;
  /** 原始锚文本（诊断回溯用） */
  at: string;
  /** 岛生长方向 */
  dir: GrowDir;
  /** 岛根节点本体的世界坐标（盒中心）；null = 自动摆放。{x:0,y:0} 是合法坐标 */
  pos: { x: number; y: number } | null;
  /** 锚解析三态（spec §5.5）；仅 well-formed 生效 */
  state: AnchorResolutionState;
  /**
   * G3：是否显示与语义父级的跨岛父子连接。缺省 'hide' 兼容旧数据
   * （已有 centers 文件的历史行为是隐藏父子线）。仅控制显示，不改变语义归属。
   */
  parentLink?: 'show' | 'hide';
  /**
   * G2（A5）：切断标记——该岛由「切断并独立」产生。detached 岛 sourceKind='detached'，
   * 且**强制不产生容器跨岛边**（与其 parentLink 无关——切断与升格的区别即在此）。
   */
  detached?: boolean;
}

/** 岛来源：文档根 / 树内升格节点 / 切断独立的分支（G2，A5 起 projectIslands 产出） */
export type IslandSourceKind = 'root' | 'promoted' | 'detached';

/** 一个布局岛：以投影副本为根、自成一体布局的子树 */
export interface LayoutIsland {
  /** 岛根节点 id（根岛 = documentRoot.id；升格岛 = 升格节点 id） */
  rootId: string;
  /** 岛根的投影副本（升格后代已从 children 剔除） */
  projectedRoot: EditableNode;
  /** 岛内全部成员 id（前序；含被岛根「接管」的普通后代） */
  memberIds: string[];
  /** 生长方向 */
  direction: GrowDir;
  /** 岛根摆放坐标；null = 由 layoutIslands 自动排开 */
  position: { x: number; y: number } | null;
  sourceKind: IslandSourceKind;
}

/** 跨岛边界边：真实父子关系跨岛时产生（detached 容器边不入集合） */
export interface BoundaryLink {
  fromId: string;
  toId: string;
}

/** 结构化诊断（中文消息，供 UI 呈现「宁可不写也不错写」的原因） */
export interface IslandDiagnostic {
  code: string;
  /** 原始锚文本；无锚上下文为 null */
  at: string | null;
  /** 相关节点 id；无节点上下文为 null */
  nodeId: string | null;
  message: string;
}

/** 岛投影结果（projectIslands 的产出，layoutIslands 的输入） */
export interface IslandProjection {
  /** 根岛恒在首位，升格岛按 DFS 发现序排列 */
  islands: LayoutIsland[];
  /** 节点 id → 岛根 id；覆盖整棵文档树每个节点恰好一次（与折叠无关） */
  ownerByNodeId: Map<string, string>;
  /** 真实父子关系跨岛边（不参与布局） */
  boundaryLinks: BoundaryLink[];
  diagnostics: IslandDiagnostic[];
}

/** 世界坐标包围盒（与 LayoutResult.bounds 同构） */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** layoutIslands 选项 */
export interface IslandLayoutOptions {
  /** 无 pos 岛相邻间距（世界坐标 px），同 layoutForest.gap */
  gap?: number;
  /** 增量缓存（F 批通道）：透传 layoutForest——森林路径此前不接管 LayoutCache */
  cache?: LayoutCache;
  /** 度量语义键（透传） */
  measureKey?: string;
}

/** layoutIslands 结果 */
export interface IslandLayoutResult {
  nodes: LayoutNode[];
  links: LinkGeometry[];
  bounds: Bounds;
  /** 每岛布局后包围盒（键 = 岛根 id） */
  islandBounds: Map<string, Bounds>;
}

/** 根岛缺省生长方向（与 pipeline 虚拟根的 dir: 'right' 口径一致） */
const DEFAULT_ROOT_DIR: GrowDir = 'right';

const EMPTY_BOUNDS: Bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

/**
 * 投影壳稳定化映射（F4）：node 身份 → 上次产出的投影（壳或 node 本身）。
 *
 * 为什么需要：岛级缓存的键 = 岛根**对象身份**——若"升格剪枝"（changed=true）每次
 * 投影都新建壳，含嵌套升格的岛**永远 miss**。判据见 below；文档根另有跨对象特判
 * （根每次编辑必换壳——不可变树祖先链必经）。
 */
const lastProjected = new WeakMap<EditableNode, EditableNode>();

/** 上次投影的「文档根产出」（跨对象根换取用判据；正确性由 sameShell 保证） */
let lastRootShell: EditableNode | null = null;

/**
 * 投影壳「内容同一」判定（结构共享感知，不做深比较）：
 * 非 children 字段引用相等（重建链 spread 保证未变字段同引用）+ children 逐项 ===。
 * 成本 O(变更路径)：未变子树走首项 `a === b` 短路。
 */
function sameShell(a: EditableNode, b: EditableNode): boolean {
  if (a === b) return true;
  if (a.id !== b.id || a.type !== b.type || a.text !== b.text) return false;
  if (a.url !== b.url || a.ref !== b.ref || a.note !== b.note) return false;
  if (a.children.length !== b.children.length) return false;
  for (let i = 0; i < a.children.length; i++) {
    if (a.children[i] !== b.children[i]) return false;
  }
  return true;
}

/**
 * 递归布局岛投影。
 *
 * 语义（已批准 G1）：
 * - 从文档根 DFS 一次；根岛 sourceKind='root' 恒存在
 * - 遇有效升格节点（centers 中 nodeId 匹配且 state='well-formed'）→ 开新岛
 *   （sourceKind='promoted'），从父岛 projectedChildren 剔除，其普通后代归它
 * - 嵌套升格同理：每节点由最近升格祖先控制
 * - 同一 nodeId 多条中心 → first-wins + 诊断
 * - nodeId=null 或 state 非 well-formed → 跳过 + 诊断（内容不丢，节点归父岛）
 * - 根自身作为中心 → 根岛沿用其 dir/pos，不新建岛、不重复投影
 */
export function projectIslands(
  documentRoot: EditableNode,
  centers: readonly ValidatedCenterSpec[],
): IslandProjection {
  const diagnostics: IslandDiagnostic[] = [];

  // ① 中心清单预处理：跳过无效条目 + first-wins 去重
  const centerByNodeId = new Map<string, ValidatedCenterSpec>();
  for (const c of centers) {
    if (c.nodeId === null) {
      diagnostics.push({
        code: 'center-null-node',
        at: c.at,
        nodeId: null,
        message: '中心条目未解析出节点 id，已跳过',
      });
      continue;
    }
    if (c.state !== 'well-formed') {
      diagnostics.push({
        code: `center-anchor-${c.state}`,
        at: c.at,
        nodeId: c.nodeId,
        message: `中心锚解析状态为「${c.state}」，已跳过该中心`,
      });
      continue;
    }
    if (centerByNodeId.has(c.nodeId)) {
      diagnostics.push({
        code: 'duplicate-center',
        at: c.at,
        nodeId: c.nodeId,
        message: '同一节点存在多条中心标注，仅采用第一条（first-wins）',
      });
      continue;
    }
    centerByNodeId.set(c.nodeId, c);
  }

  const ownerByNodeId = new Map<string, string>();
  const boundaryLinks: BoundaryLink[] = [];
  const promotedIslands: LayoutIsland[] = [];
  const usedCenterIds = new Set<string>();

  /**
   * ② 单次 DFS：投影当前岛子树。
   * 遇升格子节点 → 记跨岛边界边、入待建岛队列，并从本岛 children 剔除；
   * children 有变更才浅拷贝节点（复用节点壳），否则原样复用——源树零修改。
   */
  const pending: Array<{ node: EditableNode; spec: ValidatedCenterSpec }> = [];
  const walk = (
    node: EditableNode,
    owner: string,
  ): { projected: EditableNode; members: string[] } => {
    ownerByNodeId.set(node.id, owner);
    const members: string[] = [node.id];
    const projectedChildren: EditableNode[] = [];
    // 变更判定不能只看数量：子节点对象被投影替换（或被剪枝）都算变更，
    // 否则父节点被原样复用、升格剪枝丢失 → 升格后代同时出现在两处（重复投影）。
    let changed = false;
    for (const child of node.children) {
      const spec = centerByNodeId.get(child.id);
      if (spec !== undefined) {
        // 升格/切断：开新岛（此处只登记，稍后统一投影建岛）。
        // 跨岛边界边：detached（切断）岛**强制不产生容器边**（G2——切断与升格的
        // 区别即在于此：切断后与原父级无可见连接）；非 detached 按 parentLink 过滤
        // 由调用方（buildIslandView）负责，这里产出全量真实父子边。
        usedCenterIds.add(child.id);
        if (spec.detached !== true) boundaryLinks.push({ fromId: node.id, toId: child.id });
        pending.push({ node: child, spec });
        changed = true; // 递归剪枝：该子树不再并入父岛（含全部后代）
        continue;
      }
      const sub = walk(child, owner);
      if (sub.projected !== child) changed = true;
      projectedChildren.push(sub.projected);
      for (const m of sub.members) members.push(m);
    }
    const naive: EditableNode = changed ? { ...node, children: projectedChildren } : node;
    // 投影壳稳定化（F4）：与上次产出「逐项同一」→ 复用上次对象（岛根身份跨编辑稳定）
    const prev = lastProjected.get(node);
    if (prev !== undefined && sameShell(prev, naive)) {
      return { projected: prev, members };
    }
    // 文档根特判：根每次编辑都换壳（祖先链必经），弱映射恒 miss——与「上次根产出」
    // 跨对象比较（结构共享使成本 O(变更路径)）；等价 → 复用，根岛身份随之稳定。
    if (node === documentRoot && lastRootShell !== null && sameShell(lastRootShell, naive)) {
      lastProjected.set(node, lastRootShell);
      return { projected: lastRootShell, members };
    }
    lastProjected.set(node, naive);
    if (node === documentRoot) lastRootShell = naive;
    return { projected: naive, members };
  };

  // 根岛：根自身可为中心（沿用其 dir/pos），children 中的升格后代照常剔除
  const rootSpec = centerByNodeId.get(documentRoot.id);
  if (rootSpec !== undefined) usedCenterIds.add(documentRoot.id);
  const rootWalk = walk(documentRoot, documentRoot.id);
  const rootIsland: LayoutIsland = {
    rootId: documentRoot.id,
    projectedRoot: rootWalk.projected,
    memberIds: rootWalk.members,
    direction: rootSpec !== undefined ? rootSpec.dir : DEFAULT_ROOT_DIR,
    position: rootSpec !== undefined ? rootSpec.pos : null,
    sourceKind: 'root',
  };

  // ③ 按发现序建升格岛（FIFO = DFS 发现序；嵌套升格在 walk 内继续追加队尾）
  while (pending.length > 0) {
    const item = pending.shift();
    if (item === undefined) break;
    const sub = walk(item.node, item.node.id);
    promotedIslands.push({
      rootId: item.node.id,
      projectedRoot: sub.projected,
      memberIds: sub.members,
      direction: item.spec.dir,
      position: item.spec.pos,
      sourceKind: 'promoted',
    });
  }

  // ④ 防御诊断：well-formed 但不在文档树中（如锚与树快照不同步）的中心
  for (const [nodeId, spec] of centerByNodeId) {
    if (!usedCenterIds.has(nodeId)) {
      diagnostics.push({
        code: 'center-node-not-found',
        at: spec.at,
        nodeId,
        message: '中心节点不在文档树中，已忽略',
      });
    }
  }

  return {
    islands: [rootIsland, ...promotedIslands],
    ownerByNodeId,
    boundaryLinks,
    diagnostics,
  };
}

/**
 * 布局各岛：整包交给 layoutForest——每岛即一个 CenterSpec（node=投影根、dir=岛方向、
 * pos=岛坐标）。有 pos 的岛根中心精确落在 pos（复用 forest.ts 的平移口径，{0,0} 合法）；
 * 无 pos 的岛按局部宽度横向自动排开——语义与「把所有岛直接喂给 layoutForest」完全一致。
 * boundaryLinks 不参与布局；折叠集只影响可见性（memberIds 由投影保证不丢节点）。
 */
export function layoutIslands(
  projection: IslandProjection,
  measure: MeasureFn,
  collapsedIds: Set<string>,
  opts: IslandLayoutOptions = {},
): IslandLayoutResult {
  if (projection.islands.length === 0) {
    return { nodes: [], links: [], bounds: EMPTY_BOUNDS, islandBounds: new Map() };
  }
  const centers: CenterSpec[] = projection.islands.map((island) => ({
    node: island.projectedRoot,
    dir: island.direction,
    // pos 仅按 null 判断缺省：{x:0,y:0} 必须原样透传（0 是合法坐标）
    ...(island.position !== null ? { pos: island.position } : {}),
  }));
  const result = layoutForest(centers, measure, collapsedIds, {
    gap: opts.gap,
    cache: opts.cache,
    measureKey: opts.measureKey,
  });

  // 按 owner 映射归组每岛包围盒（owner 覆盖全树，布局节点必有所属岛）
  const acc = new Map<string, Bounds>();
  for (const n of result.nodes) {
    const owner = projection.ownerByNodeId.get(n.node.id);
    if (owner === undefined) continue;
    const x0 = n.box.x;
    const y0 = n.box.y;
    const x1 = n.box.x + n.box.w;
    const y1 = n.box.y + n.box.h;
    const cur = acc.get(owner);
    if (cur === undefined) {
      acc.set(owner, { minX: x0, minY: y0, maxX: x1, maxY: y1 });
    } else {
      cur.minX = Math.min(cur.minX, x0);
      cur.minY = Math.min(cur.minY, y0);
      cur.maxX = Math.max(cur.maxX, x1);
      cur.maxY = Math.max(cur.maxY, y1);
    }
  }
  return {
    nodes: result.nodes,
    links: result.links,
    bounds: result.bounds,
    islandBounds: acc,
  };
}
