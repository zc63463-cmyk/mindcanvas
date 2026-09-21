import { describe, expect, it, vi } from 'vitest';
import { Plugin } from '../src/plugin/plugin.js';
import { KindRegistry } from '../src/registry/kind.js';
import { NoteKeyRegistry } from '../src/registry/note-key.js';

/** 测试插件：onload 时经 registerInto 注册一个 kind + 一个 note 键，并记录 onunload 调用 */
class DemoPlugin extends Plugin {
  readonly name = 'demo';

  constructor(
    private readonly kinds: KindRegistry,
    private readonly noteKeys: NoteKeyRegistry,
    readonly kindName = 'session',
    readonly unloadSpy = vi.fn(),
  ) {
    super();
  }

  override async onload(): Promise<void> {
    this.registerInto(this.kinds, this.kindName, { label: this.kindName, color: '#0c8599' });
    this.registerInto(this.noteKeys, 'links', { description: '语义关系连线' });
  }

  override async onunload(): Promise<void> {
    this.unloadSpy();
  }
}

describe('Plugin 生命周期自注销', () => {
  it('load 注册 → unload 自动清理：注册表清空 + onunload 钩子被调用', async () => {
    const kinds = new KindRegistry();
    const noteKeys = new NoteKeyRegistry();
    const plugin = new DemoPlugin(kinds, noteKeys);

    await plugin.load();
    expect(kinds.has('session')).toBe(true);
    expect(noteKeys.has('links')).toBe(true);

    await plugin.unload();
    expect(plugin.unloadSpy).toHaveBeenCalledOnce();
    expect(kinds.has('session')).toBe(false);
    expect(noteKeys.has('links')).toBe(false);
    // 注册表回到空实现状态（无插件时内核照常工作）
    expect(kinds.list()).toHaveLength(0);
    expect(noteKeys.list()).toHaveLength(0);
  });

  it('多插件各自清理：互不影响（各自注册不同 kind key）', async () => {
    const kinds = new KindRegistry();
    const a = new DemoPlugin(kinds, new NoteKeyRegistry(), 'session');
    const b = new DemoPlugin(kinds, new NoteKeyRegistry(), 'task');
    await a.load();
    await b.load();
    expect(kinds.list()).toHaveLength(2);
    expect(kinds.has('session')).toBe(true);
    expect(kinds.has('task')).toBe(true);
    await a.unload();
    expect(kinds.list()).toHaveLength(1);
    expect(kinds.has('session')).toBe(false);
    expect(kinds.has('task')).toBe(true);
    await b.unload();
    expect(kinds.list()).toHaveLength(0);
  });

  it('unload 幂等：重复调用安全', async () => {
    const kinds = new KindRegistry();
    const plugin = new DemoPlugin(kinds, new NoteKeyRegistry());
    await plugin.load();
    await plugin.unload();
    await expect(plugin.unload()).resolves.toBeUndefined();
    expect(kinds.list()).toHaveLength(0);
  });

  it('契约边界：直接 registry.register（不经 registerInto）不享受自注销', async () => {
    const kinds = new KindRegistry();
    class ManualPlugin extends Plugin {
      readonly name = 'manual';
      override async onload(): Promise<void> {
        kinds.register('doc', { label: 'doc', color: '#2f9e44' }); // 直接注册，未纳入生命周期
      }
      override async onunload(): Promise<void> {}
    }
    const plugin = new ManualPlugin();
    await plugin.load();
    await plugin.unload();
    // 直接注册条目仍在：需插件在 onunload 自行清理（契约边界）
    expect(kinds.has('doc')).toBe(true);
  });
});
