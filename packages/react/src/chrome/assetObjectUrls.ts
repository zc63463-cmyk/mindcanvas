/**
 * 作用域感知的 objectURL 缓存（P0-B ⑥，契约 §4.5.1 §6.2 §6.3）。
 *
 * 修的是三个现状问题：
 *  - **R-07**：`WorkspaceAssetHost.objectUrls` 的键只有相对路径 —— 两个工作区
 *    各有一份 `assets/a.png` 时互相覆盖。这里键改为 `${scopeKey}::${id}`（`cacheKeyOf`）。
 *  - **R-16**：现状只有「同名替换」三个 revoke 点，断开 / 切换 / 卸载时不释放。
 *    这里提供 `releaseScope(scopeKey)`（按前缀）与 `releaseAll()`（卸载）。
 *  - 缓存无上限：提供 LRU（上限 200，契约 §2.4-3 建议值），超限 revoke 最久未用。
 *
 * 纪律（I-3）：URL 只出现在宿主返回值与渲染层 `src`，**永不**进入文档、索引主键或收藏键。
 * 本模块只保存 `id → url`，不认识文档。
 */

/** 默认 LRU 上限（契约 §2.4-3 的拟定值；不具名暴露以免调用方耦合具体数字） */
const DEFAULT_MAX = 200;

/** revoke 入口（注入以便测试断言「真的 revoke 了哪些 URL」，也让 jsdom 下可替身） */
export interface RevokeEnv {
  revokeObjectURL: (url: string) => void;
}

export class ScopedObjectUrls {
  /** 键 = `${scopeKey}::${id}`；值 = objectURL */
  private urls = new Map<string, string>();
  /** 键 → 最近使用序号（LRU 依据；单调递增，避免依赖 Date.now 的分辨率） */
  private usedAt = new Map<string, number>();
  private tick = 0;
  private readonly max: number;
  private readonly env: RevokeEnv;

  constructor(env: RevokeEnv, max = DEFAULT_MAX) {
    this.env = env;
    this.max = max;
  }

  /** 当前缓存的 URL 数（诊断与测试用；LRU 断言依赖它） */
  get size(): number {
    return this.urls.size;
  }

  /** 全部缓存键的快照（测试与诊断用；顺序 = 插入顺序） */
  keys(): string[] {
    return [...this.urls.keys()];
  }

  /** 取 URL 并刷新 LRU 位置（不存在 → null） */
  get(key: string): string | null {
    const url = this.urls.get(key);
    if (url === undefined) return null;
    this.tick += 1;
    this.usedAt.set(key, this.tick);
    return url;
  }

  /**
   * 写入 URL：**同键先 revoke 旧值**（同名替换路径，既有行为保留）。
   * 写入后若超上限，按 LRU 淘汰到上限。
   */
  set(key: string, url: string): void {
    const prev = this.urls.get(key);
    if (prev !== undefined && prev !== url) this.env.revokeObjectURL(prev);
    this.urls.set(key, url);
    this.tick += 1;
    this.usedAt.set(key, this.tick);
    this.evict();
  }

  /** 该键是否已有缓存（不刷新 LRU；`hasAsset` 的同步判定用它） */
  has(key: string): boolean {
    return this.urls.has(key);
  }

  /** 释放单个键（`disposeScope` 的细粒度版；不存在则无操作） */
  release(key: string): void {
    const url = this.urls.get(key);
    if (url === undefined) return;
    this.env.revokeObjectURL(url);
    this.urls.delete(key);
    this.usedAt.delete(key);
  }

  /**
   * 释放**某个作用域**的全部 URL（按 `scopeKey` 前缀过滤）。
   * 用于 `pick` / `detach` / 替换目录 —— 只碰该作用域，不影响其他作用域（契约 §6.3）。
   */
  releaseScope(scopeKey: string): number {
    const prefix = `${scopeKey}::`;
    let released = 0;
    for (const key of [...this.urls.keys()]) {
      if (!key.startsWith(prefix)) continue;
      this.release(key);
      released += 1;
    }
    return released;
  }

  /** 释放全部（组件卸载；宿主实例被复用时的兜底） */
  releaseAll(): number {
    const n = this.urls.size;
    for (const key of [...this.urls.keys()]) this.release(key);
    return n;
  }

  /** LRU 淘汰：超出上限时 revoke 最久未用的键 */
  private evict(): void {
    while (this.urls.size > this.max) {
      let oldestKey: string | null = null;
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const key of this.urls.keys()) {
        const at = this.usedAt.get(key) ?? 0;
        if (at < oldestAt) {
          oldestAt = at;
          oldestKey = key;
        }
      }
      if (oldestKey === null) return;
      this.release(oldestKey);
    }
  }
}
