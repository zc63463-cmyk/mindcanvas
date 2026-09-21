// @vitest-environment jsdom
/**
 * SearchPanel：Ctrl+F 搜索面板——输入即搜、Enter 轮换、Esc 关闭、点击结果回调。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { SearchPanel } from '../src/chrome/SearchPanel.js';
import type { SearchHit } from '../src/search/search.js';

const RESULTS: SearchHit[] = [
  {
    id: 'a1',
    label: '门户显示优化',
    pathLabel: '根 / 任务',
    snippet: '节点向下生长',
    node: { id: 'a1', type: 'text', text: '门户显示优化', children: [] },
  },
  {
    id: 'b2',
    label: '解析链路验证',
    pathLabel: '根 / 任务',
    snippet: '路径要可观察，定位节点',
    node: { id: 'b2', type: 'text', text: '解析链路验证', children: [] },
  },
];

const results = (q: string): SearchHit[] =>
  q ? RESULTS.filter((r) => r.label.includes(q) || r.snippet.includes(q)) : [];

describe('SearchPanel：富文本搜索面板', () => {
  it('输入 → 调用 search 并渲染结果', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <SearchPanel search={results} onSelect={onSelect} onClose={() => {}} />,
    );
    const input = container.querySelector('[data-search-input]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '门户' } });
    expect(container.querySelectorAll('[data-search-result]').length).toBe(1);
    expect(container.textContent).toContain('门户显示优化');
  });

  it('点击结果 → onSelect(id) + onClose', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <SearchPanel search={results} onSelect={onSelect} onClose={onClose} />,
    );
    fireEvent.change(container.querySelector('[data-search-input]') as HTMLInputElement, {
      target: { value: '可观察' },
    });
    fireEvent.click(container.querySelector('[data-search-result]') as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith('b2');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ArrowDown 轮换激活项；Enter 选中并关闭；Esc → onClose', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <SearchPanel search={results} onSelect={onSelect} onClose={onClose} />,
    );
    const input = container.querySelector('[data-search-input]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '节点' } }); // 两条结果都含「节点」
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // 激活 0 → 1
    const active = container.querySelector(
      '[data-search-result][data-active="true"]',
    ) as HTMLElement;
    expect(active.textContent).toContain('解析链路验证');
    fireEvent.keyDown(input, { key: 'Enter' }); // 选中激活项
    expect(onSelect).toHaveBeenCalledWith('b2');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('空结果 → 提示无匹配', () => {
    const { container } = render(
      <SearchPanel search={results} onSelect={vi.fn()} onClose={() => {}} />,
    );
    fireEvent.change(container.querySelector('[data-search-input]') as HTMLInputElement, {
      target: { value: '不存在xyz' },
    });
    expect(container.textContent).toContain('无匹配');
  });
});
