# 关系线 R2 · 派遣计划（2026-09-13）—— 修复闭环：重挂锚点 + 可发现性

> **执行状态：待启动**（外派执行稿；§1 事实为 2026-09-13 在 `987c988` 上只读取证，带 file:line）
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让**坏边能被发现、能被修好**：
- **R2-0**：kernel 开 `tolerateMissingTargets`——目标被删的引用降级为诊断而非冲突 → `remove-node` 进迁移白名单，**删除重复实体不再"漂移"其余实体的边**（R1 复核发现③）。
- **R2-1**：**重挂锚点 UI**——EdgeEditor 的 from/to 从只读文本变成可重挂（复用 `collectNodeChoices` 候选器）；这是全仓**第一个**边锚修复入口。
- **R2-2**：**可发现性闭环**——诊断条可点击 → 打开关系面板；面板行显式呈现「源锚未解析：<原文>」。
- **R2-3**：关系面板行内动作（**重挂 / 删除**）。
- **R2-4**：`edgeHealth` 口径注释修正（R1 复核发现②）。
- **R2-5**：收口。

**Architecture:** 全部是**接线与补缝**，不新增概念：
- 迁移补缝走 kernel 既有 `planReferenceMigration` 的**加选项**（不动既有调用方语义）。
- 重挂写路径**唯一归属** `useEdgeActions`（`writeEdges` + `patchEdgeAt`，`apps/canvas/src/hooks/useEdgeActions.ts:98-129`），**禁止出现第二条写路径**（ADR-0008 同款纪律）。
- 选择器复刻零新逻辑：`collectNodeChoices`（`packages/react/src/chrome/edgeEditorShared.tsx:41-63`）已与 `anchorOfNode` 同一套 `#N` 消歧规则。
- **明确不做**：无源边的画布占位（"收件箱角"）——见 §3 决策 R2-A1 与理由。

**Tech Stack:** TypeScript / pnpm workspace / Vitest + jsdom / React 19 / kernel（`anchor-migrate`）

---

## 0. 基线与交付闸门（本轮起点实测，HEAD = `987c988`）

| 项 | 实测 |
|---|---|
| 测试 | kernel **478** + react **1048** + canvas **125** = **1651 全绿** |
| lint 水位 | **1481 warnings / 46 infos**（**本批不得升高**） |
| 债务预算 | any 0/0、tsIgnore 0/0、**bang 89/90**、**asCast 31/31**、console 4/4、todo 1/1、defaultExport 2/2、**bigFiles 3/4** |
| 超大文件（**禁再写 UI 进去**） | `MindmapStage.tsx` **2244** / `MapView.tsx` 2078 / `edgeRouting.ts` 1152 —— R2 的 UI 一律落新模块或 `chrome/` 既有模块 |
| 工作树 | 干净（仅 `tools/graph-engine/` 未跟踪，勿动）；未 push |

**每任务 DoD**：三包 `tsc --noEmit` 绿 + `tsc -p packages/react/tsconfig.build.json` 重建 dist + `depcruise` 0 + `biome lint packages apps` 退出 0 且总告警 ≤ **1481** + `check-code-budget.mjs` 持平 + 相关分包测试绿 + **一条 commit**（禁 `git add -A`）。

> 环境：`pnpm` 可能不在 PATH → tsc/depcruise/lint/budget 用直跑命令（见前几批计划 §0 同款）；套件分包单跑；PowerShell 一律「重定向到 tmp-*.log + 文件读取工具看」，tmp 不提交、收尾删。

---

## 1. 实现前必读（只读取证）

### 1.1 R2-0 的注入点（kernel）
1. `planReferenceMigration(before, after, refs)` → `ok:true{updates,diagnostics} | ok:false{conflicts,diagnostics}`：`packages/kernel/src/registry/anchor-migrate.ts:247-384`。
2. **目标丢失的判定点**：`buildAnchorFor(after, nodeId)` 在 `getNode(after,nodeId)` 为空时返回 `{ conflict:'target-lost' }`：`anchor-migrate.ts:167-174`（另有 `:187-189` 的 pathOf 中断同码）。
3. 三个调用点（cid / 路径锚 / 实体锚）各自把 `conflict` 推入 `conflicts`：`:276-280`、`:317-321`、`:357-361` → **本任务在这三处统一走一个帮助函数**并支持降级。
4. 诊断码 union 需**加法扩展**：`ReferenceDiagnostic['code'] = 'dangling-kept' | 'pre-existing-ambiguous' | 'unparsable-anchor'`（`:73-80`）→ 新增 `'target-lost-kept'`。
5. 冲突码 union（供测试断言）：`ReferenceConflict['code']`（`:57-71`，含 `target-lost`）。

### 1.2 为什么 remove-node 现在被排除、以及为什么可以进白名单
6. 现状：`remove-node` **不在**白名单（`controller.ts:63-67`），代码注释写明理由——迁移对「目标被删」只能产出 `target-lost` → 会阻断「删除被边引用的节点」这一合法主流程（`controller.ts:10-12,56-61`）。
7. **排除理由的隐含前提不成立**（R1 复核发现③，本任务是它的修复）：实体 `#N` 编号**随出现数变化**——`freeEdges.ts:120-134`「多次出现才给全部加 `#N`，唯一出现回裸锚」；因此**删除一个重复出现**会改变**其余同实体节点**的规范锚 → 指向它们的边锚文本越界 → `stale`（静默漂移）。删除**不改**其他节点的路径锚（路径锚基于名字而非下标），所以风险面只有实体 `#N` 与"删掉的正是被引用者"两类。
8. `tolerateMissingTargets` 打开后：目标不在 after 的引用 → `keepWithDiagnostic('target-lost-kept')`（保留原锚 + 诊断）→ 其余引用照常迁移 → **删除不阻断、其余边不漂移**。

### 1.3 R2-1/R2-3 的写路径与候选项（react/apps）
9. 边写路径唯一归属：`useEdgeActions` 的 `writeEdges(edges: DocEdge[])`（`:98-106`）与 `patchEdgeAt(edges, index, patch)`（`edgeEditorShared.tsx:70-73`）；已有动作 `connectEdge` / `writeEdgeManual` 同款落地（`:108-129`）。**重挂 = `writeEdges(patchEdgeAt(cur, index, { from|to: newAnchor }))`**。
10. `nodeChoices: {id,label,anchor}[]` 已在 hook 内派生（`useEdgeActions.ts:70`）——直接作为重挂选项源；`anchorById` 亦已就绪（`:71-75`）。
11. EdgeEditor 的 from/to 现状**只读**：`packages/react/src/chrome/EdgeEditor.tsx:117-129`（`{edge.from} → {edge.to}` 文本）。LinkCreator 的候选选择器同文件内（原有实现，样式可复用）。
12. 状态是**派生**的（`freeEdges.ts:232-237` 每次重算）→ 重挂成功后 `state` 自动变 well-formed，**无需写 state**；`invalidAt` 是用户显式标记，**重挂不得静默清除**。

### 1.4 R2-2 的范围裁决依据（重要，防把范围做飞）
13. `freeEdges.ts:307-314` 的历史裁决：**源锚未解析时不再绘制"飞向世界原点的误导性直线"**（E8 P0 修复）；`:391-392` 因此返回 `renderable:false`，`FreeEdgeLayer.tsx:181-184` 跳过绘制。→ **"无源边在画布上凭空占位"是被明确否决过的形态**，R2 不复活它。
14. 真正"会画"的降级态已存在：目标不可解析 → **ghost 渲染**（虚线 + 空心圆 + 提示「锚点未命中（悬空）」）：`freeEdges.ts:403-417`、`FreeEdgeLayer.tsx:367-390`。
15. 因此 R2-2 的落点是**发现路径**而非画布：诊断条（R0-2 产物，`apps/canvas/src/chrome/…` 见 `EdgeHealthBar.tsx`）升级为**可点击**（打开关系面板）——与 R0-2「零点击」相反，**本任务要把"零点击"改为"单点击可达"**，并在测试里反转该断言（契约更新，需在 commit message 写明）。
16. 面板行已有「源锚未解析」禁用态（`EntityGraphPanel.tsx:151-152,202-212`）与分组（`:47-65`）——R2-3 在其上加动作，**不改分区语义**。

### 1.5 既有守卫与风格
17. R1 的表驱动守卫：`packages/react/tests/controller-anchor-migration.test.ts`（22 例，含冲突整批拒绝与 undo 契约）；kernel 侧：`packages/kernel/tests/anchor-migrate.test.ts`。
18. R0 的守卫：`packages/react/tests/edge-health.test.ts`（7 例）、`apps/canvas/tests/edge-health-bar.test.tsx`（4 例，含"零点击"断言——R2-2 要改的那条）。
19. 组件测试分组习惯：细粒度行为走组件测试（react 包），宿主接线走 `apps/canvas/tests` 冒烟——R0-2 已按此分工，沿用。

---

## 2. 任务

### R2-0：kernel `tolerateMissingTargets` + `remove-node` 入白名单

**Files:**
- Modify: `packages/kernel/src/registry/anchor-migrate.ts`（加选项 + 新增诊断码 + 三调用点统一降级）
- Modify: `packages/react/src/edit/controller.ts`（白名单加 `remove-node`；**仅当**触发 op 含 `remove-node` 时传 `tolerateMissingTargets: true`）
- Test: 扩展 `packages/kernel/tests/anchor-migrate.test.ts`；扩展 `packages/react/tests/controller-anchor-migration.test.ts`

**Interfaces:**
```ts
export function planReferenceMigration(
  before: EditableNode,
  after: EditableNode,
  refs: readonly AnchorRef[],
  opts?: { tolerateMissingTargets?: boolean },   // 缺省 false = 现行语义逐位不变
): ReferenceMigrationPlan;
// ReferenceDiagnostic['code'] 增 'target-lost-kept'
```

- [ ] **Step 1: kernel 测试（先红）**：① 目标被删 + `tolerateMissingTargets: true` → `ok:true` 且该 ref 产出 `target-lost-kept` 诊断、**无 updates**、其余 ref 正常迁移；② 同场景不带选项 → `ok:false` + `conflict.code === 'target-lost'`（**证明默认语义不变**）。
- [ ] **Step 2: 实现 → 绿**（三调用点走统一帮助函数；`buildAnchorFor` 保持纯、不改其返回）。
- [ ] **Step 3: react 测试（先红）**：① **删重复实体的一个出现** → 另一实体的边锚被迁移为裸锚、仍 well-formed（`edgeHealthOf` 无 dangling）；② **删被边引用的普通节点** → 删除**不被阻断**（root 变化、history 前进）+ 该边变 dangling + 诊断含 `target-lost-kept`（经 R0-4 通道可见）。
- [ ] **Step 4: 实现 → 绿**；跑 react 全量套件（1048+）+ kernel 套件。
- [ ] **Step 5: 阴性对照（必做）**：把 `tolerateMissingTargets` 的降级分支短路 → Step 3-① 必红 → 恢复复绿 + `git diff` 空。
- [ ] **Step 6: 提交** `feat(kernel,react): 迁移支持 tolerateMissingTargets——删除重复实体不再漂移其余实体的边`（body 写明：默认语义不变 / remove-node 的条件式启用理由）

### R2-1：重挂锚点 UI（EdgeAnchorPicker + EdgeEditor 接线）

**Files:**
- Create: `packages/react/src/chrome/EdgeAnchorPicker.tsx`（<200 行；列表 + 过滤 + Esc/点遮罩取消；样式复用 LinkCreator 的列表观感）
- Modify: `packages/react/src/chrome/EdgeEditor.tsx`（head 行的 from/to 文本旁各加「重挂」入口；新增 props）
- Modify: `packages/react/src/index.ts`（加法出口）
- Modify: `apps/canvas/src/hooks/useEdgeActions.ts`（新增 `reattachEdge(index, side, anchor)`——唯一写路径）
- Modify: `apps/canvas/src/EdgeDraftLayer.tsx`（接线 choices + onReattach）
- Test: 新建 `packages/react/tests/edge-anchor-picker.test.tsx`；扩展 `packages/react/tests/edge-editor.test.tsx`；新建 `apps/canvas/tests/edge-reattach.test.tsx`

**Interfaces:**
```ts
// EdgeEditor 新增（全部可选，缺省 = 不显示重挂入口，向后兼容）
choices?: readonly { id: string; label: string; anchor: string }[];
onReattach?: (side: 'from' | 'to', anchor: string) => void;

// EdgeAnchorPicker
{ choices; onPick: (anchor: string) => void; onClose: () => void;
  /** 排除项：当前另一端的锚（防自关联）；缺省不排 */
  excludeAnchor?: string }
```
- [ ] **Step 1: picker 组件测试（先红）**：① 列表渲染 + 点击回调正确；② `excludeAnchor` 命中项被过滤；③ Esc/遮罩取消不回调；④ 空 choices → 空态文案。
- [ ] **Step 2: 实现 picker → 绿**。
- [ ] **Step 3: EdgeEditor 测试（先红）**：① 注入 choices+onReattach → 出现两个重挂入口；② 缺省不注入 → 不出现（向后兼容钉死）；③ 点入口 → picker 打开、选一项 → `onReattach('from', anchor)` 收到正确值。
- [ ] **Step 4: hook 测试（先红）**：`reattachEdge(0,'from','node:根/X')` → `note.edges[0].from` 被改写、**同批只动这一项**（其余字段与项不变）、`invalidAt` 未被清除、可行一次 undo 回滚。
- [ ] **Step 5: 应用层测试（先红）**：一条 dangling 边 → 经重挂选到现存节点 → **`edgeHealthOf` 的 dangling 计数归零**、边在画布可见（`[data-free-edge]` 计数 +1）。
- [ ] **Step 6: 实现 → 绿**；跑 react + canvas 全量套件。
- [ ] **Step 7: 提交** `feat(react,canvas): 重挂锚点 UI（EdgeAnchorPicker + EdgeEditor 入口 + useEdgeActions.reattachEdge）`

### R2-2：可发现性闭环（诊断条可点 → 关系面板）

**Files:**
- Modify: `packages/react/src/chrome/EdgeHealthBar.tsx`（加 `onOpen?: () => void`；`pointerEvents` 从 none 改 auto——**只对这一个条**）
- Modify: `apps/canvas/src/MindmapStage.tsx`（**仅接线**：`onOpen` → 打开关系面板；不写 UI）
- Test: 修改 `apps/canvas/tests/edge-health-bar.test.tsx`（**反转"零点击"断言为"单点击可达"**）+ `packages/react/tests/…` 若有

- [ ] **Step 1: 改断言（先红）**：① 有 problems 时条可点击（`cursor:pointer` + 点击回调触发一次）；② 回调打开关系面板（宿主层断言 `panel === 'relation'`）。**commit message 写明这是 R0-2「零点击」契约的反转**。
- [ ] **Step 2: 实现 → 绿**；确认条仍不挡画布（点击区域仅条体本身，非全屏）。
- [ ] **Step 3: 提交** `feat(react,canvas): 边健康度条可点击 → 打开关系面板（可发现性闭环）`

### R2-3：关系面板行内动作（重挂 / 删除）

**Files:**
- Modify: `packages/react/src/chrome/EntityGraphPanel.tsx`（行内右侧加两个小动作；新增可选 props）
- Modify: `apps/canvas/src/MindmapStage.tsx`（接线：`onReattachEdge` / `onDeleteEdge`）
- Test: 扩展 `packages/react/tests/entity-graph-panel.test.tsx`

**Interfaces:**
```ts
// EntityGraphPanelProps 新增（全部可选；缺省不渲染按钮 = 向后兼容）
choices?: readonly { id: string; label: string; anchor: string }[];
onReattachEdge?: (key: string, side: 'from' | 'to', anchor: string) => void;
onDeleteEdge?: (key: string) => void;
```
- 行内「重挂」按**未解析的那一端**（`sourceId === ''` → from；`targetId === null` → to；两端都坏时给 from 优先并注明）；「删除」= `writeEdges` 过滤掉该项（走同一写路径）。
- 重挂复用 `EdgeAnchorPicker`（同包，直接 import）。
- [ ] **Step 1: 测试（先红）**：① 缺省 props → 无按钮（兼容）；② 悬空行点「重挂」→ picker 打开 → 选题 → `onReattachEdge(key,'from',anchor)`；③ 任意行点「删除」→ `onDeleteEdge(key)`；④ 正常行也有删除、但重挂端选择正确。
- [ ] **Step 2: 实现 → 绿**。
- [ ] **Step 3: 提交** `feat(react,canvas): 关系面板行内重挂/删除动作（dangling 修复的第三入口）`

### R2-4：`edgeHealth` 口径注释修正

- [ ] 改 `packages/react/src/render/edgeHealth.ts` 文件头口径声明：`renderable` / `noBox` 与画布 `renderable`（`freeEdges.ts:391-417`）的差异要写准——**ghost（target 不可解析）在画布会画、但被本函数 `renderable` 排除（低估）；缺盒/塌陷场景则可能高估** → 改掉"只会高估"的表述；并在 `noBox` 字段注释注明"含 ghost 场景"。**只改注释，不改计数（避免牵动 R0 测试与面板分组语义）**。
- [ ] 提交 `docs(react): edgeHealth 口径注释修正（renderable/noBox 与画布的双向差异）`

### R2-5：收口

- [ ] 全 gate（tsc ×3 + 三包套件 + depcruise + lint + budget），贴实测；lint ≤ **1481**。
- [ ] CHANGELOG 追加一段（含 R2-A1 的范围裁决与理由）。
- [ ] 提交 `docs: 关系线 R2 收口（重挂锚点 + 可发现性 + 删除漂移修复）`

---

## 3. 决策点（默认按推荐执行，不必等确认）

| # | 决策点 | 推荐 |
|---|---|---|
| **R2-A1** | 「失效边在画布不再消失」的原表述 | **降级范围**：无源边的画布占位（收件箱角/原点附近）**不做**——`freeEdges.ts:307-314` 有历史裁决"不画飞向世界原点的误导性直线"，且该形态需要新 UX 概念与命中/z-order 处理。改为**可发现性闭环**（诊断条可点 + 面板行可修复）。**若要收件箱，另立 UX 决策批**。 |
| R2-A2 | 重挂写路径 | 唯一走 `useEdgeActions.reattachEdge`（内部 `writeEdges + patchEdgeAt`）；**禁止第二写路径** |
| R2-A3 | 重挂对 `invalidAt` 的处理 | **不动**（软失效是用户显式标记；恢复归既有「失效（可恢复）」按钮）；`state` 派生自动更新，无需写 |
| R2-A4 | `tolerateMissingTargets` 启用条件 | **仅当**触发 op/批次含 `remove-node` 时传 true；其余保持严格（防掩盖 kernel bug） |
| R2-A5 | 候选项过滤 | 排除「选中后使 from === to」的候选（防数据自关联）；`collectNodeChoices` 原样使用（含 `#N` 消歧） |

---

## 4. 风险与明确不做

**风险**
1. **UI 落点**：`MindmapStage.tsx` 已 **2244 行**（超 600 名单内）——R2 的 UI 一律落 `chrome/` 模块；宿主只允许「接线」级改动（每处 ≤ 15 行），违反即视为计划偏离需上报。
2. **契约反转两处**：R0-2 的"零点击"断言（R2-2）与 `remove-node` 白名单（R2-0）——都要在 commit message 逐条写明"契约更新/条件式启用"，防被读成放水。
3. **重挂的 state 语义**：重挂后 `state` 由派生自动转 well-formed；**不得**为了"看起来修好了"顺手清 `invalidAt`（R2-A3）。
4. **picker 与画布手势**：picker 内需 `stopPropagation`（比照 EdgeEditor `:106`），避免点击穿透启动 pan / 关掉浮层。
5. 不得放宽任何既有阈值/契约测试（除 R2-2 明列的反转）；预算零余量项不得新增；新文件 <600 行。

**明确不做（本批）**：无源边画布占位（R2-A1）、`setEntityRef` 的锚迁移缺口（kernel 需支持路径锚↔实体锚重建，另立）、routingSide/`inferBowSide` 静默修复（R3）、边右键菜单/批量/反向（R4）、跳线折线化与 z-order（R5）、`attrs` 与 `cid:` 锚对齐（R6）。

---

## 5. 交付与报告

```
R2-0 → R2-1 → R2-2 → R2-3 → R2-4 → R2-5
```
- 每任务 TDD 红→绿、**红证据必贴**（工具原样）；每任务一条 commit；禁 `git add -A`；不 push。
- 报告格式：逐任务 commit + 改动文件 + 分包测试数（实测）+ 新增用例数；**R2-0 与 R2-1 各给一段阴性对照/红阶段证据**；R2-1 给「重挂前后：锚文本 + `state` + `edgeHealthOf` 计数」原始对照；R2-2 列出被反转的断言原文与原因。
- 报告数字**贴工具原样输出**；与计划的偏差及原因；然后停，等放行 R3。
