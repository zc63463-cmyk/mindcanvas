/**
 * FC-E 验收（派遣计划 §FC-E）：
 * - e2e：新建 → 落两卡 → 添加背面 → 翻面 → 连线 → serialize 含 face/edges → 再 parse 仍背面
 * - App 模式切换：导图 ↔ 自由画布 分 Stage 挂载/卸载（不串 doc 状态）
 * - 「看演示」：demo 含 2 卡 + 1 边 + 一卡已有 back
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parseCanvasDocument,
  serializeCanvasDocument,
  type McCanvasDocument,
} from '@mindcanvas/free-canvas';
import App from '../src/App';
import { FreeCanvasStage } from '../src/FreeCanvasStage';

// 未开 globals：手动 cleanup（同 startup-screen.test.tsx 口径）
afterEach(() => {
  cleanup();
});

// 宿主走独立 localStorage key；逐用例清空避免串扰
beforeEach(() => {
  localStorage.clear();
});

const bySelector = (c: HTMLElement, sel: string) => c.querySelector(sel) as HTMLElement | null;
const must = (c: HTMLElement, sel: string): HTMLElement => {
  const el = bySelector(c, sel);
  if (el === null) throw new Error(`missing: ${sel}`);
  return el;
};
const cards = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('[data-fc-card]')) as HTMLElement[];
const menuItemByText = (c: HTMLElement, text: string): HTMLElement | undefined =>
  Array.from(c.querySelectorAll('[data-menu-item]')).find(
    (el) => el.textContent?.includes(text) === true,
  ) as HTMLElement | undefined;

describe('FreeCanvasStage · e2e（C+1 验收）', () => {
  it('新建 → 两卡 → 添加背面 → 翻面 → 连线 → serialize/parse 保真', () => {
    const seen: McCanvasDocument[] = [];
    const { container } = render(
      <FreeCanvasStage onExit={() => {}} onDocChange={(d) => seen.push(d)} />,
    );

    // 新建（初始即空文档；显式点一次「新建」走产品路径）
    fireEvent.click(must(container, '[data-fc-new]'));

    // 落两卡：便签 + 面板
    fireEvent.click(must(container, '[data-fc-tool="sticky"]'));
    fireEvent.click(must(container, '[data-fc-host]'), { clientX: 120, clientY: 120 });
    fireEvent.click(must(container, '[data-fc-tool="panel"]'));
    fireEvent.click(must(container, '[data-fc-host]'), { clientX: 420, clientY: 220 });
    expect(cards(container)).toHaveLength(2);

    // 添加背面（右键菜单）→ 自动进入背面编辑 → 失焦提交
    const c0 = cards(container)[0] as HTMLElement;
    fireEvent.contextMenu(c0, { clientX: 130, clientY: 130 });
    const add = menuItemByText(container, '添加背面');
    expect(add).toBeDefined();
    fireEvent.click(add as HTMLElement);
    const ta = bySelector(container, '[data-fc-editor]') as HTMLTextAreaElement | null;
    expect(ta).not.toBeNull();
    if (ta !== null) {
      ta.value = '背面：来自 e2e';
      fireEvent.blur(ta);
    }

    // 翻面：back → ⟳ → front → ⟳ → back
    const card0 = cards(container)[0] as HTMLElement;
    expect(card0.getAttribute('data-flip-state')).toBe('back');
    fireEvent.mouseEnter(card0);
    fireEvent.click(must(container, '[data-fc-flip]'));
    expect(cards(container)[0]?.getAttribute('data-flip-state')).toBe('front');
    fireEvent.click(must(container, '[data-fc-flip]'));
    expect(cards(container)[0]?.getAttribute('data-flip-state')).toBe('back');

    // 连线：connect 工具，从卡 A 拖到卡 B
    fireEvent.click(must(container, '[data-fc-tool="connect"]'));
    const [a, b] = cards(container);
    fireEvent.pointerDown(a as HTMLElement, {
      pointerId: 21,
      button: 0,
      clientX: 150,
      clientY: 150,
      bubbles: true,
    });
    fireEvent.pointerMove(window, { pointerId: 21, clientX: 430, clientY: 240, bubbles: true });
    fireEvent.pointerUp(b as HTMLElement, {
      pointerId: 21,
      clientX: 430,
      clientY: 240,
      bubbles: true,
    });
    expect(container.querySelectorAll('[data-fc-edge]')).toHaveLength(1);

    // 序列化 → 再解析：face / back / edges 保真
    const last = seen.at(-1);
    expect(last).toBeDefined();
    const rt = parseCanvasDocument(serializeCanvasDocument(last as McCanvasDocument));
    expect(rt.edges).toHaveLength(1);
    expect(rt.placements[0]?.face).toBe('back');
    expect(rt.placements[0]?.back?.body).toBe('背面：来自 e2e');
  });

  it('看演示：demo 含 2 卡 + 1 边 + 一卡已有背（可翻）', () => {
    const seen: McCanvasDocument[] = [];
    const { container } = render(
      <FreeCanvasStage onExit={() => {}} onDocChange={(d) => seen.push(d)} />,
    );
    fireEvent.click(must(container, '[data-fc-demo]'));
    expect(cards(container)).toHaveLength(2);
    expect(container.querySelectorAll('[data-fc-edge]')).toHaveLength(1);
    const withBack = cards(container).filter((c) => c.querySelector('[data-fc-flip]') !== null);
    expect(withBack).toHaveLength(1);
    expect(seen.at(-1)?.placements).toHaveLength(2);
    expect(seen.at(-1)?.edges).toHaveLength(1);
  });
});

describe('App · 模式切换（分 Stage 挂载/卸载）', () => {
  it('导图 → 自由画布 → 导图：Stage 互斥挂载', () => {
    const { container } = render(<App />);
    // 导图模式：常驻浮标入口存在
    expect(bySelector(container, '[data-app-freecanvas]')).not.toBeNull();
    expect(bySelector(container, '[data-fc-stage]')).toBeNull();

    fireEvent.click(must(container, '[data-app-freecanvas]'));
    expect(bySelector(container, '[data-fc-stage]')).not.toBeNull();
    expect(bySelector(container, '[data-app-freecanvas]')).toBeNull();

    fireEvent.click(must(container, '[data-fc-exit]'));
    expect(bySelector(container, '[data-fc-stage]')).toBeNull();
    expect(bySelector(container, '[data-app-freecanvas]')).not.toBeNull();
  });
});
