// @vitest-environment jsdom
/**
 * P1-N3：note 面板翻面接线（NotePopover · embedded 固定卡）判别测试。
 *
 * 反例三钉（派遣计划 §N3）：
 *   ① 无 `note.md` → 无翻面按钮、面板与今天逐位一致（DOM 断言）；
 *   ② 单击选中/双击编辑不受影响（按钮命中区独立 + stopPropagation 纪律）；
 *   ③ 翻面不改变 `estimateNoteAreaHeight` 的返回值与面板 footprint。
 * 另测：有 `md` → 按钮出现、受控翻转（按钮与翻卡双层 aria-pressed）；
 * floating 预览 / 编辑态不翻（§1.2「不做 hover 预览浮窗的翻面」+ 背面编辑归 P2）。
 *
 * 说明：载体 = 生产固定卡的既有组件 `NotePopover`（`mode="embedded"` + `pinned`，
 * MapView `fixedNotePanels` 渲染位）——见 P1 报告 §N3 宿主勘误一节。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { glassToken } from '../src/theme/tokens.js';
import { NotePopover } from '../src/chrome/NotePopover.js';
import { estimateNoteAreaHeight } from '../src/chrome/NoteGrowthPanel.js';

const token = glassToken;

function renderPanel(over: Partial<React.ComponentProps<typeof NotePopover>> = {}) {
  return render(
    <NotePopover
      seq={['条目一', '条目二']}
      text="正文内容"
      x={10}
      y={20}
      pinned
      mode="embedded"
      width={200}
      height={120}
      scale={1}
      token={token}
      onChangeSeq={() => undefined}
      onChangeText={() => undefined}
      onClose={() => undefined}
      {...over}
    />,
  );
}

describe('P1-N3 反例钉①：无 note.md → 零感知', () => {
  it('缺省 md → 无按钮、无翻卡包装，两区块照旧', () => {
    const { container } = renderPanel();
    expect(container.querySelector('[data-note-flip]')).toBeNull();
    expect(container.querySelector('[data-flip-card]')).toBeNull();
    expect(container.querySelector('[data-note-seq]')).not.toBeNull();
    expect(container.querySelector('[data-note-textarea]')).not.toBeNull();
  });

  it('空串 / 纯空白 md → 同样零感知', () => {
    expect(renderPanel({ md: '' }).container.querySelector('[data-note-flip]')).toBeNull();
    expect(renderPanel({ md: '   \n  ' }).container.querySelector('[data-note-flip]')).toBeNull();
  });
});

describe('P1-N3：有 note.md → 翻面可用', () => {
  it('按钮出现（header 行内 + aria-pressed=false + title），正面区块原样', () => {
    const { container } = renderPanel({ md: '# 背面标题' });
    const btn = container.querySelector('[data-note-flip]');
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute('aria-pressed')).toBe('false');
    expect(btn?.getAttribute('title')).not.toBeNull();
    // 与 onClose 同排：按钮所在 header 行含标题文本
    expect(btn?.parentElement?.textContent).toContain('note 笔记');
    // 正面两区块仍在（FlipCard 两面均挂载）
    expect(container.querySelector('[data-note-seq]')).not.toBeNull();
    expect(container.querySelector('[data-note-textarea]')).not.toBeNull();
  });

  it('点击按钮 → 双层 aria-pressed 翻转 + 背面 markdown 渲染', () => {
    const { container } = renderPanel({ md: '**粗** 背面正文' });
    const btn = container.querySelector('[data-note-flip]');
    if (btn === null) throw new Error('翻面按钮缺失');
    const card = container.querySelector('[data-flip-card]');
    expect(card).not.toBeNull();
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(card?.getAttribute('data-flip-state')).toBe('back');
    expect(container.querySelector('[data-note-back-md] strong')?.textContent).toBe('粗');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(card?.getAttribute('data-flip-state')).toBe('front');
  });

  it('背面内容为内部滚动容器（区域滚动、外层不滚）', () => {
    const { container } = renderPanel({ md: '长文' });
    const back = container.querySelector<HTMLElement>('[data-note-back-scroll]');
    expect(back).not.toBeNull();
    expect(back?.style.overflowY).toBe('auto');
  });

  it('背面内部锚点击 → onJumpToAnchor（链路透传）', () => {
    const jump = vi.fn();
    const { container } = renderPanel({ md: '去 [甲](node:根/甲)', onJumpToAnchor: jump });
    const anchor = container.querySelector('[data-note-md-anchor]');
    if (anchor === null) throw new Error('背面内部锚缺失');
    fireEvent.click(anchor);
    expect(jump).toHaveBeenCalledWith('node:根/甲');
  });

  it('floating 预览模式不翻（无按钮）', () => {
    const { container } = renderPanel({ md: 'x', mode: 'floating' });
    expect(container.querySelector('[data-note-flip]')).toBeNull();
  });

  it('编辑态不翻（无按钮；编辑控件照旧）', () => {
    const { container } = renderPanel({ md: 'x', editing: true });
    expect(container.querySelector('[data-note-flip]')).toBeNull();
    expect(container.querySelector('textarea')).not.toBeNull();
  });
});

describe('P1-N3 反例钉②：按钮命中区独立', () => {
  it('按钮 pointerdown/click 不触发 onClose；翻面动作生效', () => {
    const onClose = vi.fn();
    const { container } = renderPanel({ md: 'x', onClose });
    const btn = container.querySelector('[data-note-flip]');
    if (btn === null) throw new Error('翻面按钮缺失');
    fireEvent.pointerDown(btn);
    fireEvent.click(btn);
    expect(onClose).not.toHaveBeenCalled();
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('面板内容双击不触发翻面（与编辑手势互不干扰）', () => {
    const { container } = renderPanel({ md: 'x' });
    const btn = container.querySelector('[data-note-flip]');
    if (btn === null) throw new Error('翻面按钮缺失');
    const seq = container.querySelector('[data-note-seq]');
    if (seq === null) throw new Error('序列区缺失');
    fireEvent.doubleClick(seq);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('P1-N3 反例钉③：footprint 不变', () => {
  it('estimateNoteAreaHeight 返回值不变（12 + 120 = 132）', () => {
    expect(estimateNoteAreaHeight()).toBe(132);
  });

  it('翻面不改变面板尺寸（翻前后 width/height 样式一致）', () => {
    const { container } = renderPanel({ md: 'x' });
    const root = container.querySelector<HTMLElement>('[data-note-popover]');
    if (root === null) throw new Error('面板根缺失');
    const before = { w: root.style.width, h: root.style.height };
    const btn = container.querySelector('[data-note-flip]');
    if (btn === null) throw new Error('翻面按钮缺失');
    fireEvent.click(btn);
    expect(root.style.width).toBe(before.w);
    expect(root.style.height).toBe(before.h);
  });
});
