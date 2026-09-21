// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportPng, readSvgSize, renderPng } from '../src/chrome/exportPng.js';
import { glassToken } from '../src/theme/tokens.js';

const LAYOUT = { bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, nodes: [], links: [] } as never;

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80" width="100" height="80"></svg>';

describe('PNG 导出（N3：降级语义）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('readSvgSize：解析 exportSvg 写入的 width/height；缺属性 → null', () => {
    expect(readSvgSize(SVG)).toEqual({ width: 100, height: 80 });
    expect(readSvgSize('<svg xmlns="x"></svg>')).toBeNull();
  });

  it('图片加载失败（jsdom/坏 URL）→ unsupported（调用方降级路径）', async () => {
    // jsdom 的 Image 不触发加载事件（需 resources 配置）——stub 触发 onerror 验证降级路径
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_: string) {
          this.onerror?.();
        }
      },
    );
    const r = await exportPng(LAYOUT, glassToken);
    expect(r).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('toBlob 抛 SecurityError（外链资产污染画布）→ tainted', async () => {
    // fake canvas：getContext 返回可用的 fake ctx，toBlob 抛 SecurityError
    const fakeCtx = { scale: vi.fn(), drawImage: vi.fn() };
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => fakeCtx,
          toBlob: (_cb: (b: Blob | null) => void, _t?: string) => {
            throw new DOMException('tainted', 'SecurityError');
          },
        } as unknown as HTMLCanvasElement;
      }
      return realCreateElement(tag);
    });
    // fake Image：onload 立即触发
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_: string) {
          this.onload?.();
        }
      },
    );
    const r = await renderPng(SVG, 100, 80, 2);
    expect(r).toEqual({ ok: false, reason: 'tainted' });
  });

  it('正常路径：2x 分辨率 + ok + blob', async () => {
    const fakeBlob = new Blob(['png'], { type: 'image/png' });
    const fakeCtx = { scale: vi.fn(), drawImage: vi.fn() };
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') {
        const el = {
          width: 0,
          height: 0,
          getContext: () => fakeCtx,
          toBlob: (cb: (b: Blob | null) => void) => cb(fakeBlob),
        } as unknown as HTMLCanvasElement;
        return el;
      }
      return realCreateElement(tag);
    });
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_: string) {
          this.onload?.();
        }
      },
    );
    const r = await renderPng(SVG, 100, 80, 2);
    expect(r).toEqual({ ok: true, blob: fakeBlob });
    expect(fakeCtx.scale).toHaveBeenCalledWith(2, 2);
    expect(fakeCtx.drawImage).toHaveBeenCalled();
  });
});
