import { describe, expect, it } from 'vitest';
import { LOD_AUTO_NODES, LOD_HYSTERESIS, lodFor, lodSkipText } from '../src/render/geometry.js';

describe('LOD 自动降级（A2：T8 降级策略 L1 接线）', () => {
  it('≤ 阈值：行为与既有完全一致（回归）', () => {
    expect(lodFor(0.6)).toBe('full');
    expect(lodFor(0.4)).toBe('detail');
    expect(lodFor(0.2)).toBe('skeleton');
    expect(lodFor(0.4, 5000)).toBe('detail'); // 恰等于阈值不降级
    expect(lodFor(0.4, undefined)).toBe('detail');
  });

  it('> 阈值：skeleton 覆盖扩大（k∈[0.26,0.4) 由 detail → skeleton）', () => {
    expect(lodFor(0.3, 6000)).toBe('skeleton'); // 原 detail → 激进 skeleton
    expect(lodFor(0.26, 6000)).toBe('skeleton');
    expect(lodFor(0.45, 6000)).toBe('detail'); // 激进 detail 区间 [0.4, 0.5)
  });

  it('近距离（k≥0.5）始终 full——大图降级不牺牲眼前阅读', () => {
    expect(lodFor(0.6, 50000)).toBe('full');
    expect(lodFor(0.5, 50000)).toBe('full');
  });

  it('阈值常量可读：5000（与 T8 基准 5K 档一致）', () => {
    expect(LOD_AUTO_NODES).toBe(5000);
  });

  it('lodSkipText 语义不变（skeleton 全省 / detail 省 depth≥2）', () => {
    expect(lodSkipText('skeleton', 0)).toBe(true);
    expect(lodSkipText('detail', 1)).toBe(false);
    expect(lodSkipText('detail', 2)).toBe(true);
    expect(lodSkipText('full', 3)).toBe(false);
  });
});

/**
 * LOD 滞回（MEASURE-RANK 后续）：进出档用不同阈值，防 fit/缩放把 k 停在 0.5 / 0.26 附近
 * 时密叶文字随 ±0.001 抖动反复进出（DEPTH-VIS-1 实测 k=0.4938 压线即为该抖动域的实证）。
 * 不给 `prev` 时逐值等于旧行为（老调用方与非 MapView 调用零影响）。
 */
describe('LOD 滞回：已在某档时按「阈值 − ε」退出', () => {
  it('full 档：已在 full 时 k 略低于 0.5 仍保持 full（升档仍需 ≥0.5）', () => {
    const k = 0.5 - LOD_HYSTERESIS / 2; // 0.49
    expect(lodFor(k)).toBe('detail'); // 无 prev → 旧行为
    expect(lodFor(k, undefined, 'full')).toBe('full');
    expect(lodFor(0.5 - LOD_HYSTERESIS - 0.001, undefined, 'full')).toBe('detail'); // 跌破 ε 带才降
    expect(lodFor(0.49, undefined, 'detail')).toBe('detail'); // 非 full 档不给滞回
  });

  it('detail 档：已在 detail 时 k 略低于 0.26 仍保持 detail', () => {
    const k = 0.26 - LOD_HYSTERESIS / 2;
    expect(lodFor(k)).toBe('skeleton');
    expect(lodFor(k, undefined, 'detail')).toBe('detail');
    expect(lodFor(0.26 - LOD_HYSTERESIS - 0.001, undefined, 'detail')).toBe('skeleton');
  });

  it('大图档（>5000 节点）：detail 阈值 0.4 同样带滞回', () => {
    const k = 0.4 - LOD_HYSTERESIS / 2;
    expect(lodFor(k, 6000)).toBe('skeleton');
    expect(lodFor(k, 6000, 'detail')).toBe('detail');
    expect(lodFor(0.5, 6000, 'detail')).toBe('full'); // 升档阈值不变
  });

  it('滞回带宽是**小量**（≤0.05）：不得把档位判定整体挪走', () => {
    expect(LOD_HYSTERESIS).toBeGreaterThan(0);
    expect(LOD_HYSTERESIS).toBeLessThanOrEqual(0.05);
  });
});
