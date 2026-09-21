/**
 * G-P6：自由边路由结果 LRU 缓存（方案 A）。
 *
 * 对症场景（perf-baseline.md §8 G-P5 复测）：「成员变化但端点盒未变」的 pan ——
 * G-P1/P2 后成员不变 = 0 次重算，但成员一旦进出，`FreeEdgeLayer` 的 routes memo
 * 仍整表重算（E=100×10K ≈ 1.3s 卡顿级）。缓存把「端点解析输出未变的边」的上次
 * RouteResult 复用起来：命中则不调 routeAesthetic，跨边累积 routedPolylines 仍按
 * 边序推进（命中项也 push points）→ 跨边协调的输入集语义不漂移。
 *
 * key 口径（G-P6 计划「edge.key + 端点盒 + collapsed 版本 + manual」的实现化）：
 * collapsed 对路由的全部影响都经 `freeEdgeEndpoints` 的解析输出（fromId/toId +
 * 两端盒）进入 key —— 折叠集变化必然改变解析输出或端点盒，无需单独版本号；
 * 另含 manual 几何 / routingSide / stagger（seq），后两者是 routeAesthetic 的
 * 显式入参，漏掉会服务过期形状。障碍集与跨边 polyline 不入 key（设计内：
 * 命中场景即「障碍未变、仅成员进出」；障碍表换代由 FreeEdgeLayer 的 gen 换代兜底）。
 *
 * 开关：FREEEDGE_ROUTE_CACHE 环境变量（'1' = 开）。**默认关**（G-P6 计划纪律：
 * 带开关落地，是否默认开启由收口实测决定）。
 */
import type { FreeEdge, EdgeEndpoints } from './freeEdges.js';

/** 环境读取（不经 node 类型；浏览器无 process → undefined → 默认关） */
function envFlag(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process;
  return proc?.env?.[name];
}

export const routeCacheConfig = {
  enabled: envFlag('FREEEDGE_ROUTE_CACHE') === '1',
};

/** LRU（Map 插入序 = recency 序；get/set 命中即移到末尾，超容量逐出最旧项） */
export class LruCache<K, V> {
  private map = new Map<K, V>();
  constructor(readonly max: number) {
    if (!(max > 0)) throw new Error('LruCache max must be > 0');
  }

  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, value);
  }
}

/** 路由结果缓存 key（见文件头「key 口径」） */
export function routeCacheKey(edge: FreeEdge, eps: EdgeEndpoints, seq: number): string {
  return (
    `${edge.key}|${eps.fromId}|${eps.toId}` +
    `|${eps.from.x},${eps.from.y},${eps.from.w},${eps.from.h}` +
    `|${eps.to.x},${eps.to.y},${eps.to.w},${eps.to.h}` +
    `|${edge.manual ? JSON.stringify(edge.manual) : ''}` +
    `|${edge.routingSide ?? ''}|${seq}`
  );
}
