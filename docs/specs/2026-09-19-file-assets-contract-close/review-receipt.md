# review-receipt：FILE-ASSETS-CONTRACT-CLOSE 回执

任务：FILE-ASSETS-CONTRACT-CLOSE｜日期：2026-09-20（含 2026-09-19 两轮）｜状态：**契约补正方向可接受；P0-0 实施计划已完成 R1–R4、CR2-1…CR2-4、CR2-4A/CR2-4B 与 NC-5 执行编排四轮定向返修，待复核**

> **复核历史**：
> - **第一轮**（2026-09-19）：契约补正方向基本成立，P0-0 计划**暂不能放行实施** → 定向返修 R1–R4 + 两项口径（见 §2.5）。
> - **第二轮**（2026-09-20）：接口返修方向成立（原子更新、四态读、事务内 mutate、`requestPermission` 接线保留，TS1119 已消失），但 P0-0 仍需四项修订 CR2-1…CR2-4（见 §2.6）。证据留档 `outputs/file-assets-contract-review-20260920-01/`。
> - **第三轮**（2026-09-20）：**CR2-1、CR2-2、CR2-3 在设计复核范围内关闭**（v3 夹具五个定向场景实测通过）；CR2-4 方向接受，但 NC-5 两处测试代码不成立（见 §2.8）。证据留档 `outputs/file-assets-contract-review-20260920-02/`。
> - **第四轮**（2026-09-20）：**CR2-4A 合法记录构造、NC-7 证据分层、CR2-4B 正确断言全部接受**；仅剩 NC-5 的**执行编排**问题（旧快照反例被要求进正式套件且「正常通过」），见 §2.10。证据留档 `outputs/file-assets-contract-review-20260920-03/`。
> - **编号对照（避免混淆）**：本回执按「返修轮次」编号（§2.5 第一轮 / §2.6 第二轮 / §2.9 第三轮 / §2.10 第四轮），复核方文档按「复核文档序号」。对照如下，**以文件路径为准**：
>
> | 复核文档 | 自题 | 其发现 | 对应本回执 |
> |---|---|---|---|
> | `docs/dispatch/2026-09-19-file-assets-contract-close-review.md` | 「第二轮返修复核」 | CR2-1…CR2-4 | §2.6（修复） |
> | `docs/dispatch/2026-09-20-file-assets-contract-close-review2.md` | 「P0-0 计划 v3 定向复核」 | CR2-4A / CR2-4B / NC-7 口径 | §2.9（收口） |
> | `docs/dispatch/2026-09-20-file-assets-contract-close-review3.md`（用户称「第三轮复核报告」） | 「FILE-ASSETS-CONTRACT-CLOSE v4 定向复核」 | NC-5 执行编排 | §2.10（收口） |
> - 本回执记录的是**四轮返修后**的状态。
> - 各轮复核方均**未修改交付者文档或产品源码、未跑全仓门禁**。
> - **返修不改变已确认的设计方向**：注册表新键、`isSameEntry` 唯一证据、8 条上限、同名三选、三轴分离、操作租约、P0-0 不含保存/资产/索引/UI。

> **本轮复核实跑证据（引用，非本轮重跑）**：
> - `duplicateTS1119 = 0`（原 TS1119 已消失；**仅针对该诊断，不代表片段完整类型检查或行为正确**）。
> - `exactFixtureReadFailure = { abortType:"undefined", readFailed:true, completed:true, stored:"after" }` → v2 夹具读取失败后仍提交，**不能证明 R1 原子性**。
> - `nc5SchedulingCounterexample = { writeChainRetained:true, transactionOutsideRead:true, result:["a","b","c"] }` → 同页 `Promise.all` 被 `writeChain` 遮蔽，**旧 NC-5 不会转红**。

> **第三轮复核实跑证据（引用，非本轮重跑）** —— `outputs/file-assets-contract-review-20260920-02/results.json`，输入 `p0-0-implementation-plan.md` SHA-256 `438f0fe3f513c2afbe9bbfcad1a76e836430b45f4608b654cc59990567a5a8ca`：
> - `exactV3FixtureCalibration` 五场景：`second-put-fails` / `second-delete-fails` / `read-fails` / `explicit-abort` 均 `events=["abort"]`、`commits=0`、`registry="old-registry"`、`root="old-root"`；`success` 为 `events=["complete"]`、`commits=1`、两键更新；前两场景 `firstWriteSucceeded=true`。
> - `exactNC5Append = { activeScopeId:"ws:b", activeIds:["ws:a","ws:b"], violatesSingleActiveInvariant:true }` → **正例构造了非法记录**（CR2-4A）。
> - `printedNC5Assertions = { lostUpdate:["ws:a","ws:c"], assertionsPass:true }` → **负控把错误结果写成通过期望**（CR2-4B）。
> - `limits`：仅提取计划片段与定向场景，**非完整 TypeScript 检查、非产品/浏览器验证**。

> **第四轮复核实跑证据（引用，非本轮重跑）** —— `outputs/file-assets-contract-review-20260920-03/results.json`，输入 `p0-0-implementation-plan.md` SHA-256 `4d8220a92219b293b72fe147d51c90b94104d24bf51fba4232f8d3ce11384a08`，原代码块 SHA-256 `a2570aab44b6857294ddabaccf0c4f21a433ebf734c6cf2e48a8b613095ce96d`（复现：`node outputs/file-assets-contract-review-20260920-03/check-v4.cjs`）：
> - `positive`：`exitCode=0`，记录含 `ws:a`(dormant)/`ws:b`(dormant)/`ws:c`(active)，`valid=true`，`outcome=PASS`。
> - `negative`：`exitCode=1`，记录仅含 `ws:a`(dormant)/`ws:c`(active)，`valid=true`，`outcome=FAIL`；stderr `AssertionError … [ 'ws:a', 'ws:c' ]`（缺 `ws:b`）。
> - **结论**：负控**在正常模型下即失败** → 它是「调用方旧快照写法」的逻辑反例，**不是**「中性化后转红」的对照；不能进默认门禁。
> - `evidenceScope`：**对最小事务模型转译执行计划原文测试体，非生产模块验证、非自制 IDB 夹具校准、非 TypeScript 检查、非浏览器测试**。**父级收集程序正常结束不等于负控退出 0**——退出码取自子进程本身。

---

## 1. 结论

T0–T5 六项检查点全部完成，并按复核意见完成 R1–R4 定向返修与两项口径补充。本轮**只改设计与计划**，未改产品源码/正式测试/门禁/验收脚本，未迁移数据，未提交/暂存/推送/发布，未启动 P0-0 实施。

闭合的五项核心问题（任务书点名）：

| # | 问题 | 闭合方式 |
|---|---|---|
| 1 | 工作区身份不是明确方案 | 选定**显式注册表**（新键 + 单事务 + 裸键兼容），八类场景定行为，且明确**收窄**「任意重挂载都保留身份」的承诺（CD-01…CD-05） |
| 2 | 同名同大小同时间戳 ≠ 相同字节 | `size`+`mtime` 只做预筛选；首期**不做去重**；同名一律三选、默认「保留两份」（CD-07 / CE-03） |
| 3 | `persisted` 被读成可携带 | 删除该术语；三轴分离为**写入结果 × 存储位置 × 可携带性**（CD-08 / I-12） |
| 4 | 「清定时器 + waitForIdle」不是互斥 | **操作租约**（归属 `DocumentSaveSession`）+ 跨会话物理写计数 + 每 await 归属校验 + 条件释放（CD-12…CD-14 / CE-07 / CE-14） |
| 5 | 部分成功后的撤销/重试无保护 | 目的地定为**新文件**；撤销副本受「已编辑/已写入」保护；重试删源前复查外部修改（CD-15 / CE-08 / CE-09） |

另闭合：旧路径唯一同名命中不构成归属证据（CD-06 / CE-06）、删除新键不是无损回退（CD-09 / CE-10）、内存 scope 与旧引用字符串的连接（CD-11 / CE-11）、P0-0 不留空实现与公共类型位置（CD-16）。

---

## 2. 执行摘要（T0–T5 对照）

| 检查点 | 状态 | 产物 |
|---|---|---|
| T0 固定调查起点与变更边界 | 完成 | `baseline.md`（HEAD、工作树 126 条（开工时）、关键输入 SHA-256、七份文档可改范围、UD/DS 分层） |
| T1 关闭身份与迁移契约 | 完成 | `shared-contracts.md` §1.2（注册表/证据/收窄/八场景）、§6.2（M1–M11）、§6.2.1（归属证据）、§6.3（回退与降级投影）；`contract-delta.md` CD-01…CD-06/CD-09 |
| T2 关闭资产写入、解析与同名契约 | 完成 | `shared-contracts.md` §1.5.1（I-10/I-11）、§1.7（I-12）、§3.4、§4.5（结果类型/同名/记账）；`asset-library.md` §1.2、§2.3、§4.1、§4.3、§4.7、§4.8、§4.9、§6.2、§10；CD-07/08/10/11 |
| T3 关闭改名/移动与保存的并发契约 | 完成 | `shared-contracts.md` §3.2、§3.3.1、§3.5（租约/物理写/编辑策略/释放）、§3.6（目的地唯一事实源）、I-14…I-20；`file-management.md` §3.3、§4、§5.3；CD-12…CD-15、CD-17、CD-18 |
| T4 修正分包与编制 P0-0 实施计划 | 完成 | `acceptance-and-backlog.md` §3.1（新增验收 L1–L4/S1–S3/R1/N1–N4）、§4.1（测试文件认领表）、§5（重排拆包 + 责任归属原则）、§6（收口判据 6–8）；`p0-0-implementation-plan.md`（逐任务） |
| T5 一致性复核与交付 | 完成 | `contract-delta.md`、`counterexamples.md`、本文件；七份旧文档逐处校正；历史回执追加勘误（`design-review-receipt.md` §10） |

### 2.5 复核打回与返修记录（R1–R5 + 两项口径）

| 编号 | 复核问题 | 返修内容 | 落点 |
|---|---|---|---|
| **R1** 阻断 | `detach()` 不是原子操作：先更新注册表再单独 `deleteDirectoryHandle()` → 「注册表 dormant、裸句柄仍在」或反向分叉 | 注册表变更与裸键处置（写/删/不动）**必须同一事务**；`detach()` 改为 `writeWorkspaceRegistry(markDormant, { kind: 'delete' })`，**移除**对 `deleteDirectoryHandle()` 的调用（该函数作为公开 API 保留）。新增 R1 正/负用例 | `shared-contracts.md` §1.2.3；计划 §4.2 签名+要求、§4.4 行为表、R1 用例×2；CD-19 |
| **R2** 阻断 | 读失败与空注册表混淆：把 `null`/`undefined` 都判 `empty` → 存储故障被误判为空库并触发 legacy adoption | 读改为**四态** `ok`/`empty`/`corrupt`/`unavailable`；新增可报告失败的读取原语（不复用 `getRaw`）；`unavailable` 时**不 legacy adoption、不写任何键**，本次为 `disk-session('registry-unavailable')` | `shared-contracts.md` §1.2.3（I-24）、§1.2.5、§1.2.6；计划 §4.2；验收 §2 G16、§3.1 S1；CD-20 |
| **R3** 阻断 | `writeWorkspaceRegistry(record, legacyHandle)` 接收已构造好的完整记录，无法做「同事务读取旧记录、合并、写回」 | 接口改为 `writeWorkspaceRegistry(mutate, legacy)`：**单事务 read-modify-write**；新记录非法 → 中止并 `failed('invalid')`；另加本页串行链 | `shared-contracts.md` §1.2.3；计划 §4.2；CD-21 |
| **R4** 必须修正 | 计划的 IDB 测试替身**无法编译**（同时声明 `set onerror` 与 `onerror` → TS1119） | 替身改为**只用属性、不用 accessor**；实现「多 put + 事务串行 + `get` 结果在 `onsuccess` 才可读 + `fail.{open,read,write}` 注入」；明确既有 15 用例断言不得改 | 计划 §4.2 夹具 v2；CD-22 |
| **R5** 必须修正 | 设计要求 `isSameEntry` 缺失时进入人工关联，P0-0 又说不做该 UI → 两种行为并存 | 分期写清：**P0-0 保守降级为 `disk-session('unassociated')`（注册表与裸键都不写）**；**P1-A** 提供人工关联；在此之前**不得声称恢复了旧工作区身份**。附已知代价（每次重选） | `shared-contracts.md` §1.2.8；计划 §4.4「关联不可证明的分期策略」；验收 §2 G13；CD-23 |
| **口径 A** | `requestPermission()` 是另一条重新挂载路径，未规定是否复用注册表与 scope 逻辑 | 新增 **I-23 单一路径**：`restore`/`pick`/`requestPermission` 共用私有 `resolveScopeForIdentity`；`requestPermission` 在已挂载时不改 `scopeId`、不变 `epoch` | `shared-contracts.md` §1.2.6 I-23、§4.2；计划 §4.4 行为表 + 两条 I-23 用例；CD-23 |
| **口径 B** | 状态表述 | 本回执头部改为「契约补正方向可接受；P0-0 计划已完成 R1–R4 返修，待复核」 | 本文件头部 |

**返修后新增/变更的验收与负控**：

- 验收 `S1` 扩到 9 个动作（含 `unavailable`、关联不可证明、`requestPermission` 一致性）与 4 条负控；降级表新增 `G16`，改写 `G13`。
- 负控由 3 条扩到 **5 条**：NC-1 注册表写回裸键、NC-2 按名称判同一性、NC-3 损坏折叠成 empty、**NC-4 读失败折叠成 empty**、**NC-5 事务外构造记录**。
- P0-0 出口由 8 条扩到 **12 条**（新增 E-7…E-11）。

### 2.6 第二轮复核打回与返修记录（CR2-1…CR2-4）

| 编号 | 复核问题（附实测/锚点） | 返修内容 | 落点 |
|---|---|---|---|
| **CR2-1** | 全部 `different` 被当作 `unknown` → **正常选择第二个目录 B 也不持久化**。复核锚点：计划 `:677/:687/:724`、`shared-contracts.md` §1.2.6。原 A→B→A 用例只看内存 id，**漏掉了「B 曾被持久登记」** | 判定表改为四档：`reuse`（唯一 `same`）/ `register`（`empty`、`entries` 为空、**或全部 `different`**）/ `degrade`（无 `same` 且存在 `unknown`）/ `refuse`（多个 `same`）。明确「键存在但 `entries` 为空」= 合法空库。新增断言：B 为 `disk/persisted`、`active=B`、`A=dormant`、裸键=`B`、刷新仍为 B、再选 A 恢复原 ID | `shared-contracts.md` §1.2.6/§1.2.9；计划 §4.4 判定表 + `★CR2-1` 用例；NC-6；CD-24 |
| **CR2-2** | 夹具**没有 abort**：复核实测 `abortType=undefined`、`readFailed=true`、`completed=true`、`stored='after'`——读取失败后仍执行 put 并提交；`fail.write` 只在整笔开始前失败，覆盖不到「第一条写成功、第二条失败」 | 夹具 **v3**：写请求**暂存**、`oncomplete` 发布、`abort` 丢弃；任一请求失败**自动 abort**；支持 `tx.abort()`/`onabort`；`oncomplete`/`onabort` **互斥结算**；`commitCount` 供断言「oncomplete 未触发」；`fail.writeAt = N` 命中关键窗口。新增 3 条用例（写入失败 / 删除失败 / `mutate` 抛错） | 计划 §4.2 夹具 v3 + 用例；CD-25 |
| **CR2-3** | 两条宿主测试期望与前提不成立：① `unassociated` 用例先写裸键却断言其为 `null`，且用 `JSON.stringify` 深比较含句柄对象；② `unavailable` 用例把**整个 IDB open** 设为失败，此时连裸句柄都取不回，不具备挂载前提 | 夹具增 `fail.readKey`（**只**让某个键读失败，裸键仍可读）；`unavailable` 拆三段：**只注册表读失败 + 裸键可读 → 可挂载降级**、**整存储不可读 → `restore()=false` 未挂载**、**picker 已给句柄 + 注册表读失败 → 会话挂载**。断言改为**只断言可读目标**（句柄 `name`、`activeScopeId`、`scopeId` 列表）。补脚手架：`handleOf`/`sameByLabel`/`patchPicker`/`PERM`/`reboot`/`resetFixture` | 计划 §4.4 脚手架 + 三条用例；CD-26 |
| **CR2-4** | NC-5 受同页 `writeChain` 遮蔽：复核最小调度反例证明「事务外读 + 保留串行链」结果仍为 `['a','b','c']`，负控**不会转红**；且未规定「异步比较与事务内变更之间的复核」 | NC-5 改为**两个独立 production 模块实例**（共用夹具数据库、**不共享** `writeChain`）+ **受控 barrier**；夹具共享态上移到 `globalThis`（真实 IDB 串行是**每库**的）。新增 **I-25 两阶段解析**：阶段 1 事务外比较、阶段 2 事务内**同步**基线复核 → 不符返回 `'conflict'` → 重解析**最多 2 次** → 仍冲突降级；给出「两调用方从空库同时识别同一目录」的口径并配用例。`RegistryMutate` 增 `'conflict'`，`RegistryWriteResult` 增 `{kind:'conflict'}` | `shared-contracts.md` §1.2.9 I-25；计划 §4.2 类型/夹具、§4.4 步 3 + 2 条用例、§5 NC-5 重写；NC-7；CD-27/28 |

**返修后新增/变更的验收与负控（第三轮）**：

- 验收 `S1` 扩到 **11 个动作**（新增 ⑩ A→B 且可证明不同、⑪ 两调用方同时识别同一目录）与 **6 条负控**（新增 ⑤ 合并 different/unknown、⑥ 同页 `writeChain` 假负控）。
- 负控由 5 条扩到 **7 条**：新增 **NC-6**（「明确不同」并入「无法判定」）、**NC-7**（事务内 `await` 外部 Promise）。
- P0-0 出口由 12 条扩到 **16 条**（新增 E-13…E-16）。（第三轮再扩到 **18 条**，见 §2.9；第四轮扩到 **19 条**，见 §2.10。）
- 用例数：`handle-store` 新增 **13** 条，`directory-host` 新增 **17** 条。（第三轮后 `handle-store` 为 **14** 条，见 §2.9。）

### 2.7 本轮纠正的两条**错误计划断言**（原文与理由）

| # | 被纠正的计划断言 | 为什么错 | 改为 |
|---|---|---|---|
| 1 | `expect(await getDirectoryHandle()).toBeNull(); // 裸键也没写`（`unassociated` 用例） | 该用例**先经 `pick` 成功挂载 A**，`pick` 已把 A 的裸键写入 IDB；降级分支「不写」指**本次不写**，不是「清空既有键」。原断言把「未写」误当「不存在」，且用 `JSON.stringify` 对含句柄/函数的对象做深比较，结论不可信 | 断言**可读目标**：注册表 `activeScopeId` 与 `scopeId` 列表保持原值 + `(await getDirectoryHandle())?.name === 'A'` |
| 2 | `fail.open = true; await host.restore(); expect(...disk-session('registry-unavailable'))`（`unavailable` 用例） | `fail.open` 让**整个 IDB open 失败**，此时连旧裸句柄也读不回，`restore()` 没有可挂载的根句柄——期望与前提自相矛盾。原用例把「存储整体不可用」与「只注册表读失败」混为一谈 | 拆三段：① **只** `fail.readKey = WORKSPACE_REGISTRY_KEY` + 裸键可读 → `restore()=true` 且降级 `registry-unavailable`；② `fail.open = true` → `restore()=false`、未挂载、`scopeState.kind==='browser'`；③ picker 已给可用句柄 + 注册表读失败 → 会话挂载且**裸键未被改写** |

**这两条是设计测试的修正，不反转任何已经正确的产品断言**；既有 30+ 条 `directory-host` 用例与 15 条 `handle-store` 用例的期望**一律不变**。

### 2.8 第三轮复核的关闭项与剩余项

| 项 | 状态 | 依据 |
|---|---|---|
| CR2-1（明确不同必须登记新身份） | **关闭** | 复核方判为计划审阅通过：四档判定已区分「明确不同」与「无法判定」，B 的持久登记/active-dormant/裸键/刷新恢复/回到 A 的期望齐全 |
| CR2-2（夹具 abort 与原子回滚） | **关闭** | 复核方**直接提取原文 v3 夹具**跑五个定向场景：第二次 put 失败、第二次 delete 失败、读失败、主动 abort 均仅 abort、`commits=0`、两键保持旧值；正常场景仅 complete、两键更新。**不要求夹具实现完整 IDB** |
| CR2-3（两条宿主测试期望/前提） | **关闭** | 「保留 A 裸键」与「本次不写键」已区分；`unavailable` 已拆成三种场景。**本轮不反转这些正确期望** |
| CR2-4（两调用方 + conflict 重试方向） | **方向接受**；两处测试代码不成立 | 见 §2.9 |
| NC-7 口径 | 需校正 | 见 §2.9 |

**已关闭项不重做**：本轮回执不重新论证 CR2-1…CR2-3，也不改动它们的断言。

### 2.9 第三轮收口：两处测试代码修正 + 一处口径校正

| # | 复核问题（附实测） | 修正 | 落点 |
|---|---|---|---|
| **CR2-4A** | **并发正例构造了非法记录**：`append` 追加新 active 条目时旧条目仍为 active。复核实测 `activeScopeId=ws:b`、`state=active` 的条目 `=[ws:a, ws:b]`，违反「active 唯一」。正确的校验器会判 `invalid` → **正例在进入并发验证前就失败**（若反而通过，说明校验器缺失） | ① **不变量收紧为五条并全部强制**（`v==1` / `scopeId` 唯一 / active **恰好一个**且等于 `activeScopeId` / `activeScopeId=null` ⇒ 无 active / 其余形状合法）；② 测试侧改用 **`legalAppend`**（新条目 active，**旧条目一律转 dormant**）；③ 正例两次写**先断言 `kind==='ok'`**，再核对三条 ID 全在、唯一 active、其余 dormant；④ **同族删除失败用例先构造合法 dormant 记录**（`activeScopeId=null` + 条目全 dormant）以命中「第二次 delete 失败」窗口；⑤ 新增 `★CR2-4A` 用例直测五条不变量 | `shared-contracts.md` §1.2.3 不变量；计划 §4.1 步骤 2 + 用例、§5 NC-5 代码、§4.2 删除失败用例；CD-29 |
| **CR2-4B** | **负控把错误结果写成通过期望**：`expect(ids).not.toEqual([a,b,c])` + `toHaveLength(2)` —— 丢更新时（`[ws:a,ws:c]`）**两条都通过**；正确实现反而失败 | 正例与负控**共用同一正确期望** `expectThreeUpdates`（三条全在 + 记录合法 + 唯一 active + 其余 dormant）；中性化**只**改「读 + 构造」位置，保留两实例与 `writeChain`，barrier 保证两侧事务外读都完成后再写；**转红判据是命令退出非零**；并分别标注证据对象（逻辑反例 vs 生产写路径副本） | 计划 §5 NC-5 + 收口判据；CD-30 |
| **口径校正** | NC-7 用「`mutate` 内 `await Promise.resolve()`」代表事务边界：**单个微任务与真实 IDB 事务关闭没有普遍对应关系**，属夹具时序外推 | 拆两部分：**(a) 可落地的契约测试** —— `mutate` 必须**同步返回**，返回 Promise → `failed('invalid')`、不写任何键（新增 `CR2-4C` 用例，三处期望固定）；**(b) 事务生命周期** —— 需在 `fake-indexeddb` 或真实浏览器上用**跨任务延迟**单独校准，**不得**外推、不得写成已验证 | 计划 §5 NC-7；CD-31 |
| 统计口径 | 仍写「三条负控」与较旧用例数 | 按最终集合更新：**NC-1…NC-7**；`workspace-scope` **9** 例、`handle-store` 新增 **14** 例、`directory-host` 新增 **17** 例；**不靠固定数量判通过** | 计划 §6.1、§8；本回执 §2.8/§8 |

**第三轮新增/变更的计数**：P0-0 出口由 16 条扩到 **18 条**（新增 E-17 不变量强制、E-18 负控纪律）；负控仍为 **7 条**（NC-7 改写而非新增）。

### 2.10 第四轮收口：NC-5 执行编排（唯一剩余项）+ 两处文案同步

**已接受、本轮不返工**：`legalAppend` 将旧条目转 dormant + 正例先断言两次 `ok` + 删除失败用例先构造合法 dormant 记录（**CR2-4A**）；`expectThreeUpdates` 恢复同一正确期望、不再把丢更新写成通过条件（**CR2-4B** 断言部分）；同步 `mutate` 契约与真实事务生命周期分离（**NC-7**，1373–1397 行）。

| # | 复核问题（附复核实跑） | 修正 | 落点 |
|---|---|---|---|
| **CD-32** | **唯一剩余执行编排问题**：旧快照负控被要求「原样加入 `handle-store.test.ts`」且「正确实现时通过」（原文 1352、1354 行）。复核方从 v4 提取原文代码块对**同一正常事务模型**跑两子进程：positive = `a,b,c`、唯一 active=`c`、**PASS/0**；negative = `a,c`、唯一 active=`c`、**AssertionError/1**；两份记录均通过不变量检查，失败恰为缺失 `b`。根因：`outOfTxAdd` 调用方**无条件**用事务外旧快照构造 `next` 并让 `mutate` 忽略事务内最新 `prev` → **正确实现下也必丢一条**，进正式套件会把一条必红用例带进默认门禁 | **拆三入口**：**① 并发回归**（正常调用方）留在 `tests/handle-store.test.ts`，**进默认门禁**、预期 PASS/0；**② 调用方旧快照逻辑反例** → `tests/counterexamples/nc5-legacy-snapshot.counterexample.ts`，**常态必红**、预期非零；**③ 生产实现中性化验证** → `tests/counterexamples/nc5-neutralized-impl.counterexample.ts` + 隔离实现副本，正常副本先跑 PASS/0、中性化副本非零。新增 `vitest.counterexamples.config.ts`（`include: ['tests/counterexamples/**/*.counterexample.ts']`）与 script `test:counterexamples`，`test` 保持 `vitest run`；共用夹具移 `tests/helpers/registryConcurrency.ts`。**明确区分**入口 ②（调用方写法之害）与入口 ③（写路径保护来源）；副本属一次性证据，留证后移除并写入回执。**禁止** `it.fails`、反转断言、`catch` 后报 PASS、宽泛 `skip`、用父级 exit 0 冒充反例退出 0 | 计划 §5 NC-5（含入口编排表、专用 config、运行命令、三入口对照）、§6.1 E-19、§8 停止点、§10 收口判据；CD-32 |
| **CD-33** | 不变量写成**无条件**「active 恰好一个」，与**空库**及 **`detach()` 后**（`activeScopeId=null` + 全 dormant）这两类合法状态冲突 | **条件化**：`activeScopeId !== null` ⇒ active **恰好一个**且 ID 匹配；`activeScopeId === null` ⇒ **零 active**。`★CR2-4A` 用例补「空库」「detach 后」两条**合法**断言 | `shared-contracts.md` §1.2.3 不变量 3；计划 §4.1 步骤 2 与用例；CD-33 |
| **CD-34** | 计划 §5 标题仍写「阴性对照设计（**三条**…）」，§8 写「§5 三条」，与 NC-1…NC-7 不符 | 标题改 **「NC-1…NC-7，共七条」**并写明**计数以行为为准、不以条数判通过**；§5 纪律补第 4 问「转红时命令是否真的退出非零」；§8 表同步 | 计划 §5 标题/纪律、§8 表；CD-34 |

**第四轮新增/变更的计数**：P0-0 出口由 18 条扩到 **19 条**（新增 E-19 三入口编排）；负控仍为 **7 条**（NC-5 改为分入口运行，条数不变）；新增 1 个专用 config 与 1 条 script；**正式套件的默认收集范围不变**（`tests/**/*.test.{ts,tsx}`）。

**计划修订世系（`p0-0-implementation-plan.md` 的 SHA-256，供审计「哪一轮看的是哪一版」）**：

| 版本 | SHA-256 | 说明 |
|---|---|---|
| v3 | （见第二轮复核证据 `outputs/file-assets-contract-review-20260920-02/results.json`） | 第三轮复核的输入 |
| **v4** | **`4d8220a92219b293b72fe147d51c90b94104d24bf51fba4232f8d3ce11384a08`** | **第四轮复核的输入**（证据 `...-03/results.json` 的 `inputSha256`；原 NC-5 代码块 `a2570aab44b6857294ddabaccf0c4f21a433ebf734c6cf2e48a8b613095ce96d`） |
| **v5** | **`faf45cf84038c8b602e5ac8a1fd8606fabcce09a6f1d06ef2c8bb2697bc3a765`** | **本轮交付（四轮返修后）**，含 CD-32…CD-34。复核时若指纹不同，说明有后续改动 |

其余交付文件本轮指纹：`contract-delta.md` `d0fb4ed7901035433ef628947bf611c210711ee641f355d3b8bb9f4cb79eb360`、`counterexamples.md` `38a2695e6205e30195de0a3c805598d32ce226426640c05bf34ff3d8054d2b54`、`baseline.md` `df945562ebf1696ae7d80efc13906b1f3333ed112a5525b22425d34bcae5a766`、`review-receipt.md`（本文件，随本轮追加而变）。七份设计文档中本轮只改两份：`shared-contracts.md` `98ed8d54c21e3b43faa0b5fe82fbc1f180741abc98aeb4d6e224fdd2c2c2ad0f`（§1.2.3 不变量条件化）、`acceptance-and-backlog.md` `160535a865cac2a570efb54fff02062abfd0782082bb8cfa01567c7ad6ba8d86`（§6 判据 2 增第 (c) 条）。

---

## 3. 已读文件

### 3.1 本轮为补正而**新读**的源码

```text
packages/react/src/edit/handleStore.ts                 （全文 190 行）
packages/react/src/edit/directoryTypes.ts              （全文 84 行）
packages/react/src/edit/directoryHost.ts               （L25-165、L200-410，含 writeAsset/readAssetFile）
packages/react/src/edit/docLibrary.ts                  （L1-130、L300-320）
packages/react/src/chrome/assetHost.ts                 （全文 104 行）
packages/react/src/chrome/idbAssetHost.ts              （全文 163 行）
packages/react/src/chrome/workspaceAssetHost.ts        （全文 124 行）
packages/react/src/chrome/AssetPanel.tsx               （L20-140）
packages/react/src/chrome/assetTypes.ts                （全文 24 行）
packages/react/src/chrome/assetDiagnostics.ts          （全文 30 行）
packages/react/src/index.ts                            （L325-365，导出面模式）
packages/react/package.json / vitest.config.ts / tsconfig.json
packages/react/tests/handle-store.test.ts              （全文 237 行，用于设计注册表测试）
apps/canvas/package.json / vitest.config.ts（存在性）
apps/canvas/src/SidePanels.tsx                         （L28-178，三条插入分支）
apps/canvas/src/hooks/useDocumentSaveSession.ts        （L20-160）
.dependency-cruiser.js（全文）/ package.json（根）/ pnpm-workspace.yaml / tsconfig.base.json
docs/specs/2026-09-19-file-assets-design/ 七份文档（当前版本，含他方修订）
docs/dispatch/2026-09-19-delivery-close-final-acceptance.md
docs/superpowers/plans/2026-09-19-file-assets-contract-close.md
docs/dispatch/2026-09-19-file-assets-contract-close-start.md
```

### 3.2 复用上一包已读的锚点（未重读全文）

`apps/canvas/src/FileManager.tsx`、`FileManagerTree.tsx`、`FileManagerModal.tsx`、`fileTreeModel.ts`、`fileManagerShared.ts`、`documentLifecycle.ts`、`useAutoSave.ts`、`useDocumentActions.ts`、`useUnsavedTransition.ts`、`MindmapStage.tsx`；`packages/react/src/render/NodeG.tsx`、`nodeIcon.ts`、`assetRef.ts`、`dropSensing.ts`；`packages/kernel/src/protocol/serializer.ts`。这些文件的引用均来自 `current-state.md` 的锚点表，本轮**未逐一重读**（见 §6 剩余限制）。

---

## 4. 已改文件

### 4.1 目录 `docs/specs/2026-09-19-file-assets-contract-close/`（新建，5 份）

| 文件 | 内容（含两轮返修后的增量） |
|---|---|
| `baseline.md` | 起点、指纹、可改范围、UD/DS 分层、禁止事项 |
| `contract-delta.md` | CD-01…CD-18（第一轮）+ CD-19…CD-23（R1–R4 返修）+ **CD-24…CD-28（CR2-1…CR2-4 返修）**：旧规则→反例→新规则→影响+锚点 |
| `counterexamples.md` | CE-01…CE-14，证据等级分离（逻辑反例 / 读码结论 / 实跑证据；实跑 0 条） |
| `p0-0-implementation-plan.md` | **v3**：逐任务签名/失败测试代码/实现步骤/命令/预期/停止点 + 夹具 v3 + 验收脚手架 + NC-1…**NC-7** + 门禁 |
| `review-receipt.md` | 本文件（含 §2.5、§2.6、§2.7 三轮记录） |

开工时该目录不存在（`Test-Path` 为假），未使用 `-r2` 后缀。表中不列字节数——两轮返修后体积已变，列旧值会误导。

**工作树状态（第四轮返修后）**：`git status --porcelain` 由开工时的 **126** 条变为 **133** 条；已跟踪修改恒为 **48** 条（**产品源码与正式测试未被本包触碰**）。新增的 7 条为：本包独占目录（1）+ 各轮复核方新增的复核文档与独占证据目录（6：`docs/dispatch/2026-09-20-*-review{,2,3}.md` ×3、`outputs/file-assets-contract-review-20260920-0{1,2,3}/` ×3，均为他方产物，**未回滚、未改动**）。

### 4.2 目录 `docs/specs/2026-09-19-file-assets-design/`（就地校正，7 份）

| 文件 | 改动性质 |
|---|---|
| `shared-contracts.md` | **重写**：新增 §1.2.1–1.2.7（注册表/证据/事务/八场景/收窄）、§1.5.1（插入归一化）、§1.7（三轴）、§3.3.1、§3.5（租约）、§3.6（唯一事实源）、I-10…I-22；重写 §4.2/§4.3/§4.4/§4.5/§5/§6.2/§6.3/§7 |
| `asset-library.md` | 校正 §1.2（归属与可携带性）、§2.3（落点+可携带性徽章）、§4.1（同名规则）、§4.3（三态）、§4.6（枚举统一）、§4.7（断图 reason）、§4.8（归一化）、新增 §4.9、§6.2（记账）、§7（自由画布单列）、§10（决策分层） |
| `acceptance-and-backlog.md` | §1（归属证据）、§2（新增 G13–G15）、F1（租约）、X1（自由画布不计通过）、新增 §3.1（L1–L4/S1–S3/R1/N1–N4）与 §3.2（证据等级）、§4（新增既有断言边界 2 条 + §4.1 测试认领表）、§5（重排 + 原则）、§6（判据 6–8） |
| `file-management.md` | §2.3（UD-1 边界）、§3.3（租约编排）、§4（步骤 ⓪ 取租约 + 边界修正）、§5.3（部分成功保护）、§8（UD/DS 分层） |
| `README.md` | §3（方案 B 三条收窄）、§4（范围 + 不新增引用形态）、§6（UD/DS 分层）、§7（交付清单含本轮目录）、§8（串行链） |
| `current-state.md` | 新增 §6.1（本轮补正指针 + R-01/06/08/09/13/14/15 的口径更新） |
| `design-review-receipt.md` | **仅在末尾追加 §10「勘误与后续修订」**；§1–§9 原文保留未改 |

### 4.3 未改动

产品源码、`apps/**`、正式测试、门禁配置、验收脚本、`.dependency-cruiser.js`、任何 `package.json`、旧 DELIVERY-CLOSE 证据与固化清单、`tools/graph-engine/`、`_tmp*`、`.codebuddy/`、`.cursor/`、`.codebase-memory/`、他方服务。

**工作树计数**：开工时 126 条 → 交付后 127 条（唯一新增为本轮独占目录）。**这不是「其余文件未变」的证明**（`baseline.md` §3）。

**他方修订的处置**：七份设计文档在本轮开工前已被他方修订（时间戳见 `baseline.md` §3.1）。本轮**在修订后的内容上继续补正，未回滚任何他方改动**；对历史回执段落采用追加勘误。

---

## 5. 契约变更速查（每条一句话）

| CD | 新规则一句话 |
|---|---|
| CD-01 | 工作区身份落**新键 `workspace-registry.v1`** 的单记录；`'workspace-root'` 永远只放裸句柄 |
| CD-02 | 同一目录只能由 `isSameEntry` 或用户确认证明；名称/路径/对象引用/唯一同名都不算 |
| CD-03 | 注册表最多保留 8 个条目；**「任意重新挂载都保留身份」不成立** |
| CD-04 | 注册表缺失时走 legacy adoption：**生成新 scopeId**，不推断历史身份 |
| CD-05 | 损坏 → 不使用、不删除、不自动改写；写入失败 → `persisted:false` 且不承诺跨刷新 |
| CD-06 | 旧收藏/句柄的路径键进**历史池**，用户显式确认才绑定 |
| CD-07 | `size`+`mtime` 只做预筛选；首期不做去重；同名一律三选，默认「保留两份」 |
| CD-08 | 删除 `persisted`；拆成 写入结果 × 存储位置 × 可携带性 |
| CD-09 | 回退分 R-A（无新写入，无损）与 R-B（有变更，需**降级投影**） |
| CD-10 | 上传写入前捕获 scope/epoch；ep 变化不更新清单但必须**记账**（`unconfirmed`） |
| CD-11 | 插入**归一化**到当前工作区（或内联小 SVG/拒绝）；解析规则唯一；取消 site-root 回落 |
| CD-12 | **操作租约**归属 `DocumentSaveSession`；租约期间一切 `submit` 一律 `blocked` |
| CD-13 | 新增跨会话 `physicalWritesInFlight`；非 0 时拒绝（不静默等待） |
| CD-14 | 租约期间**保留编辑、延迟写出**；每 await 校验四项；`finally` 条件释放 |
| CD-15 | 部分成功后目的地 = 新文件；撤销副本受保护；重试删源前复查外部修改 |
| CD-16 | 反馈随操作交付；无消费者不做；公共类型入 `packages/react`；共享接线串行；自由画布单列 |
| CD-17 | `SaveDestination` 只有一个存储位；`setDestination` 为兼容写入口 |
| CD-18 | 「dirty 改名丢内容」降级为**逻辑反例**；I-14 前置照旧保留 |

---

## 6. 未运行项

| 未做 | 说明 |
|---|---|
| 未运行任何测试 | 本轮为文档任务；`acceptance-and-backlog.md` §3.1 与 `p0-0-implementation-plan.md` §4 的测试代码是**设计预期** |
| 未运行 typecheck / depcruise / lint / budget / gate | 无源码改动，**纯文档不需要全仓门禁**；P0-0 的门禁安排见计划 §6 |
| 未复算历史门禁 | 不引用 20260919-03 的 2489 全绿作为未来改动通过的证明 |
| 未执行任何浏览器脚本 / 探针 / 预览 | 未占用端口 |
| 未对真实目录做改名/移动/删除试验 | R-01 等仍为逻辑反例 |
| 未做性能测量 | `asset-library.md` §2.4 指标仍为拟定目标 |
| 未迁移任何数据 | M1–M11 是设计，不是执行记录 |
| 未验证跨浏览器 | `isSameEntry`、`createWritable`、IDB 持久化策略均标未验证 |
| 未核对自由画布 `.mc.canvas.json` 完整格式 | 只确认宿主与入口；资产字段设计留给独立包 |
| 未回读 §3.2 列出的全部上一包锚点文件 | 见 §7 限制 1 |

---

## 7. 剩余限制

1. **上一包锚点未全部重读**。`current-state.md` 的锚点表中，`FileManager.tsx`、`MindmapStage.tsx`、`NodeG.tsx` 等文件本轮未逐一重读原文，引用的行号来自上一包记录。若这些文件在本轮开工前被改动，相关行号可能漂移；实现前应以符号名回查。
2. **34 条 CD 与 14 条 CE 全部无实跑证据**。所有「正确结果」都是设计预期；CE-01/03/04/05/11/12 的成立性未被实测。**NC-5 入口 2/3 的编排尚未实现**（无 `vitest.counterexamples.config.ts`、无 `test:counterexamples` script、无反例文件），其预期退出码来自复核方的**最小事务模型**，不是产品测试结果（见 §7.18）。
3. **注册表上限 8 与 LRU 淘汰是设计取値**，未做容量/性能测量；`REGISTRY_MAX_ENTRIES` 的具体数值可在实现时调整，但语义（有界 + 淘汰 + 承诺收窄）不可改。
4. **`isSameEntry` 的实际可用性未验证**。Chromium 各版本、Firefox/Safari 是否提供、`showDirectoryPicker` 的 jsdom 替身是否有该方法，均未实测；契约按「可能缺失」设计。
5. **`physicalWritesInFlight` 的计数点未定实现细节**。计划把它放在 `drain` 的写入路径包裹（§6.2 与 CD-13），但「下载兜底」「另存为的两次写」等分支的计数时机需在 P0-A 实现时逐个确认。
6. **租约与既有 `requestLeave` 互斥的关系只做了方向性规定**：两者都在 `DocumentSaveSession` 的互斥域内，但「租约期间用户点了离开入口」的具体交互（提示 vs 排队）留给 P0-A 决定，需在 F1/F2 的实现中固化。
7. **投影的完整性未穷举**。CD-09 只列了四类需要投影的数据；是否还有其它旧版本可读的键（例如 `mindcanvas.folders.v1`）需要投影，需在 P0-D 实现时逐键确认。
8. **P0-0 计划的测试代码未执行过**，其中内存 IDB 替身的扩展（多 put + 可注入失败）与 `tx.onerror` 触发方式需要在实现时按 fake-indexeddb 的真实行为校准；计划已标注这一点。
9. **性能与体验指标未测**：网格 2000 项、引用完整扫描成本、注册表读写的实际耗时均无数据。
10. **P1-A 的人工关联是明确欠账**（返修 R5 的结论）：P0-0 只到 `disk-session('unassociated')` 为止。在 `isSameEntry` 不可用的环境里，用户每次都要重新选文件夹——这是「不猜测归属」的必要代价，但**必须在 P1-A 由人工关联解除**，且在此之前**不得声称恢复了旧工作区身份**。
11. **`unassociated` 的注册表与裸键都不写**，是一个**有意的行为选择**（宁可回到最后一次被证明的工作区，也不留一个无法解释的裸键）。它会让 P0-0 阶段的部分用户体验变差；若主控认为不可接受，需要回到「是否允许按名称猜测」的决策，而那与本轮已确认的 I-13 冲突。
12. **R1–R4 与 CR2-1…CR2-4 的返修都只到文档层**：单事务 RMW、四态读、`detach` 原子性、三入口一致性、判定分级、两阶段解析与 conflict 重试都**没有实现，也没有实跑**；替身夹具 v3 **未经 TypeScript 编译，也未经行为运行**。实现时应先 `pnpm --filter @mindcanvas/react typecheck`，再逐条跑 NC 与新增用例。
13. **夹具 v3 是对真实 IDB 的近似**：事务串行、暂存/发布/回滚、`abort` 语义都按「足以判别本设计断言」的最小集实现；它**不保证**与真实 IDB 在所有细节上一致（例如 `tx.onerror` 与 `onabort` 的真实触发顺序、请求级错误的传播）。实现时若与真实行为冲突，**以真实行为为准校准夹具，不得放宽生产断言**。
14. **`isSameEntry` 的实际可用性仍未验证**：判定分级依赖它区分 `different` 与 `unknown`。若某环境**完全没有**该能力（全部 `unknown`），则会持续走 `unassociated` 降级——这是保守行为，但要等 P1-A 的人工关联才可用，属已知欠账（限制 10）。
15. **两实例并发测试依赖夹具的 `globalThis` 共享态**：这是刻意的（真实 IDB 的串行是每库的），但它意味着该用例**不能**在真实浏览器里用两个标签页以外的形式等价复现；标签页级行为未实测。
16. **事务生命周期（I-25 的 (b) 面）仍未验证**：NC-7 只保留可判定的「`mutate` 必须同步返回」契约测试；「活跃事务内等待跨任务延迟会导致自动提交 / `TransactionInactiveError`」需在 `fake-indexeddb` 或真实浏览器上用跨任务延迟单独校准。**本包不宣称该行为已验证，也不以自制夹具的时序外推浏览器。**
17. **夹具 v3 的校准范围有限**：复核方只转译执行了五个定向场景（第二次 put 失败 / 第二次 delete 失败 / 读失败 / 主动 abort / 正常提交），**不是完整 TypeScript 类型检查，也不是产品或真实浏览器验证**。夹具语义在其它未覆盖分支（如并发事务的多请求交错顺序、`onerror` 与 `onabort` 的真实触发关系）仍需实现时校准。
18. **NC-5 三入口编排尚未实现，其预期退出码来自逻辑模型**：`vitest.counterexamples.config.ts`、`test:counterexamples` script、`tests/counterexamples/**` 与 `tests/helpers/registryConcurrency.ts` 均**只是设计**，尚未创建。入口 1 的 PASS/0 与入口 2 的 AssertionError/1 由复核方在**最小事务模型**上验证（第四轮证据），**不是产品模块测试结果**；入口 3（生产中性化）**从未运行**，其「正常副本 0 / 中性化副本非零」是**待验证的设计预期**。任何情况下**不得**把逻辑模型结果写成产品测试通过。

---

## 8. 下一包（P0-0）准入条件

启动 P0-0 前必须同时满足：

1. 本回的返修内容（§2.5、§2.6、§2.9、§2.10）与 `p0-0-implementation-plan.md` 经主控评审通过（含 §1.2 的 **19 条**出口与 §1.3 的「不做」清单）。**特别需要确认 R1–R5、CR2-1…CR2-4、CR2-4A/CR2-4B 与 NC-5 执行编排是否已达放行标准**——它们是前四轮的打回项。
2. 确认 P0-0 的**范围不被扩张**：任何 `rebindDestination`/`*Safe`/`uploadAssetDetailed`/索引层的实现都必须退回给 P0-A/P0-B/P0-D。
3. 确认候选归档与提交边界（`docs/dispatch/2026-09-19-delivery-close-final-acceptance.md:61` 的既有要求：另建交接清单、按混合文件归属审阅提交范围）。**本轮不代为提交。**
4. 确认 §6.2 的复跑清单可接受（尤其是 `apps/canvas` 中会构造真实 `DirectoryWorkspaceHost` 的用例）。
5. 确认可选加固项（新增 depcruise 规则禁止 `packages/react` → `apps/**`，DS-11）是否纳入 P0-0；不纳入则记录为独立项。
6. **确认 §5 的七条负控都能按各自判定方式跑出「红」**：NC-1…NC-3 为第一轮既有；NC-4/NC-5 为第二轮新增；NC-6 为第三轮新增；**NC-7 已在第三轮收口改写为「`mutate` 必须同步返回」的契约测试**（事务生命周期另需真实/fake-indexeddb 校准）。判定要求：**负控期望与正例相同**，转红以**命令退出非零**为准（不得捕获 expected failure 后宣称转红）；**NC-5 必须按「两实例 + 受控交错」跑**，正例要先断言 `kind==='ok'`（不得因非法记录被判 `invalid` 而假通过），且**必须按三入口分别运行**：入口 1 进正式套件退出 0，入口 2/3 走 `test:counterexamples` 并记录**真实非零退出码**（入口 3 的正常副本先跑一次退出 0）。**入口 2 常态必红，不得进入默认门禁**。
7. **确认 P1-A 的人工关联是明确欠账而非可选优化**（计划 §7 交接表已列为「必须先补」）：在它落地前，`isSameEntry` 不可用的环境无法获得持久工作区身份。

**P0-0 完成后**：交付包回执（实际命令与输出摘要 + **NC-1…NC-7 各自的转红证据**（命令**退出非零**，且负控期望与正例相同） + 未运行项），**停止**，等待评审；不自动进入 P0-D。

---

## 9. 自由画布（单列，避免误读）

- UD-1 的决定是「**首期不纳入工作区与文件面板**」，**不是**「自由画布只做会话内插图」的实施方案批准。
- 自由画布的资产能力（格式、宿主、作用域、断图语义）**仍未设计**；它是一个**独立的设计 + 实现包**，不在 P0/P1 串行链上（`acceptance-and-backlog.md` §5 的 P1-C）。
- 「自由画布没有插图功能，但界面提示了不支持」**不构成 X1 的通过或部分通过**（`acceptance-and-backlog.md` §3 的 X1 状态行）。

---

## 10. 状态声明

- 本轮**未提交、未暂存、未推送、未发布**；未执行 `pull/rebase/reset/stash`。
- **未实施**：无功能代码、无测试代码、无迁移脚本、无门禁改动。
- **未启动 P0-0**，未另建执行任务，未重开 DELIVERY-CLOSE。
- 到达状态：**契约补正方向可接受；P0-0 实施计划已完成 R1–R4、CR2-1…CR2-4、CR2-4A/CR2-4B 与 NC-5 执行编排四轮定向返修，待复核**。在此停止，等待主控评审。
- 四轮返修**均未改动已确认的设计方向**（注册表新键、`isSameEntry` 唯一证据、8 条上限、同名三选、三轴分离、操作租约、P0-0 不含保存/资产/索引/UI）；改动集中在实现契约、判定分级、并发协议、校验强度、不变量条件化与测试编排。
- **本轮不扩范围**：没有新增功能设计、没有改动图库 UI 设计、没有触碰产品源码与正式测试；第四轮只补正 NC-5 执行编排、把不变量条件化、更正旧计数标题，**已关闭的 CR2-1…CR2-3 与已接受的 CR2-4A / CR2-4B 断言 / NC-7 分层均不返工**。
