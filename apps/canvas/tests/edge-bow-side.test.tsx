// @vitest-environment jsdom
/**
 * R5-1 补：Opp 鼓向的**来源改为路由折线顶点**（`RouteResult.points`）。
 *
 * 为什么：`d` 可能含折线跳桥（pathWithJumps 注入 4 个顶点，rise/fall 离弦 = radius）——
 * 「直线 + 跳线」经字符串解析会被读成有侧（R5-1 形态漂移）；顶点不含跳线桥
 * （applyLineJumps 只改写 d、不改 points）→ 直线仍得 'auto'（Opp 落 right 兜底，
 * 与 R5-1 之前的行为一致）。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { astToEditable, makeTextNode } from '@mindcanvas/kernel';
import { EditorController, type EdgeRouteEntry } from '@mindcanvas/react';
import { useEdgeActions } from '../src/hooks/useEdgeActions.js';

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 16) as unknown as number,
  );
  vi.stubGlobal('cancelAnimationFrame', (h: number) => {
    clearTimeout(h);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function buildController(): EditorController {
  const built = astToEditable(makeTextNode('根', [makeTextNode('A'), makeTextNode('B')]));
  if (built === null) throw new Error('fixture broken');
  built.note = { edges: [{ from: 'node:根/A', to: 'node:根/B', rel: 'relates-to' }] };
  return new EditorController(built);
}

/** 两条边的夹具（e0/e1）——用于「换到尚未收到路由的边」的门控用例 */
function buildTwoEdgeController(): EditorController {
  const built = astToEditable(makeTextNode('根2', [makeTextNode('A'), makeTextNode('B')]));
  if (built === null) throw new Error('fixture broken');
  built.note = {
    edges: [
      { from: 'node:根2/A', to: 'node:根2/B', rel: 'relates-to' },
      { from: 'node:根2/B', to: 'node:根2/A', rel: 'blocks' },
    ],
  };
  return new EditorController(built);
}

function entry(points: Array<{ x: number; y: number }>, d: string): EdgeRouteEntry {
  const box = { x: 0, y: 0, w: 10, h: 10 };
  return {
    eps: { fromId: 'a', toId: 'b', from: box, to: box, ghost: false, renderable: true },
    route: { d, points, routed: false, mid: { x: 0, y: 0 }, nx: 0, ny: 0 },
  };
}

/** 直线 + 折线跳桥（pathWithJumps 产物形态）：字符串解析会读出 'right' */
const BRIDGED_STRAIGHT_D = 'M 0 0 L 45 0 L 45 5 L 55 5 L 55 0 L 100 0';

describe('handleEdgeRoutes：鼓向来源 = 路由折线顶点（R5-1 补）', () => {
  it('直线（2 顶点）+ 跳线 d → auto（跳线桥不参与判向）', () => {
    const { result } = renderHook(() => useEdgeActions(buildController()));
    act(() => {
      result.current.setEdgeSel({ key: 'e0', x: 0, y: 0 });
    });
    act(() => {
      result.current.handleEdgeRoutes(
        new Map([
          [
            'e0',
            entry(
              [
                { x: 0, y: 0 },
                { x: 100, y: 0 },
              ],
              BRIDGED_STRAIGHT_D,
            ),
          ],
        ]),
      );
    });
    expect(result.current.selEdgeBowSide).toBe('auto');
  });

  it('弓形（3 顶点）→ 与顶点偏移同侧：上弓 left、下弓 right', () => {
    const bowed = (midY: number): EdgeRouteEntry =>
      entry(
        [
          { x: 0, y: 100 },
          { x: 100, y: midY },
          { x: 200, y: 100 },
        ],
        'M 0 100 C 50 0, 150 0, 200 100',
      );
    const { result } = renderHook(() => useEdgeActions(buildController()));
    act(() => {
      result.current.setEdgeSel({ key: 'e0', x: 0, y: 0 });
    });
    act(() => {
      result.current.handleEdgeRoutes(new Map([['e0', bowed(60)]]));
    });
    expect(result.current.selEdgeBowSide).toBe('left');
    act(() => {
      result.current.handleEdgeRoutes(new Map([['e0', bowed(140)]]));
    });
    expect(result.current.selEdgeBowSide).toBe('right');
  });

  it('换边门控（三项路由事实）：未收到新边路由前，d / 兜底标志 / 鼓向都不得复用上一结论', () => {
    const { result } = renderHook(() => useEdgeActions(buildTwoEdgeController()));
    act(() => {
      result.current.setEdgeSel({ key: 'e0', x: 0, y: 0 });
    });
    const base = entry(
      [
        { x: 0, y: 100 },
        { x: 100, y: 60 },
        { x: 200, y: 100 },
      ],
      'M 0 100 C 50 0, 150 0, 200 100',
    );
    act(() => {
      result.current.handleEdgeRoutes(
        new Map([['e0', { ...base, route: { ...base.route, forcedSideFallback: true } }]]),
      );
    });
    expect(result.current.selEdgeCurrentD).toBe('M 0 100 C 50 0, 150 0, 200 100');
    expect(result.current.selEdgeBowSide).toBe('left');
    expect(result.current.selEdgeForcedSideFallback).toBe(true);

    // 换到 e1（本帧没有任何 e1 的路由条目）→ 三项一律回落默认，不得沿用 e0 的结论
    act(() => {
      result.current.setEdgeSel({ key: 'e1', x: 0, y: 0 });
    });
    expect(result.current.selEdgeCurrentD).toBeUndefined();
    expect(result.current.selEdgeBowSide).toBeUndefined();
    expect(result.current.selEdgeForcedSideFallback).toBe(false);
  });

  it('换边后不复用上一结论（按 key 门控；未收到该边路由 → undefined）', () => {
    const { result } = renderHook(() => useEdgeActions(buildController()));
    act(() => {
      result.current.setEdgeSel({ key: 'e0', x: 0, y: 0 });
    });
    act(() => {
      result.current.handleEdgeRoutes(
        new Map([
          [
            'e0',
            entry(
              [
                { x: 0, y: 100 },
                { x: 100, y: 60 },
                { x: 200, y: 100 },
              ],
              'M 0 100 C 50 0, 150 0, 200 100',
            ),
          ],
        ]),
      );
    });
    expect(result.current.selEdgeBowSide).toBe('left');

    act(() => {
      result.current.setEdgeSel({ key: 'e1', x: 0, y: 0 });
    });
    expect(result.current.selEdgeBowSide).toBeUndefined();
  });
});
