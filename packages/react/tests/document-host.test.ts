// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isMindDocFile, LocalDocHost } from '../src/edit/document.js';
import type { MindDoc } from '../src/edit/document.js';

function docOf(over: Partial<MindDoc> = {}): MindDoc {
  return { id: 'a.mm.md', name: 'a.mm.md', source: '# A', saved: true, ts: 1, ...over };
}

describe('文档宿主（B1：多文档 + 本地持久化）', () => {
  it('create：新建未保存文档（saved=false + new- 前缀 id）', () => {
    const host = new LocalDocHost();
    const d = host.create('新画布.mm.md', '# 新画布\n');
    expect(d.saved).toBe(false);
    expect(d.name).toBe('新画布.mm.md');
    expect(d.id.startsWith('new-')).toBe(true);
    expect(d.handle).toBeUndefined();
  });

  it('open：浏览器不支持 FS Access → null（调用方走 file input 兜底）', async () => {
    const host = new LocalDocHost();
    expect(await host.open()).toBeNull();
  });

  it('save：无句柄（新建/导入）→ 下载兜底（jsdom 无 FS Access）', async () => {
    const host = new LocalDocHost();
    const outcome = await host.save(docOf());
    expect(outcome.result).toBe('download');
  });

  it('save：有句柄 → 直接写回（不弹框）；写入内容 = 文档 source', async () => {
    let written = '';
    const handle = {
      createWritable: async () => ({
        write: async (s: string) => {
          written = s;
        },
        close: async () => undefined,
      }),
      getFile: async () => new File(['old'], 'a.mm.md'),
    };
    const host = new LocalDocHost();
    const outcome = await host.save(docOf({ handle: handle as never, source: '# 新内容' }));
    expect(outcome.result).toBe('fs');
    expect(written).toBe('# 新内容');
    // FA1-T1：写回成功 → 回传同一句柄（调用方据此持久绑定，后续保存零弹窗）
    expect(outcome.handle).toBe(handle);
  });

  it('save：句柄写回抛错 → 回落选择器（jsdom 无 FS Access → download），不把失败当成功', async () => {
    const broken = {
      createWritable: async () => {
        throw new Error('file moved');
      },
    };
    const host = new LocalDocHost();
    const outcome = await host.save(docOf({ handle: broken as never }));
    expect(outcome.result).toBe('download');
  });

  it('remember/recent：去重置顶 + 上限 8 + handle 不序列化', () => {
    localStorage.clear();
    const host = new LocalDocHost();
    for (let i = 0; i < 10; i++)
      host.remember(docOf({ id: `d${i}.mm.md`, name: `d${i}.mm.md`, handle: {} as never }));
    const list = host.recent();
    expect(list.length).toBe(8);
    expect(list[0]!.id).toBe('d9.mm.md'); // 最新在前
    expect(list[7]!.id).toBe('d2.mm.md'); // 最旧被挤出
    expect(list[0]!.handle).toBeUndefined(); // handle 不入库
    // 再次 remember 已有项 → 置顶去重
    host.remember(docOf({ id: 'd5.mm.md', name: 'd5.mm.md' }));
    expect(host.recent()[0]!.id).toBe('d5.mm.md');
    expect(host.recent().length).toBe(8);
  });
});

/**
 * 单一事实源守卫（2026-09-03）：
 * 此前「元数据索引」与「最近列表」是两堆独立 localStorage，互不通知 → 状态漂移。
 * 现在统一以 DocLibrary 为唯一持久化入口，旧 key 只用于一次性迁移。
 */
describe('单一事实源：最近列表并入 DocLibrary', () => {
  it('remember 写进 DocLibrary，不再产生独立的 mindcanvas.docs.v1', () => {
    localStorage.clear();
    const host = new LocalDocHost();
    host.remember(docOf({ id: 'x.mm.md', name: 'x.mm.md' }));

    expect(localStorage.getItem('mindcanvas.docs.v1')).toBeNull();
    const lib = JSON.parse(localStorage.getItem('mindcanvas.library.v1') ?? '[]') as Array<{
      id: string;
    }>;
    expect(lib.some((e) => e.id === 'x.mm.md')).toBe(true);
  });

  it('旧版独立最近列表在构造时迁移进来，并清理旧 key', () => {
    localStorage.clear();
    localStorage.setItem(
      'mindcanvas.docs.v1',
      JSON.stringify([
        { id: 'old1.mm.md', name: '旧文档1', source: '# 旧1', saved: true, ts: 100 },
        { id: 'old2.mm.md', name: '旧文档2', source: '# 旧2', saved: true, ts: 200 },
      ]),
    );

    const host = new LocalDocHost(); // 构造即迁移
    const ids = host.recent().map((d) => d.id);
    expect(ids).toContain('old1.mm.md');
    expect(ids).toContain('old2.mm.md');
    expect(localStorage.getItem('mindcanvas.docs.v1')).toBeNull();
  });

  it('旧版列表迁移后仍保持原有访问顺序（较新的在前）', () => {
    localStorage.clear();
    const now = Date.now();
    // 旧 remember 用 unshift，index 0 = 最近访问
    localStorage.setItem(
      'mindcanvas.docs.v1',
      JSON.stringify([
        { id: 'newer.mm.md', name: '较新', source: '# newer', saved: true, ts: now - 1_000 },
        { id: 'older.mm.md', name: '较旧', source: '# older', saved: true, ts: now - 90_000 },
      ]),
    );

    const host = new LocalDocHost();
    const list = host.recent();
    expect(list.map((d) => d.id)).toEqual(['newer.mm.md', 'older.mm.md']);
  });

  it('recent 只吐有源码快照的条目（无快照的恢复出来是空壳）', () => {
    localStorage.clear();
    const host = new LocalDocHost();
    for (let i = 0; i < 12; i++) {
      host.remember(docOf({ id: `n${i}.mm.md`, name: `n${i}.mm.md` }));
    }
    const list = host.recent();
    for (const d of list) expect(typeof d.source).toBe('string');
    expect(list.length).toBe(8);
  });
});

describe('文档文件判定（GH-T1：拖入/粘贴分流）', () => {
  it('isMindDocFile：.mm.md/.md 放行，图片/其他拒绝', () => {
    expect(isMindDocFile('gateway.mm.md')).toBe(true);
    expect(isMindDocFile('note.md')).toBe(true);
    expect(isMindDocFile('a.MM.MD')).toBe(true); // 大小写不敏感
    expect(isMindDocFile('photo.png')).toBe(false);
    expect(isMindDocFile('board.svg')).toBe(false);
    expect(isMindDocFile('readme.txt')).toBe(false);
  });
});
