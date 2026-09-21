// @vitest-environment jsdom
/**
 * S4 · canvas 宿主导出接线契约。
 *
 * ## 为什么单独测这一层
 *
 * `packages/react` 的 `summary-export-svg.test.ts` 证明 **exportSvg 能画括线**；
 * 但它证明不了「canvas 宿主真的把 root 传下去了」。若 `useExportActions` 漏传 root，
 * react 侧全部用例照绿，而用户导出的 SVG 里一条括线都没有 —— 这是「功能已在库里、
 * 却没接到产品上」的典型静默失效。
 *
 * 本文件挂真实 `useExportActions`，对 `exportSvg` 取参，断言 `root` 被透传。
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportPng, exportSvg } from '@mindcanvas/react';
import { useExportActions } from '../src/hooks/useExportActions';

vi.mock('@mindcanvas/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mindcanvas/react')>();
  return {
    ...actual,
    exportPng: vi.fn(async () => ({ ok: false, reason: 'unsupported' as const })),
    exportSvg: vi.fn(() => '<svg data-stub />'),
  };
});

type Deps = Parameters<typeof useExportActions>[0];

/** 极简文档根（仅用于验证透传，不参与几何） */
const ROOT = { id: 'r', type: 'text' as const, text: '根', children: [] };

function setup() {
  const { result } = renderHook(() =>
    useExportActions({
      layout: {} as NonNullable<Deps['layout']>,
      token: {} as Deps['token'],
      docName: '画布.mm.md',
      root: ROOT as unknown as Deps['root'],
    }),
  );
  return { result };
}

beforeEach(() => {
  vi.clearAllMocks();
  // 下载链路需 stub（jsdom 无真实导航）
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:stub'),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('S4 · canvas 导出：root 透传', () => {
  it('handleExport：exportSvg 收到 root（否则括线不导出）', async () => {
    const { result } = setup();
    await act(async () => {
      result.current.handleExport();
    });
    expect(exportSvg, 'exportSvg 必须被调用').toHaveBeenCalled();
    const opts = vi.mocked(exportSvg).mock.calls[0]?.[2];
    expect(
      opts?.root,
      'root 必须透传给 exportSvg（漏传 = 导出里没有括线）',
    ).toBe(ROOT);
  });

  it('handleExportPng：exportPng 收到 root（PNG 同口径）', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.handleExportPng();
    });
    expect(exportPng, 'exportPng 必须被调用').toHaveBeenCalled();
    const opts = vi.mocked(exportPng).mock.calls[0]?.[2];
    expect(opts?.root, 'root 必须透传给 exportPng').toBe(ROOT);
  });
});
