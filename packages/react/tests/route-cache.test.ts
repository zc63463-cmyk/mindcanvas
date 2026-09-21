/**
 * G-P6：路由结果缓存 —— LRU 工具与开关的单测（先红）。
 *
 * 机制判别（React 层「成员变化但端点盒未变 → 命中 → 零重算」）见
 * `freeedge-route-cache.test.tsx`；本文件只钉死工具自身语义：
 *   ① get 命中返回同引用并刷新 recency（最近使用的最后逐出）；
 *   ② 超容量逐出「最久未用」项（LRU 而非 FIFO——命中即续命）；
 *   ③ set 已存在 key = 更新值 + 刷新 recency，不产生重复条目；
 *   ④ 开关默认关（FREEEDGE_ROUTE_CACHE 未设时 enabled === false）。
 */
import { describe, expect, it } from 'vitest';
import { LruCache, routeCacheConfig } from '../src/render/routeCache.js';

describe('G-P6 路由缓存工具', () => {
  it('① get 命中返回同引用；未命中返回 undefined', () => {
    const c = new LruCache<string, object>(4);
    const v = { d: 'M 0 0' };
    expect(c.get('k')).toBeUndefined();
    c.set('k', v);
    expect(c.get('k')).toBe(v);
  });

  it('② 超容量逐出最久未用项；get 命中刷新 recency（命中者不背逐出）', () => {
    const c = new LruCache<string, number>(3);
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    // 访问 a → b 成为最久未用
    expect(c.get('a')).toBe(1);
    c.set('d', 4); // 逐出 b
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
    expect(c.get('c')).toBe(3);
    expect(c.get('d')).toBe(4);
  });

  it('③ set 已存在 key：更新值并刷新 recency，不重复占位', () => {
    const c = new LruCache<string, number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.set('a', 9); // 更新 a（刷新 recency）→ 最久未用是 b
    expect(c.get('a')).toBe(9);
    c.set('c', 3); // 逐出 b
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(9);
    expect(c.get('c')).toBe(3);
  });

  it('④ 开关默认关（FREEEDGE_ROUTE_CACHE 未设 → enabled === false）', () => {
    expect(routeCacheConfig.enabled).toBe(false);
  });
});
