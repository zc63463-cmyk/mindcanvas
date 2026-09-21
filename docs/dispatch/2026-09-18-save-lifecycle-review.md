# SAVE-LIFECYCLE 包 1 独立复核

> 最新状态（2026-09-19）：包 1 的阻断项 R1–R4 / R4-B 已关闭，放行包 2 的实施。详见文末“第三轮复核与放行”。首轮和第二轮的退回结论保留为历史记录。下载分支的文案校正随包 2 接入完成。

日期：2026-09-18。复核工作区 HEAD：`a2ce72b`。

**结论：退回包 1 返修，暂不放行包 2 MODE-GUARD。** 原先慢保存误清后续编辑的主路径已有保护，但另存为与排队自动保存组合仍可能写错文件；异常收口也未满足包 1 契约。

本轮仅新增本复核文档与 `outputs/save-lifecycle-review-2026-09-18/` 下的独立测试/日志，未修改实现、原回执或已有视觉改动，未提交、推送或启动包 2。

## 实际验证

- 独立重跑执行者相关测试：4 个文件、58 条通过，退出码 0。日志：`outputs/save-lifecycle-2026-09-18/review-existing.log`。
- 独立补充正确行为断言：4 条均失败，并捕获 1 个 unhandled rejection，退出码 1。测试：`outputs/save-lifecycle-review-2026-09-18/probes.test.tsx`；日志：同目录 `review-probes.log`。
- 新探针是**正确行为断言，修复后应变绿**，不同于最初审计目录中的错误行为特征测试。
- 另存为探针使用真实 EditorController、React 文档状态、两种保存 hook 和真实会话协调器；宿主写入使用可控 Promise，记录目的句柄及文本。它验证调用目的地和状态回填，不声称操作了系统文件选择器或真实磁盘。
- 本轮没有重复运行全量 2398 条或全部质量门禁。全量、预算、浏览器结果仍属于执行者回执，本轮不重新背书；原 58 条通过不能覆盖新增失败组合。

复现命令（项目 pnpm 10.33.2）：

```powershell
$env:PATH = '<local-path>' + $env:PATH
pnpm --filter canvas exec vitest run --config ../../outputs/save-lifecycle-review-2026-09-18/vitest.config.ts
```

## R1 · P1：另存为之后排队自动保存仍写旧文件

位置：`apps/canvas/src/hooks/useAutoSave.ts:67`；同族检查点 `useDocumentActions.ts:156`。

复现：打开旧文件，编辑 A → 启动另存为到新文件但挂起完成 → 继续编辑 B 并推进 300ms，auto 入队 → 另存为完成并返回新句柄 → 队列继续执行。

实测第二次写入收到 `old.mm.md` 的句柄和 B 的文本；第二次成功后当前句柄也变回 `old.mm.md`，dirty=false。新文件仅收到 A，旧文件被后续编辑覆盖。日志原文：

```text
secondDestination: 'old.mm.md'
currentDestination: 'old.mm.md'
secondText: '# latest edit B\n'
dirty: false
```

原因：队列执行时重新捕获了内容，却仍使用请求入队时闭包里的 `doc.handle`。另存为只异步回填 React 状态，队列马上启动旧目的地请求；之后该请求又将旧句柄写回文档。手动保存的 `let effective = doc.handle` 有同族风险，尚未单独动态复现。

返修要求：明确并实现同会话当前保存目的地的同步更新；另存为成功后，后续普通保存/auto 使用正确目的地，已开始的 I/O 仍严格串行。不能只等一次重新渲染或取消 auto timer 掩盖已入队请求。加入真实状态联动的另存为→auto、另存为→manual、取消/失败不换目标用例，同时断言目的地、内容、dirty、最大并发数。

## R2 · P2：旧会话迟到失败会污染新文档通知

位置：`apps/canvas/src/hooks/useDocumentSaveSession.ts:181`；`useFreeCanvasDocument.ts:122`。

写入异常分支在核对会话令牌之前直接返回 failed；自由画布收到 failed 后无条件设置“保存失败”。实测旧文档保存挂起 → applyModel 新文档并设置新提示 → 旧请求 reject，结果为 failed，新文档提示被覆盖为“保存失败”。

返修要求：成功与失败都执行会话归属判断；替换/卸载后的旧结果按 stale 收口，不发当前会话通知。补旧请求 reject、旧请求 resolve、卸载和新会话正在保存的组合断言。

## R3 · P2：导图保存失败未提供可见通知

位置：`apps/canvas/src/hooks/useAutoSave.ts:81`；同族代码 `useDocumentActions.ts:184`、`handleSaveAs`。

auto completion 只处理 blocked，failed 被直接忽略。独立测试模拟 host.save 抛错：dirty 保持，但通知回调调用数为 0。手动保存也仅通知 blocked；UI 多处 `void handleSave()` / `void handleSaveAs()`，没有其他消费 failed 的展示路径。

返修要求：给当前会话的 auto/manual/save-as 失败提供准确可见反馈；取消、过期与失败分别处理。旧会话不能提示新文档失败，失败不能触发无限重试。本项对应原计划 Task 2“保存失败保留 dirty、显示准确失败通知”。

## R4 · P2：commit 抛错使 Promise 悬挂并中断队列

位置：`apps/canvas/src/hooks/useDocumentSaveSession.ts:199`。

drain 只捕获 capture/write 的错误，没有捕获 readContent/commit 的异常。独立故障注入令首个 commit 抛错，并预先排队第二个请求：首个 Promise 未结束、第二个 Promise 未结束、第二次 write 调用数 0、saving=true；Vitest 同时捕获 unhandled rejection。

这是适配回调异常下的契约测试，不能解读为默认 LocalDocHost 当前必然抛错；但公开的内部协调器承诺 submit 总返回结果，生产适配的 commit 又会调用宿主 remember，当前实现没有完整异常边界。单靠 finally 复位 draining 不能结束当前请求或继续排队请求。

返修要求：每个请求在所有受支持异常路径都能收口，失败不会让剩余队列永久挂起；区分实际写盘失败与附属元数据记录失败，不因修复错误语义造成误清脏。检查 guard/readContent/capture/write/commit 的异常边界，补针对性测试，不吞错误伪报成功。

## 包 2 接口交接补充

`useFreeCanvasDocument` 返回值目前只有 saving/save 等，未暴露 waitForIdle 或 session；不能直接按回执中的完整离开端口接入。返修时提供最小、稳定的等待入口，并明确当前会话 idle 与失效会话物理 I/O 的语义；App 登记与 flushEdits 仍留包 2，避免扩范围。

## 返修后放行条件

1. 本文 R1–R4 均有正式保护性回归，独立探针变绿且无 unhandled error。保持测试断言语义，不通过修改期望绕过问题。
2. 原相关 58 条及新增同族用例通过；全量测试、typecheck、depcruise、lint、build 通过；budget 清楚区分既有失败与新增债务。
3. 更新保存目的地/异常结果/等待接口交接；追加返修证据到原回执，保留首轮记录。真实系统选择器未验证的限制仍如实注明。
4. 完成本包后停下，再由主控复核决定包 2 是否放行。

## 给包 1 执行者的返修启动 Prompt

```text
请继续执行 MindCanvas 包 1 SAVE-LIFECYCLE 的复核返修，不启动包 2。

工作目录：<workspace>。
先读 docs/dispatch/2026-09-18-save-lifecycle-review.md、原 save-lifecycle-report.md、对应实施计划和 reliability-123-dispatch 总纲。

主控已独立重跑原相关 58 条，全绿；但新探针 4 条全红，并捕获 1 个 unhandled rejection。以复核报告和 outputs/save-lifecycle-review-2026-09-18/probes.test.tsx 为复现证据，先复现，再把正确保护断言迁入正式测试。

必须完成：
1. 修复另存为→排队 auto 使用旧句柄、覆盖旧文件并回退当前句柄的问题；同族验证排队 manual、取消与失败，明确同步的目的地归属，保持实际写入串行。
2. 旧会话成功和失败统一归属核验；切文档或卸载后的 reject 返回 stale，不污染新文档提示。
3. 当前会话 auto/manual/save-as 的失败有可见反馈，dirty 保持；取消、下载、过期结果分别处理，无无限重试。
4. 完整处理请求异常边界；commit/readContent 等异常不得留下悬挂 Promise、卡住队列或产生 unhandled rejection。区分写盘与附属元数据失败，不伪报成功。
5. 给自由画布补齐最小等待入口和准确交接说明；不提前实现包 2 的 App 离开登记或 flushEdits。

完成独立探针与正式回归红→绿，运行原计划相关测试和质量门禁，注明既有 budget 失败。更新原回执，增加“独立复核返修”章节和实际接口，保留历史证据。不要修改主控探针的保护性期望来获得绿灯。

保留所有已有视觉/度量成果与禁区。仅按块修改包 1 范围，使用 pnpm 10.33.2；不提交、不 push、不 pull/rebase/reset/stash，不整树暂存。直接执行常规修复与验证，完成后停下交回执等待复核。
```

## 第二轮复核：首轮返修后的实测结果

复核输入：原回执 §8。HEAD 仍 `a2ce72b`。

**结论：主要问题已修复，剩余 R4-B 一项 P2 需收口后再放行包 2。** 本轮不再要求重做 R1–R3，也不把系统选择器未自动化或既有预算红灯新增为包 1 阻断项。

### 独立验证与已关闭项

| 验证 | 本轮实际结果 | 日志 |
|---|---|---|
| 原独立 4 个探针 | 4 passed，退出码 0，无 unhandled error | `outputs/save-lifecycle-review-2026-09-18/recheck-probes.log` |
| 相关正式测试（含 save-destination） | 5 文件、75 passed，退出码 0 | 同目录 `recheck-formal.log` |
| pnpm typecheck | 4 子项目通过，退出码 0 | 同目录 `recheck-typecheck.log` |
| 实际手动保存适配的 commit 部分完成测试 | 1 failed，退出码 1 | 同目录 `recheck-partial-commit.log` |

R1 的另存为目的地回退、R2 的旧会话迟到失败通知、R3 的写入失败通知均通过原探针及对应正式测试。R4 原先的 Promise 悬挂、队列停摆和 unhandled rejection 已修复。自由画布已实际暴露 isSaving/waitForIdle，当前会话等待的边界有说明。

本轮没有重跑全量 2415 条或真实浏览器；这些仍是执行者 §8 的结果，独立确认范围以上表为准。只新增复核探针、日志并更新本报告，未修改实现或执行者回执。

### R4-B · P2：手动保存部分回填后返回 failed，却已经清 dirty

位置：`apps/canvas/src/hooks/useDocumentActions.ts:183`（markSaved 在 remember 之前）；`useDocumentSaveSession.ts:252`（commit 抛错统一返回 failed）。

本轮沿用 R4 的宿主回填异常场景，进一步将**真实 useDocumentActions + 真实 EditorController + React 文档状态**接入协调器，不再使用直接抛错的空 commit 替身。令写盘成功，然后 `docHost.remember` 抛错，实测：

```text
completion: { kind: 'failed' }
dirty: false
savedSource: '# new edit\n'
notice: '保存失败：写入未完成或未确认，改动仍保留在本地（未标记已保存）。'
```

原因：commit 先 setDoc/markSaved，后调用 remember；协调器 catch 只能结束 Promise，不能撤销已经发生的清脏。这与 `documentLifecycle.ts` 的 failed 不改变状态、失败提示中的“未标记已保存”，以及原实施计划的失败保持 dirty 不一致。§8.4 改写为“dirty 语义由 commit 决定”没有消除代码、公开内部契约和 UI 文案之间的矛盾。

风险边界：该探针故意注入宿主 remember 异常；**没有证明默认宿主正常运行时会抛错，也没有证明这里发生了文件内容丢失**，本例写盘已经成功。问题是离开保护将消费的结果/状态不一致：首次收到 failed 会阻止离开，后续重新读取 dirty 却可能直接走干净文档路径，界面同时显示“未标记已保存”。这是首轮 R4 要求“区分实际写盘失败与附属元数据失败”的未完成部分。

可选收口方式（选择一种一致策略，不扩展为架构重写）：

1. **建议：区分写盘与附属记录。** 确认写盘成功、会话和内容仍有效后，最近列表记录失败作为独立附属警告处理，返回 saved/current；不能显示“写入未完成/未标记已保存”。实际写盘失败继续返回 failed 并保持 dirty。协调器对未预料的 commit 异常仍须保证结果收口和队列继续。
2. **保守策略：流程失败保持 dirty。** 如果 remember 失败仍定为保存 failed，则在会抛错的必要步骤完成前不清脏，相关状态回填与文档契约保持一致。

无需机械回滚已成功写入的文件或句柄；关键是明确事实、结果、dirty 与提示的一致性，不能简单改文案掩盖未定义状态。

独立复现：

```powershell
$env:PATH = '<local-path>' + $env:PATH
pnpm --filter canvas exec vitest run --config ../../outputs/save-lifecycle-review-2026-09-18/partial-commit.config.ts
```

探针允许上述两种策略：返回 failed 时 dirty 必须保留；若选择将附属失败分离，则允许真实写盘成功返回 saved/current。正式测试还应核验相应提示和队列继续，不只测裸协调器。

### 包 2 接线提醒（非新增阻断）

- 原回执 §5 示例中的 `isSaving: saveSession.isSaving` / `waitForIdle: saveSession.waitForIdle` 会丢失类实例 this；接入时用 `() => saveSession.isSaving()` / `() => saveSession.waitForIdle()`。自由画布 hook 暴露的包装函数可直接使用。
- 离开等待发生在当前会话失效/Stage 卸载**之前**，不能先 beginDocument/dispose 再等待；真正执行目标前重新读取状态。
- 系统选择器手势验证和既有预算收口仍按原分工留待后续阶段，不能把 mock 浏览器旅程描述成系统选择器验证。

### 最后一项返修 Prompt

```text
继续包 1，只收口第二轮复核 R4-B，不启动包 2。
工作目录：<workspace>。

先读 docs/dispatch/2026-09-18-save-lifecycle-review.md 文末“第二轮复核”。主控已确认原 4 探针、75 条相关正式测试及 typecheck 通过，R1–R3 不必重做。

剩余问题：真实手动保存先 markSaved 再 remember；后者抛错时返回 failed，但 dirty=false，通知却称“未标记已保存”。用 partial-commit.config.ts 先复现，再在正式 useDocumentActions 测试中锁定正确行为。

明确区分已成功写盘与附属最近列表记录失败。优先将附属失败隔离并准确提示；也可选择流程 failed 时保留 dirty，但必须让结果、状态、通知及 documentLifecycle 契约一致。不要只改文案或放宽保护性测试，不做无关架构重写。保留原 R4 异常收口与队列继续能力。

补真实 hook 的 remember 异常测试（结果/dirty/提示/后续保存均有断言）；原 4 探针、新 partial-commit 探针和相关正式测试均应通过。按原计划完成受影响检查、更新回执并解释所选语义。修正包 2 示例的类方法 this 绑定说明。

保留已有视觉/度量成果和禁区；不提交、不 push、不 pull/rebase/reset/stash。完成后停下交回执等待复核。
```

## 第三轮复核与放行（2026-09-19）

输入：包 1 回执 §8.7。工作区 HEAD 仍为 `a2ce72b`。

**结论：R4-B 关闭，包 1 的已列阻断项全部关闭；放行包 2 MODE-GUARD 实施。** 本次放行不是版本发布批准，也不代表既有预算红灯已经消除。本轮未启动包 2、未修改实现、未提交或推送。

### 本轮独立验证

| 检查 | 实际结果 | 证据 |
|---|---|---|
| R4-B partial-commit 探针 | 1 passed，退出码 0 | `outputs/save-lifecycle-review-2026-09-18/final-partial-commit.log` |
| 原 R1–R4 独立探针 | 4 passed，退出码 0，无 unhandled error | 同目录 `final-probes.log` |
| 相关正式测试 | 5 文件、78 passed，退出码 0 | 同目录 `final-formal.log` |
| pnpm typecheck | 四子项目通过，退出码 0 | 同目录 `final-typecheck.log` |

结合代码核验：手动保存及自由画布将 remember 的附属失败隔离，磁盘写入成功仍返回 saved/current，dirty 按内容归属处理，附属警告走独立渠道。写入异常仍返回 failed，旧会话失败仍返回 stale；原目的地、排队和内容归属回归均保持通过。包 2 所需实时 isSaving/waitForIdle 入口已存在。

没有在本轮重跑全量 2418 条、lint/depcruise/build 或浏览器；这些结果属于执行者回执 §8.7，独立确认仅限上表及代码检查。既有 budget 失败、canvas tests 类型诊断和真实系统选择器未验证的限制继续保留，按原计划进入后续阶段。

### 非阻断交接项：下载事实与通知校正

回执 §8.7.2 将 `saved / downloaded` 合称“磁盘上确为该快照”不准确；`SAVE_METADATA_WARNING` 的“已写入文件”也被自由画布下载后的 remember 失败分支复用。结果联合类型仍能区分 downloaded，故这不重新打开 R4-B 的 failed/dirty 阻断；但包 2 的下载提示接入必须一并校正该文案。

统一口径：

- `saved`：宿主报告文件写入成功；current 表示本次快照的内容匹配情况。
- `downloaded`：只确认已触发下载，不确认用户文件已落盘。即使 current=true 或 dirty=false，也不能在“保存并继续”分支自动离开。
- `failed`：本次保存未获成功确认，保持原 dirty；“保持”不等于无论初始状态如何都强制为 true。
- 附属警告应按 fs/download 分别描述，或使用不声称文件已经落盘的中性措辞。增加 downloaded + remember 失败的通知和不自动离开回归，不改变 downloaded 的既有手动体验。

### 包 2 执行条件

1. 复用现有保存协调器；导图类方法通过箭头包装绑定 this，自由画布使用已包装的函数。
2. flush 未提交编辑，等待当前会话完成后再失效/卸载；执行目标之前重新检查会话、dirty、saving。保存失败、取消、过期、下载不得被当作成功保存而自动离开。
3. 三选项确认、双向模式切换、所有替换入口、中文输入组合状态和重复点击依原计划验收；不复制队列、不扩大到草稿持久化或历史栈。
4. 全部实现完成并交回执后停下，包 3 仍需另行复核放行。

可直接转发的启动材料：`docs/dispatch/2026-09-19-mode-guard-start.md`。
