/**
 * 渲染后端抽象（M5-T7）：绘制节点/连线/文本的原语集合。
 * 本期实现 SVG 适配器（SvgBackend，包装既有渲染逻辑的绘制决策）；
 * Canvas 后端为预留升级路径（为 T8 大规模基准发现的规模上限提供切换点，本期不实现）。
 * 场景由原语（group/rect/path/text/image）构成——后端无关；各适配器负责把场景落到平台。
 */
import type { ReactElement } from 'react';

/** 后端种类 */
export type BackendKind = 'svg' | 'canvas';

/** 场景原语（后端无关的绘制命令） */
export type ScenePrimitive =
  | {
      type: 'group';
      transform: string;
      children: ScenePrimitive[];
      /** 组透明度（SVG opacity） */
      opacity?: number;
      /** 不响应指针（overlay/ghost 层） */
      pointerEvents?: boolean;
      /** 测试/调试锚点（data-* 透出） */
      dataId?: string;
    }
  | {
      type: 'rect';
      x: number;
      y: number;
      w: number;
      h: number;
      rx: number;
      fill: string;
      stroke: string;
      strokeWidth: number;
      strokeDash?: string;
      /** 阴影滤镜（SVG filter 语法；'none' 省略） */
      filter?: string;
    }
  | {
      type: 'path';
      d: string;
      stroke: string;
      strokeWidth: number;
      fill?: string;
      /** v1.7.0：hub 出线箭头三角（实心 fill=stroke；缺省不画） */
      tipD?: string;
    }
  | {
      type: 'text';
      x: number;
      y: number;
      value: string;
      fontSize: number;
      fontWeight: number;
      fill: string;
      /** 垂直对齐（SVG dominantBaseline） */
      dominantBaseline?: string;
    }
  | {
      type: 'image';
      href: string;
      x: number;
      y: number;
      w: number;
      h: number;
      opacity: number;
      preserveAspectRatio: string;
    };

/** 节点卡绘制参数 */
export interface NodeCardDraw {
  x: number;
  y: number;
  w: number;
  h: number;
  rx: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  /** 阴影滤镜（'none' = 无） */
  filter?: string;
}

/** 文本行绘制参数 */
export interface TextDraw {
  x: number;
  y: number;
  value: string;
  fontSize: number;
  fontWeight: number;
  fill: string;
}

/** 连线绘制参数 */
export interface LinkDraw {
  d: string;
  stroke: string;
  strokeWidth: number;
  /** v1.7.0：hub 出线箭头三角（实心、fill=stroke；缺省不画） */
  tipD?: string;
}

/** 图片绘制参数（@img/@draw 资产预览） */
export interface ImageDraw {
  href: string;
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
}

/**
 * 渲染后端契约：绘制原语的集合 + 场景落平台入口。
 * SVG 适配器 render(scene) → React 元素；未来 Canvas 适配器 render(scene) → 画布绘制副作用。
 */
export interface RenderBackend {
  readonly kind: BackendKind;
  /** 节点卡（圆角矩形 + 描边；shadow 滤镜走令牌语法） */
  nodeCard(d: NodeCardDraw): ScenePrimitive;
  /** 文本行 */
  text(d: TextDraw): ScenePrimitive;
  /** 连线路径 */
  link(d: LinkDraw): ScenePrimitive;
  /** 图片 */
  image(d: ImageDraw): ScenePrimitive;
  /** 组合（平移/缩放/透明度/指针豁免） */
  group(
    transform: string,
    children: ScenePrimitive[],
    opts?: { opacity?: number; pointerEvents?: boolean; dataId?: string },
  ): ScenePrimitive;
  /** 场景 → 平台渲染结果（SVG: React 元素数组） */
  render(scene: ScenePrimitive): unknown;
}

/** SVG 后端：原语直接产出 SVG React 元素（包装既有 NodeG/LinkG 的绘制决策） */
export class SvgBackend implements RenderBackend {
  readonly kind: BackendKind = 'svg';

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
    return {
      type: 'path',
      d: d.d,
      stroke: d.stroke,
      strokeWidth: d.strokeWidth,
      tipD: d.tipD,
    };
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

  /** SVG 场景 → React 元素（递归） */
  render(scene: ScenePrimitive): unknown {
    return sceneToSvg(scene);
  }
}

/** 场景原语 → SVG React 元素（SvgBackend 内部；导出供测试断言） */
export function sceneToSvg(scene: ScenePrimitive): ReactElement {
  switch (scene.type) {
    case 'group':
      return (
        <g
          key={undefined}
          transform={scene.transform}
          data-node-id={scene.dataId}
          opacity={scene.opacity ?? 1}
          style={scene.pointerEvents === false ? { pointerEvents: 'none' } : undefined}
        >
          {scene.children.map((c, i) => (
            <g key={i} style={{ display: 'contents' }}>
              {sceneToSvg(c)}
            </g>
          ))}
        </g>
      );
    case 'rect':
      return (
        <rect
          x={scene.x}
          y={scene.y}
          width={scene.w}
          height={scene.h}
          rx={scene.rx}
          fill={scene.fill}
          stroke={scene.stroke}
          strokeWidth={scene.strokeWidth}
          strokeDasharray={scene.strokeDash}
          style={scene.filter ? { filter: scene.filter } : undefined}
        />
      );
    case 'path':
      return (
        <>
          <path
            d={scene.d}
            stroke={scene.stroke}
            strokeWidth={scene.strokeWidth}
            fill={scene.fill ?? 'none'}
          />
          {scene.tipD !== undefined && (
            <path d={scene.tipD} fill={scene.stroke} stroke="none" />
          )}
        </>
      );
    case 'text':
      return (
        <text
          x={scene.x}
          y={scene.y}
          fontSize={scene.fontSize}
          fontWeight={scene.fontWeight}
          fill={scene.fill}
          dominantBaseline={scene.dominantBaseline as 'central' | undefined}
        >
          {scene.value}
        </text>
      );
    case 'image':
      return (
        <image
          href={scene.href}
          x={scene.x}
          y={scene.y}
          width={scene.w}
          height={scene.h}
          opacity={scene.opacity}
          preserveAspectRatio={scene.preserveAspectRatio}
        />
      );
  }
}

/** 便捷工厂（应用层可复用同一后端实例） */
export function createSvgBackend(): RenderBackend {
  return new SvgBackend();
}
