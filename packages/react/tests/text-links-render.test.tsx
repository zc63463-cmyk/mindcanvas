// @vitest-environment jsdom
/**
 * L1：三区域只读态链接渲染判别测试（DescBlock / NotePopover / NoteGrowthPanel）。
 *
 * 钉住的契约：
 *  - 只读态：链接渲染为 span[data-text-link=锚原文][data-link-state=三态]，显示名为 label
 *    （`[label](target)` 的括号形态不可见）；well-formed + 回调 → 点击触发 onJumpToAnchor；
 *  - 幽灵态（T-A5）：dangling/stale 带 title 原因、点击不触发；
 *  - 缺省不注入回调 → 只渲染不可点（回归钉）；
 *  - 编辑态一行不动：textarea / QaEditor 态无任何 [data-text-link]。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { makeTextNode } from '@mindcanvas/kernel';
import type { EditableNode } from '@mindcanvas/kernel';
import { DescBlock } from '../src/chrome/DescBlock.js';
import { NoteGrowthPanel } from '../src/chrome/NoteGrowthPanel.js';
import { NotePopover } from '../src/chrome/NotePopover.js';
import { glassToken } from '../src/theme/tokens.js';

const token = glassToken;

/** 测试树：根 → [任务 → A（cid:c1）, B] */
function tree(): EditableNode {
  const a = makeTextNode('A');
  a.note = { cid: 'c1' };
  return makeTextNode('根', [makeTextNode('任务', [a]), makeTextNode('B')]);
}

/** 取元素或抛错（测试夹具守卫，避免非空断言） */
function need(el: Element | null, what: string): HTMLElement {
  if (!(el instanceof HTMLElement)) throw new Error(`夹具断言失败：未渲染 ${what}`);
  return el;
}

function renderDesc(text: string, props: Partial<React.ComponentProps<typeof DescBlock>> = {}) {
  return render(
    <DescBlock text={text} token={token} x={0} y={0} width={200} height={30} {...props} />,
  );
}

describe('DescBlock 只读态：链接渲染', () => {
  it('well-formed 链接：span 标记 + 显示名（括号原文不可见）', () => {
    const root = tree();
    const { container } = renderDesc('前 [名A](node:根/任务/A) 后', { root });
    const link = container.querySelector('[data-text-link]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('data-text-link')).toBe('node:根/任务/A');
    expect(link?.getAttribute('data-link-state')).toBe('well-formed');
    expect(link?.textContent).toBe('名A');
    const textEl = container.querySelector('[data-desc-text]');
    expect(textEl?.textContent).toBe('前 名A 后');
    expect(textEl?.textContent).not.toContain('](node:');
  });

  it('well-formed + 回调 → 点击触发 onJumpToAnchor(锚原文)，且不触发 onToggle', () => {
    const root = tree();
    const onJump = vi.fn();
    const onToggle = vi.fn();
    const { container } = renderDesc('点 [名A](node:根/任务/A) 这里', {
      root,
      onJumpToAnchor: onJump,
      onToggle,
    });
    fireEvent.click(need(container.querySelector('[data-text-link]'), '链接'));
    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledWith('node:根/任务/A');
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('dangling（幽灵态）：state 标记 + title 说明 + 点击不触发', () => {
    const root = tree();
    const onJump = vi.fn();
    const { container } = renderDesc('[去](node:根/不存在)', { root, onJumpToAnchor: onJump });
    const link = need(container.querySelector('[data-text-link]'), '链接');
    expect(link.getAttribute('data-link-state')).toBe('dangling');
    expect(link.getAttribute('title')).toContain('失效');
    fireEvent.click(link);
    expect(onJump).not.toHaveBeenCalled();
  });

  it('stale（同名歧义）：幽灵态 + 点击不触发', () => {
    const root = makeTextNode('根', [makeTextNode('X'), makeTextNode('X')]);
    const onJump = vi.fn();
    const { container } = renderDesc('[去](node:根/X)', { root, onJumpToAnchor: onJump });
    const link = need(container.querySelector('[data-text-link]'), '链接');
    expect(link.getAttribute('data-link-state')).toBe('stale');
    expect(link.getAttribute('title')).toContain('不确定');
    fireEvent.click(link);
    expect(onJump).not.toHaveBeenCalled();
  });

  it('回归钉：缺省不注入回调 → 链接只渲染不可点（点击无动作、不崩）', () => {
    const root = tree();
    const { container } = renderDesc('看 [名A](node:根/任务/A)', { root });
    const link = need(container.querySelector('[data-text-link]'), '链接');
    expect(link.getAttribute('data-link-state')).toBe('well-formed');
    expect(() => fireEvent.click(link)).not.toThrow();
  });

  it('回归钉：不传 root → 无三态（data-link-state=unknown），仍不可点', () => {
    const { container } = renderDesc('看 [名A](node:根/任务/A)');
    const link = need(container.querySelector('[data-text-link]'), '链接');
    expect(link.getAttribute('data-link-state')).toBe('unknown');
  });

  it('编辑态一行不动：textarea 态无 [data-text-link]', () => {
    const root = tree();
    const { container } = renderDesc('[名A](node:根/任务/A)', {
      root,
      editing: true,
      onJumpToAnchor: vi.fn(),
    });
    expect(container.querySelector('[data-desc-input]')).not.toBeNull();
    expect(container.querySelector('[data-text-link]')).toBeNull();
  });

  it('回归钉：无链接文本渲染不变（textContent 与原文逐字相同）', () => {
    const { container } = renderDesc('纯文本，没有链接');
    const textEl = container.querySelector('[data-desc-text]');
    expect(textEl?.textContent).toBe('纯文本，没有链接');
    expect(container.querySelector('[data-text-link]')).toBeNull();
  });
});

describe('NotePopover 只读态：链接渲染', () => {
  function renderPopover(props: Partial<React.ComponentProps<typeof NotePopover>> = {}) {
    return render(
      <NotePopover
        seq={[]}
        text=""
        x={0}
        y={0}
        pinned
        token={token}
        onChangeSeq={() => {}}
        onChangeText={() => {}}
        onClose={() => {}}
        {...props}
      />,
    );
  }

  it('序列区：条目内链接渲染 + 点击触发', () => {
    const root = tree();
    const onJump = vi.fn();
    const { container } = renderPopover({
      seq: ['[任务A](node:根/任务/A) 的备注'],
      root,
      onJumpToAnchor: onJump,
    });
    const link = need(container.querySelector('[data-note-seq] [data-text-link]'), '序列链接');
    expect(link.getAttribute('data-link-state')).toBe('well-formed');
    fireEvent.click(link);
    expect(onJump).toHaveBeenCalledWith('node:根/任务/A');
  });

  it('正文区：链接渲染 + 点击触发', () => {
    const root = tree();
    const onJump = vi.fn();
    const { container } = renderPopover({
      text: '正文里 [B](node:根/B) 链接',
      root,
      onJumpToAnchor: onJump,
    });
    const link = need(container.querySelector('[data-note-textarea] [data-text-link]'), '正文链接');
    fireEvent.click(link);
    expect(onJump).toHaveBeenCalledWith('node:根/B');
  });

  it('编辑态一行不动：QaEditor/textarea 态无 [data-text-link]', () => {
    const root = tree();
    const { container } = renderPopover({
      seq: ['[任务A](node:根/任务/A)'],
      text: '正文里 [B](node:根/B) 链接',
      editing: true,
      root,
      onJumpToAnchor: vi.fn(),
    });
    expect(container.querySelector('[data-text-link]')).toBeNull();
  });
});

describe('NoteGrowthPanel 只读态：链接渲染', () => {
  function renderGrowth(props: Partial<React.ComponentProps<typeof NoteGrowthPanel>> = {}) {
    return render(
      <NoteGrowthPanel
        seq={[]}
        text=""
        editing={false}
        token={token}
        x={0}
        y={0}
        width={200}
        height={120}
        onChangeSeq={() => {}}
        onChangeText={() => {}}
        onClose={() => {}}
        {...props}
      />,
    );
  }

  it('序列区 + 正文区的链接都渲染（点击触发）', () => {
    const root = tree();
    const onJump = vi.fn();
    const { container } = renderGrowth({
      seq: ['序 [任务A](node:根/任务/A)'],
      text: '文 [B](cid:c1)',
      root,
      onJumpToAnchor: onJump,
    });
    const seqLink = need(container.querySelector('[data-note-growth-seq] [data-text-link]'), '序列链接');
    expect(seqLink.getAttribute('data-link-state')).toBe('well-formed');
    fireEvent.click(seqLink);
    expect(onJump).toHaveBeenCalledWith('node:根/任务/A');
    const textLink = need(
      container.querySelector('[data-note-growth-text] [data-text-link]'),
      '正文链接',
    );
    expect(textLink.getAttribute('data-link-state')).toBe('well-formed');
  });

  it('编辑态一行不动：无 [data-text-link]', () => {
    const root = tree();
    const { container } = renderGrowth({
      seq: ['[任务A](node:根/任务/A)'],
      text: '文 [B](node:根/B)',
      editing: true,
      root,
      onJumpToAnchor: vi.fn(),
    });
    expect(container.querySelector('[data-text-link]')).toBeNull();
  });
});
