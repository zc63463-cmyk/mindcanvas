# 关系线 R4 · 派遣计划（2026-09-13）—— 能力补齐（菜单/反向/失效语义/级联/批量）

> **执行状态：待启动**（外派执行稿；§1 事实为 2026-09-13 在 `106c19b` 上只读取证，带 file:line）
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **本批纪律（重要）**：R3 复核教训——**算法/实现细节不给处方，只给契约与验收标准**。执行者自行选择实现方案；只要契约测试全绿 + 既有守卫不破 + 报告里说明选型理由即可。计划里凡出现具体实现建议，均标为「参考（非强制）」。

**Goal:** 把关系线从「能改、能看、能修、可预期」推进到**能力完整**：
- **R4-1 边右键菜单**（复用既有 `ContextMenu`）——边的第二个入口，且承载后续动作。
- **R4-2 反向**（数据层反转 + `reverseOf` 接线）——今天 schema 定义了成对反向关系（`reverseOf`），**全仓零消费者**。
- **R4-3 失效语义补全**（去重口径 / 路由协调参与 / 空 label 保护）。
- **R4-4 级联（限定语义）**：成对反向边的**同步失效 / 恢复**。
- **R4-5 批量（最小可用）**：多选边 + 批量失效/恢复/删除（含停止上报条款）。
- **R4-6 收口**。

**Tech Stack:** TypeScript / pnpm workspace / Vitest + jsdom / React 19 / Playwright（真浏览器视觉验证）

---

## 0. 基线与交付闸门（本轮起点实测，HEAD = `106c19b`）

| 项 | 实测 |
|---|---|
| 测试 | kernel **480** + react **1081** + canvas **133** = **1694 全绿** |
| lint 水位 | **1481 warnings / 46 infos**（本批不得升高） |
| 债务预算 | any 0/0、tsIgnore 0/0、**bang 89/90**、**asCast 31/31**、console 4/4、todo 1/1、defaultExport 2/2、**bigFiles 3/4** |
| 超大文件（勿再膨胀） | `MindmapStage.tsx` **2253** / `edgeRouting.ts` 1213 / `MapView.tsx` 2078 —— 本批 UI 落 `chrome/` 或新模块；宿主只接线（≤15 行/处） |
| 工作树 | 干净（仅 `tools/graph-engine/` 未跟踪，勿动；`tmp-preview.log` 被 5175 静态服务占用，勿删） |

**DoD**：tsc ×3 绿 + `tsc -p packages/react/tsconfig.build.json` 重建 dist + depcruise 0 + lint ≤ **1481** + budget 持平 + 分包测试绿 + **一条 commit/任务**（禁 `git add -A`）。

---

## 1. 实现前必读（只读取证）

### 1.1 菜单基础设施（R4-1 直接复用，不要新造）
1. `ContextMenu` 组件：`packages/react/src/chrome/ContextMenu.tsx` —— item 形状 `{ label, onSelect?, danger?, disabled?, section?, hint?, page? }`（`:17-35`），支持**分区标题**（`section` 变化处渲染，`:155-172`）与**菜单内翻页**（`page`，`:180-184`）、视口钳制（`:60-64`）、Esc/遮罩关闭。
2. 边的命中与回调现状：`FreeEdgeLayer.tsx` 的 `<g data-free-edge>` 命中区只有 `onClick`（`onSelect`，`:341-355`），**无 `onContextMenu`**；`interactive` 由 `relationMode` 门控（`MapView.tsx` 传入，见 `:1618-1626` 一带）。
3. MapView 的边回调面（R4-1 需加一个）：`MapView.tsx:209-222` —— 已有 `selectedEdgeKey` / `onEdgeClick(edge, sx, sy)` / `onEdgeManualChange` / `onEdgeRoutes`；**新增 `onEdgeContext?: (edge, sx, sy) => void` 属同族加法**。
4. 宿主菜单渲染先例：`apps/canvas/src/NodeContextMenu.tsx`（节点右键）+ `packages/react/src/edit/contextMenuItems.ts`（菜单项数据）——**边菜单照此分工**（数据在 react、渲染在宿主）。

### 1.2 反向关系（R4-2 的依据）
5. schema 已定义成对反向：`RelationTypeConfig.reverseId?`、`isSymmetric`（`relationSchema.ts:10-19`，注释：「反向关系：causes↔isCausedBy 成对注册；Passive 组系统维护，用户选择器不展示」）。
6. 查询入口已就绪但**零消费者**：`reverseOf(id): string | null`（`relationSchema.ts:314-317`）。
7. 方向的两个既有概念（**必须区分，写进契约**）：
   - `dir`（`fwd'|'back'|'both'`）= **渲染层**方向（`freeEdges.ts:432-436` 的 `forward` 交换）；
   - 「反向」（本任务）= **数据层**反转：交换 `from/to`，并按 `reverseOf` 换 `rel`；两者不是同一件事。
8. R3 已钉的渲染端语义契约（R3-3）：`manual`/`routingSide` 是**渲染端语义**，跨 `fwd↔back` 切换时要同步交换/翻转保形（`useEdgeActions.setEdgeDir`，`apps/canvas/src/hooks/useEdgeActions.ts:144-162`）。**反向会改变渲染方向 → 必须处理同一问题**（参考：复用 `setEdgeDir` 的保形思路，非强制）。

### 1.3 失效语义的现状（R4-3）
9. `invalidAt` 单点写入：EdgeEditor 的「失效（可恢复）」（`EdgeDraftLayer.tsx:147-160`）；画布灰虚线（`FreeEdgeLayer.tsx:319-326`）。
10. **失效边仍参与去重**：`findDuplicateEdge` 只看 `from+to+rel`（`edgeEditorShared.ts:94-100`），`connectEdge` 命中即选中旧边（`useEdgeActions.ts:116-129`，现 `:150-163` 一带）→ **失效边会静默吞掉新建**。
11. **失效边仍参与路由协调**：`FreeEdgeLayer.tsx:181-211` 的路由循环无 `invalidAt` 过滤 → 失效边照常占位、参与跨边协调/跳线/stagger（"已否定的关系仍在影响别人的形状"）。
12. 空 label：`edge.label ?? edge.rel`（`FreeEdgeLayer.tsx:331`）——`rel` 兜底空串时（`freeEdges.ts:245`）会渲染**空胶囊**。

### 1.4 级联的原始出处（R4-4 的语义边界）
13. `docs/research/2026-08-31-mindflow-relation-comparison.md:48,64`：E6.2 设计里写「软失效 + 恢复」「**失效-恢复级联测试**」；`dangling=目标没了 / invalidAt=关系被否定` 语义互补。**但"级联"的具体形态从未定义**——本批只落**可定义的一种**（见 R4-4），其余形态明确不做（§4）。
14. 现状无任何级联实现（R0/R1/R2/R3 均未触碰）——`invalidAt` 完全单条孤立。

### 1.5 批量（R4-5）要动的面
15. 选中是**单值**：`MapView.selectedEdgeKey?: string | null`（`:209-212`）+ `useEdgeActions.edgeSel: {key,x,y} | null`（`:54-56`）+ `FreeEdgeLayer` 的 `selectedKey`（渲染高亮 `:328`）。
16. 边编辑浮层是单条驱动：`EdgeDraftLayer` 的 `selEdgeOpen`（`:112-166`）——批量需要一个新的「多条条」UI 或入口，**不改单条路径**。
17. 仓库测试分工：细粒度行为在 react 包；宿主接线在 `apps/canvas/tests`（R0/R2 沿用）。

---

## 2. 任务

### R4-1：边右键菜单（入口 + 菜单项）

**Files:** `packages/react/src/render/FreeEdgeLayer.tsx`（命中区加 `onContextMenu`）、`packages/react/src/render/MapView.tsx`（+`onEdgeContext` prop）、`packages/react/src/edit/edgeContextItems.ts`（**新建**：菜单项数据，仿 `contextMenuItems.ts` 分工）、`apps/canvas/src/MindmapStage.tsx`（接线：渲染 `ContextMenu`）、测试（新建 `packages/react/tests/edge-context-items.test.ts` + `apps/canvas/tests/edge-context-menu.test.tsx`）

**契约（验收标准）**：
- 在**关系模式**下右键一条边 → 命中区 `onContextMenu` 触发一次（`preventDefault`，不冒泡到画布容器）、`onEdgeContext(edge, sx, sy)` 收到该边与**指针屏幕坐标**；同时该边被选中（与左键同语义）。
- 浏览态（非关系模式）：**不弹边菜单**（与既有"浏览态边不可点"一致，`FreeEdgeLayer.tsx:344-355` 的 `interactive` 门控）。
- 菜单渲染复用 `ContextMenu`；分组（`section`）与禁用态（`disabled`）按数据驱动。
- 菜单项最小集：**编辑**（打开 EdgeEditor）｜**重挂源锚 / 重挂靶锚**｜**反向**（调 R4-2 命令）｜**复制一条**｜**失效 / 恢复**（按当前 `invalidAt` 动态文案）｜**删除**（`danger`）。禁用规则：`manual` 存在时不禁用重挂；源/靶两端任一未解析时「反向」「复制」仍可用（它们是数据操作）——**具体禁用矩阵由测试钉死，不预设**。
- Esc / 点遮罩 / 选中其它边 → 关闭。

- [ ] **Step 1: 纯数据测试（先红）**：`edgeContextItems(facts)` 产出项集与禁用态（表驱动：无效/有效性组合 × 有无 manual × dangling）。
- [ ] **Step 2: 实现数据 → 绿**。
- [ ] **Step 3: 组件/宿主测试（先红）**：右键 → 菜单出现于坐标（`data-menu-item` 数量）；点「编辑」→ EdgeEditor 打开；点「删除」→ 边数 −1 且一次 undo 可回滚；浏览态右键 → **不出现**。
- [ ] **Step 4: 实现接线 → 绿**；跑 react + canvas 全量。
- [ ] **Step 5: 提交** `feat(react,canvas): 边右键菜单（编辑/重挂/反向/复制/失效/删除，复用 ContextMenu）`

### R4-2：反向（数据层反转 + `reverseOf` 接线）

**Files:** `apps/canvas/src/hooks/useEdgeActions.ts`（新增 `reverseEdge(index)`）、`packages/react/src/chrome/EdgeEditor.tsx`（加「反向」按钮，可选 prop 向后兼容）、`apps/canvas/src/EdgeDraftLayer.tsx`（接线）、测试（扩展 `apps/canvas/tests/edge-reattach.test.tsx` 或新建 `edge-reverse.test.tsx`）

**契约（验收标准）**：
- 交换 `from`/`to`；`rel` 处理三态：**成对反向**（`reverseOf(rel)` 非空）→ `rel` 换成反向 id；**对称**（`isSymmetric`）→ `rel` 不变；**未注册/无反向** → `rel` 不变**且给出一次可见提示**（文案自拟，走既有 `commandNotice` 通道）。
- 渲染几何**保形**：反转前后「原 A 端锚点仍是 A 端、原 B 端锚点仍是 B 端、绕行绝对侧不变」——即 `manual`/`routingSide` 必须按渲染端语义同步调整（同 R3-3 的问题域）；**测试用端点保位断言**（参考 `edge-reattach.test.tsx:186-196` 的 `after.start === before.end` 风格）。
- 一次 undo 全部回滚（单补丁单写，唯一写路径 `useEdgeActions`）。
- **与 `dir` 的正交性**：反向**不改** `dir`（`back` 边的反向仍然是 `back`）；两者叠加的表驱动测试必须覆盖（fwd/back/both × 反向 各一次）。

- [ ] **Step 1: 表驱动测试（先红）**：rel 三态 × dir 三态 × manual 有无（12 组合）；断言 from/to、rel、manual/routingSide、dir、undo。
- [ ] **Step 2: 实现 → 绿**。
- [ ] **Step 3: 组件入口测试**：EdgeEditor「反向」按钮 → 触发 `onReverse`（缺省不注入则不渲染按钮——向后兼容钉）。
- [ ] **Step 4: 提交** `feat(react,canvas): 边反向（from/to 交换 + reverseOf 接线 + 渲染端保形）`

### R4-3：失效语义补全（三个小契约）

**Files:** `apps/canvas/src/hooks/useEdgeActions.ts`（去重口径）、`packages/react/src/render/FreeEdgeLayer.tsx`（路由协调参与 + 空 label）、`packages/react/src/chrome/edgeEditorShared.tsx` 或 `edge-routing` 侧的过滤点、测试若干

**契约（验收标准）**：
- **③-① 去重口径**：`connectEdge` 的重复判定**只对未失效边生效**——存在同名失效边时**新建**（不静默打开旧边），并给一次提示（文案含"已存在 1 条同名失效边"）；两条同键边（一失效一正常）并存时，`findDuplicateEdge` 的返回语义必须与调用方一致（**测试钉死**）。
- **③-② 路由协调参与**（决策 R4-A3）：失效边**不再进入**跨边协调/跳线/stagger 的输入集（仍照常绘制为灰虚线）；契约测试 = 一条失效边存在与否，**不影响其它正常边的 `RouteResult`**（`d` 逐位相同）；自身形状允许变化。**必须真浏览器截图对比**（新增或复用 `tools/` 脚本）并作为独立 commit（可回退）。
- **③-③ 空 label 保护**：`rel` 为空串 → 不渲染空胶囊（标签整体不出现）；`label` 非空时照常。

- [ ] **Step 1: 三组测试（先红）**：① 失效同名边 → 新建成功且提示；② 失效边不影响他人 `d`；③ 空 rel → 无空胶囊 DOM。
- [ ] **Step 2: 实现 → 绿**（② 单独 commit）。
- [ ] **Step 3: 真浏览器**：截图对比（失效边在场/不在场的正常边形状）。
- [ ] **Step 4: 提交** `fix(react,canvas): 失效语义补全（去重只看有效边 / 退出路由协调 / 空 label 保护）`（可拆两条）

### R4-4：级联（**限定语义**：成对反向边同步失效/恢复）

**Files:** `apps/canvas/src/hooks/useEdgeActions.ts`（失效/恢复动作升级；现由 EdgeDraftLayer 直接 `patchEdgeAt`，见 `:147-160`——**收敛为 hook 动作**）、`apps/canvas/src/EdgeDraftLayer.tsx`、测试

**契约（验收标准，语义边界写死）**：
- 标记某边失效 → **同一对节点间**存在 `reverseOf(rel)` 的边（且 `rel` 非对称、已注册）→ 该边**同步**标记（同一 `invalidAt` 时间戳）；恢复同理同步恢复；提示"已同步 1 条反向关系"。
- **不联动**：对称关系（`isSymmetric`）、未注册 rel、非成对（无人反向）——表驱动钉死。
- 一次 undo 全回滚（同一批写）。
- **明确不做**：节点删除→边的自动失效标记（保持 dangling 自然语义 + R0 可见）、传递闭包、跨文档。

- [ ] **Step 1: 表驱动测试（先红）**：成对/对称/未注册 × 失效/恢复 + undo。
- [ ] **Step 2: 实现 → 绿**。
- [ ] **Step 3: 提交** `feat(canvas): 成对反向边的失效/恢复同步（级联限定版）`

### R4-5：批量（最小可用 + **停止上报条款**）

**Files:** `apps/canvas/src/hooks/useEdgeActions.ts`、`packages/react/src/chrome/EdgeEditor.tsx`（或新 `EdgeMultiBar.tsx`）、`apps/canvas/src/EdgeDraftLayer.tsx`、`packages/react/src/render/MapView.tsx`（`selectedEdgeKeys` 加法式扩展）、测试

**契约（验收标准）**：
- 关系模式下 **Shift/Ctrl + 点边** → 加入/移出选中集合；集合 ≥2 → 显示「批量条」（`data-edge-multi-bar`）：N 条 + **失效 / 恢复 / 删除** 三个动作（改 rel 可选，若做需单一输入框）。
- Esc / 点空白 / 退出关系模式 → 清空集合。
- **单条选中与编辑的既有行为完全不变**（回归钉，含 `EdgeEditor` / 面板 / 右键菜单入口）。
- 批量删除一次 undo 全回滚；批量失效互不覆盖既有 `invalidAt`（只对未失效的生效，提示"已跳过 2 条已失效"）。

**停止上报条款（硬）**：若多选实现需要改动 **≥3 个跨层文件之外**的新机制（例如新增手势层状态机），或 `MapView` 改动 **>30 行**，或发现与 pan/连接手柄手势冲突 → **停下报告**，把批量降级为「**面板内多选**」（在关系面板行上加 checkbox + 批量条），不改画布手势。

- [ ] **Step 1: hook 层测试（先红）**：集合增删/清空/批量删除/批量失效的跳过语义。
- [ ] **Step 2: 组件测试（先红）**：Shift 点选 → 批量条出现；点空白清空；单选回归。
- [ ] **Step 3: 实现 → 绿**（或触发停止上报条款）。
- [ ] **Step 4: 提交** `feat(react,canvas): 边多选与批量失效/恢复/删除（最小可用）`

### R4-6：收口

- [ ] 全 gate（tsc ×3 + 三包套件 + depcruise + lint + budget）贴实测；lint ≤ **1481**。
- [ ] CHANGELOG 追加 R4 段（含 R4-A3 的路由协调决策与 R4-4 的语义边界）；§4 的"明确不做"清单同步进去。
- [ ] 提交 `docs: 关系线 R4 收口（能力补齐）`

---

## 3. 决策点（默认按推荐执行；**算法/实现选型由执行者定，只有契约是硬的**）

| # | 决策点 | 推荐 |
|---|---|---|
| R4-A1 | 边菜单在浏览态的可用性 | **不弹**（与既有"浏览态边不可点"一致）；需要菜单 → 先进关系模式（提示条已有） |
| R4-A2 | 反向时 `rel` 无反向名 | **`rel` 不变 + 一次提示**（不静默、也不阻断——用户可能就是要反向一个自定义关系） |
| R4-A3 | 失效边是否退出路由协调 | **做**（"已否定的关系不该塑形别人"）；独立 commit + 真浏览器截图 + 可回退 |
| R4-A4 | 级联范围 | **只做成对反向的同步失效/恢复**（可定义、可测）；其余形态不做（§4） |
| R4-A5 | 批量范围 | **画布多选为第一选择**；若触发停止上报条款 → 降级为面板多选并报告 |

---

## 4. 风险与明确不做

**风险**
1. **批量（R4-5）是本批最高风险项**：动选择态（`selectedEdgeKey` 单值 → 集合）会牵动 MapView/FreeEdgeLayer/useEdgeActions/EdgeDraftLayer —— 停止上报条款就是为了防止"为了批量把画布手势层重写"。
2. **R4-3②（失效边退出路由协调）会改视觉**：必须有截图证据 + 独立 commit；若截图显示正常边形状异常 → 回退该项、只保留 ①③。
3. **反向的保形**：与 R3-3 同域问题（渲染端语义）——表驱动必须覆盖 `dir` 三态；
4. 菜单命中：右键也要**阻止画布空白菜单**（`onContextMenu` + `preventDefault` + `stopPropagation`），否则会弹两层菜单（真浏览器检查）。
5. 不得放宽任何既有阈值/契约测试；预算零余量项不得新增；新文件 <600 行；宿主只接线。

**明确不做（本批）**
- 节点删除 → 边的自动失效**标记**（保持 dangling 自然语义 + R0 已可见；若要"删除前提示将影响的边"另立）。
- 传递闭包级联、跨文档边、hover 邻居高亮、ego 过滤、方向粒子流（research 里已标 ⏸/❌ 的项）。
- 边搜索/过滤、度数→大小（research R9/R10）。

---

## 5. 交付与报告

```
R4-1 → R4-2 → R4-3 → R4-4 → R4-5 → R4-6
```
- 每任务 TDD 红→绿、**红证据必贴**；每任务一条 commit（R4-3 若拆两条按 §4 风险 2）；禁 `git add -A`；不 push。
- 报告格式：逐任务 commit + 改动文件 + 分包测试数（实测）+ 新增用例数；**R4-2 给反向前后「from/to/rel/manual/routingSide 五元组」原始对照**；**R4-3② 给真浏览器截图与「正常边 `d` 逐位相同」对照**；R4-5 若触发停止上报条款 → 明确写出触发点与降级方案。
- 报告数字**贴工具原样输出**；与计划的偏差及原因（含实现选型理由）；然后停，等放行 R5（渲染一致性：跳线折线化 / z-order / Canvas 降级提示）。
