/**
 * 兄弟子树碰撞消解（separate）：四向分叉重叠的深度优化。
 *
 * 覆盖三层：
 * 1. 纯几何原语（相交判定 / 重叠扫描）
 * 2. separateTree 行为（刚体分离、方向偏好、终止性、父盒障碍）
 * 3. 接线（layoutMindmapBranched）：随机四向树**零重叠** + 对照组确有重叠
 *
 * 对照组（`separate: false`）是防「假交付」的关键——若不加对照组，
 * 「消解后零重叠」也可能是因为随机树本来就没有重叠，测试会恒真通过。
 */
import { describe, expect, it } from 'vitest';
import {
  boxesIntersect,
  clearParentEdges,
  findOverlaps,
  overlapXOf,
  overlapYOf,
  separateTree,
  subtreeBoxOf,
  SEPARATE_MARGIN,
} from '../src/layout/separate.js';
import {
  collectNodes,
  findLinkCrossings,
  LINK_CLEAR_MARGIN,
  NodeIndex,
  polylineHitsBox,
  segmentHitsRect,
} from '../src/layout/linkClear.js';
import { layoutMindmapBranched, linkGeometry } from '../src/layout/branching.js';
import { bezierLink, layoutMindmap, sampleBezier, type Box, type LayoutNode } from '../src/layout/mindmap.js';
import { makeTextNode, type EditableNode } from '../src/tree/treeOps.js';
import type { GrowDir } from '../src/layout/forest.js';

/** 定长度量（可复现）：宽随文本长度、高固定 */
const measure = (n: EditableNode) => ({ w: (n.text?.length ?? 1) * 10 + 20, h: 30 });

const rootOf = (res: { nodes: LayoutNode[] }): LayoutNode => {
  const r = res.nodes.find((n) => n.parentId === null);
  if (!r) throw new Error('布局结果缺少根节点');
  return r;
};

/** 手工搭盒：用于纯几何单元测试（不走布局） */
function ln(node: EditableNode, box: Box, depth: number, parentId: string | null, children: LayoutNode[] = []): LayoutNode {
  return { node, box, side: 0, depth, parentId, children };
}

const withDir = (text: string, dir: GrowDir, children: EditableNode[] = []): EditableNode => ({
  ...makeTextNode(text, children),
  note: { dir },
});

/** 确定性 PRNG（种子固定 → 失败可复现） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIRS: readonly GrowDir[] = ['right', 'left', 'down', 'up'];

/** 随机四向树（每个子节点 75% 概率带 dir 声明） */
function randomTree(node: EditableNode, rand: () => number, depth: number, maxDepth: number): EditableNode {
  if (depth >= maxDepth) return node;
  const n = Math.floor(rand() * 3.4);
  for (let i = 0; i < n; i++) {
    const label = `${'x'.repeat(1 + Math.floor(rand() * 8))}${i}`;
    const kid: EditableNode = { ...makeTextNode(label), note: {} };
    if (rand() < 0.75) kid.note = { dir: DIRS[Math.floor(rand() * 4)] ?? 'right' };
    randomTree(kid, rand, depth + 1, maxDepth);
    node.children.push(kid);
  }
  return node;
}

describe('separate：几何原语', () => {
  it('overlap 量：相交为正、贴边为 0、分离为负', () => {
    const a: Box = { x: 0, y: 0, w: 10, h: 10 };
    expect(overlapXOf(a, { x: 5, y: 0, w: 10, h: 10 })).toBe(5);
    expect(overlapXOf(a, { x: 10, y: 0, w: 10, h: 10 })).toBe(0);
    expect(overlapXOf(a, { x: 30, y: 0, w: 10, h: 10 })).toBe(-20);
    expect(overlapYOf(a, { x: 0, y: 5, w: 10, h: 10 })).toBe(5);
    expect(boxesIntersect(a, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    // 只贴边不算相交（否则相邻兄弟会被误判为重叠 → 布局抖动）
    expect(boxesIntersect(a, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
  });

  it('findOverlaps：忽略祖先链，只报跨分支相交', () => {
    const root = makeTextNode('根');
    const a = makeTextNode('A');
    const child: EditableNode = { ...makeTextNode('a1'), note: {} };
    a.children.push(child);
    root.children.push(a);
    // 父盒恰好包住子盒（祖先链）→ 不计；另有一个真重叠兄弟
    const b = makeTextNode('B');
    root.children.push(b);
    const rootLn = ln(root, { x: 0, y: 0, w: 100, h: 100 }, 0, null, [
      ln(a, { x: 0, y: 0, w: 100, h: 100 }, 1, root.id, [
        ln(child, { x: 10, y: 10, w: 20, h: 20 }, 2, a.id),
      ]),
      ln(b, { x: 50, y: 50, w: 40, h: 40 }, 1, root.id),
    ]);
    const pairs = findOverlaps(rootLn);
    // 祖先链（root⊃A⊃a1）全部跳过；只剩 A↔B 这一对真实跨分支重叠
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.a).toBe(rootLn.children[0]);
    expect(pairs[0]?.b).toBe(rootLn.children[1]);
  });
});

describe('separate：separateTree 行为', () => {
  it('★ 重叠兄弟 → 分离（间隙达到 margin），且方向偏好生效', () => {
    const root = makeTextNode('根');
    const a = makeTextNode('A');
    const b: EditableNode = { ...makeTextNode('B'), note: { dir: 'right' } };
    root.children.push(a, b);
    const la = ln(a, { x: 0, y: 0, w: 100, h: 30 }, 1, root.id);
    const lb = ln(b, { x: 50, y: 10, w: 100, h: 30 }, 1, root.id);
    // 父盒远离子女，避免干扰（只测兄弟分离）
    const rootLn = ln(root, { x: -300, y: -15, w: 120, h: 30 }, 0, null, [la, lb]);

    expect(findOverlaps(rootLn)).toHaveLength(1);
    const stats = separateTree(rootLn, { dirByNodeId: new Map([[b.id, 'right']]) });
    expect(findOverlaps(rootLn)).toHaveLength(0);
    expect(stats.pushes).toBeGreaterThanOrEqual(1);
    // right 声明 → 优先向右推；两侧必有一轴达到 margin 间隙
    const gapX = lb.box.x - (la.box.x + la.box.w);
    const gapY = Math.abs(lb.box.y - (la.box.y + la.box.h));
    expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(SEPARATE_MARGIN);
  });

  it('★ 刚体平移：子树内部相对布局逐像素不变', () => {
    const g1 = makeTextNode('g1');
    const g2 = makeTextNode('g2');
    const c: EditableNode = { ...makeTextNode('C', [g1, g2]), note: {} };
    const d = makeTextNode('D');
    const root = makeTextNode('根', [c, d]);

    const l1 = ln(g1, { x: 200, y: -40, w: 40, h: 30 }, 2, c.id);
    const l2 = ln(g2, { x: 200, y: 0, w: 40, h: 30 }, 2, c.id);
    const lc = ln(c, { x: 100, y: -20, w: 60, h: 30 }, 1, root.id, [l1, l2]);
    const ld = ln(d, { x: 120, y: -20, w: 60, h: 30 }, 1, root.id);
    const rootLn = ln(root, { x: -300, y: -15, w: 100, h: 30 }, 0, null, [lc, ld]);

    const before = { y1: l1.box.y - lc.box.y, y2: l2.box.y - lc.box.y, x1: l1.box.x - lc.box.x };
    separateTree(rootLn);
    expect(l1.box.y - lc.box.y).toBe(before.y1);
    expect(l2.box.y - lc.box.y).toBe(before.y2);
    expect(l1.box.x - lc.box.x).toBe(before.x1);
    expect(findOverlaps(rootLn)).toHaveLength(0);
  });

  it('无重叠 → 逐像素不动（消解是兜底，不是重排）', () => {
    const a = makeTextNode('A');
    const b = makeTextNode('B');
    const root = makeTextNode('根', [a, b]);
    const la = ln(a, { x: 100, y: -60, w: 80, h: 30 }, 1, root.id);
    const lb = ln(b, { x: 100, y: 20, w: 80, h: 30 }, 1, root.id);
    const rootLn = ln(root, { x: 0, y: 0, w: 60, h: 30 }, 0, null, [la, lb]);
    const snapshot = [rootLn, la, lb].map((n) => ({ ...n.box }));
    const stats = separateTree(rootLn, { margin: 40 }); // 即便 margin 很大也不动
    expect(stats.pushes).toBe(0);
    expect(stats.hardStacks).toBe(0);
    expect([rootLn, la, lb].map((n) => ({ ...n.box }))).toEqual(snapshot);
  });

  it('子盒压住父盒 → 被推离（父盒是硬障碍）', () => {
    const c = makeTextNode('子');
    const root = makeTextNode('根', [c]);
    const lc = ln(c, { x: 0, y: 0, w: 60, h: 30 }, 1, root.id);
    const rootLn = ln(root, { x: 0, y: 0, w: 60, h: 30 }, 0, null, [lc]);
    // 父子同链，findOverlaps 会跳过 → 直接断言盒相交
    expect(boxesIntersect(rootLn.box, lc.box)).toBe(true);
    separateTree(rootLn);
    expect(boxesIntersect(rootLn.box, lc.box)).toBe(false);
  });

  it('终止性：病态输入（多子全叠一起）也收敛到零重叠', () => {
    const kids = Array.from({ length: 8 }, (_, i) => makeTextNode(`k${i}`));
    const root = makeTextNode('根', kids);
    const rootLn = ln(root, { x: 0, y: 0, w: 60, h: 30 }, 0, null, []);
    for (const k of kids) rootLn.children.push(ln(k, { x: 0, y: 0, w: 60, h: 30 }, 1, root.id));
    expect(findOverlaps(rootLn).length).toBeGreaterThan(0);
    const stats = separateTree(rootLn, { maxRounds: 24 });
    expect(findOverlaps(rootLn)).toHaveLength(0);
    expect(stats.hardStacks).toBeLessThanOrEqual(1);
  });

  it('确定性：同输入两次消解结果逐像素一致', () => {
    const build = () => {
      const kids = Array.from({ length: 6 }, (_, i) => ({
        ...makeTextNode(`k${i}`),
        note: { dir: DIRS[i % 4] ?? 'right' },
      }));
      const root = makeTextNode('根', kids);
      const rootLn = ln(root, { x: 0, y: 0, w: 60, h: 30 }, 0, null, []);
      for (const k of kids) {
        rootLn.children.push(ln(k, { x: (k.text?.length ?? 1) * 3, y: 0, w: 80, h: 30 }, 1, root.id));
      }
      return rootLn;
    };
    const a = build();
    const b = build();
    separateTree(a);
    separateTree(b);
    expect(a.children.map((n) => ({ ...n.box }))).toEqual(b.children.map((n) => ({ ...n.box })));
  });
});

describe('separate：子树不得回压父的出边（clearParentEdges）', () => {
  it('★ 子节点声明 right、其孙节点声明 left → 整棵子树外推到父右缘之外', () => {
    // 这正是「连线穿过自己子树」的根源：孙节点朝反方向长回去，占住了父→子的走廊。
    const p = makeTextNode('父');
    const c: EditableNode = { ...makeTextNode('子'), note: { dir: 'right' } };
    const g: EditableNode = { ...makeTextNode('孙'), note: { dir: 'left' } };
    c.children.push(g);
    p.children.push(c);

    const lg = ln(g, { x: 30, y: 0, w: 60, h: 30 }, 2, c.id);
    const lc = ln(c, { x: 100, y: 0, w: 60, h: 30 }, 1, p.id, [lg]);
    const lp = ln(p, { x: 0, y: 0, w: 60, h: 30 }, 0, null, [lc]);
    const dirOf = new Map<string, GrowDir>([
      [c.id, 'right'],
      [g.id, 'left'],
    ]);

    expect(subtreeBoxOf(lc).x).toBeLessThan(60); // 初始：孙压在父右缘里
    const pushes = clearParentEdges(lp, dirOf, 14);
    expect(pushes).toBeGreaterThan(0);
    // 外推后：整棵子树的最左边界越过「父右缘 + margin」
    expect(subtreeBoxOf(lc).x).toBeGreaterThanOrEqual(60 + 14 - 1e-6);
    // 且子树内部相对偏移不变（刚体平移）
    expect(lg.box.x - lc.box.x).toBe(30 - 100);
  });

  it('无回压 → 不动（不为了避障无谓拉长连线）', () => {
    const p = makeTextNode('父');
    const c: EditableNode = { ...makeTextNode('子'), note: { dir: 'right' } };
    p.children.push(c);
    const lc = ln(c, { x: 200, y: 0, w: 60, h: 30 }, 1, p.id);
    const lp = ln(p, { x: 0, y: 0, w: 60, h: 30 }, 0, null, [lc]);
    const dirOf = new Map<string, GrowDir>([[c.id, 'right']]);
    expect(clearParentEdges(lp, dirOf, 14)).toBe(0);
    expect(lc.box.x).toBe(200);
  });
});

describe('separate：连线避障（连线不得压在节点盒上）', () => {
  it('线段 × 矩形：穿过多/擦边/在外侧的判定', () => {
    expect(segmentHitsRect(0, 10, 100, 10, 40, 0, 20, 20)).toBe(true); // 横穿
    expect(segmentHitsRect(0, 10, 100, 10, 40, 20, 20, 20)).toBe(false); // 下方经过
    expect(segmentHitsRect(50, 0, 50, 100, 0, 40, 100, 20)).toBe(true); // 竖穿
    // 从矩形外侧掠过（y=31 在矩形下边 30 之外）不算穿
    expect(segmentHitsRect(0, 31, 100, 31, 40, 0, 20, 30)).toBe(false);
  });

  it('折线压盒：命中返回线段下标，未命中 -1', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(polylineHitsBox(pts, { x: 40, y: -5, w: 20, h: 30 })).toBe(0);
    expect(polylineHitsBox(pts, { x: 40, y: 40, w: 20, h: 30 })).toBe(-1);
  });

  it('★ 连线几何与渲染同源：默认贝塞尔的 path 与 bezierLink 逐值一致', () => {
    const root = makeTextNode('根', [makeTextNode('子')]);
    const res = layoutMindmap(root, measure, new Set());
    const [parent, child] = res.nodes;
    if (!parent || !child) throw new Error('夹具为空');
    const dirOf = new Map<string, GrowDir>([[child.node.id, 'right']]);
    const g = linkGeometry(parent, child, 'right', dirOf);
    expect(g.path).toBe(bezierLink(parent, child));
    // 折线就是这条曲线的采样（17 点 = 默认 16 段）
    expect(g.points).toEqual(sampleBezier(ctrlOf(g)));
  });

  it('★ 接线：启用避障后连线压盒明显减少，且零盒重叠不变', () => {
    let off = 0;
    let on = 0;
    let cases = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const rand = mulberry32(seed);
      const root = randomTree({ ...makeTextNode('根'), note: {} }, rand, 0, 4);
      if (root.children.length === 0) continue;
      cases++;
      const res = layoutMindmapBranched(root, measure, new Set());
      const tree = rootOf(res);
      const dirOf = effectiveDirMap(tree);
      const count = (withClear: boolean): number => {
        const index = withClear ? new NodeIndex(collectNodes(tree)) : undefined;
        return findLinkCrossings(
          tree,
          (p, c) => linkGeometry(p, c, dirOf.get(c.node.id) ?? 'right', dirOf, index).points,
          LINK_CLEAR_MARGIN,
        ).length;
      };
      off += count(false);
      on += count(true);
      expect(findOverlaps(tree)).toHaveLength(0);
    }
    expect(cases).toBeGreaterThan(30);
    expect(on).toBeLessThan(off); // 避障真的在做事（对照组防止恒真）
  });
});

/** 从几何反推贝塞尔控制点（仅用于断言「折线 = 同一条曲线」） */
function ctrlOf(g: { path: string }): Parameters<typeof sampleBezier>[0] {
  const m = /^M ([-\d.]+) ([-\d.]+) C ([-\d.]+) ([-\d.]+), ([-\d.]+) ([-\d.]+), ([-\d.]+) ([-\d.]+)$/.exec(
    g.path,
  );
  if (!m) throw new Error(`非贝塞尔 path：${g.path}`);
  return {
    sx: Number(m[1]),
    sy: Number(m[2]),
    c1x: Number(m[3]),
    c1y: Number(m[4]),
    c2x: Number(m[5]),
    c2y: Number(m[6]),
    ex: Number(m[7]),
    ey: Number(m[8]),
  };
}

/** 布局内部的有效方向表（显式声明优先，否则沿用父）——诊断/复算用 */
function effectiveDirMap(root: LayoutNode): Map<string, GrowDir> {
  const byId = new Map<string, LayoutNode>();
  const dirOf = new Map<string, GrowDir>();
  const walk = (n: LayoutNode): void => {
    byId.set(n.node.id, n);
    const d = n.node.note?.dir;
    if (typeof d === 'string' && (DIRS as readonly string[]).includes(d)) {
      dirOf.set(n.node.id, d as GrowDir);
    } else {
      const p = n.parentId === null ? undefined : byId.get(n.parentId);
      dirOf.set(n.node.id, (p && dirOf.get(p.node.id)) ?? 'right');
    }
    for (const c of n.children) walk(c);
  };
  walk(root);
  return dirOf;
}

describe('separate：接线到分支布局（四向分叉深度优化）', () => {
  it('★ 随机四向树 200 例：消解后零重叠', () => {
    let cases = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const rand = mulberry32(seed);
      const root = randomTree({ ...makeTextNode('根'), note: {} }, rand, 0, 4);
      if (root.children.length === 0) continue;
      cases++;
      const res = layoutMindmapBranched(root, measure, new Set());
      expect(findOverlaps(rootOf(res)), `seed=${seed}`).toHaveLength(0);
    }
    expect(cases).toBeGreaterThan(100); // 防止夹具退化成空跑
  });

  it('★ 对照组：关掉消解（separate:false）确实会残留重叠', () => {
    let residual = 0;
    let total = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const rand = mulberry32(seed);
      const root = randomTree({ ...makeTextNode('根'), note: {} }, rand, 0, 4);
      if (root.children.length === 0) continue;
      const res = layoutMindmapBranched(root, measure, new Set(), { separate: false });
      const n = findOverlaps(rootOf(res)).length;
      total += n;
      if (n > 0) residual++;
    }
    // 这是「消解真的在做事」的反证：没有它上述随机树会残留大量重叠
    expect(total).toBeGreaterThan(0);
    expect(residual).toBeGreaterThan(0);
  });

  it('★ 邻侧防叠升级：left 长子树 + down 宽子树 + right 子树三向共存零重叠', () => {
    const root = makeTextNode('根', [
      makeTextNode('议题', [
        withDir('反方', 'left', [
          makeTextNode('链一', [makeTextNode('链二', [makeTextNode('链三')])]),
        ]),
        withDir('细节', 'down', [
          makeTextNode('细A'),
          makeTextNode('细B'),
          makeTextNode('细C'),
        ]),
        withDir('正方', 'right', [
          makeTextNode('论一'),
          makeTextNode('论二'),
        ]),
      ]),
    ]);
    const res = layoutMindmapBranched(root, measure, new Set(), { islandDir: 'right' });
    expect(findOverlaps(rootOf(res))).toHaveLength(0);
  });

  it('★ 嵌套四向：孙层再分叉也零重叠（深度优化核心场景）', () => {
    const root = makeTextNode('根', [
      withDir('中心', 'right', [
        withDir('右上', 'up', [makeTextNode('u1'), makeTextNode('u2')]),
        withDir('右下', 'down', [makeTextNode('d1'), makeTextNode('d2')]),
        withDir('右右', 'right', [makeTextNode('r1'), makeTextNode('r2')]),
        withDir('右左', 'left', [makeTextNode('l1'), makeTextNode('l2')]),
      ]),
    ]);
    const res = layoutMindmapBranched(root, measure, new Set(), { islandDir: 'right' });
    expect(res.nodes.length).toBeGreaterThan(10);
    expect(findOverlaps(rootOf(res))).toHaveLength(0);
  });

  it('★ B″：锚定子节点的生长轴以基线落位为准，不再把兄弟推成链式贯穿', () => {
    // 经典布局会把根的第 2 个子节点分到左侧；若它的生长轴仍记成继承方向 right，
    // 碰撞消解会沿 +x 把它推回父与兄弟之间的走廊 → 连线穿过兄弟（真实缺陷）。
    const wrongIdeas: EditableNode = { ...makeTextNode('一些错误认知'), note: { dir: 'down' } };
    const root = makeTextNode('速读', [
      makeTextNode('成为速读技巧大师'),
      makeTextNode('培养速读技巧', [wrongIdeas]),
    ]);
    const res = layoutMindmapBranched(root, measure, new Set());
    const tree = rootOf(res);
    expect(findOverlaps(tree)).toHaveLength(0);
    expect(findLinkCrossings(tree, (p, c) => linkGeometry(p, c, 'right', new Map()).points, LINK_CLEAR_MARGIN)).toHaveLength(0);
    // 兄弟不再被排成链式：两者分别在父的两侧（经典左右平衡得以保留）
    const master = res.nodes.find((n) => n.node.text === '成为速读技巧大师');
    const cultivate = res.nodes.find((n) => n.node.text === '培养速读技巧');
    expect(master && cultivate).toBeTruthy();
    if (master && cultivate) {
      const rootBox = tree.box;
      const onOppositeSides =
        (master.box.x >= rootBox.x + rootBox.w && cultivate.box.x + cultivate.box.w <= rootBox.x) ||
        (cultivate.box.x >= rootBox.x + rootBox.w && master.box.x + master.box.w <= rootBox.x) ||
        Math.abs(master.box.y - cultivate.box.y) > Math.max(master.box.h, cultivate.box.h);
      expect(onOppositeSides).toBe(true);
    }
  });

  it('★ 走廊排斥：up 链的梁线走廊被 anchored 兄弟占住 → 兄弟让位、零穿越', () => {
    // 用户真实文档回归：培养速读技巧 的 up 链（新节点×3）与右侧 anchored 兄弟
    // （聚焦/克服）抢父节点上方空间，梁线横段从 聚焦 身上穿过。
    const root = makeTextNode('速读', [
      makeTextNode('培养速读技巧', [
        makeTextNode('聚焦核心速度技巧'),
        makeTextNode('克服阅读障碍'),
        withDir('眼睛-照相机一样阅读', 'up'),
        withDir('一些错误认知', 'down', [
          withDir('速读-记笔记-理解', 'down', [
            withDir('理解：信息内部融合', 'right'),
            withDir('回忆：不是保留', 'right'),
            withDir('思考能力', 'left'),
            withDir('新节点', 'down'),
          ]),
        ]),
        withDir('新节点', 'up', [
          withDir('新节点', 'up', [withDir('新节点', 'up')]),
        ]),
        withDir('新节点', 'up', [withDir('新节点', 'up')]),
      ]),
    ]);
    const res = layoutMindmapBranched(root, measure, new Set());
    const tree = rootOf(res);
    expect(findOverlaps(tree)).toHaveLength(0);
    const dirOf = effectiveDirMap(tree);
    const index = new NodeIndex(collectNodes(tree));
    expect(
      findLinkCrossings(
        tree,
        (p, c) => linkGeometry(p, c, dirOf.get(c.node.id) ?? 'right', dirOf, index).points,
        LINK_CLEAR_MARGIN,
      ),
    ).toHaveLength(0);
  });

  it('回归闸门不受影响：无 note.dir → 与 layoutMindmap 逐盒一致', () => {
    const root = makeTextNode('根', [
      makeTextNode('A', [makeTextNode('A1'), makeTextNode('A2')]),
      makeTextNode('B'),
      makeTextNode('C', [makeTextNode('C1')]),
    ]);
    const classic = layoutMindmap(root, measure, new Set());
    const branched = layoutMindmapBranched(root, measure, new Set());
    expect(branched.nodes.map((n) => ({ id: n.node.id, ...n.box }))).toEqual(
      classic.nodes.map((n) => ({ id: n.node.id, ...n.box })),
    );
    expect(branched.bounds).toEqual(classic.bounds);
  });

  it('消解后连线端点跟着更新（不残留穿盒旧 path）', () => {
    // 四向俱全：一次性覆盖 bezier / orgBeam / orgBeamUp 三种连线构造器
    const root = makeTextNode('根', [
      withDir('右', 'right', [makeTextNode('右子')]),
      withDir('下', 'down', [makeTextNode('下子')]),
      withDir('上', 'up', [makeTextNode('上子')]),
      withDir('左', 'left', [makeTextNode('左子')]),
    ]);
    const res = layoutMindmapBranched(root, measure, new Set());
    const boxById = new Map(res.nodes.map((n) => [n.node.id, n.box]));
    for (const link of res.links) {
      const from = boxById.get(link.fromId);
      const to = boxById.get(link.toId);
      if (!from || !to) throw new Error('连线引用了不存在的节点');
      // 起点必须落在源/目标盒的边界附近（含 H_GAP/V_GAP 外的正常情形）
      const m = /M ([-\d.]+) ([-\d.]+)/.exec(link.path);
      expect(m).not.toBeNull();
      const sx = Number(m?.[1]);
      const sy = Number(m?.[2]);
      const near =
        Math.abs(sx - from.x) < 1 ||
        Math.abs(sx - (from.x + from.w)) < 1 ||
        Math.abs(sx - (from.x + from.w / 2)) < 1;
      expect(near, `${link.fromId}→${link.toId} 起点 ${sx} 不贴源盒`).toBe(true);
      expect(sy).toBeGreaterThanOrEqual(from.y - 1);
      expect(sy).toBeLessThanOrEqual(from.y + from.h + 1);
    }
  });
});
