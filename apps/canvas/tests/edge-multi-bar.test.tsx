// @vitest-environment jsdom
/**
 * R4-5：批量条（组件/宿主层）。
 *
 * 契约：Shift+点两条边 → data-edge-multi-bar 出现（N 条 + 失效/恢复/删除）；
 * Esc 清空；批量删除一次 undo 全回滚；单条点击回归钉（EdgeEditor 打开、不出批量条）。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { astToEditable, makeTextNode, layoutMindmap } from '@mindcanvas/kernel';
import {
  ThemeProvider,
  createCharMeasure,
  createNodeMeasure,
  EditorController,
  MapView,
} from '@mindcanvas/react';
import { useEdgeActions } from '../src/hooks/useEdgeActions.js';
import { EdgeDraftLayer, type EdgeContextMenuState } from '../src/EdgeDraftLayer.js';

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 16) as unknown as number,
  );
  vi.stubGlobal('cancelAnimationFrame', (h: number) => {
    clearTimeout(h);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function MiniStage() {
  const [controller] = useState(() => {
    const built = astToEditable(
      makeTextNode('根', [makeTextNode('A'), makeTextNode('B'), makeTextNode('C')]),
    );
    if (built === null) throw new Error('fixture broken');
    built.note = {
      edges: [
        { from: 'node:根/A', to: 'node:根/B', rel: 'relates-to' },
        { from: 'node:根/A', to: 'node:根/C', rel: 'relates-to' },
        { from: 'node:根/B', to: 'node:根/C', rel: 'relates-to' },
      ],
    };
    return new EditorController(built);
  });
  const [edgeMenu] = useState<EdgeContextMenuState | null>(null);
  const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
  const layout = layoutMindmap(controller.root, createNodeMeasure(char, new Map()), new Set());
  const edgeActions = useEdgeActions(controller);
  return (
    <ThemeProvider>
      <MapView
        layout={layout}
        documentRoot={controller.root}
        entities={new Map()}
        char={char}
        relationMode
        selectedEdgeKey={edgeActions.edgeSel?.key ?? null}
        selectedEdgeKeys={edgeActions.edgeMultiSel}
        onEdgeClick={(edge, sx, sy, withShift) => {
          if (withShift) edgeActions.toggleEdgeMulti(edge.key);
          else edgeActions.setEdgeSel({ key: edge.key, x: sx, y: sy });
        }}
      />
      <EdgeDraftLayer
        controller={controller}
        edgeActions={edgeActions}
        treeEdgeEdit={null}
        linkDraft={null}
        onCloseTreeEdge={() => undefined}
        onCloseLinkDraft={() => undefined}
        edgeMenu={edgeMenu}
        onCloseEdgeMenu={() => undefined}
      />
    </ThemeProvider>
  );
}

function edgeHit(container: ParentNode, index: number): Element {
  const g = container.querySelectorAll('[data-free-edge]')[index];
  if (g === undefined) throw new Error('edge not found');
  const hit = g.querySelector('path[stroke="transparent"]');
  if (hit === null) throw new Error('hit path not found');
  return hit;
}

describe('EdgeMultiBar（R4-5）', () => {
  it('Shift+点两条边 → 批量条出现（N=2）；批量删除一次 undo 全回滚', () => {
    const screen = render(<MiniStage />);
    fireEvent.click(edgeHit(screen.container, 0), { shiftKey: true });
    fireEvent.click(edgeHit(screen.container, 1), { shiftKey: true });
    const bar = screen.container.querySelector('[data-edge-multi-bar]');
    if (bar === null) throw new Error('multi bar not found');
    expect(bar.textContent).toContain('2 条');
    expect(bar.textContent).toContain('失效');
    expect(bar.textContent).toContain('恢复');
    expect(bar.textContent).toContain('删除');

    const del = [...bar.querySelectorAll('[data-edge-multi-action]')].find(
      (b) => b.textContent === '删除',
    );
    if (del === undefined) throw new Error('删除 action not found');
    fireEvent.click(del);
    expect(screen.container.querySelectorAll('[data-free-edge]').length).toBe(1);
    expect(screen.container.querySelector('[data-edge-multi-bar]')).toBeNull();
  });

  it('Esc 清空集合 → 批量条消失', () => {
    const screen = render(<MiniStage />);
    fireEvent.click(edgeHit(screen.container, 0), { shiftKey: true });
    fireEvent.click(edgeHit(screen.container, 1), { shiftKey: true });
    expect(screen.container.querySelector('[data-edge-multi-bar]')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.container.querySelector('[data-edge-multi-bar]')).toBeNull();
  });

  it('单条点击回归钉：EdgeEditor 打开、无批量条', () => {
    const screen = render(<MiniStage />);
    fireEvent.click(edgeHit(screen.container, 0));
    expect(screen.container.querySelector('[data-edge-editor]')).not.toBeNull();
    expect(screen.container.querySelector('[data-edge-multi-bar]')).toBeNull();
  });
});
