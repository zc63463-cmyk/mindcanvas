// @vitest-environment jsdom
/**
 * P2：节点卡背面编辑（NoteBackEditor + NotePopover 接线）判别测试。
 *
 * 覆盖三块：
 *   ① 「编辑背面」入口条件——**仅** `isFlipped && md 非空 && !floating` 渲染
 *      （缺省/正面态/floating/正面编辑态 = 零新增 DOM；P1 零感知语义不动）；
 *   ② 进入/退出编辑——点击 → 浮窗渲染 `NoteBackEditor`（替代 seq/text 区）→
 *      提交/取消 → 退出（保持 isFlipped，回背面视图看新内容）；
 *   ③ 编辑器纪律（对齐 DescBlock 实测：失焦提交 / Shift+Enter 提交 / Esc 取消；
 *      Enter 换行）与 NotePopover 正文区做法（非受控 textarea）。
 *
 * 提交值通道：组件**总是上抛原文**（不 trim——`note.md` 前导空白有意义，
 * 「不 trim 存储值，只 trim 判空」由写回链执行）；「无改动不提交」的无谓写盘
 * 防护在接线层（对比当前 md prop，同 note-popover「正文未改动则不提交」纪律）。
 *
 * 注：全部元素获取走守卫式 `must()`（不写非空断言）——新测试不得抬升 lint 计数。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { glassToken } from '../src/theme/tokens.js';
import { NotePopover } from '../src/chrome/NotePopover.js';
import { NoteBackEditor } from '../src/chrome/NoteBackEditor.js';

const token = glassToken;

/** 元素获取守卫（缺元素即抛，带现场说明） */
function must<E extends Element>(el: E | null, what: string): E {
  if (el === null) throw new Error(`缺少元素：${what}`);
  return el;
}

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

/** 翻面（embedded 固定卡 + md 非空 → 有翻面按钮） */
function flipTo(container: HTMLElement): void {
  fireEvent.click(must(container.querySelector('[data-note-flip]'), '翻面按钮'));
}

/** 点「编辑背面」进入 md 编辑态 */
function enterMdEdit(container: HTMLElement): void {
  fireEvent.click(must(container.querySelector('[data-note-md-edit]'), '编辑背面按钮'));
}

describe('P2 入口①：编辑背面按钮条件（零新增 DOM）', () => {
  it('缺省 md：无按钮（默认态 DOM 与 P1 一致）', () => {
    const { container } = renderPanel();
    expect(container.querySelector('[data-note-md-edit]')).toBeNull();
  });

  it('正面态（未翻面）：无按钮；翻面后出现', () => {
    const { container } = renderPanel({ md: '# 背面' });
    expect(container.querySelector('[data-note-md-edit]')).toBeNull();
    flipTo(container);
    expect(container.querySelector('[data-note-md-edit]')).not.toBeNull();
  });

  it('floating 模式：无按钮（悬停预览不提供编辑）', () => {
    const { container } = renderPanel({ md: '# 背面', mode: 'floating' });
    expect(container.querySelector('[data-note-md-edit]')).toBeNull();
  });

  it('正面编辑态（editing）：无按钮', () => {
    const { container } = renderPanel({ md: '# 背面', editing: true });
    expect(container.querySelector('[data-note-md-edit]')).toBeNull();
  });

  it('空串 / 纯空白 md：无按钮', () => {
    expect(renderPanel({ md: '' }).container.querySelector('[data-note-md-edit]')).toBeNull();
    expect(renderPanel({ md: '  \n ' }).container.querySelector('[data-note-md-edit]')).toBeNull();
  });
});

describe('P2 入口②：进入编辑 → 浮窗编辑器（替代 seq/text 区）', () => {
  it('点击 → 渲染 NoteBackEditor，正面两区块让位', () => {
    const { container } = renderPanel({ md: '# 背面' });
    flipTo(container);
    enterMdEdit(container);
    expect(container.querySelector('[data-note-md-editor]')).not.toBeNull();
    expect(container.querySelector('[data-note-seq]')).toBeNull();
    expect(container.querySelector('[data-note-textarea]')).toBeNull();
    // 编辑态一律屏幕浮窗（D1：嵌入卡装不下编辑器）
    expect(container.querySelector('[data-note-popover]')?.getAttribute('data-note-mode')).toBe(
      'floating',
    );
  });

  it('Shift+Enter 提交 → onChangeMd(新值) + 退出（回背面视图）', () => {
    const onChangeMd = vi.fn();
    const { container } = renderPanel({ md: '# 旧', onChangeMd });
    flipTo(container);
    enterMdEdit(container);
    const ta = must(container.querySelector('[data-note-md-editor] textarea'), '源文 textarea');
    fireEvent.change(ta, { target: { value: '# 新' } });
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true });
    expect(onChangeMd).toHaveBeenCalledWith('# 新');
    expect(container.querySelector('[data-note-md-editor]')).toBeNull();
    expect(container.querySelector('[data-flip-card]')).not.toBeNull();
  });

  it('失焦提交 → onChangeMd(新值) + 退出', () => {
    const onChangeMd = vi.fn();
    const { container } = renderPanel({ md: '# 旧', onChangeMd });
    flipTo(container);
    enterMdEdit(container);
    const ta = must(container.querySelector('[data-note-md-editor] textarea'), '源文 textarea');
    fireEvent.change(ta, { target: { value: '# 失焦新值' } });
    fireEvent.blur(ta);
    expect(onChangeMd).toHaveBeenCalledWith('# 失焦新值');
    expect(container.querySelector('[data-note-md-editor]')).toBeNull();
  });

  it('未改动就失焦 → 不调 onChangeMd（防无谓写盘）+ 仍退出', () => {
    const onChangeMd = vi.fn();
    const { container } = renderPanel({ md: '# 原样', onChangeMd });
    flipTo(container);
    enterMdEdit(container);
    fireEvent.blur(
      must(container.querySelector('[data-note-md-editor] textarea'), '源文 textarea'),
    );
    expect(onChangeMd).not.toHaveBeenCalled();
    expect(container.querySelector('[data-note-md-editor]')).toBeNull();
  });

  it('Esc → 不写回 + 退出', () => {
    const onChangeMd = vi.fn();
    const { container } = renderPanel({ md: '# 旧', onChangeMd });
    flipTo(container);
    enterMdEdit(container);
    const ta = must(container.querySelector('[data-note-md-editor] textarea'), '源文 textarea');
    fireEvent.change(ta, { target: { value: '# 弃置' } });
    fireEvent.keyDown(ta, { key: 'Escape' });
    expect(onChangeMd).not.toHaveBeenCalled();
    expect(container.querySelector('[data-note-md-editor]')).toBeNull();
  });
});

describe('P2-N2 NoteBackEditor 组件纪律', () => {
  it('进入 autofocus（textarea 聚焦，同 DescBlock 进入编辑）', () => {
    const { container } = render(<NoteBackEditor md="# x" token={token} />);
    const ta = container.querySelector('textarea');
    expect(ta).not.toBeNull();
    expect(document.activeElement).toBe(ta);
  });

  it('双态切换：源文 → 预览（CardBackMarkdown 同源渲染）→ 源文；输入保留', () => {
    const { container } = render(<NoteBackEditor md="# 标题" token={token} />);
    const toggle = must(container.querySelector('[data-note-md-toggle]'), '双态切换按钮');
    const mode = (): string | null =>
      container.querySelector('[data-note-md-mode]')?.getAttribute('data-note-md-mode') ?? null;
    expect(mode()).toBe('source');
    // 用户输入 → 切预览：显示的是**当前输入**（而非挂载时旧值）
    const ta = must(container.querySelector('textarea'), '源文 textarea');
    fireEvent.change(ta, { target: { value: '**粗体** 新' } });
    fireEvent.click(toggle);
    expect(mode()).toBe('preview');
    expect(container.querySelector('[data-note-back-md] strong')?.textContent).toBe('粗体');
    expect(container.querySelector('textarea')).toBeNull();
    // 切回源文：草稿保留
    fireEvent.click(toggle);
    expect(mode()).toBe('source');
    expect(must(container.querySelector('textarea'), '源文 textarea').value).toBe('**粗体** 新');
  });

  it('切换按钮 pointerdown 抑制默认（防切换触发失焦提交的焦点转移）', () => {
    const { container } = render(<NoteBackEditor md="# x" token={token} />);
    const toggle = must(container.querySelector('[data-note-md-toggle]'), '双态切换按钮');
    expect(fireEvent.pointerDown(toggle)).toBe(false); // false = preventDefault 已被调用
  });

  it('提交上抛原文（不 trim —— 前导空白属 markdown 语义）', () => {
    const onCommit = vi.fn();
    const { container } = render(
      <NoteBackEditor md="  - 条目" token={token} onCommit={onCommit} />,
    );
    const ta = must(container.querySelector('textarea'), '源文 textarea');
    fireEvent.change(ta, { target: { value: '  **缩进**\n  ' } });
    fireEvent.blur(ta);
    expect(onCommit).toHaveBeenCalledWith('  **缩进**\n  ');
  });

  it('Enter（无修饰）不提交（换行语义，不拦截默认）', () => {
    const onCommit = vi.fn();
    const { container } = render(<NoteBackEditor md="# x" token={token} onCommit={onCommit} />);
    const ta = must(container.querySelector('textarea'), '源文 textarea');
    expect(fireEvent.keyDown(ta, { key: 'Enter' })).toBe(true);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
