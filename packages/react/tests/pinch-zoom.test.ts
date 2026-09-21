import { describe, expect, it } from 'vitest';
import { PinchTracker } from '../src/render/pinch.js';
import { FrameScheduler } from '../src/render/scheduler.js';
import { ViewportController } from '../src/render/viewport.js';

describe('PinchTracker（R2：双指缩放手势逻辑）', () => {
  it('双指张开 → zoom 事件（factor > 1，mid 为指间中点）', () => {
    const t = new PinchTracker();
    expect(t.down(1, 200, 200)).toBeNull(); // 首指无事件
    expect(t.down(2, 300, 200)).toEqual({ type: 'start' }); // 第二指 → start
    const ev = t.move(2, 400, 200); // 张开到 200px
    expect(ev).toEqual({ type: 'zoom', midX: 300, midY: 200, factor: 2 });
    expect(t.active).toBe(true);
  });

  it('捏合 → factor < 1；单指移动不产生事件', () => {
    const t = new PinchTracker();
    t.down(1, 200, 200);
    t.down(2, 400, 200);
    const ev = t.move(2, 300, 200); // 收拢一半
    expect(ev?.type).toBe('zoom');
    expect((ev as { factor: number }).factor).toBeLessThan(1);
    // 单指移动（size=1）→ 无事件
    t.up(2);
    expect(t.move(1, 500, 500)).toBeNull();
    expect(t.active).toBe(false);
  });

  it('up 后重置：再双指落下 → 重新 start（距离基准不残留）', () => {
    const t = new PinchTracker();
    t.down(1, 0, 0);
    t.down(2, 400, 0); // 间距 400
    t.up(1);
    t.up(2);
    t.down(1, 100, 100);
    expect(t.down(2, 160, 100)).toEqual({ type: 'start' }); // 新间距 60
    const ev = t.move(2, 220, 100); // 间距 120 → factor 2（不残留旧基准 400）
    expect((ev as { factor: number }).factor).toBeCloseTo(2, 5);
  });
});

describe('pinch × ViewportController（R2：组合——zoom 事件驱动视口）', () => {
  /** node 环境注入同步 frame（每帧立即执行 → 动画跳至终值） */
  function viewport(): ViewportController {
    const frame = new FrameScheduler({
      raf: (cb) => {
        cb();
        return 1;
      },
      rafCancel: () => undefined,
    });
    return new ViewportController(frame);
  }

  it('双指张开 → transform.k 放大；捏合 → 缩小', () => {
    const vp = viewport();
    const t = new PinchTracker();
    const k0 = vp.transform.k;
    t.down(1, 200, 200);
    t.down(2, 300, 200);
    let ev = t.move(2, 400, 200);
    if (ev?.type === 'zoom') vp.zoomAt(ev.midX, ev.midY, ev.factor);
    const kOpen = vp.transform.k;
    expect(kOpen).toBeGreaterThan(k0);
    ev = t.move(2, 250, 200);
    if (ev?.type === 'zoom') vp.zoomAt(ev.midX, ev.midY, ev.factor);
    expect(vp.transform.k).toBeLessThan(kOpen);
  });
});
