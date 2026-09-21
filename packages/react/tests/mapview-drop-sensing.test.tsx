// @vitest-environment jsdom
/**
 * FA2-T3：画布拖拽落点智能感知。
 *
 * 分两层测：
 *  ① **纯几何判定**（`senseDropTarget`）—— 穷举五个区域的边界，这是逻辑正确性的根；
 *  ② **MapView 集成** —— 拖到节点上真的会带落点语义回调上层，且松手前有可视预览。
 *
 * 只测纯几何是不够的：出现过「判定对了但没接到 drop 事件」这类接线问题，
 * 所以两层都锁。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { astToEditable, layoutMindmap, makeTextNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView } from '../src/render/MapView.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';
import {
  BRANCH_STUB,
  branchStubOf,
  dropGlyph,
  dropHint,
  HIT_PAD,
  insideBox,
  mediaBandOf,
  MEDIA_BAND,
  senseDropTarget,
  senseInsideBox,
  type DropBox,
} from '../src/render/dropSensing.js';

afterEach(cleanup);

const BOX: DropBox = { x: 100, y: 200, w: 160, h: 60 };
const NODES = [{ id: 'n1', box: BOX }];

describe('落点判定：纯几何', () => {
  it('中心（文本核心）→ icon', () => {
    expect(senseInsideBox(BOX, { x: 150, y: 230 })).toBe('icon');
  });

  it('上边缘带 → media', () => {
    expect(senseInsideBox(BOX, { x: 150, y: BOX.y + 5 })).toBe('media');
  });

  it('下边缘带 → media', () => {
    expect(senseInsideBox(BOX, { x: 150, y: BOX.y + BOX.h - 5 })).toBe('media');
  });

  it('右侧连接桩 → child', () => {
    expect(senseInsideBox(BOX, { x: BOX.x + BOX.w - 5, y: 230 })).toBe('child');
  });

  it('上下带优先于右侧桩（右上角那块应算插图，符合从上往下拖的直觉）', () => {
    expect(senseInsideBox(BOX, { x: BOX.x + BOX.w - 2, y: BOX.y + 2 })).toBe('media');
  });

  it('边界值：恰好落在 media 带厚度上仍算 media（<=）', () => {
    expect(senseInsideBox(BOX, { x: 150, y: BOX.y + MEDIA_BAND })).toBe('media');
  });

  it('边界值：刚过 media 带 → icon（不重叠、不遗漏）', () => {
    expect(senseInsideBox(BOX, { x: 150, y: BOX.y + MEDIA_BAND + 1 })).toBe('icon');
  });

  it('右侧桩边界：距右缘 BRANCH_STUB 处开始算 child', () => {
    const at = BOX.x + BOX.w - BRANCH_STUB;
    expect(senseInsideBox(BOX, { x: at, y: 230 })).toBe('child');
    expect(senseInsideBox(BOX, { x: at - 1, y: 230 })).toBe('icon');
  });

  it('最小高度节点（34px）仍有文本核心 —— 边缘带按 30% 收窄，不会吃掉整个盒子', () => {
    const tiny: DropBox = { x: 0, y: 0, w: 80, h: 34 };
    expect(senseInsideBox(tiny, { x: 40, y: 17 })).toBe('icon');
    expect(senseInsideBox(tiny, { x: 40, y: 2 })).toBe('media');
    expect(senseInsideBox(tiny, { x: 40, y: 32 })).toBe('media');
  });

  it('边缘带随盒子高度自适应（大节点仍是完整 18px）', () => {
    expect(mediaBandOf(34)).toBeCloseTo(10.2, 1);
    expect(mediaBandOf(96)).toBe(MEDIA_BAND);
    expect(branchStubOf(60)).toBe(18);
    expect(branchStubOf(200)).toBe(BRANCH_STUB);
  });

  it('命中盒判定含外宽容差（手感不至于太苛刻）', () => {
    expect(insideBox(BOX, { x: BOX.x - HIT_PAD, y: 230 })).toBe(true);
    expect(insideBox(BOX, { x: BOX.x - HIT_PAD - 1, y: 230 })).toBe(false);
  });

  it('空白画布 → free（nodeId 为 null）', () => {
    expect(senseDropTarget(NODES, { x: 900, y: 900 })).toEqual({ action: 'free', nodeId: null });
  });

  it('命中节点 → 带 nodeId', () => {
    expect(senseDropTarget(NODES, { x: 150, y: 230 })).toEqual({ action: 'icon', nodeId: 'n1' });
  });

  it('多个节点重叠 → 取后绘制的（数组末位优先）', () => {
    const overlapping = [
      { id: 'under', box: BOX },
      { id: 'over', box: { ...BOX, x: BOX.x + 20 } },
    ];
    expect(senseDropTarget(overlapping, { x: BOX.x + 100, y: 230 }).nodeId).toBe('over');
  });

  it('提示文案与图标齐全（四种语义都有）', () => {
    for (const a of ['icon', 'media', 'child', 'free'] as const) {
      expect(dropHint(a).length).toBeGreaterThan(0);
      expect(dropGlyph(a).length).toBeGreaterThan(0);
    }
    expect(dropHint('icon')).toBe('设为节点图标');
    expect(dropHint('media')).toBe('嵌入卡片插图');
    expect(dropHint('child')).toBe('添加子分支');
    expect(dropHint('free')).toBe('新建自由节点');
  });
});

// ---------------------------------------------------------------- MapView 集成

function mapLayout() {
  const root = makeTextNode('根', [makeTextNode('子节点')]);
  const editable = astToEditable(root)!;
  const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
  return { layout: layoutMindmap(editable, createNodeMeasure(char, new Map()), new Set()), char };
}

/** 构造带 Files 的拖放事件 */
function dragEventWithFiles(type: string, clientX: number, clientY: number) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    clientX: number;
    clientY: number;
    dataTransfer: { types: string[]; files: File[]; getData: () => string };
  };
  Object.defineProperty(event, 'clientX', { value: clientX });
  Object.defineProperty(event, 'clientY', { value: clientY });
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      types: ['Files'],
      files: [new File(['<svg/>'], 'star.svg', { type: 'image/svg+xml' })],
      getData: () => '',
    },
  });
  return event;
}

describe('MapView 集成：拖放落点', () => {
  it('拖到节点文本核心 → 回调带 icon 语义', () => {
    const { layout, char } = mapLayout();
    const onAssetDrop = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} onAssetDrop={onAssetDrop} />
      </ThemeProvider>,
    );
    // 取一个真实节点的世界坐标 → 转成屏幕坐标（视口默认 1:1，直接用盒中心）
    const target = layout.nodes[1] ?? layout.nodes[0];
    if (!target) throw new Error('没有节点');
    const surface = container.querySelector('[style*="touch-action"]');
    if (!surface) throw new Error('找不到画布接收层');

    const cx = target.box.x + target.box.w / 2;
    const cy = target.box.y + target.box.h / 2;
    fireEvent(
      surface,
      dragEventWithFiles('dragover', cx, cy),
    );
    fireEvent(surface, dragEventWithFiles('drop', cx, cy));

    expect(onAssetDrop).toHaveBeenCalledTimes(1);
    const [files, target2] = onAssetDrop.mock.calls[0] as [
      File[],
      { action: string; nodeId: string | null },
    ];
    expect(files.length).toBe(1);
    expect(target2.action).toBe('icon');
    expect(target2.nodeId).toBe(target.node.id);
  });

  it('拖到空白 → 回调带 free 语义', () => {
    const { layout, char } = mapLayout();
    const onAssetDrop = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} onAssetDrop={onAssetDrop} />
      </ThemeProvider>,
    );
    const surface = container.querySelector('[style*="touch-action"]');
    if (!surface) throw new Error('找不到画布接收层');
    // jsdom 里容器 rect 为 0 → 屏幕坐标即世界坐标；取远离所有节点的一点
    fireEvent(surface, dragEventWithFiles('drop', 5000, 5000));
    const [, t] = onAssetDrop.mock.calls[0] as [File[], { action: string; nodeId: string | null }];
    expect(t.action).toBe('free');
    expect(t.nodeId).toBeNull();
  });

  it('dragover 时出现落点预览浮层（松手前可预知结果）', () => {
    const { layout, char } = mapLayout();
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} onAssetDrop={vi.fn()} />
      </ThemeProvider>,
    );
    const surface = container.querySelector('[style*="touch-action"]');
    if (!surface) throw new Error('找不到画布接收层');
    const target = layout.nodes[1] ?? layout.nodes[0];
    if (!target) throw new Error('没有节点');
    fireEvent(
      surface,
      dragEventWithFiles('dragover', target.box.x + target.box.w / 2, target.box.y + target.box.h / 2),
    );
    const preview = container.querySelector('[data-drop-preview]');
    expect(preview).not.toBeNull();
    expect(preview?.getAttribute('data-drop-action')).toBe('icon');
    expect(preview?.textContent).toContain('设为节点图标');
  });

  it('drop 后预览浮层消失（不残留）', () => {
    const { layout, char } = mapLayout();
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} onAssetDrop={vi.fn()} />
      </ThemeProvider>,
    );
    const surface = container.querySelector('[style*="touch-action"]');
    if (!surface) throw new Error('找不到画布接收层');
    fireEvent(surface, dragEventWithFiles('dragover', 40, 40));
    expect(container.querySelector('[data-drop-preview]')).not.toBeNull();
    fireEvent(surface, dragEventWithFiles('drop', 40, 40));
    expect(container.querySelector('[data-drop-preview]')).toBeNull();
  });

  it('未传 onAssetDrop → 退回 onAssetFiles（老调用方零破坏）', () => {
    const { layout, char } = mapLayout();
    const onAssetFiles = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} onAssetFiles={onAssetFiles} />
      </ThemeProvider>,
    );
    const surface = container.querySelector('[style*="touch-action"]');
    if (!surface) throw new Error('找不到画布接收层');
    fireEvent(surface, dragEventWithFiles('drop', 40, 40));
    expect(onAssetFiles).toHaveBeenCalledTimes(1);
  });
});
