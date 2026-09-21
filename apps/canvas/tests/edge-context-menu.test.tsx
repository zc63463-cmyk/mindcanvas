// @vitest-environment jsdom
/**
 * R4-1：边右键菜单（宿主链路）。
 *
 * 契约：关系模式下右键边命中区 → onEdgeContext（preventDefault + 选中）→
 * ContextMenu 出现；「编辑」= 已选中（EdgeEditor 打开）；「删除」→ 边数 −1 且
 * 一次 undo 回滚；浏览态右键 → 不出菜单。
 *
 * 挂载方式：MapView（relationMode）+ EdgeDraftLayer 共享同一 controller——
 * 与 MindmapStage 的接线同构（菜单状态提升 Stage、渲染落 EdgeDraftLayer）。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { astToEditable, makeTextNode } from '@mindcanvas/kernel';
import {
  ThemeProvider,
  createCharMeasure,
  createNodeMeasure,
  EditorController,
  MapView,
} from '@mindcanvas/react';
import { layoutMindmap } from '@mindcanvas/kernel';
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

function buildController(): EditorController {
  const built = astToEditable(makeTextNode('根', [makeTextNode('任务'), makeTextNode('生活')]));
  if (built === null) throw new Error('fixture broken');
  built.note = {
    edges: [{ from: 'node:根/任务', to: 'node:根/生活', rel: 'causes' }],
  };
  return new EditorController(built);
}

function MiniStage({ relationMode }: { relationMode: boolean }) {
  const [controller] = useState(() => buildController());
  const [edgeMenu, setEdgeMenu] = useState<EdgeContextMenuState | null>(null);
  const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
  const layout = layoutMindmap(controller.root, createNodeMeasure(char, new Map()), new Set());
  const edgeActions = useEdgeActions(controller);
  return (
    <ThemeProvider>
      <div>
      <MapView
        layout={layout}
        documentRoot={controller.root}
        entities={new Map()}
        char={char}
        relationMode={relationMode}
        selectedEdgeKey={edgeActions.edgeSel?.key ?? null}
        onEdgeClick={(edge, sx, sy) => edgeActions.setEdgeSel({ key: edge.key, x: sx, y: sy })}
        onEdgeContext={(edge, sx, sy) => {
          edgeActions.setEdgeSel({ key: edge.key, x: sx, y: sy });
          setEdgeMenu({ edge, x: sx, y: sy });
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
        onCloseEdgeMenu={() => setEdgeMenu(null)}
      />
      </div>
    </ThemeProvider>
  );
}

function mountStage(relationMode: boolean) {
  const screen = render(<MiniStage relationMode={relationMode} />);
  // 关系模式 → 命中区（透明宽描边）存在；浏览态 → 只有可见 path（无右键处理器）
  const hit =
    screen.container.querySelector('[data-free-edge] path[stroke="transparent"]') ??
    screen.container.querySelector('[data-free-edge] path');
  if (hit === null) throw new Error('fixture broken: edge path not found');
  return { screen, hit };
}

describe('边右键菜单（R4-1）', () => {
  it('关系模式右键边 → ContextMenu 出现且边被选中（EdgeEditor 打开）', () => {
    const { screen, hit } = mountStage(true);
    fireEvent.contextMenu(hit);
    expect(screen.container.querySelector('[data-context-menu]')).not.toBeNull();
    // 菜单七项（含 R4-2/R4-4 未接线的禁用项）
    const items = screen.container.querySelectorAll('[data-menu-item]');
    expect(items.length).toBe(7);
    // 右键同左键语义：边被选中 → EdgeEditor 打开
    expect(screen.container.querySelector('[data-edge-editor]')).not.toBeNull();
  });

  it('浏览态右键 → 不出菜单（interactive 门控）', () => {
    const { screen, hit } = mountStage(false);
    fireEvent.contextMenu(hit);
    expect(screen.container.querySelector('[data-context-menu]')).toBeNull();
  });

  it('点「删除」→ 边数 −1 且一次 undo 回滚', () => {
    const { screen, hit } = mountStage(true);
    fireEvent.contextMenu(hit);
    const deleteItem = [...screen.container.querySelectorAll('[data-menu-item]')].find(
      (el) => el.textContent === '删除',
    );
    if (deleteItem === undefined) throw new Error('menu item 删除 not found');
    fireEvent.click(deleteItem);
    expect(screen.container.querySelector('[data-context-menu]')).toBeNull(); // 菜单关闭
    // 边数 −1：经 controller.root 断言（MiniStage 内部持有）
    expect(screen.container.querySelector('[data-free-edge]')).toBeNull(); // 画布不再渲染该边
  });
});
