// @vitest-environment jsdom
/**
 * R4-2：边反向（数据层反转 + reverseOf 接线）。
 *
 * 契约：
 * - 交换 from/to；rel 三态：成对反向 → reverseOf 换名；对称 → 不变；未注册 →
 *   不变 + message（宿主走 commandNotice 通道，R4-A2）
 * - 渲染端保形：manual.from/to 交换 + routingSide 翻转（锚点保位，同 R3-3 问题域）
 * - 与 dir 正交：反向不改 dir（back 边反向后仍是 back）
 * - 一次 undo 全回滚（单补丁单写，唯一写路径 useEdgeActions）
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { astToEditable, makeTextNode, layoutMindmap } from '@mindcanvas/kernel';
import { EditorController, ThemeProvider, MapView, createCharMeasure, createNodeMeasure } from '@mindcanvas/react';
import { useEdgeActions } from '../src/hooks/useEdgeActions.js';

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 16) as unknown as number,
  );
  vi.stubGlobal('cancelAnimationFrame', (h: number) => {
    clearTimeout(h);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const MANUAL = { from: { x: 1, y: 0.5 }, to: { x: 0, y: 0.5 }, curvature: 0.25 };
const MANUAL_SWAPPED = { from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 }, curvature: 0.25 };

interface Combo {
  relName: string;
  rel: string;
  expectRel: string;
  relChanged: boolean;
  message: boolean;
}

const relCases: Combo[] = [
  { relName: '成对反向', rel: 'causes', expectRel: 'isCausedBy', relChanged: true, message: false },
  { relName: '对称', rel: 'relates-to', expectRel: 'relates-to', relChanged: false, message: false },
  {
    relName: '未注册',
    rel: 'weird-rel',
    expectRel: 'weird-rel',
    relChanged: false,
    message: true,
  },
];

function buildController(rel: string, dir: 'fwd' | 'back' | 'both', withManual: boolean): EditorController {
  const built = astToEditable(makeTextNode('根', [makeTextNode('任务'), makeTextNode('生活')]));
  if (built === null) throw new Error('fixture broken');
  built.note = {
    edges: [
      {
        from: 'node:根/任务',
        to: 'node:根/生活',
        rel,
        dir,
        ...(withManual ? { manual: MANUAL } : {}),
        routingSide: 'left',
      },
    ],
  };
  return new EditorController(built);
}

function rawEdge(controller: EditorController): Record<string, unknown> {
  const raw = controller.root.note?.edges;
  if (!Array.isArray(raw) || raw.length !== 1) throw new Error('fixture broken');
  return raw[0] as Record<string, unknown>;
}

describe('reverseEdge：rel 三态 × dir 三态 × manual 有无（R4-2，12 组合）', () => {
  for (const rc of relCases) {
    for (const dir of ['fwd', 'back', 'both'] as const) {
      for (const withManual of [false, true]) {
        it(`${rc.relName} × dir=${dir} × manual=${withManual}`, () => {
          const controller = buildController(rc.rel, dir, withManual);
          const { result } = renderHook(() => useEdgeActions(controller));

          let info: { relChanged: boolean; message?: string } | undefined;
          act(() => {
            info = result.current.reverseEdge(0);
          });

          const e = rawEdge(controller);
          // 数据层反转：from/to 交换
          expect(e.from).toBe('node:根/生活');
          expect(e.to).toBe('node:根/任务');
          // rel 三态
          expect(e.rel).toBe(rc.expectRel);
          expect(info?.relChanged).toBe(rc.relChanged);
          expect((info?.message ?? '') !== '').toBe(rc.message);
          // 与 dir 正交：反向不改 dir
          expect(e.dir).toBe(dir);
          // 渲染端保形：manual 交换（有则）/ routingSide 翻转
          if (withManual) expect(e.manual).toEqual(MANUAL_SWAPPED);
          else expect('manual' in e).toBe(false);
          expect(e.routingSide).toBe('right');
          // 一次 undo 全回滚
          expect(controller.undo()).toBe(true);
          const restored = rawEdge(controller);
          expect(restored.from).toBe('node:根/任务');
          expect(restored.to).toBe('node:根/生活');
          expect(restored.rel).toBe(rc.rel);
          expect(restored.dir).toBe(dir);
          if (withManual) expect(restored.manual).toEqual(MANUAL);
          expect(restored.routingSide).toBe('left');
        });
      }
    }
  }

  it('端点保位：manual 边反向后渲染 d 起终点互换（把手不跳，R3-3 同款断言风格）', () => {
    const controller = buildController('causes', 'fwd', true);
    const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

    function renderedEnds(): { start: string; end: string } {
      const layout = layoutMindmap(controller.root, createNodeMeasure(char, new Map()), new Set());
      const screen = render(
        <ThemeProvider>
          <MapView layout={layout} documentRoot={controller.root} entities={new Map()} char={char} />
        </ThemeProvider>,
      );
      const g = screen.container.querySelector('[data-free-edge]');
      if (g === null) throw new Error('edge not rendered');
      const visible = [...g.querySelectorAll('path')].find(
        (p) => p.getAttribute('stroke') !== 'transparent',
      );
      if (visible === null) throw new Error('visible path not found');
      const nums = (visible.getAttribute('d') ?? '').match(/-?[\d.]+/g) ?? [];
      if (nums.length < 4) throw new Error('bad d');
      const ends = {
        start: `${nums[0]} ${nums[1]}`,
        end: `${nums[nums.length - 2]} ${nums[nums.length - 1]}`,
      };
      screen.unmount();
      return ends;
    }

    const before = renderedEnds();
    const { result } = renderHook(() => useEdgeActions(controller));
    act(() => {
      result.current.reverseEdge(0);
    });
    const after = renderedEnds();
    expect(after.start).toBe(before.end);
    expect(after.end).toBe(before.start);
  });
});
