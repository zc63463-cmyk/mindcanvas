// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { EntityPicker, type EntityCandidate } from '../src/chrome/EntityPicker.js';

const KINDS = ['issue', 'doc', 'note'];
const CANDIDATES: EntityCandidate[] = [
  { kind: 'issue', id: '1', title: '门户显示优化' },
  { kind: 'issue', id: '2', title: '快捷键冲突' },
  { kind: 'doc', id: 'docs/01-architecture.md', title: '01 架构' },
  { kind: 'note', id: 'n1', title: '灵感：折叠交互' },
];

function setup(props: Partial<Parameters<typeof EntityPicker>[0]> = {}) {
  const onPick = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <EntityPicker
      kinds={KINDS}
      candidates={CANDIDATES}
      onPick={onPick}
      onClose={onClose}
      {...props}
    />,
  );
  return { ...utils, onPick, onClose };
}

describe('EntityPicker（M1：实体选择器）', () => {
  it('渲染 kind 徽章行 + 当前 kind 的候选（按 kind 过滤）', () => {
    const { container } = setup();
    expect(container.querySelectorAll('[data-kind]').length).toBe(3);
    const items = container.querySelectorAll('[data-picker-item]');
    expect(items.length).toBe(2); // 仅 issue 的两条
    expect(container.textContent).toContain('门户显示优化');
    expect(container.textContent).not.toContain('01 架构');
  });

  it('切 kind → 候选随之切换', () => {
    const { container } = setup();
    fireEvent.click(container.querySelector('[data-kind="doc"]')!);
    expect(container.textContent).toContain('01 架构');
    expect(container.textContent).not.toContain('门户显示优化');
  });

  it('输入查询 → 过滤候选（id / 标题都参与）', () => {
    const { container } = setup();
    fireEvent.change(container.querySelector('[data-picker-input]')!, {
      target: { value: '快捷键' },
    });
    const items = container.querySelectorAll('[data-picker-item]');
    expect(items.length).toBe(1);
    expect(items[0]!.textContent).toContain('快捷键冲突');
  });

  it('点候选 → onPick({kind,id})', () => {
    const { container, onPick } = setup();
    fireEvent.click(container.querySelectorAll('[data-picker-item]')[0]!);
    expect(onPick).toHaveBeenCalledWith({ kind: 'issue', id: '1' });
  });

  it('新建项：输入非已有内容 → onPick 用输入作 id', () => {
    const { container, onPick } = setup();
    fireEvent.change(container.querySelector('[data-picker-input]')!, {
      target: { value: '新需求' },
    });
    fireEvent.click(container.querySelector('[data-picker-create]')!);
    expect(onPick).toHaveBeenCalledWith({ kind: 'issue', id: '新需求' });
  });

  it('Enter：有候选选首个；无候选且输入非空 → 新建', () => {
    const a = setup();
    fireEvent.keyDown(a.container.querySelector('[data-picker-input]')!, { key: 'Enter' });
    expect(a.onPick).toHaveBeenCalledWith({ kind: 'issue', id: '1' });

    const b = setup();
    fireEvent.change(b.container.querySelector('[data-picker-input]')!, {
      target: { value: '不存在的标题' },
    });
    fireEvent.keyDown(b.container.querySelector('[data-picker-input]')!, { key: 'Enter' });
    expect(b.onPick).toHaveBeenCalledWith({ kind: 'issue', id: '不存在的标题' });
  });

  it('编辑既有实体：显示当前引用高亮 + 清除引用（→ onPick(null)）+ Esc 关闭', () => {
    const { container, onPick, onClose } = setup({ initialKind: 'issue', currentId: '2' });
    const current = container.querySelector('[data-picker-item][data-current]');
    expect(current).not.toBeNull();
    fireEvent.click(container.querySelector('[data-picker-clear]')!);
    expect(onPick).toHaveBeenCalledWith(null);
    fireEvent.keyDown(container.querySelector('[data-picker-input]')!, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
