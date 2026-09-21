// @vitest-environment jsdom
/**
 * B3 接线：MapView 双把手**真指针路径**（trunk → bias / rail → lens）。
 *
 * 覆盖：
 * - 主干带按下拖动 → 徽标「主干 Npx」；松手 `onBeamChange{kind:'bias'}`（比例位随指针）
 * - 梁中段按下拖动 → 徽标「层距 Npx」；松手 `onBeamChange{kind:'lens'}`（层距随指针）
 * - 拖拽中**节点不动**（世界 transform 逐值不变）——两模式共同契约
 * - 未移动（点击）→ 不提交
 *
 * 设施比照 mapview-center-drag.test.tsx：jsdom 容器 0×0 → 世界变换约恒等（k=1），
 * 夹具贴近原点（±256 裁剪窗内）。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import {
  layoutMindmapBranched,
  makeTextNode,
  type Box,
  type EditableNode,
  type GrowDir,
} from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView } from '../src/render/MapView.js';
import { createCharMeasure } from '../src/render/domMeasure.js';

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
const measure = (n: EditableNode) => ({ w: (n.text?.length ?? 1) * 10 + 20, h: 30 });

/** 夹具可覆盖的父亲笔记（beamAt 场景：先拖主干抬梁后的状态） */
interface FixtureNote {
  beamAt?: { up?: number };
}

/** 上向枢纽夹具：根 → 枢纽（hub + lens.up 96 [+ 可选 beamAt]）→ 两个显式 up 子 */
function fixture(extra: FixtureNote = {}) {
  const kids = ['上子一', '上子二'].map((t) => ({
    ...makeTextNode(t),
    note: { dir: 'up' as GrowDir },
  }));
  const hub: EditableNode = {
    ...makeTextNode('枢纽', kids),
    note: { hub: true, lens: { up: 96 }, ...extra },
  };
  const root = makeTextNode('根', [hub]);
  const layout = layoutMindmapBranched(root, measure, new Set());
  return { layout, hubId: hub.id, kidIds: kids.map((k) => k.id) };
}

type BeamChangeFn = Parameters<typeof MapView>[0]['onBeamChange'];

function setup(onBeamChange: BeamChangeFn, extra: FixtureNote = {}) {
  const { layout, hubId, kidIds } = fixture(extra);
  const { container } = render(
    <ThemeProvider>
      <MapView layout={layout} entities={new Map()} char={char} onBeamChange={onBeamChange} />
    </ThemeProvider>,
  );
  const wheel = container.querySelector('div[style*="touch-action"]') as HTMLElement | null;
  if (wheel === null) throw new Error('手势层缺失');
  const hub = layout.nodes.find((n) => n.node.id === hubId);
  if (hub === undefined) throw new Error('夹具缺失枢纽盒');
  const childBoxes: Box[] = [];
  for (const id of kidIds) {
    const ln = layout.nodes.find((n) => n.node.id === id);
    if (ln === undefined) throw new Error('夹具缺失子上行盒');
    childBoxes.push(ln.box);
  }
  const hubTop = hub.box.y;
  const childEdge = Math.max(...childBoxes.map((b) => b.y + b.h));
  const cx = hub.box.x + hub.box.w / 2;
  const at = extra.beamAt?.up ?? 0.5;
  const rail = hubTop + (childEdge - hubTop) * at; // 梁位 = 比例位映射（up：childEdge 在上）
  return {
    container,
    wheel,
    hubId,
    kidIds,
    hubTop,
    childEdge,
    cx,
    rail,
    startLen: Math.abs(childEdge - hubTop), // 真 gap（lens 映射起点）
  };
}

/** 节点 g 的 transform（NodeG 定位；拖拽中应逐值不变） */
function transformsOf(container: HTMLElement, ids: readonly string[]): string[] {
  return ids.map(
    (id) => container.querySelector(`g[data-node-id="${id}"]`)?.getAttribute('transform') ?? '',
  );
}

/** 拖拽预览徽标文本（梁叠层；无叠层 → ''） */
function badgeText(container: HTMLElement): string {
  const texts = Array.from(container.querySelectorAll('g[data-layer="tree-links"] text'))
    .map((t) => t.textContent ?? '')
    .filter((s) => s.startsWith('主干') || s.startsWith('层距'));
  return texts[texts.length - 1] ?? '';
}

describe('MapView：trunk（bias）——只改比例位，节点不动', () => {
  it('★ 主干带拖动 → 徽标「主干 Npx」；松手提交 bias（gap 不变）', () => {
    const onBeamChange = vi.fn();
    const { container, wheel, hubId, kidIds, hubTop, childEdge, cx } = setup(onBeamChange);
    const before = transformsOf(container, kidIds);

    // 按下：主干带（父中线 x = cx；父出边到梁之间）——叠层即刻出现，起始位 = 当前比例位
    fireEvent.pointerDown(wheel, { clientX: cx, clientY: hubTop - 10, pointerId: 1, bubbles: true });
    expect(badgeText(container)).toBe('主干 48px'); // 起始 at 0.5 → round(96 × 0.5)
    // 移动到 0.75 位（up：比例位 = (p − 父顶) / gap，向上为负）
    const targetY = hubTop + (childEdge - hubTop) * 0.75;
    fireEvent.pointerMove(wheel, { clientX: cx, clientY: targetY, pointerId: 1, bubbles: true });
    expect(badgeText(container)).toBe('主干 72px'); // round(96 × 0.75)
    expect(transformsOf(container, kidIds)).toEqual(before); // 节点不动

    fireEvent.pointerUp(wheel, { clientX: cx, clientY: targetY, pointerId: 1, bubbles: true });
    expect(onBeamChange).toHaveBeenCalledTimes(1);
    expect(onBeamChange.mock.calls[0]?.[0]).toBe(hubId);
    const commit = onBeamChange.mock.calls[0]?.[1];
    expect(commit?.kind).toBe('bias');
    if (commit?.kind !== 'bias') throw new Error('提交形态应为 bias');
    expect(commit.dir).toBe('up');
    expect(commit.at).toBeCloseTo(0.75, 6);
  });

  it('未移动（点击主干）→ 不提交', () => {
    const onBeamChange = vi.fn();
    const { wheel, hubTop, cx } = setup(onBeamChange);
    fireEvent.pointerDown(wheel, { clientX: cx, clientY: hubTop - 10, pointerId: 1, bubbles: true });
    fireEvent.pointerUp(wheel, { clientX: cx, clientY: hubTop - 10, pointerId: 1, bubbles: true });
    expect(onBeamChange).not.toHaveBeenCalled();
  });
});

describe('MapView：rail（lens）——改层距，比例位保留', () => {
  it('★ 梁中段拖动 → 徽标「层距 Npx」；松手提交 lens', () => {
    const onBeamChange = vi.fn();
    const { container, wheel, hubId, kidIds, cx, rail, startLen } = setup(onBeamChange);
    const before = transformsOf(container, kidIds);

    // 按下：梁中段（离父中线 20px > 交汇垫 12；在梁段范围内）
    fireEvent.pointerDown(wheel, { clientX: cx + 20, clientY: rail, pointerId: 2, bubbles: true });
    // 向上拖 30px → 层距 +30（up：Δ = start.y − cur.y）
    fireEvent.pointerMove(wheel, { clientX: cx + 20, clientY: rail - 30, pointerId: 2, bubbles: true });
    expect(badgeText(container)).toBe(`层距 ${startLen + 30}px`);
    expect(transformsOf(container, kidIds)).toEqual(before); // 节点不动（松手后布局权威重排）

    fireEvent.pointerUp(wheel, { clientX: cx + 20, clientY: rail - 30, pointerId: 2, bubbles: true });
    expect(onBeamChange).toHaveBeenCalledTimes(1);
    expect(onBeamChange.mock.calls[0]?.[0]).toBe(hubId);
    const commit = onBeamChange.mock.calls[0]?.[1];
    expect(commit?.kind).toBe('lens');
    if (commit?.kind !== 'lens') throw new Error('提交形态应为 lens');
    expect(commit.dir).toBe('up');
    expect(commit.len).toBe(startLen + 30);
  });

  it('★ 用户序列：先拖主干（beamAt.up=0.75）再拖中段微调 → 层距 = gap + Δ（不弹开一截）', () => {
    const onBeamChange = vi.fn();
    const { container, wheel, hubId, hubTop, cx, rail, startLen } = setup(onBeamChange, {
      beamAt: { up: 0.75 },
    });
    // 梁在 0.75 位、起点层距 = 真 gap 96（修前 startLen = |rail − 父顶| × 2 = 144）
    expect(startLen).toBe(96);
    expect(rail).toBeCloseTo(hubTop - 72, 6); // 0.75 × gap = 主干

    fireEvent.pointerDown(wheel, { clientX: cx + 20, clientY: rail, pointerId: 3, bubbles: true });
    expect(badgeText(container)).toBe('层距 96px');
    fireEvent.pointerMove(wheel, { clientX: cx + 20, clientY: rail - 10, pointerId: 3, bubbles: true });
    expect(badgeText(container)).toBe('层距 106px'); // 修前：154px

    fireEvent.pointerUp(wheel, { clientX: cx + 20, clientY: rail - 10, pointerId: 3, bubbles: true });
    expect(onBeamChange.mock.calls[0]?.[0]).toBe(hubId);
    expect(onBeamChange.mock.calls[0]?.[1]).toEqual({ kind: 'lens', dir: 'up', len: 106 });
  });
});
