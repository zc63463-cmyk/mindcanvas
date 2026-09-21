// @vitest-environment jsdom
/**
 * EdgeHealthBar（R0-2）：边健康度诊断条。
 *
 * 行为规格（派遣计划 R0-2 → R2-2 → R6-S1a 契约更新）：
 * - 仅当 problems.length > 0 渲染；全健康 → 不渲染（阴性对照钉死此条件）
 * - R6-S1a 口径更新：文案 `⚠ 关系线诊断：N 条（…）`——括号内为**互斥主分类**
 *   （悬空 / 陈旧 / 失效 / 原始项非法 / 自关联 / 重复 / 未知关系），仅非零类目出现；
 *   **括号内数字之和 === problems.length**（总数与分项对齐，钉死）。
 *   最多 3 条明细 + 其余略不变
 * - R0-2 原「零点击（pointerEvents none）」契约已被 R2-2 反转：注入 onOpen 后
 *   条可点击（cursor pointer + 点击回调）→ 打开关系面板；缺省（未接线的
 *   旧调用方）保持 pointerEvents none 向后兼容
 *
 * MindmapStage 接线冒烟：健康网关（无边）挂载后不出现诊断条（覆盖 stage 内
 * edgeHealthOf 的 useMemo 求值路径不抛错；出现分支由组件级用例覆盖——stage 无
 * 注入缝，边数据无法从外部种入内置 controller，与仓库「面板细粒度行为走组件
 * 测试」的分工一致）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { makeEntityNode, makeTextNode, type EditableNode } from '@mindcanvas/kernel';
import { EdgeHealthBar, edgeHealthOf } from '@mindcanvas/react';
import MindmapStage from '../src/MindmapStage';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** 缺元素即抛错（替代 `!` 非空断言——新代码零 lint 告警纪律） */
function q(selector: string, root: ParentNode): Element {
  const el = root.querySelector(selector);
  if (el === null) throw new Error(`element not found: ${selector}`);
  return el;
}

/** 1 条 dangling 边的最小夹具 */
function danglingRoot(): EditableNode {
  const root = makeTextNode('根', [makeTextNode('A')]);
  root.note = { edges: [{ from: 'node:根/A', to: 'node:根/不存在', rel: 'relates-to' }] };
  return root;
}

/** 5 条坏边夹具（明细截断用） */
function messyRoot(): EditableNode {
  const root = makeTextNode('根', [
    makeTextNode('A'),
    makeTextNode('分支', [makeEntityNode({ kind: 'issue', id: '8' }), makeEntityNode({ kind: 'issue', id: '8' })]),
  ]);
  root.note = {
    edges: [
      { from: 'node:根/A', to: 'node:根/坏1', rel: 'relates-to' }, // dangling
      { from: 'node:根/A', to: 'node:根/坏2', rel: 'relates-to' }, // dangling
      { from: 'node:根/A', to: '@issue:8', rel: 'relates-to' }, // stale（同名歧义）
      { from: 'node:根/A', to: 'node:根/A', rel: 'relates-to' }, // selfAnchor
      { from: 'node:根/A', to: 'node:根/坏3', rel: 'relates-to' }, // dangling
    ],
  };
  return root;
}

/** R6-S1a 混合夹具：1 dangling + 1 malformed（静默丢弃项）+ 1 invalid —— 检验总数=各项之和 */
function mixedRoot(): EditableNode {
  const root = makeTextNode('根', [makeTextNode('A'), makeTextNode('B')]);
  root.note = {
    edges: [
      { from: 'node:根/A', to: 'node:根/坏', rel: 'relates-to' }, // dangling
      'oops', // malformed（非对象，collectFreeEdges 静默丢弃）
      {
        from: 'node:根/A',
        to: 'node:根/B',
        rel: 'relates-to',
        invalidAt: '2026-01-01T00:00:00.000Z',
      }, // invalid
    ],
  };
  return root;
}

describe('EdgeHealthBar 组件', () => {
  it('全健康（problems 为空）→ 不渲染', () => {
    const root = makeTextNode('根', [makeTextNode('A'), makeTextNode('B')]);
    root.note = { edges: [{ from: 'node:根/A', to: 'node:根/B', rel: 'relates-to' }] };
    const { container } = render(<EdgeHealthBar health={edgeHealthOf(root)} bottom={178} />);
    expect(container.querySelector('[data-edge-health-bar]')).toBeNull();
  });

  it('1 条 dangling → 条出现、计数正确、明细含锚文本与状态', () => {
    const { container } = render(<EdgeHealthBar health={edgeHealthOf(danglingRoot())} bottom={178} />);
    const bar = q('[data-edge-health-bar]', container);
    expect(bar.textContent).toContain('关系线诊断：1 条（悬空 1）');
    expect(bar.textContent).toContain('node:根/不存在');
    expect(bar.textContent).toContain('悬空');
    // 缺省（未接线 onOpen 的旧调用方）：保持非阻塞（向后兼容钉）
    expect((bar as HTMLElement).style.pointerEvents).toBe('none');
  });

  it('注入 onOpen → 条可点击（pointerEvents auto + cursor pointer），点击回调一次', () => {
    const onOpen = vi.fn();
    const { container } = render(
      <EdgeHealthBar health={edgeHealthOf(danglingRoot())} bottom={178} onOpen={onOpen} />,
    );
    const bar = q('[data-edge-health-bar]', container) as HTMLElement;
    expect(bar.style.pointerEvents).toBe('auto');
    expect(bar.style.cursor).toBe('pointer');
    fireEvent.click(bar);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('5 条坏边 → 明细最多 3 条 + 「其余 N 条略」；标题分项含自关联（旧口径漏计的那条）', () => {
    const { container } = render(<EdgeHealthBar health={edgeHealthOf(messyRoot())} bottom={178} />);
    const bar = q('[data-edge-health-bar]', container);
    expect(bar.textContent).toContain('关系线诊断：5 条（悬空 3 / 陈旧 1 / 自关联 1）');
    expect(bar.querySelectorAll('[data-edge-health-detail]').length).toBe(3);
    expect(bar.textContent).toContain('其余 2 条略');
  });

  it('R6-S1a：标题括号内数字之和 === problems.length（总数与分项对齐；零类目省略）', () => {
    const health = edgeHealthOf(mixedRoot());
    expect(health.problems.length).toBe(3);
    const { container } = render(<EdgeHealthBar health={health} bottom={178} />);
    const bar = q('[data-edge-health-bar]', container);
    expect(bar.textContent).toContain('关系线诊断：3 条（悬空 1 / 失效 1 / 原始项非法 1）');
    // 括号内数字之和 === problems.length（互斥分类全覆盖，不重不漏）
    const m = (bar.textContent ?? '').match(/（([^）]*)）/);
    if (m === null) throw new Error('标题括号未找到');
    const inner = m[1];
    if (inner === undefined) throw new Error('标题括号无内容');
    const nums = [...inner.matchAll(/(\d+)/g)].map((x) => Number(x[1]));
    expect(nums.length).toBeGreaterThan(0);
    expect(nums.reduce((a, b) => a + b, 0)).toBe(health.problems.length);
    // 零类目省略：本夹具无 陈旧/自关联/重复/未知关系 → 不出现在标题括号区
    expect(inner).not.toContain('陈旧');
    expect(inner).not.toContain('自关联');
    expect(inner).not.toContain('重复');
    expect(inner).not.toContain('未知关系');
    // 畸形项在标题与明细都有自己的席位（此前总数含它、分项不含——数不出第 2 条）
    expect(bar.textContent).toContain('原始项非法 1');
    expect(bar.textContent).toContain('第 2 条：原始项非法');
  });
});

describe('MindmapStage 接线冒烟', () => {
  it('健康内置网关挂载 → 不出现边健康度条（接线求值路径不抛错）', () => {
    const { container } = render(<MindmapStage />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('[data-edge-health-bar]')).toBeNull();
  });
});
