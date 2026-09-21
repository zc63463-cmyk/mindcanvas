// @vitest-environment jsdom
/**
 * OutlinePanel：Ctrl+D 大纲——树形列表、折叠展开、点击选中、选中高亮（画布↔大纲双向）。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { makeTextNode } from '@mindcanvas/kernel';
import type { EditableNode } from '@mindcanvas/kernel';
import { OutlinePanel } from '../src/chrome/OutlinePanel.js';

function n(text: string, children: EditableNode[] = []): EditableNode {
  return makeTextNode(text, children);
}

const root = n('根', [n('分支 A', [n('叶 1'), n('叶 2')]), n('分支 B')]);

describe('OutlinePanel：大纲面板', () => {
  it('渲染完整树（含子节点）', () => {
    const { container } = render(
      <OutlinePanel
        root={root}
        collapsed={new Set()}
        selectedId={null}
        onSelect={vi.fn()}
        onToggle={vi.fn()}
      />,
    );
    expect(container.textContent).toContain('分支 A');
    expect(container.textContent).toContain('叶 1');
    expect(container.textContent).toContain('分支 B');
  });

  it('点击条目 → onSelect(id)', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <OutlinePanel
        root={root}
        collapsed={new Set()}
        selectedId={null}
        onSelect={onSelect}
        onToggle={vi.fn()}
      />,
    );
    const items = Array.from(container.querySelectorAll('[data-outline-item]'));
    const branchA = items.find((i) => i.textContent!.includes('分支 A')) as HTMLElement;
    fireEvent.click(branchA);
    expect(onSelect).toHaveBeenCalledWith(root.children![0]!.id);
  });

  it('折叠节点 → 子节点隐藏；点击其折叠指示器 → onToggle', () => {
    const onToggle = vi.fn();
    const aId = root.children![0]!.id;
    const { container } = render(
      <OutlinePanel
        root={root}
        collapsed={new Set([aId])}
        selectedId={null}
        onSelect={vi.fn()}
        onToggle={onToggle}
      />,
    );
    // 折叠后叶节点不可见
    expect(container.textContent).not.toContain('叶 1');
    const branchA = Array.from(container.querySelectorAll('[data-outline-item]')).find((i) =>
      i.textContent!.includes('分支 A'),
    ) as HTMLElement;
    const toggler = branchA.querySelector('[data-outline-toggle]') as HTMLElement;
    fireEvent.click(toggler);
    expect(onToggle).toHaveBeenCalledWith(aId);
  });

  it('选中节点高亮（画布选择 → 大纲同步）', () => {
    const aId = root.children![0]!.id;
    const { container } = render(
      <OutlinePanel
        root={root}
        collapsed={new Set()}
        selectedId={aId}
        onSelect={vi.fn()}
        onToggle={vi.fn()}
      />,
    );
    const active = container.querySelector(
      '[data-outline-item][data-active="true"]',
    ) as HTMLElement;
    expect(active.textContent).toContain('分支 A');
  });
});
