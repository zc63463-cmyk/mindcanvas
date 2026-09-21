/**
 * PluginHost —— 插件生命周期宿主（T3 · Obsidian 模式生命周期自注销在 react 侧生效）。
 * - load：挂载插件（onload 钩子 + registerInto 注册项）
 * - unload：卸载插件（onunload 钩子 + 注册项自动注销——kernel Plugin 基类契约）
 * - unloadAll：宿主销毁时全量卸载（应用关闭清理）
 * react 侧验证点：插件 onload 注册的 DOM 事件监听 / 副作用由 onunload 清理，
 * 注册表条目由 Plugin.unload 自动注销（测试断言 has() === false）。
 */
import type { Plugin } from '@mindcanvas/kernel';

export class PluginHost {
  private plugins: Plugin[] = [];

  get active(): readonly Plugin[] {
    return this.plugins;
  }

  get size(): number {
    return this.plugins.length;
  }

  /** 挂载插件（重复挂载同一实例 → 忽略） */
  async load(plugin: Plugin): Promise<void> {
    if (this.plugins.includes(plugin)) return;
    await plugin.load();
    this.plugins.push(plugin);
  }

  /** 卸载插件（可重复调用：第二次为空操作——Plugin.unload 幂等） */
  async unload(plugin: Plugin): Promise<void> {
    if (!this.plugins.includes(plugin)) return;
    await plugin.unload();
    this.plugins = this.plugins.filter((p) => p !== plugin);
  }

  /** 卸载全部（逆序，后挂载先卸载——依赖次序安全） */
  async unloadAll(): Promise<void> {
    for (const p of [...this.plugins].reverse()) {
      await p.unload();
    }
    this.plugins = [];
  }
}
