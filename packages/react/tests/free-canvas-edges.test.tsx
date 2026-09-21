// @vitest-environment jsdom
/**
 * FC-D 验收钉（派遣计划 §FC-D）：
 * - connect 工具：从卡 A 拖到卡 B → addEdge（SVG 直线出现）
 * - 选中边 + Delete 删边
 * - 边绘制随卡拖移（transform）更新
 * - 删卡级联删边（模型层已测，此处端到端复验）
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

/** 两张卡：A(20,20) sticky / B(260,20) panel */
function docWithTwoCards(): McCanvasDocument {
  const doc = createEmptyDocument('t');
  const a = createNativePlacement({ shell: 'sticky-classic', x: 20, y: 20 });
  const b = createNativePlacement({ shell: 'card-panel', x: 260, y: 20 });
  return { ...doc, placements: [a, b] };
}

const host = (c: HTMLElement) => c.querySelector('[data-fc-host]') as HTMLElement;
const tool = (c: HTMLElement, id: string) =>
  c.querySelector(`[data-fc-tool="${id}"]`) as HTMLElement;
const cards = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('[data-fc-card]')) as HTMLElement[];

/** connect：从 a 拖到 b 松手 */
function connect(a: HTMLElement, b: HTMLElement, pointerId = 11) {
  const aRect = a.getBoundingClientRect();
  fireEvent.pointerDown(a, {
    pointerId,
    button: 0,
    clientX: aRect.left + 10,
    clientY: aRect.top + 10,
    bubbles: true,
  });
  fireEvent.pointerMove(window, { pointerId, clientX: 300, clientY: 100, bubbles: true });
  fireEvent.pointerUp(b, { pointerId, clientX: 300, clientY: 100, bubbles: true });
}

describe('FreeCanvasView（FC-D 卡间连线）', () => {
  it('connect 工具：卡 A 拖到卡 B → doc.edges ×1 + 出现 data-fc-edge', () => {
    const seen: McCanvasDocument[] = [];
    const { container } = render(
      <Harness initial={docWithTwoCards()} onDoc={(d) => seen.push(d)} />,
    );
    fireEvent.click(tool(container, 'connect'));
    const [a, b] = cards(container);
    connect(a as HTMLElement, b as HTMLElement);

    const edges = seen.at(-1)?.edges;
    expect(edges).toHaveLength(1);
    expect(edges?.[0]?.fromPlacementUuid).toBe(a?.getAttribute('data-fc-uuid'));
    expect(edges?.[0]?.toPlacementUuid).toBe(b?.getAttribute('data-fc-uuid'));
    expect(container.querySelectorAll('[data-fc-edge]')).toHaveLength(1);
  });

  it('连到空白 / 自身 → 不建边', () => {
    const seen: McCanvasDocument[] = [];
    const { container } = render(
      <Harness initial={docWithTwoCards()} onDoc={(d) => seen.push(d)} />,
    );
    fireEvent.click(tool(container, 'connect'));
    const [a] = cards(container);
    connect(a as HTMLElement, host(container)); // 松手目标是宿主空白
    connect(a as HTMLElement, a as HTMLElement); // 自环
    expect(seen.at(-1)?.edges ?? []).toHaveLength(0);
    expect(container.querySelectorAll('[data-fc-edge]')).toHaveLength(0);
  });

  it('点边选中（霓虹高亮）→ Delete 删边', () => {
    const seen: McCanvasDocument[] = [];
    const { container } = render(
      <Harness initial={docWithTwoCards()} onDoc={(d) => seen.push(d)} />,
    );
    fireEvent.click(tool(container, 'connect'));
    const [a, b] = cards(container);
    connect(a as HTMLElement, b as HTMLElement);

    const line = container.querySelector('[data-fc-edge]') as SVGElement;
    fireEvent.click(line);
    expect(line.getAttribute('data-fc-edge-selected')).toBe('true');

    fireEvent.keyDown(host(container), { key: 'Delete' });
    expect(seen.at(-1)?.edges).toHaveLength(0);
    expect(container.querySelectorAll('[data-fc-edge]')).toHaveLength(0);
  });

  it('边随卡拖移更新（端点跟随卡中心的世界坐标）', () => {
    const seen: McCanvasDocument[] = [];
    const { container } = render(
      <Harness initial={docWithTwoCards()} onDoc={(d) => seen.push(d)} />,
    );
    fireEvent.click(tool(container, 'connect'));
    const [a, b] = cards(container);
    connect(a as HTMLElement, b as HTMLElement);

    // 端点世界坐标 = SVG 内坐标 + SVG 原点偏移（包围盒随卡平移，故需还原到世界系）
    const worldX1 = (): number => {
      const svg = container.querySelector('[data-fc-edges]') as SVGElement;
      const ln = container.querySelector('[data-fc-edge]') as SVGElement;
      return parseFloat(ln.getAttribute('x1') ?? '0') + parseFloat(svg.style.left || '0');
    };
    const before = worldX1();

    // 回到选择工具拖卡 A（+100 世界单位）
    fireEvent.click(tool(container, 'select'));
    fireEvent.pointerDown(a as HTMLElement, {
      pointerId: 12,
      button: 0,
      clientX: 30,
      clientY: 30,
      bubbles: true,
    });
    fireEvent.pointerMove(window, { pointerId: 12, clientX: 130, clientY: 30, bubbles: true });
    fireEvent.pointerUp(window, { pointerId: 12, clientX: 130, clientY: 30, bubbles: true });

    expect(seen.at(-1)?.placements[0]?.transform.x).toBeCloseTo(120, 5);
    expect(worldX1()).toBeCloseTo(before + 100, 5);
  });

  it('删卡级联删边（端到端复验）', () => {
    const seen: McCanvasDocument[] = [];
    const { container } = render(
      <Harness initial={docWithTwoCards()} onDoc={(d) => seen.push(d)} />,
    );
    fireEvent.click(tool(container, 'connect'));
    const [a, b] = cards(container);
    connect(a as HTMLElement, b as HTMLElement);
    expect(seen.at(-1)?.edges).toHaveLength(1);

    // 选中卡 A 后 Delete
    fireEvent.click(tool(container, 'select'));
    fireEvent.pointerDown(a as HTMLElement, {
      pointerId: 13,
      button: 0,
      clientX: 30,
      clientY: 30,
      bubbles: true,
    });
    fireEvent.pointerUp(window, { pointerId: 13, clientX: 30, clientY: 30, bubbles: true });
    fireEvent.keyDown(host(container), { key: 'Delete' });

    expect(seen.at(-1)?.placements).toHaveLength(1);
    expect(seen.at(-1)?.edges).toHaveLength(0);
    expect(container.querySelectorAll('[data-fc-edge]')).toHaveLength(0);
  });
});
