/**
 * P2-1 · 动画期路由降载（Edge-fast routing）。
 *
 * 问题：节点过渡动画期间 edgeBoxOf 逐帧返回插值盒 → FreeEdgeLayer 的 routes useMemo
 * 每帧全量重算：每条边走 routeAesthetic 避障枚举（E×锚点×曲率×采样×障碍）+ 末尾
 * findCrossings 交叉检测 O(E²×P²)。实测注释量级：100 边 ≈ 0.5s、400 边交叉 155ms。
 *
 * 降载策略（纯性能、无视觉持久影响，动画是瞬态）：
 * - `edgeObstaclesOf`：动画期/低 LOD 传空障碍集 → 路由自动走 S 形/直连快路径，成本 O(E)
 * - `applyLineJumps` 抽纯函数并由 fastRouting 门控：动画期跳过 O(E²) 交叉检测与跳线
 * 动画结束后回到全速路由（静态 identity 稳定，缓存常态命中）。
 */
import { describe, expect, it } from 'vitest';
import type { RouteResult } from '../src/render/edgeRouting.js';
import { applyLineJumps, pathWithJumps } from '../src/render/edgeRouting.js';
import { edgeObstaclesOf } from '../src/render/MapView.js';

const layout = {
  nodes: [
    { node: { id: 'a' }, box: { x: 0, y: 0, w: 50, h: 20 } },
    { node: { id: 'b' }, box: { x: 200, y: 0, w: 50, h: 20 } },
  ],
};

describe('edgeObstaclesOf：动画期/低 LOD 关闭避障', () => {
  it('动画中（animating）→ 空障碍（快路径直连）', () => {
    expect(edgeObstaclesOf(layout, 'full', true)).toEqual([]);
  });
  it('静止 + full → 全量障碍（含 id + box）', () => {
    const obs = edgeObstaclesOf(layout, 'full', false);
    expect(obs).toHaveLength(2);
    expect(obs[0]).toEqual({ id: 'a', box: { x: 0, y: 0, w: 50, h: 20 } });
  });
  it('静止 + detail/skeleton（低 LOD）→ 空（与既有行为一致）', () => {
    expect(edgeObstaclesOf(layout, 'detail', false)).toEqual([]);
    expect(edgeObstaclesOf(layout, 'skeleton', false)).toEqual([]);
  });
});

function mkRoute(points: { x: number; y: number }[]): RouteResult {
  return {
    d:
      `M ${points[0]!.x} ${points[0]!.y} ` +
      points
        .slice(1)
        .map((p) => `L ${p.x} ${p.y}`)
        .join(' '),
    points,
    routed: false,
    mid: points[1] ?? points[0]!,
    nx: 0,
    ny: -1,
  };
}

const diagPts = [
  { x: 0, y: 0 },
  { x: 150, y: 150 },
  { x: 300, y: 300 },
];

const antiDiagPts = [
  { x: 300, y: 0 },
  { x: 150, y: 200 }, // 拐点偏移，使与 \ 对角线的交叉落在两折线的线段中段（非共享拐点）
  { x: 0, y: 300 },
];

describe('applyLineJumps：跳线应用（fastRouting 门控的抽层）', () => {
  const wrap = (route: RouteResult) => ({ route });

  it('单条边 → 原 map（引用不变，零成本）', () => {
    const m = new Map([['e0', wrap(mkRoute(diagPts))]]);
    expect(applyLineJumps(m)).toBe(m);
  });
  it('不相交（平行）→ 原 map（引用不变，无交叉则零拷贝）', () => {
    const m = new Map([
      ['e0', wrap(mkRoute(diagPts))],
      ['e1', wrap(mkRoute(antiDiagPts.map((p) => ({ x: p.x, y: p.y + 300 }))))],
    ]);
    expect(applyLineJumps(m)).toBe(m);
  });
  it('对角线相交 → under 边注入折线跳（M/L-only，顶点增加），over 边保持', () => {
    const m = new Map([
      ['e0', wrap(mkRoute(diagPts))], // 先路由 → 下方
      ['e1', wrap(mkRoute(antiDiagPts))],
    ]);
    const out = applyLineJumps(m);
    const d0 = out.get('e0')!.route.d;
    const d1 = out.get('e1')!.route.d;
    // R5-1 断言口径变更（逐条对照见 commit message）：
    // ① d0 的旧判据 `toMatch(/C /)` 断的是「恰好产出 C 拱弧」这一实现细节；
    //    折线化后换形态判据——只含 M/L（不再含 C）。
    expect(d0).not.toContain('C');
    // ② 顶点数写死：3（输入）+ 4（enter / 抬升 / 平台端 / exit）= 7 个 M/L 指令。
    expect((d0.match(/[ML] /g) ?? []).length).toBe(7);
    // ③ d1 的旧负例 `not.toMatch(/C /)`（上方边不画跳线）折线化后【恒真】——
    //    守卫静默失效。换语义等价判据：与「输入点直出折线」逐字相等（未注入任何跳线顶点）。
    expect(d1).toBe(pathWithJumps(antiDiagPts, []));
  });
});