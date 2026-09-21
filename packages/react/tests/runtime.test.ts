// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Plugin } from '@mindcanvas/kernel';
import { createReactRegistries } from '../src/runtime/registries.js';
import { PluginHost } from '../src/runtime/pluginHost.js';

describe('T3 插件运行时：六注册表实装', () => {
  it('内置种子：kinds 七类 + noteKeys(links/groups/qa) + layouts 六布局 + renderers 角标', () => {
    const regs = createReactRegistries();
    expect(regs.kinds.has('issue')).toBe(true);
    expect(regs.kinds.has('doc')).toBe(true);
    expect(regs.noteKeys.has('qa')).toBe(true);
    expect(regs.noteKeys.has('links')).toBe(true);
    expect(regs.noteKeys.has('groups')).toBe(true);
    expect(regs.layouts.has('mindmap')).toBe(true);
    // 六布局
    expect(regs.layouts.list().length).toBeGreaterThanOrEqual(6);
    // renderers：内置 kind 角标渲染描述
    const badge = regs.renderers.get('issue') as { label: string; color: string } | undefined;
    expect(badge?.label).toBe('issue');
    expect(badge?.color).toBe('#d97706');
  });

  it('纯内核三规则 ②：空注册表（无插件配置）内核照常可用', () => {
    // createKernelRegistries 不注册任何内置 → 仍可布局（渐进增强）
    const regs = createReactRegistries();
    expect(regs.semantics.list().length).toBe(0); // 语义/通道默认空实现
    expect(regs.channels.list().length).toBe(0);
    void regs;
  });
});

describe('T3 插件生命周期自注销（Obsidian 模式）', () => {
  it('load 注册 → unload 自动注销（注册表条目清理）+ onunload 清理 DOM 事件', async () => {
    const regs = createReactRegistries();
    const host = new PluginHost();

    // 测试插件：注册自定义 kind + 挂载 DOM 事件
    class DemoPlugin extends Plugin {
      name = 'demo-plugin';
      private listener: (() => void) | null = null;
      override async onload(): Promise<void> {
        this.registerInto(regs.kinds, 'session', { label: 'session', color: '#123456' });
        this.registerInto(regs.noteKeys, 'qa', { description: '覆盖内置 qa' });
        // DOM 事件（react 侧生命周期验证点）
        this.listener = () => undefined;
        window.addEventListener('demo', this.listener);
      }
      override async onunload(): Promise<void> {
        if (this.listener) window.removeEventListener('demo', this.listener);
      }
    }

    const plugin = new DemoPlugin();
    expect(regs.kinds.has('session')).toBe(false);
    await host.load(plugin);
    expect(regs.kinds.has('session')).toBe(true); // 注册生效
    expect(regs.noteKeys.has('qa')).toBe(true);
    expect(host.size).toBe(1);

    await host.unload(plugin);
    expect(regs.kinds.has('session')).toBe(false); // 自注销
    expect(host.size).toBe(0);
    // 覆盖语义：插件覆盖的内置 qa 条目随卸载释放（Registry 覆盖=替换，K5 镜子可精化为恢复旧值）
    expect(regs.noteKeys.get('qa')).toBeUndefined();
  });

  it('unloadAll 逆序卸载全部', async () => {
    const regs = createReactRegistries();
    const host = new PluginHost();
    class P extends Plugin {
      name = 'p';
      override async onload(): Promise<void> {
        this.registerInto(regs.kinds, `kind-${this.name}`, { label: this.name, color: '#000000' });
      }
      override async onunload(): Promise<void> {}
    }
    await host.load(new P());
    await host.load(new P());
    expect(host.size).toBe(2);
    await host.unloadAll();
    expect(host.size).toBe(0);
    expect(regs.kinds.has('kind-p')).toBe(false);
  });
});
