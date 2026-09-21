# 关系线 R0+R1 · 派遣计划（2026-09-13）

> **执行状态：待启动**（外派执行稿；§1 事实为 2026-09-13 在 `6fed5ea` 上只读取证，带 file:line）
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 两条批次——
**R0 观测先行**：把「边坏了但静默」变成**可计数、可看见、可定位**（`edgeHealthOf` 纯函数 + 诊断条 + 关系面板分组 + 迁移诊断上报）。
**R1 身份根治**：把已具备但**只挂在两条命令上**的「锚引用迁移」收敛到**编辑管线**，让改名/缩进/反缩进/重排**不再默默断开关系线**。

**Architecture:**
- R0 全部是**加法**（新纯函数 + 既有面板/诊断条接线），**不改渲染与路由语义**。
- R1 的核心是**写路径收敛**（与 ADR-0008「写路径收敛」同一哲学）：不加新机制，把 `planReferenceMigration`（已含 cid 双轨 + 回解析验证）接进 `controller` 的树编辑管线，一处接线覆盖全部结构编辑；冲突策略沿用既有「宁可不写也不错写（整批拒绝 + 明确提示）」。
- **明确不做**：边 cid 化（须另立 ADR，涉 `.mm.md` 协议扩展）、重挂锚点 UI（R2）、自动行为可预期化（R3）、能力补齐（R4）。

**Tech Stack:** TypeScript / pnpm workspace / Vitest + jsdom / React 19 / kernel（`anchor-migrate` 已就绪）

---

## 0. 基线与交付闸门（本轮起点实测，HEAD = `6fed5ea`）

| 项 | 实测 |
|---|---|
| 测试 | kernel **478** + react **1012** + canvas **120** = **1610 全绿** |
| lint 水位 | 全仓 **1481 warnings / 46 infos**（**本批不得升高**；新增代码零告警） |
| 债务预算 | any 0/0、tsIgnore 0/0、**bang 89/90**、**asCast 31/31**、console 4/4、todo 1/1、defaultExport 2/2、**bigFiles 3/4** |
| 超大文件（勿再膨胀） | `MindmapStage.tsx` 2212 / `MapView.tsx` 2078 / `edgeRouting.ts` 1152 —— 新逻辑放新模块（<600 行） |
| 工作树 | 干净（仅 `tools/graph-engine/` 未跟踪，勿动）；未 push |

**每任务 DoD**：三包 `tsc --noEmit` 绿 + `tsc -p packages/react/tsconfig.build.json` 重建 dist + `npx --no-install depcruise packages apps --config .dependency-cruiser.js` 0 + `biome lint packages apps` 退出 0 且**总告警数不高于 1481** + `node scripts/check-code-budget.mjs` 持平 + 相关分包测试绿 + **一条 commit**（中文 `类型(范围): 摘要`；禁 `git add -A`）。

> 环境备忘：`pnpm` 可能不在 PATH → 用上列直跑命令；套件分包单跑（**别用 `pnpm -r test`**）：`cd packages/react; node ../../node_modules/.pnpm/vitest@4.1.11_jsdom@30.0.1_vite@8.2.2/node_modules/vitest/vitest.mjs run`（canvas ~15s / kernel ~11s / react ~2-3min）；PowerShell 一律「重定向到 tmp-*.log + 文件读取工具查看」，**tmp 日志不提交、收尾删**。

---

## 1. 实现前必读（只读取证）

### 1.1 边数据面（谁写、写在哪）
1. 边存于 `root.note.edges`（文档级，非节点属性）；三面纪律见 `packages/react/src/render/freeEdges.ts:1-13` + `docs/adr/ADR-0008-edge-data-faces.md:26-32`。
2. 字段全集 `DocEdge { from, to, rel, dir?, label?, note?, style?, invalidAt?, source?, manual?, routingSide? }`：`freeEdges.ts:52-74`；**无 cid**（决策 D-E3，`docs/roadmap/2026-08-31-edge-first-relations.md:82`）。
3. 会话对象 `FreeEdge` 的 `key = 'e'+index`（**身份 = 数组下标**）：`freeEdges.ts:76-104,239`。

### 1.2 状态是「每次重算」而非持久（这是 R0 的立足点）
4. `state` 不落盘，由 `collectFreeEdges` 每次从数据重算；三态合并规则「任一 stale→stale，否则任一 dangling→dangling，否则 well-formed」：`freeEdges.ts:219-237`。
5. **静默兜底**（R0 要把它们变成可计数的病例）：非对象项 / `from`、`to` 非 string → **静默跳过丢弃**（`freeEdges.ts:225-227`）；`rel` 兜底 `''`（`:245`）；`dir` 非法静默按 `'fwd'`（`:246`）。
6. 失效只有**单点**写入：EdgeEditor 的「失效（可恢复）」→ `apps/canvas/src/EdgeDraftLayer.tsx:143-156`；`invalidAt` 不参与路由/去重（`FreeEdgeLayer.tsx:181-211` 无过滤；`edgeEditorShared.ts:94-100` 的重复判定不看 invalidAt）。

### 1.3 迁移基础设施**已就绪**（R1 的前提，不要重造）
7. `planReferenceMigration(before, after, refs) → { ok:true, updates, diagnostics } | { ok:false, conflicts, diagnostics }`：`packages/kernel/src/registry/anchor-migrate.ts:247-384`——**已含 cid 双轨分支**（`:261-298`，注释明写「根治改名/移动导致路径锚 dangling」）与**回解析验证**（路径锚 `:322-336`、实体锚 `:362-373`）。
8. 完整使用先例（照抄这个流程）：`packages/react/src/edit/cutAttach.ts:272-288`——`simulate(root, ops)` → `collectReferenceAnchors(root)` → `planReferenceMigration(root, staged, refs)` → 冲突则整批拒绝 → `migrationOps(staged, plan.updates, ops)`。
9. 触发侧先例：`apps/canvas/src/MindmapStage.tsx:920-926`（`plan.ok` 否 → `setCommandNotice(plan.error.message)`；`controller.applyTransaction(plan.ops)` → `result.ok` 否 → 提示）。
10. ⚠️ **诊断被丢弃**：`cutAttach.ts:275-288` 只消费 `plan.ok/conflicts`，`plan.diagnostics`（`dangling-kept` / `pre-existing-ambiguous`）目前无任何上报出口 → R0-4 要接。

### 1.4 哪些编辑路径**没有**迁移（R1 的靶子）
11. 改名：`packages/react/src/edit/controller.ts:152-155`（`updateText` → 直接 `apply({type:'update-node', patch:{text}})`）。
12. 缩进/反缩进：`controller.ts:236-258`（`indent`/`outdent` → `applyMove` → `apply({type:'move-node'})`）。
13. 拖拽重排：`MindmapStage.tsx` 内的 move 调用点（**执行时先 `grep -n "move-node" apps/canvas/src packages/react/src` 枚举全部调用点**，不要只信一条行号）。
14. 结论：`planReferenceMigration` 目前只被 `planCutTreeEdge`（`cutAttach.ts:274-288`）与 `planAttachIsland`（`:369-383`）调用 → **改名/缩进/反缩进/重排四类操作后，路径锚直接 dangling**。

### 1.5 失效边在 UI 上「看不见也修不了」（R0/R2 的事实基础）
15. 源锚不可解析 → `renderable:false` → **画布完全不画**：`freeEdges.ts:391-392` + `FreeEdgeLayer.tsx:184`。
16. 关系面板的 `edgeItems` **不传 `state`**：`MindmapStage.tsx:657-675`；且 dangling 行 `sourceId:''` → 行点击 `onFocusNode('')` **静默 no-op**（`:668` + `EntityGraphPanel.tsx:113`）。
17. 面板只读（无编辑/删除/修复）：`packages/react/src/chrome/EntityGraphPanel.tsx:97-171`（失效行仅 `opacity .5` + 「已失效」文案，`:112,121,157-167`；计数仍含失效边 `:85`）。
18. 全仓**没有任何重挂锚点的 UI**：`packages/react/src/chrome/EdgeEditor.tsx:117-129` 的 from/to 是只读文本；边无右键菜单（`FreeEdgeLayer.tsx:345-355` 只有 `onClick`）。

### 1.6 现成的展示/提示通道（R0 直接复用，不要新造）
19. 诊断聚合：`MindmapStage.tsx:783-787`（`allDiags = data.diagnostics + assetDiagnostics(...)`）。
20. 「中心标注诊断条」样式先例（左下琥珀条、`pointerEvents:none`、最多 3 条 + 其余略）：`MindmapStage.tsx:1685-1717`。
21. 命令告警条（顶部居中 4s 消退）：状态 `MindmapStage.tsx:931-949`、渲染 `:1631-1654`、已有消费者 `:922,926,937,1001,1025,1045`。

### 1.7 ⚠️ 会被新契约推翻的既有断言（**必须先找全**）
22. 现有测试把「改名 → dangling」当**正确语义**钉着（subagent 报告 `packages/react/tests/free-edges.test.tsx:749` 附近：改名后边 dangling 属预期）。R1 落地后该断言**语义反转** → 执行者必须 `grep -rn "dangling" packages/react/tests apps/canvas/tests` **枚举全部**，把「因改名/移动产生 dangling」的断言**改写成新契约**（改名后仍 well-formed），并在 commit message 中列明——**这是契约更新，不是放宽测试**；`dangling` 在「手写 YAML 指向不存在节点」「锚不可解析」等场景下仍是正确语义，那些断言保持不动。

---

## 2. 任务

### R0-1：`edgeHealthOf` 纯函数（R0 的地基）

**Files:**
- Create: `packages/react/src/render/edgeHealth.ts`（<200 行；与 `freeEdges.ts` 同层：纯函数、零 DOM）
- Create: `packages/react/tests/edge-health.test.ts`
- Modify: `packages/react/src/index.ts`（加法出口）

**Interfaces（建议形状，可微调但须覆盖下列病例）：**
```ts
export interface EdgeHealthItem {
  index: number;              // root.note.edges 下标（与 FreeEdge.key 对齐）
  from: string; to: string;   // 原始锚文本（malformed 时可能缺失 → ''）
  state: 'well-formed' | 'dangling' | 'stale';
  invalid: boolean;           // invalidAt 存在
  malformed?: boolean;        // 原始项非法（非对象 / from|to 非 string）→ collectFreeEdges 会静默丢弃
  selfAnchor?: boolean;       // from === to（数据自关联，画布不画）
  noBox?: boolean;            // 端点解析不到盒（删除节点遗留等 → ghost / 不画）
  unknownRel?: boolean;       // rel 不在 relationSchema（提示用，不算错）
  duplicateOf?: number;       // 同 from+to+rel 的前一条下标（与既有去重口径一致）
}
export interface EdgeHealth {
  total: number;              // 原始数组长度（含 malformed）
  renderable: number;         // collectFreeEdges 之后可参与渲染的数量
  byState: { wellFormed: number; dangling: number; stale: number };
  invalid: number; malformed: number; selfAnchor: number; noBox: number; unknownRel: number; duplicates: number;
  problems: readonly EdgeHealthItem[];   // 只含「非健康」项（正常边不进列表）
}
export function edgeHealthOf(root: EditableNode): EdgeHealth;
```
- **不修改 `collectFreeEdges`**（保持其行为与调用方契约不变）：malformed/noBox/selfAnchor 等由 `edgeHealthOf` **独立扫原始数组 + 复用既有解析函数**得出。
- 判定要复用而非复刻：状态用 `collectFreeEdges` 的产物；`noBox` 用与画布同一口径（`layout` 不可得，故以「锚不可解析 / 实体未落树」等**数据层可判定**的口径实现，并在文件头注释写明与画布 `renderable` 的差异——**别假装等价**）。

- [ ] **Step 1: 写测试（先红）**：构造覆盖 8 类病例的夹具（正常 / dangling / stale / invalid / malformed（非对象、from 非 string）/ selfAnchor / duplicate / unknownRel）→ 断言 `total/renderable/byState/各计数/problems 明细` 逐字段正确。
- [ ] **Step 2: 实现 → 绿**（严禁在此文件引入 `!`/`as`/`any`）。
- [ ] **Step 3: 阴性对照（必做）**：临时把 `malformed` 分支短路 → 对应用例必红 → 恢复复绿 + `git diff` 无残留。
- [ ] **Step 4: 提交** `feat(react): 新增 edgeHealthOf 边健康度纯函数（8 类病例，独立于 collectFreeEdges）`

### R0-2：边健康度进诊断条

**Files:**
- Modify: `apps/canvas/src/MindmapStage.tsx`（**只接线**：`edgeHealthOf(controller.root)` 入 `useMemo` + 一个新渲染块，仿 `:1685-1717` 的样式与「最多 3 条 + 其余略」结构）
- Test: `apps/canvas/tests/edge-health-bar.test.tsx`（新建）

**行为规格**：
- 仅当 `problems.length > 0` 显示；文案形如 `⚠ 关系线诊断：3 条（悬空 1 / 陈旧 1 / 失效 1）` + 最多 3 条明细（`锚文本 → 状态`）。
- 样式复用中心诊断条的令牌，位置**不与既有条重叠**（中心诊断条在 `bottom:178`；边健康度放 `bottom:178` 之下或之上，执行时实测避让）。
- `pointerEvents: 'none'`（与既有条一致，避免挡住画布）；**不做点击跳转**（那是 R2 的事）。

- [ ] **Step 1: 组件测试（先红）**：① 全健康 → 不渲染；② 造 1 条 dangling → 条出现且计数正确；③ 明细 ≤3 条 + 「其余 N 条略」。 **阴性对照**：把渲染条件改成 `always` → ①必红。
- [ ] **Step 2: 实现 → 绿**；跑 canvas 全量套件确认无回归（尤其 `stage-render`）。
- [ ] **Step 3: 提交** `feat(canvas): 边健康度诊断条（悬空/陈旧/失效计数 + 明细，零点击）`

### R0-3：关系面板分组与「不再 no-op」

**Files:**
- Modify: `apps/canvas/src/MindmapStage.tsx:657-675`（`edgeItems` 增传 `state`）
- Modify: `packages/react/src/chrome/EntityGraphPanel.tsx`（按 `state` 分组/标记；dangling 行的点击行为修正）
- Test: 扩展 `packages/react/tests/entity-graph-panel.test.tsx`

**行为规格**：
- 面板行按状态分区：**正常 / 悬空（dangling）/ 陈旧（stale）/ 已失效（invalidAt）**，每区标题带计数；失效与悬空行的视觉标记区分（现在只有「已失效」一种）。
- `sourceId === ''`（源锚未解析）的行：**不再调用 `onFocusNode('')`**（改为禁用态 + 「源锚未解析」提示），避免静默 no-op。
- 面板仍**只读**（编辑/重挂在 R2，不在本批）。

- [ ] **Step 1: 测试（先红）**：① 三类坏边各 1 条 → 分区标题与计数正确；② 点 dangling 行**不调用** `onFocusNode`；③ 正常行点击仍调用一次。
- [ ] **Step 2: 实现 → 绿**。
- [ ] **Step 3: 提交** `feat(react,canvas): 关系面板按状态分组 + 修复悬空行点击 no-op`

### R0-4：迁移诊断上报（把 `cutAttach` 丢弃的诊断接出来）

**Files:**
- Modify: `packages/react/src/edit/cutAttach.ts`（把 `plan.diagnostics` 随 plan 返回，别吞掉）
- Modify: `apps/canvas/src/MindmapStage.tsx`（切断/接回路径消费诊断 → `setCommandNotice`；多条时汇总一行）
- Test: 扩展 `packages/react/tests/cut-attach.test.ts`

**行为规格**：诊断码 `dangling-kept`（迁移前即失效，保留原值）/ `pre-existing-ambiguous`（迁移前即歧义）→ 用户提示文案必须区分「本次操作没改成」与「本来就坏」；**不阻断**操作（`ok:true` 时照常提交）。

- [ ] **Step 1: 测试（先红）**：构造「旧文件已有 dangling 边 + 执行切断」→ 断言返回的 diagnostics 非空且被宿主提示（hook/组件层断言 `setCommandNotice` 收到文案）。
- [ ] **Step 2: 实现 → 绿**。
- [ ] **Step 3: 提交** `fix(react,canvas): 引用迁移诊断不再被丢弃（dangling-kept/pre-existing-ambiguous 上报）`

### R1-1：锚引用迁移收敛到编辑管线

**Files:**
- Modify: `packages/react/src/edit/controller.ts`（核心；**只改 `apply`/`applyTransaction` 一处管线**）
- Test: `packages/react/tests/controller-anchor-migration.test.ts`（新建）

**设计（决策 R1-A1：管线级收敛，推荐）**：
- 在 `controller` 的树变更管线内统一：`before = this.root` → `next = applyOp(before, op)` → `refs = collectReferenceAnchors(before)` → `plan = planReferenceMigration(before, next, refs)` →
  - `ok:true` → `final = applyUpdates(next, plan.updates)`（**与 op 同一条 history 条目**：一次 Ctrl+Z 撤回「改名 + 锚迁移」）→ 提交；
  - `ok:false` → **整批拒绝**（不写 history、不改 root），把 `conflicts[0]` 组装成 `{ code:'reference-conflict', message }` 经既有失败通道上报（`applyTransaction` 的返回形状对齐 `cutAttach.ts:276-287`；`apply` 若原返回 void，则新增冲突回调 `onAnchorConflict?: (msg: string) => void`，宿主接 `setCommandNotice`）。
- **性能**：迁移只在「路径锚可能受影响」的 op 上跑（`update-node(带 text patch)` / `move-node` / `add-child` / `remove-node`）；其余 op（note/style/collapsed 等）直接短路跳过——避免每次编辑都全量扫锚。
- **回退方案（若管线级出现不可控副作用）**：退回**逐命令接线**（`updateText` / `indent` / `outdent` / 重排调用点各接一次），并在 CHANGELOG 写明欠账「未来新 op 需手动接」。

- [ ] **Step 1: 写测试（先红）**：建一棵带自由边的树 → `updateText` 改名 → 断言边锚**已被重写且仍 well-formed**（现状必红：改名后 dangling）。
- [ ] **Step 2: 实现 → 绿**；再补三类：`indent` / `outdent` / `move-node` 后边锚仍 well-formed。
- [ ] **Step 3: 冲突用例**：改名撞同级同名（产生歧义）→ 断言 **op 被整批拒绝**（root 未变、history 长度未变）+ 冲突信息可读（含 `code` 与锚）。
- [ ] **Step 4: undo 契约**：改名 + 迁移后一次 `undo()` → **文本与边锚同时回滚**。
- [ ] **Step 5: 阴性对照（必做）**：临时摘掉管线内的迁移调用 → Step 1 用例必红 → 恢复复绿。
- [ ] **Step 6: 提交** `feat(react): 锚引用迁移收敛到编辑管线——改名/缩进/反缩进/重排不再断开关系线`

### R1-2：全量结构编辑路径枚举与覆盖（防漏）

- [ ] `grep -rn "type: 'move-node'\|type: 'update-node'\|add-child\|remove-node" packages/react/src apps/canvas/src` **枚举全部树变更入口**，逐个核对：① 走 `controller.apply(Transaction)` 的 → 已被 R1-1 管线覆盖（写进报告）；② 直接改 `controller.root` 或另开捷径的 → **列出并接线**（这是本任务的存在意义）。
- [ ] 对每类入口补一条「操作后边锚仍 well-formed」的表驱动测试（同一个测试文件内 `it.each` 风格）。
- [ ] 提交 `test(react): 结构编辑入口全枚举 + 边锚存活性表驱动覆盖`

### R1-3：更新被新契约推翻的既有断言（**先找全，再改，列明**）

- [ ] `grep -rn "dangling" packages/react/tests apps/canvas/tests` → 找出所有「改名/移动 → dangling」断言（§1.7 第 22 条）；逐条改写成新契约（改名后仍 well-formed），并在 commit message 中**逐条列出**改了什么、为什么（**契约更新 ≠ 放宽测试**：断言方向从「坏了」变成「没坏」，强度不降）。
- [ ] 保留「手写 YAML 指向不存在节点 / 锚不可解析 → dangling」类断言**原样不动**（那是正确语义）。
- [ ] 提交 `test(react): 改写「改名即 dangling」断言为新契约（迁移后存活）`

### R1-4：冲突提示接线 + 收口

- [ ] 宿主把 R1-1 的冲突回调接到 `setCommandNotice`（`MindmapStage.tsx` 既有通道 `:931-949/:1631-1654`），文案示例：`引用迁移冲突（duplicate-sibling-name）：新路径不可唯一表示，本次改名未提交`。
- [ ] 全 gate（tsc ×3 + 三包套件 + depcruise + lint + budget）贴实测；`lint` 总告警数必须 ≤ **1481**。
- [ ] CHANGELOG 追加一段；`docs/preview/perf-baseline.md` 无需动（本批不涉性能）。
- [ ] 提交 `docs: 关系线 R0+R1 收口（健康度观测 + 锚迁移接线）`

---

## 3. 决策点（默认按推荐执行，不必等确认）

| # | 决策点 | 推荐 |
|---|---|---|
| R0-A1 | 边健康度呈现形态 | **独立条**（仿中心诊断条）而非并入 `allDiags`——`allDiags` 是"解析失败"语义，边健康度是"数据健康"语义，混在一起会污染既有诊断的语义边界 |
| R0-A2 | `edgeHealthOf` 是否改 `collectFreeEdges` | **不改**（R0 是加法；`collectFreeEdges` 静默丢弃的行为留给 R6 契约对齐批） |
| R1-A1 | 迁移接线层级 | **管线级**（`apply`/`applyTransaction` 内一处），回退方案见 R1-1 |
| R1-A2 | 冲突时的行为 | **整批拒绝 + 明确提示**（与 `cut/attach` 既有政策一致；这是"宁可不写也不错写"的延用，不是新发明） |
| R1-A3 | 边 cid 化 | **本批不做**（涉 `.mm.md` 协议扩展与兼容，须另立 ADR；本批靠迁移把「改名即断」消掉，cid 是第二代根治） |
| R1-A4 | 迁移的 op 白名单 | `update-node(含 text)` / `move-node` / `add-child` / `remove-node` 四类；其余短路（新增 op 需评估，写进 R1-2 的枚举表） |

---

## 4. 风险与明确不做

**风险**
1. **R1 触碰编辑管线**（本批风险最高项）：任何 op 都可能受影响 → 必须① op 白名单短路（不相关 op 零开销）；② 冲突整批拒绝的用例覆盖；③ undo 契约用例；④ 阴性对照；⑤ 全套件（react 1012 例）+ 真浏览器手动改名检查。
2. **既有断言语义反转**（§1.7/§1.5 第 22 条）→ R1-3 专门处理，且 commit message 逐条列明，避免被读成"改测试放水"。
3. **`noBox` 口径**：`edgeHealthOf` 无 layout，不能用画布 `renderable` 的真实口径 → 文件头必须写明差异（宁可标"数据层口径"也不许假装等价）。
4. **诊断条堆叠**：中心诊断条 / 命令告警 / 预方向提示已在 `MindmapStage` 上有固定位；新增条需实测避让，不得遮挡文档栏与 PerfPanel。
5. 不得放宽任何既有阈值/契约测试；预算零余量项不得新增（any/tsIgnore/asCast/bang/console/todo/defaultExport）；新文件 <600 行。

**明确不做（本批）**：边 cid 化、重挂锚点 UI、失效边画布占位态、routingSide/`inferBowSide` 静默修复、边右键菜单/批量/反向、跳线折线化与 z-order、`attrs` 与 `cid:` 锚对齐、Canvas 降级提示（以上归 R2–R6）。

---

## 5. 交付与报告

```
R0-1 → R0-2 → R0-3 → R0-4 → R1-1 → R1-2 → R1-3 → R1-4
（R0 可独立合并、可先报；R1 独立合并）
```
- 每任务 TDD 红→绿、**红证据必贴**（工具原样）；每任务一条 commit；**禁 `git add -A`**；不 push。
- 报告格式：逐任务 commit + 改动文件 + 分包测试数（实测）+ 新增用例数；**R0-1 与 R1-1 必须各给一段阴性对照证据**；R1-1 给「改名前后锚文本 + 边状态」的原始对照；R1-3 逐条列出被改写的断言。
- 报告数字**贴工具原样输出**；与计划的偏差及原因。
