/**
 * FO-FIX1 · 挂出子树（空间挂载层）连线并入岛产出 + 相对壳右缘净空 —— P0 回归。
 *
 * 用户实测：框右侧挂出支贴边/重叠；再外侧子孙**漂浮且无连线**。
 *
 * 根因 A（丢线）：`expandOne` 里 `layoutForest` 产出的 `spatial.links` 从未并入
 * `ctx.links`，只推了「挂点行 → 空间根」这一条边 ⇒ 挂出子树内部边全部丢失；
 * `MapView` 树边渲染只走 `layout.links`（`filterVisibleLinks`），不会从 `children` 补线。
 *
 * 根因 B（贴边）：挂点相对**大纲行右缘**量取（`FRAME_HANG_GAP`），壳右缘 = 行右缘 +
 * `FRAME_SHELL_PAD` ⇒ 理论净空 = 48 − 12 = 36px。本文件把净空钉死为常量断言，
 * 防后续改壳/挂点公式时悄悄压回来。
 *
 * 结构（与任务书一致）：doc → f(frame, depth=1) → c(挂点行) → g(空间根) → [ga → gg, gb]
 */
import { describe, expect, it } from 'vitest';
import { setFrame } from '../src/protocol/frame.js';
import {
  FRAME_HANG_GAP,
  FRAME_HANG_SIBLING_GAP,
  FRAME_SHELL_PAD,
  expandFrameIslands,
  framePrunedCollapsed,
  collectFrameRoots,
} from '../src/layout/frameLayout.js';
import { partitionFrameSubtree } from '../src/layout/framePartition.js';
import { boxesIntersect } from '../src/layout/separate.js';
import {
  layoutMindmap,
  type Box,
  type LayoutResult,
} from '../src/layout/mindmap.js';
import { makeTextNode, type EditableNode } from '../src/tree/treeOps.js';

/** 挂出空间根相对**壳右缘**的最小净空（px）：低于它就会「看起来压边」 */
const MIN_CLEAR = 24;

/** 确定性度量：宽 = 文本长 × 10、高 = 24 */
function measure(node: EditableNode): { w: number; h: number } {
  return { w: (node.text ?? 'x').length * 10, h: 24 };
}

/** 给节点打框（不可变）；dir 缺省 right */
function framed(node: EditableNode, depth: number, dir?: 'right' | 'left'): EditableNode {
  const note = setFrame(node.note, depth);
  return { ...node, note: dir === undefined ? note : { ...note, dir } };
}

/**
 * doc → f(frame, depth=1) → c → g → [ga → gg, gb]。
 * f 的大纲层 = {f, c}（c 为挂点行），空间层 = g 整棵（g/ga/gg/gb）。
 */
function fixture(dir?: 'right' | 'left') {
  const gg = makeTextNode('gg');
  const ga = makeTextNode('ga', [gg]);
  const gb = makeTextNode('gb');
  const g = makeTextNode('g', [ga, gb]);
  const c = makeTextNode('c', [g]);
  const f = framed(makeTextNode('f', [c]), 1, dir);
  const doc = makeTextNode('doc', [f]);
  const prune = framePrunedCollapsed(new Set(), collectFrameRoots(doc));
  const base = layoutMindmap(doc, measure, prune);
  const out = expandFrameIslands(base, doc, measure, new Set());
  return { doc, f, c, g, ga, gb, gg, out };
}

/** 夹具取下标（避免测试里散落非空断言） */
function at<T>(list: readonly T[], i: number): T {
  const v = list[i];
  if (v === undefined) throw new Error(`夹具错误：下标 ${i} 越界`);
  return v;
}

/** 布局结果里某节点的盒 */
function boxOf(res: LayoutResult, id: string): Box {
  const n = res.nodes.find((x) => x.node.id === id);
  if (!n) throw new Error(`夹具错误：布局结果缺节点 ${id}`);
  return n.box;
}

/** 有向边清单（断言可读化：比较 {fromId,toId} 集合而非 path 串） */
function edgesOf(res: LayoutResult): string[] {
  return res.links.map((l) => `${l.fromId}→${l.toId}`);
}

/** 框壳 AABB：大纲行包围盒 + FRAME_SHELL_PAD（与 FrameOutline / C2 壳度量同源） */
function shellBoxOf(res: LayoutResult, frameRoot: EditableNode): Box {
  const spec = frameOfDepth(frameRoot);
  const ids = new Set(partitionFrameSubtree(frameRoot, spec).outlineIds);
  const rows = res.nodes.filter((n) => ids.has(n.node.id));
  if (rows.length === 0) throw new Error('夹具错误：框内无行盒');
  const x0 = Math.min(...rows.map((r) => r.box.x));
  const y0 = Math.min(...rows.map((r) => r.box.y));
  const x1 = Math.max(...rows.map((r) => r.box.x + r.box.w));
  const y1 = Math.max(...rows.map((r) => r.box.y + r.box.h));
  return {
    x: x0 - FRAME_SHELL_PAD,
    y: y0 - FRAME_SHELL_PAD,
    w: x1 - x0 + FRAME_SHELL_PAD * 2,
    h: y1 - y0 + FRAME_SHELL_PAD * 2,
  };
}

function frameOfDepth(node: EditableNode): number {
  const raw = node.note?.frame;
  const d = typeof raw === 'object' && raw !== null ? Reflect.get(raw, 'depth') : undefined;
  return typeof d === 'number' ? d : 1;
}

describe('FO-FIX1：挂出子树内部连线并入 layout.links（根因 A）', () => {
  it('★ 挂点边 + 挂出子树内部边（含孙层）全部出现在布局连线里', () => {
    const { c, g, ga, gb, gg, out } = fixture();
    const edges = edgesOf(out);
    // 挂点边（B1 已有断言，防回归）
    expect(edges).toContain(`${c.id}→${g.id}`);
    // ★ 今日必红：空间根 → 其孩子
    expect(edges).toContain(`${g.id}→${ga.id}`);
    expect(edges).toContain(`${g.id}→${gb.id}`);
    // ★ 再深一层（截图里的「漂浮子孙」）
    expect(edges).toContain(`${ga.id}→${gg.id}`);
  });

  it('连线数与树边数一致：岛内每条真实父子边都有且仅有一条线（无双线）', () => {
    const { c, g, ga, gb, gg, out } = fixture();
    const edges = edgesOf(out);
    for (const [from, to] of [
      [c.id, g.id],
      [g.id, ga.id],
      [g.id, gb.id],
      [ga.id, gg.id],
    ] as const) {
      expect(edges.filter((e) => e === `${from}→${to}`).length).toBe(1);
    }
  });

  it('嵌套框：嵌套岛自己的挂点边在，空间层里被替换子树的陈旧树边已丢弃（不双线）', () => {
    // 外层 f(depth=1) → c → g；g 自身成框（depth=1）→ gh（g 的挂点行）→ ghh（挂出）
    const ghh = makeTextNode('ghh');
    const gh = makeTextNode('gh', [ghh]);
    const g = framed(makeTextNode('g', [gh]), 1);
    const c = makeTextNode('c', [g]);
    const f = framed(makeTextNode('f', [c]), 1);
    const doc = makeTextNode('doc', [f]);
    const prune = framePrunedCollapsed(new Set(), collectFrameRoots(doc));
    const out = expandFrameIslands(layoutMindmap(doc, measure, prune), doc, measure, new Set());
    const edges = edgesOf(out);
    expect(edges).toContain(`${c.id}→${g.id}`); // 外层挂点边
    expect(edges).toContain(`${gh.id}→${ghh.id}`); // 嵌套岛的挂点边（挂点行 = gh）
    // 空间层里按普通父子排出的陈旧边作废：框内行**没有**树边（g→gh 不再存在）
    expect(edges).not.toContain(`${g.id}→${gh.id}`);
    // 同一对 id（gh→ghh）在新旧坐标里各有一条的「双线」必须只留岛产出那一条
    expect(edges.filter((e) => e === `${gh.id}→${ghh.id}`).length).toBe(1);
  });
});

describe('FO-FIX3：同一挂点行下多个空间同级沿跨轴错开（不再叠坐标）', () => {
  /** frame(depth=1) → c(挂点行) → [s1, s2, s3]：三个同级空间根挂在同一行 */
  function siblings(dir?: 'right' | 'left') {
    const s1 = makeTextNode('s1');
    const s2 = makeTextNode('s2 稍长');
    const s3 = makeTextNode('s3');
    const c = makeTextNode('c', [s1, s2, s3]);
    const f = framed(makeTextNode('f', [c]), 1, dir);
    const doc = makeTextNode('doc', [f]);
    const prune = framePrunedCollapsed(new Set(), collectFrameRoots(doc));
    const out = expandFrameIslands(layoutMindmap(doc, measure, prune), doc, measure, new Set());
    return { doc, f, c, s1, s2, s3, out };
  }

  it('★ 三个同级空间根本体盒两两不相交（修前三点同坐标 → 叠画发厚）', () => {
    const { s1, s2, s3, out } = siblings();
    const boxes = [boxOf(out, s1.id), boxOf(out, s2.id), boxOf(out, s3.id)];
    const pairs: Array<[number, number]> = [
      [0, 1],
      [0, 2],
      [1, 2],
    ];
    for (const [i, j] of pairs) {
      const a = boxes[i];
      const b = boxes[j];
      if (a === undefined || b === undefined) throw new Error('夹具错误：缺空间根盒');
      expect(boxesIntersect(a, b)).toBe(false);
    }
  });

  it('错开沿跨轴（right → Y）且保持 hangRoots 顺序；主侧净空不回归', () => {
    const { f, s1, s2, s3, out } = siblings();
    const shell = shellBoxOf(out, f);
    const boxes = [boxOf(out, s1.id), boxOf(out, s2.id), boxOf(out, s3.id)];
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(shell.x + shell.w + MIN_CLEAR); // FIX1 净空
    }
    // 组内按 children 顺序自上而下（错开方向 = 跨轴 Y）
    expect(at(boxes, 0).y).toBeLessThan(at(boxes, 1).y);
    expect(at(boxes, 1).y).toBeLessThan(at(boxes, 2).y);
  });

  it('left 方向沿 Y 错开且净空按壳左缘（跨轴不随方向退化）', () => {
    const { f, s1, s2, s3, out } = siblings('left');
    const shell = shellBoxOf(out, f);
    const boxes = [boxOf(out, s1.id), boxOf(out, s2.id), boxOf(out, s3.id)];
    for (const b of boxes) {
      expect(b.x + b.w).toBeLessThanOrEqual(shell.x - MIN_CLEAR);
    }
    expect(at(boxes, 0).y).toBeLessThan(at(boxes, 1).y);
    expect(at(boxes, 1).y).toBeLessThan(at(boxes, 2).y);
  });

  it('挂出子树带子孙时也不重叠（插槽 = 子树展开度，不只看根本体高）', () => {
    const a1 = makeTextNode('a1');
    const a2 = makeTextNode('a2');
    const s1 = makeTextNode('s1', [a1, a2]); // s1 纵向带两个孙 → 组更高
    const s2 = makeTextNode('s2');
    const c = makeTextNode('c', [s1, s2]);
    const f = framed(makeTextNode('f', [c]), 1);
    const doc = makeTextNode('doc', [f]);
    const prune = framePrunedCollapsed(new Set(), collectFrameRoots(doc));
    const out = expandFrameIslands(layoutMindmap(doc, measure, prune), doc, measure, new Set());
    const s1Box = boxOf(out, s1.id);
    const s2Box = boxOf(out, s2.id);
    expect(boxesIntersect(s1Box, s2Box)).toBe(false);
    // 孙节点也不得咬进兄弟子树（这才是「插槽按展开度算」的证据）
    for (const id of [a1.id, a2.id]) {
      expect(boxesIntersect(boxOf(out, id), s2Box)).toBe(false);
    }
  });

  it('每个空间根仍有自己的挂点边（扇出多条，不因错开丢边）', () => {
    const { c, s1, s2, s3, out } = siblings();
    const edges = edgesOf(out);
    expect(edges).toContain(`${c.id}→${s1.id}`);
    expect(edges).toContain(`${c.id}→${s2.id}`);
    expect(edges).toContain(`${c.id}→${s3.id}`);
  });

  it('单个空间根（n=1）几何不变：中心 = 挂点行中线（既有口径零回归）', () => {
    const s1 = makeTextNode('s1');
    const c = makeTextNode('c', [s1]);
    const f = framed(makeTextNode('f', [c]), 1);
    const doc = makeTextNode('doc', [f]);
    const prune = framePrunedCollapsed(new Set(), collectFrameRoots(doc));
    const out = expandFrameIslands(layoutMindmap(doc, measure, prune), doc, measure, new Set());
    const row = boxOf(out, c.id);
    const box = boxOf(out, s1.id);
    expect(box.y + box.h / 2).toBeCloseTo(row.y + row.h / 2, 6);
  });
});

describe('FO-FIX4：不同挂点行的挂出子树之间跨岛推挤（AABB 不相交）', () => {
  /**
   * f(frame, depth=1) → [hangA → pA → [a1, a2], hangB → pB → [b1, b2]]：
   * 两个**相邻**挂点行各挂一个空间父亲（各自带 2 个孩子）——
   * 行距（≈22 + FRAME_ROW_GAP）远小于子树展开度，修前两岛必然纵向压叠。
   */
  function twoIslands(dir?: 'right' | 'left') {
    const a1 = makeTextNode('a1');
    const a2 = makeTextNode('a2');
    const pA = makeTextNode('pA', [a1, a2]);
    const b1 = makeTextNode('b1');
    const b2 = makeTextNode('b2');
    const pB = makeTextNode('pB', [b1, b2]);
    const hangA = makeTextNode('hangA', [pA]);
    const hangB = makeTextNode('hangB', [pB]);
    const f = framed(makeTextNode('f', [hangA, hangB]), 1, dir);
    const doc = makeTextNode('doc', [f]);
    const prune = framePrunedCollapsed(new Set(), collectFrameRoots(doc));
    const out = expandFrameIslands(layoutMindmap(doc, measure, prune), doc, measure, new Set());
    return { f, hangA, hangB, pA, pB, a1, a2, b1, b2, out };
  }

  it('★ 两岛各节点两两不相交（下层孩子不再纵向叠画）', () => {
    const { pA, pB, a1, a2, b1, b2, out } = twoIslands();
    const islandA = [pA, a1, a2].map((n) => boxOf(out, n.id));
    const islandB = [pB, b1, b2].map((n) => boxOf(out, n.id));
    const hits: string[] = [];
    for (const a of islandA) {
      for (const b of islandB) {
        if (boxesIntersect(a, b)) hits.push(`${a.x},${a.y} ↔ ${b.x},${b.y}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('夹具成立性：两挂点行确实相邻（行距 ≪ 子树展开度，即修前的必撞场景）', () => {
    const { hangA, hangB, out } = twoIslands();
    const rowA = boxOf(out, hangA.id);
    const rowB = boxOf(out, hangB.id);
    const gap = Math.abs(rowA.y + rowA.h / 2 - (rowB.y + rowB.h / 2));
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(40);
  });

  it('挂点边与两岛内部边仍在（推挤不丢线）；主侧仍满足壳缘净空（FIX1）', () => {
    const { f, hangA, hangB, pA, pB, a1, a2, b1, b2, out } = twoIslands();
    const edges = edgesOf(out);
    expect(edges).toContain(`${hangA.id}→${pA.id}`);
    expect(edges).toContain(`${hangB.id}→${pB.id}`);
    expect(edges).toContain(`${pA.id}→${a1.id}`);
    expect(edges).toContain(`${pA.id}→${a2.id}`);
    expect(edges).toContain(`${pB.id}→${b1.id}`);
    expect(edges).toContain(`${pB.id}→${b2.id}`);
    const shell = shellBoxOf(out, f);
    for (const id of [pA.id, pB.id]) {
      expect(boxOf(out, id).x).toBeGreaterThanOrEqual(shell.x + shell.w + MIN_CLEAR);
    }
  });

  it('left 方向同款：跨轴 = Y 推挤，净空按壳左缘', () => {
    const { f, pA, pB, a1, a2, b1, b2, out } = twoIslands('left');
    const islandA = [pA, a1, a2].map((n) => boxOf(out, n.id));
    const islandB = [pB, b1, b2].map((n) => boxOf(out, n.id));
    for (const a of islandA) for (const b of islandB) expect(boxesIntersect(a, b)).toBe(false);
    const shell = shellBoxOf(out, f);
    for (const id of [pA.id, pB.id]) {
      const box = boxOf(out, id);
      expect(box.x + box.w).toBeLessThanOrEqual(shell.x - MIN_CLEAR);
    }
  });

  it('推挤后两岛跨轴区间留间隙（≥ FRAME_HANG_SIBLING_GAP，非贴死）', () => {
    const { pA, pB, a1, a2, b1, b2, out } = twoIslands();
    const span = (ids: string[]) => {
      const boxes = ids.map((id) => boxOf(out, id));
      return {
        min: Math.min(...boxes.map((b) => b.y)),
        max: Math.max(...boxes.map((b) => b.y + b.h)),
      };
    };
    const A = span([pA.id, a1.id, a2.id]);
    const B = span([pB.id, b1.id, b2.id]);
    const gap = A.min > B.min ? A.min - B.max : B.min - A.max;
    expect(gap).toBeGreaterThanOrEqual(FRAME_HANG_SIBLING_GAP - 1e-6);
  });
});

describe('FO-FIX1：挂出根相对壳右缘的净空（根因 B）', () => {
  it('★ 空间根左缘 ≥ 壳右缘 + MIN_CLEAR（净空 = HANG_GAP − SHELL_PAD）', () => {
    const { f, g, out } = fixture();
    const shell = shellBoxOf(out, f);
    const gBox = boxOf(out, g.id);
    expect(FRAME_HANG_GAP - FRAME_SHELL_PAD).toBeGreaterThanOrEqual(MIN_CLEAR);
    expect(gBox.x).toBeGreaterThanOrEqual(shell.x + shell.w + MIN_CLEAR);
    expect(gBox.y).toBeGreaterThan(shell.y); // 纵向仍在框的带内（挂点行居中）
  });

  it('方向 left 时不变量同款（净空按壳左缘量）', () => {
    const { f, g, out } = fixture('left');
    const shell = shellBoxOf(out, f);
    const gBox = boxOf(out, g.id);
    expect(gBox.x + gBox.w).toBeLessThanOrEqual(shell.x - MIN_CLEAR);
  });

  it('挂出子树的节点都不落进壳内（子孙不回摆压框）', () => {
    const { f, g, ga, gb, gg, out } = fixture();
    const shell = shellBoxOf(out, f);
    const hanging = [g, ga, gb, gg].map((n) => boxOf(out, n.id));
    const inside = hanging.filter((b) => boxesIntersect(shell, b));
    expect(inside).toEqual([]);
  });
});
