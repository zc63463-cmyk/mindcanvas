# R6-小批派遣计划：边 attrs 链路透传 + 丢弃诊断口径补全（零协议风险）

- **日期**：2026-09-14
- **起点 HEAD**：`69323e6`（F5 发布完成；远端 origin/main 已同步）
- **出处**：R0 计划 R0-A2「`collectFreeEdges` 静默丢弃的行为留给 **R6 契约对齐批**」；R2/R3 计划「明确不做：`attrs` 与 `cid:` 锚对齐（R6）」。**本批 = 小 R6**（③+②）；① `cid:` 边锚化属协议面变更，**须另立 ADR，本批不做**（见 §1.4 与 §6）。
- **批次代号**：R6-S1 … R6-S3
- **一句话**：边这条线上，「坏边已经能看见一半、属性存了没人看得见」——本批补**诊断口径**（总数与分项对齐 + 畸形项可处置）与 **attrs 链路**（透传到 `FreeEdge`/`EdgeEditor`，只读呈现 + 保真钉）。**零协议改动**（`.mm.md` 侧一行不动）。

## §0 基线（开工实测并报告；数字不符先报告再动手）

| 项 | 参考值（我复核时点实测） |
|---|---|
| 三包 | kernel **516** / react **1206** / canvas **195** = **1917** 全绿 |
| 门禁 | tsc ×3 = 0；depcruise **432 模块 / 1224 deps** 零违规；lint **1468 + 46**（不得上升）；budget bang **89/90**、asCast **31/31（零余量！）**、bigFiles **3/4** |
| 超 600 行 | `MindmapStage 2293` / `edgeRouting 1235` / `MapView 2230`（本批只允许 MindmapStage 接线级改动） |
| 依赖面 | `packages/react` 改源 → **react dist 需重建**（canvas 侧真浏览器/构建产物路径） |

**冻结纪律**：阈值/契约测试不得放宽；**不得新增 `as` 断言（asCast 零余量 = 一动就红）**；禁 `git add -A`；不 push；不动 `.codebuddy/`/`.workbuddy/`/`tools/graph-engine/`；新文件 <600 行。

## §1 取证（file:line 逐条核过；执行前自己复核一遍）

### 1.1 ③ 的现状：**已能看见一半，但口径不齐、且畸形项在面板无席位**

- `collectFreeEdges` 有**两个静默丢弃点**（`freeEdges.ts:224-227`）：条目非对象、`from`/`to` 非 string → `return`（无声消失）。
- R0 批已建 `edgeHealthOf`（`render/edgeHealth.ts:67-147`）：**独立扫原始数组**，对"未被 `collectFreeEdges` 产出"的下标计 `malformed` 并推入 `problems`（`:86-92`，带 `malformed: true`）；口径声明见 `:19-21`（**判定复用 `collectFreeEdges` 的丢弃谓词，不复刻第二套**——本批不得破坏这条）。
- `EdgeHealthBar`（`chrome/EdgeHealthBar.tsx`）**已呈现 malformed 明细**：`labelOf` 首判 `if (p.malformed) return '原始项非法'`（`:16`）；明细行 `第 N 条：原始项非法`（`:68-69`）。
- **但标题只报三类**（`:61-64`）：`⚠ 关系线诊断：{problems.length} 条（悬空 X / 陈旧 Y / 失效 Z）`——`problems.length` 含 malformed/自关联/未知关系/重复，括号里只有 3 类 → **总数与分项数不齐**（例：1 悬空 + 1 畸形 → "2 条（悬空 1 / 陈旧 0 / 失效 0）"，用户数不出第 2 条）。**这就是 ③ 要收的口径账**。
- **面板无席位**：关系面板 `EntityGraphPanel` 的「连线」区消费 `EdgeListItem[]`（`EntityGraphPanel.tsx:19-26、143-155`），由 `collectFreeEdges` 产物派生 → **畸形项不产生 FreeEdge → 面板看不见、也处置不了**（诊断条点了打开面板却找不到那一条）。R2-2 已通"诊断条 → 面板"（`MindmapStage.tsx:1784-1788` `onOpen={() => setPanel('relation')}`）。

### 1.2 ② 的现状：**attrs 协议层能存能往返，但 react 层零命中**——动机是"看不见"，**不是"会被抹掉"**

- 协议层 ✓：E1 起 `ResolvedLink.attrs` 存在、parse→serialize 往返无损（`docs/roadmap/2026-08-31-edge-first-relations.md:29-36`）。
- **`DocEdge` 无 `attrs`**（`freeEdges.ts:52-74`，字段：from/to/rel/dir/label/note/style/invalidAt/source/manual/routingSide）；**`FreeEdge` 亦无**（`:77-104`）。
- `collectFreeEdges` 是**显式逐字段搬运**（`freeEdges.ts:238-256` 的 `...(e.label !== undefined ? …)` 列表）→ attrs 不在列表 = **不透传**（数据仍在原始数组里，画布侧看不到而已）。
- **写路径安全（已实证）**：`patchEdgeAt` = `arr.map(e => i===index ? { ...e, ...patch } : e)`（`edgeEditorShared.tsx:70-73`）→ **spread 保未知键**；`mergeStyleAt`、`reattachEdge`（patch 单端）、`removeEdgeAt` 同理。**故本项不存在"编辑抹掉 attrs"的丢失 bug，不许把任务写成修丢失**（写错方向会做出无用的"防御"）。
- `EdgeEditor`（`chrome/EdgeEditor.tsx`）字段面：rel / dir / routingSide / label / note / style / 失效 / 删除 / 重挂 / 反向（`:5`、`:206-313`）——**attrs 无席位**；264px 紧凑卡（`:146` `clampPos(x, y, POP_WIDTH, 250)`、设计原则"placeholder 代替标签行"）→ 呈现必须克制。

### 1.3 判定/呈现的既有纪律（不得破坏）

- `edgeHealthOf` 的 `problems` 是**多标记可并列**（一个项可同时 `dangling + noBox + unknownRel`）——本批**不改这些字段语义**（R0/R2 契约），"互斥分类"是**新增的呈现层口径**。
- 诊断条"全健康不渲染"（`EdgeHealthBar.tsx:36`）与"明细最多 3 条 + 其余略"（`:65-73`）是既有契约，保持。

### 1.4 为什么 ① `cid:` 边锚不在本批（一句话证据）

`resolveAnchorToId`（`freeEdges.ts:177-200`）只有 `kind==='node'` 与实体两条分支 → **`cid:` 会掉进实体分支判 dangling**；`anchorOfNode`（`:113-145`）从不产 cid。修它 = 边的锚写入形态变更 = `.mm.md` 兼容面 + `R1-A3` 明说"须另立 ADR"→ **本批明确不做**（归"R6-大"，先出 ADR）。

## §2 任务

### R6-S1 · 诊断口径补全 + 畸形项可处置（③）

**S1a（主）· 标题口径：总数 = 各项之和**
- 在 `render/edgeHealth.ts` **加法**导出互斥分类（名如 `healthBreakdown`：`{ malformed, invalid, dangling, stale, selfAnchor, duplicate, unknownRel, healthy }`），**主分类优先级**（每项只归一档，防重复计数）：
  `malformed > invalid > dangling > stale > selfAnchor > duplicate > unknownRel`；
- `EdgeHealthBar` 标题改为消费该分类：`⚠ 关系线诊断：N 条（悬空 X / 陈旧 Y / 失效 Z / 原始项非法 W / 自关联 V / 重复 U / 未知关系 T）`——**零类目省略**（避免一行过长：仅渲染非零项；全零类不出现）。**验收判据（要测试钉死）**：`malformed+invalid+dangling+stale+selfAnchor+duplicate+unknownRel === health.problems.length`，且标题括号内数字之和 === `problems.length`。
- **不许改** `EdgeHealth` 既有字段（`byState`/`invalid`/`malformed`/…）的语义；分类是新增纯函数（可测；接受 `EdgeHealth` 输入）。

**S1b（次）· 畸形项"可定位 → 可处置"**：关系面板 `EntityGraphPanel` 的连线区为畸形项补行（`第 N 条 · 原始项非法` + 「删除」按钮），删除走既有写路径（宿主 `writeEdges` + `removeEdgeAt`）。
- 类型加法（不得破坏既有 `EdgeListItem`）：新增可选 prop（如 `malformedRows?: readonly number[]`）由宿主从 `edgeHealthOf(root).problems` 过滤 `malformed` 派生——**面板不自己扫原始数组**（口径单一来源）。
- 判据：删除后 `edgeHealthOf(root).malformed === 0` 且诊断条在无其它问题时消失；`data-edge-section` 计数同步。
- **兜底（受阻即降级，不算失败）**：若面板类型/接线面超预期（>600 行或宿主改动 >15 行/处），**只交 S1a**，把 S1b 写进报告"未完成半边 + 卡点"，不得为凑数放宽判据。

### R6-S2 · attrs 链路透传 + 只读呈现 + 保真钉（②）

- **S2a 透传**：`DocEdge` / `FreeEdge` **加法** `attrs?: Record<string, unknown>`；`collectFreeEdges` 按既有 `...(e.attrs !== undefined ? { attrs: e.attrs } : {})` 口径透传（`:247-254` 同款），**非对象/数组值 → 不视为 attrs**（守卫，不许 `as`）。
- **S2b 只读呈现**：`EdgeEditor` 在 `style` 行下方加**只读**属性区（264px 约束）：`属性 N 项` + 最多 2 行 `k = v`（值 `String(v)`，超长省略），`title` 给全量。**不提供编辑**（JSON/键值编辑器属 UX 题，另议）。无 attrs → 不渲染该区（既有布局零变化）。
- **S2c 保真钉（本项核心判据，先红后绿）**：
  1. `collectFreeEdges` 透传：含 attrs 的 `DocEdge` → `FreeEdge.attrs` **引用相等**；
  2. **patch 保真**：`patchEdgeAt(原数组, i, { label: 'x' })` 后该条目 **attrs 原样在**（防未来有人改成"从 FreeEdge 重建 DocEdge"——本钉故意钉住写路径的 spread 语义）；
  3. **渲染**：`EdgeEditor` 渲染含 attrs 的边 → 属性区出现且含键名；无 attrs → 不出现；
  4. **协议往返（不新增代码，补钉）**：含 attrs 的 `edges` 数组 parse→serialize→parse 覆盖（若 E1 golden 已覆盖则引用其位置并补 edges 面一例）。
- **不做**：attrs 编辑、attrs 影响视觉（rel 语义/样式仍由 rel+style 决定）。

### R6-S3 · 收口

- `CHANGELOG.md` **顶部**追加 `[1.8.16]` 段（触发 / S1 / S2 / 验收 / 偏差；**位序必须最新在上**——F5 刚修过这个坑）。
- 报告 `outputs/2026-09-14-r6-attrs-diagnostics-report.md`：逐任务 commit + 红/绿原文 + 分类判据实测 + attrs 四钉 + 三包/门禁原样 + 降级说明（若 S1b 未做完）。
- 门禁复跑（tsc ×3、dist 重建、depcruise、lint **1468+46 不得上升**、budget、三包）；定向清理 tmp；`git status --short` 应仅 `?? tools/graph-engine/`。
- **然后停**：不 push（复核通过后另行授权）。

## §3 决策点（按推荐执行，不停下来问）

| # | 决策点 | 推荐 |
|---|---|---|
| R6-A1 | 诊断条口径 | **互斥主分类 + 总数=各项之和**（不是"多标并列"）；非零类目才显示 |
| R6-A2 | 分类落点 | `render/edgeHealth.ts` 加法导出（纯函数、可测）；**不内联在 bar 里** |
| R6-A3 | 畸形项处置 | S1b 面板加行 + 删除（复用 `removeEdgeAt`）；受阻走 §2 兜底降级 |
| R6-A4 | attrs 呈现 | **只读**；最多 2 行 + title 全量；不编辑 |
| R6-A5 | attrs 守卫 | `typeof v === 'object' && v !== null && !Array.isArray(v)`；**禁 `as`**（asCast 零余量） |
| R6-A6 | 协议改动 | **零改动**（`.mm.md` parse/serialize/ADR 一行不碰）；cid 归后续 ADR |
| R6-A7 | CHANGELOG 号位 | `[1.8.16]`，插在 `[1.8.15]` **之上** |
| R6-A8 | push | 不 push |

## §4 风险

1. **口径改动的回归风险**：`EdgeHealthBar` 既有测试断言文案含 `（悬空 X / 陈旧 Y / 失效 Z）`——口径变更**必然改断言**，须在 commit message 逐条列"旧断言 → 新断言 + 为什么不是放宽"（比照 R5-1 的做法）；`edge-health.test.ts` 的计数语义**不得动**。
2. **面板改造面**（S1b）：`EntityGraphPanel` 有既有测试与 `data-*` 契约 → 加法优先；若被迫改既有行结构，视为契约变更并在报告列明。
3. **紧凑卡被撑爆**：264px 卡 + attrs 区 → 只读 2 行 + 省略；实测长值（>200 字符）不得换行爆版。
4. **asCast 零余量**：任何 `as` 都会让 budget 红 → 守卫一律写显式类型收窄。
5. **attrs 值的渲染安全**：`String(v)` 不做 HTML 注入面（React 转义 ✓）；对象值显示 `[object Object]` 可接受，**不展开**（防深递归）。

## §5 报告格式

- 逐任务：commit hash + 改动文件 + **红/绿断言原文** + 新增用例数。
- S1：分类判据实测（总数=各项之和的断言原文）+ 标题文案终稿 + S1b 完成/降级说明。
- S2：attrs 四钉原文 + `EdgeEditor` 呈现截图或 DOM 断言 + 写路径保真证据。
- S3：三包/门禁/budget 原样输出 + `git status --short`。
- 偏差与原因；然后停，等复核与 push 授权。
