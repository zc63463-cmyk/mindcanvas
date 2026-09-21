import { describe, expect, it, vi } from 'vitest';
import { astToEditable, editableToAst, getNode, parseMm, serializeMm } from '@mindcanvas/kernel';
import { EditorController } from '../src/edit/controller.js';
import { matchEditorKey } from '../src/edit/keys.js';
import { FrameScheduler } from '../src/render/scheduler.js';

const SAMPLE = `# 根主题

## 分支 A
- 叶 1
- 叶 2

## 分支 B
`;

/** node 测试环境无 rAF：注入同步调度（生产浏览器环境用真实 rAF，同 K3 纪律） */
function buildController(): EditorController {
  const parsed = parseMm(SAMPLE);
  const frame = new FrameScheduler({
    raf: (cb) => {
      cb();
      return 1;
    },
    rafCancel: () => undefined,
  });
  return new EditorController(astToEditable(parsed.root)!, {}, frame);
}

describe('EditorController：编辑走 TreeOp + OpHistory（硬约束 1）', () => {
  it('增删改全部经 op：树状态正确且 dirty 置位', () => {
    const c = buildController();
    expect(c.dirty).toBe(false);
    const rootNode = c.root;
    const a = c.root.children[0]!;

    // 新建子（add-child）
    const childId = c.addChild(a.id, '新子节点');
    expect(getNode(c.root, childId)?.text).toBe('新子节点');
    expect(c.dirty).toBe(true);

    // 编辑文本（update-node patch.text）
    c.updateText(childId, '改名了');
    expect(getNode(c.root, childId)?.text).toBe('改名了');

    // 删除（remove-node）
    expect(c.removeNode(childId)).toBe(true);
    expect(getNode(c.root, childId)).toBeNull();
    void rootNode;
  });

  it('新建同级：插到选中节点之后；根无同级', () => {
    const c = buildController();
    const a = c.root.children[0]!;
    const id = c.addSibling(a.id, '分支 A2');
    const loc = c.root.children.findIndex((n) => n.id === id);
    expect(loc).toBe(1); // 紧跟分支 A
    expect(c.addSibling(c.root.id)).toBeNull(); // 根无同级
  });

  it('updateNote：merge 写回 + undefined 键清除', () => {
    const c = buildController();
    const a = c.root.children[0]!;
    c.updateNote(a.id, { one_liner: '一句话' });
    expect(getNode(c.root, a.id)?.note?.one_liner).toBe('一句话');
    c.updateNote(a.id, { one_liner: undefined });
    expect(getNode(c.root, a.id)?.note?.one_liner).toBeUndefined();
  });

  it('undo/redo：树状态序列正确（op 逆操作还原）', () => {
    const c = buildController();
    const original = serializeMm(editableToAst(c.root));
    const a = c.root.children[0]!;
    const childId = c.addChild(a.id, 'X');
    c.updateText(childId, 'Y');
    expect(c.undo()).toBe(true);
    expect(getNode(c.root, childId)?.text).toBe('X');
    expect(c.undo()).toBe(true);
    expect(getNode(c.root, childId)).toBeNull();
    expect(serializeMm(editableToAst(c.root))).toBe(original); // 完全还原
    expect(c.undo()).toBe(false);
    // redo 分支
    expect(c.redo()).toBe(true);
    expect(getNode(c.root, childId)).not.toBeNull();
    expect(c.redo()).toBe(true);
    expect(getNode(c.root, childId)?.text).toBe('Y');
  });

  it('删除子树 + undo 恢复完整子树', () => {
    const c = buildController();
    const b = c.root.children[1]!;
    expect(b.children.length).toBe(0); // 分支 B 无子
    const a = c.root.children[0]!;
    const childId = c.addChild(a.id, '子树根');
    c.addChild(childId, '孙1');
    c.addChild(childId, '孙2');
    expect(c.removeNode(childId)).toBe(true);
    expect(getNode(c.root, childId)).toBeNull();
    expect(c.undo()).toBe(true);
    const restored = getNode(c.root, childId);
    expect(restored?.children.length).toBe(2); // 子树完整恢复
  });

  it('折叠：瞬时状态不进 history，undo 不影响折叠', () => {
    const c = buildController();
    const a = c.root.children[0]!;
    c.toggleCollapse(a.id);
    expect(c.collapsed.has(a.id)).toBe(true);
    c.undo();
    expect(c.collapsed.has(a.id)).toBe(true); // 折叠独立于 op 历史
  });

  it('addEntityChild：新建实体子节点经 TreeOp，undo 可回退', () => {
    const c = buildController();
    const a = c.root.children[0]!;
    const id = c.addEntityChild(a.id, { kind: 'img', id: 'demo-assets/x.svg' });
    const n = getNode(c.root, id);
    expect(n?.type).toBe('entity');
    expect(n?.ref).toEqual({ kind: 'img', id: 'demo-assets/x.svg' });
    expect(c.dirty).toBe(true);
    expect(c.undo()).toBe(true);
    expect(getNode(c.root, id)).toBeNull();
  });
});

describe('快捷键表（matchEditorKey）', () => {
  // node 环境无 KeyboardEvent：用等价 plain object（matchEditorKey 只读按键字段）
  const ev = (init: {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
  }): KeyboardEvent => init as unknown as KeyboardEvent;

  it('六必做 + 保存 + 折叠映射正确', () => {
    expect(matchEditorKey(ev({ key: 'Tab' }))?.type).toBe('add-child');
    expect(matchEditorKey(ev({ key: 'Enter' }))?.type).toBe('add-sibling');
    expect(matchEditorKey(ev({ key: 'Delete' }))?.type).toBe('delete');
    expect(matchEditorKey(ev({ key: 'F2' }))?.type).toBe('edit');
    expect(matchEditorKey(ev({ key: ' ' }))?.type).toBe('collapse');
    expect(matchEditorKey(ev({ key: 'z', ctrlKey: true }))?.type).toBe('undo');
    expect(matchEditorKey(ev({ key: 'z', ctrlKey: true, shiftKey: true }))?.type).toBe('redo');
    expect(matchEditorKey(ev({ key: 'y', ctrlKey: true }))?.type).toBe('redo');
    expect(matchEditorKey(ev({ key: 's', ctrlKey: true }))?.type).toBe('save');
  });

  it('修饰键裸键忽略 / 无匹配为 null', () => {
    expect(matchEditorKey(ev({ key: 'Tab', altKey: true }))).toBeNull();
    expect(matchEditorKey(ev({ key: 'a' }))).toBeNull();
    expect(matchEditorKey(ev({ key: 'Enter', ctrlKey: true }))).toBeNull(); // 非绑定组合
  });
});

describe('批次 1：层级调整（indent/outdent，move-node op）', () => {
  it('indent：移入前一个兄弟的子节点末尾（undo 还原）', () => {
    const c = buildController();
    const a = c.root.children[0]!;
    const b = c.root.children[1]!;
    expect(c.indent(b.id)).toBe(true);
    // 分支 B 成为 分支 A 的子节点（末位）
    const after = getNode(c.root, a.id)!;
    expect(after.children.map((n) => n.id)).toContain(b.id);
    expect(c.dirty).toBe(true);
    // undo 还原为同级
    expect(c.undo()).toBe(true);
    const restored = getNode(c.root, a.id)!;
    expect(restored.children.map((n) => n.id)).not.toContain(b.id);
    expect(c.root.children.map((n) => n.id)).toContain(b.id);
  });

  it('indent 首位兄弟 / 根 → false（无移动）', () => {
    const c = buildController();
    const a = c.root.children[0]!;
    expect(c.indent(a.id)).toBe(false); // 首位无前兄弟
    expect(c.indent(c.root.id)).toBe(false); // 根不可移
    expect(c.dirty).toBe(false);
  });

  it('outdent：上移一级为父节点的后一兄弟', () => {
    const c = buildController();
    const a = c.root.children[0]!;
    const leaf1 = a.children[0]!;
    expect(c.outdent(leaf1.id)).toBe(true);
    // 叶1 上移到根下、位于 分支A 之后
    const idx = c.root.children.findIndex((n) => n.id === leaf1.id);
    expect(idx).toBe(1);
  });

  it('outdent 根的直接子 / 根 → false', () => {
    const c = buildController();
    const a = c.root.children[0]!;
    expect(c.outdent(a.id)).toBe(false); // 根的直接子不能再上移
    expect(c.outdent(c.root.id)).toBe(false);
  });
});

describe('批次 1：方向键导航（尊重折叠）', () => {
  it('down/up 按可见前序遍历移动选中', () => {
    const c = buildController();
    const a = c.root.children[0]!;
    const leaf1 = a.children[0]!;
    const leaf2 = a.children[1]!;
    c.select(a.id);
    expect(c.navigate('down')).toBe(leaf1.id);
    expect(c.navigate('down')).toBe(leaf2.id);
    expect(c.navigate('down')).toBe(c.root.children[1]!.id); // 分支 B
    expect(c.navigate('up')).toBe(leaf2.id);
    expect(c.navigate('up')).toBe(leaf1.id);
    expect(c.navigate('up')).toBe(a.id);
  });

  it('right：子节点优先（钻入）；left：父节点优先（返回）', () => {
    const c = buildController();
    const a = c.root.children[0]!;
    const leaf1 = a.children[0]!;
    c.select(a.id);
    expect(c.navigate('right')).toBe(leaf1.id);
    expect(c.navigate('left')).toBe(a.id);
    expect(c.navigate('left')).toBe(c.root.id); // 分支A 的父 = 根
  });

  it('折叠节点：导航跳过其子节点（不可见）', () => {
    const c = buildController();
    const a = c.root.children[0]!;
    c.toggleCollapse(a.id);
    c.select(a.id);
    // down 应跳到 分支 B，而非 叶1
    expect(c.navigate('down')).toBe(c.root.children[1]!.id);
    // right 无可见子节点 → 落到下一可见节点
    c.select(a.id);
    expect(c.navigate('right')).toBe(c.root.children[1]!.id);
  });

  it('边界：末位 down / 根 up → null（不越界）', () => {
    const c = buildController();
    c.select(c.root.children[1]!.id); // 分支 B（末位）
    expect(c.navigate('down')).toBeNull();
    c.select(c.root.id);
    expect(c.navigate('up')).toBeNull();
    expect(c.navigate('left')).toBeNull(); // 根无父
  });

  it('未选中 → navigate 返回 null', () => {
    const c = buildController();
    expect(c.navigate('down')).toBeNull();
  });
});

describe('批次 1：显式折叠/展开（Ctrl+[ / Ctrl+]）', () => {
  it('setCollapsed(true) 折叠 / false 展开；重复设置幂等', () => {
    const c = buildController();
    const a = c.root.children[0]!;
    c.setCollapsed(a.id, true);
    expect(c.collapsed.has(a.id)).toBe(true);
    c.setCollapsed(a.id, true); // 幂等
    expect(c.collapsed.has(a.id)).toBe(true);
    c.setCollapsed(a.id, false);
    expect(c.collapsed.has(a.id)).toBe(false);
  });
});

describe('批次 1：折叠状态持久化（storage 注入，路径制）', () => {
  it('构造时按路径从 storage 恢复折叠集', () => {
    const c = buildControllerWithStorage({ load: () => [[0]] }); // 路径 [0] = 分支 A
    const a = c.root.children[0]!;
    expect(c.collapsed.has(a.id)).toBe(true);
  });

  it('toggle/setCollapsed 变更后写回路径（非 id）', () => {
    const save = vi.fn();
    const c = buildControllerWithStorage({ load: () => [], save });
    const a = c.root.children[0]!;
    c.toggleCollapse(a.id);
    expect(save).toHaveBeenCalledWith([[0]]); // 分支 A 路径
    c.setCollapsed(a.id, false);
    expect(save).toHaveBeenLastCalledWith([]);
  });

  it('路径制持久化：跨解析（id 重生成）仍能恢复折叠', () => {
    const c1 = buildControllerWithStorage({ load: () => [] });
    const a = c1.root.children[0]!;
    c1.toggleCollapse(a.id);
    // buildControllerWithStorage 每次重解析：c2 的树 id 与 c1 全不同，
    // 但路径 [0] 仍指向 c2 自己的「分支 A」→ 路径制跨解析有效
    const c2 = buildControllerWithStorage({ load: () => [[0]] });
    expect(c2.collapsed.has(c2.root.children![0]!.id)).toBe(true);
    void a;
  });

  it('reset（打开新文件）清空折叠并写回空集', () => {
    const save = vi.fn();
    const c = buildControllerWithStorage({ load: () => [[0]], save });
    const fresh = parseMm(`# 新文件\n\n## 新分支\n`)!;
    c.reset(astToEditable(fresh.root)!);
    expect(c.collapsed.size).toBe(0);
    expect(save).toHaveBeenLastCalledWith([]);
  });

  it('无 storage 注入 → 不持久化、正常使用', () => {
    const c = buildController();
    const a = c.root.children[0]!;
    c.toggleCollapse(a.id);
    expect(c.collapsed.has(a.id)).toBe(true);
  });
});

describe('批次 1：快捷键表新绑定', () => {
  const ev = (init: {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
  }): KeyboardEvent => init as unknown as KeyboardEvent;

  it('Shift+Tab 缩进 / Ctrl+Shift+Tab 反缩进', () => {
    expect(matchEditorKey(ev({ key: 'Tab', shiftKey: true }))).toEqual({ type: 'indent' });
    expect(matchEditorKey(ev({ key: 'Tab', ctrlKey: true, shiftKey: true }))).toEqual({
      type: 'outdent',
    });
  });

  it('方向键导航（裸键）', () => {
    expect(matchEditorKey(ev({ key: 'ArrowUp' }))).toEqual({ type: 'navigate', dir: 'up' });
    expect(matchEditorKey(ev({ key: 'ArrowDown' }))).toEqual({ type: 'navigate', dir: 'down' });
    expect(matchEditorKey(ev({ key: 'ArrowLeft' }))).toEqual({ type: 'navigate', dir: 'left' });
    expect(matchEditorKey(ev({ key: 'ArrowRight' }))).toEqual({ type: 'navigate', dir: 'right' });
    expect(matchEditorKey(ev({ key: 'ArrowDown', ctrlKey: true }))).toBeNull();
  });

  it('Ctrl+[ 折叠 / Ctrl+] 展开 / Ctrl+0 重置缩放', () => {
    expect(matchEditorKey(ev({ key: '[', ctrlKey: true }))).toEqual({ type: 'fold' });
    expect(matchEditorKey(ev({ key: ']', ctrlKey: true }))).toEqual({ type: 'unfold' });
    expect(matchEditorKey(ev({ key: '0', ctrlKey: true }))).toEqual({ type: 'reset-zoom' });
  });

  it('?（Shift+/）打开快捷键帮助', () => {
    expect(matchEditorKey(ev({ key: '?', shiftKey: true }))).toEqual({ type: 'help' });
    expect(matchEditorKey(ev({ key: '/', shiftKey: true }))).toEqual({ type: 'help' });
  });

  it('Ctrl+F 搜索 / Ctrl+D 大纲', () => {
    expect(matchEditorKey(ev({ key: 'f', ctrlKey: true }))).toEqual({ type: 'search' });
    expect(matchEditorKey(ev({ key: 'F', ctrlKey: true }))).toEqual({ type: 'search' });
    expect(matchEditorKey(ev({ key: 'd', ctrlKey: true }))).toEqual({ type: 'outline' });
  });
});

/** 带 storage 注入的 controller（复用 SAMPLE） */
function buildControllerWithStorage(storage: {
  load: () => number[][];
  save?: (paths: number[][]) => void;
}) {
  const parsed = parseMm(SAMPLE);
  const frame = new FrameScheduler({
    raf: (cb) => {
      cb();
      return 1;
    },
    rafCancel: () => undefined,
  });
  return new EditorController(
    astToEditable(parsed.root)!,
    { storage: { load: storage.load, save: storage.save ?? (() => undefined) } },
    frame,
  );
}
describe('节点转实体（M1：setEntityRef）', () => {
  function tree() {
    const frame = new FrameScheduler({
      raf: (cb) => {
        cb();
        return 1;
      },
      rafCancel: () => undefined,
    });
    const root = astToEditable(parseMm('# 根\n\n- 任务 A\n').root!)!;
    return new EditorController(root, {}, frame);
  }

  it('setEntityRef → 节点变实体（type=entity + ref；文本保留）', () => {
    const c = tree();
    const leafId = c.root.children[0]!.id;
    c.setEntityRef(leafId, { kind: 'issue', id: '1' });
    const n = c.root.children[0]!;
    expect(n.type).toBe('entity');
    expect(n.ref).toEqual({ kind: 'issue', id: '1' });
    expect(n.text).toBe('任务 A');
  });

  it('setEntityRef(null) → 清引用转回文本节点', () => {
    const c = tree();
    const leafId = c.root.children[0]!.id;
    c.setEntityRef(leafId, { kind: 'doc', id: 'a.md' });
    c.setEntityRef(leafId, null);
    const n = c.root.children[0]!;
    expect(n.type).toBe('text');
    expect(n.ref).toBeUndefined();
  });

  it('undo 回退转实体操作（与其余编辑同管线）', () => {
    const c = tree();
    const leafId = c.root.children[0]!.id;
    c.setEntityRef(leafId, { kind: 'issue', id: '1' });
    expect(c.root.children[0]!.type).toBe('entity');
    c.undo();
    expect(c.root.children[0]!.type).toBe('text');
    expect(c.root.children[0]!.ref).toBeUndefined();
  });

  it('实体节点下仍可继续加子节点（不破坏树结构）', () => {
    const c = tree();
    const leafId = c.root.children[0]!.id;
    c.setEntityRef(leafId, { kind: 'issue', id: '1' });
    const childId = c.addChild(leafId, '子任务');
    expect(childId).not.toBeNull();
    expect(c.root.children[0]!.children[0]!.text).toBe('子任务');
  });
});
