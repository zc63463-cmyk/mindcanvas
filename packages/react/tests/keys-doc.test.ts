import { describe, expect, it } from 'vitest';
import { EDITOR_KEY_BINDINGS, matchEditorKey } from '../src/edit/keys.js';

function keyEvent(
  key: string,
  mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {},
): KeyboardEvent {
  return {
    key,
    ctrlKey: mods.ctrl ?? false,
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
    metaKey: false,
  } as KeyboardEvent;
}

describe('快捷键：文档操作（B1：Ctrl+O 打开 / Ctrl+N 新建）', () => {
  it('matchEditorKey 识别 Ctrl+O → open、Ctrl+N → new', () => {
    expect(matchEditorKey(keyEvent('o', { ctrl: true }))).toEqual({ type: 'open' });
    expect(matchEditorKey(keyEvent('n', { ctrl: true }))).toEqual({ type: 'new' });
    // 组合键仍优先：Ctrl+Shift+N 不是 new
    expect(matchEditorKey(keyEvent('n', { ctrl: true, shift: true }))).toBeNull();
    // 既有 Ctrl+S 不受影响（回归）
    expect(matchEditorKey(keyEvent('s', { ctrl: true }))).toEqual({ type: 'save' });
  });

  it('绑定表包含 打开/新建（帮助面板可见）', () => {
    const actions = EDITOR_KEY_BINDINGS.map((b) => b.action);
    expect(actions).toContain('open');
    expect(actions).toContain('new');
    const open = EDITOR_KEY_BINDINGS.find((b) => b.action === 'open');
    expect(open?.key).toBe('Ctrl+O');
  });
});

describe('快捷键：幕布描述（v1.3.0 Shift+Enter）', () => {
  it('Shift+Enter → desc（切换主题 ↔ 描述编辑）', () => {
    expect(matchEditorKey(keyEvent('Enter', { shift: true }))).toEqual({ type: 'desc' });
  });

  it('裸 Enter 仍是 add-sibling（未被 Shift+Enter 抢占）', () => {
    expect(matchEditorKey(keyEvent('Enter'))).toEqual({ type: 'add-sibling' });
  });

  it('Shift+Tab 仍是 indent（Shift 分支内无冲突）', () => {
    expect(matchEditorKey(keyEvent('Tab', { shift: true }))).toEqual({ type: 'indent' });
  });

  it('Ctrl+Enter 走组合键分支，不是 desc', () => {
    expect(matchEditorKey(keyEvent('Enter', { ctrl: true }))).toBeNull();
  });

  it('绑定表包含 desc（帮助面板可见）', () => {
    const binding = EDITOR_KEY_BINDINGS.find((b) => b.action === 'desc');
    expect(binding).toBeDefined();
    expect(binding?.key).toBe('Shift+Enter');
    expect(binding?.label).toBe('编辑描述');
  });
});
