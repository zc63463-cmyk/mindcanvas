// @vitest-environment jsdom
/**
 * B3 写路径：共享梁双把手**提交分流**（真 EditorController，无 UI）。
 *
 * 覆盖（设计 §4.3 松手提交 + §3 协议）：
 * - trunk（bias）松手 → 只写 `beamAt[dir]`（`lens` 不动）；布局重跑后**子盒坐标逐值不变**
 * - rail（lens）松手 → `lens[dir]` 变、`beamAt` 保留；布局重跑后**子组外推**
 * - ≈0.5（BEAM_AT_EPS 容差内）→ 删该方向键；其余方向键保留；全空 → 删整个 `beamAt` 键
 * - 单条 undo：一次提交一条历史（undo 即复原，含序列化源文）
 * - 序列化（转 AST → serializeMm）：`beamAt` 落盘为 inline JSON；≈0.5 提交后无该键
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BEAM_AT_EPS,
  editableToAst,
  getNode,
  layoutMindmapBranched,
  makeTextNode,
  serializeMm,
  type EditableNode,
  type GrowDir,
  type LayoutResult,
} from '@mindcanvas/kernel';
import { EditorController } from '@mindcanvas/react';
import { applyBeamCommit } from '../src/beamEdit.js';

const measure = (n: EditableNode) => ({ w: (n.text?.length ?? 1) * 10 + 20, h: 30 });

/** 上向枢纽夹具：根 → 枢纽（lens.up = 96）→ 两个显式 up 子 */
function fixture(note: Record<string, unknown> = {}) {
  const kids = ['上子一', '上子二'].map((t) => ({
    ...makeTextNode(t),
    note: { dir: 'up' as GrowDir },
  }));
  const hub: EditableNode = {
    ...makeTextNode('枢纽', kids),
    note: { lens: { up: 96 }, ...note },
  };
  return { root: makeTextNode('根', [hub]), hubId: hub.id, kidIds: kids.map((k) => k.id) };
}

const layoutOf = (root: EditableNode): LayoutResult =>
  layoutMindmapBranched(root, measure, new Set());

/** 父出边 → 最近子入边的空隙（up：父顶边 − 最高子底缘） */
function upGap(layout: LayoutResult, hubId: string, kidIds: readonly string[]): number {
  const hub = layout.nodes.find((n) => n.node.id === hubId);
  if (hub === undefined) throw new Error('布局缺失枢纽');
  const bottoms = kidIds.map((id) => {
    const ln = layout.nodes.find((n) => n.node.id === id);
    if (ln === undefined) throw new Error('布局缺失子节点');
    return ln.box.y + ln.box.h;
  });
  return hub.box.y - Math.max(...bottoms);
}

/** 节点盒快照（找 id 排序，保证与遍历顺序无关） */
function boxesOf(layout: LayoutResult): Array<{ id: string; x: number; y: number }> {
  return layout.nodes
    .map((n) => ({ id: n.node.id, x: n.box.x, y: n.box.y }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

// canvas 套件统一 pretendToBeVisual:false（无 rAF）→ controller.notify 的调度需补桩
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    window.setTimeout(() => cb(0), 16),
  );
  vi.stubGlobal('cancelAnimationFrame', (h: number) => window.clearTimeout(h));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('B3 写路径：bias（主干）只写 beamAt', () => {
  it('★ trunk 松手 → 只出现 beamAt；lens 不动；布局重跑后子盒坐标逐值不变', () => {
    const { root, hubId } = fixture();
    const controller = new EditorController(root);
    const before = boxesOf(layoutOf(controller.root));

    applyBeamCommit(controller, hubId, { kind: 'bias', dir: 'up', at: 0.75 });

    const note = getNode(controller.root, hubId)?.note;
    expect(note?.beamAt).toEqual({ up: 0.75 });
    expect(note?.lens).toEqual({ up: 96 }); // 层距不动
    expect(boxesOf(layoutOf(controller.root))).toEqual(before); // 节点盒零位移
  });

  it('非法值（NaN）不落盘（防文档污染 → 布局 NaN 扩散）', () => {
    const { root, hubId } = fixture();
    const controller = new EditorController(root);
    applyBeamCommit(controller, hubId, { kind: 'bias', dir: 'up', at: Number.NaN });
    expect('beamAt' in (getNode(controller.root, hubId)?.note ?? {})).toBe(false);
  });

  it('★ ≈0.5 删该方向键；其余方向键保留；全空 → 连 beamAt 键一起删', () => {
    const { root, hubId } = fixture({ beamAt: { up: 0.75, left: 0.3 } });
    const controller = new EditorController(root);

    applyBeamCommit(controller, hubId, { kind: 'bias', dir: 'up', at: 0.5 });
    expect(getNode(controller.root, hubId)?.note?.beamAt).toEqual({ left: 0.3 });

    applyBeamCommit(controller, hubId, {
      kind: 'bias',
      dir: 'left',
      at: 0.5 + BEAM_AT_EPS / 2, // 容差内 → 视为缺省
    });
    expect('beamAt' in (getNode(controller.root, hubId)?.note ?? {})).toBe(false);
  });

  it('★ 序列化：beamAt 落盘 inline JSON；≈0.5 提交后源文无该键（最小面）', () => {
    const { root, hubId } = fixture();
    const controller = new EditorController(root);
    const srcOf = (): string => serializeMm(editableToAst(controller.root));

    expect(srcOf()).not.toContain('beamAt');
    applyBeamCommit(controller, hubId, { kind: 'bias', dir: 'up', at: 0.625 });
    expect(srcOf()).toContain('beamAt');
    applyBeamCommit(controller, hubId, { kind: 'bias', dir: 'up', at: 0.5 });
    expect(srcOf()).not.toContain('beamAt');
  });

  it('★ 单条 undo：一次提交一条历史（undo 即复原，含源文）', () => {
    const { root, hubId } = fixture();
    const controller = new EditorController(root);
    const srcBefore = serializeMm(editableToAst(controller.root));

    applyBeamCommit(controller, hubId, { kind: 'bias', dir: 'up', at: 0.75 });
    expect(serializeMm(editableToAst(controller.root))).not.toBe(srcBefore);
    expect(controller.undo()).toBe(true);
    expect(serializeMm(editableToAst(controller.root))).toBe(srcBefore);
  });
});

describe('B3 写路径：lens（梁中段）不影响 beamAt', () => {
  it('★ rail 松手 → lens 变、beamAt 保留；布局重跑后子组外推', () => {
    const { root, hubId, kidIds } = fixture({ beamAt: { up: 0.75 } });
    const controller = new EditorController(root);
    const gapBefore = upGap(layoutOf(controller.root), hubId, kidIds);

    applyBeamCommit(controller, hubId, { kind: 'lens', dir: 'up', len: 160 });

    const note = getNode(controller.root, hubId)?.note;
    expect(note?.lens).toEqual({ up: 160 });
    expect(note?.beamAt).toEqual({ up: 0.75 }); // 比例位保留
    const gapAfter = upGap(layoutOf(controller.root), hubId, kidIds);
    expect(gapBefore).toBeCloseTo(96, 3);
    expect(gapAfter).toBeCloseTo(160, 3); // 子组外推 = 新层距
  });

  it('序列化：lens 与 beamAt 并存（两键互不吞并）', () => {
    const { root, hubId } = fixture({ beamAt: { up: 0.75 } });
    const controller = new EditorController(root);
    applyBeamCommit(controller, hubId, { kind: 'lens', dir: 'up', len: 160 });
    const src = serializeMm(editableToAst(controller.root));
    expect(src).toContain('lens');
    expect(src).toContain('beamAt');
  });

  it('非法层距（Infinity）不落盘', () => {
    const { root, hubId } = fixture();
    const controller = new EditorController(root);
    applyBeamCommit(controller, hubId, { kind: 'lens', dir: 'up', len: Number.POSITIVE_INFINITY });
    expect(getNode(controller.root, hubId)?.note?.lens).toEqual({ up: 96 });
  });
});
