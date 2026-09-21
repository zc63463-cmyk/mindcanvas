// @vitest-environment jsdom
/**
 * 文档库（DocLibrary）行为测试。
 *
 * 锁住：去重 / 分类筛选 / 重命名 / 删除 / 标签汇总，
 * 以及两条容易出错的约束：
 *   ① 源码快照只保留最近若干条（localStorage 有配额）
 *   ② 存储损坏时退化为内存态而不是抛错
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DocLibrary, UNTAGGED, type DocEntry } from '../src/edit/docLibrary';

const KEY = 'mindcanvas.library.v1';

function lib(): DocLibrary {
  return new DocLibrary();
}

/** 造 n 条（ts 递减，保证顺序稳定） */
function seed(n: number): DocLibrary {
  const d = lib();
  for (let i = 0; i < n; i++) {
    d.upsert({ id: `doc-${i}`, name: `文档${i}.mm.md`, source: `# 文档${i}\n- a` });
  }
  // 让 ts 严格递减（upsert 用 Date.now()，同毫秒会并列）
  const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as DocEntry[];
  raw.forEach((e, i) => {
    e.ts = 1_000_000 - i;
  });
  localStorage.setItem(KEY, JSON.stringify(raw));
  return d;
}

const FOLDERS_KEY = 'mindcanvas.folders.v1';

beforeEach(() => {
  localStorage.removeItem(KEY);
  localStorage.removeItem(FOLDERS_KEY);
});
afterEach(() => {
  localStorage.removeItem(KEY);
  localStorage.removeItem(FOLDERS_KEY);
});

describe('DocLibrary · 基本增删查', () => {
  it('空库返回空列表', () => {
    expect(lib().list()).toEqual([]);
  });

  it('upsert 后可列出，新的在前', () => {
    const d = lib();
    d.upsert({ id: 'a', name: 'A.mm.md', source: '# A' });
    d.upsert({ id: 'b', name: 'B.mm.md', source: '# B' });
    const list = d.list();
    expect(list.length).toBe(2);
    // b 后写入，ts 更新 → 排前面
    expect(list[0]!.id).toBe('b');
  });

  it('同 id 重复 upsert 只保留一条（去重）', () => {
    const d = lib();
    d.upsert({ id: 'a', name: 'A.mm.md', source: '# v1' });
    d.upsert({ id: 'a', name: 'A.mm.md', source: '# v2' });
    const list = d.list();
    expect(list.length).toBe(1);
    expect(list[0]!.source).toBe('# v2');
  });

  it('rename 只改名称，不影响其它字段', () => {
    const d = lib();
    d.upsert({ id: 'a', name: '旧名.mm.md', source: '# A' });
    d.rename('a', '新名.mm.md');
    expect(d.get('a')?.name).toBe('新名.mm.md');
    expect(d.get('a')?.source).toBe('# A');
  });

  it('remove 移除指定条目', () => {
    const d = seed(3);
    d.remove('doc-1');
    // seed 顺序：doc-0 先写、doc-2 最后写 → 列表为 [doc-2, doc-1, doc-0]，移除中间那条
    const ids = d.list().map((e) => e.id);
    expect(ids).toEqual(['doc-2', 'doc-0']);
  });

  it('重命名不存在的 id 不报错', () => {
    const d = lib();
    expect(() => d.rename('nope', 'x')).not.toThrow();
  });
});

describe('DocLibrary · 分类（标签）', () => {
  it('setTags 去重、去空白、稳定排序', () => {
    const d = lib();
    d.upsert({ id: 'a', name: 'A.mm.md', source: '# A' });
    d.setTags('a', ['工作', '  ', '工作', '灵感']);
    // 注意：排序用 localeCompare('zh')，但 Node 无完整 ICU 时退化为码点序，
    // 两种情况下「工」都在「灵」之前，故此断言在 Node 与浏览器下都成立。
    expect(d.get('a')?.tags).toEqual(['工作', '灵感']);
  });

  it('byTag 按标签筛选', () => {
    const d = seed(3);
    d.setTags('doc-0', ['工作']);
    d.setTags('doc-1', ['灵感']);
    expect(d.byTag('工作').map((e) => e.id)).toEqual(['doc-0']);
    expect(d.byTag('灵感').map((e) => e.id)).toEqual(['doc-1']);
  });

  it('byTag(UNTAGGED) 筛出无标签的', () => {
    const d = seed(3);
    d.setTags('doc-0', ['工作']);
    // 仅 doc-0 有标签；列表顺序 [doc-2, doc-1, doc-0]
    const untagged = d.byTag(UNTAGGED).map((e) => e.id);
    expect(untagged).toEqual(['doc-2', 'doc-1']);
  });

  it('byTag(null) 返回全部', () => {
    const d = seed(3);
    expect(d.byTag(null).length).toBe(3);
  });

  it('allTags 汇总全部标签（去重、排序）', () => {
    const d = seed(3);
    d.setTags('doc-0', ['工作']);
    d.setTags('doc-1', ['灵感']);
    d.setTags('doc-2', ['工作']);
    expect(d.allTags()).toEqual(['工作', '灵感']);
  });

  it('重命名/更新 tags 不影响已登记的其它条目', () => {
    const d = seed(2);
    d.setTags('doc-0', ['工作']);
    d.rename('doc-0', '改了.mm.md');
    expect(d.get('doc-0')?.tags).toEqual(['工作']);
    expect(d.get('doc-1')?.tags).toEqual([]);
  });
});

describe('DocLibrary · 存储约束', () => {
  it('源码快照只保留最近 8 条（更早的只存元数据）', () => {
    const d = seed(12);
    const list = d.list();
    expect(list.length).toBe(12);
    expect(list.slice(0, 8).every((e) => typeof e.source === 'string')).toBe(true);
    expect(list.slice(8).every((e) => e.source === undefined)).toBe(true);
  });

  it('元数据条目仍保留名称与时间（不丢索引）', () => {
    const d = seed(10);
    // 列表 [doc-9 … doc-0]，索引 9 即最旧的 doc-0
    const oldest = d.list()[9]!;
    expect(oldest.id).toBe('doc-0');
    expect(oldest.name).toBe('文档0.mm.md');
    expect(typeof oldest.ts).toBe('number');
  });

  it('存储内容损坏时不抛错，退化为内存态', () => {
    localStorage.setItem(KEY, '{ 这不是 JSON');
    const d = lib();
    expect(() => d.list()).not.toThrow();
    expect(d.list()).toEqual([]);
  });

  it('存储内容形状非法时被过滤掉', () => {
    localStorage.setItem(KEY, JSON.stringify([{ id: 1 }, null, 'x']));
    expect(lib().list()).toEqual([]);
  });
});

describe('DocLibrary · 目录（树）', () => {
  it('upsert 时指定 folder 即归入该目录', () => {
    const d = lib();
    d.upsert({ id: 'a', name: 'A.mm.md', source: '# A', folder: '工作/PomodoroXII' });
    expect(d.get('a')?.folder).toBe('工作/PomodoroXII');
  });

  it('未指定 folder 时为根目录（空字符串）', () => {
    const d = lib();
    d.upsert({ id: 'a', name: 'A.mm.md', source: '# A' });
    expect(d.get('a')?.folder).toBe('');
  });

  it('路径会被清洗：去首尾斜杠、合并重复、丢空段', () => {
    const d = lib();
    d.upsert({ id: 'a', name: 'A.mm.md', source: '# A', folder: '/工作//项目A/' });
    expect(d.get('a')?.folder).toBe('工作/项目A');
  });

  it('重复 upsert 不会丢掉已有 folder', () => {
    const d = lib();
    d.upsert({ id: 'a', name: 'A.mm.md', source: '# v1', folder: '工作' });
    d.upsert({ id: 'a', name: 'A.mm.md', source: '# v2' });
    expect(d.get('a')?.folder).toBe('工作');
    expect(d.get('a')?.source).toBe('# v2');
  });

  it('move 把文档移到另一个目录', () => {
    const d = lib();
    d.upsert({ id: 'a', name: 'A.mm.md', source: '# A', folder: '工作' });
    d.move('a', '灵感/随手');
    expect(d.get('a')?.folder).toBe('灵感/随手');
  });

  it('move 到空路径 = 移回根目录', () => {
    const d = lib();
    d.upsert({ id: 'a', name: 'A.mm.md', source: '# A', folder: '工作' });
    d.move('a', '  ');
    expect(d.get('a')?.folder).toBe('');
  });

  it('folders() 返回所有层级（含中间层）', () => {
    const d = lib();
    d.upsert({ id: 'a', name: 'A.mm.md', source: '# A', folder: '工作/PomodoroXII/架构' });
    expect(d.folders()).toEqual(['工作', '工作/PomodoroXII', '工作/PomodoroXII/架构']);
  });

  it('childrenOf(根目录) 返回一级子目录 + 直属文档', () => {
    const d = lib();
    d.upsert({ id: 'a', name: 'A.mm.md', source: '# A', folder: '工作' });
    d.upsert({ id: 'b', name: 'B.mm.md', source: '# B', folder: '灵感/随手' });
    d.upsert({ id: 'c', name: 'C.mm.md', source: '# C' });
    const root = d.childrenOf('');
    expect(root.dirs).toEqual(['工作', '灵感']);
    expect(root.docs.map((e) => e.id)).toEqual(['c']);
  });

  it('childrenOf(子目录) 只看直属，不递归', () => {
    const d = lib();
    d.upsert({ id: 'a', name: 'A.mm.md', source: '# A', folder: '工作/PomodoroXII' });
    d.upsert({ id: 'b', name: 'B.mm.md', source: '# B', folder: '工作' });
    const work = d.childrenOf('工作');
    expect(work.dirs).toEqual(['PomodoroXII']);
    expect(work.docs.map((e) => e.id)).toEqual(['b']);
  });

  it('旧数据缺 folder 字段时兜底为根目录（向后兼容）', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([{ id: 'old', name: '旧.mm.md', ts: 1000, tags: [] }]),
    );
    const d = lib();
    expect(d.get('old')?.folder).toBe('');
    expect(d.childrenOf('').docs.map((e) => e.id)).toEqual(['old']);
  });

  it('addFolder 添加自定义空目录，可在 folders() 和 childrenOf() 中列出', () => {
    const d = lib();
    d.addFolder('工作项目/前端');
    expect(d.folders()).toEqual(['工作项目', '工作项目/前端']);
    expect(d.childrenOf('').dirs).toEqual(['工作项目']);
    expect(d.childrenOf('工作项目').dirs).toEqual(['前端']);
  });

  it('removeFolder 删除目录及其子目录，并将所含文档退回根目录', () => {
    const d = lib();
    d.addFolder('待删目录/子目录');
    d.upsert({ id: 'doc1', name: 'Doc1.mm.md', source: '# 1', folder: '待删目录/子目录' });
    d.upsert({ id: 'doc2', name: 'Doc2.mm.md', source: '# 2', folder: '其他目录' });

    d.removeFolder('待删目录');
    expect(d.folders()).toEqual(['其他目录']);
    expect(d.get('doc1')?.folder).toBe('');
    expect(d.get('doc2')?.folder).toBe('其他目录');
  });

  it('ensurePresetFolders 在空库时初始化默认预置分类目录', () => {
    const d = lib();
    d.ensurePresetFolders();
    expect(d.folders()).toContain('示例导图');
    expect(d.folders()).toContain('工作项目');
  });
});
