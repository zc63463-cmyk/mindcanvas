/**
 * FO-C2 · 框壳体积参与基座布局（**真管线** `layoutDemo`，非组件层）：
 * 成框根在基座布局里占「壳 AABB」（= 大纲行包围盒 + `FRAME_SHELL_PAD`，与 `FrameOutline`
 * 画出来的壳同源），于是邻子树节点盒不会压进框内；框内换行撑高 → 壳变高 → 邻节点被推开。
 *
 * 规格：`docs/specs/2026-09-15-subtree-frame-outline-c-amendment.md` §1「框体积/碰撞」；
 * 设计 §5.1「外壳尺寸 = 大纲包围盒 + padding（内容撑高，触发岛重排）」。
 *
 * 口径（与 C2 任务书一致）：
 *  - 碰撞体 = **壳**（不是每行卡）；壳**不含**挂出子树外包络（挂出层仍由自身盒参与）；
 *  - 无框文档：走不到壳度量（pipeline 不加包装）→ 几何零变更；
 *  - 拆框：框根立刻恢复普通 measure（不永久粘住）。
 */
import { describe, expect, it } from 'vitest';
import {
  boxesIntersect,
  clearFrame,
  frameOf,
  layoutMindmapBranched,
  makeTextNode,
  partitionFrameSubtree,
  setFrame,
  type Box,
  type EditableNode,
  type LayoutResult,
} from '@mindcanvas/kernel';
import { layoutDemo } from '../src/demo/pipeline.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';
import { FRAME_SHELL_PAD } from '../src/chrome/FrameOutline.js';

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

/** 长文本：固定内容列宽下必然折成多行（壳随之变高） */
const LONG = '框内这段长文本会在固定列宽下自动换行把行盒撑高于是整个框壳体积随之变大';
const SHORT = '短';

/**
 * R → [F(frame, depth=1) → F1, S → S1]：F 的框内行 = {F, F1}（F1 = 挂点行，无挂出子树）。
 *
 * 两子树**同侧相邻**（`note.dir = 'right'`，走 D2′ 分支布局 + `separateTree`）——
 * 这正是「岛不参与外层占位」暴露的场景：基座里 F 只是 34 高的框头小盒，而框内行向下
 * 长出 ~50px，兄弟 S 会被摆在框内行上（压框）。
 */
function docOf(text: string): {
  doc: EditableNode;
  f: EditableNode;
  f1: EditableNode;
  s: EditableNode;
  s1: EditableNode;
} {
  const f1 = makeTextNode(text);
  const fBase = makeTextNode('F', [f1]);
  const f: EditableNode = { ...fBase, note: { ...setFrame(fBase.note, 1), dir: 'right' } };
  const s1 = makeTextNode('S1');
  const sBase = makeTextNode('S', [s1]);
  const s: EditableNode = { ...sBase, note: { dir: 'right' } };
  const doc = makeTextNode('R', [f, s]);
  return { doc, f, f1, s, s1 };
}

function layoutOf(doc: EditableNode): LayoutResult {
  return layoutDemo(doc, new Map(), char).layout;
}

function nodeOf(layout: LayoutResult, id: string) {
  const hit = layout.nodes.find((n) => n.node.id === id);
  if (hit === undefined) throw new Error(`夹具错误：布局缺节点 ${id}`);
  return hit;
}

/** 框壳 AABB：大纲行包围盒 + FRAME_SHELL_PAD（与 FrameOutline 的壳算式同源） */
function shellBoxOf(layout: LayoutResult, frameRoot: EditableNode): Box {
  const spec = frameOf(frameRoot.note);
  if (spec === undefined) throw new Error('夹具错误：非框根');
  const ids = new Set(partitionFrameSubtree(frameRoot, spec.depth).outlineIds);
  const rows = layout.nodes.filter((n) => ids.has(n.node.id));
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

/** 框内行 id 集合（碰撞体是壳，行本身不算「邻居」） */
function rowIdsOf(frameRoot: EditableNode): Set<string> {
  const spec = frameOf(frameRoot.note);
  if (spec === undefined) throw new Error('夹具错误：非框根');
  return new Set(partitionFrameSubtree(frameRoot, spec.depth).outlineIds);
}

describe('FO-C2：框壳体积参与基座布局（碰撞体 = 壳）', () => {
  it('★ 邻子树节点盒不得与框壳 AABB 重叠（成框根在基座里占壳体积）', () => {
    const { doc, f, s } = docOf(LONG);
    const layout = layoutOf(doc);
    const shell = shellBoxOf(layout, f);
    const rows = rowIdsOf(f);

    // 对照组：邻节点确实在布局里（否则断言会因「没渲染」而假绿）
    expect(nodeOf(layout, s.id).node.id).toBe(s.id);
    const outsiders = layout.nodes.filter((n) => !rows.has(n.node.id));
    expect(outsiders.length).toBeGreaterThan(0);
    const hit = outsiders.filter((n) => boxesIntersect(shell, n.box));
    expect(hit.map((n) => n.node.text)).toEqual([]);
  });

  it('框内换行撑高 → 壳变高，且邻子树被推开（重排，不永久压住邻居）', () => {
    const short = docOf(SHORT);
    const long = docOf(LONG);
    const shortLayout = layoutOf(short.doc);
    const longLayout = layoutOf(long.doc);
    const shortShell = shellBoxOf(shortLayout, short.f);
    const longShell = shellBoxOf(longLayout, long.f);

    expect(longShell.h).toBeGreaterThan(shortShell.h); // 折行 → 壳变高
    // 邻子树（S → S1）整体被推远（纵向堆叠方向上 y 增大；不允许原地不动被永久压住）
    expect(nodeOf(longLayout, long.s.id).box.y).toBeGreaterThan(
      nodeOf(shortLayout, short.s.id).box.y,
    );
    // 撑高之后依然零重叠
    const rows = rowIdsOf(long.f);
    const hit = longLayout.nodes
      .filter((n) => !rows.has(n.node.id))
      .filter((n) => boxesIntersect(longShell, n.box));
    expect(hit.map((n) => n.node.text)).toEqual([]);
  });

  it('壳 = 大纲行包围盒 + FRAME_SHELL_PAD；框头行坐在壳内（同一壳尺寸源）', () => {
    const { doc, f } = docOf(LONG);
    const layout = layoutOf(doc);
    const shell = shellBoxOf(layout, f);
    const head = nodeOf(layout, f.id).box;
    expect(head.x).toBeCloseTo(shell.x + FRAME_SHELL_PAD, 6);
    expect(head.y).toBeCloseTo(shell.y + FRAME_SHELL_PAD, 6);
    expect(head.x + head.w).toBeLessThanOrEqual(shell.x + shell.w + 1e-6);
    expect(head.y + head.h).toBeLessThanOrEqual(shell.y + shell.h + 1e-6);
  });

  it('FO-C2.1：挂出枝不得压邻居（占位含挂出外包络；真管线 layoutDemo）', () => {
    // F(frame, depth=1, dir=right) → hangRow → p → [c1..c5]；邻居 Z(dir=right) 链式子树向右伸进挂出区
    const rz = (n: EditableNode): EditableNode => ({ ...n, note: { dir: 'right' } });
    const cs = ['c1', 'c2', 'c3', 'c4', 'c5'].map((t) => makeTextNode(`${t}wxyz`));
    const p = makeTextNode('p', cs);
    const fBase = makeTextNode('F', [makeTextNode('hangRow', [p])]);
    const f: EditableNode = { ...fBase, note: { ...setFrame(fBase.note, 1), dir: 'right' } };
    const z4 = rz(
      makeTextNode('z4', [rz(makeTextNode('z4a')), rz(makeTextNode('z4b')), rz(makeTextNode('z4c'))]),
    );
    const z3 = rz(makeTextNode('z3', [z4]));
    const z2 = rz(makeTextNode('z2', [z3]));
    const z1 = rz(makeTextNode('z1', [z2]));
    const z = rz(makeTextNode('Z', [z1]));
    const doc = makeTextNode('doc', [f, z]);

    const layout = layoutOf(doc);
    const hang = [p, ...cs];
    const neighbors = [z, z1, z2, z3, z4, ...z4.children];
    const hits: string[] = [];
    for (const h of hang) {
      for (const nb of neighbors) {
        if (boxesIntersect(nodeOf(layout, h.id).box, nodeOf(layout, nb.id).box)) {
          hits.push(`${nodeOf(layout, h.id).node.text} ↔ ${nodeOf(layout, nb.id).node.text}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('拆框 → 框根恢复普通 measure（不永久粘住壳体积）', () => {
    const { doc, f, f1 } = docOf(LONG);
    const layout = layoutOf(doc);
    const shellH = shellBoxOf(layout, f).h;

    const unframed: EditableNode = { ...f, note: clearFrame(f.note) };
    const doc2: EditableNode = { ...doc, children: [unframed, makeTextNode('S')] };
    const after = layoutOf(doc2);
    const fBox = nodeOf(after, f.id).box;
    expect(fBox.h).toBeLessThan(shellH); // 回到节点卡高度
    expect(after.nodes.some((n) => n.node.id === f1.id)).toBe(true); // 子树回到常规布局
  });

  it('无框文档：不引入壳度量（几何与直接走基座布局逐值一致）', () => {
    const plain = makeTextNode('R', [makeTextNode('A', [makeTextNode('A1')]), makeTextNode('B')]);
    const piped = layoutOf(plain);
    const raw = layoutMindmapBranched(plain, createNodeMeasure(char, new Map()), new Set());
    expect(piped.nodes.map((n) => ({ id: n.node.id, box: n.box }))).toEqual(
      raw.nodes.map((n) => ({ id: n.node.id, box: n.box })),
    );
  });
});
