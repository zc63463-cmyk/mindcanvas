import { describe, expect, it } from 'vitest';
import {
  ChannelRegistry,
  KindRegistry,
  LayoutRegistry,
  NoteKeyRegistry,
  RendererRegistry,
  SemanticsRegistry,
  type Channel,
  type KindMeta,
  type LayoutAlgorithm,
  type NoteKeyHandler,
  type SemRoleMapping,
  createKernelRegistries,
} from '../src/registry/index.js';

describe('空实现：无插件时内核照常工作', () => {
  it('createKernelRegistries 六注册表初始为空（list 空 / get undefined / has false）', () => {
    const r = createKernelRegistries();
    expect(r.kinds.list()).toHaveLength(0);
    expect(r.noteKeys.list()).toHaveLength(0);
    expect(r.renderers.list()).toHaveLength(0);
    expect(r.layouts.list()).toHaveLength(0);
    expect(r.semantics.list()).toHaveLength(0);
    expect(r.channels.list()).toHaveLength(0);
    expect(r.kinds.get('issue')).toBeUndefined();
    expect(r.kinds.has('issue')).toBe(false);
  });
});

describe('Registry 通用语义', () => {
  it('register → get/has/list，unregister 后条目消失', () => {
    const kinds = new KindRegistry();
    const meta: KindMeta = { label: 'issue', color: '#d97706' };
    const handle = kinds.register('issue', meta);
    expect(kinds.get('issue')).toBe(meta);
    expect(kinds.has('issue')).toBe(true);
    expect(kinds.list()).toEqual([{ key: 'issue', item: meta }]);
    handle.unregister();
    expect(kinds.has('issue')).toBe(false);
  });

  it('unregister 幂等：重复调用安全', () => {
    const kinds = new KindRegistry();
    const handle = kinds.register('issue', { label: 'issue', color: '#d97706' });
    handle.unregister();
    handle.unregister();
    expect(kinds.has('issue')).toBe(false);
  });

  it('同 key 重复注册覆盖旧条目；旧句柄注销不误删新条目', () => {
    const kinds = new KindRegistry();
    const oldMeta: KindMeta = { label: 'issue-old', color: '#111111' };
    const newMeta: KindMeta = { label: 'issue-new', color: '#222222' };
    const oldHandle = kinds.register('issue', oldMeta);
    const newHandle = kinds.register('issue', newMeta);
    expect(kinds.get('issue')).toBe(newMeta);
    oldHandle.unregister();
    expect(kinds.get('issue')).toBe(newMeta);
    newHandle.unregister();
    expect(kinds.has('issue')).toBe(false);
  });
});

describe('KindRegistry', () => {
  it('注册 kind 元信息（label/color），可选 validateId 生效', () => {
    const kinds = new KindRegistry();
    kinds.register('session', {
      label: 'session',
      color: '#0c8599',
      validateId: (id) => /^[1-9][0-9]*$/.test(id),
    });
    const meta = kinds.get('session');
    expect(meta?.label).toBe('session');
    expect(meta?.validateId?.('42')).toBe(true);
    expect(meta?.validateId?.('x')).toBe(false);
  });
});

describe('NoteKeyRegistry', () => {
  it('注册笔记透传键语义处理器', () => {
    const noteKeys = new NoteKeyRegistry();
    const handler: NoteKeyHandler = { description: '语义关系连线', parse: (v) => v };
    const handle = noteKeys.register('links', handler);
    expect(noteKeys.get('links')).toBe(handler);
    handle.unregister();
    expect(noteKeys.has('links')).toBe(false);
  });
});

describe('RendererRegistry 泛型槽位（不依赖 react）', () => {
  it('按 kind 注册不透明渲染策略，react 侧注入具体类型', () => {
    const renderers = new RendererRegistry<{ componentId: string }>();
    const strategy = { componentId: 'EntityBadge' };
    renderers.register('session', strategy);
    expect(renderers.get('session')).toBe(strategy);
    expect(renderers.get('session')?.componentId).toBe('EntityBadge');
  });
});

describe('LayoutRegistry', () => {
  it('按算法名注册/查询', () => {
    const layouts = new LayoutRegistry<{ count: number }, { height: number }>();
    const algo: LayoutAlgorithm<{ count: number }, { height: number }> = {
      name: 'tree-right',
      layout: (input) => ({ height: input.count * 10 }),
    };
    layouts.register(algo.name, algo);
    expect(layouts.get('tree-right')?.layout({ count: 3 })).toEqual({ height: 30 });
  });
});

describe('SemanticsRegistry', () => {
  it('按语义角色注册 SemRole → action 映射', () => {
    const semantics = new SemanticsRegistry();
    const mapping: SemRoleMapping = {
      role: 'task',
      action: 'create_issue',
      description: '待办任务落库为 issue',
    };
    semantics.register(mapping.role, mapping);
    expect(semantics.get('task')?.action).toBe('create_issue');
  });
});

describe('ChannelRegistry', () => {
  it('按通道 id 注册三通道之一', () => {
    const channels = new ChannelRegistry();
    const channel: Channel = { id: 'forgejo-mcp', kind: 'mcp', description: 'MCP 工具面' };
    channels.register(channel.id, channel);
    expect(channels.get('forgejo-mcp')?.kind).toBe('mcp');
  });
});
