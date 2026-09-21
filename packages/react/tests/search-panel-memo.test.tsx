// @vitest-environment jsdom
/**
 * SearchPanel · 检索结果 memo（批次 B · B-P6）
 *
 * 背景：`results = query.trim() ? search(query) : []` 在渲染体内直算 —— `search` 是全树 walk
 * （search.ts 46-69），**每次渲染都重跑**：父组件每帧重渲、甚至面板内 ↑/↓ 的 `setActive`
 * 都会触发一次 O(全树) 检索。
 *
 * 判别指标 = 注入的 `search` 被调用次数：
 *   修复前：同 props 重渲染 / setActive 各 +1（红）；
 *   修复后：`useMemo([query, search])` —— 只有 query 或 search 引用变化才重算（绿）。
 * 注入方（SidePanels）须提供**稳定引用**的闭包（controller 长寿命，调用时实时读 root）。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { makeTextNode } from '@mindcanvas/kernel';
import { SearchPanel } from '../src/chrome/SearchPanel.js';

const hit = (id: string, label: string) => ({
  id,
  label,
  pathLabel: '根 / 子',
  snippet: label,
  node: makeTextNode(label),
});

describe('SearchPanel · 检索结果 memo（B-P6）', () => {
  it('同 props 重渲染与 setActive 不重复 walk；改 query / 换 search 引用才重算', () => {
    const searchFn = vi.fn((q: string) => [hit('a', `命中 ${q}`)]);
    const noop = (): void => {};
    const ui = (fn: (query: string) => ReturnType<typeof searchFn>) => (
      <SearchPanel search={fn} onSelect={noop} onClose={noop} />
    );
    const { container, rerender } = render(ui(searchFn));
    const input = container.querySelector('[data-search-input]') as HTMLInputElement;

    expect(searchFn).not.toHaveBeenCalled(); // 空查询不搜

    fireEvent.change(input, { target: { value: 'A' } });
    const afterInput = searchFn.mock.calls.length;
    expect(afterInput).toBe(1); // 输入 → 恰好 1 次 walk
    expect(container.querySelectorAll('[data-search-result]')).toHaveLength(1);

    // ① 父组件重渲染（同 props 同 search 引用）→ 不重复 walk（修复前 +1 → 红）
    rerender(ui(searchFn));
    expect(searchFn.mock.calls.length, '同 props 重渲染不应重复全树 walk').toBe(afterInput);

    // ② 面板内状态变化（↑/↓ 的 setActive）→ 不重复 walk（修复前 +1 → 红）
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(searchFn.mock.calls.length, 'setActive 重渲染不应重复全树 walk').toBe(afterInput);

    // ③ 改 query → 恰好重算一次
    fireEvent.change(input, { target: { value: 'AB' } });
    expect(searchFn.mock.calls.length).toBe(afterInput + 1);
    expect(container.querySelectorAll('[data-search-result]')).toHaveLength(1);

    // ④ search 引用变化（注入方换闭包）→ 重算（deps 契约；调用方须稳定闭包，见 SidePanels）
    const searchFn2 = vi.fn((q: string) => [hit('b', `命中2 ${q}`)]);
    rerender(ui(searchFn2));
    expect(searchFn2.mock.calls.length).toBe(1);
  });

  it('空查询 → 不调用 search 且渲染占位（防 memo 引入的空串意外调用）', () => {
    const searchFn = vi.fn(() => [hit('a', 'x')]);
    const { container } = render(
      <SearchPanel search={searchFn} onSelect={(): void => {}} onClose={(): void => {}} />,
    );
    const input = container.querySelector('[data-search-input]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } }); // 纯空白 = 视为空
    expect(searchFn).not.toHaveBeenCalled();
    expect(container.querySelector('[data-search-result]')).toBeNull();
  });
});
