// @vitest-environment jsdom
/**
 * R5-2：层序契约（data-layer 序列）+ 边标签上提判别。
 *
 * 契约（绘制序，自下而上）：sections → tree-links → free-edges → nodes →
 * edge-labels → ghosts → drag。为什么：① 标签是**信息层**——被节点盖住即失效
 * （本批把树线标注与自由边标签统一上提到 edge-labels 层修复）；② 命中区是
 * **交互层**——必须在节点之下，上提会抢节点点击（反例钉在下方）。
 *
 * 断言口径（辨别式）：
 *  - 层序列 = 契约的投影（缺层跳过、相对顺序不得变形）——下标硬断言太脆，见计划坑 7；
 *  - 标签层 EdgeLabel 数量 = 树线标注数 + 自由边标签数（搬层不改变数量）；
 *  - 自由边标签已移出 free-edges 层（结构钉）；命中区仍在 free-edges 层（反例钉）。
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { layoutMindmap, makeTextNode, type EditableNode } from '@mindcanvas/kernel';
import { ThemeProvider, MapView } from '../src/index.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

/**
 * 契约序列（全量；未渲染的层跳过，但相对顺序必须保持）。
 * `island-overview` 为 IO-1 条件层（k < 0.35 且有中心岛才挂）——无岛夹具下缺席，
 * 但位置钉在 sections 之后、tree-links 之前（梁/自由边画在卡之上，岛间关系始终可见）。
 */
const CONTRACT = [
  'sections',
  'island-overview',
  'tree-links',
  'free-edges',
  'nodes',
  'edge-labels',
  'ghosts',
  'drag',
];

/** 夹具：树线标注 1 条（子1 的入边） + 自由边标签 1 条（子1 → B） */
function fixture(): EditableNode {
  const root = makeTextNode('根', [
    makeTextNode('任务A', [makeTextNode('子1')]),
    makeTextNode('B'),
  ]);
  const z1 = root.children[0]?.children[0];
  if (!z1) throw new Error('夹具构建失败：找不到 子1');
  z1.note = { edge: { rel: 'blocks' } };
  root.note = {
    edges: [{ from: 'node:根/任务A/子1', to: 'node:根/B', rel: 'relates-to', label: '关系标签' }],
  };
  return root;
}

function mount(root: EditableNode) {
  const layout = layoutMindmap(root, createNodeMeasure(char, new Map()), new Set());
  const { container } = render(
    <ThemeProvider>
      <MapView layout={layout} entities={new Map()} char={char} relationMode />
    </ThemeProvider>,
  );
  const layers = [...container.querySelectorAll('svg > g > [data-layer]')].map(
    (el) => el.getAttribute('data-layer') ?? '',
  );
  return { container, layers };
}

describe('R5-2 层序契约（data-layer 序列）', () => {
  it('层序列 = 契约的投影（缺层跳过、相对顺序不变）+ 标签层位于节点层之上', () => {
    const { container, layers } = mount(fixture());
    const present = new Set(layers);
    expect(layers).toEqual(CONTRACT.filter((l) => present.has(l)));
    // 关键关系显式钉住（修复点 + 反例点各一）
    expect(layers).toContain('edge-labels');
    expect(layers.indexOf('edge-labels')).toBeGreaterThan(layers.indexOf('nodes'));
    expect(layers.indexOf('free-edges')).toBeLessThan(layers.indexOf('nodes'));
    // 标签数量不因搬层而变：树线标注 1 + 自由边标签 1 = 2
    const labelLayer = container.querySelector('[data-layer="edge-labels"]');
    expect(labelLayer?.querySelectorAll('[data-edge-label]').length).toBe(2);
    // 结构钉：自由边标签已移出 free-edges 层
    expect(container.querySelector('[data-layer="free-edges"] [data-edge-label]')).toBeNull();
  });

  it('反例钉：命中区（宽透明描边）仍在节点层之下、不在标签层——上提不得带走命中区', () => {
    const { container, layers } = mount(fixture());
    const hit = container.querySelector('[data-layer="free-edges"] [data-free-edge-hit]');
    expect(hit).not.toBeNull();
    expect(hit?.getAttribute('stroke-width')).toBe('12');
    expect(layers.indexOf('free-edges')).toBeLessThan(layers.indexOf('nodes'));
    expect(container.querySelector('[data-layer="edge-labels"] [data-free-edge-hit]')).toBeNull();
  });

  it('空文本守卫回归：label 空 + rel 空 → 标签层不产出胶囊（边本身仍渲染）', () => {
    const root = makeTextNode('根', [makeTextNode('A'), makeTextNode('B')]);
    root.note = { edges: [{ from: 'node:根/A', to: 'node:根/B', rel: '' }] };
    const { container } = mount(root);
    expect(container.querySelectorAll('[data-edge-label]').length).toBe(0);
    expect(container.querySelectorAll('[data-free-edge]').length).toBe(1);
  });

  it('稳定输入重渲染 → 标签数量不漂移（收集回路守护；循环会触发 React 深度报错）', () => {
    const layout = layoutMindmap(fixture(), createNodeMeasure(char, new Map()), new Set());
    const entities = new Map();
    const make = () => (
      <ThemeProvider>
        <MapView layout={layout} entities={entities} char={char} relationMode />
      </ThemeProvider>
    );
    const { container, rerender } = render(make());
    const before = container.querySelectorAll('[data-edge-label]').length;
    for (let i = 0; i < 4; i++) rerender(make());
    expect(before).toBe(2);
    expect(container.querySelectorAll('[data-edge-label]').length).toBe(2);
  });
});
