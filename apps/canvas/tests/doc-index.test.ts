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
  formatRecentWhen,
  hasOwnershipEvidence,
  migrateContextOf,
  wsDocKey,
  type IndexStore,
  type MigrateContext,
} from '../src/docIndex.js';

const HANDLES_DB_HINT = 'mindcanvas-handles';

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

function idx(ctx: MigrateContext, now = 1_000): DocIndex {
  let t = now;
  return new DocIndex({
    store: store(),
    now: () => t,
    makeLineageId: () => `lin-${(t += 1)}`,
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
    // 无历史证据 → 进历史池，不建条目；改成一个有证据的作用域来建条目
    const d2 = idx(diskCtx());
    localStorage.setItem(
      LEGACY_LIBRARY_KEY,
      JSON.stringify([{ id: '旧.mm.md', name: '旧.mm.md', ts: 9_999_999, folder: '', tags: [] }]),
    );
    d2.migrate();
    const migrated = d2.listDocs()[0]!;
    expect(migrated.openedAt).toBeNull(); // ← 绝不把 ts(9_999_999) 当成打开时间
    expect(migrated.savedAt).toBe(9_999_999);

    d2.openDoc({ docKey: wsDocKey('ws:aaaa', '新.mm.md'), relPath: '新.mm.md', name: '新.mm.md' }, 5);
    // 有打开时间的排前，null 排末尾（哪怕它的 savedAt 大得多）
    expect(d2.recentDocs().map((e) => e.name)).toEqual(['新.mm.md', '旧.mm.md']);
    expect(formatRecentWhen(migrated.openedAt)).toBe('未记录打开时间');
    expect(d.listDocs()).toEqual([]); // 无证据作用域：一条条目都不建
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
    const r = idx(diskCtx()).migrate();
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
    const first = d.migrate();
    const snapshot = JSON.stringify(d.listDocs());
    const second = d.migrate();
    expect(first.migrated).toBeGreaterThan(0);
    expect(second.migrated).toBe(0); // 第二次全部 unchanged
    expect(second.unchanged).toBeGreaterThan(0);
    expect(JSON.stringify(d.listDocs())).toBe(snapshot);
    // 迁移不得编造打开时间
    expect(d.listDocs().every((e) => e.openedAt === null)).toBe(true);
    // 收藏被迁移（M6 精确命中）
    expect(d.listDocs()[0]!.starred).toBe(true);
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

    // 每批只认领 batch 条：游标必须**持久化**，否则每次都从旧键第 0 条重来，
    // 第 2、3 批永远停在原地（进度不推进 = 用户点了半天还在同一批）。
    const r1 = d.migrate({ batch: 2 });
    expect(r1.migrated).toBe(2);
    expect(d.listDocs().length).toBe(2); // ← 只处理了 2 条
    const r2 = d.migrate({ batch: 2 });
    expect(r2.migrated).toBe(2);
    expect(d.listDocs().length).toBe(4);
    const r3 = d.migrate({ batch: 2 });
    expect(r3.migrated).toBe(1); // 最后一条
    expect(d.listDocs().length).toBe(5);

    // 五条旧键全部最终被认领，无明显漏项
    expect(
      d.listDocs().every((e) => e.legacyKeys.some((k) => k.startsWith(LEGACY_LIBRARY_KEY))),
    ).toBe(true);
  });

  it('续跑不依赖内存状态：新实例（模拟刷新）重跑得到同样结果且不重复', () => {
    seedLegacy();
    const ctx = diskCtx();
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

  it('唯一同名命中不自动绑定，进历史池', () => {
    localStorage.setItem(LEGACY_LIBRARY_KEY, JSON.stringify(legacy));
    // legacy adoption 新生成的 scopeId：无历史证据
    const d = idx(adoptedCtx());
    const r = d.migrate();
    expect(r.migrated).toBe(0);
    expect(d.listDocs()).toEqual([]); // ← 不建条目 = 不认领
    expect(d.historyPool().map((h) => h.key)).toEqual(['研发/架构.mm.md']);
    expect(d.historyPool()[0]!.reason).toBe('no-evidence');
    // 旧键保留（用户不处理也不丢）；folder 会被包侧 normalize 清洗掉首尾斜杠
    const kept = JSON.parse(localStorage.getItem(LEGACY_LIBRARY_KEY) ?? '[]') as Array<{
      id: string;
    }>;
    expect(kept.map((e) => e.id)).toEqual(['研发/架构.mm.md']);
  });

  it('有 isSameEntry 证据的作用域下，精确 relPath 命中才迁移', () => {
    localStorage.setItem(LEGACY_LIBRARY_KEY, JSON.stringify(legacy));
    const d = idx(diskCtx('ws:proven'));
    expect(d.migrate().migrated).toBe(1);
    expect(d.listDocs()[0]!.docKey).toBe('ws:proven::研发/架构.mm.md');
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
    expect(d.historyPool()[0]!.reason).toBe('ephemeral-scope');
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
    const row = lib.find((e) => e.id === '研发/架构.mm.md');
    expect(row).toBeDefined();
    expect(row!.name).toBe('架构.mm.md');
    expect(row!.ts).toBe(1_111); // max(openedAt, savedAt)
    expect(row!.folder).toBe('');
    expect(row!.tags).toEqual([]);

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
    expect(lib[0]!.ts).toBe(900);
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
    const orphan = lib.find((e) => e.id === 'd11.mm.md');
    expect(orphan).toBeDefined();
    expect(orphan!.name).toBe('d11.mm.md');
  });

  it('取消收藏会同步从旧收藏键移除（投影是当前状态的镜像，不是只增）', () => {
    const d = idx(diskCtx());
    const key = wsDocKey('ws:aaaa', 'a.mm.md');
    d.openDoc({ docKey: key, relPath: 'a.mm.md', name: 'a.mm.md' }, 1);
    d.setStarred(key, true);
    d.setStarred(key, false);
    expect(JSON.parse(localStorage.getItem(LEGACY_STARRED_KEY) ?? '[]')).toEqual([]);
  });

  it('投影写入失败时主流程不中断，但该次变更标为不可回退且可查', () => {
    let failProjection = false;
    const failing: IndexStore = {
      get: (k) => localStorage.getItem(k),
      set: (k, v) => {
        // 索引键能写；投影目标键写失败（模拟配额满）
        if (failProjection && (k === LEGACY_LIBRARY_KEY || k === LEGACY_STARRED_KEY)) {
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
    expect(d.openDoc({ docKey: key, relPath: 'a.mm.md', name: 'a.mm.md' }).projected).toBe(true);
    failProjection = true;
    const out = d.setStarred(key, true);
    expect(out.written).toBe(true); // 索引仍写成功
    expect(out.projected).toBe(false); // 投影失败 → 不可回退
    expect(d.projectionStatus()).toEqual({ wroteNewData: true, projectionFailed: true });
    // 索引里的收藏是新的（主流程不中断）
    expect(d.getDoc(key)?.starred).toBe(true);
    // 旧键没被写坏：仍是上一次成功投影的内容
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
    const out = d.openDoc({ docKey: 'browser::x', name: 'x.mm.md' });
    expect(out.written).toBe(false);
    expect(out.projected).toBe(false);
    expect(d.projectionStatus().projectionFailed).toBe(true);
  });
});

// ---------------------------------------------------------------- M4 / M7 / M8

describe('DocIndex · M4 / M7 / M8', () => {
  it('M7：浏览器素材库收藏可直接迁移；磁盘项无证据时进历史池', () => {
    localStorage.setItem(
      LEGACY_ASSET_FAV_KEY,
      JSON.stringify(['idb:a.png', 'disk:assets/b.png']),
    );
    const d = idx(adoptedCtx());
    const r = d.migrate();
    expect(r.migrated).toBe(1);
    // `idb:` 项（浏览器素材库）作用域唯一，可直接迁移
    expect(d.listAssets().map((a) => a.assetKey)).toEqual(['idb:a.png']); // 规范 id 保持原样
    expect(d.listAssets()[0]!.starred).toBe(true);
    // 无证据的 `disk:` 项进历史池
    expect(d.historyPool().map((h) => h.key)).toEqual(['disk:assets/b.png']);
  });

  it('M7：作用域有证据时磁盘资产项才迁移', () => {
    localStorage.setItem(LEGACY_ASSET_FAV_KEY, JSON.stringify(['disk:assets/b.png']));
    const d = idx(diskCtx());
    expect(d.migrate().migrated).toBe(1);
    // 旧键 `disk:assets/b.png` 的 `kind:` 前缀不进入新 assetKey（真实身份是相对路径）
    expect(d.listAssets()[0]!.assetKey).toBe('assets/b.png');
    expect(d.listAssets()[0]!.legacyKeys).toEqual(['disk:assets/b.png']);
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
    const before = JSON.stringify(d.listDocs());
    expect(d.getDoc('browser:local::c1')?.legacyKeys).toEqual([LEGACY_CANVAS_RECENT_KEY]);
    const second = d.migrate();
    expect(d.listDocs().length).toBe(1); // 不重复建条目
    expect(JSON.stringify(d.listDocs())).toBe(
      JSON.stringify(
        (JSON.parse(before) as unknown[]).map((e) => ({ ...(e as object), legacyKeys: [LEGACY_CANVAS_RECENT_KEY] })),
      ),
    );
    expect(d.getDoc('browser:local::c1')?.legacyKeys).toEqual([LEGACY_CANVAS_RECENT_KEY]);
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

  it('M9：句柄镜像不越界——没有已知旧 docId 时不写 handles 库', async () => {
    // 句柄镜像只对「本会话已证明可取句柄的旧 docId」执行（handleId 入参）；
    // jsdom 无 indexedDB 时镜像静默跳过，不抛、不影响迁移结果。
    localStorage.setItem(
      LEGACY_LIBRARY_KEY,
      JSON.stringify([{ id: 'a.mm.md', name: 'a.mm.md', ts: 1 }]),
    );
    expect(typeof indexedDB).toBe('undefined');
    const r = idx(diskCtx()).migrate();
    await Promise.resolve();
    expect(r.migrated).toBe(1);
    expect(localStorage.getItem(HANDLES_DB_HINT)).toBeNull();
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
    expect(d.starredDocs().map((e) => e.name)).toEqual(['新名.mm.md']);
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
    expect(raw.entries[0]!.futureField).toEqual({ a: 1 });
  });

  it('缺失字段被补齐而不丢条目（后向兼容）', () => {
    localStorage.setItem(DOC_INDEX_KEY, JSON.stringify([{ docKey: 'browser::y' }]));
    const e = idx(diskCtx()).getDoc('browser::y');
    expect(e).toBeDefined();
    expect(e!.savedAt).toBe(0);
    expect(e!.openedAt).toBeNull();
    expect(e!.starred).toBe(false);
    expect(e!.legacyKeys).toEqual([]);
    expect(e!.sourceRef).toEqual({ kind: 'none' });
  });

  it('listDocs 可容忍非数组索引键', () => {
    localStorage.setItem(DOC_INDEX_KEY, '{"not":"array"}');
    expect(idx(diskCtx()).listDocs()).toEqual([]);
  });
});
