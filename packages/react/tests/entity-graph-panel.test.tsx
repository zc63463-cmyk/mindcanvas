// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { EntityGraphPanel } from '../src/chrome/EntityGraphPanel.js';
import type { EntityRelation } from '../src/chrome/entityGraph.js';

const rels: EntityRelation[] = [
  {
    ref: { kind: 'issue', id: '1' },
    kind: 'issue',
    title: '门户显示优化',
    refNodes: [
      { nodeId: 'n1', text: '任务 A' },
      { nodeId: 'n2', text: '任务 B' },
    ],
  },
  {
    ref: { kind: 'doc', id: 'docs/a.md' },
    kind: 'doc',
    title: '01 架构',
    refNodes: [{ nodeId: 'n3', text: '关联文档' }],
  },
];

describe('EntityGraphPanel（F1：实体关系图视图）', () => {
  it('实体列表：kind 徽章 + 标题 + 引用数', () => {
    const { container } = render(
      <EntityGraphPanel relations={rels} onFocusNode={vi.fn()} onClose={vi.fn()} />,
    );
    const items = container.querySelectorAll('[data-entity-item]');
    expect(items.length).toBe(2);
    expect(container.textContent).toContain('@issue');
    expect(container.textContent).toContain('门户显示优化');
    expect(container.textContent).toContain('@doc');
    expect(container.textContent).toContain('2'); // issue 引用数
  });

  it('点实体 → 径向图出现（中心 + 引用节点 + 连线）', () => {
    const { container } = render(
      <EntityGraphPanel relations={rels} onFocusNode={vi.fn()} onClose={vi.fn()} />,
    );
    expect(container.querySelector('svg[data-relation-graph]')).toBeNull(); // 未选中 → 提示
    fireEvent.click(container.querySelectorAll('[data-entity-item]')[0]!);
    expect(container.querySelector('svg[data-relation-graph]')).not.toBeNull();
    expect(container.querySelector('[data-entity-center]')).not.toBeNull();
    expect(container.querySelectorAll('[data-ref-node]').length).toBe(2);
    expect(container.querySelectorAll('svg[data-relation-graph] line').length).toBe(2);
  });

  it('点引用节点 → onFocusNode(nodeId)', () => {
    const focus = vi.fn();
    const { container } = render(
      <EntityGraphPanel relations={rels} onFocusNode={focus} onClose={vi.fn()} />,
    );
    fireEvent.click(container.querySelectorAll('[data-entity-item]')[0]!);
    fireEvent.click(container.querySelectorAll('[data-ref-node]')[0]!);
    expect(focus).toHaveBeenCalledWith('n1');
  });

  it('activeRefKey → 对应实体项高亮（data-active）', () => {
    const { container } = render(
      <EntityGraphPanel
        relations={rels}
        activeRefKey="doc:docs/a.md"
        onFocusNode={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const items = container.querySelectorAll('[data-entity-item]');
    expect(items[1]!.getAttribute('data-active')).toBeDefined();
    expect(items[0]!.getAttribute('data-active')).toBeNull();
  });

  it('空关系 → 空态引导；关闭按钮 → onClose', () => {
    const close = vi.fn();
    const { container } = render(
      <EntityGraphPanel relations={[]} onFocusNode={vi.fn()} onClose={close} />,
    );
    expect(container.textContent).toContain('暂无实体引用');
    fireEvent.click(container.querySelector('[data-relation-close]')!);
    expect(close).toHaveBeenCalled();
  });
});

// ---------- E4：语义边区（连线一等公民）+ 星型降级 ----------
import type { EdgeListItem } from '../src/chrome/EntityGraphPanel.js';

const edgeItems: EdgeListItem[] = [
  {
    key: 'n1#0',
    rel: 'blocks',
    dir: 'fwd',
    sourceId: 'n1',
    sourceText: '任务 A',
    targetId: 'n4',
    targetText: '里程碑 M2',
  },
  {
    key: 'n3#0',
    rel: 'relates-to',
    dir: 'back',
    sourceId: 'n3',
    sourceText: '关联文档',
    targetId: null,
    targetText: 'issue:777',
  },
];

describe('EntityGraphPanel 语义边区（E4）', () => {
  it('edges 传入 → 连线区渲染（rel + 方向箭头 + 目标文本）', () => {
    const { container } = render(
      <EntityGraphPanel
        relations={rels}
        edges={edgeItems}
        onFocusNode={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const section = container.querySelector('[data-edge-section]');
    expect(section).not.toBeNull();
    expect(container.textContent).toContain('连线 2');
    expect(container.textContent).toContain('blocks');
    expect(container.textContent).toContain('任务 A → 里程碑 M2');
    expect(container.textContent).toContain('关联文档 ← issue:777');
  });

  it('点边行 → onFocusNode(源节点)', () => {
    const focus = vi.fn();
    const { container } = render(
      <EntityGraphPanel relations={[]} edges={edgeItems} onFocusNode={focus} onClose={vi.fn()} />,
    );
    fireEvent.click(container.querySelectorAll('[data-edge-item]')[0]!);
    expect(focus).toHaveBeenCalledWith('n1');
  });

  it('星型降级：仅点实体条目才出现星图；边行点击不触星图', () => {
    const { container } = render(
      <EntityGraphPanel
        relations={rels}
        edges={edgeItems}
        onFocusNode={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container.querySelector('svg[data-relation-graph]')).toBeNull(); // 默认无星图
    fireEvent.click(container.querySelectorAll('[data-edge-item]')[0]!);
    expect(container.querySelector('svg[data-relation-graph]')).toBeNull();
    fireEvent.click(container.querySelectorAll('[data-entity-item]')[0]!);
    expect(container.querySelector('svg[data-relation-graph]')).not.toBeNull();
  });

  it('缺省 edges（向后兼容）→ 无连线区；既有行为不变', () => {
    const { container } = render(
      <EntityGraphPanel relations={rels} onFocusNode={vi.fn()} onClose={vi.fn()} />,
    );
    expect(container.querySelector('[data-edge-section]')).toBeNull();
    expect(container.querySelectorAll('[data-entity-item]').length).toBe(2);
  });
});

describe('EntityGraphPanel 语义边区：按状态分组（R0-3）', () => {
  /** 缺元素即抛错（替代 `!` 断言——新增代码零 lint 告警纪律） */
  function q(sel: string, root: ParentNode): Element {
    const el = root.querySelector(sel);
    if (el === null) throw new Error(`element not found: ${sel}`);
    return el;
  }

  /** 四类各 1 条：正常 / 悬空（源锚未解析）/ 陈旧（歧义）/ 已失效（invalidAt） */
  const groupedEdges: EdgeListItem[] = [
    {
      key: 'e0',
      rel: 'relates-to',
      dir: 'fwd',
      sourceId: 'n1',
      sourceText: '任务 A',
      targetId: 'n2',
      targetText: '里程碑 M2',
      state: 'well-formed',
    },
    {
      key: 'e1',
      rel: 'relates-to',
      dir: 'fwd',
      sourceId: '',
      sourceText: 'node:根/幽灵',
      targetId: null,
      targetText: '@issue:777',
      state: 'dangling',
    },
    {
      key: 'e2',
      rel: 'causes',
      dir: 'fwd',
      sourceId: 'n1',
      sourceText: '任务 A',
      targetId: null,
      targetText: '@issue:8',
      state: 'stale',
    },
    {
      key: 'e3',
      rel: 'blocks',
      dir: 'fwd',
      sourceId: 'n1',
      sourceText: '任务 A',
      targetId: 'n2',
      targetText: '里程碑 M2',
      invalidAt: '2026-01-01T00:00:00.000Z',
      state: 'well-formed',
    },
  ];

  it('分区标题与计数正确（正常 1 / 悬空 1 / 陈旧 1 / 已失效 1）', () => {
    const { container } = render(
      <EntityGraphPanel
        relations={[]}
        edges={groupedEdges}
        onFocusNode={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(q('[data-edge-group="ok"]', container).textContent).toContain('正常 1');
    expect(q('[data-edge-group="dangling"]', container).textContent).toContain('悬空 1');
    expect(q('[data-edge-group="stale"]', container).textContent).toContain('陈旧 1');
    expect(q('[data-edge-group="invalid"]', container).textContent).toContain('已失效 1');
  });

  it('悬空行（源锚未解析）点击不调用 onFocusNode，且呈禁用态 + 提示', () => {
    const focus = vi.fn();
    const { container } = render(
      <EntityGraphPanel
        relations={[]}
        edges={groupedEdges}
        onFocusNode={focus}
        onClose={vi.fn()}
      />,
    );
    const danglingRow = q('[data-edge-group="dangling"] [data-edge-item]', container);
    expect(danglingRow.textContent).toContain('源锚未解析');
    fireEvent.click(danglingRow);
    expect(focus).not.toHaveBeenCalled();
  });

  it('正常行点击仍调用 onFocusNode(源节点) 一次', () => {
    const focus = vi.fn();
    const { container } = render(
      <EntityGraphPanel
        relations={[]}
        edges={groupedEdges}
        onFocusNode={focus}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(q('[data-edge-group="ok"] [data-edge-item]', container));
    expect(focus).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledWith('n1');
  });

  it('state 未传（旧调用方）→ 全部落「正常」区，行为不变', () => {
    const { container } = render(
      <EntityGraphPanel
        relations={[]}
        edges={edgeItems}
        onFocusNode={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(q('[data-edge-group="ok"]', container).textContent).toContain('正常 2');
    expect(container.querySelectorAll('[data-edge-group="dangling"]').length).toBe(0);
  });
});

describe('EntityGraphPanel 行内动作（R2-3）', () => {
  /** 缺元素即抛错（替代 `!` 断言——新增代码零 lint 告警纪律） */
  function qa(sel: string, root: ParentNode): Element {
    const el = root.querySelector(sel);
    if (el === null) throw new Error(`element not found: ${sel}`);
    return el;
  }

  const actionEdges: EdgeListItem[] = [
    {
      key: 'e0',
      rel: 'relates-to',
      dir: 'fwd',
      sourceId: 'n1',
      sourceText: '任务',
      targetId: 'n2',
      targetText: '生活',
      state: 'well-formed',
      from: 'node:根/任务',
      to: 'node:根/生活',
    },
    {
      key: 'e1',
      rel: 'relates-to',
      dir: 'fwd',
      sourceId: '',
      sourceText: 'node:根/幽灵',
      targetId: 'n2',
      targetText: '生活',
      state: 'dangling',
      from: 'node:根/幽灵',
      to: 'node:根/生活',
    },
    {
      key: 'e2',
      rel: 'causes',
      dir: 'fwd',
      sourceId: 'n1',
      sourceText: '任务',
      targetId: null,
      targetText: 'node:根/坏',
      state: 'stale',
      from: 'node:根/任务',
      to: 'node:根/坏',
    },
  ];

  const pickerChoices = [
    { id: 'n1', label: '任务', anchor: 'node:根/任务' },
    { id: 'n2', label: '生活', anchor: 'node:根/生活' },
  ];

  it('缺省（不注入动作 props）→ 行内无重挂/删除按钮（向后兼容钉死）', () => {
    const { container } = render(
      <EntityGraphPanel
        relations={[]}
        edges={actionEdges}
        onFocusNode={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-edge-reattach]')).toBeNull();
    expect(container.querySelector('[data-edge-delete]')).toBeNull();
  });

  it('悬空行（源锚未解析）重挂端 = from：picker 打开 → 选题 → onReattachEdge(key,"from",anchor)', () => {
    const onReattachEdge = vi.fn();
    const { container } = render(
      <EntityGraphPanel
        relations={[]}
        edges={actionEdges}
        onFocusNode={vi.fn()}
        onClose={vi.fn()}
        choices={pickerChoices}
        onReattachEdge={onReattachEdge}
        onDeleteEdge={vi.fn()}
      />,
    );
    fireEvent.click(qa('[data-edge-reattach="e1"]', container));
    fireEvent.click(qa('[data-edge-anchor-option="node:根/任务"]', container));
    expect(onReattachEdge).toHaveBeenCalledTimes(1);
    expect(onReattachEdge).toHaveBeenCalledWith('e1', 'from', 'node:根/任务');
  });

  it('陈旧行（目标未解析）重挂端 = to；正常行无重挂但有删除', () => {
    const onReattachEdge = vi.fn();
    const { container } = render(
      <EntityGraphPanel
        relations={[]}
        edges={actionEdges}
        onFocusNode={vi.fn()}
        onClose={vi.fn()}
        choices={pickerChoices}
        onReattachEdge={onReattachEdge}
        onDeleteEdge={vi.fn()}
      />,
    );
    fireEvent.click(qa('[data-edge-reattach="e2"]', container));
    fireEvent.click(qa('[data-edge-anchor-option="node:根/生活"]', container));
    expect(onReattachEdge).toHaveBeenCalledWith('e2', 'to', 'node:根/生活');
    // 健康行：两端可解析 → 无重挂入口；删除入口仍在
    expect(container.querySelector('[data-edge-reattach="e0"]')).toBeNull();
    expect(container.querySelector('[data-edge-delete="e0"]')).not.toBeNull();
  });

  it('点删除 → onDeleteEdge(key) 且不触发行的 onFocusNode（stopPropagation）', () => {
    const onDeleteEdge = vi.fn();
    const onFocusNode = vi.fn();
    const { container } = render(
      <EntityGraphPanel
        relations={[]}
        edges={actionEdges}
        onFocusNode={onFocusNode}
        onClose={vi.fn()}
        choices={pickerChoices}
        onReattachEdge={vi.fn()}
        onDeleteEdge={onDeleteEdge}
      />,
    );
    fireEvent.click(qa('[data-edge-delete="e0"]', container));
    expect(onDeleteEdge).toHaveBeenCalledTimes(1);
    expect(onDeleteEdge).toHaveBeenCalledWith('e0');
    expect(onFocusNode).not.toHaveBeenCalled();
  });
});

// ---------- R6-S1b：畸形项行（可定位 → 可处置；口径单一来源 = edgeHealthOf.problems） ----------
import { makeTextNode, type EditableNode } from '@mindcanvas/kernel';
import { edgeHealthOf } from '../src/render/edgeHealth.js';
import { EdgeHealthBar } from '../src/chrome/EdgeHealthBar.js';
import { collectFreeEdges } from '../src/render/freeEdges.js';
import { edgesOf, removeEdgeAt } from '../src/chrome/EdgeEditor.js';

describe('EntityGraphPanel 畸形项行（R6-S1b）', () => {
  /** 缺元素即抛错（替代 `!` 断言——新增代码零 lint 告警纪律） */
  function qm(sel: string, root: ParentNode): Element {
    const el = root.querySelector(sel);
    if (el === null) throw new Error(`element not found: ${sel}`);
    return el;
  }

  /** 1 健康边（A→B）+ 1 畸形项（'oops'，原始数组下标 1） */
  function panelFixture(): EditableNode {
    const root = makeTextNode('根', [makeTextNode('A'), makeTextNode('B')]);
    root.note = {
      edges: [{ from: 'node:根/A', to: 'node:根/B', rel: 'relates-to' }, 'oops'],
    };
    return root;
  }

  /** 夹具 → 面板 edges 行（与 MindmapStage.edgeItems 同款最小映射） */
  function edgeItemsOf(root: EditableNode): EdgeListItem[] {
    return collectFreeEdges(root).map((e) => ({
      key: e.key,
      rel: e.rel,
      dir: e.dir,
      sourceId: e.sourceId ?? '',
      sourceText: e.from,
      targetId: e.targetId,
      targetText: e.to,
      state: e.state,
    }));
  }

  /** 宿主派生口径：edgeHealthOf.problems 过滤 malformed → 下标数组（面板不扫原始数组） */
  function malformedRowsOf(root: EditableNode): number[] {
    return edgeHealthOf(root)
      .problems.filter((p) => p.malformed === true)
      .map((p) => p.index);
  }

  it('malformedRows 传入 → 「原始项非法」组出现（第 N 条 · 原始项非法 + 删除入口）；section 计数含畸形项', () => {
    const root = panelFixture();
    const malformedRows = malformedRowsOf(root);
    expect(malformedRows).toEqual([1]);
    const onDeleteEdge = vi.fn();
    const { container } = render(
      <EntityGraphPanel
        relations={[]}
        edges={edgeItemsOf(root)}
        malformedRows={malformedRows}
        onFocusNode={vi.fn()}
        onClose={vi.fn()}
        onDeleteEdge={onDeleteEdge}
      />,
    );
    // 计数同步：1 条可解析边 + 1 条畸形项 → 连线 2（诊断条点进来逐条对得上）
    expect(qm('[data-edge-section]', container).textContent).toContain('连线 2');
    expect(qm('[data-edge-group="malformed"]', container).textContent).toContain('原始项非法 1');
    expect(qm('[data-edge-malformed="e1"]', container).textContent).toContain('第 2 条 · 原始项非法');
    // 删除走既有写路径（key 沿用 e{index} 位置键约定）
    fireEvent.click(qm('[data-edge-delete="e1"]', container));
    expect(onDeleteEdge).toHaveBeenCalledTimes(1);
    expect(onDeleteEdge).toHaveBeenCalledWith('e1');
  });

  it('删除畸形项 → malformed === 0 且诊断条消失（无其它问题；总数口径闭环）', () => {
    const root = panelFixture();
    const before = edgeHealthOf(root);
    expect(before.malformed).toBe(1);
    // 删除前：条出现（问题列表恰为这条畸形项）
    const barBefore = render(<EdgeHealthBar health={before} bottom={178} />);
    expect(barBefore.container.querySelector('[data-edge-health-bar]')).not.toBeNull();
    barBefore.unmount();

    const onDeleteEdge = vi.fn((key: string) => {
      // 宿主写路径模拟：writeEdges + removeEdgeAt（useEdgeActions.deleteEdge 同款）
      root.note = { edges: removeEdgeAt(edgesOf(root.note), Number(key.slice(1))) };
    });
    const { container } = render(
      <EntityGraphPanel
        relations={[]}
        edges={edgeItemsOf(root)}
        malformedRows={malformedRowsOf(root)}
        onFocusNode={vi.fn()}
        onClose={vi.fn()}
        onDeleteEdge={onDeleteEdge}
      />,
    );
    fireEvent.click(qm('[data-edge-delete="e1"]', container));
    expect(onDeleteEdge).toHaveBeenCalledWith('e1');
    const after = edgeHealthOf(root);
    expect(after.malformed).toBe(0);
    expect(after.problems).toEqual([]);
    const barAfter = render(<EdgeHealthBar health={after} bottom={178} />);
    expect(barAfter.container.querySelector('[data-edge-health-bar]')).toBeNull();
    barAfter.unmount();
  });

  it('仅有畸形项（edges 为空）→ 连线区仍渲染（诊断条点进来的那一条找得到）', () => {
    const root = makeTextNode('根');
    root.note = { edges: ['oops'] };
    const { container } = render(
      <EntityGraphPanel
        relations={[]}
        edges={[]}
        malformedRows={malformedRowsOf(root)}
        onFocusNode={vi.fn()}
        onClose={vi.fn()}
        onDeleteEdge={vi.fn()}
      />,
    );
    expect(qm('[data-edge-section]', container).textContent).toContain('连线 1');
    expect(qm('[data-edge-malformed="e0"]', container).textContent).toContain('第 1 条 · 原始项非法');
    // 空态引导文案不得与畸形行同屏混淆
    expect(container.textContent).not.toContain('暂无实体引用');
  });

  it('缺省 malformedRows → 无畸形区（向后兼容钉死）；有畸形行未注入 onDeleteEdge → 行在、删除入口不在', () => {
    const bare = render(
      <EntityGraphPanel relations={[]} edges={edgeItems} onFocusNode={vi.fn()} onClose={vi.fn()} />,
    );
    expect(bare.container.querySelector('[data-edge-group="malformed"]')).toBeNull();
    expect(bare.container.querySelector('[data-edge-malformed]')).toBeNull();
    bare.unmount();

    const root = panelFixture();
    const noAction = render(
      <EntityGraphPanel
        relations={[]}
        edges={edgeItemsOf(root)}
        malformedRows={malformedRowsOf(root)}
        onFocusNode={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(noAction.container.querySelector('[data-edge-malformed="e1"]')).not.toBeNull();
    expect(noAction.container.querySelector('[data-edge-delete]')).toBeNull();
    noAction.unmount();
  });
});
