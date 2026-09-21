// @vitest-environment jsdom
/**
 * ContextMenu：节点右键菜单——定位 (x,y)，点击项回调 + 关闭；Esc/点击外部关闭。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { ContextMenu } from '../src/chrome/ContextMenu.js';

describe('ContextMenu：右键菜单', () => {
  it('渲染菜单项并定位在 (x,y)', () => {
    const { container } = render(
      <ContextMenu
        x={120}
        y={80}
        items={[{ label: '新建子节点', onSelect: vi.fn() }]}
        onClose={() => {}}
      />,
    );
    const menu = container.querySelector('[data-context-menu]') as HTMLElement;
    expect(menu.style.left).toBe('120px');
    expect(menu.style.top).toBe('80px');
    expect(container.textContent).toContain('新建子节点');
  });

  it('点击菜单项 → 触发该 onSelect 并 onClose', () => {
    const onClose = vi.fn();
    const onSel = vi.fn();
    const { container } = render(
      <ContextMenu x={0} y={0} items={[{ label: '编辑', onSelect: onSel }]} onClose={onClose} />,
    );
    fireEvent.click(container.querySelector('[data-menu-item]') as HTMLElement);
    expect(onSel).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc → onClose', () => {
    const onClose = vi.fn();
    render(
      <ContextMenu x={0} y={0} items={[{ label: '编辑', onSelect: vi.fn() }]} onClose={onClose} />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击遮罩（外部）→ onClose', () => {
    const onClose = vi.fn();
    const { container } = render(
      <ContextMenu x={0} y={0} items={[{ label: '编辑', onSelect: vi.fn() }]} onClose={onClose} />,
    );
    fireEvent.pointerDown(container.querySelector('[data-menu-backdrop]') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('v1.8.1：section 变化处渲染分区标题；hint 显示在行内', () => {
    const items = [
      { label: '新建子节点', section: '常用', hint: 'Tab', onSelect: vi.fn() },
      { label: '编辑', section: '常用', hint: 'F2', onSelect: vi.fn() },
      { label: '生长方向（子树往哪边长） › 向右', section: '生长与连线', onSelect: vi.fn() },
    ];
    const { container } = render(<ContextMenu x={0} y={0} items={items} onClose={() => {}} />);
    // 两个分区标题（常用 / 生长与连线）——同 section 连续项只出一个标题
    const sections = container.querySelectorAll('[data-menu-section]');
    expect(sections).toHaveLength(2);
    expect(sections[0]!.textContent).toBe('常用');
    expect(sections[1]!.textContent).toBe('生长与连线');
    expect(container.textContent).toContain('Tab');
    expect(container.textContent).toContain('F2');
  });
});

/**
 * v1.8.2（T6）：菜单内**翻页** `page` —— 方向型 / 参数型动作收进子页。
 * 与环「同一外圈换页」同语义：翻页 ≠ 提交（不关菜单）；子页首行恒为「‹ 返回」。
 */
describe('ContextMenu：菜单内翻页（T6）', () => {
  const pageItem = (onPick: () => void) => ({
    label: '生长方向：向右',
    hint: 'Alt+方向',
    page: [
      { label: '向右 ✓', onSelect: vi.fn() },
      { label: '向左', onSelect: onPick },
      { label: '继承（跟随父级）', onSelect: vi.fn() },
    ],
  });

  it('翻页项：行尾 chevron；点击 → 不关闭菜单 + 渲染子页与「‹ 返回」', () => {
    const onClose = vi.fn();
    const { container } = render(
      <ContextMenu x={0} y={0} items={[{ label: '删除节点', onSelect: vi.fn() }, pageItem(vi.fn())]} onClose={onClose} />,
    );
    const row = [...container.querySelectorAll('[data-menu-item]')].find((el) =>
      el.textContent?.includes('生长方向'),
    ) as HTMLElement;
    expect(row.textContent).toContain('›'); // 翻页 affordance（行尾）
    fireEvent.click(row);
    expect(onClose).not.toHaveBeenCalled(); // 翻页 ≠ 提交
    expect(container.querySelector('[data-menu-back]')).not.toBeNull();
    expect(container.textContent).toContain('‹ 返回');
    expect(container.textContent).toContain('向右 ✓'); // 子页内容
    expect(container.textContent).toContain('生长方向：向右'); // 返回行右侧 = 来源页标题
    expect(container.textContent).not.toContain('删除节点'); // 子页替换首屏
  });

  it('子页点项 → 执行 + 关闭（沿用既有提交语义）', () => {
    const onClose = vi.fn();
    const onPick = vi.fn();
    const { container } = render(<ContextMenu x={0} y={0} items={[pageItem(onPick)]} onClose={onClose} />);
    fireEvent.click(container.querySelector('[data-menu-item]') as HTMLElement); // 进子页
    const child = [...container.querySelectorAll('[data-menu-item]')].find((el) =>
      el.textContent?.includes('向左'),
    ) as HTMLElement;
    fireEvent.click(child);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('「‹ 返回」/ ← 键 → 回上一页（不关闭菜单）', () => {
    const onClose = vi.fn();
    const { container } = render(<ContextMenu x={0} y={0} items={[pageItem(vi.fn())]} onClose={onClose} />);
    fireEvent.click(container.querySelector('[data-menu-item]') as HTMLElement);
    fireEvent.click(container.querySelector('[data-menu-back]') as HTMLElement);
    expect(container.textContent).not.toContain('向右 ✓');
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(container.querySelector('[data-menu-item]') as HTMLElement); // 再进子页
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(container.querySelector('[data-menu-back]')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('子页里 Esc → 一键关闭（右键菜单肌肉记忆）', () => {
    const onClose = vi.fn();
    const { container } = render(<ContextMenu x={0} y={0} items={[pageItem(vi.fn())]} onClose={onClose} />);
    fireEvent.click(container.querySelector('[data-menu-item]') as HTMLElement);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/**
 * 视口钳制（T6 真浏览器实测修复）：节点贴近底边右键 → 菜单顶出屏幕、下面的行点不到。
 */
describe('ContextMenu：视口钳制（T6）', () => {
  it('贴底右键 → 菜单上移收进视口（jsdom 视口 1024×768）', () => {
    // jsdom 的 getBoundingClientRect 恒 0 → 用 spy 给出「12 行菜单」的真实尺寸
    const rect = {
      x: 0,
      y: 0,
      width: 200,
      height: 600,
      top: 0,
      left: 0,
      right: 200,
      bottom: 600,
      toJSON: () => ({}),
    } as DOMRect;
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect);
    try {
      const { container } = render(
        <ContextMenu x={100} y={700} items={[{ label: '编辑', onSelect: vi.fn() }]} onClose={() => {}} />,
      );
      const menu = container.querySelector('[data-context-menu]') as HTMLElement;
      expect(menu.style.top).toBe(`${768 - 600 - 8}px`); // 160px：底部留 8px 边距
      expect(menu.style.left).toBe('100px'); // 宽度未溢出 → x 不动
    } finally {
      spy.mockRestore();
    }
  });
});
