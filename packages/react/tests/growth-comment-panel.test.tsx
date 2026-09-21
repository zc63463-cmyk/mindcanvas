// @vitest-environment jsdom
/**
 * GrowthCommentPanel 组件单测：节点"向下生长"注释区（连体透明背景 + 内置滚动 + 增删改）。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { glassToken } from '../src/theme/tokens.js';
import {
  GrowthCommentPanel,
  GCP_HEADER_H,
  GCP_INPUT_H,
  GCP_ROW_H,
  estimateCommentAreaHeight,
} from '../src/chrome/GrowthCommentPanel.js';

const token = glassToken;

function renderPanel(props: Partial<React.ComponentProps<typeof GrowthCommentPanel>> = {}) {
  return render(
    <GrowthCommentPanel
      items={['观点对比', '路径可观察']}
      onChange={() => {}}
      onClose={() => {}}
      token={token}
      x={50}
      y={100}
      width={220}
      height={estimateCommentAreaHeight()}
      {...props}
    />,
  );
}

describe('GrowthCommentPanel：节点向下生长注释区', () => {
  it('无 qa 条目 → 不渲染', () => {
    const { container } = renderPanel({ items: [] });
    expect(container.querySelector('[data-grow-comment]')).toBeNull();
  });

  it('渲染头部 + 计数 + 关闭按钮', () => {
    const { container } = renderPanel();
    const root = container.querySelector('[data-grow-comment]');
    expect(root).not.toBeNull();
    expect(root!.textContent).toContain('快速注释');
    expect(root!.textContent).toContain('2');
    expect(container.querySelector('[data-gcp-close]')).not.toBeNull();
  });

  it('× 关闭 → 调 onClose（上层收起）', () => {
    const onClose = vi.fn();
    const { container } = renderPanel({ onClose });
    fireEvent.click(container.querySelector('[data-gcp-close]') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('内置滚动：条目区 overflow-y auto + max-height 上限', () => {
    const { container } = renderPanel();
    const scroll = container.querySelector('[data-gcp-scroll]') as HTMLElement;
    expect(scroll).not.toBeNull();
    const style = scroll.getAttribute('style') ?? '';
    expect(style).toContain('overflow-y: auto');
    expect(style).toContain('max-height');
  });

  it('透明背景（与上层 SVG 注释区连体，不画自己的背景）', () => {
    const { container } = renderPanel();
    const root = container.querySelector('[data-grow-comment]') as HTMLElement;
    expect(root.style.background).toBe('transparent');
  });

  it('坐标/尺寸由 props 传入（组件不参与位置决策）', () => {
    const { container } = renderPanel({ x: 250, y: 80, width: 200, height: 120 });
    const root = container.querySelector('[data-grow-comment]') as HTMLElement;
    expect(root.style.left).toBe('250px');
    expect(root.style.top).toBe('80px');
    expect(root.style.width).toBe('200px');
    expect(root.style.height).toBe('120px');
  });

  it('+ 号 → 调起添加输入 → 输入 + Enter 提交 onChange 追加新条目', () => {
    const onChange = vi.fn();
    const { container, rerender } = renderPanel({ items: ['A'], onChange });
    fireEvent.click(container.querySelector('[data-gcp-add]') as HTMLElement);
    rerender(
      <GrowthCommentPanel
        items={['A']}
        onChange={onChange}
        onClose={() => {}}
        token={token}
        x={0}
        y={0}
        width={220}
        height={120}
      />,
    );
    const input = container.querySelector('[data-gcp-input-adding]') as HTMLInputElement;
    expect(input).not.toBeNull();
    fireEvent.change(input, { target: { value: '新批注' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['A', '新批注']);
  });

  it('双击条目 → 行内编辑 → Enter 提交 onChange 更新该条', () => {
    const onChange = vi.fn();
    const { container } = renderPanel({ items: ['原始', '其他'], onChange });
    fireEvent.doubleClick(container.querySelector('[data-gcp-item="0"]') as HTMLElement);
    const input = container.querySelector('[data-gcp-input-editing]') as HTMLInputElement;
    expect(input).not.toBeNull();
    fireEvent.change(input, { target: { value: '已改' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['已改', '其他']);
  });

  it('Esc 在编辑中 → 退出编辑不写回', () => {
    const onChange = vi.fn();
    const { container } = renderPanel({ items: ['A'], onChange });
    fireEvent.doubleClick(container.querySelector('[data-gcp-item="0"]') as HTMLElement);
    const input = container.querySelector('[data-gcp-input-editing]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '改了一半' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector('[data-gcp-input-editing]')).toBeNull();
  });

  it('× 删除条目 → onChange 收到过滤后的数组', () => {
    const onChange = vi.fn();
    const { container } = renderPanel({ items: ['A', 'B', 'C'], onChange });
    fireEvent.click(container.querySelectorAll('button[aria-label="删除注释"]')[1] as HTMLElement);
    expect(onChange).toHaveBeenCalledWith(['A', 'C']);
  });

  it('长条目文字不截断：自动换行显示完整文本（滚动区兜底）', () => {
    const long = '解析路径要可观察：每步存疑与决策可回放';
    const { container } = renderPanel({ items: [long] });
    const item = container.querySelector('[data-gcp-item="0"]') as HTMLElement;
    const span = item.querySelector('span') as HTMLElement;
    // 换行显示（非 nowrap/ellipsis 截断），完整文本可见
    expect(span.style.whiteSpace).toBe('normal');
    expect(item.textContent).toContain('可回放');
    expect(span.style.textOverflow).not.toBe('ellipsis');
  });

  it('scale 缩放内容：尺寸随 scale 倍增（与视口缩放对齐，避免缩小裁剪）', () => {
    const { container } = renderPanel({ scale: 2 });
    const root = container.querySelector('[data-grow-comment]') as HTMLElement;
    const header = root.children[0] as HTMLElement;
    expect(header.style.height).toBe(`${GCP_HEADER_H * 2}px`);
    const item = container.querySelector('[data-gcp-item="0"]') as HTMLElement;
    expect(item.style.minHeight).toBe(`${GCP_ROW_H * 2}px`);
    const close = container.querySelector('[data-gcp-close]') as HTMLElement;
    expect(close.style.width).toBe(`${18 * 2}px`);
    const add = container.querySelector('[data-gcp-add]') as HTMLElement;
    expect(add.style.height).toBe(`${GCP_INPUT_H * 2}px`);
  });

  it('面板内 click/pointerdown stopPropagation（不冒泡到画布）', () => {
    const onBubble = vi.fn();
    const { container } = render(
      <div onPointerDown={() => onBubble('pointerdown')} onClick={() => onBubble('click')}>
        <GrowthCommentPanel
          items={['A']}
          onChange={() => {}}
          onClose={() => {}}
          token={token}
          x={0}
          y={0}
          width={220}
          height={120}
        />
      </div>,
    );
    const panel = container.querySelector('[data-grow-comment]') as HTMLElement;
    fireEvent.click(panel, { bubbles: true });
    expect(onBubble).not.toHaveBeenCalled();
  });
});
