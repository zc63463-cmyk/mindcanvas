/**
 * 画布手势（pan 平移 / pinch 多指缩放 / 节点拖拽结束）的状态与处理器。
 *
 * 从 `MapView` 拆出，属代码结构规范化 T2。承载画布手势的**全部四个**处理器
 * （onPointerDown / Move / Up / Cancel）与两个 ref 状态（pinch / dragRef）。
 *
 * 分三小步渐进迁移完成（每步独立验证、独立提交）：
 *   ① 抽出 worldPointOf / hitNodeAt 消除 5 处重复
 *   ② 搬入结束类处理器（Up / Cancel）
 *   ③ 搬入起始类处理器（Down / Move）
 * 全程保持 Hook 数量与调用位置恒定，故未触碰 Hook 顺序敏感性问题。
 *
 * 同时承载 `worldPointOf` / `hitNodeAt` 两个交互辅助函数：
 * 它们被 MapView 的多个处理器共用，放在这里以保持单向依赖（MapView → 本模块）。
 *
 * 不是什么：不含节点渲染、连线路由、自由边、连接手柄（仍在 MapView）；
 * 本模块只负责「指针事件 → 手势状态 / 节点拖拽状态」这一层。
 */

import { type BoxIndex, type LayoutResult, queryBoxIndex } from '@mindcanvas/kernel';
import type { Dispatch, PointerEvent as ReactPointerEvent, SetStateAction } from 'react';
import { useRef } from 'react';
import {
  beamDragCommit,
  beamDragMove,
  hitBeamAt,
  hitBeamTarget,
  type BeamCommit,
  type BeamDragState,
  type BeamHandle,
} from './beamDrag.js';
import { PAN_INERTIA_TRIGGER, PAN_SAMPLE_WINDOW } from './motion.js';
import { type DropMode, dropModeFor, planDrop } from './nodeDrag.js';
import { PinchTracker } from './pinch.js';
import { estimatePanVelocity, type PanSample, type ViewportController } from './viewport.js';

/** 可见节点（= layout.nodes 的元素） */
export type VisibleNode = LayoutResult['nodes'][number];

/** 节点拖拽状态（与 MapView 内 useState 的结构一致） */
export interface NodeDragState {
  nodeId: string;
  pointerId: number;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  moved: boolean;
  targetId: string | null;
  mode: DropMode;
  valid: boolean;
}

/** 画布平移拖拽的运行时状态 */
interface PanDrag {
  id: number;
  x: number;
  y: number;
  moved: boolean;
  samples: PanSample[];
}

/**
 * 指针事件 → 世界坐标（扣掉容器偏移）。
 *
 * 这是所有命中测试 / 拖拽定位的公共第一步。原先在 onPointerDown / onPointerUp /
 * onContextMenu / onDoubleClick 里各写一遍（4 处重复），收敛到此处。
 */
export function worldPointOf(
  e: { clientX: number; clientY: number },
  el: { getBoundingClientRect(): { left: number; top: number } },
  viewport: ViewportController,
): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  return viewport.toWorld(e.clientX - rect.left, e.clientY - rect.top);
}

/** 命中容差（世界单位）：hitNodeAt 精判与索引粗筛的查询矩形共用同一常量 */
export const HIT_PAD = 6;

/**
 * 自后向前命中可见节点（后绘制的在上，故倒序遍历），返回最顶层的命中项。
 *
 * `skip` 用于排除：拖拽时跳过根节点（depth===0 不可拖）、
 * 以及拖拽中被排除的节点自身（dragExcluded）。
 *
 * B-P1：传入 `index`（调用方按可见集建好、跨帧复用）时先做**索引粗筛**再精判 ——
 * 语义与原线性路径逐字节一致（同样的倒序「取最大下标命中」、同样的 skip 过滤、同样的 6px pad）；
 * `index` 缺省 / null 时走原线性路径（小图零回归）。
 */
export function hitNodeAt(
  visible: readonly VisibleNode[],
  w: { x: number; y: number },
  skip?: (ln: VisibleNode) => boolean,
  index?: BoxIndex | null,
): VisibleNode | null {
  if (!index) {
    for (let i = visible.length - 1; i >= 0; i--) {
      const ln = visible[i]!;
      if (skip?.(ln)) continue;
      if (worldHitPad(ln.box, w)) return ln;
    }
    return null;
  }
  // 粗筛：查询矩形 = 命中点 ± HIT_PAD（与精判同口径；queryBoxIndex 结果按下标升序）
  const candidates = queryBoxIndex(index, {
    x: w.x - HIT_PAD,
    y: w.y - HIT_PAD,
    w: HIT_PAD * 2,
    h: HIT_PAD * 2,
  });
  let best: VisibleNode | null = null;
  let bestIdx = -1;
  for (const i of candidates) {
    if (i <= bestIdx) continue; // 升序遍历 → 取通过精判的最大下标（= 线性版倒序的首个命中）
    const ln = visible[i];
    if (!ln || skip?.(ln)) continue;
    if (worldHitPad(ln.box, w)) {
      best = ln;
      bestIdx = i;
    }
  }
  return best;
}

/** 命中判定（含 `HIT_PAD` 容差）——抽出来只为让 hitNodeAt 保持单一职责 */
function worldHitPad(box: VisibleNode['box'], w: { x: number; y: number }): boolean {
  return (
    w.x >= box.x - HIT_PAD &&
    w.x <= box.x + box.w + HIT_PAD &&
    w.y >= box.y - HIT_PAD &&
    w.y <= box.y + box.h + HIT_PAD
  );
}

export interface UseMapGesturesParams {
  viewport: ViewportController;
  layout: LayoutResult;
  /** 视口裁剪后的可见节点（命中测试只遍历它，不遍历全量） */
  visibleNodes: readonly VisibleNode[];
  /**
   * B-P1：可见集的网格索引（MapView 在节点数 ≥ INDEX_MIN_NODES 时建好、跨帧复用）。
   * 传入后命中测试先粗筛再精判；缺省 / null = 原线性路径。
   */
  hitIndex?: BoxIndex | null;
  nodeDrag: NodeDragState | null;
  setNodeDrag: Dispatch<SetStateAction<NodeDragState | null>>;
  /** 拖拽中需排除的节点（被拖节点及其子树），避免命中自身 */
  dragExcluded?: ReadonlySet<string> | null;
  /** 合法落点 → 执行移动 op；非法（成环/自拖/根目标）→ 不回调 */
  onNodeMove?: (op: NonNullable<ReturnType<typeof planDrop>['op']>) => void;
  onNodeClick?: (ln: VisibleNode, info: { shift: boolean; sx: number; sy: number }) => void;
  /** 指针悬停到节点（未按下时）；移出节点时传 null —— 供上层显示注释浮窗 */
  onNodeHover?: (id: string | null, at: { x: number; y: number }) => void;
  /** 点击空白处（未命中任何节点）：用于取消选中 / 收起放大展开 */
  onBlankClick?: () => void;
  /**
   * G6′：该节点是否为「中心」。
   * 中心拖拽 = **移动坐标**（带动整棵子树），而非改树结构 ——
   * 因此拖拽期间不做落点/成环判定，也不显示落点指示器。
   */
  isCenter?: (id: string) => boolean;
  /** G6′：中心拖拽结束 —— 世界坐标位移（已除以缩放 k） */
  onCenterMove?: (id: string, worldDx: number, worldDy: number) => void;
  /** v1.7.0：hub 共享梁把手（beamDrag.buildBeamHandles 产出；缺省 = 不启用梁拖拽） */
  beamHandles?: readonly BeamHandle[];
  /** v1.7.0：梁拖拽状态（MapView useState——渲染叠层消费） */
  beamDrag?: BeamDragState | null;
  setBeamDrag?: Dispatch<SetStateAction<BeamDragState | null>>;
  /**
   * v1.11.0（双把手）：梁拖拽松手 —— 单字段提交（lens 写 lens[dir] / bias 写 beamAt[dir]，
   * 单条 undo；拖拽中不落盘）。
   */
  onBeamChange?: (fromId: string, commit: BeamCommit) => void;
  /** v1.7.0：梁悬停方向变化（null = 离开梁/命中节点）——供上层切换 ns/ew-resize 光标 */
  onBeamHover?: (dir: BeamDragState['handle']['dir'] | null) => void;
  /**
   * B-P3：**缩放手势**（多指 pinch）起止各上报一次 true/false ——
   * 供 MapView 在手势期间冻结 LOD（跨阈值不反复重排）；**平移不触发**（平移不改 k，LOD 天然稳定）。
   */
  onGestureActive?: (active: boolean) => void;
}

export function useMapGestures({
  viewport,
  layout,
  visibleNodes,
  hitIndex,
  nodeDrag,
  setNodeDrag,
  dragExcluded,
  onNodeMove,
  onNodeClick,
  onBlankClick,
  onNodeHover,
  isCenter,
  onCenterMove,
  beamHandles,
  beamDrag,
  setBeamDrag,
  onBeamChange,
  onBeamHover,
  onGestureActive,
}: UseMapGesturesParams) {
  /** R2：多指 pinch 跟踪（≥2 指 → 缩放模式，抑制 pan / 节点拖拽） */
  const pinch = useRef(new PinchTracker());
  /** 画布平移拖拽（含 M5-T4 速度采样，用于松手惯性） */
  const dragRef = useRef<PanDrag | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>): void => {
    // 用户接管视口：打断进行中的视口动画（M5-T3）
    viewport.cancelAnim();
    // R2：多指登记——第二指落下进入 pinch（取消单指 pan / 节点拖拽 / 梁拖拽）
    if (pinch.current.down(e.pointerId, e.clientX, e.clientY)?.type === 'start') {
      onGestureActive?.(true); // B-P3：pinch 开始（冻结 LOD）
      dragRef.current = null;
      setNodeDrag(null);
      setBeamDrag?.(null);
      return;
    }
    const w = worldPointOf(e, e.currentTarget, viewport);
    // 命中节点 → 节点拖拽重排；空白 → 画布平移。
    // 「根不可拖」排除的是**文档根**；森林布局下升格岛根同为 depth===0，
    // 但它们是中心（拖拽 = 移动坐标）——不得被排除，否则中心岛永远拖不动
    // （A4 修复：此前中心岛根被跳过后落入 pan 分支，拖动变成平移画布）。
    const hitId =
      hitNodeAt(
        visibleNodes,
        w,
        (ln) => ln.depth === 0 && !isCenter?.(ln.node.id),
        hitIndex,
      )?.node.id ?? null;
    if (hitId !== null) {
      onBeamHover?.(null); // 节点命中优先 → 清梁悬停（光标回默认）
      setNodeDrag({
        nodeId: hitId,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        dx: 0,
        dy: 0,
        moved: false,
        targetId: null,
        mode: 'child',
        valid: false,
      });
    } else if (beamHandles && setBeamDrag) {
      // v1.7.0：共享梁拖拽——梁线 ±8px 带内按下（空白处，节点命中之后）→ 优先于画布平移
      // v1.11.0：命中分裂——主干带 → bias（只写 beamAt）；梁中段（扣除交汇垫）→ lens（写 lens）
      const hit = hitBeamTarget(beamHandles, w);
      if (hit) {
        setBeamDrag({
          handle: hit.handle,
          mode: hit.mode,
          pointerId: e.pointerId,
          startW: w,
          len: hit.handle.startLen,
          at: hit.handle.at,
          moved: false,
          curW: w,
        });
      } else {
        dragRef.current = {
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          moved: false,
          samples: [],
        };
      }
    } else {
      dragRef.current = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        moved: false,
        samples: [],
      };
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>): void => {
    // R2：pinch 路径——距离比 → zoomAt(指间中点)；中点位移自然转化为平移
    if (pinch.current.active) {
      const ev = pinch.current.move(e.pointerId, e.clientX, e.clientY);
      if (ev?.type === 'zoom') {
        const rect = e.currentTarget.getBoundingClientRect();
        viewport.zoomAt(ev.midX - rect.left, ev.midY - rect.top, ev.factor);
      }
      return;
    }
    // 节点拖拽路径（M5-T5）
    const nd = nodeDrag;
    if (nd) {
      if (nd.pointerId !== e.pointerId) return;
      const dx = e.clientX - nd.startX;
      const dy = e.clientY - nd.startY;
      if (!nd.moved && Math.hypot(dx, dy) <= 4) return; // 未过拖拽阈值
      // G6′：中心拖拽 = 移动坐标，不做落点/成环判定（否则会出现
      // 「拖到别的节点上就变成改结构」的歧义行为）
      if (isCenter?.(nd.nodeId)) {
        setNodeDrag({ ...nd, dx, dy, moved: true, targetId: null, mode: 'child', valid: true });
        return;
      }
      // 悬停目标：命中可见节点（排除自身子树）→ 按悬停带判定插入模式
      const w = worldPointOf(e, e.currentTarget, viewport);
      let targetId: string | null = null;
      let mode: DropMode = 'child';
      const target = hitNodeAt(
        visibleNodes,
        w,
        (ln) => dragExcluded?.has(ln.node.id) ?? false,
        hitIndex,
      );
      if (target) {
        targetId = target.node.id;
        mode = dropModeFor(target.box, w);
      }
      const plan = targetId ? planDrop(layout, nd.nodeId, targetId, mode) : null;
      setNodeDrag({
        ...nd,
        dx,
        dy,
        moved: true,
        targetId,
        mode,
        valid: plan?.valid ?? false,
      });
      return;
    }
    // v1.7.0：梁拖拽路径（预览；不落盘）——lens 沿行程轴映射新层距 / bias 沿空隙轴映射比例位
    if (beamDrag && setBeamDrag) {
      if (beamDrag.pointerId !== e.pointerId) return;
      setBeamDrag(beamDragMove(beamDrag, worldPointOf(e, e.currentTarget, viewport)));
      return;
    }
    // 画布平移路径（含 M5-T4 速度采样）
    const d = dragRef.current;
    // 未按下时（纯移动）也要做命中检测 —— 供上层显示节点注释浮窗（悬停预览）
    if (!d) {
      const w = worldPointOf(e, e.currentTarget, viewport);
      const hit = hitNodeAt(visibleNodes, w, undefined, hitIndex);
      onNodeHover?.(hit ? hit.node.id : null, { x: e.clientX, y: e.clientY });
      // v1.7.0：梁悬停方向（节点命中优先 → null）——上层据此切换 ns/ew-resize 光标
      const bh = hit === null && beamHandles ? hitBeamAt(beamHandles, w) : null;
      onBeamHover?.(bh === null ? null : bh.dir);
      return;
    }
    if (d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) > 3) d.moved = true;
    if (d.moved) {
      // 速度采样（M5-T4 惯性：最近窗口位移/时长）
      d.samples.push({ t: performance.now(), dx, dy });
      if (d.samples.length > PAN_SAMPLE_WINDOW) d.samples.shift();
      viewport.panBy(dx, dy);
      d.x = e.clientX;
      d.y = e.clientY;
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLElement>): void => {
    // R2：指头抬起——退出登记（剩一指重新按下即可恢复 pan）
    const wasPinching = pinch.current.active;
    pinch.current.up(e.pointerId);
    if (wasPinching && !pinch.current.active) onGestureActive?.(false); // B-P3：pinch 结束
    // 节点拖拽结束（M5-T5）：合法落点 → move-node op；非法/无目标 → 拒绝；未移动 → 点击选中
    const nd = nodeDrag;
    if (nd && nd.pointerId === e.pointerId) {
      if (nd.moved) {
        if (isCenter?.(nd.nodeId)) {
          // G6′：屏幕位移 → 世界位移（除以缩放）
          const k = viewport.transform.k > 0 ? viewport.transform.k : 1;
          if (onCenterMove) onCenterMove(nd.nodeId, nd.dx / k, nd.dy / k);
        } else {
          const plan = nd.targetId ? planDrop(layout, nd.nodeId, nd.targetId, nd.mode) : null;
          if (plan?.valid && plan.op) onNodeMove?.(plan.op);
          // 非法（成环/自拖/根目标）→ 不执行任何 op
        }
      } else {
        const ln = layout.nodes.find((n) => n.node.id === nd.nodeId);
        if (ln) onNodeClick?.(ln, { shift: e.shiftKey, sx: e.clientX, sy: e.clientY });
      }
      setNodeDrag(null);
      return;
    }
    // v1.7.0：梁拖拽结束——越过阈值 → 单字段提交（lens / bias，单条 undo）；否则视为点击取消
    if (beamDrag && setBeamDrag) {
      if (beamDrag.pointerId === e.pointerId) {
        const commit = beamDragCommit(beamDrag);
        if (commit) onBeamChange?.(beamDrag.handle.fromId, commit);
        setBeamDrag(null);
      }
      return;
    }
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    dragRef.current = null;
    if (d.moved) {
      // M5-T4：松手速度高于阈值 → 惯性滑行（指数衰减缓停）
      const { vx, vy } = estimatePanVelocity(d.samples);
      if (Math.hypot(vx, vy) >= PAN_INERTIA_TRIGGER) viewport.animateInertia(vx, vy);
      return;
    }
    // 点击：世界坐标命中检测（可见节点自后向前取顶）
    const w = worldPointOf(e, e.currentTarget, viewport);
    const ln = hitNodeAt(visibleNodes, w, undefined, hitIndex);
    if (ln) onNodeClick?.(ln, { shift: e.shiftKey, sx: e.clientX, sy: e.clientY });
    else onBlankClick?.();
  };

  const onPointerCancel = (e: ReactPointerEvent<HTMLElement>): void => {
    const wasPinching = pinch.current.active;
    pinch.current.up(e.pointerId);
    if (wasPinching && !pinch.current.active) onGestureActive?.(false); // B-P3：pinch 结束
    if (dragRef.current?.id === e.pointerId) dragRef.current = null;
    setNodeDrag((d) => (d?.pointerId === e.pointerId ? null : d));
    setBeamDrag?.((d) => (d?.pointerId === e.pointerId ? null : d));
  };

  return { pinch, dragRef, onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
