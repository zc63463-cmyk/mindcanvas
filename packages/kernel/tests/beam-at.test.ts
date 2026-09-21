/**
 * 共享梁比例位 `note.beamAt`（双把手 · B1 几何）：梁在「父出边 ↔ 最近子入边」
 * 空隙中的**比例位**（0..1，缺省 0.5 = 今日中点）。
 *
 * 契约（设计 docs/specs/2026-09-17-beam-dual-handle-design.md §2/§4.4）：
 * - 缺省 0.5 ≡ 今日中点公式（旧文档逐位兼容，回归钉）
 * - 有 beamAt：rail = 父出边 + (子入边 − 父出边) × at
 * - 非法值 / 数字串走与 lens 同纪律的容错收敛；PAD 钳制不让 trunk/stub 塌到 0
 * - 梁位偏移**不动任何节点盒**（子节点与无 beamAt 时逐值相等）
 * - 森林岛内重建同源（islandLinks 经 linkGeometry 消费同一公式，不再写死中点）
 */
import { describe, expect, it } from 'vitest';
import {
  BEAM_AT_PAD,
  beamRailBetween,
  clampBeamAt,
  readBeamAt,
  readBeamAtMap,
} from '../src/layout/beamSide.js';
import { layoutMindmapBranched } from '../src/layout/branching.js';
import { layoutForest } from '../src/layout/forest.js';
import type { GrowDir, LayoutResult } from '../src/layout/mindmap.js';
import { parseMm } from '../src/protocol/parser.js';
import { serializeMm, verifyRoundTrip } from '../src/protocol/serializer.js';
import type { MindNode } from '../src/protocol/types.js';
import { makeTextNode, type EditableNode } from '../src/tree/treeOps.js';

/** 定长度量（可复现）：宽随文本长度，高固定 */
const measure = (n: EditableNode) => ({ w: (n.text?.length ?? 1) * 10 + 20, h: 30 });

/**
 * 上向枢纽夹具：根 → 枢纽（可带 lens/beamAt）→ n 个显式 `dir: 'up'` 的上子。
 * 枢纽自身不声明方向（锚定基线）——上组由子节点显式声明成立，正是用户摩擦场景。
 */
function upHubFixture(parentNote: Record<string, unknown> = {}, kidCount = 3) {
  const kids = Array.from({ length: kidCount }, (_, i) => ({
    ...makeTextNode(`上子${i + 1}`),
    note: { dir: 'up' as GrowDir },
  }));
  const hub: EditableNode = { ...makeTextNode('枢纽', kids), note: { ...parentNote } };
  const root = makeTextNode('根', [hub]);
  return { root, hub, kids };
}

/** hub 右向枢纽夹具（覆盖 left/right 竖梁的换轴镜像） */
function rightHubFixture(parentNote: Record<string, unknown> = {}) {
  const kids = Array.from({ length: 3 }, (_, i) => ({
    ...makeTextNode(`右子${i + 1}`),
    note: { dir: 'right' as GrowDir },
  }));
  const hub: EditableNode = {
    ...makeTextNode('枢纽', kids),
    note: { hub: true, ...parentNote },
  };
  return { root: makeTextNode('根', [hub]), hub, kids };
}

function boxOf(res: LayoutResult, node: EditableNode) {
  const ln = res.nodes.find((n) => n.node.id === node.id);
  if (!ln) throw new Error(`节点「${node.text}」不在布局结果中`);
  return ln.box;
}

function pathTo(res: LayoutResult, toId: string): string {
  const l = res.links.find((x) => x.toId === toId);
  if (!l) throw new Error('连线缺失');
  return String(l.path);
}

/** 方向组最近子入边（与 beamYUp/beamYDown/beamXLeft/beamXRight 同判据） */
function childEdgeOf(res: LayoutResult, parent: EditableNode, dir: GrowDir): number {
  const boxes = parent.children.map((c) => boxOf(res, c));
  if (dir === 'up') return Math.max(...boxes.map((b) => b.y + b.h));
  if (dir === 'down') return Math.min(...boxes.map((b) => b.y));
  if (dir === 'right') return Math.min(...boxes.map((b) => b.x));
  return Math.max(...boxes.map((b) => b.x + b.w));
}

/** 父出边（与 beamYUp/beamYDown/beamXLeft/beamXRight 同判据） */
function parentEdgeOf(res: LayoutResult, parent: EditableNode, dir: GrowDir): number {
  const b = boxOf(res, parent);
  if (dir === 'up') return b.y;
  if (dir === 'down') return b.y + b.h;
  if (dir === 'right') return b.x + b.w;
  return b.x;
}

/**
 * 从正交梁线 path 提取梁坐标：Q 控制点 = 轴对齐折线的拐角，梁线段两端拐角同值。
 * 无横段（父中线 === 子中线 → 退化为直线）返回 null——该连线没有「梁」可谈。
 */
function railOfPath(path: string, dir: GrowDir): number | null {
  const qs = [...path.matchAll(/Q\s+(-?[\d.]+)\s+(-?[\d.]+)/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
  }));
  if (qs.length === 0) return null;
  const vertical = dir === 'up' || dir === 'down';
  const vals = [...new Set(qs.map((q) => (vertical ? q.y : q.x)))];
  const first = vals[0];
  if (vals.length !== 1 || first === undefined) throw new Error(`梁线拐角不在同一梁位：${path}`);
  return first;
}

/** 组内带横段的梁位集合（中间子上行直线：父中线 = 子中线，无横段可取样） */
function railsOfGroup(res: LayoutResult, kids: readonly EditableNode[], dir: GrowDir): number[] {
  return kids
    .map((k) => railOfPath(pathTo(res, k.id), dir))
    .filter((r): r is number => r !== null);
}

describe('readBeamAt / 钳制（与 lens 同纪律的容错收敛）', () => {
  it('缺省 / 数字串 / 内联 JSON / 宽松流式串 → 同值', () => {
    expect(readBeamAt(undefined, 'up', 100)).toBe(0.5);
    expect(readBeamAt({ beamAt: { up: 0.75 } }, 'up', 100)).toBe(0.75);
    expect(readBeamAt({ beamAt: { up: '0.25' } }, 'up', 100)).toBe(0.25);
    expect(readBeamAt({ beamAt: '{"up":0.3}' }, 'up', 100)).toBeCloseTo(0.3, 10);
    expect(readBeamAt({ beamAt: '{up: 0.8}' }, 'up', 100)).toBeCloseTo(0.8, 10);
    // 方向键缺省 → 0.5（其余方向不影响本方向）
    expect(readBeamAt({ beamAt: { down: 0.2 } }, 'up', 100)).toBe(0.5);
  });

  it('非法值回落 0.5；越界值被 PAD 钳回', () => {
    expect(readBeamAt({ beamAt: { up: 'abc' } }, 'up', 100)).toBe(0.5);
    expect(readBeamAt({ beamAt: { up: true } }, 'up', 100)).toBe(0.5);
    expect(readBeamAt({ beamAt: { up: 1.5 } }, 'up', 100)).toBeCloseTo(1 - BEAM_AT_PAD / 100, 10);
    expect(readBeamAt({ beamAt: { up: -2 } }, 'up', 100)).toBeCloseTo(BEAM_AT_PAD / 100, 10);
    expect(readBeamAtMap({ beamAt: { up: 0.2, down: 'x', side: 0.9 } })).toEqual({ up: 0.2 });
    expect(readBeamAtMap({ beamAt: 'nope' })).toBeNull();
  });

  it('钳制：PAD 护栏（trunk/stub 不塌到 0）；空隙装不下两侧垫 → 锁 0.5', () => {
    expect(clampBeamAt(0.5, 100)).toBe(0.5);
    expect(clampBeamAt(0.9, 100)).toBe(0.9);
    expect(clampBeamAt(0.01, 100)).toBe(BEAM_AT_PAD / 100);
    expect(clampBeamAt(0.99, 100)).toBe(1 - BEAM_AT_PAD / 100);
    expect(clampBeamAt(0.2, BEAM_AT_PAD * 2 - 2)).toBe(0.5); // gap < 2×PAD
    expect(clampBeamAt(Number.NaN, 100)).toBe(0.5);
  });
});

describe('beamRailBetween：缺省逐位兼容（回归钉）', () => {
  it('at = 0.5 → 与旧中点公式**逐位**相等（严格 ===，非容差）', () => {
    const cases: Array<[number, number]> = [
      [0, 100],
      [100, 40],
      [-20, 140],
      [12.5, 87.5],
      [123.75, 456.25],
      [0.1, 0.3],
    ];
    for (const [p, c] of cases) {
      expect(beamRailBetween(p, c, 0.5)).toBe((p + c) / 2);
    }
  });

  it('at = 0.75 → 落在父→子 3/4 处（容差）', () => {
    expect(beamRailBetween(100, 200, 0.75)).toBeCloseTo(175, 10);
    expect(beamRailBetween(100, 0, 0.75)).toBeCloseTo(25, 10); // 反向（left/up）同式
    expect(beamRailBetween(100, 200, 0)).toBe(100);
    expect(beamRailBetween(100, 200, 1)).toBe(200);
  });
});

describe('布局 · up 组梁位吃 beamAt（旧文档零变更）', () => {
  // 宽空隙（lens.up = 96）：默认候选离两侧盒边足够远 → 避障不介入，梁位 = 公式值。
  // 默认空隙（V_GAP = 14）下 PAD 钳制 + 避障采样会把梁推离极端比例（属设计 §8 已知风险）。

  it('★ 回归钉：无 beamAt → 梁位 = 中点（与改前公式逐位相等）', () => {
    const { root, hub, kids } = upHubFixture({ lens: { up: 96 } });
    const res = layoutMindmapBranched(root, measure, new Set());
    const pEdge = parentEdgeOf(res, hub, 'up');
    const cEdge = childEdgeOf(res, hub, 'up');
    const expected = (pEdge + cEdge) / 2; // 改前 beamYUp 的字面公式
    const rails = railsOfGroup(res, kids, 'up');
    expect(rails.length).toBeGreaterThanOrEqual(2); // 至少两侧子有横段
    for (const r of rails) expect(r).toBe(expected);
  });

  it('★ beamAt.up = 0.75 → |父顶 − 梁| / gap = 0.75（容差内）', () => {
    const { root, hub, kids } = upHubFixture({ beamAt: { up: 0.75 }, lens: { up: 96 } });
    const res = layoutMindmapBranched(root, measure, new Set());
    const pEdge = parentEdgeOf(res, hub, 'up');
    const cEdge = childEdgeOf(res, hub, 'up');
    const gap = Math.abs(cEdge - pEdge);
    const rails = railsOfGroup(res, kids, 'up');
    expect(rails.length).toBeGreaterThanOrEqual(2);
    // 同组多个子节点共用同一条梁，且落在 3/4 处
    for (const r of rails) {
      expect(Math.abs(r - pEdge) / gap).toBeCloseTo(0.75, 6);
    }
  });

  it('★ 梁位偏移不动任何节点盒（子盒与无 beamAt 逐值相等）', () => {
    const plain = upHubFixture({ lens: { up: 96 } });
    const biased = upHubFixture({ beamAt: { up: 0.75 }, lens: { up: 96 } });
    const a = layoutMindmapBranched(plain.root, measure, new Set());
    const b = layoutMindmapBranched(biased.root, measure, new Set());
    // 两次夹具的节点 id 不同 → 按文本比对（文本唯一）
    const byText = (r: LayoutResult) =>
      r.nodes.map((n) => ({ text: n.node.text, ...n.box }));
    expect(byText(b)).toEqual(byText(a));
    expect(b.links.length).toBe(a.links.length);
  });

  it('极端 beamAt 仍被 PAD 钳制（不贴父边 / 不贴子边）', () => {
    for (const at of [0.999, -1]) {
      const { root, hub, kids } = upHubFixture({ beamAt: { up: at }, lens: { up: 96 } });
      const res = layoutMindmapBranched(root, measure, new Set());
      const pEdge = parentEdgeOf(res, hub, 'up');
      const cEdge = childEdgeOf(res, hub, 'up');
      const rails = railsOfGroup(res, kids, 'up');
      expect(rails.length).toBeGreaterThanOrEqual(2);
      // 梁位恒在父/子两边之间，且与两边各留 ≥ PAD（up 方向：子边在上、父边在下）
      for (const rail of rails) {
        expect(rail).toBeGreaterThanOrEqual(Math.min(pEdge, cEdge) + BEAM_AT_PAD - 1e-9);
        expect(rail).toBeLessThanOrEqual(Math.max(pEdge, cEdge) - BEAM_AT_PAD + 1e-9);
      }
    }
  });
});

describe('布局 · hub 左右组竖梁吃 beamAt（换轴镜像）', () => {
  it('★ 无 beamAt → 竖梁 = 中点；beamAt.right = 0.75 → 靠子侧 3/4', () => {
    const plain = rightHubFixture();
    const plainRes = layoutMindmapBranched(plain.root, measure, new Set());
    const pEdge = parentEdgeOf(plainRes, plain.hub, 'right');
    const cEdge = childEdgeOf(plainRes, plain.hub, 'right');
    // 默认空隙 H_GAP = 64：默认候选干净 → 逐值 = 中点
    const plainRails = railsOfGroup(plainRes, plain.kids, 'right');
    expect(plainRails.length).toBeGreaterThanOrEqual(2);
    for (const r of plainRails) expect(r).toBe((pEdge + cEdge) / 2);

    const biased = rightHubFixture({ beamAt: { right: 0.75 } });
    const biasedRes = layoutMindmapBranched(biased.root, measure, new Set());
    const bp = parentEdgeOf(biasedRes, biased.hub, 'right');
    const bc = childEdgeOf(biasedRes, biased.hub, 'right');
    const rails = railsOfGroup(biasedRes, biased.kids, 'right');
    expect(rails.length).toBeGreaterThanOrEqual(2);
    for (const rail of rails) {
      expect(Math.abs(rail - bp) / Math.abs(bc - bp)).toBeCloseTo(0.75, 6);
    }
  });
});

describe('布局 · 森林岛重建同源（islandLinks 不再写死中点）', () => {
  it('★ 岛内 up 组 beamAt 生效（平移后仍按比例）', () => {
    const { root, hub, kids } = upHubFixture({ beamAt: { up: 0.75 }, lens: { up: 96 } });
    const res = layoutForest([{ node: root, dir: 'right', pos: { x: 0, y: 0 } }], measure, new Set());
    const pEdge = parentEdgeOf(res, hub, 'up');
    const cEdge = childEdgeOf(res, hub, 'up');
    const rails = railsOfGroup(res, kids, 'up');
    expect(rails.length).toBeGreaterThanOrEqual(2);
    for (const rail of rails) {
      expect(Math.abs(rail - pEdge) / Math.abs(cEdge - pEdge)).toBeCloseTo(0.75, 6);
    }
  });
});

/**
 * 协议往返（B3）：`beamAt` 是普通 note 键——parser / serializer **零特殊分支**
 * （前向兼容透传铁律），读写收敛全在读侧（readBeamAt / readBeamAtMap）。
 */
describe('协议：beamAt 往返（parse → serialize → parse）', () => {
  const SRC = [
    '# 根',
    '',
    '<!--',
    'beamAt: {"up": 0.72, "down": "0.3"}',
    'lens: {"up": 96}',
    '-->',
    '',
    '## 甲',
    '',
  ].join('\n');

  /** 解析 → 根（root 可为 null：显式抛，避免非空断言） */
  const rootOf = (text: string): MindNode => {
    const root = parseMm(text).root;
    if (root === null) throw new Error('夹具解析失败：root 为 null');
    return root;
  };

  /** 笔记块归属其后的结构节点（协议 §2.1）：本文档 → 甲 */
  const noteOfJia = (text: string): unknown => {
    const jia = rootOf(text).children.find((c) => c.text === '甲');
    if (jia === undefined) throw new Error('夹具缺失节点「甲」');
    return jia.note;
  };

  it('★ 往返：数值等价（数字串容错同 lens）；安全闸 verifyRoundTrip 不误报', () => {
    const first = rootOf(SRC);
    const out = serializeMm(first);
    expect(out).toContain('beamAt:');
    expect(out).toContain('lens:');
    // 第二跳：字符串形态 → 读侧收敛为同一数值映射
    expect(readBeamAtMap(noteOfJia(out))).toEqual({ up: 0.72, down: 0.3 });
    expect(verifyRoundTrip(first)).toBe(true);
    expect(verifyRoundTrip(rootOf(out))).toBe(true);
  });

  it('★ 手写 beamAt: 0.5 原样透传（丢键是**写侧**纪律，不是序列化器职责）', () => {
    const src = ['# 根', '', '<!--', 'beamAt: {"up": 0.5}', '-->', '', '## 甲', ''].join('\n');
    const out = serializeMm(rootOf(src));
    expect(out).toContain('beamAt');
    expect(readBeamAt(noteOfJia(out), 'up', 96)).toBe(0.5);
  });

  it('读侧对未知方向键/宿主标量容错（与 lens 同纪律）', () => {
    const src = [
      '# 根',
      '',
      '<!--',
      'beamAt: {"up": 1.4, "side": 0.2}',
      '-->',
      '',
      '## 甲',
      '',
    ].join('\n');
    const note = noteOfJia(serializeMm(rootOf(src)));
    expect(readBeamAtMap(note)).toEqual({ up: 1.4 }); // 未知方向键忽略
    expect(readBeamAt(note, 'up', 96)).toBeCloseTo(1 - BEAM_AT_PAD / 96, 10); // 越界 → PAD 钳回
  });
});
