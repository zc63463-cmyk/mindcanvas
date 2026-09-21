/**
 * CanvasBackend（R4：T8 降级阶梯 L3 的渲染后端骨架）。
 * 实现 RenderBackend 契约：原语构造与 SvgBackend 同构（场景树后端无关），
 * render(scene) 返回 <CanvasSurface> React 元素——useEffect 用 2D ctx 执行 drawScene。
 *
 * 边界（诚实标注）：
 * - 未接入 MapView 主渲染循环（接入含命中检测/动画/文本布局重构 = 独立专项）
 * - 文本字体 family 取 ctx 默认（TextDraw 未携带 family）；drop-shadow 做简版解析
 * - 资产 image 绘制需异步加载——骨架版跳过；>50K 自动切换在主循环接入后才生效
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

/** SVG path 指令（M/L/Q/C/Z）→ ctx 路径调用（骨架：M 开路径，坐标绘制留主循环接入时补全） */
function tracePath(ctx: Ctx2D, d: string): void {
  const tokens = d.match(/[MLQCZmlqcz][^MLQCZmlqcz]*/g) ?? [];
  for (const t of tokens) {
    const cmd = t[0];
    if (cmd === 'M' || cmd === 'm') ctx.beginPath();
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
