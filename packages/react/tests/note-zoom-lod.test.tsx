// @vitest-environment jsdom
/**
 * note 笔记在滚轮缩放下的显示与渲染（2026-09-09）
 *
 * 锁的核心语义：
 *   ① 悬停预览是**屏幕空间 HUD**：宽度/字号恒定，绝不乘 transform.k
 *   ② 固定卡片是**世界空间**：在 k=1 基线排版，由一次 transform: scale(k) 驱动
 *   ③ 缩放档位：≥0.65 全量 / 0.35~0.65 角标（悬停仍可浮窗预览）/ <0.35 全剔除
 */
import { describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach } from 'vitest';
import { astToEditable, layoutMindmap, makeTextNode } from '@mindcanvas/kernel';
import type { RefObject } from 'react';
import type { MapViewApi } from '../src/render/MapView.js';
import { MapView } from '../src/render/MapView.js';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';
import {
  EMBEDDED_NOTE_MIN_H,
  EMBEDDED_NOTE_MIN_W,
  FLOATING_NOTE_MIN_W,
  FLOATING_NOTE_W,
  NOTE_FONT_MAX,
  NOTE_FONT_MIN,
  NotePopover,
  estimateFloatingNoteHeight,
  floatingNoteWidth,
  noteFontSizeOf,
} from '../src/chrome/NotePopover.js';
import { noteLodFor } from '../src/render/fixedNotePanels.js';
import { glassToken } from '../src/theme/tokens.js';

const token = glassToken;

// MapView 挂载会起 rAF 帧调度器；不卸载会让文件跑完仍挂着句柄（进程不退出）
afterEach(() => cleanup());

function renderPop(over: Partial<React.ComponentProps<typeof NotePopover>> = {}) {
  return render(
    <NotePopover
      seq={['条目一']}
      text="一整段说明"
      x={100}
      y={200}
      pinned={false}
      token={token}
      onChangeSeq={() => undefined}
      onChangeText={() => undefined}
      onClose={() => undefined}
      {...over}
    />,
  );
}

const popEl = (c: HTMLElement): HTMLElement =>
  c.querySelector('[data-note-popover]') as HTMLElement;

describe('note 缩放档位（LOD）', () => {
  it('k ≥ 0.65 全量；0.35~0.65 角标；<0.35 剔除', () => {
    expect(noteLodFor(1)).toBe('full');
    expect(noteLodFor(2.5)).toBe('full');
    expect(noteLodFor(0.65)).toBe('full');
    expect(noteLodFor(0.64)).toBe('badge');
    expect(noteLodFor(0.35)).toBe('badge');
    expect(noteLodFor(0.34)).toBe('none');
    expect(noteLodFor(0.1)).toBe('none');
  });

  it('脏值（NaN / 0）退化为 full，不隐藏用户已固定的卡片', () => {
    expect(noteLodFor(Number.NaN)).toBe('full');
    expect(noteLodFor(0)).toBe('full');
  });
});

describe('悬浮预览：宽度对齐节点 + 字号不大于节点', () => {
  it('宽度 = 节点屏幕宽（对齐节点长度），不是固定 260', () => {
    const a = renderPop({ mode: 'floating', nodeWidth: 160, viewportW: 1000, viewportH: 800 });
    const b = renderPop({ mode: 'floating', nodeWidth: 320, viewportW: 1000, viewportH: 800 });
    expect(popEl(a.container).style.width).toBe('160px');
    expect(popEl(b.container).style.width).toBe('320px');
  });

  it('节点窄到装不下内容时兜到可读下限（不再被压成细条）', () => {
    const tiny = renderPop({ mode: 'floating', nodeWidth: 60, viewportW: 1000, viewportH: 800 });
    expect(popEl(tiny.container).style.width).toBe(`${FLOATING_NOTE_MIN_W}px`);
  });

  it('宽度不超出视口', () => {
    const wide = renderPop({ mode: 'floating', nodeWidth: 900, viewportW: 400, viewportH: 800 });
    expect(popEl(wide.container).style.width).toBe('380px'); // 400 - 10*2
  });

  it('字号不大于所属节点字号', () => {
    const leaf = renderPop({ mode: 'floating', nodeWidth: 200, nodeFontSize: 9 });
    const branch = renderPop({ mode: 'floating', nodeWidth: 200, nodeFontSize: 11 });
    const big = renderPop({ mode: 'floating', nodeWidth: 200, nodeFontSize: 28 });
    const fontOf = (c: HTMLElement): string =>
      (c.querySelector('[data-note-textarea] div:last-child') as HTMLElement).style.fontSize;
    expect(parseFloat(fontOf(leaf.container))).toBeLessThanOrEqual(9);
    expect(parseFloat(fontOf(branch.container))).toBeLessThanOrEqual(11);
    // 放大视图：节点字号很大，笔记仍封顶在 chrome 小字号
    expect(parseFloat(fontOf(big.container))).toBeLessThanOrEqual(NOTE_FONT_MAX);
  });

  it('节点字号小到不可读时兜到可读底线（不是无限跟小）', () => {
    const { container } = renderPop({ mode: 'floating', nodeWidth: 200, nodeFontSize: 3 });
    const el = container.querySelector('[data-note-textarea] div:last-child') as HTMLElement;
    expect(parseFloat(el.style.fontSize)).toBe(NOTE_FONT_MIN);
  });

  it('浮窗没有 scale 变换（屏幕空间，文本不被缩放糊掉）', () => {
    const { container } = renderPop({ mode: 'floating', scale: 0.2, nodeWidth: 160 });
    expect(popEl(container).style.transform).not.toContain('scale');
  });

  it('水平越界时钳回视口内', () => {
    const { container } = renderPop({
      mode: 'floating',
      x: 980,
      nodeWidth: 260,
      viewportW: 1000,
      viewportH: 800,
    });
    expect(popEl(container).style.left).toBe('730px'); // 1000 - 260 - 10
  });

  it('下方空间不足时翻转到节点上方（translate -100%）', () => {
    const { container } = renderPop({
      mode: 'floating',
      x: 100,
      y: 560,
      anchorTop: 100,
      viewportW: 1000,
      viewportH: 600,
    });
    expect(popEl(container).style.transform).toContain('-100%');
    expect(popEl(container).style.top).toBe('92px'); // anchorTop - gap
  });

  it('下方空间充足时不翻转', () => {
    const { container } = renderPop({
      mode: 'floating',
      x: 100,
      y: 100,
      anchorTop: 40,
      viewportW: 1000,
      viewportH: 800,
    });
    expect(popEl(container).style.transform).toContain('translate3d(0, 0, 0)');
    expect(popEl(container).style.top).toBe('100px');
  });

  it('高度估算随内容增长并封顶（翻转判定不是拍脑袋）', () => {
    const short = estimateFloatingNoteHeight([], '短', 260);
    const long = estimateFloatingNoteHeight(['a', 'b', 'c'], '长'.repeat(400), 260);
    expect(long).toBeGreaterThan(short);
    expect(long).toBeLessThanOrEqual(320);
  });

  it('floatingNoteWidth：对齐节点宽，兜下限，不超视口', () => {
    expect(floatingNoteWidth(160, 1000)).toBe(160);
    expect(floatingNoteWidth(30, 1000)).toBe(FLOATING_NOTE_MIN_W);
    expect(floatingNoteWidth(900, 400)).toBe(380); // 视口 - 2*margin
    expect(floatingNoteWidth(0, 0)).toBe(FLOATING_NOTE_W); // 节点宽/视口均未知 → 兜底
  });

  it('noteFontSizeOf：min(上限, 节点字号)，但不低于可读底线', () => {
    expect(noteFontSizeOf(9)).toBe(9);
    expect(noteFontSizeOf(11)).toBe(11);
    expect(noteFontSizeOf(28)).toBe(NOTE_FONT_MAX);
    expect(noteFontSizeOf(2)).toBe(NOTE_FONT_MIN);
    expect(noteFontSizeOf(undefined)).toBe(NOTE_FONT_MAX);
  });
});

describe('固定嵌入卡片：世界基线 + 一次 scale(k)', () => {
  it('尺寸用世界基线，缩放只体现在 transform（不逐像素重排）', () => {
    const { container } = renderPop({
      mode: 'embedded',
      scale: 0.5,
      width: 200,
      height: 120,
      pinned: true,
    });
    const el = popEl(container);
    expect(el.style.width).toBe('200px'); // 不是 100（旧实现 = 世界宽 × k）
    expect(el.style.height).toBe('120px');
    expect(el.style.transform).toContain('scale(0.5)');
    expect(el.style.transformOrigin).toBe('0 0');
  });

  it('极小尺寸有最小可用宽高保护（不溃缩成一条线）', () => {
    const { container } = renderPop({
      mode: 'embedded',
      scale: 0.4,
      width: 20,
      height: 10,
      pinned: true,
    });
    const el = popEl(container);
    expect(el.style.width).toBe(`${EMBEDDED_NOTE_MIN_W}px`);
    expect(el.style.height).toBe(`${EMBEDDED_NOTE_MIN_H}px`);
  });
});

describe('编辑态：一律浮窗 + 放大面板', () => {
  it('编辑态一律浮窗（含 k≥0.7 的 embedded）：预留槽太矮装不下编辑器', () => {
    const { container } = renderPop({
      mode: 'embedded',
      scale: 1,
      width: 200,
      height: 120,
      pinned: true,
      editing: true,
    });
    const el = popEl(container);
    expect(el.getAttribute('data-note-mode')).toBe('floating');
    expect(container.querySelector('textarea')).not.toBeNull();
  });

  it('编辑态面板放大：minHeight ≥ 300、宽度不小于 320', () => {
    const { container } = renderPop({
      mode: 'floating',
      nodeWidth: 160,
      nodeFontSize: 9,
      pinned: true,
      editing: true,
      viewportW: 1000,
      viewportH: 800,
    });
    const el = popEl(container);
    expect(parseFloat(el.style.minHeight)).toBeGreaterThanOrEqual(300);
    expect(parseFloat(el.style.width)).toBeGreaterThanOrEqual(320);
    // 不遮全屏：高度上限 460
    expect(parseFloat(el.style.maxHeight)).toBeLessThanOrEqual(460);
  });

  it('预览态不放大（保持按内容自适应）', () => {
    const { container } = renderPop({ mode: 'floating', nodeWidth: 160, viewportW: 1000, viewportH: 800 });
    const el = popEl(container);
    expect(el.style.minHeight).toBe('');
    expect(popEl(container).style.width).toBe('160px'); // 依旧对齐节点
  });

  it('编辑态 textarea 有足够可见行数（≥110px，其余靠滚动）', () => {
    const { container } = renderPop({ mode: 'floating', pinned: true, editing: true });
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(parseFloat(ta.style.minHeight)).toBeGreaterThanOrEqual(110);
  });
});

// ---------------- MapView 集成：档位真的控制了 DOM 的生成 ----------------

/** 带 note 的小型树 → 布局 */
function layoutWithNote() {
  const root = makeTextNode('根', [makeTextNode('分支 A'), makeTextNode('分支 B')]);
  const editable = astToEditable(root)!;
  const branch = editable.children[0]!;
  branch.note = { note: ['条目一'], note_text: '正文内容' };
  const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
  const layout = layoutMindmap(editable, createNodeMeasure(char, new Map()), new Set());
  return { layout, char, noteId: branch.id };
}

/** 轮询等待断言成立（视口 notify 走 rAF，不是同步 setState） */
async function waitFor(assertFn: () => void, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      assertFn();
      return;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw lastErr ?? new Error('waitFor timeout');
}

type NoteFixture = ReturnType<typeof layoutWithNote>;

function renderMap(fx: NoteFixture, over: Partial<React.ComponentProps<typeof MapView>> = {}) {
  const apiRef: RefObject<MapViewApi | null> = { current: null };
  const { container } = render(
    <ThemeProvider>
      <MapView
        layout={fx.layout}
        entities={new Map()}
        char={fx.char}
        apiRef={apiRef}
        {...over}
      />
    </ThemeProvider>,
  );
  return { container, apiRef };
}

describe('MapView：note 档位控制 DOM 生成', () => {
  it('同一个实例走完三档：full → badge → none', async () => {
    const fx = layoutWithNote();
    const { container, apiRef } = renderMap(fx, { pinnedNoteIds: [fx.noteId] });
    const api = apiRef.current!;

    // k=1（full）：固定卡片以嵌入模式贴合节点
    const pops = container.querySelectorAll('[data-note-popover]');
    expect(pops.length).toBe(1);
    expect(pops[0]!.getAttribute('data-note-mode')).toBe('embedded');

    // k=0.5（badge）：固定卡片不再挂载，角标保留
    act(() => api.zoomBy(0.5));
    await waitFor(() => {
      expect(container.querySelectorAll('[data-note-popover]').length).toBe(0);
      expect(container.querySelectorAll('[data-note-badge]').length).toBeGreaterThan(0);
    });

    // k=0.2（none）：note 相关 DOM 全剔除，连角标也不生成
    act(() => api.zoomBy(0.4));
    await waitFor(() => {
      expect(container.querySelectorAll('[data-note-popover]').length).toBe(0);
      expect(container.querySelectorAll('[data-note-badge]').length).toBe(0);
    });
  });

  it('固定卡片宽度对齐节点、字号不大于节点字号', () => {
    const fx = layoutWithNote();
    const { container } = renderMap(fx, { pinnedNoteIds: [fx.noteId] });
    const node = fx.layout.nodes.find((n) => n.node.id === fx.noteId)!;
    const pop = container.querySelector('[data-note-popover]') as HTMLElement;
    // 宽度 = 节点基线宽（世界口径；仅当节点过窄时才兜到最小可用宽）
    expect(pop.style.width).toBe(`${Math.max(EMBEDDED_NOTE_MIN_W, node.box.w)}px`);
    // 字号 ≤ 节点正文字号（depth<2 用 size）
    const font = parseFloat(
      (container.querySelector('[data-note-textarea] div:last-child') as HTMLElement).style
        .fontSize,
    );
    expect(font).toBeLessThanOrEqual(glassToken.font.size);
  });

  it('未固定时不生成卡片：只留角标（悬停才浮出预览）', () => {
    const fx = layoutWithNote();
    const { container } = renderMap(fx, { pinnedNoteIds: [] });
    expect(container.querySelectorAll('[data-note-popover]').length).toBe(0);
    expect(container.querySelectorAll('[data-note-badge]').length).toBeGreaterThan(0);
  });

  it('正在编辑的面板在任何档位都保留（不丢用户输入）', async () => {
    const fx = layoutWithNote();
    const { container, apiRef } = renderMap(fx, {
      pinnedNoteIds: [fx.noteId],
      editingNoteIds: [fx.noteId],
    });
    expect(container.querySelectorAll('[data-note-popover]').length).toBe(1);
    act(() => apiRef.current!.zoomBy(0.5));
    await waitFor(() => {
      const pop = container.querySelector('[data-note-popover]');
      expect(pop).not.toBeNull();
      // 档位降级后升级为屏幕浮窗（k=0.5 < 0.7）：输入框与 IME 选词框不漂
      expect(pop!.getAttribute('data-note-mode')).toBe('floating');
    });
  });
});
