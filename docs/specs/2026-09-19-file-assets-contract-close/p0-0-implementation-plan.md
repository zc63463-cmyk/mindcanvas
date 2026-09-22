# P0-0 实施计划：身份与存储基础

任务：FILE-ASSETS-CONTRACT-CLOSE（T4 产物）。日期：2026-09-19。**本文件是计划，不是实施记录；本包未运行任何测试。**

> **版本：v5.1（G0 勘误后，2026-09-20）**。v5（指纹 `faf45cf84038c8b602e5ac8a1fd8606fabcce09a6f1d06ef2c8bb2697bc3a765`）经 G0 独立复核（回执 `docs/dispatch/2026-09-20-g0-report.md`，证据 `outputs/file-assets/G0/20260920-01/`）后做**局部勘误**（不改变已确认设计）：§4.2 同实例并发用例改用合法追加（旧条目转 dormant + 断言两次 `ok`）· §5 helpers 补齐导出/导入一致（`export` 补齐、去掉未用类型导入、句柄形状与 §4.2 一致）· 入口 1 补受控启动 barrier（与入口 3「完全相同调用方」及 §6.1「两实例 + 受控交错」对齐）· 入口 2/3 夹具安装说明 · `getRawResult`：仅 `undefined`（键不存在）为 `empty`，已存 `null` 走 `corrupt` · `corrupt` 对 `pick` 不再例外（所有入口不覆盖，与 E-5/CD-05 对齐）· §3.2 类型归属澄清。
>
> **版本：v5（执行编排修正后）**。相对 v4 的增量（依据 `docs/dispatch/2026-09-20-file-assets-contract-close-review3.md`，用户称「第三轮复核报告」，证据 `outputs/file-assets-contract-review-20260920-03/`）：**NC-5 拆为三入口编排**（正常并发回归进正式套件；旧快照逻辑反例与生产中性化副本放 `tests/counterexamples/**/*.counterexample.ts` + 专用 config，默认不收集）· **明确区分「调用方逻辑反例」与「生产实现中性化验证」**（前者常态必红、后者才证明写路径受保护）· **不变量条件化**（`activeScopeId` 非空时才要求恰好一个 active；空库与 detach 后合法）· **更正 §5 旧标题「三条」，计数以行为为准**。
>
> **版本：v4（第四轮收口后）**。相对 v3 的增量（CR2-4A/CR2-4B + 口径校正）：
> **`isRegistryRecord` 补齐全部不变量校验**（唯一 `scopeId`、active 唯一且等于 `activeScopeId`、`activeScopeId=null` ⇒ 无 active）· **NC-5 正例与同族用例改用合法 `legalAppend`**（旧条目先转 dormant）· **负控改用与正例相同的正确期望**（`ids == [a,b,c]`，中性化后以非零退出转红）· **删除失败用例先构造合法 dormant 记录**以命中删除失败窗口 · **NC-7 改为「`mutate` 必须同步返回」的契约测试**，事务生命周期另需真实/fake-indexeddb 校准。
>
> **版本：v3（第三轮返修后）**。
> - 第二轮复核打回 R1–R4 + 两项口径 → 已按 CD-19…CD-23 返修（`detach` 两键同事务 · 读四态 · 单事务 RMW · 夹具可编译 · `unassociated` 分期 · `requestPermission` 纳入 I-23）。
> - 第三轮复核打回 CR2-1…CR2-4 → 本版按 CD-24…CD-28 返修：**「明确不同」必须登记新身份**（不再并入无法判定）· **夹具 v3 支持 abort 与原子回滚**（`fail.writeAt` 命中「第一条写成功、第二条失败」）· **修正两条宿主测试的期望与前提**（`unavailable` 拆三段；只断言可读目标）· **NC-5 改为两实例 + 受控交错**并新增 **I-25 两阶段解析 + conflict 复核与有界重试**。
> **已确认的设计方向未变**；改动只在实现契约、判定分级与夹具。

**执行方式**：本计划经主控评审通过后，由独立开发包按 §4 的任务顺序执行。**不得**在本包内启动实施。

---

## 1. 范围、出口与不做什么

### 1.1 一句话范围

让「工作区」这件事第一次拥有**可跨会话稳定、且证据可审计**的身份：新增一个版本化的注册表记录键、一套纯函数身份工具、以及在 `DirectoryWorkspaceHost` 的**既有**挂载/恢复/断开三条路径上真实生效的 `scopeId`。

### 1.2 出口（什么算完成）

| # | 出口 |
|---|---|
| E-1 | `DirectoryWorkspaceHost` 在 `pick()` / `restore()` / `detach()` 后能给出 `scopeState` / `scopeId` / `scopeEpoch`，且取值符合 `shared-contracts.md` §1.2.5 |
| E-2 | 同目录重新选择（`isSameEntry` 命中）→ **同一** `scopeId`；不同目录 → **不同** `scopeId` |
| E-3 | A→B→A 后 A 的条目为 `dormant` 且**未被删除**，回到 A 时恢复 A 的 `scopeId` |
| E-4 | 旧裸句柄（注册表缺失）→ 走 legacy adoption，生成**新** `scopeId`，且 `'workspace-root'` 裸键的读路径行为**完全不变** |
| E-5 | 注册表损坏 → 不使用、不删除、不自动改写（**任何入口，含 `pick`**；G0 勘误明确）；本次为 `disk-session('registry-corrupt')` |
| E-6 | 注册表写入失败 → 本次可用、`persisted:false`、不承诺跨刷新 |
| E-7 | **读取/存储不可用 → `disk-session('registry-unavailable')`，不 legacy adoption、不写任何键**（R2） |
| E-8 | 关联不可证明（`isSameEntry` 缺失/抛错，或注册表非空且无命中）→ **保守降级为 `disk-session('unassociated')`，注册表与裸键都不写**，不声称恢复旧身份（R5 / §1.2.8） |
| E-9 | `detach()` 的注册表变更与裸键删除**在同一事务**提交；事务失败时两键都不变（R1） |
| E-10 | 注册表写入是**单事务 read-modify-write**；并发两次变更不丢更新（R3） |
| E-11 | `restore` / `pick` / `requestPermission` 三个入口对同一目录给出**同一 `scopeId`**；`requestPermission` 在已挂载时不改身份（I-23） |
| E-12 | 全部新增符号在 P0-0 内有真实调用点；无空实现（§1.4 自检表） |
| E-13 | **「明确不同」被正确登记为持久身份**（CR2-1）：A→B 后 B 为 `disk/persisted`、`active=B`、A 转 `dormant`、裸键=B；刷新后仍为 B；再选 A 恢复 A 原 `scopeId`。「注册表存在但 `entries` 为空」按空库处理，不降级 |
| E-14 | 夹具支持 **abort 与原子回滚**（CR2-2）：第 1 条写成功、第 2 条失败时两键都保持旧值、Promise 收束、`oncomplete` 未触发；另覆盖主动中止、`mutate` 抛错、记录非法、读取失败 |
| E-15 | **NC-5 用两个独立实例 + 受控交错**可复现「事务外读丢更新」，负控确实转红（CR2-4）；且 conflict → 重解析 → 两调用方同目录不产生重复条目 |
| E-16 | 身份判定只依赖**可读目标**断言（句柄 `name`、`activeScopeId`、`scopeId` 列表），不对含函数/句柄的对象做 `JSON.stringify` 深比较（CR2-3） |
| E-17 | **记录校验器强制全部不变量**（CR2-4A）：`scopeId` 唯一、`active` 唯一且等于 `activeScopeId`、`activeScopeId === null` ⇒ 无 active 条目；非法记录返回 `failed('invalid')` 而**不是**写入。所有并发/删除失败用例**先构造合法记录**再注入失败 |
| E-18 | **负控与正例使用同一正确期望**（CR2-4B）：转红的判据是命令**退出非零**（记录真实退出码）；不得把 expected failure 捕获成 exit 0 后宣称转红。NC-7 只保留「`mutate` 必须同步返回」这一可判定边界，事务生命周期另需真实/fake-indexeddb 校准 |
| E-19 | **NC-5 三入口编排**（第三轮复核修正）：**入口 1**（正常并发回归）进正式套件、必须 PASS/退出 0；**入口 2**（调用方旧快照逻辑反例）与**入口 3**（生产实现中性化）放 `tests/counterexamples/**/*.counterexample.ts` + 专用 config，**默认 `vitest run` 不收集**，各自预期 AssertionError/非零退出。**入口 2 常态必红**（旧调用方写法本身丢更新），**入口 3 才证明生产写路径受保护**（正常副本 0 / 中性化副本非零，分别留证）。禁止 `it.fails`、反转断言、`catch` 后报 PASS、宽泛 `skip` |

### 1.3 明确不做

| 不做 | 归属 |
|---|---|
| `rebindDestination` / `getDestinationInfo` / 操作租约 / `physicalWritesInFlight` | P0-A |
| `FileOpOutcome` / `FileOpError` / `*Safe` 变体 | P0-A |
| `uploadAssetDetailed` / `AssetWriteResult` / `AssetKey` / 解析状态 | P0-B |
| 索引层 / `DocIndexEntry` / 迁移 M4–M9 / 归档与降级投影 | P0-D |
| 「人工关联工作区」的交互面板 | P1-A（P0-0 只提供状态与证据字段，不提供 UI） |
| 任何 UI 改动、任何 `apps/canvas` 改动 | 后续包 |

**特别注意**：P0-0 **不实现**「旧收藏/句柄的归属迁移」，因为那需要索引层（P0-D）。契约里对应的反例 CE-06 / S3 验收项由 P0-D 承接；P0-0 **不得**为了让 S3 变绿而提前引入索引。

### 1.4 无消费者自检表（每个新符号必须有调用点）

| 新符号 | P0-0 内的调用点 | 是否空实现 |
|---|---|---|
| `newScopeId` / `isScopeId` | `directoryHost.pick()` / `restore()` / `upsertEntry` | 否 |
| `isRegistryRecord` | `handleStore.readWorkspaceRegistry()` | 否 |
| `upsertEntry` / `evictEntries` | `directoryHost.pick()` / `restore()` | 否 |
| `sameDirectory` | `directoryHost.pick()` | 否 |
| `scopeKeyOf` | **P0-0 无调用点 → 不引入**（P0-B 需要时再加） | — |
| `readWorkspaceRegistry` / `writeWorkspaceRegistry` / `WORKSPACE_REGISTRY_KEY` | `directoryHost` 三条路径 | 否 |
| `BROWSER_SCOPE_ID` / `REGISTRY_MAX_ENTRIES` | `directoryHost` 初始态 / `evictEntries` 调用 | 否 |
| `ScopeState` / `WorkspaceRegistryRecord` / `WorkspaceRegistryEntry` / `RegistryReadResult` | 上述函数的签名与返回值 | 否 |
| `isSameEntry?` 类型声明 | `sameDirectory` | 否 |

> **审查方式**：实现完成后，对每个新导出跑一次全局检索；若只有定义与测试命中，即视为空实现，必须删除或补齐真实调用点。

---

## 2. 文件与分层决策（先论证位置，再动手）

### 2.1 为什么放在 `packages/react/src/edit/**`

| 事实 | 证据 |
|---|---|
| 包名 `@mindcanvas/react`，`files: ["dist"]`，`main: ./dist/index.js` | `packages/react/package.json:2,4,6,15-18` |
| `packages/react/src/index.ts` 已再导出 `./edit/handleStore.js` 与 `./edit/directoryHost.js` | `packages/react/src/index.ts:325-344` |
| depcruise 现有规则**没有一条**禁止 `packages/react` → `apps/**` | `.dependency-cruiser.js:15-101` |
| `apps/canvas` 依赖 `@mindcanvas/react`（workspace 协议） | `apps/canvas/package.json:28-34` |

**结论**：P0-0 的全部新符号落在 `packages/react/src/edit/`（身份与目录原语）并通过 `index.ts` 再导出，`apps/canvas` 经 `@mindcanvas/react` 消费。

**理由**：① 已发布包的构建产物不能反向依赖应用目录；② depcruise 现状不拦该方向，正确性不能靠工具兜底；③ 与既有 `directoryHost`/`handleStore` 的导出方式一致，改动面最小。

**可选加固（本包建议、不在 P0-0 强制）**：向 `.dependency-cruiser.js` 增加一条 `no-react-depends-on-apps`（`from: '^packages/react/src', to: '^apps/'`，severity error）。若做，需同时确认现有依赖图不违反（属独立验证项）。

### 2.2 存储位置与键

沿用 `mindcanvas-handles` / store `handles`（`handleStore.ts:17-18`），**不新建数据库**：

| 键 | 内容 | 状态 |
|---|---|---|
| `'workspace-root'` | 裸 `FsDirectoryHandle` | **既有键，语义不变**；P0-0 只保证「active 变化时同事务写回」 |
| `'workspace-registry.v1'` | `WorkspaceRegistryRecord` | **新增**，单键单记录 |

---

## 3. 交付物清单

### 3.1 创建

| 路径 | 内容 |
|---|---|
| `packages/react/src/edit/workspaceScope.ts` | `ScopeId`/`ScopeState` 类型、`newScopeId`、`isScopeId`、`isRegistryRecord`、`upsertEntry`、`evictEntries`、`sameDirectory`、`BROWSER_SCOPE_ID`、`REGISTRY_VERSION`、`REGISTRY_MAX_ENTRIES` |
| `packages/react/tests/workspace-scope.test.ts` | 纯函数单测（§4.1） |

### 3.2 修改

| 路径 | 改动 |
|---|---|
| `packages/react/src/edit/handleStore.ts` | 新增 `WORKSPACE_REGISTRY_KEY`、`WorkspaceRegistryEntry`、`WorkspaceRegistryRecord`、`RegistryReadResult`（四态；★G0 勘误：**此三者定义在 `workspaceScope.ts`**，本文件只 `import type`，不得重复 export——见 §4.2 ⚠）、`LegacyHandleIntent`、`RegistryMutate`、`RegistryWriteResult`、`readWorkspaceRegistry()`、`writeWorkspaceRegistry(mutate, legacy)`（**单事务 RMW**）；新增内部 `getRawResult()`（可报告失败，**不复用** `getRaw()`）与 `writeChain` 串行链；**不改**既有 8 个导出的签名与语义 |
| `packages/react/src/edit/directoryTypes.ts` | `FsDirectoryHandle` 增加可选 `isSameEntry?: (other: unknown) => Promise<boolean>` |
| `packages/react/src/edit/directoryHost.ts` | `pick()` / `restore()` / `detach()` 接入注册表；新增 `scopeState` / `scopeId` / `scopeEpoch` 访问器；新增内部 `sameDirectory` 调用与 `disk-session` 降级 |
| `packages/react/src/index.ts` | 再导出 §3.1/§3.2 的新符号 |
| `packages/react/tests/handle-store.test.ts` | 扩展：注册表双写、损坏记录、事务失败（需扩展内存 IDB 替身） |
| `packages/react/tests/directory-host.test.ts` | 扩展：同目录重选、不同目录同名隔离、A→B→A、断开再连、旧裸句柄、损坏与写入失败 |

### 3.3 不修改（本轮明确）

`packages/react/src/chrome/**`、`packages/react/src/render/**`、`apps/**`、`packages/kernel/**`、`.dependency-cruiser.js`（§2.1 的加固为可选独立项）、任何 `package.json`（P0-0 不新增依赖）。

---

## 4. 逐任务计划

> 每个任务给出：产出签名 → 先写的失败测试（代码）→ 最小实现步骤 → 运行命令 → 预期结果 → 停止点。
>
> 命名与风格沿用仓库现状：相对路径 `.js` 互引（`verbatimModuleSyntax` 已开）、`import type` 显式类型导入、中文注释解释「为什么」。

### 4.1 P0-0-1 纯函数身份工具（`packages/react/src/edit/workspaceScope.ts`）

**产出签名**

```ts
export const BROWSER_SCOPE_ID = 'browser:local';
export const REGISTRY_VERSION = 1;
export const REGISTRY_MAX_ENTRIES = 8;

export type ScopeId = string;
export type ScopeState =
  | { kind: 'disk'; scopeId: ScopeId; label: string; epoch: number; persisted: true }
  | { kind: 'disk-session'; scopeId: ScopeId; label: string; epoch: number; persisted: false;
      reason: 'registry-write-failed' | 'registry-corrupt' | 'unassociated' }
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

export function isScopeId(v: unknown): v is ScopeId;
export function isRegistryRecord(v: unknown): v is WorkspaceRegistryRecord;
export function newScopeId(makeUuid: () => string): ScopeId;   // 注入 uuid 源，便于确定性测试
export function upsertEntry(
  rec: WorkspaceRegistryRecord,
  next: { scopeId: ScopeId; handle: FsDirectoryHandle; label: string; now: number;
          via: WorkspaceRegistryEntry['associations'][number]['via'] },
): WorkspaceRegistryRecord;                                    // 纯：返回新记录，active 指向 next
export function evictEntries(rec: WorkspaceRegistryRecord, max: number): WorkspaceRegistryRecord;
export function sameDirectory(
  a: FsDirectoryHandle, b: FsDirectoryHandle,
): Promise<'same' | 'different' | 'unknown'>;                  // 能力缺失/抛错 → 'unknown'
```

**为什么 `newScopeId` 注入 uuid 源**：测试需要确定性；生产传 `() => crypto.randomUUID()`。这避免为测试引入随机或 spy。

**先写的失败测试**（`packages/react/tests/workspace-scope.test.ts`，默认 node 环境，无需 jsdom）

```ts
import { describe, expect, it } from 'vitest';
import {
  BROWSER_SCOPE_ID, REGISTRY_MAX_ENTRIES,
  evictEntries, isRegistryRecord, isScopeId, newScopeId, sameDirectory, upsertEntry,
} from '../src/edit/workspaceScope.js';
import type { FsDirectoryHandle } from '../src/edit/directoryTypes.js';
import type { WorkspaceRegistryEntry, WorkspaceRegistryRecord } from '../src/edit/workspaceScope.js';

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
    const a = upsertEntry({ v: 1, activeScopeId: null, entries: [] },
      { scopeId: 'ws:a', handle: dir('A'), label: 'A', now: 1, via: 'isSameEntry' });
    const b = upsertEntry(a, { scopeId: 'ws:b', handle: dir('B'), label: 'B', now: 2, via: 'isSameEntry' });
    expect(b.activeScopeId).toBe('ws:b');
    expect(b.entries.find((e) => e.scopeId === 'ws:a')?.state).toBe('dormant');
    expect(b.entries.find((e) => e.scopeId === 'ws:b')?.state).toBe('active');
  });

  it('upsertEntry：同 scopeId 复用同一个条目并追加证据（幂等）', () => {
    const a = upsertEntry({ v: 1, activeScopeId: null, entries: [] },
      { scopeId: 'ws:a', handle: dir('A'), label: 'A', now: 1, via: 'isSameEntry' });
    const a2 = upsertEntry(a, { scopeId: 'ws:a', handle: dir('A2'), label: 'A', now: 9, via: 'user-confirmed' });
    expect(a2.entries).toHaveLength(1);
    expect(a2.entries[0]?.associations.map((x) => x.via)).toEqual(['isSameEntry', 'user-confirmed']);
    expect(a2.entries[0]?.lastSeenAt).toBe(9);
  });

  it('evictEntries 保留 active 与最近的 dormant，淘汰最旧', () => {
    let rec = { v: 1 as const, activeScopeId: null as string | null, entries: [] as never[] };
    // 依次塞入 max+1 个条目（lastSeenAt 递增）
    for (let i = 0; i <= REGISTRY_MAX_ENTRIES; i++) {
      rec = upsertEntry(rec as never, { scopeId: `ws:${i}`, handle: dir(`D${i}`), label: `D${i}`, now: i + 1, via: 'isSameEntry' }) as never;
    }
    const out = evictEntries(rec as never, REGISTRY_MAX_ENTRIES);
    expect(out.entries).toHaveLength(REGISTRY_MAX_ENTRIES);
    expect(out.entries.some((e) => e.scopeId === 'ws:0')).toBe(false);        // 最旧被淘汰
    expect(out.entries.some((e) => e.scopeId === out.activeScopeId)).toBe(true); // active 必须在
  });

  it('sameDirectory：isSameEntry=true → same；false → different', async () => {
    expect(await sameDirectory(dir('A', async () => true), dir('B'))).toBe('same');
    expect(await sameDirectory(dir('A', async () => false), dir('B'))).toBe('different');
  });

  it('sameDirectory：能力缺失 / 抛错 → unknown（不猜测）', async () => {
    expect(await sameDirectory(dir('A'), dir('A'))).toBe('unknown');
    expect(await sameDirectory(dir('A', async () => { throw new Error('boom'); }), dir('A'))).toBe('unknown');
  });
});
```

**最小实现步骤**

1. 建 `workspaceScope.ts`，写类型与常量：`ScopeId`、`ScopeState`、`WorkspaceRegistryEntry`、`WorkspaceRegistryRecord`、**`RegistryReadResult`**（四态，见 §4.2 形状说明；`handleStore.ts` 只 import 使用）与 `REGISTRY_VERSION` / `REGISTRY_MAX_ENTRIES` / `BROWSER_SCOPE_ID`。
2. `isRegistryRecord`：**必须完整校验已声明的不变量**（CR2-4A）——① `v === 1`；② `Array.isArray(entries)`；③ 每条 `scopeId` 过 `isScopeId`；④ **`scopeId` 在记录内唯一**；⑤ **条件化 active 约束**：`activeScopeId !== null` ⇒ `state === 'active'` 的条目**恰好一个**且其 `scopeId === activeScopeId`；`activeScopeId === null` ⇒ **没有任何 active 条目**（空库与 `detach` 后均为合法状态，第三轮复核校正）。
   - 任一条不满足 → `false`。**不得**为了让某个测试通过而退化成「只检查 activeScopeId 是否存在条目」——那会让 `mutate` 写出非法记录（CR2-4A 的成因）。
3. `newScopeId(makeUuid)` = `` `ws:${makeUuid()}` ``。
4. `upsertEntry`：浅拷贝记录；同 `scopeId` 命中则合并（替换 handle、`lastSeenAt = now`、push 证据、`state='active'`），其余置 `'dormant'`；`activeScopeId = scopeId`。
5. `evictEntries`：保留 active + 按 `lastSeenAt` 降序取前 `max-1` 条 dormant。
6. `sameDirectory`：`typeof a.isSameEntry === 'function'` 时 `try { return (await a.isSameEntry(b)) ? 'same' : 'different' } catch { return 'unknown' }`；否则 `'unknown'`。**注释必须写明为什么不用 `name` 或 `===`**（I-13）。

**运行命令**

```bash
pnpm --filter @mindcanvas/react test -- workspace-scope
```

**预期结果**：新文件 **9** 个用例全绿（含 ★CR2-4A 的不变量用例）；其余测试不受影响（新模块尚未被引用）。

**停止点**：`workspaceScope.ts` 与测试独立可跑；**不继续**写 `handleStore`，直到本任务绿。

---

### 4.2 P0-0-2 注册表读写（`packages/react/src/edit/handleStore.ts`）

**产出签名**

```ts
export const WORKSPACE_REGISTRY_KEY = 'workspace-registry.v1';

/**
 * 注册表读取结果。**四态必须分开**（R2）：
 * - `empty`       键**不存在**（仅此一种情形）
 * - `ok`         键存在且结构合法
 * - `corrupt`    键存在但结构非法 / 版本未知 → 不删除、不修复
 * - `unavailable` IDB 打开失败或读取失败 → **存储故障，不代表空库**
 */
// ⚠ 归属：`RegistryReadResult` 与 `WorkspaceRegistryRecord` / `WorkspaceRegistryEntry` 一样
//   **定义在 `./edit/workspaceScope.js`**（见 §4.1），handleStore.ts 只 `import type` 使用，
//   §4.5 的桶导出也从 `workspaceScope.js` 再导出。此处只列形状，**不要在本文件重复 export**：
// export type RegistryReadResult =
//   | { kind: 'ok'; record: WorkspaceRegistryRecord }
//   | { kind: 'empty' }
//   | { kind: 'corrupt' }
//   | { kind: 'unavailable' };

/** 读注册表：四态见上；**永不抛** */
export async function readWorkspaceRegistry(): Promise<RegistryReadResult>;

/** 裸句柄键（`WORKSPACE_ROOT_KEY`）的处置，与注册表变更**在同一事务内**提交 */
export type LegacyHandleIntent =
  | { kind: 'unchanged' }
  | { kind: 'write'; handle: FsDirectoryHandle }
  | { kind: 'delete' };

/**
 * 注册表变更函数：在**事务内**基于事务内读到的结果计算新记录。
 * 返回值语义（CR2-1/CR2-4）：
 * - 合法记录  → 写入
 * - `'unchanged'` → 本次不写注册表键（只处置裸句柄）
 * - `'conflict'`  → 事务读到的状态与阶段 1 基线不一致 → **不写任何键**，交调用方重新解析
 *
 * **禁止**在 mutate 内 `await` 任何非 IDB 的 Promise（`isSameEntry` 比较必须在事务外，I-25）。
 */
export type RegistryMutate = (
  prev: RegistryReadResult,
) => WorkspaceRegistryRecord | 'unchanged' | 'conflict';

export type RegistryWriteResult =
  | { kind: 'ok'; record: WorkspaceRegistryRecord | null }   // null = 本次未写注册表
  | { kind: 'conflict' }                                     // 状态已变，未写任何键
  | { kind: 'failed'; reason: 'unavailable' | 'aborted' | 'invalid' };

/**
 * **单事务 read-modify-write**。同一 `readwrite` 事务内依次完成：
 * ① `get(WORKSPACE_REGISTRY_KEY)` → 判定四态；
 * ② 读失败 → 直接 `failed('unavailable')`，**不执行** mutate、不写任何键；
 * ③ 调用 `mutate(prev)` 计算；
 * ④ `isRegistryRecord` 校验返回值，非法 → `tx.abort()` + `failed('invalid')`（**拒绝写入**，而不是写进去再发现坏了）；
 * ⑤ 写注册表键（除非 `'unchanged'`）；
 * ⑥ 按 `legacy` 写 / 删裸句柄键；
 * ⑦ `tx.oncomplete` → `ok`；`tx.onerror`／异常 → `failed('aborted')`。
 *
 * 不抛；失败经 `failed` 暴露。
 */
export async function writeWorkspaceRegistry(
  mutate: RegistryMutate,
  legacy: LegacyHandleIntent,
): Promise<RegistryWriteResult>;
```

**关键实现要求**

1. **读路径必须能报告失败（R2）**：新增内部 `getRawResult(): Promise<{kind:'ok';value:unknown} | {kind:'empty'} | {kind:'unavailable'}>`，其 `req.onerror` → `unavailable`；**仅 `req.result === undefined`（键不存在，是 `empty` 的唯一情形）→ `empty`**；其余（**包括已存的 `null`**）→ `{kind:'ok', value}`，交 `classify` 判定（`null` 过不了 `isRegistryRecord` → `corrupt`，不得折叠成 `empty`——G0 勘误）。**不得**复用既有的 `getRaw()`——它在 `catch` 后返回 `null`（`handleStore.ts:70-72`），正是「存储故障被折叠成空库」的根因。判定顺序：`unavailable` → `empty` → `isRegistryRecord` 失败则 `corrupt`。
2. **写入必须是单事务 RMW（R3）**：`conn.transaction(STORE,'readwrite')` → `store.get(KEY)` → **在 `req.onsuccess` 内**判定四态并调 `mutate` → 校验 → `put` → 按 `legacy` 处置裸键 → `tx.oncomplete`。**不得**接受调用方在事务外构造好的完整记录（那正是并发丢更新的根因）。
   - 依赖 IDB 规范「重叠 scope 的 `readwrite` 事务按创建顺序串行」；同时在模块内加一条 `let writeChain: Promise<unknown> = Promise.resolve()` 的串行链，保证本页并发调用的「打开库 → 建事务」顺序稳定（**不得**只靠锁而不做事务内 RMW）。
3. **原子性（R1）**：注册表键与裸句柄键（写或删）**必须同一事务提交**。因此 `detach()` **不得**再「先改注册表 + 再单独 `deleteDirectoryHandle()`」——它改为 `writeWorkspaceRegistry(markDormant, { kind: 'delete' })`。
   - `deleteDirectoryHandle()` 作为既有公开 API **保持签名与语义不变**（仍可用于只想清裸键的调用方）；只是 `detach()` 不再走它，以避免两键分叉。
   - 事务失败时两键**都不变**（无半更新）。
4. **兼容纪律**：`legacy.kind === 'write'` 写的是**裸句柄**，绝不写包装对象。
5. **不得**修改既有导出（`WORKSPACE_ROOT_KEY` / `setDirectoryHandle` / `getDirectoryHandle` / `deleteDirectoryHandle` / `setFileHandle` / `getFileHandle` / `deleteFileHandle` / `verifyPermission`）的签名与语义。

**先写的失败测试**（扩展 `packages/react/tests/handle-store.test.ts`）

现有的内存 IDB 替身（`:30-95`）只支持单 put、且 `onerror` setter 是空实现。扩展为「多 put + 可注入失败」：

```ts
/**
 * 内存 IDB 替身 v3（可编译；支持 **abort 与原子回滚**）。
 *
 * 相对 v2 的关键修正（CR2-2）：
 * - 写请求**暂存**（staged），`oncomplete` 时才发布到 memStore；`abort` 时**丢弃**；
 * - 任一请求失败**自动 abort**，不再「读取失败后继续 put 并提交」；
 * - 支持 `tx.abort()` 主动中止与 `onabort`；
 * - `oncomplete` / `onabort` **互斥结算**（只触发其一）；
 * - `fail.writeAt = N` 让**第 N 个**写请求失败，从而命中原 v2 覆盖不到的窗口：
 *   「第一条写已执行、第二条失败」时两键都不变。
 *
 * 另对齐三条既有语义：① 一次事务可多次 put/delete；② `get()` 的 `result` 在
 * `onsuccess` 时才可读；③ 事务按创建顺序串行（重叠 scope 的 readwrite 串行）。
 *
 * **共享态挂在 `globalThis`**：使 `vi.resetModules()` 后的多个模块实例共用同一个
 * 「数据库」与同一条事务串行链——这是 CR2-4 要求「两个独立调用方共用数据库但不共享
 * `writeChain`」的前提（真实 IDB 的串行是**每库**的，不是每模块的）。
 *
 * 说明：这是**计划用夹具**。实现时若与真实 IDB 行为不符，以真实行为为准校准；
 * **不得**为了让测试变绿而放宽生产断言（见 review-receipt.md §7）。
 */
interface FakeReq {
  result: unknown;
  error: unknown;
  onsuccess: null | (() => void);
  onerror: null | ((e: unknown) => void);
  onupgradeneeded: null | (() => void);
}

interface FakeIdbState {
  mem: Map<string, unknown>;
  /** `read` = 所有读失败；`readKey` = 只让某个键的读失败（CR2-3：只注入注册表读取错误，裸键仍可读） */
  fail: { open: boolean; read: boolean; readKey: string | null; writeAt: number };
  txChain: { p: Promise<void> };
  /** 已提交事务计数：用于断言「失败时 oncomplete 未触发」 */
  commitCount: number;
}

const g = globalThis as unknown as { __fakeIdb?: FakeIdbState };
const st: FakeIdbState = (g.__fakeIdb ??= {
  mem: new Map<string, unknown>(),
  fail: { open: false, read: false, readKey: null, writeAt: 0 },
  txChain: { p: Promise.resolve() },
  commitCount: 0,
});
const memStore = st.mem;
const fail = st.fail;

function okReq(value: unknown): FakeReq {
  const r: FakeReq = { result: value, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
  queueMicrotask(() => r.onsuccess?.());
  return r;
}

/** 一次事务：v3 —— 暂存 + 失败中止 + 提交发布 + abort 丢弃 */
function makeTx() {
  const tasks: Array<() => void> = [];
  const staged: Array<() => void> = [];
  let writeCount = 0;
  let settled: 'complete' | 'abort' | null = null;
  let abortRequested = false;

  const finish = (kind: 'complete' | 'abort'): void => {
    if (settled !== null) return;            // 互斥结算
    settled = kind;
    if (kind === 'complete') {
      st.commitCount += 1;
      tx.oncomplete?.();
    } else {
      tx.onabort?.();
    }
  };

  const request = (run: (req: FakeReq) => void): FakeReq => {
    const req: FakeReq = {
      result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null,
    };
    tasks.push(() => run(req));
    return req;
  };

  const failWrite = (req: FakeReq): void => {
    writeCount += 1;
    if (fail.writeAt !== writeCount) return;
    req.error = new Error(`write #${writeCount} failed`);
    abortRequested = true;
    req.onerror?.(req.error);
    tx.onerror?.(req.error);
  };

  const tx = {
    error: null as unknown,
    oncomplete: null as null | (() => void),
    onabort: null as null | (() => void),
    onerror: null as null | ((e: unknown) => void),
    /** 主动中止（生产代码在 mutate 抛错 / 记录非法时调用） */
    abort(): void {
      abortRequested = true;
    },
    objectStore: () => ({
      put: (v: unknown, k: string) =>
        request((req) => {
          failWrite(req);
          if (req.error !== null) return;
          staged.push(() => memStore.set(k, v));
          req.onsuccess?.();
        }),
      delete: (k: string) =>
        request((req) => {
          failWrite(req);
          if (req.error !== null) return;
          staged.push(() => memStore.delete(k));
          req.onsuccess?.();
        }),
      get: (k: string) =>
        request((req) => {
          if (fail.read || fail.readKey === k) {
            req.error = new Error(`read failed: ${k}`);
            abortRequested = true;
            req.onerror?.(req.error);
            tx.onerror?.(req.error);
            return;
          }
          req.result = memStore.get(k);
          req.onsuccess?.();
        }),
    }),
  };

  st.txChain.p = st.txChain.p.then(
    () =>
      new Promise<void>((resolve) => {
        // 先让当前同步块把本事务的操作登记完，再按登记顺序执行
        queueMicrotask(() => {
          // 索引循环：`get` 的 onsuccess 里新登记的 put 也会在同一事务内执行
          for (let i = 0; i < tasks.length && !abortRequested; i++) tasks[i]?.();
          if (abortRequested) {
            staged.length = 0;               // 回滚：丢弃全部暂存
            finish('abort');
          } else {
            for (const op of staged) op();   // 提交：发布
            finish('complete');
          }
          resolve();
        });
      }),
  );
  return tx;
}

function openReq(): FakeReq {
  const r: FakeReq = { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
  queueMicrotask(() => {
    if (fail.open) {
      r.error = new Error('open failed');
      r.onerror?.(r.error);
      return;
    }
    r.result = {
      objectStoreNames: { contains: (n: string) => n === STORE },
      createObjectStore: () => undefined,
      transaction: () => makeTx(),
    };
    r.onupgradeneeded?.();
    r.onsuccess?.();
  });
  return r;
}

function installMemoryIndexedDB(): void {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = {
    open: () => openReq(),
  } as unknown as IDBFactory;
}

/** 每个用例前重置共享态（含 commitCount 与串行链） */
function resetFixture(): void {
  memStore.clear();
  fail.open = false;
  fail.read = false;
  fail.readKey = null;
  fail.writeAt = 0;
  st.commitCount = 0;
  st.txChain.p = Promise.resolve();
}
```

> **夹具校准记录（CR2-2）**：v2 夹具在读取失败后仍继续执行 `put` 并触发 `oncomplete`（复核实跑：`abortType=undefined`、`readFailed=true`、`completed=true`、`stored='after'`）。v3 用「暂存 + 失败中止 + 提交发布 + abort 丢弃 + 互斥结算」修正；`fail.writeAt = N` 取代 v2 的全局 `fail.write`，以命中「第一条写已执行、第二条失败」的窗口。**生产实现不得为了迁就夹具而绕开 `abort`。**

> **迁移说明**：本替身替换原文件里既有的 `FakeRequest` / `valueReq` / `openReq`（同一文件内保持一致）。**原有 15 个用例的断言不得改动**，只改它们引用的 helper 名字。

```ts
describe('handleStore：工作区注册表（单事务 RMW）', () => {
  /** 构造一个合法注册表记录（便于断言） */
  const rec = (ids: readonly string[]): WorkspaceRegistryRecord => ({
    v: 1,
    activeScopeId: ids[ids.length - 1] ?? null,
    entries: ids.map((s, i) => ({
      scopeId: s,
      handle: dirHandle(s),
      label: s,
      lastSeenAt: i + 1,
      state: i === ids.length - 1 ? ('active' as const) : ('dormant' as const),
      associations: [{ at: 1, via: 'isSameEntry' as const }],
    })),
  });

  it('R3：RMW 往返 —— mutate 在事务内基于**事务读到的**旧记录计算', async () => {
    await writeWorkspaceRegistry(() => rec(['ws:1']), { kind: 'write', handle: dirHandle('A') });
    let seen: RegistryReadResult | null = null;
    const out = await writeWorkspaceRegistry(
      (prev) => {
        seen = prev;
        return prev.kind === 'ok' ? rec(['ws:1', 'ws:2']) : rec(['ws:2']);
      },
      { kind: 'unchanged' },
    );
    expect(seen).not.toBeNull();
    expect((seen as unknown as RegistryReadResult).kind).toBe('ok');   // 事务内读到了上一次的写入
    expect(out).toMatchObject({ kind: 'ok' });
    const got = await readWorkspaceRegistry();
    expect(got.kind === 'ok' && got.record.entries.map((e) => e.scopeId)).toEqual(['ws:1', 'ws:2']);
  });

  it('R3：并发两次 RMW 不丢更新（事务串行 + 事务内读）', async () => {
    await writeWorkspaceRegistry(() => rec(['ws:a']), { kind: 'unchanged' });
    const append = (id: string) => (prev: RegistryReadResult): WorkspaceRegistryRecord => {
      const base = prev.kind === 'ok' ? prev.record : rec([]);
      // ★G0 勘误：追加必须保持合法——旧条目一律转 dormant 后再追加新 active（与生产 upsertEntry、
      // §5 legalAppend 同规）。旧版保留旧 active 会形成「两个 active」，被 isRegistryRecord 判 invalid →
      // 正例在正确实现下必红（与 CR2-4A 同类问题）。
      return {
        ...base,
        entries: [...base.entries.map((e) => ({ ...e, state: 'dormant' as const })), ...rec([id]).entries],
        activeScopeId: id,
      };
    };
    const [r1, r2] = await Promise.all([
      writeWorkspaceRegistry(append('ws:b'), { kind: 'unchanged' }),
      writeWorkspaceRegistry(append('ws:c'), { kind: 'unchanged' }),
    ]);
    expect(r1).toMatchObject({ kind: 'ok' });   // ★G0 勘误：两次都必须被接受（不得是 invalid）
    expect(r2).toMatchObject({ kind: 'ok' });
    const got = await readWorkspaceRegistry();
    const ids = got.kind === 'ok' ? got.record.entries.map((e) => e.scopeId).sort() : [];
    expect(ids).toEqual(['ws:a', 'ws:b', 'ws:c']);   // 两次变更都保留
  });

  it('R1：注册表变更与裸句柄删除在同一事务（detach 原子）', async () => {
    await writeWorkspaceRegistry(() => rec(['ws:1']), { kind: 'write', handle: dirHandle('A') });
    expect(await getDirectoryHandle()).not.toBeNull();
    const out = await writeWorkspaceRegistry(
      (prev) =>
        prev.kind === 'ok'
          ? { ...prev.record, activeScopeId: null, entries: prev.record.entries.map((e) => ({ ...e, state: 'dormant' as const })) }
          : 'unchanged',
      { kind: 'delete' },
    );
    expect(out).toMatchObject({ kind: 'ok' });
    expect(await getDirectoryHandle()).toBeNull();                     // 裸键已删
    const got = await readWorkspaceRegistry();
    expect(got.kind === 'ok' && got.record.activeScopeId).toBeNull();  // 注册表已 dormant
    expect(got.kind === 'ok' && got.record.entries).toHaveLength(1);   // 条目未删
  });

  it('R1 负向：第 1 条写成功、第 2 条失败 → 两键都保持旧值（原子回滚，CR2-2）', async () => {
    await writeWorkspaceRegistry(() => rec(['ws:old']), { kind: 'write', handle: dirHandle('OLD') });
    const commitsBefore = st.commitCount;

    fail.writeAt = 2;                     // 第 1 个写请求成功（暂存），第 2 个失败 → 中止
    const out = await writeWorkspaceRegistry(() => rec(['ws:new']), { kind: 'write', handle: dirHandle('NEW') });
    fail.writeAt = 0;

    expect(out).toEqual({ kind: 'failed', reason: 'aborted' });        // Promise 收束
    expect(st.commitCount).toBe(commitsBefore);                        // oncomplete 未触发
    const got = await readWorkspaceRegistry();
    expect(got.kind === 'ok' && got.record.entries.map((e) => e.scopeId)).toEqual(['ws:old']);  // 注册表回滚
    expect((await getDirectoryHandle())?.name).toBe('OLD');            // 裸键回滚
  });

  it('R1 负向：第 1 条写成功、第 2 条是删除且失败 → 两键都保持旧值', async () => {
    await writeWorkspaceRegistry(() => rec(['ws:old']), { kind: 'write', handle: dirHandle('OLD') });
    fail.writeAt = 2;
    const out = await writeWorkspaceRegistry(
      // ★CR2-4A：必须先构造**合法**记录（条目转 dormant + activeScopeId=null），
      // 否则会被 isRegistryRecord 判为 invalid 而在到达 delete 请求前就中止，
      // 命不中「第二次 delete 失败」这个窗口。
      (prev) =>
        prev.kind === 'ok'
          ? {
              ...prev.record,
              activeScopeId: null,
              entries: prev.record.entries.map((e) => ({ ...e, state: 'dormant' as const })),
            }
          : 'unchanged',
      { kind: 'delete' },
    );
    fail.writeAt = 0;
    expect(out).toEqual({ kind: 'failed', reason: 'aborted' });
    expect(await getDirectoryHandle()).not.toBeNull();                 // 删除被回滚
    const got = await readWorkspaceRegistry();
    expect(got.kind === 'ok' && got.record.activeScopeId).toBe('ws:old');
  });

  it('CR2-2：mutate 抛错 → 中止，两键不变', async () => {
    await writeWorkspaceRegistry(() => rec(['ws:old']), { kind: 'write', handle: dirHandle('OLD') });
    const out = await writeWorkspaceRegistry(() => {
      throw new Error('boom');
    }, { kind: 'delete' });
    expect(out).toEqual({ kind: 'failed', reason: 'aborted' });
    expect((await getDirectoryHandle())?.name).toBe('OLD');
    const got = await readWorkspaceRegistry();
    expect(got.kind === 'ok' && got.record.entries).toHaveLength(1);
  });

  it('R2：键不存在 → empty（仅此一种情形；已存 null 是 corrupt，不是 empty）', async () => {
    expect((await readWorkspaceRegistry()).kind).toBe('empty');
    // ★G0 勘误：`null` 是「键存在但值非法」，不是「键不存在」——不得折叠成 empty
    memStore.set(WORKSPACE_REGISTRY_KEY, null);
    expect((await readWorkspaceRegistry()).kind).toBe('corrupt');
  });

  it('R2：结构非法 → corrupt，且不删除、不修复', async () => {
    memStore.set(WORKSPACE_REGISTRY_KEY, { not: 'a registry' });
    expect((await readWorkspaceRegistry()).kind).toBe('corrupt');
    expect((await readWorkspaceRegistry()).kind).toBe('corrupt');
    expect(memStore.has(WORKSPACE_REGISTRY_KEY)).toBe(true);
  });

  it('R2：IDB 打开失败 → unavailable（**不得**折叠成 empty）', async () => {
    fail.open = true;
    expect((await readWorkspaceRegistry()).kind).toBe('unavailable');
    fail.open = false;
  });

  it('R2：读取失败 → unavailable', async () => {
    fail.read = true;
    expect((await readWorkspaceRegistry()).kind).toBe('unavailable');
    fail.read = false;
  });

  it('R2：unavailable 时 mutate 不执行、任何键都不写', async () => {
    fail.read = true;
    let called = false;
    const out = await writeWorkspaceRegistry(
      (prev) => { called = true; return prev.kind === 'ok' ? prev.record : rec([]); },
      { kind: 'write', handle: dirHandle('A') },
    );
    fail.read = false;
    expect(out).toEqual({ kind: 'failed', reason: 'unavailable' });
    expect(called).toBe(false);
    expect(await getDirectoryHandle()).toBeNull();
  });

  it('R3：mutate 返回非法记录 → 拒绝写入（failed:invalid），旧记录不被破坏', async () => {
    await writeWorkspaceRegistry(() => rec(['ws:1']), { kind: 'unchanged' });
    const out = await writeWorkspaceRegistry(
      () => ({ v: 1, activeScopeId: 'ws:ghost', entries: [] }) as unknown as WorkspaceRegistryRecord,
      { kind: 'unchanged' },
    );
    expect(out).toEqual({ kind: 'failed', reason: 'invalid' });
    const got = await readWorkspaceRegistry();
    expect(got.kind === 'ok' && got.record.entries).toHaveLength(1);
  });

  it('回归：既有裸句柄接口语义不变（set/get/delete 仍可用）', async () => {
    await setDirectoryHandle(dirHandle('A'));
    expect((await getDirectoryHandle())?.name).toBe('A');
    await deleteDirectoryHandle();
    expect(await getDirectoryHandle()).toBeNull();
  });
});
```

（`dirHandle(name)` 是新增的本地 helper：返回带 `getDirectoryHandle` 的对象，以满足 `isDirectoryHandle` 谓词。）

**最小实现步骤**

1. 新增 `WORKSPACE_REGISTRY_KEY` 常量、`LegacyHandleIntent`、`RegistryMutate`、`RegistryWriteResult` 类型（后三者在本文件导出，`WorkspaceRegistryRecord` 从 `workspaceScope.ts` 再导出类型）。
2. 新增内部 `getRawResult(key)`：`req.onerror` → `{kind:'unavailable'}`；**仅 `req.result === undefined` → `{kind:'empty'}`**（键不存在是 `empty` 的唯一情形）；否则 `{kind:'ok', value}`（**已存 `null` 也走此处**，由 `classify` 判为 `corrupt`——G0 勘误）。**不复用 `getRaw()`**。
3. 新增内部 `classify(raw)`：`unavailable` → `unavailable`；`empty` → `empty`；`isRegistryRecord` 失败 → `corrupt`；成功 → `ok`。`readWorkspaceRegistry()` 只用这条路径。
4. `writeWorkspaceRegistry(mutate, legacy)`：建 `readwrite` 事务 → `get` → 在 `onsuccess` 内 `classify` → 若 `unavailable` 则 `tx.abort()` 并 resolve `failed('unavailable')` → 调 `mutate(prev)` → 若 `'unchanged'` 则跳过写注册表 → 否则 `isRegistryRecord` 校验，非法 → `tx.abort()` + `failed('invalid')` → `put(record, KEY)` → 按 `legacy` 写或删或不动裸键 → `oncomplete` → `ok(record|null)`；`onerror`/异常 → `failed('aborted')`。
5. 模块内加 `writeChain` 串行链包住整个 RMW（保证本页并发调用的「开库 → 建事务」顺序稳定）；用注释说明为什么还要依赖事务内读（跨标签页仍以事务串行为准）。
6. 代码注释写明三点：为什么注册表要新键（CE-02）、为什么读必须四态（R2：`getRaw` 把存储故障折叠成 null，会误触发 legacy adoption）、为什么写必须事务内 RMW（R3：事务外构造记录会丢并发更新）。

**运行命令**

```bash
pnpm --filter @mindcanvas/react test -- handle-store
```

**预期结果**：原 15 个用例（`:133-237`）**全部保持通过**（它们的期望不得改）；新增 **14** 个注册表用例通过（R1×3、R2×5、R3×3、CR2-4C×1、mutate 抛错×1、回归×1）。

**停止点**：注册表读写独立可测；**不继续**接线 `directoryHost`。

---

### 4.3 P0-0-3 `isSameEntry?` 类型声明（`packages/react/src/edit/directoryTypes.ts`）

**改动**

```ts
export interface FsDirectoryHandle {
  // …既有字段不变…
  /**
   * 目录同一性比较（Chromium）。
   * 缺失或抛错时**必须**按「无法判定」处理（保守降级，不得按名称猜测）——
   * 见 docs/specs/2026-09-19-file-assets-contract-close/contract-delta.md CD-02。
   */
  isSameEntry?: (other: unknown) => Promise<boolean>;
}
```

**只加在目录句柄上**：`FsFileHandle`（`save.ts`）在 P0-0 无消费者，不加（避免无消费者改动）。

**运行命令**

```bash
pnpm --filter @mindcanvas/react typecheck
```

**预期结果**：类型检查通过（可选字段，不破坏既有替身与调用方）。

---

### 4.4 P0-0-4 `DirectoryWorkspaceHost` 接线

**产出签名**

```ts
class DirectoryWorkspaceHost {
  // 既有不变（签名与语义都不改）
  get mounted(): boolean;
  get name(): string | null;
  async pick(): Promise<FsDirectoryHandle | null>;
  async restore(): Promise<boolean>;
  async requestPermission(): Promise<boolean>;
  async detach(): Promise<void>;
  // 新增
  get scopeState(): ScopeState;
  get scopeId(): ScopeId | null;      // 未挂载或 browser → null
  get scopeEpoch(): number;
}
```

**单一路径原则（R5 前置约定）**

> **I-23** 工作区身份**只能**由一条私有解析路径产生：`resolveScopeForIdentity(handle)`。`restore()`、`pick()`、`requestPermission()` 三个入口**都必须经过它**；对同一个目录句柄，它们必须给出**同一个 `scopeId`**（或在无法证明时**都不给出持久身份**）。
>
> 现状依据：`requestPermission()` 在 `this.root === null` 时会从裸键句柄挂载（`directoryHost.ts:183-192`），是与 `restore()` 并列的**第二条重新挂载路径**。若只接线 `pick/restore/detach`，同一工作区可能经不同入口得到不同身份。

```ts
/**
 * 私有：由根句柄解析身份（三个入口共用；不写任何键，写键由调用方决定）。
 * ★G0 勘误：删除 `allowOverwriteCorrupt` 选项——`corrupt` 注册表对**所有入口**（含 `pick`）
 * 一致保守处理：不使用、不覆盖、不写入；显式「重建工作区记录」入口不在本包。
 */
private async resolveScopeForIdentity(
  root: FsDirectoryHandle,
): Promise<{ state: ScopeState; commit: LegacyHandleIntent; mutate: RegistryMutate }>;
```

**行为规定**（对应 `shared-contracts.md` §1.2.6）

| 路径 | 行为 |
|---|---|
| `resolveScopeForIdentity` | ① `readWorkspaceRegistry()`；② **`unavailable`** → `disk-session('registry-unavailable')`、`commit = 'unchanged'`、`mutate = () => 'unchanged'`（**绝不 legacy adoption、绝不写键**）；③ `empty` → 判定 `register`；④ `corrupt` → `disk-session('registry-corrupt')` + `unchanged`（**所有入口一致：不覆盖、不写入**——G0 勘误）；⑤ `ok` → 对条目逐个 `sameDirectory`（**事务外**），按 §「身份判定表」得 `reuse`/`register`/`degrade`/`refuse`；⑥ `mutate` **必须同步复核基线**（`reuse` 要求事务读仍含该 `scopeId`；`register` 要求 `entries` 的 `scopeId` 集合与基线逐字相同），不符则返回 `'conflict'`；⑦ `conflict` → 重新执行 ①–⑥，**最多 2 次**，仍冲突 → `disk-session('unassociated')` |
| `restore()` | 保持既有「只认 `granted`」的门槛（`directoryHost.ts:172-180`）。身份来自 `resolveScopeForIdentity(handle)`；**非 `granted` → 不挂载、返回 `false`**（不改）。`empty` 分支下 legacy adoption 的写失败 → `disk-session('registry-write-failed')`。`epoch++`、`return true` |
| `requestPermission()` | 保持既有行为（`this.root ?? getDirectoryHandle()`、`verifyPermission(handle,true,true)`、成功则挂载；`directoryHost.ts:183-192`）。**新增**：成功后若这次挂载**改变了 root**（此前 `root === null`），必须调用 `resolveScopeForIdentity(this.root)` 并按其结果设置 `scope`；若此前已挂载（`root` 未变）→ **不重新解析、不改 `scopeId`、不变 `epoch`**。本入口**永不**覆盖 `corrupt` 注册表 |
| `pick()` | 保持既有 picker 调用与 AbortError 容错（`directoryHost.ts:151-164`）。成功后调 `resolveScopeForIdentity(handle)`——**不再有覆盖损坏记录的例外**（用户选择文件夹 ≠ 授权覆盖损坏记录；G0 勘误）→ `evictEntries` → 执行 `mutate`/`commit` 的 `writeWorkspaceRegistry`。写失败 → `disk-session('registry-write-failed')`；但**目录仍可用** |
| `detach()` | 保持 `root=null`、`tree=null`；**注册表变更与裸键删除在同一事务**（R1）：`writeWorkspaceRegistry(markDormant, { kind:'delete' })`，其中 `markDormant` 对 `ok` 返回「active 条目转 `dormant` + `activeScopeId=null`（**不删条目**）」，对 `empty`/`corrupt`/`unavailable` 返回 `'unchanged'`。`scope = browser`、`epoch++`。**不再调用 `deleteDirectoryHandle()`**（避免两键分叉）；该函数作为公开 API 保持可用 |
| `epoch` | 挂载、断开、`scopeId` 变化时 +1（初值 0）。`requestPermission()` 在已挂载时**不变** |
| 初始态 | `scope = { kind:'browser', scopeId: BROWSER_SCOPE_ID, label:'浏览器素材库', epoch: 0, persisted: true }` |

**身份判定表（CR2-1 修正：明确不同 ≠ 无法判定）**

阶段 1（事务外比较）得到判定后，按下表执行；**不要把「注册表键存在但 `entries` 为空」当作身份不明**：

| 判定 | 条件 | P0-0 行为 | P1-A 之后 |
|---|---|---|---|
| `reuse(id)` | **恰好一个** `same` | 复用该 `scopeId`，该条目 `state='active'`、`lastSeenAt=now`、追加 `associations += isSameEntry`；其余转 `dormant`；同事务写裸键 | 不变 |
| `register` | 注册表 `empty`，**或** `ok` 且 `entries` 为空，**或** `ok` 且非空但**全部为 `different`** | **登记新身份**：新 `scopeId` + `via:'session-only'`、`state='active'`、旧条目全 `dormant`、`evictEntries`、**同事务写裸键** | 不变 |
| `degrade` | 无 `same` 且**存在 `unknown`**（`isSameEntry` 缺失/抛错） | `disk-session('unassociated')`；注册表与裸键**都不写** | P1-A 提供人工关联面板；用户确认后按 `via:'user-confirmed'` 写回 |
| `refuse` | **多个** `same`（理论上不应出现） | `disk-session('unassociated')`，提示「无法确定这个文件夹的身份」 | 同人工关联 |

**关键差别**：选择第二个目录 B 时，若 `isSameEntry` 能证明 B 与 A **明确不同** → 走 `register`，B 被**持久登记**（刷新后仍是 B，A 转 `dormant`）。只有**比较能力不可用**（`unknown`）时才降级为「本次不记住」。

**冲突与重试（CR2-4 的一半）**：阶段 2 的 `mutate` 必须复核基线（见 `shared-contracts.md` §1.2.9）。事务内读到 `conflict` → 重新执行阶段 1，最多 **2 次**；仍冲突 → 放弃登记，`disk-session('unassociated')` 并提示「工作区记录正在被其他窗口更新，本次未记住这个文件夹」。

> **口径纪律**：在 P1-A 落地人工关联之前，**不得声称恢复了旧工作区身份**。降级分支能承诺的只有「这次能用这个文件夹」+「本次不记住它」；UI 文案：『这个文件夹可能和以前的工作区是同一个，但当前无法自动确认；本次先不记住它。』
>
> **已知代价（收窄后）**：只有在**比较能力不可用**时才需要每次重选；能证明「全新」或「明确不同」的目录照常被记住。
>
> **`unassociated` 的副作用**：本轮不写裸键 ⇒ 刷新后 `restore()` 会回到**最后一次被登记（或证明）的**工作区。这是刻意的：宁可回到已知身份，也不留一个无法解释的裸键。**注意这与「注册表未被修改」是两件事**——降级分支既不写裸键也不写注册表，因此原有裸键句柄**仍然存在且可读**（见 §4.4 的测试修正 CR2-3）。

**先写的失败测试**（扩展 `packages/react/tests/directory-host.test.ts`）

```ts
/**
 * 测试脚手架（CR2-3：给出可落地的 helper 与权限初始化/复位规则，避免依赖未定义 helper）。
 *
 * 设计要点：
 * - `handleOf(name, sameEntry?)` 造目录句柄替身；**是否带 `isSameEntry` 由此决定**
 *   （这是区分 `different` 与 `unknown` 的唯一手段）。
 * - `sameByLabel(label)` 是 `isSameEntry` 的语义替身：按「对方句柄的 name」判断（**只用于测试**）。
 * - `patchPicker(h)` 让下一次 `window.showDirectoryPicker` 返回该句柄。
 * - 权限：改 `PERM.state` 即可（`handleOf` 的 `queryPermission`/`requestPermission` 实时读它）；
 *   **`beforeEach` 复位为 `granted`**。
 * - `reboot()` 丢弃当前 host 实例（保留 IDB），模拟页面刷新。
 * - 断言对象：**只断言可读目标**（句柄 `name`、注册表的 `activeScopeId` 与 `scopeId` 列表），
 *   **不对含函数/句柄的对象做 `JSON.stringify` 深比较**（CR2-3）。
 */
const PERM = { state: 'granted' as PermissionState };

function handleOf(name: string, sameEntry?: (other: unknown) => Promise<boolean>) {
  return {
    name,
    kind: 'directory' as const,
    getDirectoryHandle: async () => handleOf(name),
    queryPermission: async () => PERM.state,
    requestPermission: async () => PERM.state,
    ...(sameEntry ? { isSameEntry: sameEntry } : {}),
  } as unknown as FsDirectoryHandle;
}

/** `isSameEntry` 的语义替身：按「对方句柄的 name」判断（只用于测试，不代表生产逻辑） */
const sameByLabel = (label: string) => (other: unknown): Promise<boolean> =>
  Promise.resolve((other as { name?: string }).name === label);

let nextPicker: FsDirectoryHandle | null = null;
function patchPicker(h: FsDirectoryHandle | null): void {
  nextPicker = h;
  (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker = async () => nextPicker;
}

let host: DirectoryWorkspaceHost;
function reboot(): void {
  host = new DirectoryWorkspaceHost();          // 新实例，IDB 保留
}
beforeEach(() => {
  resetFixture();
  PERM.state = 'granted';                        // 权限复位
  nextPicker = null;
  reboot();
});

describe('工作区身份：注册表与同一性', () => {
  /** 经 picker 挂载（多数用例的入口） */
  const mountByPick = async (h: FsDirectoryHandle): Promise<void> => {
    patchPicker(h);
    await host.pick();
  };
  /** 读注册表中某个条目的状态 */
  const stateOf = (got: RegistryReadResult, scopeId: string | null): string | undefined =>
    got.kind === 'ok' && scopeId !== null
      ? got.record.entries.find((e) => e.scopeId === scopeId)?.state
      : undefined;

  it('同目录重新选择（isSameEntry 命中）→ 同一 scopeId', async () => {
    await mountByPick(handleOf('MyNotes', () => Promise.resolve(false)));
    const id1 = host.scopeId;
    reboot();                                                  // 新实例、保留 IDB
    await mountByPick(handleOf('MyNotes', sameByLabel('MyNotes')));  // 新句柄对象，但声称同一
    expect(host.scopeId).toBe(id1);
    expect(host.scopeState.kind).toBe('disk');
  });

  it('不同目录同名 → 不同 scopeId（名称不构成证据）', async () => {
    await mountByPick(handleOf('notes', () => Promise.resolve(false)));
    const id1 = host.scopeId;
    reboot();
    await mountByPick(handleOf('notes', () => Promise.resolve(false)));  // 同名但明确不同
    expect(host.scopeId).not.toBe(id1);
  });

  it('★CR2-1：A 登记后选择可证明不同的 B → **B 被持久登记**；刷新后仍是 B；再选 A 恢复原 ID', async () => {
    await mountByPick(handleOf('A', () => Promise.resolve(false)));      // empty → register
    const idA = host.scopeId;
    expect(host.scopeState).toMatchObject({ kind: 'disk', persisted: true });

    reboot();
    await mountByPick(handleOf('B', () => Promise.resolve(false)));      // 与 A 明确不同 → register
    const idB = host.scopeId;
    expect(idB).not.toBe(idA);
    expect(host.scopeState).toMatchObject({ kind: 'disk', persisted: true });   // ★ 不得降级

    const got = await readWorkspaceRegistry();
    expect(got.kind).toBe('ok');
    expect(got.kind === 'ok' && got.record.activeScopeId).toBe(idB);            // active = B
    expect(stateOf(got, idA)).toBe('dormant');                                   // A 转 dormant
    expect((await getDirectoryHandle())?.name).toBe('B');                        // 裸键 = B

    reboot();                                                                    // 刷新恢复
    expect(await host.restore()).toBe(true);
    expect(host.scopeId).toBe(idB);

    reboot();                                                                    // 再选 A
    await mountByPick(handleOf('A', sameByLabel('A')));
    expect(host.scopeId).toBe(idA);
    expect(host.scopeState).toMatchObject({ kind: 'disk' });
  });

  it('A→B→A：A 条目保持 dormant，回到 A 恢复原 scopeId', async () => {
    await mountByPick(handleOf('A', () => Promise.resolve(false)));
    const idA = host.scopeId;
    reboot();
    await mountByPick(handleOf('B', () => Promise.resolve(false)));
    expect(host.scopeId).not.toBe(idA);
    reboot();
    await mountByPick(handleOf('A', sameByLabel('A')));
    expect(host.scopeId).toBe(idA);
  });

  it('断开再连接 → 不删条目，重连恢复同一 scopeId', async () => {
    await mountByPick(handleOf('A', () => Promise.resolve(false)));
    const id = host.scopeId;
    await host.detach();
    expect(host.scopeState.kind).toBe('browser');
    await mountByPick(handleOf('A', sameByLabel('A')));
    expect(host.scopeId).toBe(id);
  });

  it('★CR2-3-a：注册表非空 + 无 isSameEntry → disk-session(unassociated)，注册表与**裸键保持原值**', async () => {
    await mountByPick(handleOf('A', () => Promise.resolve(false)));
    const idA = host.scopeId;
    const regBefore = await readWorkspaceRegistry();
    expect((await getDirectoryHandle())?.name).toBe('A');       // A 的裸键已存在

    reboot();
    await mountByPick(handleOf('NewFolder'));                   // 无 isSameEntry → 全部 unknown → degrade
    expect(host.scopeState).toMatchObject({ kind: 'disk-session', reason: 'unassociated' });
    expect(host.mounted).toBe(true);                            // 目录仍可用
    expect(host.scopeId).not.toBe(idA);                         // 不声称恢复旧身份

    const regAfter = await readWorkspaceRegistry();
    expect(regAfter.kind).toBe('ok');
    if (regBefore.kind !== 'ok' || regAfter.kind !== 'ok') throw new Error('unreachable');
    expect(regAfter.record.activeScopeId).toBe(regBefore.record.activeScopeId);
    expect(regAfter.record.entries.map((e) => e.scopeId))
      .toEqual(regBefore.record.entries.map((e) => e.scopeId));
    // ★ 关键修正：断言**可读目标**，而不是对象深比较；旧句柄仍在，不是 null
    expect((await getDirectoryHandle())?.name).toBe('A');
  });

  it('I-23：同一工作区经 restore 与 requestPermission 得到同一 scopeId', async () => {
    await mountByPick(handleOf('A', sameByLabel('A')));
    const id = host.scopeId;

    reboot();                                                   // 模拟刷新：新实例、root 空
    PERM.state = 'prompt';
    expect(await host.restore()).toBe(false);                   // prompt → 不挂载（既有语义）
    PERM.state = 'granted';                                     // 用户点「连接工作区」的手势
    expect(await host.requestPermission()).toBe(true);
    expect(host.scopeId).toBe(id);                              // 与 restore 同一条解析路径
  });

  it('I-23 负向：requestPermission 在已挂载时不改 scopeId、不变 epoch', async () => {
    await mountByPick(handleOf('A', () => Promise.resolve(false)));
    const id = host.scopeId;
    const ep = host.scopeEpoch;
    await host.requestPermission();
    expect(host.scopeId).toBe(id);
    expect(host.scopeEpoch).toBe(ep);
  });

  it('★CR2-3-b：只有注册表读取失败 + 裸键仍可读 → 冷启动可挂载但身份降级', async () => {
    await setDirectoryHandle(handleOf('Legacy'));
    reboot();
    fail.readKey = WORKSPACE_REGISTRY_KEY;                      // 只让注册表键读失败
    expect(await host.restore()).toBe(true);
    fail.readKey = null;
    expect(host.scopeState).toMatchObject({ kind: 'disk-session', reason: 'registry-unavailable' });
    expect((await readWorkspaceRegistry()).kind).toBe('empty');  // 未留下任何记录
    expect((await getDirectoryHandle())?.name).toBe('Legacy');   // 裸键未被改写
  });

  it('★CR2-3-c：整个存储不可读 → 冷启动无法恢复（restore=false，未挂载）', async () => {
    await setDirectoryHandle(handleOf('Legacy'));
    reboot();
    fail.open = true;
    expect(await host.restore()).toBe(false);
    fail.open = false;
    expect(host.mounted).toBe(false);
    expect(host.scopeState.kind).toBe('browser');
  });

  it('R2：picker 已给可用句柄 + 注册表读失败 → 会话挂载，不 legacy adoption、不写键', async () => {
    await setDirectoryHandle(handleOf('Legacy'));
    fail.readKey = WORKSPACE_REGISTRY_KEY;
    await mountByPick(handleOf('New'));
    fail.readKey = null;
    expect(host.scopeState).toMatchObject({ kind: 'disk-session', reason: 'registry-unavailable' });
    expect(host.mounted).toBe(true);
    expect((await readWorkspaceRegistry()).kind).toBe('empty');
    expect((await getDirectoryHandle())?.name).toBe('Legacy');   // 裸键未被改写
  });

  it('旧裸句柄（无注册表）→ legacy adoption 生成新 scopeId，旧读路径仍可用', async () => {
    await setDirectoryHandle(handleOf('Legacy'));
    expect(await host.restore()).toBe(true);
    expect(host.scopeId).toMatch(/^ws:/);
    expect((await readWorkspaceRegistry()).kind).toBe('ok');
  });

  it('注册表损坏 → disk-session(registry-corrupt)，不删除记录', async () => {
    memStore.set(WORKSPACE_REGISTRY_KEY, { not: 'a registry' });   // 直接写脏记录
    await setDirectoryHandle(handleOf('X'));
    expect(await host.restore()).toBe(true);
    expect(host.scopeState).toMatchObject({ kind: 'disk-session', reason: 'registry-corrupt' });
    expect((await readWorkspaceRegistry()).kind).toBe('corrupt');   // 仍在、未被改写
  });

  it('★G0：损坏库时 pick 与 restore 一致 —— 不覆盖损坏记录，仅本次会话可用', async () => {
    memStore.set(WORKSPACE_REGISTRY_KEY, { not: 'a registry' });   // 直接写脏记录
    await mountByPick(handleOf('X'));
    expect(host.scopeState).toMatchObject({ kind: 'disk-session', reason: 'registry-corrupt' });
    expect(host.mounted).toBe(true);                                 // 目录仍可用
    expect((await readWorkspaceRegistry()).kind).toBe('corrupt');    // 损坏记录未被改写
    expect(await getDirectoryHandle()).toBeNull();                   // 裸键也未被写入
  });

  it('注册表写入失败 → disk-session(registry-write-failed)，但目录仍可用', async () => {
    fail.writeAt = 1;                                              // 第 1 个写请求即失败
    await mountByPick(handleOf('A', () => Promise.resolve(false)));
    fail.writeAt = 0;
    expect(host.scopeState).toMatchObject({ kind: 'disk-session', reason: 'registry-write-failed' });
    expect(host.mounted).toBe(true);
  });

  it('R1：detach 把 active 置 dormant、不删条目，且同事务删除裸键', async () => {
    await mountByPick(handleOf('A', () => Promise.resolve(false)));
    expect(await getDirectoryHandle()).not.toBeNull();       // pick 已写裸键
    await host.detach();
    const got = await readWorkspaceRegistry();
    expect(got.kind === 'ok' && got.record.entries).toHaveLength(1);
    expect(got.kind === 'ok' && got.record.entries[0]?.state).toBe('dormant');
    expect(got.kind === 'ok' && got.record.activeScopeId).toBeNull();
    expect(await getDirectoryHandle()).toBeNull();            // 同事务一并删除
  });

  it('CR2-4：mutate 返回 conflict → 不写任何键，交调用方重解析', async () => {
    await mountByPick(handleOf('A', () => Promise.resolve(false)));
    const before = await readWorkspaceRegistry();
    const out = await writeWorkspaceRegistry(() => 'conflict', { kind: 'delete' });
    expect(out).toEqual({ kind: 'conflict' });
    expect((await getDirectoryHandle())?.name).toBe('A');      // 裸键未动
    const after = await readWorkspaceRegistry();
    expect(after.kind === 'ok' && after.record.entries.map((e) => e.scopeId))
      .toEqual(before.kind === 'ok' ? before.record.entries.map((e) => e.scopeId) : []);
  });

  it('CR2-4：两调用方从空注册表同时 pick 同一目录 → 不产生重复条目', async () => {
    // 两个独立的 directory-host 模块实例（各自 handleStore 副本 / 各自 writeChain），
    // 共用同一个夹具数据库 —— 对应真实世界的两个标签页。
    vi.resetModules();
    const M1 = await import('../src/edit/directory-host.js');
    vi.resetModules();
    const M2 = await import('../src/edit/directory-host.js');
    const h1 = new M1.DirectoryWorkspaceHost();
    const h2 = new M2.DirectoryWorkspaceHost();
    const dir = handleOf('MyNotes', sameByLabel('MyNotes'));

    await Promise.all([(patchPicker(dir), h1.pick()), (patchPicker(dir), h2.pick())]);

    const got = await readWorkspaceRegistry();
    expect(got.kind).toBe('ok');
    expect(got.kind === 'ok' && got.record.entries).toHaveLength(1);   // ★ 不重复登记
    expect(h1.scopeId).toBe(h2.scopeId);                              // 两方最终同一身份
  });
});
```

**最小实现步骤**

1. 引入 `workspaceScope.ts` 与 `handleStore` 的新导出。
2. 加私有 `scope: ScopeState` 与 `epochOf`/`bumpEpoch()`。
3. **先实现 `resolveScopeForIdentity(root)`**（返回 `{ state, mutate, commit }`，**不写任何键**），再让三个入口都消费它。这是 I-23 的落点，且必须实现 **I-25 两阶段协议**：
   - **阶段 1（事务外）**：读注册表 + 逐个 `sameDirectory` → 得 `reuse`/`register`/`degrade`/`refuse`（判定表见下）。**`sameDirectory` 绝不在事务内 await**。
   - **阶段 2（事务内）**：`mutate` 只做**同步**基线复核（`reuse` 要求仍含该 `scopeId`；`register` 要求 `entries` 的 `scopeId` 集合与基线逐字相同），不符 → 返回 `'conflict'`。
   - **冲突重试**：`conflict` → 重跑阶段 1，最多 2 次；仍冲突 → `disk-session('unassociated')`。
4. 按上表改写 `restore()` / `pick()` / `requestPermission()` / `detach()`；**保持**既有行为不变的部分：`restore` 只认 `granted`、`pick` 的 AbortError→null 与非 AbortError 不置 root、`requestPermission` 的 `verifyPermission(...,true,true)`、`this.tree = null` 的失效点。
5. `detach()` 改为 `writeWorkspaceRegistry(markDormant, { kind: 'delete' })`，**移除对 `deleteDirectoryHandle()` 的调用**（R1）。
6. 加三个访问器。
7. 注释写明四件事：`isSameEntry` 的唯一证据地位、为什么 `corrupt` 对**所有入口**都不自动改写（含 `pick`——G0 勘误）、为什么 `unavailable` 绝不能走 legacy adoption（会覆盖读不到的注册表）、为什么 `'workspace-root'` 必须是裸句柄。

**运行命令**

```bash
pnpm --filter @mindcanvas/react test -- directory-host
pnpm --filter @mindcanvas/react test -- handle-store
```

**预期结果**：既有 `directory-host.test.ts` 的 30+ 用例**全部保持通过**（`:186-220` 的能力探测、`:391-420` 的持久化组等期望不得改）；新增 18 个身份用例通过（含 CR2-1 的 B 登记与刷新、CR2-3 的三段 `unavailable`、CR2-4 的 conflict 与两调用方同目录、I-23 三入口一致、detach 原子性、G0 勘误的 pick-损坏一致性）。

**停止点**：宿主接线完成且两组测试绿；**不继续**改 `index.ts` 之外的任何文件。

---

### 4.5 P0-0-5 导出面（`packages/react/src/index.ts`）

**改动**：在既有 `./edit/handleStore.js` 与 `./edit/directoryHost.js` 的导出块附近，追加 `./edit/workspaceScope.js` 的值与类型再导出：

```ts
export {
  BROWSER_SCOPE_ID, REGISTRY_MAX_ENTRIES, REGISTRY_VERSION,
  evictEntries, isRegistryRecord, isScopeId, newScopeId, sameDirectory, upsertEntry,
} from './edit/workspaceScope.js';
export type {
  RegistryReadResult, ScopeId, ScopeState,
  WorkspaceRegistryEntry, WorkspaceRegistryRecord,
} from './edit/workspaceScope.js';
export {
  WORKSPACE_REGISTRY_KEY, readWorkspaceRegistry, writeWorkspaceRegistry,
} from './edit/handleStore.js';
export type {
  LegacyHandleIntent, RegistryMutate, RegistryWriteResult,
} from './edit/handleStore.js';
```

**运行命令**

```bash
pnpm --filter @mindcanvas/react typecheck
pnpm --filter @mindcanvas/react build
```

**预期结果**：类型检查与构建通过；`dist/index.d.ts` 含新导出（`tsc -p tsconfig.build.json`）。

**停止点**：导出面完成；**不继续**做 §5 门禁之外的任何改动。

---

### 4.6 P0-0-6 负控与门禁

见 §5 与 §6。

---

## 5. 阴性对照设计（NC-1…NC-7，共七条，必须按各自判定方式实际跑出「红」）

> **计数以行为为准，不以条数判通过**（第三轮复核校正：旧标题写「三条」，与最终集合不符）。下面每条都给出「中性化 / 保持不变的断言 / 判定方式 / 证明」，**转红一律以命令退出非零为准**。

**纪律**：普通边界测试（例如「不存在的键 → empty」）**不是**阴性对照。阴性对照必须能回答四个问题：中性化了哪块守卫、正确断言是否保持不变、预计哪条用例转红、**转红时命令是否真的退出非零**。**负控与正例必须使用同一份正确期望**；反例/中性化入口不得被默认 `test` 收集（见 NC-5 的三入口编排）。

### NC-1 注册表写回裸键（中性化「新键」守卫）

| 项 | 内容 |
|---|---|
| 中性化 | 把 `writeWorkspaceRegistry` 的目标键临时改成 `WORKSPACE_ROOT_KEY`，写入 `{ record }` 包装对象 |
| 保持不变的断言 | `getDirectoryHandle()` 仍应返回可用句柄（`handle-store.test.ts` 既有「set/get 往返」与新增「R3：RMW 往返」） |
| 预计转红 | `handle-store.test.ts`「R3：RMW 往返」中的 `expect(await getDirectoryHandle()).not.toBeNull()`（该用例前置写了裸键） |
| 证明 | 「把注册表记录放进旧键」确实会让旧读路径失效（CE-02） |

### NC-2 按目录名判定同一性（中性化 `isSameEntry` 守卫）

| 项 | 内容 |
|---|---|
| 中性化 | `sameDirectory()` 改为 `Promise.resolve(a.name === b.name ? 'same' : 'different')` |
| 保持不变的断言 | 其余断言（`isScopeId`、`isRegistryRecord`、`evictEntries`）不变 |
| 预计转红 | `directory-host.test.ts` 的「不同目录同名 → 不同 scopeId」与「关联不可证明（注册表非空 + 无 isSameEntry）→ disk-session(unassociated)」两条 |
| 证明 | 名称不是归属证据（I-13），且能力缺失时不得猜测 |

### NC-3 损坏记录按 `empty` 处理（中性化 corrupt 分支）

| 项 | 内容 |
|---|---|
| 中性化 | `readWorkspaceRegistry()` 把 `isRegistryRecord` 失败的结果返回 `{ kind: 'empty' }` |
| 保持不变的断言 | 挂载仍可用（`restore()` 返回 true）的断言不变 |
| 预计转红 | `handle-store.test.ts`「R2：结构非法 → corrupt，且不删除、不修复」；`directory-host.test.ts`「注册表损坏 → disk-session(registry-corrupt)，不删除记录」 |
| 证明 | 「损坏」与「不存在」是两种不同状态，不能合并；合并会导致覆盖用户数据（自动改写注册表） |

### NC-4 读取失败折叠成 `empty`（中性化 R2 的第三态）

| 项 | 内容 |
|---|---|
| 中性化 | `getRawResult()` 的 `req.onerror` 分支改为返回 `{ kind: 'empty' }`（即复用旧的「catch 后当空库」行为） |
| 保持不变的断言 | 正常路径下（`fail.*` 全为 false）所有用例的断言不变；挂载可用性断言不变 |
| 预计转红 | `handle-store.test.ts`「R2：IDB 打开失败 → unavailable」「R2：读取失败 → unavailable」「R2：unavailable 时 mutate 不执行、任何键都不写」；`directory-host.test.ts`「R2：注册表 unavailable → disk-session(registry-unavailable)」——后者还会因误触发 legacy adoption 而多留一条注册表记录 |
| 证明 | 存储故障 ≠ 空库；折叠会误触发 legacy adoption 并覆盖读不到的注册表（review 阻断项 2） |

### NC-5 并发保护：**三个入口，三种证据对象**（CR2-4 收口；第三轮复核修正执行编排）

**为什么旧版 NC-5 无效（复核实证）**：生产设计用 `writeChain` 包住整段读写，因此同页 `Promise.all` 的两次调用会被**串行**；即便把读取挪到事务外，第二次仍会读到第一次的结果 → 结果依然是 `['a','b','c']`，负控**不会转红**。复核方的最小调度反例（`nc5SchedulingCounterexample`：`writeChainRetained=true`、`transactionOutsideRead=true`、`result=['a','b','c']`）证明的正是这一点。因此**不能**用它来证明「事务内合并是必需的」。

**修订后的 NC-5 设计**：使用**两个独立的 production 模块实例**（`vi.resetModules()` + 动态 `import`），它们**共用同一个数据库**（夹具共享态挂在 `globalThis`）但**各自持有自己的 `writeChain`**——对应真实世界里的两个标签页。

#### ★第三轮修正：旧快照负控**不是**「中性化后转红」，而是**常态必红的调用方逻辑反例**

复核方从 v4 原文提取 NC-5 代码块实跑（`outputs/file-assets-contract-review-20260920-03/`，子进程真实退出码见 `results.json`）：

| 子进程 | 写入模型 | 实际记录 | 断言 / 退出码 |
|---|---|---|---|
| positive | 正常事务内 RMW | `a`、`b`、`c`；唯一 active = `c` | PASS / **0** |
| negative | **同一正常模型**，原文调用方预构造旧快照 | `a`、`c`；唯一 active = `c` | AssertionError / **1** |

两份记录**都通过**不变量检查；负控失败恰为缺失 `b`，不是非法记录、环境或导入失败。

**这说明**：`outOfTxAdd` 的调用方**无条件**用事务外旧快照构造 `next`、并让 `mutate` **忽略事务内最新 `prev`** —— 因此它**在正确实现下也必然丢一条**。它演示的是「**旧调用方写法本身会造成丢更新**」，**不是**「中性化某块守卫后保护消失」。把它放进正式套件并要求「正常时通过」是自相矛盾的（按原文实施会把一条必红用例带进默认门禁，无需实现有缺陷即可失败）。

#### 入口编排（P0-0 必须按此落地）

| # | 入口 | 载体 | 是否被默认 `test` 收集 | 预期结果 | 证据对象 |
|---|---|---|---|---|---|
| **1** | **并发回归（正式套件）** | `packages/react/tests/handle-store.test.ts` | **是**（`include: ['tests/**/*.test.{ts,tsx}']`） | **PASS，退出 0** | 生产 `handleStore` 的**正常调用方**行为 |
| **2** | **调用方旧快照逻辑反例** | `packages/react/tests/counterexamples/nc5-legacy-snapshot.counterexample.ts` | **否**（专用 config） | **AssertionError，退出非零** | **调用方逻辑**：保留旧接口写法会丢更新（**不接生产模块的中性化**，就是同一正常实现 + 旧调用方） |
| **3** | **生产实现中性化验证** | `packages/react/tests/counterexamples/nc5-neutralized-impl.counterexample.ts` + 隔离实现副本 | **否**（专用 config） | **AssertionError，退出非零**（对照组：正常副本退出 0） | **生产写路径**：只有把「事务内读 + 合并」挪走才会丢更新 |

**入口 2 与入口 3 的区别必须写进证据**：入口 2 用**正式实现** + **旧调用方**（展示旧写法之害）；入口 3 用**正式调用方** + **被中性化的实现副本**（证明事务内合并是保护来源）。两者都保留 `expectThreeUpdates` 原样。

**专用 config（新增文件，不进默认门禁）**：

```ts
// packages/react/vitest.counterexamples.config.ts
import { defineConfig } from 'vitest/config';

/** 反例/中性化入口：**仅**由 test:counterexamples 显式运行，绝不被默认 `vitest run` 收集 */
export default defineConfig({
  test: {
    include: ['tests/counterexamples/**/*.counterexample.ts'],
    environment: 'node',
    fileParallelism: false,
  },
});
```

```jsonc
// packages/react/package.json scripts（新增一条；`test` 保持 `vitest run` 不变）
"test:counterexamples": "vitest run --config vitest.counterexamples.config.ts"
```

**运行命令与判定**：

```bash
# 入口 1：正式门禁的一部分，必须 PASS 且退出 0
pnpm --filter @mindcanvas/react test -- handle-store

# 入口 2 + 3：显式运行，允许（并要求）非零退出；留 stdout/stderr 与真实退出码
pnpm --filter @mindcanvas/react test:counterexamples; echo "exit=$?"   # 期望 exit=1
```

**禁止事项（复核明确要求）**：不得用**反转断言**（`not.toEqual`）让反例「通过」；不得用 `it.fails` / `test.fails`；不得 `catch` 断言错误后打印 PASS；不得用宽泛 `skip` / `describe.skip` 把入口 2、3 藏起来；不得把父级收集程序的 exit 0 当成反例退出 0（**必须记录子进程/命令本身的退出码**）。

**共用夹具**（放 `packages/react/tests/helpers/registryConcurrency.ts`，**非** `*.test.ts`，不被默认收集）：


```ts
// tests/helpers/registryConcurrency.ts —— 三个入口共用；非 *.test.ts，默认不被收集
import { expect, vi } from 'vitest';
import type { FsDirectoryHandle } from '../../src/edit/directoryTypes.js';
import type {
  WorkspaceRegistryRecord, WorkspaceRegistryEntry,
} from '../../src/edit/workspaceScope.js';   // ★ 类型都定义在 workspaceScope.ts（G0 勘误：去掉未使用的 RegistryReadResult；handleStore 只 import type——§4.2 ⚠）
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
  const gate = new Promise<void>((r) => { release = r; });
  return async (): Promise<void> => {
    arrived += 1;
    if (arrived === n) release();
    await gate;
  };
}

/** 合法条目骨架（新条目为 active） */
const entryOf = (id: string, seq: number): WorkspaceRegistryEntry => ({
  scopeId: id, handle: handleOf(id), label: id, lastSeenAt: seq,
  state: 'active' as const, associations: [{ at: seq, via: 'isSameEntry' as const }],
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
  expect(isRegistryRecord(rec)).toBe(true);                       // 记录必须满足全部不变量
  const actives = rec.entries.filter((e) => e.state === 'active');
  expect(actives).toHaveLength(1);
  expect(actives[0]?.scopeId).toBe(rec.activeScopeId);
  expect(rec.entries.filter((e) => e.state === 'dormant')).toHaveLength(2);
}

// ── 入口 1：正式套件（tests/handle-store.test.ts）——正确实现必须 PASS、退出 0 ──
//    import { emptyRec, expectThreeUpdates, legalAppend, loadTwoInstances, makeBarrier }
//      from './helpers/registryConcurrency.js';
it('★NC-5 并发回归：两个独立实例并发 RMW → 三条更新全部保留', async () => {
  const { A, B } = await loadTwoInstances();
  await A.writeWorkspaceRegistry(() => legalAppend(emptyRec(), 'ws:a', 1), { kind: 'unchanged' });

  const append = (id: string) => (prev: RegistryReadResult): WorkspaceRegistryRecord =>
    legalAppend(prev.kind === 'ok' ? prev.record : emptyRec(), id, 9);

  // ★G0 勘误：两实例并发也是受控交错（barrier 两侧同时放行）——与入口 3「完全相同调用方」
  // 和 §6.1「两实例 + 受控交错」口径一致；中性化对照才能保持「只变实现」的单一变量属性。
  const barrier = makeBarrier(2);
  const fire = (h: typeof A, id: string) =>
    (async () => {
      await barrier();
      return h.writeWorkspaceRegistry(append(id), { kind: 'unchanged' });
    })();
  const [r1, r2] = await Promise.all([fire(A, 'ws:b'), fire(B, 'ws:c')]);
  expect(r1).toMatchObject({ kind: 'ok' });      // ★ 两次都必须是 ok（不得是 invalid）
  expect(r2).toMatchObject({ kind: 'ok' });

  const got = await A.readWorkspaceRegistry();
  expect(got.kind).toBe('ok');
  if (got.kind !== 'ok') throw new Error('unreachable');
  expectThreeUpdates(got.record);
});

// ── 入口 2：调用方旧快照逻辑反例（tests/counterexamples/nc5-legacy-snapshot.counterexample.ts）──
//    import { emptyRec, expectThreeUpdates, legalAppend, loadTwoInstances, makeBarrier }
//      from '../helpers/registryConcurrency.js';
//    ★不接生产模块的中性化：这里用的是**同一正常实现** + **旧调用方写法**。
//    因此它在正确实现下**常态必红**（丢一条），只由 test:counterexamples 显式运行，
//    绝不进入默认 `vitest run`。保留 expectThreeUpdates 原样。
it('NC-5 反例：旧调用方用事务外旧快照构造 → 必然丢一条更新（常态 AssertionError）', async () => {
  const { A, B } = await loadTwoInstances();
  await A.writeWorkspaceRegistry(() => legalAppend(emptyRec(), 'ws:a', 1), { kind: 'unchanged' });

  const barrier = makeBarrier(2);
  /** 复刻旧接口语义：先在事务外读、构造好整份记录，再只做写入（mutate 忽略事务内最新 prev） */
  const outOfTxAdd = (h: typeof A) => async (id: string): Promise<void> => {
    const prev = await h.readWorkspaceRegistry();                        // ← 事务外读（旧快照）
    await barrier();                                                     // ← 受控交错：两侧都读完再写
    const next = legalAppend(prev.kind === 'ok' ? prev.record : emptyRec(), id, 9);
    await h.writeWorkspaceRegistry(() => next, { kind: 'unchanged' });    // ← 已构造好，只写
  };

  await Promise.all([outOfTxAdd(A)('ws:b'), outOfTxAdd(B)('ws:c')]);

  const got = await A.readWorkspaceRegistry();
  expect(got.kind).toBe('ok');
  if (got.kind !== 'ok') throw new Error('unreachable');
  expectThreeUpdates(got.record);      // ★ 与入口 1 **同一期望**：这里因缺 ws:b 而 AssertionError
});
```

> **★G0 勘误（入口 2/3 的夹具安装）**：`test:counterexamples` 在 node 环境运行，入口 2/3 的反例文件在 `loadTwoInstances()` 之前必须安装 §4.2 的 v3 内存 IDB 夹具（`installMemoryIndexedDB()` + `resetFixture()`；把安装/复位抽到反例文件可导入的位置或等价复制均可）。缺这一步会以 `indexedDB is not defined` 之类的**环境错误**收场——环境/导入错误**不算负控命中**（转红必须来自断言失败）。

**入口 3（生产实现中性化）的写法**：P0-0 实施时复制 `packages/react/src/edit/handleStore.ts` 为 `tests/counterexamples/handleStore.neutralized.ts`，**只**把「事务内读 + 在 `mutate` 内合并」改为「读取从事务内移到事务外」（其余逐字保留），再在 `nc5-neutralized-impl.counterexample.ts` 中用**与入口 1 完全相同的调用方**（两实例、各自 `writeChain`、barrier）与**完全相同的 `expectThreeUpdates`** 运行。

- 双跑：先对**未改动的实现**跑一次 → 必须 **PASS / 退出 0**；再对**中性化副本**跑一次 → 必须 **AssertionError / 退出非零**。两次输出与退出码分别留证。
- 副本与入口 3 属**一次性证据**：留证后从仓库移除（避免长期维护双份 `handleStore`），移除动作与理由写入 P0-0 回执；不得被默认 `test` 收集。
- 若实施者无法建立真实两实例的模块隔离，**如实标注该对照未做**，不得用单实例或同页 `Promise.all` 冒充（已被 `nc5SchedulingCounterexample` 证否）。

**三入口对照**：

| 项 | 入口 1（并发回归） | 入口 2（调用方逻辑反例） | 入口 3（生产中性化） |
|---|---|---|---|
| 实现在用哪份 | 生产 `handleStore` | 生产 `handleStore` | 正常副本 / 中性化副本 |
| 调用方 | 正常（事务内 `mutate` 合并） | **旧快照**（事务外读 + 预构造） | **正常**（与入口 1 逐字相同） |
| 断言 | `expectThreeUpdates` | `expectThreeUpdates`（原样） | `expectThreeUpdates`（原样） |
| 正确实现预期 | PASS / 0 | **FAIL / 非零**（旧写法之害，非缺陷证据） | 正常副本 PASS / 0；中性化副本 FAIL / 非零 |
| 是否进默认门禁 | **是** | 否 | 否 |
| 证明什么 | 事务内合并下两次并发更新都保留 | **旧接口写法本身会丢更新**（历史风险演示） | **事务内读 + 合并是保护来源** |
| 不能证明什么 | —— | 不能证明生产写路径受保护 | 不能替代产品/浏览器验证 |

**NC-5 的整体证明**：并发合并在**单实例 + 同页**下可被 `writeChain` 遮蔽，因此必须用**两实例 + 受控交错**才能证明「事务内读」是必需的（CR2-4）；而证明的对象必须分清是**调用方**还是**实现**。

### NC-6 「明确不同」并入「无法判定」（中性化 CR2-1 的判定分叉）

| 项 | 内容 |
|---|---|
| 中性化 | 身份判定表中删掉 `register` 的「全部 `different`」分支，使「没有 `same`」一律走 `degrade`（即把 `different` 与 `unknown` 合并） |
| 保持不变的断言 | 同目录重新选择、A→B→A、断开重连、`detach` 原子性的断言不变 |
| 预计转红 | `directory-host.test.ts`「★CR2-1：A 登记后选择可证明不同的 B → B 被持久登记；刷新后仍是 B；再选 A 恢复原 ID」——B 会停在 `unassociated`，`activeScopeId` 仍为 A，裸键仍为 A |
| 证明 | 「明确不同」不是「无法判定」；合并会让**第二个工作区永远无法持久登记**（CR2-1） |

### NC-7 `mutate` 必须同步返回（I-25 的可落地形态）

**口径校正（CR2-4 次要项）**：原 NC-7 用「`mutate` 内 `await Promise.resolve()`」来代表「事务内等待外部 Promise」，并据此断言 `put` 会落在夹具结算之后。**这个推理不成立**：单个微任务与真实 IDB 事务何时关闭**没有普遍对应关系**，由自制夹具的时序**外推浏览器行为**是过度推断。

改为两部分，**分别标注证据对象**：

**（a）契约测试（确定性强，可落地）** —— `mutate` 的返回类型是同步值，不接受 Promise：

```ts
it('CR2-4C：mutate 返回 Promise（非同步记录）→ 拒绝写入，不落任何键', async () => {
  await writeWorkspaceRegistry(() => rec(['ws:old']), { kind: 'write', handle: dirHandle('OLD') });
  const out = await writeWorkspaceRegistry(
    // 故意返回一个 Promise：类型上非法，运行期必须被当作「非法记录」拒绝
    (() => Promise.resolve(rec(['ws:new']))) as unknown as RegistryMutate,
    { kind: 'delete' },
  );
  expect(out).toEqual({ kind: 'failed', reason: 'invalid' });
  expect((await getDirectoryHandle())?.name).toBe('OLD');       // 裸键未动
  const got = await readWorkspaceRegistry();
  expect(got.kind === 'ok' && got.record.entries.map((e) => e.scopeId)).toEqual(['ws:old']);
});
```

| 项 | 内容 |
|---|---|
| 中性化 | 让实现接受 Promise（例如 `await mutate(prev)`）并按其 resolve 值写入 |
| 保持不变的断言 | 上面这条用例的**三处期望全部不变**（`failed('invalid')`、裸键仍为 `OLD`、注册表仍是 `ws:old`） |
| 判定方式 | 正确实现：用例通过（Promise 被 `isRegistryRecord` 判为非记录 → `invalid`）。中性化后：写入成功 → 三处断言失败、**退出非零** |
| 证明 | I-25 的「同步判定」在实现层有可判定的边界：**非同步返回值一律拒绝**（CR2-4 / I-25） |

**（b）事务生命周期（需真实环境校准，本包不宣称已证）** —— 「在活跃事务里等待不受控 Promise 会导致事务自动提交 / `TransactionInactiveError`」这一行为**必须**在 `fake-indexeddb` 或真实浏览器上用**跨任务延迟**（`setTimeout`、`await new Promise(r => setTimeout(r, 0))` 等，而不是单个微任务）单独验证并记录；**不得**用自制夹具的时序推断浏览器行为，也不得把本项的结论写成已验证。

---

## 6. 门禁安排与需复跑的既有用例

### 6.1 本包必须实际运行的命令与预期

| # | 命令 | 预期 | 说明 |
|---|---|---|---|
| G-1 | `pnpm --filter @mindcanvas/react test -- workspace-scope` | 9/9 通过 | 纯函数层（含 ★CR2-4A 不变量用例） |
| G-2 | `pnpm --filter @mindcanvas/react test -- handle-store` | 既有 15 + 新增 14 全通过 | 含 NC-1、NC-3、NC-4、**NC-5（两实例 + 受控交错）**、**NC-7(a)** |
| G-3 | `pnpm --filter @mindcanvas/react test -- directory-host` | 既有 30+ + 新增 18 全通过 | 含 NC-2、NC-4、**NC-6**、**CR2-1/CR2-3/CR2-4 用例**、**G0 勘误的 pick-损坏一致性** |
| G-4 | `pnpm --filter @mindcanvas/react typecheck` | exit 0 | `tsc -b tsconfig.json`（含 tests） |
| G-5 | `pnpm --filter @mindcanvas/react build` | exit 0 | 确认导出面可发布 |
| G-6 | `pnpm --filter @mindcanvas/react test` | 全包通过 | 改动落在 `edit/**`，全包回归成本低 |
| G-7 | `pnpm exec depcruise packages/react --config .dependency-cruiser.js` | exit 0，无新增 error/warn | **重点看 `no-orphans`**：新模块必须被 `index.ts` 或 `directoryHost.ts` 引用 |
| G-8 | `pnpm lint` | exit 0 | Biome |
| G-9 | `pnpm budget` | exit 0 | `scripts/check-code-budget.mjs`（真实存在） |
| G-10 | `pnpm gate:fast` | exit 0 | `typecheck + depcruise + lint + budget`（根脚本） |
| G-11 | `pnpm gate` | exit 0 | 全仓 `test` 一并跑；**这是唯一能覆盖 `apps/canvas` 的方式** |

**明确不做的引用方式**：不得以「20260919-03 的 2489 全绿」代替 G-6/G-11；历史结论只能作为基线参考（`baseline.md` §4.4）。

### 6.2 按影响面需要复跑的既有用例

**影响面判定**：P0-0 改了 `handleStore`（新增键与单事务 RMW 写路径）、`directoryHost`（`pick`/`restore`/`requestPermission`/`detach` **四条**路径与三个访问器）、`directoryTypes`（可选字段）、`index.ts`（导出面）。因此：

| 影响面 | 需复跑 | 原因 |
|---|---|---|
| 直接构造 `DirectoryWorkspaceHost` 的测试 | `packages/react/tests/directory-host.test.ts`、`document-host.test.ts`、`doc-library.test.ts`、`save-handle.test.ts`、`handle-store.test.ts` | 三条路径新增 IDB 读写与 scope 状态 |
| `apps/canvas` 中走真实 host 的保存/离开链 | `save-destination.test.tsx`、`save-lifecycle.test.tsx`、`mode-guard.test.tsx`、`useDocumentActions.test.tsx`、`useAutoSave.test.tsx`、`unsaved-transition.test.tsx`、`leave-entry-matrix.test.tsx`、`note-back-leave.test.tsx`、`free-canvas-leave.test.tsx`、`free-canvas-save-lifecycle.test.tsx`、`startup-doc-switch.test.tsx` | 虽然这些用例多用 `WorkspaceLike` 替身（不走真实 host），但 `MindmapStage` 会构造真实 `DirectoryWorkspaceHost` 并调用 `restore()`；`restore()` 现在会读 IDB → 必须确认 jsdom 下无未处理拒绝 |
| 文件面板 | `file-manager-tree.test.tsx`、`file-manager-dialogs.test.tsx`、`no-native-dialogs.test.ts` | 面板用 `WorkspaceLike` 替身，理论上不受影响；复跑用于确认 |
| 类型与依赖 | `pnpm typecheck`（全仓）、`pnpm depcruise` | `index.ts` 导出面变化 |

**jsdom 无 `crypto.randomUUID` 时的处理**：`packages/react/vitest.config.ts` 的默认环境是 `node`（`:7`）；jsdom 测试文件里 `crypto.randomUUID` 在 Node ≥ 19 的 jsdom 环境可用，但**实现不得依赖**这一点——`newScopeId` 的 uuid 源由调用方注入，实现里用 `globalThis.crypto?.randomUUID?.() ?? fallback`（fallback 用 `Date.now().toString(36) + Math.random().toString(36).slice(2)`）。这条必须写进实现注释，并在 G-3 的用例里覆盖一次「uuid 源不可用仍能生成合法 scopeId」。

### 6.3 集成门禁安排

| 阶段 | 命令 | 阻断条件 |
|---|---|---|
| 任务级（每个 §4 任务后） | 该任务的 `--filter` 测试 + `typecheck` | 红则停 |
| 包级（接线完成后） | `pnpm gate:fast` | 红则停 |
| 包级最终 | `pnpm gate` | 红则停；**这是本包唯一的全仓证据** |
| 负控 | §5 的 **NC-1…NC-7**，各自跑一次并保留输出与**真实退出码** | 若负控**没有**转红（退出 0），说明断言无判别力 → 必须重做断言；反例/中性化入口单独运行，不进默认门禁 |

---

## 7. 交接给 P0-D / P0-A / P0-B 的事项

| 事项 | 消费者 | 注意 |
|---|---|---|
| `scopeId` 作为索引主键前缀（`'ws:<uuid>::<relPath>'`） | P0-D | P0-0 只提供 `scopeId`，不定义索引键格式 |
| `disk-session` 期间写入的索引条目必须标 `ephemeral` | P0-D | 适用于 `registry-write-failed` / `registry-corrupt` / `registry-unavailable` / `unassociated` **四种** reason |
| 被淘汰的 dormant 作用域 → 其索引条目进历史池 | P0-D | 注册表上限是常量（`REGISTRY_MAX_ENTRIES`） |
| `SaveDestination.scopeId` | P0-A | 直接取 `directoryHost.scopeId`；注意 `scopeId` 为 `null`（browser）或 `disk-session` 时不得写入持久索引 |
| 上传的 scope/epoch 捕获 | P0-B | 取 `scopeId` + `scopeEpoch`；`isCurrent` 由 apps 侧薄包装实现 |
| **「人工关联工作区」面板（P1-A 必须补）** | P1-A | P0-0 **只**保守降级为 `disk-session('unassociated')` 并保留注册表条目；在此之前**不得声称恢复了旧工作区身份**。P1-A 需提供：列出注册表条目（`readWorkspaceRegistry` 已够读）、用户确认后按 `via:'user-confirmed'` 写回。**这是一项明确的欠账，不是可选优化** |
| **`requestPermission()` 的身份一致性（I-23）** | P1-A 及后续所有入口 | 任何新增的「重新挂载工作区」入口都必须经 `resolveScopeForIdentity`，否则会出现同一目录两个身份 |

---

## 8. 停止点

- 完成 §4 六个任务并使 §6.1 的 G-1…G-11 全部实际通过、§5 的 **NC-1…NC-7** 全部按各自「判定方式」实际转红后，**停止**。注意：**负控的期望与正例相同**（不得用错误结果当通过条件），转红的判据是命令**退出非零**；**NC-5 必须按三入口分别运行并分别留证**（入口 1 进正式套件退出 0；入口 2、3 走 `test:counterexamples`，记录真实非零退出码；入口 3 的正常副本先跑一次 0）。
- 交付包回执（含：实际命令与输出摘要、每条负控的转红证据、未运行项、剩余限制）。
- **不自动进入 P0-D**；P0-D 需独立评审后另行派单。
- 若实施过程中发现本计划与 `shared-contracts.md` 冲突，**以契约文档为准并先回报**，不得就地改契约。
