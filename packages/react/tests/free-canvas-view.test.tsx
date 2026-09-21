// @vitest-environment jsdom
/**
 * FC-B 验收钉（派遣计划 §FC-B）：
 * - 空文档 → 点工具 → 点空白 → DOM 出现 data-fc-card ×1
 * - 拖后 doc.placements[0].transform 变化
 * - Delete 删卡；pan/zoom 写 viewport
 */
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import {
  createEmptyDocument,
  createNativePlacement,
  type McCanvasDocument,
} from '@mindcanvas/free-canvas';
import { FreeCanvasView } from '../src/free-canvas/FreeCanvasView.js';

function Harness({
  initial,
  onDoc,
}: {
  initial?: McCanvasDocument;
  onDoc?: (doc: McCanvasDocument) => void;
}) {
  const [doc, setDoc] = useState<McCanvasDocument>(() => initial ?? createEmptyDocument('测试画布'));
  return (
    <FreeCanvasView
      doc={doc}
      onChange={(d) => {
        setDoc(d);
        onDoc?.(d);
      }}
      style={{ width: 800, height: 600 }}
    />
  );
}

function docWithOneCard(): McCanvasDocument {
  const doc = createEmptyDocument('t');
  const card = createNativePlacement({ shell: 'sticky-classic', x: 40, y: 30 });
  return { ...doc, placements: [card] };
}

const host = (c: HTMLElement) => c.querySelector('[data-fc-host]') as HTMLElement;

describe('FreeCanvasView（FC-B 视口 + 两壳落卡 + 拖移/删除）', () => {
  it('便签工具 → 点空白 → data-fc-card ×1（sticky-classic）', () => {
    const seen: McCanvasDocument[] = [];
    const { container } = render(<Harness onDoc={(d) => seen.push(d)} />);
    fireEvent.click(container.querySelector('[data-fc-tool="sticky"]') as HTMLElement);
    fireEvent.click(host(container), { clientX: 120, clientY: 90 });
    const cards = container.querySelectorAll('[data-fc-card]');
    expect(cards).toHaveLength(1);
    expect(cards[0]?.getAttribute('data-fc-shell')).toBe('sticky-classic');
    expect(seen.at(-1)?.placements).toHaveLength(1);
    // 落卡后工具回到选择
    expect(container.querySelector('[data-fc-tool="sticky"]')?.getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('面板工具 → 落 card-panel 壳', () => {
    const { container } = render(<Harness />);
    fireEvent.click(container.querySelector('[data-fc-tool="panel"]') as HTMLElement);
    fireEvent.click(host(container), { clientX: 10, clientY: 10 });
    expect(container.querySelectorAll('[data-fc-card]')).toHaveLength(1);
    expect(container.querySelector('[data-fc-card]')?.getAttribute('data-fc-shell')).toBe(
      'card-panel',
    );
  });

  it('拖卡 → onChange 携带新 transform（movePlacement 世界坐标）', () => {
    const seen: McCanvasDocument[] = [];
    const { container } = render(
      <Harness initial={docWithOneCard()} onDoc={(d) => seen.push(d)} />,
    );
    const card = container.querySelector('[data-fc-card]') as HTMLElement;
    fireEvent.pointerDown(card, {
      pointerId: 7,
      button: 0,
      clientX: 50,
      clientY: 50,
      bubbles: true,
    });
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 130, clientY: 110, bubbles: true });
    fireEvent.pointerUp(window, { pointerId: 7, clientX: 130, clientY: 110, bubbles: true });
    const p = seen.at(-1)?.placements[0];
    expect(p?.transform.x).toBeCloseTo(40 + 80, 5);
    expect(p?.transform.y).toBeCloseTo(30 + 60, 5);
    expect(card.style.left).toBe('120px');
  });

  it('选中后 Delete 删卡（placements 清空）', () => {
    const seen: McCanvasDocument[] = [];
    const { container } = render(
      <Harness initial={docWithOneCard()} onDoc={(d) => seen.push(d)} />,
    );
    const card = container.querySelector('[data-fc-card]') as HTMLElement;
    fireEvent.pointerDown(card, {
      pointerId: 8,
      button: 0,
      clientX: 50,
      clientY: 50,
      bubbles: true,
    });
    fireEvent.pointerUp(window, { pointerId: 8, clientX: 50, clientY: 50, bubbles: true });
    fireEvent.keyDown(host(container), { key: 'Delete' });
    expect(seen.at(-1)?.placements).toHaveLength(0);
    expect(container.querySelectorAll('[data-fc-card]')).toHaveLength(0);
  });

  it('空白拖拽 → pan；滚轮 → zoom（viewport 写入 doc）', () => {
    const seen: McCanvasDocument[] = [];
    const { container } = render(<Harness onDoc={(d) => seen.push(d)} />);
    const h = host(container);
    fireEvent.pointerDown(h, { pointerId: 9, button: 0, clientX: 10, clientY: 10, bubbles: true });
    fireEvent.pointerMove(window, { pointerId: 9, clientX: 60, clientY: 40, bubbles: true });
    fireEvent.pointerUp(window, { pointerId: 9, clientX: 60, clientY: 40, bubbles: true });
    expect(seen.at(-1)?.viewport.panX).toBeCloseTo(50, 5);
    expect(seen.at(-1)?.viewport.panY).toBeCloseTo(30, 5);

    fireEvent.wheel(h, { deltaY: -200, clientX: 400, clientY: 300 });
    expect(seen.at(-1)?.viewport.scale).toBeGreaterThan(1);
  });
});
