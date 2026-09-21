// @vitest-environment jsdom
/**
 * R5-3：Canvas 降级可感知 —— `MapStats.backend` 契约 + 材料字段 + 损失清单实测。
 *
 * DoD（计划 §2 R5-3）：损失清单必须**实测**（同夹具 `forceBackend='svg'` vs `'canvas'`
 * 两侧渲染 diff，贴 `data-tree-edge-label` / `data-note-badge` 数量），不许只写「我认为」；
 * 文案以实测为准。本文件即测量仪器 + 回归钉。
 *
 * 口径说明：既有 stats 断言均按字段访问（`reports.at(-1)?.visibleNodes` 等），
 * 无全等匹配 → `backend` 为**加法**字段，既有用例零修改。
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { astToEditable, layoutMindmap, makeTextNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView, type MapStats } from '../src/render/MapView.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 纯树夹具（自动降级场景的等价物）：树线标注 1（子1 入边）+ note 角标 1（子1 有注释） */
function buildFixture() {
  const root = astToEditable(
    makeTextNode('根', [makeTextNode('任务A', [makeTextNode('子1')]), makeTextNode('B')]),
  );
  const z1 = root?.children[0]?.children[0];
  if (!root || !z1) throw new Error('夹具构建失败：找不到 子1');
  z1.note = { edge: { rel: 'blocks' }, note: ['一条注释'] };
  return layoutMindmap(root, createNodeMeasure(char, new Map()), new Set());
}

describe('R5-3 · MapStats.backend 契约', () => {
  it("forceBackend='canvas' → 载荷 backend='canvas'", () => {
    const stats: MapStats[] = [];
    render(
      <ThemeProvider>
        <MapView
          layout={buildFixture()}
          entities={new Map()}
          char={char}
          forceBackend="canvas"
          onStats={(s) => stats.push(s)}
        />
      </ThemeProvider>,
    );
    expect(stats.at(-1)?.backend).toBe('canvas');
  });

  it("forceBackend='svg' → 载荷 backend='svg'", () => {
    const stats: MapStats[] = [];
    render(
      <ThemeProvider>
        <MapView
          layout={buildFixture()}
          entities={new Map()}
          char={char}
          forceBackend="svg"
          onStats={(s) => stats.push(s)}
        />
      </ThemeProvider>,
    );
    expect(stats.at(-1)?.backend).toBe('svg');
  });

  it('后端切换（svg → canvas）必然触发一次上报（backend 并入材料字段）', async () => {
    const stats: MapStats[] = [];
    const layout = buildFixture();
    const entities = new Map();
    const push = (s: MapStats): void => {
      stats.push(s);
    };
    const { rerender } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={entities} char={char} forceBackend="svg" onStats={push} />
      </ThemeProvider>,
    );
    expect(stats.at(-1)?.backend).toBe('svg');

    // 只有 backend 变（节点/连线/lod 全不变）→ 仍必须补报一次（材料字段含 backend）
    rerender(
      <ThemeProvider>
        <MapView
          layout={layout}
          entities={entities}
          char={char}
          forceBackend="canvas"
          onStats={push}
        />
      </ThemeProvider>,
    );
    await sleep(320); // 越过 200ms 节流窗口（窗口内合并 → 末尾补报）
    expect(stats.at(-1)?.backend).toBe('canvas');
  });
});

describe('R5-3 · 损失清单实测（DoD：不许只写「我认为」）', () => {
  it('同夹具两侧渲染 diff：svg → 树线标注 1 / note 角标 1 / 中心角标 1；canvas → 0 / 0 / 0', () => {
    const layout = buildFixture();
    // C4 追加：中心角标（data-center）损失项——「任务A」作中心身份
    // （渲染条件吃 centerTitles = collectCenters 的真实中心事实，见 mapview-center-badge.test.tsx）
    const centerNode = layout.nodes.find((n) => n.node.text === '任务A');
    if (centerNode === undefined) throw new Error('夹具构建失败：找不到 任务A');
    const centerTitles = new Map([[centerNode.node.id, '中心']]);

    const svgView = render(
      <ThemeProvider>
        <MapView
          layout={layout}
          entities={new Map()}
          char={char}
          forceBackend="svg"
          centerTitles={centerTitles}
        />
      </ThemeProvider>,
    );
    // 实测（2026-09-13 占位跑捕获，原样）：svg 侧 tree-edge-label=1 / note-badge=1；
    // canvas 侧 = +0 / +0。与 §1.3 损失清单一致（树线标注 chip + note 角标丢失）。
    expect(svgView.container.querySelectorAll('[data-tree-edge-label]').length).toBe(1);
    expect(svgView.container.querySelectorAll('[data-note-badge]').length).toBe(1);
    expect(svgView.container.querySelectorAll('[data-center]').length).toBe(1);

    const canvasView = render(
      <ThemeProvider>
        <MapView
          layout={layout}
          entities={new Map()}
          char={char}
          forceBackend="canvas"
          centerTitles={centerTitles}
        />
      </ThemeProvider>,
    );
    expect(canvasView.container.querySelector('canvas')).not.toBeNull();
    expect(canvasView.container.querySelectorAll('[data-tree-edge-label]').length).toBe(0);
    expect(canvasView.container.querySelectorAll('[data-note-badge]').length).toBe(0);
    expect(canvasView.container.querySelectorAll('[data-center]').length).toBe(0);
  });
});
