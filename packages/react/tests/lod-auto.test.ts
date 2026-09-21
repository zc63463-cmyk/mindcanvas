import { describe, expect, it } from 'vitest';
import { LOD_AUTO_NODES, lodFor, lodSkipText } from '../src/render/geometry.js';

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
