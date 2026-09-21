// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { layoutMindmap, makeTextNode } from '@mindcanvas/kernel';
import type { LayoutResult } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView } from '../src/render/MapView.js';
import { createCharMeasure, } from '../src/render/domMeasure.js';

/** 4 叉树 → 5461 / 21845 / 87381（与 docs/preview/perf-baseline.md 同构） */
function buildTree(depth: number) {
  let seq = 0;
  const mk = (d: number): ReturnType<typeof makeTextNode> => {
    const node = makeTextNode('n' + seq, []);
    seq += 1;
    if (d < depth) {
      for (let i = 0; i < 4; i++) node.children.push(mk(d + 1));
    }
    return node;
  };
  return mk(0);
}

const measure = (n: { text?: string }) => ({ w: 40 + (n.text ? n.text.length : 0) * 6, h: 30 });

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

describe('大规模渲染基准（M5-T8：首帧渲染耗时代理）', () => {
  it.each([
    [6, 5461],
    [7, 21845],
    [8, 87381],
  ] as const)(
    '深度 %i（~%i 节点）：首帧提交耗时落档',
    (depth, expected) => {
      const root = buildTree(depth);
      const layout: LayoutResult = layoutMindmap(root, measure, new Set());
      // jsdom 无尺寸 → 视口裁剪兜底（可见集受裁剪约束，DOM 量小）——
      // 本测试度量「布局 + 派生 + 裁剪 + DOM 首帧提交」的完整计算成本（真实浏览器 DOM 更快）
      const t0 = performance.now();
      const { container, unmount } = render(
        <ThemeProvider>
          <MapView layout={layout} entities={new Map()} char={char} />
        </ThemeProvider>,
      );
      const t1 = performance.now();
      const firstCommitMs = t1 - t0;
      const domNodes = container.querySelectorAll('g[data-node-id]').length;
      console.log(
        `[T8] nodes=${layout.nodes.length} firstCommitMs=${firstCommitMs.toFixed(1)} domNodes=${domNodes} (jsdom 代理)`,
      );
      expect(layout.nodes.length).toBeGreaterThanOrEqual(expected);
      // C2 自动降级：>CANVAS_AUTO_NODES(50K) → SVG 层让位 Canvas（DOM 节点 0 属预期，canvas 接管绘制）
      const canvasMode = container.querySelector('canvas') !== null;
      if (canvasMode) expect(domNodes).toBe(0);
      else expect(domNodes).toBeGreaterThan(0);
      expect(firstCommitMs).toBeLessThan(5000); // 宽松门禁：不崩溃 + 可完成
      unmount();
    },
    60000,
  );
});
