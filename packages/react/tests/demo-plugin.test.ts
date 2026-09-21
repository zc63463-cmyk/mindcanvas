// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createReactRegistries, PluginHost } from '@mindcanvas/react';
import { DemoPlugin } from '../src/plugins/demoPlugin.js';

describe('T5 插件样例：DemoPlugin 组合能力 + 生命周期自注销', () => {
  it('load 注册四类组合面（kind/语义键/renderer/DOM 事件），unload 全部自注销', async () => {
    const regs = createReactRegistries();
    const host = new PluginHost();
    const plugin = new DemoPlugin(regs);

    // load 前无组合面
    expect(regs.kinds.has('session')).toBe(false);
    expect(regs.noteKeys.has('ai_role')).toBe(false);
    expect(regs.renderers.has('qa-badge')).toBe(false);

    await host.load(plugin);
    // 组合能力生效
    expect(regs.kinds.has('session')).toBe(true);
    expect(regs.kinds.get('session')?.validateId?.('abc_123')).toBe(true);
    expect(regs.kinds.get('session')?.validateId?.('bad id')).toBe(false); // 自定义 kind 级校验
    expect(regs.noteKeys.has('ai_role')).toBe(true);
    const badge = regs.renderers.get('qa-badge') as { label: string; color: string } | undefined;
    expect(badge?.label).toBe('qa');
    expect(host.size).toBe(1);

    await host.unload(plugin);
    // 自注销：注册项全部释放（Obsidian 模式）
    expect(regs.kinds.has('session')).toBe(false);
    expect(regs.noteKeys.has('ai_role')).toBe(false);
    expect(regs.renderers.has('qa-badge')).toBe(false);
    expect(host.size).toBe(0);
  });

  it('插件列表为空时（纯文本版）注册表面保持内置种子', () => {
    const regs = createReactRegistries();
    // 不挂插件 → 内置种子不受影响
    expect(regs.kinds.has('issue')).toBe(true);
    expect(regs.noteKeys.has('qa')).toBe(true);
    expect(regs.layouts.has('mindmap')).toBe(true);
  });
});
