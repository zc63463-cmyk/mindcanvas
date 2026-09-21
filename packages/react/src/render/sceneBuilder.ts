/**
 * 场景构建器（C1：Canvas 主循环接入的第一块）。
 * 从「可见节点/连线 + 令牌」构建后端无关的 ScenePrimitive 树（世界坐标；
 * 视口变换由 CanvasSurface 的 setTransform 处理）。
 * 视觉决策取 NodeG 的简化等价：节点卡（分支色/叶样式）+ 单行文本 + 折叠计数 + 选中描边。
 * 交互态（hover/编辑浮层/拖拽 ghost）不在场景内——超大图降级场景可接受。
 */
import {
  buildLinkPath,
  horizontalBeamMap,
  hubArrowTip,
  nodeCardStyle,
  verticalBeamMap,
  type BeamAtOf,
  type CardLevel,
} from './geometry.js';
import type { BranchColor, TokenSet } from '../theme/types.js';
import type { ScenePrimitive } from './backend.js';
import type { Box, GrowDir } from '@mindcanvas/kernel';

/** 自动切 Canvas 的节点数阈值（T8 降级策略 L3：>50K） */
export const CANVAS_AUTO_NODES = 50000;

/**
 * A6/T23 Canvas 门禁：后端裁决。
 * - 显式 forceBackend='canvas' → Canvas（既有行为）
 * - 显式 forceBackend='svg' → **压过**自动降级：含跨岛父子连接/自由边的文档仅 SVG
 *   后端完整渲染（Canvas scene 只有树线+节点卡），宁可 SVG 慢也不静默丢岛/边
 * - 未指定 → >CANVAS_AUTO_NODES 自动降级（既有行为）
 */
export function resolveBackend(
  forceBackend: 'svg' | 'canvas' | undefined,
  nodeCount: number,
): 'svg' | 'canvas' {
  if (forceBackend === 'canvas') return 'canvas';
  if (forceBackend === 'svg') return 'svg';
  return nodeCount > CANVAS_AUTO_NODES ? 'canvas' : 'svg';
}

/** 场景构建输入（调用方从 MapView 渲染循环的既有量装配） */
export interface SceneInput {
  nodes: Array<{
    id: string;
    box: Box;
    depth: number;
    text: string | null;
    isEntity: boolean;
    entityKind: string | null;
    childCount: number;
    collapsed: boolean;
    selected: boolean;
  }>;
  /** 连线（端点盒由调用方解析后传入；fromId/dir 供垂直方向组共享梁分组——dir=声明方向） */
  links: Array<{ fromId: string; from: Box; to: Box; toId: string; dir?: GrowDir }>;
  /** v1.7.0：出线枢纽判定（nodeId → note.hub）。缺省不启用——hub 左右组退化为贝塞尔（降级场景可接受） */
  hubOf?: (id: string) => boolean;
  /** v1.11.0：梁比例位读取（nodeId + 方向 + 空隙 → note.beamAt；缺省 0.5 = 中点） */
  beamAtOf?: BeamAtOf;
  /** 节点 id → 分支色（MapView 的 branchIndex 已算好） */
  branchColorOf: (id: string) => BranchColor | undefined;
  token: TokenSet;
}

/** 单节点 → 场景组（卡 + 文本 + 折叠计数） */
function nodeScene(
  n: SceneInput['nodes'][number],
  token: TokenSet,
  colorOf: (id: string) => BranchColor | undefined,
): ScenePrimitive {
  const palette = colorOf(n.id);
  const level: CardLevel = n.depth >= 2 ? 'leaf' : 'branch';
  const style = nodeCardStyle(token, palette, level, n.isEntity ? (n.entityKind ?? null) : null);
  const selectedStroke = n.selected ? token.color.selection : style.stroke;
  const selectedWidth = n.selected ? style.strokeWidth + 1 : style.strokeWidth;
  const children: ScenePrimitive[] = [
    {
      type: 'rect',
      x: 0,
      y: 0,
      w: n.box.w,
      h: n.box.h,
      rx: style.radius,
      fill: style.fill,
      stroke: selectedStroke,
      strokeWidth: selectedWidth,
    },
  ];
  // 单行文本（骨架保真：省略多行换行；文本缺省占位）
  const fontSize = n.depth >= 2 ? token.font.sizeLeaf : token.font.size;
  children.push({
    type: 'text',
    x: token.spacing.padX + 2,
    y: n.box.h / 2,
    value: n.text ?? '（实体）',
    fontSize,
    fontWeight: n.depth === 0 ? token.font.weightRoot : token.font.weight,
    fill: style.text,
    dominantBaseline: 'central',
  });
  // 折叠计数（一眼可知隐藏子树规模）
  if (n.collapsed && n.childCount > 0) {
    children.push({
      type: 'text',
      x: n.box.w - 8,
      y: n.box.h / 2,
      value: `+${n.childCount}`,
      fontSize: token.font.sizeLeaf,
      fontWeight: 600,
      fill: token.color.textMuted,
      dominantBaseline: 'central',
    });
  }
  return { type: 'group', transform: `translate(${n.box.x} ${n.box.y})`, children, dataId: n.id };
}

/** 可见节点/连线 → 场景树（世界坐标） */
export function buildSceneFromLayout(input: SceneInput): ScenePrimitive {
  // G6′ 垂直连线共享梁：up/down 方向组共用一条水平梁（与内核 makeLinkByDir 公式一致）；
  // dir = 声明方向（声明 up/down 无视 x 重叠，一律并入垂直组）
  const beamYs = verticalBeamMap(input.links, (l) => l.dir, input.beamAtOf);
  const beamXs = horizontalBeamMap(
    input.links,
    (l) => input.hubOf?.(l.fromId) === true,
    (l) => l.dir,
    input.beamAtOf,
  );
  const linkPrims = input.links.map((l) => {
    const hub = input.hubOf?.(l.fromId) === true;
    const p = buildLinkPath(input.token, l.from, l.to, undefined, {
      beamY: beamYs.get(l),
      beamX: beamXs.get(l),
      hub,
      dir: l.dir,
    });
    const tip = hubArrowTip(l.from, l.to, l.dir, {
      hub,
      beamX: beamXs.get(l),
      beamY: beamYs.get(l),
    });
    return {
      type: 'path',
      d: p.d,
      stroke: p.stroke,
      strokeWidth: p.width,
      tipD: tip ?? undefined,
    } as ScenePrimitive;
  });
  const nodePrims = input.nodes.map((n) => nodeScene(n, input.token, input.branchColorOf));
  return { type: 'group', transform: '', children: [...linkPrims, ...nodePrims] };
}
