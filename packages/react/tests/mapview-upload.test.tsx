// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { astToEditable, layoutMindmap, makeTextNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView } from '../src/render/MapView.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

function renderMap(onAssetFiles?: (files: File[]) => void) {
  const root = astToEditable(makeTextNode('根', [makeTextNode('分支 A')]))!;
  const layout = layoutMindmap(root, createNodeMeasure(char, new Map()), new Set());
  return render(
    <ThemeProvider>
      <MapView layout={layout} entities={new Map()} char={char} onAssetFiles={onAssetFiles} />
    </ThemeProvider>,
  );
}

function wheelOf(container: HTMLElement): HTMLElement {
  return container.querySelector('div[style*="touch-action"]') as HTMLElement;
}

describe('MapView 文件投放（P1：拖拽/粘贴 → onAssetFiles 透传）', () => {
  it('drop 文件 → onAssetFiles 收到文件列表', () => {
    const onAssetFiles = vi.fn();
    const { container } = renderMap(onAssetFiles);
    const file = new File(['<svg/>'], 'arch.svg', { type: 'image/svg+xml' });
    fireEvent.drop(wheelOf(container), { dataTransfer: { files: [file] }, bubbles: true });
    expect(onAssetFiles).toHaveBeenCalledTimes(1);
    expect(onAssetFiles.mock.calls[0]![0]).toEqual([file]);
  });

  it('dragover（含 Files 类型）→ 允许 drop 并出现拖拽高亮', () => {
    const { container } = renderMap();
    const wheel = wheelOf(container);
    fireEvent.dragOver(wheel, { dataTransfer: { types: ['Files'] }, bubbles: true });
    // 高亮 outline 注入（selection 令牌色虚线）
    expect(wheel.style.outline).toContain('dashed');
    fireEvent.dragLeave(wheel);
    expect(wheel.style.outline).toBeFalsy();
  });

  it('dragover 非文件类型 → 不进入拖拽态', () => {
    const { container } = renderMap();
    const wheel = wheelOf(container);
    fireEvent.dragOver(wheel, { dataTransfer: { types: ['text/plain'] }, bubbles: true });
    expect(wheel.style.outline).toBeFalsy();
  });

  it('粘贴文件 → onAssetFiles 收到剪贴板文件', () => {
    const onAssetFiles = vi.fn();
    const { container } = renderMap(onAssetFiles);
    const file = new File(['png-data'], 'shot.png', { type: 'image/png' });
    fireEvent.paste(wheelOf(container), { clipboardData: { files: [file] }, bubbles: true });
    expect(onAssetFiles).toHaveBeenCalledTimes(1);
    expect(onAssetFiles.mock.calls[0]![0]).toEqual([file]);
  });

  it('未传 onAssetFiles → drop 不抛错（缺省忽略）', () => {
    const { container } = renderMap();
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    expect(() =>
      fireEvent.drop(wheelOf(container), { dataTransfer: { files: [file] }, bubbles: true }),
    ).not.toThrow();
  });
});
