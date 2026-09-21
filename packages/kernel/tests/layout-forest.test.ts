/**
 * G6′ 森林布局（layoutForest）：多中心各自局部布局 → 按坐标平移 → 合并。
 *
 * 关键回归点：path 字符串内含绝对坐标，平移节点盒后**必须重建** links，
 * 否则连线会留在局部坐标原点（视觉上表现为一堆线堆在左上角）。
 */
import { describe, expect, it } from 'vitest';
import {
  GROW_DIR_LABEL,
  layoutForest,
  LAYOUT_KIND_BY_DIR,
  type CenterSpec,
  type GrowDir,
} from '../src/layout/forest.js';
import type { EditableNode } from '../src/tree/treeOps.js';

function t(id: string, children: EditableNode[] = []): EditableNode {
  return { id, type: 'text', text: id, children };
}

const measure = (): { w: number; h: number } => ({ w: 100, h: 30 });

const centerOf = (
  nodes: Array<{ node: EditableNode; box: { x: number; y: number; w: number; h: number } }>,
  id: string,
) => {
  const b = nodes.find((n) => n.node.id === id)?.box;
  return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : undefined;
};

const boxOf = (
  nodes: Array<{ node: EditableNode; box: { x: number; y: number; w: number; h: number } }>,
  id: string,
) => nodes.find((n) => n.node.id === id)?.box;

describe('layout/forest：基础', () => {
  it('空中心清单 → 空结果（bounds 不出现 Infinity）', () => {
    const r = layoutForest([], measure, new Set());
    expect(r.nodes).toEqual([]);
    expect(r.links).toEqual([]);
    expect(r.bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });

  it('单中心：中心节点中心精确落在 pos', () => {
    const r = layoutForest(
      [{ node: t('A', [t('a1'), t('a2')]), dir: 'right', pos: { x: 500, y: 300 } }],
      measure,
      new Set(),
    );
    const c = centerOf(r.nodes, 'A');
    expect(c?.x).toBeCloseTo(500, 6);
    expect(c?.y).toBeCloseTo(300, 6);
  });

  it('多中心：各中心各自归位，互不干扰', () => {
    const r = layoutForest(
      [
        { node: t('A', [t('a1')]), dir: 'right', pos: { x: 0, y: 0 } },
        { node: t('B', [t('b1')]), dir: 'down', pos: { x: 800, y: 200 } },
      ],
      measure,
      new Set(),
    );
    expect(centerOf(r.nodes, 'A')?.x).toBeCloseTo(0, 6);
    expect(centerOf(r.nodes, 'B')?.x).toBeCloseTo(800, 6);
    expect(centerOf(r.nodes, 'B')?.y).toBeCloseTo(200, 6);
    expect(r.nodes).toHaveLength(4);
  });
});

describe('layout/forest：四向生长', () => {
  const one = (dir: GrowDir) =>
    layoutForest([{ node: t('R', [t('c')]), dir, pos: { x: 0, y: 0 } }], measure, new Set());

  it('right：子树在中心右侧', () => {
    const r = one('right');
    expect(boxOf(r.nodes, 'c')!.x).toBeGreaterThan(boxOf(r.nodes, 'R')!.x);
  });

  it('left：子树在中心左侧', () => {
    const r = one('left');
    expect(boxOf(r.nodes, 'c')!.x).toBeLessThan(boxOf(r.nodes, 'R')!.x);
  });

  it('down：子树在中心下方', () => {
    const r = one('down');
    expect(boxOf(r.nodes, 'c')!.y).toBeGreaterThan(boxOf(r.nodes, 'R')!.y);
  });

  it('up：子树在中心上方', () => {
    const r = one('up');
    expect(boxOf(r.nodes, 'c')!.y).toBeLessThan(boxOf(r.nodes, 'R')!.y);
  });

  it('四向均有连线且数量 = 节点数 - 1', () => {
    for (const dir of ['right', 'left', 'down', 'up'] as GrowDir[]) {
      const r = one(dir);
      expect(r.links, dir).toHaveLength(1);
    }
  });

  it('方向 → 布局类型映射完整（UI 复用同一套）', () => {
    expect(LAYOUT_KIND_BY_DIR.right).toBe('logic-right');
    expect(LAYOUT_KIND_BY_DIR.left).toBe('logic-left');
    expect(LAYOUT_KIND_BY_DIR.down).toBe('org');
    expect(LAYOUT_KIND_BY_DIR.up).toBe('org-up');
    expect(Object.keys(GROW_DIR_LABEL)).toHaveLength(4);
  });
});

describe('layout/forest：自动排列（无 pos）', () => {
  it('两中心无 pos → 横向排开且不重叠', () => {
    const r = layoutForest(
      [
        { node: t('A', [t('a1'), t('a2')]), dir: 'down' },
        { node: t('B', [t('b1'), t('b2')]), dir: 'down' },
      ],
      measure,
      new Set(),
      { gap: 100 },
    );
    const aNodes = r.nodes.filter((n) => n.node.id === 'A' || n.node.id.startsWith('a'));
    const bNodes = r.nodes.filter((n) => n.node.id === 'B' || n.node.id.startsWith('b'));
    const aMaxX = Math.max(...aNodes.map((n) => n.box.x + n.box.w));
    const bMinX = Math.min(...bNodes.map((n) => n.box.x));
    expect(bMinX).toBeGreaterThanOrEqual(aMaxX);
  });

  it('混排：有 pos 的按 pos，无 pos 的从原点起排', () => {
    const r = layoutForest(
      [
        { node: t('A', [t('a1')]), dir: 'right' },
        { node: t('B', [t('b1')]), dir: 'right', pos: { x: 5000, y: 0 } },
      ],
      measure,
      new Set(),
    );
    expect(centerOf(r.nodes, 'B')?.x).toBeCloseTo(5000, 6);
  });

  it('★ 左生长岛：后续岛按真实 bounds 错开，前岛左翼不被压（四向生长引入的跨岛重叠）', () => {
    // dir=left 的岛，子树整体伸到「根中心」左侧；若只按宽度 cursorX += w 顺排，
    // 下一个岛的左翼会压进前一个岛。
    const r = layoutForest(
      [
        { node: t('A', [t('甲1', [t('甲1a', [t('甲1b')])]), t('甲2'), t('甲3')]), dir: 'left' },
        { node: t('B', [t('乙1')]), dir: 'left' },
      ],
      measure,
      new Set(),
      { gap: 100 },
    );
    const of = (pred: (id: string) => boolean) =>
      r.nodes.filter((n) => pred(n.node.id)).map((n) => n.box);
    const aBoxes = of((id) => id.startsWith('甲') || id === 'A');
    const bBoxes = of((id) => id.startsWith('乙') || id === 'B');
    const aMax = Math.max(...aBoxes.map((b) => b.x + b.w));
    const bMin = Math.min(...bBoxes.map((b) => b.x));
    expect(bMin).toBeGreaterThanOrEqual(aMax);
    expect(bMin - aMax).toBeCloseTo(100, 6); // gap 精确生效
  });
});

describe('layout/forest：连线随节点平移（最易错点）', () => {
  it('★ 平移后 links 的 path 使用世界坐标，而非局部原点', () => {
    const r = layoutForest(
      [{ node: t('A', [t('a1')]), dir: 'right', pos: { x: 1000, y: 700 } }],
      measure,
      new Set(),
    );
    const root = boxOf(r.nodes, 'A')!;
    const link = r.links[0]!;
    // bezierLink 起点 = 父右缘中点（right 方向）
    const m = /^M ([-\d.]+) ([-\d.]+)/.exec(link.path);
    expect(m).not.toBeNull();
    expect(Number(m?.[1])).toBeCloseTo(root.x + root.w, 6);
    expect(Number(m?.[2])).toBeCloseTo(root.y + root.h / 2, 6);
  });

  it('★ 若只平移 box 而忘了重建 links，起点会停在原点（反例守卫）', () => {
    const r = layoutForest(
      [{ node: t('A', [t('a1')]), dir: 'right', pos: { x: 1000, y: 700 } }],
      measure,
      new Set(),
    );
    const m = /^M ([-\d.]+) /.exec(r.links[0]!.path);
    // 起点应远离 0（已平移到 1000+），而不是留在局部坐标的 50 附近
    expect(Number(m?.[1])).toBeGreaterThan(500);
  });

  it('向下生长时连线走 orgBeam（正交折线，非贝塞尔）', () => {
    const r = layoutForest(
      [{ node: t('A', [t('a1')]), dir: 'down', pos: { x: 0, y: 0 } }],
      measure,
      new Set(),
    );
    const root = boxOf(r.nodes, 'A')!;
    const m = /^M ([-\d.]+) ([-\d.]+)/.exec(r.links[0]!.path);
    // orgBeamLink 起点 = 父底边中点
    expect(Number(m?.[1])).toBeCloseTo(root.x + root.w / 2, 6);
    expect(Number(m?.[2])).toBeCloseTo(root.y + root.h, 6);
  });
});

/**
 * 岛内连线选型（v1.8.x 修复）。
 *
 * 森林重建岛内连线时曾一律套用「岛方向」的构建器（右岛 → 全岛贝塞尔），岛内子节点的
 * **有效生长方向**与 hub 标记全被丢掉：up/down 共享梁、hub 共享竖梁在内核几何里都不存在。
 * 渲染端自己按 dir/hub 重建，于是「内核挑的线」与「屏幕上的线」不是同一条（岛文档全量失配）。
 * 修复后：岛内连线与岛外同一族（linkGeometry：子节点有效方向 + hub）。
 */
describe('layout/forest：岛内连线按子节点有效方向 / hub 选线型（v1.8.x 修复）', () => {
  const withNote = (
    id: string,
    note: Record<string, unknown>,
    children: EditableNode[] = [],
  ): EditableNode => ({ id, type: 'text', text: id, children, note });

  it('★ 岛内 up 子节点走共享梁（正交折线），而不是「岛方向」的贝塞尔', () => {
    const root = withNote('A', { dir: 'right' }, [withNote('上子', { dir: 'up' })]);
    const r = layoutForest(
      [{ node: root, dir: 'right', pos: { x: 0, y: 0 } }],
      measure,
      new Set(),
    );
    const link = r.links.find((l) => l.toId === '上子');
    expect(link).toBeDefined();
    expect(link!.path).not.toContain('C');
  });

  it('★ 岛内 hub 节点的左右组走共享竖梁（字符串 "true" 同样生效）', () => {
    const hub = withNote('枢纽', { dir: 'right', hub: 'true' }, [
      withNote('右子', { dir: 'right' }),
    ]);
    const root = withNote('A', { dir: 'right' }, [hub]);
    const r = layoutForest(
      [{ node: root, dir: 'right', pos: { x: 0, y: 0 } }],
      measure,
      new Set(),
    );
    const link = r.links.find((l) => l.toId === '右子');
    expect(link).toBeDefined();
    expect(link!.path).not.toContain('C');
  });

  it('回归：经典岛（无 dir 声明）仍按岛方向出线（right 岛 → 贝塞尔）', () => {
    const r = layoutForest(
      [{ node: t('A', [t('a1')]), dir: 'right', pos: { x: 0, y: 0 } }],
      measure,
      new Set(),
    );
    expect(r.links[0]!.path).toContain('C');
  });
});
