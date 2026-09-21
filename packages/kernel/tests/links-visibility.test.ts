import { describe, expect, it } from 'vitest';
import type { Box } from '../src/layout/mindmap.js';
import { filterVisibleLinks } from '../src/layout/cull.js';

describe('filterVisibleLinks：父子连线端点可见性过滤（任一入视口则渲染）', () => {
  // 构造辅助：LinkGeometry 最小子集（含 fromId/toId）
  type TestLink = { fromId: string; toId: string; path: string; depth: number };
  const mkLink = (fromId: string, toId: string): TestLink => ({
    fromId,
    toId,
    path: `M 0 0 L 10 10`,
    depth: 0,
  });

  it('1. 两端都在视口内 → 保留', () => {
    // view: 世界坐标 [-100,-100] 宽 1200 高 900 → 可视范围 [-100,1100] x [-100,800]
    const view = { x: -100, y: -100, w: 1200, h: 900 };
    const nodesById = new Map<string, Box>([
      ['a', { x: 0, y: 0, w: 80, h: 40 }], // 完全在 view 内
      ['b', { x: 100, y: 0, w: 80, h: 40 }], // 完全在 view 内
    ]);
    const links = [mkLink('a', 'b')];
    const result = filterVisibleLinks(links, nodesById, view, 90);
    expect(result).toHaveLength(1);
    expect(result[0].fromId).toBe('a');
    expect(result[0].toId).toBe('b');
  });

  it('2. 一端在视口内、一端在视口外 → 保留', () => {
    // 与 relGeos 规则一致：连接到屏幕外节点的线仍应画到屏幕边缘
    const view = { x: -100, y: -100, w: 1200, h: 900 };
    const nodesById = new Map<string, Box>([
      ['a', { x: 0, y: 0, w: 80, h: 40 }], // 在视口内
      ['b', { x: 5000, y: 0, w: 80, h: 40 }], // 远在视口外（+1000px 以上）
    ]);
    const links = [mkLink('a', 'b')];
    const result = filterVisibleLinks(links, nodesById, view, 90);
    expect(result).toHaveLength(1);
  });

  it('3. 两端都在视口外（+1000px 远离）→ 剔除', () => {
    const view = { x: -100, y: -100, w: 1200, h: 900 };
    const nodesById = new Map<string, Box>([
      ['a', { x: 5000, y: 0, w: 80, h: 40 }], // 远在视口外
      ['b', { x: 5200, y: 0, w: 80, h: 40 }], // 远在视口外
    ]);
    const links = [mkLink('a', 'b')];
    const result = filterVisibleLinks(links, nodesById, view, 90);
    expect(result).toHaveLength(0);
  });

  it('4. margin 90 生效：距边缘 50px → 保留；距边缘 200px → 剔除', () => {
    // view: [0, 0] - [1000, 800]，margin=90
    const view = { x: 0, y: 0, w: 1000, h: 800 };
    const nodesById = new Map<string, Box>([
      // from 距视口右边缘 50px（x+w = 1000-50 = 950，在 margin 90 内）
      ['near', { x: 950 - 80, y: 100, w: 80, h: 40 }],
      // to 完全在视口内
      ['in', { x: 100, y: 100, w: 80, h: 40 }],
      // from 距视口右边缘 200px（x = 1000 + 200 = 1200，超出 margin 90）
      ['far', { x: 1200, y: 100, w: 80, h: 40 }],
    ]);
    const linkNear = mkLink('near', 'in'); // 一端 near 在 margin 内 → 保留
    const linkFar = mkLink('far', 'in'); // 两端：far 超出 margin，in 在内 → 一端在内 → 保留
    // 再加一个两端都远的（200px 外）
    const linkBothFar = mkLink('far', 'faraway');
    nodesById.set('faraway', { x: 1500, y: 100, w: 80, h: 40 });

    // 先测试 near-in：near 在右边缘 -50px（x=870~950），距 1000 边缘 50px < margin 90 → 可见
    const r1 = filterVisibleLinks([linkNear], nodesById, view, 90);
    expect(r1).toHaveLength(1);

    // 再测试 far-in：far 在 1200~1280（距 1000 边缘 200px > margin 90），但 in 在视口内
    // 任一端在内 → 保留
    const r2 = filterVisibleLinks([linkFar], nodesById, view, 90);
    expect(r2).toHaveLength(1);

    // 最后测试 far-faraway：两端都 > margin 90 外 → 剔除
    const r3 = filterVisibleLinks([linkBothFar], nodesById, view, 90);
    expect(r3).toHaveLength(0);
  });
});
