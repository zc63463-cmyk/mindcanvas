// @vitest-environment jsdom
/**
 * FA1-T1：文件句柄闭环 —— 一次选择，终身静默落盘。
 *
 * 回归背景：此前 `saveMarkdown` 拿到 `showSaveFilePicker()` 的 handle 后直接丢弃，
 * doc.handle 永远是 undefined → 每次 Ctrl+S 重新唤起系统另存为窗口并触发覆盖确认。
 *
 * 本文件锁死三件事：
 *   1. saveMarkdown 成功写入后**必须**回传 handle；
 *   2. 已有 handle 时**绝不**再调 showSaveFilePicker（零弹窗的硬证据）；
 *   3. 用户取消（AbortError）不产生半截结果，也不误走下载兜底。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalDocHost } from '../src/edit/document.js';
import type { MindDoc } from '../src/edit/document.js';
import { isEmbeddedFrame, MM_OPEN_TYPES, saveMarkdown, writeToHandle } from '../src/edit/save.js';
import type { FsFileHandle, FsWritable } from '../src/edit/save.js';

/** 记录写入内容的可控句柄（测试替身：不碰真实文件系统） */
function fakeHandle(name = 'a.mm.md'): FsFileHandle & { written: string[] } {
  const written: string[] = [];
  return {
    name,
    written,
    async createWritable(): Promise<FsWritable> {
      return {
        async write(s: string) {
          written.push(s);
        },
        async close() {
          /* noop */
        },
      };
    },
  };
}

/** 安装一次性 showSaveFilePicker；返回调用探针 */
function stubPicker(impl: () => Promise<FsFileHandle>): ReturnType<typeof vi.fn> {
  const spy = vi.fn(impl);
  window.showSaveFilePicker = spy as unknown as typeof window.showSaveFilePicker;
  return spy;
}

afterEach(() => {
  delete window.showSaveFilePicker;
  vi.restoreAllMocks();
});

function docOf(over: Partial<MindDoc> = {}): MindDoc {
  return { id: 'a.mm.md', name: 'a.mm.md', source: '# A', saved: true, ts: 1, ...over };
}

describe('saveMarkdown：句柄回传（FA1-T1）', () => {
  it('fs 保存成功 → outcome 带 handle 且内容已写入', async () => {
    const handle = fakeHandle();
    const picker = stubPicker(async () => handle);

    const outcome = await saveMarkdown('# 正文', 'a.mm.md');

    expect(outcome.result).toBe('fs');
    expect(outcome.handle).toBe(handle);
    expect(handle.written).toEqual(['# 正文']);
    expect(picker).toHaveBeenCalledTimes(1);
  });

  it('用户取消（AbortError）→ cancelled，不再回落下载兜底', async () => {
    stubPicker(async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });
    const createEl = vi.spyOn(document, 'createElement');

    const outcome = await saveMarkdown('# 正文', 'a.mm.md');

    expect(outcome.result).toBe('cancelled');
    expect(outcome.handle).toBeUndefined();
    expect(createEl).not.toHaveBeenCalled(); // 没有 <a download> = 没触发下载
  });

  it('不支持 FS Access → download 兜底（无 handle）', async () => {
    const outcome = await saveMarkdown('# 正文', 'a.mm.md');
    expect(outcome.result).toBe('download');
    expect(outcome.handle).toBeUndefined();
  });

  it('嵌入 frame（IDE 预览）：跳过 FS 对话框直接下载（webview 里系统对话框会挂起）', async () => {
    const picker = stubPicker(async () => fakeHandle());
    const outcome = await saveMarkdown('# 正文', 'a.mm.md', { embedded: true });
    expect(outcome.result).toBe('download');
    expect(picker).not.toHaveBeenCalled();
  });

  it('isEmbeddedFrame：顶层窗口 → false（不误判为嵌入）', () => {
    expect(isEmbeddedFrame()).toBe(false);
  });

  it('打开对话框类型不含双段扩展名（.mm.md 在部分浏览器里让文件灰显不可选）', () => {
    const accept = MM_OPEN_TYPES[0]?.accept['text/markdown'] ?? [];
    expect(accept.length).toBeGreaterThan(0);
    for (const ext of accept) expect(ext.split('.').length).toBeLessThanOrEqual(2);
  });

  it('句柄写回抛错（文件被移走）→ 回落下载，不静默吞掉失败', async () => {
    stubPicker(async () => ({
      createWritable: async () => {
        throw new Error('NotFoundError');
      },
    }));
    const outcome = await saveMarkdown('# 正文', 'a.mm.md');
    expect(outcome.result).toBe('download');
  });
});

describe('writeToHandle：静默写回（零弹窗）', () => {
  it('写入成功返回 true', async () => {
    const handle = fakeHandle();
    expect(await writeToHandle(handle, '# 新')).toBe(true);
    expect(handle.written).toEqual(['# 新']);
  });

  it('createWritable 抛错返回 false（调用方据此回落选择器）', async () => {
    const broken: FsFileHandle = {
      createWritable: async () => {
        throw new Error('gone');
      },
    };
    expect(await writeToHandle(broken, '# 新')).toBe(false);
  });
});

describe('LocalDocHost：连续保存零弹窗（FA1-T1 门禁）', () => {
  it('已有 handle → 连续 3 次 save 都不再唤起 showSaveFilePicker', async () => {
    const handle = fakeHandle();
    const picker = stubPicker(async () => fakeHandle('other.mm.md'));
    const host = new LocalDocHost();
    const doc = docOf({ handle: handle as never });

    for (const src of ['# 1', '# 2', '# 3']) {
      const outcome = await host.save({ ...doc, source: src });
      expect(outcome.result).toBe('fs');
      expect(outcome.handle).toBe(handle);
    }

    expect(picker).not.toHaveBeenCalled();
    expect(handle.written).toEqual(['# 1', '# 2', '# 3']);
  });

  it('无 handle → 首次 save 唤起选择器并回传新 handle（后续可静默）', async () => {
    const fresh = fakeHandle('picked.mm.md');
    const picker = stubPicker(async () => fresh);
    const host = new LocalDocHost();

    const first = await host.save(docOf({ handle: undefined }));
    expect(first.result).toBe('fs');
    expect(first.handle).toBe(fresh);
    expect(picker).toHaveBeenCalledTimes(1);

    // 调用方把 handle 写回 doc 后，第二次不应再弹窗
    const second = await host.save({ ...docOf({ handle: first.handle }), source: '# 2' });
    expect(second.result).toBe('fs');
    expect(picker).toHaveBeenCalledTimes(1);
  });

  it('open 成功 → 文档自带 handle（打开即具备写回能力）', async () => {
    const handle = fakeHandle('opened.mm.md');
    window.showOpenFilePicker = (async () => [
      { ...handle, getFile: async () => new File(['# 打开'], 'opened.mm.md') },
    ]) as unknown as typeof window.showOpenFilePicker;

    const host = new LocalDocHost();
    const doc = await host.open();

    expect(doc).not.toBeNull();
    expect(doc?.handle).toBeDefined();
    expect(doc?.source).toBe('# 打开');
    delete window.showOpenFilePicker;
  });
});
