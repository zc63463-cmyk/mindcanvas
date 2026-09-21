// @vitest-environment jsdom
/**
 * DescBlock 幕布描述块单测（v1.3.0）：
 * - 渲染：引用竖线 + 缩进 + 弱化文字
 * - 内容完整换行显示（pre-wrap），超过软上限由内部滚动 —— 无展开/收缩态
 * - 编辑态：textarea 聚焦、Shift+Enter 提交、Esc 取消、blur 提交
 * - 空文本不渲染（无描述时不占位）
 * - 高度估算：按行数增长，封顶 DESC_SOFT_MAX_LINES
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { glassToken } from '../src/theme/tokens.js';
import {
  DescBlock,
  descFontSize,
  estimateDescHeight,
  DESC_LINE_H,
  DESC_PAD,
  DESC_SOFT_MAX_LINES,
} from '../src/chrome/DescBlock.js';

const token = glassToken;

function renderDesc(props: Partial<React.ComponentProps<typeof DescBlock>> = {}) {
  return render(
    <DescBlock
      text="这是对主题的补充说明"
      token={token}
      x={0}
      y={0}
      width={200}
      height={estimateDescHeight('x')}
      {...props}
    />,
  );
}

describe('DescBlock：幕布描述块', () => {
  it('空文本且非编辑态 → 不渲染', () => {
    const { container } = renderDesc({ text: '' });
    expect(container.querySelector('[data-desc-block]')).toBeNull();
  });

  it('空文本但处于编辑态 → 渲染（新建描述占位）', () => {
    const { container } = renderDesc({ text: '', editing: true });
    expect(container.querySelector('[data-desc-block]')).not.toBeNull();
    expect(container.querySelector('[data-desc-input]')).not.toBeNull();
  });

  it('渲染描述文本 + data 标记（默认完整显示）', () => {
    const { container } = renderDesc();
    const root = container.querySelector('[data-desc-block]');
    expect(root).not.toBeNull();
    expect(root!.getAttribute('data-desc-expanded')).toBe('true');
    expect(container.querySelector('[data-desc-text]')!.textContent).toBe('这是对主题的补充说明');
  });

  it('不自动折行：pre（幕布语义 —— 一般横向撑长，除非主动换行）', () => {
    const { container } = renderDesc({ text: '第一行\n第二行' });
    const textEl = container.querySelector('[data-desc-text]') as HTMLElement;
    // pre = 保留显式 \n，但不在节点宽度处自动折行（自动折行会让短描述也占几行）
    expect(textEl.style.whiteSpace).toBe('pre');
  });

  it('pre 保留显式换行的多行', () => {
    const { container } = renderDesc({ text: '第一行\n第二行', expanded: true });
    const textEl = container.querySelector('[data-desc-text]')!;
    expect((textEl as HTMLElement).style.whiteSpace).toBe('pre');
  });

  it('点击描述区 → onToggle 触发（切换展开/收缩）', () => {
    const onToggle = vi.fn();
    const { container } = renderDesc({ onToggle });
    fireEvent.click(container.querySelector('[data-desc-block]')!);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('编辑态：Shift+Enter 提交（幕布「切换主题与描述」语义）', () => {
    const onCommit = vi.fn();
    const { container } = renderDesc({ editing: true, onCommit });
    const ta = container.querySelector('[data-desc-input]')!;
    fireEvent.change(ta, { target: { value: '新描述内容' } });
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true });
    expect(onCommit).toHaveBeenCalledWith('新描述内容');
  });

  it('编辑态：单独 Enter 不提交（用于换行）', () => {
    const onCommit = vi.fn();
    const { container } = renderDesc({ editing: true, onCommit });
    const ta = container.querySelector('[data-desc-input]')!;
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('编辑态：Esc 取消', () => {
    const onCancel = vi.fn();
    const onCommit = vi.fn();
    const { container } = renderDesc({ editing: true, onCancel, onCommit });
    fireEvent.keyDown(container.querySelector('[data-desc-input]')!, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('编辑态：blur 提交', () => {
    const onCommit = vi.fn();
    const { container } = renderDesc({ editing: true, onCommit });
    const ta = container.querySelector('[data-desc-input]')!;
    fireEvent.change(ta, { target: { value: '失焦提交' } });
    fireEvent.blur(ta);
    expect(onCommit).toHaveBeenCalledWith('失焦提交');
  });

  it('提交时 trim 首尾空白', () => {
    const onCommit = vi.fn();
    const { container } = renderDesc({ editing: true, onCommit });
    const ta = container.querySelector('[data-desc-input]')!;
    fireEvent.change(ta, { target: { value: '  两侧有空格  ' } });
    fireEvent.blur(ta);
    expect(onCommit).toHaveBeenCalledWith('两侧有空格');
  });
});

describe('estimateDescHeight：描述区高度估算', () => {
  it('空文本高度为 0（不占位）', () => {
    expect(estimateDescHeight('')).toBe(0);
  });

  it('按行数增长', () => {
    const one = estimateDescHeight('一行');
    const three = estimateDescHeight('a\nb\nc');
    expect(three).toBeGreaterThan(one);
    expect(three).toBe(3 * DESC_LINE_H + DESC_PAD * 2);
  });

  it('行数封顶 DESC_SOFT_MAX_LINES（超长描述不撑爆节点，改由内部滚动）', () => {
    const long = estimateDescHeight(
      Array.from({ length: 50 }, (_, i) => `行${i}`).join('\n'),
    );
    expect(long).toBe(DESC_SOFT_MAX_LINES * DESC_LINE_H + DESC_PAD * 2);
  });

  it('编辑态预留固定高度（先变大再键入）', () => {
    expect(estimateDescHeight('', true)).toBeGreaterThan(0);
  });
});

/**
 * friction-log 守卫（2026-09-03 用户反馈，用 mindcanvas 自建文件记下的两条）：
 * 这些断言锁的是**具体效果**而非常量本身 —— 把 DESC_SOFT_MAX_LINES 调回 6、
 * 或把字号改成不分差分，下面都会红。
 */
describe('friction-log 守卫：注释显示（2026-09-03）', () => {
  it('#1 十行描述展开态必须高于 6 行（不被裁成小窗口）', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `行${i}`).join('\n');
    expect(estimateDescHeight(ten)).toBeGreaterThan(6 * DESC_LINE_H + DESC_PAD * 2);
  });

  it('#1 DESC_SOFT_MAX_LINES 不低于 12（低于此值长描述又要靠滚动凑）', () => {
    expect(DESC_SOFT_MAX_LINES).toBeGreaterThanOrEqual(12);
  });

  it('#2 描述区字号随层级差分：根/分支 > 叶子', () => {
    expect(descFontSize(0)).toBeGreaterThan(descFontSize(2));
  });

  it('#2 叶子字号仍有可读性下限（不小于 8px）', () => {
    expect(descFontSize(2)).toBeGreaterThanOrEqual(8);
  });

  it('#2 行高不随层级差分 —— 与 measure 预留高度严格同口径，防错位', () => {
    // measure（createDescMeasure）拿不到 depth（EditableNode 无该字段），
    // 行高若差分就会与节点盒预留高度错位。描述区现在始终按完整内容渲染。
    const branch = estimateDescHeight('a\nb\nc');
    expect(branch).toBe(3 * DESC_LINE_H + DESC_PAD * 2);
  });
});
