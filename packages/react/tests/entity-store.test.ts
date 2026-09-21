// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ENTITY_STORE_MAX,
  HttpEntityHost,
  LocalEntityStore,
  entityKeyOf,
} from '../src/chrome/entityStore.js';

describe('实体候选宿主（N1：跨文档复用）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('空 store → list 为空', () => {
    expect(new LocalEntityStore().list()).toEqual([]);
  });

  it('remember 登记：新实体入表（title/usedAt/docs）', () => {
    const s = new LocalEntityStore();
    s.remember([{ kind: 'issue', id: '1', title: '门户显示优化' }], 'gateway.mm.md');
    const list = s.list();
    expect(list.length).toBe(1);
    expect(list[0]).toMatchObject({
      kind: 'issue',
      id: '1',
      title: '门户显示优化',
      docs: ['gateway.mm.md'],
    });
  });

  it('去重：同 ref 再次登记 → 一条（docs 合并 + usedAt 更新）', () => {
    const s = new LocalEntityStore();
    s.remember([{ kind: 'issue', id: '1', title: '门户显示优化' }], 'a.mm.md');
    s.remember([{ kind: 'issue', id: '1', title: '门户显示优化' }], 'b.mm.md');
    const list = s.list();
    expect(list.length).toBe(1);
    expect(list[0]!.docs).toEqual(['a.mm.md', 'b.mm.md']);
  });

  it('标题策略：真标题覆盖；传入 title 等于 id 时保留既有标题', () => {
    const s = new LocalEntityStore();
    s.remember([{ kind: 'issue', id: '1', title: '门户显示优化' }], 'a.mm.md');
    s.remember([{ kind: 'issue', id: '1', title: '1' }], 'a.mm.md'); // 无标题（=id）
    expect(s.list()[0]!.title).toBe('门户显示优化');
    s.remember([{ kind: 'issue', id: '1', title: '新标题' }], 'a.mm.md');
    expect(s.list()[0]!.title).toBe('新标题');
  });

  it('上限裁剪（LRU）：超出 200 时保留最近使用', () => {
    const s = new LocalEntityStore();
    for (let i = 0; i < ENTITY_STORE_MAX + 20; i++) {
      s.remember([{ kind: 'issue', id: `i${i}`, title: `t${i}` }], 'a.mm.md');
    }
    const list = s.list();
    expect(list.length).toBe(ENTITY_STORE_MAX);
    expect(list[0]!.id).toBe(`i${ENTITY_STORE_MAX + 19}`); // 最新在前（LRU 生效）
  });

  it('持久化往返：新实例可读回（跨会话复用）', () => {
    new LocalEntityStore().remember([{ kind: 'doc', id: 'docs/a.md', title: '架构' }], 'a.mm.md');
    const again = new LocalEntityStore().list();
    expect(again.length).toBe(1);
    expect(again[0]!.title).toBe('架构');
  });

  it('remove 删除；search 按 kind/id/title 过滤', () => {
    const s = new LocalEntityStore();
    s.remember(
      [
        { kind: 'issue', id: '1', title: '门户显示优化' },
        { kind: 'doc', id: 'docs/a.md', title: '架构' },
      ],
      'a.mm.md',
    );
    expect(s.search('架构').length).toBe(1);
    expect(s.search('docs/').length).toBe(1);
    expect(s.search('issue').length).toBe(1);
    expect(s.search('').length).toBe(2);
    s.remove('issue', '1');
    expect(s.list().length).toBe(1);
    expect(s.list()[0]!.kind).toBe('doc');
  });

  it('entityKeyOf：kind:id', () => {
    expect(entityKeyOf('issue', '1')).toBe('issue:1');
  });
});

describe('HTTP 实体宿主（R3：B 线接缝）', () => {
  function fakeFetch(responses: Array<{ method: string; status?: number; body?: unknown }>) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const impl = (async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET') as string;
      calls.push({ url, init });
      const match = responses.find((r) => r.method === method) ?? { method, status: 404 };
      return {
        ok: (match.status ?? 200) < 400,
        status: match.status ?? 200,
        json: async () => match.body,
      } as Response;
    }) as typeof fetch;
    return { impl, calls };
  }

  it('refresh：GET /entities 拉取入缓存 → list() 同步命中', async () => {
    const { impl } = fakeFetch([
      {
        method: 'GET',
        body: [{ kind: 'issue', id: '1', title: '远端实体', usedAt: 1, docs: ['x'] }],
      },
    ]);
    const host = new HttpEntityHost('http://sidecar', 'a.mm.md', impl);
    expect(host.list()).toEqual([]); // 初始缓存空
    await host.refresh();
    expect(host.list()[0]!.title).toBe('远端实体');
  });

  it('refresh 失败（非 2xx）→ throw，缓存保留', async () => {
    const { impl } = fakeFetch([{ method: 'GET', status: 500 }]);
    const host = new HttpEntityHost('http://sidecar', 'a.mm.md', impl);
    await expect(host.refresh()).rejects.toThrow();
    expect(host.list()).toEqual([]);
  });

  it('remember：本地缓存立即生效 + POST fire-and-forget（body 含 refs/doc）', async () => {
    const { impl, calls } = fakeFetch([{ method: 'GET', body: [] }, { method: 'POST' }]);
    const host = new HttpEntityHost('http://sidecar', 'a.mm.md', impl);
    await host.refresh();
    host.remember([{ kind: 'issue', id: '9', title: '新引用' }], 'a.mm.md');
    expect(host.list().some((r) => r.id === '9')).toBe(true); // 本地即时
    await Promise.resolve(); // fire-and-forget 落地
    const post = calls.find((c) => c.init?.method === 'POST');
    expect(post).toBeDefined();
    expect(JSON.parse(String(post!.init!.body))).toMatchObject({ doc: 'a.mm.md' });
  });

  it('remove：本地删除 + DELETE 调用', async () => {
    const { impl, calls } = fakeFetch([
      { method: 'GET', body: [{ kind: 'issue', id: '1', title: 'x', usedAt: 1, docs: [] }] },
      { method: 'DELETE' },
    ]);
    const host = new HttpEntityHost('http://sidecar', 'a.mm.md', impl);
    await host.refresh();
    host.remove('issue', '1');
    expect(host.list().length).toBe(0);
    await Promise.resolve();
    expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(true);
  });
});
