// @vitest-environment jsdom
/**
 * FO-B2 · 画布接线冒烟（真实管线 + 真实 MapView）：
 * 成框文档经 `layoutDemo`（B1 岛展开）渲染 → 框壳与框内大纲行出现在画布；
 * 框内行**不再画节点卡**（让位给 FrameOutline）；深层空间节点**仍是节点卡**（设计 §5.2）。
 *
 * 坐标约束（与 mapview-section-drag 同款）：jsdom 无布局引擎，viewport 恒 1×1，
 * 可见世界矩形只靠 CULL_MARGIN 撑开 → 夹具必须贴着原点。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { makeTextNode, setFrame, type EditableNode } from '@mindcanvas/kernel';
import { layoutDemo } from '../src/demo/pipeline.js';
import { createCharMeasure } from '../src/render/domMeasure.js';
import { MapView } from '../src/render/MapView.js';
import { ThemeProvider } from '../src/theme/ThemeContext.js';

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

/**
 * A（**文档根自身成框**，depth=1）→ A1 → A2：大纲层 = {A, A1}，空间层 = {A2}。
 *
 * 夹具贴着原点（坐标约束见文件头）：FO-C1 起框内行是固定内容列宽（220），FO-C2 起成框根
 * 在基座里占**壳体积**（≈244 宽）——若把框根挂在别的节点下（左右任一侧），它都会被推到
 * 约 ±270px 外、超出 jsdom 裁剪窗（viewport 恒 1×1）。文档根成框则盒子居中于原点，
 * 行与挂出子树都在窗内，且**不改变**本测要验的语义（框内行 ≠ 节点卡）。
 */
function fixture() {
  const a2 = makeTextNode('A2');
  const a1 = makeTextNode('A1', [a2]);
  const aBase = makeTextNode('A', [a1]);
  const a: EditableNode = {
    ...aBase,
    note: { ...setFrame(aBase.note, 1), dir: 'left' },
  };
  const root = a; // 文档根自身成框（A3 命令层允许）
  const { layout } = layoutDemo(root, new Map(), char);
  return { root, a, a1, a2, layout };
}

function renderStage(
  root: EditableNode,
  layout: ReturnType<typeof layoutDemo>['layout'],
  onNodeClick: (ln: { node: { id: string } }) => void = () => undefined,
) {
  return render(
    <ThemeProvider>
      <MapView
        layout={layout}
        documentRoot={root}
        entities={new Map()}
        char={char}
        onNodeClick={onNodeClick}
      />
    </ThemeProvider>,
  );
}

describe('MapView 框岛接线（FO-B2）', () => {
  it('成框节点渲染框壳 + 大纲行；框内行让位节点卡；空间层节点仍走节点卡', () => {
    const { root, a, a1, a2, layout } = fixture();
    const { container } = renderStage(root, layout);

    // 框壳 + 大纲行（框头 A + 行 A1）
    expect(container.querySelector(`[data-frame-shell][data-frame-root="${a.id}"]`)).not.toBeNull();
    expect(container.querySelector(`[data-frame-row][data-frame-node="${a.id}"]`)).not.toBeNull();
    expect(container.querySelector(`[data-frame-row][data-frame-node="${a1.id}"]`)).not.toBeNull();
    // 框内行不再画节点卡（同盒双层是本次要消灭的）
    expect(container.querySelector(`[data-node-id="${a.id}"]`)).toBeNull();
    expect(container.querySelector(`[data-node-id="${a1.id}"]`)).toBeNull();
    // 深层空间节点（d=2 > depth）仍是画布节点卡，且不在框内
    expect(container.querySelector(`[data-node-id="${a2.id}"]`)).not.toBeNull();
    expect(container.querySelector(`[data-frame-node="${a2.id}"]`)).toBeNull();
  });

  it('单击大纲行 → 走上层既有节点点击通道（选中语义，不新开状态）', () => {
    const { root, a1, layout } = fixture();
    const onNodeClick = vi.fn();
    const { container } = renderStage(root, layout, onNodeClick);
    const row = container.querySelector(`[data-frame-row][data-frame-node="${a1.id}"]`);
    expect(row).not.toBeNull();
    fireEvent.click(row as HTMLElement);
    expect(onNodeClick).toHaveBeenCalledTimes(1);
    expect(onNodeClick.mock.calls[0]?.[0]).toMatchObject({ node: { id: a1.id } });
  });

  it('无框文档：不渲染任何框壳（框机制不泄漏）', () => {
    const plain = makeTextNode('R', [makeTextNode('A')]);
    const { layout } = layoutDemo(plain, new Map(), char);
    const { container } = renderStage(plain, layout);
    expect(container.querySelector('[data-frame-shell]')).toBeNull();
  });

  it('FO-C1：框内行编辑态 = 换行输入（textarea，宽度 = 行盒宽，无 ellipsis 裁切）', () => {
    const { root, a1, layout } = fixture();
    const { container } = render(
      <ThemeProvider>
        <MapView
          layout={layout}
          documentRoot={root}
          entities={new Map()}
          char={char}
          editingId={a1.id}
          onEditCommit={() => undefined}
          onEditCancel={() => undefined}
        />
      </ThemeProvider>,
    );
    const editor = container.querySelector('textarea[data-overlay-editor="wrap"]');
    expect(editor).not.toBeNull();
    const el = editor as HTMLTextAreaElement;
    const ln = layout.nodes.find((n) => n.node.id === a1.id);
    // 编辑面宽度 ≈ 行内容宽（行盒宽，不含盒外框）
    expect(Number.parseFloat(el.style.width)).toBeCloseTo(ln?.box.w ?? -1, 5);
    // 自动换行（不是单行盒 nowrap/ellipsis）
    expect(el.style.whiteSpace).toBe('pre-wrap');
    expect(el.style.textOverflow).toBe('');
    // 最小高度 = 行盒高（内容更高时由内容撑高）
    expect(Number.parseFloat(el.style.height)).toBeCloseTo(ln?.box.h ?? -1, 5);
  });

  it('FO-C1：框内 text 行换行增高（行盒 ≥ 2 行文本高），且非框行仍走节点卡', () => {
    const a2 = makeTextNode('A2');
    const a1 = makeTextNode('这是一段很长的框内文本内容需要在固定列宽下自动换行而非被裁切', [a2]);
    const aBase = makeTextNode('A', [a1]);
    const a: EditableNode = { ...aBase, note: setFrame(aBase.note, 1) };
    const root = makeTextNode('R', [a]);
    const { layout } = layoutDemo(root, new Map(), char);
    const row = layout.nodes.find((n) => n.node.id === a1.id);
    if (row === undefined) throw new Error('夹具错误：框内行缺盒');
    expect(row.box.h).toBeGreaterThanOrEqual(2 * 16); // LINE_H=16：折行后行盒随行数增高
    const { container } = renderStage(root, layout);
    const el = container.querySelector(`[data-frame-row][data-frame-node="${a1.id}"]`);
    expect(el).not.toBeNull();
    expect((el as HTMLElement).style.height).toBe(`${row.box.h}px`);
  });
});
