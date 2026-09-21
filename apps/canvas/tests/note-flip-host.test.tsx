// @vitest-environment jsdom
/**
 * P1 收尾 T1 端到端：翻卡态提升宿主（真 MindmapStage 全链）。
 *
 * 链路：启动页「看内置示例」进入应用 →「最近」菜单打开含 note.md 的文档 → 点节点固定
 * note 面板 → 翻面 → 关闭面板（卸载）→ 重新点节点固定（重挂）→ **仍背面**。
 * 旧实现翻面态在面板内 state（key={panel.id} 挂载/卸载），重挂即复位为正面；
 * 提升为宿主（MindmapStage）会话态后跨卸载保持（本用例即该语义的端到端判别）。
 *
 * 设施比照 delete-key.test.tsx：jsdom 无尺寸 → 世界变换约为恒等（本文件工具已做变换感知，
 * 兼容 fit/缩放后的 translate+scale）；canvas 套件统一 pretendToBeVisual:false（无 rAF）→ 调度需补桩。
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MindmapStage from '../src/MindmapStage';

const LIB_KEY = 'mindcanvas.library.v1';

/**
 * 含 note.md 的小文档：note 块绑定「其后第一个结构节点」= 甲。
 * 注：序列必须用**块形态**（`note:` + `- 条目`）——流式 `["…"]` 会被自研 YAML 读成
 * 字符串，hasNote 为 false（点击不固定面板）。
 */
const DOC_SOURCE = [
  '# 根',
  '',
  '<!--',
  'note:',
  '  - 条目一',
  'md: "## 背面标题"',
  '-->',
  '',
  '## 甲',
  '',
].join('\n');

const tick = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms));

function nodeIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('g[data-node-id]')).map(
    (g) => g.getAttribute('data-node-id') ?? '',
  );
}

/** 节点 g 的**世界**中心（transform 的 translate + 首个 rect 的宽高） */
function centerOf(container: HTMLElement, id: string): { cx: number; cy: number } | null {
  const g = container.querySelector(`g[data-node-id="${id}"]`);
  if (!g) return null;
  const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(g.getAttribute('transform') ?? '');
  const r = g.querySelector('rect');
  if (!m || !r) return null;
  return {
    cx: Number(m[1]) + Number(r.getAttribute('width') ?? 0) / 2,
    cy: Number(m[2]) + Number(r.getAttribute('height') ?? 0) / 2,
  };
}

/** 世界→屏幕变换：读世界组 `translate(x y) scale(k)`（fit/缩放后非恒等；缺省按恒等） */
function worldTransformOf(container: HTMLElement): { tx: number; ty: number; k: number } {
  const svg = container.querySelector('g[data-node-id]')?.closest('svg') ?? null;
  const g = svg === null ? null : (Array.from(svg.children).find((el) => el.tagName === 'g') ?? null);
  const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\)\s*scale\(\s*(-?[\d.]+)/.exec(
    g?.getAttribute('transform') ?? '',
  );
  if (m === null) return { tx: 0, ty: 0, k: 1 };
  return { tx: Number(m[1]), ty: Number(m[2]), k: Number(m[3]) };
}

/** 在画布手势层上点一下（pointerdown+up = 选中；世界坐标经当前变换换算到屏幕） */
function clickNode(container: HTMLElement, id: string): boolean {
  const wheel = container.querySelector('div[style*="touch-action"]') as HTMLElement | null;
  const at = centerOf(container, id);
  if (!wheel || !at) return false;
  const { tx, ty, k } = worldTransformOf(container);
  const sx = at.cx * k + tx;
  const sy = at.cy * k + ty;
  fireEvent.pointerDown(wheel, { clientX: sx, clientY: sy, pointerId: 1, bubbles: true });
  fireEvent.pointerUp(wheel, { clientX: sx, clientY: sy, pointerId: 1, bubbles: true });
  return true;
}

/** 轮询等待断言成立（controller.notify → rAF 桩 → 帧） */
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
    await tick(25);
  }
  throw lastErr ?? new Error('waitFor timeout');
}

/** 背面 face 的朝向：'rotateY(0deg)' = 翻面中（背面朝向观察者）；FlipCard 两面恒挂载 */
function backTransform(container: HTMLElement): string {
  const back = container.querySelector('[data-note-back-scroll]');
  const el = back?.parentElement;
  if (el === null || el === undefined) throw new Error('背面 face 缺失（面板未挂载或 md 未透传）');
  return el.style.transform;
}

describe('P1 收尾 T1 端到端：翻面 → 面板卸载 → 重挂仍背面', () => {
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
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('翻面 → 关闭（卸载）→ 重新固定（重挂）→ 仍背面（宿主持态）', async () => {
    localStorage.setItem(
      LIB_KEY,
      JSON.stringify([
        { id: 'e2e-flip', name: 'e2e-flip.mm.md', source: DOC_SOURCE, ts: Date.now(), tags: [] },
      ]),
    );
    const { container } = render(<MindmapStage />);

    // 启动页 →「看内置示例」先进入应用；随后经「最近」菜单切换文档 —— 走 applyDoc →
    // 已挂载 StageContent 的 useDocumentSwitch 路径（会 reset 树）。
    // 注：启动页「继续上次」为 setDoc 直通，绕过 reset 首挂跳过（范围外发现，详见报告）。
    const sample = Array.from(container.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '') === '看内置示例',
    );
    if (sample === undefined) throw new Error('启动页「看内置示例」按钮缺失');
    fireEvent.click(sample);
    await waitFor(() => expect(container.querySelector('[data-doc-name]')).not.toBeNull());

    // 文档栏「最近」→ 菜单 → 点本用例文档 → applyDoc 切换
    const recentBtn = Array.from(container.querySelectorAll('span')).find(
      (s) => (s.textContent ?? '') === '最近',
    );
    if (recentBtn === undefined) throw new Error('文档栏「最近」按钮缺失');
    fireEvent.click(recentBtn);
    await waitFor(() => expect(container.querySelector('[data-recent-menu]')).not.toBeNull());
    const docItem = Array.from(container.querySelectorAll('[data-recent-doc]')).find((el) =>
      (el.textContent ?? '').includes('e2e-flip.mm.md'),
    );
    if (docItem === undefined) throw new Error('「最近」菜单未列出 e2e-flip.mm.md');
    fireEvent.click(docItem);

    // 点「甲」（带 note 的节点）→ 固定面板（md 非空 → 有翻面按钮）
    // 等一下：文档切换落地 + 节点文本渲染（失败时 dump 现场便于诊断）
    const findTarget = (): string | undefined =>
      nodeIds(container).find((id) =>
        (container.querySelector(`g[data-node-id="${id}"]`)?.textContent ?? '').includes('甲'),
      );
    let target = findTarget();
    for (let i = 0; i < 40 && target === undefined; i++) {
      await tick(50);
      target = findTarget();
    }
    if (target === undefined) {
      const docName = container.querySelector('[data-doc-name]')?.textContent ?? '(无)';
      const dump = nodeIds(container).map((id) => {
        const g = container.querySelector(`g[data-node-id="${id}"]`);
        return `${id}:${g?.textContent ?? ''}`;
      });
      throw new Error(`节点「甲」缺失；doc=${docName}；节点=${JSON.stringify(dump)}`);
    }
    // 面板固定卡仅在 k ≥ 0.65 档位渲染（noteLod full）。jsdom 实测进入后 k=1（fit 为空操作），
    // 此处做档位守卫：若环境差异压低 k，先经滚轮升档再交互（真实用户同路径）。
    const wheelEl = container.querySelector('div[style*="touch-action"]') as HTMLElement | null;
    for (let i = 0; i < 8 && worldTransformOf(container).k < 0.65; i++) {
      wheelEl?.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -500, clientX: 60, clientY: 60, bubbles: true }),
      );
      await tick(60);
    }
    if (worldTransformOf(container).k < 0.65) {
      throw new Error(`缩放未达面板档位（k=${worldTransformOf(container).k}）`);
    }

    expect(clickNode(container, target)).toBe(true);
    try {
      await waitFor(() => expect(container.querySelector('[data-note-flip]')).not.toBeNull());
    } catch {
      const wt = worldTransformOf(container);
      const pops = container.querySelectorAll('[data-note-popover]').length;
      const badges = container.querySelectorAll('[data-note-badge]').length;
      throw new Error(`翻面按钮未出现；popover=${pops} badge=${badges} k=${wt.k} t=(${wt.tx},${wt.ty})`);
    }
    expect(backTransform(container)).toBe('rotateY(-180deg)'); // 初始 = 正面

    // 翻面 → 背面
    const flipBtn = container.querySelector('[data-note-flip]');
    if (flipBtn === null) throw new Error('翻面按钮缺失');
    fireEvent.click(flipBtn);
    await waitFor(() => expect(backTransform(container)).toBe('rotateY(0deg)'));

    // 关闭面板（卸载：pinnedNotePaths 移除 → key={panel.id} 的面板卸载）
    const closeBtn = container.querySelector('[aria-label="关闭 note笔记"]');
    if (closeBtn === null) throw new Error('关闭按钮缺失');
    fireEvent.click(closeBtn);
    await waitFor(() => expect(container.querySelector('[data-note-popover]')).toBeNull());

    // 重新固定（重挂）→ 仍背面（未再点翻面；旧实现此处复位为正面）
    expect(clickNode(container, target)).toBe(true);
    await waitFor(() => expect(container.querySelector('[data-note-flip]')).not.toBeNull());
    expect(backTransform(container)).toBe('rotateY(0deg)');
  });
});
