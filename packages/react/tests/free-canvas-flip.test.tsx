// @vitest-environment jsdom
/**
 * FC-C 验收钉（派遣计划 §FC-C）：
 * - 无 back → 无翻面钮
 * - addBack 后可翻，data-flip-state / rotateY 可见
 * - 内存态 round-trip：toggle 后 face 仍为 back
 * - 双击编辑当前面；失焦 / Shift+Enter 提交
 */
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import {
  createEmptyDocument,
  createNativePlacement,
  parseCanvasDocument,
  serializeCanvasDocument,
  type Face,
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

/** 一张卡；withBack 时附加背面槽位 */
function docWithCard(opts?: { withBack?: boolean; face?: Face }): McCanvasDocument {
  const doc = createEmptyDocument('t');
  const card = createNativePlacement({ shell: 'sticky-classic', x: 20, y: 20 });
  if (opts?.withBack === true) {
    card.back = { contentKind: 'markdown', body: '背面原文' };
  }
  if (opts?.face !== undefined) {
    card.face = opts.face;
  }
  return { ...doc, placements: [card] };
}

const menuItemByText = (c: HTMLElement, text: string): HTMLElement | undefined =>
  Array.from(c.querySelectorAll('[data-menu-item]')).find(
    (el) => el.textContent?.includes(text) === true,
  ) as HTMLElement | undefined;

describe('FreeCanvasView（FC-C 整卡 3D 翻面 + 添加背面 + 面编辑）', () => {
  it('无 back → 无翻面钮；右键「添加背面」→ face=back + 翻面钮出现 + 进入背面编辑', () => {
    const seen: McCanvasDocument[] = [];
    const { container } = render(<Harness initial={docWithCard()} onDoc={(d) => seen.push(d)} />);
    expect(container.querySelector('[data-fc-flip]')).toBeNull();

    const card = container.querySelector('[data-fc-card]') as HTMLElement;
    fireEvent.contextMenu(card, { clientX: 100, clientY: 100 });
    const add = menuItemByText(container, '添加背面');
    expect(add).toBeDefined();
    fireEvent.click(add as HTMLElement);

    const p = seen.at(-1)?.placements[0];
    expect(p?.face).toBe('back');
    expect(p?.back).toBeDefined();
    expect(container.querySelector('[data-fc-flip]')).not.toBeNull();
    // 「添加背面」→ 自动进入背面编辑
    expect(container.querySelector('[data-fc-editor]')).not.toBeNull();
  });

  it('悬停才显示翻面钮（opacity 0 → 1）', () => {
    const { container } = render(<Harness initial={docWithCard({ withBack: true })} />);
    const card = container.querySelector('[data-fc-card]') as HTMLElement;
    expect((container.querySelector('[data-fc-flip]') as HTMLElement).style.opacity).toBe('0');
    fireEvent.mouseEnter(card);
    expect((container.querySelector('[data-fc-flip]') as HTMLElement).style.opacity).toBe('1');
  });

  it('翻面：data-flip-state 与 rotateY 同步；face 经 round-trip 保留', () => {
    const seen: McCanvasDocument[] = [];
    const { container } = render(
      <Harness initial={docWithCard({ withBack: true, face: 'back' })} onDoc={(d) => seen.push(d)} />,
    );
    const card = container.querySelector('[data-fc-card]') as HTMLElement;
    const stage = container.querySelector('[data-fc-flip-stage]') as HTMLElement;
    expect(card.getAttribute('data-flip-state')).toBe('back');
    expect(stage.style.transform).toContain('rotateY(180deg)');

    fireEvent.mouseEnter(card);
    fireEvent.click(container.querySelector('[data-fc-flip]') as HTMLElement);
    expect(seen.at(-1)?.placements[0]?.face).toBe('front');
    expect(card.getAttribute('data-flip-state')).toBe('front');
    expect(stage.style.transform).toContain('rotateY(0deg)');

    // 内存态回放：face 持久化于文档
    const last = seen.at(-1) ?? docWithCard();
    const rt = parseCanvasDocument(serializeCanvasDocument(last));
    expect(rt.placements[0]?.face).toBe('front');
    expect(rt.placements[0]?.back?.body).toBe('背面原文');
  });

  it('双击进入当前面编辑 → 失焦提交（保持 contentKind）', () => {
    const seen: McCanvasDocument[] = [];
    const { container } = render(<Harness initial={docWithCard()} onDoc={(d) => seen.push(d)} />);
    const card = container.querySelector('[data-fc-card]') as HTMLElement;
    fireEvent.doubleClick(card);
    const ta = container.querySelector('[data-fc-editor]') as HTMLTextAreaElement;
    expect(ta).not.toBeNull();
    ta.value = '改后的正面';
    fireEvent.blur(ta);
    const front = seen.at(-1)?.placements[0]?.front;
    expect(front?.contentKind).toBe('markdown');
    expect(front?.contentKind === 'markdown' ? front.body : '').toBe('改后的正面');
    expect(container.querySelector('[data-fc-editor]')).toBeNull();
  });

  it('背面编辑 Shift+Enter 提交（写 patchBack）', () => {
    const seen: McCanvasDocument[] = [];
    const { container } = render(
      <Harness initial={docWithCard({ withBack: true, face: 'back' })} onDoc={(d) => seen.push(d)} />,
    );
    const card = container.querySelector('[data-fc-card]') as HTMLElement;
    fireEvent.doubleClick(card); // 当前面 = back
    const ta = container.querySelector('[data-fc-editor]') as HTMLTextAreaElement;
    ta.value = '背面新文案';
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true });
    expect(seen.at(-1)?.placements[0]?.back?.body).toBe('背面新文案');
  });
});
