// @vitest-environment jsdom
/**
 * R4-5：边多选与批量（hook 层）。
 *
 * 契约：
 * - toggleEdgeMulti 增/删（Shift+点击的复数选择集合）；setEdgeSel（单选）清空集合；
 * - 批量删除：一次写一条 history（一次 undo 全回滚）；
 * - 批量失效：跳过已失效（返回 skipped），同一时间戳，一次 undo 全回滚；
 * - 批量恢复：只对已失效生效。
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

const EDGE_DEFS = [
  { from: 'node:根/A', to: 'node:根/B', rel: 'relates-to' },
  { from: 'node:根/A', to: 'node:根/C', rel: 'relates-to' },
  { from: 'node:根/B', to: 'node:根/C', rel: 'relates-to', invalidAt: '2026-09-01T00:00:00.000Z' },
];

function buildController(): EditorController {
  const built = astToEditable(
    makeTextNode('根', [makeTextNode('A'), makeTextNode('B'), makeTextNode('C')]),
  );
  if (built === null) throw new Error('fixture broken');
  built.note = { edges: EDGE_DEFS };
  return new EditorController(built);
}

function rawEdges(controller: EditorController): Array<Record<string, unknown>> {
  const raw = controller.root.note?.edges;
  if (!Array.isArray(raw)) throw new Error('fixture broken');
  return raw as Array<Record<string, unknown>>;
}

describe('edgeMultiSel（R4-5）', () => {
  it('toggle 增/删/去重；setEdgeSel（单选）清空集合', () => {
    const controller = buildController();
    const { result } = renderHook(() => useEdgeActions(controller));
    act(() => {
      result.current.toggleEdgeMulti('e0');
      result.current.toggleEdgeMulti('e1');
    });
    expect([...result.current.edgeMultiSel].sort()).toEqual(['e0', 'e1']);
    act(() => {
      result.current.toggleEdgeMulti('e0'); // 再点移出
    });
    expect([...result.current.edgeMultiSel]).toEqual(['e1']);
    act(() => {
      result.current.setEdgeSel({ key: 'e2', x: 0, y: 0 }); // 单选清空集合
    });
    expect(result.current.edgeMultiSel.length).toBe(0);
  });

  it('批量删除：一次写一条 history，一次 undo 全回滚', () => {
    const controller = buildController();
    const { result } = renderHook(() => useEdgeActions(controller));
    act(() => {
      result.current.toggleEdgeMulti('e0');
      result.current.toggleEdgeMulti('e2');
    });
    act(() => {
      result.current.batchDelete();
    });
    expect(rawEdges(controller).length).toBe(1);
    expect(controller.undo()).toBe(true);
    expect(rawEdges(controller).length).toBe(3);
    // 集合随批量操作清空
    expect(result.current.edgeMultiSel.length).toBe(0);
  });

  it('批量失效：跳过已失效（skipped=1）、同一时间戳、一次 undo 全回滚', () => {
    const controller = buildController();
    const { result } = renderHook(() => useEdgeActions(controller));
    act(() => {
      result.current.toggleEdgeMulti('e0');
      result.current.toggleEdgeMulti('e1');
      result.current.toggleEdgeMulti('e2'); // 已失效 → 跳过
    });
    let skipped = -1;
    act(() => {
      skipped = result.current.batchInvalidate();
    });
    expect(skipped).toBe(1);
    const edges = rawEdges(controller);
    expect(edges[0]?.invalidAt).toBe(edges[1]?.invalidAt); // 同一时间戳
    expect(edges[2]?.invalidAt).toBe('2026-09-01T00:00:00.000Z'); // 不覆盖既有
    expect(controller.undo()).toBe(true);
    expect(rawEdges(controller)[0]?.invalidAt).toBeUndefined();
    expect(rawEdges(controller)[1]?.invalidAt).toBeUndefined();
    expect(rawEdges(controller)[2]?.invalidAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('批量恢复：只对已失效生效', () => {
    const controller = buildController();
    const { result } = renderHook(() => useEdgeActions(controller));
    act(() => {
      result.current.toggleEdgeMulti('e0');
      result.current.toggleEdgeMulti('e2');
    });
    let restored = -1;
    act(() => {
      restored = result.current.batchRestore();
    });
    expect(restored).toBe(1);
    expect(rawEdges(controller)[0]?.invalidAt).toBeUndefined(); // 本就有效 → no-op
    expect(rawEdges(controller)[2]?.invalidAt).toBeUndefined(); // 被恢复
  });
});
