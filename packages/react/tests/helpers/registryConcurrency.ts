// tests/helpers/registryConcurrency.ts —— 三个入口共用；非 *.test.ts，默认不被收集
// ★计数器/期望纪律：正例与负控**共用**同一正确 oracle（expectThreeUpdates）；
// 负控转红以命令退出非零为准，禁止反转断言 / it.fails / catch 后报 PASS / 宽泛 skip。
import { expect, vi } from 'vitest';
import type { FsDirectoryHandle } from '../../src/edit/directoryTypes.js';
import type {
  WorkspaceRegistryRecord,
  WorkspaceRegistryEntry,
} from '../../src/edit/workspaceScope.js'; // ★ 类型都定义在 workspaceScope.ts（G0 勘误：去掉未使用的 RegistryReadResult；handleStore 只 import type——§4.2 ⚠）
import { isRegistryRecord } from '../../src/edit/workspaceScope.js';

/** 句柄替身（helpers 自带，不依赖测试文件里的 dirHandle）；★G0 勘误：形状与 §4.2 的 dirHandle 一致（带 getDirectoryHandle，满足 isDirectoryHandle 谓词） */
const handleOf = (name: string): FsDirectoryHandle =>
  ({ kind: 'directory', name, getDirectoryHandle: async () => handleOf(name) }) as FsDirectoryHandle;

/** 载入两个互相独立的 handleStore 实例（各自 writeChain，共用同一夹具数据库） */
export async function loadTwoInstances() {
  vi.resetModules();
  const A = await import('../../src/edit/handleStore.js');
  vi.resetModules();
  const B = await import('../../src/edit/handleStore.js');
  return { A, B };
}

/** 受控交错：两侧的「事务外读」都完成后才放行后续写 */
export function makeBarrier(n: number) {
  let arrived = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  return async (): Promise<void> => {
    arrived += 1;
    if (arrived === n) release();
    await gate;
  };
}

/** 合法条目骨架（新条目为 active） */
const entryOf = (id: string, seq: number): WorkspaceRegistryEntry => ({
  scopeId: id,
  handle: handleOf(id),
  label: id,
  lastSeenAt: seq,
  state: 'active' as const,
  associations: [{ at: seq, via: 'isSameEntry' as const }],
});

/**
 * ★CR2-4A：**合法追加** —— 新条目为 active，**旧条目一律转 dormant**。
 * 与生产 `upsertEntry` 同规。旧版直接 `[...base.entries, newActive]` 会留下两个 active，
 * 违反「active 唯一且等于 activeScopeId」不变量 —— 正确的校验器应当拒绝写入，
 * 于是正例在进入并发验证前就失败（或反过来暴露校验器缺失）。
 */
export const legalAppend = (rec: WorkspaceRegistryRecord, id: string, seq: number): WorkspaceRegistryRecord => ({
  ...rec,
  activeScopeId: id,
  entries: [...rec.entries.map((e) => ({ ...e, state: 'dormant' as const })), entryOf(id, seq)],
});

export const emptyRec = (): WorkspaceRegistryRecord => ({ v: 1, activeScopeId: null, entries: [] });

/** 正例与负控**共用**的正确期望：三条更新都在 + 记录合法 + 唯一 active + 其余 dormant */
export function expectThreeUpdates(rec: WorkspaceRegistryRecord): void {
  expect(rec.entries.map((e) => e.scopeId).sort()).toEqual(['ws:a', 'ws:b', 'ws:c']);
  expect(isRegistryRecord(rec)).toBe(true); // 记录必须满足全部不变量
  const actives = rec.entries.filter((e) => e.state === 'active');
  expect(actives).toHaveLength(1);
  expect(actives[0]?.scopeId).toBe(rec.activeScopeId);
  expect(rec.entries.filter((e) => e.state === 'dormant')).toHaveLength(2);
}
