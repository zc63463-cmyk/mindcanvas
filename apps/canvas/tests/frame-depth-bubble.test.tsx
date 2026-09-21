// @vitest-environment jsdom
/**
 * FrameDepthBubble：框深度数值步进气泡（FO-UI1，取代「改框深度…」的原生 prompt）。
 *
 * 锁定（FO-UI1 键位修复后口径）：
 * - 预填当前值 / 挂载即**强制聚焦**（右键菜单卸载会把焦点抢回画布）；
 * - **气泡打开期间键盘由气泡消费**（window **capture** 阶段）：Enter 提交、Esc 取消，
 *   preventDefault + stopPropagation —— 焦点不在输入框也不能落到画布 `matchEditorKey`
 *   （否则 Enter = 建同级，用户实测的「深度不落盘、旁边多出一个节点」）；
 * - 输入值钳进 [1, max]；非法不提交；`±` 步进**即提交**（钳位）；
 * - Esc / 点外部取消，不写盘。
 *
 * 注意：**不**并排挂多个气泡（生产上 backdrop 挡住后续点击 → 天然互斥；
 * 多个实例同挂会让 capture 监听互相叠加，测试一律一测一挂）。
 */
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FrameDepthBubble } from '../src/FrameDepthBubble';

/** 渲染 + 取输入框（夹具错误显式抛，避免非空断言） */
function renderBubble(over: Partial<Parameters<typeof FrameDepthBubble>[0]> = {}) {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  const props = { x: 10, y: 20, current: 2, max: 5, onCommit, onCancel, ...over };
  const { container } = render(<FrameDepthBubble {...props} />);
  const input = container.querySelector('[data-frame-depth-input]');
  if (input === null) throw new Error('夹具错误：气泡输入框未渲染');
  const inc = container.querySelector('[data-frame-depth-inc]');
  const dec = container.querySelector('[data-frame-depth-dec]');
  if (inc === null || dec === null) throw new Error('夹具错误：步进按钮未渲染');
  return {
    container,
    input: input as HTMLInputElement,
    inc: inc as HTMLElement,
    dec: dec as HTMLElement,
    onCommit,
    onCancel,
  };
}

/** 画布全局键位的替身：window **冒泡**阶段监听（MatchEditorKey 就挂在 window 上） */
function spyCanvasKeys(): { spy: () => number; off: () => void } {
  const fn = vi.fn();
  window.addEventListener('keydown', fn);
  return { spy: () => fn.mock.calls.length, off: () => window.removeEventListener('keydown', fn) };
}

describe('FrameDepthBubble', () => {
  it('预填当前深度；Enter 提交该值', () => {
    const { input, onCommit } = renderBubble({ current: 3, max: 5 });
    expect(input.value).toBe('3');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(3);
  });

  it('★ 挂载即强制聚焦输入框（不依赖 autoFocus：右键菜单卸载会把焦点抢回画布）', () => {
    const { input } = renderBubble();
    expect(document.activeElement).toBe(input);
  });

  it('★ 焦点不在输入框时 Enter 仍提交，且不落到画布键位（capture 阶段消费）', () => {
    const { input, onCommit } = renderBubble({ current: 2, max: 5 });
    fireEvent.change(input, { target: { value: '3' } });
    input.blur(); // 模拟焦点被画布 / 框内行抢走（用户实测症状）
    expect(document.activeElement).not.toBe(input);

    const canvas = spyCanvasKeys();
    fireEvent.keyDown(window, { key: 'Enter' }); // 派发到 window：只靠 capture 监听能收到
    const canvasHits = canvas.spy();
    canvas.off();

    expect(onCommit).toHaveBeenCalledWith(3);
    expect(canvasHits).toBe(0); // 不触发 matchEditorKey → 不建同级
  });

  it('★ 焦点不在输入框时 Esc 仍取消（不写盘）', () => {
    const { input, onCancel, onCommit } = renderBubble();
    fireEvent.change(input, { target: { value: '4' } });
    input.blur();
    const canvas = spyCanvasKeys();
    fireEvent.keyDown(window, { key: 'Escape' });
    const canvasHits = canvas.spy();
    canvas.off();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
    expect(canvasHits).toBe(0);
  });

  it('★ 修饰键 Enter（Shift/Alt）同样归气泡，不漏给画布（Shift+Enter=描述）', () => {
    const a = renderBubble({ current: 2, max: 5 });
    const canvas = spyCanvasKeys();
    fireEvent.keyDown(window, { key: 'Enter', shiftKey: true });
    const shiftHits = canvas.spy();
    canvas.off();
    expect(a.onCommit).toHaveBeenCalledWith(2);
    expect(shiftHits).toBe(0);
  });

  it('★ 输入框内按键仍走同一路径（capture 优先，不重复提交）', () => {
    const { input, onCommit } = renderBubble({ current: 2, max: 5 });
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledTimes(1); // 只提交一次，没有第二条路径再补一刀
    expect(onCommit).toHaveBeenCalledWith(5);
  });

  it('输入值钳进 [1, max]：99 → max；0 / 负数 → 1', () => {
    const a = renderBubble({ current: 2, max: 5 });
    fireEvent.change(a.input, { target: { value: '99' } });
    fireEvent.keyDown(a.input, { key: 'Enter' });
    expect(a.onCommit).toHaveBeenCalledWith(5);

    const b = renderBubble({ current: 2, max: 5 });
    fireEvent.change(b.input, { target: { value: '0' } });
    fireEvent.keyDown(b.input, { key: 'Enter' });
    expect(b.onCommit).toHaveBeenCalledWith(1);

    const c = renderBubble({ current: 2, max: 5 });
    fireEvent.change(c.input, { target: { value: '-3' } });
    fireEvent.keyDown(c.input, { key: 'Enter' });
    expect(c.onCommit).toHaveBeenCalledWith(1);
  });

  it('非法输入（空 / 非数字）Enter 不提交（气泡保持，可继续改）', () => {
    const { input, onCommit, onCancel } = renderBubble();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('★ ± 步进即提交（钳在 [1, max]）——无需再按 Enter，也不留焦点在按钮', () => {
    const inc = renderBubble({ current: 2, max: 3 });
    fireEvent.click(inc.inc);
    expect(inc.onCommit).toHaveBeenCalledWith(3);

    const dec = renderBubble({ current: 2, max: 3 });
    fireEvent.click(dec.dec);
    expect(dec.onCommit).toHaveBeenCalledWith(1);

    // 以上界为基准：+ 不再越界
    const capped = renderBubble({ current: 3, max: 3 });
    fireEvent.click(capped.inc);
    expect(capped.onCommit).toHaveBeenCalledWith(3);

    // 手输后步进：以输入框当前值为基准
    const typed = renderBubble({ current: 2, max: 8 });
    fireEvent.change(typed.input, { target: { value: '5' } });
    fireEvent.click(typed.inc);
    expect(typed.onCommit).toHaveBeenCalledWith(6);
  });

  it('Esc 取消（不改盘）；点外部（遮罩）取消', () => {
    const a = renderBubble();
    fireEvent.change(a.input, { target: { value: '4' } });
    fireEvent.keyDown(a.input, { key: 'Escape' });
    expect(a.onCancel).toHaveBeenCalledTimes(1);
    expect(a.onCommit).not.toHaveBeenCalled();

    const b = renderBubble();
    fireEvent.pointerDown(b.container.querySelector('[data-frame-depth-backdrop]') as HTMLElement);
    expect(b.onCancel).toHaveBeenCalledTimes(1);
    expect(b.onCommit).not.toHaveBeenCalled();
  });

  it('展示合法范围（1…max，与 frameDepthRange 同源）', () => {
    const { container } = renderBubble({ max: 8 });
    expect(container.querySelector('[data-frame-depth-bubble]')?.textContent).toContain('1…8');
  });
});
