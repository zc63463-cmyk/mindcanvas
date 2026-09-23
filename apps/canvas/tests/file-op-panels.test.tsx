// @vitest-environment jsdom
/**
 * P0-A ⑥：反馈面板的**渲染契约**（§5.2 / §5.3 / L3）。
 *
 * 为什么单独测组件：状态层的用例能证明「状态判据正确」，但证明不了「界面按判据
 * 收起了危险入口」。L3 的保护是**两段**的：
 *  ① 状态层：`copyHasNewChanges` 判据正确（file-op-partial.test 覆盖）；
 *  ② 渲染层：判据为真时**不渲染**「撤销新副本」，只渲染「放弃这些改动并删除副本」。
 * 只做 ① 不做 ② 时，用户仍能一键删掉有改动的副本 —— 这条正是本文件的判别目标。
 *
 * 同时钉住「不得用原生对话框」（no-native-dialogs 的同族要求）。
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** 取一个必须存在的元素（不用非空断言：lint 会记 warning，而这里本就需要「不存在即失败」） */
function must(c: HTMLElement, selector: string): HTMLElement {
  const el = c.querySelector(selector);
  if (el === null) throw new Error(`找不到元素 ${selector}`);
  return el as HTMLElement;
}
import {
  FileOpNotice,
  PartialSuccessPanel,
  RenameConflictPanel,
  RenameDirtyPanel,
} from '../src/FileOpPanels';

afterEach(cleanup);

beforeEach(() => {
  // 原生对话框一律不得触碰：被调用即抛错
  vi.spyOn(window, 'confirm').mockImplementation(() => {
    throw new Error('native confirm() 被调用');
  });
  vi.spyOn(window, 'prompt').mockImplementation(() => {
    throw new Error('native prompt() 被调用');
  });
});

describe('冲突三选（§5.2②）', () => {
  it('三个动作齐全，且「保留两份」是默认焦点（不静默替换）', () => {
    const onChoose = vi.fn();
    const { container } = render(
      <RenameConflictPanel name="架构.mm.md" keepBothName="架构 2.mm.md" onChoose={onChoose} />,
    );
    const keep = container.querySelector('[data-fm-conflict-keep]') as HTMLButtonElement;
    const replace = container.querySelector('[data-fm-conflict-replace]') as HTMLButtonElement;
    const cancel = container.querySelector('[data-fm-conflict-cancel]') as HTMLButtonElement;
    expect(keep).not.toBeNull();
    expect(replace).not.toBeNull();
    expect(cancel).not.toBeNull();
    // 默认焦点在安全侧：直接回车不会覆盖目标文件
    expect(document.activeElement).toBe(keep);
    expect(keep.textContent).toContain('架构 2.mm.md');
    // 替换的后果必须写明
    expect(container.textContent).toContain('不可撤销');
  });

  it('三选分别回传对应 choice（不吞动作、不自动选）', () => {
    for (const [selector, choice] of [
      ['[data-fm-conflict-keep]', 'keep-both'],
      ['[data-fm-conflict-replace]', 'replace'],
      ['[data-fm-conflict-cancel]', 'cancel'],
    ] as const) {
      const onChoose = vi.fn();
      const { container, unmount } = render(
        <RenameConflictPanel name="a.mm.md" keepBothName="a 2.mm.md" onChoose={onChoose} />,
      );
      fireEvent.click(must(container, selector));
      expect(onChoose).toHaveBeenCalledWith(choice);
      unmount();
    }
  });
});

describe('★部分成功面板（§5.3 + L3）', () => {
  const base = {
    createdPath: '归档/架构.mm.md',
    sourcePath: '研发/架构.mm.md',
    reason: '没有写入权限：请重新授权后重试。',
    onChoose: vi.fn(),
  };

  it('★必须出现「两份」说明并同时列出新位置与旧位置（F3 负控：不得按「移动失败」呈现）', () => {
    const { container } = render(<PartialSuccessPanel {...base} copyHasNewChanges={false} />);
    const text = container.textContent ?? '';
    expect(text).toContain('两份');
    expect(text).toContain('归档/架构.mm.md');
    expect(text).toContain('研发/架构.mm.md');
    expect(text).toContain('原因');
    expect(text).toContain('没有写入权限');
  });

  it('三个动作齐备（重试删除原文件 / 保留两份 / 撤销新副本）', () => {
    const { container } = render(<PartialSuccessPanel {...base} copyHasNewChanges={false} />);
    expect(container.querySelector('[data-fm-partial-retry]')).not.toBeNull();
    expect(container.querySelector('[data-fm-partial-keep]')).not.toBeNull();
    expect(container.querySelector('[data-fm-partial-undo]')).not.toBeNull();
    expect(container.querySelector('[data-fm-partial-later]')).not.toBeNull();
  });

  it('★L3 保护：有改动时**不渲染**「撤销新副本」，只给「放弃这些改动并删除副本」', () => {
    // 这是 L3 的第二段（渲染层）。状态层判据正确但这里放行的话，用户仍能一键删掉有改动的副本。
    const { container } = render(<PartialSuccessPanel {...base} copyHasNewChanges />);
    expect(container.querySelector('[data-fm-partial-undo]')).toBeNull();
    expect(container.querySelector('[data-fm-partial-discard-copy]')).not.toBeNull();
    // 并且明确告知后果
    expect(container.textContent).toContain('已有新的改动');
    expect(container.textContent).toContain('丢失');
  });

  it('★L3：显式「放弃这些改动并删除副本」才回传 discard-copy-changes（不是 undo-copy）', () => {
    const onChoose = vi.fn();
    const { container } = render(
      <PartialSuccessPanel {...base} onChoose={onChoose} copyHasNewChanges />,
    );
    fireEvent.click(must(container, '[data-fm-partial-discard-copy]'));
    expect(onChoose).toHaveBeenCalledWith('discard-copy-changes');
    // 绝不能把「放弃改动」悄悄当成普通撤销（两者的语义与后果不同）
    expect(onChoose).not.toHaveBeenCalledWith('undo-copy');
  });

  it('无改动时「撤销新副本」直接可用，回传 undo-copy', () => {
    const onChoose = vi.fn();
    const { container } = render(
      <PartialSuccessPanel {...base} onChoose={onChoose} copyHasNewChanges={false} />,
    );
    fireEvent.click(must(container, '[data-fm-partial-undo]'));
    expect(onChoose).toHaveBeenCalledWith('undo-copy');
  });

  it('四个动作分别回传对应 choice', () => {
    for (const [selector, choice] of [
      ['[data-fm-partial-retry]', 'retry-delete'],
      ['[data-fm-partial-keep]', 'keep-both'],
      ['[data-fm-partial-undo]', 'undo-copy'],
      ['[data-fm-partial-later]', 'later'],
    ] as const) {
      const onChoose = vi.fn();
      const { container, unmount } = render(
        <PartialSuccessPanel {...base} onChoose={onChoose} copyHasNewChanges={false} />,
      );
      fireEvent.click(must(container, selector));
      expect(onChoose).toHaveBeenCalledWith(choice);
      unmount();
    }
  });

  it('busy 时禁用写入类动作（防重复点击造出第二次删除）', () => {
    const { container } = render(
      <PartialSuccessPanel {...base} copyHasNewChanges={false} busy onChoose={vi.fn()} />,
    );
    expect((container.querySelector('[data-fm-partial-retry]') as HTMLButtonElement).disabled).toBe(true);
    expect((container.querySelector('[data-fm-partial-undo]') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('未保存三选（§5.2⑤）', () => {
  it('三个动作齐备且「保存并改名」为默认焦点', () => {
    const onChoose = vi.fn();
    const { container } = render(<RenameDirtyPanel name="架构.mm.md" onChoose={onChoose} />);
    const save = container.querySelector('[data-fm-rename-dirty-save]') as HTMLButtonElement;
    expect(document.activeElement).toBe(save);
    expect(container.querySelector('[data-fm-rename-dirty-discard]')).not.toBeNull();
    expect(container.querySelector('[data-fm-rename-dirty-cancel]')).not.toBeNull();
    // 说明「为什么」：改名复制的是磁盘快照
    expect(container.textContent).toContain('未保存');
  });

  it('三分支分别回传', () => {
    for (const [selector, choice] of [
      ['[data-fm-rename-dirty-save]', 'save-then-rename'],
      ['[data-fm-rename-dirty-discard]', 'discard-then-rename'],
      ['[data-fm-rename-dirty-cancel]', 'cancel'],
    ] as const) {
      const onChoose = vi.fn();
      const { container, unmount } = render(<RenameDirtyPanel name="a.mm.md" onChoose={onChoose} />);
      fireEvent.click(must(container, selector));
      expect(onChoose).toHaveBeenCalledWith(choice);
      unmount();
    }
  });
});

describe('提示条（错误码 → 文案的呈现）', () => {
  it('非空文案 → 渲染并可关闭', () => {
    const onDismiss = vi.fn();
    const { container } = render(
      <FileOpNotice notice="没有写入权限：请重新授权后重试。" onDismiss={onDismiss} />,
    );
    expect(container.querySelector('[data-fm-op-notice]')).not.toBeNull();
    fireEvent.click(must(container, '[data-fm-op-notice-dismiss]'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('★空文案 / null → **不渲染**（静默取消 = 不打扰用户）', () => {
    const a = render(<FileOpNotice notice="" />);
    expect(a.container.querySelector('[data-fm-op-notice]')).toBeNull();
    a.unmount();
    const b = render(<FileOpNotice notice={null} />);
    expect(b.container.querySelector('[data-fm-op-notice]')).toBeNull();
  });
});
