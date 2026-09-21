import { describe, expect, it, vi } from 'vitest';
import { astToEditable, parseMm } from '@mindcanvas/kernel';
import { contextMenuItemsFor, getNodeLabel, subRingPagesFor } from '../src/edit/contextMenuItems.js';
import type { ContextMenuItem } from '../src/chrome/ContextMenu.js';
import { EditorController } from '../src/edit/controller.js';
import { FrameScheduler } from '../src/render/scheduler.js';

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

const PLAIN = '# 根\n\n- A\n- B\n';
const ENTITY = '# 根\n\n- @issue:1\n- B\n';

/** 中心动作袋（默认「非中心」） */
const centerFixture = (patch: Partial<Parameters<typeof contextMenuItemsFor>[4]> = {}) => ({
  isCenter: () => false,
  isDetached: () => false,
  parentLinkOf: () => 'hide' as const,
  onToggleParentLink: () => undefined,
  onPromote: vi.fn(),
  onDemote: () => undefined,
  onAttach: () => undefined,
  cidOf: () => undefined,
  onCopyCid: vi.fn(),
  ...patch,
});

/** 生长方向袋 */
const growFixture = (cur: 'right' | 'left' | 'down' | 'up' | null) => ({
  explicitDirOf: () => cur,
  onSetGrowDir: vi.fn(),
});

/** 生长方向 + 出线长度袋 */
const lenFixture = (cur: number | null) => ({
  ...growFixture('right'),
  lenOf: () => cur,
  onSetLen: vi.fn(),
  onRequestLenCustom: vi.fn(),
});

/** 取折叠项（`page` 项）的子页 */
const pageOf = (items: ContextMenuItem[], labelPrefix: string): ContextMenuItem[] | undefined =>
  items.find((i) => i.label.startsWith(labelPrefix))?.page;

describe('节点右键菜单项（N2：实体专属动作）', () => {
  it('文本节点：仅既有项（无实体三项）', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const labels = contextMenuItemsFor(c, id).map((i) => i.label);
    expect(labels).toContain('新建子节点');
    expect(labels).toContain('编辑');
    expect(labels).not.toContain('改引用…');
    expect(labels).not.toContain('转为纯文本');
  });

  it('缺省 entityActions（向后兼容）→ 不追加实体项', () => {
    const c = build(ENTITY);
    const id = c.root.children[0]!.id;
    expect(c.root.children[0]!.type).toBe('entity');
    const labels = contextMenuItemsFor(c, id).map((i) => i.label);
    expect(labels).not.toContain('改引用…');
  });

  it('传入 entityActions + 实体节点 → 追加三项且动作回调生效', () => {
    const c = build(ENTITY);
    const id = c.root.children[0]!.id;
    const onEditRef = vi.fn();
    const onShowInGraph = vi.fn();
    const items = contextMenuItemsFor(c, id, { onEditRef, onShowInGraph });
    const labels = items.map((i) => i.label);
    expect(labels).toContain('改引用…');
    expect(labels).toContain('在关系图中显示');
    expect(labels).toContain('转为纯文本');

    items.find((i) => i.label === '改引用…')!.onSelect?.();
    expect(onEditRef).toHaveBeenCalledWith(id);
    items.find((i) => i.label === '在关系图中显示')!.onSelect?.();
    expect(onShowInGraph).toHaveBeenCalledWith(id);
    // 转为纯文本：实体 → 文本（ref 清空）
    items.find((i) => i.label === '转为纯文本')!.onSelect?.();
    expect(c.root.children[0]!.type).toBe('text');
    expect(c.root.children[0]!.ref).toBeUndefined();
  });

  it('根节点：无「新建同级/缩进/删除」（既有语义回归）', () => {
    const c = build(PLAIN);
    const labels = contextMenuItemsFor(c, c.root.id).map((i) => i.label);
    expect(labels).not.toContain('新建同级节点');
    expect(labels).not.toContain('缩进');
    expect(labels).not.toContain('删除节点');
  });

  it('v1.8.2：「复制节点文本」常驻内容区 → 写剪贴板（与环剪贴板席同一实现）', () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const item = contextMenuItemsFor(c, id).find((i) => i.label === '复制节点文本');
    expect(item?.section).toBe('内容');
    item?.onSelect?.();
    expect(writeText).toHaveBeenCalledWith('A');
    // 根节点也有（通用动作）
    expect(contextMenuItemsFor(c, c.root.id).map((i) => i.label)).toContain('复制节点文本');
  });

  it('v1.8.2：菜单「新建同级节点」走共用命令（新建 → 选中 → 进入编辑）', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    contextMenuItemsFor(c, id).find((i) => i.label === '新建同级节点')!.onSelect?.();
    expect(c.root.children).toHaveLength(3); // A / B → 新兄弟
    expect(c.selectedId).toBe(c.root.children[1]!.id);
  });

  it('getNodeLabel：根/有文本/无文本', () => {
    const c = build(PLAIN);
    expect(getNodeLabel(c.root, c.root.id)).toBe('根');
    expect(getNodeLabel(c.root, c.root.children[0]!.id)).toBe('A');
    expect(getNodeLabel(c.root, '不存在')).toBe('节点');
  });
});

/**
 * T6（v1.8.2）：菜单瘦身 —— 阶段 1 移除 4 项 + 方向/参数型收成「一行 + 子页」。
 * 移除项全部有**环内等价席位**（T5 已进正片），故菜单不再重复提供。
 */
describe('T6：阶段 1 移除 4 项（等价入口在环）', () => {
  const REMOVED = ['编辑描述（盒内）', '编辑笔记（盒下）', '升级为出线枢纽', '取消出线枢纽', '复制中心编号'];

  it('描述 / 笔记 / 枢纽 / 复制编号不再出现在菜单（含中心节点）', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const items = contextMenuItemsFor(c, id, undefined, undefined, centerFixture({ isCenter: () => true }));
    const labels = items.map((i) => i.label);
    for (const gone of REMOVED) expect(labels.some((l) => l.startsWith(gone))).toBe(false);
  });

  it('★ 跨模块不变量：被移除项的环席位仍存在（环 = 唯一入口，不能两头都删）', () => {
    const ids = (subRingPagesFor({
      isRoot: false,
      isCenter: true,
      hasCid: true,
      isHub: false,
      hasDesc: true,
      hasNote: true,
    })[0] ?? []).map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['sub:edit-desc', 'sub:edit-note', 'sub:hub', 'sub:copy-cid']));
  });
});

describe('T6：方向型 / 参数型「一行 + 子页」', () => {
  it('生长方向：单项 + 行内当前值 + 快捷键 hint；子页 4 向（当前 ✓）+「继承」条件出现', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const items = contextMenuItemsFor(c, id, undefined, undefined, undefined, growFixture('left'));
    const row = items.find((i) => i.label.startsWith('生长方向'));
    expect(row?.label).toBe('生长方向：向左'); // 行内显示当前值
    expect(row?.hint).toBe('Alt+方向'); // 更快的通道
    expect(row?.section).toBe('生长与连线');
    const page = pageOf(items, '生长方向') ?? [];
    expect(page.map((i) => i.label)).toEqual(['向右', '向左 ✓', '向下', '向上', '继承（跟随父级）']);
  });

  it('生长方向子页：点选方向 → onSetGrowDir(dir)；继承 → null', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const actions = growFixture('down');
    const items = contextMenuItemsFor(c, id, undefined, undefined, undefined, actions);
    const page = pageOf(items, '生长方向') ?? [];
    page.find((i) => i.label === '向上')!.onSelect?.();
    expect(actions.onSetGrowDir).toHaveBeenCalledWith(id, 'up');
    page.find((i) => i.label === '继承（跟随父级）')!.onSelect?.();
    expect(actions.onSetGrowDir).toHaveBeenCalledWith(id, null);
  });

  it('继承状态（无显式 dir）→ 行内显示「继承」、子页无 ✓、无「继承」项', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const items = contextMenuItemsFor(c, id, undefined, undefined, undefined, growFixture(null));
    expect(items.find((i) => i.label.startsWith('生长方向'))?.label).toBe('生长方向：继承');
    const page = pageOf(items, '生长方向') ?? [];
    expect(page.map((i) => i.label)).toEqual(['向右', '向左', '向下', '向上']);
  });

  it('根节点 → 不出现生长方向项（根的方向由岛/布局决定）', () => {
    const c = build(PLAIN);
    const labels = contextMenuItemsFor(c, c.root.id, undefined, undefined, undefined, growFixture(null)).map(
      (i) => i.label,
    );
    expect(labels.some((l) => l.startsWith('生长方向'))).toBe(false);
  });

  it('出线长度：单项 + 行内当前值；子页 = 预设 + 缺省 + 自定义（✓ 标当前）', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const items = contextMenuItemsFor(c, id, undefined, undefined, undefined, lenFixture(null));
    const row = items.find((i) => i.label.startsWith('出线长度'));
    expect(row?.label).toBe('出线长度：缺省');
    expect(row?.hint).toBe('拖梁');
    expect((pageOf(items, '出线长度') ?? []).map((i) => i.label)).toEqual([
      '14',
      '32',
      '60',
      '100',
      '缺省 ✓',
      '自定义…',
    ]);
  });

  it('出线长度子页：点选预设 → onSetLen(v)；缺省 → null；自定义 → 宿主气泡', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const actions = lenFixture(60);
    const items = contextMenuItemsFor(c, id, undefined, undefined, undefined, actions);
    expect(items.find((i) => i.label.startsWith('出线长度'))?.label).toBe('出线长度：60');
    const page = pageOf(items, '出线长度') ?? [];
    expect(page.map((i) => i.label)).toContain('60 ✓');
    page.find((i) => i.label === '60 ✓')!.onSelect?.();
    expect(actions.onSetLen).toHaveBeenCalledWith(id, 60);
    page.find((i) => i.label === '缺省')!.onSelect?.();
    expect(actions.onSetLen).toHaveBeenCalledWith(id, null);
    page.find((i) => i.label === '自定义…')!.onSelect?.();
    expect(actions.onRequestLenCustom).toHaveBeenCalledWith(id);
  });

  it('出线长度：预设外的值（手改文件）行内直接显示数字、✓ 落在「自定义」上', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const items = contextMenuItemsFor(c, id, undefined, undefined, undefined, lenFixture(45));
    expect(items.find((i) => i.label.startsWith('出线长度'))?.label).toBe('出线长度：45');
    expect((pageOf(items, '出线长度') ?? []).map((i) => i.label)).toContain('自定义… ✓');
  });

  it('向后兼容：缺省 onRequestLenCustom → 子页无「自定义…」；缺省 lenOf/onSetLen → 无出线长度项', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const noCustom = contextMenuItemsFor(c, id, undefined, undefined, undefined, {
      ...growFixture('right'),
      lenOf: () => null,
      onSetLen: vi.fn(),
    });
    expect((pageOf(noCustom, '出线长度') ?? []).some((i) => i.label.startsWith('自定义'))).toBe(false);
    const noLen = contextMenuItemsFor(c, id, undefined, undefined, undefined, growFixture('right'));
    expect(noLen.some((i) => i.label.startsWith('出线长度'))).toBe(false);
  });

  it('升为中心：单项 + 子页四向（文案与环方向页统一）；已是中心 → 降格为单项', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const actions = centerFixture();
    const items = contextMenuItemsFor(c, id, undefined, undefined, actions);
    const row = items.find((i) => i.label === '升为中心（钉住坐标）');
    expect(row?.hint).toBe('环：更多');
    expect(row?.section).toBe('岛与区域');
    const page = pageOf(items, '升为中心') ?? [];
    expect(page.map((i) => i.label)).toEqual(['靠右生长', '靠左生长', '靠下生长', '靠上生长']);
    page[2]!.onSelect?.();
    expect(actions.onPromote).toHaveBeenCalledWith(id, 'down');

    const centered = contextMenuItemsFor(c, id, undefined, undefined, centerFixture({ isCenter: () => true }));
    const demote = centered.find((i) => i.label === '降格为普通节点');
    expect(demote?.page).toBeUndefined(); // 降格是普通项（无子页）
  });

  it('★ 首屏行数预算：普通节点 12 行（T6 前 28）——三组方向/参数项各占 1 行', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const items = contextMenuItemsFor(
      c,
      id,
      undefined,
      undefined,
      centerFixture(),
      lenFixture(60),
      {
        sectionOf: () => undefined,
        onMark: vi.fn(),
        onPromoteAndMark: vi.fn(),
        onUnmark: vi.fn(),
      },
    );
    expect(items).toHaveLength(12);
    // 四组折叠项各只有 1 行（不再四向/六值平铺）
    expect(items.filter((i) => i.label.startsWith('生长方向'))).toHaveLength(1);
    expect(items.filter((i) => i.label.startsWith('出线长度'))).toHaveLength(1);
    expect(items.filter((i) => i.label.startsWith('升为中心'))).toHaveLength(1);
  });
});

describe('v1.8.1 菜单梳理（分区 / 提示 / 直删）', () => {
  it('「常用」置顶且与环一级对齐；关键项带快捷键提示', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const items = contextMenuItemsFor(c, id);
    const labels = items.map((i) => i.label);
    expect(labels.slice(0, 4)).toEqual(['新建子节点', '新建同级节点', '编辑', '删除节点']);
    expect(items[0]!.hint).toBe('Tab');
    expect(items[1]!.hint).toBe('Enter');
    expect(items[2]!.hint).toBe('F2');
    expect(items[3]!.hint).toBe('Del');
    expect(items[3]!.section).toBe('常用');
    expect(items[3]!.danger).toBe(true);
  });

  it('删除为直删（撤销兜底）：onSelect 不再走阻塞确认', () => {
    const c = build(PLAIN);
    const id = c.root.children[0]!.id;
    const items = contextMenuItemsFor(c, id);
    // node 环境无 window.confirm —— 直删路径不得调用它（调用即抛错）
    const g = globalThis as { confirm?: (m?: string) => boolean };
    const prev = g.confirm;
    g.confirm = () => {
      throw new Error('直删路径不应调用 confirm');
    };
    try {
      items.find((i) => i.label === '删除节点')!.onSelect?.();
      expect(c.root.children.some((n) => n.id === id)).toBe(false);
    } finally {
      g.confirm = prev;
    }
  });
});
