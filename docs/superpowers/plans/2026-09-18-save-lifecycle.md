# SAVE-LIFECYCLE 保存生命周期实施计划

> For agentic workers: 使用 `superpowers:executing-plans` 逐任务执行；缺陷归因遵循 systematic-debugging，修复遵循 test-driven-development。按 checkbox 跟踪。当前仅准备计划，实施由启动 prompt 发起。

**Goal:** 保存只确认实际写入的内容快照，异步完成不能清除后续编辑或污染其他文档。

**Architecture:** 在应用层建立每个文档会话的保存协调器，两模式共用生命周期原则、各自提供快照和宿主适配。自动/手动/另存为走同一会话写入协调；只在会话仍有效且当前快照匹配时清脏。优先保持 `EditorController.markSaved()` 旧签名与语义，在调用方验证后再调用。

**Tech Stack:** TypeScript、React hooks、Vitest、Testing Library、现有 DocumentHost/CanvasDocHost。

**Spec:** `outputs/2026-09-18-progress-audit-and-actions.md` §3 P0-A；本计划以下不变量及 `docs/dispatch/2026-09-18-reliability-123-dispatch.md`。

## Global Constraints

- 本包不改 `.mm.md` / `.mc.canvas.json` 格式，不持久化内部保存序号。
- `doc.source` 保持解析输入，成功保存只写 `savedSource`；不可触发 reset/fit/清 Undo。
- 保留 S2G 的开始写前同步校验；另存为保留救援功能。救出的快照不应自动证明原会话已同步。
- 禁止用 `doc.id`（当前可能是文件名）、源文本相等或 `dirty` 作为唯一会话身份。每次显式文档替换具有新会话令牌，即使同名/同内容；普通保存/句柄补挂不得换令牌。无需为此改变现有“同内容不 reset”的视图语义。
- 渲染 epoch 包含选中、折叠等变化，不能直接当编辑版本；捕获不可变根/模型身份，或增加只随内容变化的应用层版本。同值回退允许保守保持 dirty，但不能误清。
- 同会话实际写盘串行；后一个请求不能越过前一个写请求。只过滤过期 UI 回调不足以防止旧内容最后覆盖文件。
- 队列中的自动请求合并到最新快照；显式另存为不得被普通保存吞掉。旧会话未开始的任务取消，已发出的 I/O 不声称能撤回，其完成回调不得回填新会话。
- 下载结果保留独立语义；本包不全局改写既有手动下载体验，但必须向包 2 暴露“仅触发下载，不代表持久化已确认”。失败/取消不清 dirty、不形成无人处理的 Promise rejection。
- 遵守总纲工作树、环境、禁区、默认不提交/不推送纪律。

## 接口交接（应用内部，不增加包公开导出）

新增 `apps/canvas/src/documentLifecycle.ts`，两包共用以下结果和端口；仅具体内部实现可调整，若改签名须同步计划/回执与全部调用方：

```ts
export type SaveIntent = 'auto' | 'manual' | 'save-as';
export type SaveCompletion =
  | { kind: 'saved'; current: boolean }
  | { kind: 'downloaded'; current: boolean }
  | { kind: 'cancelled' | 'blocked' | 'failed' | 'stale' };

export interface DocumentLeavePort {
  // 将输入框中尚未提交的文本提交到模型；校验失败返回 false。
  flushEdits(): boolean;
  isDirty(): boolean;
  isSaving(): boolean;
  // 等已开始 I/O 完成；不自动开始一个新的文件选择器。
  waitForIdle(): Promise<void>;
  save(): Promise<SaveCompletion>;
}
```

本包产出 SaveCompletion、isSaving/waitForIdle/save 的实现基础；`flushEdits` 与 App 离开登记属于包 2。`saved.current=true` 仅在该调用结束时会话/内容仍匹配；调用者在真正离开前仍需重新读取 isDirty/isSaving，不能缓存结果永久有效。

协调器建议文件：`apps/canvas/src/hooks/useDocumentSaveSession.ts`（会话及写入调度）；`apps/canvas/src/hooks/useFreeCanvasDocument.ts`（将 FreeCanvasStage 的文档状态和保存适配抽出）。每个新文件独立职责、≤600 行；不新建全局存储框架。

## Task 1：正式回归先复现并锁定快照语义

**Files:** 修改 `apps/canvas/tests/useAutoSave.test.tsx`；新增 `apps/canvas/tests/save-lifecycle.test.tsx`。参考审计 `probes.test.tsx`，不直接将“dirty=false”的错误期望复制为正确结果。

- [ ] 建立可控延迟 DocumentHost，真实 controller，记录每次传给 save 的文本以及“实际写完”的文本。
- [ ] 将审计场景改为正确期望，观察红灯：A 写入等待期间编辑 B；A 成功后 B 仍 dirty，随后自动写入 B；只在 B 成功后清脏。
- [ ] 添加切文档、同名不同文档、同内容重新打开和卸载四个迟到回调用例。
- [ ] 验证选中/折叠不应让内容恒定的正常保存永久无法清脏。

测试夹具的核心工具（放测试 helper 或测试内）：

```ts
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((ok, bad) => { resolve = ok; reject = bad; });
  return { promise, resolve, reject };
}
// 时序断言：先捕获 A → 改 B → resolve(A) → dirty 为 true。
// 推进实际调度窗口 → 第二次 save 收到 B → resolve(B) → dirty 为 false。
// 任何失败都要确认来自保护行为缺失，而不是 import、rAF 或 fixture 错误。
```

运行：`pnpm --filter canvas exec vitest run tests/useAutoSave.test.tsx tests/save-lifecycle.test.tsx`。回执保存修复前失败断言。

## Task 2：实现会话与写入协调，接入自动保存

**Files:** 新增 `documentLifecycle.ts`、`hooks/useDocumentSaveSession.ts`；修改 `hooks/useAutoSave.ts`、`hooks/useDocumentSwitch.ts`、`MindmapStage.tsx` 的文档接线；测试上列文件。

- [ ] 先用单测锁定会话切换失效、排队串行、auto 合并、finally 状态归属，再实现协调器。
- [ ] 在实际文档替换入口推进会话令牌；保存元数据回填不推进。令牌推进须在旧回调可能观察到新文档之前完成，不能仅靠延后的 passive effect。
- [ ] 从最新快照捕获请求，保存完成同时核对会话和内容身份；只对被确认快照更新 savedSource，后续编辑保持 dirty。
- [ ] dirty 已为 true 时继续编辑也能安排后续保存；不得仅依赖 false→true 边沿。300ms 调度保留可解释的 debounce/合并语义，失败不无限重试。
- [ ] “保存中”反映当前会话活动任务，旧会话 finally 不得隐藏新会话正在保存状态；同步守卫拦截不闪 saving。
- [ ] 保存失败保留 dirty、显示准确失败通知且无 unhandled rejection；取消不自动循环重试。
- [ ] 运行 Task 1 测试与 `tests/useDocumentSwitch.test.tsx`、现有 S2G 守卫测试。

正确性判断骨架（必须在真实回填路径消费）：

```ts
// capturedSession / capturedContent 在开始该请求时捕获。
// liveSession / liveContent 必须来自当前状态，不读陈旧 render 闭包。
const sessionMatches = capturedSession === liveSession;
const contentMatches = capturedContent === liveContent;
// 会话失效：零 setDoc、零 markSaved、零当前会话通知。
// 会话匹配但内容变化：记录这次实际成功快照，保持 dirty 并安排最新保存。
// 会话与内容均匹配：允许 markSaved。
```

## Task 3：统一手动/另存为/自由画布结果

**Files:** 修改 `hooks/useDocumentActions.ts`、`FreeCanvasStage.tsx`、`canvasDocHost.ts`（确有需要时）；新增 `hooks/useFreeCanvasDocument.ts`、`tests/free-canvas-save-lifecycle.test.tsx`；扩展 `tests/useDocumentActions.test.tsx`。

- [ ] 手动保存与自动保存共享同一调度；取消尚未触发的 auto timer 不等于取消已开始 I/O。
- [ ] 普通保存、另存为均返回 SaveCompletion；只在验证通过时清 dirty。维持现有调用者忽略返回值仍可工作的内部用法。
- [ ] 另存为捕获独立 intent/目标；保存到新句柄的回填只能属于当前会话。测试选择器取消、旧句柄失败后下载、另存为期间编辑、另存为与 auto 相邻。
- [ ] 尊重文件选择器的用户手势限制：不能在等待任意旧 Promise 后无条件唤起选择器；busy 时禁重复启动 picker并提示稍后重试，或先由直接点击获取目标后排队写入。真浏览器验证该路径。
- [ ] 自由画布保存抽成可测试 hook，复现 A/B 后继续编辑不清 dirty；不在本包添加自由画布自动保存。
- [ ] 对失败、cancelled、downloaded、stale 各做判别测试；downloaded 的返回值必须与 saved 分支不同，包 2 将据此阻止自动离开。

运行：`pnpm --filter canvas exec vitest run tests/useDocumentActions.test.tsx tests/free-canvas-save-lifecycle.test.tsx tests/free-canvas-stage.test.tsx`。

## Task 4：同族矩阵、阴性对照与交接

| 必测场景 | 核心断言 |
|---|---|
| A 写中改 B | A 完成不能清 B；auto 最终写 B，free-canvas 手动仍 dirty |
| 两次保存 | 同一会话宿主写入最大并发为 1；最终文件为最新已成功快照 |
| A 写中切至 B | B 的源文、句柄、dirty、保存指示均不受 A 回调影响 |
| 同名/同内容重新打开 | 旧会话结果仍 stale；不能仅比较 source/id |
| 保存失败/取消 | dirty 保持、错误可见、无无限重试与未处理异常 |
| 选中/缩放/折叠 | 不制造内容版本误判，不清 Undo/编辑会话 |
| 卸载 | 待发请求停止，迟到回调零当前状态副作用 |
| 守卫/救援 | S2G 普通保存拒写；另存为可救出当前内容 |

- [ ] 在自己新增的守卫块临时中性化会话/内容检查，确认关键回归精确变红；只恢复自己的块，禁止 git restore 整文件覆盖他人改动。
- [ ] `pnpm typecheck`、`pnpm test`、`pnpm depcruise`、`pnpm lint`、`pnpm budget`；区分继承预算失败与新增失败，不要求本包提前吞掉包 3 的存量治理。
- [ ] 写 `docs/dispatch/2026-09-18-save-lifecycle-report.md`，列实际接口及包 2 接入点。停下交回执，默认不提交、不 push。
