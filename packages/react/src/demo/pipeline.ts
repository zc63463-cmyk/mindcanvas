/**
 * demo 数据管线（T3：parseMm → astToEditable → layoutMindmap → 渲染 的组成示例）。
 * kernel = 纯只读依赖（协议解析 / 布局 / 度量抽象），react 侧注入 DOM 精确度量。
 * demo 画布文本来自 kernel fixtures（apps/canvas 内 `?raw` 引入）。
 */
import {
  astToEditable,
  collectFrameRoots,
  createFrameShellMeasure,
  expandFrameIslands,
  framePrunedCollapsed,
  layoutForest,
  layoutMindmapBranched,
  parseMm,
  projectIslands,
  refKey,
  type BoundaryLink,
  type CenterSpec,
  type IslandDiagnostic,
  type LayoutCache,
  type ValidatedCenterSpec,
} from '@mindcanvas/kernel';
import type {
  Diagnostic,
  EditableNode,
  Entity,
  EntityRef,
  LayoutResult,
  CharMeasure,
  MeasureFn,
} from '@mindcanvas/kernel';
import { createNodeMeasure } from '../render/domMeasure.js';
import { estimateCommentAreaHeight, GROW_EXPAND_W } from '../chrome/GrowthCommentPanel.js';
import {
  DESC_EDIT_MIN_W,
  estimateDescHeight,
  estimateDescWidth,
} from '../chrome/DescBlock.js';
import { estimateNoteAreaHeight } from '../chrome/NoteGrowthPanel.js';
import { buildNestedCenterIdsByRoot } from '../render/islandNesting.js';

export interface DemoSource {
  editable: EditableNode | null;
  refs: EntityRef[];
  diagnostics: Diagnostic[];
}

/** `.mm.md` 文本 → 可编辑树（协议层事实源） */
export function buildEditable(source: string): DemoSource {
  const { root, refs, diagnostics } = parseMm(source);
  return { editable: astToEditable(root), refs, diagnostics };
}

/** refs + 标题表 → entity 表（缺口 = unresolved，驱动警示角标演示） */
export function buildEntities(
  refs: EntityRef[],
  titleByRef: Record<string, { title: string; status?: string; ref?: string }>,
): Map<string, Entity> {
  const map = new Map<string, Entity>();
  for (const r of refs) {
    const k = refKey(r);
    const spec = titleByRef[k];
    map.set(
      k,
      spec
        ? {
            kind: r.kind,
            id: r.id,
            title: spec.title,
            status: spec.status ?? 'open',
            ref: spec.ref ?? null,
          }
        : {
            kind: r.kind,
            id: r.id,
            title: null,
            status: 'unresolved',
            ref: null,
            meta: { unresolved_reason: 'not-found' },
          },
    );
  }
  return map;
}

export interface DemoLayout {
  layout: LayoutResult;
  /** 注入 measure（可复用于后续折叠重布局） */
  measure: ReturnType<typeof createNodeMeasure>;
}

/** 展开态节点加宽（快速注释"生长"）：宽=定值，高=本体+注释区高（参与布局 → 推开其他节点） */
export function createExpandMeasure(
  base: MeasureFn,
  expandedId: string | null,
  expandW: number,
  extraH: number,
): MeasureFn {
  if (expandedId === null) return base;
  return (node) => {
    if (node.id !== expandedId) return base(node);
    const b = base(node);
    return { w: Math.max(expandW, b.w), h: b.h + extraH };
  };
}

/** 固定 note 笔记为每个指定节点增加下方布局区域，宽度保持与节点本体完全一致。 */
export function createFixedNoteMeasure(
  base: MeasureFn,
  fixedIds: ReadonlySet<string>,
  extraH: number,
): MeasureFn {
  if (fixedIds.size === 0) return base;
  return (node) => {
    const b = base(node);
    return fixedIds.has(node.id) ? { w: b.w, h: b.h + extraH } : b;
  };
}

/**
 * 描述区（note.desc）加高：凡有描述的节点，布局高度 += 描述区高度（参与布局 → 推开其他节点）。
 * 与 createExpandMeasure（qa 快速注释：仅单个 expandedId 生效）的区别——
 * 描述是**常驻可见**的（默认收缩一行），对所有有 desc 的节点无条件生效。
 */
/**
 * 把 id 集合编码进度量键。
 *
 * ⚠️ **不能用 size 代替** —— 内核 `LayoutCache` 只靠 measureKey 字符串判定失效
 * （`mindmap.ts:101-104`，同时比较 collapsedIds 的**引用**）。而调用方的
 * collapsedIds 通常是稳定引用（如 `controller.collapsed`），于是键就成了唯一依据：
 * 若只编码数量，"展开 A" 换成 "展开 B"（数量都是 1）键不变 → 缓存未作废 →
 * 布局仍是旧的（A 还高着、B 没变高）。
 *
 * 排序后拼接：成员相同则键相同（稳定，不因遍历顺序抖动）。
 */
export function idsMeasureKey(ids: ReadonlySet<string>): string {
  return [...ids].sort().join(',');
}

/**
 * 描述区度量。
 *
 * @param descEditingId 正在编辑描述的节点 id —— **必须纳入 measure**。
 *   早期版本为"避免全树重排"刻意不含 editing（`hasSlot = desc !== ''`），
 *   代价是：新建描述时节点盒**不扩张**，编辑框只能浮出在节点下方（不占布局），
 *   用户按 Shift+Enter 后看不到"节点自己长出编辑区"的过程，且浮出框会遮挡邻居。
 *   现在改为：编辑中的节点即使 desc 为空也预留编辑区高度+最小宽度 → 节点自己扩张。
 *
 *   性能取舍：measureKey 纳入 descEditingId 后，进入/退出编辑各触发一次全树重排
 *   （用户主动的一次性操作，可接受）；**键入过程中 measureKey 不变**，
 *   因此不会每敲一个字就重排 —— 这与当初避免重排的诉求并不冲突。
 */
export function createDescMeasure(
  base: MeasureFn,
  char: CharMeasure,
  descEditingId: string | null = null,
): MeasureFn {
  return (node) => {
    const b = base(node);
    const raw = node.note?.desc;
    const desc = typeof raw === 'string' ? raw : '';
    const isEditing = descEditingId !== null && node.id === descEditingId;
    // 描述区**始终**参与布局（无展开/收缩态）。
    // 幕布语义：描述是轻量单行文本 —— 不自动折行，长了**横向撑开**节点盒；
    // 只有显式 `\n` 才增高。超过软上限后由描述区内部滚动。
    if (desc === '' && !isEditing) return b;
    const dh = estimateDescHeight(desc, isEditing);
    const dw = Math.max(estimateDescWidth(desc, char), isEditing ? DESC_EDIT_MIN_W : 0);
    return { w: Math.max(b.w, dw), h: b.h + dh };
  };
}

/**
 * 框内大纲行的**附属区高度**（FO-C1）：内核只排「紧凑正文行」，而幕布注释 / 快速注释 /
 * 固定 note 的高度估算住在 react 层（DescBlock / GrowthCommentPanel / NoteGrowthPanel），
 * 故以回调注入 `expandFrameIslands`。
 *
 * 判据必须与三个 measure 装饰器**逐项一致**（`createExpandMeasure` / `createDescMeasure` /
 * `createFixedNoteMeasure`），否则框内行盒与附属浮层错位：正文行按紧凑高排、注释却按旧卡高定位。
 * 框头行（d=0）不走本回调 —— 它保持基座盒，附属区已由基座 measure 计入（见 `layoutFrameIsland`）。
 */
export function createFrameRowAuxH(opts: {
  descEditingId: string | null;
  expandedId: string | null;
  fixedNoteIds: ReadonlySet<string>;
}): (node: EditableNode) => number {
  return (node) => {
    let h = 0;
    const raw = node.note?.desc;
    const desc = typeof raw === 'string' ? raw : '';
    const editing = opts.descEditingId !== null && node.id === opts.descEditingId;
    if (desc !== '' || editing) h += estimateDescHeight(desc, editing);
    if (opts.fixedNoteIds.has(node.id)) h += estimateNoteAreaHeight();
    if (opts.expandedId === node.id) h += estimateCommentAreaHeight();
    return h;
  };
}

/** layoutMindmap + DOM 精确度量（T3：替换默认估算的注入点）。
 *  M5-T6：传入 cache → 增量布局（仅重算受影响分支）；measureKey 覆盖字体/实体/展开态变化（由调用方给出版本令牌）。 */
export function layoutDemo(
  editable: EditableNode,
  entities: Map<string, Entity>,
  char: CharMeasure,
  collapsedIds: Set<string> = new Set(),
  expandedId: string | null = null,
  cache?: LayoutCache,
  measureKey?: string,
  descEditingId: string | null = null,
  fixedNoteIds: ReadonlySet<string> = new Set(),
  /**
   * G6′ 中心清单。非空 → 走 layoutForest（多中心各自布局后按坐标合并）；
   * 空 → 沿用 layoutMindmap（既有行为，含 LayoutCache 增量）。
   *
   * F 批（森林布局缓存）：cache / measureKey 透传至森林路径（通道就位，键位在
   * layoutForest 入口统一管理）——岛级缓存（F2：未编辑岛零重算）与岛内增量
   * （F3：编辑局部化）均已接入。
   */
  centers: readonly CenterSpec[] | null = null,
): DemoLayout {
  const base = createNodeMeasure(char, entities);
  const withQa = expandedId
    ? createExpandMeasure(base, expandedId, GROW_EXPAND_W, estimateCommentAreaHeight())
    : base;
  // 注意：measure 不含 editing 状态（见 createDescMeasure 注释）——编辑态不触发全树重排
  // note 笔记必须位于节点最下方；描述区先占用自身空间，再由固定笔记追加末尾区域。
  const withDesc = createDescMeasure(withQa, char, descEditingId);
  const measure = createFixedNoteMeasure(withDesc, fixedNoteIds, estimateNoteAreaHeight());
  const useForest = centers !== null && centers !== undefined && centers.length > 0;
  // FO-B1（框布局岛）：成框节点的子树先按「折叠」从基座布局剪出（框根本体仍以叶形态参与，
  // 父边端点不动），再由 `expandFrameIslands` 收成岛——大纲区行盒 + 挂点 + 空间层
  // （挂出子树交回现有单子树布局，见 kernel/layout/frameLayout.ts）。
  // 无成框节点时 `framePrunedCollapsed` 原样返回入参（同引用）且不展开 → 旧路径零行为变更。
  const frameRoots = collectFrameRoots(editable);
  const pruned = framePrunedCollapsed(collapsedIds, frameRoots);
  // FO-C1/C2：框内行度量选项（折行字符度量 + 附属区高度）——岛布局与壳度量**必须同一份**，
  // 否则基座占位（壳）与画出来的壳不一致（重复预留或空隙）。
  const frameRows = {
    textMeasure: char,
    rowAuxH: createFrameRowAuxH({ descEditingId, expandedId, fixedNoteIds }),
  };
  /**
   * FO-C2：成框根在基座布局里占**壳 AABB 体积**（= 大纲行包围盒 + FRAME_SHELL_PAD），
   * 于是邻节点/邻岛在第一帧就被摆在壳外，框内换行撑高会推动邻居重排（设计 §5.1
   * 「内容撑高，触发岛重排」）。
   *
   * 无成框节点时**不包一层**：measure 身份与逐值行为与 C2 前完全一致（无框零回归）。
   */
  const layoutMeasure =
    frameRoots.length === 0 ? measure : createFrameShellMeasure(measure, frameRows);
  const baseLayout = useForest
    ? layoutForest(
        centers!,
        layoutMeasure,
        pruned,
        cache ? { cache, measureKey: measureKey ?? undefined } : undefined,
      )
    // D2′ 接线：无 note.dir 声明时内部逐像素回退 layoutMindmap（旧文件零变更），
    // 有声明则按子节点各自 dir 分组挂不同侧（思想分叉）。
    : layoutMindmapBranched(
        editable,
        layoutMeasure,
        pruned,
        cache ? { cache, measureKey: measureKey ?? undefined } : undefined,
      );
  return {
    // 折叠语义：框根被用户折叠 → 整岛隐藏（expandFrameIslands 以 collapsedIds 判定，
    // 不能用剪枝集——框根恒在剪枝集里，那是「岛接管」而非「用户折叠」）。
    layout:
      frameRoots.length === 0
        ? baseLayout
        : expandFrameIslands(baseLayout, editable, layoutMeasure, collapsedIds, {
            cache,
            measureKey: measureKey ?? undefined,
            ...frameRows,
          }),
    measure,
  };
}

/**
 * G6″：布局岛视图组装（A3-2）——specs + 跨岛边界边 + 中心诊断，单一投影事实源。
 *
 * boundaryLinks 过滤（G3 批准案）：仅显示中心条目 `parent_link: 'show'` 的跨岛
 * 真实父子边；缺省 hide 兼容旧数据（已有 centers 文件历史行为是隐藏父子线）。
 * 边集合不参与自动布局，仅供渲染层画跨岛连接。
 */
export function buildIslandView(
  root: EditableNode,
  centers: readonly ValidatedCenterSpec[],
): {
  specs: CenterSpec[] | null;
  boundaryLinks: BoundaryLink[];
  diagnostics: IslandDiagnostic[];
  membersByRoot: Map<string, string[]>;
  /** 内容树上的嵌套升格：祖先中心 → 非切断子孙中心（Section 包容 / 拖动跟移） */
  nestedCenterIdsByRoot: Map<string, string[]>;
} {
  // 无中心标注 → null（回退既有单树 layoutMindmap，行为完全不变）
  if (centers.length === 0) {
    return {
      specs: null,
      boundaryLinks: [],
      diagnostics: [],
      membersByRoot: new Map(),
      nestedCenterIdsByRoot: new Map(),
    };
  }

  const projection = projectIslands(root, centers);
  const rootIsCenter = centers.some((c) => c.nodeId === root.id && c.state === 'well-formed');
  // 有效中心 = 实际产生了独立岛（升格节点在树上被投影剔除），或根本身是中心。
  // 「spec 形状有效但树上找不到」（如 nodeId 悬空）不算——projectIslands 会给它
  // 诊断并忽略，此时必须回退单树，不能退化成「只含根岛」的森林绕开 LayoutCache。
  const hasPromoted = projection.islands.some((i) => i.sourceKind === 'promoted');
  const specs: CenterSpec[] =
    hasPromoted || rootIsCenter
      ? projection.islands.flatMap((island): CenterSpec[] => {
          // 根岛输出条件：根本身是中心（显示根本体），或仍有未升格内容（虚拟根职责）。
          // 全部一级升格且根非中心 → 不输出根岛（文档根不显示，与 v1 行为一致，
          // 见 free-edges ★ 回归：此时自由边从 documentRoot 解析而非布局结果）。
          if (
            island.sourceKind === 'root' &&
            !rootIsCenter &&
            island.projectedRoot.children.length === 0
          ) {
            return [];
          }
          return [
            {
              node: island.projectedRoot,
              dir: island.direction,
              // pos 缺省 = 自动摆放；{x:0,y:0} 是合法坐标，只能按 null 判缺省
              ...(island.position !== null ? { pos: island.position } : {}),
            },
          ];
        })
      : [];

  // G3：跨岛父子边按中心条目的 parentLink 过滤（toId = 升格岛根 = 中心条目）
  const parentLinkShow = new Set(
    centers.filter((c) => c.parentLink === 'show').map((c) => c.nodeId),
  );
  const boundaryLinks = projection.boundaryLinks.filter((l) => parentLinkShow.has(l.toId));

  // A4：岛成员映射（拖动预览用；ownerByNodeId 反转即得，岛根恒在首位）
  const membersByRoot = new Map<string, string[]>();
  for (const island of projection.islands) {
    membersByRoot.set(island.rootId, [...island.memberIds]);
  }

  const centerIds = new Set<string>();
  const detachedIds = new Set<string>();
  for (const c of centers) {
    if (c.nodeId === null || c.state !== 'well-formed') continue;
    centerIds.add(c.nodeId);
    if (c.detached === true) detachedIds.add(c.nodeId);
  }
  const nestedCenterIdsByRoot = buildNestedCenterIdsByRoot(root, centerIds, detachedIds);

  return {
    specs: specs.length > 0 ? specs : null,
    boundaryLinks,
    diagnostics: projection.diagnostics,
    membersByRoot,
    nestedCenterIdsByRoot,
  };
}

/**
 * G6″：由文档级 center 标注构造中心清单（A3 起由递归布局岛投影驱动）。
 * specs 之外的边界边/诊断请用 buildIslandView（本函数是其薄包装，保持既有签名）。
 *
 * 升格语义 = 该子树从父岛**提出来**成为独立中心（任意深度，G1 批准），
 * 因此与语义父级的连线不再由树布局绘制（跨岛边界边由渲染层另行处理）。
 *
 * @returns 中心清单；无**有效**中心标注时返回 null（调用方回退 layoutMindmap +
 *          LayoutCache 旧路径——不能退化成「只含根岛」的森林绕开缓存全量重算）
 */
export function buildCenterSpecs(
  root: EditableNode,
  centers: readonly ValidatedCenterSpec[],
): CenterSpec[] | null {
  return buildIslandView(root, centers).specs;
}
