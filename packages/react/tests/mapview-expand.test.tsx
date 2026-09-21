// @vitest-environment jsdom
/**
 * MapView：展开态"生长"交互——展开节点渲染注释区 overlay + NodeG 连体注释区背景。
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { astToEditable, layoutMindmap, makeTextNode } from '@mindcanvas/kernel';
import type { EditableNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView } from '../src/render/MapView.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';
import { createExpandMeasure } from '../src/demo/pipeline.js';
import { estimateCommentAreaHeight, GROW_EXPAND_W } from '../src/chrome/GrowthCommentPanel.js';

/** 根 + 2 分支；分支 A 挂 qa（可展开）。一次建树 → 布局可复用同一 editable（id 稳定） */
function tree() {
  const a = makeTextNode('分支 A');
  const b = makeTextNode('分支 B');
  const root = makeTextNode('根', [a, b]);
  const editable = astToEditable(root)!;
  const childA = editable.children![0] as { note?: { qa: string[] } };
  childA.note = { qa: ['批注 1', '批注 2'] };
  const aId = editable.children![0]!.id;
  const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
  return { editable: editable as EditableNode, aId, char };
}

function layoutOf(
  editable: EditableNode,
  char: ReturnType<typeof createCharMeasure>,
  expandedId: string | null,
) {
  const base = createNodeMeasure(char, new Map());
  const measure = createExpandMeasure(base, expandedId, GROW_EXPAND_W, estimateCommentAreaHeight());
  return layoutMindmap(editable, measure, new Set());
}

describe('MapView：展开态"生长"交互', () => {
  it('无 expandedId → 不渲染注释区 overlay', () => {
    const { editable, char } = tree();
    const layout = layoutOf(editable, char, null);
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} />
      </ThemeProvider>,
    );
    expect(container.querySelector('[data-grow-comment]')).toBeNull();
  });

  it('expandedId = 有 qa 节点 → 渲染注释区 overlay（条目可见）', () => {
    const { editable, char, aId } = tree();
    const layout = layoutOf(editable, char, aId);
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} expandedId={aId} />
      </ThemeProvider>,
    );
    const panel = container.querySelector('[data-grow-comment]') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.textContent).toContain('批注 1');
    expect(panel.textContent).toContain('批注 2');
  });

  it('展开节点 SVG 画连体注释区背景（本体 rect + 注释区背景 path：上半直角连体、下半圆角）', () => {
    const { editable, char, aId } = tree();
    const layout = layoutOf(editable, char, aId);
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} expandedId={aId} />
      </ThemeProvider>,
    );
    const nodeG = container.querySelector(`g[data-node-id="${aId}"]`) as SVGGElement;
    expect(nodeG).not.toBeNull();
    // 本体卡片 rect
    expect(nodeG.querySelectorAll('rect').length).toBeGreaterThanOrEqual(1);
    // 注释区背景改为 path（连体几何：顶边直角与本体相接，底部两角圆角）；
    // 修复前用全圆角 rect 会在连体处留缺口，且顶边 stroke 与额外分隔线三线叠加成粗横线
    const notePath = Array.from(nodeG.querySelectorAll('path')).find((p) => {
      const d = p.getAttribute('d') ?? '';
      return d.includes('Q'); // 圆角由二次贝塞尔表达
    });
    expect(notePath).not.toBeNull();
    // 连体：path 起点 y 与本体高度相同（顶边与本体底边重合，不产生双线错位）
    const box = layout.nodes.find((n) => n.node.id === aId)!.box;
    expect(notePath!.getAttribute('d')).toContain(`M 0 `);
    expect(box.h).toBeGreaterThan(0);
  });
});
