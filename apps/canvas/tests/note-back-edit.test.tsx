// @vitest-environment jsdom
/**
 * P2 端到端：节点卡背面编辑全链（真 MindmapStage）。
 *
 * 链路：启动页「看内置示例」→「最近」菜单打开含 note.md 的文档 → 点节点固定 note 面板
 * → 翻面 → 「编辑背面」→ 改源文 → 提交 → 退出编辑 → 背面显示新内容
 * → 关闭面板重开（卸载重挂）→ 仍背面 + 新内容 → 点「保存」→ 库 source 含新 md（逐字）。
 *
 * 键位口径（P2 报告 §P2-1 抄录）：派遣计划/设计稿转述为 Ctrl+Enter，**实测 `DescBlock`
 * 为 Shift+Enter 提交**（Enter 换行 / Esc 取消 / 失焦提交）——按「以实际为准 + 与
 * DescBlock 对齐」执行；本用例显式断言 Ctrl+Enter **不提交**（对齐证据留在测试里），
 * 真提交走 Shift+Enter。全局键位核对：`matchEditorKey` 的 ctrl 分支无 Enter（null 无动作）、
 * Shift+Enter 的「desc」动作被 textarea 的 stopPropagation 拦截（与 DescBlock 同款结构）。
 *
 * 另：清空提交 → md 键删除 → 翻面入口消失（P1 零感知语义保留）。
 * 设施比照 note-flip-host.test.tsx：jsdom 无尺寸 → 世界变换约为恒等（工具已做变换感知）；
 * canvas 套件统一 pretendToBeVisual:false（无 rAF）→ 调度需补桩；k ≥ 0.65 面板档位守卫。
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MindmapStage from '../src/MindmapStage';

const LIB_KEY = 'mindcanvas.library.v1';
const DOC_ID = 'e2e-back';
const DOC_NAME = 'e2e-back.mm.md';

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

/** 元素获取守卫（缺元素即抛；新测试不写非空断言——lint 计数不得抬升） */
function must<E extends Element>(el: E | null, what: string): E {
  if (el === null) throw new Error(`缺少元素：${what}`);
  return el;
}

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

/**
 * 隔帧点击（down 与 up 之间让出一个 macrotask）——贴近真实浏览器时序：
 * 真实指针抬起必然晚于按下若干帧，React 有机会在二者之间提交 `setNodeDrag`；
 * jsdom 里 fireEvent 同步连发时该提交可能被"编辑刚触发的更新"压住，
 * 导致 up 读到旧闭包（`nodeDrag=null` 且 `dragRef=null`）→ 点击被吞。
 */
async function clickNodeFlushed(container: HTMLElement, id: string): Promise<void> {
  const wheel = container.querySelector('div[style*="touch-action"]') as HTMLElement | null;
  const at = centerOf(container, id);
  if (!wheel || !at) throw new Error('手势层或节点缺失');
  const { tx, ty, k } = worldTransformOf(container);
  const sx = at.cx * k + tx;
  const sy = at.cy * k + ty;
  fireEvent.pointerDown(wheel, { clientX: sx, clientY: sy, pointerId: 1, bubbles: true });
  await tick(30);
  fireEvent.pointerUp(wheel, { clientX: sx, clientY: sy, pointerId: 1, bubbles: true });
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

/** 启动页 →「最近」菜单打开本用例文档（走 applyDoc → useDocumentSwitch reset 路径） */
async function openDoc(container: HTMLElement): Promise<void> {
  const sample = Array.from(container.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '') === '看内置示例',
  );
  if (sample === undefined) throw new Error('启动页「看内置示例」按钮缺失');
  fireEvent.click(sample);
  await waitFor(() => expect(container.querySelector('[data-doc-name]')).not.toBeNull());

  const recentBtn = Array.from(container.querySelectorAll('span')).find(
    (s) => (s.textContent ?? '') === '最近',
  );
  if (recentBtn === undefined) throw new Error('文档栏「最近」按钮缺失');
  fireEvent.click(recentBtn);
  await waitFor(() => expect(container.querySelector('[data-recent-menu]')).not.toBeNull());
  const docItem = Array.from(container.querySelectorAll('[data-recent-doc]')).find((el) =>
    (el.textContent ?? '').includes(DOC_NAME),
  );
  if (docItem === undefined) throw new Error(`「最近」菜单未列出 ${DOC_NAME}`);
  fireEvent.click(docItem);
}

/** 等「甲」渲染出来（失败时 dump 现场便于诊断） */
async function waitForJia(container: HTMLElement): Promise<string> {
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
  return target;
}

/** 面板固定卡仅在 k ≥ 0.65 档位渲染（noteLod full）；环境差异压低 k 时先经滚轮升档 */
async function ensurePanelZoom(container: HTMLElement): Promise<void> {
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
}

/** 点固定面板头「翻转」按钮并等背面朝前 */
async function flipBack(container: HTMLElement): Promise<void> {
  fireEvent.click(must(container.querySelector('[data-note-flip]'), '翻面按钮'));
  await waitFor(() => expect(backTransform(container)).toBe('rotateY(0deg)'));
}

/** 进入背面编辑器：点「编辑背面」→ 等 data-note-md-editor */
async function enterMdEdit(container: HTMLElement): Promise<HTMLTextAreaElement> {
  fireEvent.click(must(container.querySelector('[data-note-md-edit]'), '编辑背面按钮'));
  await waitFor(() => expect(container.querySelector('[data-note-md-editor]')).not.toBeNull());
  return must<HTMLTextAreaElement>(
    container.querySelector('[data-note-md-editor] textarea'),
    '源文 textarea',
  );
}

/** 诊断：节点在当前 DOM 的位置快照（世界 translate + 首个 rect 尺寸） */
function nodePosOf(container: HTMLElement, id: string): string {
  const g = container.querySelector(`g[data-node-id="${id}"]`);
  if (!g) return '(missing)';
  const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(g.getAttribute('transform') ?? '');
  const r = g.querySelector('rect');
  return `t=(${m?.[1]},${m?.[2]}) rect=${r?.getAttribute('width')}x${r?.getAttribute('height')}`;
}

/**
 * 等节点位置稳定（连续 3 次采样不变）再点击——**关闭 note 面板会移除「note 预留」，
 * 森林布局随之重排**，节点位置经历多帧过渡（实测：关闭瞬间 → 稳定值有 ~40px 级位移）；
 * 真实用户「关闭 → 找到节点 → 抬起手点击」的间隔天然覆盖该窗口，jsdom 里需显式等待。
 * （首击落在过渡窗口内时 hit-test 会 miss → 点击被吞；这是既有画布行为，非 P2 引入。）
 */
async function waitForStablePos(container: HTMLElement, id: string): Promise<void> {
  let same = 0;
  let prev = nodePosOf(container, id);
  for (let i = 0; i < 80 && same < 3; i++) {
    await tick(40);
    const cur = nodePosOf(container, id);
    if (cur !== '(missing)' && cur === prev) same += 1;
    else same = 0;
    prev = cur;
  }
}

/** 库中该文档的 source（严格提取——JSON 解析结果不可信，不写裸断言） */
function libSourceOf(id: string): string {
  const parsed: unknown = JSON.parse(localStorage.getItem(LIB_KEY) ?? '[]');
  if (!Array.isArray(parsed)) return '';
  for (const e of parsed) {
    const holder = Object(e);
    if (Reflect.get(holder, 'id') === id) {
      const s: unknown = Reflect.get(holder, 'source');
      return typeof s === 'string' ? s : '';
    }
  }
  return '';
}

describe('P2 端到端：背面编辑 → 提交 → 重开新内容 → 保存写回', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      setTimeout(() => cb(0), 16) as unknown as number,
    );
    vi.stubGlobal('cancelAnimationFrame', (h: number) => {
      clearTimeout(h);
    });
    // jsdom 未实现 Blob URL / 下载导航：保存兜底（下载路径）需要它们存在（本用例验证
    // save → DocLibrary 写回链；真实下载行为不在断言范围）。
    URL.createObjectURL = () => 'blob:mock-url';
    URL.revokeObjectURL = () => undefined;
    HTMLAnchorElement.prototype.click = () => undefined;
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('翻面 → 编辑背面 → Ctrl+Enter 不提交（实测对齐 DescBlock）/ Shift+Enter 提交 → 重开仍背面新内容 → 保存后 source 含新 md 逐字', async () => {
    localStorage.setItem(
      LIB_KEY,
      JSON.stringify([{ id: DOC_ID, name: DOC_NAME, source: DOC_SOURCE, ts: Date.now(), tags: [] }]),
    );
    const { container } = render(<MindmapStage />);

    await openDoc(container);
    const target = await waitForJia(container);
    await ensurePanelZoom(container);

    // 点「甲」→ 固定面板（md 非空 → 有翻面按钮）
    expect(clickNode(container, target)).toBe(true);
    await waitFor(() => expect(container.querySelector('[data-note-flip]')).not.toBeNull());
    expect(backTransform(container)).toBe('rotateY(-180deg)'); // 初始 = 正面

    await flipBack(container);
    // 背面态：编辑入口可用（默认态零新增 DOM 由单测钉死，此处只走正面路径）
    const ta = await enterMdEdit(container);
    fireEvent.change(ta, { target: { value: '## 新标题' } });

    // 键位实测对齐（DescBlock）：Ctrl+Enter **不提交**（编辑器保持；全局 matchEditorKey
    // 的 ctrl 分支无 Enter，不会引发任何动作）
    fireEvent.keyDown(ta, { key: 'Enter', ctrlKey: true });
    expect(container.querySelector('[data-note-md-editor]')).not.toBeNull();

    // Shift+Enter：提交（写回 + 退出编辑态）→ 回背面视图
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true });
    await waitFor(() => expect(container.querySelector('[data-note-md-editor]')).toBeNull());
    expect(backTransform(container)).toBe('rotateY(0deg)'); // 保持背面
    await waitFor(() =>
      expect(container.querySelector('[data-note-back-md]')?.textContent ?? '').toContain('新标题'),
    );

    // 关闭面板（卸载）→ 等「note 预留移除 → 布局重排」落定 → 重新固定（重挂）
    // → 仍背面 + 新内容（宿主持态 + 树已写回）
    fireEvent.click(must(container.querySelector('[aria-label="关闭 note笔记"]'), '关闭按钮'));
    await waitFor(() => expect(container.querySelector('[data-note-popover]')).toBeNull());
    await waitForStablePos(container, target);
    await clickNodeFlushed(container, target);
    try {
      await waitFor(() => expect(container.querySelector('[data-note-flip]')).not.toBeNull());
    } catch {
      const wt = worldTransformOf(container);
      const pops = container.querySelectorAll('[data-note-popover]').length;
      throw new Error(
        `重开后面板未出现；pops=${pops} k=${wt.k} t=(${wt.tx},${wt.ty}) pos=[${nodePosOf(container, target)}]`,
      );
    }
    expect(backTransform(container)).toBe('rotateY(0deg)');
    expect(container.querySelector('[data-note-back-md]')?.textContent ?? '').toContain('新标题');

    // round-trip：点「保存」→ serialize() 写回库 source（含新 md 逐字）
    const saveBtn = Array.from(container.querySelectorAll('span')).find(
      (s) => (s.textContent ?? '') === '保存',
    );
    if (saveBtn === undefined) throw new Error('文档栏「保存」按钮缺失');
    fireEvent.click(saveBtn);
    await waitFor(() => expect(libSourceOf(DOC_ID)).toContain('md: "## 新标题"'));
  });

  it('清空提交 → md 删键：翻面按钮与编辑入口消失、面板仍存活（零感知语义保留）', async () => {
    localStorage.setItem(
      LIB_KEY,
      JSON.stringify([{ id: DOC_ID, name: DOC_NAME, source: DOC_SOURCE, ts: Date.now(), tags: [] }]),
    );
    const { container } = render(<MindmapStage />);

    await openDoc(container);
    const target = await waitForJia(container);
    await ensurePanelZoom(container);
    expect(clickNode(container, target)).toBe(true);
    await waitFor(() => expect(container.querySelector('[data-note-flip]')).not.toBeNull());

    await flipBack(container);
    const ta = await enterMdEdit(container);
    fireEvent.change(ta, { target: { value: '   ' } }); // 纯空白 = 空文本（trim 判空）
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true });

    // 提交后：编辑面退出；md 键删除 → 翻面门关闭（按钮消失）、编辑入口消失、面板仍存活
    await waitFor(() => {
      expect(container.querySelector('[data-note-md-editor]')).toBeNull();
      expect(container.querySelector('[data-note-flip]')).toBeNull();
      expect(container.querySelector('[data-note-md-edit]')).toBeNull();
    });
    expect(container.querySelector('[data-note-popover]')).not.toBeNull();
    // 正面区块回来了（面板未消失，只是不再有背面）
    expect(container.querySelector('[data-note-seq]')).not.toBeNull();

    // 删键证据（数据层）：保存 → 序列化 source 的 note 块不再有 md 键。
    // （若「空文本」被写成空白串而非删键，source 会含 `md: "   "` —— 本断言钉死删键语义）
    const saveBtn = Array.from(container.querySelectorAll('span')).find(
      (s) => (s.textContent ?? '') === '保存',
    );
    if (saveBtn === undefined) throw new Error('文档栏「保存」按钮缺失');
    fireEvent.click(saveBtn);
    await waitFor(() => expect(libSourceOf(DOC_ID)).not.toContain('md:'));
  });
});
