/**
 * FO-C2 · 框壳体积（kernel 侧）：壳 AABB 的算式、壳度量注入、以及「成框根在基座里占壳体积」
 * → 邻子树不被压 / 框内撑高推动邻居重排。
 *
 * 规格：`docs/specs/2026-09-15-subtree-frame-outline-c-amendment.md` §1（框体积/碰撞）、
 * 设计 §5.1「外壳尺寸 = 大纲包围盒 + padding（内容撑高，触发岛重排）」。
 *
 * 分工（与 react 侧 `frame-shell-collision.test.ts` 的差别）：
 *  - 本文件用**内核编排**（`layoutMindmapBranched` / `layoutMindmap` + 壳度量 + `expandFrameIslands`）
 *    逐条钉住几何，不依赖 react 的 measure 装饰器；
 *  - react 侧那份走真管线 `layoutDemo`，证明**接线**没漏。
 *
 * 口径：碰撞体 = **壳**（不是每行卡）；壳不含挂出子树外包络（挂出层节点仍以自身盒参与）。
 */
import { describe, expect, it } from 'vitest';
import { setFrame } from '../src/protocol/frame.js';
import {
  FRAME_SHELL_PAD,
  collectFrameRoots,
  createFrameShellMeasure,
  expandFrameIslands,
  framePrunedCollapsed,
  frameShellSize,
  layoutFrameIsland,
} from '../src/layout/frameLayout.js';
import type { Box, LayoutNode, LayoutResult } from '../src/layout/mindmap.js';
import { layoutMindmap, type MeasureFn } from '../src/layout/mindmap.js';
import { boxesIntersect } from '../src/layout/separate.js';
import { layoutMindmapBranched } from '../src/layout/branching.js';
import { makeTextNode, type EditableNode } from '../src/tree/treeOps.js';

/** 确定性度量：宽 = 文本长 × 10、高 = 24（与 frame-layout.test.ts 同款） */
const ROW_H = 24;
function measure(node: EditableNode): { w: number; h: number } {
  return { w: (node.text ?? 'x').length * 10, h: ROW_H };
}

const LONG = '框内这段长文本会在固定列宽下自动换行把行盒撑高于是整个框壳体积随之变大';
const SHORT = '短';

/** 给节点打框（不可变） */
function framed(node: EditableNode, depth: number, dir?: 'right' | 'left'): EditableNode {
  const note = setFrame(node.note, depth);
  return { ...node, ...(dir === undefined ? { note } : { note: { ...note, dir } }) };
}

/**
 * R → [F(frame) → F1, S → S1]（可指定同侧 dir）。
 *
 * 带 dir → 走 D2′ 分支布局（同侧相邻 + `separateTree`）；这也是 react 侧那份测的夹具形状。
 * 不带 dir → 走 `layoutMindmap` 回退，但**根直辖子女会被「按高度贪心」分到两侧**，
 * 故回退路径另用 `nestedDocOf`（兄弟挂在第二层，必然同侧相邻）。
 */
function docOf(text: string, dir?: 'right' | 'left') {
  const f1 = makeTextNode(text);
  const fBase = makeTextNode('F', [f1]);
  const f = framed(fBase, 1, dir);
  const sBase = makeTextNode('S', [makeTextNode('S1')]);
  const s: EditableNode = dir === undefined ? sBase : { ...sBase, note: { dir } };
  const doc = makeTextNode('R', [f, s]);
  return { doc, f, s };
}

/** R → A → [F(frame) → F1, S → S1]：无 dir 的 fallback 路径下，兄弟同侧相邻 */
function nestedDocOf(text: string) {
  const f1 = makeTextNode(text);
  const fBase = makeTextNode('F', [f1]);
  const f = framed(fBase, 1);
  const s = makeTextNode('S', [makeTextNode('S1')]);
  const a = makeTextNode('A', [f, s]);
  const doc = makeTextNode('R', [a]);
  return { doc, f, s };
}

/** 与 pipeline 同构的内核编排：剪枝 →（可选壳度量）基座 → 岛展开 */
function layoutWithShell(
  doc: EditableNode,
  opts: { base?: MeasureFn; shell?: boolean } = {},
): LayoutResult {
  const base = opts.base ?? measure;
  const frameRoots = collectFrameRoots(doc);
  const pruned = framePrunedCollapsed(new Set(), frameRoots);
  const useShell = (opts.shell ?? true) && frameRoots.length > 0;
  const m = useShell ? createFrameShellMeasure(base) : base;
  const baseLayout = layoutMindmapBranched(doc, m, pruned);
  return frameRoots.length === 0 ? baseLayout : expandFrameIslands(baseLayout, doc, m, new Set());
}

function nodeOf(layout: LayoutResult, id: string): LayoutNode {
  const hit = layout.nodes.find((n) => n.node.id === id);
  if (hit === undefined) throw new Error(`夹具错误：布局缺节点 ${id}`);
  return hit;
}

/**
 * 「挂出枝 vs 邻居」夹具（FO-C2.1）：
 * `doc → [F(frame, depth=1, dir=right) → hangRow → p → [c1wxyz..c5wxyz], Z(dir=right) → … → z4 → [z4a,b,c]]`
 * - F 的挂出枝向右长、跨轴铺开 5 个孩子（挂出区 ≈ x∈[371,505]、y∈[-132,44] 相对文档原点）；
 * - Z 与 F 同侧相邻（基座排在 F 之后），其链式子树向右延伸并在 x≈489 处与挂出区**相交**——
 *   这正是「邻居贴/压挂出枝」的可复现场景（修前 z4a/z4b 与 c4wxyz/c5wxyz 相交）。
 */
function hangVsNeighbor() {
  const rz = (n: EditableNode): EditableNode => ({ ...n, note: { dir: 'right' } });
  const cs = ['c1', 'c2', 'c3', 'c4', 'c5'].map((t) => makeTextNode(`${t}wxyz`));
  const p = makeTextNode('p', cs);
  const f = framed(makeTextNode('F', [makeTextNode('hangRow', [p])]), 1, 'right');
  const z4 = rz(
    makeTextNode('z4', [rz(makeTextNode('z4a')), rz(makeTextNode('z4b')), rz(makeTextNode('z4c'))]),
  );
  const z3 = rz(makeTextNode('z3', [z4]));
  const z2 = rz(makeTextNode('z2', [z3]));
  const z1 = rz(makeTextNode('z1', [z2]));
  const z = rz(makeTextNode('Z', [z1]));
  const doc = makeTextNode('doc', [f, z]);
  return {
    doc,
    f,
    hangNodes: [p, ...cs],
    neighborNodes: [z, z1, z2, z3, z4, ...(z4.children as EditableNode[])],
  };
}

function shellBoxOf(layout: LayoutResult, frameRoot: EditableNode): Box {
  const rows = rowNodesOf(layout, frameRoot);
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

/** 框内行（d ∈ [0, depth]）的布局节点 */
function rowNodesOf(layout: LayoutResult, frameRoot: EditableNode): LayoutNode[] {
  if (frameRoot.note?.frame === undefined) throw new Error('夹具错误：非框根');
  const island = layoutFrameIsland({
    frameRoot,
    depth: readDepth(frameRoot),
    measure,
    origin: { x: 0, y: 0 },
    direction: 'right',
  });
  const ids = new Set(island.boxes.keys());
  return layout.nodes.filter((n) => ids.has(n.node.id));
}

function readDepth(node: EditableNode): number {
  const spec = node.note?.frame;
  const raw = typeof spec === 'object' && spec !== null ? Reflect.get(spec, 'depth') : 1;
  return typeof raw === 'number' ? raw : 1;
}

/** 壳之外的节点（邻子树 / 上游） */
function outsidersOf(layout: LayoutResult, frameRoot: EditableNode): LayoutNode[] {
  const rows = new Set(rowNodesOf(layout, frameRoot).map((n) => n.node.id));
  return layout.nodes.filter((n) => !rows.has(n.node.id));
}

describe('FO-C2：壳 AABB 算式与壳度量', () => {
  it('island.shell = 大纲行包围盒 + 2×FRAME_SHELL_PAD；frameShellSize 与之逐值一致', () => {
    const long = makeTextNode(LONG);
    const r = makeTextNode('根', [long]);
    const island = layoutFrameIsland({
      frameRoot: r,
      depth: 1,
      measure,
      origin: { x: 5, y: 7 },
      direction: 'right',
    });
    const boxes = [...island.boxes.values()];
    const x0 = Math.min(...boxes.map((b) => b.x));
    const y0 = Math.min(...boxes.map((b) => b.y));
    const x1 = Math.max(...boxes.map((b) => b.x + b.w));
    const y1 = Math.max(...boxes.map((b) => b.y + b.h));
    expect(island.shell).toEqual({
      x: x0 - FRAME_SHELL_PAD,
      y: y0 - FRAME_SHELL_PAD,
      w: x1 - x0 + FRAME_SHELL_PAD * 2,
      h: y1 - y0 + FRAME_SHELL_PAD * 2,
    });
    // 尺寸与坐标无关（基座只看尺寸；行从壳左上角 + pad 起排）
    const size = frameShellSize(r, 1, measure);
    expect(size).toEqual({ w: island.shell.w, h: island.shell.h });
  });

  it('createFrameShellMeasure：成框根 → 壳尺寸；非框节点 → 原样透传 base', () => {
    const f = framed(makeTextNode('框', [makeTextNode(LONG)]), 1);
    const plain = makeTextNode('普通');
    const base: MeasureFn = () => ({ w: 10, h: 20 });
    const m = createFrameShellMeasure(base);
    expect(m(plain)).toEqual({ w: 10, h: 20 });
    const shell = frameShellSize(f, 1, m);
    expect(m(f)).toEqual(shell);
    expect(shell.h).toBeGreaterThan(base(f).h); // 壳体积 > 框头卡（这就是「框要有体积」）
  });

  it('壳尺寸随框内折行增大（内容撑高 → 体积变大）', () => {
    const short = framed(makeTextNode('F', [makeTextNode(SHORT)]), 1);
    const long = framed(makeTextNode('F', [makeTextNode(LONG)]), 1);
    expect(frameShellSize(long, 1, measure).h).toBeGreaterThan(
      frameShellSize(short, 1, measure).h,
    );
  });
});

describe('FO-C2：成框根在基座里占壳体积（邻子树不被压 / 撑高推开邻居）', () => {
  it('★ 无 dir（layoutMindmap 回退路径）：邻子树不与壳重叠；对照组（不注壳度量）确实压框', () => {
    const { doc, f, s } = nestedDocOf(LONG);
    const layout = layoutWithShell(doc);
    const shell = shellBoxOf(layout, f);
    expect(nodeOf(layout, s.id).node.id).toBe(s.id); // 邻节点确实在布局里（防假绿）
    const hit = outsidersOf(layout, f).filter((n) => boxesIntersect(shell, n.box));
    expect(hit.map((n) => n.node.text)).toEqual([]);
    expect(nodeOf(layout, s.id).box.y).toBeGreaterThanOrEqual(shell.y + shell.h - 1e-6);

    // 对照组（防「本测恒真」）：C2 前行为 = 不注入壳度量 → 邻节点压进壳内
    const before = layoutWithShell(doc, { shell: false });
    const beforeShell = shellBoxOf(before, f);
    const pressed = outsidersOf(before, f).filter((n) => boxesIntersect(beforeShell, n.box));
    expect(pressed.length).toBeGreaterThan(0);
  });

  it('★ 有 dir（D2′ 分支 + separateTree 路径）：同样零重叠，且框根占位 = 壳盒', () => {
    const { doc, f, s } = docOf(LONG, 'right');
    const size = frameShellSize(f, 1, measure);
    const layout = layoutWithShell(doc);
    const shell = shellBoxOf(layout, f);
    const hit = outsidersOf(layout, f).filter((n) => boxesIntersect(shell, n.box));
    expect(hit.map((n) => n.node.text)).toEqual([]);
    // 壳尺寸就是基座给成框根的占位尺寸（画出来的壳 = 占的体积）
    expect(shell.w).toBeCloseTo(size.w, 6);
    expect(shell.h).toBeCloseTo(size.h, 6);
    // 邻子树被推到壳下方（不是原地压着）
    expect(nodeOf(layout, s.id).box.y).toBeGreaterThanOrEqual(shell.y + shell.h);
  });

  it('框内换行撑高 → 邻子树被推开（重排，不永久压住邻居）', () => {
    const short = docOf(SHORT, 'right');
    const long = docOf(LONG, 'right');
    const shortLayout = layoutWithShell(short.doc);
    const longLayout = layoutWithShell(long.doc);
    expect(shellBoxOf(longLayout, long.f).h).toBeGreaterThan(shellBoxOf(shortLayout, short.f).h);
    expect(nodeOf(longLayout, long.s.id).box.y).toBeGreaterThan(
      nodeOf(shortLayout, short.s.id).box.y,
    );
  });

  it('FO-C2.1：挂出枝不得压邻居（占位壳并集挂出外包络）', () => {
    const { doc, hangNodes, neighborNodes } = hangVsNeighbor();
    const layout = layoutWithShell(doc);
    const hits: string[] = [];
    for (const h of hangNodes) {
      for (const nb of neighborNodes) {
        if (boxesIntersect(nodeOf(layout, h.id).box, nodeOf(layout, nb.id).box)) {
          hits.push(`${nodeOf(layout, h.id).node.text} ↔ ${nodeOf(layout, nb.id).node.text}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('FO-C2.1：占位壳 ⊇ 描边壳；无挂出时两者逐值一致（C2 行为不变）', () => {
    // 有挂出：place 含外包络 → 严格更大（且描边壳仍贴大纲行）
    const p = makeTextNode('p', [makeTextNode('c1'), makeTextNode('c2')]);
    const withHang = framed(makeTextNode('F', [makeTextNode('hr', [p])]), 1, 'right');
    const islandA = layoutFrameIsland({
      frameRoot: withHang,
      depth: 1,
      measure,
      origin: { x: 0, y: 0 },
      direction: 'right',
    });
    expect(islandA.place.w).toBeGreaterThanOrEqual(islandA.shell.w);
    expect(islandA.place.h).toBeGreaterThanOrEqual(islandA.shell.h);
    expect(islandA.place.x + islandA.place.w).toBeGreaterThan(islandA.shell.x + islandA.shell.w);

    // 无挂出：place === shell（FO-C2 逐值一致）
    const noHang = framed(makeTextNode('F', [makeTextNode('hr')]), 1, 'right');
    const islandB = layoutFrameIsland({
      frameRoot: noHang,
      depth: 1,
      measure,
      origin: { x: 0, y: 0 },
      direction: 'right',
    });
    expect(islandB.place).toEqual(islandB.shell);
    expect(frameShellSize(noHang, 1, measure)).toEqual({
      w: islandB.shell.w,
      h: islandB.shell.h,
    });
  });

  it('无成框节点：原样返回基座（同引用，零行为变更）', () => {
    const plain = makeTextNode('R', [makeTextNode('A')]);
    const base = layoutMindmap(plain, measure, new Set());
    const frameRoots = collectFrameRoots(plain);
    expect(frameRoots).toEqual([]);
    const m = frameRoots.length === 0 ? measure : createFrameShellMeasure(measure);
    expect(m).toBe(measure); // 无框 → 不包壳度量（measure 身份不变）
    expect(expandFrameIslands(base, plain, m, new Set())).toBe(base);
  });
});
