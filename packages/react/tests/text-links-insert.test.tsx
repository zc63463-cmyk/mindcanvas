// @vitest-environment jsdom
/**
 * L3：插入链接入口（复用 EdgeAnchorPicker；textarea 光标处插入）。
 *
 * 契约：
 *  - 编辑态 + root → 「插入链接」按钮；点击 → 候选选择器（portal 到 body）；
 *  - 选中候选 → textarea 光标处插入 `[显示名](锚)`；显示名取路径末段；
 *  - T-A7：目标节点有 cid → 写 `cid:cX`（稳定身份）；无 cid → 路径锚；
 *  - Esc / 点遮罩取消 → 无插入；root 缺省 / 非编辑态 → 无按钮（缺省纪律）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { makeTextNode } from '@mindcanvas/kernel';
import type { EditableNode } from '@mindcanvas/kernel';
import { NoteGrowthPanel } from '../src/chrome/NoteGrowthPanel.js';
import { NotePopover } from '../src/chrome/NotePopover.js';
import { glassToken } from '../src/theme/tokens.js';

// vitest 未开 globals，@testing-library/react 不会自动清理 DOM；本文件用 baseElement
// 查 portal（候选选择器渲染到 body），必须显式 afterEach(cleanup) 防跨用例残留命中
afterEach(cleanup);

const token = glassToken;

/** 树：根 → [任务 → A, B] */
function tree(): EditableNode {
  return makeTextNode('根', [makeTextNode('任务', [makeTextNode('A')]), makeTextNode('B')]);
}

/** 给 A 设 cid:c-a（模拟已升格/切断过的节点） */
function treeWithCid(): EditableNode {
  const root = tree();
  const a = root.children[0]?.children[0];
  if (!a) throw new Error('夹具失败：A 缺失');
  a.note = { cid: 'c-a' };
  return root;
}

function need<T extends Element>(el: T | null, what: string): T {
  if (el === null) throw new Error(`夹具断言失败：未渲染 ${what}`);
  return el;
}

function needTextArea(el: Element | null): HTMLTextAreaElement {
  if (!(el instanceof HTMLTextAreaElement)) throw new Error('夹具断言失败：textarea 缺失');
  return el;
}

function renderPopover(props: Partial<React.ComponentProps<typeof NotePopover>> = {}) {
  return render(
    <NotePopover
      seq={[]}
      text=""
      x={0}
      y={0}
      pinned
      editing
      token={token}
      onChangeSeq={() => {}}
      onChangeText={() => {}}
      onClose={() => {}}
      {...props}
    />,
  );
}

describe('L3 · NotePopover 插入链接', () => {
  it('编辑态 + root → 按钮存在；点开 → 候选选择器出现（portal）', () => {
    const { container, baseElement } = renderPopover({ root: tree(), text: 'AB' });
    const btn = need(container.querySelector('[data-insert-link]'), '插入链接按钮');
    fireEvent.click(btn);
    expect(baseElement.querySelector('[data-edge-anchor-panel]')).not.toBeNull();
  });

  it('选中候选 → 光标处插入 [显示名](路径锚)；光标移到插入尾', () => {
    const { container, baseElement } = renderPopover({ root: tree(), text: 'AB' });
    const ta = needTextArea(container.querySelector('[data-note-textarea] textarea'));
    ta.setSelectionRange(1, 1);
    fireEvent.click(need(container.querySelector('[data-insert-link]'), '按钮'));
    fireEvent.click(
      need(baseElement.querySelector('[data-edge-anchor-option="node:根/任务/A"]'), '候选 A'),
    );
    expect(ta.value).toBe('A[A](node:根/任务/A)B');
    expect(ta.selectionStart).toBe(1 + '[A](node:根/任务/A)'.length);
    expect(baseElement.querySelector('[data-edge-anchor-panel]')).toBeNull();
  });

  it('光标记录挂在 pointerdown（失焦重置 selection 之前）——click 前已丢失 selection 也能插回原光标', () => {
    const { container, baseElement } = renderPopover({ root: tree(), text: 'AB' });
    const ta = needTextArea(container.querySelector('[data-note-textarea] textarea'));
    ta.setSelectionRange(1, 1);
    const btn = need(container.querySelector('[data-insert-link]'), '按钮');
    fireEvent.pointerDown(btn); // 记录 caret={1,1}
    ta.setSelectionRange(0, 0); // 模拟真实浏览器失焦后 selection 被重置
    fireEvent.click(btn);
    fireEvent.click(
      need(baseElement.querySelector('[data-edge-anchor-option="node:根/任务/A"]'), '候选 A'),
    );
    expect(ta.value).toBe('A[A](node:根/任务/A)B'); // 插在 1——而非重置后的 0
  });

  it('T-A7：目标节点有 cid → 插入 cid: 形态', () => {
    const { container, baseElement } = renderPopover({ root: treeWithCid(), text: '' });
    const ta = needTextArea(container.querySelector('[data-note-textarea] textarea'));
    fireEvent.click(need(container.querySelector('[data-insert-link]'), '按钮'));
    fireEvent.click(
      need(baseElement.querySelector('[data-edge-anchor-option="node:根/任务/A"]'), '候选 A'),
    );
    expect(ta.value).toBe('[A](cid:c-a)');
  });

  it('Esc 取消 → 关闭选择器、不插入', () => {
    const { container, baseElement } = renderPopover({ root: tree(), text: 'AB' });
    const ta = needTextArea(container.querySelector('[data-note-textarea] textarea'));
    fireEvent.click(need(container.querySelector('[data-insert-link]'), '按钮'));
    expect(baseElement.querySelector('[data-edge-anchor-panel]')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(baseElement.querySelector('[data-edge-anchor-panel]')).toBeNull();
    expect(ta.value).toBe('AB');
  });

  it('回归钉：root 缺省 → 无按钮（不做无候选入口）', () => {
    const { container } = renderPopover({ text: 'AB' });
    expect(container.querySelector('[data-insert-link]')).toBeNull();
  });

  it('回归钉：非编辑态 → 无按钮（只读态不提供插入）', () => {
    const { container } = renderPopover({ root: tree(), editing: false });
    expect(container.querySelector('[data-insert-link]')).toBeNull();
  });
});

describe('L3 · NoteGrowthPanel 插入链接', () => {
  function renderGrowth(props: Partial<React.ComponentProps<typeof NoteGrowthPanel>> = {}) {
    return render(
      <NoteGrowthPanel
        seq={[]}
        text=""
        editing
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

  it('编辑态 + root → 按钮；插入生效（尾部光标）', () => {
    const { container, baseElement } = renderGrowth({ text: 'X', root: tree() });
    const ta = needTextArea(container.querySelector('[data-note-growth-text] textarea'));
    ta.setSelectionRange(1, 1);
    fireEvent.click(need(container.querySelector('[data-insert-link]'), '按钮'));
    fireEvent.click(
      need(baseElement.querySelector('[data-edge-anchor-option="node:根/任务/A"]'), '候选 A'),
    );
    expect(ta.value).toBe('X[A](node:根/任务/A)');
  });
});
