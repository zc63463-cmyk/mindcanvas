// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { FlipCard } from '../src/chrome/FlipCard.js';
import { ThemeSwitcher } from '../src/chrome/ThemeSwitcher.js';
import { formatNote } from '../src/chrome/note.js';
import { ThemeProvider } from '../src/theme/ThemeContext.js';

describe('Glass chrome 组件（ADR-0003 决策 3：外壳恒定）', () => {
  it('formatNote：有序分区 + 数组字段展平', () => {
    const sections = formatNote({
      one_liner: '先验证链路',
      status: '设计中',
      next: ['A', 'B'],
      decisions: ['只读先行', '引用即快照'],
      reminder: '别被带偏',
    });
    expect(sections.map((s) => s.key)).toEqual([
      'one_liner',
      'status',
      'next',
      'reminder',
      'decisions',
    ]);
    expect(sections.find((s) => s.key === 'next')!.value).toBe('A → B');
    expect(sections.find((s) => s.key === 'decisions')!.value).toBe('只读先行；引用即快照');
  });

  it('formatNote：空笔记 → 空分区', () => {
    expect(formatNote(undefined)).toEqual([]);
    expect(formatNote({})).toEqual([]);
  });

  it('FlipCard：点击翻转正面→背面（自持状态）', () => {
    const { container } = render(
      <FlipCard front={<div>正面内容</div>} back={<div>背面内容</div>} />,
    );
    expect(container.textContent).toContain('正面内容');
    const card = container.querySelector('[role="button"]') as HTMLElement;
    fireEvent.click(card);
    expect(card.getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toContain('背面内容');
  });

  it('FlipCard：受控模式跟随外部 flipped', () => {
    const { container } = render(<FlipCard front={<div>F</div>} back={<div>B</div>} flipped />);
    expect(container.textContent).toContain('B');
  });

  it('FlipCard：锚点 data-flip-card / data-flip-state 始终输出（交互缺省）', () => {
    const { container } = render(<FlipCard front={<div>F</div>} back={<div>B</div>} />);
    const card = container.querySelector('[data-flip-card]');
    if (card === null) throw new Error('data-flip-card 缺失');
    expect(card.getAttribute('data-flip-state')).toBe('front');
    fireEvent.click(card);
    expect(card.getAttribute('data-flip-state')).toBe('back');
  });

  it('FlipCard：interactive=false → 去按钮语义 / 无 pointer / 点击不翻（受控 no-op 宿主）', () => {
    const onFlip = vi.fn();
    const { container } = render(
      <FlipCard front={<div>正</div>} back={<div>背</div>} interactive={false} onFlip={onFlip} />,
    );
    const card = container.querySelector('[data-flip-card]');
    if (card === null) throw new Error('data-flip-card 缺失');
    expect(card.getAttribute('role')).toBeNull();
    expect(card.getAttribute('tabindex')).toBeNull();
    expect(card.getAttribute('aria-pressed')).toBeNull();
    expect(card.getAttribute('aria-label')).toBeNull();
    expect((card as HTMLElement).style.cursor).not.toBe('pointer');
    fireEvent.click(card);
    expect(card.getAttribute('data-flip-state')).toBe('front');
    expect(onFlip).not.toHaveBeenCalled();
  });

  it('ThemeSwitcher：三主题一键切换（令牌随点击变化）', () => {
    const { container } = render(
      <ThemeProvider>
        <ThemeSwitcher />
      </ThemeProvider>,
    );
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(3);
    fireEvent.click(buttons[0]!); // classic
    expect(buttons[0]!.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(buttons[2]!); // glass
    expect(buttons[2]!.getAttribute('aria-pressed')).toBe('true');
  });
});
