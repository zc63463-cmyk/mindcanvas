/**
 * CanvasBackend（R4：T8 降级阶梯 L3 的渲染后端骨架）。
 * 实现 RenderBackend 契约：原语构造与 SvgBackend 同构（场景树后端无关），
 * render(scene) 返回 <CanvasSurface> React 元素——useEffect 用 2D ctx 执行 drawScene。
 *
 * 边界（诚实标注）：
 * - **已接入 MapView**：后端由 `resolveBackend(forceBackend, layout.nodes.length)` 选择——
 *   显式 `?backend=canvas`，或未强制 SVG 且**布局节点总数 > CANVAS_AUTO_NODES(50000)** 时自动降级
 *   （口径是布局节点总数，不是视口可见节点数）；含中心/自由边的文档由产品壳强制 SVG，不走本后端。
 *   命中检测不走 DOM：MapView 的 pointer 命中按坐标（`nodeHitTest`）读同一份布局盒。
 * - **路径几何（DF-R4 已修）**：`tracePath` 支持场景构造器实际产出的 `M`/`L`/`Q`/`C`/`Z`
 *   绝对指令，树线、组织图梁线与 hub 箭头三角都会落笔；未产出的相对指令与其它命令**不落笔**（有界解析）。
 * - 文本字体 family 取 ctx 默认（TextDraw 未携带 family）；drop-shadow 做简版解析
 * - 资产 image 绘制需异步加载——仍跳过（资产密集文档请走 SVG 后端）
 */
import { useEffect, useRef, type ReactElement } from 'react';
import type {
  ImageDraw,
  LinkDraw,
  NodeCardDraw,
  RenderBackend,
  ScenePrimitive,
  TextDraw,
} from './backend.js';

/** 2D 绘制上下文的最小面（测试可 fake） */
export interface Ctx2D {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  beginPath(): void;
  /**
   * 路径几何指令（DF-R4：连线/箭头**落笔**必需）。
   *
   * 与场景构造器实际产出的 SVG 指令一一对应：
   * `compactBezier`/`bezierPath` 的 `M … C …`、`orthogonalPath` 的 `M … L … Q …`、
   * `hubArrowTip` 的 `M … L … L … Z`。真 `CanvasRenderingContext2D` 天然满足本接口。
   */
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
  closePath(): void;
  roundRect(x: number, y: number, w: number, h: number, rx: number): void;
  fill(): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  font: string;
  textBaseline: string;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
}

/** 场景树 → 2D 绘制副作用（递归；ctx 记录调用即可测） */
export function drawScene(ctx: Ctx2D, scene: ScenePrimitive): void {
  switch (scene.type) {
    case 'group': {
      ctx.save();
      // SVG transform 语法（本仓库只产出 translate/scale 指令的组合）
      for (const m of scene.transform.matchAll(/(translate|scale)\(([^)]*)\)/g)) {
        const args = (m[2] ?? '')
          .trim()
          .split(/[\s,]+/)
          .map(Number);
        if (m[1] === 'translate') ctx.translate(args[0] ?? 0, args[1] ?? 0);
        else ctx.scale(args[0] ?? 1, args[1] ?? args[0] ?? 1);
      }
      if (scene.opacity !== undefined) ctx.globalAlpha = scene.opacity;
      for (const c of scene.children) drawScene(ctx, c);
      ctx.restore();
      return;
    }
    case 'rect': {
      ctx.save();
      applyShadow(ctx, scene.filter);
      ctx.fillStyle = scene.fill;
      ctx.strokeStyle = scene.stroke;
      ctx.lineWidth = scene.strokeWidth;
      ctx.beginPath();
      ctx.roundRect(scene.x, scene.y, scene.w, scene.h, scene.rx);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      return;
    }
    case 'path': {
      ctx.save();
      ctx.strokeStyle = scene.stroke;
      ctx.lineWidth = scene.strokeWidth;
      ctx.beginPath();
      tracePath(ctx, scene.d);
      if (scene.fill !== undefined) {
        ctx.fillStyle = scene.fill;
        ctx.fill();
      }
      ctx.stroke();
      if (scene.tipD !== undefined) {
        ctx.fillStyle = scene.stroke;
        ctx.beginPath();
        tracePath(ctx, scene.tipD);
        ctx.fill();
      }
      ctx.restore();
      return;
    }
    case 'text': {
      ctx.save();
      ctx.fillStyle = scene.fill;
      ctx.font = `${scene.fontWeight} ${scene.fontSize}px sans-serif`;
      ctx.textBaseline = scene.dominantBaseline === 'central' ? 'middle' : 'alphabetic';
      ctx.fillText(scene.value, scene.x, scene.y);
      ctx.restore();
      return;
    }
    case 'image':
      // 资产图片绘制需异步加载（Image onload）——骨架版跳过；接入主循环时配合缓存 + 重绘回调
      return;
  }
}

/** 简版 drop-shadow 解析：'drop-shadow(0 2px 3px rgba(...))' → shadow 属性 */
function applyShadow(ctx: Ctx2D, filter?: string): void {
  const m = /drop-shadow\(([^)]+)\)/.exec(filter ?? '');
  if (!m) return;
  const parts = (m[1] ?? '').trim().split(/\s+/);
  const num = (s: string | undefined): number => Number((s ?? '0').replace('px', ''));
  ctx.shadowOffsetX = num(parts[0]);
  ctx.shadowOffsetY = num(parts[1]);
  ctx.shadowBlur = num(parts[2]);
  ctx.shadowColor = parts[3] ?? 'rgba(0,0,0,0.2)';
}

/** 指令 → 参数个数（有界解析只认场景构造器实际产出的绝对指令；其余 = 0 参数且不落笔） */
function pathArity(cmd: string): number {
  if (cmd === 'M' || cmd === 'L') return 2;
  if (cmd === 'Q') return 4;
  if (cmd === 'C') return 6;
  return 0;
}

/**
 * SVG path 指令 → ctx 路径调用（DF-R4）。
 *
 * 修复背景：本函数此前只对 `M` 调 `beginPath()`、不产出任何几何指令，于是
 * `drawScene` 的 `case 'path'` 对**空路径** `stroke()` —— Canvas 后端
 * （显式 `?backend=canvas`，或未强制 SVG 时布局节点数 > 50000 的自动降级）**看不到树线/箭头**。
 *
 * 有界解析：只覆盖场景构造器实际输出的 `M` / `L` / `Q` / `C` / `Z`
 * （`compactBezier` / `bezierPath` 的 `M … C …`、`orthogonalPath` 的 `M … L … Q … L …`、
 * `hubArrowTip` 的 `M … L … L … Z`），分隔符同时接受空格与逗号。
 * **未知指令不落笔也不抛错**：宁可少画一段，也不能因一条异常指令打断整帧绘制。
 */
function tracePath(ctx: Ctx2D, d: string): void {
  const tokens = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
  if (tokens === null) return;
  let cmd = '';
  let args: number[] = [];
  const emit = (): void => {
    if (cmd === 'M') ctx.moveTo(args[0] ?? 0, args[1] ?? 0);
    else if (cmd === 'L') ctx.lineTo(args[0] ?? 0, args[1] ?? 0);
    else if (cmd === 'Q') ctx.quadraticCurveTo(args[0] ?? 0, args[1] ?? 0, args[2] ?? 0, args[3] ?? 0);
    else if (cmd === 'C') {
      ctx.bezierCurveTo(
        args[0] ?? 0,
        args[1] ?? 0,
        args[2] ?? 0,
        args[3] ?? 0,
        args[4] ?? 0,
        args[5] ?? 0,
      );
    } else if (cmd === 'Z') ctx.closePath();
    args = [];
  };
  for (const token of tokens) {
    if (token.length === 1 && token >= 'A' && token <= 'Z') {
      cmd = token;
      args = [];
      if (pathArity(cmd) === 0) emit(); // Z（以及未知指令）立即结算
      continue;
    }
    if (token.length === 1 && token >= 'a' && token <= 'z') {
      continue; // 相对指令：场景构造器不产出 → 有界解析不支持（少画一段好过画错）
    }
    args.push(Number(token));
    if (args.length === pathArity(cmd)) emit(); // 同指令连续参数组 = 隐式重复
  }
}

/**
 * Canvas 渲染面：挂载后把场景绘制到 2D 画布（scene/transform 变化重绘）。
 * transform 为视口变换（translate(x y) scale(k) 语义）：世界坐标场景 → 屏幕绘制。
 */
export function CanvasSurface(props: {
  scene: ScenePrimitive;
  width: number;
  height: number;
  transform?: { x: number; y: number; k: number };
}): ReactElement {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const t = props.transform;
    if (t) {
      // 等价于 SVG transform="translate(x y) scale(k)"（世界 → 屏幕）
      ctx.setTransform(t.k, 0, 0, t.k, t.x, t.y);
    } else {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    drawScene(ctx as unknown as Ctx2D, props.scene);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, [props.scene, props.width, props.height, props.transform]);
  return (
    <canvas
      ref={ref}
      width={props.width}
      height={props.height}
      style={{ position: 'absolute', inset: 0 }}
    />
  );
}

/**
 * Canvas 渲染后端：原语构造与 SvgBackend 同构；render() → CanvasSurface 元素。
 */
export class CanvasBackend implements RenderBackend {
  readonly kind = 'canvas' as const;

  constructor(
    /** 画布尺寸（render 时传给 CanvasSurface；MapView 接入时随视口更新） */
    private size: { width: number; height: number } = { width: 1280, height: 800 },
  ) {}

  nodeCard(d: NodeCardDraw): ScenePrimitive {
    return {
      type: 'rect',
      x: d.x,
      y: d.y,
      w: d.w,
      h: d.h,
      rx: d.rx,
      fill: d.fill,
      stroke: d.stroke,
      strokeWidth: d.strokeWidth,
      filter: d.filter && d.filter !== 'none' ? d.filter : undefined,
    };
  }

  text(d: TextDraw): ScenePrimitive {
    return {
      type: 'text',
      x: d.x,
      y: d.y,
      value: d.value,
      fontSize: d.fontSize,
      fontWeight: d.fontWeight,
      fill: d.fill,
    };
  }

  link(d: LinkDraw): ScenePrimitive {
    return { type: 'path', d: d.d, stroke: d.stroke, strokeWidth: d.strokeWidth, tipD: d.tipD };
  }

  image(d: ImageDraw): ScenePrimitive {
    return {
      type: 'image',
      href: d.href,
      x: d.x,
      y: d.y,
      w: d.w,
      h: d.h,
      opacity: d.opacity,
      preserveAspectRatio: 'xMidYMid meet',
    };
  }

  group(
    transform: string,
    children: ScenePrimitive[],
    opts?: { opacity?: number; pointerEvents?: boolean; dataId?: string },
  ): ScenePrimitive {
    return {
      type: 'group',
      transform,
      children,
      opacity: opts?.opacity,
      pointerEvents: opts?.pointerEvents,
      dataId: opts?.dataId,
    };
  }

  /** 场景 → CanvasSurface 元素（useEffect 内执行 drawScene） */
  render(scene: ScenePrimitive): unknown {
    return <CanvasSurface scene={scene} width={this.size.width} height={this.size.height} />;
  }
}
