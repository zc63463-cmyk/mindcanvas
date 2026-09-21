# SAVE-LIFECYCLE（第 1 包）交付回执

执行日期：2026-09-18。工作目录：`<workspace>`。
总纲：`docs/dispatch/2026-09-18-reliability-123-dispatch.md` §4；计划：`docs/superpowers/plans/2026-09-18-save-lifecycle.md`。
状态：**包 1 实现与验证完成，已停下等待复核；未提交、未 push、未对远端做任何操作**。

> **返修轮次（2026-09-18/19，复核后追加）**：独立复核（`docs/dispatch/2026-09-18-save-lifecycle-review.md`）
> 判定退回返修（R1–R4）。首轮记录保留在 §1–§7；返修修复、证据、更新后的接口契约与门禁见 **§8**。
> §8 中的接口说明**覆盖** §5 的对应条目（保存目的地、失败结果、等待入口）。
> 第二轮复核（同文件文末）确认 R1–R3 通过，仅剩 **R4-B**（部分回填后 failed 与 dirty 矛盾）；
> 该项收口见 **§8.7**（第三轮），§8.7 的契约说明覆盖 §8.4 中关于 `failed` 的表述。

## 1. 基线与工作区

| 项 | 开工 | 收工 |
|---|---|---|
| HEAD | `a2ce72b` | `a2ce72b`（本包零提交） |
| 已跟踪改动 | 21 文件，+523/-152（开工前视觉/度量批次） | 同一批仍在，**未被触碰/回退**；另加本包 7 个文件 |
| 未跟踪 | 开工前的测试/设计/技能等 | 全部保留；新增本包 5 文件 + 1 验证脚本 |
| 外部写入者 | 未发现 | 未发现（无同文件并发修改；`git status` 无意外条目） |

环境：`pnpm --version` = **10.33.2**（`<local-path>`，仅当前进程加 PATH，未重装依赖、未改全局工具）。日志统一 `outputs/save-lifecycle-2026-09-18/*.log`。

本包涉及文件（相对 HEAD 的精确改动；未跟踪文件为新增）：

```
新增  apps/canvas/src/documentLifecycle.ts                      51 行
新增  apps/canvas/src/hooks/useDocumentSaveSession.ts          256 行
新增  apps/canvas/src/hooks/useFreeCanvasDocument.ts           128 行
新增  apps/canvas/tests/save-lifecycle.test.tsx                514 行
新增  apps/canvas/tests/free-canvas-save-lifecycle.test.tsx    212 行
新增  tools/verify-save-lifecycle.mjs                          161 行（真浏览器证据脚本）

修改  apps/canvas/src/MindmapStage.tsx                      +27/-7（其中本包接线 +11/-4，其余为开工前视觉批次）
修改  apps/canvas/src/FreeCanvasStage.tsx                   +15/-43（文档状态与保存抽至 hook）
修改  apps/canvas/src/hooks/useAutoSave.ts                  +46/-39（改接保存会话）
修改  apps/canvas/src/hooks/useDocumentActions.ts          +116/-75（返回 SaveCompletion + 会话协调）
修改  apps/canvas/src/hooks/useDocumentSwitch.ts            +11/-1（source 变化兜底推进会话令牌）
修改  apps/canvas/tests/useAutoSave.test.tsx                 +22/-9（夹具改接会话 + saving 由会话推送）
修改  apps/canvas/tests/useDocumentActions.test.tsx        +178/-0（结果可判别 / 忙时拒绝 / 会话推进）
```

未跟踪的 `tools/graph-engine/`、`.cursor/*`、`_tmp_*`、他人临时文件均未触碰；未执行 `git add -A/.`，未执行 pull/rebase/reset/stash。

## 2. 任务完成情况

| 计划任务 | 状态 | 说明 |
|---|---|---|
| Task 1 正式回归先复现并锁定快照语义 | 完成 | 红灯 3/4（见 §3），红→绿全绿 |
| Task 2 会话与写入协调 + 接入自动保存 | 完成 | 新建会话协调器；`useAutoSave` / `useDocumentSwitch` / `MindmapStage` 改接 |
| Task 3 统一手动/另存为/自由画布结果 | 完成 | `handleSave`/`handleSaveAs`/自由画布 `save()` 均返回 `SaveCompletion`；自由画布抽 hook |
| Task 4 矩阵、阴性对照与交接 | 完成 | 阴性对照 A/B 各精确变红并已恢复；全门禁已跑；本回执 |

未完成 / 未做（不掩盖）：

- **真实浏览器未覆盖「文件选择器手势」路径**：无头环境无法自动化系统 `showSaveFilePicker`，`busy → 拒绝启动选择器` 只有 jsdom 证据（`useDocumentActions.test.tsx` 两条 + 自由画布 4 条）。真浏览器只跑了 P0-A 慢写窗口旅程（§6）。跨浏览器、触控、离线重启、系统选择器取消的真实交互留待包 3 的浏览器矩阵或人工核对。
- 审计目录 `outputs/progress-audit-2026-09-18/probes.test.tsx` **保持原样**（它就是「通过=问题存在」的历史特征测试）；正确行为断言已迁入正式测试，未把它当契约。
- 预算红灯（`asCast 32/31`、`bigFiles 6/4`）按总纲属包 3 收口，本包只保证**不新增债务**（§4）。
- 未做 Sidecar/MCP、未做自由画布自动保存、未改 `.mm.md` / `.mc.canvas.json` 格式、未持久化保存序号。

## 3. 红 → 绿证据（修复前的失败就是判别力）

红灯（修复前，旧实现 `useAutoSave` + 无条件 `markSaved()`）：

```powershell
node apps/canvas/node_modules/vitest/vitest.mjs run --root apps/canvas tests/save-lifecycle.test.tsx
```

结果：**3 failed / 1 passed**（日志 `red-before-fix.log`）。失败明细即修复前行为：

1. `A 写中改 B`：A 完成后 `controller.dirty` 由 `true` 变 `false`（期望保持 `true`）——审计 P0-A 本体；
2. `写中切文档`：旧文档回调仍调用 `setDoc`（期望零调用）；
3. `卸载`：迟到完成仍调用 `setDoc`（期望零副作用）。

第 4 条 `写盘期间仅选中/折叠（内容恒定）→ 完成仍清脏` 修复前后都绿 —— 它是**防过度拦截**的反向对照（防止用「内容版本」把瞬时状态也算成编辑，导致正常保存永远清不掉脏）。

绿灯（修复后）：

```powershell
node apps/canvas/node_modules/vitest/vitest.mjs run --root apps/canvas tests/save-lifecycle.test.tsx tests/useDocumentActions.test.tsx tests/useAutoSave.test.tsx tests/free-canvas-save-lifecycle.test.tsx
# 4 files / 58 tests 全绿（task4-matrix.log）
```

接线更新说明（红→绿之间）：夹具由旧签名（`controller + docHost + onSavingChange`）改为经 `DocumentSaveSession` 接线，并在「切文档」用例显式调用 `beginDocument()` 模拟产品路径 `applyDoc`；**断言语义未改**（同一条断言在两种接线下分别红、绿）。

阴性对照（只临时中性化**本包新增**的守卫块，改完立即恢复；未用 `git restore` 覆盖任何文件）：

| 对照 | 中性化点 | 结果 | 日志 |
|---|---|---|---|
| A | `useDocumentSaveSession.drain()` 的内容归属 `Object.is(readContent(), snapshot.content)` → `true` | **恰好 2 条转红**：导图 A 写中改 B、自由画布 A 写中改 B；其余 15 条保持绿 | `negative-control-A.log` |
| B | `drain()` 的会话归属 `entry.token !== this.token` 判定失效 | **恰好 5 条转红**：写中切文档、同名同内容重开、卸载迟到回调、自由画布写入中替换文档、`applyDoc 推进会话`；其余 40 条绿 | `negative-control-B.log` |

修复前后如何区分：

- 旧实现：`dirty` 布尔驱动调度 + 完成即 `markSaved()` + 回调不校验会话 ⇒ 慢写窗口里「未落盘的新内容」被标成已保存，且不再有第二次写入。
- 新实现：写入**开始时**捕获「源文 + 内容身份（不可变根引用）」→ 完成时校验**会话令牌**与**内容身份** → 只有两者都匹配才清脏；内容已变则记下实际写出快照、保持 dirty，并由内容订阅排定下一次自动保存。会话令牌只在显式文档替换时推进（`applyDoc` 同步推进 + `doc.source` 变化兜底），保存元数据/handle 回填不推进。

## 4. 门禁结果（区分基线与新增）

| 检查 | 命令 | 退出码 | 结果 | 与基线对比 |
|---|---|---|---|---|
| 类型 | `pnpm typecheck` | 0 | 4 子项目 Done | 持平（`typecheck.log`） |
| 测试 | `pnpm test` | 0 | free-canvas 12、kernel 622、react 1497、canvas **267**；合计 **2398** | 基线 2376 → **+22 全为新增用例**（`full-test-final.log`） |
| 依赖 | `pnpm depcruise` | 0 | 516 模块 / 1508 依赖，0 违规 | 持平（`depcruise.log`） |
| lint | `pnpm lint` | 0 | **1541 warnings + 47 infos** | 与审计基线完全持平（`lint.log`） |
| 预算 | `pnpm budget` | **1** | `asCast 32/31`、`bigFiles 6/4` 超预算；`bang 89/90 ↓1`、any/tsIgnore/console/todo/defaultExport 持平 | **与审计基线同一失败画像，未新增债务**（`bang` 还少 1）；收口属包 3（`budget.log`） |
| 构建 | `pnpm --filter canvas build` | 0 | 230 modules，`main-BQfiOXXi.js` 419.11 kB | 浏览器证据前置（`build.log`） |
| canvas tests 类型（探底） | 临时 TS Compiler API 脚本（用完已删） | 0 | **9 条诊断**，与审计口径一致（2 条 `node:fs/node:path` 环境缺失 + 7 条既有：潜在 undefined/元素类型/只读赋值/句柄不完整/保存返回类型） | **零新增**；正式纳入门禁属包 3（`test-types.log`） |

新增用例分布：`save-lifecycle.test.tsx` 11、`free-canvas-save-lifecycle.test.tsx` 4、`useDocumentActions.test.tsx` +7（共 58 条在本次相关 4 文件中）。

## 5. 实际接口与包 2/3 接入点

`apps/canvas/src/documentLifecycle.ts`（应用内部，不新增包公开导出）：

```ts
export type SaveIntent = 'auto' | 'manual' | 'save-as';
export type SaveCompletion =
  | { kind: 'saved'; current: boolean }
  | { kind: 'downloaded'; current: boolean }
  | { kind: 'cancelled' | 'blocked' | 'failed' | 'stale' };

export interface DocumentLeavePort {
  flushEdits(): boolean;          // 包 2 实现（未提交的编辑草稿）
  isDirty(): boolean;
  isSaving(): boolean;
  waitForIdle(): Promise<void>;   // 只等已开始的 I/O，不自动唤起选择器
  save(): Promise<SaveCompletion>;
}
export const SAVE_BUSY_NOTICE = '正在保存上一份改动，请稍后重试（本次未发起新的写入）。';
```

`apps/canvas/src/hooks/useDocumentSaveSession.ts`（协调器 + React 接入）：

```ts
class DocumentSaveSession {
  beginDocument(): void;                    // 显式文档替换 → 推进令牌；未开始任务→stale
  isSaving(): boolean;                      // 仅当前会话的活动任务（旧会话 finally 不影响）
  waitForIdle(): Promise<void>;
  submit(request: {
    intent: SaveIntent;
    guard?: () => boolean;                  // false → blocked（不入队、不闪 saving）
    capture: () => { source: string; content: unknown } | null;  // 轮到本任务时才捕获
    write: (snapshot) => Promise<SaveOutcome>;
    commit: (snapshot, outcome, current) => void;  // current=false 时调用方必须保持 dirty
  }): Promise<SaveCompletion>;              // 永不 reject
  dispose(): void;                          // 卸载：待发取消 + 令牌作废
}
useDocumentSaveSession({ readContent }): { session; saving };  // saving = useSyncExternalStore
```

`useAutoSave`：新增 `session`（去掉 `onSavingChange`），调度改为「内容身份变化即重排」。
`useDocumentActions`：`handleSave()/handleSaveAs(): Promise<SaveCompletion>`；新增 `session`，去掉 `onSavingChange`；`applyDoc` 在 `setDoc` 前调用 `session.beginDocument()`。
`useDocumentSwitch`：新增可选 `session`，`doc.source` 变化时兜底推进令牌。
`useFreeCanvasDocument({ host, initialName, onDocChange })` → `{ name, model, dirty, saving, notice, setNotice, applyModel, updateModel, save }`。

包 2 接入方式（不需要复制第二套保存实现）：

1. 导图侧 port：`{ flushEdits: <包 2 的编辑草稿提交>, isDirty: () => controller.dirty, isSaving: () => saveSession.isSaving(), waitForIdle: () => saveSession.waitForIdle(), save: handleSave }`。
   > ⚠️ 这三处必须用箭头包装：`isSaving` / `waitForIdle` / `beginDocument` 是类原型方法，直接取引用会丢 `this`（第二轮复核提醒；本行已在第三轮修正，覆盖首轮写法）。
2. 自由画布侧 port：`{ flushEdits, isDirty: () => dirty, isSaving: () => saving, waitForIdle, save }`（`saving`/`save()` 由 `useFreeCanvasDocument` 提供）。
3. 离开判据：`SaveCompletion` 的 `downloaded` / `current:false` / `failed` / `blocked` / `cancelled` / `stale` 一律**不算**「已确认落盘」，必须重新读 `isDirty()/isSaving()`；`blocked` 也用于「写入忙」，语义统一为「本次请求未发起、文档状态未改变」。
4. 自由画布的文档替换入口（新建/打开/最近/演示）已统一走 `applyModel`（内部推进令牌）；App 层只需在替换前先做保存/放弃/取消询问。

与计划的偏差及理由：

- `beginDocument` 除 `applyDoc` 外还在 `useDocumentSwitch` 的 `source` 变化分支兜底推进一次（计划把该文件列入待改文件）。理由：覆盖不经 `applyDoc` 的替换路径；主推进仍是同步的 `applyDoc`，不依赖延后的被动 effect（计划要求）。重复推进是幂等的。
- `blocked` 同时承载「同步守卫拒写」与「写入忙拒绝启动选择器」，并新增 `SAVE_BUSY_NOTICE` 文案常量。理由：`SaveCompletion` 已冻结为计划所列联合类型，不新增成员；两种情形对调用方语义相同（未发起写入、状态未变）。
- `commit(snapshot, outcome, current)` 增加第三个参数 `current`（计划允许内部实现调整）。理由：内容已变时仍需回填 `savedSource`（磁盘确实是旧快照），但不得清脏 —— 该判定只能由协调器给出。
- 自由画布未新增自动保存、未加 App 层离开保护（计划已明确属包 2）。
- 会话令牌用内部单调数值 + 内容身份用调用方提供的不可变引用（计划允许「捕获不可变根/模型身份」），未改冻结公开接口语义（`markSaved()` 仍在调用方校验后调用，签名不变）。

## 6. 证据与复现入口

jsdom / 单测证据（全部 `outputs/save-lifecycle-2026-09-18/`）：

- `red-before-fix.log` — 修复前红灯（3 failed，含失败断言原文）；
- `task4-matrix.log` — 修复后 58/58 绿；
- `negative-control-A.log` / `negative-control-B.log` — 阴性对照精确变红；
- `canvas-suite.log`、`full-test-final.log`、`typecheck.log`、`depcruise.log`、`lint.log`、`budget.log`、`build.log`、`test-types.log`。

区分「本包接线」与「开工前视觉批次」用 `git --no-pager diff -- apps/canvas/src/MindmapStage.tsx`（本包接线 = 会话 hook 声明、`session:` 三处参数、删除本地 `saving` state；其余 `MEASURE-RANK` / `charOf` 等为开工前改动）。

真浏览器证据（Playwright，独立于 jsdom）：

- 脚本：`tools/verify-save-lifecycle.mjs`（新增），日志 `browser-verify.log`，退出码 **0 / PASS**；
- 旅程：内存句柄打开种子文档（auto-save 可用）→ 编辑① → 写入① 的 `createWritable().close()` 被脚本挂起 → 写入① 未完成时编辑② → 放行写入① → 断言：
  - 写入① 挂起期间与完成后指示器都是 `保存中…`（**不是** `✓ 已保存`）；
  - 真的发生第二次写入，且 `writes[1]` 含编辑②、`writes[0]` 含编辑①（数量恰为 2）；
  - 放行写入② 之后指示器才变 `✓ 已保存`。
- 产物新鲜度：脚本自带 `checkSnapshotFresh` / `assertLoadedBundle`，页面实际加载 `main-BQfiOXXi.js` = 产物入口（不是旧 bundle）。
- 未覆盖：系统文件选择器的真实唤起/取消（无头不可自动化）、跨浏览器、触控、离线 —— 已在 §2 声明。

## 7. 交付状态

- 精确 diff：见 §1 表（本包修改 7 文件 +415/-174 中含 `MindmapStage.tsx` 开工前视觉批次 +16/-3；新增 6 文件）。
- 未提交：**是**。本回执与全部实现只在工作区，未建 commit、未 `git add`、未 push（HEAD 仍 `a2ce72b`，本地领先远端 66 commits 的既有状态未变）。
- 未触碰禁区：`tools/graph-engine/`、`.cursor/mcp.json`、`.codebase-memory/`、`_tmp_93540_*`、他人临时文件、开工前视觉/度量改动。
- 停在此处等待主控复核；**不自动执行第 2 包**。

---

# 8. 独立复核返修（2026-09-18，复核后追加）

复核输入：`docs/dispatch/2026-09-18-save-lifecycle-review.md`（R1–R4 + 包 2 接口补充），
复现件 `outputs/save-lifecycle-review-2026-09-18/probes.test.tsx`（**未修改**，保护性期望原样保留）。
本轮 HEAD 仍 `a2ce72b`，未提交、未 push、未 pull/rebase/reset/stash；视觉/度量改动与禁区未动。

## 8.1 复现（先红）

```powershell
$env:PATH = '<local-path>' + $env:PATH
pnpm --filter canvas exec vitest run --config ../../outputs/save-lifecycle-review-2026-09-18/vitest.config.ts
```

| 时点 | 结果 | 日志 |
|---|---|---|
| 返修前 | **4 failed + 1 unhandled rejection**（与复核一致） | `review-repro-before.log` |
| 返修后 | **4 passed，0 unhandled error** | `review-probes-after.log` |

返修前探针输出原文（摘要）：`secondDestination: 'old.mm.md'` / `completion {kind:'failed'}, notice '保存失败'` /
`firstSettled:false, secondWrites:0, saving:true`。返修后：`secondDestination: 'new.mm.md'` /
`completion {kind:'stale'}, notice 'new document notice'` / `firstSettled:true, secondSettled:true, secondWrites:1, saving:false`。

## 8.2 四项修复

**R1 · 保存目的地的同步归属（`useDocumentSaveSession` + 三个调用方）**

- 会话新增 `setDestination(handle)` / `getDestination()`，`beginDocument(handle)` 同时换令牌与目的地。
- 所有写盘在**任务真正开始**时读 `session.getDestination()`，不再用入队时闭包里的 `doc.handle`；
  `commit` 把「实际写出的句柄」同步写回目的地 → 另存为成功后，已入队的 auto/manual 写新文件。
- 目的地初始化/跟随：`applyDoc` → `beginDocument(next.handle)`；`useDocumentSwitch`（source 变化兜底）
  → `beginDocument(doc.handle)`；`useAutoSave` 增加 `doc.handle` 变化时的次级同步 effect；
  自由画布 `applyModel` → `beginDocument(handle)`。
- 取消/失败不改目的地；同会话写入仍严格串行（探针与服务端并发计数均验证 max=1）。
- 手动保存的「无目的地」判据与写入共用同一事实源：`session.isSaving() && !session.getDestination()`
  才拒绝排队（避免「判定有句柄、写入却弹选择器」的错位）。

**R2 · 成功与失败一视同仁做会话归属（`drain`）**

写盘异常不再先行返回 `failed`：先做令牌核验 → 旧会话的 rejects 一律 `stale`（零回填、零通知）；
只有当前会话的失败才 `failed`。自由画布据此只在当前会话失败时设置「保存失败」，不再覆盖新文档提示。

**R3 · 当前会话失败可见（应用层）**

新增 `SAVE_FAILED_NOTICE`；auto/manual/save-as 的 `failed` 经既有通知渠道
（`onBlockedSave`，三条文案 `SAVE_BLOCKED_NOTICE` / `SAVE_BUSY_NOTICE` / `SAVE_FAILED_NOTICE` 区分
守卫拦截、写入忙、写入失败）上报到顶部通知条。取消与过期（stale）静默；失败保持 dirty 且不自动重试。

**R4 · 每个请求在所有异常路径收口（`drain` / `submit` / `publish`）**

| 边界 | 处理 |
|---|---|
| `guard` 抛错 | 按 `blocked` 收口（不逃逸、不入队、不闪 saving） |
| `capture` 抛错 | 该请求 `failed`，队列继续 |
| `write` 抛错 | 先做会话归属（旧会话 → `stale`），当前会话 → `failed` |
| `readContent` 抛错 | 保守视为「内容已变」→ `current=false`（不清脏），请求正常收口 |
| `commit` 抛错 | 请求按**写盘事实**收口（`saved`/`downloaded`），异常经 `onCommitError` 暴露，队列不悬挂（第三轮 R4-B 调整，见 §8.7.2） |
| 订阅者（渲染层）抛错 | 不中断写入队列 |

## 8.3 正式回归（保护性断言，非期望改写）

新增/扩展测试（canvas 267 → **284**，+17）：

| 文件 | 覆盖 |
|---|---|
| `tests/save-destination.test.tsx`（新增，4） | 另存为→排队 auto / 排队 manual 写新目的地、内容为最新、当前句柄不回退、取消与失败不改目的地、最大并发 1 |
| `tests/save-lifecycle.test.tsx`（+6） | 旧会话**失败** → stale 且不发失败通知；guard/capture/readContent/commit/write 五类异常边界收口与队列继续 |
| `tests/useAutoSave.test.tsx`（+2） | auto 失败 → 可见失败通知 + dirty 保持 + 不重试 + saving 回落；取消静默 |
| `tests/useDocumentActions.test.tsx`（+3） | 手动成功同步目的地；手动/另存为失败 → `{failed}` + 通知 + 不 markSaved/不 setDoc、目的地不变 |
| `tests/free-canvas-save-lifecycle.test.tsx`（+2） | 替换文档后旧请求失败 → `stale` 且不覆盖新提示、不清新文档 dirty；`waitForIdle/isSaving` 语义（含失效会话不计物理 I/O） |

**返修新增守卫的阴性对照**（临时中性化本包新增块，随即恢复；未用 `git restore` 覆盖任何文件）：

| 对照 | 中性化点 | 结果 | 日志 |
|---|---|---|---|
| C | `useAutoSave` 写盘目的地读回入队闭包 `doc.handle`（而非会话目的地） | **恰好 1 条转红**：另存为→排队 auto 目的地；其余 20 条绿 | `negative-control-C.log` |
| D | `drain` 的会话归属判定跳过写盘失败路径（`!writeFailed && …`） | **恰好 3 条转红**：导图「旧会话失败→stale」、自由画布「替换后失败→stale」、单测「write 抛错+旧会话 stale」 | `negative-control-D.log` |

## 8.4 接口交接（覆盖 §5 对应条目）

```ts
// DocumentSaveSession 新增
setDestination(handle: FsFileHandle | undefined): void;   // 同步事实源
getDestination(): FsFileHandle | undefined;               // 排队请求写盘时唯一句柄来源
beginDocument(handle: FsFileHandle | undefined): void;    // 令牌 + 目的地一起换

// documentLifecycle.ts 新增文案
export const SAVE_FAILED_NOTICE = '保存失败：写入未完成或未确认，改动仍保留在本地（未标记已保存）。';

// useFreeCanvasDocument 新增（包 2 交接）
isSaving(): boolean;              // 实时判据（不是渲染期 saving 布尔）
waitForIdle(): Promise<void>;     // 等**当前会话**已开始 I/O；不自动唤起选择器
```

包 2 语义边界（写入回执与 JSDoc 同步）：

- `isSaving()/waitForIdle()` 只反映**当前会话**。被替换会话（切文档/新建/打开/最近/演示/卸载）已发出的
  物理 I/O 无法撤回，会后台跑完且不再回填任何状态 —— 不能把 `waitForIdle()` 当作「磁盘上无未结束写入」。
- `SaveCompletion.failed` = **写盘未成功/未确认**（第三轮起；此时 `commit` 未执行 → dirty 保持），
  附属记录失败不降级为 failed 而是附属警告 —— 详见 §8.7.2；
  `downloaded` / `current:false` / `stale` / `cancelled` 均**不算**已确认落盘。
- 另存为/打开/补挂句柄后，目的地由会话同步持有：包 2 不要再从 `doc.handle` 推断目的地。

## 8.5 返修后门禁与浏览器证据

| 检查 | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 复核探针 | `pnpm --filter canvas exec vitest run --config ../../outputs/save-lifecycle-review-2026-09-18/vitest.config.ts` | 0 | 4 passed，0 unhandled error（`review-probes-after.log`） |
| 全量测试 | `pnpm test` | 0 | free-canvas 12 / kernel 622 / react 1497 / canvas **284** = **2415**（首轮 2398 → +17） |
| 类型 | `pnpm typecheck` | 0 | 4 子项目 Done |
| 依赖 | `pnpm depcruise` | 0 | 517 模块 / 1515 依赖，0 违规 |
| lint | `pnpm lint` | 0 | 1541 warnings + 47 infos（与首轮基线持平） |
| 预算 | `pnpm budget` | **1** | **既有失败不变**：`asCast 32/31`、`bigFiles 6/4`；`bang 89/90 ↓1`（无新增债务） |
| 构建 | `pnpm --filter canvas build` | 0 | `main-W9shIL4i.js` 419.85 kB |
| canvas tests 类型（探底，临时脚本用完已删） | TS Compiler API | 0 | **9 条诊断（与基线同）**，80 文件；零新增 |

真浏览器（Playwright，脚本本次扩展为两条旅程；产物为新构建）：

```powershell
node tools/verify-save-lifecycle.mjs http://localhost:5175   # exit 0 / PASS
```

- 旅程 A（P0-A 慢写窗口）：`保存中…` → 写入① 完成后仍 `保存中…` → 写入② 含最新编辑 → 写入② 完成后 `✓ 已保存`。
- 旅程 B（**R1 真浏览器复验**）：测点一写旧文件 → 另存为写新句柄（`e2e-save-as.mm.md`）→ 挂起期间编辑 →
  放行后排队 auto 第 3 次写入的目的地 = **新句柄**，内容含最新编辑；`handles = [旧, 新, 新]`，全程串行。
- 仍不覆盖：真实系统选择器的用户手势/取消（无头不可自动化，选择器以 mock 顶替）——与首轮相同的限制，
  留包 3 浏览器矩阵或人工核对。

## 8.6 本轮文件与偏差

- 修改：`useDocumentSaveSession.ts`（目的地 + 异常边界 + 归属顺序）、`useAutoSave.ts`（目的地/失败通知/
  目的地同步）、`useDocumentActions.ts`（目的地 + 失败通知 + beginDocument(handle)）、`useDocumentSwitch.ts`、
  `useFreeCanvasDocument.ts`（目的地 + isSaving/waitForIdle）、`documentLifecycle.ts`（失败文案）；
  测试 5 个文件；`tools/verify-save-lifecycle.mjs` 扩展旅程 B。
- 偏差：`onBlockedSave` 扩义为「保存未完成的统一通知渠道」（守卫/忙/失败三态，文案区分）——
  为兼容复核探针对该回调的既有期望，未新增并行回调；已在 §8.4 与该选项 JSDoc 写明。
- 复核意见未被削弱：探针文件原样保留，正式回归沿用其保护性期望（仅替换夹具接线与断言对象）。

---

## 8.7 第三轮收口：R4-B（写盘结果与附属记录分离）

第二轮复核确认 R1–R3 通过、R4 的悬挂/队列问题已修，仅剩 **R4-B**：真实手动保存先 `markSaved`
再 `remember`，后者抛错 → 协调器返回 `failed`，但 dirty 已清、提示仍称「未标记已保存」——
结果、状态、提示三者互相矛盾。本轮只收口该项，不启动包 2。

### 8.7.1 复现（先红）

```powershell
$env:PATH = '<local-path>' + $env:PATH
pnpm --filter canvas exec vitest run --config ../../outputs/save-lifecycle-review-2026-09-18/partial-commit.config.ts
```

| 时点 | 证据 | 日志 |
|---|---|---|
| 收口前 | `completion {kind:'failed'}` + `dirty:false` + 提示「…未标记已保存」→ 断言红 | `partial-commit-before.log` |
| 收口后 | `completion {kind:'saved', current:true}` + `dirty:false` + `savedSource:'# new edit\n'` | `partial-commit-after.log` |

（探针自身对两种策略都放行：failed 时必须保留 dirty，或写盘成功则返回 saved/current。）

### 8.7.2 选定语义（复核建议方案 1：区分写盘与附属记录）

- **`SaveCompletion` 只表达写盘事实**：
  - `failed` = 写盘未成功或结果未确认（`commit` 因此不执行 → dirty 保持原样，调用方不得清脏）；
  - `saved` / `downloaded` = 磁盘上确为该快照（含下载兜底），`current` 仍表示会话+内容是否匹配。
- **附属记录失败不降级结果**：最近列表 `remember` / 句柄回填失败时，结果仍 `saved` / `downloaded`，
  dirty 按内容归属正常处理，另经独立渠道给出**附属警告**
  （`SAVE_METADATA_WARNING`，`onSaveWarning` / 自由画布直接置提示）；不再出现「结果说失败、
  dirty 已清、提示说未标记已保存」。
- **实际写盘失败仍 `failed` + dirty 保持**（R3 语义不变）。
- **协调器保持收口与队列继续**：`commit` 抛错（含未预料异常）不再悬挂或中断队列；
  由于写盘已成功，结果按写盘事实收口，异常经新增的 `onCommitError` 端口暴露给渲染层。
- 契约文本同步写进 `documentLifecycle.ts`（`SaveCompletion` 文档 + 新常量）。

### 8.7.3 实现落点

| 文件 | 改动 |
|---|---|
| `documentLifecycle.ts` | `SaveCompletion` 文档改写（`failed` = 写盘未成功/未确认）；新增 `SAVE_METADATA_WARNING` |
| `useDocumentSaveSession.ts` | 构造参数新增 `onCommitError`；`drain` 的 commit 异常改为「按写盘事实收口 + 上报附属异常」 |
| `useDocumentActions.ts` | 新增 `onSaveWarning` 端口；commit 内 `remember` / `persistHandle` 各自 try/catch 并汇总为一次附属警告；写盘状态回填与 markSaved 顺序不变 |
| `useFreeCanvasDocument.ts` | 同样隔离 `host.remember`，失败时把提示替换为附属警告（dirty 仍按 `current` 处理） |
| `MindmapStage.tsx` | `onSaveWarning: setCommandNotice`、`onCommitError → SAVE_METADATA_WARNING` 接线 |

本轮**未新增 `as`/`!`/console/TODO**；`SaveCompletion` 联合类型与既有成员未改，仅语义文档与新常量。

### 8.7.4 正式回归（+3，全部为真实 hook）

| 文件 | 用例 | 断言 |
|---|---|---|
| `tests/save-destination.test.tsx` | 附属记录失败（remember 抛错） | 真实 `EditorController`：结果 `{saved,current:true}`、`dirty=false`、`savedSource` 已回填、提示为 `SAVE_METADATA_WARNING` 且**不是**失败文案、**后续保存仍可用**（再次编辑→再保存成功） |
| `tests/useDocumentActions.test.tsx` | 附属记录失败（remember 抛错） | mock controller：结果仍 `saved/current:true`、`markSaved` 照常、`setDoc` 回填、`onBlockedSave` 零调用、`onSaveWarning` 收到附属警告 |
| `tests/free-canvas-save-lifecycle.test.tsx` | 附属记录失败（remember 抛错） | 结果 `{saved,current:true}`、`dirty=false`、提示为附属警告 |
| `tests/save-lifecycle.test.tsx` | 协调器 `commit` 抛错（改写既有用例） | 结果按写盘事实 `{saved,current:true}`、`onCommitError` 恰一次、队列继续（第二次请求照常完成）、`saving` 回落 |

阴性对照 E（临时把 `remember` 的隔离去掉，随即恢复）：**恰好 2 条转红**（上述前两条），
其余 43 条绿 —— 证明新回归确实盯住该保护（`negative-control-E.log`）。

### 8.7.5 检查与证据

| 检查 | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 原 4 探针 | 复核 vitest config | 0 | 4 passed，0 unhandled error（`review-probes-after-r2.log`） |
| R4-B 探针 | partial-commit config | 0 | 1 passed（`partial-commit-after.log`） |
| 相关正式测试 | 5 文件 | 0 | **78 passed**（`r4b-formal.log`） |
| 全量测试 | `pnpm test` | 0 | 12 / 622 / 1497 / canvas **287** = **2418**（第二轮 2415 → +3） |
| 类型 / 依赖 / lint / 预算 / 构建 | `pnpm typecheck` / `depcruise` / `lint` / `budget` / `--filter canvas build` | 0/0/0/**1**/0 | lint 1541+47 持平；预算仍为既有 `asCast 32/31`、`bigFiles 6/4`（无新增债务）；构建 0 |
| canvas tests 类型探底（临时脚本用完已删） | TS Compiler API | 0 | 9 条诊断 = 基线，80 文件，零新增 |

真浏览器（重建产物后复跑既有两条旅程）：`node tools/verify-save-lifecycle.mjs http://localhost:5175`
→ 退出码 0 / **PASS**，页面实际加载 `main-DTucwP6_.js`（`browser-verify-r4b.log`）。
系统选择器手势仍未覆盖（无头不可自动化）——与首轮相同的限制。

### 8.7.6 包 2 接线补充（覆盖 §8.4 示例）

- 端口取值必须箭头包装：`isSaving: () => saveSession.isSaving()`、
  `waitForIdle: () => saveSession.waitForIdle()` —— 它们是类原型方法，直接引用会丢 `this`；
  自由画布 hook 暴露的 `isSaving` / `waitForIdle` 已是包装函数，可直接使用。
- 离开等待发生在**当前会话失效/Stage 卸载之前**；真正执行目标前重新读 `isDirty()` / `isSaving()`。
- 消费结果时按 §8.7.2 的语义：`failed` 才代表「没写成」（此时 dirty 必然仍为真）；
  `saved/downloaded + current:false` 表示「写的是更早的快照，最新编辑仍未落盘」。
