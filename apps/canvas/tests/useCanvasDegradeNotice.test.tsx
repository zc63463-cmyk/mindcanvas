// @vitest-environment jsdom
/**
 * R5-3：Canvas 降级提示的**去重语义**（同一文档只提示一次；切文档后重新允许）。
 *
 * 判别序列（计划 §2 R5-3）：mock stats 序列 svg → canvas → canvas（同文档重复上报）
 * → notify 恰好 1 次；切文档后再进入 canvas → 再提示 1 次。
 * 对照含义：漏去重 → t1 红；去重键误为「会话级布尔」（不随文档变化）→ t2 红。
 */
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CANVAS_DEGRADE_NOTICE,
  useCanvasDegradeNotice,
} from '../src/hooks/useCanvasDegradeNotice';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup(initial: { backend: 'svg' | 'canvas'; docId: string | null }) {
  const notify = vi.fn();
  const view = renderHook(
    (props: { backend: 'svg' | 'canvas'; docId: string | null }) =>
      useCanvasDegradeNotice({ backend: props.backend, docId: props.docId, notify }),
    { initialProps: initial },
  );
  return { view, notify };
}

describe('useCanvasDegradeNotice · 去重语义（R5-3）', () => {
  it('t1：svg → canvas 提示恰 1 次；同文档重复上报不再提示', () => {
    const { view, notify } = setup({ backend: 'svg', docId: 'a.mm.md' });
    expect(notify).not.toHaveBeenCalled();

    view.rerender({ backend: 'canvas', docId: 'a.mm.md' });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(CANVAS_DEGRADE_NOTICE);

    // stats 材料字段（可见节点数等）每 200ms 可能变化 → 会重复上报 backend——不得复提示
    view.rerender({ backend: 'canvas', docId: 'a.mm.md' });
    view.rerender({ backend: 'canvas', docId: 'a.mm.md' });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('t2：切文档后再进入 canvas → 再提示 1 次（去重键 = 文档，而非会话级布尔）', () => {
    const { view, notify } = setup({ backend: 'canvas', docId: 'a.mm.md' });
    expect(notify).toHaveBeenCalledTimes(1);

    view.rerender({ backend: 'svg', docId: 'b.mm.md' });
    expect(notify).toHaveBeenCalledTimes(1);

    view.rerender({ backend: 'canvas', docId: 'b.mm.md' });
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('t3：svg 态静默；docId 为 null（极端输入）不提示、不崩溃', () => {
    const { view, notify } = setup({ backend: 'canvas', docId: null });
    expect(notify).not.toHaveBeenCalled();

    view.rerender({ backend: 'svg', docId: 'a.mm.md' });
    expect(notify).not.toHaveBeenCalled();
  });
});
