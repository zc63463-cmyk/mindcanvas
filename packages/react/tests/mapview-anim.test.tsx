// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { addChild, astToEditable, layoutMindmap, makeTextNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView } from '../src/render/MapView.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';
import { NODE_ANIM_MS } from '../src/render/motion.js';

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

/** 2 分支树 → 布局（jsdom 无尺寸：transform 恒等，世界=屏幕） */
function baseLayout() {
  const root = astToEditable(
    makeTextNode('根', [
      makeTextNode('分支 0', [makeTextNode('叶 0')]),
      makeTextNode('分支 1', [makeTextNode('叶 1')]),
    ]),
  )!;
  return layoutMindmap(root, createNodeMeasure(char, new Map()), new Set());
}

/** 从布局节点反推可编辑树（保留 id）——保证跨布局 id 稳定 */
function treeFromLayout(layout: ReturnType<typeof baseLayout>) {
  const build = (
    ln: (typeof layout.nodes)[number],
  ): NonNullable<ReturnType<typeof astToEditable>> => {
    const children = (ln.children ?? []).map((c) => build(c));
    return { ...ln.node, children } as NonNullable<ReturnType<typeof astToEditable>>;
  };
  return build(layout.nodes.find((n) => n.depth === 0)!);
}

function nodeTransform(container: HTMLElement, id: string): string | null {
  return container.querySelector(`g[data-node-id="${id}"]`)?.getAttribute('transform') ?? null;
}

describe('MapView 节点位置过渡（M5-T2 集成）', () => {
  it('布局变化 → 节点从旧坐标插值（过渡中非最终位）→ 落位最终坐标', async () => {
    const layout1 = baseLayout();
    const branchA = layout1.nodes.find((n) => n.node.text === '分支 0')!;
    const branchAId = branchA.node.id;
    const { container, rerender } = render(
      <ThemeProvider>
        <MapView layout={layout1} entities={new Map()} char={char} />
      </ThemeProvider>,
    );
    // 静止态：transform 即布局坐标
    const settled = nodeTransform(container, branchAId)!;
    expect(settled).toContain(`translate(${branchA.box.x} ${branchA.box.y})`);

    // 同树增一分支 → 新布局（id 不变）
    const grown = addChild(
      treeFromLayout(layout1),
      branchAId,
      makeTextNode('新分支', [makeTextNode('新叶')]),
    );
    const layout2 = layoutMindmap(grown, createNodeMeasure(char, new Map()), new Set());
    const branchA2 = layout2.nodes.find((n) => n.node.id === branchAId)!;
    const finalTransform = `translate(${branchA2.box.x} ${branchA2.box.y})`;
    rerender(
      <ThemeProvider>
        <MapView layout={layout2} entities={new Map()} char={char} />
      </ThemeProvider>,
    );
    // 过渡早期：位置介于旧新之间——不得等于最终位（捕获「瞬间跳变」回归）
    await new Promise((r) => setTimeout(r, NODE_ANIM_MS * 0.25));
    const mid = nodeTransform(container, branchAId)!;
    expect(mid).not.toBe(finalTransform);
    // 过渡结束：落位最终坐标；ghost 全部退场（无残留）
    await new Promise((r) => setTimeout(r, NODE_ANIM_MS * 1.2));
    expect(nodeTransform(container, branchAId)).toBe(finalTransform);
    expect(container.querySelectorAll('g[data-ghost-group]').length).toBe(0);
  });

  it('删除节点 → 过渡期间 ghost 淡出，结束后移除', async () => {
    const layout3 = baseLayout();
    const { container, rerender } = render(
      <ThemeProvider>
        <MapView layout={layout3} entities={new Map()} char={char} />
      </ThemeProvider>,
    );
    // 同树删「分支 1」子树 → 新布局
    const tree = treeFromLayout(layout3);
    const removedId = tree.children.find((c) => c.text === '分支 1')!.id;
    const shrunk = {
      ...tree,
      children: tree.children.filter((c) => c.id !== removedId),
    } as typeof tree;
    const layout2 = layoutMindmap(shrunk, createNodeMeasure(char, new Map()), new Set());
    rerender(
      <ThemeProvider>
        <MapView layout={layout2} entities={new Map()} char={char} />
      </ThemeProvider>,
    );
    await new Promise((r) => setTimeout(r, NODE_ANIM_MS * 0.3));
    // ghost 仍以 data-node-id 渲染（旧 id），且透明度 < 1（淡出中）
    const ghost = container.querySelector(`g[data-node-id="${removedId}"]`);
    expect(ghost).not.toBeNull();
    const opacity = Number(ghost!.getAttribute('opacity'));
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);
    await new Promise((r) => setTimeout(r, NODE_ANIM_MS * 1.2));
    expect(container.querySelector(`g[data-node-id="${removedId}"]`)).toBeNull();
  });
});
