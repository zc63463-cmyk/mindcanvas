/**
 * FO-B1 · 框布局岛：`layoutFrameIsland`（大纲区 + 挂点 + 空间层复用现有布局）、
 * `expandFrameIslands`（基座布局 → 岛展开）、跨 depth 边界层级守卫。
 *
 * 规格：`docs/specs/2026-09-15-subtree-frame-outline-design.md` §5.1（布局岛）/ §5.2（交互约束）；
 * 计划：`docs/superpowers/plans/2026-09-15-subtree-frame-outline.md` Task 4。
 *
 * 契约要点：
 *  - 大纲层 = 相对框根 `d ∈ [0, depth]`（与 `partitionFrameSubtree` **同源**：盒键序 = outlineIds）；
 *  - 挂点 = `d === depth` 行的子侧锚点；挂出子树交给**现有**单子树布局（forest）继续排，不再写一套；
 *  - 跨 depth 边界改层级（进/出大纲层）一期 no-op；空间层内排序 / 进/出空间层不拦。
 */
import { describe, expect, it } from 'vitest';
import { setFrame } from '../src/protocol/frame.js';
import {
  crossesFrameDepthBoundary,
  expandFrameIslands,
  frameLayerOf,
  framePrunedCollapsed,
  collectFrameRoots,
  FRAME_ROW_GAP,
  FRAME_SHELL_PAD,
  layoutFrameIsland,
} from '../src/layout/frameLayout.js';
import { partitionFrameSubtree } from '../src/layout/framePartition.js';
import {
  FRAME_OUTLINE_CONTENT_W,
  FRAME_OUTLINE_MIN_W,
  FRAME_OUTLINE_PLACEHOLDER_H,
  FRAME_OUTLINE_ROW_PAD_X,
  FRAME_OUTLINE_ROW_PAD_Y,
  FRAME_ROW_INDENT,
  frameRowMetrics,
  frameRowTextWidth,
} from '../src/layout/frameMeasure.js';
import { defaultMeasure } from '../src/layout/measure.js';
import { LINE_H } from '../src/layout/nodeLayout.js';
import { layoutMindmap, type Box, type LayoutResult } from '../src/layout/mindmap.js';
import { makeEntityNode, makeImageNode, makeTextNode, type EditableNode } from '../src/tree/treeOps.js';

/** 确定性度量：宽 = 文本长度 × 10，高 = 24（行高断言的可读基数） */
const ROW_H = 24;
function measure(node: EditableNode): { w: number; h: number } {
  return { w: (node.text ?? 'x').length * 10, h: ROW_H };
}

/** 夹具取下标（避免测试里散落非空断言） */
function at<T>(list: readonly T[], i: number): T {
  const v = list[i];
  if (v === undefined) throw new Error(`夹具错误：下标 ${i} 越界`);
  return v;
}

/** 布局结果里某节点的盒（断言用） */
function boxOf(res: LayoutResult, id: string): Box {
  const n = res.nodes.find((x) => x.node.id === id);
  if (!n) throw new Error(`夹具错误：布局结果缺节点 ${id}`);
  return n.box;
}

/** 给节点打框（不可变：返回新节点对象） */
function framed(node: EditableNode, depth: number): EditableNode {
  return { ...node, note: setFrame(node.note, depth) };
}

/** 三层链：r(0) → c(1) → g(2)；depth=1 → 大纲 {r,c}，挂点行 = c，空间层 = g */
function threeLevel(): { r: EditableNode; c: EditableNode; g: EditableNode } {
  const g = makeTextNode('g');
  const c = makeTextNode('c', [g]);
  const r = makeTextNode('r', [c]);
  return { r, c, g };
}

describe('layoutFrameIsland（大纲区 + 挂点）', () => {
  it('depth=1 三层树：大纲 id 有盒；spatialRoot.x > 大纲行右缘', () => {
    const { r, c, g } = threeLevel();
    const island = layoutFrameIsland({
      frameRoot: r,
      depth: 1,
      measure,
      origin: { x: 100, y: 50 },
      direction: 'right',
    });
    expect(island.boxes.has(r.id)).toBe(true);
    expect(island.boxes.has(c.id)).toBe(true);
    expect(island.boxes.has(g.id)).toBe(false); // d=2 > depth → 空间层，不在大纲区
    expect(boxOfKeys(island.boxes, r.id).x).toBe(100); // origin 生效（行自 origin 起排）
    expect(boxOfKeys(island.boxes, r.id).y).toBe(50);

    const hang = island.hangOrigins.get(g.id);
    if (hang === undefined) throw new Error('夹具错误：缺挂点');
    const gLeft = hang.x - measure(g).w / 2; // 挂点值 = 空间根**中心**（与 forest CenterSpec.pos 同口径）
    const rowRight = islandRowRight(island, c.id);
    expect(gLeft).toBeGreaterThan(rowRight);
    expect(hang.y).toBeCloseTo(islandRowCenterY(island, c.id));
  });

  it('大纲盒键序与 partitionFrameSubtree.outlineIds 逐项一致（相对深度同源）', () => {
    const { r, g } = threeLevel();
    const island = layoutFrameIsland({
      frameRoot: r,
      depth: 1,
      measure,
      origin: { x: 0, y: 0 },
      direction: 'right',
    });
    expect([...island.boxes.keys()]).toEqual(partitionFrameSubtree(r, 1).outlineIds);
    expect([...island.boxes.keys()]).not.toContain(g.id);
  });

  it('depth=2：孙进大纲、无挂点；行向下堆叠且随相对深度缩进', () => {
    const { r, c, g } = threeLevel();
    const island = layoutFrameIsland({
      frameRoot: r,
      depth: 2,
      measure,
      origin: { x: 0, y: 0 },
      direction: 'right',
    });
    expect(island.hangOrigins.size).toBe(0);
    const rBox = boxOfKeys(island.boxes, r.id);
    const cBox = boxOfKeys(island.boxes, c.id);
    const gBox = boxOfKeys(island.boxes, g.id);
    expect(cBox.y).toBeGreaterThanOrEqual(rBox.y + rBox.h);
    expect(gBox.y).toBeGreaterThanOrEqual(cBox.y + cBox.h);
    expect(cBox.x).toBeGreaterThan(rBox.x);
    expect(gBox.x).toBeGreaterThan(cBox.x);
    // outlineHeight = 大纲包围盒高（origin.y → 最深行底）
    const bottom = Math.max(rBox.y + rBox.h, cBox.y + cBox.h, gBox.y + gBox.h);
    expect(island.outlineHeight).toBeCloseTo(bottom - 0);
  });

  it('direction=left：挂点在行左缘左侧；down/up 走行下/上侧', () => {
    const { r, c, g } = threeLevel();
    const left = layoutFrameIsland({
      frameRoot: r,
      depth: 1,
      measure,
      origin: { x: 0, y: 0 },
      direction: 'left',
    });
    const leftHang = left.hangOrigins.get(g.id);
    if (leftHang === undefined) throw new Error('夹具错误：缺挂点');
    expect(leftHang.x + measure(g).w / 2).toBeLessThan(islandRowLeft(left, c.id));

    const down = layoutFrameIsland({
      frameRoot: r,
      depth: 1,
      measure,
      origin: { x: 0, y: 0 },
      direction: 'down',
    });
    const downHang = down.hangOrigins.get(g.id);
    if (downHang === undefined) throw new Error('夹具错误：缺挂点');
    expect(downHang.y - measure(g).h / 2).toBeGreaterThan(islandRowBottom(down, c.id));
  });
});

describe('frameRowMetrics（FO-C1：紧凑行 + 固定列宽自动换行）', () => {
  /** 长文本：固定内容列宽下必然折行（≥2 行） */
  const LONG = '这是一段需要在框内自动换行的长文本内容用于验证行盒随行数增高而不是被省略号裁切掉';

  it('text 行按内容列宽折行：lines ≥ 2 且盒高 = pad×2 + LINE_H×行数', () => {
    const node = makeTextNode(LONG);
    const m = frameRowMetrics(node, 0);
    expect(m.placeholder).toBe(false);
    expect(m.lines.length).toBeGreaterThanOrEqual(2);
    expect(m.lines.join('')).toBe(LONG); // 折行只切分不丢字（复用 wrapText）
    expect(m.h).toBe(FRAME_OUTLINE_ROW_PAD_Y * 2 + LINE_H * m.lines.length);
    expect(m.h).toBeGreaterThanOrEqual(2 * LINE_H);
  });

  it('行宽 = 内容列宽 - 缩进（同列右缘对齐），深层缩进有最小宽度兜底', () => {
    const node = makeTextNode('窄行');
    expect(frameRowMetrics(node, 0).w).toBe(FRAME_OUTLINE_CONTENT_W);
    expect(frameRowMetrics(node, 2).w).toBe(FRAME_OUTLINE_CONTENT_W - 2 * FRAME_ROW_INDENT);
    expect(frameRowMetrics(node, 99).w).toBe(FRAME_OUTLINE_MIN_W);
  });

  it('明显紧凑于同节点画布卡：单行文本行高 < 节点卡默认高', () => {
    const node = makeTextNode('短标题');
    const row = frameRowMetrics(node, 0);
    expect(row.lines.length).toBe(1);
    expect(row.h).toBeLessThan(defaultMeasure(node).h); // 22 < 34（节点卡最小高）
  });

  it('image/entity 行 = 扁占位常量高，不跑资产预览高', () => {
    const img = makeImageNode('demo.png');
    const ent = makeEntityNode({ kind: 'img', id: 'demo.svg' });
    for (const n of [img, ent]) {
      const m = frameRowMetrics(n, 0);
      expect(m.placeholder).toBe(true);
      expect(m.h).toBe(FRAME_OUTLINE_PLACEHOLDER_H);
      expect(m.lines).toEqual([]);
      expect(m.h).toBeLessThan(defaultMeasure(n).h); // 实体资产卡含 ASSET_H(96) 预览高
    }
  });

  it('有 desc 的行不再扣「注释」提示列：折行可用宽与无 desc 一致（FO-FIX2）', () => {
    const measure10 = (s: string): number => s.length * 10;
    const plain = makeTextNode('12345678901234567890'); // 20 字符 × 10px：恰好放满一行
    const commented: EditableNode = { ...plain, note: { desc: '补充说明' } };
    const inner = FRAME_OUTLINE_CONTENT_W - FRAME_OUTLINE_ROW_PAD_X * 2;
    expect(plain.text !== undefined && measure10(plain.text) <= inner).toBe(true);
    // ★ 可用宽不随 desc 变窄（旁侧 chip 已删，幕布注释由 DescBlock/附属区显示）
    expect(frameRowTextWidth(commented, 0)).toBe(frameRowTextWidth(plain, 0));
    // 同文案不再因 desc 多折一行
    expect(frameRowMetrics(plain, 0, measure10).lines.length).toBe(1);
    expect(frameRowMetrics(commented, 0, measure10).lines.length).toBe(1);
  });

  it('layoutFrameIsland 用行度量排行：长文本行盒随行数增高、outlineHeight 同步', () => {
    const long = makeTextNode(LONG);
    const short = makeTextNode('短');
    const r = makeTextNode('根', [long, short]);
    const island = layoutFrameIsland({
      frameRoot: r,
      depth: 1,
      measure, // 画布卡度量（h 恒 24）不得再用作 text 行高
      origin: { x: 0, y: 0 },
      direction: 'right',
    });
    // 框头行（d=0）**也**是紧凑行（FO-C2 起基座盒 = 壳盒，行盒不再取画布卡度量）
    const headBox = boxOfKeys(island.boxes, r.id);
    const headMetrics = frameRowMetrics(r, 0);
    expect(headBox).toEqual({ x: 0, y: 0, w: headMetrics.w, h: headMetrics.h });
    const longBox = boxOfKeys(island.boxes, long.id);
    const metrics = frameRowMetrics(long, 1);
    expect(longBox.h).toBe(metrics.h);
    expect(longBox.w).toBe(metrics.w);
    expect(longBox.h).toBeGreaterThanOrEqual(2 * LINE_H);
    const shortBox = boxOfKeys(island.boxes, short.id);
    expect(shortBox.y).toBeGreaterThanOrEqual(longBox.y + longBox.h + FRAME_ROW_GAP - 1e-6);
    expect(island.outlineHeight).toBeCloseTo(shortBox.y + shortBox.h); // origin.y = 0
  });

  it('rowAuxH：宿主附属区（幕布注释等）叠在紧凑正文行之上', () => {
    const row = makeTextNode('行');
    const r = makeTextNode('根', [row]);
    const island = layoutFrameIsland({
      frameRoot: r,
      depth: 1,
      measure,
      origin: { x: 0, y: 0 },
      direction: 'right',
      rowAuxH: (n) => (n.id === row.id ? 30 : 0),
    });
    expect(boxOfKeys(island.boxes, row.id).h).toBe(frameRowMetrics(row, 1).h + 30);
  });
});

describe('expandFrameIslands（基座剪枝 → 岛展开，复用现有子树布局）', () => {
  it('剪枝基座只见框根；展开后大纲行 + 挂出子树回到布局，父链接回挂点行', () => {
    const { r, c, g } = threeLevel();
    const f = framed(r, 1);
    const doc = makeTextNode('doc', [f]);
    const prune = framePrunedCollapsed(new Set(), collectFrameRoots(doc));
    const base = layoutMindmap(doc, measure, prune);
    // 框内子树不进基座（无重复摆放）；框根以「叶」形态参与基座
    expect(base.nodes.map((n) => n.node.id).sort()).toEqual([doc.id, f.id].sort());

    const out = expandFrameIslands(base, doc, measure, new Set());
    const ids = out.nodes.map((n) => n.node.id);
    expect(ids).toContain(c.id);
    expect(ids).toContain(g.id);
    expect(new Set(ids).size).toBe(ids.length); // 无重复摆放
    // FO-C2：框头行 = 基座盒（成框根在基座里的占位盒）左上角 + FRAME_SHELL_PAD，
    // 尺寸 = 紧凑行度量（基座占位由 createFrameShellMeasure 给成壳盒，父边端点落在壳缘）
    const baseFrame = base.nodes.find((n) => n.node.id === f.id);
    expect(baseFrame).toBeDefined();
    const head = boxOf(out, f.id);
    const headMetrics = frameRowMetrics(f, 0);
    expect(head.x).toBeCloseTo((baseFrame?.box.x ?? 0) + FRAME_SHELL_PAD, 6);
    expect(head.y).toBeCloseTo((baseFrame?.box.y ?? 0) + FRAME_SHELL_PAD, 6);
    expect(head.w).toBe(headMetrics.w);
    expect(head.h).toBe(headMetrics.h);
    // 挂出子树在挂点行右侧（复用 forest 平移：pos = 空间根中心）
    expect(boxOf(out, g.id).x).toBeGreaterThan(boxOf(out, c.id).x + boxOf(out, c.id).w);
    // 挂点连线：大纲行 → 空间根（真实父子边，不再是「整棵节点盒」）
    expect(out.links.some((l) => l.fromId === c.id && l.toId === g.id)).toBe(true);
    // 空间层节点父链已接回挂点行；depth 绝对化（= 框根 depth + 相对深度）
    const gNode = out.nodes.find((n) => n.node.id === g.id);
    expect(gNode?.parentId).toBe(c.id);
    expect(gNode?.depth).toBe(3);
    expect(out.bounds.maxX).toBeGreaterThanOrEqual(boxOf(out, g.id).x + boxOf(out, g.id).w);
  });

  it('无成框节点：原样返回（引用不变，零行为变更）', () => {
    const g = makeTextNode('g');
    const root = makeTextNode('r', [g]);
    const base = layoutMindmap(root, measure, new Set());
    expect(expandFrameIslands(base, root, measure, new Set())).toBe(base);
  });

  it('框根被用户折叠 → 整岛隐藏（设计 §5.2；与全局折叠一致）', () => {
    const { r } = threeLevel();
    const f = framed(r, 1);
    const doc = makeTextNode('doc', [f]);
    const collapsed = new Set([f.id]);
    const prune = framePrunedCollapsed(collapsed, collectFrameRoots(doc));
    const base = layoutMindmap(doc, measure, prune);
    expect(expandFrameIslands(base, doc, measure, collapsed)).toBe(base);
  });

  it('框根 = 布局根（文档根成框）：基座未剪根的子层时也不得双份', () => {
    const { r, c, g } = threeLevel();
    const root = framed(r, 1); // 文档根自身成框（A3 命令层允许）
    const base = layoutMindmap(root, measure, framePrunedCollapsed(new Set(), [root]));
    const out = expandFrameIslands(base, root, measure, new Set());
    const ids = out.nodes.map((n) => n.node.id);
    expect(new Set(ids).size).toBe(ids.length); // 同 id 仅一份（旧副本已丢弃）
    expect(ids.sort()).toEqual([root.id, c.id, g.id].sort());
    // 上游连线（根 → 行）已被岛内结构取代：不再保留基座的父子线
    expect(out.links.some((l) => l.fromId === root.id && l.toId === c.id)).toBe(false);
    expect(out.links.some((l) => l.fromId === c.id && l.toId === g.id)).toBe(true);
  });

  it('空间挂载层上的嵌套框根递归成岛（设计 §3.3 允许的形态）', () => {
    const gg = makeTextNode('gg');
    const g = framed(makeTextNode('g', [gg]), 1); // g 成框 → 相对 g 的 d=1 行 = gg（无挂点）
    const c = makeTextNode('c', [g]);
    const f = framed(makeTextNode('r', [c]), 1); // 相对 f：c 为挂点行，g 起整棵属空间层
    const doc = makeTextNode('doc', [f]);
    const prune = framePrunedCollapsed(new Set(), collectFrameRoots(doc));
    const base = layoutMindmap(doc, measure, prune);
    expect(base.nodes.map((n) => n.node.id).sort()).toEqual([doc.id, f.id].sort());

    const out = expandFrameIslands(base, doc, measure, new Set());
    const ids = out.nodes.map((n) => n.node.id);
    expect(ids.sort()).toEqual([doc.id, f.id, c.id, g.id, gg.id].sort());
    expect(new Set(ids).size).toBe(ids.length);
    // 嵌套岛的行排在 g 的盒之下、且随相对深度缩进
    expect(boxOf(out, gg.id).y).toBeGreaterThanOrEqual(boxOf(out, g.id).y + boxOf(out, g.id).h);
    expect(boxOf(out, gg.id).x).toBeGreaterThan(boxOf(out, g.id).x);
    expect(out.links.some((l) => l.fromId === c.id && l.toId === g.id)).toBe(true);
  });
});

describe('跨 depth 边界守卫（设计 §5.2 一期）', () => {
  // doc → [f(frame, depth=1), z]；f → c → g → gg：f 的大纲层 {f, c}，空间层 {g, gg}
  const gg = makeTextNode('gg');
  const g = makeTextNode('g', [gg]);
  const c = makeTextNode('c', [g]);
  const f = framed(makeTextNode('f', [c]), 1);
  const z = makeTextNode('z');
  const doc = makeTextNode('doc', [f, z]);

  it('frameLayerOf：最近成框祖先定层级；框根自身不受自己管辖；框外为 null', () => {
    expect(frameLayerOf(doc, c.id)).toEqual({ frameId: f.id, layer: 'outline' });
    expect(frameLayerOf(doc, g.id)).toEqual({ frameId: f.id, layer: 'spatial' });
    expect(frameLayerOf(doc, gg.id)).toEqual({ frameId: f.id, layer: 'spatial' });
    expect(frameLayerOf(doc, f.id)).toBeNull();
    expect(frameLayerOf(doc, z.id)).toBeNull();
  });

  it('进/出大纲层 → 拦（大纲→空间、空间→大纲、出框、进框）', () => {
    expect(crossesFrameDepthBoundary(doc, c.id, g.id)).toBe(true); // 大纲行 → 挂到空间层节点（相对深度 >depth）
    expect(crossesFrameDepthBoundary(doc, g.id, f.id)).toBe(true); // 空间层 → 挂回框根之下（回到大纲层）
    expect(crossesFrameDepthBoundary(doc, c.id, z.id)).toBe(true); // 移出框（出大纲层）
    expect(crossesFrameDepthBoundary(doc, z.id, f.id)).toBe(true); // 移成框根的直接孩子（进大纲层，d=1）
  });

  it('同层改层级 → 放行（大纲内重排 / 空间层内排序 / 进/出空间层不跨 depth 边界）', () => {
    expect(crossesFrameDepthBoundary(doc, c.id, f.id)).toBe(false); // 大纲内：c → f 之下（d=1）
    expect(crossesFrameDepthBoundary(doc, gg.id, g.id)).toBe(false); // 空间层内
    expect(crossesFrameDepthBoundary(doc, z.id, g.id)).toBe(false); // 框外 → 空间层（不过 depth 线）
    expect(crossesFrameDepthBoundary(doc, z.id, c.id)).toBe(false); // 框外 → 挂点行之下（d=2 > depth，仍空间层）
  });

  it('无框文档 / 节点不在树内 → 恒放行（交给既有 op 校验）', () => {
    const plain = makeTextNode('a', [makeTextNode('b')]);
    const b = at(plain.children, 0);
    expect(frameLayerOf(plain, b.id)).toBeNull();
    expect(crossesFrameDepthBoundary(plain, b.id, plain.id)).toBe(false);
    expect(crossesFrameDepthBoundary(doc, 'missing', z.id)).toBe(false);
  });
});

// ---------- 断言辅助（减少重复算式；不参与被测语义） ----------

/** 从岛盒表取盒（缺 → 夹具错误） */
function boxOfKeys(boxes: Map<string, Box>, id: string): Box {
  const b = boxes.get(id);
  if (b === undefined) throw new Error(`夹具错误：岛缺行 ${id}`);
  return b;
}

type Island = ReturnType<typeof layoutFrameIsland>;
function islandRowRight(island: Island, id: string): number {
  const b = boxOfKeys(island.boxes, id);
  return b.x + b.w;
}
function islandRowLeft(island: Island, id: string): number {
  return boxOfKeys(island.boxes, id).x;
}
function islandRowBottom(island: Island, id: string): number {
  const b = boxOfKeys(island.boxes, id);
  return b.y + b.h;
}
function islandRowCenterY(island: Island, id: string): number {
  const b = boxOfKeys(island.boxes, id);
  return b.y + b.h / 2;
}
