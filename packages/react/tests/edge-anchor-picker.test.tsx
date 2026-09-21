// @vitest-environment jsdom
/**
 * EdgeAnchorPicker（R2-1）：重挂锚点候选选择器。
 *
 * 行为规格（派遣计划 R2-1 / R2-A5）：
 * - 列表 + 文本过滤 + 点选回调；Esc / 点遮罩取消（不回调 onPick）
 * - excludeAnchor：排除「选中后使 from === to」的候选（防数据自关联）
 * - picker 内 stopPropagation（比照 EdgeEditor:106，防点击穿透启动画布手势）
 * - 空 choices → 空态文案
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { EdgeAnchorPicker } from '../src/chrome/EdgeAnchorPicker.js';

const choices = [
  { id: 'n1', label: '任务', anchor: 'node:根/任务' },
  { id: 'n2', label: '生活', anchor: 'node:根/生活' },
  { id: 'n3', label: 'K3', anchor: 'node:根/任务/K3' },
];

function mount(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

/** 缺元素即抛错（新增代码零 `!` lint 告警纪律） */
function q(selector: string, root: ParentNode): Element {
  const el = root.querySelector(selector);
  if (el === null) throw new Error(`element not found: ${selector}`);
  return el;
}

describe('EdgeAnchorPicker', () => {
  it('列表渲染全部候选；点选 → onPick(anchor) 一次', () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    const { container } = mount(
      <EdgeAnchorPicker choices={choices} onPick={onPick} onClose={onClose} />,
    );
    expect(container.querySelectorAll('[data-edge-anchor-option]').length).toBe(3);
    fireEvent.click(q('[data-edge-anchor-option="node:根/生活"]', container));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('node:根/生活');
    expect(onClose).not.toHaveBeenCalled(); // 选中是成功路径，取消才是 onClose
  });

  it('excludeAnchor 命中的候选被过滤（防自关联）', () => {
    const onPick = vi.fn();
    const { container } = mount(
      <EdgeAnchorPicker
        choices={choices}
        onPick={onPick}
        onClose={vi.fn()}
        excludeAnchor="node:根/任务"
      />,
    );
    const opts = [...container.querySelectorAll('[data-edge-anchor-option]')];
    expect(opts.length).toBe(2);
    expect(
      opts.some((o) => o.getAttribute('data-edge-anchor-option') === 'node:根/任务'),
    ).toBe(false);
  });

  it('Esc / 点遮罩 → 仅 onClose，不回调 onPick', () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    const { unmount } = mount(
      <EdgeAnchorPicker choices={choices} onPick={onPick} onClose={onClose} />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
    unmount();

    const second = mount(<EdgeAnchorPicker choices={choices} onPick={onPick} onClose={onClose} />);
    fireEvent.click(q('[data-edge-anchor-cancel]', second.container));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('过滤输入命中 label 或锚片段；空 choices → 空态文案', () => {
    const onPick = vi.fn();
    const { container } = mount(
      <EdgeAnchorPicker choices={choices} onPick={onPick} onClose={vi.fn()} />,
    );
    fireEvent.change(q('[data-edge-anchor-filter]', container), { target: { value: 'K3' } });
    const filtered = container.querySelectorAll('[data-edge-anchor-option]');
    expect(filtered.length).toBe(1);
    expect(filtered[0]?.getAttribute('data-edge-anchor-option')).toBe('node:根/任务/K3');

    const empty = mount(<EdgeAnchorPicker choices={[]} onPick={onPick} onClose={vi.fn()} />);
    expect(q('[data-edge-anchor-empty]', empty.container)).toBeDefined();
  });

  it('面板内 pointerDown 不冒泡到遮罩（防画布手势/穿透，比照 EdgeEditor:106）', () => {
    const onClose = vi.fn();
    const { container } = mount(
      <EdgeAnchorPicker choices={choices} onPick={vi.fn()} onClose={onClose} />,
    );
    const panel = q('[data-edge-anchor-panel]', container);
    fireEvent.pointerDown(panel);
    expect(onClose).not.toHaveBeenCalled();
  });
});
