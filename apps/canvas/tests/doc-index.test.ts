// @vitest-environment jsdom
/**
 * P0-D 索引层（`apps/canvas/src/docIndex.ts`）行为测试。
 *
 * 锁住四件事（对应 acceptance-and-backlog 的 P0-D 四条负控）：
 *  ① **旧键损坏**下索引仍可用且不崩（归一化/过滤守卫）；
 *  ② 迁移**幂等**：同一旧键迁移两次结果一致（可中断续跑）；
 *  ③ **唯一同名命中 ≠ 归属证据**：不自动绑定，进历史池（§6.2.1）；
 *  ④ **降级投影**：升级后新增的收藏/最近在旧结构里真的读得到（I-21）。
 *
 * 另测 UD-2：`openedAt` 只由打开推进、`savedAt` 不参与「最近」排序、`null` 排末尾。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ASSET_INDEX_KEY,
  DOC_INDEX_KEY,
  LEGACY_ASSET_FAV_KEY,
  LEGACY_CANVAS_RECENT_KEY,
  LEGACY_LIBRARY_KEY,
  LEGACY_STARRED_KEY,
  DocIndex,
  compareRecent,
  evidenceFromRegistry,
  fileNameOf,
  formatRecentWhen,
  hasOwnershipEvidence,
  migrateContextOf,
  wsDocKey,
  type IndexStore,
  type MigrateContext,
} from '../src/docIndex.js';

const HANDLES_DB_HINT = 'mindcanvas-handles';

/**
 * 取第一个元素（不存在则抛清晰的断言错误）。
 *
 * 用它在测试里替代 `arr[0]!.x`：非空断言会让 lint 记一条 warning（债务基线冻结），
 * 而这里本就需要「不存在即失败」的语义，用显式断言表达更准确。
 */
function first<T>(list: readonly T[]): T {
  const hit = list[0];
  if (hit === undefined) throw new Error('期望至少一个元素，实际为空');
  return hit;
}

/** 取一条被断言「必须存在」的记录（同上：不用非空断言） */
function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('期望条目存在，实际为 undefined');
  return v;
}

function store(): IndexStore {
  return {
    get: (k) => localStorage.getItem(k),
    set: (k, v) => localStorage.setItem(k, v),
  };
}

/** 有历史证据的磁盘作用域（本次以 isSameEntry 建立） */
function diskCtx(scopeId = 'ws:aaaa', over: Partial<MigrateContext> = {}): MigrateContext {
  return {
    scopeId,
    persisted: true,
    hasHistoryEvidence: true,
    handleStoreAvailable: false,
    ...over,
  };
}

/** 无历史证据的磁盘作用域（legacy adoption 新生成的 scopeId） */
function adoptedCtx(scopeId = 'ws:adopted'): MigrateContext {
  return diskCtx(scopeId, { hasHistoryEvidence: false });
}

/**
 * §6.2.1 生效后，M5/M6 只**认领既有条目**，不再凭旧库/旧收藏键的字符串
 * 凭空造 `ws:` 身份（「唯一同名命中 ≠ 归属证据」，且造出来的 entry 的
 * `openedAt` 只能靠编造）。所以凡是需要「迁移结果里出现条目」的用例，
 * 必须先把该文档按真实句柄登记进索引——这正是生产里的先后顺序：
 * 用户先在工作区打开它（`registerDoc`），下次启动才跑迁移。
 */
function seedRegistered(d: DocIndex, relPath = '架构.mm.md', scopeId = 'ws:aaaa'): void {
  d.registerDoc({
    docKey: wsDocKey(scopeId, relPath),
    relPath,
    name: fileNameOf(relPath),
    scopeId,
    persisted: true,
    sourceRef: { kind: 'disk-handle' },
  });
}

function idx(ctx: MigrateContext, now = 1_000): DocIndex {
  let t = now;
  return new DocIndex({
    store: store(),
    now: () => t,
    makeLineageId: () => {
      t += 1;
      return `lin-${t}`;
    },
    ctx: () => ctx,
  });
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------- UD-2：时间语义

describe('DocIndex · openedAt / savedAt（UD-2）', () => {
  it('打开推进 openedAt，保存不推进；保存只推进 savedAt', () => {
    const d = idx(diskCtx());
    const key = wsDocKey('ws:aaaa', '研发/架构.mm.md');
    d.openDoc({ docKey: key, relPath: '研发/架构.mm.md', name: '架构.mm.md' }, 100);
    expect(d.getDoc(key)?.openedAt).toBe(100);
    expect(d.getDoc(key)?.savedAt).toBe(100);

    d.saveDoc({ docKey: key, relPath: '研发/架构.mm.md', name: '架构.mm.md' }, 200);
    expect(d.getDoc(key)?.savedAt).toBe(200);
    expect(d.getDoc(key)?.openedAt).toBe(100); // 保存**不**推进打开时间

    d.openDoc({ docKey: key, relPath: '研发/架构.mm.md', name: '架构.mm.md' }, 300);
    expect(d.getDoc(key)?.openedAt).toBe(300);
    expect(d.getDoc(key)?.savedAt).toBe(200);
  });

  it('「最近」按 openedAt 降序：保存更晚但打开更早的文档仍排后面', () => {
    const d = idx(diskCtx());
    const a = wsDocKey('ws:aaaa', 'a.mm.md');
    const b = wsDocKey('ws:aaaa', 'b.mm.md');
    d.openDoc({ docKey: a, relPath: 'a.mm.md', name: 'a.mm.md' }, 100);
    d.openDoc({ docKey: b, relPath: 'b.mm.md', name: 'b.mm.md' }, 200);
    // b 后来被保存（savedAt 更大），但 a 才是最近打开的
    d.saveDoc({ docKey: b, relPath: 'b.mm.md', name: 'b.mm.md' }, 900);
    d.openDoc({ docKey: a, relPath: 'a.mm.md', name: 'a.mm.md' }, 1_000);
    expect(d.recentDocs().map((e) => e.name)).toEqual(['a.mm.md', 'b.mm.md']);
  });

  it('openedAt === null 排末尾且显示「未记录打开时间」（不回落 mtime）', () => {
    const d = idx(adoptedCtx());
    // 迁移来的旧条目：savedAt 很大（旧库的访问时间），但 openedAt 必须保持 null
    localStorage.setItem(
      LEGACY_LIBRARY_KEY,
      JSON.stringify([{ id: '旧.mm.md', name: '旧.mm.md', ts: 9_999_999, folder: '', tags: [] }]),
    );
    // 无历史证据 → 进历史池，不建条目；改成一个有证据的作用域来建条目。
    // 注意：M5 只认领**既有**条目（`library.v1` 的 id 只是文件名，不是目录身份），
    // 所以这里必须先有一条由真实句柄注册出来的条目，而不是凭空迁移。
    const d2 = idx(diskCtx());
    d2.registerDoc({
      docKey: wsDocKey('ws:aaaa', '旧.mm.md'),
      relPath: '旧.mm.md',
      name: '旧.mm.md',
      scopeId: 'ws:aaaa',
      persisted: true,
      sourceRef: { kind: 'disk-handle' },
    });
    localStorage.setItem(
      LEGACY_LIBRARY_KEY,
      JSON.stringify([{ id: '旧.mm.md', name: '旧.mm.md', ts: 9_999_999, folder: '', tags: [] }]),
    );
    d2.migrate();
    const migrated = first(d2.listDocs());
    expect(migrated.openedAt).toBeNull(); // ← 绝不把 ts(9_999_999) 当成打开时间
    expect(migrated.savedAt).toBe(9_999_999);

    d2.openDoc({ docKey: wsDocKey('ws:aaaa', '新.mm.md'), relPath: '新.mm.md', name: '新.mm.md' }, 5);
    // 有打开时间的排前，null 排末尾（哪怕它的 savedAt 大得多）
    expect(d2.recentDocs().map((e) => e.name)).toEqual(['新.mm.md', '旧.mm.md']);
    expect(formatRecentWhen(migrated.openedAt)).toBe('未记录打开时间');
    expect(d.listDocs()).toEqual([]); // 无证据作用域：一条条目都不建
  });

  it('`formatRecentWhen`：只有 `null` 是「未记录打开时间」，`0` 是真实时间戳', () => {
    // 签名是 `number | null`，`0` 不是哨兵值（不会由 `openedAt` 的缺省产生）——
    // 缺省一律是 `null`（见 `DocIndexEntry.openedAt` 的注释与 UD-2）。
    // 若把 `0` 也当「未记录」，一个真实打开于 epoch 0 的条目会被显示成从没开过。
    expect(formatRecentWhen(null, 1_000)).toBe('未记录打开时间');
    expect(formatRecentWhen(0, 1_000)).toBe('刚刚'); // 0 是「很久以前」→ 落到日期分支
  });

  it('compareRecent 的 null 分支按 savedAt 降序稳定排列', () => {
    const base = {
      docKey: 'k',
      scopeId: 'browser:local',
      relPath: null,
      lineageId: 'l',
      name: 'n',
      title: null,
      starred: false,
      sourceRef: { kind: 'none' as const },
      legacyKeys: [],
    };
    const withOpen = { ...base, openedAt: 1, savedAt: 1 };
    const noOpenBig = { ...base, openedAt: null, savedAt: 900 };
    const noOpenSmall = { ...base, openedAt: null, savedAt: 100 };
    const sorted = [noOpenSmall, withOpen, noOpenBig].sort(compareRecent);
    expect(sorted.map((e) => e.savedAt)).toEqual([1, 900, 100]);
  });
});

// ---------------------------------------------------------------- NC-1：旧键损坏

describe('DocIndex · 损坏旧数据仍可用（NC-1 期望）', () => {
  it('索引键本身损坏时不抛错、退回空索引', () => {
    localStorage.setItem(DOC_INDEX_KEY, '{ 这不是 JSON');
    localStorage.setItem(ASSET_INDEX_KEY, 'null');
    expect(() => idx(diskCtx()).listDocs()).not.toThrow();
    expect(idx(diskCtx()).listDocs()).toEqual([]);
  });

  it('索引条目形状非法时被过滤，合法的仍保留（与 docLibrary 同规）', () => {
    localStorage.setItem(
      DOC_INDEX_KEY,
      JSON.stringify([
        { docKey: 'browser::good', scopeId: 'browser:local', name: '好.mm.md', savedAt: 5 },
        null,
        'x',
        { name: '没有主键' },
        { docKey: '' },
      ]),
    );
    const d = idx(diskCtx());
    expect(d.listDocs().map((e) => e.docKey)).toEqual(['browser::good']);
    // 未知字段保留（前向兼容）
    expect(d.getDoc('browser::good')?.legacyKeys).toEqual([]);
    expect(d.getDoc('browser::good')?.openedAt).toBeNull();
  });

  it('旧库键无法解析时迁移不崩：不删旧键、不误报成功', () => {
    localStorage.setItem(LEGACY_LIBRARY_KEY, '{ 坏掉的旧库');
    localStorage.setItem(LEGACY_STARRED_KEY, '不是数组');
    const d = idx(diskCtx());
    const r = d.migrate();
    expect(r.migrated).toBe(0); // 解析不了的批次绝不记成已迁移
    expect(r.unchanged).toBe(0);
    expect(localStorage.getItem(LEGACY_LIBRARY_KEY)).toBe('{ 坏掉的旧库'); // 不删除旧数据
    expect(d.listDocs()).toEqual([]);
  });

  it('旧库键可解析但形状非法时整批记为未迁移', () => {
    localStorage.setItem(LEGACY_LIBRARY_KEY, '{"not":"array"}');
    const r = idx(diskCtx()).migrate();
    expect(r.failed).toBe(1);
    expect(r.migrated).toBe(0);
    expect(localStorage.getItem(LEGACY_LIBRARY_KEY)).toBe('{"not":"array"}');
  });

  it('旧库数组里混入非法条目时只跳过那一条', () => {
    localStorage.setItem(
      LEGACY_LIBRARY_KEY,
      JSON.stringify([{ id: '好.mm.md', name: '好.mm.md', ts: 10 }, null, { name: '缺 id' }]),
    );
    const d = idx(diskCtx());
    seedRegistered(d, '好.mm.md');
    const r = d.migrate();
    expect(r.migrated).toBe(1);
    expect(r.failed).toBe(2);
  });
});

// ---------------------------------------------------------------- NC-2：迁移幂等

describe('DocIndex · 迁移幂等与续跑（NC-2 期望）', () => {
  /**
   * 本 describe 内的每个用例显式播种。
   *
   * 为什么不放在 describe 级 `beforeEach`：外层已有全局 `beforeEach(() => localStorage.clear())`，
   * 而 vitest 的 hook 顺序是**外层先跑**——外层 clear 会把内层种的数据清掉，
   * 用例于是跑在空旧库上（曾因此得到「migrated=3」这种反直觉结果）。
   */
  const seedLegacy = (): void => {
    localStorage.setItem(
      LEGACY_LIBRARY_KEY,
      JSON.stringify([{ id: '架构.mm.md', name: '架构.mm.md', ts: 42, folder: '', tags: [] }]),
    );
    localStorage.setItem(LEGACY_STARRED_KEY, JSON.stringify(['架构.mm.md']));
  };



  it('同一旧键迁移两次结果一致（条目、时间、legacyKeys 全不动）', () => {
    seedLegacy();
    const ctx = diskCtx();
    const d = idx(ctx);
    seedRegistered(d);
    const run1 = d.migrate();
    const snapshot = JSON.stringify(d.listDocs());
    const run2 = d.migrate();
    expect(run1.migrated).toBeGreaterThan(0);
    expect(run2.migrated).toBe(0); // 第二次全部 unchanged
    expect(run2.unchanged).toBeGreaterThan(0);
    expect(JSON.stringify(d.listDocs())).toBe(snapshot);
    // 迁移不得编造打开时间
    expect(d.listDocs().every((e) => e.openedAt === null)).toBe(true);
    // 收藏被迁移（M6 精确命中）
    expect(first(d.listDocs()).starred).toBe(true);
  });

  it('第一批未处理完的旧键在后续调用时补齐（可中断续跑）', () => {
    // 造 5 条，batch=2 分三批
    const many = Array.from({ length: 5 }, (_, i) => ({
      id: `d${i}.mm.md`,
      name: `d${i}.mm.md`,
      ts: i + 1,
      folder: '',
      tags: [],
    }));
    // 旧库里的 id 要能精确命中当前作用域的 relPath（§6.2.1）。
    // 注意：只写这 5 条——不要先 `seedLegacy()`，否则旧库是 6 条，
    // batch=2 的第一批会连第 3 条（前一个 seed 的条目）一起处理。
    localStorage.setItem(LEGACY_LIBRARY_KEY, JSON.stringify(many));
    const d = idx(diskCtx());
    for (let i = 0; i < 5; i += 1) seedRegistered(d, `d${i}.mm.md`);

    // 每批只认领 batch 条：游标必须**持久化**，否则每次都从旧键第 0 条重来，
    // 第 2、3 批永远停在原地（进度不推进 = 用户点了半天还在同一批）。
    // 被认领条目的计数用 **legacyKeys 命中数**而不是 listDocs().length：
    // 五条 `ws:` 条目在登记时就已存在（`seedRegistered`），长度恒为 5。
    const claimed = (): number =>
      d.listDocs().filter((e) => e.legacyKeys.some((k) => k.startsWith(LEGACY_LIBRARY_KEY)))
        .length;
    const r1 = d.migrate({ batch: 2 });
    expect(r1.migrated).toBe(2);
    expect(claimed()).toBe(2); // ← 只认领了 2 条
    const r2 = d.migrate({ batch: 2 });
    expect(r2.migrated).toBe(2);
    expect(claimed()).toBe(4);
    const r3 = d.migrate({ batch: 2 });
    expect(r3.migrated).toBe(1); // 最后一条
    expect(claimed()).toBe(5);

    // 五条旧键全部最终被认领，无明显漏项
    expect(claimed()).toBe(5);
  });

  it('续跑不依赖内存状态：新实例（模拟刷新）重跑得到同样结果且不重复', () => {
    seedLegacy();
    const ctx = diskCtx();
    seedRegistered(idx(ctx));
    idx(ctx).migrate();
    const after = JSON.parse(localStorage.getItem(DOC_INDEX_KEY) ?? '{}') as {
      entries: unknown[];
    };
    const reloaded = idx(ctx);
    const r = reloaded.migrate();
    expect(r.migrated).toBe(0);
    expect(r.unchanged).toBeGreaterThan(0); // 新实例重跑仍认出「已迁移」
    const now = JSON.parse(localStorage.getItem(DOC_INDEX_KEY) ?? '{}') as { entries: unknown[] };
    expect(now.entries).toHaveLength(after.entries.length); // 不重复建条目
  });
});

// ---------------------------------------------------------------- NC-3：唯一同名命中

describe('DocIndex · 归属证据（§6.2.1 / NC-3 期望）', () => {
  const legacy = [{ id: '研发/架构.mm.md', name: '架构.mm.md', ts: 7, folder: '研发', tags: [] }];

  it('M5：他区同名条目不被他区旧库键认领（existing 查找须限定当前作用域）', () => {
    // 当前作用域 ws:bbbb（无证据）的旧库里有一条与 ws:aaaa 条目同 relPath 的记录。
    // 若不限定作用域，M5 会把 ws:aaaa 的条目标上 ws:bbbb 的 legacyKeys，
    // 等于把别人的条目当成本区的历史。
    //
    // 注意必须让**当前作用域有证据**（`diskCtx`，而非 `adoptedCtx`）：
    // 无证据时 M5 会先走「证据不足 → 历史池」直接 continue，`existing` 根本不被查——
    // 那样这条用例就测不到被评审指出的分支（我第一版正是这么写错的）。
    localStorage.setItem(
      LEGACY_LIBRARY_KEY,
      JSON.stringify([{ id: '研发/笔记.mm.md', name: '笔记.mm.md', ts: 5, folder: '研发', tags: [] }]),
    );
    const d = idx(diskCtx('ws:bbbb'));
    d.registerDoc({
      docKey: 'ws:aaaa::研发/笔记.mm.md',
      relPath: '研发/笔记.mm.md',
      name: '笔记.mm.md',
      scopeId: 'ws:aaaa',
      persisted: true,
      sourceRef: { kind: 'disk-handle' },
    });
    seedRegistered(d, '研发/笔记.mm.md', 'ws:bbbb');
    d.migrate();
    // ① 他区的条目**不得**被本区的旧键污染
    expect(d.getDoc('ws:aaaa::研发/笔记.mm.md')?.legacyKeys).toEqual([]);
    // ② 本区条目认领自己的旧键（本区有自己的真实句柄证据）
    expect(d.getDoc('ws:bbbb::研发/笔记.mm.md')?.legacyKeys).toContain(
      `${LEGACY_LIBRARY_KEY}#研发/笔记.mm.md`,
    );
    // ③ 两条条目各自独立，`legacyKeys` 不串
    expect(d.listDocs().length).toBe(2);
    expect(d.historyPool()).toEqual([]);
  });

  it('M5：浏览器身份条目仍可被同 relPath 的旧库键认领（兼容模式打开过它）', () => {
    localStorage.setItem(
      LEGACY_LIBRARY_KEY,
      JSON.stringify([{ id: 'a.mm.md', name: 'a.mm.md', ts: 5, folder: '', tags: [] }]),
    );
    // 浏览器作用域（scopeId 就是 BROWSER_SCOPE_ID）→ existing 命中是合法的
    const d = idx(diskCtx('browser:local'));
    d.registerDoc({
      docKey: 'browser::a.mm.md',
      relPath: 'a.mm.md',
      name: 'a.mm.md',
      scopeId: 'browser:local',
      persisted: true,
      sourceRef: { kind: 'none' },
    });
    const r = d.migrate();
    expect(r.migrated).toBeGreaterThan(0);
    expect(d.getDoc('browser::a.mm.md')?.legacyKeys).toContain(
      `${LEGACY_LIBRARY_KEY}#a.mm.md`,
    );
    expect(d.listDocs().length).toBe(1); // 不重复建条目
  });

  it('唯一同名命中不自动绑定，进历史池', () => {
    localStorage.setItem(LEGACY_LIBRARY_KEY, JSON.stringify(legacy));
    // legacy adoption 新生成的 scopeId：无历史证据
    const d = idx(adoptedCtx());
    const r = d.migrate();
    expect(r.migrated).toBe(0);
    expect(d.listDocs()).toEqual([]); // ← 不建条目 = 不认领
    expect(d.historyPool().map((h) => h.key)).toEqual(['研发/架构.mm.md']);
    expect(first(d.historyPool()).reason).toBe('no-evidence');
    // 旧键保留（用户不处理也不丢）；folder 会被包侧 normalize 清洗掉首尾斜杠
    const kept = JSON.parse(localStorage.getItem(LEGACY_LIBRARY_KEY) ?? '[]') as Array<{
      id: string;
    }>;
    expect(kept.map((e) => e.id)).toEqual(['研发/架构.mm.md']);
  });

  it('M5：本区有证据但索引里没有这条文档 → 不凭空造 `ws:` 条目（旧库 id 只是文件名）', () => {
    // `library.v1` 的 `id` 是 `doc.id` = **文件名**（`document.ts:151` 的
    // `upsert({ id: doc.id, ... })`）。文件名不是目录身份：本区「有历史证据」
    // 只证明**目录**没错，不证明这个文件名对应的就是工作区里的那一份
    // （§6.2.1「唯一同名命中 ≠ 归属证据」）。也没有既有条目可供 `openedAt`——
    // 凭空造出来的条目只能把注册时刻当打开时间（违反 UD-2）。
    localStorage.setItem(LEGACY_LIBRARY_KEY, JSON.stringify(legacy));
    const d = idx(diskCtx('ws:aaaa')); // 有证据，但索引里**没有**这条文档
    const r = d.migrate();
    expect(r.migrated).toBe(0);
    expect(d.listDocs()).toEqual([]); // ← 不造条目
    expect(d.historyPool().map((h) => h.key)).toEqual(['研发/架构.mm.md']);
    expect(first(d.historyPool()).reason).toBe('no-existing-entry');
  });

  it('投影不得抹掉尚未迁移的畸形旧行（`null` / 缺 id）', () => {
    // `registerDoc` → `persist` → `project()` 会在**每次打开文档**时重写
    // `library.v1`。若投影只写得出「有 id 的合法行」，这些畸形行会被静默删除，
    // 于是「升级即丢历史」，且 M5 再也读不到它们（`failed` 恒为 0）。
    localStorage.setItem(
      LEGACY_LIBRARY_KEY,
      JSON.stringify([{ id: '好.mm.md', name: '好.mm.md', ts: 10 }, null, { name: '缺 id' }]),
    );
    const d = idx(diskCtx());
    seedRegistered(d, '好.mm.md');
    const r = d.migrate();
    expect(r.failed).toBe(2); // ← 畸形行仍在旧库里被逐条判定
    const kept = JSON.parse(localStorage.getItem(LEGACY_LIBRARY_KEY) ?? '[]') as unknown[];
    expect(kept).toHaveLength(3); // ← 一行没少
    expect(kept[1]).toBeNull();
    expect(kept[2]).toEqual({ name: '缺 id' });
  });

  it('有 isSameEntry 证据的作用域下，精确 relPath 命中才迁移', () => {
    localStorage.setItem(LEGACY_LIBRARY_KEY, JSON.stringify(legacy));
    const d = idx(diskCtx('ws:proven'));
    // 「精确命中」的命中对象是**索引里已有的条目**（它由真实句柄登记而来），
    // 不是旧库字符串本身——§6.2.1 要求证据来自目录身份，而非同名。
    d.registerDoc({
      docKey: 'ws:proven::研发/架构.mm.md',
      relPath: '研发/架构.mm.md',
      name: '架构.mm.md',
      scopeId: 'ws:proven',
      persisted: true,
      sourceRef: { kind: 'disk-handle' },
    });
    expect(d.migrate().migrated).toBe(1);
    expect(first(d.listDocs()).docKey).toBe('ws:proven::研发/架构.mm.md');
    expect(first(d.listDocs()).legacyKeys).toContain(`${LEGACY_LIBRARY_KEY}#研发/架构.mm.md`);
    expect(d.historyPool()).toEqual([]);
  });

  it('用户显式「关联到此工作区」后才绑定，并留下 relinkEvidence', () => {
    localStorage.setItem(LEGACY_LIBRARY_KEY, JSON.stringify(legacy));
    const d = idx(adoptedCtx());
    d.migrate();
    // 先由真实打开/保存建立目标条目（用户在工作区里打开了这份文档）
    const key = 'ws:adopted::研发/架构.mm.md';
    d.openDoc({ docKey: key, relPath: '研发/架构.mm.md', name: '架构.mm.md' }, 500);
    expect(d.relink('研发/架构.mm.md', key, 600)).toBe(true);
    expect(d.getDoc(key)?.relinkEvidence).toEqual({ at: 600, via: 'user-confirmed' });
    expect(d.getDoc(key)?.legacyKeys).toContain('研发/架构.mm.md');
    expect(d.historyPool()).toEqual([]);
  });

  it('relink 拒绝跨作用域目标（不伪造归属证据）', () => {
    localStorage.setItem(LEGACY_LIBRARY_KEY, JSON.stringify(legacy));
    const d = idx(adoptedCtx('ws:mine'));
    d.migrate();
    // 另有一条属于**别的作用域**的同名文档
    d.registerDoc({
      docKey: 'ws:other::研发/架构.mm.md',
      relPath: '研发/架构.mm.md',
      name: '架构.mm.md',
      scopeId: 'ws:other',
      persisted: true,
      sourceRef: { kind: 'disk-handle' },
    });
    expect(d.relink('研发/架构.mm.md', 'ws:other::研发/架构.mm.md')).toBe(false);
    expect(d.getDoc('ws:other::研发/架构.mm.md')?.relinkEvidence).toBeUndefined();
    // 历史池条目仍在（没被错误消费掉）
    expect(d.historyPool().map((h) => h.key)).toEqual(['研发/架构.mm.md']);
  });

  it('relink 拒绝不存在的目标（不允许凭一次点击凭空造身份）', () => {
    localStorage.setItem(LEGACY_LIBRARY_KEY, JSON.stringify(legacy));
    const d = idx(adoptedCtx('ws:mine'));
    d.migrate();
    expect(d.relink('研发/架构.mm.md', 'ws:mine::不存在.mm.md')).toBe(false);
    expect(d.getDoc('ws:mine::不存在.mm.md')).toBeUndefined();
    expect(d.historyPool().map((h) => h.key)).toEqual(['研发/架构.mm.md']);
  });

  it('忽略只从呈现移除，不改索引、不删旧键', () => {
    localStorage.setItem(LEGACY_LIBRARY_KEY, JSON.stringify(legacy));
    const d = idx(adoptedCtx());
    d.migrate();
    d.ignoreLegacy('研发/架构.mm.md');
    expect(d.historyPool()).toEqual([]);
    expect(localStorage.getItem(LEGACY_LIBRARY_KEY)).not.toBeNull();
  });

  it('ephemeral（上次会话的 disk-session）作用域的旧条目进历史池，不自动绑定', () => {
    localStorage.setItem(LEGACY_LIBRARY_KEY, JSON.stringify(legacy));
    const d = idx(diskCtx('ws:session', { persisted: false, hasHistoryEvidence: false }));
    const r = d.migrate();
    expect(r.migrated).toBe(0);
    expect(first(d.historyPool()).reason).toBe('ephemeral-scope');
  });

  it('hasOwnershipEvidence：无 relPath / 未持久 / 无证据 一律 false', () => {
    expect(hasOwnershipEvidence(diskCtx(), null)).toBe(false);
    expect(hasOwnershipEvidence(diskCtx(), '')).toBe(false);
    expect(hasOwnershipEvidence(adoptedCtx(), 'a.mm.md')).toBe(false);
    expect(
      hasOwnershipEvidence(diskCtx('ws:x', { persisted: false }), 'a.mm.md'),
    ).toBe(false);
    expect(hasOwnershipEvidence(diskCtx(), 'a.mm.md')).toBe(true);
  });

  it('M11 衔接：legacy adoption（session-only）不算证据，isSameEntry 才算', () => {
    expect(
      evidenceFromRegistry([{ scopeId: 'ws:a', associations: [{ via: 'session-only' }] }], 'ws:a'),
    ).toBe(false);
    expect(
      evidenceFromRegistry([{ scopeId: 'ws:a', associations: [{ via: 'isSameEntry' }] }], 'ws:a'),
    ).toBe(true);
    expect(
      evidenceFromRegistry(
        [{ scopeId: 'ws:a', associations: [{ via: 'user-confirmed' }] }],
        'ws:a',
      ),
    ).toBe(true);
    // 注册表里没有该 scopeId（含读不到 / 损坏）→ 不猜
    expect(evidenceFromRegistry([], 'ws:a')).toBe(false);
  });

  it('migrateContextOf：browser 唯一作用域可直迁；disk-session 不持久', () => {
    const browser = migrateContextOf(
      { kind: 'browser', scopeId: 'browser:local', label: 'b', epoch: 0, persisted: true },
      [],
      false,
    );
    expect(browser.hasHistoryEvidence).toBe(true);
    const session = migrateContextOf(
      {
        kind: 'disk-session',
        scopeId: 'ws:s',
        label: 's',
        epoch: 0,
        persisted: false,
        reason: 'unassociated',
      },
      [{ scopeId: 'ws:s', associations: [{ via: 'isSameEntry' }] }],
      false,
    );
    expect(session.persisted).toBe(false);
    expect(session.hasHistoryEvidence).toBe(false); // 未持久 → 即便有 association 也不算
  });
});

// ---------------------------------------------------------------- NC-4：降级投影

describe('DocIndex · 降级投影（§6.3 / NC-4 期望）', () => {
  it('升级后**新增收藏**出现在旧结构（mindcanvas.library.v1 / starred.v1）里', () => {
    const d = idx(diskCtx());
    const key = wsDocKey('ws:aaaa', '研发/架构.mm.md');
    d.openDoc({ docKey: key, relPath: '研发/架构.mm.md', name: '架构.mm.md' }, 1_111);
    d.setStarred(key, true, 1_200);

    // ① 旧文档库投影：旧结构真的读得到新条目
    const lib = JSON.parse(localStorage.getItem(LEGACY_LIBRARY_KEY) ?? '[]') as Array<
      Record<string, unknown>
    >;
    const row = must(lib.find((e) => e.id === '研发/架构.mm.md'));
    expect(row.name).toBe('架构.mm.md');
    expect(row.ts).toBe(1_111); // max(openedAt, savedAt)
    expect(row.folder).toBe('');
    expect(row.tags).toEqual([]);

    // ② 旧收藏键集合：升级后新增的收藏必须在里面
    expect(JSON.parse(localStorage.getItem(LEGACY_STARRED_KEY) ?? '[]')).toEqual([
      '研发/架构.mm.md',
    ]);

    // ③ 旧版本读得懂这三张投影：用包侧 DocLibrary 直接读
    //    （见 packages/react/tests/doc-library.test.ts 的 LIBRARY_KEY/replaceAll 用例）
  });

  it('ts = max(openedAt, savedAt)：保存更晚时投影取 savedAt', () => {
    const d = idx(diskCtx());
    const key = wsDocKey('ws:aaaa', 'a.mm.md');
    d.openDoc({ docKey: key, relPath: 'a.mm.md', name: 'a.mm.md' }, 100);
    d.saveDoc({ docKey: key, relPath: 'a.mm.md', name: 'a.mm.md' }, 900);
    const lib = JSON.parse(localStorage.getItem(LEGACY_LIBRARY_KEY) ?? '[]') as Array<{
      ts: number;
    }>;
    expect(first(lib).ts).toBe(900);
  });

  it('投影保 source 只留 8 条，且不同旧 id 的既有快照不串源', () => {
    const docs = Array.from({ length: 12 }, (_, i) => ({
      id: `d${i}.mm.md`,
      name: `d${i}.mm.md`,
      ts: 1_000 - i,
      folder: '',
      tags: [],
      source: `# d${i}`,
    }));
    localStorage.setItem(LEGACY_LIBRARY_KEY, JSON.stringify(docs));
    const d = idx(diskCtx());
    // 11 条在本工作区真实存在（打开过）→ 具备归属证据；第 12 条（d11）不在本工作区，
    // 应当**留在旧库里**（投影是并集，不是整体覆盖）。
    for (let i = 0; i < 11; i++) {
      d.openDoc(
        { docKey: wsDocKey('ws:aaaa', `d${i}.mm.md`), relPath: `d${i}.mm.md`, name: `d${i}.mm.md` },
        5_000 - i,
      );
    }
    const lib = JSON.parse(localStorage.getItem(LEGACY_LIBRARY_KEY) ?? '[]') as Array<{
      id: string;
      name: string;
      source?: string;
    }>;
    expect(lib.length).toBe(12); // 11 条索引 + 1 条旧库孤儿（d11）
    expect(lib.slice(0, 8).every((e) => typeof e.source === 'string')).toBe(true);
    expect(lib.slice(8).every((e) => e.source === undefined)).toBe(true);
    // d0 原本的 source 仍跟着 d0（未被别的条目挪用）
    expect(lib.find((e) => e.id === 'd0.mm.md')?.source).toBe('# d0');
    // 旧库孤儿**保留在旧结构里**（投影是并集，不是覆盖）。
    // 它的 source 可能落在 8 条窗口之外而被剥掉——这与既有 SOURCE_KEEP 降级一致，
    // 不是本次投影的丢失（索引侧仍保有条目本身）。
    const orphan = must(lib.find((e) => e.id === 'd11.mm.md'));
    expect(orphan.name).toBe('d11.mm.md');
  });

  it('取消收藏会同步从旧收藏键移除（投影是当前状态的镜像，不是只增）', () => {
    const d = idx(diskCtx());
    const key = wsDocKey('ws:aaaa', 'a.mm.md');
    d.openDoc({ docKey: key, relPath: 'a.mm.md', name: 'a.mm.md' }, 1);
    d.setStarred(key, true);
    d.setStarred(key, false);
    expect(JSON.parse(localStorage.getItem(LEGACY_STARRED_KEY) ?? '[]')).toEqual([]);
  });

  /**
   * 判别力说明（对照 p0-0-implementation-plan §5 的负控标准）：
   * 本用例的中性化对象是**投影失败处理**本身——把 `project()` 的返回值改成恒 `true`
   * （或把 `catch` 改成吞掉失败后返回 true），本用例必须转红。
   *
   * 因此这里的要求比「键没被写」更严：
   *   ① 注入的 store 在投影目标键上**真的抛错**（不是静默跳过）；
   *   ② 断言 `projected === false` **且** `projectionFailed === true`；
   *   ③ 断言失败**被区分出来**：同一个 store 下，索引键写成功、投影键写失败，
   *      两者不能混为一谈。
   * 一个「写了但 catch 掉、projectionFailed 仍置 true」的实现无法同时满足 ②③，
   * 因为 ② 直接读的是 `project()` 的返回值。
   */
  it('投影写入失败时主流程不中断，但该次变更标为不可回退且可查', () => {
    let failProjection = false;
    let projectionWriteAttempts = 0;
    const failing: IndexStore = {
      get: (k) => localStorage.getItem(k),
      set: (k, v) => {
        // 索引键能写；投影目标键**抛错**（模拟配额满 / 存储不可用）
        if (failProjection && (k === LEGACY_LIBRARY_KEY || k === LEGACY_STARRED_KEY)) {
          projectionWriteAttempts += 1;
          throw new Error('quota');
        }
        localStorage.setItem(k, v);
      },
    };
    let t = 1;
    const d = new DocIndex({
      store: failing,
      now: () => (t += 1),
      ctx: () => diskCtx(),
    });
    const key = wsDocKey('ws:aaaa', 'a.mm.md');
    // 写方法返回 void；投影结果经 `projectionStatus()`（生产读取面：
    // `useIndexWiring.syncProjectionState`）暴露——这是 §6.3「不可回退且可查」的查证入口。
    d.openDoc({ docKey: key, relPath: 'a.mm.md', name: 'a.mm.md' });
    expect(d.projectionStatus()).toEqual({ wroteNewData: true, projectionFailed: false });

    failProjection = true;
    d.setStarred(key, true);
    expect(projectionWriteAttempts).toBeGreaterThan(0); // 确实尝试过写、且真的抛了
    // 投影失败 → 该次变更不可回退，但主流程不中断（索引里已是新值）
    expect(d.projectionStatus()).toEqual({ wroteNewData: true, projectionFailed: true });
    // 索引里的收藏是新的
    expect(d.getDoc(key)?.starred).toBe(true);
    // 旧键没被写坏：仍是上一次成功投影的内容
    expect(JSON.parse(localStorage.getItem(LEGACY_STARRED_KEY) ?? '[]')).toEqual([]);

    // 恢复存储后，下一次变更把投影补齐（可重试，不是永久坏掉）
    failProjection = false;
    d.setStarred(key, false);
    expect(d.projectionStatus().projectionFailed).toBe(false);
    expect(JSON.parse(localStorage.getItem(LEGACY_STARRED_KEY) ?? '[]')).toEqual([]);
  });

  it('索引键写失败也如实返回（不伪报成功）', () => {
    const broken: IndexStore = {
      get: (k) => localStorage.getItem(k),
      set: () => {
        throw new Error('quota');
      },
    };
    const d = new DocIndex({ store: broken, ctx: () => diskCtx() });
    d.openDoc({ docKey: 'browser::x', name: 'x.mm.md' });
    // 索引键写失败 → 投影也无从写出（`project(written=false)` 直接返回 false），
    // 状态如实记为「不可回退」，不伪报成功。
    expect(d.projectionStatus().projectionFailed).toBe(true);
  });
});

// ---------------------------------------------------------------- M4 / M7 / M8

describe('DocIndex · M4 / M7 / M8', () => {
  /**
   * 旧收藏键的真实格式是 `` `${a.kind}:${a.id}` ``，`a.kind ∈ {'img','draw'}`
   * （`packages/react/src/chrome/assetTypes.ts:7`、`assetHost.ts:11-13`，
   * 写入点 `AssetPanel.tsx:151/367`），`a.id` 是**资产 id**
   * （`assets/<rel>` / `builtin:<id>` / data URL）。
   *
   * 这里刻意用真实前缀：旧实现把前缀猜成 `idb:` / `disk:`，
   * 于是 `isBrowserItem` 恒 false、`relPath` 恒 null、
   * 「磁盘项需 (scopeId, relPath) 且作用域已证明同一目录」这条分支**生产上不可达**。
   */
  /**
   * M6 的「精确命中」**不是**归属证据（§6.2.1 第 1 行的前提是「该 scopeId 本次以
   * isSameEntry / 用户确认建立」）。索引里任何作用域的条目（含另一工作区、
   * 含 `ephemeral` 条目）都不能凭「恰好同名」把旧收藏键提升为「已绑定 + 已收藏」——
   * 否则 `starredKeys()` 会把 `legacyKeys` 当收藏别名暴露给 UI，错绑直接显示成「已收藏」。
   */
  it('M6：索引里存在**其他作用域**的同名条目 → 不认领，进历史池', () => {
    localStorage.setItem(LEGACY_STARRED_KEY, JSON.stringify(['研发/架构.mm.md']));
    // 当前作用域是 ws:aaaa（无证据），索引里却有一条 ws:OTHER 的同名条目
    const d = idx(adoptedCtx('ws:aaaa'));
    d.registerDoc({
      docKey: 'ws:OTHER::研发/架构.mm.md',
      relPath: '研发/架构.mm.md',
      name: '架构.mm.md',
      scopeId: 'ws:OTHER',
      persisted: true,
      sourceRef: { kind: 'disk-handle' },
    });
    const r = d.migrate();
    expect(r.migrated).toBe(0);
    // 另一作用域的条目**不得**被置为收藏
    expect(d.getDoc('ws:OTHER::研发/架构.mm.md')?.starred).toBe(false);
    // 收藏集合为空（`starredKeys()` 是生产读取面，见 fileManagerShared.ts:159）
    expect([...d.starredKeys()].filter((k) => !k.includes('::'))).toEqual([]);
    expect(d.historyPool().map((h) => h.key)).toEqual(['研发/架构.mm.md']);
  });

  it('M6：证据充分但命中条目属于**别的**作用域 → 仍不认领（作用域是本条硬条件）', () => {
    localStorage.setItem(LEGACY_STARRED_KEY, JSON.stringify(['研发/架构.mm.md']));
    // 关键：当前作用域**有**历史证据（hasOwnershipEvidence 返回 true），
    // 所以「证据不足」这条退路不成立 —— 只有「命中条目必须同作用域」这道限定
    // 才能拦住错误绑定。否则索引里任意作用域的同名条目都会被这道旧键点亮。
    const d = idx(diskCtx('ws:aaaa'));
    d.registerDoc({
      docKey: 'ws:OTHER::研发/架构.mm.md',
      relPath: '研发/架构.mm.md',
      name: '架构.mm.md',
      scopeId: 'ws:OTHER',
      persisted: true,
      sourceRef: { kind: 'disk-handle' },
    });
    d.migrate();
    expect(d.getDoc('ws:OTHER::研发/架构.mm.md')?.starred).toBe(false);
    expect(d.historyPool().map((h) => h.key)).toEqual(['研发/架构.mm.md']);
  });

  it('M6：证据充分但命中条目是 `ephemeral` → 仍不认领（作用域已失效）', () => {
    localStorage.setItem(LEGACY_STARRED_KEY, JSON.stringify(['会话文档.mm.md']));
    // 手写一条 ephemeral 条目（模拟上次会话的 disk-session 残留），
    // scopeId 与当前作用域**相同** —— 只有 `ephemeral` 这一道限定能拦住它。
    localStorage.setItem(
      DOC_INDEX_KEY,
      JSON.stringify({
        entries: [
          {
            docKey: 'ws:aaaa::会话文档.mm.md',
            scopeId: 'ws:aaaa',
            relPath: '会话文档.mm.md',
            lineageId: 'l1',
            name: '会话文档.mm.md',
            title: null,
            openedAt: null,
            savedAt: 0,
            starred: false,
            sourceRef: { kind: 'none' },
            ephemeral: true,
            legacyKeys: [],
          },
        ],
      }),
    );
    const d = new DocIndex({
      store: store(),
      now: () => 1,
      makeLineageId: () => 'l2',
      ctx: () => diskCtx('ws:aaaa'),
    });
    expect(d.getDoc('ws:aaaa::会话文档.mm.md')?.ephemeral).toBe(true);
    d.migrate();
    expect(d.getDoc('ws:aaaa::会话文档.mm.md')?.starred).toBe(false);
    expect(d.historyPool().map((h) => h.key)).toEqual(['会话文档.mm.md']);
  });

  it('M6：索引里的 `ephemeral` 条目不被旧收藏键认领（§6.2.1 第 5 行）', () => {
    localStorage.setItem(LEGACY_STARRED_KEY, JSON.stringify(['会话文档.mm.md']));
    const d = idx(diskCtx('ws:session', { persisted: false, hasHistoryEvidence: false }));
    d.registerDoc({
      docKey: 'ws:session::会话文档.mm.md',
      relPath: '会话文档.mm.md',
      name: '会话文档.mm.md',
      scopeId: 'ws:session',
      persisted: false,
      sourceRef: { kind: 'none' },
    });
    expect(d.getDoc('ws:session::会话文档.mm.md')?.ephemeral).toBe(true);
    d.migrate();
    expect(d.getDoc('ws:session::会话文档.mm.md')?.starred).toBe(false);
    expect(d.historyPool().map((h) => h.key)).toEqual(['会话文档.mm.md']);
  });

  it('M6：同作用域且有证据时，精确命中才认领为收藏', () => {
    localStorage.setItem(LEGACY_STARRED_KEY, JSON.stringify(['研发/架构.mm.md']));
    const d = idx(diskCtx('ws:proven'));
    d.registerDoc({
      docKey: 'ws:proven::研发/架构.mm.md',
      relPath: '研发/架构.mm.md',
      name: '架构.mm.md',
      scopeId: 'ws:proven',
      persisted: true,
      sourceRef: { kind: 'disk-handle' },
    });
    const r = d.migrate();
    // 断言落在**行为**上（收藏被认领、无历史池），不数 migrated：
    // 同一轮里 M6 认领收藏、M8 补 legacyKeys 都会计入 migrated，计数随批量口径浮动。
    expect(r.migrated).toBeGreaterThan(0);
    expect(d.getDoc('ws:proven::研发/架构.mm.md')?.starred).toBe(true);
    expect(d.getDoc('ws:proven::研发/架构.mm.md')?.legacyKeys).toContain(
      `${LEGACY_STARRED_KEY}#研发/架构.mm.md`,
    );
    expect(d.historyPool()).toEqual([]);
  });

  it('M7：`assets/<rel>` 项在有证据作用域下迁移为 (scopeId, relPath)，前缀不进入 assetKey', () => {
    localStorage.setItem(LEGACY_ASSET_FAV_KEY, JSON.stringify(['img:assets/b.png']));
    const d = idx(diskCtx());
    expect(d.migrate().migrated).toBe(1);
    const a = first(d.listAssets());
    // 资产 id 是 `assets/b.png` —— 去掉 `kind:` 之后整体保留（不是丢掉前缀只留末段）
    expect(a.assetKey).toBe('assets/b.png');
    expect(a.relPath).toBe('assets/b.png');
    expect(a.starred).toBe(true);
    expect(a.legacyKeys).toEqual(['img:assets/b.png']);
    expect(d.historyPool()).toEqual([]);
  });

  it('M7：无证据作用域下 `assets/<rel>` 项进历史池（唯一同名也不认领）', () => {
    localStorage.setItem(LEGACY_ASSET_FAV_KEY, JSON.stringify(['img:assets/b.png']));
    const d = idx(adoptedCtx());
    const r = d.migrate();
    expect(r.migrated).toBe(0);
    expect(d.listAssets()).toEqual([]);
    expect(d.historyPool().map((h) => h.key)).toEqual(['img:assets/b.png']);
  });

  it('M7：`draw:` 前缀（SVG）按同一规则处理', () => {
    localStorage.setItem(LEGACY_ASSET_FAV_KEY, JSON.stringify(['draw:assets/i.svg']));
    const d = idx(diskCtx());
    expect(d.migrate().migrated).toBe(1);
    expect(first(d.listAssets()).assetKey).toBe('assets/i.svg');
  });

  it('M7：`builtin:` 与 data: 是自包含引用，不属于任何作用域，可直接迁移（I-5）', () => {
    localStorage.setItem(
      LEGACY_ASSET_FAV_KEY,
      JSON.stringify(['img:builtin:star', 'draw:data:image/svg+xml;base64,AAA']),
    );
    const d = idx(adoptedCtx());
    const r = d.migrate();
    expect(r.migrated).toBe(2);
    // 自包含引用不在磁盘上，迁移后不该被当成工作区相对路径
    for (const a of d.listAssets()) {
      expect(a.relPath).toBeNull();
      expect(a.starred).toBe(true);
    }
    expect(d.listAssets().map((a) => a.assetKey).sort()).toEqual([
      'builtin:star',
      'data:image/svg+xml;base64,AAA',
    ]);
    expect(d.historyPool()).toEqual([]);
  });

  it('M7：无法切出合法 `kind:` 的键记为未迁移，不猜归属', () => {
    localStorage.setItem(LEGACY_ASSET_FAV_KEY, JSON.stringify(['assets/b.png', 'x:y']));
    const d = idx(diskCtx());
    const r = d.migrate();
    expect(r.migrated).toBe(0);
    expect(r.failed).toBe(2);
    expect(d.listAssets()).toEqual([]);
    expect(localStorage.getItem(LEGACY_ASSET_FAV_KEY)).toBe(
      JSON.stringify(['assets/b.png', 'x:y']),
    );
  });

  it('M8：自由画布最近并入索引且**不改写**该旧键', () => {
    const legacy = JSON.stringify([{ id: 'c1', name: '画布一', ts: 77 }]);
    localStorage.setItem(LEGACY_CANVAS_RECENT_KEY, legacy);
    const d = idx(diskCtx());
    const r = d.migrate();
    expect(r.migrated).toBe(1);
    const entry = d.getDoc('browser:local::c1');
    expect(entry?.name).toBe('画布一');
    expect(entry?.openedAt).toBeNull(); // ts 是保存时间，不是打开时间
    expect(entry?.savedAt).toBe(77);
    expect(localStorage.getItem(LEGACY_CANVAS_RECENT_KEY)).toBe(legacy);
    // 二次迁移幂等：条目已在且 legacyKeys 已含该键 → 条目本身不再变。
    // （`migrated` 计数含「M8 补 legacyKeys」这一段，走完一轮进度归零后会重跑一次复核，
    //  所以断言落在**条目内容**与**不重复建条目**上，而不是计数。）
    expect(d.getDoc('browser:local::c1')?.legacyKeys).toEqual([LEGACY_CANVAS_RECENT_KEY]);
    // 再迁移一次：条目内容不变、不重复建条目（进度走完一轮后从头做幂等复核）
    const before = JSON.stringify(d.listDocs());
    d.migrate();
    expect(d.listDocs().length).toBe(1);
    expect(JSON.stringify(d.listDocs())).toBe(before);
    // 时间也不被迁移改写（迁移不是打开、不是保存）
    expect(d.getDoc('browser:local::c1')?.openedAt).toBeNull();
    expect(d.getDoc('browser:local::c1')?.savedAt).toBe(77);
  });

  it('M8：单条损坏跳过，合法条目仍迁入', () => {
    localStorage.setItem(
      LEGACY_CANVAS_RECENT_KEY,
      JSON.stringify([{ id: 'c1', name: '画布一', ts: 1 }, { name: '缺 id' }, null]),
    );
    const r = idx(diskCtx()).migrate();
    expect(r.migrated).toBe(1);
    expect(r.failed).toBe(2);
  });

  it('M9 写侧**未实现**：迁移全程不触碰 `mindcanvas-handles`', async () => {
    // 规范 M9 的写侧要求「同时写新键（`file-handle.v1:<docKey>` 富记录）与旧键」。
    // 富记录键在包侧（`packages/react/src/edit/handleStore.ts`）**尚不存在**，
    // P0-D 不越界实现它，也不造假镜像（读旧键再写回同一个旧键不是双写）。
    // 本用例把「未实现」钉成可回归的事实：迁移不读写该库、也不写它的 localStorage 影子。
    localStorage.setItem(
      LEGACY_LIBRARY_KEY,
      JSON.stringify([{ id: 'a.mm.md', name: 'a.mm.md', ts: 1 }]),
    );
    expect(typeof indexedDB).toBe('undefined'); // jsdom：句柄库根本不可用
    const d = idx(diskCtx());
    seedRegistered(d, 'a.mm.md');
    const r = d.migrate();
    await Promise.resolve();
    expect(r.failed).toBe(0); // 迁移本身正常完成
    expect(localStorage.getItem(HANDLES_DB_HINT)).toBeNull(); // 不落任何影子键
  });

  it('旧键一律不删除（DS-10 由主控决定）', () => {
    localStorage.setItem(LEGACY_LIBRARY_KEY, JSON.stringify([{ id: 'a.mm.md', ts: 1 }]));
    localStorage.setItem(LEGACY_STARRED_KEY, JSON.stringify(['a.mm.md']));
    localStorage.setItem(LEGACY_ASSET_FAV_KEY, JSON.stringify(['idb:x.png']));
    localStorage.setItem(LEGACY_CANVAS_RECENT_KEY, JSON.stringify([{ id: 'c', ts: 1 }]));
    idx(diskCtx()).migrate();
    for (const k of [
      LEGACY_LIBRARY_KEY,
      LEGACY_STARRED_KEY,
      LEGACY_ASSET_FAV_KEY,
      LEGACY_CANVAS_RECENT_KEY,
    ]) {
      expect(localStorage.getItem(k)).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------- 收藏身份 / 未知字段

describe('DocIndex · 收藏身份与宽容读写', () => {
  it('收藏跟稳定身份走：relPath 改了收藏不丢', () => {
    const d = idx(diskCtx());
    const key = wsDocKey('ws:aaaa', '旧名.mm.md');
    d.openDoc({ docKey: key, relPath: '旧名.mm.md', name: '旧名.mm.md' }, 1);
    d.setStarred(key, true);
    // P0-A 改名后：同一个 docKey（血统），relPath 变了
    d.saveDoc({ docKey: key, relPath: '新名.mm.md', name: '新名.mm.md' }, 2);
    expect(d.getDoc(key)?.starred).toBe(true);
    expect(d.listDocs().filter((e) => e.starred).map((e) => e.name)).toEqual(['新名.mm.md']);
    expect(d.starredKeys().has(key)).toBe(true);
    expect(d.starredKeys().has('新名.mm.md')).toBe(true);
  });

  it('未知字段在读写往返中保留（前向兼容）', () => {
    localStorage.setItem(
      DOC_INDEX_KEY,
      JSON.stringify({
        entries: [
          {
            docKey: 'browser::x',
            scopeId: 'browser:local',
            name: 'x',
            savedAt: 3,
            futureField: { a: 1 },
          },
        ],
      }),
    );
    const d = idx(diskCtx());
    d.saveDoc({ docKey: 'browser::x', name: 'x' });
    const raw = JSON.parse(localStorage.getItem(DOC_INDEX_KEY) ?? '{}') as {
      entries: Record<string, unknown>[];
    };
    expect(first(raw.entries).futureField).toEqual({ a: 1 });
  });

  it('缺失字段被补齐而不丢条目（后向兼容）', () => {
    localStorage.setItem(DOC_INDEX_KEY, JSON.stringify([{ docKey: 'browser::y' }]));
    const e = must(idx(diskCtx()).getDoc('browser::y'));
    expect(e.savedAt).toBe(0);
    expect(e.openedAt).toBeNull();
    expect(e.starred).toBe(false);
    expect(e.legacyKeys).toEqual([]);
    expect(e.sourceRef).toEqual({ kind: 'none' });
  });

  it('listDocs 可容忍非数组索引键', () => {
    localStorage.setItem(DOC_INDEX_KEY, '{"not":"array"}');
    expect(idx(diskCtx()).listDocs()).toEqual([]);
  });
});
