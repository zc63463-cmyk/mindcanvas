// @vitest-environment jsdom
/**
 * P1 收尾 T1：翻卡态提升宿主（NotePopover 受控/非受控双模 + MapView 受控透传）。
 *
 * 判别：
 *   ① 受控驱动：flippedNoteIds 含某面板 id → 该面板出示背面、其它面板不受影响；
 *   ② 按钮回传：点击翻面按钮 → onToggleNoteFlip(id, true) 恰一次（受控下不自翻）；
 *   ③ 卸载重挂保持：面板因 pinnedNoteIds 短暂移除而卸载 → 重挂后仍背面（宿主持态）；
 *   ④ 负向：flippedNoteIds 含不存在 id → 零影响、不崩。
 * 另钉 NotePopover 双模本体：受控（flipped 传入）只回传不自翻 / 非受控（缺省）自翻 = 现行为。
 *
 * 断言口径：FlipCard 两面恒挂载，翻面态以“背面 face 的 rotateY 朝向”判定
 * （不依赖 role/aria 属性面——那属后续批次改动，此处只钉翻卡态数据流）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { astToEditable, layoutMindmap, makeTextNode } from '@mindcanvas/kernel';
import type { RefObject } from 'react';
import type { MapViewApi } from '../src/render/MapView.js';
import { MapView } from '../src/render/MapView.js';
import { NotePopover } from '../src/chrome/NotePopover.js';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { glassToken } from '../src/theme/tokens.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

// MapView 挂载会起 rAF 帧调度器；不卸载会让文件跑完仍挂着句柄（进程不退出）
afterEach(() => cleanup());

/** 两根分支各带 note（md 非空 = 翻面可用）→ 布局 */
function layoutTwoNotes() {
  const root = makeTextNode('根', [makeTextNode('分支 A'), makeTextNode('分支 B')]);
  const editable = astToEditable(root);
  if (editable === null) throw new Error('astToEditable 失败');
  const a = editable.children[0];
  const b = editable.children[1];
  if (a === undefined || b === undefined) throw new Error('夹具分支缺失');
  a.note = { note: ['条目一'], note_text: '正文 A', md: '# 背面 A' };
  b.note = { note: ['条目一'], note_text: '正文 B', md: '# 背面 B' };
  const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
  const layout = layoutMindmap(editable, createNodeMeasure(char, new Map()), new Set());
  return { layout, char, aId: a.id, bId: b.id };
}

type TwoNoteFixture = ReturnType<typeof layoutTwoNotes>;

function renderMap(fx: TwoNoteFixture, over: Partial<React.ComponentProps<typeof MapView>> = {}) {
  const apiRef: RefObject<MapViewApi | null> = { current: null };
  const view = (o: Partial<React.ComponentProps<typeof MapView>>) => (
    <ThemeProvider>
      <MapView layout={fx.layout} entities={new Map()} char={fx.char} apiRef={apiRef} {...o} />
    </ThemeProvider>
  );
  const { container, rerender } = render(view(over));
  return {
    container,
    apiRef,
    rerender: (patch: Partial<React.ComponentProps<typeof MapView>>): void => {
      rerender(view({ ...over, ...patch }));
    },
  };
}

/** 面板内的「面结构」：正面 face = 序列区父级；背面 face = 背文滚动区父级（FlipCard 两面恒挂载） */
function facesOf(pop: HTMLElement): { front: string; back: string } {
  const front = pop.querySelector('[data-note-seq]');
  const back = pop.querySelector('[data-note-back-scroll]');
  if (
    front === null ||
    back === null ||
    front.parentElement === null ||
    back.parentElement === null
  ) {
    throw new Error('面板面结构缺失');
  }
  return { front: front.parentElement.style.transform, back: back.parentElement.style.transform };
}

/** 按正面正文定位面板（两根分支的正文互异 → 唯一） */
function panelOf(container: HTMLElement, text: string): HTMLElement {
  const pops = container.querySelectorAll<HTMLElement>('[data-note-popover]');
  for (const pop of Array.from(pops)) {
    if (pop.textContent?.includes(text)) return pop;
  }
  throw new Error(`未找到含「${text}」的面板`);
}

describe('P1 收尾 T1：MapView 受控翻面（flippedNoteIds / onToggleNoteFlip）', () => {
  it('① 受控：A 在 flippedNoteIds → A 翻面、B 不受影响', () => {
    const fx = layoutTwoNotes();
    const { container } = renderMap(fx, {
      pinnedNoteIds: [fx.aId, fx.bId],
      flippedNoteIds: [fx.aId],
    });
    const fa = facesOf(panelOf(container, '正文 A'));
    const fb = facesOf(panelOf(container, '正文 B'));
    expect(fa.back).toBe('rotateY(0deg)');
    expect(fa.front).toBe('rotateY(180deg)');
    expect(fb.back).toBe('rotateY(-180deg)');
    expect(fb.front).toBe('rotateY(0deg)');
  });

  it('② 点击翻面按钮 → onToggleNoteFlip(id, true) 恰一次；受控下不自翻', () => {
    const fx = layoutTwoNotes();
    const onToggleNoteFlip = vi.fn();
    const { container } = renderMap(fx, {
      pinnedNoteIds: [fx.aId],
      flippedNoteIds: [],
      onToggleNoteFlip,
    });
    const pop = panelOf(container, '正文 A');
    const btn = pop.querySelector('[data-note-flip]');
    if (btn === null) throw new Error('翻面按钮缺失');
    fireEvent.click(btn);
    expect(onToggleNoteFlip).toHaveBeenCalledTimes(1);
    expect(onToggleNoteFlip).toHaveBeenCalledWith(fx.aId, true);
    // 受控：宿主未回写 flippedNoteIds 前，面板保持正面（不存在「内部态偷偷自翻」）
    expect(facesOf(pop).back).toBe('rotateY(-180deg)');
  });

  it('③ 卸载重挂保持：pinnedNoteIds 移除再恢复 → 重挂后仍背面', () => {
    const fx = layoutTwoNotes();
    const { container, rerender } = renderMap(fx, {
      pinnedNoteIds: [fx.aId],
      flippedNoteIds: [fx.aId],
    });
    expect(facesOf(panelOf(container, '正文 A')).back).toBe('rotateY(0deg)');

    rerender({ pinnedNoteIds: [] }); // 面板卸载（props 变化）
    expect(container.querySelectorAll('[data-note-popover]').length).toBe(0);

    rerender({ pinnedNoteIds: [fx.aId] }); // 重挂
    expect(facesOf(panelOf(container, '正文 A')).back).toBe('rotateY(0deg)');
  });

  it('④ 负向：flippedNoteIds 含不存在 id → 零影响、不崩', () => {
    const fx = layoutTwoNotes();
    const { container } = renderMap(fx, {
      pinnedNoteIds: [fx.aId, fx.bId],
      flippedNoteIds: ['不存在的节点'],
    });
    expect(facesOf(panelOf(container, '正文 A')).back).toBe('rotateY(-180deg)');
    expect(facesOf(panelOf(container, '正文 B')).back).toBe('rotateY(-180deg)');
  });
});

describe('P1 收尾 T1：NotePopover 受控/非受控双模', () => {
  function renderPop(over: Partial<React.ComponentProps<typeof NotePopover>> = {}) {
    return render(
      <NotePopover
        seq={['条目一']}
        text="正文"
        x={10}
        y={20}
        pinned
        mode="embedded"
        width={200}
        height={120}
        scale={1}
        token={glassToken}
        onChangeSeq={() => undefined}
        onChangeText={() => undefined}
        onClose={() => undefined}
        {...over}
      />,
    );
  }

  it('受控：flipped 传入 → 显示背面；点击按钮只回传 onFlipChange(false)，不自翻', () => {
    const onFlipChange = vi.fn();
    const { container } = renderPop({ md: '# 背面', flipped: true, onFlipChange });
    const pop = container.querySelector<HTMLElement>('[data-note-popover]');
    if (pop === null) throw new Error('面板缺失');
    expect(facesOf(pop).back).toBe('rotateY(0deg)');
    const btn = pop.querySelector('[data-note-flip]');
    if (btn === null) throw new Error('翻面按钮缺失');
    fireEvent.click(btn);
    expect(onFlipChange).toHaveBeenCalledTimes(1);
    expect(onFlipChange).toHaveBeenCalledWith(false);
    expect(facesOf(pop).back).toBe('rotateY(0deg)'); // 父级未回写 → 保持受控值
  });

  it('非受控：缺省 flipped → 内部态自翻（现行为）', () => {
    const { container } = renderPop({ md: '# 背面' });
    const pop = container.querySelector<HTMLElement>('[data-note-popover]');
    if (pop === null) throw new Error('面板缺失');
    const btn = pop.querySelector('[data-note-flip]');
    if (btn === null) throw new Error('翻面按钮缺失');
    expect(facesOf(pop).back).toBe('rotateY(-180deg)');
    fireEvent.click(btn);
    expect(facesOf(pop).back).toBe('rotateY(0deg)');
  });
});
