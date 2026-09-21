/**
 * 兄弟子树碰撞消解（separate）：四向分叉布局的重叠兜底。
 *
 * 背景（ADR-0009「已知取舍」）：D2′ 分支布局的邻侧防叠是**布局期一次推开、不迭代**，
 * 三向以上复杂分叉（或其子树内部再分叉）会残留节点重叠 —— 视觉上表现为盒子压盒子、
 * 连线从别的节点身上穿过去。
 *
 * 本模块做**布局无关**的纯几何消解，就地修改 LayoutNode 树的盒坐标：
 * 自底向上，对每个节点的子女做「子树刚性分离」—— 只要两棵子树里存在相交的节点盒，
 * 就把其中一棵**整棵平移**到分离为止。刚体平移保证子树内部相对布局（层距 / 梁线 /
 * 兄弟间距）逐像素不变，只有外层落点被推开；分离完成后由调用方重新生成连线，
 * 于是连线端点与长度自动跟着更新（不残留穿盒的旧 path）。
 *
 * 为什么自底向上就能保证全局无重叠（归纳）：
 *   若 n 的每棵子子树内部无重叠，且 n 的各子子树两两无重叠，
 *   则 n 子树内部无重叠。基础情形是叶子（单盒，恒真）—— 归纳即得整树无重叠。
 *
 * 终止性（两级）：
 *   ① 迭代阶段按「最小位移方向」把子树推离，每推一次严格消除该对的重叠；
 *      轮次上限 SEPARATE_MAX_ROUNDS 兜底防病态振荡；
 *   ② 迭代后仍有残留 → 退化执行「按 x 排序的刚性错位堆叠」，把各子树 x 区间彻底
 *      错开，必然零重叠。两级都失败的情况不存在，故算法一定收敛到零重叠。
 *
 * 零依赖、零 DOM：本模块不读节点 note（方向经 dirByNodeId 注入），可独立测试。
 */
import type { Box, GrowDir, LayoutNode } from './mindmap.js';

/** 分离后相邻盒之间保留的最小间隙（px）。与 V_GAP 对齐，让推开量看起来「是一档间距」。 */
export const SEPARATE_MARGIN = 14;

/** 单层迭代轮次上限（防病态输入死循环；超限走错位堆叠兜底）。 */
export const SEPARATE_MAX_ROUNDS = 24;

/**
 * 「子树不回压父出边 ↔ 盒重叠消解」交替的最大轮次。
 *
 * 外推子树会让父线变长（这是要的：连线距离跟着更新），但也可能压到兄弟；
 * 消解兄弟重叠时又可能把子树推回父的出边。两者相互牵制，故设上限；
 * 到达上限时最后执行的是**盒重叠消解**（零重叠优先）。
 */
export const PARENT_EDGE_ROUNDS = 3;

/**
 * 节点级相交检测的「节点对数」上限：超过此值不再逐节点求最小位移，
 * 改用子树包围盒估算（更保守但恒为 O(1)）。二者的**正确性等价**——都保证分离。
 */
const NODE_PAIR_LIMIT = 40_000;

export interface SeparateOptions {
  /** 分离间隙（px）。缺省 {@link SEPARATE_MARGIN} */
  margin?: number;
  /** 单层迭代轮次上限。缺省 {@link SEPARATE_MAX_ROUNDS} */
  maxRounds?: number;
  /** 节点 → 有效生长方向（决定「优先往哪边推」）；缺省 = 四向里挑位移最小的 */
  dirByNodeId?: ReadonlyMap<string, GrowDir>;
}

export interface SeparateStats {
  /** 实际执行的子树平移次数 */
  pushes: number;
  /** 触发错位堆叠兜底的层数（理想为 0） */
  hardStacks: number;
  /** 判定阶段参与比较的兄弟对数（性能观察用） */
  pairs: number;
}

/** 一对相交的节点盒（诊断 / 测试断言用） */
export interface OverlapPair {
  a: LayoutNode;
  b: LayoutNode;
  overlapX: number;
  overlapY: number;
}

/** x 轴重叠量（> 0 = 相交；仅贴边时为 0） */
export function overlapXOf(a: Box, b: Box): number {
  return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
}

/** y 轴重叠量（> 0 = 相交；仅贴边时为 0） */
export function overlapYOf(a: Box, b: Box): number {
  return Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
}

/** 两盒是否相交（边贴边不算） */
export function boxesIntersect(a: Box, b: Box): boolean {
  return overlapXOf(a, b) > 0 && overlapYOf(a, b) > 0;
}

export type Axis = 'x' | 'y';

/** 一次「推开」的方向：沿 axis、sign 方向位移 */
export interface Push {
  axis: Axis;
  sign: 1 | -1;
}

const ANY_PUSHES: readonly Push[] = [
  { axis: 'x', sign: 1 },
  { axis: 'x', sign: -1 },
  { axis: 'y', sign: 1 },
  { axis: 'y', sign: -1 },
];

/**
 * 方向的候选推开向量。首位是「外向」（子节点挂在父的这一侧，往这边推最自然），
 * 次位是反向兜底 —— 当外向推会把子树推得更深时（同侧兄弟错位），用反向更省。
 */
export function pushCandidates(dir: GrowDir | undefined): readonly Push[] {
  switch (dir) {
    case 'right':
      return [
        { axis: 'x', sign: 1 },
        { axis: 'x', sign: -1 },
      ];
    case 'left':
      return [
        { axis: 'x', sign: -1 },
        { axis: 'x', sign: 1 },
      ];
    case 'down':
      return [
        { axis: 'y', sign: 1 },
        { axis: 'y', sign: -1 },
      ];
    case 'up':
      return [
        { axis: 'y', sign: -1 },
        { axis: 'y', sign: 1 },
      ];
    default:
      return ANY_PUSHES;
  }
}

/** 刚体平移：节点盒 + 全部后代盒 */
function translate(ln: LayoutNode, dx: number, dy: number): void {
  ln.box.x += dx;
  ln.box.y += dy;
  for (const c of ln.children) translate(c, dx, dy);
}

/** 一次「推开」的判定结果 */
interface PushPlan {
  push: Push;
  dist: number;
}

/**
 * 全树碰撞消解（就地修改盒坐标）。
 *
 * 返回统计信息；调用方在返回后**必须重新生成 links**（path 内含绝对坐标）。
 */
export function separateTree(root: LayoutNode, opts: SeparateOptions = {}): SeparateStats {
  const margin = opts.margin ?? SEPARATE_MARGIN;
  const maxRounds = Math.max(0, opts.maxRounds ?? SEPARATE_MAX_ROUNDS);
  const dirOf = opts.dirByNodeId;
  const stats: SeparateStats = { pushes: 0, hardStacks: 0, pairs: 0 };

  /** 子树包围盒缓存（后序写入；刚体平移时同步平移） */
  const boxes = new Map<LayoutNode, Box>();
  /** 子树节点清单（懒构建：只有包围盒相交的兄弟对才需要逐节点比对） */
  const nodeLists = new Map<LayoutNode, LayoutNode[]>();

  const nodesOf = (ln: LayoutNode): LayoutNode[] => {
    const hit = nodeLists.get(ln);
    if (hit !== undefined) return hit;
    const out: LayoutNode[] = [];
    const stack: LayoutNode[] = [ln];
    while (stack.length > 0) {
      const n = stack.pop();
      if (n === undefined) continue;
      out.push(n);
      for (const c of n.children) stack.push(c);
    }
    nodeLists.set(ln, out);
    return out;
  };

  /** 读子树包围盒（后序已写入则 O(1)；未写入则现算，保证独立可用） */
  const boxOf = (ln: LayoutNode): Box => {
    const hit = boxes.get(ln);
    if (hit !== undefined) return hit;
    let x0 = ln.box.x;
    let y0 = ln.box.y;
    let x1 = ln.box.x + ln.box.w;
    let y1 = ln.box.y + ln.box.h;
    for (const c of ln.children) {
      const cb = boxOf(c);
      x0 = Math.min(x0, cb.x);
      y0 = Math.min(y0, cb.y);
      x1 = Math.max(x1, cb.x + cb.w);
      y1 = Math.max(y1, cb.y + cb.h);
    }
    const box: Box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    boxes.set(ln, box);
    return box;
  };

  /** 刚体平移 + 同步包围盒缓存（后代缓存随之失效但不再被读取） */
  const shift = (ln: LayoutNode, dx: number, dy: number): void => {
    translate(ln, dx, dy);
    const b = boxes.get(ln);
    if (b !== undefined) {
      b.x += dx;
      b.y += dy;
    }
  };

  /**
   * 把 move 子树沿 push 方向推开、使其与「固定障碍」不再相交所需的最小位移。
   * 固定障碍以（包围盒 + 节点集）给出：兄弟用整棵子树；父盒只用自身。
   * 返回 0 表示沿该方向无需移动。
   */
  const shiftFor = (
    fb: Box,
    fn: readonly LayoutNode[],
    move: LayoutNode,
    push: Push,
    gap: number,
  ): number => {
    const mb = boxOf(move);
    if (!boxesIntersect(fb, mb)) return 0;
    const mn = nodesOf(move);
    if (fn.length * mn.length > NODE_PAIR_LIMIT) {
      // 大子树：包围盒估算（保守，保证分离；不做最紧优化）
      return push.axis === 'x'
        ? push.sign > 0
          ? fb.x + fb.w + gap - mb.x
          : mb.x + mb.w + gap - fb.x
        : push.sign > 0
          ? fb.y + fb.h + gap - mb.y
          : mb.y + mb.h + gap - fb.y;
    }
    let need = 0;
    for (const a of fn) {
      for (const b of mn) {
        if (!boxesIntersect(a.box, b.box)) continue;
        const d =
          push.axis === 'x'
            ? push.sign > 0
              ? a.box.x + a.box.w + gap - b.box.x
              : b.box.x + b.box.w + gap - a.box.x
            : push.sign > 0
              ? a.box.y + a.box.h + gap - b.box.y
              : b.box.y + b.box.h + gap - a.box.y;
        if (d > need) need = d;
      }
    }
    return need;
  };

  /** 在候选方向里挑位移最小的一次推开；无相交返回 null */
  const bestPush = (
    fb: Box,
    fn: readonly LayoutNode[],
    move: LayoutNode,
    dir: GrowDir | undefined,
    gap: number,
  ): PushPlan | null => {
    let best: PushPlan | null = null;
    for (const p of pushCandidates(dir)) {
      const dist = shiftFor(fb, fn, move, p, gap);
      if (dist <= 0) continue;
      if (best === null || dist < best.dist) best = { push: p, dist };
    }
    return best;
  };

  const apply = (ln: LayoutNode, plan: PushPlan): void => {
    const dx = plan.push.axis === 'x' ? plan.push.sign * plan.dist : 0;
    const dy = plan.push.axis === 'y' ? plan.push.sign * plan.dist : 0;
    shift(ln, dx, dy);
    stats.pushes++;
  };

  /** 一轮消解：先保证子女不压住父盒，再把后置兄弟推离前置兄弟 */
  const resolveRound = (ln: LayoutNode): boolean => {
    const kids = ln.children;
    let moved = false;
    // ① 父盒是不可动障碍；gap = 0（只消重叠，不把子女推离父节点）
    const own = [ln];
    for (const k of kids) {
      const plan = bestPush(ln.box, own, k, dirOf?.get(k.node.id), 0);
      if (plan !== null) {
        apply(k, plan);
        moved = true;
      }
    }
    // ② 兄弟互换：谁动代价小谁动（同级子树刚性推开）
    for (let j = 1; j < kids.length; j++) {
      const bj = kids[j];
      if (bj === undefined) continue;
      for (let i = 0; i < j; i++) {
        const bi = kids[i];
        if (bi === undefined) continue;
        if (!boxesIntersect(boxOf(bi), boxOf(bj))) continue;
        stats.pairs++;
        const cj = bestPush(boxOf(bi), nodesOf(bi), bj, dirOf?.get(bj.node.id), margin);
        const ci = bestPush(boxOf(bj), nodesOf(bj), bi, dirOf?.get(bi.node.id), margin);
        if (cj === null && ci === null) continue; // 包围盒相交但无节点相交（L 形交错）
        if (cj !== null && (ci === null || cj.dist <= ci.dist)) apply(bj, cj);
        else if (ci !== null) apply(bi, ci);
        moved = true;
      }
    }
    return moved;
  };

  /** 残留判定：是否仍有真实节点相交（包围盒相交只是粗筛） */
  const hasResidual = (ln: LayoutNode): boolean => {
    const kids = ln.children;
    for (let j = 1; j < kids.length; j++) {
      const bj = kids[j];
      if (bj === undefined) continue;
      const bjn = nodesOf(bj);
      for (let i = 0; i < j; i++) {
        const bi = kids[i];
        if (bi === undefined) continue;
        if (!boxesIntersect(boxOf(bi), boxOf(bj))) continue;
        const bin = nodesOf(bi);
        if (bin.length * bjn.length > NODE_PAIR_LIMIT) return true; // 保守
        for (const a of bin) {
          for (const b of bjn) {
            if (boxesIntersect(a.box, b.box)) return true;
          }
        }
      }
    }
    return false;
  };

  /**
   * 兜底：按子树盒中心 x 升序做刚性错位堆叠 —— 各子树 x 区间彻底错开后必然零重叠。
   * 只在迭代阶段未能收敛（病态输入）时触发。
   */
  const hardStack = (ln: LayoutNode): void => {
    const sorted = [...ln.children].sort((a, b) => {
      const ab = boxOf(a);
      const bb = boxOf(b);
      return ab.x + ab.w / 2 - (bb.x + bb.w / 2);
    });
    let cursor: number | null = null;
    for (const k of sorted) {
      const b = boxOf(k);
      if (cursor === null) {
        cursor = b.x + b.w;
        continue;
      }
      const dx = cursor + margin - b.x;
      if (dx > 0) shift(k, dx, 0);
      const nb = boxOf(k);
      cursor = Math.max(cursor, nb.x + nb.w);
    }
  };

  /** 后序：子层先消解完成，本层再做兄弟分离，最后写回自身子树包围盒 */
  const visit = (ln: LayoutNode): void => {
    for (const c of ln.children) visit(c);
    if (ln.children.length > 0) {
      for (let r = 0; r < maxRounds; r++) {
        if (!resolveRound(ln)) break;
      }
      if (ln.children.length > 1 && hasResidual(ln)) {
        hardStack(ln);
        stats.hardStacks++;
      }
    }
    let x0 = ln.box.x;
    let y0 = ln.box.y;
    let x1 = ln.box.x + ln.box.w;
    let y1 = ln.box.y + ln.box.h;
    for (const c of ln.children) {
      const cb = boxOf(c);
      x0 = Math.min(x0, cb.x);
      y0 = Math.min(y0, cb.y);
      x1 = Math.max(x1, cb.x + cb.w);
      y1 = Math.max(y1, cb.y + cb.h);
    }
    boxes.set(ln, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  };

  visit(root);
  return stats;
}

/** 子树（含自身）包围盒 */
export function subtreeBoxOf(ln: LayoutNode): Box {
  let x0 = ln.box.x;
  let y0 = ln.box.y;
  let x1 = ln.box.x + ln.box.w;
  let y1 = ln.box.y + ln.box.h;
  for (const c of ln.children) {
    const b = subtreeBoxOf(c);
    if (b.x < x0) x0 = b.x;
    if (b.y < y0) y0 = b.y;
    if (b.x + b.w > x1) x1 = b.x + b.w;
    if (b.y + b.h > y1) y1 = b.y + b.h;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * 子树不得**回压到父的出边**：越界就整棵沿生长方向外推。
 *
 * 四向分叉最典型的「线穿盒」来源不是盒压盒，而是——某个子节点的子树朝**反方向**
 * 长了回去（右向子节点的孙节点声明 left、下向子节点的孙节点声明 up …），于是它
 * 自己就压在「父 → 自己」这条连线上。这类穿越**换任何连线画法都躲不开**，
 * 因为空间是被自己的子树占住的，只能把整棵子树往前挪、拉长父线（连线距离随之更新）。
 *
 * 统计口径：越界判定用 {@link corridorSubtreeBox}——只统计**真的落进「父 → 本节点」
 * 出边走廊**的盒。整棵子树包围盒过宽：左向分支若绕过祖先盒生长（落在走廊之外），
 * 计入包围盒会让整棵子树被无谓外推（实测：根 → 议题 的 left 组落在根盒左侧，
 * 议题整棵仍被外推 148px，未声明方向的兄弟跟着位移，B″ 局部性被破坏）；
 * 而真正压在走廊里的反向分支（孙节点落在「父右缘 ↔ 子左缘」之间）仍会被抓住。
 *
 * 自顶向下执行：推完某个子节点后，它内部的孙层约束要用新坐标再算一遍。
 *
 * @returns 外推次数
 */
export function clearParentEdges(
  root: LayoutNode,
  dirOf: ReadonlyMap<string, GrowDir>,
  margin = SEPARATE_MARGIN,
): number {
  let pushes = 0;
  /**
   * @param incoming 本节点相对**父节点**的生长方向。
   *   朝反方向长的子节点（右向节点的 left 子节点）不在此处约束——它本就该待在
   *   「父 ↔ 本节点」的走廊里，约束它只会把它推回走廊外沿、与外层约束互相打架；
   *   它需要的空间由**本节点自身**的外推让出来（见上一条 walk 的处理）。
   */
  const walk = (ln: LayoutNode, incoming: GrowDir | undefined): void => {
    for (const c of ln.children) {
      const dir = dirOf.get(c.node.id);
      if (dir !== undefined && !isOppositeDir(dir, incoming)) {
        const b = corridorSubtreeBox(ln.box, c, dir);
        if (b !== null) {
          let dx = 0;
          let dy = 0;
          if (dir === 'right') {
            const need = ln.box.x + ln.box.w + margin - b.x;
            if (need > 0) dx = need;
          } else if (dir === 'left') {
            const need = b.x + b.w - (ln.box.x - margin);
            if (need > 0) dx = -need;
          } else if (dir === 'down') {
            const need = ln.box.y + ln.box.h + margin - b.y;
            if (need > 0) dy = need;
          } else {
            const need = b.y + b.h - (ln.box.y - margin);
            if (need > 0) dy = -need;
          }
          if (dx !== 0 || dy !== 0) {
            translate(c, dx, dy);
            pushes++;
          }
        }
      }
      walk(c, dir);
    }
  };
  walk(root, undefined);
  return pushes;
}

/**
 * 「压住出边走廊」的子树包围盒：只统计与「父 → 子」走廊相交的后代盒。
 *
 * 走廊 = 父盒与子盒之间沿生长轴的那片空隙（横/纵跨度取两者的合并范围）。
 * 没有任何后代盒落进走廊 → 返回 null（本子节点无需外推）。
 *
 * 与整棵子树包围盒的区别见 {@link clearParentEdges} 的统计口径说明：
 * 它避免「绕过走廊的反向分支」把整棵子树误判为回压，
 * 同时不放过「真正落在走廊里」的反向分支。
 */
function corridorSubtreeBox(parent: Box, child: LayoutNode, dir: GrowDir): Box | null {
  const cb = child.box;
  let corridor: Box;
  if (dir === 'right' || dir === 'left') {
    const x0 = dir === 'right' ? parent.x + parent.w : cb.x + cb.w;
    const x1 = dir === 'right' ? cb.x : parent.x;
    const yTop = Math.min(parent.y, cb.y);
    const yBot = Math.max(parent.y + parent.h, cb.y + cb.h);
    corridor = { x: x0, y: yTop, w: x1 - x0, h: yBot - yTop };
  } else {
    const y0 = dir === 'down' ? parent.y + parent.h : cb.y + cb.h;
    const y1 = dir === 'down' ? cb.y : parent.y;
    const xL = Math.min(parent.x, cb.x);
    const xR = Math.max(parent.x + parent.w, cb.x + cb.w);
    corridor = { x: xL, y: y0, w: xR - xL, h: y1 - y0 };
  }
  if (corridor.w <= 0 || corridor.h <= 0) return null; // 无空隙（贴边/反向重叠）→ 无走廊可言
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const stack: LayoutNode[] = [...child.children];
  while (stack.length > 0) {
    const n = stack.pop();
    if (n === undefined) continue;
    if (boxesIntersect(n.box, corridor)) {
      x0 = Math.min(x0, n.box.x);
      y0 = Math.min(y0, n.box.y);
      x1 = Math.max(x1, n.box.x + n.box.w);
      y1 = Math.max(y1, n.box.y + n.box.h);
    }
    for (const k of n.children) stack.push(k);
  }
  if (x0 === Infinity) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** 是否朝父节点的反方向生长（right↔left、down↔up） */
function isOppositeDir(dir: GrowDir, incoming: GrowDir | undefined): boolean {
  if (incoming === undefined) return false;
  return (
    (incoming === 'right' && dir === 'left') ||
    (incoming === 'left' && dir === 'right') ||
    (incoming === 'down' && dir === 'up') ||
    (incoming === 'up' && dir === 'down')
  );
}

/**
 * 全树重叠扫描（诊断 / 测试用）：返回所有**非同一条祖先链**的相交节点盒对。
 *
 * 祖先链上的盒天然相邻（父子本就要靠近），不计入；同链上若真发生重叠，
 * 会在子层分离的「父盒障碍」环节被消解，故扫描只用于跨分支回归。
 *
 * 复杂度 O(n²)：定位为诊断工具（分叉压力测试规模在千级以内），不进入生产热路径。
 */
export function findOverlaps(root: LayoutNode, margin = 0): OverlapPair[] {
  const out: OverlapPair[] = [];
  const seen: LayoutNode[] = [];
  const path = new Set<LayoutNode>();
  const walk = (ln: LayoutNode): void => {
    for (const prev of seen) {
      if (path.has(prev)) continue; // 祖先：跳过
      const ox = overlapXOf(ln.box, prev.box);
      const oy = overlapYOf(ln.box, prev.box);
      if (ox + margin > 0 && oy + margin > 0) {
        out.push({ a: prev, b: ln, overlapX: ox, overlapY: oy });
      }
    }
    seen.push(ln);
    path.add(ln);
    for (const c of ln.children) walk(c);
    path.delete(ln);
  };
  walk(root);
  return out;
}
