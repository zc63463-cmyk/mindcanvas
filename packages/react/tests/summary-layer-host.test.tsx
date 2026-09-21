// @vitest-environment jsdom
/**
 * S4 · 摘要括线**真实挂载**契约（生产 MapView，不是复制体）。
 *
 * ## 为什么必须挂载生产 MapView
 *
 * 任务书 §四.9 明确要求：「真实组件测试必须挂载生产 MapView / SummaryLayer，
 * 不得只测试一个复制的 hook 或几何函数」。只测 `buildSummaryViews` 只能证明
 * 几何函数正确 —— 若 MapView 忘了挂 `<SummaryLayer>`、或把它挂在变换 `<g>` 之外、
 * 或层序排错，几何测试**一律照绿**。本文件挂载真 MapView，让上述三种失效可见。
 *
 * ## 断言口径
 *
 * - **存在性**：`[data-summary-bracket]` / `[data-summary-stem]` 必须出现
 *   —— 层被摘掉即红（阴性对照 1 的目标）。
 * - **层序**：`summaries` 层须在 `tree-links` 之前、`nodes` 之前
 *   —— 顺序挪到节点之后即红（阴性对照 2 的目标）。
 * - **同层同 g**：括线与节点在同一变换 `<g>` 内 —— 缩放/平移天然同步
 *   （证明「不使用绝对屏幕坐标」，§四.5/§四.6）。
 * - **几何与布局同源**：path `d` 的 x 落在成员带右侧（§三.1）。
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import {
  layoutMindmap,
  makeTextNode,
  satelliteHook,
  SUMMARY_BRACKET_GAP,
  type EditableNode,
  type LayoutResult,
} from '@mindcanvas/kernel';
import { ThemeProvider, MapView } from '../src/index.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

function req<T>(v: T | undefined | null, what: string): T {
  if (v === undefined || v === null) throw new Error(`测试前置缺失：${what}`);
  return v;
}

/** 根 → 父[成员一..成员三]，摘要覆盖 成员一..成员三（cid 锚，与生产写入同形态）。 */
function fixture(): EditableNode {
  const m1 = makeTextNode('成员一');
  const m2 = makeTextNode('成员二');
  const m3 = makeTextNode('成员三');
  m1.note = { cid: 'c1' };
  m2.note = { cid: 'c2' };
  m3.note = { cid: 'c3' };
  const summary: EditableNode = {
    ...makeTextNode('摘要'),
    note: { cid: 'c9', summary_of: { from: 'cid:c1', to: 'cid:c3' } },
  };
  const parent = makeTextNode('父', [m1, m2, m3, summary]);
  const root = makeTextNode('根', [parent]);
  root.note = { cid: 'c0', next_cid: 10 };
  return root;
}

function layoutOf(root: EditableNode): LayoutResult {
  return layoutMindmap(root, createNodeMeasure(char, new Map()), new Set(), {
    satellite: satelliteHook,
  });
}

function mount(layout: LayoutResult) {
  const { container } = render(
    <ThemeProvider>
      <MapView layout={layout} entities={new Map()} char={char} relationMode />
    </ThemeProvider>,
  );
  return container;
}

/** 变换 g（含缩放的层容器）；层序断言都在它内部。 */
function transformG(container: HTMLElement): SVGGElement {
  return req(
    container.querySelector('svg > g[transform]') as SVGGElement | null,
    '变换 g',
  );
}

describe('S4 · SummaryLayer 真实挂载（生产 MapView）', () => {
  it('摘要文档：括线与 stem 真的渲染出来', () => {
    const layout = layoutOf(fixture());
    expect(layout.satellites ?? [], '前置：布局确实产出了卫星').toHaveLength(1);
    const container = mount(layout);
    expect(
      container.querySelectorAll('[data-summary-bracket]').length,
      '括线 path 必须存在（删除 SummaryLayer 挂载 → 此处转红）',
    ).toBe(1);
    expect(
      container.querySelectorAll('[data-summary-stem]').length,
      'stem path 必须存在',
    ).toBe(1);
  });

  it('层序契约：summaries 在树线之前、节点之前（各层同 g）', () => {
    const container = mount(layoutOf(fixture()));
    const g = transformG(container);
    const order = [...g.querySelectorAll('[data-layer]')].map((el) =>
      el.getAttribute('data-layer'),
    );
    const at = (name: string): number => {
      const i = order.indexOf(name);
      expect(i, `层 ${name} 必须存在`).toBeGreaterThanOrEqual(0);
      return i;
    };
    // 契约：sections → summaries → tree-links → … → nodes
    expect(at('summaries'), 'summaries 必须在 tree-links 之前').toBeLessThan(at('tree-links'));
    expect(at('summaries'), 'summaries 必须在 nodes 之前').toBeLessThan(at('nodes'));
    // 括线不得落在 nodes 层之后（否则会盖住节点卡 → 阴性对照 2 的目标）
    expect(
      at('summaries'),
      'summary 括线必须在节点层之下（盖住节点卡是回归）',
    ).toBeLessThan(at('nodes'));
    // 与既有契约一致：节段层仍最底
    if (order.includes('sections')) {
      expect(at('sections'), 'sections 仍在 summaries 之前').toBeLessThan(at('summaries'));
    }
  });

  it('括线挂在变换 g 内（缩放/平移与节点同步，不用屏幕绝对坐标）', () => {
    const container = mount(layoutOf(fixture()));
    const g = transformG(container);
    const bracket = req(
      g.querySelector('[data-summary-bracket]') as SVGPathElement | null,
      '变换 g 内的括线',
    );
    expect(bracket, '括线必须是变换 g 的后代（否则平移/缩放不同步）').not.toBeNull();
  });

  it('括线几何与布局同源：x 落在成员带右侧', () => {
    const root = fixture();
    const layout = layoutOf(root);
    const sat = req((layout.satellites ?? [])[0], '卫星');
    const container = mount(layout);
    const d = req(
      container.querySelector('[data-summary-bracket]')?.getAttribute('d'),
      '括线 d',
    );
    const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    const pathXs: number[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pathXs.push(req(nums[i], `x@${i}`));
    // 成员带右沿 = 成员盒右沿（叶子成员）
    const memberRight = Math.max(
      ...['成员一', '成员二', '成员三'].map((t) => {
        const n = [...layout.nodes].find((l) => l.node.text === t);
        return req(n, t).box.x + req(n, t).box.w;
      }),
    );
    const bracketX = Math.max(...pathXs);
    expect(
      bracketX,
      `括线 x=${bracketX} 应 = 带右沿(${memberRight}) + BRACKET_GAP(${SUMMARY_BRACKET_GAP})`,
    ).toBeCloseTo(memberRight + SUMMARY_BRACKET_GAP, 1);
    expect(sat.box.x, '摘要盒在括线右侧（stem 正向）').toBeGreaterThan(bracketX);
  });

  it('无摘要文档：不渲染 summaries 层（零回归）', () => {
    const plain = makeTextNode('根', [makeTextNode('A'), makeTextNode('B')]);
    const container = mount(layoutOf(plain));
    expect(container.querySelectorAll('[data-summary-bracket]').length, '无摘要零括线').toBe(0);
    expect(
      transformG(container).querySelector('[data-layer="summaries"]'),
      '无摘要时不挂 summaries 层',
    ).toBeNull();
  });

  it('括线不参与命中：pointer-events 为 none（选择逻辑零改动）', () => {
    const container = mount(layoutOf(fixture()));
    const b = req(
      container.querySelector('[data-summary-bracket]') as SVGPathElement | null,
      '括线',
    );
    expect(
      b.getAttribute('pointer-events') ?? b.style.pointerEvents,
      '括线必须 pointer-events:none，否则会抢节点点击',
    ).toContain('none');
  });
});
