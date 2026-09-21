import { describe, expect, it } from 'vitest';
import { easeOutCubic, FrameScheduler, type EasingFn } from '../src/render/scheduler.js';

/** 可控时钟 + 手动 rAF：逐帧推进并可观测 rAF 申请次数 */
function manualClockRaf() {
  let now = 0;
  let rafCalls = 0;
  const pending: Array<() => void> = [];
  return {
    raf: (cb: () => void): number => {
      rafCalls += 1;
      pending.push(cb);
      return pending.length;
    },
    rafCancel: () => undefined,
    now: () => now,
    pending,
    get rafCalls() {
      return rafCalls;
    },
    advance(ms: number): void {
      now += ms;
    },
    flush(): void {
      pending.splice(0).forEach((cb) => cb());
    },
  };
}

describe('FrameScheduler 动画模式（M5-T1：链式 rAF + 空闲归零）', () => {
  it('动画期间链式调度帧；自然完成后立即休眠（不再申请 rAF）', () => {
    const m = manualClockRaf();
    const s = new FrameScheduler({ raf: m.raf, rafCancel: m.rafCancel, now: m.now });
    const frames: number[] = [];
    const done: number[] = [];
    const rafBefore = m.rafCalls;
    s.animate({
      from: 0,
      to: 100,
      duration: 100,
      onFrame: (v) => frames.push(v),
      onDone: () => done.push(1),
    });
    expect(m.pending.length).toBe(1); // 动画启动 → 恰好一帧
    m.flush(); // t=0
    expect(frames).toEqual([0]);
    expect(m.pending.length).toBe(1); // 未完成 → 链式申请下一帧
    m.advance(50);
    m.flush(); // t=0.5
    expect(frames[1]).toBeCloseTo(100 * easeOutCubic(0.5), 5);
    m.advance(50);
    m.flush(); // t=1 → 完成
    expect(frames.length).toBe(3);
    expect(frames[2]).toBe(100);
    expect(done).toEqual([1]);
    expect(m.pending.length).toBe(0); // 最后一帧不调度下一帧 → 立即休眠
    expect(s.hasPending).toBe(false);
    // 硬验收：动画结束后推进 3 秒，rAF 申请数必须零增长
    const rafAfter = m.rafCalls;
    m.advance(3000);
    m.flush();
    expect(m.rafCalls).toBe(rafAfter);
    expect(m.pending.length).toBe(0);
    expect(rafAfter).toBeGreaterThan(rafBefore);
  });

  it('新动画打断旧动画：从当前插值位置继续，不跳回起点', () => {
    const m = manualClockRaf();
    const s = new FrameScheduler({ raf: m.raf, rafCancel: m.rafCancel, now: m.now });
    const frames: number[] = [];
    s.animate({ from: 0, to: 100, duration: 200, onFrame: (v) => frames.push(v) });
    m.flush(); // t=0
    m.advance(50);
    m.flush(); // 旧动画 t=0.25 → value = 100 * easeOutCubic(0.25)
    const midValue = 100 * easeOutCubic(0.25);
    expect(frames[1]).toBeCloseTo(midValue, 5);
    // 打断：新目标 1000，from 必须是当前插值位置（≈midValue），不是 0
    s.animate({ from: 0, to: 1000, duration: 200, onFrame: (v) => frames.push(v) });
    expect(frames.length).toBe(2); // 未追加帧——from 仅内部取当前值
    m.flush(); // 新动画 t=0 → 应立即看到从 midValue 继续
    expect(frames[2]).toBeCloseTo(midValue, 5);
    m.advance(200);
    m.flush(); // t=1
    expect(frames[3]).toBeCloseTo(1000, 5);
    // 中断后的帧（slice(2) 起）必须从 midValue 继续——未跳回起点（frames[0]=0 属旧动画起始帧，不算）
    expect(frames.slice(2).some((v) => v < midValue * 0.99)).toBe(false);
    expect(s.hasPending).toBe(false);
  });

  it('cancelAnim：立即休眠且不触发 onDone', () => {
    const m = manualClockRaf();
    const s = new FrameScheduler({ raf: m.raf, rafCancel: m.rafCancel, now: m.now });
    const done: number[] = [];
    s.animate({
      from: 0,
      to: 100,
      duration: 100,
      onFrame: () => undefined,
      onDone: () => done.push(1),
    });
    expect(s.animating).toBe(true);
    s.cancelAnim();
    expect(s.animating).toBe(false);
    expect(s.hasPending).toBe(false);
    expect(done).toEqual([]);
    m.flush();
    expect(m.pending.length).toBe(0);
  });

  it('动画期间 dirty-flag request 帧正常合批，互不干扰', () => {
    const m = manualClockRaf();
    const s = new FrameScheduler({ raf: m.raf, rafCancel: m.rafCancel, now: m.now });
    const dirty: number[] = [];
    s.animate({ from: 0, to: 10, duration: 100, onFrame: () => undefined });
    s.request(() => dirty.push(1));
    m.flush(); // 动画帧 t=0 + dirty 回调
    expect(dirty).toEqual([1]);
    m.advance(100);
    m.flush(); // 动画完成
    expect(s.hasPending).toBe(false);
    expect(m.pending.length).toBe(0);
  });

  it('duration ≤ 0：单帧立即完成', () => {
    const m = manualClockRaf();
    const s = new FrameScheduler({ raf: m.raf, rafCancel: m.rafCancel, now: m.now });
    const frames: number[] = [];
    s.animate({ from: 5, to: 9, duration: 0, onFrame: (v) => frames.push(v) });
    m.flush();
    expect(frames).toEqual([9]);
    expect(s.hasPending).toBe(false);
  });

  it('自定义缓动与泛型插值（坐标对）生效', () => {
    const m = manualClockRaf();
    const s = new FrameScheduler({ raf: m.raf, rafCancel: m.rafCancel, now: m.now });
    const easing: EasingFn = (t) => t; // 线性便于断言
    const lerp = (a: { x: number }, b: { x: number }, t: number): { x: number } => ({
      x: a.x + (b.x - a.x) * t,
    });
    const frames: Array<{ x: number }> = [];
    s.animate({
      from: { x: 0 },
      to: { x: 10 },
      duration: 100,
      easing,
      interpolate: lerp,
      onFrame: (v) => frames.push(v),
    });
    m.advance(50);
    m.flush();
    expect(frames[0]).toEqual({ x: 5 });
    m.advance(50);
    m.flush();
    expect(frames[1]).toEqual({ x: 10 });
    expect(s.hasPending).toBe(false);
  });
});
