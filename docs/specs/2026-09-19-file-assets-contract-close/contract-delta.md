# contract-delta：旧规则 → 反例 → 新规则 → 影响

任务：FILE-ASSETS-CONTRACT-CLOSE。日期：2026-09-19。追踪范围：T1（身份与迁移）、T2（资产）、T3（并发）、T4（分包）。

> **五轮结构**：CD-01…CD-18（第一轮补正）→ CD-19…CD-23（第二轮返修 R1–R4）→ CD-24…CD-28（第三轮返修 CR2-1…CR2-4）→ CD-29…CD-31（第四轮收口 CR2-4A/CR2-4B + 口径校正）→ **CD-32…CD-34（第五轮收口：NC-5 执行编排 + 不变量条件化 + 计数文案）**。**以最后一轮的结论为准；已关闭项不重做。**

**读法**：每条 CD 给出「旧规则（被推翻或需收窄）→ 反例/缺口 → 新规则（定案）→ 影响接口与后续包 → 源码锚点」。反例编号指向 `counterexamples.md` 的 CE-xx。

**证据等级**：本文件全部为设计结论，**不含实跑证据**；反例分「逻辑反例（读码推导）」与「读码结论」两级，见 `counterexamples.md`。

---

## 0. 索引

| CD | 主题 | 任务 | 对应新规则 |
|---|---|---|---|
| CD-01 | 工作区身份的表示 | T1 | §1.2.2/§1.2.3 |
| CD-02 | 同一目录的识别证据 | T1 | I-13 |
| CD-03 | A→B→A 与身份承诺收窄 | T1 | §1.2.7 |
| CD-04 | 旧裸句柄兼容与 legacy adoption | T1 | §1.2.6 / M11 |
| CD-05 | 损坏记录与写入失败 | T1 | §1.2.5/§1.2.6 |
| CD-06 | 旧收藏/句柄的归属证据 | T1 | §6.2.1 |
| CD-07 | 同名判定与去重 | T2 | §4.5.2 |
| CD-08 | `persisted` 与可携带性 | T2 | I-12 / §4.5.1 |
| CD-09 | 回退与降级投影 | T1/T5 | I-21 / §6.3 |
| CD-10 | 上传的作用域捕获与记账 | T2 | §4.5.4 |
| CD-11 | 插入归一化与唯一解析规则 | T2 | I-10 / I-11 / §1.5.1 |
| CD-12 | 操作租约 | T3 | I-16 |
| CD-13 | 物理写静默 | T3 | I-17 |
| CD-14 | 租约期间的编辑与释放 | T3 | I-18 / I-19 |
| CD-15 | 部分成功的目的地与保护 | T3 | I-15 |
| CD-16 | 分包重排与责任归属 | T4 | §5.1 |
| CD-17 | 目的地唯一事实源 | T3 | I-20 |
| CD-18 | 「dirty 改名丢内容」的证据等级 | T3 | I-14 的证据等级说明 |
| CD-19 | `detach()` 的两键原子性 | T1 返修 R1 | §1.2.3 单事务 |
| CD-20 | 读注册表的四态（含 `unavailable`） | T1 返修 R2 | I-24 |
| CD-21 | 注册表写的单事务 read-modify-write | T1 返修 R3 | §1.2.3 RMW |
| CD-22 | 测试替身的可编译性 | T4 返修 R4 | 计划 §4.2 夹具 |
| CD-23 | 三个重新挂载入口的身份一致性 + 人工关联分期 | T1/T4 返修 | I-23 / §1.2.8 |
| CD-24 | 「明确不同」必须登记新身份（不得并入无法判定） | 第三轮返修 CR2-1 | §1.2.9 判定表 |
| CD-25 | 夹具支持事务中止与原子回滚 | 第三轮返修 CR2-2 | 计划 §4.2 夹具 v3 |
| CD-26 | 两条宿主测试的期望与前提修正 | 第三轮返修 CR2-3 | 计划 §4.4 测试 |
| CD-27 | 并发负控必须用两实例 + 受控交错 | 第三轮返修 CR2-4 | 计划 §5 NC-5 |
| CD-28 | 两阶段身份解析 + conflict 复核与有界重试 | 第三轮返修 CR2-4 | I-25 / §1.2.9 |
| CD-29 | 记录校验器必须强制全部不变量；用例先构造合法记录 | 第四轮收口 CR2-4A | §1.2.3 不变量 |
| CD-30 | 负控必须以**正确期望**通过、以**非零退出**转红 | 第四轮收口 CR2-4B | 计划 §5 负控纪律 |
| CD-31 | NC-7 口径校正：同步 `mutate` 契约 ≠ 事务生命周期 | 第四轮收口（次要） | 计划 §5 NC-7 |
| CD-32 | NC-5 拆为**三入口编排**：常态必红的反例不进默认门禁 | 第五轮收口 CR2-4B（执行编排） | 计划 §5 NC-5 |
| CD-33 | 不变量**条件化**：`activeScopeId` 非空时才要求恰好一个 active | 第五轮收口（文案同步） | §1.2.3 不变量 |
| CD-34 | 计数/标题以行为为准：§5 旧标题「三条」更正 | 第五轮收口（文案同步） | 计划 §5 标题、§6.1 |

---

## CD-01 工作区身份的表示

**旧规则**：`ScopeId` 由 `handleStore` 已有的目录句柄记录派生（初版 §1.2），或把 `{handle, scopeId, schemaVersion}` 写进 `'workspace-root'`，或另立 `'workspace-root-scope'` 存 `{scopeId, schemaVersion}`（两种候选）。

**反例/缺口**：

- **CE-02**：把包装对象写进 `'workspace-root'` → 旧版本 `getDirectoryHandle()` 的 `isDirectoryHandle` 判定失败（要求存在 `getDirectoryHandle` 函数，`handleStore.ts:39-45`）→ 返回 `null` → 静默失去工作区。
- 「独立 `workspace-root-scope` 键」只能表达一个工作区，无法支持 A→B→A；且两个键可各自成败，产生半更新状态。

**新规则（定案）**：**显式工作区注册表**，单一新键 `'workspace-registry.v1'`，单记录、单事务读写；旧的 `'workspace-root'` **保持裸句柄语义不变**，作为兼容键继续被读写。结构、事务与八类场景见 `shared-contracts.md` §1.2。

**影响接口**：`handleStore` 新增注册表读写（不改既有 `setDirectoryHandle`/`getDirectoryHandle`/`deleteDirectoryHandle` 的签名与语义）；`DirectoryWorkspaceHost` 新增 `scopeState`/`scopeId`/`scopeEpoch` 三个访问器。

**影响后续包**：P0-0（实现）；P0-D（索引主键前缀）；P0-A（`SaveDestination.scopeId`）；P0-B（`AssetKey`）。

**源码锚点**：`handleStore.ts:17-18`（库/store 名）、`:39-45`（目录句柄窄化谓词）、`:81-107`（裸键读写）、`:48-73`（容错式 put/get）。

---

## CD-02 同一目录的识别证据

**旧规则**：初版隐含「读取同一已保存工作区沿用原 ID，用户选择新目录时生成新 ID」，但没有规定「用户重选同一目录」怎么识别。

**反例/缺口**：

- 目录名相同 ≠ 同一目录（`~/work/notes` 与 `~/archive/notes`）。
- 对象引用相等只在**同一次会话内**成立；跨刷新必然不同（句柄从 IDB 结构化克隆回来是新对象）。
- 当前目录恰好有同名文件不构成归属证据（**CE-06**）。

**新规则（定案，I-13）**：同一目录的**唯一**可用证据是 ① `handle.isSameEntry(other)` 成功返回，或 ② 用户在明确询问下的显式确认。其余一律**保守降级**：不自动合并，进入人工关联面板；用户不选则用 `session-only` 作用域（`persisted:false`）。

**影响接口**：`FsDirectoryHandle`/`FsFileHandle` 新增可选 `isSameEntry?: (other: unknown) => Promise<boolean>`；注册表条目新增 `associations: Array<{at, via}>` 作为可审计证据。

**影响后续包**：P0-0（实现 + 保守降级）；P1-A（人工关联 UI 的措辞）。

**源码锚点**：`directoryTypes.ts:10-25`（目录句柄面，当前无 `isSameEntry`）；`directoryHost.ts:151-199`（pick/restore/detach）。

---

## CD-03 A→B→A 与身份承诺收窄

**旧规则**：初版承诺「首次挂载生成一次并写回，不因重新挂载而产生新 id」。

**反例/缺口**：若只保留一个根句柄（现状），从 A 切到 B 后 A 的身份就丢了；A→B→A 无法恢复 A 的索引与收藏。

**新规则（定案）**：保留**有界注册表**（最多 8 个条目，按 `lastSeenAt` 淘汰 `dormant`）；条目被淘汰后再次连接会得到**新的** `scopeId`，其索引条目进历史池。

> **承诺收窄（原文照录）**：「任意重新挂载都保留身份」不成立；成立的是「在注册表保留期内、且能用 `isSameEntry` 证明同一目录时保留身份」。（`shared-contracts.md` §1.2.7）

**影响接口**：注册表条目上限为常量；淘汰策略必须显式（否则 A→B→A 的失败无法解释）。

**影响后续包**：P0-0；P0-D（历史池承接被淘汰作用域的条目）。

**源码锚点**：`handleStore.ts:81`（`WORKSPACE_ROOT_KEY` 固定单键——这正是「只保留一个根句柄」的现状证据）。

---

## CD-04 旧裸句柄兼容与 legacy adoption

**旧规则**：初版未定义「注册表缺失但裸键存在」的行为。

**反例/缺口**：现有用户库里只有 `'workspace-root'` 一条裸句柄记录（`handleStore.ts:84-92`）。升级后若不兼容，用户会莫名失去工作区（**CE-02** 的另一面）。

**新规则（定案）**：

1. `getDirectoryHandle()` 行为**完全不变**（继续读裸键、继续用同一窄化谓词）。
2. 注册表缺失 + 裸键有效 → **legacy adoption**：生成**新** `scopeId`（不得推断历史身份），`associations: [{ via: 'session-only' }]`；不因此改写任何既有索引条目。
3. 新版本每次把 active 条目变更时，**同事务**写回裸键，使回退版本仍可恢复目录。

**影响接口**：`handleStore` 的写路径必须同事务双写（注册表 + 裸键）；读路径保持两个入口独立。

**影响后续包**：P0-0；P0-D（legacy adoption 产生的 scopeId 无历史证据，其索引必须进历史池）。

**源码锚点**：`handleStore.ts:84-92`、`:188-190`（`verifyPermission` 的 granted 语义）。

---

## CD-05 损坏记录与写入失败

**旧规则**：初版只写「句柄或元数据写入失败不得伪称跨刷新稳定」，未规定**损坏**与**失败**各自的行为。

**新规则（定案）**：

| 情形 | 行为 |
|---|---|
| 注册表结构不合法 / `v` 未知 | **不使用、不删除**；本次 `disk-session`（`persisted:false`），UI 明确说明；提供「重建工作区记录」（生成新 `scopeId`）——**显式入口，不在 P0-0**；P0-0 对所有入口（含 `pick`）一律**不覆盖、不写入**（G0 勘误） |
| 注册表条目违反不变量（active 指向不存在或非 active 条目） | 按损坏处理 |
| 注册表写入失败（隐私模式/配额） | 本次仍可挂载使用；`persisted:false`；UI **不得**承诺「下次自动恢复工作区身份」 |
| `persisted:false` 期间写入的索引条目 | 标 `ephemeral: true`；下次会话其 `scopeId` 视为无效 → 历史池，不自动绑定 |

**影响接口**：`ScopeState` 的 `disk-session` 变体与 `reason`；索引条目的 `ephemeral` 字段。

**影响后续包**：P0-0（注册表容错）；P0-D（`ephemeral` 条目的历史池处置）。

**源码锚点**：`handleStore.ts:57-59`（put 静默容错）、`:126-132`（文件句柄 put 的同样容错）、`getRaw` 的 `:70-72`。

> **G0 勘误（2026-09-20）**：「重建工作区记录」是**显式修复入口**，不在 P0-0；所有入口（含 `pick`）对 `corrupt` 一律**不覆盖、不写入**。原 `shared-contracts.md` §1.2.6 的 `pick` 例外已移除；`resolveScopeForIdentity` 的签名（含 I-23 的 §1.2.6 与 §4.2 两处引用）同步为**无 `opts` 参数**（该参数的唯一用途即被删除的覆盖选项）。见 `docs/dispatch/2026-09-20-g0-report.md`。

---

## CD-06 旧收藏/句柄的归属证据

**旧规则**：初版 M6 写「能按 `relPath` 唯一匹配到当前作用域 → 直接迁移」。

**反例/缺口**：**CE-06** ——「当前目录恰好只有这一个同名项」是巧合，不是归属证据。旧键 `mindcanvas.starred.v1` 里存的是路径字符串（`fileManagerShared.ts:115`），它**从未记录过作用域**；把它绑定到当前工作区等于用猜测制造归属。

**新规则（定案，§6.2.1）**：旧键只在「该 `scopeId` 是本次以 `isSameEntry` 或用户确认建立」且「键与 `docKey` 精确命中」时才迁移；否则进**历史池**，以用户语言呈现（「N 条旧记录未关联工作区」），由用户逐条确认；用户不处理也不丢。

**影响接口**：`DocIndexEntry.legacyKeys`（只追加）+ `relinkEvidence`；历史池的呈现入口。

**影响后续包**：P0-D（迁移 + 历史池 + 人工关联）；P1-A（入口与措辞）。

**源码锚点**：`fileManagerShared.ts:115,133-146`（收藏键 = `fullPath`）、`fileManagerShared.ts:118-125`（损坏时返回空集）。

---

## CD-07 同名判定与去重

**旧规则**：初版 §4.1 写「同名 + 同内容 → 不弹冲突；磁盘 `size` + `lastModified` 一致视为同内容」。

**反例/缺口**：**CE-03** ——「同名、同大小、同时间戳、不同字节」完全可能（复制后编辑并回写、脚本生成、时钟精度相同的批量导出）。据此跳过写入 = **静默丢失用户的新内容**，而且用户看不到任何提示。

**新规则（定案）**：

1. `size` + `lastModified` **只能做预筛选**（用于显示「可能相同」），**不得**据此跳过写入或跳过冲突流程。
2. 只有**实际字节比对**（或同一次会话内可靠的内容摘要）才能判定「相同」。
3. **推荐最小方案：首期不做去重**——同名一律进三选，默认焦点「保留两份」。
4. 冲突检测本身失败（权限/IDB 不可用）→ **按「已存在」处理**（宁可多问一次，不可静默覆盖）。

**影响接口**：`AssetWriteResult` 不新增 `skipped-same-content` 变体（首期）；同名探测的失败路径必须有结果。

**影响后续包**：P0-B（实现）；P0-A（文档新建路径仍保留既有的静默加序号，两者不得混淆——见 `acceptance-and-backlog.md` §4 的既有断言边界表）。

**源码锚点**：`directoryHost.ts:375-386`（`getFileHandle(name,{create:true})` 直接覆盖）、`idbAssetHost.ts:146-157`（`put` 覆盖）、`assetHost.ts:92-96`（Demo 同语义）、`directoryHost.ts:352-365`（`uniqueName` 静默加序号）。

---

## CD-08 `persisted` 与可携带性

**旧规则**：初版把 `persisted(where:'disk'|'idb')` 写成「唯一可宣称『换机器还在』的状态」。

**反例/缺口**：

- `idb` 分支不可能宣称可携带——IndexedDB 可被浏览器在存储压力下清理，清站点数据必失（与 R-16/G6 一致）。
- 磁盘分支的可携带性有前提：**必须把整个文件夹拷走**；只拷文档不带 `assets/` 仍然断图。
- 该术语还把「写到哪」（来源）与「多可靠」（持久性/可携带性）混成一个字段。

**新规则（定案，I-12）**：三轴分离——**写入结果**（`written`/`session-only`/`failed`）× **存储位置**（`AssetStore`）× **可携带性**（`AssetPortability`）。允许/禁止的文案表见 `shared-contracts.md` §1.7。

**影响接口**：删除 `AssetPersist` 与 `persisted` 术语；新增 `AssetStore` / `AssetPortability`；`AssetWriteResult.kind` 由 `persisted` 改为 `written` + `store`。

**影响后续包**：P0-B（实现与徽章）；P1-B（详情页与删除确认文案）；P2-A（manifest 的 `portability` 声明）。

**源码锚点**：`idbAssetHost.ts:146-150`（写失败被 catch 后仍返回同一 `AssetItem`）、`workspaceAssetHost.ts:100-112`（磁盘写入返回相对路径）、`assetHost.ts:88-91`（小 SVG 内联）。

---

## CD-09 回退与降级投影

**旧规则**：初版 §6.3 写「回退 = 删除新键即可，无数据损失」，并在回执 §7 记为假设 A-7。

**反例/缺口**：**CE-10** ——若升级后用户新增了收藏、最近记录或句柄更新，这些只存在于新键里；删掉新键 = 丢失这些变更。「旧键还在」只证明**旧数据**未被动过，不证明**新数据**可恢复。

**新规则（定案，I-21）**：

| 情形 | 规定 |
|---|---|
| R-A 迁移尚未产生新写入 | 删新键即可无损回退 |
| R-B 新版本已有变更 | 必须依靠**降级投影**：每次变更后写一份旧版本能读懂的投影（`mindcanvas.library.v1` 条目、`mindcanvas.starred.v1` 键、旧 `docId` 裸句柄） |

投影的诚实边界：有损（旧版本读不出 `scopeId`/`lineageId`）；投影写入失败不影响主流程，但**该次变更不可回退**；真正无损的回退只有「保留新键 + 支持读新键的版本」或「P2 的导出包」两条路。

**影响接口**：`apps/canvas/src/docIndex.ts` 每次变更后必须写投影；`DocIndexEntry` 不需要额外字段，但写路径必须包含投影步骤。

**影响后续包**：P0-D（实现 + R-A/R-B 双实测）。

**源码锚点**：`docLibrary.ts:98-110`（localStorage 配额降级：先剥 source 再试）、`:315-319`（`persistSorted` 的 `SOURCE_KEEP` 截断——投影必须沿用同一截断口径）。

---

## CD-10 上传的作用域捕获与记账

**旧规则**：初版 §2.2 写「核对 epoch 未变 → 更新清单；已变 → 丢弃并记一条诊断」。

**反例/缺口**：**CE-04** ——「丢弃」只处理了 UI 回填。若写入**已经发生**（文件已落在磁盘/IDB），把结果整个丢掉意味着：文件存在但没有任何记录；用户切回原工作区后会看到一份自己不知道来路的文件，或者以为上传失败而重复上传。

**新规则（定案，§4.5.4）**：写入前捕获 `{scopeId, epoch, store}`；epoch 变化时**不更新当前清单**，但必须**记账**（`AssetIndexEntry.unconfirmed: true`，属于捕获时的 `scopeId`），下次该作用域挂载时由 `listAssets` 重新发现并清除标记；文案见 `asset-library.md` §6.2。

**影响接口**：`AssetIndexEntry.unconfirmed`；`uploadAssetDetailed` 的返回必须携带**捕获时**的作用域。

**影响后续包**：P0-B（实现）；P1-B（重新发现与详情展示）。

**源码锚点**：`workspaceAssetHost.ts:87-112`（`uploadAsset` 在切换后仍会写盘）、`MindmapStage.tsx:908-916`（现状只有组件级 `alive` 标志，不校验作用域）、`:888-892`（`uploadToGallery` 不捕获 scope/epoch）。

---

## CD-11 插入归一化与唯一解析规则

**旧规则**：初版只要求「面板卡片带归属徽章 + 宿主缓存键作用域化」，并保留 `resolveAsset` 未命中回落 `baseUrl + id` 的行为。

**反例/缺口**：

- **CE-11**：文档里只有 `assets/a.png`。浏览器素材库与当前工作区各有一张同名图时，插入哪一张、重开解析到哪一张，**无法由文档内容决定**；只在内存里区分作用域，重开后必然丢失。
- **R-15 / CE-12**：未命中回落 `baseUrl + id` 指向**站点根**（`/assets/a.png`），与「工作区根」不是同一基准；`no-scope` 与 `missing` 也被混为一谈。
- 初版还允许「只在本次会话使用」的落点，这会产生「写进文档、重开必断」的引用。

**新规则（定案，I-10/I-11/§1.5.1）**：

1. **插入归一化**：已挂载工作区 → 字节落 `<workspace>/assets/`（必要时分配不冲突新名）；未挂载工作区 + 可净化小 SVG → 内联 `data:`；**其他 → 拒绝插入**（不写新形态引用）。
2. **唯一解析规则**：`data:` 自包含 / `builtin:` 查内置表 / `assets/<relPath>` 相对**当前工作区根** / 其他一律 `unresolved('external')` 且**不产生** `W-ASSET-MISSING`、不被改写。
3. **区分** `unresolved('no-scope')`（没打开工作区）与 `unresolved('missing')`（工作区里没这个文件）。
4. **取消 `baseUrl` 回落**：未命中时返回 `pending` 或 `unresolved`，**不得**编造站点根 URL。

**影响接口**：`normalizeForInsert`；`AssetResolution` 的 `reason` 集合；渲染层 `resolveAssetState` 优先于 `resolveAsset`。

**影响后续包**：P0-B（归一化 + 解析）；P1-B（断图修复按 reason 分支）；P2-A（可携带性边界由此确定）。

**源码锚点**：`SidePanels.tsx:39-41`（`assetValueOf`）、`:128-153`（三条插入分支）、`idbAssetHost.ts:127-131`（`resolveAsset` 回落 `baseUrl + id`）、`workspaceAssetHost.ts:81-85`（磁盘缓存未命中即回落）、`NodeG.tsx:107-131`（渲染侧解析）、`assetDiagnostics.ts:15-30`（缺失诊断不分外链）。

---

## CD-12 操作租约

**旧规则**：初版 §3.2 用「`waitForIdle` → `suppressPendingAuto`」实现互斥。

**反例/缺口**：**CE-07** ——

- `suppressPendingAuto` 只清**一个** 300ms 定时器；内容再变化会重新排定新的自动保存（`useAutoSave.ts:121` 的 deps 含 `content`）。
- `waitForIdle()` 只等**当前会话**已开始的 I/O（`useDocumentSaveSession.ts:146-157` 的既有语义边界）。
- 结果：`等待空闲 → 新保存进入 → rename 复制旧快照 → 删源`。

**新规则（定案，I-16）**：**操作租约**，归属 `DocumentSaveSession`（不新造第二个锁对象，因 token/queue/inFlight/idleWaiters 已是「谁在动这份文档」的事实源）。

- `beginExclusiveOp(intent, target)` → `granted(leaseId, opSeq)` 或 `refused('busy-lease'|'busy-physical'|'session-replaced')`。
- **租约期间 `submit` 一律 `blocked`**（auto/manual/save-as 全部，不入队、不闪 saving、零状态变化）。
- 覆盖范围：自动保存、手动保存、另存为、重复操作（第二次 `beginExclusiveOp` → `busy-lease`）、目标切换（`opSeq` 变化）。
- 取得时机：UI 校验通过之后、任何 `await` 之前；需要用户手势的步骤（picker/confirm）放在取得租约**之前**。

**影响接口**：`DocumentSaveSession` 新增 `beginExclusiveOp`/`endExclusiveOp`/`opSeq`；`FileOpIntent`。

**影响后续包**：P0-A（实现）；P0-B（上传的磁盘写入复用同一互斥域）；P1-A（归档复用 `move` 意图）。

**源码锚点**：`useAutoSave.ts:69,112-113,121`（触发条件与 deps）、`useDocumentSaveSession.ts:143`（`isSaving`）、`:152-157`（`waitForIdle` 边界）、`documentLifecycle.ts:82-85`（`suppressPendingAuto` 的既有语义）。

---

## CD-13 物理写静默

**旧规则**：初版写「逻辑 stale ≠ 物理已撤销」，但未给可判定手段。

**反例/缺口**：会话令牌推进只保证 **回调不回填**；被替换会话**已经发出**的物理写仍在跑（`useDocumentSaveSession.ts:26-27` 的类头注已声明）。若在此时 rename/move 拷贝并删除源文件，可能与那次写入交错。

**新规则（定案，I-17）**：新增跨会话计数 `physicalWritesInFlight`（write 开始 +1、`finally` -1，**不随 token 推进归零**）；`beginExclusiveOp` 在其非 0 时 `refused('busy-physical')`，文案「上一份写入还没有结束，请稍后重试（本次未做任何改动）。」

**选择拒绝而不是静默等待的理由**：无限期等待会让用户在无反馈中卡住；拒绝 + 可重试是可解释的行为。

**影响接口**：`DocumentSaveSession.physicalWritesInFlight`（内部）+ 拒绝原因。

**影响后续包**：P0-A（实现 + F1 负控）。

**源码锚点**：`useDocumentSaveSession.ts:26-27`（类头注的语义边界）、`:209-280`（`drain` 的写入路径——计数应在此包裹）、`:243-246`（token 不匹配即 stale 的零回填）。

---

## CD-14 租约期间的编辑与释放

**旧规则**：初版未规定租约期间能否编辑。

**新规则（定案，I-18/I-19）**：

- **保留编辑、延迟写出**：不冻结输入（冻结会引入新的焦点/IME/草稿边界，且需要新 UI 状态）；写入被 `blocked` 挡回，有既有通知通道。
- **每个 `await` 后校验**：`leaseId` / `sessionToken` / `scopeId` / `opSeq` 四项；任一不符 → 停止后续步骤且**不写任何状态**。
- **条件释放**：`finally` 中 `if (leaseIdOf(op) === leaseId) endExclusiveOp(leaseId)`——否则会解开后续请求持有的租约。
- 释放后若 `dirty` 仍为真 → 立即重排一次 auto（写**新**目的地）。

**影响的六类场景**（时序表见 `shared-contracts.md` §3.5.4）：慢写后新编辑 / 租约内 Ctrl+S / 租约内另存为 / 切文档迟到回调 / 部分成功后继续编辑再撤销副本 / 源被外部修改。

**影响接口**：无新增类型；由 `opSeq` 与 `leaseId` 承载。

**影响后续包**：P0-A。

**源码锚点**：`useUnsavedTransition.ts:129-135,277,331,347`（既有「每个异步边界校验归属」的同规做法，可直接对齐）、`useDocumentLeaveRegistration.ts:18-28`（ref 转发避免陈旧闭包）。

---

## CD-15 部分成功的目的地与保护

**旧规则**：初版 §3.3 给了三选，但未规定：① 部分成功后「当前目的地」是哪一份；② 「撤销新副本」的边界；③ 「重试删源」前是否复查。

**反例/缺口**：

- **CE-09**：部分成功后用户在新位置继续编辑，此时点「撤销新副本」→ 删除副本会把刚写的编辑一起删掉。
- **CE-08**：源文件在部分成功后可能被外部程序修改；无条件 `removeEntry` 会删掉别人的改动。

**新规则（定案，I-15）**：

| 项 | 规定 |
|---|---|
| 当前目的地 | **新文件**（用户目标即「放到那里」，且已成功写出）；旧文件标「待处理」，不参与会话写入 |
| 撤销新副本 | 副本已被编辑（`dirty`）或已被写入（`savedAt > opStartedAt`）→ **拒绝直接删除**，只提供「放弃这些改动并删除副本」或「保留两份」 |
| 重试删源 | **只删源、不重做复制**；删除前复查 `{size, lastModified}` 快照，不一致 → 不删，提示「原文件已被外部修改，未删除」 |
| 两份都在 | 树内标「重复」+ 显式删除入口（同样走复查）；**不自动清理** |
| 稍后处理 | 进「N 项待处理」，不自动重试 |

**影响接口**：`FileOpOutcome.partial` 的载荷需要能表达「源快照」（用于复查）与「opStartedAt」（用于保护判断）。

**影响后续包**：P0-A。

**源码锚点**：`directoryHost.ts:343-349`（`moveFile` 先建后删）、`:321-328`（`removeFile` 的可选调用）、`FileManager.tsx:226-236`（`dropInto` 无 catch）。

---

## CD-16 分包重排与责任归属

**旧规则**：初版拆包为 P0-0（契约冻结，含类型与空实现）→ P0-D/P0-A/P0-B 并行 → P0-C 补反馈；P1-C 做两种画布对齐。

**反例/缺口**：

- P0-0 的「只加类型与空实现」违反「不留无消费者的空实现」；且把 `rebindDestination` 放在 P0-0 会造出一个当包内无调用方的公共方法。
- 「P0-A 交付操作、P0-C 补反馈」意味着 P0-A 会先交付一批**无用户可见失败通道**的危险操作。
- 初版把 `FileOpOutcome` 放在 `apps/canvas/src/fileOpTypes.ts`，同时要求 `packages/react` 产出它 → 包反向依赖应用（`.dependency-cruiser.js` 现状**不拦**该方向，属真实风险，不能靠工具兜底）。
- 「不同包不同文件面所以可以并行」不成立：`MindmapStage.tsx`/`FileManager.tsx`/`SidePanels.tsx` 被多个包同时需要改。

**新规则（定案，`acceptance-and-backlog.md` §5.1）**：

| 原则 | 内容 |
|---|---|
| 责任随操作 | 失败/冲突/部分成功的反馈**随该操作所在包交付**；P0-C 只做跨操作的统一呈现 |
| 无消费者不做 | 类型/方法/字段必须在本包内有真实调用点 |
| 公共类型位置 | 落 `packages/react/src/edit/**` 与 `packages/react/src/chrome/**`，经 `index.ts` 再导出 |
| 共享接线串行 | `MindmapStage.tsx` 等默认同包独占；并行前必须先切分接线责任 |

**串行链**：P0-0 → P0-D → P0-A → P0-B → P0-C → P1-A → P1-B → P2-A。

**P0-0 范围收窄**：只做**身份与存储基础**（注册表 + `scopeId` + 八类场景 + legacy adoption + 宿主接线），不含 `rebindDestination`/`uploadAssetDetailed`/`*Safe`/`AssetWriteResult`。

**自由画布**：UD-1 只决定「不进工作区与文件面板」；其能力对齐是**单列独立包**（P1-C），不在串行链上，且不得用「无功能但提示不支持」当作 X1 通过。

**源码锚点**：`.dependency-cruiser.js:15-101`（无 react→apps 规则）、`packages/react/package.json:15-18`（`files: ["dist"]`——已发布包不能引用应用目录）、`packages/react/src/index.ts:325-344`（既有再导出方式）。

---

## CD-17 目的地唯一事实源

**旧规则**：初版说「`rebindDestination` 内部同步维护两者，避免出现两个事实源」，但没有把这条写成不变量。

**反例/缺口**：`setDestination(handle)` 有 4 处既有调用（`useDocumentActions.ts:201,264`、`useAutoSave.ts:89`、`useFreeCanvasDocument.ts:134`）。若新方法另存一份「作用域 + 路径」，两处会分叉：UI 显示的目的地与实际写入的目的地可以不同。

**新规则（定案，I-20）**：`SaveDestination` 只有**一个**存储位；`setDestination` 保留为兼容写入口（内部归一化后写入同一字段）；`rebindDestination` 是唯一能同时更新「作用域 + 相对路径 + 句柄」的入口；**不变量**：`getDestinationInfo()` 与 `getDestination()` 在任何时刻描述同一目的地。

**影响接口**：`DocumentSaveSession` 的私有字段与四个入口。

**影响后续包**：P0-A。

**源码锚点**：`useDocumentSaveSession.ts:72`（私有字段）、`:99-106`（两个既有入口）、`useDocumentActions.ts:187-191`（写盘时读会话目的地）。

---

## CD-18 「dirty 改名丢内容」的证据等级

**旧规则**：初版 I-8 写「这是当前最可能的真实丢内容路径（R-01）」，并在 `current-state.md` 的 R-01 标为【线索】——两处口径不一致（正文像已确认缺陷，风险表标线索）。

**反例/缺口**：该结论**没有被实跑复现**。它是一个**逻辑反例**：`renameFile` 读的是磁盘内容（`directoryHost.ts:310`），dirty 时改名会把磁盘旧快照复制成新文件；随后旧句柄指向已删除的旧文件，第 15 步之后的自动保存会失败或写不回原处。成立与否取决于「dirty 且保存失败/未保存」这一具体时序，以及浏览器对已删除路径句柄的写入行为。

**新规则（定案）**：

- 表述统一为**逻辑反例（未实跑）**，正式复现条件与观察点见 `counterexamples.md` CE-01。
- I-14 的**前置条件本身照旧保留**——不是因为它已被证明会丢内容，而是因为它把「不确定会不会丢」变成「不可能丢」，且成本最低。

**影响接口**：无。

**影响后续包**：P0-A（F1 验收的第 ③ 条改由「新文件内容 = 改名前的落盘快照 + 租约内编辑由后续 auto 补写」来判定，而不是「必然丢失」）。

**源码锚点**：`directoryHost.ts:308-318`（`renameFile` 读旧内容）、`:343-349`（`moveFile`）、`FileManager.tsx:212-223`（调用点不消费返回值）、`useDocumentSaveSession.ts:99-106`（目的地只在特定入口更新）。

---

# 第二轮返修（复核 R1–R4，2026-09-19）

复核结论：契约补正方向可接受，P0-0 计划暂不放行。下列五项为定向返修，**不改变**已确认的设计方向（注册表新键、`isSameEntry` 唯一证据、8 条上限、同名三选、三轴分离、租约、P0-0 不含保存/资产/索引/UI）。

## CD-19 `detach()` 的两键原子性（返修 R1）

**旧规则（本轮被打回）**：`detach()` 先写注册表（active → `dormant`），**再**调用既有 `deleteDirectoryHandle()` 清裸键。

**反例/缺口**：两次独立写操作 → 任一步失败即产生分叉：
- 注册表已 `dormant`、裸键仍在 → 下次刷新 `resolveScopeForIdentity` 从注册表拿不到 active，却仍能从裸键拿到句柄 → 身份与句柄不一致；
- 或裸键已删、注册表仍 `active` → 下次刷新按注册表挂载一个「已断开」的工作区。

**新规则（定案）**：注册表变更与裸键处置（写/删/不动）**必须在同一个 `readwrite` 事务内提交**；`detach()` 改为 `writeWorkspaceRegistry(markDormant, { kind: 'delete' })`，**不再调用** `deleteDirectoryHandle()`（该函数作为既有公开 API 保持签名与语义不变）。事务失败时两键**都不变**。

**影响接口**：`writeWorkspaceRegistry` 的第二个参数从「可空裸句柄」改为 `LegacyHandleIntent = unchanged | write | delete`。

**影响后续包**：P0-0（实现 + R1 正负用例）。

**源码锚点**：`directoryHost.ts:194-199`（现状 `detach` 的两次独立操作）、`handleStore.ts:94-107`（`deleteDirectoryHandle` 的独立事务）。

## CD-20 读注册表的四态（返修 R2）

**旧规则（本轮被打回）**：`readWorkspaceRegistry()` 把「键不存在」与「读到 `null`/`undefined`」都判为 `empty`。

**反例/缺口**：既有 `getRaw()` 在 `catch` 后返回 `null`（`handleStore.ts:70-72`），`null` 同时表示「键不存在」与「IDB 打开/读取失败」。把后者当 `empty` 会触发 **legacy adoption** → 生成新 `scopeId` 并**写回注册表**，覆盖一个其实存在但读不到的注册表 → 用户的历史工作区身份与索引绑定被破坏。

**新规则（定案，I-24）**：四态 `ok` / `empty` / `corrupt` / `unavailable`；**只有 `empty` 允许 legacy adoption**；`unavailable` 时不 legacy adoption、不写任何键，本次为 `disk-session('registry-unavailable')`。实现上必须新增可报告失败的读取原语（`getRawResult`），**不得**复用 `getRaw()`。

**影响接口**：`RegistryReadResult` 增第四态；`ScopeState.reason` 增 `'registry-unavailable'`。

**影响后续包**：P0-0；P0-D（四种 `disk-session` reason 都要标 `ephemeral`）。

**源码锚点**：`handleStore.ts:62-73`（`getRaw` 的 catch→null）、`:57-59`（`putRaw` 的同样静默）。

## CD-21 注册表写的单事务 RMW（返修 R3）

**旧规则（本轮被打回）**：`writeWorkspaceRegistry(record, legacyHandle)` 接收调用方**已经在事务外构造好**的完整记录。

**反例/缺口**：契约要求「同一事务内读取旧记录、合并、写回」，但旧签名无法表达这一点。两个并发调用各自读到同一旧记录、各自合并、各自写回 → 后写覆盖先写（丢更新）。这不是理论问题：`pick()` 与 `restore()` 可能在同一次挂载流程里连续触发。

**新规则（定案）**：接口改为 `writeWorkspaceRegistry(mutate: (prev: RegistryReadResult) => WorkspaceRegistryRecord | 'unchanged', legacy: LegacyHandleIntent)`。同一 `readwrite` 事务内完成「读 → 判四态 → 调 mutate → 校验 → 写注册表 → 处置裸键」；新记录不合法 → 中止并 `failed('invalid')`（拒绝写入，而不是写进去再发现坏了）。额外在本页加一条串行链保证「开库 → 建事务」顺序稳定；跨标签页仍以 IDB 对重叠 scope 的 `readwrite` 串行语义为准。

**影响接口**：`writeWorkspaceRegistry` 签名；新增 `RegistryMutate` / `RegistryWriteResult`。

**影响后续包**：P0-0（实现 + 并发用例 + NC-5）。

**源码锚点**：`handleStore.ts:48-60`（`putRaw` 是「先构造后写」的既有形态，注册表路径不得照抄）。

## CD-22 测试替身的可编译性（返修 R4）

**旧规则（本轮被打回）**：计划中的内存 IDB 替身同时声明 `set onerror(...)` 与 `onerror` 属性。

**反例/缺口**：TypeScript 报 **TS1119**（`An object literal cannot have property and accessor with the same name`）——计划给执行者的测试代码**无法编译**。

**新规则（定案）**：替身对象**只用属性**，不写 accessor；事务串行与失败注入按计划 §4.2 的 v2 夹具实现（`makeTx()` 用操作登记 + 索引循环 + `txChain` 串行；`fail = { open, read, write }` 三个开关）。同时把既有 `FakeRequest`/`valueReq`/`openReq` 一并替换，**原有 15 个用例的断言不得改动**。

**影响接口**：无（测试夹具）。

**影响后续包**：P0-0。

**源码锚点**：`packages/react/tests/handle-store.test.ts:30-95`（既有替身形态）。

## CD-23 入口一致性（I-23）与人工关联分期

**旧规则**：P0-0 计划只明确接线 `pick/restore/detach`；对 `isSameEntry` 缺失，文档同时写了「进入人工关联」与「生成新的 `disk-session` scope」两种行为。

**反例/缺口**：
- `requestPermission()` 在 `root === null` 时会从裸键句柄挂载（`directoryHost.ts:183-192`），是与 `restore()` 并列的**第二条**重新挂载路径。只接线三条会让同一工作区经不同入口得到不同身份。
- 「人工关联」需要 UI，而 P0-0 明确不做 UI；两种行为并存会让执行者无法判断。

**新规则（定案）**：

1. **I-23 单一路径**：新增私有 `resolveScopeForIdentity(root)`；`restore`/`pick`/`requestPermission` 三个入口都必须经过它，对同目录给出同一 `scopeId` 或都不给持久身份。`requestPermission` 在**已挂载**时不重新解析、不改 `scopeId`、不变 `epoch`。
2. **人工关联分期（§1.2.8）**：P0-0 保守降级为 `disk-session('unassociated')`（目录可用、身份不持久、注册表与裸键**都不写**）；P1-A 提供人工关联面板，确认后按 `via:'user-confirmed'` 写回。**在 P1-A 之前不得声称恢复了旧工作区身份。**
3. 已知代价（接受）：P1-A 之前，注册表非空且 `isSameEntry` 不可用时用户每次都要重新选文件夹。

**影响接口**：`requestPermission()` 的语义补充（签名不变）；`resolveScopeForIdentity` 为私有，不进导出面。

**影响后续包**：P0-0（实现 + 两条 I-23 用例）；P1-A（人工关联面板，列为明确欠账）。

**源码锚点**：`directoryHost.ts:167-192`（`restore` 与 `requestPermission` 的并列挂载路径）、`:194-199`（`detach`）。

---

# 第三轮返修（复核 CR2-1…CR2-4，2026-09-20）

复核结论：接口返修方向成立（原子更新、四态读、事务内 mutate、`requestPermission` 接线均可保留，TS1119 已消失），但 P0-0 仍需四项定向修订。**不扩大范围、不启动实现。**

## CD-24 「明确不同」必须登记新身份（CR2-1）

**旧规则（被打回）**：计划把**全部 `different`** 与 `unknown` 一起送入「不写任何键的 `unassociated`」分支。

**反例/缺口**：A 登记之后，用户正常选择**可证明不同**的目录 B，也会被判为「无法判定」→ B 不被登记；刷新后 `restore()` 回到 A。**第二个工作区永远无法持久登记**。而 A→B→A 用例只断言了「内存 id 不等」与「回到 A 时 id 相等」，**漏掉了 B 曾被持久登记**这一关键事实，因此测试无法发现该退化。

**新规则（定案，§1.2.9 判定表）**：

| 判定 | 条件 | 行为 |
|---|---|---|
| `reuse` | **恰好一个** `same` | 复用该 `scopeId` |
| `register` | `empty`，或 `ok` 且 `entries` 为空，**或 `ok` 且非空但全部为 `different`** | **登记新身份**（持久） |
| `degrade` | 无 `same` 且**存在 `unknown`** | `disk-session('unassociated')`，不写键 |
| `refuse` | **多个** `same` | 拒绝合并，`disk-session('unassociated')` |

并明确：**「注册表键存在但 `entries` 为空」是合法空库，不是「身份不明」**。

**补的断言**：A→B 后断言 B 为 `disk/persisted`、`activeScopeId=B`、A 为 `dormant`、裸键=`B`；新实例 `restore()` 仍为 B；再选 A 恢复 A 原 `scopeId`；保留「同名但不同目录」用例。

**影响后续包**：P0-0（实现 + 用例）。

**源码锚点**：`handleStore.ts:84-92`（裸键写入是「记住」的唯一手段）、`directoryHost.ts:151-164`（`pick` 的 AbortError 容错不影响判定）。

## CD-25 夹具必须支持事务中止与原子回滚（CR2-2）

**旧规则（被打回）**：v2 夹具的 `put`/`delete` 直接改 `memStore`，没有提交前暂存与失败回滚；`fail.write` 只在整笔操作开始前失败。

**反例/缺口**：复核方**直接提取计划里的夹具运行**，得到 `abortType=undefined`、`readFailed=true`、`completed=true`、`stored='after'`——即**读取失败后仍执行后续 `put` 并提交**。这既不能证明 R1 的原子性，也覆盖不到「第一条写成功、第二条失败」这一关键窗口。

**新规则（定案，计划 §4.2 夹具 v3）**：写请求**暂存**，`oncomplete` 时发布、`abort` 时丢弃；任一请求失败**自动 abort**；支持 `tx.abort()` 与 `onabort`；`oncomplete`/`onabort` **互斥结算**；`fail.writeAt = N` 让第 N 个写请求失败。必须验证的断言：两键初始有值 → 第 1 条写成功、第 2 条失败 → 两键保持旧值、Promise 收束、`oncomplete` 未触发。另覆盖主动 abort、`mutate` 抛错、记录非法、读取失败。**生产实现不得为迁就夹具而绕开 `abort`。**

**影响后续包**：P0-0。

**源码锚点**：`packages/react/tests/handle-store.test.ts:30-95`（v2 之前的原始替身）。

## CD-26 两条宿主测试的期望与前提修正（CR2-3）

**旧规则（被打回）**：

1. `unassociated` 用例：先成功挂载 A（`pick` 会写裸键），却断言「不写任何键」时 `getDirectoryHandle()` 为 `null`，并用 `JSON.stringify` 对含句柄/函数的对象做深比较。
2. `unavailable` 用例：在新实例 `restore()` 前把**整个 IDB open** 设为失败——此时连旧裸句柄也取不回，**不具备挂载 `disk-session` 的根句柄**，期望与前提自相矛盾。

**反例/缺口**：第 1 条把「本次未写」误当成「所有键都不存在」——**旧 A 的裸键其实还在**；第 2 条把「存储整体不可用」与「只注册表读失败」混为一谈。

**新规则（定案，计划 §4.4）**：

| 场景 | 前提 | 期望 |
|---|---|---|
| 只失败注册表读取（`fail.readKey`），裸键可读 | picker 给句柄，或冷启动 | 可挂载但身份降级 `disk-session('registry-unavailable')`；**裸键未被改写** |
| 整个存储不可读（`fail.open`） | 冷启动 | `restore()` 返回 `false`，**未挂载**，`scopeState.kind === 'browser'` |
| 注册表非空 + 无 `isSameEntry` | 先登记 A | 注册表与**裸键保持原值**（断言句柄 `name` 仍为 `A`），不承认恢复旧身份 |

并补齐脚手架：`handleOf` / `sameByLabel` / `patchPicker` / `PERM`（权限复位）/ `reboot()`；**只断言可读目标**，不做对象深比较。

**影响后续包**：P0-0。

**源码锚点**：`handleStore.ts:62-73`（`getRaw` 对读失败返回 `null`——这正是「必须能区分」的原因）。

## CD-27 并发负控必须用两实例 + 受控交错（CR2-4）

**旧规则（被打回）**：NC-5 用同页 `Promise.all` 证明「事务外读会丢更新」。

**反例/缺口**：生产设计用 `writeChain` 包住整段读写，同页两次调用被**串行**；即便把读取挪到事务外，第二次仍会读到第一次的结果 → 负控**不会转红**。复核的最小调度反例已证明：保留 `writeChain` 时结果仍为 `['a','b','c']`。**因此不能据此证明「事务内合并是必需的」。**

**新规则（定案）**：

1. 负控使用**两个独立的 production 模块实例**（`vi.resetModules()` + 动态 `import`），**共用同一个数据库**（夹具共享态挂 `globalThis`）但**各自持有 `writeChain`**——对应真实世界的两个标签页。
2. 要有**受控交错**：两侧的「事务外读」都完成后再放行写入（barrier），从而确定性地丢一条更新。
3. 同时给**正例**：两个独立实例并发调用真正的 `writeWorkspaceRegistry(mutate,…)` → 两条更新都保留。
4. 夹具的 `txChain`/`memStore`/`commitCount` 必须挂在 `globalThis`，否则跨实例的「事务串行」不成立（真实 IDB 的串行是**每库**的）。

**影响后续包**：P0-0（NC-5 重写 + 夹具共享态）。

**源码锚点**：计划 §4.2 夹具 v2 的 `txChain`（模块级 → 必须改为共享）。

## CD-28 两阶段身份解析 + conflict 复核与有界重试（CR2-4 的另一半）

**旧规则**：`resolveScopeForIdentity` 在事务内调 `mutate`，但没有规定「异步比较结果与事务内状态是否一致」。

**反例/缺口**：

- `sameDirectory` 依赖 `handle.isSameEntry()`，是**不受控的外部 Promise**；而 IDB 事务在微任务队列清空且无挂起请求时会**自动提交**——在活跃事务里 `await` 它会导致事务提前提交或报错。
- 即便不 await，把「基于阶段 1 快照的闭包」直接写进事务，等于**默认快照未变**；两个标签页同时操作时，第二次写入可能基于过期判定（例如把已存在的身份重复登记）。

**新规则（定案，I-25 / §1.2.9）**：

1. 身份解析分两阶段：**阶段 1 事务外比较**（得 `reuse`/`register`/`degrade`/`refuse`），**阶段 2 事务内只做同步判定与写入**。
2. `mutate` 必须**同步复核基线**：`reuse` 要求事务读仍含该 `scopeId`；`register` 要求 `entries` 的 `scopeId` 集合与基线**逐字相同**。不符 → 返回 `'conflict'`，**不写任何键**。
3. `conflict` → 调用方**重跑阶段 1**，最多 **2 次**；仍冲突 → `disk-session('unassociated')`，提示「工作区记录正在被其他窗口更新，本次未记住这个文件夹」。
4. **两调用方从空库同时识别同一目录**：先提交者写入；后者事务读与基线（`empty`）不符 → `conflict` → 重解析时得到**唯一 `same`** → `reuse`，**不产生重复条目**。
5. **禁止**在 `mutate` 内 `await` 任何非 IDB 的 Promise。

**影响接口**：`RegistryMutate` 的返回值增加 `'conflict'`；`RegistryWriteResult` 增加 `{ kind: 'conflict' }`。

**影响后续包**：P0-0。

**源码锚点**：无（新增契约）；约束来自 IDB 事务自动提交语义与 `isSameEntry` 的异步性。

---

# 第四轮收口（复核 CR2-4A / CR2-4B + 口径校正，2026-09-20）

复核结论：CR2-1、CR2-2、CR2-3 **在设计复核范围内关闭**（v3 夹具五个定向场景实测：第二次 put 失败 / 第二次 delete 失败 / 读失败 / 主动 abort 均仅 abort、`commits=0`、两键保持旧值；正常场景仅 complete、两键更新；前两种明确观察到第一条写的 `onsuccess` 已发生）。CR2-4 的两调用方与冲突重试方向接受，但**两处测试代码不成立**。**不重做已关闭项。**

## CD-29 记录校验器必须强制全部不变量（CR2-4A）

**旧规则（被打回）**：`isRegistryRecord` 只检查「`activeScopeId` 为 `null` 或能命中某条 `entries`」；NC-5 的 `append` 直接 `[...base.entries, newActive]`，**旧条目仍为 `active`**；删除失败用例把 `activeScopeId` 置 `null` 却保留 `active` 条目。

**反例/缺口（复核实测）**：

```text
NC-5 append 结果：activeScopeId = ws:b，state=active 的条目 = [ws:a, ws:b]   ← 违反「active 唯一」
```

正确实现应当在写入前判为 `invalid`：于是**正例在进入并发验证之前就失败**（或反过来暴露校验器缺失）；删除失败用例则**在到达 delete 请求之前**就中止，**命不中「第二次 delete 失败」窗口**——测不到本来要测的东西。

**新规则（定案）**：不变量收紧为五条并全部强制（§1.2.3 已同步）：`v==1` / `scopeId` 过 `isScopeId` 且**唯一** / `active` **恰好一个**且等于 `activeScopeId` / `activeScopeId=null` ⇒ **无** active 条目 / 其余字段形状合法。任一条不满足 → `failed('invalid')`。**明确禁止**退化成「只检查 activeScopeId 是否存在条目」。

**测试侧要求**：并发与删除失败用例**先构造合法记录**（`legalAppend`：新条目 active、**旧条目一律转 dormant**；删除场景先转 dormant 再把 `activeScopeId` 置 `null`），再注入失败。正例两次写都必须先断言 `kind === 'ok'`（不得是 `invalid`），再核对「三条 ID 全在、唯一 active、其余 dormant」。

**影响接口**：`isRegistryRecord` 的判定强度（签名不变）。

**影响后续包**：P0-0（实现 + `★CR2-4A` 用例 + 同族用例修正）。

**源码锚点**：`handleStore.ts` 无对应实现（新增）；约束来自 §1.2.3 的不变量。

## CD-30 负控必须以正确期望通过、以非零退出转红（CR2-4B）

**旧规则（被打回）**：NC-5 负控写成

```ts
expect(ids).not.toEqual(['ws:a', 'ws:b', 'ws:c']);
expect(ids).toHaveLength(2);
```

**反例/缺口（复核实测）**：丢更新时的结果 `[ws:a, ws:c]` **两条断言都通过**——负控在「实现错误」时反而全绿，**不可能转红**；而正确实现（三条都在）会让这两条失败。也就是说它把「错误结果」当成了通过条件，方向完全颠倒。

**新规则（定案）**：

1. **正例与负控使用同一正确期望**：`ids == ['ws:a','ws:b','ws:c']` + 记录合法 + 唯一 active + 其余 dormant（共用一个 `expectThreeUpdates` 断言函数）。
2. 中性化**只**改「读 + 构造」的位置（测试侧复刻旧接口语义），**保留**两个独立实例与 `writeChain`，并用 barrier 保证两侧事务外读都完成后再写。
3. **转红判据是命令退出非零**：正确实现下正例与负控都通过；中性化后负控因少一条而 `AssertionError`、进程**退出非零**。**不得**把 expected failure 捕获成 exit 0 后再宣称「转红」。
4. **证据对象分别记录**：本负控证明「事务外读快照会丢更新」（逻辑反例）；要证明**生产写路径**受保护，必须中性化实现副本并**保留原调用方与正确断言**。

**影响后续包**：P0-0（NC-5 重写 + 收口判据）。

**源码锚点**：无。

## CD-31 NC-7 口径校正（次要）

**旧规则**：NC-7 用「`mutate` 内 `await Promise.resolve()`」代表「事务内等待外部 Promise」，并断言 `put` 会落在夹具结算之后。

**问题**：**单个微任务与真实 IDB 事务何时关闭没有普遍对应关系**；由自制夹具的时序**外推浏览器行为**属过度推断（复核明确要求校准）。

**新规则（定案）**：

1. **（a）可落地的契约测试**：`mutate` 的返回类型是同步值，**不接受 Promise**；返回 Promise → `isRegistryRecord` 判为非记录 → `failed('invalid')`、不写任何键。期望三处固定（`failed('invalid')`、裸键不变、注册表不变），中性化（`await mutate(...)`）后必红。
2. **（b）事务生命周期**：「活跃事务内等待跨任务延迟会导致自动提交 / `TransactionInactiveError`」**必须**在 `fake-indexeddb` 或真实浏览器上用**跨任务延迟**单独验证并记录；**不得**用自制夹具外推，也不得写成已验证。
3. 同次校正：把仍写「三条负控」/旧用例数的统计与标题按最终集合更新（NC-1…NC-7；`workspace-scope` 9 例、`handle-store` 新增 14 例、`directory-host` 新增 17 例），**不靠固定数量判通过**。

**影响后续包**：P0-0（NC-7 重写 + 统计口径）。

**源码锚点**：无。

---

# 第五轮收口（第三轮复核 CR2-4B 执行编排 + 两处文案同步，2026-09-20）

复核结论（`docs/dispatch/2026-09-20-file-assets-contract-close-review3.md`，证据 `outputs/file-assets-contract-review-20260920-03/`）：**CR2-4A 已接受**（`legalAppend` 转 dormant、删除失败用例先构造合法 dormant 记录）·**CR2-4B 的正确断言已接受**（`expectThreeUpdates` 恢复）·**NC-7 的证据分层已接受**。**唯一剩余问题**：NC-5 的旧快照反例被要求「原样进正式套件且正常时通过」，与代码行为矛盾。**已关闭项不重开。**

## CD-32 NC-5 拆为三入口编排（执行编排修正）

**旧规则（被打回）**：计划要求「两段代码加入 `handle-store.test.ts`」且「正确实现：正例与负控都通过」。

**反例/缺口（复核实跑）**：从 v4 原文提取 NC-5 代码块，对**同一正常事务模型**跑两个子进程：

| 子进程 | 写入模型 | 实际记录 | 断言 / 退出码 |
|---|---|---|---|
| positive | 正常事务内 RMW | `a`、`b`、`c`；唯一 active=`c` | PASS / **0** |
| negative | 同一正常模型，原文调用方预构造旧快照 | `a`、`c`；唯一 active=`c` | AssertionError / **1** |

两份记录均通过不变量检查；负控失败恰为缺失 `b`。根因：`outOfTxAdd` 的调用方**无条件**用事务外旧快照构造 `next`，并让 `mutate` **忽略事务内最新 `prev`** —— 因此它在**正确实现下也必然丢一条**。按原文实施会把一条**必红用例**带进默认门禁（无需实现有缺陷即可失败）。

**新规则（定案）**——三个入口，三种证据对象：

| # | 入口 | 载体 | 默认 `vitest run` 收集 | 预期 | 证据对象 |
|---|---|---|---|---|---|
| 1 | 并发回归（正式套件） | `tests/handle-store.test.ts` | **是** | PASS / 退出 0 | 生产实现的正常调用方 |
| 2 | 调用方旧快照**逻辑反例** | `tests/counterexamples/nc5-legacy-snapshot.counterexample.ts` | **否** | **FAIL / 非零**（**常态必红**） | **调用方写法**会丢更新（同一正常实现） |
| 3 | 生产实现**中性化验证** | `tests/counterexamples/nc5-neutralized-impl.counterexample.ts` + 隔离实现副本 | **否** | FAIL / 非零（正常副本先跑 PASS / 0） | **事务内读 + 合并是保护来源** |

- 专用入口：`packages/react/vitest.counterexamples.config.ts`（`include: ['tests/counterexamples/**/*.counterexample.ts']`）+ `"test:counterexamples": "vitest run --config vitest.counterexamples.config.ts"`；`test` 脚本保持 `vitest run` 不变。
- 共用夹具放 `tests/helpers/registryConcurrency.ts`（非 `*.test.ts`，不被默认收集）。
- **入口 2 与入口 3 的区别必须写进证据**：入口 2 = 生产实现 + 旧调用方（展示旧写法之害）；入口 3 = 生产调用方 + 中性化实现副本（证明保护来源）。
- 入口 3 的隔离副本属**一次性证据**，留证后移除，理由写入回执。
- **禁止**：`it.fails` / `test.fails`、反转断言、`catch` 后打印 PASS、宽泛 `skip`、用父级收集程序的 exit 0 冒充反例退出 0。

**影响接口**：无（测试编排与脚本）。

**影响后续包**：P0-0（新增 config 与 script、三个入口、双跑留证）。

**源码锚点**：`packages/react/vitest.config.ts:6`（`include: ['tests/**/*.test.{ts,tsx}']` → 反例文件名不匹配该模式，默认不被收集）；`packages/react/package.json:19-23`（`scripts`，`fake-indexeddb ^6.2.5` 在 devDependencies，供 NC-7(b) 校准）。

## CD-33 不变量条件化（文案同步）

**旧规则**：`state === 'active'` 的条目**恰好一个**（无条件），且其 `scopeId === activeScopeId`。

**问题**：无条件表述与**空库**（`{v:1, activeScopeId:null, entries:[]}`）及 **`detach()` 之后**（`activeScopeId=null` + 条目全 `dormant`）冲突 —— 这两类合法状态会被自判为非法，首次挂载与断开都无法落盘。

**新规则（定案）**：**条件化** —— `activeScopeId !== null` ⇒ `state==='active'` 的条目**恰好一个**且其 `scopeId === activeScopeId`；`activeScopeId === null` ⇒ **没有任何** active 条目。同步更新 `shared-contracts.md` §1.2.3 不变量 3 与计划 §4.1 步骤 2；`★CR2-4A` 用例补「空库」「detach 后」两条**合法**断言。

**影响后续包**：P0-0（`isRegistryRecord` 实现与用例）。

## CD-34 计数/标题以行为为准（文案同步）

计划 §5 标题原写「阴性对照设计（**三条**，必须实际跑过并失败）」，与 NC-1…NC-7 不符；§8 的「负控 = §5 三条」同。**新规则**：标题改「NC-1…NC-7，共七条」，并显式写明**计数以行为为准，不以条数判通过**；§5 纪律补第 4 问「转红时命令是否真的退出非零」。
