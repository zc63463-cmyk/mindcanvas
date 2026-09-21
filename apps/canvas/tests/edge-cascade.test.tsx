// @vitest-environment jsdom
/**
 * R4-4：级联（限定语义）——成对反向边的同步失效 / 恢复。
 *
 * 语义边界（测试钉死）：
 * - 联动：同一对节点（无序）+ rel === reverseOf(源边 rel)（非对称、已注册）→
 *   同一 invalidAt 时间戳同步标记 / 同步恢复，返回 cascaded=1，一次 undo 全回滚；
 * - 不联动：对称（isSymmetric）、未注册 rel、非成对（rel 无反向）→ cascaded=0；
 * - 已失效的配对边不被覆盖时间戳（失效跳过）；已有效的配对边恢复为 no-op。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { astToEditable, makeTextNode } from '@mindcanvas/kernel';
import { EditorController } from '@mindcanvas/react';
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

function buildController(edges: Array<Record<string, unknown>>): EditorController {
  const built = astToEditable(makeTextNode('根', [makeTextNode('任务'), makeTextNode('生活')]));
  if (built === null) throw new Error('fixture broken');
  built.note = { edges };
  return new EditorController(built);
}

function rawEdges(controller: EditorController): Array<Record<string, unknown>> {
  const raw = controller.root.note?.edges;
  if (!Array.isArray(raw)) throw new Error('fixture broken');
  return raw as Array<Record<string, unknown>>;
}

describe('setEdgeInvalid 级联（R4-4：成对反向同步失效/恢复）', () => {
  it('成对反向（causes ↔ isCausedBy）失效 → 同一时间戳同步标记 + cascaded=1 + 一次 undo 全回滚', () => {
    const controller = buildController([
      { from: 'node:根/任务', to: 'node:根/生活', rel: 'causes' },
      { from: 'node:根/生活', to: 'node:根/任务', rel: 'isCausedBy' },
    ]);
    const { result } = renderHook(() => useEdgeActions(controller));
    let info: { cascaded: number } | undefined;
    act(() => {
      info = result.current.setEdgeInvalid(0, true);
    });
    const edges = rawEdges(controller);
    expect(edges[0]?.invalidAt).toBe(edges[1]?.invalidAt); // 同一时间戳
    expect(typeof edges[1]?.invalidAt).toBe('string');
    expect(info?.cascaded).toBe(1);
    expect(controller.undo()).toBe(true);
    expect(rawEdges(controller)[0]?.invalidAt).toBeUndefined();
    expect(rawEdges(controller)[1]?.invalidAt).toBeUndefined();
  });

  it('成对反向恢复 → 同步清除 + cascaded=1', () => {
    const controller = buildController([
      { from: 'node:根/任务', to: 'node:根/生活', rel: 'causes', invalidAt: '2026-09-13T00:00:00.000Z' },
      { from: 'node:根/生活', to: 'node:根/任务', rel: 'isCausedBy', invalidAt: '2026-09-12T00:00:00.000Z' },
    ]);
    const { result } = renderHook(() => useEdgeActions(controller));
    let info: { cascaded: number } | undefined;
    act(() => {
      info = result.current.setEdgeInvalid(0, false);
    });
    expect(rawEdges(controller)[0]?.invalidAt).toBeUndefined();
    expect(rawEdges(controller)[1]?.invalidAt).toBeUndefined();
    expect(info?.cascaded).toBe(1);
  });

  it('对称关系（relates-to）→ 不联动', () => {
    const controller = buildController([
      { from: 'node:根/任务', to: 'node:根/生活', rel: 'relates-to' },
      { from: 'node:根/生活', to: 'node:根/任务', rel: 'relates-to' },
    ]);
    const { result } = renderHook(() => useEdgeActions(controller));
    let info: { cascaded: number } | undefined;
    act(() => {
      info = result.current.setEdgeInvalid(0, true);
    });
    expect(typeof rawEdges(controller)[0]?.invalidAt).toBe('string');
    expect(rawEdges(controller)[1]?.invalidAt).toBeUndefined();
    expect(info?.cascaded).toBe(0);
  });

  it('未注册 rel → 不联动', () => {
    const controller = buildController([
      { from: 'node:根/任务', to: 'node:根/生活', rel: 'weird-rel' },
      { from: 'node:根/生活', to: 'node:根/任务', rel: 'weird-rel' },
    ]);
    const { result } = renderHook(() => useEdgeActions(controller));
    act(() => {
      result.current.setEdgeInvalid(0, true);
    });
    expect(typeof rawEdges(controller)[0]?.invalidAt).toBe('string');
    expect(rawEdges(controller)[1]?.invalidAt).toBeUndefined();
  });

  it('非成对（另一侧 rel 与 reverseOf 不匹配）→ 不联动', () => {
    // causes 的反向是 isCausedBy；另一侧 rel 仍是 causes → 不构成成对反向
    const controller = buildController([
      { from: 'node:根/任务', to: 'node:根/生活', rel: 'causes' },
      { from: 'node:根/生活', to: 'node:根/任务', rel: 'causes' },
    ]);
    const { result } = renderHook(() => useEdgeActions(controller));
    act(() => {
      result.current.setEdgeInvalid(0, true);
    });
    expect(typeof rawEdges(controller)[0]?.invalidAt).toBe('string');
    expect(rawEdges(controller)[1]?.invalidAt).toBeUndefined();
  });

  it('已失效的配对边 → 失效跳过（不覆盖既有时间戳），cascaded=0', () => {
    const controller = buildController([
      { from: 'node:根/任务', to: 'node:根/生活', rel: 'causes' },
      { from: 'node:根/生活', to: 'node:根/任务', rel: 'isCausedBy', invalidAt: '2026-09-01T00:00:00.000Z' },
    ]);
    const { result } = renderHook(() => useEdgeActions(controller));
    let info: { cascaded: number } | undefined;
    act(() => {
      info = result.current.setEdgeInvalid(0, true);
    });
    expect(typeof rawEdges(controller)[0]?.invalidAt).toBe('string'); // 新标记
    expect(rawEdges(controller)[1]?.invalidAt).toBe('2026-09-01T00:00:00.000Z'); // 保留原戳
    expect(rawEdges(controller)[0]?.invalidAt).not.toBe('2026-09-01T00:00:00.000Z');
    expect(info?.cascaded).toBe(0);
  });
});
