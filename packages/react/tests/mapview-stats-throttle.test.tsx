// @vitest-environment jsdom
/**
 * B-P3：`onStats` 节流（≥200ms 且**材料字段**变化才回调）+ 缩放手势期 LOD 冻结
 *
 * 动机（计划 §1 第 4 条）：原先每 epoch（= 每个 pan/zoom 帧）都 `onStats(新对象)` →
 * 父壳（2000+ 行、PerfPanel 常显）每帧重渲。这是「最便宜的高收益项」。
 *
 * 三维验收：
 *  ① 200ms 窗口内的连续 epoch 变更 → 只上报 1 次；窗口过后值未变 → 仍不上报；
 *  ② 正向对照：**材料字段**（visibleNodes/totalNodes/visibleLinks/lod）变化 → 会补报；
 *  ③ 缩放手势期跨越 0.5 阈值 → 手势内 lod 保持手势前的值，手势结束后才切换。
 *
 * 材料字段口径：`viewMs` 每帧都变（渲染计时噪声）故**不**作为触发条件，
 * 只在回调 payload 里如实携带（面板诊断用，允许语义微调）。
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { astToEditable, layoutMindmap, makeTextNode, type LayoutResult } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';
import { MapView, type MapStats } from '../src/render/MapView.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function mount(onStats: (s: MapStats) => void, extra: Partial<Parameters<typeof MapView>[0]> = {}) {
  const root = makeTextNode('根', [
    makeTextNode('分支 A', [makeTextNode('叶 1'), makeTextNode('叶 2')]),
    makeTextNode('分支 B'),
  ]);
  const editable = astToEditable(root)!;
  const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
  const layout = layoutMindmap(editable, createNodeMeasure(char, new Map()), new Set());
  const { container } = render(
    <ThemeProvider>
      <MapView layout={layout} entities={new Map()} char={char} onStats={onStats} {...extra} />
    </ThemeProvider>,
  );
  const wheel = container.querySelector('div[style*="touch-action"]') as HTMLElement;
  return { container, wheel, layout, char };
}

/**
 * 静态布局夹具（材料字段恒定）：5 个同址小盒、无连线。
 * 用途：jsdom 视口极小（1×1，靠 CULL_MARGIN 撑开，见 mapview-section-drag.test.tsx 注），
 * 真实布局的小幅平移也会改变可见集 → 无法构造「材料字段不变」场景；静态小盒则可以。
 */
function mountTiny(onStats: (s: MapStats) => void) {
  const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
  const rootNode = makeTextNode('root');
  const kids = Array.from({ length: 4 }, (_, i) => makeTextNode(`k${i}`));
  rootNode.children = kids; // 真实父子关系（MapView 需 root 派生）
  const mk = (node: ReturnType<typeof makeTextNode>, x: number, depth: number, parentId: string | null) => ({
    node,
    box: { x, y: 0, w: 30, h: 20 },
    side: 1 as const,
    depth,
    parentId,
    children: [] as never[],
  });
  const nodes = [
    mk(rootNode, 0, 0, null),
    ...kids.map((k, i) => mk(k, i * 4, 1, rootNode.id)),
  ];
  const layout: LayoutResult = {
    nodes,
    links: [],
    bounds: { minX: 0, minY: 0, maxX: 30, maxY: 20 },
  };
  const { container } = render(
    <ThemeProvider>
      <MapView layout={layout} entities={new Map()} char={char} onStats={onStats} />
    </ThemeProvider>,
  );
  const wheel = container.querySelector('div[style*="touch-action"]') as HTMLElement;
  return { container, wheel, layout };
}

/**
 * 一次按住 + n 次移动、**不抬起**（总位移 40px，手势保持）——
 * 用于「材料字段不变」的场景：jsdom 视口极小（1×1，靠 CULL_MARGIN 撑开），
 * 松手会触发惯性滑行把节点甩出裁剪带 → 材料字段必然变化；不抬起则视口停在原处。
 */
function panHold(wheel: HTMLElement, n: number, dx = 4, dy = 3): void {
  fireEvent.pointerDown(wheel, { clientX: -4000, clientY: -4000, pointerId: 1, bubbles: true });
  for (let i = 1; i <= n; i++) {
    fireEvent.pointerMove(wheel, {
      clientX: -4000 + i * dx,
      clientY: -4000 + i * dy,
      pointerId: 1,
      bubbles: true,
    });
  }
}

describe('B-P3 · onStats 节流', () => {
  it('① 窗口内连续 10 次 epoch 变更 → 只上报 1 次；窗口过后未变 → 不补报', async () => {
    const reports: MapStats[] = [];
    const { wheel } = mountTiny((s) => reports.push(s)); // 静态布局：材料字段恒定
    expect(reports.length).toBe(1); // 首帧一报
    expect(reports[0]?.totalNodes).toBe(5);

    panHold(wheel, 10); // 10 次移动 = 10 次 epoch 变更（总位移 40px，同址小盒不裁剪）
    await sleep(80); // 一帧（仍在 200ms 窗口内）
    expect(reports.length).toBe(1); // 窗口内合并：10 次 epoch 只 1 次上报（原实现是 10 次）

    await sleep(300); // 越过窗口：材料字段未变 → 仍不补报
    expect(reports.length).toBe(1);
  });

  it('② 正向对照：可见集变化（材料字段）→ 会补报，且 payload 如实反映', async () => {
    const reports: MapStats[] = [];
    const { wheel, layout } = mount((s) => reports.push(s));
    expect(reports.at(-1)?.visibleNodes).toBe(layout.nodes.length);

    // 一次大位移平移：节点全部离开视口 → visibleNodes 变化（材料字段）
    fireEvent.pointerDown(wheel, { clientX: -4000, clientY: -4000, pointerId: 1, bubbles: true });
    fireEvent.pointerMove(wheel, { clientX: 3000, clientY: -4000, pointerId: 1, bubbles: true });
    fireEvent.pointerUp(wheel, { clientX: 3000, clientY: -4000, pointerId: 1, bubbles: true });
    await sleep(320); // 越过 200ms 节流窗口（补报在窗口末尾）

    expect(reports.length).toBeGreaterThan(1);
    expect(reports.at(-1)?.visibleNodes).toBe(0);
    expect(reports.at(-1)?.totalNodes).toBe(layout.nodes.length);
  });
});

describe('B-P3 · 缩放手势期 LOD 冻结', () => {
  it('③ 手势内跨越 0.5 阈值 → lod 保持手势前的值；手势结束后才切换', async () => {
    const reports: MapStats[] = [];
    const { wheel } = mount((s) => reports.push(s));
    await sleep(30);
    expect(reports.at(-1)?.lod).toBe('full'); // k=1 → full

    // 滚轮缩小：3 连击使 k < 0.5（force = exp(-deltaY*0.0016)）
    for (let i = 0; i < 3; i++) {
      fireEvent.wheel(wheel, { clientX: 200, clientY: 200, deltaY: 400 });
      await sleep(30);
    }
    // 手势仍在进行（空闲 < 120ms）→ 期间任何上报都必须是手势前的档位
    const during = reports.map((r) => r.lod);
    expect(during.every((l) => l === 'full'), `手势内出现非冻结档位：${during.join(',')}`).toBe(true);

    await sleep(400); // 手势结束（释放延迟 120ms）+ 窗口结束 → 补报新档位
    expect(reports.at(-1)?.lod).not.toBe('full');
  });
});
