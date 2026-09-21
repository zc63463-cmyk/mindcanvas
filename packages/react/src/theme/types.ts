/**
 * 主题令牌类型（ADR-0003：主题 = 设计令牌集 TokenSet，不是三套组件）。
 * 渲染核心按令牌参数化 —— 组件逻辑不写死视觉值，一切颜色/圆角/阴影/连线样式走本令牌。
 */

/** 主题 id（ADR-0003 首期三套） */
export type ThemeId = 'classic' | 'sticker' | 'glass';

/** 分支色板项：每分支一色（stroke=连线/描边、fill=填充、text=文字） */
export interface BranchColor {
  readonly stroke: string;
  readonly fill: string;
  readonly text: string;
  /** 叶节点卡片变体（classic 按分支浅化；未设则回退 color.leafDefault） */
  readonly leaf?: BranchLeaf;
}

/** 叶节点卡片三色（classic 分支浅化 / sticker 橄榄贴 / glass 霓虹卡） */
export interface BranchLeaf {
  readonly fill: string;
  readonly stroke: string;
  readonly text: string;
}

/** 连线语言（ADR-0003 主题集定义表「连线语言」列） */
export type LineLanguage = 'color-curve' | 'wavy' | 'soft';

/** 节点形态（ADR-0003「节点形态」列） */
export type NodeShape = 'roundedRect' | 'sticker' | 'glass';

/**
 * 设计令牌集：三主题全部差异收敛于此。
 * 渲染器只读本接口 —— 主题切换 = 换令牌，组件保持同一实现。
 */
export interface TokenSet {
  id: ThemeId;
  color: {
    /** 画布底色 */
    canvas: string;
    /** 画布点缀光（玻璃背景光斑；classic/sticker 可省略） */
    canvasGlow?: string;
    /** 主文字 */
    text: string;
    /** 次级文字（叶节点等） */
    textMuted: string;
    /** 分支色板：渲染层按分支索引取色（classic 高饱和 / sticker 多彩 / glass 统一灰） */
    branches: readonly BranchColor[];
    /** 实体节点基准填充（具体描边色由内核 KIND_META 提供——实体语义色跨主题一致） */
    entityFill: string;
    /** 实体节点文字 */
    entityText: string;
    /** 霓虹强调（glass 叶节点/高亮；其余主题 null） */
    accent: string | null;
    /** 连线基础色（color-curve 语言下被分支色覆盖） */
    linkStroke: string;
    /** 叶节点默认卡（sticker 橄榄贴 / glass 霓虹卡；classic 走分支 leaf 变体） */
    leafDefault: BranchLeaf;
    /** 警示色（未解析实体等） */
    warn: string;
    /** 选中节点描边（编辑/导航高亮；跨主题一致语义，各主题取醒目色） */
    selection: string;
    /** 快速注释 accent（R15：三主题同 accent 不同质感——classic 实色 / sticker 纸感 / glass 半透明珊瑚） */
    annotationAccent: string;
    /** 注释计数徽章底 */
    annotationBadge: string;
  };
  radius: {
    /** 节点圆角 */
    node: number;
    /** 叶节点圆角 */
    leaf: number;
    /** 面板/翻卡圆角 */
    panel: number;
  };
  spacing: {
    padX: number;
    padY: number;
  };
  font: {
    family: string;
    size: number;
    sizeLeaf: number;
    weight: number;
    weightRoot: number;
  };
  motion: {
    duration: string;
    easing: string;
  };
  lineStyle: {
    language: LineLanguage;
    width: number;
    /** 曲线曲率（连线语言的几何差异：color-curve 0.4 / wavy 0.5 / soft 0.3） */
    curvature: number;
  };
  nodeStyle: {
    shape: NodeShape;
    strokeWidth: number;
    /** 叶节点描边宽（classic 1 / sticker 1 / glass 0.8——对照设计报告叶子卡） */
    strokeWidthLeaf: number;
    /** 节点阴影（'none' 表示无） */
    shadow: string;
  };
  shadow: {
    /** 面板/翻卡投影 */
    panel: string;
  };
}
