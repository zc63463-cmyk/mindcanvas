// @vitest-environment jsdom
/**
 * C4：中心可见性角标——升格后「看得见」（左上 `data-center` 小圆点）。
 *
 * 渲染条件 = `centerTitles`（collectCenters 的真实中心事实）——**不用 `centerIds`**：
 * 后者含布局输出所需的「根岛根」，会把文档根误标为中心（真浏览器核对抓到的差异，
 * 见 tools/verify-c4-center-badge.mjs 与 C4 报告）。
 *
 * 判别断言：
 * - 升格（centerTitles 含 id）→ 出现：title「中心（doc#cid）」、左上落点（cx/cy = 盒 + 5）、
 *   `pointerEvents: 'none'`（不抢节点点击）；
 * - 降格（rerender 移除）→ 消失；
 * - root（不可升格）→ 无角标（即便它因根岛进入 centerIds）；
 * - 缺省 centerTitles → 不渲染（向后兼容）；
 * - Canvas（`forceBackend='canvas'`）→ 不渲染（SVG 节点层让位；损失清单追加项见
 *   canvas-degrade.test.tsx 的 `data-center` 1→0）。
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { astToEditable, layoutMindmap, makeTextNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView } from '../src/render/MapView.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

function buildFixture() {
  const root = astToEditable(makeTextNode('根', [makeTextNode('任务A'), makeTextNode('B')]));
  if (root === null) throw new Error('fixture broken: astToEditable returned null');
  const a = root.children[0];
  if (a === undefined) throw new Error('fixture broken: 任务A missing');
  const layout = layoutMindmap(root, createNodeMeasure(char, new Map()), new Set());
  return { root, a, layout };
}

function boxOf(layout: ReturnType<typeof layoutMindmap>, id: string) {
  const ln = layout.nodes.find((n) => n.node.id === id);
  if (ln === undefined) throw new Error(`fixture broken: layout node ${id} missing`);
  return ln.box;
}

function renderWith(
  f: ReturnType<typeof buildFixture>,
  opts: {
    centerIds?: ReadonlySet<string>;
    centerTitles?: ReadonlyMap<string, string>;
    forceBackend?: 'svg' | 'canvas';
  } = {},
) {
  const view = render(
    <ThemeProvider>
      <MapView
        layout={f.layout}
        entities={new Map()}
        char={char}
        centerIds={opts.centerIds}
        centerTitles={opts.centerTitles}
        forceBackend={opts.forceBackend}
      />
    </ThemeProvider>,
  );
  return { ...view, ...f };
}

describe('C4 中心角标（左上 data-center）', () => {
  it('升格 → 出现：title 带 doc#cid、落点左上、pointerEvents none', () => {
    const f = buildFixture();
    const { container } = renderWith(f, {
      centerTitles: new Map([[f.a.id, '中心（t.mm.md#c7）']]),
    });

    const badge = container.querySelector(`[data-center="${f.a.id}"]`);
    expect(badge).not.toBeNull();
    expect(badge?.querySelector('title')?.textContent).toBe('中心（t.mm.md#c7）');
    expect(badge?.getAttribute('pointer-events')).toBe('none');
    const box = boxOf(f.layout, f.a.id);
    const circle = badge?.querySelector('circle');
    expect(circle?.getAttribute('cx')).toBe(String(box.x + 5));
    expect(circle?.getAttribute('cy')).toBe(String(box.y + 5));
  });

  it('降格 → 消失（rerender 移除 centerTitles 后无残留）', () => {
    const f = buildFixture();
    const view = render(
      <ThemeProvider>
        <MapView
          layout={f.layout}
          entities={new Map()}
          char={char}
          centerTitles={new Map([[f.a.id, '中心']])}
        />
      </ThemeProvider>,
    );
    expect(view.container.querySelector(`[data-center="${f.a.id}"]`)).not.toBeNull();

    view.rerender(
      <ThemeProvider>
        <MapView layout={f.layout} entities={new Map()} char={char} centerTitles={new Map()} />
      </ThemeProvider>,
    );
    expect(view.container.querySelector('[data-center]')).toBeNull();
  });

  it('root（不可升格）→ 无角标：即便它因根岛进入 centerIds，也不被误标', () => {
    const f = buildFixture();
    // 模拟真实画布：centerIds = 根岛根（root）+ 真中心（a）；centerTitles 只有真中心
    const { container } = renderWith(f, {
      centerIds: new Set([f.root.id, f.a.id]),
      centerTitles: new Map([[f.a.id, '中心（t.mm.md#c1）']]),
    });

    expect(container.querySelector(`[data-center="${f.a.id}"]`)).not.toBeNull();
    expect(container.querySelector(`[data-center="${f.root.id}"]`)).toBeNull();
  });

  it('缺省 centerTitles → 不渲染任何角标（向后兼容；即便传了 centerIds）', () => {
    const f = buildFixture();
    const { container } = renderWith(f, { centerIds: new Set([f.a.id]) });
    expect(container.querySelector('[data-center]')).toBeNull();
  });

  it("Canvas（forceBackend='canvas'）→ 角标不渲染（SVG 节点层让位）", () => {
    const f = buildFixture();
    const { container } = renderWith(f, {
      centerTitles: new Map([[f.a.id, '中心']]),
      forceBackend: 'canvas',
    });
    expect(container.querySelector('canvas')).not.toBeNull();
    expect(container.querySelectorAll('[data-center]').length).toBe(0);
  });
});
