import { describe, expect, it } from 'vitest';
import { FrameScheduler } from '../src/render/scheduler.js';
import { ViewportController, estimatePanVelocity } from '../src/render/viewport.js';
import { ZOOM_MAX, ZOOM_MIN } from '../src/render/motion.js';

/** 可控 rAF 驱动 */
function manualRaf() {
  const pending: Array<() => void> = [];
  return {
    raf: (cb: () => void): number => {
      pending.push(cb);
      return pending.length;
    },
    rafCancel: () => undefined,
    pending,
    flush: () => pending.splice(0).forEach((cb) => cb()),
  };
}

/** 可控时钟 + 手动 rAF（动画测试用） */
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
    flush: () => pending.splice(0).forEach((cb) => cb()),
  };
}

describe('ViewportController：变换 + dirty 单帧通知', () => {
  it('多次变更合并为一帧通知（同一帧内监听器只触发一次）', () => {
    const m = manualRaf();
    const vp = new ViewportController(new FrameScheduler({ raf: m.raf, rafCancel: m.rafCancel }));
    vp.setSize(800, 600);
    m.flush(); // 尺寸初始通知消费掉
    let notified = 0;
    vp.subscribe(() => (notified += 1));
    const e0 = vp.getSnapshot();
    vp.panBy(10, 0);
    vp.panBy(5, 5);
    vp.zoomAt(400, 300, 1.2);
    expect(vp.getSnapshot()).toBeGreaterThan(e0); // 脏标记已积累
    expect(notified).toBe(0); // 但帧尚未执行——无同步风暴
    m.flush();
    expect(notified).toBe(1); // 合批一次
  });

  it('平移按屏幕像素、zoomAt 保持世界锚点不动', () => {
    const m = manualRaf();
    const vp = new ViewportController(new FrameScheduler({ raf: m.raf, rafCancel: m.rafCancel }));
    vp.setSize(800, 600);
    m.flush();
    vp.panBy(100, 50);
    expect(vp.transform.x).toBe(100);
    expect(vp.transform.y).toBe(50);

    const t0 = { ...vp.transform };
    const anchor = vp.toWorld(300, 200);
    vp.zoomAt(300, 200, 2);
    expect(vp.transform.k).toBeCloseTo(t0.k * 2);
    const anchorAfter = vp.toWorld(300, 200);
    expect(anchorAfter.x).toBeCloseTo(anchor.x, 5);
    expect(anchorAfter.y).toBeCloseTo(anchor.y, 5);
  });

  it('fitBounds 居中并缩放到能装下 bounds', () => {
    const m = manualRaf();
    const vp = new ViewportController(new FrameScheduler({ raf: m.raf, rafCancel: m.rafCancel }));
    vp.setSize(1000, 800);
    m.flush();
    vp.fitBounds({ minX: 0, minY: 0, maxX: 200, maxY: 100 }, 60);
    // 世界中心 (100,50) 应映射到屏幕中心 (500,400)
    const c = vp.toWorld(500, 400);
    expect(c.x).toBeCloseTo(100, 3);
    expect(c.y).toBeCloseTo(50, 3);
    // 缩放应不超过视口（含 pad）
    expect(vp.transform.k).toBeLessThanOrEqual((1000 - 120) / 200 + 1e-9);
  });

  it('空闲（无变更）→ 无挂起帧 → 零活动', () => {
    const m = manualRaf();
    const s = new FrameScheduler({ raf: m.raf, rafCancel: m.rafCancel });
    const vp = new ViewportController(s);
    vp.setSize(100, 100);
    m.flush();
    expect(s.hasPending).toBe(false);
  });
});

describe('ViewportController 视口动画（M5-T3：平滑平移缩放）', () => {
  it('animateTo：平移 + 缩放同时插值，结束后立即休眠', () => {
    const m = manualClockRaf();
    const s = new FrameScheduler({ raf: m.raf, rafCancel: m.rafCancel, now: m.now });
    const vp = new ViewportController(s);
    vp.setSize(800, 600);
    m.flush();
    vp.animateTo({ k: 2, x: 100, y: 50 }, 200);
    m.flush(); // t=0：起始帧
    expect(vp.transform.k).toBe(1);
    expect(vp.transform.x).toBe(0);
    m.advance(100);
    m.flush(); // t=0.5
    expect(vp.transform.k).toBeCloseTo(1.5, 5);
    expect(vp.transform.x).toBeCloseTo(50, 5);
    m.advance(100);
    m.flush(); // t=1：精确落位
    expect(vp.transform).toEqual({ k: 2, x: 100, y: 50 });
    m.flush(); // 消费末帧 notify 广播（合法的最终渲染帧，仅一帧）
    expect(s.hasPending).toBe(false); // 动画结束立即休眠
    // 3 秒后 rAF 申请数零增长
    const rafAfter = m.rafCalls;
    m.advance(3000);
    m.flush();
    expect(m.rafCalls).toBe(rafAfter);
  });

  it('animateTo 打断续接：从当前插值位置继续，不跳回起点', () => {
    const m = manualClockRaf();
    const s = new FrameScheduler({ raf: m.raf, rafCancel: m.rafCancel, now: m.now });
    const vp = new ViewportController(s);
    vp.setSize(800, 600);
    m.flush();
    vp.animateTo({ k: 2, x: 0, y: 0 }, 200);
    m.flush();
    m.advance(100);
    m.flush(); // t=0.5 → k=1.5
    vp.animateTo({ k: 4, x: 0, y: 0 }, 200); // 打断：from = 当前 k=1.5
    m.flush();
    expect(vp.transform.k).toBeCloseTo(1.5, 5); // 未跳回 1
    m.advance(200);
    m.flush();
    expect(vp.transform.k).toBe(4);
    m.flush(); // 消费末帧 notify 广播
    expect(s.hasPending).toBe(false);
  });

  it('fitBoundsAnimated：终点与瞬间 fit 一致', () => {
    const m = manualClockRaf();
    const s = new FrameScheduler({ raf: m.raf, rafCancel: m.rafCancel, now: m.now });
    const vp = new ViewportController(s);
    vp.setSize(1000, 800);
    m.flush();
    vp.fitBoundsAnimated({ minX: 0, minY: 0, maxX: 200, maxY: 100 }, 60, 200);
    const target = vp.fitTransform({ minX: 0, minY: 0, maxX: 200, maxY: 100 }, 60)!;
    m.advance(200);
    m.flush();
    expect(vp.transform.k).toBeCloseTo(target.k, 6);
    expect(vp.transform.x).toBeCloseTo(target.x, 6);
    expect(vp.transform.y).toBeCloseTo(target.y, 6);
    m.flush(); // 消费末帧 notify 广播
    expect(s.hasPending).toBe(false);
  });

  it('手动 zoomAt/panBy 打断视口动画（用户接管）', () => {
    const m = manualClockRaf();
    const s = new FrameScheduler({ raf: m.raf, rafCancel: m.rafCancel, now: m.now });
    const vp = new ViewportController(s);
    vp.setSize(800, 600);
    m.flush();
    vp.animateTo({ k: 4, x: 300, y: 200 }, 400);
    m.advance(50);
    m.flush(); // 动画中
    const kBefore = vp.transform.k;
    vp.zoomAt(400, 300, 0.5); // 用户滚轮 → 立即接管
    const kAfter = vp.transform.k;
    expect(kAfter).toBeCloseTo(kBefore * 0.5, 6);
    m.advance(400);
    m.flush();
    // 动画已取消：变换保持手动结果，不再向目标推进
    expect(s.hasPending).toBe(false);
    expect(vp.transform.k).toBe(kAfter);
  });

  it('cancelAnim：打断视口动画且不影响其他槽（节点过渡仍继续）', () => {
    const m = manualClockRaf();
    const s = new FrameScheduler({ raf: m.raf, rafCancel: m.rafCancel, now: m.now });
    const vp = new ViewportController(s);
    vp.setSize(800, 600);
    m.flush();
    vp.animateTo({ k: 3, x: 100, y: 100 }, 200); // 'viewport' 槽
    const nodeFrames: number[] = [];
    s.animate({ from: 0, to: 10, duration: 200, onFrame: (v) => nodeFrames.push(v) }); // 'default' 槽
    m.flush();
    vp.cancelAnim(); // 只取消视口动画
    m.advance(100);
    m.flush();
    // 视口动画已死：transform 停在打断点
    expect(vp.transform.k).toBeLessThan(3);
    // 节点动画仍推进
    expect(nodeFrames.length).toBeGreaterThan(0);
    m.advance(100);
    m.flush();
    expect(nodeFrames[nodeFrames.length - 1]).toBe(10);
    expect(s.hasPending).toBe(false);
  });
});
describe('缩放平移手感（M5-T4：惯性阻尼 + 边界回弹 + 光标锚点）', () => {
  it('滚轮缩放以光标为锚：缩放后光标下的世界点保持不动', () => {
    const m = manualRaf();
    const vp = new ViewportController(new FrameScheduler({ raf: m.raf, rafCancel: m.rafCancel }));
    vp.setSize(800, 600);
    m.flush();
    vp.panBy(120, -40);
    const anchor = vp.toWorld(320, 240);
    vp.zoomAt(320, 240, 1.6);
    const after = vp.toWorld(320, 240);
    expect(after.x).toBeCloseTo(anchor.x, 5);
    expect(after.y).toBeCloseTo(anchor.y, 5);
  });

  it('越界缩放：先弹性超调再平滑回弹到硬边界（上限）', () => {
    const m = manualClockRaf();
    const s = new FrameScheduler({ raf: m.raf, rafCancel: m.rafCancel, now: m.now });
    const vp = new ViewportController(s);
    vp.setSize(800, 600);
    m.flush();
    vp.zoomAt(400, 300, 10); // raw=10 > ZOOM_MAX
    // 立即超调（弹性余量），不硬停
    expect(vp.transform.k).toBeCloseTo(ZOOM_MAX * 1.3, 6);
    // 回弹动画到硬边界
    m.advance(130);
    m.flush();
    expect(vp.transform.k).toBeCloseTo(ZOOM_MAX, 6);
    m.flush(); // 消费末帧广播
    expect(s.hasPending).toBe(false);
  });

  it('越界缩放：回弹到硬边界（下限）', () => {
    const m = manualClockRaf();
    const s = new FrameScheduler({ raf: m.raf, rafCancel: m.rafCancel, now: m.now });
    const vp = new ViewportController(s);
    vp.setSize(800, 600);
    m.flush();
    vp.zoomAt(400, 300, 0.01); // raw=0.01 < ZOOM_MIN
    expect(vp.transform.k).toBeCloseTo(ZOOM_MIN / 1.3, 6);
    m.advance(130);
    m.flush();
    expect(vp.transform.k).toBeCloseTo(ZOOM_MIN, 6);
    m.flush();
    expect(s.hasPending).toBe(false);
  });

  it('边界内缩放不受回弹影响（正常路径无动画帧）', () => {
    const m = manualClockRaf();
    const s = new FrameScheduler({ raf: m.raf, rafCancel: m.rafCancel, now: m.now });
    const vp = new ViewportController(s);
    vp.setSize(800, 600);
    m.flush();
    const rafBefore = m.rafCalls;
    vp.zoomAt(400, 300, 1.5);
    m.flush();
    expect(vp.transform.k).toBe(1.5);
    expect(m.rafCalls).toBe(rafBefore + 1); // 仅一帧广播，无回弹动画
    expect(s.hasPending).toBe(false);
  });

  it('惯性滑行：指数衰减缓停，总位移 ≈ v·τ·(1-e^-3)，结束后休眠', () => {
    const m = manualClockRaf();
    const s = new FrameScheduler({ raf: m.raf, rafCancel: m.rafCancel, now: m.now });
    const vp = new ViewportController(s);
    vp.setSize(800, 600);
    m.flush();
    vp.animateInertia(2, 0); // vx=2 px/ms, τ=240
    const TAU = 240;
    m.advance(240);
    m.flush(); // t=τ：滑行 ≈ v·τ·(1-e^-1)
    expect(vp.transform.x).toBeCloseTo(2 * TAU * (1 - Math.exp(-1)), 1);
    m.advance(480);
    m.flush(); // t=3τ：≈ v·τ·(1-e^-3)
    expect(vp.transform.x).toBeCloseTo(2 * TAU * (1 - Math.exp(-3)), 1);
    m.flush(); // 消费末帧广播
    expect(s.hasPending).toBe(false);
  });

  it('estimatePanVelocity：窗口内总位移 / 总时长；采样不足返回 0', () => {
    expect(
      estimatePanVelocity([
        { t: 0, dx: 0, dy: 0 },
        { t: 100, dx: 20, dy: 0 },
        { t: 200, dx: 20, dy: 10 },
      ]),
    ).toEqual({
      vx: 0.2,
      vy: 0.05,
    });
    expect(estimatePanVelocity([{ t: 0, dx: 5, dy: 5 }])).toEqual({ vx: 0, vy: 0 });
    expect(
      estimatePanVelocity([
        { t: 0, dx: 5, dy: 5 },
        { t: 0, dx: 5, dy: 5 },
      ]),
    ).toEqual({ vx: 0, vy: 0 }); // dt=0
  });
});
