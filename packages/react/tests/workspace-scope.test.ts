/**
 * P0-0-1：workspaceScope 身份纯函数测试（计划 §4.1）。
 *
 * 锁死的行为：
 *  1. ScopeId 形状（`ws:` 前缀 + 非空主体）与生成（uuid 源注入，确定性可测）；
 *  2. 注册表记录校验**全部不变量强制**（CR2-4A）：唯一 scopeId、条件化 active
 *     唯一且等于 activeScopeId、`activeScopeId=null` ⇒ 零 active；
 *  3. 合法追加：新条目 active、旧条目一律转 dormant（与生产 upsertEntry 同规）；
 *  4. 淘汰有界且 active 必留；
 *  5. `sameDirectory` 只认 `isSameEntry` 成功返回，缺失/抛错 → `unknown`。
 */
import { describe, expect, it } from 'vitest';
import {
  REGISTRY_MAX_ENTRIES,
  evictEntries,
  isRegistryRecord,
  isScopeId,
  newScopeId,
  sameDirectory,
  upsertEntry,
} from '../src/edit/workspaceScope.js';
import type { FsDirectoryHandle } from '../src/edit/directoryTypes.js';
import type { WorkspaceRegistryEntry } from '../src/edit/workspaceScope.js';

function dir(name: string, sameEntry?: (other: unknown) => Promise<boolean>): FsDirectoryHandle {
  return { name, kind: 'directory', ...(sameEntry ? { isSameEntry: sameEntry } : {}) };
}

/** 合法条目骨架（state 由调用方覆盖，便于构造非法记录做负控） */
function entryOf(scopeId: string): WorkspaceRegistryEntry {
  return {
    scopeId,
    handle: dir(scopeId),
    label: scopeId,
    lastSeenAt: 1,
    state: 'dormant',
    associations: [{ at: 1, via: 'isSameEntry' }],
  };
}

describe('workspaceScope：身份纯函数', () => {
  it('isScopeId 只接受 ws: 前缀的非空串', () => {
    expect(isScopeId('ws:abc')).toBe(true);
    expect(isScopeId('ws:')).toBe(false);
    expect(isScopeId('browser:local')).toBe(false);
    expect(isScopeId(42)).toBe(false);
  });

  it('newScopeId 用注入的 uuid 源，生成 ws:<uuid>', () => {
    expect(newScopeId(() => 'u1')).toBe('ws:u1');
  });

  it('isRegistryRecord 拒绝缺字段 / 版本不符 / active 指向不存在条目', () => {
    expect(isRegistryRecord({ v: 1, activeScopeId: null, entries: [] })).toBe(true);
    expect(isRegistryRecord({ v: 2, activeScopeId: null, entries: [] })).toBe(false);
    expect(isRegistryRecord({ v: 1, activeScopeId: 'ws:x', entries: [] })).toBe(false);
    expect(isRegistryRecord({ v: 1, entries: [] })).toBe(false);
  });

  it('★CR2-4A：isRegistryRecord 强制「唯一 scopeId + 条件化 active 唯一且等于 activeScopeId」', () => {
    const e = (s: string, st: 'active' | 'dormant') => ({ ...entryOf(s), state: st });
    // 合法：activeScopeId 命中且**只有它**是 active，其余 dormant
    expect(isRegistryRecord({ v: 1, activeScopeId: 'ws:a', entries: [e('ws:a', 'active'), e('ws:b', 'dormant')] })).toBe(true);
    // 合法：空库
    expect(isRegistryRecord({ v: 1, activeScopeId: null, entries: [] })).toBe(true);
    // 合法：detach 后（activeScopeId=null + 条目全 dormant）★第三轮复核校正
    expect(isRegistryRecord({ v: 1, activeScopeId: null, entries: [e('ws:a', 'dormant'), e('ws:b', 'dormant')] })).toBe(true);
    // 非法：两个 active（NC-5 旧版 append 的产物）
    expect(isRegistryRecord({ v: 1, activeScopeId: 'ws:b', entries: [e('ws:a', 'active'), e('ws:b', 'active')] })).toBe(false);
    // 非法：activeScopeId 与 active 条目不一致
    expect(isRegistryRecord({ v: 1, activeScopeId: 'ws:a', entries: [e('ws:a', 'dormant')] })).toBe(false);
    // 非法：activeScopeId = null 但仍有 active 条目（删除失败用例旧版的产物）
    expect(isRegistryRecord({ v: 1, activeScopeId: null, entries: [e('ws:a', 'active')] })).toBe(false);
    // 非法：scopeId 重复
    expect(isRegistryRecord({ v: 1, activeScopeId: 'ws:a', entries: [e('ws:a', 'active'), e('ws:a', 'dormant')] })).toBe(false);
    // 非法：scopeId 不是 ws: 形态
    expect(isRegistryRecord({ v: 1, activeScopeId: 'x', entries: [e('x', 'active')] })).toBe(false);
  });

  it('upsertEntry：新增条目并把 active 指向它，旧条目转 dormant', () => {
    const a = upsertEntry({ v: 1, activeScopeId: null, entries: [] }, { scopeId: 'ws:a', handle: dir('A'), label: 'A', now: 1, via: 'isSameEntry' });
    const b = upsertEntry(a, { scopeId: 'ws:b', handle: dir('B'), label: 'B', now: 2, via: 'isSameEntry' });
    expect(b.activeScopeId).toBe('ws:b');
    expect(b.entries.find((e) => e.scopeId === 'ws:a')?.state).toBe('dormant');
    expect(b.entries.find((e) => e.scopeId === 'ws:b')?.state).toBe('active');
  });

  it('upsertEntry：同 scopeId 复用同一个条目并追加证据（幂等）', () => {
    const a = upsertEntry({ v: 1, activeScopeId: null, entries: [] }, { scopeId: 'ws:a', handle: dir('A'), label: 'A', now: 1, via: 'isSameEntry' });
    const a2 = upsertEntry(a, { scopeId: 'ws:a', handle: dir('A2'), label: 'A', now: 9, via: 'user-confirmed' });
    expect(a2.entries).toHaveLength(1);
    expect(a2.entries[0]?.associations.map((x) => x.via)).toEqual(['isSameEntry', 'user-confirmed']);
    expect(a2.entries[0]?.lastSeenAt).toBe(9);
  });

  it('evictEntries 保留 active 与最近的 dormant，淘汰最旧', () => {
    let rec = { v: 1 as const, activeScopeId: null as string | null, entries: [] as never[] };
    // 依次塞入 max+1 个条目（lastSeenAt 递增）
    for (let i = 0; i <= REGISTRY_MAX_ENTRIES; i++) {
      rec = upsertEntry(rec as never, {
        scopeId: `ws:${i}`,
        handle: dir(`D${i}`),
        label: `D${i}`,
        now: i + 1,
        via: 'isSameEntry',
      }) as never;
    }
    const out = evictEntries(rec as never, REGISTRY_MAX_ENTRIES);
    expect(out.entries).toHaveLength(REGISTRY_MAX_ENTRIES);
    expect(out.entries.some((e) => e.scopeId === 'ws:0')).toBe(false); // 最旧被淘汰
    expect(out.entries.some((e) => e.scopeId === out.activeScopeId)).toBe(true); // active 必须在
  });

  it('sameDirectory：isSameEntry=true → same；false → different', async () => {
    expect(await sameDirectory(dir('A', async () => true), dir('B'))).toBe('same');
    expect(await sameDirectory(dir('A', async () => false), dir('B'))).toBe('different');
  });

  it('sameDirectory：能力缺失 / 抛错 → unknown（不猜测）', async () => {
    expect(await sameDirectory(dir('A'), dir('A'))).toBe('unknown');
    expect(
      await sameDirectory(
        dir('A', async () => {
          throw new Error('boom');
        }),
        dir('A'),
      ),
    ).toBe('unknown');
  });
});
