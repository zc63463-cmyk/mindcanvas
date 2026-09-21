# MODE-GUARD（第 2 包）交付回执

执行日期：2026-09-19。工作目录：`<workspace>`。
启动材料：`docs/dispatch/2026-09-19-mode-guard-start.md`；计划：`docs/superpowers/plans/2026-09-18-mode-guard.md`；
总纲：`docs/dispatch/2026-09-18-reliability-123-dispatch.md`；审计输入：`outputs/2026-09-18-progress-audit-and-actions.md` §3 P0-B。
前置：包 1 SAVE-LIFECYCLE 已由第三轮复核放行（`...save-lifecycle-review.md` 文末）。

状态：**包 2 实现与验证完成，已停下等待主控复核；未提交、未 push、未 pull/rebase/reset/stash，未启动包 3**。

## 1. 基线与工作区

| 项 | 开工 | 收工 |
|---|---|---|
| HEAD | `a2ce72b` | `a2ce72b`（本包零提交） |
| 既有改动 | 包 1（save-lifecycle）+ 视觉/度量批次 | **原样保留**，未被触碰/回退 |
| 本包新增 | — | 6 个源/测试文件 + 1 个浏览器脚本（见 §11） |
| 禁区 | `tools/graph-engine/`、`.cursor/mcp.json`、`.codebase-memory/`、`_tmp_*`、他人临时文件 | 未触碰 |

环境：`pnpm --version` = **10.33.2**（`<local-path>`，仅当前进程加 PATH）。日志统一 `outputs/mode-guard-2026-09-19/*.log`。

## 2. 任务完成情况

| 计划任务 | 状态 | 说明 |
|---|---|---|
| Task 1 离开决策器与三选项模态 | 完成 | 新建 `useUnsavedTransition` + `useDocumentLeaveRegistration`；`UnsavedPrompt` 明确升级为三选项（默认焦点非破坏性、Esc/遮罩=取消、Tab 约束、关闭恢复焦点、层级 600） |
| Task 2 编辑草稿的提交边界 | 完成 | 新建 `draftFlush`（沿既有 blur→commit 通道 + 组合未结束拒绝提交 + `hasPendingDraft` 供 beforeunload）；导图/自由画布端口都用它 |
| Task 3 App 双向模式与 Stage 内替换 | 完成 | App 只协调离开；`MindmapStage` 与 `FreeCanvasStage` 登记端口；`applyDoc` 与自由画布四入口统一走决策器；两模式 beforeunload |
| Task 4 跨模式验收与回执 | 完成 | 入口/分支矩阵测试、阴性对照、真浏览器旅程、门禁、本回执 |

未做（不掩盖）：系统文件选择器的**真实用户手势**未自动化（限制见 §10）；App 浮标/Stage 按钮的“加载中”态仅做了「未就绪=禁用」，未做骨架屏。

## 3. 入口清单（全量）

| # | 入口 | 触发点 | 是否经离开决策 | 证据 |
|---|---|---|---|---|
| 1 | 导图 → 自由画布（App 浮标） | `App.tsx` `[data-app-freecanvas]` | ✅ `requestLeave(() => setMode('free-canvas'))` | `mode-guard.test.tsx` 冷启动/导图小节；浏览器 A |
| 2 | 自由画布 → 导图（工具栏「← 导图」） | `FreeCanvasStage` `[data-fc-exit]` → App `backToMindmap` | ✅ | `mode-guard.test.tsx` 自由画布小节；浏览器 B/C/D |
| 3 | 导图打开（Ctrl+O / 工具栏「打开」/ file input / 拖入 / 工作区文件 / 文件库） | `useDocumentActions.handleOpen` → `applyDoc` | ✅（单点收口） | `useDocumentActions.test.tsx` applyDoc 4 例 |
| 4 | 导图新建 | `handleNew` → `applyDoc` | ✅ | 同上 |
| 5 | 导图最近 / 演示 / FileManager | `applyDoc` | ✅ | 同上 |
| 6 | 自由画布新建 | `[data-fc-new]` → `leaveOr` | ✅ | `free-canvas-leave.test.tsx` 新建例 |
| 7 | 自由画布打开（picker / file input） | `[data-fc-open]` → `leaveOr` | ✅ | 同上 打开例 + `mode-guard.test.tsx`「dirty 时打开也确认」 |
| 8 | 自由画布最近 | `[data-fc-recent-item]` → `leaveOr` | ✅ | `free-canvas-leave.test.tsx` 最近例 |
| 9 | 自由画布看演示 | `[data-fc-demo]` → `leaveOr` | ✅ | 同上 演示例 |
| 10 | 启动页「自由画布」入口 | `StartupScreen onOpenFreeCanvas` = App 回调 | ✅（干净端口放行） | §7 启动页/解析失败端口 |
| 11 | 页面关闭/刷新 | beforeunload（两模式） | ✅ 原生拦截（不弹自定义模态） | `free-canvas-leave.test.tsx`；浏览器 D2 |
| 12 | 普通保存（Ctrl+S / 保存按钮 / 自动保存） | `handleSave` / `useAutoSave` | —（不离开，走包 1 结果） | 包 1 回归保持绿色 |

## 4. 决策分支矩阵（与计划「决策规则」逐条对应）

| 场景 | 期望 | 实测证据 |
|---|---|---|
| 干净且无 I/O | 直接执行目标 | `unsaved-transition` 首例；`mode-guard` 冷启动两例 |
| 未就绪（无端口） | 不放行（App 按钮禁用，不造短窗口） | `unsaved-transition` 未登记例；`App.tsx` `disabled={!ready}` |
| 输入框有未提交修改 | 先 flush 再判 dirty | `draftFlush` + 端口接线；`mode-guard` 组合例（D1） |
| 组合未结束 | 暂缓离开 + 明确提示；结束后可继续 | `unsaved-transition` 组合例；浏览器 D1 |
| dirty → 取消 / Esc / 遮罩 | 目标不执行、内容保留 | `mode-guard`（Esc/遮罩）、浏览器 A4/A5 |
| dirty → 放弃 | 停排新 auto + 等已发 I/O 收束 + 执行目标 | `unsaved-transition` 放弃两例（suppressPendingAuto / waitForIdle） |
| dirty → 保存成功 | 仅 `saved,current=true` 且复核 dirty/saving 通过才执行 | `unsaved-transition` 成功例 + 复核失败例；浏览器 A8/B3 |
| 保存期间继续编辑 | 不离开，提示需再保存或放弃；不无限等待 | `unsaved-transition`「复核发现仍 dirty」例（阴性对照 G 命中它） |
| 保存失败/取消/被拦/过期 | 不执行目标 + 对应提示（可重试） | `unsaved-transition` `failed/blocked/cancelled/stale` 四例 |
| 下载兜底 | **不自动离开** + 准确提示 + 取消/显式放弃 | `unsaved-transition` downloaded 例；`mode-guard` 下载例；浏览器 C1/C2 |
| 当前已保存中 | busy 提示；不重复提交；写完重新判定 | `unsaved-transition`「打开时已有写入」+「重复点只发一次」 |
| 连续点击不同入口 | 一次只处理一个；第二次直接 false | `unsaved-transition` 重复点击例；`mode-guard` 连续点击例 |
| 遮罩不可穿透 | 下层按钮点不到 | `mode-guard` A6（`elementFromPoint` 命中遮罩）；浏览器 A6 |
| 键盘焦点 | 默认非破坏性、Tab 约束、Esc 取消、关闭恢复 | `useDocumentActions.test.tsx` 键盘/焦点恢复；浏览器 A7 |

## 5. 红 → 绿与阴性对照

**先复现（正确期望）**：审计 P0-B「切模式静默丢弃便签」在 `mode-guard.test.tsx` 里被改写成正确期望
（切模式必须出现确认；取消保留便签与当前模式；放弃才离开；保存成功才离开）。实现在前、断言在后，
红灯由下面的阴性对照给出（见「阴性对照 F」：去掉守卫后 7 条立刻变红）。

**阳性证据**：`node apps/canvas/node_modules/vitest/vitest.mjs run --root apps/canvas tests/unsaved-transition.test.tsx tests/mode-guard.test.tsx tests/free-canvas-leave.test.tsx`
→ 3 文件 / 36 条全绿（`mg-fc.log`、`fix-check2.log`）。

| 对照 | 临时中性化 | 结果 | 日志 |
|---|---|---|---|
| F · 去掉 App 登记守卫（App 直接 `setMode`） | `App.tsx` 两个入口绕过 `requestLeave` | **7 条转红**（自由画布取消/下载/保存、导图取消/保存、组合、重复点击），3 条干净路径保持绿 | `negative-control-F.log` |
| G · 去掉完成前 dirty 复查（把一次 `saved` 当通行证） | `useUnsavedTransition.saveRequest` 删掉 `isDirty()/isSaving()` 复核 | **恰好 1 条转红**（保存期间继续编辑 → 不离开） | `negative-control-G.log` |

两处改动都在验证后**只恢复该块**（未用 `git restore`/`checkout` 覆盖任何文件）。

## 6. App 层不丢内容的证据

- **自由画布**（`mode-guard.test.tsx` 首例）：建便签 → 点「← 导图」→ 断言 `[data-unsaved-prompt]` 出现且仍在自由画布；
  「取消」后 `[data-fc-card]` 仍为 1、仍在自由画布；再请求「放弃修改」才回到导图；再次进入是空 Stage
  （放弃的结果，不是恢复缺陷）。**修复前对应行为由阴性对照 F 复现为 7 条红。**
- **导图**：改节点文本 → 点浮标 → 确认框出现且未切换；取消后节点文本仍是改后的值、`[data-save-state]` 仍「未保存」。
- **真浏览器**（§10 旅程 A）：确认框出现 → Esc 取消后**编辑内容仍在画布上**；确认后写盘内容含编辑文本（A9）。
- **组合输入**：编辑态派发 `compositionstart` → 切模式被暂缓并提示；`compositionend` 后可继续保存离开（jsdom + 浏览器各一）。

## 7. 实现要点与关键取舍

- **App 只协调离开**：`useUnsavedTransition` 单实例持有端口与三选项状态；App 不持有任一模式的文档内容，
  不同时挂载两个 Stage，不新建保存队列（保存仍走包 1 的 `DocumentSaveSession`）。
- **端口登记**：`useLeavePortRegistration` 用 `useLayoutEffect` 在首次绘制前登记，方法体经 ref 读实时状态；
  注册返回的清理按**身份**判定 —— 旧 Stage 的清理不会注销刚挂载的新 Stage（`unsaved-transition` 有例）。
- **启动页 / 解析失败态**：也要登记端口，否则模式入口会被「未就绪」挡住。
  启动页 = 干净端口（尚无可编辑内容）；解析失败 = `isDirty: () => !doc.saved`（拖入/导入后从未落盘的源文
  不允许被当作可安全丢弃，必须用户显式放弃）。
- **`suppressPendingAuto`**（端口可选扩展）：用户选「放弃」时停排新的自动保存（导图清 debounce timer；
  自由画布无自动保存，不实现）。已开始的 I/O 仍等收束。
- **「保存并继续」等待语义**：若已有写入在跑（例如自动保存刚好在跑），先 `waitForIdle()` 等它收束再写；
  模态显示「正在收束已开始的写入…」。按钮**不置 disabled**（避免死按钮），重复提交由请求级 `saving` 标记拦住。
- **flush 通道**：只对**当前聚焦的表单控件**调用 `blur()`，由控件自身既有 commit 通道提交（不读 DOM value、
  不绕过业务校验）；组合未结束直接返回 false（避免把未确认的候选串当正文提交）。
- **beforeunload**：`controller.dirty || isSaving() || hasPendingDraft()`（导图）/ `isDirty() || isSaving() || hasPendingDraft()`（自由画布）；
  不在 unload 里弹自定义异步模态。

## 8. 随包校正：下载事实与附属警告（第三轮复核交接项）

- `SAVE_METADATA_WARNING`（fs 分支）与新增 `SAVE_METADATA_WARNING_DOWNLOAD`（下载分支）分离：
  后者措辞为「已发起下载；但最近记录/句柄回填失败（下载不代表文件已落盘，请确认文件已保存）」，
  不再对下载分支声称「已写入文件」。落点：`useDocumentActions` 手动/另存为的附属失败、`useFreeCanvasDocument` 提交失败。
- `SaveCompletion` 文档措辞同步：`saved` = 宿主报告写入成功；`downloaded` = 仅触发下载；
  `failed` = 未获成功确认（保持原 dirty，不等于必然 dirty=true）。
- 回归：`unsaved-transition` downloaded 例 + `mode-guard` 下载例（**downloaded + 不自动离开**）；
  自由画布「下载兜底 + remember 失败」也已按分支取文案。
- 回执 §8.7.2 的「saved/downloaded 均已落盘」表述已由本轮报告 §8 覆盖修正。

## 9. 门禁结果

| 检查 | 命令 | 退出码 | 结果 | 与上一基线对比 |
|---|---|---|---|---|
| 全量测试 | `pnpm test` | 0 | free-canvas 12 / kernel 622 / react 1497 / canvas **324** = **2455** | 上次 2418 → **+37**（本包新增用例） |
| 类型 | `pnpm typecheck` | 0 | 4 子项目 Done | 持平 |
| 依赖 | `pnpm depcruise` | 0 | 523 模块 / 1534 依赖，0 违规 | 持平（模块数随新文件增长） |
| lint | `pnpm lint` | 0 | **1539 warnings + 48 infos**（合计 1587） | 上次 1541+47=1588 → **−1** |
| 预算 | `pnpm budget` | **1** | 既有失败不变：`asCast 32/31`、`bigFiles 6/4`；`bang 89/90 ↓1`，其余持平 | **无新增债务**（收口仍属包 3） |
| 构建 | `pnpm --filter canvas build` | 0 | `main-vAJwF9t-.js` 426.36 kB | 浏览器证据前置 |
| canvas tests 类型探底（临时脚本用完已删） | TS Compiler API | 0 | **9 条诊断 = 基线**（86 文件，新增 6 个测试文件零新增诊断） | 持平 |

新增用例分布：`unsaved-transition.test.tsx` **19**、`mode-guard.test.tsx` **10**、`free-canvas-leave.test.tsx` **7**（合计 36，
逐文件实测）；`useDocumentActions.test.tsx` 迁移（applyDoc 4 + 三选项模态 7，41 条）。

## 10. 真浏览器验证与限制

```powershell
pnpm --filter canvas build
# 静态托管 dist（vite preview --port 5175）
node tools/verify-mode-guard.mjs http://localhost:5175     # 退出码 0 / PASS
```

产物新鲜度：脚本自带 `checkSnapshotFresh` / `assertLoadedBundle`，页面实际加载 `main-vAJwF9t-.js` = 产物入口。

| 旅程 | 覆盖 | 结果 |
|---|---|---|
| A | 导图编辑 → 浮标 → 确认框出现 → Esc 取消（内容保留、仍在导图）→ 点遮罩取消 → `elementFromPoint` 命中遮罩（不可穿透）→ Tab 循环焦点仍在模态 → Enter 激活「保存并继续」→ 写盘后进入自由画布；写盘文本含编辑内容 | ✅ A1–A9 |
| B | 自由画布「打开」带句柄文档（真实 picker 位置由内存句柄顶替）→ 落便签 → 「← 导图」→ 确认 → 保存并继续 → 写回句柄 → 回到导图 | ✅ B1/B2a/B2/B3 |
| C | `?nofs=1`（无 showSaveFilePicker）→ 建便签 → 返回导图 → 保存并继续 → **留在自由画布** + 提示「已发起下载…」→ 放弃修改才离开 | ✅ C1/C2 |
| D | 自由画布卡片编辑态派发 `compositionstart` → 返回导图被暂缓 + 提示「输入法组合未结束」；dirty 时 `beforeunload` 被 `defaultPrevented`；取消后便签仍在 | ✅ D1–D3 |

**仍不覆盖（如实注明）**：真实系统文件选择器的用户手势/取消（无头不可自动化，脚本用内存句柄顶替 picker）；
跨浏览器（只跑 Chromium）；触控；离线。刷新/关闭只用 `beforeunload` 事件断言，未走浏览器原生对话框 UI。

## 11. 实际接口与文件

```ts
// apps/canvas/src/documentLifecycle.ts（新增/扩展）
export type LeaveChoice = 'save' | 'discard' | 'cancel';
export type RequestLeave = (perform: () => void | Promise<void>) => Promise<boolean>;
export interface DocumentLeavePort {
  flushEdits(): boolean;                    // false = 组合未结束/校验失败 → 不得离开
  isDirty(): boolean;
  isSaving(): boolean;
  waitForIdle(): Promise<void>;             // 只等当前会话已开始的 I/O
  save(): Promise<SaveCompletion>;
  suppressPendingAuto?: () => void;         // 「放弃」时停排新的自动保存（可选）
}
export const SAVE_METADATA_WARNING;          // fs 分支附属警告
export const SAVE_METADATA_WARNING_DOWNLOAD; // 下载分支附属警告（不声称已落盘）

// apps/canvas/src/hooks/useUnsavedTransition.ts（新增）
export interface LeavePromptState { notice: string | null; busy: boolean }
export interface UnsavedTransition {
  ready: boolean;
  prompt: LeavePromptState | null;
  requestLeave: RequestLeave;
  choose: (choice: LeaveChoice) => void;
  registerPort: (port: DocumentLeavePort | null) => () => void;  // 返回按身份判定的清理
}
export function useUnsavedTransition(): UnsavedTransition;
export const LEAVE_COMPOSITION_NOTICE / LEAVE_SAVING_NOTICE / LEAVE_SETTLING_NOTICE /
             LEAVE_SAVE_AGAIN_NOTICE / LEAVE_DOWNLOAD_NOTICE / LEAVE_FAILED_NOTICE /
             LEAVE_BLOCKED_NOTICE / LEAVE_CANCELLED_NOTICE / LEAVE_STALE_NOTICE;

// apps/canvas/src/hooks/useDocumentLeaveRegistration.ts（新增）
export function useLeavePortRegistration(
  register: ((port: DocumentLeavePort | null) => () => void) | undefined,
  buildPort: () => DocumentLeavePort,
): void;

// apps/canvas/src/draftFlush.ts（新增）
export function flushActiveDraft(): boolean;   // 聚焦控件 blur→commit；组合未结束返回 false
export function hasPendingDraft(): boolean;    // beforeunload 条件（排除搜索框一类非内容输入）

// apps/canvas/src/UnsavedPrompt.tsx（升级：两按钮 → 三选项）
export interface UnsavedPromptProps {
  open: boolean;
  notice?: string | null;   // 保存失败/下载/组合未结束…（模态内可见）
  busy?: boolean;           // 显示进行中文案 + aria-busy（不置 disabled）
  onChoice: (choice: LeaveChoice) => void;
}
// data-unsaved-prompt / -backdrop（z-index 600 / -save / -discard / -cancel / -notice

// Stage props（应用层，可选字段；不改 React 包冻结导出）
MindmapStageProps { onOpenFreeCanvas?; requestLeave?: RequestLeave; registerLeavePort?: RegisterLeavePort }
FreeCanvasStageProps { onExit; onDocChange?; requestLeave?: RequestLeave; registerLeavePort?: RegisterLeavePort }
// useDocumentActions：confirmDiscard → requestLeave（applyDoc 经决策器；缺省直接替换）
// useFreeCanvasDocument：新增 isDirty(): boolean（实时判据，供端口使用）
```

文件清单（相对 HEAD）：

```
新增  apps/canvas/src/draftFlush.ts                            85 行
新增  apps/canvas/src/hooks/useUnsavedTransition.ts           243 行
新增  apps/canvas/src/hooks/useDocumentLeaveRegistration.ts     31 行
新增  apps/canvas/tests/unsaved-transition.test.tsx           427 行
新增  apps/canvas/tests/mode-guard.test.tsx                   339 行
新增  apps/canvas/tests/free-canvas-leave.test.tsx            240 行
新增  tools/verify-mode-guard.mjs                             322 行

修改  apps/canvas/src/App.tsx                            +45/-9
修改  apps/canvas/src/FreeCanvasStage.tsx                +86/-64（含包 1 抽取的累计差异）
修改  apps/canvas/src/MindmapStage.tsx                  +106/-35（含开工前视觉批次）
修改  apps/canvas/src/UnsavedPrompt.tsx                 +137/-26
修改  apps/canvas/src/hooks/useDocumentActions.ts       +204/-88（含包 1 累计差异）
修改  apps/canvas/tests/useDocumentActions.test.tsx     +409/-62（迁移 + 新增）
（包 1 新增文件 documentLifecycle.ts / useFreeCanvasDocument.ts 本包继续扩展）
```

## 12. 偏差与说明

- 计划允许「`useDocumentLeaveRegistration` 若少量接线可合并」——本包**保留独立文件**（31 行，登记/清理语义与决策器正交）。
- 计划要求「busy 时阻止重复保存及切换提交」：实现为**请求级标记**而非按钮 `disabled`
  （真实浏览器实测：自动保存常在确认框出现时正在跑，disabled 会让「保存并继续」变成死按钮）；
  重复点击只发起一次保存有专门用例。
- 计划要求「放弃时不再排定新的 auto」：通过端口可选方法 `suppressPendingAuto` 实现（导图清 timer）；
  自由画布无自动保存故不实现该方法。
- 新增可选端口成员 `suppressPendingAuto` 属包 1 冻结接口的**向后兼容扩展**，已在此注明；
  包 1 的全部回归（78 条相关 + 全量）保持绿色。
- 启动页/解析失败态的端口策略是本包新增决定（见 §7），计划原文只说「未就绪时先禁模式按钮」。

## 13. 交付状态

- 未提交：**是**。本回执与全部实现只在工作区，未建 commit、未 `git add`、未 push（HEAD 仍 `a2ce72b`）。
- 未触碰禁区与既有视觉/度量改动；未执行 pull/rebase/reset/stash。
- 停在此处等待主控复核；**不自动执行第 3 包**（含既有预算红灯收口与系统选择器人工核对）。

---

# 附：复核返修（MG-R1 / MG-R2 / MG-R3）· 2026-09-19

输入：`docs/dispatch/2026-09-19-mode-guard-review.md`（结论「暂不通过」）。本节**追加**，第 1–13 节的首轮记录原样保留（含 §5「实现在前、断言在后」的事实承认）。
本轮只收口三项及其同族时序；未扩展自动草稿、历史栈、持久化框架或无关视觉。仍未提交（HEAD `a2ce72b`）。

## R0. 起点：先复现复核的 5 条正确期望探针（全红）

```powershell
$env:PATH = '<local-path>' + $env:PATH
pnpm --filter canvas exec vitest run --config ../../outputs/mode-guard-review-2026-09-19/vitest.config.ts
```

| | 结果 | 日志 |
|---|---|---|
| 复现（返修前） | **1 文件 / 5 failed**，退出码 1；`composition blur evidence { editorStillPresent: false, committedCandidate: '尚未确认的候选文字', notice: '正在输入（输入法组合未结束）…' }` | `outputs/mode-guard-review-2026-09-19/repro-before.log` |
| 返修后 | **1 文件 / 5 passed**，退出码 0（期望未反转） | 同目录 `probes-final.log` |

## R1. MG-R1：组合输入跟踪与「不提前提交候选文字」

三处改动（缺一不可）：

1. **跟踪改为模块加载即安装**（`draftFlush.ts`）：`trackComposition()` 在模块初始化时执行，
   `hasActiveComposition()` 只作兜底。原「首次 flush 才装」会漏掉「先开始组合、随后才第一次请求离开」
   的冷启动时序 → 首次 flush 误判可提交。新增 `subscribeCompositionEnd(listener)` 供决策器续跑。
2. **编辑器提交边界拒绝未完成组合，并在组合结束时补提交**：
   `packages/react/src/free-canvas/NativeCard.tsx`（`[data-fc-editor]`）与
   `packages/react/src/edit/OverlayEditor.tsx`（`[data-overlay-editor]` 单行/换行两态）
   都在 blur 提交处检查本组件的组合态：组合中 → **不提交**、记下「待提交」；
   `compositionend` 时若存在待提交 → 用**已确认**的文字补提交（否则确认文字只留在 DOM 里，离开即丢）。
   这是「点工具栏/模态抢焦点导致的失焦提交」的**根因防线**（真实浏览器里入口点击本身就会触发失焦）。
3. **组合未结束不弹模态，改为非模态提示 + 暂缓请求**（`useUnsavedTransition.ts` + `App.tsx`）：
   模态的自动聚焦正是失焦提交的触发者。新行为：`flushEdits() === false` →
   保留编辑焦点，渲染不可交互的 `[data-unsaved-blocked]` 提示（`pointerEvents: none`），
   请求保持活动并订阅 `compositionend`；组合结束后**在事件派发结束的微任务里**续跑
   （不能同步续跑：编辑器自己的 `compositionend` 处理器在冒泡阶段，晚于 document capture 监听，
   同步续跑的 blur 会被编辑器判成「组合未结束」而拒绝提交 —— 实测踩到并已修）。

**行为变更（如实标注）**：组合未结束不再出现三选项模态（改为非模态提示），因此两条既有断言随之更新：
`mode-guard.test.tsx` 的「组合输入未结束…」与 `unsaved-transition.test.tsx` 的「flush 失败（组合未结束）…」。
两者断言的**语义**未变（不离开 + 明确提示 + 内容不丢），落点从模态内提示改为非模态提示，并各自新增
「组合结束后自动续跑」断言。真浏览器旅程 D 已覆盖：编辑器保留（同一元素）、未回写模型、
不弹模态、非模态提示可见、`beforeunload` 仍拦截、组合结束后自动续跑、保存写出确认文字。

## R2. MG-R2：请求绑定端口登记代次

`useUnsavedTransition.ts` 重写要点：

- `registerPort()` 每次登记分配 **`gen` 代次**；`ActiveRequest` 记下发起时的 `(port, gen)`。
- 归属判定 `owns(request) = activeRef===request && !invalidated && portRef.current?.gen===request.gen`；
  **每个 await 之后**（`waitForIdle`、`port.save()`）与**执行目标之前**都核一次。
- 端口**注销**（清理函数）、**被替换**（新端口登记）、**决策器卸载** → `abandon(...)` 把该端口上
  **尚未开始执行目标**的请求立即结算 `false`、关闭模态、解绑组合订阅；**已开始执行目标**的不动
  （正常切换必然导致 Stage 卸载，不能误判为失败）。
- 旧 Stage 的清理仍按身份判定：`portRef.current?.gen !== gen` 时直接返回（既不注销新端口、也不结束新请求）。
- 端口方法抛错也结束请求（`try/catch` → `settle(false)`），不留下悬挂互斥把后续入口永久挡住。

## R3. MG-R3：异步目标的互斥与解锁

- `runTarget` 不再在 `perform()` 之前清空 `activeRef`：先置 `executing`，**目标收束**（成功或失败）才结算；
  异步目标期间第二次 `requestLeave` 直接 `false` 且零执行。
- 精确区分「执行完」：同步目标（常规 `setMode`/`applyModel`）**调用返回即执行完**，立刻收束互斥；
  若把释放一律推迟到 `await` 之后，会晚一个微任务释放，导致同一 tick 的连续入口点击被吞
  （返修中实测到 6 条既有用例因此转红，已按此语义修正）。
- 目标抛错/拒绝 → 结算 `false` 且解锁（后续请求正常可用，不悬挂）。

## R4. 红 → 绿与四项阴性对照（本轮新增）

返修不是只让探针变绿：把探针断言纳入正式回归，并对每项修复做**中性化对照**（改完即恢复该块）。

| 对照 | 临时中性化 | 命中（转红） | 日志 |
|---|---|---|---|
| N1 | 组合跟踪改回「首次 flush 才安装」 | 探针 `first leave attempt…` + 正式 `冷启动：任何 flush 之前就已 compositionstart` | `neg-N1-probes.log` / `neg-N1-unit.log` |
| N2 | 去掉编辑器提交边界的组合保护（`NativeCard.commit`） | **真浏览器** D1：`editorKept:false`、`frontsWhileComposing` 回升（=候选串回写模型），D5 连带超时 | `neg-N2-browser.log` |
| N3 | 端口注销时不结算该端口的在途请求 | 探针 `unregistering a port…` + 正式「待选择时注销端口…」「保存进行中注销端口…」 | `neg-N3-probes.log` / `neg-N3-unit.log` |
| N4 | 目标执行前就清空 `activeRef`（旧行为） | 探针 `single request ownership…` + 正式「异步目标执行期间保留互斥…」 | `neg-N4-probes.log` / `neg-N4-unit.log` |

N2 的说明（如实）：jsdom 的 `fireEvent.click` 不会移动焦点，所以 jsdom 端在去掉防线后仍绿；
该防线的必要性由**真实浏览器**对照证明（浏览器点击本身就触发 blur）。这也是「合成事件 ≠ 真实输入法」
分界的具体体现。

## R5. 正式同族矩阵（本轮新增/更新用例）

`apps/canvas/tests/unsaved-transition.test.tsx`（19 → 32 条）：

- 草稿 flush · 组合跟踪：冷启动首次 flush 必须 false；组合结束通知订阅者（解绑后不再回调）。
- 端口归属（MG-R2）：待选择时注销 → 结算 false + 模态关闭；保存中注销 → 迟到结果不执行旧目标、不改写提示；
  保存中被替换 → 旧目标零执行 + **新端口请求仍可用**；等待收束中被替换 → 迟到结果零副作用；
  决策器卸载 → 未执行目标的请求结算 false；旧清理晚于新登记 → 不清端口也不结束新请求。
- 异步目标（MG-R3）：执行期间互斥保留（第二次 false 且零执行）+ 完成后解锁；目标失败 → 结算 false 且解锁；
  目标执行导致端口注销（正常切换）→ 结算 **true**，不误判失败。
- 组合暂缓：第二次请求被拒（单请求）；暂缓期间取消/卸载 → 解绑监听，迟到 `compositionend` 不再续跑。
- 更新：`flush 失败（组合未结束）` → 改为「不弹模态 + 非模态提示 + 暂缓；结束后自动续跑」。

`apps/canvas/tests/mode-guard.test.tsx`（10 → 11 条）：更新组合用例到新契约（非模态提示 + 自动续跑）；
新增「组合输入中点入口：候选文字不进模型/不写盘；结束后最后确认文字准确保存」
（用 `[data-fc-front]` 计数作「未回写模型」投影证据 + 句柄写出文本作文件级证据）。

## R6. 实际接口增量

```ts
// draftFlush.ts
export function subscribeCompositionEnd(listener: () => void): () => void;  // 组合结束订阅（决策器续跑用）

// useUnsavedTransition.ts
export interface UnsavedTransition {
  ready: boolean;
  prompt: LeavePromptState | null;
  blockedNotice: string | null;   // 新增：非模态提示（组合未结束 → 已暂缓，完成输入后自动继续）
  requestLeave: RequestLeave;
  choose: (choice: LeaveChoice) => void;
  registerPort: (port: DocumentLeavePort | null) => () => void;   // 每次登记分配代次；清理按代次判定
}
export const LEAVE_COMPOSITION_DEFERRED_NOTICE;   // 新增文案（组合未结束的暂缓提示）

// 端口契约语义（未改字段，明确语义）
// - flushEdits()===false ⇒ 组合未结束/草稿校验失败：决策器**不弹模态**、暂缓请求
// - 端口注销/替换/决策器卸载 ⇒ 其**尚未执行目标**的请求结算 false；目标已开始的由执行结果决定
```

## R7. 门禁（返修轮）

| 检查 | 命令 | 退出码 | 结果 | 对比 |
|---|---|---|---|---|
| 复核探针 | `pnpm --filter canvas exec vitest run --config …/vitest.config.ts` | 0 | **5 passed** | 返修前 5 failed |
| 相关四文件 | `vitest run tests/unsaved-transition 等` | 0 | **91 passed**（77 → 91，+14） | 首轮 77 |
| canvas 全量 | `vitest run --root apps/canvas` | 0 | **41 files / 338 passed** | 首轮 324（+14） |
| 全仓测试 | `pnpm test` | 0 | free-canvas 12 / kernel 622 / react 1497 / canvas 338 = **2469** | 首轮 2455（+14） |
| 类型 | `pnpm typecheck` | 0 | 4 子项目 Done | 持平 |
| 依赖 | `pnpm depcruise` | 0 | 523 模块 / **1536** 依赖，0 违规 | 依赖数 +2（新引用） |
| lint | `pnpm lint` | 0 | **1540 warnings + 48 infos（合计 1588）** | 首轮 1587（±1 为 Biome 每规则诊断上限造成的计数抖动；无 error 级） |
| 预算 | `pnpm budget` | **1** | 既有失败不变：`asCast 32/31`、`bigFiles 6/4`；`bang 89/90 ↓1`、`console 4/4`（无新增） | 属包 3 存量债务 |
| 构建 | `pnpm --filter canvas build` | 0 | `main-DoKUUa1X.js` 428.97 kB | 浏览器证据前置 |
| canvas tests 类型探底（临时脚本已删） | TS Compiler API | 0 | **9 条 = 基线**（86 文件） | 持平 |

lint 过程中发现并修掉 1 条自有新警告（`useExhaustiveDependencies`：`requestLeave` 漏 `settle`），
另删除 1 个未使用测试辅助函数（`noUnusedVariables`）。

## R8. 真浏览器验证（返修轮）

```powershell
pnpm --filter canvas build && (vite preview --port 5175)
node tools/verify-mode-guard.mjs http://localhost:5175     # 退出码 0 / PASS，加载 main-DoKUUa1X.js
```

| 旅程 | 本轮新增/加强的联合断言 | 结果 |
|---|---|---|
| A | 导图编辑 → 确认 → Esc/遮罩/焦点/Enter → 保存后进入自由画布；写盘文本含编辑内容 | ✅ A1–A9 |
| B | 自由画布「打开」带句柄文档（按 picker 请求的 types 分派句柄）→ 便签 → 确认 → 保存并继续 → 回导图 | ✅ B1/B2a/B2/B3 |
| C | `?nofs=1`（无 showSaveFilePicker）→ 下载兜底**不自动离开** + 准确提示 → 显式放弃才离开 | ✅ C1/C2 |
| D | **IME 联合断言**：组合中输入候选串 → 点「← 导图」→ ①编辑器仍在（**未被失焦关闭**）②`[data-fc-front]` 计数未回升（**未回写模型**）③不弹模态、非模态提示可见、仍在自由画布 ④dirty 时 `beforeunload` 被拦截 ⑤派发 `compositionend` 后自动续跑 → 三选项模态 ⑥保存并继续 → 回到导图，**写出文本含「已确认的文字」且从不含候选串** | ✅ D1–D5 |

**验证限制（与合成事件分开报告）**：
- D 段用**合成 `CompositionEvent`**（`bubbles: true`）模拟组合输入，**不覆盖真实输入法与候选框**
  （OS 级输入法无法在无头浏览器自动化）；真实选择器手势、跨浏览器（只跑 Chromium）、触控、离线仍不覆盖。
- 浏览器证据只说明「点击入口导致的失焦不会把候选串写进模型/文件」，
  不声称覆盖真实输入法的候选窗交互与提交时机差异。

## R9. 偏差与说明

- 计划原「flush 失败 → 模态 + 提示」被复核要求改为「不弹模态 + 暂缓」（MG-R1 返修条款），
  属**有意行为变更**，已更新受影响断言并在此标注；模态契约本身（三选项/焦点/键盘/遮罩）未变。
- 新增可选端口语义、`subscribeCompositionEnd`、`blockedNotice` 均为向后兼容扩展；
  包 1 的保存回归与包 2 首轮的其余断言保持通过。
- `runTarget` 对「同步 vs 异步目标」分档收束互斥，是对 MG-R3 字面要求（「目标执行完或失败之前保留互斥」）
  的精确实现，不是放宽：探针 P4 与正式用例都验证异步目标期间仍严格互斥。
- 仍未提交：**是**（HEAD `a2ce72b`，未 `git add`）。停在此处交回执，等待主控复核；**不启动第 3 包**。

---

# 附二：第二轮复核返修（MG-R4 / MG-R1-B / MG-R2-B）· 2026-09-19

输入：`docs/dispatch/2026-09-19-mode-guard-review.md` 文末「第二轮复核」（结论：返修有效、MG-R3 关闭，
尚余三项；包 3 暂不放行）。**第 1–13 节与附录一原样保留**（首轮与上一轮记录不删改）。
本轮只收口这三项及其同族时序，未扩大到草稿持久化或无关架构重写。

## S0. 起点：先复现第二轮 3 条 followup 探针（全红）

```powershell
$env:PATH = '<local-path>' + $env:PATH
pnpm --filter canvas exec vitest run --config ../../outputs/mode-guard-review-2026-09-19/followup.config.ts
```

| | 结果 | 证据（`followup-repro.log` → `followup-final.log`） |
|---|---|---|
| 复现（返修前） | **3 failed / exit 1** | `preview evidence { modelText: 'original', beforeUnloadSeesDraft: false, targetCalls: 1 }`；`Markdown IME evidence { callsBeforeEnd: [['尚未确认的背面候选']] }`；同对象重登记后 Promise 未结算 |
| 返修后 | **3 passed / exit 0**（期望未反转） | `{ modelText: 'new unsaved markdown', beforeUnloadSeesDraft: true, targetCalls: 0 }`；`callsBeforeEnd: []` |

## S1. MG-R4：编辑会话 pending / flush 通道（预览态草稿不再隐形）

**问题**：草稿可以活在组件状态里而 DOM 中没有任何可 blur 的控件（`NoteBackEditor` 切预览后 textarea
卸载 —— React 卸载不派发 onBlur）。只按 `document.activeElement` 推断「没有草稿」→ 干净路径直接离开、
`beforeunload` 也不拦。

**修复**（新增通道，不引入草稿持久化框架）：

- `packages/react/src/edit/draftSessions.ts`：**仅覆盖挂载期**的会话登记表
  （`DraftSession { hasPending(); commit() }` + `registerDraftSession` + `hasPendingDraftSession()`
  + `commitDraftSessions()` + `useDraftSession(build)`；工厂式入参避免捕获旧闭包，卸载即注销）。
- 登记方：`NoteBackEditor`（预览态/隐藏态草稿）、`NotePopover` 正文（非受控 textarea 的值即草稿）、
  `DescBlock`（编辑态草稿）。三者 `commit()` 都走**各自既有的提交通道**（比较基准、trim、写回与退出
  编辑态的语义不变）。
- 消费方：`apps/canvas/src/draftFlush.ts` —— `flushActiveDraft()` 先 blur 聚焦控件（既有通道），
  再 `commitDraftSessions()`；`hasPendingDraft()` 先看 `hasPendingDraftSession()`（预览/隐藏态），
  再看焦点控件。

## S2. MG-R1-B：原编辑入口矩阵的组合提交边界（统一接线，不只修点名组件）

**问题**：上一轮只给 `NativeCard`（自由画布面）与 `OverlayEditor`（标题/框内行）加了组合保护；
`NoteBackEditor`、`NotePopover` 正文、`DescBlock`、`GrowthCommentPanel` 仍是 `onBlur` 直接 commit。

**修复**：抽出统一边界 `packages/react/src/edit/compositionGuard.ts` →
`useCompositionCommitGuard(commit)` 返回 `{ onCompositionStart, onCompositionEnd, allowCommit }`：
组合中 `allowCommit()` 返回 false 并记「待提交」，`compositionend` 用**已确认**文字补提交。
按矩阵统一接线（6 处编辑器 / 含自由画布正反两面）：

| 入口 | 组件 | 组合开始 | 失焦拒绝 | 确认后补提交 |
|---|---|---|---|---|
| 标题 / 框内行 | `edit/OverlayEditor`（single + wrap 两态） | ✅ 统一 hook | ✅ | ✅ |
| 自由画布正面 / 背面 | `free-canvas/NativeCard` → `FaceEditor` | ✅ | ✅ | ✅ |
| 背面 Markdown | `chrome/NoteBackEditor` | ✅ | ✅ | ✅ |
| 描述 | `chrome/DescBlock` | ✅ | ✅ | ✅ |
| 备注正文 | `chrome/NotePopover` 正文 textarea | ✅ | ✅ | ✅ |
| 批注（编辑 / 新增） | `chrome/GrowthCommentPanel` 两个输入 | ✅ | ✅ | ✅ |

关键时序修正：决策器把「组合结束后的自动续跑」延到 **`compositionend` 派发结束的微任务**
（`Promise.resolve().then(...)`）—— 编辑器自己的 `compositionend`（React 合成事件，冒泡阶段）
晚于 document capture 监听，同步续跑时的 blur 会被编辑器判成「组合未结束」而拒绝补提交（实测踩到已修）。

## S3. MG-R2-B：同一端口对象重复登记 = 新代次 → 旧请求收束

`registerPort` 原先只在 `previous.port !== port` 时结束旧代次请求；同一对象再次登记会让旧请求
`owns()` 永远 false 却仍占着 `activeRef`（模态不关、Promise 不悬挂结算、后续入口全被拒）。
**修复**：每次登记都 `abandon(previous)`（不论是否同一对象），代次语义与幂等策略统一为「新代次生效」；
旧 cleanup 仍按代次判定，不清新登记、不结束新请求。

## S4. 红 → 绿与三项阴性对照（本轮）

| 对照 | 临时中性化 | 命中（转红） | 日志 |
|---|---|---|---|
| N5 | `flushActiveDraft` 去掉 `commitDraftSessions()` | followup 探针 1（MG-R4）+ 正式「预览态草稿：beforeunload 拦截 → 取消保留草稿 → 保存并继续写出最后 Markdown」（App 层） | `neg-N5-probes.log` / `neg-N5-unit.log` |
| N6 | `NoteBackEditor.commit` 去掉组合边界 | followup 探针 2（MG-R1-B）+ 正式「背面 Markdown（NotePopover → NoteBackEditor）」 | `neg-N6-probes.log` / `neg-N6-unit.log` |
| N7 | `registerPort` 改回「仅不同对象才结束旧代次」 | followup 探针 3（MG-R2-B）+ 正式「同一端口对象重复登记（新代次）→ 旧请求结算 false、模态关闭、新请求可用」 | `neg-N7-probes.log` / `neg-N7-unit.log` |

三处改动都在验证后**只恢复该块**（未用 `git restore`/`checkout` 覆盖任何文件）。

## S5. 正式回归（本轮新增/更新）

| 文件 | 新增 | 覆盖 |
|---|---|---|
| `apps/canvas/tests/leave-entry-matrix.test.tsx`（新） | 7 | 入口矩阵 5 项（标题/描述/备注正文/背面 Markdown/批注）× 「组合中失焦不得提交候选串」「组合结束提交确认文字」；预览态草稿的会话通道（`hasPendingDraft` 看得见、`flushActiveDraft` 提交、干净路径不放行）；卸载后会话注销 |
| `apps/canvas/tests/note-back-leave.test.tsx`（新） | 2 | **真 App**：背面预览态草稿 → `beforeunload` 拦截 → 切模式确认（草稿已进模型）→ 取消保留 → 保存并继续**写出最后 Markdown**（文件级断言）；背面编辑器组合中切模式 → 候选串不进模型/文件、确认后写出确认文字 |
| `apps/canvas/tests/unsaved-transition.test.tsx` | +1（33） | 同对象重登记的端口契约（结算 false、模态关闭、新请求可用） |
| `packages/react/tests/free-canvas-flip.test.tsx` | +1（6） | 自由画布**背面** FaceEditor：组合中失焦不提交、组合结束写入确认文字 |

## S6. 实际接口增量

```ts
// packages/react/src/edit/compositionGuard.ts（新增；包根导出）
export interface CompositionCommitGuard { onCompositionStart(): void; onCompositionEnd(text: string): void; allowCommit(): boolean }
export function useCompositionCommitGuard(commit: (text: string) => void): CompositionCommitGuard;

// packages/react/src/edit/draftSessions.ts（新增；包根导出）
export interface DraftSession { hasPending(): boolean; commit(): void }
export function registerDraftSession(session: DraftSession): () => void;
export function hasPendingDraftSession(): boolean;
export function commitDraftSessions(): boolean;
export function draftSessionCount(): number;
export function useDraftSession(build: () => DraftSession): void;

// packages/react/src/chrome/noteSizing.ts（新增）：浮窗尺寸/字号常量 + 3 个纯函数
//   （自 NotePopover 原样抽出以守其 600 行线；NotePopover 仍**原样再导出**，外部导入路径不变）

// registerPort 契约补充（apps/canvas/src/hooks/useUnsavedTransition.ts）
//   每次登记（含同一对象重复登记）都产生新代次 → 前代次上尚未执行目标的请求结算 false
```

## S7. 门禁（本轮）

| 检查 | 命令 | 退出码 | 结果 | 对比 |
|---|---|---|---|---|
| 原 5 探针 | `…/vitest.config.ts` | 0 | **5 passed** | 保持 |
| 第二轮 3 探针 | `…/followup.config.ts` | 0 | **3 passed** | 返修前 3 failed |
| canvas 全量 | `vitest run --root apps/canvas` | 0 | **43 files / 348 passed** | 上轮 338（+10） |
| react 包 | `vitest run`（packages/react） | 0 | **1498 passed** | 上轮 1497（+1） |
| 全仓测试 | `pnpm test` | 0 | 12 + 622 + **1498** + **348** = **2480** | 上轮 2469（+11） |
| 类型 | `pnpm typecheck` | 0 | 4 子项目 Done | 持平 |
| 依赖 | `pnpm depcruise` | 0 | 528 模块 / 1557 依赖，0 违规 | 模块 +1（新文件） |
| lint | `pnpm lint` | 0 | **1541 warnings + 48 infos（合计 1589）** | 本轮新增文件**零告警**（±1 为 Biome 每规则诊断上限抖动） |
| 预算 | `pnpm budget` | **1** | 仅**存量**：`asCast 32/31`、`bigFiles 6/4`；`bang 89/90 ↓1`、`console 4/4` | **无新增债务**（见下） |
| 构建 | `pnpm --filter canvas build` | 0 | `main-CPhAqqyd.js` 430.72 kB | 浏览器证据前置 |
| canvas tests 类型探底（临时脚本已删） | TS Compiler API | 0 | **9 条 = 基线**（88 文件） | 持平 |

预算过程中的一次自我纠偏（如实记录）：本轮把 `NotePopover.tsx` 加到 625 行，触发了 `bigFiles 7/4`
（新增一项债务）。随即把该文件的**尺寸/字号常量与 3 个纯函数**原样抽到 `chrome/noteSizing.ts`
（并在 NotePopover 再导出保持导入路径不变），文件回落到 **556 行**，预算复原为 `6/4` 存量。

## S8. 真浏览器验证（本轮新增旅程 E）

```powershell
pnpm --filter canvas build && (vite preview --port 5175)
node tools/verify-mode-guard.mjs http://localhost:5175     # 退出码 0 / PASS，加载 main-CPhAqqyd.js
```

| 旅程 | 断言 | 结果 |
|---|---|---|
| A–D | 既有一轮旅程（模式确认/取消/遮罩/键盘、fs 与下载分支、自由画布 IME 焦点链路） | ✅ 保持 |
| **E** | **背面 Markdown 预览态草稿 + 输入焦点链路**：①点节点固定面板（翻面入口）②切预览后源文编辑器卸载 ③草稿存在 → `beforeunload` **被拦截** ④切模式 → 草稿先被提交（进模型）→ 出现三选项确认 ⑤取消 → 仍在导图、内容未丢 ⑥源文编辑器组合中输入 → 点入口：编辑器**未被失焦关闭**、不弹模态、非模态提示可见 ⑦`compositionend` 后自动续跑 → 模态 ⑧保存并继续 → **写出文件含确认文字、从不含候选串**，且才进入自由画布 | ✅ E1–E8 |

**验证限制（与系统级验证分开报告）**：
- 输入法用**合成 `CompositionEvent`** 模拟（真实 OS 输入法候选框无法在无头浏览器自动化）；
  文件写入走**内存句柄**（不触碰真实磁盘文件）；系统文件选择器手势仍不覆盖；只跑 Chromium。

## S9. 偏差与说明 / 交付状态

- `NoteBackEditor` 补提交 + 会话提交都走 `NoteBody.onCommit` 既有链（比较 → 写回 → 退出编辑态），
  未新增写回路径；`DescBlock`/正文的提交值口径（trim / 未改动不提交）保持不变。
- 组合未结束「不弹模态 + 非模态提示 + 自动续跑」是第一轮既定行为，本轮沿用；
  E6 断言了入口点击（真实浏览器中会造成失焦）不会关闭编辑器。
- 新增的 `compositionGuard` / `draftSessions` / `noteSizing` 均为**包根新增导出**（向后兼容，未改既有签名）。
- 仍未提交：**是**（HEAD `a2ce72b`，未 `git add`、未 push、未 pull/rebase/reset/stash）。
  停在此处交回执，等待主控复核；**不启动第 3 包**。

---

# 附三：第三轮复核返修（MG-R4-B 草稿提交失败传递）· 2026-09-19

输入：`docs/dispatch/2026-09-19-mode-guard-review.md` 文末「第三轮复核」（结论：前两轮八项已关闭；
新增草稿通道**吞掉提交异常**仍按干净模型放行，包 3 暂不放行）。前三章记录原样保留。

## T0. 起点：先复现（1 红）

```powershell
$env:PATH = '<local-path>' + $env:PATH
pnpm --filter canvas exec vitest run --config ../../outputs/mode-guard-review-2026-09-19/draft-failure.config.ts
```

| | 结果 | 证据 |
|---|---|---|
| 复现（返修前） | **1 failed / exit 1** | `failed draft evidence { stillPending: true, result: true, targetCalls: 1 }`（`draft-failure-repro.log`） |
| 返修后 | **1 passed / exit 0**（期望未反转） | `{ stillPending: true, result: undefined, targetCalls: 0 }`（`draft-failure-final.log`）：草稿仍在、请求未结算（模态等用户）、目标零执行 |

## T1. 修复：把失败如实传上去

三处改动，链路是「会话 → flush → 决策器」：

1. **`packages/react/src/edit/draftSessions.ts`**：`commitDraftSessions()` 返回
   `'ok' | 'failed'` —— 某个会话 `commit()` 抛错时**继续尝试其它会话**（能提交的先保住），
   但把失败**汇总上报**（不再 catch 后当作成功）。失败会话的 `hasPending()` 保持 true（草稿不丢），
   后续 `flushActiveDraft()` 仍会看到它 → 可重试。
2. **`apps/canvas/src/draftFlush.ts`**：`flushActiveDraft()` 返回
   `'ok' | false | 'failed'`：控件 `blur()` 抛错 → `'failed'`；会话通道失败 → `'failed'`；
   组合未结束 → **仍严格返回 `false`**（保持既有布尔契约，复核探针按此钉住）。
3. **`apps/canvas/src/hooks/useUnsavedTransition.ts`**：新增
   `FlushOutcome = 'ok' | 'composing' | 'failed'` 的归一化（`true→ok`、`false→composing`，
   兼容旧端口/测试替身），并把三态分别落到：
   - `continueRequest`：`'failed'` → 打开模态并提示 `LEAVE_DRAFT_FAILED_NOTICE`、
     **不订阅 `compositionend`**（这不是 IME 事件，等一个不会到来的信号等于死锁）、
     请求保持活动（互斥不释放）直到用户取消/放弃/修正后重试；
   - `saveRequest`（两处 flush）：`'failed'` → 停在模态给同一提示（用户可修正编辑器后重试）；
   - `discardRequest`：`'composing'` 仍拦（不截断正在组合的文字）；
     `'failed'` **放行** —— 「放弃修改」是用户对这份草稿的显式处置，
     不能因为写不回去就把用户锁死在文档里。

## T2. 语义决策表（本轮定稿）

| 情形 | 行为 | 依据 |
|---|---|---|
| 组合未结束 | 非模态提示 + 暂缓 + `compositionend` 自动续跑（不变） | 第一轮 MG-R1 |
| 草稿提交**失败** | 模态提示「有未提交的草稿无法写入（提交失败）：请取消后修正再试，或选择放弃修改并离开」；草稿保留、目标零执行、互斥保留 | MG-R4-B 要求 2 |
| 用户「取消」 | 释放互斥（请求结算 false）→ 可修正后重试 | 要求 2/3 |
| 用户「放弃修改」 | 显式处置草稿 → 放行离开 | 要求 2 |
| 提交成功但尚未重渲染（`hasPending()` 仍 true） | **不**误判失败：失败只由「抛错」判定，不复查 `hasPending` | 要求 3 |
| 决策器卸载 | 未执行目标的请求结算 false（不悬挂、无未处理 rejection） | 既有 |

## T3. 红 → 绿与阴性对照

| 对照 | 临时中性化 | 命中（转红） | 日志 |
|---|---|---|---|
| N8 | `commitDraftSessions` 的 catch 里去掉失败上报（恢复「吞掉」） | 复核探针（原始证据 `{ stillPending: true, result: true, targetCalls: 1 }`）+ 5 条新正式用例中的 4 条（「尚未重渲染不误判」那条按设计保持绿 —— 它钉的是**反面**：不得过度拦截） | `neg-N8-probes.log` / `neg-N8-unit.log` |

改动在验证后只恢复该块（未用 `git restore`/`checkout` 覆盖任何文件）。

## T4. 正式回归（本轮新增 5 条，`apps/canvas/tests/leave-entry-matrix.test.tsx`）

| 用例 | 钉住的行为 |
|---|---|
| 提交抛错 → 目标零执行、草稿保留、模态可修正提示（不等待 compositionend） | 失败不离开 + 提示准确（`LEAVE_DRAFT_FAILED_NOTICE`）+ 非 IME 不挂等待 |
| 部分会话失败：成功的照常写入，失败会话保留 → 汇总为失败不放行 | 「继续尝试其它会话」与「失败必须上报」同时成立 |
| 修正后重试成功：取消 → 修好 → 第二次离开正常执行目标 | 真实 hook 的恢复路径（第二次成功、互斥已释放） |
| 提交成功但尚未重渲染（`hasPending` 仍 true）→ 不误判失败，正常执行目标 | 不过度拦截（要求 3 的反面） |
| 放弃修改：提交失败也允许显式放弃 | 用户不被锁死 |

一处**自有**断言随契约更新（如实记录）：`unsaved-transition.test.tsx` 的冷启动用例原本断言
组合结束后 `flushActiveDraft() === true`，现在返回 `'ok'`（组合分支仍严格 `false` 不变）；
复核探针只钉 `false` 分支，未受影响。

## T5. 接口增量

```ts
// apps/canvas/src/documentLifecycle.ts
export type FlushOutcome = 'ok' | 'composing' | 'failed';
/** 端口实际可返回的形状（含旧式布尔：true→ok，false→composing） */
export type FlushResult = FlushOutcome | boolean;
export interface DocumentLeavePort { flushEdits(): FlushResult; /* ... */ }

// apps/canvas/src/draftFlush.ts
export function flushActiveDraft(): 'ok' | false | 'failed';

// packages/react/src/edit/draftSessions.ts
export function commitDraftSessions(): 'ok' | 'failed';   // 失败汇总上报（不再吞）

// apps/canvas/src/hooks/useUnsavedTransition.ts
export const LEAVE_DRAFT_FAILED_NOTICE;                   // 新增：提交失败的模态提示
```

## T6. 门禁（本轮）

| 检查 | 命令 | 退出码 | 结果 | 对比 |
|---|---|---|---|---|
| 三组探针（首轮 5 + 次轮 3 + 本轮 1） | 三个 config | 0 / 0 / 0 | **5 + 3 + 1 = 9 passed** | 本轮返修前 1 failed |
| canvas 全量 | `vitest run --root apps/canvas` | 0 | **43 files / 353 passed** | 上轮 348（+5） |
| 全仓测试 | `pnpm test` | 0 | 12 + 622 + 1498 + 353 = **2485** | 上轮 2480（+5） |
| 类型 | `pnpm typecheck` | 0 | 4 子项目 Done | 持平 |
| 依赖 | `pnpm depcruise` | 0 | 0 违规 | 持平 |
| lint | `pnpm lint` | 0 | **1541 warnings + 48 infos（1589）** | 持平；本轮文件零告警 |
| 预算 | `pnpm budget` | 1 | 仅存量：`asCast 32/31`、`bigFiles 6/4`；`bang 89/90 ↓1`、`console 4/4` | **无新增债务** |
| 构建 | `pnpm --filter canvas build` | 0 | `main-D3S8M3Pl.js` 431.14 kB | 浏览器证据前置 |
| canvas tests 类型探底（临时脚本已删） | TS Compiler API | 0 | **9 条 = 基线**（88 文件） | 持平 |

## T7. 浏览器与限制

`node tools/verify-mode-guard.mjs http://localhost:5175` → **退出码 0 / PASS**，加载最终产物
`main-D3S8M3Pl.js`，旅程 A–E 全绿（含 E 的背面预览草稿 + 输入焦点链路）。
**限制（如实）**：本轮的问题是**故障注入**（`commit` 抛错），浏览器脚本没有注入钩子，
因此浏览器证据的作用是「正常路径与 IME 链路未因本轮改动回退」；
失败/重试语义只在 jsdom（含真实 hook）中验证，不声称覆盖真实磁盘错误。

## T8. 交付状态

- 仍未提交：**是**（HEAD `a2ce72b`，未 `git add`、未 push、未 pull/rebase/reset/stash）。
- 未触碰禁区与既有视觉/度量成果；包 1 保存回归与前三章全部断言保持通过。
- 停在此处交回执，等待主控复核；**不启动第 3 包**（含存量预算/类型债务收口）。

