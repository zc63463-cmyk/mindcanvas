/**
 * 工作区身份解析（P0-0）：**单一路径 + 两阶段协议**（I-23 / I-25）。
 *
 * 刚从 `directoryHost.ts` 抽出（同包 `edit/` 内，行为逐字保留）：为满足 `bigFiles`
 * 代码预算（≤600 行/文件），并把「身份解析规则」与「目录宿主」的职责分开——
 * 宿主只管何时调用，判定表 / 事务复核 / 冲突重试 / 降级都收敛在本模块。
 *
 * 不是什么：
 * - 不持有宿主状态（root / tree / epoch 都在 `DirectoryWorkspaceHost` 上）；
 * - 不自己决定写键——写键一律经 `mutate` / `commit` 交给 `writeWorkspaceRegistry`
 *   的**单事务**（见 handleStore.ts）。
 *
 * 身份证据只有 `isSameEntry` 成功返回（I-13）；`'workspace-root'` 必须是裸句柄；
 * `corrupt` 对**所有入口**（含 `pick`）都不自动改写；`unavailable` 绝不 legacy adoption。
 */
import type { FsDirectoryHandle } from './directoryTypes.js';
import { readWorkspaceRegistry, writeWorkspaceRegistry } from './handleStore.js';
import type { LegacyHandleIntent, RegistryMutate } from './handleStore.js';
import {
  BROWSER_SCOPE_ID,
  REGISTRY_MAX_ENTRIES,
  REGISTRY_VERSION,
  evictEntries,
  newScopeId,
  sameDirectory,
  upsertEntry,
} from './workspaceScope.js';
import type { RegistryReadResult, ScopeId, ScopeState, WorkspaceRegistryRecord } from './workspaceScope.js';

/** 初始/断开后的浏览器态 */
export const BROWSER_SCOPE: ScopeState = {
  kind: 'browser',
  scopeId: BROWSER_SCOPE_ID,
  label: '浏览器素材库',
  epoch: 0,
  persisted: true,
};

/**
 * uuid 源（G-3）：环境没有 `crypto.randomUUID`（或它抛错）时仍要生成合法 scopeId
 * （`newScopeId` 只拼接字符串，不依赖 crypto）——jsdom 等环境不得成为硬依赖。
 */
function makeUuid(): string {
  const c = globalThis.crypto;
  try {
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  } catch {
    // 源抛错同样走回退
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

/** scopeId 集合是否逐字相同（顺序无关）；register 的事务内基线复核用 */
function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

/** detach：注册表转 dormant（**不删条目**）；empty / corrupt / unavailable → 不动 */
export const markDormant: RegistryMutate = (prev) =>
  prev.kind === 'ok'
    ? {
        ...prev.record,
        activeScopeId: null,
        entries: prev.record.entries.map((e) => ({ ...e, state: 'dormant' as const })),
      }
    : 'unchanged';

/**
 * 阶段 1（**事务外**）：读注册表 + 逐个 `sameDirectory`，得到判定与待提交的
 * `{ mutate, commit }`。**不写任何键**（写键由 applyIdentity 决定）。
 *
 * 判定表（CR2-1）：
 * - `reuse`    恰好一个 `same` → 复用该 `scopeId`，其余转 dormant
 * - `register` 空库 / 合法空表 / 全部**明确不同** → 登记新身份（via `session-only`）
 * - `degrade`  存在 `unknown` 且无 `same` → `disk-session('unassociated')`（不写键）
 * - `refuse`   **多个** `same`（理论上不应出现）→ 同上保守降级
 *
 * 同对象引用仅作**会话内快速路径**（省一次 await，**不作为跨会话证据**——
 * 真实刷新必然拿到新对象）。
 */
async function resolveScopeForIdentity(root: FsDirectoryHandle): Promise<{
  state: ScopeState;
  commit: LegacyHandleIntent;
  mutate: RegistryMutate;
  expectWrite: boolean;
}> {
  const label = root.name ?? '工作区';
  const read: RegistryReadResult = await readWorkspaceRegistry();

  if (read.kind === 'unavailable') {
    // 读不到注册表：绝不 legacy adoption、绝不写键（I-24）；否则会覆盖一个读不到的数据
    return {
      state: {
        kind: 'disk-session',
        scopeId: newScopeId(makeUuid),
        label,
        epoch: 0,
        persisted: false,
        reason: 'registry-unavailable',
      },
      commit: { kind: 'unchanged' },
      mutate: () => 'unchanged',
      expectWrite: false,
    };
  }
  if (read.kind === 'corrupt') {
    // 损坏记录：不使用、不删除、不覆盖（**所有入口一致**，含 pick——G0 勘误）
    return {
      state: {
        kind: 'disk-session',
        scopeId: newScopeId(makeUuid),
        label,
        epoch: 0,
        persisted: false,
        reason: 'registry-corrupt',
      },
      commit: { kind: 'unchanged' },
      mutate: () => 'unchanged',
      expectWrite: false,
    };
  }

  const now = Date.now();
  const baseline: WorkspaceRegistryRecord | null = read.kind === 'ok' ? read.record : null;

  const sameIds: string[] = [];
  let sawUnknown = false;
  if (baseline) {
    for (const e of baseline.entries) {
      const verdict = root === e.handle ? 'same' : await sameDirectory(root, e.handle);
      if (verdict === 'same') sameIds.push(e.scopeId);
      else if (verdict === 'unknown') sawUnknown = true;
    }
  }

  const onlySame = sameIds.length === 1 ? sameIds[0] : undefined;
  if (onlySame !== undefined) {
    // reuse：复用原 scopeId；该条目 active + 追加证据，其余 dormant；同事务写裸键
    const reuseId: ScopeId = onlySame;
    const mutate: RegistryMutate = (prev) => {
      if (prev.kind !== 'ok' || !prev.record.entries.some((e) => e.scopeId === reuseId)) {
        return 'conflict';
      }
      const entries = prev.record.entries.map((e) =>
        e.scopeId === reuseId
          ? {
              ...e,
              handle: root,
              label,
              lastSeenAt: now,
              state: 'active' as const,
              associations: [...e.associations, { at: now, via: 'isSameEntry' as const }],
            }
          : { ...e, state: 'dormant' as const },
      );
      return { ...prev.record, activeScopeId: reuseId, entries };
    };
    return {
      state: { kind: 'disk', scopeId: reuseId, label, epoch: 0, persisted: true },
      commit: { kind: 'write', handle: root },
      mutate,
      expectWrite: true,
    };
  }

  if (sameIds.length === 0 && !sawUnknown) {
    // register：空库 / 合法空表 / 全部明确不同 —— 登记新身份并淘汰（CR2-1 / E-13）
    const freshId = newScopeId(makeUuid);
    const base: WorkspaceRegistryRecord =
      baseline ?? { v: REGISTRY_VERSION, activeScopeId: null, entries: [] };
    const nextRecord = evictEntries(
      upsertEntry(base, { scopeId: freshId, handle: root, label, now, via: 'session-only' }),
      REGISTRY_MAX_ENTRIES,
    );
    const baselineIds = baseline ? baseline.entries.map((e) => e.scopeId) : [];
    const mutate: RegistryMutate = (prev) => {
      const prevIds =
        prev.kind === 'ok' ? prev.record.entries.map((e) => e.scopeId) : prev.kind === 'empty' ? [] : null;
      if (prevIds === null || !sameIdSet(prevIds, baselineIds)) return 'conflict';
      return nextRecord;
    };
    return {
      state: { kind: 'disk', scopeId: freshId, label, epoch: 0, persisted: true },
      commit: { kind: 'write', handle: root },
      mutate,
      expectWrite: true,
    };
  }

  // degrade（存在 unknown 且无 same）/ refuse（多个 same）：保守降级，注册表与裸键都不写
  return {
    state: {
      kind: 'disk-session',
      scopeId: newScopeId(makeUuid),
      label,
      epoch: 0,
      persisted: false,
      reason: 'unassociated',
    },
    commit: { kind: 'unchanged' },
    mutate: () => 'unchanged',
    expectWrite: false,
  };
}

/**
 * 阶段 2（**单事务内**）：执行 `mutate` / `commit`；`conflict` → 重跑阶段 1
 * （最多重解析 2 次 = 共 3 次尝试）→ 仍冲突 `disk-session('unassociated')`；
 * 写失败 → `disk-session('registry-write-failed')`（目录仍可用）。
 */
export async function applyIdentity(root: FsDirectoryHandle): Promise<ScopeState> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const plan = await resolveScopeForIdentity(root);
    if (!plan.expectWrite) return plan.state;
    const out = await writeWorkspaceRegistry(plan.mutate, plan.commit);
    if (out.kind === 'ok') return plan.state;
    if (out.kind === 'failed') {
      return {
        kind: 'disk-session',
        scopeId: plan.state.scopeId,
        label: plan.state.label,
        epoch: 0,
        persisted: false,
        reason: 'registry-write-failed',
      };
    }
    // conflict → 循环重解析（最多 2 次重试）
  }
  return {
    kind: 'disk-session',
    scopeId: newScopeId(makeUuid),
    label: root.name ?? '工作区',
    epoch: 0,
    persisted: false,
    reason: 'unassociated',
  };
}
