// @vitest-environment jsdom
/**
 * OverlayEditor：节点文本内联编辑（v1.3.0 Shift+Enter 切换描述；G10 编辑态 Tab 生长）。
 *
 * 关键回归点：原实现 onKeyDown 只判 `e.key === 'Enter'`，**不区分 Shift**——
 * Shift+Enter 被当作普通提交，导致幕布核心语义「Shift+Enter 切换主题 ↔ 描述」
 * 在编辑态完全失效。本测试锁定修复后的行为。
 *
 * G10 关键回归点：Tab 曾被 stopPropagation 拦掉后**什么都不做**，只换来浏览器
 * 默认焦点跳转；而单行 input 根本不需要 Tab 缩进。现 Tab = 提交 + 建子节点。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { glassToken } from '../src/theme/tokens.js';
import { OverlayEditor } from '../src/edit/OverlayEditor.js';

const token = glassToken;

afterEach(() => {
  cleanup();
});

function renderEditor(props: Partial<React.ComponentProps<typeof OverlayEditor>> = {}) {
  return render(
    <OverlayEditor
      x={0}
      y={0}
      w={200}
      h={36}
      initial="初始文本"
      token={token}
      depth={1}
      root={false}
      scale={1}
      onCommit={() => {}}
      onCancel={() => {}}
      {...props}
    />,
  );
}

describe('OverlayEditor：节点文本内联编辑', () => {
  it('Enter 提交（既有行为不变）', () => {
    const onCommit = vi.fn();
    const { container } = renderEditor({ onCommit });
    const input = container.querySelector('input')!;
    fireEvent.change(input, { target: { value: '改后的文本' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('改后的文本');
  });

  it('Esc 取消（既有行为不变）', () => {
    const onCancel = vi.fn();
    const onCommit = vi.fn();
    const { container } = renderEditor({ onCancel, onCommit });
    fireEvent.keyDown(container.querySelector('input')!, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('v1.3.0：Shift+Enter → 触发 onRequestDesc（主题 → 描述切换）', () => {
    const onRequestDesc = vi.fn();
    const { container } = renderEditor({ onRequestDesc });
    fireEvent.keyDown(container.querySelector('input')!, { key: 'Enter', shiftKey: true });
    expect(onRequestDesc).toHaveBeenCalledTimes(1);
  });

  it('v1.3.0：Shift+Enter 先落盘主题文本再切描述（防输入丢失）', () => {
    const onCommit = vi.fn();
    const onRequestDesc = vi.fn();
    const { container } = renderEditor({ onCommit, onRequestDesc });
    const input = container.querySelector('input')!;
    fireEvent.change(input, { target: { value: '主题文本' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onCommit).toHaveBeenCalledWith('主题文本');
    expect(onRequestDesc).toHaveBeenCalledTimes(1);
  });

  it('v1.3.0：未注入 onRequestDesc 时 Shift+Enter 退化为提交（向后兼容）', () => {
    const onCommit = vi.fn();
    const { container } = renderEditor({ onCommit });
    const input = container.querySelector('input')!;
    fireEvent.change(input, { target: { value: '兼容路径' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onCommit).toHaveBeenCalledWith('兼容路径');
  });

  it('提交幂等：重复 Enter 只提交一次（committedRef 守卫）', () => {
    const onCommit = vi.fn();
    const { container } = renderEditor({ onCommit });
    const input = container.querySelector('input')!;
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('键盘事件 stopPropagation（不冒泡到全局快捷键）', () => {
    const { container } = renderEditor();
    const input = container.querySelector('input')!;
    const spy = vi.fn();
    window.addEventListener('keydown', spy);
    fireEvent.keyDown(input, { key: 'Enter' });
    window.removeEventListener('keydown', spy);
    expect(spy).not.toHaveBeenCalled();
  });

  // ── G10：编辑态 Tab = 提交 + 建子节点（连续录入不打断）──

  it('G10：Tab → 触发 onTabGrow 并带上当前文本', () => {
    const onTabGrow = vi.fn();
    const { container } = renderEditor({ onTabGrow });
    const input = container.querySelector('input')!;
    fireEvent.change(input, { target: { value: '分支主题' } });
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(onTabGrow).toHaveBeenCalledWith('分支主题');
  });

  it('G10：Tab 不触发 onCommit —— 提交由上层统一做，避免在 undo 栈留两条', () => {
    // 若本组件自行 commit 后再交给上层 commitEdit，updateText 会被调用两次。
    const onCommit = vi.fn();
    const onTabGrow = vi.fn();
    const { container } = renderEditor({ onCommit, onTabGrow });
    const input = container.querySelector('input')!;
    fireEvent.change(input, { target: { value: '只提交一次' } });
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(onTabGrow).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('G10：Tab 之后随卸载触发 blur 不再二次提交（committedRef 守卫）', () => {
    const onCommit = vi.fn();
    const onTabGrow = vi.fn();
    const { container } = renderEditor({ onCommit, onTabGrow });
    const input = container.querySelector('input')!;
    fireEvent.change(input, { target: { value: '切换节点' } });
    fireEvent.keyDown(input, { key: 'Tab' });
    fireEvent.blur(input);
    expect(onTabGrow).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('G10：未注入 onTabGrow 时 Tab 不触发任何回调（向后兼容）', () => {
    const onCommit = vi.fn();
    const { container } = renderEditor({ onCommit });
    const input = container.querySelector('input')!;
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('G10：Tab 同样不冒泡（不误触画布层 add-child）', () => {
    const { container } = renderEditor({ onTabGrow: () => {} });
    const input = container.querySelector('input')!;
    const spy = vi.fn();
    window.addEventListener('keydown', spy);
    fireEvent.keyDown(input, { key: 'Tab' });
    window.removeEventListener('keydown', spy);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('OverlayEditor：FO-C1 换行模式（框内大纲行）', () => {
  it('渲染 textarea + pre-wrap：宽度 = 行盒宽，高度以行盒高为最小值，无 ellipsis 裁切', () => {
    const { container } = renderEditor({ wrap: true, w: 202, h: 22 });
    const ta = container.querySelector('textarea[data-overlay-editor="wrap"]');
    expect(ta).not.toBeNull();
    const el = ta as HTMLTextAreaElement;
    expect(el.style.whiteSpace).toBe('pre-wrap');
    expect(el.style.textOverflow).toBe(''); // 不再单行省略号
    expect(Number.parseFloat(el.style.width)).toBe(202); // 编辑面宽 ≈ 行内容宽
    expect(Number.parseFloat(el.style.minHeight)).toBe(22);
    // jsdom 无布局引擎（scrollHeight = 0）→ 高度退化为最小值（不虚构高度）
    expect(Number.parseFloat(el.style.height)).toBe(22);
    expect(container.querySelector('input')).toBeNull(); // 不再用单行 input
  });

  it('提交纪律与节点编辑一致：Enter 提交 / Esc 取消 / blur 提交', () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const { container } = renderEditor({ wrap: true, onCommit, onCancel });
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '需要在框内换行显示的长文本' } });
    fireEvent.keyDown(ta, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();

    const onCommit2 = vi.fn();
    const { container: c2 } = renderEditor({ wrap: true, onCommit: onCommit2 });
    const ta2 = c2.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(ta2, { target: { value: '提交这段文本' } });
    fireEvent.keyDown(ta2, { key: 'Enter' });
    expect(onCommit2).toHaveBeenCalledWith('提交这段文本');
  });
});
