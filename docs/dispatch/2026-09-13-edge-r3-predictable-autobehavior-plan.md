# 关系线 R3 · 派遣计划（2026-09-13）—— 自动行为可预期化

> **执行状态：待启动**（外派执行稿；§1 事实为 2026-09-13 在 `fbc5815` 上只读取证，带 file:line）
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消灭「点了没反应 / 形状悄悄变了 / 方向反了」三类**静默**：
- **R3-1**：manual（手工几何）存在时，`routingSide`/Opp 控件**显式禁用**（今天可点但静默无效）。
- **R3-2**：`inferBowSide` 支持**跳线/折线**路径（今天只认严格单 C 段 → Opp 恒落 `right`）。
- **R3-3**：`dir` 切换**保形**（manual 锚与 `routingSide` 随渲染端同步交换/翻转 → 线反向但形状不变）。
- **R3-4**：指定侧无解→直穿降级 给出**显式反馈**（今天静默变直连）。
- **R3-5**：三处**注释/文档对齐**（含 R3-4 的"绝不空白"取舍写明）。
- **R3-6**：收口。

**Architecture:** 全部是**显式化**，不改路由算法本身：
- 只加**新字段/新可选 props/新动作**（`forcedSideFallback`、`onDirChange`、`useEdgeActions.setEdgeDir`），**不动既有字段语义**（`routed` 的含义被大量测试依赖，保持原样）。
- 写路径仍唯一：`useEdgeActions`（`writeEdges` + `patchEdgeAt`，`apps/canvas/src/hooks/useEdgeActions.ts:103-120`）。
- **明确不做**：低 LOD / 动画期形状变化的**行为修改**（性能权衡，且 B-P3 已冻结手势期 LOD）——只文档化。

**Tech Stack:** TypeScript / pnpm workspace / Vitest + jsdom / React 19

---

## 0. 基线与交付闸门（本轮起点实测，HEAD = `fbc5815`）

| 项 | 实测 |
|---|---|
| 测试 | kernel **480** + react **1062** + canvas **128** = **1670 全绿** |
| lint 水位 | **1481 warnings / 46 infos**（本批不得升高） |
| 债务预算 | any 0/0、tsIgnore 0/0、**bang 89/90**、**asCast 31/31**、console 4/4、todo 1/1、defaultExport 2/2、**bigFiles 3/4** |
| 超大文件 | `MindmapStage.tsx` **2253** / `MapView.tsx` 2078 / `edgeRouting.ts` 1152 —— 本批 UI 落 `chrome/`，宿主只接线（≤15 行/处） |
| 工作树 | 干净（仅 `tools/graph-engine/` 未跟踪，勿动） |

**DoD**：同前几批（tsc ×3 + react dist 重建 + depcruise 0 + lint ≤1481 + budget 持平 + 分包测试绿 + 一条 commit，禁 `git add -A`）。

---

## 1. 实现前必读（只读取证）

### 1.1 R3-1：manual 与 routingSide/Opp 的静默冲突
1. `FreeEdgeLayer.tsx:196-207`（路由分支）：`edge.manual` 优先于 `routeAesthetic`，而 `forceSide` 只作用于 `routeAesthetic` 的选项 → **manual 边上的 routingSide 永远不生效**（静默）。
2. 控件现状（可点）：`EdgeEditor.tsx:184-192`——`DirToggle`、`RoutingSideToggle`、Opp 按钮（`data-edge-opp`, `flipSide`）。
3. `manual` 在会话对象上可达：`FreeEdge` 含 `manual?`（`freeEdges.ts:92-97`）→ EdgeEditor 能直接判断，无需新数据。
4. 恢复自动的既有入口：双击 bend（`FreeEdgeLayer.tsx:492-497` 一带）——文案要指向它。

### 1.2 R3-2：`inferBowSide` 的严格正则
5. 实现：`edgeRouting.ts:510-520` —— `d.match(/^M x y C c1 c2 p3$/)`，**单 C 段精确匹配**；不匹配 → `'auto'`。
6. 跳线边的 d 由 `pathWithJumps`（`edgeRouting.ts:701-772`）产出，形如 `M… C… L…`/多段 → **必落 'auto'**。
7. Opp 的消费点：`EdgeEditor.tsx:95-101`（`flipSide`）——未设 `routingSide` 时用 `inferBowSide(currentD)`，`'auto'` → **恒置 `'right'`**（用户观感"点了没反应"，需再点一次）。
8. 既有 Opp 闭环测试：`packages/react/tests/edge-routing.test.ts`（`inferBowSide`/Opp 一节）——**必须保持绿**。

### 1.3 R3-3：dir 的渲染端交换 vs manual 的存储语义
9. `dir` 的渲染交换点：`freeEdges.ts:432-436` —— `const forward = edge.dir !== 'back'`，`back` 时把渲染 `from/to` 对调；`both` 与 `fwd` 同向。
10. `manual` 的落点按**渲染 from/to**应用：`FreeEdgeLayer.tsx:38-58`（`manualPathOf`）+ `:241-261`（写回）→ **切 dir 会让手工几何换端**（今天）。
11. `routingSide` 同样是**渲染端相对**（`left/right` 是"沿 from→to 行进方向的侧"，见 `edgeRouting.ts:806-815` 定义）→ 切 dir 后同一绝对侧需要翻转 `routingSide` 才等价。
12. 写路径现状：EdgeEditor 的一切补丁经 `EdgeDraftLayer.tsx:137-141` 的通用 `onChange(patch) → writeEdges(patchEdgeAt(...))`（dir 也走这条）。
13. `useEdgeActions` 是唯一写路径，已有 `reattachEdge`（`:113-120`）/`deleteEdge`（`:122-125`）同款薄封装先例 → `setEdgeDir` 照此加。

### 1.4 R3-4：直穿降级与 `routed` 的语义坑
14. `RouteResult.routed`（`edgeRouting.ts:30-42`）：**`false` 同时表示**「空旷直连」与「降级直穿」——**两种含义不可区分**（这是本任务必须加新标志的原因，**不要改 routed 语义**）。
15. 降级直穿的实际出口：`edgeRouting.ts:1128-1150`（`best` 为空 → 取最近锚点对连直线，`routed:false`）。
16. `forceSide` 下的行为契约：`edgeRouting.ts:1027-1029` 注释（**与实现一致**）：该侧无解 → 下方直穿兜底；而 `:812-813` 的旧注释写「回退到两侧全枚举」——**与实现不符**（R3-5 修）。
17. 结果透传链：`FreeEdgeLayer` 的 `EdgeRouteEntry = { eps, route }`（`FreeEdgeLayer.tsx:112-116`）→ `onRoutesChange` → `useEdgeActions.handleEdgeRoutes` 只存 `d`（`:91-96`，值比较防死循环的先例）→ **R3-4 照该先例再存一个标志**。

### 1.5 既有守卫风格（照抄，别新造）
18. 值比较防重渲：`useEdgeActions.ts:84-96`（存 `d` 而非 Map 的注释与理由）。
19. 组件测试放 react 包、宿主接线冒烟放 `apps/canvas/tests`（仓库分工，R0/R2 沿用）。

---

## 2. 任务

### R3-1：manual 边禁用 routingSide/Opp（显式化）

**Files:**
- Modify: `packages/react/src/chrome/EdgeEditor.tsx`（`RoutingSideToggle` 与 Opp 按 `edge.manual !== undefined` 禁用；`flipSide` 早退早返）
- Test: 扩展 `packages/react/tests/edge-editor.test.tsx`

- [ ] **Step 1: 测试（先红）**：① 带 `manual` 的边 → `data-edge-opp` 与 routingSide 控件呈禁用（`aria-disabled` 或 `disabled` + 不可点）；② 点击它们 → `onChange` **不被调用**（今天必红：可点且会写）；③ 无 `manual` → 控件可用（回归钉）；④ 禁用态 tooltip 文案含「双击 bend 恢复自动」。
- [ ] **Step 2: 实现 → 绿**。
- [ ] **Step 3: 提交** `fix(react): manual 边显式禁用 routingSide/Opp（消除静默 no-op）`

### R3-2：`inferBowSide` 支持跳线/折线路径

**Files:**
- Modify: `packages/react/src/render/edgeRouting.ts`（`inferBowSide` 扩展为多段解析）
- Modify: `packages/react/src/chrome/EdgeEditor.tsx`（`flipSide`：`'auto'` 时不再"静默落 right"——保留落 right 兜底但**给行内提示**）
- Test: 扩展 `packages/react/tests/edge-routing.test.ts`（含用 `pathWithJumps` 产出的真实 d 做夹具）

**算法（决策 R3-A2）**：解析 `M` 起始点 + 全部 `C`/`L` 段；取**弦长最长的 C 段**（跳线场景下主体段即主导段），量其 `c1` 相对该段弦的法向偏移符号 → `left/right`；无 C 段（纯折线）→ 用**折线中点相对首末弦**的偏移符号兜底；仍不可判 → `'auto'`。
- [ ] **Step 1: 测试（先红）**：① 跳线 d（`pathWithJumps` 真实输出）→ 返回正确侧（今天 `'auto'`）；② 单 C 段（现状路径）行为**逐位不变**（回归钉）；③ 纯折线 d → 判定正确；④ 退化（空/畸形 d）→ `'auto'`。
- [ ] **Step 2: 实现 → 绿**；跑 `edge-routing.test.ts` 全量（Opp 闭环保持绿）。
- [ ] **Step 3: 组件测试（先红）**：跳线边点 Opp → `routingSide` 变**另一侧**（今天是"落 right / 无变化"）；`'auto'` 兜底时行内提示出现。
- [ ] **Step 4: 实现 → 绿**。
- [ ] **Step 5: 提交** `fix(react): inferBowSide 支持跳线/折线路径（Opp 不再恒落 right）`

### R3-3：`dir` 切换保形（manual 交换 + routingSide 翻转）

**Files:**
- Modify: `apps/canvas/src/hooks/useEdgeActions.ts`（新增 `setEdgeDir(index, dir)`）
- Modify: `packages/react/src/chrome/EdgeEditor.tsx`（新增可选 `onDirChange?: (dir: LinkDir) => void`；缺省回落 `onChange({dir})` 保持向后兼容）
- Modify: `apps/canvas/src/EdgeDraftLayer.tsx`（接线 `onDirChange → edgeActions.setEdgeDir`）
- Test: 扩展 `apps/canvas/tests/edge-reattach.test.tsx`（或新建 `edge-dir-preserve.test.tsx`）

**契约（决策 R3-A3，写进 `freeEdges.ts` 与 `edgeRouting.ts` 注释）**：`manual` 与 `routingSide` 都是**渲染端语义**（所见即所得）；`dir` 在 `fwd ↔ back` 之间切换时，同一个补丁里**交换 `manual.from/to`** 并**翻转 `routingSide`**，使渲染几何与绝对绕行侧不变；`both` 与 `fwd` 同向（`freeEdges.ts:433` 的 `forward` 判据），**不交换**。

- [ ] **Step 1: 测试（先红）**：① manual 边 `fwd → back` → 渲染 `d` 与切换前**逐位相同**（今天必红：几何换端）；② `routingSide:'left'` 边切 dir → 变 `'right'`（今天必红：不变）；③ 无 manual/无 routingSide → 仅 `dir` 变化（回归钉）；④ `back → fwd` 反向同样保形；⑤ `fwd → both` **不交换**（三态边界钉）；⑥ 一次 undo 全部回滚。
- [ ] **Step 2: 实现 → 绿**（`setEdgeDir` 内部构建单个补丁，一次写、一条 history）。
- [ ] **Step 3: 提交** `fix(canvas,react): dir 切换保形（manual 交换 + routingSide 翻转，渲染端语义契约）`

### R3-4：指定侧无解的显式反馈

**Files:**
- Modify: `packages/react/src/render/edgeRouting.ts`（`RouteResult` 增可选 `forcedSideFallback?: boolean`；**仅**在「`forceSide` 有值 且 走到 1128-1150 的直穿降级」时置 true）
- Modify: `apps/canvas/src/hooks/useEdgeActions.ts`（`handleEdgeRoutes` 增存该标志，**值比较**，仿 `selEdgeD` 先例 `:84-96`）
- Modify: `packages/react/src/chrome/EdgeEditor.tsx`（行内提示「指定侧不可行：已回退直连（可试另一侧）」；由新可选 prop `forcedSideFallback?: boolean` 驱动）
- Modify: `apps/canvas/src/EdgeDraftLayer.tsx`（接线）
- Test: 扩展 `packages/react/tests/edge-routing.test.ts` + `edge-editor.test.tsx` + `apps/canvas/tests/…`

- [ ] **Step 1: 纯函数测试（先红）**：① `forceSide:'left'` + 全穿障 → `forcedSideFallback === true` 且 `routed === false`；② **无 `forceSide` 的直穿 → 标志不置**（关键区分钉）；③ 正常绕行 → 不置。
- [ ] **Step 2: 实现 → 绿**；`edge-routing.test.ts` 全量。
- [ ] **Step 3: hook 测试**：标志变化触发新值、同值不触发（值比较，防重渲链）。
- [ ] **Step 4: 组件测试**：注入 `forcedSideFallback` → 提示出现；不注入/为 false → 不出现（向后兼容）。
- [ ] **Step 5: 提交** `feat(react,canvas): 指定侧无解→直穿降级给出显式反馈（forcedSideFallback）`

### R3-5：注释/文档对齐（三处）

- [ ] `edgeRouting.ts:812-813`：把「若该侧无解，回退到两侧全枚举」改写为事实——「该侧无解 → 由下方**直穿降级**兜底（绝不空白，`:1128-1150`）」。
- [ ] `edgeRouting.ts:306-307` 的 stagger 步长注释（写 0.125）与实现（`a.h*0.125/2` = 0.0625，测试 `edge-natural.test.ts` 按 0.0625 断言）对齐——**改注释不改代码**。
- [ ] CHANGELOG 增「已知取舍」条：① 低 LOD 关避障 / 动画期 `fastRouting` 跳过跳线（形状瞬变 = 刻意换帧率，`MapView` 的 `edgeObstaclesOf` 门控 + `FreeEdgeLayer` 的 `fastRouting`）；② `manual`/`routingSide` 的**渲染端语义契约**（R3-3 钉死的）；
- [ ] 提交 `docs(react): edgeRouting 注释对齐 + CHANGELOG 已知取舍（直穿兜底/stagger 步长/渲染端语义）`

### R3-6：收口

- [ ] 全 gate（tsc ×3 + 三包套件 + depcruise + lint + budget），贴实测；lint ≤ **1481**。
- [ ] CHANGELOG 追加 R3 段。
- [ ] 提交 `docs: 关系线 R3 收口（自动行为可预期化）`

---

## 3. 决策点（默认按推荐执行，不必等确认）

| # | 决策点 | 推荐 |
|---|---|---|
| R3-A1 | manual 时控件的处理 | **禁用 + tooltip**（不隐藏——隐藏会让用户找不到"为什么不能设侧"）；`flipSide` 同时早退（双保险） |
| R3-A2 | `inferBowSide` 的判定法 | **弦长最长的 C 段**（跳线场景主体段即主导段）→ 无 C 段用折线中点偏移兜底 → 仍不可判才 `'auto'` |
| R3-A3 | dir 保形的语义契约 | **manual/routingSide = 渲染端语义**；`fwd ↔ back` 交换/翻转，`both` 与 `fwd` 同向不交换；写进代码注释（`freeEdges.ts:432-436` 旁 + `edgeRouting.ts:806-815`） |
| R3-A4 | `routed` 是否复用 | **不动**（两种 `false` 语义被大量测试与 UI 依赖）；新增专用 `forcedSideFallback` |
| R3-A5 | 低 LOD/动画期形状变化 | **不修行为**（性能权衡 + B-P3 已冻结手势期 LOD），只文档化 |

---

## 4. 风险与明确不做

**风险**
1. **`inferBowSide` 行为变化**（扩大判定范围）→ 既有 Opp 闭环测试必须原样绿；新增跳线用例先红后绿。
2. **dir 保形的交换条件**必须与 `freeEdges.ts:433` 的 `forward` 判据**逐字对齐**（fwd/back/both 三态边界测试钉死），错一个就变成"切 dir 形状乱跳"。
3. **`RouteResult` 加字段**是加法，但 `forcedSideFallback` 的置位条件**必须只在 forceSide 路径**——否则全量直穿场景都会误报（测试②即此钉）。
4. **EdgeEditor 新增 props 一律可选**（`onDirChange?` / `forcedSideFallback?`），缺省回落现有行为——既有 40+ 例 `edge-editor.test.tsx` 不得被迫修改；**若不得不改，视为契约变更，需在报告里逐条列明**。
5. 不得放宽任何既有阈值/契约测试；预算零余量项不得新增；新文件 <600 行；`MindmapStage` 只允许接线（≤15 行/处）。

**明确不做（本批）**：低 LOD/动画期形状稳定化、`setEntityRef` 锚迁移缺口、边右键菜单/批量/反向（R4）、跳线折线化与 z-order（R5）、`attrs`/`cid:` 对齐（R6）。

---

## 5. 交付与报告

```
R3-1 → R3-2 → R3-3 → R3-4 → R3-5 → R3-6
```
- 每任务 TDD 红→绿、**红证据必贴**；每任务一条 commit；禁 `git add -A`；不 push。
- 报告格式：逐任务 commit + 改动文件 + 分包测试数（实测）+ 新增用例数；**R3-2 与 R3-3 各给一段红阶段证据**；R3-3 给「切 dir 前后 `d` 字符串」原始对照；R3-2 给「跳线 d → 判定结果」对照；R3-4 给「置位/不置位」两例对照。
- 报告数字**贴工具原样输出**；与计划的偏差及原因；然后停，等放行 R4。
