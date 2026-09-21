# 共享契约：身份、数据流、状态机与接口草案（D0）

任务：FILE-ASSETS-DESIGN（初版）｜**本轮补正：FILE-ASSETS-CONTRACT-CLOSE（2026-09-19，见 `../2026-09-19-file-assets-contract-close/contract-delta.md`）**。

本文件是 D1（文件管理）与 D2（图库）共同依赖的底座。凡是两个模块都要用到的身份、作用域、结果类型、失败语义，一律先在这里定义一次，两个模块只做引用，不各自再造一套。

**格式纪律（贯穿本包）**：P0/P1 **不修改** `.mm.md` 与 `.mc.canvas.json` 的既有语法；新增能力一律落在宿主、索引层与 UI 层。任何需要在文档里新增字段或新增引用形态的想法，只在 P2 讨论，且必须满足「旧解析器忽略未知字段、往返不丢」的门槛。**本轮进一步收紧：P0/P1 也不得新增引用形态**（见 I-10）。

**本轮补正要点（相对初版）**：工作区身份改为显式注册表并确定单一方案（§1.2）、新增归属证据规则（§1.2/§1.6）、新增插入归一化（§1.4）、本地写入与可携带性分离（§1.7）、新增操作租约（§3.5）、迁移与回退按证据重写（§6）。凡与初版冲突处，以本文件为准。

---

## 1. 身份模型

### 1.1 七类概念的区分

工作区文档的 `MindDoc.id = 相对路径`，写盘能力来自 `MindDoc.handle`（`MindmapStage.tsx:821,824`）。设计把它们显式拆开：

| 概念 | 定义 | 生命周期 | 现状锚点 |
|---|---|---|---|
| 逻辑文档身份 | 用户心里「这一篇文档」 | 跨会话，应能跟随改名/移动 | 无独立表示；用 `MindDoc.id`（= 路径）近似 |
| 一次编辑会话 | 从 `applyDoc` 到下一次 `applyDoc`/卸载 | 与会话令牌同生共死 | `DocumentSaveSession.token`（`useDocumentSaveSession.ts:65-66`） |
| 内容版本 | 内容的不可变身份 | 每次编辑产生新值 | `controller.root`（不可变引用，`useAutoSave.ts:59`）；已落盘快照 `savedSource` |
| 保存目的地 | 下一次写入应该落到哪里 | 随会话推进，可被另存为/改名/移动重绑 | `session.destination`（私有字段，`:72`；仅存句柄） |
| 句柄对象 | 浏览器授予的 I/O 能力 | 可失效、可被重新授予；**对象变化不代表文件变化** | `FsFileHandle`（`save.ts:34`） |
| 显示名 | 界面上给人看的名 | 与文件名、文档内部标题三者可分 | `MindDoc.name` / `WorkspaceFile.name` |
| 路径 | 作用域内的相对位置 | 外部改名即可变化，且本应用无法收到通知 | `WorkspaceFile.path`（`directoryTypes.ts:44-55`） |

**核心不变量**：

> **I-1** 同一个文件取得新句柄，不因为它成为另一个文件。
> **I-2** 两个同名文件位于不同目录（或不同工作区），不能因为显示名相同被视为同一个。

现状两条都不成立：没有血统表示，路径既是主键又是显示名，句柄只被当作 I/O 句柄使用。

### 1.2 工作区身份（本轮定案）

#### 1.2.1 结论：显式注册表，单一键、单事务

初版给出过两种候选（把 `{handle, scopeId, schemaVersion}` 存进同一键；或另立 `workspace-root-scope` 存 `{scopeId, schemaVersion}`）。**本轮选定第三种、也是二者的收敛形态：在既有 IDB store 中新增一个「工作区注册表」记录键，并把旧裸句柄键原样保留。**

弃用前两种的理由：
- 「包装对象写进 `'workspace-root'`」会破坏向下兼容——旧代码的 `getDirectoryHandle()` 用 `isDirectoryHandle()`（`handleStore.ts:39-45`）判形状，包装对象没有 `getDirectoryHandle` → 返回 `null` → 旧版本静默失去工作区。
- 「`workspace-root-scope` 独立键」只能表达**一个**工作区，无法支持 A→B→A；且两个键可以各自成功/失败，产生半更新状态。

#### 1.2.2 记录结构与键

存储沿用 `mindcanvas-handles` / store `handles`（`handleStore.ts:17-18`）：

```ts
/** 兼容键：保持裸句柄语义，永不写入包装对象 */
export const WORKSPACE_ROOT_KEY = 'workspace-root';           // 既有，不改用途
/** 新增：工作区注册表（单键、单记录、原子读写） */
export const WORKSPACE_REGISTRY_KEY = 'workspace-registry.v1';

type ScopeId = string;                                        // 'ws:<uuid>'

interface WorkspaceRegistryRecord {
  v: 1;                                                       // 记录版本；未知 v 视为损坏
  activeScopeId: ScopeId | null;
  entries: WorkspaceRegistryEntry[];                          // 上限 8，超出按 lastSeenAt 淘汰 dormant
}

interface WorkspaceRegistryEntry {
  scopeId: ScopeId;
  /** 目录句柄（结构化克隆；与裸句柄同 store 不同键，互不干扰） */
  handle: FsDirectoryHandle;
  /** 目录名。**仅用于显示**，不是身份证据 */
  label: string;
  lastSeenAt: number;
  state: 'active' | 'dormant';
  /** 该 scopeId 的成立证据（可审计；见 1.2.4） */
  associations: Array<{ at: number; via: 'isSameEntry' | 'user-confirmed' | 'session-only' }>;
}
```

#### 1.2.3 读写事务

**读四态（不得把存储故障折叠成空库）**：

> **I-24** `readWorkspaceRegistry()` 必须区分四种结果：`ok`（键存在且合法）/ `empty`（键**不存在**）/ `corrupt`（键存在但结构非法或 `v` 未知）/ `unavailable`（IDB 打开失败或读取失败）。**只有 `empty` 才允许触发 legacy adoption**；把 `unavailable` 当作 `empty` 会覆盖一个读不到的注册表。

依据：既有 `getRaw()`（`handleStore.ts:62-73`）在 `catch` 后返回 `null`，与「键不存在」不可分辨；注册表路径**不得**复用该原语。

**写：单事务 read-modify-write**

- 一次 `readwrite` 事务内依次完成：① `get` 注册表键并判定四态；② 读失败 → 中止，不执行任何变更；③ 在**事务内**调用变更函数计算新记录；④ 校验新记录合法（不合法则中止，**拒绝写入**）；⑤ `put` 注册表键（除非本次声明「不改注册表」）；⑥ 按同一事务处置 `WORKSPACE_ROOT_KEY` 裸句柄（写入 / 删除 / 不动）。
- **不接受**「调用方在事务外构造完整记录再写入」的接口：那会在并发下丢失更新。
- 两键同事务提交，**不可能出现注册表与裸键分叉**——这同时覆盖 `detach()` 的「注册表转 dormant + 删裸键」，二者必须一次提交。

**失败**：读失败 → `failed('unavailable')`；事务 abort → `failed('aborted')`；新记录非法 → `failed('invalid')`。任一种都意味着**两个键都不变**。本次仅内存生效，scopeId 标记 `persisted: false`（见 1.2.5）。

**不变量（校验器必须全部强制，缺一条即无效）**：

1. `v === 1`；`entries` 是数组；
2. 每条 `scopeId` 满足 `isScopeId`，且**记录内唯一**；
3. **条件化的 active 约束**（第三轮复核校正）：`activeScopeId !== null` 时，`state === 'active'` 的条目**恰好一个**，且其 `scopeId === activeScopeId`；`activeScopeId === null` 时，**没有任何** active 条目；
4. `label` / `lastSeenAt` / `associations` 存在（形状合法即可）。

> **为什么必须条件化（而不是把「active 恰好一个」写成无条件）**：空库（`{v:1, activeScopeId:null, entries:[]}`）与 `detach()` 之后（`activeScopeId=null` + 条目全 `dormant`）都是**合法状态**；若要求「无条件恰好一个 active」，这两类状态会被自己判为非法，`detach` 与首次挂载都无法落盘。

写入前校验，**任一条不满足 → 按 `'invalid'` 拒绝写入**（`tx.abort()` + `failed('invalid')`）。

> **不得退化为「只检查 `activeScopeId` 能否命中某条 entries」**：那样会让「两个 active 条目」或「`activeScopeId=null` 但仍有一条 active」这类记录被写入，进而使后续读取按损坏处理——而且会让并发/失败用例**在到达被测窗口之前**就以 `invalid` 结束，测不到真正想测的行为（CR2-4A 的成因）。

#### 1.2.4 同一目录的识别：证据规则

> **I-13（归属证据规则）** 下述任一**都不构成**「这是同一个目录/同一个文件」的证据：
> ① 目录名或显示路径字符串相同；② 对象引用相等（跨刷新必然不成立）；③ 在当前目录里恰好存在同名项。
>
> **允许的证据只有两类**：① `isSameEntry` 能力的成功返回；② 用户在明确询问下作出的显式确认。

- **首选** `handle.isSameEntry(other)`（Chromium 提供；需在 `directoryTypes.ts` 的 `FsDirectoryHandle`/`FsFileHandle` 上补可选声明）。
- **会话内快速路径**：注册表刚返回的同一对象引用可直接命中，但只用于省一次 `await`，不作为跨会话证据。
- **能力缺失或比较抛错** → **保守降级**：不自动合并；进入「人工关联」一次性面板（列出已知工作区：目录名 + 上次使用时间 + 条目数），用户选择：
  - 「就是这个工作区」→ 复用该 `scopeId`，并向 `associations` 追加 `{ via: 'user-confirmed' }`；
  - 「这是另一个文件夹」→ 生成新 `scopeId`；
  - 关闭面板不选择 → 本会话用 `session-only` 作用域（`persisted: false`），不写注册表绑定。

#### 1.2.5 运行期形态

```ts
type ScopeState =
  | { kind: 'disk'; scopeId: ScopeId; label: string; epoch: number; persisted: true }
  | { kind: 'disk-session'; scopeId: ScopeId; label: string; epoch: number; persisted: false;
      reason: 'registry-write-failed' | 'registry-corrupt' | 'registry-unavailable' | 'unassociated' }
  | { kind: 'browser'; scopeId: 'browser:local'; label: '浏览器素材库'; epoch: number; persisted: true };
```

`persisted: false` 的语义：**scopeId 不跨刷新**。因此索引层写入的条目必须带 `ephemeral: true`；下次会话这些条目的 `scopeId` 视为无效，进历史池（§6.2 的未知归属规则），**不自动绑定**。

> **术语消歧（本轮）**：`ScopeState.persisted` 说的是「**工作区身份**能否跨会话保持」，与资产的**可携带性**（I-12）是两件不同的事。资产侧的 `persisted` 术语已在本轮**删除**（见 §4.5.1 与 CD-08）；全文凡出现 `persisted` 均指工作区身份。

`label` 仅用于显示（`'disk'` = 目录名）；任何逻辑判断不得依赖它。

#### 1.2.6 场景的规定行为（T1 检查点）

**单一路径原则**：

> **I-23** 工作区身份**只能**由一条解析路径产生（`DirectoryWorkspaceHost` 的私有 `resolveScopeForIdentity(root)`）。`restore()`、`pick()`、`requestPermission()` 三个入口**都必须经过它**；对同一个目录句柄，它们必须给出**同一个 `scopeId`**，或在无法证明时**都不给出持久身份**。
>
> 依据：`requestPermission()` 在 `root === null` 时会从裸键句柄挂载（`directoryHost.ts:183-192`），是与 `restore()` 并列的第二条重新挂载路径。只接线 `pick/restore/detach` 会让同一工作区经不同入口得到不同身份。

| 场景 | 规定行为 |
|---|---|
| 刷新恢复（`restore()`） | 经 `resolveScopeForIdentity` → `ok` 且 `activeScopeId` 条目有效 → **复用同一 `scopeId`**；权限仅 `granted` 才挂载（保留 `handleStore.ts:188-190` 与 `directoryHost.ts:172-180` 的既有语义） |
| 权限补请求（`requestPermission()`） | 保持既有行为（`root ?? getDirectoryHandle()`；`verifyPermission(handle,true,true)`）。**新增**：仅当本次**改变了 root**（此前未挂载）才调用 `resolveScopeForIdentity`；此前已挂载 → 不重新解析、不改 `scopeId`、不变 `epoch`。本入口**永不**覆盖损坏注册表 |
| 同目录重新选择（`pick()` 又选了同一目录） | 对新句柄逐个条目试 `isSameEntry` → 命中唯一 → 复用该 `scopeId`，用新句柄替换该条目并把 `state` 置 active |
| A→B→A | 切换到 B 时 A 条目保留为 `dormant`（**不删**）；回到 A 时经 `isSameEntry` 命中 → 恢复 A 的 `scopeId`，其索引/收藏按原作用域命中 |
| 断开再连接（`detach()` 后再连同一目录） | `detach` **在单事务内**把 active 置为 `dormant` 并删除 `WORKSPACE_ROOT_KEY` 裸键，**不删注册表条目**；再连接经 `isSameEntry` 恢复同一 `scopeId` |
| 新目录（注册表为空，首次连接） | 生成新 `scopeId`，追加条目，active 指向它；同时写裸键（这次必须记住） |
| **全新目录**（注册表 `empty`，或 `ok` 但 `entries` 为空，且可证明与任何已有条目都不同） | **登记新身份**：生成新 `scopeId` + `via:'session-only'`，`state='active'`，旧条目全部 `dormant`，并写裸键（见 §1.2.9 判定表）。<br>**注意**：「注册表键存在但 `entries` 为空」是**合法空库**，不是「身份不明」，不得送入会话降级 |
| **明确不同**（`ok` 且非空，逐条比较**全部为 `different`**） | 同「全新目录」：**登记新身份**（这是正常选择第二个工作区 B 的路径，必须持久化，否则刷新会回到 A） |
| **无法判定**（存在 `unknown` 且无 `same`；或提交前状态已变） | **保守降级为 `disk-session('unassociated')`**：目录可用，但注册表与裸键**都不写**（保留旧条目）。**不得**声称恢复了旧工作区身份。人工关联由 P1-A 提供（见 §1.2.8） |
| **多个 `same`**（理论上不应出现） | **明确拒绝**：不合并、不登记；降级为 `disk-session('unassociated')` 并如实提示「无法确定这个文件夹的身份」 |
| 旧裸句柄（注册表 `empty`） | **legacy adoption**：用裸键句柄建注册表，生成**新** `scopeId`（无法得知历史身份），`associations: [{ via: 'session-only' }]`；不因此改写任何既有索引条目 |
| 损坏记录（`corrupt`） | **不使用、不删除、不自动改写**；本次为 `disk-session('registry-corrupt')`；UI 说明「这次的工作区标识无法保存」。**所有入口（含 `pick()`）一律不覆盖损坏记录**；显式「重建工作区记录」入口不在 P0-0（G0 勘误：与 CD-05「不自动改写」对齐） |
| **读取/存储不可用（`unavailable`）** | **不 legacy adoption、不写任何键**；本次为 `disk-session('registry-unavailable')`。理由：读不到注册表时无法判断它是否存在，写入会覆盖真实数据（I-24） |
| 写入失败（隐私模式/配额） | 本次仍可挂载使用；`persisted:false`；UI **不得**承诺「下次自动恢复工作区身份」 |

#### 1.2.8 人工关联的分期（避免两种行为并存）

`isSameEntry` 缺失或比较失败时，**最终目标**是进入人工关联（用户显式确认后复用 `scopeId`，`via: 'user-confirmed'`）。但人工关联需要 UI，**不在 P0-0**。因此分期如下：

| 阶段 | 行为 |
|---|---|
| P0-0 | **仅在无法判定时**保守降级为 `disk-session('unassociated')`：目录可用、身份不持久、注册表与裸键都不写。**不得声称恢复了旧工作区身份**。能判定为「全新目录」或「明确不同」时，按 §1.2.9 正常登记（**不进入**降级） |
| P1-A | 提供「人工关联」面板：列出注册表条目（`readWorkspaceRegistry` 已够读），用户确认后按 `via:'user-confirmed'` 写回，此后该目录获得稳定 `scopeId` |

**已知代价（收窄后）**：只有在**比较能力不可用**（存在 `unknown`）时才需要每次重选文件夹。能证明「全新」或「明确不同」的目录照常被记住——这是 CR2-1 修复的关键差别：**「明确不同」不是「无法判定」**。

#### 1.2.9 身份解析的两阶段协议（事务边界与并发）

**硬约束**：`sameDirectory()` 依赖 `handle.isSameEntry()`，是**不受控的外部 Promise**；而 IDB 事务在微任务队列清空且无挂起请求时会**自动提交**。因此：

> **I-25** **不得**在 IDB 活跃事务中 `await` `sameDirectory()` 或任何非 IDB 的外部 Promise。身份解析必须分两阶段：**阶段 1 在事务外比较**，**阶段 2 在事务内只做同步判定与写入**。

**阶段 1（事务外）**：`readWorkspaceRegistry()` → 对条目逐个 `sameDirectory` → 得到判定：

| 判定 | 条件 | 决策 |
|---|---|---|
| `reuse` | **恰好一个** `same` | 复用该 `scopeId` |
| `register` | `empty`，或 `ok` 且 `entries` 为空，或**全部为 `different`** | 登记新身份 |
| `degrade` | 无 `same` 且**存在 `unknown`** | `disk-session('unassociated')` |
| `refuse` | **多个** `same` | 拒绝合并，`disk-session('unassociated')` |

**阶段 2（单事务内）**：把阶段 1 的判定交给 `mutate`，并在事务内**复核判定是否仍然成立**（防止「事务内调用一个使用旧快照的闭包」）：

```ts
type RegistryMutationOutcome =
  | { kind: 'write'; record: WorkspaceRegistryRecord }
  | { kind: 'unchanged' }
  | { kind: 'conflict' };   // 事务读到的状态与阶段 1 的基线不一致 → 不写，交调用方重解析
```

复核规则（同步、可判定）：

| 阶段 1 判定 | 事务内要求 | 不满足时 |
|---|---|---|
| `reuse(id)` | 事务读 `ok` 且**含 `id`** | `conflict` |
| `register`（基线 `empty` / `entries` 空） | 事务读仍为 `empty`，或 `ok` 且 `entries` 仍为空 | `conflict`（说明另一调用方刚好登记了——不得重复登记） |
| `register`（基线为非空且全部 `different`） | 事务读的 `entries` 的 `scopeId` 集合与基线**逐字相同** | `conflict`（新出现的条目没能参与比较，不能判定它与本目录不同） |
| `degrade` / `refuse` | 不写注册表 | — |

**冲突处理（有界重试）**：`conflict` → 调用方**重新执行阶段 1**（重新比较），最多 **2 次**；仍冲突 → 放弃登记，降级为 `disk-session('unassociated')`，UI 提示「工作区记录正在被其他窗口更新，本次未记住这个文件夹」。

**两个调用方同时从空库识别同一目录**：双方阶段 1 都是 `register`（基线 `empty`）。先提交者写入条目；后者的阶段 2 会读到 `ok` 且 `entries` 非空 → 与基线（`empty`）不一致 → `conflict` → 重新执行阶段 1：此时基线是含 1 条目的 `ok`，对同目录 `sameDirectory` 得到**唯一 `same`** → `reuse`，**不产生重复条目**。若第二次比较得到 `different`（不同目录）→ 正常 `register`。这条规则同时覆盖了「不得用旧快照闭包冒充并发已解决」。

**登记（`register`）时的完整写入**：新 `scopeId` + `associations: [{ via: 'session-only' }]`、`state='active'`、旧条目全部 `dormant`、`lastSeenAt=now`，并**同事务**写裸键；超上限则 `evictEntries`。

#### 1.2.7 与初版承诺的收窄

初版承诺「首次挂载生成一次并写回，不因重新挂载而产生新 id」。本轮收窄为：

> **只保留一个注册表记录文件**（不是每个目录一份历史档案）。注册表内最多保留 8 个条目；超过后按 `lastSeenAt` 淘汰 `dormant` 条目。被淘汰的目录再次连接时**会得到新的 `scopeId`**，其索引条目进入历史池（不自动绑定）。
>
> 也就是说：**「任意重新挂载都保留身份」不成立**，成立的是「在注册表保留期内、且能用 `isSameEntry` 证明同一目录时保留身份」。

### 1.3 血统键（lineageId）

```ts
/** 由索引层维护；不写进文档 */
type LineageId = string;  // 'lf:<uuid>'
```

- 创建文档时生成；`renameFile` / `moveFile` 成功时由调用方**继承**（源与结果共享同一 `lineageId`）。
- 外部改名（本应用无法感知）→ `lineageId` 失配；只有通过「重新定位」显式继承时才重新绑定。
- **本轮补正**：外部改名场景下，「当前目录存在同名文件」**不是**归属证据（I-13）。重新定位必须由用户显式触发并确认；确认动作记入索引条目的 `relinkEvidence: { at, via: 'user-confirmed' }`。
- 归属：`apps/canvas` 索引层（§4.7）。

### 1.4 文档身份的三个层次（对外呈现口径）

| 层 | 内容 | 用途 |
|---|---|---|
| 逻辑身份 | `lineageId` + `scopeId` | 收藏、最近、上次打开位置的迁移依据 |
| 存储身份 | `scopeId` + `relPath` | 索引主键、保存目的地定位、资产作用域判定 |
| 显示身份 | `name`（末段）/ 面包屑路径 / 文档内部标题 | 只给人看，**任何逻辑判断不得只依赖它** |

文档内部标题与文件名**不自动同步**（见 `file-management.md` §3.3）。

### 1.5 资产身份

```ts
/** 资产在库内的稳定键（内存与索引层使用；不写进文档） */
type AssetKey = string;   // 'ws:<uuid>::assets/a.png' ｜ 'browser:local::assets/a.png'

interface AssetRef {                 // 文档里序列化出来的东西（现状已存在）
  kind: 'img' | 'draw';
  id: string;                        // 现状 = 'assets/a.png' 或 'builtin:<id>' 或 data: URL
}
```

| 概念 | 形态 | 是否持久身份 | 现状锚点 |
|---|---|---|---|
| 资产身份 | `AssetKey = (scopeId, relPath)` 或 `(browserScope, id)` | 是（**库内**主键） | 现状只有 `id`（`assetTypes.ts:8-20`） |
| 存储归属 | `'workspace-assets' \| 'browser-idb' \| 'builtin'` | 是 | 现状无字段；只能靠 `item.svg`/id 形态猜 |
| 序列化引用 | `AssetRef.id` 字符串（相对工作区根 / `builtin:<id>` / data URL） | 是（文档事实） | `serializer.ts:137`；`SidePanels.tsx:39-41` |
| 临时 URL | `objectURL` / `data:`（仅内联形态时） | **否**；绝不能成为身份 | `idbAssetHost.ts:59,110-115`；`svgTint.ts:172` |

**不变量**：

> **I-3** `objectURL` 只出现在宿主返回值与渲染层 `src`，永不进入文档、索引主键或收藏键。
> **I-4** 磁盘资产引用字符串**相对工作区根**解析，与文档所在目录无关（`directoryHost.ts:385,398-409`）。不改成「相对文档目录」。
> **I-5** `builtin:*` 与 `data:` 是自包含引用，不属于任何工作区作用域，也不参与「磁盘资产」的引用影响计算。

#### 1.5.1 插入归一化（本轮新增，关闭「内存 scope 与旧引用字符串脱节」）

问题：文档里只写得下 `assets/a.png`。当浏览器素材库与当前工作区各有一张 `assets/a.png` 时，仅靠「在卡片上加 scope 徽章」无法保证插入与重开解析到同一张图。

> **I-10（插入归一化）** 写入文档的引用必须满足「文档重开后仍能被解析」；判据是该引用在**文档的解析基准**下能唯一确定到一个存储位置。按优先级：
> 1. **工作区归一**（当前已挂载工作区）：把所选资产写入 `<workspace>/assets/`，文档引用该文件。跨存储时（浏览器素材库 → 磁盘）先复制字节再引用。文件名冲突见 §4.5 的同名策略；**已存在同名但无法证明字节相同 → 分配不冲突的新名**（不覆盖、不影响其他文档的引用）。
> 2. **自包含**（未挂载工作区，且资产是可净化的小 SVG）→ 内联 `data:`。
> 3. **拒绝**（未挂载工作区且不满足 2）→ 不插入，提示「先打开一个文件夹作为工作区」。**不得**写入任何新形态引用（例如 `browser:<id>`），因为那会扩展文档语法且重开必失效。

由此得到的**唯一解析规则**（取代初版含糊的回落分支）：

| 文档中的 `id` | 解析 |
|---|---|
| `data:` | 自包含，直接渲染 |
| `builtin:<id>` | 命中内置图标表；未命中 → `unresolved('missing')` |
| `assets/<relPath>` | 相对**当前挂载工作区根**解析；未挂载 → `unresolved('no-scope')`，文案「这份文档的图片保存在它的工作区 `assets/` 里，请先打开对应文件夹」 |
| 其他（含 `http(s):`、`../` 等外链形态） | `unresolved('external')`，标注「外部引用，不纳入图库管理」；**不产生** `W-ASSET-MISSING`，移动/复制文档时也不改写 |

> **I-11** `unresolved('no-scope')` 与 `unresolved('missing')` 必须区分：前者是「没打开工作区」，后者是「工作区里没有这个文件」。把两者混为一谈会让用户去错误地「重新定位」一个其实完好的引用。

**副作用（必须接受）**：浏览器素材库的定位从「可直接引用的素材源」变为**来源与暂存区**；未挂载工作区时，除小 SVG 内联外不能插入图片。这是把「单文件文档里必然断图的引用」从存在变成不存在的代价。

### 1.6 引用索引的覆盖范围与可信度

现状只有「当前文档 + 当前清单」的一维比对（`assetDiagnostics.ts:15-30`），无法回答「还有谁引用这张图」。

```ts
type RefCoverage =
  | 'current-doc'     // 只扫了当前文档
  | 'open-docs'       // 扫了当前打开的全部文档（本项目同时只有一个；保留该值以对齐历史表述）
  | 'known-docs'      // 扫了索引中已知且内容可得的文档
  | 'full-scan'       // 完整扫描过作用域内全部文档（含目录遍历成功）
  | 'unknown';        // 未扫描 / 扫描中断 / 作用域不可遍历

interface AssetRefReport {
  assetKey: AssetKey;
  coverage: RefCoverage;
  /** 仅当 coverage==='full-scan' 且扫描无错时为 true */
  complete: boolean;
  matches: Array<{ docKey: string; count: number }>;
  /** 扫描期间发生的错误（不可遍历目录、读取失败等） */
  gaps: Array<{ docKey: string; reason: string }>;
}
```

**枚举纪律（本轮统一）**：全包（设计文档、验收、拆包、实现计划）只使用以上五个字面量，不得出现「仅当前文档」「已扫描」等同义口语值。UI 文案可以口语化，但代码与文档枚举必须一致。

> **I-6** `coverage !== 'full-scan' || !complete` 时，UI 必须显示「引用范围未知」，**不得**显示「无引用」。
> **I-7** 首期（P0/P1）**不做任何自动垃圾回收**。删除资产只接受用户的显式确认（用户决定 UD-4），并在确认文案里注明当前覆盖范围。

### 1.7 本地写入、持久性与可携带性（本轮新增）

初版把「磁盘写入成功」写成可代表「换机器还在」。本轮拆成三个正交维度，**禁止**互相冒充：

> **I-12** 「本次写入成功」「在本机持久存在」「可随文档携带」是三件不同的事，必须分别陈述：
> - **写入结果**：本次 I/O 是否成功（`written` / `session-only` / `failed`）。
> - **本机持久性**：`workspace-assets` 与 `browser-idb` 都是本机持久，但**浏览器可在存储压力下清理 IndexedDB**；清站点数据必失。
> - **可携带性**：只有 `workspace-assets`（且用户确实把整个文件夹拷走）与 `builtin`/`data:` 内联才是可携带的。

允许与禁止的文案：

| 场景 | 允许 | 禁止 |
|---|---|---|
| 磁盘 `assets/` 写入成功 | 「已保存到 `<工作区>/assets/<文件名>`；把整个文件夹拷走仍可用」 | 「已保存，换电脑也能用」（未拷文件夹时不成立） |
| 浏览器 IDB 写入成功 | 「已保存到这台机器的浏览器素材库」+ 「换浏览器或清理浏览器数据会丢失」 | 「已保存」（会被读成可携带）、「换机器还在」 |
| 仅会话可用 | 「可用，但**没有写入持久存储**，刷新后消失」 | 「已保存」 |
| `data:` 内联 | 「已作为文本写入文档，单文件拷走也能显示」 | 任何关于「图片文件已保存」的表述 |

---

## 2. 数据流

### 2.1 打开 / 保存 / 另存为 / 重开（目标形态）

```text
   ┌───────────── IDB mindcanvas-handles ─────────────┐
   │ 'workspace-root'          ← 裸句柄（兼容键）      │
   │ 'workspace-registry.v1'   ← 注册表（单键单事务）   │
   └───────────────────┬──────────────────────────────┘
                       │ scopeId + epoch（唯一来源：DirectoryWorkspaceHost）
                       ▼
   ┌──────────┐  打开   ┌────────────────────┐  替换   ┌──────────────────┐
   │ 文件面板 │ ──────► │ applyDoc/requestLeave│ ─────► │ 编辑会话（token） │
   └──────────┘         └────────────────────┘        └────────┬─────────┘
                                                              │ ② 写盘（经租约）
                              ┌───────────────────────────────▼──────────────────┐
                              │ SaveDestination（唯一事实源：scopeId+relPath+handle）│
                              │  - 另存为：显式换目的地                              │
                              │  - 改名/移动：rebindDestination（不推进 token）      │
                              └──────────────────────────────────────────────────┘
```

与现状的差异（其余全部沿用）：

1. `SaveDestination` 从「只有句柄」升级为「作用域 + 相对路径 + 句柄」，让「目的地是谁」可显示、可校验、可在改名后重绑。
2. `rebindDestination`：**不推进会话令牌**、不作废队列，只换目的地。
3. 索引层成为收藏/最近的唯一事实源，取代 `fullPath` 直接当键（`fileManagerShared.ts:115,133-146`）。
4. **新增**：所有会改变「当前文档写到哪里」的操作（改名/移动/删除/复制/归档）都必须先取得**操作租约**（§3.5），而不是只清一个 auto 定时器。

### 2.2 上传 / 插入 / 解析 / 导出（目标形态）

```text
上传：
  UI（面板四入口 / 画布 drop-paste）
    → apps/canvas 的 uploadToGallery
        ① 捕获 { scopeId, epoch, store }（写入前）
        ② host.uploadAssetDetailed(file, kind) → AssetWriteResult
        ③ 核对 epoch：未变 → 更新清单
                     已变 → **不更新当前清单**，但按 §4.5.4 记账（写入已发生）

插入（本轮新增的归一化步骤，见 I-10）：
  面板/画布 → normalizeForInsert(item, currentScope)
        ├─ 已挂载工作区 → 确保字节落在 <workspace>/assets/<name>（必要时分配新名）
        │                 → 文档引用 assets/<name>
        ├─ 未挂载 + 可净化小 SVG → data: URL
        └─ 其他 → 拒绝并说明
    → controller.updateNote（icon/media）或 addEntityChild（child）

解析（唯一规则见 §1.5.1）：
  渲染层 NodeG/nodeIcon 读 resolveAssetUrl → apps/canvas 适配器
      resolved(url) / pending(reason) / unresolved(reason)
  pending：骨架占位，**不回落 baseUrl**（关闭 R-15 的错图窗口）
  unresolved：断图占位（沿用 NodeG.tsx:166-196），按 reason 给出不同文案

导出：
  SVG 直出 / PNG（tainted 降级 SVG）  【现状不变，useExportActions.ts:41-75】
  新增：导出前如存在 unresolved 资产，提示「N 项资产缺失，导出结果将保留占位」
```

---

## 3. 状态机

### 3.1 保存会话（现状，不改）

```text
idle ──submit──► queued ──drain──► writing ──┬─► committed(saved/downloaded) ──► idle
                   │                          ├─► failed（不 commit，dirty 保持）
                   │                          └─► cancelled（用户取消，零状态变化）
                   ├─guard=false──────────► blocked（不入队、不闪 saving、零状态变化）
                   └─beginDocument─────────► stale（未开始任务整体结算）
```

锚点：`useDocumentSaveSession.ts:143,160-192,209-280`。**本包不修改该状态机**，只在其上加「换目的地」与「操作租约」两个旁路动作。

### 3.2 目的地重绑（新增，用于当前文档改名/移动）

```text
        ① 取操作租约（§3.5）——失败 → busy/refused，零副作用
                                ▼
        ② 前置：waitForIdle + 物理写静默（§3.5.3）
                                ▼
        ③ 前置：要求一次 saved && current（见 I-14）
                                ▼
  leased ──suppressPendingAuto()──► quiesced（停排新 auto；不清 dirty、不推进 token）
                                ▼
                          performing（host rename/move；编辑继续，写入被租约挡回 blocked）
             ┌──────────────────┼───────────────────┐
             ▼                  ▼                   ▼
        rebind(newHandle,   partial(目标已建、   failed（目的地与 token 不变）
        newRelPath)         源删除失败)
             │                  │                   │
             ▼                  ▼                   ▼
        resumed +           partial-success      resumed
        auto 重排            （用户三选，见 §3.3）  （提示可重试；不自动重试覆盖）
             │
             └─ release 租约 → 若 dirty 仍为真 → 立即重排一次 auto（写新目的地）
```

> **I-14（改名/移动当前文档的前置条件）** 必须先得到一次 `saved && current` 的落盘结果，否则拒绝并提示「先保存再改名/移动」。
>
> **证据等级说明（本轮纠正初版表述）**：初版把「dirty 时改名必然丢失内存内容」写成事实判断。**这未被实跑复现**，正确表述是：由代码路径可推导出一个**逻辑反例**（`renameFile` 读磁盘内容 → 新文件是旧快照；随后旧句柄指向已删除的旧文件），其成立依赖「dirty 且保存失败或未保存」这一具体时序。正式复现条件与观察点见 `../2026-09-19-file-assets-contract-close/counterexamples.md` CE-01。无论是否复现，前置条件本身都应存在，因为它是把「不确定是否丢内容」变成「不可能丢内容」的最省做法。
>
> 不允许用「静默先保存」替代显式确认：保存可能失败、可能弹选择器、可能触发权限请求。

**用户取消保存**（决策器返回 `false`）→ 停在 `ready`，释放租约，**不改目的地、不改路径、不重建索引**；面板保持原名。

### 3.3 文件操作（统一结果机）

```text
validate ──┬─► invalid(名字非法/目标非法/环) ──► 提示，零 I/O
           └─► ready ──► io ──┬─► ok(结果对象)
                              ├─► cancelled(用户在选择器/确认条取消) ──► 零副作用
                              ├─► permission-denied ──► 提示 + 重新授权入口
                              ├─► partial(见下) ──► 用户决定
                              └─► failed(code, retryable) ──► 提示 + 保留原状态
```

覆盖：新建、改名、移动、删除、复制、归档、重新定位。

#### 3.3.1 部分成功（复制成功、源删除失败）的完整规定

> **I-15** `partial` 不是失败，也不是成功。必须同时成立：① 新位置的文件存在且是**被写入的那一份**；② 原位置的文件**未被删除**；③ 用户能看到两份并作出选择。

| 决策 | 规定 |
|---|---|
| 当前目的地 | **新文件成为当前目的地**（用户的目标就是「把它放到那里」，且已成功写出）。旧文件标记为「待处理」，不参与会话写入 |
| 撤销新副本 | 若副本**已被继续编辑**（`dirty === true`）**或已被写入**（`savedAt > opStartedAt`）→ **拒绝直接删除**，必须让用户显式选择「放弃这些修改并删除副本」；否则只提供「保留两份」 |
| 重试删除源 | **删除前必须复查源文件是否被外部修改**：比对操作开始时记录的 `{ size, lastModified }` 快照；不一致 → 不删，转为「保留两份」并提示「原文件已被外部修改，未删除」 |
| 重试删除源 | **只删源，不重做复制**（不得再次 `createFile`，否则会覆盖副本内容） |
| 两份都在 | 树内标「重复」，提供「删除旧文件」显式入口；**不自动清理** |
| 稍后处理 | 进入面板底部「N 项待处理」，不自动重试 |

### 3.4 资产写入与解析（本轮重写）

```text
写入：
  capturing{scopeId,epoch,store} ──► writing ──┬─► written(store)         【仅表示本次本地写入成功】
                                              ├─► session-only(reason)   【明确告知"未写入持久存储"】
                                              └─► failed(code)           【不进入清单，可重试】
  epoch 变化：
    - 未提交任何写入 → 丢弃结果，无账可记
    - 写入已经发生   → 按 §4.5.4 记账（属于捕获时的 scopeId），当前清单不展示

解析：
  resolved(url)             ──► 正常渲染
  pending(reason)           ──► 骨架占位（不回落 baseUrl）
  unresolved('no-scope')    ──► 断图 + 「请先打开这份文档所在的工作区文件夹」
  unresolved('missing')     ──► 断图 + 「工作区里没有这个文件」+ 重新定位入口
  unresolved('external')    ──► 断图 + 「外部引用，不纳入图库管理」
  unresolved('unavailable') ──► 断图 + 「当前环境无法读取资产」
```

### 3.5 操作租约（本轮新增）

#### 3.5.1 为什么需要

现状的「取消 auto 定时器 + `waitForIdle()`」**不是文件操作互斥**：
- `useAutoSave` 的 300ms 定时器被清除后，**内容再变化会重新排定新的自动保存**（`useAutoSave.ts:69,112-113,121` 的 deps 含 `content`）；
- `waitForIdle()` 只等**当前会话**已开始的 I/O，被替换会话的物理写不在范围内（`useDocumentSaveSession.ts:146-157` 的既有语义边界）。

于是存在真实竞态：`waitForIdle → 新保存进入 → rename 复制旧快照 → 删源`。

#### 3.5.2 归属与取得时机

> **I-16** 「谁在动这份文档」的唯一事实源是 `DocumentSaveSession`（已有 token / queue / inFlight / idleWaiters），**不新造第二个锁对象**。租约是会话的一个状态位，与保存队列共用同一互斥域。

```ts
/** DocumentSaveSession 新增（语义为增量，不改既有方法） */
beginExclusiveOp(intent: FileOpIntent, target: { scopeId: ScopeId; relPath: string }):
  | { kind: 'granted'; leaseId: number; opSeq: number }
  | { kind: 'refused'; reason: 'busy-lease' | 'busy-physical' | 'session-replaced' };

endExclusiveOp(leaseId: number): void;         // 只有持有者可释放
rebindDestination(next: SaveDestination): void; // 只换目的地
getDestinationInfo(): SaveDestination;          // 供 UI 显示「保存到哪里」
```

- `intent`：`'rename' | 'move' | 'delete' | 'duplicate' | 'archive' | 'relink'`。
- **取得时机**：在**任何** `await` 之前、UI 校验通过之后立即取得；`pick`/`confirm` 类需要用户手势的步骤在取得租约**之前**完成（避免长占租约等待手势）。
- **租约期间 `submit` 一律 `blocked`**（不入队、不闪 saving、零状态变化）——包括 auto、manual、save-as。这条替换初版的「先清定时器再赌没有新保存」。
- `opSeq`：全局单调递增的操作代次，每次 `beginExclusiveOp` 成功 +1；用于每个 `await` 后的归属校验。

#### 3.5.3 物理写静默（关闭「逻辑 stale ≠ 物理已撤销」）

> **I-17** `waitForIdle()` 只覆盖**当前会话**。租约取得还必须满足「无跨会话物理写在跑」。

```ts
/** 跨会话计数：write 开始 +1，write 的 finally -1（不随 token 推进而归零） */
physicalWritesInFlight: number;
```

- `beginExclusiveOp` 在 `physicalWritesInFlight > 0` 时返回 `refused('busy-physical')`。
- UI 文案：「上一份写入还没有结束，请稍后重试（本次未做任何改动）。」
- **不无限期静默等待**：拒绝而不是等待，避免用户在无反馈中卡住；用户可重试。
- 这一条同时解释了为什么「逻辑 stale」不能被当作「物理已撤销」——stale 只保证回调不回填，不保证 I/O 已结束。

#### 3.5.4 编辑与写入的关系（推荐：保留编辑、延迟写出）

> **I-18** 租约期间**不冻结编辑**。理由：冻结输入需要新的 UI 状态与焦点管理，且会在 IME 组合、草稿提交路径上产生新的边界；而「写入被挡回 blocked」已有成熟通道与文案。

完整时序：

| 阶段 | 编辑 | 写入 | dirty |
|---|---|---|---|
| 取得租约前 | 正常 | 正常（auto/manual 均可） | 正常 |
| 租约期间 | 正常（内容变化 → `controller.root` 变化） | auto/manual/save-as 一律 `blocked`（有通知） | 保持/变为 dirty |
| 执行 host 操作 | 正常 | 无 | 可继续变 dirty |
| rebind 后 | 正常 | 释放租约 → 若 dirty 立即重排一次 auto（写新目的地） | 由该次保存的归属判据决定 |

**关键**：host 的 rename/move 复制的是**磁盘快照**（租约前那次成功落盘的内容）。因此 I-14 的前置条件不可省——否则新文件里的内容是旧的，而租约期间的编辑只能等到 rebind 后由 auto 写到新目的地（内容不会丢，但新文件在 rebind 前处于「旧内容」状态，用户若在此时关闭页面就会丢）。把「必须已 saved && current」作为硬前置，直接消除这个窗口。

受影响场景的明确结果：

| 场景 | 结果 |
|---|---|
| 租约内 Ctrl+S | `blocked` + `SAVE_BLOCKED_NOTICE`（不改任何状态）；释放后若 dirty 自动补一次 |
| 租约内另存为 | `blocked` + 同一文案；**不弹选择器**（保住 transient activation） |
| 租约内 IME 组合 / 未提交草稿 | 编辑继续，草稿留在输入框；host 操作不触碰输入框；rebind 后 auto 写入会包含已提交内容 |
| 租约内保存失败（若在取得租约前已发出） | 先等物理写静默，失败本身按既有 `failed` 处理（不清脏，提示可重试）；不因失败而继续 rename（前置条件未满足 → 拒绝操作） |
| `downloaded`（下载兜底，无句柄） | 不满足 `saved && current` 的持久条件 → 拒绝改名/移动，提示「先让它保存到磁盘」 |
| 内容在 host 操作期间又变 | rebind 后 auto 写新目的地；`current` 判据确保只有真正写出的快照才清脏 |
| 会话被替换（用户切文档） | 租约随会话作废；host 操作若已开始，其完成回调因 `opSeq`/`leaseId` 不匹配而**不回填任何状态** |

#### 3.5.5 释放与归属校验

> **I-19** 每个 `await` 之后必须重新校验：`leaseId` 仍是自己的、`sessionToken` 未变、`scopeId` 未变、`opSeq` 未变。任一项不符 → 停止后续步骤并**不写任何状态**。
>
> `finally` 中释放租约必须是**条件释放**：`if (session.leaseIdOf(op) === leaseId) session.endExclusiveOp(leaseId)`，否则会解开后续请求持有的租约。

### 3.6 目的地唯一事实源（本轮明确）

> **I-20** `SaveDestination` 只有**一个**存储位，`setDestination` / `getDestination` / `rebindDestination` / `getDestinationInfo` 全部读写同一字段；不得让「新方法与旧字段」各存一份。
>
> - 既有 `setDestination(handle)` 保留为**兼容写入口**：内部归一化为 `{ kind:'disk'|'browser'|'none', handle }` 后写入同一字段。既有 4 处调用点（`useDocumentActions.ts:201,264`、`useAutoSave.ts:89`、`useFreeCanvasDocument.ts:134`）行为不变。
> - `rebindDestination` 是唯一能同时更新「作用域 + 相对路径 + 句柄」的入口。
> - **不变量**：`getDestinationInfo()` 与 `getDestination()` 在任何时刻描述同一个目的地；`commit` 中先 `setDestination` 再 `setDoc` 的既有顺序不变。
> - 清脏判据不变：仅当会话令牌匹配且 `Object.is(readContent(), snapshot.content)` 时才 `markSaved()`（`useDocumentSaveSession.ts:243-262`）。写盘事实与附属元数据警告保持两分（`documentLifecycle.ts:28-31,120-130`）。

---

## 4. 接口草案

### 4.1 分层归属（先说谁负责，再说类型）

| 层 | 负责 | 不负责 |
|---|---|---|
| `packages/kernel` | 语法与序列化（**本包不改**） | 任何身份、作用域、I/O |
| `packages/react/chrome`（宿主） | 资产的读写与解析、面板与网格渲染、诊断产出、**资产结果类型与错误码** | 会话编排、作用域代次的生命周期、跨面板一致性 |
| `packages/react/edit`（目录原语） | 目录/文件的真实 I/O；**文件操作结果类型与错误码**；工作区身份与注册表（`handleStore`） | 文档会话、脏标记、索引 |
| `packages/react/render` | 用 `resolve` 适配器把引用渲染成图/占位 | 决定资产存哪、是否失效 |
| `apps/canvas`（编排） | 作用域消费、租约编排、离开决策、索引层、文件面板交互、插入归一化 | 直接操作文件系统（一律经 host） |

**公共结果类型的位置（本轮修正初版）**：初版把 `FileOpOutcome` 放在 `apps/canvas/src/fileOpTypes.ts`，同时要求 `packages/react` 产出它——这会造成包反向依赖应用。**修正**：文件操作结果类型落在 `packages/react/src/edit/fileOps.ts`，资产结果类型落在 `packages/react/src/chrome/assetHost.ts` 的同目录模块，均由 `packages/react/src/index.ts` 再导出（与既有 `./edit/directoryHost.js` 的导出方式一致，`index.ts:325-344`）。`apps/canvas` 经 `@mindcanvas/react` 消费。

补充理由：现状 depcruise **没有**任何规则禁止 `packages/react` → `apps/**`（`.dependency-cruiser.js:15-101`），所以正确性不能靠工具兜底；放在 `packages/react` 内部是唯一不会让已发布包（`files: ["dist"]`，`packages/react/package.json:15-18`）引用应用目录的做法。本包建议后续补一条 depcruise 规则作为加固（`baseline.md` DS-11）。

### 4.2 工作区作用域（由 `DirectoryWorkspaceHost` 拥有）

初版把作用域放在 apps 层并新增 `ScopeProvider`。**本轮修正**：工作区的四条生命周期路径本来就由 `DirectoryWorkspaceHost` 拥有（`pick`/`restore`/`requestPermission`/`detach`，`directoryHost.ts:151-199`），注册表也在 `handleStore`；把作用域再放到 apps 会产生两个 owner。

```ts
/** @mindcanvas/react，由 DirectoryWorkspaceHost 暴露 */
get scopeState(): ScopeState;        // §1.2.5；未挂载 → { kind:'browser', ... }
get scopeId(): ScopeId | null;       // 未挂载或 browser 情况为 null（browser 用常量）
get scopeEpoch(): number;            // 挂载/断开/scopeId 变化时 +1；requestPermission 在已挂载时不变
```

**入口一致性（I-23）**：`restore()` / `pick()` / `requestPermission()` 三条「可能改变 root」的路径必须共用同一私有解析方法 `resolveScopeForIdentity(root)`；不得各自实现一套判定（否则同一目录会出现两个身份）。`detach()` 不产生身份，只把当前身份置为 `browser`。

`apps/canvas` 侧把它适配成 `ScopeProvider`（薄包装，不持有状态）：

```ts
interface ScopeProvider {
  current(): WorkspaceScope;                       // 永不为 null
  isCurrent(scopeId: ScopeId, epoch: number): boolean;   // 迟到结果丢弃
}
```

### 4.3 保存目的地（apps/canvas 负责，唯一事实源）

```ts
type SaveDestination =
  | { kind: 'disk'; scopeId: ScopeId; relPath: string; name: string; handle: FsFileHandle }
  | { kind: 'browser'; docId: string }          // 兼容模式：句柄可后续补挂
  | { kind: 'none' };                            // 新建未保存 / 下载兜底

/** DocumentSaveSession 新增 */
rebindDestination(next: SaveDestination): void;
getDestinationInfo(): SaveDestination;
beginExclusiveOp(intent: FileOpIntent, target: { scopeId: ScopeId; relPath: string }): OpLeaseResult;
endExclusiveOp(leaseId: number): void;
```

兼容影响与唯一事实源纪律见 §3.6。

### 4.4 文件操作结果（`packages/react/src/edit` 负责产出）

```ts
type FileOpErrorCode =
  | 'E-PERMISSION' | 'E-NOT-FOUND' | 'E-EXISTS' | 'E-QUOTA'
  | 'E-UNAVAILABLE' | 'E-ABORT' | 'E-IO' | 'E-UNKNOWN';

interface FileOpError {
  code: FileOpErrorCode;
  /** 面向开发者的原始信息；UI 不得直接展示 */
  detail?: string;
  retryable: boolean;
}

type FileOpOutcome<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'cancelled'; stage: 'picker' | 'confirm' }
  | { kind: 'partial'; created: T; sourceRetained: true; error: FileOpError }
  | { kind: 'failed'; stage: 'read' | 'write' | 'delete' | 'permission'; error: FileOpError };
```

改动方式（**不破坏既有测试**）：现有 `renameFile/moveFile/removeFile/...` 保持签名不变（继续抛错），另加 `*Safe` 变体返回 `FileOpOutcome`；UI 一律调用 `*Safe`。`removeEntry?.` 的可选调用（`directoryHost.ts:326,334`）必须在 `*Safe` 内显式判定：能力缺失 → `E-UNAVAILABLE`，**不得再静默成功**。

### 4.5 资产写入与解析（`packages/react/chrome` 负责）

#### 4.5.1 结果类型（三轴分离）

```ts
type AssetStore = 'workspace-assets' | 'browser-idb' | 'builtin';

type AssetWriteResult =
  | { kind: 'written'; item: AssetItem; store: AssetStore; refId: string; bytes: number | null }
  | { kind: 'session-only'; item: AssetItem;
      reason: 'idb-failed' | 'fs-unavailable' | 'no-workspace' | 'declined' }
  | { kind: 'failed'; error: FileOpError };

/** 可携带性：由 store 决定，不由本次写入决定（I-12） */
type AssetPortability = 'folder-relative' | 'browser-local' | 'self-contained';

interface AssetHostV2 extends AssetHost {
  /** 与 uploadAsset 同实现，但结果可判别；uploadAsset 保留为薄包装（返回 .item） */
  uploadAssetDetailed?(file: File, kind?: 'img' | 'draw'): Promise<AssetWriteResult>;
  /** 显式解析状态；缺省时渲染层退回 resolveAsset 的字符串契约 */
  resolveAssetState?(item: Pick<AssetItem, 'kind' | 'id'>): AssetResolution;
  /** 作用域标记；用于把跨工作区串图变成可诊断事实 */
  scopeKey?(): string;
}

type AssetResolution =
  | { kind: 'resolved'; url: string }
  | { kind: 'pending'; reason: 'scope-loading' | 'listing' }
  | { kind: 'unresolved';
      reason: 'no-scope' | 'missing' | 'wrong-scope' | 'external' | 'unavailable' };
```

> 删除初版的 `persisted` 术语与 `AssetPersist = 'disk' | 'idb' | 'builtin' | 'session-only'`：它把「写到哪」与「多可靠」混成一个字段，并诱导出「`persisted` = 换机器还在」的错误陈述。

#### 4.5.2 同名策略（本轮收紧）

- **`size` + `lastModified` 只能做预筛选**（用于显示「可能相同」），**不得据此跳过上传或跳过写入**。
- 只有**实际字节比对**（或同一次会话内可靠的内容摘要）才能判定「相同」。
- **推荐最小方案：首期不做去重**。同名一律进入冲突三选：

```text
[ 保留两份 ]（默认焦点）  新文件存为 <base> 2.<ext>，现有文件与既有引用完全不变
[ 显式替换 ]             覆盖现有文件；已知引用处内容随之变化
[ 取消 ]                 不写入任何文件
```

- 允许的「同内容跳过」只有一种情形：本会话内已读过旧文件字节并与新字节逐字节相同 → 提示「该图片已存在，未重复写入」。**不得**用 `size`+`mtime` 代替该比对。
- 反例见 `../2026-09-19-file-assets-contract-close/counterexamples.md` CE-03（同名、同大小、同时间戳、不同字节）。

#### 4.5.3 同名同大小同时间戳不同字节的正确结果

> 用户的新内容必须保住，旧内容不得被静默替换。首期实现即上文三选（默认焦点「保留两份」）。

#### 4.5.4 写入已完成但作用域已切换（记账规则）

```ts
interface AssetIndexEntry {
  assetKey: AssetKey;
  scopeId: ScopeId;
  kind: 'img' | 'draw';
  name: string;
  relPath: string | null;
  store: AssetStore;
  portability: AssetPortability;
  bytes: number | null;
  lastSeenAt: number;
  /** 写入完成但未在当前作用域确认（epoch 已变）；下次该作用域挂载时由 listAssets 清除 */
  unconfirmed?: true;
}
```

规则：

1. 写入**已经发生**的资产必须记账，属于**捕获时**的 `scopeId`，标 `unconfirmed: true`。
2. 当前 UI 清单**不展示**它（避免串图），并写一条开发诊断。
3. 该作用域下次挂载时，`listAssets` 会重新发现该文件 → 清除 `unconfirmed`。
4. 用户可见文案（若在切换前看到）：「图片已写入「<原文件夹>/assets/」，但工作区已切换；切回后可在素材库看到。」
5. 丢弃 UI 回填**不是**撤销磁盘写入；不得据此认为文件不存在。

> 与之配套的不变量 **I-22**（「epoch 变化只允许丢弃 UI 回填，写入已发生就必须记账」）写在 `asset-library.md` §6.2，与本条是同一条契约的两面。

### 4.6 引用查询（apps/canvas 负责编排，react 提供纯函数）

```ts
interface AssetRefQuery {
  assetKey: AssetKey;
  /** 允许调用方降级：UI 先给 known-docs，用户点「完整检查引用」再升到 full-scan */
  requested: RefCoverage;      // 只使用 §1.6 的五个字面量
}
```

分层：扫描编排在 `apps/canvas`；「一段文本里出现哪些引用」的纯函数在 `packages/react`（复用 `assetRef.ts:20-43`）。

### 4.7 索引层（apps/canvas 负责）

```ts
interface DocIndexEntry {
  docKey: string;                 // 主键：'ws:<uuid>::研发/架构.mm.md' | 'browser::<docId>'
  scopeId: ScopeId;
  relPath: string | null;
  lineageId: LineageId;
  name: string;                   // 文件名（末段）
  title: string | null;           // 文档内部标题（首个 H1），与文件名分开
  openedAt: number | null;        // 打开历史；**旧条目无真实打开时间时为 null，不回填 mtime**（UD-2）
  savedAt: number;                // 最后成功落盘时间（仅展示，不参与「最近」排序）
  starred: boolean;
  sourceRef: { kind: 'disk-handle' | 'idb-handle' | 'none' };
  relinkEvidence?: { at: number; via: 'user-confirmed' };
  /** 作用域未持久化（disk-session）时写入的条目：下次会话其 scopeId 无效 */
  ephemeral?: true;
  /** 迁移来源键（只追加，不删除） */
  legacyKeys: string[];
}
```

- 「最近」只有一个入口，按 `openedAt` 降序；`openedAt === null` 的条目排在末尾并**不显示**为「刚刚/N 天前」，而显示「未记录打开时间」。
- 存储：沿用 `localStorage`，新键 `mindcanvas.docindex.v2` / `mindcanvas.assetindex.v2`。引用扫描命中表按需计算、不持久化。

---

## 5. 架构方案比较

三种方案围绕同一个问题：**「这个资产/这份文档到底属于谁」如何被表示，以及外部改名/复制后还能不能识别。**

### 方案 A：路径加作用域的最小修补

- 做法：不做新身份。磁盘资产 id 保持 `assets/<name>`，只把宿主的 URL 缓存键从 `relPath` 改成 `scopeId + relPath`；改名/移动后由 UI 重新 `scan` 并靠路径重算一切。
- 兼容成本：**最低**。不动索引、不动格式、不动接口签名。
- 外部改名/复制可识别程度：**低**。
- 无工作区场景：不受影响（浏览器情形本就只有一个作用域）。
- 迁移风险：**最低**（无迁移）。
- 缺口：解决不了 I-1/I-2/I-13（归属证据），也解决不了「引用范围未知」与「上传三态」。

### 方案 B：显式作用域 / 稳定索引 + 兼容引用（推荐）

- 做法：§1–§4 的完整契约。序列化引用**保持现状字符串**，身份升级只发生在**内存与索引层**。
- 兼容成本：中。
- 外部改名/复制可识别程度：**中**（本应用内完整；外部经显式重新定位；跨工作区按各自作用域解析不串）。
- 无工作区场景：覆盖，但**收窄**为「只能内联小 SVG 或拒绝插入」（I-10）；浏览器素材库退为来源/暂存区。
- 迁移风险：中（幂等、可回退、需维持降级投影）。
- **本轮对 B 的收窄**：工作区身份不是任意稳定，而是「注册表保留期 + `isSameEntry` 可证明」内稳定（§1.2.7）；可携带性不再由 `persisted` 代言（I-12）。

### 方案 C：自包含项目包

- 做法：文档 + `assets/` + manifest 打成可搬走的项目目录/压缩包。
- 兼容成本：**高**；迁移风险：**高**；与现有单文件契约、`downloaded ≠ saved` 纪律冲突。
- 结论：作为 **P2 的可携带性目标**，不作为 P0/P1 底座。

### 比较表

| 维度 | A 最小修补 | **B 显式作用域 + 索引（推荐）** | C 自包含项目包 |
|---|---|---|---|
| 兼容成本 | 最低 | 中 | 高 |
| 本应用内改名/移动识别 | 无 | 完整（血统继承） | 完整 |
| 外部改名识别 | 无 | 显式重新定位（用户确认） | 完整（包内） |
| 跨工作区同名隔离 | 部分（仅缓存键） | 完整 | 完整 |
| 无工作区场景 | 可用但语义含糊 | **受限**：内联小 SVG 或拒绝插入 | 需新概念 |
| 迁移风险 | 无 | 中（幂等 + 降级投影） | 高 |
| 可验证性 | 高 | 高 | 中 |
| 覆盖不变量 | 仅 I-3/I-4 部分 | 全部 | 全部 |
| 是否需改文档格式 | 否 | **否**（P0/P1） | 是 |
| 是否需外部服务 | 否 | 否 | 否 |

**推荐：方案 B**，并采纳 A 的两个低成本动作作为 B 的第一步（缓存键作用域化、`epoch` 迟到丢弃）。

理由摘要：
1. 现有相对路径引用 + 小 SVG 内联已提供「文件夹拷走仍离线可读」的能力（`workspaceAssetHost.ts:8-13`），改格式会破坏这项既有价值。
2. 现有编排层（保存会话令牌、离开决策器、宿主注入）已具备承载显式作用域与租约的扩展点，B 是在其上做加法。
3. 任务书 §4 要求「优先评估 B，允许证据支持更小方案；不得预设必须重写全部格式或引入数据库服务」——B 满足。
4. 浏览器无法提供 inode 级真实身份，B 用「血统键 + 显式重新定位 + 保守降级」把这一限制变成**可解释的 UI 事实**（I-13）。

### 浏览器文件身份的能力与边界

- 可获得：`FileSystemFileHandle`、`FileSystemDirectoryHandle`、`name`、`lastModified`、`size`、`getFile()`，以及 `isSameEntry`（Chromium 系；**jsdom 替身与部分实现可能没有**）。
- **不可获得**：inode/文件 id；跨刷新后「同一路径是否同一文件」只能靠重新读取 + 内容比对推断。
- `open:` / `save:` 是 DELIVERY-CLOSE 的**固定场景替身标识**，不能当作生产设计（`docs/dispatch/2026-09-19-delivery-close-final-acceptance.md:51`）。
- 因此身份策略是：**作用域内相对路径做主键 + 血统键做迁移依据 + 内容比对做辅助**；对 `isSameEntry` 缺失/失败一律保守降级，绝不宣称能自动判定真实同一文件（I-13）。

---

## 6. 存储能力与迁移

### 6.1 现状存储盘点

| 介质 | 键/库 | 内容 | 锚点 |
|---|---|---|---|
| IndexedDB | `mindcanvas-handles` / `handles` | `'workspace-root'` 裸目录句柄；文件句柄以 docId 为键 | `handleStore.ts:17,81-151` |
| IndexedDB | `mindcanvas-assets` / `assets` | 资产 meta + 二进制 + 小 SVG 源码 | `idbAssetHost.ts:19-20,23-35` |
| localStorage | `mindcanvas.library.v1` | 文档库元数据（含最近 8 条的 source） | `docLibrary.ts:17,25,315-319` |
| localStorage | `mindcanvas.folders.v1` | 自定义空目录 | `docLibrary.ts:18,168-185` |
| localStorage | `mindcanvas.canvas.recent.v1` | 自由画布最近 | `canvasDocHost.ts:27` |
| localStorage | `mindcanvas.starred.v1` | 文件收藏（键 = `fullPath`） | `fileManagerShared.ts:115` |
| localStorage | `mindcanvas.assets.fav` | 资产收藏（键 = `kind:id`） | `AssetPanel.tsx:71` |
| localStorage | `mindcanvas.docs.v1`（旧） | 旧文档库，已有迁移 | `document.ts:78,172-209` |
| 磁盘 | `<workspace>/assets/` | 真实资产文件 | `directoryHost.ts:46,375-386` |

### 6.2 迁移表（本轮按证据重写）

**原则**：惰性优先、幂等、可续跑、保留原数据、**证据不足不绑定**。

| # | 旧表示 | 识别条件 | 新表示 | 迁移方式 | 失败续跑 | 幂等 |
|---|---|---|---|---|---|---|
| M1 | 文档内 `@img:assets/a.png` / `note.icon: assets/a.svg` | `id` 以 `assets/` 开头 | 不变（引用字符串保持） | **不迁移**；解析按 I-10/§1.5.1 | — | — |
| M2 | `note.icon: data:image/svg+xml;...` | `isDataUrl`（`svgTint.ts:184`） | 不变 | 不迁移 | — | — |
| M3 | `builtin:<id>` | id 前缀 | 不变 | 不迁移 | — | — |
| M4 | IDB 资产键 `assets/<name>` | 记录 id 以 `assets/` 开头 | `browser:local::assets/<name>` | **惰性**：`listAssets` 读出时在索引层补 `scopeId`，**不改 IDB 记录** | IDB 打不开 → 跳过 | 是 |
| M5 | `mindcanvas.library.v1` 条目 | 键存在 | `DocIndexEntry` | **分批惰性**：每条独立判定；**只有具备 §6.2.1 证据的才绑定 `scopeId`/`relPath`**，否则进历史池 | 逐条 try/catch；失败条目留在旧库并标「未迁移」 | 是（按 `docKey` upsert） |
| M6 | `mindcanvas.starred.v1`（键 = `fullPath`） | 键存在 | `DocIndexEntry.starred` | **只有**该键能按 `docKey` 精确命中索引条目时才迁移；否则进历史池（`legacyKeys`） | 不命中不算失败 | 是 |
| M7 | `mindcanvas.assets.fav`（键 = `kind:id`） | 键存在 | `AssetIndexEntry` 收藏标记 | `browser:local` 项可直接迁移（作用域唯一）；磁盘项需 `(scopeId, relPath)` **且该作用域当前已证明同一目录** | 资产缺失 → 保留为 `legacyKeys` | 是 |
| M8 | `mindcanvas.canvas.recent.v1` | 键存在 | `DocIndexEntry`（`scopeId='browser:local'`） | 惰性读取并入索引；**不改写该键** | 单条损坏跳过 | 是 |
| M9 | `mindcanvas-handles` 中键为旧 `docId` 的裸文件句柄 | 新键未命中、旧键命中 | `file-handle.v1:<docKey>` 富记录 + 保留旧裸键 | **双读 + 双写**：读新键优先，未命中读旧键；命中后**同时**写新键（富记录）与旧键（裸句柄），使回退版本仍可用 | 写新键失败 → 本次仍用旧键 | 是 |
| M10 | 目录 `assets/` 与文档引用不一致 | 解析 `unresolved('missing')` | 不变 | 不自动修复；提供「重新定位」（D2 §5） | — | — |
| M11 | **本轮新增**：注册表缺失但有 `'workspace-root'` 裸句柄 | `readWorkspaceRegistry()` 无有效记录 且 `getDirectoryHandle()` 非 null | 注册表（新 `scopeId`） | legacy adoption（§1.2.6） | 写注册表失败 → `disk-session` | 是（已存在有效注册表则跳过） |

#### 6.2.1 归属证据规则（M5–M7 的判据，T1 检查点）

> **旧收藏/句柄只带路径字符串时，当前目录恰好存在同名项不构成归属证据**（I-13）。

| 情形 | 判定 | 处置 |
|---|---|---|
| 旧键能与当前 `scopeId` 下的某个 `relPath` **精确命中**，且该 `scopeId` 是**本次以 `isSameEntry` 或用户确认建立**的 | 证据充分 | 绑定并迁移 |
| 旧键能与某路径命中，但该 `scopeId` 是 legacy adoption 新生成的（无历史证据） | 证据不足 | 进历史池，UI 标「未关联的工作区记录」 |
| 旧键在当前作用域下有 **1 个**同名命中 | 证据不足（唯一命中 ≠ 归属证据） | 进历史池；提供「关联到此工作区」显式动作，确认后写入 `relinkEvidence` |
| 旧键在当前作用域下有 **多个**同名命中 | 证据不足 | 同上，且不提供一键批量关联 |
| 旧条目带 `ephemeral: true`（上一次会话的 `disk-session`） | 无效 scopeId | 进历史池，不自动绑定 |

历史池的呈现（用户语言，不暴露索引概念）：文件面板底部「N 条旧记录未关联工作区」→ 展开为列表 → 每条可「关联到此工作区」或「忽略」。**用户不处理也不丢**（保留在 `legacyKeys` 与旧键中）。

### 6.3 版本回退策略（本轮重写）

> **I-21** 「旧键还在」**不是**「升级后新增的数据可恢复」的证明。回退必须分两种情形分别论证。

| 情形 | 事实 | 规定 |
|---|---|---|
| **R-A 迁移尚未产生新写入** | 新旧数据一致 | 直接删新键即可回退，无损失。此情形成立的前提是新功能尚未被使用 |
| **R-B 新版本已产生收藏/最近/句柄更新** | 旧键**已陈旧**；只删新键 = 丢失升级后的全部变更 | 必须依靠**降级投影**（下文） |

**降级投影（R-B 的答案）**：新版本在**每次**变更后，写一份旧版本能读懂的投影：

| 新数据 | 投影目标 | 投影内容 |
|---|---|---|
| `DocIndexEntry`（收藏/最近） | `mindcanvas.library.v1` | `{ id, name, ts, folder, tags, source? }`，`ts` 取 `max(openedAt, savedAt)`；`source` 仍只保留 8 条 |
| `DocIndexEntry.starred` | `mindcanvas.starred.v1` | 旧式文件键集合（`fullPath` 或旧 id） |
| 文件句柄富记录 | `mindcanvas-handles` 旧 `docId` 键 | 裸 `FsFileHandle` |
| 工作区注册表 | `'workspace-root'` | 裸目录句柄（已由 §1.2.3 的同事务写入保证） |

投影的诚实边界：

- 投影是**有损**的：旧版本读不出 `scopeId`/`lineageId`，因此回退后「同名不同目录」「改名后收藏跟随」等能力回落。
- 投影写入失败不影响主流程（与既有 `putRaw` 的容错一致），但此时**该次变更不可回退**——UI 不提示（用户语言里没有这个概念），但必须在回执与验证中可查。
- **真正无损的回退只有两条路**：① 保留新键并运行支持读新键的版本；② 用 P2 的导出（manifest 包）把新数据导出成可迁移文件。
- `localStorage` 投影失败（配额）→ 沿用 `docLibrary.save` 的既有降级：先剥 `source` 再试，仍失败则静默（`docLibrary.ts:98-110`）。

索引层读写必须容忍未知字段（前向兼容）与缺失字段（后向兼容），与 `DocLibrary` 的 `normalize`/`isEntry` 过滤同规（`docLibrary.ts:61-84`）。

---

## 7. 本文件未决与转交

| 事项 | 处置 | 转交 |
|---|---|---|
| 是否把 `scopeId` 写进文档 | **不做**；P2 再评估，且必须满足往返不丢 | P2 包 |
| 内容指纹（hash）用于「疑似同一文件」 | P1 可选，不在 P0；**不得**用 `size`+`mtime` 冒充 | P1 包的排除项 |
| 索引层是否改 IndexedDB | 不改（localStorage 够用）；超过约 5k 条目再评估 | DS-12 待确认 |
| 注册表条目上限 | 定为 8（可配置常量），超出淘汰最旧 dormant | 实现时定常量名 |
| 补 depcruise 规则禁止 `packages/react` → `apps/**` | 建议做，列为 P0-0 可选加固项 | DS-11 待确认 |
| 自由画布的资产能力 | **未设计**；UD-1 只决定「不进工作区与文件面板」，不构成对「仅会话插图」的批准 | 独立设计包（见 `contract-delta.md` CD-16） |
