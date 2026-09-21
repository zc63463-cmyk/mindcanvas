import { describe, expect, it } from 'vitest';
import { layoutMindmap } from '../src/layout/mindmap.js';
import { layoutFishbone, layoutOrg, layoutTimeline } from '../src/layout/layouts.js';
import type { EditableNode } from '../src/tree/treeOps.js';

function t(id: string, children: EditableNode[] = []): EditableNode {
  return { id, type: 'text', text: id, children };
}
const measure = (): { w: number; h: number } => ({ w: 100, h: 30 });
function fixture(): EditableNode {
  return t('r', [t('a', [t('a1'), t('a2')]), t('b', [t('b1')])]);
}

/** 解析 SVG path 端点/控制点/中点（支持 M…C… 格式） */
function bezierMid(d: string): {
  x: number;
  y: number;
  sx: number;
  sy: number;
  ex: number;
  ey: number;
  c1x: number;
  c1y: number;
} {
  const m = d.match(
    /^M ([\d.-]+) ([\d.-]+) C ([\d.-]+) ([\d.-]+), ([\d.-]+) ([\d.-]+), ([\d.-]+) ([\d.-]+)$/,
  );
  if (!m) throw new Error(`无法解析 path: ${d}`);
  const [sx, sy, c1x, c1y, c2x, c2y, ex, ey] = m.slice(1).map(Number);
  const x = 0.125 * sx + 0.375 * c1x + 0.375 * c2x + 0.125 * ex;
  const y = 0.125 * sy + 0.375 * c1y + 0.375 * c2y + 0.125 * ey;
  return { x, y, sx, sy, ex, ey, c1x, c1y };
}

/** 提取 path 中全部点（含 Q 控制点，水平/垂直段检测适用） */
function pathPoints(d: string): Array<[number, number]> {
  const nums = d.match(/[-\d.]+/g)?.map(Number) ?? [];
  const pts: Array<[number, number]> = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  return pts;
}

/** path 中出现的全部水平段 y（相邻点同 y 且 x 变化），返回去重集合 */
function horizontalYs(d: string): number[] {
  const pts = pathPoints(d);
  const ys = new Set<number>();
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][1] === pts[i - 1][1] && pts[i][0] !== pts[i - 1][0]) ys.add(pts[i][1]);
  }
  return [...ys];
}

describe('links：基线布局（思维导图）父边不穿越节点', () => {
  it('端点贴父右缘/子左缘（链接顺序 = 前序收集）', () => {
    // 前序：r, a, a1, a2, b, b1 → links[0]=r→a, links[1]=a→a1, links[3]=r→b
    const r = layoutMindmap(fixture(), measure, new Set());
    const box = (id: string) => r.nodes.find((n) => n.node.id === id)!.box;
    const la = bezierMid(r.links[0].path);
    expect(la.sx).toBe(box('r').x + box('r').w);
    expect(la.sy).toBe(box('r').y + box('r').h / 2);
    expect(la.ex).toBe(box('a').x);
    expect(la.ey).toBe(box('a').y + box('a').h / 2);
  });

  it('紧凑贝塞尔：控制点 x 偏移 = 0.4 * 水平距离（curvature 归一化，弧高受控）', () => {
    const r = layoutMindmap(fixture(), measure, new Set());
    const la = bezierMid(r.links[0].path); // r→a，子居右（ex ≥ sx）
    const dx = (la.ex - la.sx) * 0.4;
    expect(la.c1x).toBeCloseTo(la.sx + dx, 5);
    expect(la.c1y).toBeCloseTo(la.sy + Math.abs(la.ey - la.sy) * 0.2, 5);
  });

  it('紧凑贝塞尔凸包守护：c1x 在端点 X 盒内、曲线中点 Y 在端点 Y 盒内（不扫过兄弟槽位）', () => {
    const r = layoutMindmap(fixture(), measure, new Set());
    for (let i = 0; i < r.links.length; i++) {
      const m = bezierMid(r.links[i].path);
      const loX = Math.min(m.sx, m.ex);
      const hiX = Math.max(m.sx, m.ex);
      const loY = Math.min(m.sy, m.ey);
      const hiY = Math.max(m.sy, m.ey);
      // 水平：curvature=0.4 保证 c1x 落在端点 X 区间内（线不横向穿越兄弟槽位）。
      expect(m.c1x).toBeGreaterThanOrEqual(loX);
      expect(m.c1x).toBeLessThanOrEqual(hiX);
      // 垂直：compactBezier 的 c1y = sy + 0.2*|Δy| 恒 ≥ sy，向上连线（ey<sy）时 c1y 会越出
      // 端点 Y 盒（如 a→a1），故约束改用曲线中点 m.y（0.125/0.375 加权）守护纵向不越界。
      expect(m.y).toBeGreaterThanOrEqual(loY);
      expect(m.y).toBeLessThanOrEqual(hiY);
    }
  });

  it('左向边（r→b，b 在根左侧）：起点贴父左缘、终点贴子右缘', () => {
    const r = layoutMindmap(fixture(), measure, new Set());
    const box = (id: string) => r.nodes.find((n) => n.node.id === id)!.box;
    expect(box('b').x + box('b').w).toBeLessThan(box('r').x); // 前置：b 确在左侧
    const lb = bezierMid(r.links[3].path); // links[3] = r→b
    // 左向：紧凑贝塞尔 dir=-1 → c1x = sx - 0.4*|Δx|；c1y = sy + 0.2*|Δy|
    expect(lb.c1x).toBeCloseTo(lb.sx - Math.abs(lb.sx - lb.ex) * 0.4, 5);
    expect(lb.c1y).toBeCloseTo(lb.sy + Math.abs(lb.ey - lb.sy) * 0.2, 5);
    expect(lb.sx).toBe(box('r').x);
    expect(lb.ex).toBe(box('b').x + box('b').w);
  });
});

describe('links：共享引擎端点贴边契约（timeline / fishbone）', () => {
  // timeline/fishbone 均为"子在父右侧"布局 → 父右缘 → 子左缘
  for (const [name, run] of [
    ['timeline', () => layoutTimeline(fixture(), measure, new Set())],
    ['fishbone', () => layoutFishbone(fixture(), measure, new Set())],
  ] as const) {
    it(`${name}：r→a 连线起点贴父右缘、终点贴子左缘`, () => {
      const r = run();
      const box = (id: string) => r.nodes.find((n) => n.node.id === id)!.box;
      const la = bezierMid(r.links[0].path); // links[0] = r→a（前序）
      expect(la.sx).toBe(box('r').x + box('r').w);
      expect(la.sy).toBe(box('r').y + box('r').h / 2);
      expect(la.ex).toBe(box('a').x);
      expect(la.ey).toBe(box('a').y + box('a').h / 2);
    });
  }
});

describe('links：org 组织图圆角正交梁线', () => {
  it('端点贴父底边中心/子顶边中心', () => {
    const r = layoutOrg(fixture(), measure, new Set());
    const box = (id: string) => r.nodes.find((n) => n.node.id === id)!.box;
    const la = pathPoints(r.links[0].path); // r→a
    const first = la[0];
    const last = la[la.length - 1];
    expect(first[0]).toBeCloseTo(box('r').x + box('r').w / 2);
    expect(first[1]).toBeCloseTo(box('r').y + box('r').h);
    expect(last[0]).toBeCloseTo(box('a').x + box('a').w / 2);
    expect(last[1]).toBeCloseTo(box('a').y);
  });

  it('同一父的多个子共享同一水平梁 y', () => {
    const r = layoutOrg(fixture(), measure, new Set());
    const y1 = horizontalYs(r.links[0].path); // r→a
    const y3 = horizontalYs(r.links[3].path); // r→b
    const shared = y1.filter((y) => y3.includes(y));
    expect(shared.length).toBeGreaterThan(0);
  });

  it('梁 y 位于根底边之下（不穿根盒）', () => {
    const r = layoutOrg(fixture(), measure, new Set());
    const rootBox = r.nodes.find((n) => n.node.id === 'r')!.box;
    const rootBottom = rootBox.y + rootBox.h;
    for (const link of r.links) {
      for (const y of horizontalYs(link.path)) {
        expect(y).toBeGreaterThan(rootBottom);
      }
    }
  });
});
