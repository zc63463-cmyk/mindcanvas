/**
 * 方向键**几何导航**（A 档）：按视觉方向（↑↓←→）取最近的可见节点。
 *
 * 为什么不用树序（`EditorController.navigate` 的可见前序）：
 * - ↓ 会先钻入当前节点的子树，要走完整棵子树才轮到下一个兄弟（用户实测："得遍历到
 *   子树的叶节点才有作用"）；且 **↓ 与 → 实现逐字相同**（都是 `ids[i+1]`），意义不明。
 * - 画布是**二维**的，而且这里是左右双翼布局：一侧的父在右、另一侧在左 —— 任何
 *   「左=父 / 右=子」的**语义**映射必有一侧反向；只有**几何**映射不会。
 * `EditorController.navigate` 保留（公开 API，供大纲式线性场景），键盘导航改走本模块。
 *
 * 输入直接用布局产物 `layout.nodes`（`{ node: { id }, box }` 结构）——**零额外分配**，
 * 且布局已按折叠裁剪子树 → 「折叠节点的子节点不可达」天然成立，无需另建可见集。
 *
 * 选点规则（两级，确定性）：
 *   ① **对齐带优先**：候选与源在垂直方向上的投影有重叠（= 真·正上/下/左/右）
 *      → 优先于需要斜跳的候选（哪怕后者直线距离更近）；
 *   ② 同级内：主方向距离近者 → 横向偏差小者 → 输入顺序靠前者（等距镜像候选可预期）。
 * 锥形过滤：横向偏差 ≤ 主方向距离 × {@link NAV_CONE_RATIO}（挡掉 ~58° 以上的"擦边"邻居）。
 *
 * 复杂度：单次 O(N)（N = 可见节点数）。每次按键一次线性扫描、无分配；
 * 大图（>5 万节点）若需要可改接 B-P1 的网格索引做半空间粗筛，当前不需要（先简单）。
 */

/** 方向（与 `matchEditorKey` 的 navigate 动作同域） */
export type NavDir = 'up' | 'down' | 'left' | 'right';

/**
 * 导航所需的最小节点契约 —— 结构化匹配布局产物 `LayoutNode`（`{ box, node: { id } }`）。
 * 刻意不 import kernel 类型：避免耦合，也避免为了适配而产生 O(N) 对象拷贝。
 */
export interface NavShapedNode {
  readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly node: { readonly id: string };
}

/**
 * 锥形半角的正切上限：`lateral ≤ along × ratio` 才当候选。
 * 1.6 ≈ 58°（tan58°）。取值权衡：过小 → 侧向邻居按不动；过大 → 会跳到很斜的树上。
 */
export const NAV_CONE_RATIO = 1.6;

/** 主方向最小位移（世界 px）：同排/几乎同位（浮点抖动）的邻居不算"在该方向上" */
const MIN_PRIMARY = 1;

/**
 * 几何导航的**最小推入**内边距（屏幕 px）：目标盒进入视口时与边缘保持的间隙。
 * 取值权衡：太小 → 节点贴着边（折叠指示/浮标被裁）；太大 → 小幅移动也触发推挤。
 */
export const NAV_REVEAL_PAD = 24;

interface Candidate {
  id: string;
  /** 0 = 与源在垂直投影上重叠（正上/下/左/右）；1 = 需斜跳 */
  band: 0 | 1;
  /** 主方向距离（正向，已取绝对值语义） */
  primary: number;
  /** 横向偏差 */
  lateral: number;
  /** 输入顺序（等距确定性） */
  at: number;
}

/** 候选 a 是否优于 b（字典序：band → primary → lateral → 输入顺序） */
function better(a: Candidate, b: Candidate | null): boolean {
  if (b === null) return true;
  if (a.band !== b.band) return a.band < b.band;
  if (a.primary !== b.primary) return a.primary < b.primary;
  if (a.lateral !== b.lateral) return a.lateral < b.lateral;
  return a.at < b.at;
}

/**
 * 从 `fromId` 出发，按方向取最近可见节点；无候选 → null。
 * 源不存在于 `nodes`（如选中了一个已被折叠隐藏的节点）→ null（不动作）。
 */
export function nextNodeInDirection(
  nodes: readonly NavShapedNode[],
  fromId: string,
  dir: NavDir,
): string | null {
  const from = nodes.find((n) => n.node.id === fromId);
  if (from === undefined) return null;
  const ax = from.box.x + from.box.w / 2;
  const ay = from.box.y + from.box.h / 2;
  const vertical = dir === 'up' || dir === 'down';

  let best: Candidate | null = null;
  for (const [i, cand] of nodes.entries()) {
    if (cand.node.id === fromId) continue;
    const dx = cand.box.x + cand.box.w / 2 - ax;
    const dy = cand.box.y + cand.box.h / 2 - ay;
    // along：带符号的主方向位移（必须 > 0）；lateral：横向偏差（取绝对值）
    const along = vertical ? (dir === 'down' ? dy : -dy) : dir === 'right' ? dx : -dx;
    const lateral = Math.abs(vertical ? dx : dy);
    if (along < MIN_PRIMARY) continue; // 不在目标方向的半空间
    if (lateral > along * NAV_CONE_RATIO) continue; // 锥外（过斜，不硬跳）
    // 对齐带：垂直方向上的投影是否重叠（|Δcenter| < 半跨之和 ⇔ 盒范围相交）
    const halfSpan = vertical ? (from.box.w + cand.box.w) / 2 : (from.box.h + cand.box.h) / 2;
    const next: Candidate = {
      id: cand.node.id,
      band: lateral <= halfSpan ? 0 : 1,
      primary: along,
      lateral,
      at: i,
    };
    if (better(next, best)) best = next;
  }
  return best?.id ?? null;
}

/**
 * 视口**最小推入**的目标变换（纯计算，不改任何状态）——导航后的「跟随」。
 *
 * 语义：目标盒只在实际越界时平移，且只挪「刚好可见」的量（不居中、不改 k）——
 * 避免每次按方向键都晃动画面；已完全可见 → null（调用方零动作）。
 * 世界盒 → 屏幕：`screen = world × k + t`（`ViewportController.toWorld` 的逆）。
 *
 * @param view 视口快照（结构化：`ViewportController` 直接满足）
 * @param box  目标世界盒
 * @param pad  与视口边缘保留的间隙（屏幕 px）
 * @returns 需要平移时的目标 transform；已可见 / 视口未测量 / 变换非有限 → null
 */
export function revealTargetInViewport(
  view: { transform: { k: number; x: number; y: number }; viewW: number; viewH: number },
  box: { x: number; y: number; w: number; h: number },
  pad = NAV_REVEAL_PAD,
): { k: number; x: number; y: number } | null {
  if (!(view.viewW > pad * 2) || !(view.viewH > pad * 2)) return null;
  const { k, x, y } = view.transform;
  if (!Number.isFinite(k) || !Number.isFinite(x) || !Number.isFinite(y) || k <= 0) return null;
  const sx = box.x * k + x;
  const sy = box.y * k + y;
  const sw = box.w * k;
  const sh = box.h * k;
  let dx = 0;
  let dy = 0;
  if (sx < pad) dx = pad - sx;
  else if (sx + sw > view.viewW - pad) dx = view.viewW - pad - (sx + sw);
  if (sy < pad) dy = pad - sy;
  else if (sy + sh > view.viewH - pad) dy = view.viewH - pad - (sy + sh);
  if (dx === 0 && dy === 0) return null;
  return { k, x: x + dx, y: y + dy };
}
