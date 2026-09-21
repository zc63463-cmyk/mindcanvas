/**
 * 工作区身份纯函数（P0-0-1）：ScopeId 生成/校验、注册表记录校验、合法追加与淘汰、
 * 目录同一性比较。
 *
 * 不是什么：
 * - 不做任何 I/O —— IndexedDB 读写归 `handleStore.ts`，目录访问归 `directoryHost.ts`；
 * - 不依赖 DOM / 浏览器 API —— uuid 源由调用方注入（`newScopeId`），`isSameEntry`
 *   只是句柄上的可选能力（缺失/抛错一律按「无法判定」处理，见 CD-02）。
 *
 * 证据与契约：docs/specs/2026-09-19-file-assets-design/shared-contracts.md §1.2.3（不变量）、
 * §1.2.4（I-13 归属证据规则）；p0-0-implementation-plan.md §4.1。
 */
import type { FsDirectoryHandle } from './directoryTypes.js';

export const BROWSER_SCOPE_ID = 'browser:local';
export const REGISTRY_VERSION = 1;
export const REGISTRY_MAX_ENTRIES = 8;

export type ScopeId = string;

/**
 * 运行期形态（shared-contracts §1.2.5）：
 * - `disk`          已持久登记的磁盘工作区（跨刷新有效）
 * - `disk-session`  本次会话可用的磁盘工作区，但身份不跨刷新（persisted:false）
 * - `browser`       浏览器素材库（无工作区）
 */
export type ScopeState =
  | { kind: 'disk'; scopeId: ScopeId; label: string; epoch: number; persisted: true }
  | {
      kind: 'disk-session';
      scopeId: ScopeId;
      label: string;
      epoch: number;
      persisted: false;
      reason: 'registry-write-failed' | 'registry-corrupt' | 'registry-unavailable' | 'unassociated';
    }
  | { kind: 'browser'; scopeId: typeof BROWSER_SCOPE_ID; label: string; epoch: number; persisted: true };

export interface WorkspaceRegistryEntry {
  scopeId: ScopeId;
  handle: FsDirectoryHandle;
  label: string;
  lastSeenAt: number;
  state: 'active' | 'dormant';
  associations: Array<{ at: number; via: 'isSameEntry' | 'user-confirmed' | 'session-only' }>;
}

export interface WorkspaceRegistryRecord {
  v: typeof REGISTRY_VERSION;
  activeScopeId: ScopeId | null;
  entries: WorkspaceRegistryEntry[];
}

/**
 * 注册表读取结果。**四态必须分开**（R2）：
 * - `empty`       键**不存在**（仅此一种情形；已存 `null` / 非法数据属于 `corrupt`）
 * - `ok`          键存在且结构合法
 * - `corrupt`     键存在但结构非法 / 版本未知 → 不删除、不修复、不覆盖
 * - `unavailable` IDB 打开失败或读取失败 → **存储故障，不代表空库**
 */
export type RegistryReadResult =
  | { kind: 'ok'; record: WorkspaceRegistryRecord }
  | { kind: 'empty' }
  | { kind: 'corrupt' }
  | { kind: 'unavailable' };

/** ScopeId 形状：`ws:` 前缀 + 非空主体 */
export function isScopeId(v: unknown): v is ScopeId {
  return typeof v === 'string' && v.startsWith('ws:') && v.length > 'ws:'.length;
}

/**
 * 生成新 ScopeId。uuid 源由调用方注入（测试需要确定性；生产传
 * `() => globalThis.crypto?.randomUUID?.() ?? fallback`，见 directoryHost.ts）。
 */
export function newScopeId(makeUuid: () => string): ScopeId {
  return `ws:${makeUuid()}`;
}

/**
 * 注册表记录校验：**全部不变量强制**（CR2-4A），任一条不满足 → `false`。
 *
 * 1. `v === REGISTRY_VERSION`，`entries` 是数组，`activeScopeId` 为 `null` 或合法 ScopeId；
 * 2. 每条 `scopeId` 过 `isScopeId`，且**记录内唯一**；
 * 3. **条件化 active 约束**：`activeScopeId !== null` ⇒ `state === 'active'` 的条目
 *    **恰好一个**且其 `scopeId === activeScopeId`；`activeScopeId === null` ⇒ **零** active
 *    （空库与 `detach()` 后都是合法状态）；
 * 4. 条目形状：`handle` 为对象，`label` 字符串，`lastSeenAt` 有限数，`associations` 数组。
 *
 * **不得**退化为「只检查 `activeScopeId` 能否命中某条 entries」——那会让「两个 active」
 * 或「`activeScopeId=null` 但仍有一条 active」的非法记录被写入（CR2-4A 的成因）。
 * 对任意 unknown 安全（`null` / 原始值一律 `false`，不抛）。
 */
export function isRegistryRecord(v: unknown): v is WorkspaceRegistryRecord {
  if (typeof v !== 'object' || v === null) return false;
  const rec = v as { v?: unknown; activeScopeId?: unknown; entries?: unknown };
  if (rec.v !== REGISTRY_VERSION) return false;
  const declaredActive = rec.activeScopeId;
  let declaredActiveId: string | null = null;
  if (declaredActive !== null) {
    if (!isScopeId(declaredActive)) return false;
    declaredActiveId = declaredActive;
  }
  if (!Array.isArray(rec.entries)) return false;

  const seen = new Set<string>();
  let activeCount = 0;
  let activeEntryId: string | null = null;

  for (const raw of rec.entries) {
    if (typeof raw !== 'object' || raw === null) return false;
    const e: Record<string, unknown> = raw;
    if (!isScopeId(e.scopeId)) return false;
    if (seen.has(e.scopeId)) return false; // scopeId 记录内唯一
    seen.add(e.scopeId);
    if (e.state !== 'active' && e.state !== 'dormant') return false;
    if (typeof e.label !== 'string') return false;
    if (typeof e.lastSeenAt !== 'number' || !Number.isFinite(e.lastSeenAt)) return false;
    if (!Array.isArray(e.associations)) return false;
    if (typeof e.handle !== 'object' || e.handle === null) return false;
    if (e.state === 'active') {
      activeCount += 1;
      activeEntryId = e.scopeId;
    }
  }

  if (declaredActiveId === null) return activeCount === 0;
  return activeCount === 1 && activeEntryId === declaredActiveId;
}

/**
 * 合法追加（与生产 `upsertEntry` 同规）：新条目为 active，**旧条目一律转 dormant**。
 * 同 `scopeId` 命中则复用条目并追加证据（幂等）。纯函数：返回新记录。
 */
export function upsertEntry(
  rec: WorkspaceRegistryRecord,
  next: {
    scopeId: ScopeId;
    handle: FsDirectoryHandle;
    label: string;
    now: number;
    via: WorkspaceRegistryEntry['associations'][number]['via'];
  },
): WorkspaceRegistryRecord {
  const existing = rec.entries.find((e) => e.scopeId === next.scopeId);
  const entries: WorkspaceRegistryEntry[] = rec.entries
    .filter((e) => e.scopeId !== next.scopeId)
    .map((e) => ({ ...e, state: 'dormant' }));
  entries.push({
    scopeId: next.scopeId,
    handle: next.handle,
    label: next.label,
    lastSeenAt: next.now,
    state: 'active',
    associations: [...(existing?.associations ?? []), { at: next.now, via: next.via }],
  });
  return { v: REGISTRY_VERSION, activeScopeId: next.scopeId, entries };
}

/**
 * 淘汰：最多保留 `max` 条；**active 必须保留**，其余按 `lastSeenAt` 降序保留最近的。
 * 未超限时原样返回（幂等）。
 */
export function evictEntries(rec: WorkspaceRegistryRecord, max: number): WorkspaceRegistryRecord {
  if (rec.entries.length <= max) return rec;
  const sorted = [...rec.entries].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  const keep: WorkspaceRegistryEntry[] = [];
  const active = sorted.find((e) => e.scopeId === rec.activeScopeId);
  if (active) keep.push(active);
  for (const e of sorted) {
    if (keep.length >= max) break;
    if (e.scopeId === active?.scopeId) continue;
    keep.push(e);
  }
  return { ...rec, entries: keep };
}

/**
 * 目录同一性比较（I-13）：**只有 `isSameEntry()` 的成功返回才算证据**。
 *
 * 为什么不用 `name` 或对象引用：目录名可重复、可重命名；对象引用跨刷新必然不成立
 * （IndexedDB 读回的是新对象）。能力缺失或比较抛错 → **`'unknown'`（不猜测）**，
 * 交由上层保守降级（CD-02 / CE-02）。
 */
export async function sameDirectory(
  a: FsDirectoryHandle,
  b: FsDirectoryHandle,
): Promise<'same' | 'different' | 'unknown'> {
  if (typeof a.isSameEntry !== 'function') return 'unknown';
  try {
    return (await a.isSameEntry(b)) ? 'same' : 'different';
  } catch {
    return 'unknown';
  }
}
