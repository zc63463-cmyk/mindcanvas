/**
 * 节点位置过渡计划器（M5-T2，纯函数、零 React 零 DOM）：
 * 布局前后各取一次坐标快照（toNodeFrame），按 id 配对插值（lerpNodeFrame）。
 * - 幸存节点：x/y 从旧坐标插值到新坐标（w/h 取目标——宽高突变属已知限制，见 M5-report）
 * - 新增节点：从目标位淡入（opacity 0→1 + scale 0.8→1）
 * - 删除节点：留在旧坐标淡出（ghost；opacity 1→0 + scale 1→0.8），动画结束后随帧移除
 * 帧间插值（NodeFrame → NodeFrame）天然支持动画打断：从当前插值位置继续。
 */
import type { LayoutNode } from '@mindcanvas/kernel';
import { NODE_FADE_IN_SCALE, NODE_FADE_OUT_SCALE } from './motion.js';

/** 单个节点的动画盒（渲染覆盖值；w/h 取目标侧保证内容排版稳定） */
export interface AnimatedBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0..1 透明度 */
  opacity: number;
  /** 缩放（新增/删除用；幸存节点恒 1） */
  scale: number;
}

/** 一帧节点过渡快照（from/to 通用；打断时 from = 当前插值帧） */
export interface NodeFrame {
  /** id → 动画盒（含淡出中的 ghost） */
  boxes: Map<string, AnimatedBox>;
  /** 目标布局节点（新增/幸存；ghost 提取与渲染源） */
  nodes: LayoutNode[];
  /** 淡出中的被删节点（旧 LayoutNode；渲染样式/深度用） */
  ghosts: LayoutNode[];
}

/** 布局节点数组 → 终态帧（全部原位、不透明、不缩放、无 ghost） */
export function toNodeFrame(nodes: readonly LayoutNode[]): NodeFrame {
  const boxes = new Map<string, AnimatedBox>();
  for (const n of nodes) {
    boxes.set(n.node.id, { x: n.box.x, y: n.box.y, w: n.box.w, h: n.box.h, opacity: 1, scale: 1 });
  }
  return { boxes, nodes: [...nodes], ghosts: [] };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * 帧间插值：目标帧为新状态，起点帧可为上一帧的任意中间态（打断即续）。
 * - 目标存在的 id：x/y 从起点插值；w/h/缩放/透明度按新增/幸存分支取
 * - 仅起点存在的 id：作为 ghost 淡出（保留旧坐标与尺寸）
 */
export function lerpNodeFrame(from: NodeFrame, to: NodeFrame, t: number): NodeFrame {
  const boxes = new Map<string, AnimatedBox>();
  for (const [id, tb] of to.boxes) {
    const fb = from.boxes.get(id);
    if (fb) {
      boxes.set(id, {
        x: lerp(fb.x, tb.x, t),
        y: lerp(fb.y, tb.y, t),
        w: tb.w,
        h: tb.h,
        opacity: 1,
        scale: 1,
      });
    } else {
      // 新增：淡入 + 从 0.8 放大到 1
      boxes.set(id, {
        ...tb,
        opacity: t,
        scale: NODE_FADE_IN_SCALE + (1 - NODE_FADE_IN_SCALE) * t,
      });
    }
  }
  // 删除（仅起点有）：旧坐标淡出——从当前透明度/缩放继续衰减（打断续接不跳回全显）
  for (const [id, fb] of from.boxes) {
    if (!to.boxes.has(id)) {
      boxes.set(id, {
        ...fb,
        opacity: fb.opacity * (1 - t),
        scale: fb.scale * (1 - (1 - NODE_FADE_OUT_SCALE) * t),
      });
    }
  }
  // ghost 列表：继承旧 ghost + 本帧新删除的（目标已重新出现的旧 ghost 剔除）
  const ghostSet = new Set<string>();
  const ghosts: LayoutNode[] = [];
  for (const g of from.ghosts) {
    if (!to.boxes.has(g.node.id)) {
      ghosts.push(g);
      ghostSet.add(g.node.id);
    }
  }
  for (const n of from.nodes) {
    if (!to.boxes.has(n.node.id) && !ghostSet.has(n.node.id)) {
      ghosts.push(n);
      ghostSet.add(n.node.id);
    }
  }
  // 终态帧（t=1）不携带 ghost——已完全透明，由调度器 onDone 清空
  return { boxes, nodes: to.nodes, ghosts: t >= 1 ? [] : ghosts };
}
