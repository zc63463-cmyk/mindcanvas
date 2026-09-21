/**
 * FreeEdgeLayer —— 自由边叠加层渲染（E2）。树形连线之上的语义边：
 * 贝塞尔曲线 + dir 箭头 + label chip + note 原生提示 + ghost 锚点 + 点击选中。
 * 数据/几何来自 freeEdges.ts 纯函数；本组件只做 SVG 组装。
 * 已知边界：Canvas 模式（>50K 自动降级）不渲染自由边——L3 场景树未含边类型，等场景 diff 批次补。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { EditableNode } from '@mindcanvas/kernel';
import type { Box } from '@mindcanvas/kernel';
import type { TokenSet } from '../theme/types.js';
import {
  edgeResolverOf,
  edgeVisualOf,
  freeEdgeEndpoints,
  type EdgeEndpoints,
  type EdgeManual,
  type FreeEdge,
} from './freeEdges.js';
import { buildObstacleTable, type ObstacleTable } from './obstacleTable.js';
import { LruCache, routeCacheConfig, routeCacheKey } from './routeCache.js';
import {
  applyLineJumps,
  manualAnchors,
  manualBezier,
  routeAesthetic,
  type RouteObstacle,
  type RouteResult,
} from './edgeRouting.js';
import type { FreeEdgeLabelSpec } from './EdgeLabelLayer.js';

/**
 * 人工锁定边的手动路径（Issue #3）。
 *
 * 交互契约（与 XMind / MindManager / Miro 一致）：用户一旦手动调整某条连线，
 * 自动优化立即停用，需显式恢复。手动几何存于边的 `manual` 透传字段，
 * 重载后保持 —— 尊重人工干预，不让自动路由覆盖用户的明确意图。
 */
// v1.3.0：EdgeManual 迁至 freeEdges.ts（数据契约层）以消除循环依赖 ——
// 本文件依赖 freeEdges，反向 import 会成环。此处 re-export 保持既有导入路径可用。
export type { EdgeManual } from './freeEdges.js';

/** 由手动字段还原路径；字段不全时退回直连。
 *  P1-3：形状语言与自动路由统一——语义锚基形（缺省贴边中点）+ 相切控制点 + 可调侧弓
 *  （curvature），不再回退到旧「盒中心法向弓」（跳变源头）。 */
function manualPathOf(edge: FreeEdge, from?: Box, to?: Box): RouteResult {
  const c = edge.manual?.curvature ?? 0;
  if (from && to) {
    const { p0, dir0, p3, dir3 } = manualAnchors(
      from,
      to,
      edge.manual?.from,
      edge.manual?.to,
    );
    const bez = manualBezier(p0, dir0, p3, dir3, c);
    return {
      d: bez.d,
      points: [p0, bez.mid, p3],
      routed: false,
      mid: bez.mid,
      nx: bez.nx,
      ny: bez.ny,
    };
  }
  return { d: '', points: [], routed: false, mid: { x: 0, y: 0 }, nx: 0, ny: 0 };
}

export interface FreeEdgeLayerProps {
  edges: readonly FreeEdge[];
  /** 端点盒取值（含动画帧插值盒）；端点无盒须返回 undefined（不可退化成零盒——否则边会飞向原点） */
  boxOf: (id: string) => Box | undefined;
  /**
   * FE-FRAME-1：端点**解析后提升**钩子（跨 Section 贴框 / 总览贴卡）。
   *
   * 在 `freeEdgeEndpoints` 之后、路由/缓存之前调用 —— 只允许改写 `eps.from / to` 两个盒
   * （fromId/toId/ghost/renderable 不得变）。缺省不启用：行为与改前逐位一致
   * （freeedge-equivalence 系列等价性测试覆盖无钩子路径）。
   * 引用稳定性要求同 boxOf —— 这是路由 useMemo 的依赖项之一。
   */
  refineEndpoints?: (edge: FreeEdge, eps: EdgeEndpoints) => EdgeEndpoints;
  root: EditableNode;
  collapsed: ReadonlySet<string>;
  token: TokenSet;
  selectedKey?: string | null;
  onSelect?: (edge: FreeEdge, sx: number, sy: number, withShift?: boolean) => void;
  /** R4-1：右键边（关系模式；preventDefault + 选中后回调，带指针屏幕坐标） */
  onEdgeContext?: (edge: FreeEdge, sx: number, sy: number) => void;
  /** R4-5：多选集合（批量高亮；与 selectedKey 单选并存） */
  selectedKeys?: readonly string[];
  /** E8：连线只在关系模式下可点选编辑 */
  interactive?: boolean;
  /**
   * 避障障碍物（画布上其它节点卡片的世界坐标盒 + 节点 id）。
   * 缺省空数组 → 退化为原「恒定弓高贝塞尔」行为（调用方在低 LOD / 大图时据此关闭避障）。
   *
   * 带 id 的原因：节点过渡动画期间端点走的是**插值盒**，与障碍集里的最终盒坐标不同，
   * 按坐标值无法判定"这是端点自己的卡片"；按 id 排除才可靠，否则连线会被自己的卡片
   * 判定为障碍而绕行。
   */
  obstacles?: readonly { id: string; box: RouteObstacle }[];
  /**
   * 屏幕坐标 → 世界坐标（Issue #3 拖拽 handle 定位用，由上层视口提供）。
   * 拖拽事件给的是屏幕坐标，而本组件渲染在世界坐标系（外层有 translate/scale），
   * 故需上层注入换算；缺省时拖拽 handle 不渲染（降级为不可拖拽）。
   */
  toWorld?: (sx: number, sy: number) => { x: number; y: number };
  /**
   * 手动调整回调（Issue #3）：拖拽端点 / bend 控制点后给出新的 manual 几何。
   * manual = null 表示「恢复自动优化」（清空人工锁定）。
   */
  onManualChange?: (edge: FreeEdge, manual: EdgeManual | null) => void;
  /**
   * 路由结果回调（Opp 精确翻转用）：把「边 key → 实际渲染的 RouteResult」抛给上层。
   *
   * 上层需要它来回答「这条边现在到底鼓向哪一侧」—— 只在 routingSide 未设（auto）时才需要，
   * 因为 auto 模式下鼓向由评分决定、光看数据无从得知。
   * 用回调而非让上层复刻计算：复刻会漏掉跨边交叉协调与 Line jumps 的影响，结论可能与实际渲染不符。
   */
  onRoutesChange?: (routes: ReadonlyMap<string, EdgeRouteEntry>) => void;
  /**
   * P2-1 降载：动画/瞬态期间跳过跨边交叉检测与 Line jumps（O(E²×P²) 成本），
   * 路由本身仍按 obstacles 快路径执行。静态态默认 false 行为不变。
   */
  fastRouting?: boolean;
  /**
   * R5-2：标签描述符上报（收集器）——标签渲染搬去宿主层（节点层之上，修遮挡）。
   * 本层不再渲染 EdgeLabel；命中区与 path 留原层（交互层级不得上提）。
   * 上报时机 = layout effect（与路由同一次提交内，标签不滞后一帧）；卸载时清空。
   */
  onLabelsChange?: (labels: readonly FreeEdgeLabelSpec[]) => void;
}

const GHOST_R = 4;
/** R5-2：空标签集（卸载清空宿主层用；模块级唯一引用 → set 短路成立） */
const EMPTY_LABELS: readonly FreeEdgeLabelSpec[] = [];

/**
 * 一条边的路由结果条目（Opp 精确翻转用）。
 * eps = 解析后的端点（含折叠上溯与幽灵锚点）；route = 实际渲染的几何（含跨边协调与 Line jumps 后的最终 d）。
 */
export type EdgeRouteEntry = {
  eps: ReturnType<typeof freeEdgeEndpoints>;
  route: RouteResult;
};

export function FreeEdgeLayer({
  edges,
  boxOf,
  refineEndpoints,
  root,
  collapsed,
  token,
  selectedKey,
  onSelect,
  onEdgeContext,
  selectedKeys,
  interactive = true,
  obstacles = [],
  toWorld,
  onManualChange,
  onRoutesChange,
  fastRouting = false,
  onLabelsChange,
}: FreeEdgeLayerProps) {
  // Issue #3：正在拖拽的 handle（端点 / bend 控制点）。仅选中的边渲染 handle，
  // 与 XMind 交互一致——选中关系线后才出现可拖拽的端点与控制点。
  const [drag, setDrag] = useState<{ key: string; handle: 'from' | 'to' | 'bend' } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  // 路由缓存（E8 性能 P4）：仅在「边集 / 端点盒 / 树结构 / 障碍集」变化时重算。
  // pan/zoom 的真实条件（G-P4 注释对齐，详见 docs/dispatch/2026-09-12-freeedge-routing-recompute-plan.md）：
  // 世界坐标路由与视口无关，且 boxOf / obstacles / collapsed 已稳定化 —— 但要害在 `edges`：其身份由
  //   ① 内容键稳定（G-P1）：成员不变 → 复用引用；② 裁剪窗口量化（G-P2）：memo 只在跨 256px 网格时重跑
  // ⇒ pan 期重算频率 ≈ 每 256px 至多一次（且仅成员真的变化时）；成员不变的小步平移 = 0 次。
  // 仅节点过渡动画期间（animBoxes 逐帧变化，且 MapView 侧 obstacles 置空 + fastRouting）才逐帧重算。
  //
  // G-P3（每边成本）：整表重算的内层 O(N) 降为「每次重算一次 + 每边 O(1)/轻量」：
  //  ① 端点解析器：一次 O(N) 树遍历摊薄到全部边（旧：每端点一次 collapsedAncestors DFS）；
  //  ② 障碍预构建表：盒数组与 id→下标建一次，端点排除只做整数比较（旧：每边 filter+map 两次遍历 + 两个数组）；
  //  ③ G-P3b 索引粗筛：大图按「外扩 R 保守界」查询障碍子集（短边大赢；长边窗口≈全图时自动回退②）。
  //  各路径逐字段等价由 tests/freeedge-equivalence.test.ts 钉死（接线前后均绿）。
  const resolveEndpoint = useMemo(
    () => edgeResolverOf(root, collapsed, boxOf),
    [root, collapsed, boxOf],
  );
  const obstacleTable = useMemo(() => buildObstacleTable(obstacles), [obstacles]);
  // G-P6（方案 A，开关默认关）：路由结果 LRU。key 见 routeCache.ts「key 口径」——
  // 命中场景 = 「成员进出但端点解析输出未变」的 pan（障碍集、端点盒、折叠解析全部未变）。
  // 换代兜底：obstacleTable 身份换代（布局/障碍重算）即弃缓存重建，杜绝过期避障。
  // 命中项同样 push points 进 routedPolylines——跨边协调的输入集语义不漂移。
  const routeCacheRef = useRef<{ gen: ObstacleTable; lru: LruCache<string, RouteResult> } | null>(
    null,
  );
  const routes = useMemo(() => {
    const m = new Map<string, { eps: ReturnType<typeof freeEdgeEndpoints>; route: RouteResult }>();
    // 跨边协调：按边顺序累积已路由路径，供后续边做「交叉罚分」。
    // 对应 Issue #2 —— 让多条关系线彼此错开，而不是各自为政地抢同一条通道。
    // 用「起点—中点—终点」三点折线近似曲线（交叉检测精度足够，成本远低于全曲线采样）。
    const routedPolylines: { x: number; y: number }[][] = [];
    // P0 · 平行入边错位：同一目标节点的第 N 条入边沿外侧轴反向错位（anchorStagger），
    // 避免多条边从同一个点扇形炸开（semanticAnchorPair 的 stagger 语义）。
    const staggerSeen = new Map<string, number>();
    // G-P6 缓存换代（显式 if，避免表达式内赋值）：同一障碍表代内复用 LRU；换代即重建
    let cache: { gen: ObstacleTable; lru: LruCache<string, RouteResult> } | null = null;
    if (routeCacheConfig.enabled) {
      const prev = routeCacheRef.current;
      if (prev && prev.gen === obstacleTable) {
        cache = prev;
      } else {
        cache = { gen: obstacleTable, lru: new LruCache<string, RouteResult>(512) };
        routeCacheRef.current = cache;
      }
    }
    // R4-3②：失效（invalidAt）边退出路由协调——不占 stagger 档、不进
    // routedPolylines（他人绕行/交叉罚分输入）、不参与跳线；自身仍路由并绘制（灰虚线）。
    const inactiveKeys = new Set<string>();
    for (const edge of edges) {
      const raw = freeEdgeEndpoints(edge, boxOf, root, collapsed, resolveEndpoint);
      // FE-FRAME-1：解析后提升（跨 Section 贴框 / 总览贴卡）。钩子只许改 from/to 两个盒；
      // 无钩子时 eps === raw —— 路由 / 缓存 key / 下游逐位与改前一致（等价性测试守护）。
      const eps = refineEndpoints !== undefined ? refineEndpoints(edge, raw) : raw;
      // 源锚未解析/端点盒缺失 → 不绘制（此前退化成指向世界原点的误导性直线）
      if (!eps.renderable) continue;
      const inactive = edge.invalidAt !== undefined;
      if (inactive) inactiveKeys.add(edge.key);
      const seq = inactive ? 0 : (staggerSeen.get(eps.toId) ?? 0);
      if (!inactive && eps.toId !== '') staggerSeen.set(eps.toId, seq + 1);
      // 按 id 排除两端自身卡片（动画期间坐标不可靠，见 obstacles 注释）；
      // G-P3：经预构建表排除（等价性：与 filter+map 逐项同序，测试钉死）；
      // G-P3b：大图时先索引粗筛（保守界推导见 obstacleTable.near 注释），收益不足（长边窗口≈全图）
      // 自动回退完整路径——两条路径结果逐位等价（freeedge-equivalence.test.ts 钉死）。
      const obs =
        obstacleTable.near(eps.from, eps.to, eps.fromId, eps.toId) ??
        obstacleTable.without(eps.fromId, eps.toId);
      const key = cache ? routeCacheKey(edge, eps, seq) : '';
      const hit = cache ? cache.lru.get(key) : undefined;
      // 新主路由：曲率自适应贝塞尔（外围绕行优先，见 edgeRouting.ts 顶部说明）。
      // 人工锁定的边跳过自动路由 —— 见 Issue #3 的 manual 字段约定。
      const route =
        hit ??
        (edge.manual
          ? manualPathOf(edge, eps.from, eps.to)
          : routeAesthetic(eps.from, eps.to, obs, inactive ? [] : routedPolylines, {
              // 用户指定的绕行侧优先于评分自动选择（对标 markvault forceSide）
              ...(edge.routingSide ? { forceSide: edge.routingSide } : {}),
              // P0 · 平行入边错位（步长 = 盒边长 × 0.0625，最多 4 档防出盒内缩）
              anchorStagger: Math.min(seq, 4),
            }));
      if (!hit) cache?.lru.set(key, route);
      m.set(edge.key, { eps, route });
      if (!inactive && route.points.length >= 2) routedPolylines.push([...route.points]);
    }

    // P2-1：动画/瞬态（fastRouting）跳过跨边交叉检测与 Line jumps——瞬态让步帧率。
    // 静态态行为与原实现逐位一致（applyLineJumps 抽出自下方的跳线块）。
    // R4-3②：失效边不参与跳线（不生弧、不收弧）——从输入集中剔除后合并回原条目。
    if (fastRouting) return m;
    if (inactiveKeys.size === 0) return applyLineJumps(m);
    const activeOnly = new Map([...m].filter(([k]) => !inactiveKeys.has(k)));
    const jumped = applyLineJumps(activeOnly);
    return new Map([...jumped, ...[...m].filter(([k]) => inactiveKeys.has(k))]);
  }, [edges, boxOf, refineEndpoints, root, collapsed, fastRouting, resolveEndpoint, obstacleTable]);

  // Opp 精确翻转：把实际渲染结果抛给上层（含跨边交叉协调与 Line jumps 的最终 d）。
  // 上层据此用 inferBowSide 判断当前鼓向，避免"复刻计算"与真实渲染不一致。
  useEffect(() => {
    onRoutesChange?.(routes);
  }, [routes, onRoutesChange]);

  // R5-2：标签描述符收集（渲染搬去宿主层——MapView 的 edge-labels 层，节点层之上）。
  // 字段口径与原渲染循环逐项一致：stroke 三态（失效→灰 / stale→warn / 语义色）、
  // ghost 边挂幽灵锚点、空文本不产出（EdgeLabel 内部再守一道——双保险）。
  // deps 全为稳定引用（edges 经 stableByKeys / routes 经 useMemo / token 主题级）——
  // 引用稳定是「store 引用相等短路」成立的前提（防宿主重渲回环）。
  const labels = useMemo(() => {
    const out: FreeEdgeLabelSpec[] = [];
    for (const edge of edges) {
      const cached = routes.get(edge.key);
      if (!cached) continue;
      const { eps, route } = cached;
      const visual = edgeVisualOf(edge, token);
      const invalidated = edge.invalidAt !== undefined;
      const stroke = invalidated
        ? token.color.textMuted
        : edge.state === 'stale'
          ? token.color.warn
          : visual.stroke;
      const text = edge.label !== undefined && edge.label !== '' ? edge.label : edge.rel;
      if (text === '') continue;
      out.push({
        key: edge.key,
        ax: eps.ghost ? eps.to.x + eps.to.w / 2 : route.mid.x,
        ay: eps.ghost ? eps.to.y + eps.to.h / 2 - GHOST_R : route.mid.y,
        nx: eps.ghost ? 0 : route.nx,
        ny: eps.ghost ? -1 : route.ny,
        text,
        stroke,
        muted: invalidated,
      });
    }
    return out;
  }, [edges, routes, token]);
  // 上报时机 = layout effect：与路由同一次提交内，标签不滞后一帧（pan/动画不脱节）
  useLayoutEffect(() => {
    onLabelsChange?.(labels);
  }, [labels, onLabelsChange]);
  // 卸载（边删光 / 切 SVG↔Canvas）→ 清空宿主层，防残留旧标签
  useLayoutEffect(() => {
    return () => onLabelsChange?.(EMPTY_LABELS);
  }, [onLabelsChange]);

  // Issue #3：拖拽期间在 window 上跟踪指针 —— 指针可能移出 SVG 区域，
  // 只在元素上监听会导致拖拽中断。
  useEffect(() => {
    if (!drag || !toWorld || !onManualChange) return;
    const target = edges.find((e) => e.key === drag.key);
    if (!target) return;
    const entry = routes.get(drag.key);
    if (!entry) return;
    const { eps } = entry;
    const a = eps.from;
    const b = eps.to;
    const cur = target.manual ?? {};

    const onMove = (ev: PointerEvent): void => {
      const w = toWorld(ev.clientX, ev.clientY);
      if (drag.handle === 'bend') {
        // bend：以「相对弦的垂距 / 弦长」作为曲率（与 bezierFromAnchors 的 bow 定义一致）
        const p0 = { x: a.x + a.w * (cur.from?.x ?? 0.5), y: a.y + a.h * (cur.from?.y ?? 0.5) };
        const p3 = { x: b.x + b.w * (cur.to?.x ?? 0.5), y: b.y + b.h * (cur.to?.y ?? 0.5) };
        const dx = p3.x - p0.x;
        const dy = p3.y - p0.y;
        const chord = Math.hypot(dx, dy) || 1;
        // 有符号垂距（叉积 / 弦长）
        const cross = ((w.x - p0.x) * dy - (w.y - p0.y) * dx) / chord;
        // bezierFromAnchors 中 mid 偏移 = 0.75 * chord * c，故 c = cross / (0.75 * chord)
        const c = cross / (0.75 * chord);
        onManualChange(target, { ...cur, curvature: Math.max(-2.5, Math.min(2.5, c)) });
        return;
      }
      // 端点：投影到对应盒，换算为归一化坐标（夹紧到 [0,1]）
      const box = drag.handle === 'from' ? a : b;
      const nx = box.w > 0 ? (w.x - box.x) / box.w : 0.5;
      const ny = box.h > 0 ? (w.y - box.y) / box.h : 0.5;
      const norm = { x: Math.max(0, Math.min(1, nx)), y: Math.max(0, Math.min(1, ny)) };
      onManualChange(
        target,
        drag.handle === 'from' ? { ...cur, from: norm } : { ...cur, to: norm },
      );
    };
    const onUp = (): void => setDrag(null);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, toWorld, onManualChange, edges, routes]);

  if (edges.length === 0) return null;
  // marker 按颜色去重（同色边共享箭头 def）
  const colors: string[] = [];
  const markerIdOf = (stroke: string): string => {
    let i = colors.indexOf(stroke);
    if (i < 0) {
      colors.push(stroke);
      i = colors.length - 1;
    }
    return `free-arrow-${i}`;
  };
  const onSelectRef = onSelect;
  const onEdgeContextRef = onEdgeContext;
  return (
    <g data-free-edge-layer data-layer="free-edges">
      <defs>
        {colors.map((c, i) => (
          <marker
            key={c}
            id={`free-arrow-${i}`}
            viewBox="0 0 10 10"
            refX={9}
            refY={5}
            markerWidth={7}
            markerHeight={7}
            orient="auto-start-reverse"
          >
            <path
              d="M1 1L9 5L1 9"
              fill="none"
              stroke={c}
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </marker>
        ))}
      </defs>
      {edges.map((edge) => {
        const cached = routes.get(edge.key);
        if (!cached) return null;
        const { eps, route } = cached;
        const { d } = route;
        const visual = edgeVisualOf(edge, token);
        const stale = edge.state === 'stale';
        const invalidated = edge.invalidAt !== undefined;
        const stroke = invalidated
          ? token.color.textMuted
          : stale
            ? token.color.warn
            : visual.stroke;
        const dashed = invalidated || stale || visual.dashed;
        const width = visual.width;
        const selected =
          selectedKey === edge.key || (selectedKeys?.includes(edge.key) ?? false);
        const mId = markerIdOf(stroke);
        const both = edge.dir === 'both' && !eps.ghost;
        const tip = [
          invalidated ? `已失效 ${edge.invalidAt?.slice(0, 10)}` : '',
          `${edge.rel}${edge.label ? ` · ${edge.label}` : ''}`,
          edge.source ? `来源: ${edge.source}` : '',
          edge.note ?? '',
          eps.ghost ? '锚点未命中（悬空）' : '',
        ]
          .filter(Boolean)
          .join('\n');
        return (
          <g key={edge.key} data-free-edge={edge.key} data-free-edge-state={edge.state}>
            <title>{tip}</title>
            {/* 命中区：宽透明描边，拦截点击（阻断下层 pan 启动）；浏览态不挂载（边只读）。
                R5-2：data-free-edge-hit 供层序契约测试钉「命中区留在节点层之下」。 */}
            {interactive && (
              <path
                data-free-edge-hit
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth={12}
                style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                onPointerDown={(e) => e.stopPropagation()}
                onContextMenu={(e) => {
                  // R4-1：阻断画布空白菜单（两层菜单）+ 浏览器原生菜单；右键同左键语义（选中）
                  e.preventDefault();
                  e.stopPropagation();
                  onSelectRef?.(edge, e.clientX, e.clientY);
                  onEdgeContextRef?.(edge, e.clientX, e.clientY);
                }}
                onClick={(e) => {
                  // R4-5：Shift 修饰随回调透传（多选切换由宿主决定）
                  onSelectRef?.(edge, e.clientX, e.clientY, e.shiftKey);
                }}
              />
            )}
            <path
              d={d}
              fill="none"
              stroke={stroke}
              strokeWidth={selected ? width + 0.8 : width}
              strokeDasharray={dashed ? '5 4' : undefined}
              markerEnd={eps.ghost ? undefined : `url(#${mId})`}
              markerStart={both ? `url(#${mId})` : undefined}
              opacity={selected ? 1 : 0.9}
              style={{ pointerEvents: 'none' }}
            />
            {eps.ghost && (
              <circle
                cx={eps.to.x + eps.to.w / 2}
                cy={eps.to.y + eps.to.h / 2}
                r={GHOST_R}
                fill="none"
                stroke={stroke}
                strokeWidth={1.2}
                strokeDasharray="2 2"
                style={{ pointerEvents: 'none' }}
              />
            )}
            {/* R5-2：关系标签已搬至宿主层（MapView「edge-labels」层，节点层之上）——
                本层只留命中区 + path + 幽灵点 + handles：交互层级不得随标签上提，
                否则宽透明描边会抢节点点击。标签描述符经 onLabelsChange 上报。 */}
            {/* Issue #3：手动覆盖 handle —— 选中边才显示（与 XMind 一致）：
                两个端点圆点（from/to）+ 一个 bend 方点（曲率）。拖动任一即写入
                edge.manual 并停用自动优化；Shift+点击 bend 或点击「恢复自动」清空。 */}
            {interactive && selected && toWorld && onManualChange && (
              <EdgeHandles
                edge={edge}
                entry={cached}
                token={token}
                onDragStart={(handle) => setDrag({ key: edge.key, handle })}
                onReset={() => onManualChange(edge, null)}
              />
            )}
          </g>
        );
      })}
    </g>
  );
}

/** Issue #3：端点 / bend 控制点渲染 */
function EdgeHandles({
  edge,
  entry,
  token,
  onDragStart,
  onReset,
}: {
  edge: FreeEdge;
  entry: { eps: ReturnType<typeof freeEdgeEndpoints>; route: RouteResult };
  token: TokenSet;
  onDragStart: (handle: 'from' | 'to' | 'bend') => void;
  onReset: () => void;
}) {
  const { eps, route } = entry;
  const cur = edge.manual ?? {};
  const p0 = {
    x: eps.from.x + eps.from.w * (cur.from?.x ?? 0.5),
    y: eps.from.y + eps.from.h * (cur.from?.y ?? 0.5),
  };
  const p3 = {
    x: eps.to.x + eps.to.w * (cur.to?.x ?? 0.5),
    y: eps.to.y + eps.to.h * (cur.to?.y ?? 0.5),
  };
  // bend 控制点：自中点沿法向外推（偏移量随曲率），让控制点落在曲线"弓起"的一侧
  const dx = p3.x - p0.x;
  const dy = p3.y - p0.y;
  const chord = Math.hypot(dx, dy) || 1;
  const nxv = -dy / chord;
  const nyv = dx / chord;
  const c = cur.curvature ?? 0;
  const bowPx = 0.75 * chord * c;
  const bend = { x: route.mid.x + nxv * bowPx, y: route.mid.y + nyv * bowPx };

  const dot = (p: { x: number; y: number }, handle: 'from' | 'to', fill: string): ReactElement => (
    <circle
      key={handle}
      data-edge-handle={handle}
      cx={p.x}
      cy={p.y}
      r={5}
      fill={fill}
      stroke={token.color.canvas}
      strokeWidth={1.5}
      style={{ cursor: 'grab', pointerEvents: 'all' }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onDragStart(handle);
      }}
    />
  );

  return (
    <g data-edge-handles>
      {/* bend 引导线（中点 → bend 点），让"曲率"可感知 */}
      <line
        x1={route.mid.x}
        y1={route.mid.y}
        x2={bend.x}
        y2={bend.y}
        stroke={token.color.textMuted}
        strokeWidth={0.8}
        strokeDasharray="3 2"
        style={{ pointerEvents: 'none' }}
      />
      {dot(p0, 'from', token.color.selection)}
      {dot(p3, 'to', token.color.selection)}
      <rect
        data-edge-handle="bend"
        x={bend.x - 4.5}
        y={bend.y - 4.5}
        width={9}
        height={9}
        rx={2}
        fill={token.color.selection}
        stroke={token.color.canvas}
        strokeWidth={1.5}
        style={{ cursor: 'grab', pointerEvents: 'all' }}
        onPointerDown={(e) => {
          e.stopPropagation();
          onDragStart('bend');
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onReset();
        }}
      >
        <title>拖动调整曲率；双击恢复自动优化</title>
      </rect>
    </g>
  );
}
