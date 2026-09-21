// @vitest-environment jsdom
/**
 * S2F-1 复现：启动页三出口文档切换同步（真 MindmapStage 全链）。
 *
 * 症状（修复前）：启动页「继续上次 / 最近列表 / 新建」任一出口 → 文档名已切、
 * 画布仍是 gateway 示例树（会话内不自愈）——`useDocumentSwitch` 的「首挂跳过」
 * 吃掉了 StageContent 首次挂载时唯一一次同步机会（详见派遣计划 §1）。
 *
 * 断言口径（D5·双边）：目标文档独有节点**存在** 且 gateway 独有节点**不存在**。
 *
 * 设施比照 note-flip-host.test.tsx：jsdom 无尺寸 → 世界变换约恒等；
 * canvas 套件统一 pretendToBeVisual:false（无 rAF）→ 调度需补桩。
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MindmapStage from '../src/MindmapStage';

const LIB_KEY = 'mindcanvas.library.v1';
/** gateway 示例树独有节点（双边断言的反侧） */
const GATEWAY_NODE = 'Agent Gateway';

/** 与 gateway 不同、彼此可区分的两个种子文档 */
const DOC_A = ['# S2F-A根', '', '## S2F-A子', ''].join('\n');
const DOC_B = ['# S2F-B根', '', '## S2F-B子', ''].join('\n');

const tick = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms));

function nodeTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('g[data-node-id]')).map((g) =>
    (g.textContent ?? '').trim(),
  );
}

function hasNodeText(container: HTMLElement, text: string): boolean {
  return nodeTexts(container).some((t) => t.includes(text));
}

/** 轮询等目标节点出现；失败时 dump 现场（doc 名 + 节点文本） */
async function waitForNodeText(
  container: HTMLElement,
  text: string,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (hasNodeText(container, text)) return;
    await tick(50);
  }
  const docName = container.querySelector('[data-doc-name]')?.textContent ?? '(无)';
  throw new Error(`节点「${text}」缺失；doc=${docName}；节点=${JSON.stringify(nodeTexts(container))}`);
}

function seedLibrary(): void {
  localStorage.setItem(
    LIB_KEY,
    JSON.stringify([
      { id: 's2f-a', name: 's2f-a.mm.md', source: DOC_A, ts: Date.now(), tags: [] },
      { id: 's2f-b', name: 's2f-b.mm.md', source: DOC_B, ts: Date.now() - 100_000, tags: [] },
    ]),
  );
}

/** 启动页按钮：继续上次（含文档名 + 节点数文案）/ 最近列表项 / 新建 —— 均可用 includes 唯一命中 */
function findButton(container: HTMLElement, needle: string): HTMLElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').replace(/\s+/g, '').includes(needle),
  );
}

describe('S2F：启动页三出口 → 画布树同步（双边断言）', () => {
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

  it('「继续上次」出口：切到最近文档（A），且无 gateway 节点', async () => {
    seedLibrary();
    const { container } = render(<MindmapStage />);
    const open = findButton(container, '继续上次');
    if (open === undefined) throw new Error('启动页「继续上次」按钮缺失');
    fireEvent.click(open);
    await waitForNodeText(container, 'S2F-A子');
    expect(hasNodeText(container, GATEWAY_NODE)).toBe(false);
  });

  it('「最近列表」出口：切到较早文档（B），且无 gateway 节点', async () => {
    seedLibrary();
    const { container } = render(<MindmapStage />);
    const open = findButton(container, 's2f-b.mm.md');
    if (open === undefined) throw new Error('启动页最近列表项（s2f-b.mm.md）缺失');
    fireEvent.click(open);
    await waitForNodeText(container, 'S2F-B子');
    expect(hasNodeText(container, GATEWAY_NODE)).toBe(false);
  });

  it('「新建」出口：新文档「未命名」渲染，且无 gateway 节点', async () => {
    seedLibrary();
    const { container } = render(<MindmapStage />);
    const create = findButton(container, '新建');
    if (create === undefined) throw new Error('启动页「新建」按钮缺失');
    fireEvent.click(create);
    await waitForNodeText(container, '未命名');
    expect(hasNodeText(container, GATEWAY_NODE)).toBe(false);
  });
});
