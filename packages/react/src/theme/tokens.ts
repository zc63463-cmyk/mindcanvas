/**
 * 三套主题令牌数据（ADR-0003 主题集定义表 + docs/preview/mindmap-design-styles-report.html
 * 三版本内联 SVG 视觉值，逐值对照映射——映射表见 docs/dispatch/K3-report.md）。
 */
import type { ThemeId, TokenSet } from './types.js';

const SANS = 'Segoe UI, Microsoft YaHei, PingFang SC, sans-serif';

/**
 * V1 经典曲线（XMind 谱系）：圆角矩形 + 彩色曲线贝塞尔 + 每分支一色（高饱和）。
 * SVG 取值：节点 rx=9/8、分支色 #d97706/#2f9e44/#0c8599（浅底深字）、连线宽 2.2。
 */
export const classicToken: TokenSet = {
  id: 'classic',
  color: {
    canvas: '#faf8f4',
    text: '#2b2926',
    textMuted: '#9a948a',
    branches: [
      {
        stroke: '#d97706',
        fill: '#fef2e4',
        text: '#633806',
        leaf: { fill: '#fff7ec', stroke: '#e8a34e', text: '#854f0b' },
      },
      {
        stroke: '#2f9e44',
        fill: '#eaf3de',
        text: '#27500a',
        leaf: { fill: '#f3f8e9', stroke: '#88a94e', text: '#3b6d11' },
      },
      {
        stroke: '#0c8599',
        fill: '#e1f5ee',
        text: '#085041',
        leaf: { fill: '#e8f6f1', stroke: '#4fa88f', text: '#0f6e56' },
      },
      {
        stroke: '#534ab7',
        fill: '#eeedfe',
        text: '#3c3489',
        leaf: { fill: '#efedfc', stroke: '#9189e0', text: '#3c3489' },
      },
      {
        stroke: '#e8590c',
        fill: '#fdeee5',
        text: '#712b13',
        leaf: { fill: '#fdf0ea', stroke: '#f2a284', text: '#712b13' },
      },
      {
        stroke: '#185fa5',
        fill: '#e6f1fb',
        text: '#0c447c',
        leaf: { fill: '#e9f1fb', stroke: '#7ba7d4', text: '#0c447c' },
      },
    ],
    entityFill: '#f5f3ee',
    entityText: '#444441',
    accent: null,
    linkStroke: '#8a847a',
    leafDefault: { fill: '#fff7ec', stroke: '#e8a34e', text: '#854f0b' },
    warn: '#e8590c',
    selection: '#534ab7',
    annotationAccent: '#e8590c',
    annotationBadge: '#fdeee5',
  },
  radius: { node: 9, leaf: 8, panel: 16 },
  spacing: { padX: 10, padY: 6 },
  font: { family: SANS, size: 11, sizeLeaf: 9, weight: 500, weightRoot: 600 },
  motion: { duration: '0.18s', easing: 'ease' },
  lineStyle: { language: 'color-curve', width: 2.2, curvature: 0.4 },
  nodeStyle: { shape: 'roundedRect', strokeWidth: 1.4, strokeWidthLeaf: 1, shadow: 'none' },
  shadow: { panel: '0 10px 30px rgba(43,41,38,.10)' },
};

/**
 * V7 画布贴纸（Miro/FigJam 谱系）：贴纸卡片（投影）+ 任意曲线 + 多彩贴纸色。
 * SVG 取值：卡 rx=10/9/7、fill #fdf3d8/#ffe9e3/#e4ecfd/#eaf3de、
 * drop-shadow(0 2px 3px rgba(43,41,38,.12))、灰连线 #c9c4b8 宽 1.2。
 */
export const stickerToken: TokenSet = {
  id: 'sticker',
  color: {
    canvas: '#fdfdfb',
    text: '#2b2926',
    textMuted: '#6b655c',
    branches: [
      { stroke: '#d9a441', fill: '#fdf3d8', text: '#633806' },
      { stroke: '#d85a30', fill: '#ffe9e3', text: '#712b13' },
      { stroke: '#185fa5', fill: '#e4ecfd', text: '#0c447c' },
      { stroke: '#639922', fill: '#eaf3de', text: '#3b6d11' },
      { stroke: '#9c6ad4', fill: '#f6e8fd', text: '#5c2d7f' },
      { stroke: '#0f6e56', fill: '#e8f6f1', text: '#085041' },
    ],
    entityFill: '#f5f3ee',
    entityText: '#444441',
    accent: null,
    linkStroke: '#c9c4b8',
    leafDefault: { fill: '#eaf3de', stroke: '#639922', text: '#3b6d11' },
    warn: '#d85a30',
    selection: '#185fa5',
    annotationAccent: '#f2a284',
    annotationBadge: '#fdf3d8',
  },
  radius: { node: 10, leaf: 7, panel: 18 },
  spacing: { padX: 12, padY: 7 },
  font: { family: SANS, size: 12, sizeLeaf: 10, weight: 500, weightRoot: 600 },
  motion: { duration: '0.22s', easing: 'ease' },
  lineStyle: { language: 'wavy', width: 1.2, curvature: 0.5 },
  nodeStyle: {
    shape: 'sticker',
    strokeWidth: 1.2,
    strokeWidthLeaf: 1,
    shadow: 'drop-shadow(0 2px 3px rgba(43,41,38,.12))',
  },
  shadow: { panel: '0 12px 32px rgba(43,41,38,.12)' },
};

/**
 * V8 玻璃现代（Linear/Arc 谱系，默认）：半透明圆角卡 + 柔和贝塞尔 + 深底霓虹。
 * SVG 取值：底 #16181d、卡 fill rgba(255,255,255,.05/.07) 边 rgba(255,255,255,.14/.18)、
 * 连线 #3a3f4d 宽 1.2、霓虹 #7ae9c4（叶 fill rgba(122,233,196,.08) 边 rgba(122,233,196,.35)）。
 */
export const glassToken: TokenSet = {
  id: 'glass',
  color: {
    canvas: '#16181d',
    canvasGlow: 'radial-gradient(1200px 600px at 70% -10%, rgba(122,233,196,.07), transparent 60%)',
    text: '#e8eaef',
    textMuted: '#d3d7e0',
    branches: [
      { stroke: 'rgba(255,255,255,.18)', fill: 'rgba(255,255,255,.05)', text: '#d3d7e0' },
      { stroke: 'rgba(255,255,255,.18)', fill: 'rgba(255,255,255,.05)', text: '#d3d7e0' },
      { stroke: 'rgba(255,255,255,.18)', fill: 'rgba(255,255,255,.05)', text: '#d3d7e0' },
      { stroke: 'rgba(255,255,255,.18)', fill: 'rgba(255,255,255,.05)', text: '#d3d7e0' },
      { stroke: 'rgba(255,255,255,.18)', fill: 'rgba(255,255,255,.05)', text: '#d3d7e0' },
      { stroke: 'rgba(255,255,255,.18)', fill: 'rgba(255,255,255,.05)', text: '#d3d7e0' },
    ],
    entityFill: 'rgba(255,255,255,.07)',
    entityText: '#e8eaef',
    accent: '#7ae9c4',
    // 连线色：原 #3a3f4d 对底色 #16181d 仅 2.3:1（低于 WCAG 非文本 3:1）→ 提亮至约 3.4:1
    linkStroke: '#646b7d',
    leafDefault: {
      fill: 'rgba(122,233,196,.08)',
      stroke: 'rgba(122,233,196,.35)',
      text: '#7ae9c4',
    },
    warn: '#f76b58',
    selection: '#7ae9c4',
    annotationAccent: 'rgba(247,107,88,.55)',
    annotationBadge: 'rgba(247,107,88,.16)',
  },
  radius: { node: 10, leaf: 8, panel: 14 },
  spacing: { padX: 10, padY: 6 },
  font: { family: SANS, size: 11, sizeLeaf: 9, weight: 400, weightRoot: 500 },
  motion: { duration: '0.2s', easing: 'cubic-bezier(.2,.7,.3,1)' },
  lineStyle: { language: 'soft', width: 1.2, curvature: 0.3 },
  nodeStyle: { shape: 'glass', strokeWidth: 1, strokeWidthLeaf: 0.8, shadow: 'none' },
  shadow: { panel: '0 20px 60px rgba(0,0,0,.5)' },
};

/** 全部主题索引（默认 = glass，ADR-0003 决策 4） */
export const THEMES: Record<ThemeId, TokenSet> = {
  classic: classicToken,
  sticker: stickerToken,
  glass: glassToken,
};

/** 默认主题 id */
export const DEFAULT_THEME: ThemeId = 'glass';

/**
 * 玻璃 chrome 令牌（ADR-0003 决策 3：应用外壳恒定玻璃工具感，不随画布主题漂移，V8 气质）。
 * 深色半透明 + 霓虹强调；面板/翻卡等交互组件统一消费本常量，组件内零视觉值。
 */
export const CHROME = {
  /** 外壳底色 */
  bg: '#101318',
  /** 面板/工具条半透明底 */
  panelBg: 'rgba(255,255,255,.06)',
  panelBgStrong: 'rgba(255,255,255,.09)',
  /** 面板描边（常态/悬停） */
  panelBorder: 'rgba(255,255,255,.14)',
  panelBorderStrong: 'rgba(255,255,255,.3)',
  text: '#e8eaef',
  textMuted: '#98a2b3',
  /** 霓虹强调 */
  neon: '#7ae9c4',
  neonSoft: 'rgba(122,233,196,.14)',
  /** 警示（未解析实体等联动用） */
  warn: '#f76b58',
  radius: 14,
  radiusSmall: 9,
  fontFamily: 'Segoe UI, Microsoft YaHei, PingFang SC, sans-serif',
  fontSize: 12,
  fontSizeSmall: 11,
  /** 面板投影（玻璃浮层） */
  shadow: '0 20px 60px rgba(0,0,0,.5)',
} as const;
