/**
 * G6′ 森林布局：多个「中心」各自局部布局后按坐标平移合并。
 *
 * 设计要点（与项目既有原则同构）：
 * - **复用而非改写**：每个中心内部交给现成的布局函数（logic-right / logic-left /
 *   org / org-up），本模块只做「局部布局 → 平移 → 合并」，布局算法一行不改
 * - **只有中心有坐标**：子树内节点的位置仍由算法决定，不落进事实源
 * - **缺失 pos 即自动排列**：无坐标的中心按 bounds **右边界**依次横向错开
 *   （对齐左边界而非根中心——四向生长的岛左翼会伸到根中心左侧，只按宽度顺排会压岛）
 *
 * ⚠️ 平移后必须**重新生成** links：path 字符串内含绝对坐标，
 * 只平移节点盒会让连线留在原地。重建按子节点有效方向 + hub 选线型（见 islandLinks）。
 */
import type { EditableNode } from '../tree/treeOps.js';
import {
  layoutBounds,
  type ForestIslandEntry,
  type GrowDir,
  type LayoutCache,
  type LayoutResult,
  type LayoutNode,
  type LinkGeometry,
  type MeasureFn,
} from './mindmap.js';
import { layoutLogic, layoutOrg, type LayoutKind } from './layouts.js';
import { layoutMindmapBranched, linkGeometry } from './branching.js';

/** 中心生长方向（四向）。
 *  定义在 mindmap.ts（布局基座）——forest 与 layouts 都依赖它；
 *  若定义留在本文件，layouts 取型会形成 forest↔layouts 循环依赖（depcruise 拦截实证）。
 *  此处转出口保持既有导入路径（islands/pipeline/kernel index）不受影响。 */
export type { GrowDir } from './mindmap.js';

/** 一个中心：升格的节点 + 生长方向 + 可选摆放坐标 */
export interface CenterSpec {
  /** 中心节点（作为该子树的根做局部布局） */
  node: EditableNode;
  /** 子树生长方向 */
  dir: GrowDir;
  /**
   * 中心（根）节点**中心**的世界坐标。
   * 缺省 → 由 layoutForest 按 bounds 自动横向排布。
   */
  pos?: { x: number; y: number };
}

/** 方向 → 局部布局函数（仅取 nodes/bounds；links 平移后由 islandLinks 重建）。
 *  F3：第 4 参透传缓存选项——岛内经典布局（layoutLogic/layoutOrg）接 LayoutCache
 *  增量原语（编辑局部化）；调用方（branching 的 fallback 调用点）负责传参。 */
const LAYOUT_BY_DIR: Record<
  GrowDir,
  (
    r: EditableNode,
    m: MeasureFn,
    c: Set<string>,
    opts?: { cache?: LayoutCache; measureKey?: string },
  ) => LayoutResult
> = {
  right: (r, m, c, o) => layoutLogic(r, m, c, 1, o),
  left: (r, m, c, o) => layoutLogic(r, m, c, -1, o),
  down: (r, m, c, o) => layoutOrg(r, m, c, 1, o),
  up: (r, m, c, o) => layoutOrg(r, m, c, -1, o),
};

/** 方向 → 文档级布局类型（供 UI 复用同一套映射） */
export const LAYOUT_KIND_BY_DIR: Record<GrowDir, LayoutKind> = {
  right: 'logic-right',
  left: 'logic-left',
  down: 'org',
  up: 'org-up',
};

function emptyResult(): LayoutResult {
  return { nodes: [], links: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
}

/**
 * 森林布局。
 *
 * @param centers      中心清单（顺序影响自动排列次序）
 * @param measure      节点度量
 * @param collapsedIds 折叠集合（所有中心共享）
 * @param opts.gap     自动排列时相邻中心的间距（世界坐标 px）
 * @param opts.cache   增量缓存（F 批通道）：契约与 layoutMindmap 同款——
 *                     collapsedKey / measureKey **身份比较**不匹配 → reset() 全量
 *                     （不用内容深比较替代）。对象归属由宿主单点持有（复用同一实例）。
 * @param opts.measureKey 度量语义键（字体/实体/展开态变化 → 换键强制全量）
 */
export function layoutForest(
  centers: readonly CenterSpec[],
  measure: MeasureFn,
  collapsedIds: Set<string>,
  opts: { gap?: number; cache?: LayoutCache; measureKey?: string; measureDepthBase?: number } = {},
): LayoutResult {
  if (centers.length === 0) return emptyResult();

  const gap = opts.gap ?? 160;
  const cache = opts.cache;
  // MEASURE-RANK：岛内局部深度 + 基准 = 文档绝对深度（视觉档度量用）。
  // 缺省 0 = 顶层森林（岛根即文档深度 0），逐像素维持旧行为。
  const depthBase = opts.measureDepthBase ?? 0;
  const islandMeasure: MeasureFn =
    depthBase === 0 ? measure : (node, depth) => measure(node, depthBase + (depth ?? 0));
  // 缓存失效契约（与 layoutMindmap 的 mindmap.ts:112-121 逐字同款）：
  // collapsedIds / measureKey 均**身份比较**，不匹配即 reset() + 全量。
  // 本检查先于任何岛内布局执行——分支路径当前忽略缓存命中，但通道的键位在此统一管理，
  // 防止两套失效纪律漂移（岛级/岛内缓存复用同一实例，见 F2/F3）。
  const cacheValid =
    cache !== undefined &&
    cache.collapsedKey === collapsedIds &&
    cache.measureKey === (opts.measureKey ?? null);
  if (cache && !cacheValid) {
    cache.reset();
    cache.collapsedKey = collapsedIds;
    cache.measureKey = opts.measureKey ?? null;
  }

  // ① 局部布局 + 记录每棵子树的局部包围盒（自动排列用真实 bounds，不再只用宽度）
  //    D2′ 接线：岛内也要支持「思想分叉」——走分支布局（注入 islandDir=岛方向）；
  //    无 note.dir 声明时 layoutMindmapBranched 内部逐像素回退经典布局，零行为变更。
  //
  //    F2 岛级缓存：键 = 岛根**对象身份** + dir（collapsedKey/measureKey 已在入口统一校验）。
  //    身份键的可靠性（§1.4）：不可变编辑只重建到编辑点为止的祖先链 + 投影复用未变节点壳
  //    ⇒ 编辑岛 I 内任一节点 → I 的投影岛根换壳（miss → 重算）；其它岛岛根身份不变（命中）。
  //    已知边界：投影壳易位（如根岛/含嵌套升格的岛每次投影换新壳）→ 恒 miss 重算——
  //    只影响提速、不影响正确性。
  const local = centers.map((spec) => {
    const entries = cache?.forestIslands.get(spec.node);
    // 命中判据含 depthBase（MEASURE-RANK）：同岛根在不同基准下的盒尺寸不同，不得混用
    const hit = entries?.find((e) => e.dir === spec.dir && (e.depthBase ?? 0) === depthBase);
    if (hit) return { spec, res: hit.local, dirSink: hit.dirSink, entry: hit };

    const dirSink = new Map<string, GrowDir>();
    const res = layoutMindmapBranched(spec.node, islandMeasure, collapsedIds, {
      islandDir: spec.dir,
      // 回退沿用岛内原四向布局（整棵朝该方向），保证无 note.dir 时零行为变更
      fallback: LAYOUT_BY_DIR[spec.dir],
      dirSink,
      // 通道：cache / measureKey 透传到岛内布局调用面——无 dir 回退（LAYOUT_BY_DIR
      // 四向经典布局）与分支基准（layoutMindmap）已接增量原语（F3）；分支路径自身的
      // 骨架/消解/放置步骤仍为全量（范围与理由见 F3 收口报告）。
      cache,
      measureKey: opts.measureKey,
    });
    const entry: ForestIslandEntry = { dir: spec.dir, depthBase, local: res, dirSink, placed: null };
    if (cache) {
      const list = cache.forestIslands.get(spec.node);
      if (list) list.push(entry);
      else cache.forestIslands.set(spec.node, [entry]);
    }
    return { spec, res, dirSink, entry };
  });

  // ② 确定落点：有 pos 用 pos；无 pos 则**按真实包围盒**向右错开。
  //    注意 origin 是「中心节点中心」，而岛可以向任意方向生长——向左/向上生长的岛，
  //    其翼展落在 origin 的负方向。若只按宽度 cursorX += w 顺排，下一个岛的左翼就会
  //    压进前一个岛（这正是四向生长引入的跨岛重叠）。故改为对齐**最右边界**：
  //    下一个岛的左边界 = 已摆放岛的最右边界 + gap。
  //    （首岛保持 origin.x = 0，与既有绝对坐标口径一致。）
  const origins: { x: number; y: number }[] = [];
  let rightMost: number | null = null;
  const advanceRight = (x: number, maxX: number): void => {
    const right = x + maxX;
    if (rightMost === null || right > rightMost) rightMost = right;
  };
  for (const item of local) {
    if (item.spec.pos) {
      origins.push(item.spec.pos);
      advanceRight(item.spec.pos.x, item.res.bounds.maxX);
    } else {
      const x = rightMost === null ? 0 : rightMost + gap - item.res.bounds.minX;
      origins.push({ x, y: 0 });
      advanceRight(x, item.res.bounds.maxX);
    }
  }

  // ③ 合并：从**局部产物**产出平移副本（非破坏式——缓存条目永不被平移污染；
  //    原地累加 + 跨调用复用 = 几何逐次漂移，坑 1）。
  //    placedAt 守卫：落点与上次一致 → 直接复用上次平移产物（引用复用，零分配）；
  //    否则从 local 重建（纯函数，无累加）。
  const nodes: LayoutNode[] = [];
  const links: LinkGeometry[] = [];
  local.forEach((item, i) => {
    const origin = origins[i] ?? { x: 0, y: 0 };
    const entry = item.entry;
    const placed = entry.placed;
    if (placed && placed.at.x === origin.x && placed.at.y === origin.y) {
      nodes.push(...placed.result.nodes);
      links.push(...placed.result.links);
      return;
    }
    const shifted = shiftIsland(item.res, origin, item.spec.dir, item.dirSink);
    entry.placed = { at: { x: origin.x, y: origin.y }, result: shifted };
    nodes.push(...shifted.nodes);
    links.push(...shifted.links);
  });

  return { nodes, links, bounds: layoutBounds(nodes) };
}

/**
 * 岛合并期平移（非破坏式）：从**局部产物**产出平移副本 + 重建岛内连线。
 *
 * 为什么重建 links：path 字符串内含绝对坐标，平移节点盒会让连线留在原地——
 * 必须按平移后的世界坐标重算（岛内线型按 dirSink 有效方向选，见 islandLinks）。
 *
 * 为什么不原地平移：局部产物被岛级缓存跨调用持有；原地累加会让第二次平移基于
 * 已平移的盒再加 delta（几何逐次漂移）。本函数对 local 零写入。
 */
function shiftIsland(
  local: LayoutResult,
  origin: { x: number; y: number },
  dir: GrowDir,
  dirSink: ReadonlyMap<string, GrowDir>,
): LayoutResult {
  const root = local.nodes.find((n) => n.parentId === null) ?? null;
  if (!root) return emptyResult();
  // 局部布局中「根节点中心」的位置 → 需要平移到 origin
  const dx = origin.x - (root.box.x + root.box.w / 2);
  const dy = origin.y - (root.box.y + root.box.h / 2);
  const entry = shiftTree(root, dx, dy);
  const nodes = entry.preorder;
  return { nodes, links: islandLinks(entry.shifted, dir, dirSink), bounds: layoutBounds(nodes) };
}

/**
 * 平移副本（**每次实算——不可 memo**，F5 复核证据链）：
 * 任何「身份 + 部分输入」的 memo 都不充分——条目有效性要求「整棵源子树的 box 均未变」，
 * 而岛内放置重放会**原地改写复用 LayoutNode 的 box**（F3 机制），身份相等 ≠ 几何未变
 * （实测：memo 只校验 (dx,dy) 时，深层 w-编辑可只改后代 box 而岛 dx/dy 不变 → 命中
 * 返回陈旧副本，n5 差 36px 且持久）。「补 node 自身 box 校验」同样不充分：只覆盖祖先
 * 自身、不覆盖后代被改写的情形。故放弃 memo；复核实测代价 ~2.1ms，远低于 16ms 预算。
 * 回归钉：`tests/layout-forest-shift-invariance.test.ts`（四方向 × 两种 measure 矩阵）。
 *
 * 返回 { shifted, preorder }：shifted = 平移副本树（全新对象；对源树零写入），
 * preorder = 其前序数组（与 shifted 同构；直接并入输出）。
 */
interface ShiftedEntry {
  shifted: LayoutNode;
  /** 子树前序数组（与 shifted 同构） */
  preorder: LayoutNode[];
}

function shiftTree(ln: LayoutNode, dx: number, dy: number): ShiftedEntry {
  const children = ln.children.map((c) => shiftTree(c, dx, dy));
  const shifted: LayoutNode = {
    ...ln,
    box: { x: ln.box.x + dx, y: ln.box.y + dy, w: ln.box.w, h: ln.box.h },
    children: children.map((c) => c.shifted),
  };
  const preorder: LayoutNode[] = [shifted];
  for (const c of children) {
    for (const n of c.preorder) preorder.push(n);
  }
  return { shifted, preorder };
}

/**
 * 岛内连线重建（平移后 path 必须重算 —— 字符串内含绝对坐标）。
 *
 * **线型与岛外同族**：按子节点**有效生长方向**（布局落位期回填的 dirSink）与 hub 标记
 * 选几何（linkGeometry：左右组 hub 走共享竖梁 / up·down 走共享梁 / 其余贝塞尔）。
 * 此前一律套用「岛方向」构建器：右岛里 up/down 共享梁与 hub 共享竖梁全被画成贝塞尔，
 * 而渲染端自己按 dir/hub 重建 —— 「内核挑的线」≠「屏幕上的线」（岛文档全量失配）。
 *
 * dirSink 缺省或未命中的节点回落岛方向 —— 经典岛（全树无显式 dir）语义逐像素不变。
 * 不传节点索引（不做避障挑选）：与既有森林行为一致，只保证线型家族正确。
 */
function islandLinks(
  root: LayoutNode,
  islandDir: GrowDir,
  dirSink: ReadonlyMap<string, GrowDir>,
): LinkGeometry[] {
  // linkGeometry 的 dirOf 是「整棵岛」的查询表：未回填者（含根）一律按岛方向——
  // 不能让它落到内部的 `?? 'right'`（up/down 组的梁高会按错方向过滤兄弟）。
  const dirOf = new Map<string, GrowDir>();
  const collect = (ln: LayoutNode): void => {
    dirOf.set(ln.node.id, dirSink.get(ln.node.id) ?? islandDir);
    ln.children.forEach(collect);
  };
  collect(root);
  const out: LinkGeometry[] = [];
  const walk = (ln: LayoutNode): void => {
    for (const c of ln.children) {
      out.push({
        path: linkGeometry(ln, c, dirOf.get(c.node.id) ?? islandDir, dirOf).path,
        depth: ln.depth,
        fromId: ln.node.id,
        toId: c.node.id,
      });
      walk(c);
    }
  };
  walk(root);
  return out;
}

/** 方向 → 中文标签（UI 用） */
export const GROW_DIR_LABEL: Record<GrowDir, string> = {
  right: '向右',
  left: '向左',
  down: '向下',
  up: '向上',
};
