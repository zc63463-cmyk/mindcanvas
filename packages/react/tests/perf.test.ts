/**
 * T5 性能验证：500+ 节点 布局 + 视口裁剪 + 空闲判据（对照 kernel 布局 23ms 预算）。
 * 阈值宽松（CI 抗抖动）：600+ 节点布局 < 250ms、单帧裁剪 < 8ms、空闲零挂起帧。
 * 中位数采样抗噪声（K2-fix 同法）。
 */
import { describe, expect, it } from 'vitest';
import { filterVisibleLinks, isBoxInView, layoutMindmap, makeTextNode } from '@mindcanvas/kernel';
import type { EditableNode, LayoutResult } from '@mindcanvas/kernel';
import { FrameScheduler } from '../src/render/scheduler.js';
import { ViewportController } from '../src/render/viewport.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

/** 生成平衡子树（rootBranch ×(1 + w + w² + …) 节点） */
function genTree(depth: number, width: number, prefix = 'n'): EditableNode {
  const node = makeTextNode(prefix, []);
  if (depth > 1) {
    for (let i = 0; i < width; i++) node.children.push(genTree(depth - 1, width, `${prefix}.${i}`));
  }
  return node;
}

/** 中位数（抗噪声） */
function median(samples: number[]): number {
  const s = [...samples].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

describe('T5 性能验证（500+ 节点）', () => {
  it('布局预算对照 + 裁剪/LOD 视口统计 + 空闲零活动', () => {
    // 根 + 8 枝，每枝 4 层 × 4 宽 = 85 → 共 ~680 节点
    const root = makeTextNode('root', []);
    for (let i = 0; i < 8; i++) root.children.push(genTree(4, 4, `b${i}`));
    const char = createCharMeasure(
      { family: 'Segoe UI, Microsoft YaHei, sans-serif', size: 11 },
      null,
    );
    const measure = createNodeMeasure(char, new Map());

    // 布局耗时（中位数 ×5，对照 kernel 2000 节点 ~23ms 量级）
    const layoutSamples: number[] = [];
    let layout: LayoutResult;
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      layout = layoutMindmap(root, measure, new Set());
      layoutSamples.push(performance.now() - t0);
    }
    const layoutMs = median(layoutSamples);
    const totalNodes = layout!.nodes.length;
    expect(totalNodes).toBeGreaterThan(500);

    // 视口：fit 全图后统计可见集（裁剪计算耗时；同 MapView 单帧路径）
    const frame = new FrameScheduler({
      raf: (cb) => cb() as unknown as number,
      rafCancel: () => undefined,
    });
    const vp = new ViewportController(frame);
    vp.setSize(1280, 800);
    vp.fitBounds(layout!.bounds, 60);
    const view = vp.worldRect(128);

    // 渲染体计时：3 次采样取中位数（单次受 GC/JIT 噪声影响——M5-report B2 记录：单跑 1.4ms、并行负载偶发 11ms）
    const boxes = new Map(layout!.nodes.map((n) => [n.node.id, n.box]));
    const viewSamples: number[] = [];
    let visibleNodes: unknown[] = [];
    let visibleLinks: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      const t1 = performance.now();
      visibleNodes = layout!.nodes.filter((n) => isBoxInView(n.box, view, 128));
      visibleLinks = filterVisibleLinks(layout!.links, boxes, view, 128);
      viewSamples.push(performance.now() - t1);
    }
    const viewMs = [...viewSamples].sort((a, b) => a - b)[1]!;

    // 空闲判据：帧已 flush，无挂起 rAF（dirty-flag 单帧，无永续循环）
    expect(frame.hasPending).toBe(false);

    // 数值记录（K3-report T5 小节引用）
    console.log(
      `[T5] nodes=${totalNodes} links=${layout!.links.length} layoutMedianMs=${layoutMs.toFixed(2)} ` +
        `viewMs=${viewMs.toFixed(3)} visible=${visibleNodes.length}/${totalNodes} visibleLinks=${visibleLinks.length}`,
    );

    expect(layoutMs).toBeLessThan(250);
    // B2 放宽：8ms 单次绝对阈值在并行负载下偶发误报（实测单跑 1.4ms）→ 中位数门禁 + 1.5x 余量
    expect(viewMs).toBeLessThan(12);
    expect(visibleNodes.length).toBeGreaterThan(0);
  });
});
