// @vitest-environment jsdom
/**
 * FO-B2 · `FrameOutline`（框壳 + 框内大纲）组件单测。
 *
 * 规格：`docs/specs/2026-09-15-subtree-frame-outline-design.md` §4.3–4.5 / §5.1；
 * 计划 Task 5（行为表逐项）。
 *
 * 契约：
 *  - 行盒来自 **B1 岛产出**（`layoutFrameIsland`，本测用真函数造盒）——组件不重算布局；
 *  - 单击行 = 选中；双击 text 行 = 既有编辑入口；image/entity 行 = 只读占位；
 *  - 结构键与 `edit/keys.ts` 对齐（Tab=建子 / Enter=建同级 / Shift+Tab=缩进 / Ctrl+Shift+Tab=反缩进）；
 *    跨 depth 边界 no-op 由 **controller 守卫**兜底（本测用真 `EditorController` 端到端一条）；
 *  - 注释：只读提示 + 「注释」入口（复用幕布 desc 编辑，勿新 WYSIWYG）。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import {
  FRAME_OUTLINE_PLACEHOLDER_H,
  LINE_H,
  layoutFrameIsland,
  makeEntityNode,
  makeTextNode,
  setFrame,
  type Box,
  type EditableNode,
} from '@mindcanvas/kernel';
import { FrameOutline } from '../src/chrome/FrameOutline.js';
import { EditorController } from '../src/edit/controller.js';
import { FrameScheduler } from '../src/render/scheduler.js';
import { estimateDescHeight } from '../src/chrome/DescBlock.js';
import { glassToken } from '../src/theme/tokens.js';

const token = glassToken;
const ROW_H = 24;

/** 夹具度量：行高固定；描述区高度与生产管线（createDescMeasure）同口径计入行盒 */
function measureOf(node: EditableNode): { w: number; h: number } {
  const desc = typeof node.note?.desc === 'string' ? node.note.desc : '';
  const w = (node.text ?? node.ref?.id ?? 'x').length * 10;
  return { w, h: ROW_H + (desc === '' ? 0 : estimateDescHeight(desc)) };
}

/** 夹具：根（depth=1 成框）→ [a, c → g]；大纲层 = {根, a, c}，空间层 = {g} */
function fixture(opts: { entity?: boolean; desc?: string; text?: string } = {}): {
  root: EditableNode;
  a: EditableNode;
  c: EditableNode;
  g: EditableNode;
  boxes: Map<string, Box>;
} {
  const g = makeTextNode('g');
  const c = makeTextNode('c', [g]);
  const aBase = opts.entity
    ? makeEntityNode({ kind: 'img', id: 'demo.svg' })
    : makeTextNode(opts.text ?? 'a');
  const a: EditableNode = opts.desc === undefined ? aBase : { ...aBase, note: { desc: opts.desc } };
  const rootBase = makeTextNode('根', [a, c]);
  const root: EditableNode = { ...rootBase, note: setFrame(rootBase.note, 1) };

  const island = layoutFrameIsland({
    frameRoot: root,
    depth: 1,
    measure: measureOf,
    origin: { x: 0, y: 0 },
    direction: 'right',
  });
  const boxes = new Map<string, Box>(island.boxes);
  const hang = island.hangOrigins.get(g.id);
  if (hang !== undefined) boxes.set(g.id, { x: hang.x - 20, y: hang.y - ROW_H / 2, w: 40, h: ROW_H });
  return { root, a, c, g, boxes };
}

/** 渲染 FrameOutline（缺省注入零变换：屏幕坐标 = 世界坐标，断言可读） */
function renderOutline(props: Partial<React.ComponentProps<typeof FrameOutline>> = {}) {
  const f = fixture();
  const onSelect = vi.fn();
  const utils = render(
    <FrameOutline
      frameRoot={f.root}
      boxOf={(id) => f.boxes.get(id)}
      transform={{ k: 1, x: 0, y: 0 }}
      token={token}
      onSelect={onSelect}
      {...props}
    />,
  );
  return { ...utils, ...f, onSelect };
}

/** 行元素 */
function rowOf(container: HTMLElement, id: string): HTMLElement {
  const el = container.querySelector(`[data-frame-row][data-frame-node="${id}"]`);
  if (el === null) throw new Error(`夹具错误：缺行 ${id}`);
  return el as HTMLElement;
}

/** 控制器（与 frame-commands.test.ts 同款夹具） */
function controllerOf(root: EditableNode): EditorController {
  const frame = new FrameScheduler({
    raf: (cb) => {
      cb();
      return 1;
    },
    rafCancel: () => undefined,
  });
  return new EditorController(root, {}, frame);
}

describe('FrameOutline：框壳与大纲行', () => {
  it('渲染框壳 + 大纲行（= partition 大纲层，含框头；空间层节点不在框内）', () => {
    const { container, root, a, c, g } = renderOutline();
    expect(container.querySelector('[data-frame-shell]')).not.toBeNull();
    const rows = [...container.querySelectorAll('[data-frame-row]')];
    expect(rows.map((r) => r.getAttribute('data-frame-node'))).toEqual([root.id, a.id, c.id]);
    expect(container.querySelector(`[data-frame-node="${g.id}"]`)).toBeNull(); // 空间层仍走画布节点盒
    // 缩进随相对深度（框头 0 / 行 1 同缩进级）
    expect(rowOf(container, root.id).style.left < rowOf(container, a.id).style.left).toBe(true);
  });

  it('框壳包住大纲行盒 + 内边距（外壳尺寸 = 大纲包围盒 + padding）', () => {
    const { container, boxes, a, c } = renderOutline();
    const shell = container.querySelector('[data-frame-shell]') as HTMLElement;
    const left = Number.parseFloat(shell.style.left);
    const top = Number.parseFloat(shell.style.top);
    const right = left + Number.parseFloat(shell.style.width);
    const bottom = top + Number.parseFloat(shell.style.height);
    for (const id of [a.id, c.id]) {
      const b = boxes.get(id);
      if (b === undefined) throw new Error('夹具错误：缺盒');
      expect(left).toBeLessThan(b.x);
      expect(top).toBeLessThan(b.y);
      expect(right).toBeGreaterThan(b.x + b.w);
      expect(bottom).toBeGreaterThan(b.y + b.h);
    }
  });

  it('单击行 → onSelect(nodeId)', () => {
    const { container, a, onSelect } = renderOutline();
    fireEvent.click(rowOf(container, a.id));
    expect(onSelect).toHaveBeenCalledWith(a.id);
  });

  it('双击 text 行 → onEditStart(id)；编辑态该行让位自身文本（防双层）', () => {
    const onEditStart = vi.fn();
    const { container, a } = renderOutline({ onEditStart });
    fireEvent.doubleClick(rowOf(container, a.id));
    expect(onEditStart).toHaveBeenCalledWith(a.id);

    const f = fixture();
    const { container: editing } = render(
      <FrameOutline
        frameRoot={f.root}
        boxOf={(id) => f.boxes.get(id)}
        transform={{ k: 1, x: 0, y: 0 }}
        token={token}
        onSelect={vi.fn()}
        editingId={f.a.id}
      />,
    );
    expect(rowOf(editing, f.a.id).querySelector('[data-frame-row-text]')).toBeNull();
    expect(rowOf(editing, f.root.id).querySelector('[data-frame-row-text]')).not.toBeNull();
  });

  it('image/entity 行：只读占位（点击选中，双击不触发编辑）', () => {
    const f = fixture({ entity: true });
    const onSelect = vi.fn();
    const onEditStart = vi.fn();
    const { container } = render(
      <FrameOutline
        frameRoot={f.root}
        boxOf={(id) => f.boxes.get(id)}
        transform={{ k: 1, x: 0, y: 0 }}
        token={token}
        onSelect={onSelect}
        onEditStart={onEditStart}
      />,
    );
    const row = rowOf(container, f.a.id);
    expect(row.getAttribute('data-frame-placeholder')).toBe('true');
    expect(row.textContent).toContain('img:demo.svg');
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith(f.a.id);
    fireEvent.doubleClick(row);
    expect(onEditStart).not.toHaveBeenCalled(); // 一期不改 url / ref（设计 §4.3）
  });

  it('结构键与 keys.ts 对齐：Tab=建子 / Enter=建同级 / Shift+Tab=缩进 / Ctrl+Shift+Tab=反缩进', () => {
    const onFrameKey = vi.fn();
    const { container, a } = renderOutline({ onFrameKey });
    const row = rowOf(container, a.id);
    fireEvent.keyDown(row, { key: 'Tab' });
    expect(onFrameKey).toHaveBeenLastCalledWith(a.id, 'add-child');
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onFrameKey).toHaveBeenLastCalledWith(a.id, 'add-sibling');
    fireEvent.keyDown(row, { key: 'Tab', shiftKey: true });
    expect(onFrameKey).toHaveBeenLastCalledWith(a.id, 'indent');
    fireEvent.keyDown(row, { key: 'Tab', shiftKey: true, ctrlKey: true });
    expect(onFrameKey).toHaveBeenLastCalledWith(a.id, 'outdent');
    // 无关键不触发（避免抢走既有全局语义）
    fireEvent.keyDown(row, { key: 'ArrowDown' });
    expect(onFrameKey).toHaveBeenCalledTimes(4);
  });

  it('跨 depth 结构键 → controller 守卫 no-op（挂点行缩进会跨出大纲层）；同层结构键仍生效', () => {
    const f = fixture();
    const ctrl = controllerOf(f.root);
    const { container } = render(
      <FrameOutline
        frameRoot={f.root}
        boxOf={(id) => f.boxes.get(id)}
        transform={{ k: 1, x: 0, y: 0 }}
        token={token}
        onSelect={(id) => ctrl.select(id)}
        onFrameKey={(id, action) => {
          if (action === 'add-child') ctrl.addChild(id);
          else if (action === 'add-sibling') ctrl.addSibling(id);
          else if (action === 'indent') ctrl.indent(id);
          else if (action === 'outdent') ctrl.outdent(id);
        }}
      />,
    );
    // 挂点行 c：缩进会成为 a 的孩子（相对深度 2 > depth=1 → 空间层）→ 跨边界 no-op
    const before = ctrl.root;
    fireEvent.keyDown(rowOf(container, f.c.id), { key: 'Tab', shiftKey: true });
    expect(ctrl.root).toBe(before);
    expect(ctrl.canUndo).toBe(false);
    // 对照：同为结构键但不动层级 → 生效（证明接线不是死路）
    fireEvent.keyDown(rowOf(container, f.a.id), { key: 'Enter' });
    expect(ctrl.root).not.toBe(before);
  });

  it('视口裁剪：整框出屏 → 不建 DOM；框在视口内 → 正常渲染', () => {
    const f = fixture();
    const far = { x: 100000, y: 100000, w: 800, h: 600 };
    const { container } = render(
      <FrameOutline
        frameRoot={f.root}
        boxOf={(id) => f.boxes.get(id)}
        transform={{ k: 1, x: 0, y: 0 }}
        token={token}
        onSelect={vi.fn()}
        view={far}
      />,
    );
    expect(container.querySelector('[data-frame-shell]')).toBeNull();

    const near = { x: -200, y: -200, w: 800, h: 600 };
    const { container: c2 } = render(
      <FrameOutline
        frameRoot={f.root}
        boxOf={(id) => f.boxes.get(id)}
        transform={{ k: 1, x: 0, y: 0 }}
        token={token}
        onSelect={vi.fn()}
        view={near}
      />,
    );
    expect(c2.querySelector('[data-frame-shell]')).not.toBeNull();
  });

  it('FO-FIX2：有 note.desc 的行**无**旁侧「注释 …」chip（幕布注释由行下 DescBlock 显示）', () => {
    const f = fixture({ desc: '补充说明' });
    const onDescEdit = vi.fn();
    const { container } = render(
      <FrameOutline
        frameRoot={f.root}
        boxOf={(id) => f.boxes.get(id)}
        transform={{ k: 1, x: 0, y: 0 }}
        token={token}
        onSelect={vi.fn()}
        onDescEdit={onDescEdit}
      />,
    );
    // chip 已删：任何行都不再渲染旁侧注释预览（内容由既有 DescBlock/附属区负责）
    expect(container.querySelectorAll('[data-frame-comment]').length).toBe(0);
    expect(rowOf(container, f.a.id).textContent).not.toContain('注释 ');
    // Shift+Enter 仍是幕布注释编辑入口（与全局幕布编辑同入口；不依赖已删的 chip 点击）
    fireEvent.keyDown(rowOf(container, f.a.id), { key: 'Enter', shiftKey: true });
    expect(onDescEdit).toHaveBeenCalledWith(f.a.id);
  });
});

describe('FrameOutline：FO-C1 紧凑换行行', () => {
  it('text 行正文换行显示：无 nowrap / 无 ellipsis 裁切；行盒高随行数（不再是单行盒）', () => {
    const long = '这是一段需要在框内自动换行的长文本内容用来验证省略号裁切已被换行取代';
    const f = fixture({ text: long });
    const { container } = render(
      <FrameOutline
        frameRoot={f.root}
        boxOf={(id) => f.boxes.get(id)}
        transform={{ k: 1, x: 0, y: 0 }}
        token={token}
        onSelect={vi.fn()}
      />,
    );
    const row = rowOf(container, f.a.id);
    const span = row.querySelector('[data-frame-row-text]') as HTMLElement;
    expect(span.textContent).toBe(long); // 全文都在（不裁内容）
    expect(span.style.whiteSpace).toBe('normal'); // 不是 nowrap
    expect(span.style.textOverflow).toBe(''); // 无省略号
    expect(span.style.overflow).not.toBe('hidden');
    // 行盒 = 折行产出（≥ 2 行），DOM 行高与内核度量同源
    const box = f.boxes.get(f.a.id);
    expect(box?.h ?? 0).toBeGreaterThanOrEqual(2 * LINE_H);
    expect(Number.parseFloat(row.style.height)).toBeCloseTo(box?.h ?? -1, 5);
  });

  it('image/entity 行更扁：占位常量高（不跑资产预览高），仍只读占位', () => {
    const f = fixture({ entity: true });
    const { container } = render(
      <FrameOutline
        frameRoot={f.root}
        boxOf={(id) => f.boxes.get(id)}
        transform={{ k: 1, x: 0, y: 0 }}
        token={token}
        onSelect={vi.fn()}
      />,
    );
    const row = rowOf(container, f.a.id);
    expect(row.getAttribute('data-frame-placeholder')).toBe('true');
    expect(f.boxes.get(f.a.id)?.h).toBe(FRAME_OUTLINE_PLACEHOLDER_H);
    expect(Number.parseFloat(row.style.height)).toBe(FRAME_OUTLINE_PLACEHOLDER_H);
  });

  it('FO-FIX2：有 desc 的行折行不再为提示列变窄（行盒与同文案无 desc 一致）', () => {
    const text = '这是一段带有幕布注释的行文本需要在固定列宽下换行显示';
    const plain = fixture({ text });
    const commented = fixture({ text, desc: '补充说明' });
    // 同文案、同相对深度：desc 只影响行下附属区（rowAuxH），不影响正文折行宽
    expect(plain.boxes.get(plain.a.id)?.w).toBe(commented.boxes.get(commented.a.id)?.w);
    expect(plain.boxes.get(plain.a.id)?.h).toBe(commented.boxes.get(commented.a.id)?.h);
    // 且渲染层确无 chip（冗余预览已删）
  });
});
