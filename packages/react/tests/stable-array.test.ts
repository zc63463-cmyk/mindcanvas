/**
 * G-P1：stableByKeys —— 内容键相同 → 复用 prev 引用（React memo 友好）。
 *
 * 语义守护（防陈旧渲染）：只有「长度一致 && 逐项 key 一致」才复用；
 * 成员增/删/换序一律返回 next 引用。
 */
import { describe, expect, it } from 'vitest';
import { stableByKeys } from '../src/render/stableArray.js';

interface Item {
  key: string;
  v: number;
}

const keyOf = (t: Item): string => t.key;

describe('stableByKeys', () => {
  it('长度与逐项 key 相同 → 返回 prev 引用（即使对象都是新造的）', () => {
    const prev: readonly Item[] = [
      { key: 'a', v: 1 },
      { key: 'b', v: 2 },
    ];
    const next: readonly Item[] = [
      { key: 'a', v: 9 },
      { key: 'b', v: 8 },
    ];
    expect(stableByKeys(prev, next, keyOf)).toBe(prev);
  });

  it('成员删除 → 返回 next 引用', () => {
    const prev: readonly Item[] = [
      { key: 'a', v: 1 },
      { key: 'b', v: 2 },
    ];
    const next: readonly Item[] = [{ key: 'a', v: 1 }];
    expect(stableByKeys(prev, next, keyOf)).toBe(next);
  });

  it('成员新增 → 返回 next 引用', () => {
    const prev: readonly Item[] = [{ key: 'a', v: 1 }];
    const next: readonly Item[] = [
      { key: 'a', v: 1 },
      { key: 'b', v: 2 },
    ];
    expect(stableByKeys(prev, next, keyOf)).toBe(next);
  });

  it('同成员换序（key 序列不同）→ 返回 next 引用', () => {
    const prev: readonly Item[] = [
      { key: 'a', v: 1 },
      { key: 'b', v: 2 },
    ];
    const next: readonly Item[] = [
      { key: 'b', v: 2 },
      { key: 'a', v: 1 },
    ];
    expect(stableByKeys(prev, next, keyOf)).toBe(next);
  });

  it('prev 为 null（首次）→ 返回 next 引用', () => {
    const next: readonly Item[] = [{ key: 'a', v: 1 }];
    expect(stableByKeys(null, next, keyOf)).toBe(next);
  });

  it('两侧皆空 → 返回 prev 引用（空数组不是「换引用」的理由）', () => {
    const prev: readonly Item[] = [];
    const next: readonly Item[] = [];
    expect(stableByKeys(prev, next, keyOf)).toBe(prev);
  });

  it('next 为空而 prev 非空 → 返回 next 引用', () => {
    const prev: readonly Item[] = [{ key: 'a', v: 1 }];
    const next: readonly Item[] = [];
    expect(stableByKeys(prev, next, keyOf)).toBe(next);
  });

  it('keyOf 每项恰调用 2 次（prev/next 各一）——不做深比较', () => {
    let calls = 0;
    const counted = (t: Item): string => {
      calls++;
      return t.key;
    };
    const prev: readonly Item[] = [{ key: 'a', v: 1 }];
    const next: readonly Item[] = [{ key: 'a', v: 2 }];
    expect(stableByKeys(prev, next, counted)).toBe(prev);
    expect(calls).toBe(2);
  });
});
