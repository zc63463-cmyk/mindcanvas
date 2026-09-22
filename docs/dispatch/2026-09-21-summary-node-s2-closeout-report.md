# 摘要节点 S2 返修后交付收口回执

- **日期**：2026-09-21
- **性质**：S2 返修后的**交付收口**（冻结完整候选 + 观测口隔离 + 补齐证据 + 告警/口径更正）
- **起点（返修基线）**：`0d77197f57a0f963845fe3074f65cad5ff2f2458`
- **本轮回执产出候选**：`4867386978e0f768aa6a31b8e34d1bc4e446e7d7`
- **tree**：`7e1dd605844acf1549f7ce3de2d5a07e26ee7c72`
- **分支**：`codex/summary-node-s2-20260920`
- **工作树**：`<workspace>/.workbuddy/wt-summary-node-s2`
- **本轮证据目录**：`outputs/summary-node/S2/20260920-S2-CLOSEOUT-01/`
- **结论**：**可提交独立复核**。未 push、未发布、未启动 S3。

> **保留声明**：本轮**未 amend、未覆盖**任何旧提交。`9cac632`（S2 功能）与 `0d77197`（含回执候选）
> 原样保留，`4867386` 是其上的**新提交**。旧回执（`docs/dispatch/2026-09-20-summary-node-s2-report.md`、
> `…-s2-repair-report.md`）与旧证据目录（`20260920-S2-01`、`20260920-S2-REPAIR-01`）**一字未改**。

---

## §1 冻结完整候选

### 1.1 提交锚定与差异

```
start (返修基线)  0d77197f57a0f963845fe3074f65cad5ff2f2458
candidate        4867386978e0f768aa6a31b8e34d1bc4e446e7d7
tree             7e1dd605844acf1549f7ce3de2d5a07e26ee7c72
parent           0d77197f57a0f963845fe3074f65cad5ff2f2458
merge-base --is-ancestor 0d77197 HEAD → PASS
```

`git diff --stat 0d77197..HEAD` = **15 files changed, 2025 insertions(+), 311 deletions(-)**

```
M  apps/canvas/src/MindmapStage.tsx
M  apps/canvas/src/hooks/useDocumentActions.ts
A  apps/canvas/src/hooks/useDocumentToken.ts
A  apps/canvas/src/hooks/useSummaryHop.ts
M  apps/canvas/src/summaryInteraction.ts
A  apps/canvas/src/testBuild.ts
M  apps/canvas/src/vite-env.d.ts
A  apps/canvas/tests/summary-two-hop-host.test.tsx
M  apps/canvas/tests/summary-two-hop.test.tsx
M  apps/canvas/vite.config.ts
M  apps/canvas/vitest.config.ts
A  docs/dispatch/2026-09-20-summary-node-s2-repair-report.md
M  packages/react/src/edit/summaryCommands.ts
M  packages/react/src/index.ts
M  packages/react/tests/summary-create.test.ts
```

逐文件 SHA-256 见 `evidence/candidate-files.sha256`；差异明细见 `evidence/candidate-diff.txt`。

### 1.2 漂移核对（先核对后动手）

对返修回执 §6.3 的逐文件 SHA256 与工作区实算值**逐条比对**：

| 文件 | 回执声称 | 实算 | 判定 |
|---|---|---|---|
| `apps/canvas/src/MindmapStage.tsx` | `b63625d4…` | `b63625d4…` | ✓ |
| `apps/canvas/src/hooks/useDocumentActions.ts` | `9dc3e09c…` | `9dc3e09c…` | ✓ |
| `apps/canvas/src/summaryInteraction.ts` | `9b1fac76…` | `9b1fac76…` | ✓ |
| `apps/canvas/src/vite-env.d.ts` | `24140fd8…` | `24140fd8…` | ✓ |
| `apps/canvas/tests/summary-two-hop.test.tsx` | `366ef0d0…` | `366ef0d0…` | ✓ |
| `packages/react/src/edit/summaryCommands.ts` | `2be1d50a…` | `2be1d50a…` | ✓ |
| `packages/react/tests/summary-create.test.ts` | `74445212…` | `74445212…` | ✓ |
| `apps/canvas/src/hooks/useDocumentToken.ts` | `6100dd90…` | `6100dd90…` | ✓ |
| `apps/canvas/src/hooks/useSummaryHop.ts` | `97ab3623…` | `97ab3623…` | ✓ |
| `apps/canvas/tests/summary-two-hop-host.test.tsx` | `28528481…` | `28528481…` | ✓ |

**10/10 逐字节一致 → 无漂移**，未覆盖任何人改动，直接在其上收口。

### 1.3 逐路径暂存与排除项

`git add` 显式逐路径执行（**未用 `git add -A`**），仅纳入本包 15 个文件。
**未纳入**（提交后仍为未跟踪）：

- `outputs/` —— 本轮与历史证据目录（`outputs/` 下的**其它**文件是仓库既有已跟踪文件，与本次无关）
- `.zcode/` —— 工作流草稿
- `nul` —— 先前会话遗留的 Windows 保留名文件，与本轮无关

**未使用 stash 对象冒充候选**：返修回执 §6.2 曾用 `git stash create` 作聚合锚（其值
`75a6f5cd…` 不可复现），本轮**不复用该口径**，改以**完整提交 + tree SHA** 锚定固定候选。

### 1.4 新检出即可获得全部实现与测试（实测）

从 `4867386` 建 detached 检出（`mindcanvas-verify-s2c`），`pnpm install --frozen-lockfile` + `pnpm -r build` 后：

```
apps/canvas/src/testBuild.ts                        OK (30 lines)
apps/canvas/src/hooks/useDocumentToken.ts           OK (50 lines)
apps/canvas/src/hooks/useSummaryHop.ts              OK (172 lines)
apps/canvas/tests/summary-two-hop-host.test.tsx     OK (803 lines)
docs/dispatch/…-s2-repair-report.md                 OK (440 lines)

nul           absent
.zcode        absent
outputs/summary-node/  absent（本包证据未入库，正确）

生产构建观测口扫描：radial / radialSurface / main 三个 chunk 命中 0 次
定向测试：2 files / 38 tests passed
```

---

## §2 测试观测口隔离（`__mindcanvasSummaryHost`）

### 2.1 问题

原实现为 `if (typeof window !== 'undefined') { window.__mindcanvasSummaryHost = {...} }`——
`typeof window` 只说明「有 DOM」，**浏览器生产环境同样成立**，不构成任何隔离：
该全局入口会无条件出现在生产运行时。这违反本轮要求。

### 2.2 处置（构建期隔离，非运行期判断）

新增 `apps/canvas/src/testBuild.ts`：

```ts
declare const __MINDCANVAS_TEST_BUILD__: boolean | undefined;
export const IS_TEST_BUILD: boolean =
  typeof __MINDCANVAS_TEST_BUILD__ !== 'undefined' && __MINDCANVAS_TEST_BUILD__ === true;
```

- `vite.config.ts`（生产）注入 `__MINDCANVAS_TEST_BUILD__: 'false'` → `IS_TEST_BUILD` 为假 →
  Rollup 将整块判为死代码并 tree-shake；
- `vitest.config.ts`（测试）覆盖为 `'true'`（`mergeConfig` 后者生效）；
- 用 `declare const` + `define` 而非 `window.__X` / `globalThis.__X`：前者是**编译期常量**，
  可被静态消除；后两者是运行期属性读取，无法 tree-shake，等于没隔离。
- **未**使用 `process.env.NODE_ENV` 判断：本仓未做明确约定，且 Vite 客户端包中它被静态替换，
  未声明处读取会得到 `undefined`（不报错也不隔离），属不可靠判据。
- `typeof` 守卫兜底：即使某构建路径忘了注入，也只表现为「没有观测口」，不会抛 `ReferenceError`。

### 2.3 归属与职责划分

- **按实例归属**：新增 `installedHandleRef`；注册时记录本实例写下的句柄，清理时
  **仅当全局值仍 === 本实例句柄**才删除 → 多实例并存（测试里先后 render 两个 Stage）时，
  先卸载的实例不会误删后挂载实例的入口。
- **只读观测 / 操作入口分离**：句柄拆为
  - `observe`：`summaryDraft` / `hasDraft()` / `documentToken` / `selectedId` / `root` / `layoutReady`（纯读）
  - `actions`：`undo` / `redo` / `replaceDoc`（改状态，但走真实生产路径 `applyDoc` / `controller`）
  类型契约见 `src/vite-env.d.ts`，并把「`root` 只读、改树必须走 actions 或 UI」写进注释。

### 2.4 隔离证据（实测）

```
$ grep -rc "mindcanvasSummaryHost" apps/canvas/dist/assets/*.js
apps/canvas/dist/assets/radial-BQ6l7Hsx.js:0
apps/canvas/dist/assets/radialSurface-D_OlurFd.js:0
apps/canvas/dist/assets/main-fwWIeTLt.js:0
```

**生产构建中该全局名出现 0 次**；测试构建中 14 项宿主用例正常通过（依赖该入口读回真实节点 id）。
新检出树复算同样为 0。

### 2.5 真实接线测试保留（未退回复刻）

`summary-two-hop-host.test.tsx` 仍**真实挂载** `MindmapStage`（`render(<MindmapStage />)`），
链路走真实画布节点命中（pointerdown/up）+ 真实右键菜单 + 真实 Ctrl+Z；
`useSummaryHop` 仍为生产与测试**共同消费**的 hook（生产 `MindmapStage` 与测试都 import 它）。

---

## §3 草稿跨保存的证据补足（任务书 §三）

### 3.1 新增用例

| 用例 | 内容 | 断言 |
|---|---|---|
| ⑪ | 先起草稿 → 真实编辑（右键「编辑」）→ 真实保存（文档栏「保存」） | 令牌不推进、草稿仍有效、随后第二跳完成**原范围**（成员 = A/B/C） |
| ⑫ | 先起草稿 → 真实另存为（文档栏「另存为」） | 选择器被唤起、写入内容含当前树、令牌不推进、草稿存活、第二跳完成原范围 |
| ⑧（收紧） | 编辑 + 保存 + **另存为** | 三者均不推进令牌；草稿跨越三者仍有效 |

**另存为是真实执行，不是看令牌或读源码**：测试装 `showSaveFilePicker` 替身
（返回**真的**可写句柄并记录写入内容），断言选择器调用次数与写入快照内容，
因此「另存为确实跑通」有写入路径证据。

**实现期发现（如实记录）**：该文档无 handle 时，`LocalDocHost.save` 按既有语义
**保存与另存为都会走选择器**（`if (doc.handle) 静默写回; else saveMarkdown(...)`）。
首版断言 `picker.calls === 1` 因此转红（实得 2）——**是测试断言写错，不是产品缺陷**；
已改为按动作分别统计调用增量（`callsBeforeSave` / `callsBeforeSaveAs`）。

### 3.2 补充回归：Shift 连线真的生成边

用例 ⑬：切关系模式（真实点 `data-relation-mode`）→ 普通点击选中源 → 真实 Shift 点击目标 →
断言 `[data-free-edge]` 计数**真的 +1**（数真实渲染出来的边分组），且未误建摘要。
此前的 ⑨ 只证明「未建摘要」，未证明「生成了预期边」，本轮补齐。

---

## §4 告警与回执错误

### 4.1 lint 同工具同口径对比（实测）

| 树 | 命令 | 结果 |
|---|---|---|
| `0d77197`（基线，`wt-lint-base` 独立检出） | `npx biome lint packages apps` | **1544 warnings / 48 infos** |
| `4867386`（本候选） | 同上 | **1542 warnings / 48 infos** |

**本包新增告警 = 0**（且净减 2）。定位并消除的三条：

| 文件 | 规则 | 处置 |
|---|---|---|
| `apps/canvas/src/summaryInteraction.ts` | `noUnusedFunctionParameters` | 删去已无用的 `clickedId` 形参（调用点同步） |
| `apps/canvas/tests/summary-two-hop.test.tsx` | `noUnusedImports` | 删去未用 import |
| `apps/canvas/src/hooks/useSummaryHop.ts` | `useExhaustiveDependencies` | 令牌复位改为**渲染期派生 state** |

> 第 3 条的取舍值得记录：`draftResetToken` 已在渲染期被 `lastTokenRef` 消费，
> 再列进 effect deps 是**多余依赖**（告警）；而不列进 deps，effect 不复跑 → 失效。
> 两条路都错，故改用 React 官方的渲染期派生写法（首次改动曾让
> `summary-two-hop.test.tsx` 文档替换用例真实转红，已修正并复绿）。
> **未放宽规则、未提高预算**：`asCast` 仍 31/31，`bigFiles` 仍 4/4。

### 4.2 口径更正（**新增勘误，不覆盖旧记录**）

对返修回执的以下声明作更正。旧文本原样保留在 `20260920-S2-REPAIR-01/`，本节为**追加勘误**。

| # | 原声明 | 更正 | 依据 |
|---|---|---|---|
| E-1 | 「`git stash create` 聚合终态哈希纳入 tracked + 未跟踪新文件」 | **`stash create` 不纳入未跟踪文件**，该值只覆盖 tracked 改动；不能当作完整源码候选的指纹 | 本轮改用**完整提交 + tree SHA** 锚定 |
| E-2 | 「lint 1545/48（与修改前基线逐位相同，非上升）」 | **1545/48 不等于已验收基线 1541/48**；且返修起点 `0d77197` 实测为 **1544/48**，故 1545 实为 **+1** | 同命令实测（§4.1），本候选已降至 1542/48 |
| E-3 | 「`useDocumentSwitch` 的 `session` 是死参数」 | **不成立**：`session` 实际在 `useDocumentSwitch.ts:71` 被使用（`session?.beginDocument(doc.handle)`） | 直接读源码 |
| E-4 | 「11 + 24 = 34 条记录」 | 应为 **35**；且 34/35 条须**标明对应测试版本**（返修期与收口期测试集合不同，不可混算） | 逐文件计数 |
| E-5 | 「同一工作区两次 `stash create` 取值不同 ⇒ 负控结果非确定性」 | **不同测试集合的负控结果不能直接判为非确定性**；两次快照 ID 不同只说明快照对象非确定性，与测试判定无关 | 本轮四组负控均在**固定终态 + 明确测试集合**下取值 |
| E-6 | 环境性 `Invalid hook call` 曾出现在某次负控 | **环境性 `Invalid hook call` 不计入行为负控成功**；本轮四组负控日志已逐一检查，**均无**环境错误（§6.2） | 逐日志 grep |

### 4.3 公共导出收敛（任务书 §四末）

审计「跨包实际需要」后，`packages/react/src/index.ts` 的 S2 面收敛为**一个值符号**：

```ts
export { createSummary } from './edit/summaryCommands.js';
```

| 符号 | 跨包消费者 | 去留 |
|---|---|---|
| `createSummary` | `apps/canvas/src/MindmapStage.tsx`、`hooks/useSummaryHop.ts` | **保留**（实际调用） |
| `SummaryMenuActions`（类型） | `NodeContextMenu.tsx`、`nodeMenuBags.ts` | **保留**（经 `contextMenuItems` re-export，动作袋契约） |
| `planCreateSummary` | 无（`summaryInteraction.ts` 仅注释提及） | **移出包根** |
| `mergeSummaryOf` | 无 | **移出** |
| `summaryOfNode` | 无 | **移出** |
| `SUMMARY_DEFAULT_TEXT` | 无 | **移出** |
| `CreateSummaryResult` / `SummaryPlan` / `SummaryPlanError` / `SummaryPlanErrorCode` / `SummaryPlanOk` | 无（仅包内测试） | **移出** |

运行时验证（`dist/index.js` 直接 import）：
```
createSummary          PRESENT
mergeSummaryOf         absent
planCreateSummary      absent
summaryOfNode          absent
SUMMARY_DEFAULT_TEXT   absent
```
**未引入跨包 `src` 深路径依赖**（全仓无 `@mindcanvas/react/src/...` 形式导入）。

---

## §5 测试实际数量（逐项）

| 套件 | 文件数 | 用例数 | 说明 |
|---|---|---|---|
| `packages/react` 全包 | 157 | **1599** | 含 `summary-create.test.ts` **39**、`summary-menu.test.ts` **6** |
| `apps/canvas` 全包 | 45 | **391** | 含 `summary-two-hop.test.tsx` **24**、`summary-two-hop-host.test.tsx` **14** |
| `packages/kernel` | 70 | 656 | **本轮未改 kernel**（`git diff --name-only 0d77197 HEAD -- packages/kernel` = 0），未重跑 |

宿主测试 14 项构成：① ①b ② ③ ④ ⑤ ⑥ ⑦ ⑧ ⑨ ⑩（返修期 11 项）+ ⑪ ⑫ ⑬（本轮新增 3 项）。
> **注**：⑧ 在返修期为「名带另存为但未驱动」，本轮**改写为实际驱动另存为**（期望未放宽）。

---

## §6 同一终态验证

所有门禁在**同一终态 `4867386`** 上运行，且**先重建候选自身 dist**。

### 6.1 dist 与解析路径

```
pnpm -r build                        → exit 0
@mindcanvas/kernel -> E:\…\wt-summary-node-s2\packages\kernel\dist\index.js   （本 worktree 自身）
sha256 packages/react/dist/index.js                    = 04cba3096a85e66553187adb2fde7857d2b2598f370bea39467bd4a7cc230fd3
sha256 packages/react/dist/edit/summaryCommands.js     = d75ae38bd36221d38514d073cbe03e379e655413a43d9d01c323a585faffb615
sha256 packages/kernel/dist/index.js                   = 3cd978a749f616adb248c89c1127e099d2602e70ea15d15ecdb733418eb7be96
```

### 6.2 门禁结果（全部实测）

| 门禁 | 实测 | 判定 |
|---|---|---|
| R1 单成员/双成员（`summary-create.test.ts`） | **39 passed** | ✓ |
| 生产 hook（`summary-two-hop.test.tsx`） | **24 passed** | ✓ |
| 真实宿主（`summary-two-hop-host.test.tsx`） | **14 passed** | ✓ |
| `packages/react` 全包 | **1599 passed / 157 files** | ✓ |
| `apps/canvas` 全包 | **391 passed / 45 files** | ✓ |
| typecheck | **exit 0**（4 包，含 canvas `tsconfig.test.json`） | ✓ |
| build | **exit 0** | ✓ |
| depcruise | **551 modules / 1644 deps / 0 violations**，exit 0 | ✓ |
| lint | **1542 warnings + 48 infos**，exit 0（基线 1544/48 → 净减 2） | ✓ |
| budget | any 0 / tsIgnore 0 / bang 89(90) / asCast **31(31)** / console 4 / todo 1 / defaultExport 2 / bigFiles **4(4)**，exit 0 | ✓ |

日志：`gates/g1-build-dist.log`、`g2-targeted.log`、`g3-full.log`。

### 6.3 隔离副本负控（四组，固定终态 + 明确测试集合）

副本：`mindcanvas-nc-closeout`（detached `4867386`，主树之外），先验证**正常副本全绿**
（38 passed）再中性化；中性化后**重建 dist** 才判定。**副本已删除**。

| # | 中性化点 | 源文件 SHA256（NC / 候选） | 测试集合 | 目标红项 | 真实退出码 |
|---|---|---|---|---|---|
| NC-1 | R1 恢复**双分配**（`summaryCommands.ts`） | `9e677f27…` / `2be1d50a…` | `summary-create.test.ts` | 3 项：只分配一次 / well-formed / Undo-Redo | **1** |
| NC-2 | 文档替换**不推进令牌**（`useDocumentActions.ts`） | `00b65b54…` / `9dc3e09c…` | `summary-two-hop-host.test.tsx` | 2 项：⑥ 文档替换清草稿 / ⑦ 同内容替换 | **1** |
| NC-3 | 保存回填**错误推进**令牌 | `f021dd7f…` / `9dc3e09c…` | `summary-two-hop-host.test.tsx` | 2 项：⑧ 保存不得误判 / ⑪ 草稿跨保存 | **1** |
| NC-4 | 摘掉摘要**点击首判**（仅改生产接线） | `8f734767…` / `5f536143…` | `summary-two-hop-host.test.tsx` | 8 项：①②③⑧⑩⑪⑫ 等 | **1** |

**关键红证据原文（节选）**

```
NC-1  AssertionError: expected 'c6' to be 'c5'      (tests/summary-create.test.ts)
      AssertionError: expected 'dangling' to be 'well-formed'
NC-2  FAIL ⑥ 文档替换清草稿… AssertionError: expected true to be false
      FAIL ⑦ 同内容文档替换也清草稿… AssertionError: expected 8000000 not to be 8000000
NC-3  FAIL ⑧ 普通编辑/保存/另存为… AssertionError: expected 9000002 to be 9000001
      FAIL ⑪ 编辑+保存… AssertionError: expected 12000002 to be 12000001
NC-4  FAIL ① 真实右键入口… AssertionError: expected [] to have a length of 1 but got +0
      FAIL ③ 非法第二跳… AssertionError: expected '⚠ 点选范围末成员…' to contain '创建摘要未完成'
```

**纪律遵守**：四组均为**目标断言**转红（非编译错误、非形断言），
**测试期望一字未改**；未使用 `it.fails` / 反转断言 / catch 后报 PASS / 宽泛 skip。
NT-4 只改**生产接线**（`MindmapStage` 的 `onNodeClick` 首判），符合「集成负控只改生产」要求。

**环境错误检查（E-6 落实）**：四份 NC 日志逐一 grep
`Invalid hook call` / `React is not defined` / `unexpected undefined reading 'current'` → **均无命中的环境性错误**，
故四组均计入**行为负控成功**。

**未凑数量**：每组仅记录实际因目标断言转红的用例，未要求无关用例转红。

---

## §7 已修复项 vs 仅更正措辞项

### 7.1 代码修复（本轮实际改动）

| 项 | 类别 | 内容 |
|---|---|---|
| F-1 | **修复** | 观测口 `__mindcanvasSummaryHost` 由「无条件注册」改为**构建期隔离**（`testBuild.ts` + 两处 `define`），生产产物 0 命中 |
| F-2 | **修复** | 观测口注册/清理改为**按实例归属**，避免跨实例误删 |
| F-3 | **修复** | 观测口句柄拆为 `observe`（只读）/ `actions`（改状态但走真实路径），职责边界写进类型与注释 |
| F-4 | **修复** | 消除本包新增的 3 条 lint 告警（其中 `useSummaryHop` 改为渲染期派生 state） |
| F-5 | **修复** | 用例 ⑧ 由「名带另存为未驱动」改为**实际驱动另存为**（选择器替身 + 真实写入） |
| F-6 | **补充** | 新增用例 ⑪⑫（草稿跨编辑/保存/另存为）+ ⑬（Shift 连线真的生成边） |
| F-7 | **修复** | 公共导出收敛为跨包实际所需的 `createSummary`（+ `SummaryMenuActions`） |

### 7.2 仅措辞/口径更正（未改代码）

| 项 | 类别 | 内容 |
|---|---|---|
| E-1 | 措辞更正 | `stash create` 不纳入未跟踪文件（改用提交 + tree 锚定） |
| E-2 | 措辞更正 | 1545/48 ≠ 已验收基线 1541/48；返修起点实为 1544/48 |
| E-3 | 措辞更正 | `useDocumentSwitch` 的 `session` **仍被使用**（line 71），非死参数 |
| E-4 | 措辞更正 | 记录数 11+24 应为 35，且须标明对应测试版本 |
| E-5 | 措辞更正 | 不同测试集合的负控结果不能直接判为非确定性 |
| E-6 | 措辞更正 | 环境性 `Invalid hook call` 不计入行为负控成功 |

**产品语义**（点回起点建单成员摘要）在返修期已完成，本轮**未重开**，仅保留其证据。

---

## §8 未覆盖项（如实）

1. **基线 canvas 首跑失败用例仍未定位**：起工基线首跑曾 1 failed、随后两次通过，
   但首跑日志只截了 tail，**失败用例名未保留** → 保持「**未定位失败**」口径，
   **不因随后两次通过就宣称已确认稳定性**。
2. **kernel 未重跑全包**：本轮 kernel 源码零改动（实测 0 文件），按影响面验证，未机械重跑。
3. **`nul` 未删除**：先前会话遗留的 Windows 保留名文件（untracked），
   为避免越界改动未删；不影响任何门禁，且**未被纳入候选**。
4. **另存为的「选择器替身」是测试替身**：驱动的是真实 `saveMarkdown` 代码路径与真实
   `session.submit` 承诺链，但文件选择器本身由替身提供（浏览器原生对话框无法在 jsdom 中触发）。
   **未覆盖**真实浏览器中的原生选择器交互。
5. **⑬ 只覆盖「边数 +1」**：未覆盖边的具体锚文本、关系类型与渲染几何。
6. **`start-gone` 分支**（草稿起点被删 → 清草稿）仅有 hook 级用例，
   **未**在真实宿主路径下构造（需在草稿期删除起点节点，属编辑竞态场景）。
7. **未做浏览器人工验证**：本轮无截图/录屏证据（计划将浏览器收尾列在 S5）。
8. **S3（布局卫星）、S4（括线渲染）、S5（收尾）未启动**；未 push、未发布。
9. **本轮改动未 amend 旧提交**：`9cac632` / `0d77197` 原样保留，符合任务书要求。

---

## §9 证据清单

`outputs/summary-node/S2/20260920-S2-CLOSEOUT-01/`

```
gates/g1-build-dist.log          构建 + 解析路径 + dist 指纹
gates/g2-targeted.log            R1 / 生产 hook / 真实宿主 定向
gates/g3-full.log                react 全包 / canvas 全包 / typecheck / depcruise / lint / budget
negs/nc1-r1-double-alloc.log     NC-1 源指纹 + 目标红项 + 真实退出码
negs/nc2-replace-no-token.log    NC-2 同上
negs/nc3-save-bumps-token.log    NC-3 同上
negs/nc4-drop-first-judgment.log NC-4 同上
evidence/candidate-files.sha256  候选 15 文件逐文件 SHA-256
evidence/candidate-diff.txt      提交锚定 + 相对差异 + 祖孙关系
evidence/lint-comparison.txt     lint 同口径对比
```

**结论限于：可提交独立复核。** 未 push、未发布、未启动 S3；完成后停止。
