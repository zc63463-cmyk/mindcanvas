import { describe, expect, it } from 'vitest';
import {
  SCALE_NOTICE_HUGE,
  SCALE_NOTICE_LARGE,
  scaleNoticeFor,
} from '../src/chrome/scaleNotice.js';

describe('规模提示（A3：T8 降级策略 L4）', () => {
  it('≤20K → 无提示', () => {
    expect(scaleNoticeFor(0)).toBeNull();
    expect(scaleNoticeFor(5000)).toBeNull();
    expect(scaleNoticeFor(20000)).toBeNull();
  });

  it('>20K → 激进简化提示（含节点数）', () => {
    const msg = scaleNoticeFor(30000);
    expect(msg).not.toBeNull();
    expect(msg).toContain('30,000');
    expect(msg).toContain('激进简化');
  });

  it('>50K → 必须降级提示（建议折叠）', () => {
    const msg = scaleNoticeFor(88000);
    expect(msg).not.toBeNull();
    expect(msg).toContain('88,000');
    expect(msg).toContain('折叠');
  });

  it('阈值常量与 T8 基准档位一致', () => {
    expect(SCALE_NOTICE_LARGE).toBe(20000);
    expect(SCALE_NOTICE_HUGE).toBe(50000);
  });
});
