/**
 * E5：画布级标注边编辑测试。
 * 覆盖：collectNodeChoices（id+anchor）/ edges 数组纯函数（含 mergeStyleAt 内层合并）/
 * 菜单「连线到…」/ LinkCreator 与 EdgeEditor 交互（含样式）/ controller.updateNote 全链路（undo 继承）。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { astToEditable, parseMm, makeTextNode, type EditableNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import {
  EdgeEditor,
  LinkCreator,
  collectNodeChoices,
  appendEdge,
  patchEdgeAt,
  mergeStyleAt,
  removeEdgeAt,
  edgesOf,
  findDuplicateEdge,
} from '../src/chrome/EdgeEditor.js';
import { contextMenuItemsFor } from '../src/edit/contextMenuItems.js';
import { pathWithJumps } from '../src/render/edgeRouting.js';
import { EditorController } from '../src/edit/controller.js';
import { FrameScheduler } from '../src/render/scheduler.js';
import { anchorOfNode, collectFreeEdges } from '../src/render/freeEdges.js';

function build(mm: string): EditorController {
  const frame = new FrameScheduler({
    raf: (cb) => {
      cb();
      return 1;
    },
    rafCancel: () => undefined,
  });
  return new EditorController(astToEditable(parseMm(mm).root!)!, {}, frame);
}

function fixture(): EditableNode {
  return makeTextNode('根', [makeTextNode('任务A'), makeTextNode('里程碑', [makeTextNode('M2')])]);
}

describe('collectNodeChoices：目标候选（id + anchor）', () => {
  it('生成路径锚与 id（根除外）', () => {
    const choices = collectNodeChoices(fixture());
    const byAnchor = new Map(choices.map((c) => [c.anchor, c]));
    expect(byAnchor.get('node:根/任务A')!.id).toBeTruthy();
    expect(byAnchor.get('node:根/里程碑/M2')).toBeDefined();
    expect(byAnchor.has('node:根')).toBe(false);
  });
});

describe('edges 数组纯函数', () => {
  it('append / patch / remove 不可变', () => {
    const e0 = edgesOf(undefined);
    expect(e0).toEqual([]);
    const e1 = appendEdge(e0, { from: 'node:根/A', to: 'node:根/B', rel: 'blocks' });
    const e2 = patchEdgeAt(e1, 0, { dir: 'back', label: 'L' });
    expect(e2[0]).toEqual({
      from: 'node:根/A',
      to: 'node:根/B',
      rel: 'blocks',
      dir: 'back',
      label: 'L',
    });
    expect(e1[0]).toEqual({ from: 'node:根/A', to: 'node:根/B', rel: 'blocks' });
    expect(removeEdgeAt(e2, 0)).toEqual([]);
  });
  it('mergeStyleAt：style 内层合并；清空 → 移除 style 键', () => {
    const arr = [{ from: 'a', to: 'b', rel: 'blocks' }];
    const s1 = mergeStyleAt(arr, 0, { color: '#e24b4a' });
    expect(s1[0]!.style).toEqual({ color: '#e24b4a' });
    const s2 = mergeStyleAt(s1, 0, { color: '#10b981', dashed: true, width: 3 });
    expect(s2[0]!.style).toEqual({ color: '#10b981', dashed: true, width: 3 });
    const s3 = mergeStyleAt(s2, 0, { color: undefined, dashed: undefined, width: undefined });
    expect(s3[0]!.style).toBeUndefined();
  });
  it('mergeStyleAt：显式 undefined = 清除（治「默认按钮/取消虚线失效」bug）', () => {
    const arr = [{ from: 'a', to: 'b', rel: 'blocks', style: { color: '#e24b4a', dashed: true } }];
    // 选了色再点默认 → color 清除，dashed 保留
    const s1 = mergeStyleAt(arr, 0, { color: undefined });
    expect(s1[0]!.style).toEqual({ dashed: true });
    // 取消虚线 → dashed 清除，color 保留
    const s2 = mergeStyleAt(s1, 0, { dashed: undefined });
    expect(s2[0]!.style).toBeUndefined(); // 全空 → style 键整体移除
  });
  it('findDuplicateEdge：同 from+to+rel 命中，rel 不同不算', () => {
    const arr = [
      { from: 'a', to: 'b', rel: 'blocks' },
      { from: 'a', to: 'c', rel: 'blocks' },
    ];
    expect(findDuplicateEdge(arr, { from: 'a', to: 'b', rel: 'blocks' })).toBe(0);
    expect(findDuplicateEdge(arr, { from: 'a', to: 'b', rel: 'causes' })).toBe(-1);
  });
  it('R6-S2：patchEdgeAt 后 attrs 原样在（spread 语义保真钉——防未来改成从 FreeEdge 重建 DocEdge）', () => {
    const attrs = { severity: 'high' };
    const arr = [{ from: 'a', to: 'b', rel: 'blocks', attrs }];
    const next = patchEdgeAt(arr, 0, { label: 'x' });
    const patched = next[0];
    const original = arr[0];
    if (patched === undefined || original === undefined) throw new Error('条目缺失');
    expect(patched.label).toBe('x');
    expect(patched.attrs).toBe(attrs); // 引用原样（未知键经 spread 保留）
    expect(original.attrs).toBe(attrs); // 不可变：原数组未被改写
  });
});

describe('菜单「连线到…」（E5）', () => {
  const MM = '# 根\n\n- A\n- B\n';
  it('缺省 edgeActions → 不追加（向后兼容）', () => {
    const c = build(MM);
    const labels = contextMenuItemsFor(c, c.root.children[0]!.id).map((i) => i.label);
    expect(labels).not.toContain('连线到…');
  });
  it('传入 edgeActions → 追加项且回调生效', () => {
    const c = build(MM);
    const onStartLink = vi.fn();
    const id = c.root.children[0]!.id;
    const items = contextMenuItemsFor(c, id, undefined, { onStartLink });
    const item = items.find((i) => i.label === '连线到…')!;
    expect(item).toBeDefined();
    item.onSelect?.();
    expect(onStartLink).toHaveBeenCalledWith(id);
  });
});

describe('LinkCreator 交互（含样式）', () => {
  it('搜索候选 → 选中 → 创建（dir/label/note/style 条件字段）', () => {
    const onCreate = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <LinkCreator
          choices={collectNodeChoices(fixture())}
          x={10}
          y={10}
          onCreate={onCreate}
          onClose={() => undefined}
        />
      </ThemeProvider>,
    );
    fireEvent.change(container.querySelector('[data-link-query]')!, { target: { value: 'M2' } });
    fireEvent.click(container.querySelector('[data-link-choice]')!);
    fireEvent.change(container.querySelector('[data-link-rel]')!, { target: { value: 'blocks' } });
    fireEvent.click(container.querySelector('[data-dir-opt="both"]')!);
    fireEvent.click(container.querySelector('[data-style-color="#e24b4a"]')!);
    fireEvent.click(container.querySelector('[data-link-create]')!);
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate.mock.calls[0]![0]).toEqual({
      from: '',
      to: 'node:根/里程碑/M2',
      rel: 'blocks',
      dir: 'both',
      style: { color: '#e24b4a' },
    });
  });
});

describe('EdgeEditor 交互（含样式）', () => {
  const edge = {
    key: 'e0',
    index: 0,
    rel: 'blocks',
    dir: 'fwd' as const,
    from: 'node:根/A',
    to: 'node:根/B',
  };
  it('改 rel/dir/label → onChange；样式色 → onStyle', () => {
    const onChange = vi.fn();
    const onStyle = vi.fn();
    const onInvalidate = vi.fn();
    const onRestore = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <EdgeEditor
          edge={edge}
          x={10}
          y={10}
          onChange={onChange}
          onStyle={onStyle}
          onInvalidate={onInvalidate}
          onRestore={onRestore}
          onDelete={() => undefined}
          onClose={() => undefined}
        />
      </ThemeProvider>,
    );
    fireEvent.change(container.querySelector('[data-edge-rel]')!, { target: { value: 'causes' } });
    expect(onChange).toHaveBeenLastCalledWith({ rel: 'causes' });
    fireEvent.click(container.querySelector('[data-dir-opt="back"]')!);
    expect(onChange).toHaveBeenLastCalledWith({ dir: 'back' });
    fireEvent.change(container.querySelector('[data-edge-label]')!, {
      target: { value: '硬依赖' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ label: '硬依赖' });
    fireEvent.click(container.querySelector('[data-style-color="#10b981"]')!);
    expect(onStyle).toHaveBeenLastCalledWith({ color: '#10b981' });
    fireEvent.click(container.querySelector('[data-style-default]')!);
    expect(onStyle).toHaveBeenLastCalledWith({ color: undefined });
  });
  it('绕行侧三态：routingSide 写回（↰/↱）与回切自动（forceSide 可见化）', () => {
    const onChange = vi.fn();
    const onInvalidate = vi.fn();
    const onRestore = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <EdgeEditor
          edge={edge}
          x={10}
          y={10}
          onChange={onChange}
          onStyle={() => undefined}
          onInvalidate={onInvalidate}
          onRestore={onRestore}
          onDelete={() => undefined}
          onClose={() => undefined}
        />
      </ThemeProvider>,
    );
    fireEvent.click(container.querySelector('[data-routing-side-opt="left"]')!);
    expect(onChange).toHaveBeenLastCalledWith({ routingSide: 'left' });
    fireEvent.click(container.querySelector('[data-routing-side-opt="right"]')!);
    expect(onChange).toHaveBeenLastCalledWith({ routingSide: 'right' });
    fireEvent.click(container.querySelector('[data-routing-side-opt="auto"]')!);
    expect(onChange).toHaveBeenLastCalledWith({ routingSide: undefined });
  });
  it('删除 → onDelete 回调', () => {
    const onDelete = vi.fn();
    const onInvalidate = vi.fn();
    const onRestore = vi.fn();
    const { container, rerender } = render(
      <ThemeProvider>
        <EdgeEditor
          edge={edge}
          x={10}
          y={10}
          onChange={() => undefined}
          onStyle={() => undefined}
          onInvalidate={onInvalidate}
          onRestore={onRestore}
          onDelete={onDelete}
          onClose={() => undefined}
        />
      </ThemeProvider>,
    );
    fireEvent.click(container.querySelector('[data-edge-invalidate]')!);
    expect(onInvalidate).toHaveBeenCalledTimes(1);
    // 已失效态 → 恢复按钮出现 → 点击触发 onRestore
    rerender(
      <ThemeProvider>
        <EdgeEditor
          edge={{ ...edge, invalidAt: '2026-08-31T00:00:00Z' }}
          x={10}
          y={10}
          onChange={() => undefined}
          onStyle={() => undefined}
          onInvalidate={onInvalidate}
          onRestore={onRestore}
          onDelete={onDelete}
          onClose={() => undefined}
        />
      </ThemeProvider>,
    );
    expect(container.querySelector('[data-edge-invalidated]')).not.toBeNull();
    expect(container.querySelector('[data-edge-restore]')).not.toBeNull();
    fireEvent.click(container.querySelector('[data-edge-restore]')!);
    expect(onRestore).toHaveBeenCalledTimes(1);
    // 彻底删除仍可用
    fireEvent.click(container.querySelector('[data-edge-delete]')!);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

describe('全链路：updateNote(root) 写入 → 画布边可见 → 编辑 → 删除（undo 继承）', () => {
  it('创建 → 样式覆盖 → 删除 → undo 恢复', () => {
    const c = build('# 根\n\n- A\n- B\n');
    const rootId = c.root.id;
    // 创建（文档级）
    c.updateNote(rootId, {
      edges: appendEdge(edgesOf(c.root.note), {
        from: 'node:根/A',
        to: 'node:根/B',
        rel: 'blocks',
        label: '依赖',
      }),
    });
    let edges = collectFreeEdges(c.root);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.sourceId).toBe(c.root.children[0]!.id);
    expect(edges[0]!.targetId).toBe(c.root.children[1]!.id);
    // 样式覆盖
    c.updateNote(rootId, {
      edges: mergeStyleAt(edgesOf(c.root.note), 0, { color: '#7f77dd', dashed: true }),
    });
    edges = collectFreeEdges(c.root);
    expect(edges[0]!.style).toEqual({ color: '#7f77dd', dashed: true });
    // 删除 + undo 恢复（含样式）
    c.updateNote(rootId, { edges: removeEdgeAt(edgesOf(c.root.note), 0) });
    expect(collectFreeEdges(c.root)).toHaveLength(0);
    // T22：删除自由边不拆树——节点与结构原样
    expect(c.root.children.map((n) => n.text)).toEqual(['A', 'B']);
    expect(c.root.text).toBe('根');
    expect(c.undo()).toBe(true);
    edges = collectFreeEdges(c.root);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.style).toEqual({ color: '#7f77dd', dashed: true });
  });
  it('E6.1：软失效 → 恢复；来源标记透传', () => {
    const c = build('# 根\n\n- A\n- B\n');
    const rootId = c.root.id;
    c.updateNote(rootId, {
      edges: [{ from: 'node:根/A', to: 'node:根/B', rel: 'blocks', source: 'manual' }],
    });
    c.updateNote(rootId, {
      edges: patchEdgeAt(edgesOf(c.root.note), 0, { invalidAt: '2026-08-31T00:00:00Z' }),
    });
    const edges = collectFreeEdges(c.root);
    expect(edges[0]!.invalidAt).toBe('2026-08-31T00:00:00Z');
    expect(edges[0]!.source).toBe('manual');
    // 恢复 = 清空 invalidAt
    c.updateNote(rootId, { edges: patchEdgeAt(edgesOf(c.root.note), 0, { invalidAt: undefined }) });
    expect(collectFreeEdges(c.root)[0]!.invalidAt).toBeUndefined();
  });
  it('E8：持久化往返——含实体锚的边序列化后重解析仍命中同一对节点', () => {
    const c = build('# Agent Gateway\n\n## 任务\n\n- @issue:8\n\n## 想法\n\n- 先只读\n');
    const rootId = c.root.id;
    const all: EditableNode[] = [];
    {
      const walk = (n: EditableNode): void => {
        all.push(n);
        n.children.forEach(walk);
      };
      walk(c.root);
    }
    const issue8 = all.find((n) => n.type === 'entity')!;
    const think = all.find((n) => n.text === '先只读')!;
    const from = anchorOfNode(c.root, think.id)!;
    const to = anchorOfNode(c.root, issue8.id)!;
    expect(to).toBe('@issue:8');
    c.updateNote(rootId, {
      edges: appendEdge(edgesOf(c.root.note), {
        from,
        to,
        rel: 'blocks',
        label: '待验证',
        source: 'manual',
      }),
    });
    // 序列化 → 重解析（模拟保存/重开）
    const text = c.serialize();
    const c2 = build(text);
    const e2 = collectFreeEdges(c2.root);
    expect(e2).toHaveLength(1);
    expect(e2[0]!.rel).toBe('blocks');
    expect(e2[0]!.label).toBe('待验证');
    expect(e2[0]!.sourceId).not.toBeNull();
    expect(e2[0]!.targetId).not.toBeNull();
    // 目标仍是那个实体节点（按 ref 判定，而非会话内 id）
    const all2: EditableNode[] = [];
    {
      const walk = (n: EditableNode): void => {
        all2.push(n);
        n.children.forEach(walk);
      };
      walk(c2.root);
    }
    const t2 = all2.find((n) => n.id === e2[0]!.targetId)!;
    expect(t2.type).toBe('entity');
    expect(t2.ref).toEqual({ kind: 'issue', id: '8' });
    const s2 = all2.find((n) => n.id === e2[0]!.sourceId)!;
    expect(s2.text).toBe('先只读');
  });
});

describe('EdgeEditor 重挂入口（R2-1）', () => {
  /** 缺元素即抛错（替代 `!` 断言——新增代码零 lint 告警纪律） */
  function q(sel: string, root: ParentNode): Element {
    const el = root.querySelector(sel);
    if (el === null) throw new Error(`element not found: ${sel}`);
    return el;
  }
  const baseEdge = {
    key: 'e0',
    index: 0,
    rel: 'blocks',
    dir: 'fwd' as const,
    from: 'node:根/A',
    to: 'node:根/B',
  };
  const choices = [
    { id: 'n1', label: '任务', anchor: 'node:根/任务' },
    { id: 'n2', label: '生活', anchor: 'node:根/生活' },
  ];

  it('注入 choices+onReattach → 出现 from/to 两个重挂入口', () => {
    const { container } = render(
      <ThemeProvider>
        <EdgeEditor
          edge={baseEdge}
          x={10}
          y={10}
          onChange={vi.fn()}
          onStyle={vi.fn()}
          onInvalidate={vi.fn()}
          onRestore={vi.fn()}
          onDelete={() => undefined}
          onClose={() => undefined}
          choices={choices}
          onReattach={vi.fn()}
        />
      </ThemeProvider>,
    );
    expect(q('[data-reattach-from]', container)).toBeDefined();
    expect(q('[data-reattach-to]', container)).toBeDefined();
  });

  it('缺省（不注入）→ 无重挂入口（向后兼容钉死）', () => {
    const { container } = render(
      <ThemeProvider>
        <EdgeEditor
          edge={baseEdge}
          x={10}
          y={10}
          onChange={vi.fn()}
          onStyle={vi.fn()}
          onInvalidate={vi.fn()}
          onRestore={vi.fn()}
          onDelete={() => undefined}
          onClose={() => undefined}
        />
      </ThemeProvider>,
    );
    expect(container.querySelector('[data-reattach-from]')).toBeNull();
    expect(container.querySelector('[data-reattach-to]')).toBeNull();
  });

  it('点 from 入口 → picker 打开 → 选题 → onReattach("from", anchor)', () => {
    const onReattach = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <EdgeEditor
          edge={baseEdge}
          x={10}
          y={10}
          onChange={vi.fn()}
          onStyle={vi.fn()}
          onInvalidate={vi.fn()}
          onRestore={vi.fn()}
          onDelete={() => undefined}
          onClose={() => undefined}
          choices={choices}
          onReattach={onReattach}
        />
      </ThemeProvider>,
    );
    fireEvent.click(q('[data-reattach-from]', container));
    const option = q('[data-edge-anchor-option="node:根/生活"]', container); // picker 已打开
    fireEvent.click(option);
    expect(onReattach).toHaveBeenCalledTimes(1);
    expect(onReattach).toHaveBeenCalledWith('from', 'node:根/生活');
  });
});

describe('EdgeEditor manual 边禁用 routingSide/Opp（R3-1）', () => {
  /** 缺元素即抛错（替代 `!` 断言——新增代码零 lint 告警纪律） */
  function q3(sel: string, root: ParentNode): Element {
    const el = root.querySelector(sel);
    if (el === null) throw new Error(`element not found: ${sel}`);
    return el;
  }
  const plainEdge = {
    key: 'e0',
    index: 0,
    rel: 'blocks',
    dir: 'fwd' as const,
    from: 'node:根/A',
    to: 'node:根/B',
  };
  const manualEdge = { ...plainEdge, manual: { curvature: 0.3 } };

  function mountEditor(edge: typeof plainEdge, onChange: (p: unknown) => void) {
    return render(
      <ThemeProvider>
        <EdgeEditor
          edge={edge}
          x={10}
          y={10}
          onChange={onChange}
          onStyle={vi.fn()}
          onInvalidate={vi.fn()}
          onRestore={vi.fn()}
          onDelete={() => undefined}
          onClose={() => undefined}
        />
      </ThemeProvider>,
    );
  }

  it('带 manual → Opp 与 routingSide 三钮全部禁用（disabled + aria-disabled）', () => {
    const { container } = mountEditor(manualEdge, vi.fn());
    const opp = q3('[data-edge-opp]', container) as HTMLButtonElement;
    expect(opp.disabled).toBe(true);
    expect(opp.getAttribute('aria-disabled')).toBe('true');
    const opts = container.querySelectorAll('[data-routing-side-opt]');
    expect(opts.length).toBe(3);
    opts.forEach((o) => {
      expect((o as HTMLButtonElement).disabled).toBe(true);
      expect(o.getAttribute('aria-disabled')).toBe('true');
    });
  });

  it('点击禁用控件 → onChange 不被调用（今天：可点且会写）', () => {
    const onChange = vi.fn();
    const { container } = mountEditor(manualEdge, onChange);
    fireEvent.click(q3('[data-edge-opp]', container));
    fireEvent.click(q3('[data-routing-side-opt="left"]', container));
    fireEvent.click(q3('[data-routing-side-opt="auto"]', container));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('无 manual → 控件可用，routingSide/Opp 行为不变（回归钉）', () => {
    const onChange = vi.fn();
    const { container } = mountEditor(plainEdge, onChange);
    const opp = q3('[data-edge-opp]', container) as HTMLButtonElement;
    expect(opp.disabled).toBe(false);
    const leftOpt = q3('[data-routing-side-opt="left"]', container) as HTMLButtonElement;
    expect(leftOpt.disabled).toBe(false);
    fireEvent.click(leftOpt);
    expect(onChange).toHaveBeenCalledWith({ routingSide: 'left' });
  });

  it('禁用态 tooltip 指引恢复入口：文案含「双击 bend 恢复自动」', () => {
    const { container } = mountEditor(manualEdge, vi.fn());
    const opp = q3('[data-edge-opp]', container) as HTMLButtonElement;
    expect(opp.getAttribute('title')).toContain('双击 bend 恢复自动');
    const toggle = q3('[data-routing-side-toggle]', container);
    toggle.querySelectorAll('button').forEach((b) => {
      expect(b.getAttribute('title')).toContain('双击 bend 恢复自动');
    });
  });
});

describe('EdgeEditor Opp：跳线判定与 auto 兜底提示（R3-2）', () => {
  /** 缺元素即抛错（替代 `!` 断言——新增代码零 lint 告警纪律） */
  function q4(sel: string, root: ParentNode): Element {
    const el = root.querySelector(sel);
    if (el === null) throw new Error(`element not found: ${sel}`);
    return el;
  }
  const oppEdge = {
    key: 'e0',
    index: 0,
    rel: 'blocks',
    dir: 'fwd' as const,
    from: 'node:根/A',
    to: 'node:根/B',
  };
  /** 弓向上的跳线 d（pathWithJumps 真实输出）→ inferBowSide 应判 left */
  const jumpedLeftD = pathWithJumps(
    [
      { x: 0, y: 100 },
      { x: 100, y: 60 },
      { x: 200, y: 100 },
    ],
    [{ x: 50, y: 80 }],
  );

  function mountOpp(currentD: string, onChange: (p: unknown) => void) {
    return render(
      <ThemeProvider>
        <EdgeEditor
          edge={oppEdge}
          x={10}
          y={10}
          currentD={currentD}
          onChange={onChange}
          onStyle={vi.fn()}
          onInvalidate={vi.fn()}
          onRestore={vi.fn()}
          onDelete={() => undefined}
          onClose={() => undefined}
        />
      </ThemeProvider>,
    );
  }

  /** R5-1 补：鼓向首选来源 = 路由顶点（`currentBowSide`）；字符串 d 仅作回落 */
  function mountOppWithSide(
    currentD: string,
    currentBowSide: 'left' | 'right' | 'auto',
    onChange: (p: unknown) => void,
  ) {
    return render(
      <ThemeProvider>
        <EdgeEditor
          edge={oppEdge}
          x={10}
          y={10}
          currentD={currentD}
          currentBowSide={currentBowSide}
          onChange={onChange}
          onStyle={vi.fn()}
          onInvalidate={vi.fn()}
          onRestore={vi.fn()}
          onDelete={() => undefined}
          onClose={() => undefined}
        />
      </ThemeProvider>,
    );
  }

  it('直线上带跳线：currentBowSide=auto 优先于 currentD → 落 right（auto 兜底，不按跳线方向翻转）', () => {
    // 直线 + 折线跳桥：只看 d 会解析出 'right'（跳线方向）→ 落 left（R5-1 漂移）；
    // 顶点法给 'auto' → 落 right（与 R5-1 之前的 auto 兜底行为一致）。
    const bridgedStraight = pathWithJumps(
      [
        { x: 0, y: 100 },
        { x: 200, y: 100 },
      ],
      [{ x: 100, y: 100 }],
    );
    const onChange = vi.fn();
    const { container } = mountOppWithSide(bridgedStraight, 'auto', onChange);
    fireEvent.click(q4('[data-edge-opp]', container));
    expect(onChange).toHaveBeenCalledWith({ routingSide: 'right' });
  });

  it('currentBowSide 缺省（旧调用方）→ 回落 currentD 字符串解析（兼容钉）', () => {
    const onChange = vi.fn();
    const { container } = mountOpp(jumpedLeftD, onChange);
    fireEvent.click(q4('[data-edge-opp]', container));
    expect(onChange).toHaveBeenCalledWith({ routingSide: 'right' }); // 上弓 left → 翻 right
  });

  it('跳线边点 Opp → routingSide 翻到另一侧（今天：恒落 right）', () => {
    const onChange = vi.fn();
    const { container } = mountOpp(jumpedLeftD, onChange);
    fireEvent.click(q4('[data-edge-opp]', container));
    // 当前鼓向 = left → Opp 应置 right（旧实现 inferBowSide='auto' 恒落 right，恰好同值；
    // 弓向下的跳线用例才是判别性的，见下一用例）
    expect(onChange).toHaveBeenCalledWith({ routingSide: 'right' });
  });

  it('弓向下的跳线边点 Opp → 翻到 left（判别性用例：旧实现恒落 right 必红）', () => {
    const jumpedRightD = pathWithJumps(
      [
        { x: 0, y: 100 },
        { x: 100, y: 140 },
        { x: 200, y: 100 },
      ],
      [{ x: 50, y: 120 }],
    );
    const onChange = vi.fn();
    const { container } = mountOpp(jumpedRightD, onChange);
    fireEvent.click(q4('[data-edge-opp]', container));
    expect(onChange).toHaveBeenCalledWith({ routingSide: 'left' });
  });

  it("inferBowSide 'auto' 兜底：仍落 right 但行内提示出现（不再静默）", () => {
    const onChange = vi.fn();
    const { container } = mountOpp('M 0 0 L 100 0', onChange);
    fireEvent.click(q4('[data-edge-opp]', container));
    expect(onChange).toHaveBeenCalledWith({ routingSide: 'right' });
    expect(container.querySelector('[data-edge-auto-hint]')).not.toBeNull();
  });
});

describe('EdgeEditor onDirChange（R3-3）', () => {
  /** 缺元素即抛错（替代 `!` 断言——新增代码零 lint 告警纪律） */
  function q5(sel: string, root: ParentNode): Element {
    const el = root.querySelector(sel);
    if (el === null) throw new Error(`element not found: ${sel}`);
    return el;
  }
  const dirEdge = {
    key: 'e0',
    index: 0,
    rel: 'blocks',
    dir: 'fwd' as const,
    from: 'node:根/A',
    to: 'node:根/B',
  };

  it('注入 onDirChange → DirToggle 点击走 onDirChange 且不经 onChange', () => {
    const onChange = vi.fn();
    const onDirChange = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <EdgeEditor
          edge={dirEdge}
          x={10}
          y={10}
          onChange={onChange}
          onStyle={vi.fn()}
          onInvalidate={vi.fn()}
          onRestore={vi.fn()}
          onDelete={() => undefined}
          onClose={() => undefined}
          onDirChange={onDirChange}
        />
      </ThemeProvider>,
    );
    fireEvent.click(q5('[data-dir-opt="back"]', container));
    expect(onDirChange).toHaveBeenCalledTimes(1);
    expect(onDirChange).toHaveBeenCalledWith('back');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('缺省（不注入）→ 回落 onChange({dir})（向后兼容钉）', () => {
    const onChange = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <EdgeEditor
          edge={dirEdge}
          x={10}
          y={10}
          onChange={onChange}
          onStyle={vi.fn()}
          onInvalidate={vi.fn()}
          onRestore={vi.fn()}
          onDelete={() => undefined}
          onClose={() => undefined}
        />
      </ThemeProvider>,
    );
    fireEvent.click(q5('[data-dir-opt="both"]', container));
    expect(onChange).toHaveBeenCalledWith({ dir: 'both' });
  });
});

describe('EdgeEditor forcedSideFallback 提示（R3-4）', () => {
  const fbEdge = {
    key: 'e0',
    index: 0,
    rel: 'blocks',
    dir: 'fwd' as const,
    from: 'node:根/A',
    to: 'node:根/B',
  };

  it('注入 forcedSideFallback → 行内提示出现（指定侧不可行：已回退直连）', () => {
    const { container } = render(
      <ThemeProvider>
        <EdgeEditor
          edge={fbEdge}
          x={10}
          y={10}
          onChange={vi.fn()}
          onStyle={vi.fn()}
          onInvalidate={vi.fn()}
          onRestore={vi.fn()}
          onDelete={() => undefined}
          onClose={() => undefined}
          forcedSideFallback
        />
      </ThemeProvider>,
    );
    const hint = container.querySelector('[data-edge-fallback-hint]');
    if (hint === null) throw new Error('fallback hint not found');
    expect(hint.textContent).toContain('指定侧不可行');
    expect(hint.textContent).toContain('直连');
  });

  it('不注入 / 为 false → 提示不出现（向后兼容）', () => {
    const without = render(
      <ThemeProvider>
        <EdgeEditor
          edge={fbEdge}
          x={10}
          y={10}
          onChange={vi.fn()}
          onStyle={vi.fn()}
          onInvalidate={vi.fn()}
          onRestore={vi.fn()}
          onDelete={() => undefined}
          onClose={() => undefined}
        />
      </ThemeProvider>,
    );
    expect(without.container.querySelector('[data-edge-fallback-hint]')).toBeNull();
    without.unmount();
    const off = render(
      <ThemeProvider>
        <EdgeEditor
          edge={fbEdge}
          x={10}
          y={10}
          onChange={vi.fn()}
          onStyle={vi.fn()}
          onInvalidate={vi.fn()}
          onRestore={vi.fn()}
          onDelete={() => undefined}
          onClose={() => undefined}
          forcedSideFallback={false}
        />
      </ThemeProvider>,
    );
    expect(off.container.querySelector('[data-edge-fallback-hint]')).toBeNull();
  });
});

describe('EdgeEditor 反向按钮（R4-2）', () => {
  const revEdge = {
    key: 'e0',
    index: 0,
    rel: 'causes',
    dir: 'fwd' as const,
    from: 'node:根/A',
    to: 'node:根/B',
  };

  it('注入 onReverse → 「反向」按钮出现且点击触发一次', () => {
    const onReverse = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <EdgeEditor
          edge={revEdge}
          x={10}
          y={10}
          onChange={vi.fn()}
          onStyle={vi.fn()}
          onInvalidate={vi.fn()}
          onRestore={vi.fn()}
          onDelete={() => undefined}
          onClose={() => undefined}
          onReverse={onReverse}
        />
      </ThemeProvider>,
    );
    const btn = container.querySelector('[data-edge-reverse]');
    if (btn === null) throw new Error('reverse button not found');
    fireEvent.click(btn);
    expect(onReverse).toHaveBeenCalledTimes(1);
  });

  it('缺省（不注入）→ 不渲染反向按钮（向后兼容钉）', () => {
    const { container } = render(
      <ThemeProvider>
        <EdgeEditor
          edge={revEdge}
          x={10}
          y={10}
          onChange={vi.fn()}
          onStyle={vi.fn()}
          onInvalidate={vi.fn()}
          onRestore={vi.fn()}
          onDelete={() => undefined}
          onClose={() => undefined}
        />
      </ThemeProvider>,
    );
    expect(container.querySelector('[data-edge-reverse]')).toBeNull();
  });
});

describe('EdgeEditor attrs 只读属性区（R6-S2b）', () => {
  /** 缺元素即抛错（替代 `!` 断言——新增代码零 lint 告警纪律） */
  function qa(sel: string, root: ParentNode): Element {
    const el = root.querySelector(sel);
    if (el === null) throw new Error(`element not found: ${sel}`);
    return el;
  }

  const attrsEdge = {
    key: 'e0',
    index: 0,
    rel: 'blocks',
    dir: 'fwd' as const,
    from: 'node:根/A',
    to: 'node:根/B',
    attrs: { severity: 'high', w: 3, team: 'core' },
  };

  function mount(edge: {
    key: string;
    index: number;
    rel: string;
    dir: 'fwd' | 'back' | 'both';
    from: string;
    to: string;
    attrs?: Record<string, unknown>;
  }) {
    return render(
      <ThemeProvider>
        <EdgeEditor
          edge={edge}
          x={10}
          y={10}
          onChange={vi.fn()}
          onStyle={vi.fn()}
          onInvalidate={vi.fn()}
          onRestore={vi.fn()}
          onDelete={() => undefined}
          onClose={() => undefined}
        />
      </ThemeProvider>,
    );
  }

  it('含 attrs → 属性区出现：N 项计数 + 最多 2 行 `k = v` + title 全量；只读（无输入控件）', () => {
    const { container } = mount(attrsEdge);
    const area = qa('[data-edge-attrs]', container);
    expect(area.textContent).toContain('属性 3 项');
    expect(area.textContent).toContain('severity = high');
    expect(area.textContent).toContain('w = 3');
    // 最多 2 行（264px 紧凑卡：超出不展开，计数由标题行交代）
    const rows = area.querySelectorAll('[data-edge-attr-row]');
    expect(rows.length).toBe(2);
    const row0 = rows[0];
    if (row0 === undefined) throw new Error('attr 行缺失');
    expect(row0.textContent).toBe('severity = high');
    expect(row0.getAttribute('title')).toBe('severity = high');
    // 只读：区内不得出现输入控件（不提供编辑，R6-A4）
    expect(area.querySelector('input')).toBeNull();
    expect(area.querySelector('button')).toBeNull();
  });

  it('无 attrs / 空对象 → 不渲染该区（既有布局零变化，向后兼容）', () => {
    const plain = mount({
      key: 'e0',
      index: 0,
      rel: 'blocks',
      dir: 'fwd',
      from: 'node:根/A',
      to: 'node:根/B',
    });
    expect(plain.container.querySelector('[data-edge-attrs]')).toBeNull();
    plain.unmount();
    const empty = mount({ ...attrsEdge, attrs: {} });
    expect(empty.container.querySelector('[data-edge-attrs]')).toBeNull();
    empty.unmount();
  });

  it('长值（>200 字符）单行省略不爆版：nowrap + ellipsis；DOM 文本与 title 给全量', () => {
    const long = 'x'.repeat(240);
    const { container } = mount({ ...attrsEdge, attrs: { memo: long } });
    const row = qa('[data-edge-attr-row]', container);
    expect(row.textContent).toBe(`memo = ${long}`);
    expect(row.getAttribute('style')).toContain('nowrap');
    expect(row.getAttribute('style')).toContain('ellipsis');
    expect(row.getAttribute('title')).toBe(`memo = ${long}`);
  });
});
