/**
 * LenBubble：出线长度数值气泡（v1.8.1 菜单梳理，取代原生 prompt——裁决 M3）。
 * 锁定：预填 / Enter 提交与下限校验（≥14）/ Esc 与点外部取消。
 */
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LenBubble } from '../src/LenBubble';

describe('LenBubble', () => {
  it('预填当前值；Enter 提交合法值', () => {
    const onCommit = vi.fn();
    const { container } = render(
      <LenBubble x={10} y={20} initial={60} onCommit={onCommit} onCancel={() => {}} />,
    );
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('60');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(60);
  });

  it('缺省值（null）→ 预填 32；非法输入（<14 / 非数字）Enter 不提交', () => {
    const onCommit = vi.fn();
    const { container } = render(
      <LenBubble x={0} y={0} initial={null} onCommit={onCommit} onCancel={() => {}} />,
    );
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('32');
    fireEvent.change(input, { target: { value: '13' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '80' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(80);
  });

  it('Esc 取消；点外部（遮罩）取消', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <LenBubble x={0} y={0} initial={null} onCommit={() => {}} onCancel={onCancel} />,
    );
    fireEvent.keyDown(container.querySelector('input')!, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(container.querySelector('[data-len-backdrop]') as HTMLElement);
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
