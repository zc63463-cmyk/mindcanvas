/**
 * Plugin 基类：生命周期 onload / onunload + 注册自注销（Obsidian 模式）。
 * 插件经 `registerInto` 注册的一切（各注册表条目）随 `unload()` 自动清理 ——
 * 生命周期自注销是本内核的硬性设计要求（调研报告 §4）。
 */
import { type Registry, type UnregisterHandle } from '../registry/registry.js';

export abstract class Plugin {
  /** 插件名（唯一标识） */
  abstract readonly name: string;

  /** 挂载钩子：在此经 `registerInto` 注册各项能力（kind / note 键 / 渲染器 / 布局 / 语义映射 / 通道） */
  abstract onload(): void | Promise<void>;

  /** 卸载钩子：插件自身额外清理（如关闭资源）；基类随后自动注销全部注册项 */
  abstract onunload(): void | Promise<void>;

  /** 本插件经 registerInto 收集的注册句柄（unload 时逐一注销） */
  private readonly handles = new Set<UnregisterHandle>();

  /**
   * 注册并纳入插件生命周期：插件 unload 时自动注销。
   * 仅经本方法注册的条目享受自注销；插件直接调用 registry.register 的条目
   * 需插件在 onunload 内自行清理（契约边界，Obsidian 同款约定）。
   */
  protected registerInto<T>(registry: Registry<T>, key: string, item: T): void {
    this.handles.add(registry.register(key, item));
  }

  /** 挂载入口：执行 onload 钩子 */
  async load(): Promise<void> {
    await this.onload();
  }

  /**
   * 卸载入口：先执行插件 onunload 钩子，再自动注销全部经 registerInto 注册的条目。
   * 可重复调用（幂等，第二次为空操作）。
   */
  async unload(): Promise<void> {
    await this.onunload();
    for (const handle of this.handles) handle.unregister();
    this.handles.clear();
  }
}
