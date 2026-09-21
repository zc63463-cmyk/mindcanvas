/**
 * 注册表公共底座：UnregisterHandle + 通用 Registry<T>。
 * 六注册表统一语义：`register()` 返回可释放句柄；插件侧（Plugin 基类）收集句柄，
 * 随插件 onunload 自动注销（Obsidian 模式生命周期自注销）。
 */

/** 可释放句柄：register() 的返回值；unregister() 注销该条注册，可重复调用（幂等） */
export interface UnregisterHandle {
  unregister(): void;
}

/**
 * 通用注册表空实现（六注册表的公共底座）。
 * 未注册任何条目时内核照常工作（渐进增强架构：插件列表为空 = 纯文本内核全功能）。
 */
export class Registry<T> {
  private readonly items = new Map<string, T>();

  /** 注册条目并返回可释放句柄；同一 key 重复注册将覆盖旧条目（旧句柄注销时不会误删新条目） */
  register(key: string, item: T): UnregisterHandle {
    this.items.set(key, item);
    let disposed = false;
    return {
      unregister: () => {
        if (disposed) return;
        disposed = true;
        if (this.items.get(key) === item) {
          this.items.delete(key);
        }
      },
    };
  }

  /** 按 key 查询条目；未注册返回 undefined */
  get(key: string): T | undefined {
    return this.items.get(key);
  }

  /** 是否已注册该 key */
  has(key: string): boolean {
    return this.items.has(key);
  }

  /** 列出全部条目（/schema 语义注册表自动生成的素材） */
  list(): ReadonlyArray<{ key: string; item: T }> {
    return [...this.items.entries()].map(([key, item]) => ({ key, item }));
  }
}
