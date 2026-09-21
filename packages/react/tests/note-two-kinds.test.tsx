// @vitest-environment jsdom
/**
 * 两种注释共存（v1.4.0）
 *
 * 这是分离方案的核心前提，也是最容易被"实现了一半"的地方：
 *   - **幕布注释（desc）**：常驻节点盒内，完整换行，超长内部滚动
 *   - **节点注释（note）**：浮窗展示，不占节点空间；有内容时节点右上角有标记
 *
 * 曾经出现过「代码都写了但界面上看不到」的情况 —— 缺的是**入口**（右键菜单）
 * 和**可发现性**（标记）。这里把三条路径一起锁住。
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import {
  astToEditable,
  hasNote,
  layoutMindmap,
  makeTextNode,
  noteOf,
  type MindNode,
} from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView } from '../src/render/MapView.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

function build() {
  const desc = makeTextNode('有描述', [makeTextNode('子')]);
  desc.note = { desc: '幕布注释内容\n第二行' };
  const note = makeTextNode('有注释', [makeTextNode('子')]);
  note.note = { note: ['条目一'], note_text: '正文' };
  const qa = makeTextNode('有旧qa', [makeTextNode('子')]);
  qa.note = { qa: ['老条目'] };
  const plain = makeTextNode('啥都没有', [makeTextNode('子')]);

  const root = makeTextNode('根', [desc, note, qa, plain]);
  const editable = astToEditable(root)!;
  const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
  const layout = layoutMindmap(editable, createNodeMeasure(char, new Map()), new Set());
  return { layout, char };
}

/**
 * 渲染画布。fixture 由调用方传入 —— **必须保证取节点 id 和渲染用的是同一棵树**：
 * 每次 build() 都会生成新的节点 id，若在测试里另外 build() 一次，拿到的 id
 * 在渲染的树里根本不存在（曾两次误判"浮窗打不开"，其实是测试自己的 bug）。
 */
function renderMap(props: Record<string, unknown> = {}, fixture = build()) {
  const view = render(
    <ThemeProvider>
      <MapView layout={fixture.layout} entities={new Map()} char={fixture.char} {...props} />
    </ThemeProvider>,
  );
  return { ...view, layout: fixture.layout };
}

/** 按文本取节点对象（数据层断言用） */
function nodeByText(layout: { nodes: Array<{ node: MindNode }> }, text: string): MindNode {
  return layout.nodes.find((n) => n.node.text === text)!.node;
}

/**
 * 按文本取节点 id（浮窗固定用）。
 * MindNode 类型上没声明 id，但运行时挂在 node 对象上 —— 这里显式取一次。
 */
function idOf(layout: { nodes: Array<{ node: unknown }> }, text: string): string {
  const hit = layout.nodes.find((n) => (n.node as MindNode).text === text)!;
  return (hit.node as { id: string }).id;
}

describe('两种注释：数据层可区分', () => {
  it('desc 与 note 是不同字段，互不干扰', () => {
    const { layout } = build();
    const d = nodeByText(layout, '有描述');
    expect(d.note?.desc).toBe('幕布注释内容\n第二行');
    expect(hasNote(d)).toBe(false); // 有描述 ≠ 有注释

    const n = nodeByText(layout, '有注释');
    expect(noteOf(n)).toEqual({ seq: ['条目一'], text: '正文' });
  });

  it('旧 qa 读作序列区域（迁移兼容）', () => {
    const { layout } = build();
    expect(noteOf(nodeByText(layout, '有旧qa')).seq).toEqual(['老条目']);
    expect(hasNote(nodeByText(layout, '有旧qa'))).toBe(true);
  });
});

describe('两种注释：渲染层都能看到', () => {
  it('幕布注释渲染为节点盒内的描述块', () => {
    const { container } = renderMap();
    const blocks = container.querySelectorAll('[data-desc-block]');
    expect(blocks.length).toBe(1);
    expect(blocks[0]!.textContent).toContain('幕布注释内容');
  });

  it('有注释的节点带可见标记（否则用户无从发现）', () => {
    const { container } = renderMap();
    const badges = container.querySelectorAll('[data-note-badge]');
    // 有注释 + 有旧qa 两个节点各一个标记
    expect(badges.length).toBe(2);
  });

  it('没有注释的节点不带标记', () => {
    const fixture = build();
    const { container } = renderMap({}, fixture);
    const ids = Array.from(container.querySelectorAll('[data-note-badge]')).map((b) =>
      b.getAttribute('data-note-badge'),
    );
    expect(ids).not.toContain(idOf(fixture.layout, '啥都没有'));
    expect(ids).not.toContain(idOf(fixture.layout, '有描述'));
  });
});

describe('note 笔记：固定态保留预览卡片', () => {
  it('pinnedNoteId 固定后仍渲染独立卡片，不吞入节点背景', () => {
    const fixture = build();
    const noteId = idOf(fixture.layout, '有注释');
    const { container } = renderMap({ pinnedNoteId: noteId }, fixture);
    const panel = container.querySelector('[data-note-popover]') as HTMLElement | null;
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute('data-note-pinned')).toBe('true');
    expect(panel!.style.background).not.toBe('');
    expect(container.querySelector('[data-note-growth-panel]')).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
    const node = container.querySelector(`[data-node-id="${noteId}"]`);
    expect(node?.querySelector('path[stroke]')).toBeNull();
  });

  it('未固定时不会给空节点弹浮窗（避免鼠标扫过就弹）', () => {
    const { container } = renderMap({ pinnedNoteId: null });
    expect(container.querySelector('[data-note-popover]')).toBeNull();
  });
});
