/**
 * S2 · 「创建摘要…」菜单项（结构区）与两跳草稿的**可测纯逻辑**部分。
 *
 * 契约（任务书 §六）：
 *  - `summaryActions` **缺省时不显示菜单项**（向后兼容，既有调用方零影响）；
 *  - 提供 action 时显示「创建摘要…」，与「连线到…」并列于「结构」区；
 *  - **根节点不显示**该项（根无法作为范围成员）；
 *  - 菜单触发后进入第一跳等待状态（调用方 `onStartSummary`），文案须明确
 *    「选择同一父级范围的末成员」。
 *
 * 阴/阳性对照在此文件内成对出现：同一个查询函数分别以「无 bag / 有 bag / 根节点」
 * 调用，只断言「有无该项」——足以判别「缺省也给入口」或「根节点也给入口」两类实现。
 */
import { describe, expect, it, vi } from 'vitest';
import { astToEditable, type EditableNode } from '@mindcanvas/kernel';
import { contextMenuItemsFor } from '../src/edit/contextMenuItems.js';
import { EditorController } from '../src/edit/controller.js';
import type { SummaryMenuActions } from '../src/edit/menuActionTypes.js';
import { FrameScheduler } from '../src/render/scheduler.js';

function ast(tree: EditableNode): EditableNode {
  const built = astToEditable(tree);
  if (built === null) throw new Error('fixture broken');
  return built;
}

function makeController(root: EditableNode): EditorController {
  const frame = new FrameScheduler({
    raf: (cb) => {
      cb();
      return 1;
    },
    rafCancel: () => undefined,
  });
  return new EditorController(root, {}, frame);
}

function fixture(): EditableNode {
  return ast({
    id: 'r',
    type: 'text',
    text: '根',
    children: [
      { id: 'a', type: 'text', text: 'A', children: [] },
      { id: 'b', type: 'text', text: 'B', children: [] },
      { id: 'c', type: 'text', text: 'C', children: [] },
    ],
  });
}

/** 只注入 summaryActions 的菜单构造（其余动作袋缺省——与既有 frame-commands 用例同款） */
function menuWith(
  c: EditorController,
  id: string,
  summaryActions?: SummaryMenuActions,
): ReturnType<typeof contextMenuItemsFor> {
  return contextMenuItemsFor(
    c,
    id,
    undefined, // entityActions
    undefined, // edgeActions
    undefined, // centerActions
    undefined, // growDirActions
    undefined, // sectionActions
    undefined, // frameActions
    summaryActions,
  );
}

function summaryItem(items: ReturnType<typeof contextMenuItemsFor>) {
  return items.find((i) => i.label === '创建摘要…');
}

describe('「创建摘要…」菜单项', () => {
  it('summaryActions 缺省 → 不出现该项（向后兼容）', () => {
    const c = makeController(fixture());
    const a = c.root.children[0];
    if (!a) throw new Error('fixture broken');
    expect(summaryItem(menuWith(c, a.id))).toBeUndefined();
  });

  it('提供 summaryActions → 出现在「结构」区，文案为「创建摘要…」', () => {
    const c = makeController(fixture());
    const a = c.root.children[0];
    if (!a) throw new Error('fixture broken');
    const actions: SummaryMenuActions = { onStartSummary: vi.fn() };
    const item = summaryItem(menuWith(c, a.id, actions));
    expect(item).toBeDefined();
    expect(item?.section).toBe('结构');
  });

  it('根节点不出现该项', () => {
    const c = makeController(fixture());
    const actions: SummaryMenuActions = { onStartSummary: vi.fn() };
    expect(summaryItem(menuWith(c, c.root.id, actions))).toBeUndefined();
  });

  it('选中该项调用 onStartSummary(id) 且只调用一次', () => {
    const c = makeController(fixture());
    const a = c.root.children[0];
    if (!a) throw new Error('fixture broken');
    const onStartSummary = vi.fn();
    const item = summaryItem(menuWith(c, a.id, { onStartSummary }));
    if (!item) throw new Error('expected item');
    const onSelect = item.onSelect;
    if (!onSelect) throw new Error('expected onSelect');
    onSelect();
    expect(onStartSummary).toHaveBeenCalledTimes(1);
    expect(onStartSummary).toHaveBeenCalledWith(a.id);
  });

  it('该项无子页（进入两跳等待，不再要求二次选择）', () => {
    const c = makeController(fixture());
    const a = c.root.children[0];
    if (!a) throw new Error('fixture broken');
    const item = summaryItem(menuWith(c, a.id, { onStartSummary: vi.fn() }));
    expect(item?.page).toBeUndefined();
  });

  it('与「连线到…」并列于结构区：两者可同时存在且分区相同', () => {
    const c = makeController(fixture());
    const a = c.root.children[0];
    if (!a) throw new Error('fixture broken');
    const items = contextMenuItemsFor(
      c,
      a.id,
      undefined,
      { onStartLink: vi.fn() },
      undefined,
      undefined,
      undefined,
      undefined,
      { onStartSummary: vi.fn() },
    );
    const link = items.find((i) => i.label === '连线到…');
    const sum = items.find((i) => i.label === '创建摘要…');
    expect(link?.section).toBe('结构');
    expect(sum?.section).toBe('结构');
  });
});
