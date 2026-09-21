// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { LayoutCache, astToEditable, layoutMindmap, parseMm, updateNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView } from '../src/render/MapView.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

/**
 * GH-T5 验收：真实 10K 节点 .mm 端到端链路（打开 → 解析 → 布局 → 首帧）。
 * 数据与浏览器手测清单见 docs/dispatch/2026-08-30-gh-batch-report.md（T5 小节）；
 * 手测用文件由 scripts/gen-big-mm.mjs 生成（bench-assets/big-10k.mm.md），
 * 此处在测试内生成同构文本（3 叉深 8）——避免 node fs 依赖（react 包 tsconfig types:[]）。
 */
function genBigSource(depth = 8, fanout = 3): string {
  const lines = ['# 10K 节点验收图', ''];
  let seq = 0;
  const walk = (d: number, indent: string): void => {
    if (d >= depth) return;
    for (let i = 0; i < fanout; i++) {
      lines.push(`${indent}- n${seq++}`);
      walk(d + 1, indent + '  ');
    }
  };
  walk(0, '');
  return lines.join('\n');
}
const source = genBigSource();
const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

describe('10K 节点端到端验收（GH-T5 硬门禁）', () => {
  it('打开链路：parse + 布局 + 增量编辑 + 首帧，全流程可用', async () => {
    // 1. parse（打开文档的解析步骤）
    let t = performance.now();
    const { root } = parseMm(source);
    const parseMs = performance.now() - t;

    // 2. 布局（首次打开的计算主体）
    const editable = astToEditable(root)!;
    // 关键：measure 与 collapsed **必须复用同一引用** —— 二者都是 LayoutCache 的键组成部分。
    // 原写法每次 `createNodeMeasure(char, new Map())` / `new Set()`，键每次都变 →
    // 缓存**永不命中**，于是第 3 步测到的根本不是增量而是全量（实测 27ms；真正增量仅 0.1ms）。
    // 这也是这条门禁偶发抖动的根因：分子测的是全量，却拿去和「冷启动全量」比，阈值只剩 1.05x 余量。
    const measure = createNodeMeasure(char, new Map());
    const collapsed = new Set<string>();
    t = performance.now();
    const layout = layoutMindmap(editable, measure, collapsed);
    const layoutMs = performance.now() - t;
    expect(layout.nodes.length).toBeGreaterThanOrEqual(9800);

    // 3. 增量编辑（打开后首个操作：编辑一个叶子节点）——T6 缓存命中路径
    // 注意：编辑根节点会使整树失效（预期）；叶子编辑才是增量最优场景
    const cache = new LayoutCache();
    layoutMindmap(editable, measure, collapsed, {
      cache,
      measureKey: 'k',
    });
    let leaf = editable;
    const findLeaf = (n: typeof editable): void => {
      if (n.children.length === 0) leaf = n;
      else for (const c of n.children) findLeaf(c as typeof editable);
    };
    findLeaf(editable);
    // 不换行短文本：宽度变化、高度不变 → 根居中不位移 → 增量命中最优路径（T6 同款）
    const edited = updateNode(editable, leaf.id, { text: 'x'.repeat(10) });
    // 稳态采样（T6 同款：预热后循环取中位数，避免单次 JIT/GC 噪声）
    const incTimes: number[] = [];
    for (let i = 0; i < 7; i++) {
      t = performance.now();
      layoutMindmap(edited, measure, collapsed, {
        cache,
        measureKey: 'k',
      });
      incTimes.push(performance.now() - t);
    }
    const incMs = [...incTimes].sort((a, b) => a - b)[3]!;
    const incLayout = layoutMindmap(edited, measure, collapsed, {
      cache,
      measureKey: 'k',
    });
    expect(incLayout.nodes.length).toBe(layout.nodes.length);

    // 4. 首帧提交（jsdom 代理；真实浏览器 DOM 更快）
    t = performance.now();
    const { container, unmount } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} />
      </ThemeProvider>,
    );
    const firstCommitMs = performance.now() - t;
    expect(container.querySelector('g[data-node-id]')).not.toBeNull();
    unmount();

    console.log(
      `[GH-T5] nodes=${layout.nodes.length} parseMs=${parseMs.toFixed(1)} layoutMs=${layoutMs.toFixed(1)} ` +
        `incEditMs=${incMs.toFixed(2)} firstCommitMs=${firstCommitMs.toFixed(1)}`,
    );
    // 门禁：解析+布局合计 < 1s（真实浏览器 + 本机硬件量级）
    expect(parseMs + layoutMs).toBeLessThan(1000);
    // 增量编辑：缓存命中后应只重放受影响分支。
    // 修复前因每轮新建 measure/collapsed，缓存不命中，实测 ~27ms（≈全量），
    // 却拿去和「冷启动全量」比，阈值只剩 1.05x 余量 → 偶发抖动（pass→fail→pass）。
    // 修复后实测 ~0.1ms（约为冷启动全量的 0.14%）。阈值取 5%：
    //   · 余量约 35x —— 单次测量的 JIT/GC 噪声（±30%）完全不足以触发失败
    //   · 且**恢复了检测能力** —— 一旦缓存退化（增量退回全量量级 ~27ms）即远超 5% 阈值而报错
    // 真正的增量/全量比率由 kernel T6（`layout-incremental.test.ts`）以 30% 权威守护。
    expect(incMs).toBeLessThan(layoutMs * 0.05);
    expect(firstCommitMs).toBeLessThan(5000);
  }, 60000);
});
