/**
 * 画布拖拽落点智能感知（FA2-T3）：光标落在节点的哪一块，决定素材的插入语义。
 *
 * 为什么需要：上期（FA1）把「图标 / 插图 / 子分支」做成了面板上的三选一按钮，
 * 但用户从系统文件管理器或图库直接往画布上拖时，还得先去面板切模式 —— 手感是断的。
 * 这里把判定做成**纯几何函数**：给一个世界坐标 + 节点盒，返回落点语义。
 * 纯函数 → 无需浏览器即可穷举边界（顶部边缘 / 底部边缘 / 右侧桩 / 文本核心 / 空白）。
 *
 * 区域划分（节点盒 b，尺寸均为世界坐标）：
 *
 *   ┌───────────────────────────────┐
 *   │  MEDIA（上边缘带）            │  ← 拖到这 → 嵌入卡片插图
 *   ├───────────────────────────────┤
 *   │                               │
 *   │      TEXT CORE（中心）        │  ← 拖到这 → 设为节点图标
 *   │                               │
 *   ├───────────────────────────────┤
 *   │  MEDIA（下边缘带）            │  ← 拖到这 → 嵌入卡片插图
 *   └───────────────────────────────┘
 *                                   ┆
 *                              BRANCH（右侧桩）  ← 拖到这 → 添加子分支
 */

/** 落点语义 */
export type DropAction = 'icon' | 'media' | 'child' | 'free';

/** 节点盒（世界坐标；VisibleNode['box'] 的形状） */
export interface DropBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DropTarget {
  action: DropAction;
  /** 命中的节点 id；'free'（空白）时为 null */
  nodeId: string | null;
}

/** 上下「嵌入插图」边缘带的**最大**高度（px，世界坐标） */
export const MEDIA_BAND = 18;
/** 右侧「长子分支」连接桩的**最大**宽度（px） */
export const BRANCH_STUB = 26;
/** 落点判定的外宽容差（略大于节点，手感不至于太苛刻） */
export const HIT_PAD = 6;
/**
 * 边缘带占盒高的**最大比例**。
 *
 * 为什么要有比例上限：最小节点只有 34px 高，若上下各固定留 18px 的插图带，
 * 两条带直接吃掉整个盒子 —— 文本核心宽度归零，「设为图标」永远命中不到。
 * 取 min(固定值, 比例×尺寸) 后，矮盒子自动收窄边缘带，中心区始终存在。
 */
const BAND_RATIO = 0.3;

/** 上下插图带的实际厚度（不超过盒高的 30%，保证中心区不被吃光） */
export function mediaBandOf(h: number): number {
  return Math.min(MEDIA_BAND, h * BAND_RATIO);
}

/** 右侧连接桩的实际宽度（不超过盒宽的 30%） */
export function branchStubOf(w: number): number {
  return Math.min(BRANCH_STUB, w * BAND_RATIO);
}

/**
 * 判定单个节点盒内的落点（调用方需先确认坐标已落在该盒内）。
 *
 * 顺序有讲究：**先上下带、后右侧桩**。
 * 若先判右侧桩，右上角那一小块会被「子分支」吃掉，而用户从上方拖下来时
 * 视觉上明明细长的一条是上边缘 —— 上下带优先符合直觉。
 */
export function senseInsideBox(b: DropBox, w: { x: number; y: number }): Exclude<DropAction, 'free'> {
  const band = mediaBandOf(b.h);
  const relY = w.y - b.y;
  if (relY <= band) return 'media';
  if (relY >= b.h - band) return 'media';
  const relX = w.x - b.x;
  if (relX >= b.w - branchStubOf(b.w)) return 'child';
  return 'icon';
}

/** 世界坐标是否命中节点盒（含外宽容差） */
export function insideBox(b: DropBox, w: { x: number; y: number }): boolean {
  return (
    w.x >= b.x - HIT_PAD &&
    w.x <= b.x + b.w + HIT_PAD &&
    w.y >= b.y - HIT_PAD &&
    w.y <= b.y + b.h + HIT_PAD
  );
}

/**
 * 在一组可见节点中判定落点（自后向前，后绘制的在上）。
 *
 * @param boxes 节点盒列表（{ id, box }；id 用于回传）
 * @param w 世界坐标
 * @returns 命中节点 → icon/media/child；都没命中 → free（新建自由节点）
 */
export function senseDropTarget(
  boxes: ReadonlyArray<{ id: string; box: DropBox }>,
  w: { x: number; y: number },
): DropTarget {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const t = boxes[i];
    if (!t) continue;
    if (!insideBox(t.box, w)) continue;
    return { action: senseInsideBox(t.box, w), nodeId: t.id };
  }
  return { action: 'free', nodeId: null };
}

/** 落点 → 中文提示（拖放浮层上的文案） */
export function dropHint(action: DropAction): string {
  switch (action) {
    case 'icon':
      return '设为节点图标';
    case 'media':
      return '嵌入卡片插图';
    case 'child':
      return '添加子分支';
    case 'free':
      return '新建自由节点';
  }
}

/** 落点 → 视觉标识（浮层图标） */
export function dropGlyph(action: DropAction): string {
  switch (action) {
    case 'icon':
      return '◆';
    case 'media':
      return '🖼';
    case 'child':
      return '⑃';
    case 'free':
      return '＋';
  }
}
