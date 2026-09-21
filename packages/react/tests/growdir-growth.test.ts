/**
 * PG 式「创建时生长」测试（ADR-0009 第一步扩展）：
 * ① 预方向双敲（W W/S S/A A/D D）② Tab 生长时按预方向固化 ③ 无预方向 → 兄弟多数/父方向推断。
 *
 * 与 growdir-pipeline.test.ts 同样锁死「接线/行为」而非孤立函数——
 * 本文件断言的是 **addChild 产出的新节点 note.dir**（固化结果）。
 */
import { describe, expect, it } from 'vitest';
import { astToEditable, getNode, parseMm, type EditableNode, type Note } from '@mindcanvas/kernel';
import { EditorController } from '../src/edit/controller.js';
import { EDITOR_KEY_BINDINGS, matchPreDirKey } from '../src/edit/keys.js';
import { FrameScheduler } from '../src/render/scheduler.js';
import { inferChildDir } from '../src/render/growDir.js';
import { contextMenuItemsFor } from '../src/edit/contextMenuItems.js';
import { makeTextNode } from '@mindcanvas/kernel';

/** 真实控制器（与 context-menu-items.test.ts 同款夹具） */
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

/** 带 note 的便捷构造 */
function nodeWithNote(text: string, note: Note): EditableNode {
  return { ...makeTextNode(text), note };
}

/** 造一个键盘事件（只取匹配器用到的字段） */
function keyEvt(key: string, extra: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { key, ...extra } as KeyboardEvent;
}

describe('① 预方向快捷键（Alt + 方向键，单键触发）', () => {
  it('Alt+方向键 → 对应方向', () => {
    expect(matchPreDirKey(keyEvt('ArrowUp', { altKey: true }))).toBe('up');
    expect(matchPreDirKey(keyEvt('ArrowDown', { altKey: true }))).toBe('down');
    expect(matchPreDirKey(keyEvt('ArrowLeft', { altKey: true }))).toBe('left');
    expect(matchPreDirKey(keyEvt('ArrowRight', { altKey: true }))).toBe('right');
  });

  it('裸方向键（导航）不被吞；带 Ctrl/Shift 不触发', () => {
    expect(matchPreDirKey(keyEvt('ArrowUp'))).toBeNull();
    expect(matchPreDirKey(keyEvt('ArrowLeft', { ctrlKey: true }))).toBeNull();
    expect(matchPreDirKey(keyEvt('ArrowUp', { shiftKey: true, altKey: true }))).toBeNull();
    expect(matchPreDirKey(keyEvt('w', { altKey: true }))).toBeNull();
  });

  it('帮助表含预方向条目（可发现性）', () => {
    expect(EDITOR_KEY_BINDINGS.some((b) => b.key.includes('Alt+'))).toBe(true);
  });
});

describe('② 生长固化：真实 controller.addChild 写入 note.dir', () => {
  it('★ 传 note 时新节点带 dir（真实树断言，非模拟）', () => {
    const c = build('# 根\n\n- A\n');
    const parentId = c.root.children[0]!.id;
    const id = c.addChild(parentId, undefined, { dir: 'left' });
    const child = getNode(c.root, id);
    expect(child?.text).toBeTruthy();
    expect(child?.note?.dir).toBe('left');
  });

  it('★ 一次 undo 同时回退新节点与其方向（单 op，不分裂历史）', () => {
    const c = build('# 根\n\n- A\n');
    const parentId = c.root.children[0]!.id;
    const id = c.addChild(parentId, undefined, { dir: 'up' });
    expect(getNode(c.root, id)?.note?.dir).toBe('up');
    expect(c.undo()).toBe(true);
    // 节点整体消失（而非残留一个无方向的空节点）
    expect(getNode(c.root, id)).toBeNull();
  });

  it('不传 note → 不写 dir（旧行为零变更）', () => {
    const c = build('# 根\n\n- A\n');
    const id = c.addChild(c.root.children[0]!.id);
    expect(getNode(c.root, id)?.note).toBeUndefined();
  });
});

describe('③ 无预方向时的自动推断（inferChildDir）', () => {
  it('兄弟多数方向优先（2 右 1 左 → right）', () => {
    const parent = makeTextNode('父', [
      { ...makeTextNode('A'), note: { dir: 'right' } },
      { ...makeTextNode('B'), note: { dir: 'right' } },
      { ...makeTextNode('C'), note: { dir: 'left' } },
    ]);
    expect(inferChildDir(parent)).toBe('right');
  });

  it('无兄弟声明 → 跟随父自己的生长侧', () => {
    const parent = { ...makeTextNode('父', [makeTextNode('A')]), note: { dir: 'up' } };
    expect(inferChildDir(parent)).toBe('up');
  });

  it('父与兄弟都无声明 → null（不写，走继承）', () => {
    const parent = makeTextNode('父', [makeTextNode('A')]);
    expect(inferChildDir(parent)).toBeNull();
  });

  it('非法 dir 值不参与推断（读侧容错一致）', () => {
    const parent = makeTextNode('父', [
      { ...makeTextNode('A'), note: { dir: 'north' } as Note },
      { ...makeTextNode('B'), note: { dir: 'down' } },
    ]);
    expect(inferChildDir(parent)).toBe('down');
  });

  it('无预方向（未按 Alt）时由推断兜底', () => {
    const parent = { ...makeTextNode('父', []), note: { dir: 'left' } };
    expect(matchPreDirKey(keyEvt('ArrowUp'))).toBeNull();
    expect(inferChildDir(parent)).toBe('left');
  });

  it('无效输入不崩（空父节点）', () => {
    const parent = makeTextNode('父');
    expect(() => inferChildDir(parent)).not.toThrow();
    expect(inferChildDir(parent)).toBeNull();
  });
});

describe('契约：预方向键不干扰既有裸键', () => {
  it('Tab/Enter/空格/方向键等不被预方向匹配吞掉', () => {
    for (const k of ['Tab', 'Enter', 'Delete', 'F2', ' ', 'ArrowUp', 'ArrowLeft']) {
      expect(matchPreDirKey(keyEvt(k))).toBeNull();
    }
  });
});

describe('④ 触发一致性：右键菜单/同级生长与 Tab 共用同一套方向推断', () => {
  it('★ addSibling 传 note → 新同级带 dir（真实树断言）', () => {
    const c = build('# 根\n\n- A\n- B\n');
    const a = c.root.children[0]!;
    const sid = c.addSibling(a.id, undefined, { dir: 'up' });
    if (sid === null) throw new Error('addSibling 不应返回 null（非根节点）');
    expect(getNode(c.root, sid)?.note?.dir).toBe('up');
  });

  it('★ addSibling 不传 note → 不写 dir（旧行为零变更）', () => {
    const c = build('# 根\n\n- A\n- B\n');
    const sid = c.addSibling(c.root.children[0]!.id);
    if (sid === null) throw new Error('addSibling 不应返回 null（非根节点）');
    expect(getNode(c.root, sid)?.note).toBeUndefined();
  });

  it('★ 右键菜单「新建子节点」：兄弟多数方向自动固化（与 Tab 生长一致）', () => {
    const c = build('# 根\n\n- A\n');
    const a = c.root.children[0]!;
    c.addChild(a.id, undefined, { dir: 'up' });
    const item = contextMenuItemsFor(c, a.id).find((i) => i.label === '新建子节点')!;
    item.onSelect!();
    const last = getNode(c.root, a.id)!.children.at(-1)!;
    expect(last.note?.dir).toBe('up');
  });

  it('★ 右键菜单「新建同级节点」：参照兄弟方向（孤立 up 兄弟也跟随）', () => {
    const c = build('# 根\n\n- A\n  - B\n');
    const a = c.root.children[0]!;
    const b = getNode(c.root, a.id)!.children[0]!;
    c.updateNote(b.id, { dir: 'up' });
    const item = contextMenuItemsFor(c, b.id).find((i) => i.label === '新建同级节点')!;
    item.onSelect!();
    const sib = getNode(c.root, a.id)!.children.at(-1)!;
    expect(sib.note?.dir).toBe('up');
  });
});
