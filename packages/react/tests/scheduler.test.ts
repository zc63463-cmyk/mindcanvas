import { describe, expect, it } from 'vitest';
import { FrameScheduler } from '../src/render/scheduler.js';

/** 可控 rAF：手动 flush 驱动帧 */
function manualRaf() {
  const pending: Array<() => void> = [];
  const raf = (cb: () => void): number => {
    pending.push(cb);
    return pending.length;
  };
  return {
    raf,
    rafCancel: () => undefined,
    pending,
    flush: () => {
      pending.splice(0).forEach((cb) => cb());
    },
  };
}

describe('FrameScheduler：dirty-flag 单帧合批（禁永续 rAF 的落地）', () => {
  it('同一帧多次 request 只调度一次 rAF，回调全部合并执行', () => {
    const m = manualRaf();
    const s = new FrameScheduler({ raf: m.raf, rafCancel: m.rafCancel });
    let n = 0;
    s.request(() => (n += 1));
    s.request(() => (n += 2));
    s.request(() => (n += 3));
    expect(m.pending.length).toBe(1); // 一帧内合并——无永续循环
    m.flush();
    expect(n).toBe(6);
    expect(s.hasPending).toBe(false); // 帧后休眠：空闲零活动
  });

  it('帧内新请求 → 调度下一帧（逐交互驱动，非轮询）', () => {
    const m = manualRaf();
    const s = new FrameScheduler({ raf: m.raf, rafCancel: m.rafCancel });
    const calls: number[] = [];
    s.onFrame(() => calls.push(1));
    m.flush();
    expect(calls).toEqual([1]);
    expect(m.pending.length).toBe(0);
    // 无新请求时再 flush 不应有新回调执行
    m.flush();
    expect(calls).toEqual([1]);
  });

  it('dispose 取消挂起帧并清空回调', () => {
    const m = manualRaf();
    const s = new FrameScheduler({ raf: m.raf, rafCancel: m.rafCancel });
    let n = 0;
    s.request(() => (n += 1));
    s.dispose();
    m.flush();
    expect(n).toBe(0);
    expect(s.hasPending).toBe(false);
  });
});
