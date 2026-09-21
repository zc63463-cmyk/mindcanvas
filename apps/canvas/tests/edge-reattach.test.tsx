// @vitest-environment jsdom
/**
 * R2-1：重挂锚点——hook 写路径 + 应用层可见性。
 *
 * 红线（派遣计划 R2-A2/A3）：
 * - 唯一写路径 useEdgeActions.reattachEdge（内部 writeEdges + patchEdgeAt）
 * - 重挂只 patch 指定端，不得清 invalidAt；同批只动这一项
 * - 一次 undo 回滚
 * 应用层：dangling（源锚未解析）→ 重挂后 state 派生 well-formed、
 * edgeHealthOf dangling 归零、画布 [data-free-edge] +1。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { astToEditable, makeTextNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '@mindcanvas/react';
import {
  EditorController,
  edgeHealthOf,
  MapView,
} from '@mindcanvas/react';
import { useEdgeActions } from '../src/hooks/useEdgeActions.js';
import type { EdgeRouteEntry } from '@mindcanvas/react';
import { createCharMeasure, createNodeMeasure } from '@mindcanvas/react';
import { layoutMindmap } from '@mindcanvas/kernel';

beforeEach(() => {
  // canvas 套件统一 pretendToBeVisual:false（无 rAF）——controller 调度需补桩
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
  const built = astToEditable(
    makeTextNode('根', [
      makeTextNode('任务'),
      makeTextNode('生活'),
      makeTextNode('孤儿'),
    ]),
  );
  if (built === null) throw new Error('fixture broken');
  built.note = {
    edges: [
      // 源锚未解析（node:根/幽灵 不存在）→ 画布不画；invalidAt 用户标记须保留
      { from: 'node:根/幽灵', to: 'node:根/生活', rel: 'relates-to', invalidAt: '2026-09-01T00:00:00.000Z' },
    ],
  };
  return new EditorController(built);
}

describe('useEdgeActions.reattachEdge（唯一写路径）', () => {
  it('重挂 from → 仅该项 from 被改写；invalidAt 保留；一次 undo 回滚', () => {
    const controller = buildController();
    const { result } = renderHook(() => useEdgeActions(controller));

    act(() => {
      result.current.reattachEdge(0, 'from', 'node:根/任务');
    });

    const raw = controller.root.note?.edges;
    expect(Array.isArray(raw)).toBe(true);
    const edge = (raw as Array<Record<string, unknown>>)[0];
    expect(edge?.from).toBe('node:根/任务');
    expect(edge?.to).toBe('node:根/生活');
    expect(edge?.rel).toBe('relates-to');
    expect(edge?.invalidAt).toBe('2026-09-01T00:00:00.000Z'); // R2-A3：不得清除
    expect((raw as unknown[]).length).toBe(1); // 同批只动这一项

    expect(controller.undo()).toBe(true);
    const rawAfter = controller.root.note?.edges;
    expect(Array.isArray(rawAfter)).toBe(true);
    const restored = Array.isArray(rawAfter)
      ? (rawAfter as Array<Record<string, unknown>>)[0]
      : undefined;
    expect(restored?.from).toBe('node:根/幽灵');
  });
});

describe('重挂后画布可见性（应用层闭环）', () => {
  function mountMap(controller: EditorController) {
    const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
    const layout = layoutMindmap(controller.root, createNodeMeasure(char, new Map()), new Set());
    return render(
      <ThemeProvider>
        <MapView layout={layout} documentRoot={controller.root} entities={new Map()} char={char} />
      </ThemeProvider>,
    );
  }

  it('dangling 源锚边默认不画 → 重挂后 [data-free-edge] +1 且 state=well-formed', () => {
    const controller = buildController();
    const first = mountMap(controller);
    // 源锚未解析 → renderable:false → 画布不画（历史裁决：不画误导性直线）
    expect(first.container.querySelectorAll('[data-free-edge]').length).toBe(0);

    const { result } = renderHook(() => useEdgeActions(controller));
    act(() => {
      result.current.reattachEdge(0, 'from', 'node:根/任务');
    });
    first.unmount();

    // 重挂后：state 派生 well-formed；edgeHealthOf dangling 归零；画布画出
    const second = mountMap(controller);
    const drawn = second.container.querySelectorAll('[data-free-edge]');
    expect(drawn.length).toBe(1);
    expect(drawn[0]?.getAttribute('data-free-edge-state')).toBe('well-formed');
    expect(edgeHealthOf(controller.root).byState.dangling).toBe(0);
    expect(edgeHealthOf(controller.root).renderable).toBe(1);
  });
});

describe('setEdgeDir：dir 切换保形（R3-3）', () => {
  /** 缺元素即抛错（新增代码零 `!` lint 告警纪律） */
  function qq<T extends Element = Element>(sel: string, root: ParentNode): T {
    const el = root.querySelector(sel);
    if (el === null) throw new Error(`element not found: ${sel}`);
    return el as T;
  }

  function buildDirController(): EditorController {
    const built = astToEditable(makeTextNode('根', [makeTextNode('任务'), makeTextNode('生活')]));
    if (built === null) throw new Error('fixture broken');
    built.note = {
      edges: [
        {
          from: 'node:根/任务',
          to: 'node:根/生活',
          rel: 'relates-to',
          dir: 'fwd',
          manual: { from: { x: 1, y: 0.5 }, to: { x: 0, y: 0.5 }, curvature: 0.25 },
          routingSide: 'left',
        },
      ],
    };
    return new EditorController(built);
  }

  function rawEdge(controller: EditorController): Record<string, unknown> {
    const raw = controller.root.note?.edges;
    if (!Array.isArray(raw)) throw new Error('fixture broken: no edges');
    const e = raw[0];
    if (typeof e !== 'object' || e === null) throw new Error('fixture broken: edge');
    return e as Record<string, unknown>;
  }

  /** 从渲染 d 提取起点/终点坐标（M 后两个数 / 末尾两个数） */
  function dEnds(d: string): { start: string; end: string } {
    const nums = d.match(/-?[\d.]+/g) ?? [];
    if (nums.length < 4) throw new Error(`bad d: ${d}`);
    return { start: `${nums[0]} ${nums[1]}`, end: `${nums[nums.length - 2]} ${nums[nums.length - 1]}` };
  }

  function renderedEnds(controller: EditorController): { start: string; end: string } {
    const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
    const layout = layoutMindmap(controller.root, createNodeMeasure(char, new Map()), new Set());
    const screen = render(
      <ThemeProvider>
        <MapView layout={layout} documentRoot={controller.root} entities={new Map()} char={char} />
      </ThemeProvider>,
    );
    const g = qq('[data-free-edge]', screen.container);
    const paths = [...g.querySelectorAll('path')];
    const visible = paths.find((p) => p.getAttribute('stroke') !== 'transparent');
    if (visible === undefined) throw new Error('visible edge path not found');
    const ends = dEnds(visible.getAttribute('d') ?? '');
    screen.unmount();
    return ends;
  }

  it('manual 边 fwd→back：两端锚点保位（d 起终点互换）+ manual 交换 + routingSide 翻转', () => {
    const controller = buildDirController();
    const before = renderedEnds(controller);

    const { result } = renderHook(() => useEdgeActions(controller));
    act(() => {
      result.current.setEdgeDir(0, 'back');
    });
    const after = renderedEnds(controller);

    // 端点保位：新 d 起于原终点、终于原起点（手工把手不跳——原修复目标）
    expect(after.start).toBe(before.end);
    expect(after.end).toBe(before.start);
    // 存储侧：manual.from/to 交换、routingSide 翻转、curvature 不动（同一补丁）
    const e = rawEdge(controller);
    expect(e.dir).toBe('back');
    expect(e.manual).toEqual({ from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 }, curvature: 0.25 });
    expect(e.routingSide).toBe('right');
    // 一次 undo 全回滚
    expect(controller.undo()).toBe(true);
    const restored = rawEdge(controller);
    expect(restored.dir).toBe('fwd');
    expect(restored.manual).toEqual({ from: { x: 1, y: 0.5 }, to: { x: 0, y: 0.5 }, curvature: 0.25 });
    expect(restored.routingSide).toBe('left');
  });

  it('back→fwd 反向同样保形（交换回去）', () => {
    const controller = buildDirController();
    const { result } = renderHook(() => useEdgeActions(controller));
    act(() => {
      result.current.setEdgeDir(0, 'back');
    });
    const mid = renderedEnds(controller);
    act(() => {
      result.current.setEdgeDir(0, 'fwd');
    });
    const back = renderedEnds(controller);
    expect(back.start).toBe(mid.end);
    expect(back.end).toBe(mid.start);
    expect(rawEdge(controller).manual).toEqual({
      from: { x: 1, y: 0.5 },
      to: { x: 0, y: 0.5 },
      curvature: 0.25,
    });
    expect(rawEdge(controller).routingSide).toBe('left');
  });

  it('fwd→both 不交换（both 与 fwd 同向——三态边界钉）', () => {
    const controller = buildDirController();
    const { result } = renderHook(() => useEdgeActions(controller));
    act(() => {
      result.current.setEdgeDir(0, 'both');
    });
    const e = rawEdge(controller);
    expect(e.dir).toBe('both');
    expect(e.manual).toEqual({ from: { x: 1, y: 0.5 }, to: { x: 0, y: 0.5 }, curvature: 0.25 });
    expect(e.routingSide).toBe('left');
  });

  it('无 manual / 无 routingSide → 仅 dir 变化（回归钉）', () => {
    const controller = buildController(); // 复用本文件的悬空边夹具（无 manual/routingSide）
    const { result } = renderHook(() => useEdgeActions(controller));
    act(() => {
      result.current.reattachEdge(0, 'from', 'node:根/任务'); // 先修成 well-formed
    });
    act(() => {
      result.current.setEdgeDir(0, 'back');
    });
    const raw = controller.root.note?.edges;
    const e = Array.isArray(raw) ? (raw[0] as Record<string, unknown>) : undefined;
    expect(e?.dir).toBe('back');
    expect(e?.from).toBe('node:根/任务');
    expect(e?.to).toBe('node:根/生活');
    expect(e?.invalidAt).toBe('2026-09-01T00:00:00.000Z');
    expect('manual' in (e ?? {})).toBe(false);
    expect('routingSide' in (e ?? {})).toBe(false);
  });
});

describe('handleEdgeRoutes：forcedSideFallback 值比较（R3-4）', () => {
  function routeEntry(fb: boolean): EdgeRouteEntry {
    const box0 = { x: 0, y: 0, w: 10, h: 10 };
    return {
      eps: {
        fromId: 'a',
        toId: 'b',
        from: box0,
        to: box0,
        ghost: false,
        renderable: true,
      },
      route: {
        d: 'M 0 0 L 1 1',
        points: [],
        routed: false,
        mid: { x: 0, y: 0 },
        nx: 0,
        ny: 0,
        ...(fb ? { forcedSideFallback: true as const } : {}),
      },
    };
  }

  it('标志变化 → 新值；同值重复 → 保持（值比较，防重渲链）', () => {
    const controller = buildController();
    const { result } = renderHook(() => useEdgeActions(controller));
    expect(result.current.selEdgeForcedSideFallback).toBe(false); // 未选中 → false

    act(() => {
      result.current.setEdgeSel({ key: 'e0', x: 0, y: 0 });
    });
    act(() => {
      result.current.handleEdgeRoutes(new Map([['e0', routeEntry(true)]]));
    });
    expect(result.current.selEdgeForcedSideFallback).toBe(true);
    // 同值重复：状态保持（值比较短路——与 selEdgeD 先例同款纪律）
    act(() => {
      result.current.handleEdgeRoutes(new Map([['e0', routeEntry(true)]]));
    });
    expect(result.current.selEdgeForcedSideFallback).toBe(true);
    // 变化 → 翻转
    act(() => {
      result.current.handleEdgeRoutes(new Map([['e0', routeEntry(false)]]));
    });
    expect(result.current.selEdgeForcedSideFallback).toBe(false);
  });
});

describe('connectEdge 去重口径（R4-3①）：失效边不吞新建', () => {
  function buildInvalidDupController(): EditorController {
    const built = astToEditable(makeTextNode('根', [makeTextNode('任务'), makeTextNode('生活')]));
    if (built === null) throw new Error('fixture broken');
    built.note = {
      edges: [
        {
          from: 'node:根/任务',
          to: 'node:根/生活',
          rel: 'relates-to',
          invalidAt: '2026-09-01T00:00:00.000Z',
        },
      ],
    };
    return new EditorController(built);
  }

  it('同名失效边在场 → 新建成功（并存）+ 返回 skippedInvalid=1 + undo 回滚', () => {
    const controller = buildInvalidDupController();
    const { result } = renderHook(() => useEdgeActions(controller));
    let info: { created: boolean; skippedInvalid: number } | undefined;
    act(() => {
      info = result.current.connectEdge('node:根/任务', 'node:根/生活', 'relates-to', 0, 0);
    });
    const raw = controller.root.note?.edges;
    expect(Array.isArray(raw)).toBe(true);
    expect((raw as unknown[]).length).toBe(2);
    const first = (raw as Array<Record<string, unknown>>)[0];
    const second = (raw as Array<Record<string, unknown>>)[1];
    expect(first?.invalidAt).toBe('2026-09-01T00:00:00.000Z'); // 原失效边保留
    expect(second?.invalidAt).toBeUndefined(); // 新边有效
    expect(info?.created).toBe(true);
    expect(info?.skippedInvalid).toBe(1);
    expect(controller.undo()).toBe(true);
    const rawAfterUndo = controller.root.note?.edges;
    expect(Array.isArray(rawAfterUndo) && rawAfterUndo.length === 1).toBe(true);
  });

  it('同名正常边在场 → 仍选中旧边不新建（回归钉）', () => {
    // 专用夹具：同键边且未失效（buildController 的边带 invalidAt 且 from 不同）
    const built = astToEditable(makeTextNode('根', [makeTextNode('任务'), makeTextNode('生活')]));
    if (built === null) throw new Error('fixture broken');
    built.note = {
      edges: [{ from: 'node:根/任务', to: 'node:根/生活', rel: 'relates-to' }],
    };
    const controller = new EditorController(built);
    const { result } = renderHook(() => useEdgeActions(controller));
    let info: { created: boolean; skippedInvalid: number } | undefined;
    act(() => {
      info = result.current.connectEdge('node:根/任务', 'node:根/生活', 'relates-to', 0, 0);
    });
    const rawBefore = controller.root.note?.edges;
    expect(Array.isArray(rawBefore) && rawBefore.length === 1).toBe(true);
    expect(info?.created).toBe(false);
    expect(info?.skippedInvalid).toBe(0);
    expect(result.current.edgeSel?.key).toBe('e0');
  });
});
