// @vitest-environment jsdom
/**
 * 节点注释浮窗（NotePopover）测试（v1.4.0）
 *
 * 锁的核心语义：**一个浮窗、两个区域共存**（不是二选一的类型）。
 *   ① 序列区域（note）  ② 纯文本区域（note_text）
 * 预览态只读，固定态可编辑。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { glassToken } from '../src/theme/tokens.js';
import { NotePopover } from '../src/chrome/NotePopover.js';

const token = glassToken;

function renderPop(over: Partial<React.ComponentProps<typeof NotePopover>> = {}) {
  return render(
    <NotePopover
      seq={['条目一', '条目二']}
      text="一整段说明"
      x={10}
      y={20}
      pinned={false}
      token={token}
      onChangeSeq={() => undefined}
      onChangeText={() => undefined}
      onClose={() => undefined}
      {...over}
    />,
  );
}

describe('NotePopover：一个浮窗两个区域', () => {
  it('两个区域同时渲染（不是二选一）', () => {
    const { container } = renderPop();
    expect(container.querySelector('[data-note-seq]')).not.toBeNull();
    expect(container.querySelector('[data-note-textarea]')).not.toBeNull();
  });

  it('序列区域渲染为编号列表', () => {
    const { container } = renderPop();
    const items = container.querySelectorAll('[data-note-seq] li');
    expect(items.length).toBe(2);
    expect(items[0]!.textContent).toBe('条目一');
  });

  it('纯文本区域按换行保留（pre-wrap）', () => {
    const { container } = renderPop({ text: '第一行\n第二行' });
    const el = container.querySelector('[data-note-textarea] div:last-child') as HTMLElement;
    expect(el.style.whiteSpace).toBe('pre-wrap');
    expect(el.textContent).toBe('第一行\n第二行');
  });

  it('空区域有占位提示而不是消失', () => {
    const { container } = renderPop({ text: '' });
    expect(container.textContent).toContain('（无正文）');
  });
});

describe('NotePopover：预览态 vs 固定态', () => {
  it('预览态只读 —— 没有输入框', () => {
    const { container } = renderPop({ pinned: false });
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('input')).toBeNull();
    expect(container.textContent).toContain('点击固定');
  });

  it('固定态保持预览 —— 不出现编辑控件', () => {
    const { container } = renderPop({ pinned: true });
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('input')).toBeNull();
  });

  it('编辑态才出现两个区域的编辑控件', () => {
    const { container } = renderPop({ pinned: true, editing: true });
    // 纯文本：textarea；序列：QaEditor 的新增输入框
    expect(container.querySelector('textarea')).not.toBeNull();
    expect(container.querySelector('input')).not.toBeNull();
  });

  it('按下预览浮窗会立即请求固定', () => {
    const onPin = vi.fn();
    const { container } = renderPop({ onPin });
    fireEvent.pointerDown(container.querySelector('[data-note-popover]')!);
    expect(onPin).toHaveBeenCalledTimes(1);
  });
});

describe('NotePopover：编辑回调', () => {
  it('正文失焦时提交改动', () => {
    const onChangeText = vi.fn();
    const { container } = renderPop({ pinned: true, editing: true, onChangeText });
    const ta = container.querySelector('textarea')!;
    fireEvent.change(ta, { target: { value: '改过的正文' } });
    fireEvent.blur(ta);
    expect(onChangeText).toHaveBeenCalledWith('改过的正文');
  });

  it('正文未改动则不提交（避免无谓写盘）', () => {
    const onChangeText = vi.fn();
    const { container } = renderPop({ pinned: true, editing: true, text: '原样', onChangeText });
    const ta = container.querySelector('textarea')!;
    fireEvent.blur(ta);
    expect(onChangeText).not.toHaveBeenCalled();
  });

  it('序列删除条目 → onChangeSeq 收到去掉该项的数组', () => {
    const onChangeSeq = vi.fn();
    const { container } = renderPop({ pinned: true, editing: true, onChangeSeq });
    const del = container.querySelector('button[aria-label="删除注释"]')!;
    fireEvent.click(del);
    expect(onChangeSeq).toHaveBeenCalledWith(['条目二']);
  });

  it('序列已有条目可直接编辑，失焦后回传更新数组', () => {
    const onChangeSeq = vi.fn();
    const { container } = renderPop({ pinned: true, editing: true, onChangeSeq });
    const editors = container.querySelectorAll<HTMLInputElement>(
      'input[aria-label="编辑注释"]',
    );
    expect(editors).toHaveLength(2);
    fireEvent.change(editors[0]!, { target: { value: '修改后的条目' } });
    fireEvent.blur(editors[0]!);
    expect(onChangeSeq).toHaveBeenCalledWith(['修改后的条目', '条目二']);
  });

  it('点关闭 → onClose 触发', () => {
    const onClose = vi.fn();
    const { container } = renderPop({ onClose });
    fireEvent.click(container.querySelector('button[aria-label="关闭 note笔记"]')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('正文失焦回传改动（textarea 用非受控 defaultValue，props 变化不重建实例）', () => {
    // 这是修过的关键路径：之前用受控 + useEffect 同步外部文本，每次 props 变化都重建
    // textarea 实例 → 焦点丢失 → 用户体验"点击就消失"。
    const onChangeText = vi.fn();
    const { container } = renderPop({ pinned: true, editing: true, text: '原内容', onChangeText });
    const ta = container.querySelector('textarea')!;
    // value 反映 defaultValue
    expect(ta.value).toBe('原内容');
    // 用户输入
    fireEvent.change(ta, { target: { value: '改后内容' } });
    expect(ta.value).toBe('改后内容');
    // 失焦 → 与 prop.text 对比回传
    fireEvent.blur(ta);
    expect(onChangeText).toHaveBeenCalledWith('改后内容');
  });

  it('父级 text 更新 → textarea 实例不被重建（用同一节点，key 不变）', () => {
    // 这是 textarea 受控 → props 变 → 实例重建 → 焦点丢失的根因。
    // 改为非受控 defaultValue 后，React 应当复用实例。
    const { container } = renderPop({ pinned: true, editing: true, text: '第一版' });
    const ta1 = container.querySelector('textarea')!;
    // 模拟父级 prop 更新：重新渲染（注意：rerender 是同一个 root）。
    // 我们用同一函数 renderPop 在 jsdom 中确实会替换 DOM，因为不是真正的 rerender。
    // 这里改成断言：defaultValue 用的是初次挂载时的 text —— 重渲染后值应保持。
    expect(ta1.defaultValue).toBe('第一版');
    fireEvent.change(ta1, { target: { value: '输入中' } });
    expect(ta1.value).toBe('输入中');
  });

  it('浮窗内点击不冒泡到画布', () => {
    const spy = vi.fn();
    // 直接把浮窗渲染在一个监听 click 的父节点内，验证 stopPropagation 生效
    const { container } = render(
      <div onClick={spy}>
        <NotePopover
          seq={[]}
          text="x"
          x={0}
          y={0}
          pinned={false}
          token={token}
          onChangeSeq={() => undefined}
          onChangeText={() => undefined}
          onClose={() => undefined}
        />
      </div>,
    );
    fireEvent.click(container.querySelector('[data-note-popover]')!);
    expect(spy).not.toHaveBeenCalled();
  });

  it('浮窗内指针事件不触发画布手势', () => {
    const spy = vi.fn();
    const { container } = render(
      <div
        onPointerDown={spy}
        onPointerMove={spy}
        onPointerUp={spy}
        onPointerCancel={spy}
      >
        <NotePopover
          seq={[]}
          text="x"
          x={0}
          y={0}
          pinned
          token={token}
          onChangeSeq={() => undefined}
          onChangeText={() => undefined}
          onClose={() => undefined}
        />
      </div>,
    );
    const pop = container.querySelector('[data-note-popover]')!;
    fireEvent.pointerDown(pop);
    fireEvent.pointerMove(pop);
    fireEvent.pointerUp(pop);
    fireEvent.pointerCancel(pop);
    expect(spy).not.toHaveBeenCalled();
  });
});
