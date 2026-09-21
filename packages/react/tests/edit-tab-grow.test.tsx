// @vitest-environment jsdom
/**
 * G10：编辑态 Tab 连续生长 —— 端到端（MapView 层）守卫。
 *
 * 核心风险：Tab 生长时 `editingId` 在同一事件内从旧节点**直接**切到新节点，
 * 中间没有 `null` 态被渲染（commitEdit 与 startEdit 被 React 批处理合并）。
 * 此时若 NodeTextOverlay 实例被复用，OverlayEditor 的 `useState(initial)`
 * 不会重新取值 —— 输入框会残留**上一个节点**的文本，用户接着打字就写错了地方。
 *
 * 解法：MapView 用 `key={editingId}` 强制重建。本文件锁定该约束，
 * 防止有人以「key 是多余的」为由移除它。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { astToEditable, layoutMindmap, makeTextNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView } from '../src/render/MapView.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

afterEach(() => {
  cleanup();
});

function setup() {
  const root = astToEditable(
    makeTextNode('根', [makeTextNode('第一个节点'), makeTextNode('第二个节点')]),
  )!;
  const layout = layoutMindmap(root, createNodeMeasure(char, new Map()), new Set());
  const idOf = (text: string): string => {
    const n = layout.nodes.find((x) => x.node.type === 'text' && x.node.text === text);
    if (!n) throw new Error(`未找到文本为「${text}」的节点`);
    return n.node.id;
  };
  return { layout, idOf };
}

function renderAt(layout: ReturnType<typeof setup>['layout'], editingId: string | null) {
  return render(
    <ThemeProvider>
      <MapView
        layout={layout}
        entities={new Map()}
        char={char}
        editingId={editingId}
        onEditCommit={() => {}}
      />
    </ThemeProvider>,
  );
}

describe('G10：编辑态切换节点时输入框不残留旧文本', () => {
  it('首次进入编辑显示该节点文本', () => {
    const { layout, idOf } = setup();
    const { container } = renderAt(layout, idOf('第一个节点'));
    expect(container.querySelector('input')?.value).toBe('第一个节点');
  });

  it('editingId 直接切到另一节点（无 null 中间态）→ 输入框显示新节点文本', () => {
    const { layout, idOf } = setup();
    // 模拟 Tab 生长：旧节点 → 新节点，中间不经过 null
    const { container, rerender } = renderAt(layout, idOf('第一个节点'));
    expect(container.querySelector('input')?.value).toBe('第一个节点');

    rerender(
      <ThemeProvider>
        <MapView
          layout={layout}
          entities={new Map()}
          char={char}
          editingId={idOf('第二个节点')}
          onEditCommit={() => {}}
        />
      </ThemeProvider>,
    );
    expect(container.querySelector('input')?.value).toBe('第二个节点');
  });

  it('editingId 为 null 时不渲染输入框', () => {
    const { layout } = setup();
    const { container } = renderAt(layout, null);
    expect(container.querySelector('input')).toBeNull();
  });
});
