# MODE-GUARD 包 2 独立复核

> 最新结论（2026-09-19）：包 2 已列阻断项全部关闭，放行包 3 DELIVERY-CLOSE 实施。详见文末“第四轮复核与放行”。此前退回结论与证据保留为历史记录。

日期：2026-09-19。HEAD：`a2ce72b`。输入：`2026-09-18-mode-guard-report.md`。

**结论：暂不通过；返修 MG-R1～MG-R3，包 3 不放行。** 常规保存/取消/下载保护已有有效覆盖，但组合输入、请求归属和异步目标期间的单请求约束尚未闭合。

本轮只新增独立复核探针、日志和本报告，未改实现、原回执或已有视觉/度量成果，未提交、推送或启动包 3。

## 独立证据

| 检查 | 结果 | 路径 |
|---|---|---|
| 包 2 相关既有测试 | 4 文件、77 passed，退出码 0 | `outputs/mode-guard-review-2026-09-19/existing.log` |
| 新增正确行为断言 | 5 failed，退出码 1；全部失败来自保护断言 | 同目录 `probes.log` |
| 复核源码 | 决策器、登记桥、draftFlush、模态、App、两种 Stage 的接线 | 下文定位 |

既有测试文件：unsaved-transition、mode-guard、free-canvas-leave、useDocumentActions。本轮没有重跑全量 2455 条、质量门禁或真实浏览器，执行者回执中的相应结果不等同于本轮独立验证。

复现命令（项目 pnpm 10.33.2）：

```powershell
$env:PATH = '<local-path>' + $env:PATH
pnpm --filter canvas exec vitest run --config ../../outputs/mode-guard-review-2026-09-19/vitest.config.ts
```

探针路径：`outputs/mode-guard-review-2026-09-19/probes.test.tsx`。断言为正确保护行为，修复后应变绿；不要反转期望。jsdom 的 canvas/getContext 能力提示不是上述失败原因。

## MG-R1 · P1：组合输入保护会漏首次事件，且拒绝后仍被模态聚焦强制提交

位置：`apps/canvas/src/draftFlush.ts:22`、`:35`、`:60`；`apps/canvas/src/UnsavedPrompt.tsx:82`；`apps/canvas/src/hooks/useUnsavedTransition.ts:124`。

两个独立问题：

1. composition 监听在第一次 `flushActiveDraft()` 调用时才安装。在用户已经 compositionstart、随后首次请求离开的时序下，start 已错过，flush 返回 true 并执行 blur。其他调用点没有在编辑开始前安装这套监听。首个独立探针返回 true，正确期望为 false。正式修复测试应在全新 App 挂载后、没有任何先前切换/flush 的条件下验证，不能依赖上一条用例预热模块级状态。
2. 即使 composition 已被正确跟踪，flush 返回 false 后仍打开三选项模态；模态 effect 抢走编辑器焦点，触发编辑器自身 onBlur 提交。真实 App + 自由画布 FaceEditor 的独立测试证明，在没有发出 compositionend 时，编辑器已被关闭，候选文字进入卡片正文，而模态仍显示“组合未结束”。日志：

```text
editorStillPresent: false
committedCandidate: '尚未确认的候选文字'
notice: '正在输入（输入法组合未结束）：请先完成候选输入，再选择保存或放弃。'
```

这不是只差一条文案；它违反“不截断正在组合的文字”的明确验收。第二个探针运行的是 jsdom 内的真实 App/FreeCanvasView/FaceEditor，不是 OS 级中文输入法测试；没有声称已覆盖真实候选框。执行者已有测试只证明提示出现且模式未切换，不能证明候选串未提交。

返修：在可能收到首个组合事件之前建立生命周期明确的跟踪；组合未结束时不得通过模态聚焦或入口的默认失焦间接提交。可选择保留编辑焦点、非模态提示并暂缓请求，或在编辑器提交边界显式阻止未完成组合；确保 compositionend 后能恢复正常操作、取消保留草稿，并清理失效的组合状态。不能仅把监听提前就宣称本项全部修复。

正式与浏览器回归至少包含：冷启动首次编辑即组合输入；没有 compositionend 就请求离开；候选文字不进入模型/文件；取消后草稿仍可继续；compositionend 后最后确认文字准确保存。已有编辑入口矩阵要验证未 blur 草稿的真实提交值，而不只查看确认框。

## MG-R2 · P1：端口失效未使活动请求失效，旧保存仍可执行目标

位置：`apps/canvas/src/hooks/useUnsavedTransition.ts:79`、`:93`、`:167`、`:182`、`:213`。

registerPort 及其清理只更新 portRef/ready；activeRef 与 pending resolver 不随端口失效结束。异步保存/等待完成后只比对 activeRef，没有核对当前登记端口。独立复现：

- A 端口发起离开并等待用户决策 → 注销 A：Promise 仍未结束，正确结果应为 false，模态应关闭。
- A 发起保存并等待 → B 端口登记 → A 保存迟到返回 saved/current=true：旧 perform 实际调用 1 次，正确结果应为 0。

这组是端口生命周期契约测试，模拟端口替换，不声称当前常规按钮路径每次都会出现该时序；但登记桥本身明确支持 Stage 清理/替换，原计划也要求失效和卸载后剩余请求 resolve(false)。当前 hook 无卸载清理，同类风险需一起覆盖。

返修：请求绑定端口登记身份/代次；端口注销、被替换或决策器卸载时，准确结束其尚未执行的活动请求，迟到的 wait/save 结果不能执行旧目标或更新新请求提示。每个 await 之后以及目标真正执行之前检查归属。保留“旧 Stage 清理不能注销新 Stage”的已有正确行为，不能用无条件取消所有新请求的方式修复。

正式回归：待选择时注销、保存中注销、保存中替换、等待中替换、决策器卸载、旧清理晚于新登记；确认 Promise 只结算一次、旧目标零执行、新请求可用。

## MG-R3 · P2：异步目标尚未完成，单请求锁已经释放

位置：`apps/canvas/src/hooks/useUnsavedTransition.ts:92`。

runTarget 在 `await request.perform()` 之前将 activeRef 清空。独立探针将干净文档的第一个 perform 挂起，再发第二个 requestLeave：第二请求返回 true，目标实际执行；与“同一时刻只允许一个活动请求，直到收束”的声明不符。

风险边界：RequestLeave 明确允许异步 perform；目前常见 setMode/applyModel 目标主要是同步操作，因此本项评为 P2，不描述为常规点击必现的数据丢失。

返修：明确确认/保存/执行目标/结束的请求生命周期；目标执行完或失败之前保留互斥。应区分“因正常目标执行造成 Stage 注销”与“目标尚未执行前的外部失效”，避免 MG-R2 修复把一次成功切换误结算为失败。异步目标成功和失败后都应解锁，后续请求正常可用；失败不悬挂。

## 返修范围与放行条件

- 仅收口上面三项及其同族时序，不扩展自动草稿、历史栈、持久化框架或无关视觉功能。
- 现有 77 条与包 1 保存回归保持通过；新增正式保护性断言、独立探针变绿且无未处理异常。若采用新的显式初始化/编辑器注册 API，可适配探针夹具接线，但必须保留冷启动/未预热和归属断言，并在回执说明。
- 真浏览器补 IME 事件/焦点/模型/写出文本的联合断言；合成 composition 事件与真实输入法/系统选择器验证继续分开报告。
- 完成受影响类型、测试、依赖、lint、预算、构建检查，区分已有失败；本轮未要求提前接管包 3 存量债务。
- 回执 §5 已承认“实现在前、断言在后”，阴性对照不是原实现前红灯证据。保留事实，本轮从这些明确失败复现开始返修，附实际红→绿证据。
- 更新原包 2 回执，保留首轮记录；完成后停下复核，不启动包 3。

## 返修启动 Prompt

```text
请继续包 2 MODE-GUARD 的复核返修，不启动包 3。
工作目录：<workspace>。

先读 docs/dispatch/2026-09-19-mode-guard-review.md、原包 2 回执与实施计划。主控独立重跑现有相关 77 条全绿，但新增 5 个正确行为探针全红。

按 MG-R1～MG-R3 修复：
1. 首次组合事件不能漏；组合未结束时不得由模态聚焦/默认失焦把候选文字提前提交。覆盖冷启动首次离开与真实自由画布编辑链路，验证模型和写出文本，不只验证提示。
2. 请求绑定端口归属；注销/替换/卸载应使尚未执行的请求结束为 false，迟到保存或等待回调不能执行旧目标、污染新请求；旧 Stage 清理不能取消新 Stage。
3. 异步 perform 完成或失败前保留单请求互斥，且正常目标造成的 Stage 卸载不能误判为失败。补恢复、重试和 Promise 单次结算用例。

先运行 outputs/mode-guard-review-2026-09-19/vitest.config.ts 复现，然后把正确保护断言纳入正式测试再修复。保持包 1 与包 2 既有回归通过，补真实浏览器组合输入/焦点/文本验证；准确区分合成事件和系统级输入验证。

使用 pnpm 10.33.2，按原计划跑检查并记录既有预算失败。只按块修改本包范围，保留视觉/度量成果和禁区；不提交、不 push、不 pull/rebase/reset/stash、不批量暂存。

在 docs/dispatch/2026-09-18-mode-guard-report.md 追加复核返修章节，列红→绿、正式同族矩阵、实际接口、门禁与验证限制。完成后停下交回执，等待主控复核。
```

## 第二轮复核（2026-09-19）

输入：执行者回执 §R0–R9；HEAD 仍 `a2ce72b`。

**结论：返修有效，但包 2 尚未达到原编辑入口矩阵要求，包 3 暂不放行。** 不是要求重做已通过部分：原冷启动跟踪、自由画布候选串保护、不同端口替换/注销和异步互斥的独立复现已经变绿。MG-R3 关闭。

### 本轮独立验证

| 检查 | 结果 | 路径（outputs/mode-guard-review-2026-09-19/） |
|---|---|---|
| 原 5 探针 | 5 passed / exit 0 | `recheck-probes.log` |
| 相关 4 正式测试文件 | 91 passed / exit 0 | `recheck-formal.log` |
| pnpm typecheck | 四子项目通过 / exit 0 | `recheck-typecheck.log` |
| 新补同族探针 | 3 failed / exit 1 | `followup.log` |

没有重跑全仓 2469 条、浏览器或其余门禁；那些仍是执行者回执结果。本轮只新增复核材料，未修改实现。

### MG-R4 · P1：Markdown 预览态的未提交草稿绕过离开保护

位置：`packages/react/src/chrome/NoteBackEditor.tsx` 的 `toggleMode` / preview 分支；`apps/canvas/src/draftFlush.ts` 的 `activeDraftElement` / `flushActiveDraft` / `hasPendingDraft`。

这不是新增需求。原 MODE-GUARD 计划 Task 2 明确列出背面 Markdown / NoteBackEditor，要求输入进入保存快照；Task 3 要求 beforeunload 覆盖未提交草稿。

独立测试挂载真实 NoteBackEditor，修改源文但不 blur，点击其“预览”按钮。组件把改动放入自身 draft 状态，textarea 被卸载（该组件的设计与注释明确说明卸载不派发 onBlur），模型仍是旧文本。接入真实离开决策器和产品使用的 flushActiveDraft 后，实测：

```text
modelText: 'original'
beforeUnloadSeesDraft: false
targetCalls: 1
```

即：模型未更新，草稿检测为 false，离开动作已经执行。当前“只 blur 聚焦控件”的通道覆盖不了失焦/隐藏/预览态持有的草稿；离开卸载编辑器时该 draft 就没有保存来源。

证据边界：测试是真实编辑组件 + 产品 flush 函数 + 真实决策器的集成夹具，模型用 onCommit 写回变量模拟；不是完整 App 的鼠标旅程，也不声称实测真实磁盘丢文件。代码路径和断言已明确证明保护缺口，返修需补完整 App 层回归。

返修：为编辑会话提供明确的 pending/flush 通道，使预览态草稿也可被 Stage 提交和 beforeunload 检测；不要仅按 document.activeElement 推断“无草稿”。沿现有回调最小接线，保持预览、Esc、空文本和业务校验语义；不引入全局持久化草稿框架。验收：从已保存文档进入背面编辑→改文→预览→请求离开，取消保留草稿；保存实际写出最后 Markdown；关闭/刷新检测到 pending。

### MG-R1-B · P1：组合提交边界尚未覆盖原计划中的备注/描述编辑器

返修为 NativeCard 和 OverlayEditor 加了组合保护，但 NoteBackEditor 的 onBlur 仍直接 commit；NotePopover 正文和 DescBlock 也未接入这套组合边界（后两者是代码检查，尚未单独动态复现）。

新探针挂载真实 NoteBackEditor，compositionstart → 填入候选文本 → 对离开按钮调用原生 focus，触发实际 blur。compositionend 之前，onCommit 已收到：

```text
callsBeforeEnd: [['尚未确认的背面候选']]
```

这个探针显式调用 focus，因此不依赖 fireEvent.click 是否自动转移焦点；jsdom 中即可复现真实 React onBlur 提交。它不声称覆盖 OS 输入法，但准确覆盖“点击离开入口带来的失焦不能提交未确认候选串”这一既有要求。App 非模态提示发生在入口 click 阶段，不能倒退阻止此前的默认失焦。

返修：按原计划的标题/描述/备注正文/背面 Markdown/自由画布正反面矩阵一次核对完整提交路径，补漏掉的组合开始、失焦拒绝、结束后确认文本提交。至少分别有候选串不进入模型、确认串准确保存的正式断言，不以提示出现代替内容验证。避免只为两个被探针命中的组件打补丁。

### MG-R2-B · P2：同一端口对象重新登记会让旧请求永久失去归属但不结束

位置：`apps/canvas/src/hooks/useUnsavedTransition.ts` 的 `registerPort`。

每次 registerPort 都递增 gen，但只有 `previous.port !== port` 才 abandon(previous)。同一对象再次登记时：旧请求 gen 失效，owns 永远 false，activeRef 却仍占用，Promise 也没有 resolve。

独立复现：登记 P → dirty 请求打开确认 → 再次登记 P → 等微任务，旧结果仍 undefined，正确值应为 false（或明确选择幂等登记而保持有效，二者必须一致）。现有注释与回执声明每次登记均产生新代次，因此当前探针采用“新代次应结束旧请求”的期望。

风险边界：当前登记桥一般以新对象登记，因此不是常规点击必现；这是本轮新增代次语义的同族漏洞，P2。修复可选：每个新代次都结束前代未执行目标的请求，或同对象登记真正幂等；同步契约和测试。旧 cleanup 仍不能清除新登记，后续请求应能正常执行。

### 补充复现与收口范围

```powershell
$env:PATH = '<local-path>' + $env:PATH
pnpm --filter canvas exec vitest run --config ../../outputs/mode-guard-review-2026-09-19/followup.config.ts
```

测试源：同目录 `followup.test.tsx`。保留保护性断言；若使用新的编辑会话登记 API，可调整夹具完成真实接线，需在回执说明，不可通过跳过注册/反转断言掩盖问题。

最终只剩本节三项，按**原计划的全编辑入口矩阵**收口。维持原 5 探针、91 条正式测试、包 1 回归；新增正式回归后完成受影响检查，补真实浏览器预览态草稿与输入焦点链路证据。暂不增加包 3 的预算/类型存量任务。

### 第二轮返修 Prompt

```text
继续包 2，按 docs/dispatch/2026-09-19-mode-guard-review.md 文末“第二轮复核”收口，不启动包 3。

原 5 探针、91 条正式测试与 typecheck 主控已独立确认通过，MG-R3 关闭，不重做这些成果。

剩余三项：
1. MG-R4：背面 Markdown 切预览后草稿留在组件状态，聚焦控件 flush 与 beforeunload 均看不到，导致干净路径直接离开。为编辑会话提供明确 pending/flush 通道，覆盖预览态，不仅 blur activeElement。
2. MG-R1-B：NoteBackEditor 组合中失焦仍会提交候选串。按原计划完整核验标题/描述/备注正文/背面 Markdown/自由画布正反面，统一补齐提交边界与确认后提交语义；不只修探针点名组件。
3. MG-R2-B：同一端口对象重新登记递增 gen 却不结束旧请求，产生悬挂互斥；让代次/幂等策略一致，保留旧 cleanup 不影响新登记。

先运行 followup.config.ts 复现 3 条失败，再补正式回归修复；新增完整 App 的背面预览草稿保存/取消/beforeunload 验收与浏览器输入焦点证据。保持现有保护测试和包 1 回归，不扩大到草稿持久化或无关架构重写。

更新原包 2 回执，附原编辑入口矩阵逐项证据、红→绿和检查结果，完成后停下等待复核。保留已有视觉改动和禁区，不提交、不推送、不 pull/rebase/reset/stash。
```

## 第三轮复核：编辑会话接线后的异常收口（2026-09-19）

输入：执行者回执附二 §S0–S9。HEAD：`a2ce72b`。

**结论：MG-R4、MG-R1-B、MG-R2-B 的既有复现均已修复；新增草稿通道的提交失败路径仍需收口，包 3 暂不放行。** 本轮只保留下面一项具体问题，不要求重做已通过矩阵，也不扩展到包 3 存量治理。

### 独立验证

| 检查 | 实测 | 日志（outputs/mode-guard-review-2026-09-19/） |
|---|---|---|
| 首轮独立探针 | 5 passed / exit 0 | `s-final-probes.log` |
| 第二轮同族探针 | 3 passed / exit 0 | `s-final-followup.log` |
| 相关正式回归（含矩阵、App 背面预览离开） | 6 文件、101 passed / exit 0 | `s-final-formal.log` |
| pnpm typecheck | 四子项目通过 / exit 0 | `s-final-typecheck.log` |
| 草稿提交失败探针 | 1 failed / exit 1 | `draft-failure.log` |

未重复全仓 2480 条、浏览器与其他门禁；这些保持为执行者回执证据。本轮未修改实现，只添加审查材料。

### MG-R4-B · P2：草稿提交异常被吞掉，仍以干净模型放行

位置：`packages/react/src/edit/draftSessions.ts` 的 `commitDraftSessions()`；`apps/canvas/src/draftFlush.ts` 的 `flushActiveDraft()`。

新通道 catch 了 session.commit 的异常，但没有向调用方返回失败或重新抛出；其 boolean 仅表示“曾尝试提交”，flushActiveDraft 又忽略该返回值并无条件返回 true。若模型本来干净、未提交内容只存在编辑会话中，提交抛错后，决策器仍走干净路径执行离开。

独立故障注入测试：通过新公开登记接口注册 hasPending=true、commit 抛错的会话，接真实 flushActiveDraft 与 useUnsavedTransition；模型保持 clean。实测：

```text
stillPending: true
result: true
targetCalls: 1
```

这证明草稿还未提交，离开却成功执行；后续卸载可能丢弃那份草稿。证据边界：这是对提交回调的故障注入，不表示默认编辑器正常输入必然抛错，也没有声称真实磁盘文件已损坏。本项对应原计划“校验失败不得离开”，发生在本轮新建通道中。

返修要求：

1. 区分“提交成功/没有待提交”和“提交失败”，不能 catch 后当作 flush 成功。可以继续尝试其他会话，但必须汇总失败并向离开决策器传递；不要仅为了保留 boolean 而丢失错误事实。
2. 提交失败时保留草稿、目标零执行，提供准确可见提示；用户可取消或修正后重试。非 IME 错误不能等待一个永远不会到来的 compositionend，也不能留下永久互斥。
3. 保留已通过的预览态/组合结束/原始文本/空值语义；不要简单同步复查 React props 就误判已成功但尚未重渲染的提交为失败。用真实 hook 的恢复测试确认第二次可以成功。
4. 补正式“失败不离开”“部分会话失败”“修正后重试成功”断言；新探针、已有 8 探针、101 条及相关新增回归通过，无 unhandled rejection。

复现命令：

```powershell
$env:PATH = '<local-path>' + $env:PATH
pnpm --filter canvas exec vitest run --config ../../outputs/mode-guard-review-2026-09-19/draft-failure.config.ts
```

### 定向返修 Prompt

```text
继续包 2，仅收口 docs/dispatch/2026-09-19-mode-guard-review.md 文末第三轮复核的 MG-R4-B，不启动包 3。

主控确认原 8 个独立探针、101 条相关正式测试及 typecheck 通过，之前三项返修关闭。

剩余问题：commitDraftSessions 吞掉提交异常，flushActiveDraft 仍返回 true；草稿未进入模型时可直接按 clean 放行。主控新探针实测 stillPending=true、result=true、targetCalls=1。

先按 draft-failure.config.ts 复现，再补正式测试修复。提交失败须向上传达，保留草稿并阻止目标执行，准确提示且可取消/修正后重试；不要把非 IME 错误永久挂在 compositionend 等待。验证多会话部分失败、恢复后成功，以及 React 尚未重渲染时正常提交不被误拦。

保持已通过的预览态和组合输入矩阵，不扩大架构或接管包 3 存量债务。按原计划完成受影响检查，追加回执说明实际失败/重试语义和红→绿证据。保留既有视觉改动及禁区，不提交、不推送、不 pull/rebase/reset/stash。完成后停下等待复核。
```

## 第四轮复核与放行（2026-09-19）

输入：执行者回执附三 §T0–T8；HEAD 仍为 `a2ce72b`。

**结论：MG-R4-B 关闭，包 2 已列阻断项全部关闭；放行包 3 DELIVERY-CLOSE 实施。** 本次是后续实施放行，不是版本发布批准。本轮没有启动包 3、修改实现、提交或推送。

### 本轮独立验证

| 检查 | 实测结果 | 证据（outputs/mode-guard-review-2026-09-19/） |
|---|---|---|
| 原五项探针 | 5 passed / exit 0 | `t-final-probes.log` |
| Markdown / 重登记探针 | 3 passed / exit 0 | `t-final-followup.log` |
| 草稿提交失败探针 | 1 passed / exit 0 | `t-final-draft-failure.log` |
| 相关正式回归 | 6 文件、106 passed / exit 0 | `t-final-formal.log` |
| pnpm typecheck | 四子项目通过 / exit 0 | `t-final-typecheck.log` |

代码与正式断言核验：commitDraftSessions 汇总失败而继续尝试其它会话；flush 将失败传递给决策器；草稿提交失败与 composition 暂缓分支独立，前者展示可取消/重试提示，不等待 compositionend。取消后重试、部分失败、成功但未重渲染的不过度拦截、显式放弃均已通过正式测试。

本轮没有重跑全仓 2485 条、depcruise/lint/budget/build 或真实浏览器；其结果属于执行者附三回执。本轮独立确认限于上表及代码核验。原生输入法候选框、系统选择器手势、真实磁盘异常等限制继续保留，不能将合成事件或内存句柄证据提升为系统级验证。

### 包 3 交接边界

- 保持包 1/2 的全部正确行为回归；重点保留慢保存、目的地切换、下载不自动离开、预览态草稿、组合输入、端口失效、异步互斥与提交失败/重试分支。
- 最新 flush 契约为 `FlushResult = FlushOutcome | boolean`，其中 `'ok'/'composing'/'failed'` 与旧 `true/false` 由决策器统一解释；禁止简单真值判断将 `'failed'` 当成功。
- `packages/react` 本系列新增了草稿会话/组合保护等显式导出；包 3 的兼容性基线是**当前经复核工作区**，不能只对 HEAD 比较后把新增导出当作可删对象。保持原有导出及本系列已接入的导出。
- 包 3 接管既有预算 `asCast 32/31`、`bigFiles 6/4` 与 canvas tests 类型诊断基线 9 条，目标是标准 gate/build 真正返回 0，不能放宽阈值或隐藏扫描范围。
- 新增/修改代码的 lint 不得新增告警；总水位重新实测，不能把旧审计计数机械当当前事实。最终测试数量以当前结果为准，并说明任何删减。
- 原计划的浏览器视觉/导出/性能矩阵及系统能力限制准确记录；未验证项保持未完成或明确限制，不能写成全验证。

完整启动材料：`docs/dispatch/2026-09-19-delivery-close-start.md`。包 3 完成后仍需主控复核，不自动提交、推送或发布。
