// @vitest-environment jsdom
/**
 * FE-FRAME-1.1 护航：Section 两级 memo 分层（A · 成员清单 ↔ B · 取盒建帧）。
 *
 * 判别指标 = 成员公式唯一出口 `containedMemberIds` 的调用次数（模块级计数包装）：
 * 布局动画期 B 层逐帧跟 animBoxes（Section 框随插值移动 = 动画确在进行的证据），
 * A 层 deps 不含 derived / animBoxes / centerPreview → **零新增调用**
 * （成功标准：动画期不再每帧 walk(contentRoot)）。基线（单 memo）会在动画的每个
 * rAF 帧重跑成员公式 → 计数随帧增长（先红）。
 *
 * 为什么计数可靠：动画期无中心拖拽（centerPreview 恒 null）→ `containedMemberIds`
 * 的调用**只可能**来自 A 层；计数稳定 ⇔ A 层未重算。
 */
import { describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import {
  layoutForest,
  makeTextNode,
  type EditableNode,
  type LayoutResult,
} from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView } from '../src/render/MapView.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';
import { NODE_ANIM_MS } from '../src/render/motion.js';
import { SECTION_PADDING } from '../src/render/sectionFrames.js';

/** 成员公式调用计数（vi.mock 工厂懒执行时读取，引用安全；与 mapview-pan-memo 同款惯例） */
let containedCalls = 0;

vi.mock('../src/render/islandNesting.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/islandNesting.js')>();
  return {
    ...actual,
    containedMemberIds: (...args: Parameters<typeof actual.containedMemberIds>) => {
      containedCalls++;
      return actual.containedMemberIds(...args);
    },
  };
});

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

/** 文档：R ── C（含 c1）── other；C 升格中心 + 挂 Section（cid 锚）。 */
function fixture() {
  const c1 = makeTextNode('c1');
  const c: EditableNode = { ...makeTextNode('C 岛', [c1]), note: { cid: 'c7' } };
  const other = makeTextNode('other');
  const root: EditableNode = {
    ...makeTextNode('根', [c, other]),
    note: {
      sections: [{ id: 'sec_c', title: '摩擦分析', root: 'cid:c7', color: 'blue' }],
      centers: [{ at: 'node:R/C', cid: 'c7', dir: 'right', x: 40, y: 0 }],
    },
  };
  const layoutRoot: EditableNode = { ...root, children: [other] };
  const layoutOf = (dx: number, dy: number): LayoutResult =>
    layoutForest(
      [
        { node: layoutRoot, dir: 'right', pos: { x: 0, y: 0 } },
        { node: c, dir: 'right', pos: { x: 40 + dx, y: dy } },
      ],
      createNodeMeasure(char, new Map()),
      new Set(),
    );
  // 位移保持小步：jsdom 视口 1×1，Section 帧走 isBoxInView 自裁剪（CULL_MARGIN 128），
  // 收尾帧必须仍与可见世界矩形相交，否则断言会读到「被裁掉的空帧」。
  return { layout1: layoutOf(0, 0), layout2: layoutOf(40, 30), root, c, c1Id: c1.id, otherId: other.id };
}

const flushFrames = (): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 80));
  });

describe('FE-FRAME-1.1：Section 成员清单（A）与取盒建帧（B）分层 memo', () => {
  it('布局动画期：框逐帧跟 animBoxes 移动，A 层成员公式零新增调用', async () => {
    const f = fixture();
    const centerIds = new Set([f.c.id]);
    const members = new Map<string, string[]>([
      [f.root.id, [f.root.id, f.otherId]],
      [f.c.id, [f.c.id, f.c1Id]],
    ]);
    const view = (layout: LayoutResult) => (
      <ThemeProvider>
        <MapView
          layout={layout}
          documentRoot={f.root}
          entities={new Map()}
          char={char}
          centerIds={centerIds}
          islandMembers={members}
        />
      </ThemeProvider>
    );
    const { container, rerender } = render(view(f.layout1));
    await flushFrames();

    const frameX = (): number => {
      const rect = container.querySelector('g[data-section-id="sec_c"] rect');
      if (!rect) throw new Error('fixture broken: sec_c frame missing');
      return Number(rect.getAttribute('x'));
    };
    /** 成员徽标（标题栏第 2 个 text；第 1 = 标题、第 3 = 折叠钮） */
    const badge = (): string => {
      const texts = container.querySelectorAll(
        'g[data-section-id="sec_c"] g[data-section-titlebar] > text',
      );
      return texts[1]?.textContent ?? '';
    };

    // 夹具有效性：帧已建 + 成员公式已执行过（计数基线 > 0）+ 成员数 = [C, c1]
    expect(frameX()).not.toBeNaN();
    expect(containedCalls).toBeGreaterThan(0);
    expect(badge()).toBe('2');
    const x0 = frameX();

    // 布局变化 → 节点位置过渡：动画期 B 层逐帧重算，A 层必须零重算
    const before = containedCalls;
    rerender(view(f.layout2));
    await act(async () => {
      await new Promise((r) => setTimeout(r, NODE_ANIM_MS * 0.35));
    });

    // B 层在跟 animBoxes：框已随动画移动（且尚未落位终点 —— 动画确在途中）
    expect(frameX()).not.toBe(x0);
    // 行为测：动画中途成员口径不变
    expect(badge()).toBe('2');
    // A 层零重算：动画期成员公式零新增调用（基线 = 每帧重跑 → 计数增长）
    expect(containedCalls).toBe(before);

    // 动画收尾：框落位最终坐标（min(C, c1).x − padding；c1 在 C 右侧 → 即 c.box.x − pad）
    await act(async () => {
      await new Promise((r) => setTimeout(r, NODE_ANIM_MS));
    });
    const cBox = f.layout2.nodes.find((ln) => ln.node.id === f.c.id)?.box;
    expect(cBox).toBeDefined();
    expect(frameX()).toBeCloseTo(cBox!.x - SECTION_PADDING, 1);
    expect(containedCalls).toBe(before);
  });
});
