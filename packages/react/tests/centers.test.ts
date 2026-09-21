/**
 * G6′ 中心数据层（render/centers.ts）
 *
 * 关键回归点：
 * ① 路径锚定位（不记 id —— astToEditable 每次解析都重新生成 id）
 * ② 坐标成对才生效（缺一个 → 整体交给 layoutForest 自动排列）
 * ③ **降格坐标进历史区，再升格吸附回原位**（用户决策④）
 */
import { describe, expect, it } from 'vitest';
import type { EditableNode, Note } from '@mindcanvas/kernel';
import { buildCenterSpecs } from '../src/demo/pipeline.js';
import {
  collectCenterHistory,
  collectCenters,
  forgetCenterPos,
  isGrowDir,
  removeCenter,
  upsertCenter,
} from '../src/render/centers.js';

function t(id: string, children: EditableNode[] = []): EditableNode {
  return { id, type: 'text', text: id, children };
}

function root(): EditableNode {
  return t('总览', [t('工作', [t('项目A')]), t('生活')]);
}

const AT_WORK = 'node:总览/工作';
const AT_LIFE = 'node:总览/生活';

function noteWith(centers: unknown): Note {
  return { centers } as Note;
}

describe('centers：收集与解析', () => {
  it('无 centers → 空列表', () => {
    expect(collectCenters(root())).toEqual([]);
    expect(collectCenters({ ...root(), note: noteWith(undefined) })).toEqual([]);
  });

  it('路径锚解析为 nodeId（不依赖 id）', () => {
    const r = { ...root(), note: noteWith([{ at: AT_WORK, dir: 'right', x: 10, y: 20 }]) };
    const list = collectCenters(r);
    expect(list).toHaveLength(1);
    const c = list[0]!;
    expect(c.nodeId).not.toBeNull();
    // 解析到的应是「工作」节点本身
    const work = r.children[0]!;
    expect(c.nodeId).toBe(work.id);
    expect(c.dir).toBe('right');
    expect(c.pos).toEqual({ x: 10, y: 20 });
  });

  it('实体锚 @kind:id 解析为树中实体节点（升格实体节点的逆向寻址）', () => {
    const e1: EditableNode = { id: 'e1', type: 'entity', ref: { kind: 'issue', id: '8' }, children: [] };
    const e2: EditableNode = { id: 'e2', type: 'entity', ref: { kind: 'doc', id: 'a.md' }, children: [] };
    const r = t('总览', [t('工作', [e1]), e2]);
    const r2 = { ...r, note: noteWith([{ at: '@issue:8', dir: 'down' }]) } as EditableNode;
    const list = collectCenters(r2);
    expect(list).toHaveLength(1);
    expect(list[0]!.nodeId).toBe('e1');
    expect(list[0]!.state).toBe('well-formed');
  });

  it('实体锚多命中：裸锚 stale、#N 精确命中、越界 dangling', () => {
    const a1: EditableNode = { id: 'a1', type: 'entity', ref: { kind: 'issue', id: '8' }, children: [] };
    const a2: EditableNode = { id: 'a2', type: 'entity', ref: { kind: 'issue', id: '8' }, children: [] };
    const r = t('总览', [t('甲', [a1]), t('乙', [a2])]);
    const bare = collectCenters({ ...r, note: noteWith([{ at: '@issue:8', dir: 'right' }]) })[0]!;
    expect(bare.state).toBe('stale');
    expect(bare.nodeId).toBeNull();
    const nth = collectCenters({ ...r, note: noteWith([{ at: '@issue:8#2', dir: 'right' }]) })[0]!;
    expect(nth.state).toBe('well-formed');
    expect(nth.nodeId).toBe('a2');
    const oob = collectCenters({ ...r, note: noteWith([{ at: '@issue:8#9', dir: 'right' }]) })[0]!;
    expect(oob.state).toBe('dangling');
  });

  it('G3 parent_link：缺省 hide、show 生效、非法值回落 hide', () => {
    const r = {
      ...root(),
      note: noteWith([
        { at: AT_WORK, dir: 'right' },
        { at: AT_LIFE, dir: 'left', parent_link: 'show' },
        { at: 'node:总览/不存在', dir: 'up', parent_link: 'bogus' },
      ]),
    } as EditableNode;
    const list = collectCenters(r);
    expect(list[0]!.parentLink).toBe('hide'); // 缺省 hide（兼容旧数据）
    expect(list[1]!.parentLink).toBe('show');
    expect(list[2]!.parentLink).toBe('hide'); // 非法值回落
  });

  it('G3 upsert parentLink：show 落字段、hide 删字段（协议面保持最小）', () => {
    let note = upsertCenter(undefined, AT_WORK, { dir: 'right' });
    note = upsertCenter(note, AT_WORK, { parentLink: 'show' });
    expect((note.centers as Array<Record<string, unknown>>)[0]).toMatchObject({
      at: AT_WORK,
      parent_link: 'show',
    });
    // 切回 hide → 字段删除（hide 是缺省语义，不落盘）
    note = upsertCenter(note, AT_WORK, { parentLink: 'hide' });
    const entry = (note.centers as Array<Record<string, unknown>>)[0]!;
    expect('parent_link' in entry).toBe(false);
  });

  it('坐标缺失 → pos = null（交给自动排列）', () => {
    const r = { ...root(), note: noteWith([{ at: AT_WORK, dir: 'down' }]) };
    expect(collectCenters(r)[0]!.pos).toBeNull();
  });

  it('★ 坐标只给一个 → 整体视为无坐标（成对才生效）', () => {
    const r = { ...root(), note: noteWith([{ at: AT_WORK, x: 100 }]) };
    expect(collectCenters(r)[0]!.pos).toBeNull();
  });

  it('非法 dir → 回落 right', () => {
    const r = { ...root(), note: noteWith([{ at: AT_WORK, dir: 'sideways' }]) };
    expect(collectCenters(r)[0]!.dir).toBe('right');
  });

  it('缺 dir → right', () => {
    const r = { ...root(), note: noteWith([{ at: AT_WORK }]) };
    expect(collectCenters(r)[0]!.dir).toBe('right');
  });

  it('脏数据安全跳过（非对象 / 缺 at）', () => {
    const r = {
      ...root(),
      note: noteWith([null, 'x', { dir: 'right' }, { at: AT_WORK }]),
    };
    expect(collectCenters(r)).toHaveLength(1);
  });

  it('isGrowDir 覆盖四向且拒绝其它值', () => {
    expect(['right', 'left', 'down', 'up'].every(isGrowDir)).toBe(true);
    expect(isGrowDir('up-left')).toBe(false);
    expect(isGrowDir(undefined)).toBe(false);
  });
});

describe('centers：升格（upsert）', () => {
  it('新增中心，dir 缺省补 right', () => {
    const note = upsertCenter(undefined, AT_WORK);
    const c = (note.centers as Array<Record<string, unknown>>)[0]!;
    expect(c.at).toBe(AT_WORK);
    expect(c.dir).toBe('right');
  });

  it('同 at 重复 upsert → 更新而非重复追加', () => {
    let note = upsertCenter(undefined, AT_WORK, { dir: 'right' });
    note = upsertCenter(note, AT_WORK, { dir: 'down', x: 5, y: 6 });
    expect(note.centers).toHaveLength(1);
    const c = (note.centers as Array<Record<string, unknown>>)[0]!;
    expect(c.dir).toBe('down');
    expect(c.x).toBe(5);
  });

  it('仅更新方向时优先保留当前成对坐标，不被历史坐标覆盖', () => {
    const note = {
      centers: [{ at: AT_WORK, dir: 'right', x: 10, y: 20 }],
      center_pos: [{ at: AT_WORK, x: 100, y: 200 }],
    } as Note;
    const updated = upsertCenter(note, AT_WORK, { dir: 'down' });
    expect((updated.centers as Array<Record<string, unknown>>)[0]).toMatchObject({
      at: AT_WORK,
      dir: 'down',
      x: 10,
      y: 20,
    });
  });

  it('不同 at → 各自一条', () => {
    let note = upsertCenter(undefined, AT_WORK);
    note = upsertCenter(note, AT_LIFE, { dir: 'up' });
    expect(note.centers).toHaveLength(2);
  });

  it('不修改传入的 note（不可变）', () => {
    const before = noteWith([{ at: AT_WORK, dir: 'right' }]);
    const snapshot = JSON.stringify(before);
    upsertCenter(before, AT_WORK, { x: 1, y: 2 });
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('centers：降格与吸附回原位（用户决策④）', () => {
  const placed = (): Note =>
    upsertCenter(undefined, AT_WORK, { dir: 'right', x: 320, y: -140 });

  it('前置条件：升格摆放本身不写历史区（历史区只做降格存档）', () => {
    // 若这条失败，说明 upsert 产生了副作用，会掩盖「降格不留档」的缺陷
    expect(collectCenterHistory(placed()).has(AT_WORK)).toBe(false);
  });

  it('★ 降格：从 centers 移除，坐标进历史区', () => {
    const note = removeCenter(placed(), AT_WORK);
    expect(note.centers).toHaveLength(0);
    const history = collectCenterHistory(note);
    expect(history.get(AT_WORK)).toEqual({ x: 320, y: -140 });
  });

  it('★ 再升格：自动吸附回原位（未显式给坐标时）', () => {
    const note = removeCenter(placed(), AT_WORK);
    const again = upsertCenter(note, AT_WORK, { dir: 'right' });
    const c = (again.centers as Array<Record<string, unknown>>)[0]!;
    expect(c.x).toBe(320);
    expect(c.y).toBe(-140);

    // 端到端：解析出来的 pos 也回到原位
    const r = { ...root(), note: again };
    expect(collectCenters(r)[0]!.pos).toEqual({ x: 320, y: -140 });
  });

  it('显式给坐标 → 以新坐标为准；历史区保持降格那一刻的存档', () => {
    const note = removeCenter(placed(), AT_WORK);
    const again = upsertCenter(note, AT_WORK, { dir: 'right', x: 999, y: 888 });
    expect((again.centers as Array<Record<string, unknown>>)[0]!.x).toBe(999);
    // 历史区只记录「降格瞬间」的位置，不被随后的升格覆盖；
    // 下次降格时才更新为 999/888
    expect(collectCenterHistory(again).get(AT_WORK)).toEqual({ x: 320, y: -140 });
  });

  it('再次降格 → 历史区更新为最新摆放位置', () => {
    const note = removeCenter(placed(), AT_WORK);
    const again = upsertCenter(note, AT_WORK, { dir: 'right', x: 999, y: 888 });
    const again2 = removeCenter(again, AT_WORK);
    expect(collectCenterHistory(again2).get(AT_WORK)).toEqual({ x: 999, y: 888 });
  });

  it('dropPos=true → 彻底丢弃，再升格为自动排列（无坐标）', () => {
    const note = removeCenter(placed(), AT_WORK, true);
    expect(collectCenterHistory(note).has(AT_WORK)).toBe(false);
    const again = upsertCenter(note, AT_WORK, { dir: 'right' });
    const c = (again.centers as Array<Record<string, unknown>>)[0]!;
    expect(c.x).toBeUndefined();
    expect(collectCenters({ ...root(), note: again })[0]!.pos).toBeNull();
  });

  it('forgetCenterPos 只清指定 at', () => {
    // 先降格产生 AT_WORK 存档，再手工加一条 AT_LIFE
    let note = remember(removeCenter(placed(), AT_WORK), AT_LIFE, { x: 1, y: 2 });
    note = forgetCenterPos(note, AT_LIFE);
    expect(collectCenterHistory(note).has(AT_LIFE)).toBe(false);
    expect(collectCenterHistory(note).has(AT_WORK)).toBe(true);
  });

  it('历史区脏数据安全跳过', () => {
    const note = { center_pos: [null, 'x', { at: AT_WORK }, { at: AT_LIFE, x: 1 }] } as Note;
    const history = collectCenterHistory(note);
    expect(history.size).toBe(0);
  });
});

describe('buildCenterSpecs：中心标注 → 中心清单', () => {
  const r = root();
  const workId = r.children[0]!.id;
  const lifeId = r.children[1]!.id;

  it('无中心标注 → null（回退既有单树 layoutMindmap，行为完全不变）', () => {
    expect(buildCenterSpecs(r, [])).toBeNull();
  });

  it('升格一个子节点 → 虚拟根（未升格部分）+ 该中心', () => {
    const specs = buildCenterSpecs(r, [
      { nodeId: workId, at: AT_WORK, dir: 'right', pos: null, state: 'well-formed' },
    ])!;
    expect(specs).toHaveLength(2);
    // 虚拟根：复用根的度量属性，但 children 只剩未升格的「生活」
    expect(specs[0]!.node.children.map((c) => c.text)).toEqual(['生活']);
    expect(specs[0]!.dir).toBe('right');
    expect(specs[0]!.pos).toBeUndefined(); // 无坐标 → 自动排列
    // 升格的子树：完整保留自己的 children
    expect(specs[1]!.node.text).toBe('工作');
    expect(specs[1]!.node.children.map((c) => c.text)).toEqual(['项目A']);
  });

  it('全部子节点都升格 → 无虚拟根', () => {
    const specs = buildCenterSpecs(r, [
      { nodeId: workId, at: AT_WORK, dir: 'down', pos: { x: 10, y: 20 }, state: 'well-formed' },
      { nodeId: lifeId, at: AT_LIFE, dir: 'up', pos: { x: 30, y: 40 }, state: 'well-formed' },
    ])!;
    expect(specs).toHaveLength(2);
    expect(specs.map((s) => s.node.text).sort()).toEqual(['工作', '生活']);
  });

  it('中心带 pos → spec 带上坐标；无 pos → 交给自动排列', () => {
    const specs = buildCenterSpecs(r, [
      { nodeId: workId, at: AT_WORK, dir: 'down', pos: { x: 7, y: 9 }, state: 'well-formed' },
      { nodeId: lifeId, at: AT_LIFE, dir: 'right', pos: null, state: 'well-formed' },
    ])!;
    const work = specs.find((s) => s.node.text === '工作')!;
    const life = specs.find((s) => s.node.text === '生活')!;
    expect(work.pos).toEqual({ x: 7, y: 9 });
    expect(life.pos).toBeUndefined();
  });

  it('无效 nodeId → 跳过该中心（不产生空 spec）', () => {
    const specs = buildCenterSpecs(r, [
      { nodeId: 'no-such-id', at: 'node:总览/不存在', dir: 'right', pos: null, state: 'well-formed' },
      { nodeId: workId, at: AT_WORK, dir: 'right', pos: null, state: 'well-formed' },
    ])!;
    expect(specs).toHaveLength(2); // 虚拟根(含生活) + 工作
    expect(specs.some((s) => s.node.text === '工作')).toBe(true);
  });

  it('全部中心都无效 → null（回退单树）', () => {
    const specs = buildCenterSpecs(r, [
      { nodeId: 'x', at: 'node:总览/x', dir: 'right', pos: null, state: 'well-formed' },
      { nodeId: 'y', at: 'node:总览/y', dir: 'right', pos: null, state: 'well-formed' },
    ]);
    // 悬空 nodeId 在树上解析不到 → 不产生独立岛 → 回退单树。
    // 刻意不退化成「只含根岛的森林」：那样虽能渲染出同样的树，
    // 却会绕开 LayoutCache 做全量重算。
    expect(specs).toBeNull();
  });

  it('端到端：collectCenters → buildCenterSpecs 串起来', () => {
    const withNote = {
      ...root(),
      note: upsertCenter(undefined, AT_WORK, { dir: 'down', x: 100, y: 200 }),
    };
    const specs = buildCenterSpecs(withNote, collectCenters(withNote))!;
    const work = specs.find((s) => s.node.text === '工作')!;
    expect(work.dir).toBe('down');
    expect(work.pos).toEqual({ x: 100, y: 200 });
  });
});

/** 测试内小工具：直接构造带历史坐标的 note */
function remember(note: Note, at: string, pos: { x: number; y: number }): Note {
  const raw = note.center_pos;
  const list = Array.isArray(raw) ? raw.filter((i) => typeof i === 'object' && i !== null) : [];
  return { ...note, center_pos: [...list, { at, ...pos }] } as Note;
}
