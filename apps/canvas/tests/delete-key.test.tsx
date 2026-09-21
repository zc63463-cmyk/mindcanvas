// @vitest-environment jsdom
/**
 * 键盘删除端到端（2026-09-11 用户实测「Del 删不掉」后的回归网）
 * ══════════════════════════════════════════════════════════════════════
 * 旧实现：`case 'delete'` 走原生 `confirm()` —— IDE 内嵌 webview（以及 jsdom）
 * 会**静默吞掉**原生对话框：不弹、且恒返回 false → 删除退化成空操作。
 * 本测试真做全链：点中一个非根节点（pointer 命中选中）→ 按 Delete → 断言节点消失。
 *
 * 坐标：jsdom 无尺寸 → MapView 恒等变换，世界坐标 = 屏幕坐标（与 packages/react
 * 的手势测试同一前提）。
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MindmapStage from '../src/MindmapStage';

/** 等一拍：controller.notify → FrameScheduler 走 rAF（下方桩成 16ms 定时器） */
const tick = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms));

function nodeIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('g[data-node-id]')).map(
    (g) => g.getAttribute('data-node-id') ?? '',
  );
}

/** 节点 g 的屏幕中心（transform 的 translate + 首个 rect 的宽高） */
function centerOf(container: HTMLElement, id: string): { cx: number; cy: number } | null {
  const g = container.querySelector(`g[data-node-id="${id}"]`);
  if (!g) return null;
  const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(g.getAttribute('transform') ?? '');
  const r = g.querySelector('rect');
  if (!m || !r) return null;
  return {
    cx: Number(m[1]) + Number(r.getAttribute('width') ?? 0) / 2,
    cy: Number(m[2]) + Number(r.getAttribute('height') ?? 0) / 2,
  };
}

/** 在画布手势层上点一下（pointerdown+up = 选中；与 packages/react 手势测试同法） */
function clickNode(container: HTMLElement, id: string): boolean {
  const wheel = container.querySelector('div[style*="touch-action"]') as HTMLElement | null;
  const at = centerOf(container, id);
  if (!wheel || !at) return false;
  fireEvent.pointerDown(wheel, { clientX: at.cx, clientY: at.cy, pointerId: 1, bubbles: true });
  fireEvent.pointerUp(wheel, { clientX: at.cx, clientY: at.cy, pointerId: 1, bubbles: true });
  return true;
}

describe('键盘删除（Del）端到端：选中 → 删除', () => {
  beforeEach(() => {
    // canvas 套件统一 pretendToBeVisual:false（无 rAF）——controller.notify 的调度需补桩
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      setTimeout(() => cb(0), 16) as unknown as number,
    );
    vi.stubGlobal('cancelAnimationFrame', (h: number) => {
      clearTimeout(h);
    });
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('点中一个非根节点 → 按 Delete → 该节点消失（不再被原生 confirm 静默吞掉）', async () => {
    localStorage.clear(); // 无最近文档 → 直接进画布
    const { container } = render(<MindmapStage />);

    const before = nodeIds(container);
    expect(before.length).toBeGreaterThan(1);

    // 末位节点通常是最深的叶子（避免误选根——根不可删）
    const target = before[before.length - 1] ?? '';
    expect(target).not.toBe('');
    expect(clickNode(container, target)).toBe(true);
    await tick(); // 等选中落地（notify → rAF）

    fireEvent.keyDown(window, { key: 'Delete' });
    await tick();

    const after = nodeIds(container);
    expect(after).not.toContain(target);
    expect(after.length).toBeLessThan(before.length);
  });
});
