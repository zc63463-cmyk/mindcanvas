# R5 派遣计划：渲染一致性（跳线折线化 / z-order / Canvas 降级提示）

- **日期**：2026-09-13
- **起点 HEAD**：`843ae30`（批次 E 编辑流保全 + 方向键几何导航 + 空白区交互裁决均已收口）
- **出处**：R2/R3/R4 三份计划的「明确不做（本批）」均写「跳线折线化与 z-order（R5）」「Canvas 降级提示（以上归 R2–R6）」；R4 报告尾句同款。**本计划即该项的展开**。
- **批次代号**：R5-1 … R5-4（逐个提交，做完停下报告）

---

## §0 基线（动手前自己复核一遍；数字不符先报告，不要硬开工）

| 项 | 值（2026-09-13 实测） |
|---|---|
| 三包测试 | kernel **480** / react **1110** / canvas **179** = **1769** 全绿 |
| 门禁 | tsc ×3 = 0；react dist 重建 = 0（本批改 react 源 → 必须重建）；depcruise = 0（409 modules / 1152 deps）；lint = **1468 warnings + 46 infos**（水位不得上升） |
| 预算 | bang **89/90** ↓1 · asCast **31/31** · console 4/4 · todo 1/1 · defaultExport 2/2 · bigFiles **3/4** ↓1 |
| 超 600 行 | `MindmapStage.tsx` **2249** / `edgeRouting.ts` **1213** / `MapView.tsx` **2112**（MapView 本批预计 +30~60；不得新增其它超限文件，新文件一律 <600） |
| 冻结纪律 | 不放宽任何阈值/契约测试；**断言口径变更**（本批**必然发生**，见 §1.5 第 1 条）必须逐条列明并说明"为什么不是放宽"；禁 `git add -A`；不 push；不动 `.codebuddy/` 与 `tools/graph-engine/` |

**DoD（每任务）**：① TDD 红→绿且**红证据贴原文**；② 每任务一条 commit（中文 `类型(范围): 摘要`）；③ 范围外的文件不动；④ 报告数字**贴工具原样输出**；⑤ 全部做完停下等放行。

---

## §1 取证（写稿时逐条核过，含 file:line；执行前请自行复核一遍）

### 1.1 跳线（Line jumps）现状

| 项 | 事实 |
|---|---|
| 生成器 | `pathWithJumps(pts, jumpPoints, radius=5)` —— `edgeRouting.ts:756-830`。**主体是 `M … L …` 折线**，跳线处在交叉点前后各留 `r` 距离，用**三次贝塞尔 `C`** 拱起（控制点沿法向 `(-uy,ux)` 外推 `r*1.3`）→ 产出**混合形态 M/L/C** |
| 作用域 | `applyLineJumps`（`:619-645`）**只被 `FreeEdgeLayer` 调用**（`:228-231`），输入是**自由边之间**的交叉（`routedPolylines` 只累积自由边路由结果）→ **树线既不生弧也不收弧** |
| 门控 | `fastRouting`（动画/瞬态）跳过交叉检测与跳线：`FreeEdgeLayer:104-107 / 224-231` |
| 失效边 | R4-3②：失效边从跳线输入集**剔除**后再合并回原条目（`:226-231`）——不变量，不得被重构吃掉 |
| 零拷贝 | 无交叉 → 返回**原 map 引用**（`:622/626`，有测试钉） |

**既有测试把 `C` 当判据（这就是"折线化"要动的地方）**：
- `packages/react/tests/edge-routing.test.ts:355-367`：`pathWithJumps(pts,[{x:50,y:0}],5)` → `expect(jumped).toContain('C')`
- 同文件 `:597-609`（R3-2）：夹具前提 `expect(bowUp).toContain('C'); // 夹具确有跳线弧（多段路径）`
- `packages/react/tests/edge-routing-fast.test.ts:82-92`：`expect(d0).toMatch(/C /)`（under 加拱弧）**且** `expect(d1).not.toMatch(/C /)`（over 不加）
- 夹具消费者：`packages/react/tests/edge-editor.test.tsx:546-590`（用 `pathWithJumps` 输出喂 `inferBowSide`）

**下游对混合形态的特判**：`inferBowSide` 的「多段路径」分支（`edgeRouting.ts:536-560`，注释明确写「跳线 d = M…L…C 拱弧…L…」）+ `onPathPointsOf` 的 `C` 索引特判（`:562-577`）。

### 1.2 z-order 现状（画布变换 `<g>` 内；数组顺序 = 绘制顺序，后绘者在上）

| # | 层 | 位置 | Canvas 模式 |
|---|---|---|---|
| 1 | Section 框（背景层，永在最底） | `MapView.tsx:1481-1501` | 不渲染 |
| 2 | 树线（含 hub 箭头、`<title>`、**标注 chip** `data-tree-edge-label`） | `:1502-1615`（标签 `:1573-1585`） | 线/箭头渲染（`sceneBuilder:119-139`），**标签无** |
| 3 | 跨岛父子连线 boundaryLinks | `:1616-1646` | 不渲染（`:1619` 注释） |
| 4 | 自由边（命中区 + path + ghost 点 + **`EdgeLabel`**） | `:1648-1672`（标签 `FreeEdgeLayer.tsx:411-420`） | 不渲染（`:1647` 注释） |
| 5 | 节点（含 **note 角标** `data-note-badge`） | `:1674-1762`（角标 `:1750-1758`） | 卡片/文本/折叠计数渲染（`sceneBuilder:62-111`），**角标无** |
| 6 | 淡出 ghost 节点（M5-T2） | `:1763-1798` | — |
| 7 | 拖拽浮空克隆 | `:1799-` | — |

`</svg>` 在 `:1959`；其后是**屏幕空间 HTML 浮层**（与后端无关，两种模式都在）：`NodeTextOverlay`(`:1962`)、`DescOverlays`/`ExpandCommentOverlay`、`NotePopover` 预览态(`:2022`)与固定卡片(`:2028`)、drop preview(`:2052`，`zIndex:90`)。

**已确认的问题（本批要修的）**：两处 `EdgeLabel` 渲染点都在**节点层之下** → 标签落到节点盒范围时被节点**遮挡**（树线标签同理）。

### 1.3 Canvas 降级现状

- 阈值 `CANVAS_AUTO_NODES = 50000`（`sceneBuilder.ts:21`）；裁决 `resolveBackend`（`:30-37`）；调用点 `MapView.tsx:974`。**注意**：传入的是 `layout.nodes.length` = **折叠裁剪后的可见节点数** → 用户**折叠分支即可跌回阈值以下**自动恢复 SVG（这句要进用户提示文案）。
- 宿主门禁（`MindmapStage.tsx:1052-1056`）：文档含**中心岛**或**自由边** → 显式 `forceBackend='svg'` 压过自动降级。→ **自动降级在实践中只发生在纯树文档 >50000 可见节点**。
- **静默损失清单**（自动降级场景，**实测确认项**见 §2.3 任务）：
  1. 树线**标注 chip**（`data-tree-edge-label`）—— SVG 专属
  2. 节点 **note 角标**（`data-note-badge`）—— `sceneBuilder.nodeScene` 只有 rect + 文本 + 折叠计数
  3. 跨岛父子连线、4. 自由边、5. Section 框 —— 属"显式 canvas"场景（自动降级时它们本会强制 SVG）
  - **不丢**：note 卡片与编辑浮层（HTML 浮层）、选中态描边、分支色、hub 共享梁/箭头（`sceneBuilder:117-139` 实测在）
- **用户零感知**：全仓无任何降级提示。

### 1.4 通知与统计通道现状

- `MapStats`（`MapView.tsx:278-285`）= `{epoch,totalNodes,visibleNodes,visibleLinks,lod,viewMs}`，**无 backend 字段**。
- B-P3 节流上报（`:1126-1153`）：**材料字段** = `totalNodes/visibleNodes/visibleLinks/lod`（`viewMs` 仅随载荷携带，不作触发条件）。
- 消费点：`PerfPanel`（`MindmapStage:1646` 常显）；告警通道 `commandNotice`（声明 `:200`、展示 `:1649-1672`、4s 自动消退 `:946-950`、调用例：`setCommandNotice` 共 10+ 处）。

### 1.5 七个坑（踩了会静默失效或返工）

1. **断言口径变更 ≠ 放宽，但必须写成判别式**：R5-1 后跳线路径不再含 `C`，于是 `edge-routing-fast.test.ts:91` 的 `expect(d1).not.toMatch(/C /)`（over 边不画跳线）**会退化成恒真**——该负例将静默失去判别力。**必须换成语义等价判据**（见 §2.1），否则等于自己把守卫删了。
2. **`inferBowSide` 的 C 分支不能删**：`manualBezier` 仍产纯 `C` 路径（走分支①）；折线化只让**跳线**落进分支②。`onPathPointsOf` 的 C 特判同上（注释要改准，不要顺手删）。
3. **`fastRouting` 门控零影响**：只改几何生成，不碰门控条件（`FreeEdgeLayer:224-228`）。
4. **R4-3② 不变量**：`inactiveKeys` 的「剔除 → 合并回原条目」路径（`FreeEdgeLayer:226-231`）必须原样保留。
5. **命中区不得随标签上提**：自由边的透明宽描边命中区（`FreeEdgeLayer:364+`）负责拦点击/阻断 pan；它若跟标签一起搬到节点层之上 → **抢节点点击**（回归）。
6. **`EdgeLabel` 空文本守卫**：`text === ''` → 不渲染胶囊（`FreeEdgeLayer:349-351` 与本组件内部双保险）——上提后仍须成立。
7. **jsdom 读层序的方法**：`container.querySelector('svg > g')` 的子元素顺序 = 绘制顺序；**先给每层加 `data-layer="…"` 标记再断言**（按下标断言太脆，且会与 Section 有无渲染纠缠）。

---

## §2 任务（R5-1 → R5-4，逐个提交）

### R5-1 · 跳线折线化（`pathWithJumps` 去 `C`）

**目标**：跳线 hop 由贝塞尔弧改为**折线跳**，使边路径**只含 `M/L`**（单几何形态贯穿路由 → 渲染 → 判定 → 导出）。

**不变量（逐条钉）**：跳线点位置与「哪条在上/下」判定不变；`radius` 默认 5 与语义（前后各留 `r`）不变；`t ≤ 0.02 / ≥ 0.98` 忽略；「跳线点离路径 > `max(1.5, radius)` 忽略」；无跳线点 → 纯折线（`M 0 0 L 100 0`）；无交叉 → `applyLineJumps` 返回原 map 引用；`fastRouting` 门控与失效边剔除路径不动。

**判别测试（先红）**
1. 新增：`pathWithJumps([{0,0},{100,0}], [{50,0}], 5)` → **`expect(d).not.toContain('C')`**、顶点数 = 原顶点数 + 2（抬升/落回各 1 点 + 平台两端，按实现定，**必须在测试里写死具体数字**）、首尾 `M 0 0` / `L 100 0` 不变；`radius` 生效（抬升高度 = `radius`）。
2. **三处既有 `C` 判据改为语义等价折线判据**（逐条在 commit message 列明"口径变更 + 不是放宽"）：
   - `edge-routing.test.ts:355-367`：`toContain('C')` → 折线跳判据（不含 C + 顶点数增加）
   - 同文件 `:597-609`：夹具断言 → 改为"确有多段折线（顶点 ≥ 4）"，`inferBowSide` 期望值**不变**
   - `edge-routing-fast.test.ts:82-92`：**这是最关键的一条** —— `d0` 的 `toMatch(/C /)` → 折线判据；`d1` 的 `not.toMatch(/C /)` → 换成「`d1` 未加跳线」的等价判据（例如 `d1` 的 `d` 与输入 `points` 直出折线逐字相等 / 顶点数未增加），**不得保留恒真断言**
3. `edge-editor.test.tsx:546-590` 的 `inferBowSide` 夹具：保持期望结论（left/right）不变，夹具随之改（若该文件被迫修改，按 R3 先例逐条列明）。

**视觉验收（真浏览器）**：`tools/verify-*.mjs` 产出 before/after 截图（`verify-shots/r5-jump-*.png`）：跳线应清晰可辨、**不像断点**、与折线主体风格一致。若形似断点 → 调 hop 几何（抬升高度/斜边比例），**不得**改 `radius` 默认值语义。

**commit**：`refactor(react): 跳线折线化——pathWithJumps 去贝塞尔弧，边路径统一 M/L`

### R5-2 · z-order 契约化 + 边标签层上提

**目标**：① 把层序固化成**显式契约**（每层 `data-layer` 标记 + 顺序判别测试）② 修掉"边标签被节点遮挡"。

**实现（推荐路径）**
- 新增**标签层**：把两处 `EdgeLabel`（树线 `MapView:1573-1585`、自由边 `FreeEdgeLayer:411-420`）的渲染收集到一个层，插在**节点层之后、ghost 层之前**。树线标签可直接搬；自由边标签需 `FreeEdgeLayer` 通过回调/收集器把（边 key、label、锚点、stroke、muted）交给宿主层渲染 —— **命中区与 path 留在原层**（§1.5 第 5 条）。
- 层序契约注释写在 `MapView` 渲染块开头（含"为什么"：标签是信息层，被节点盖住即失效；命中区是交互层，必须在节点之下防抢点击）。

**判别测试（先红）**
1. jsdom：渲染含（树线标注 + 自由边标签 + 节点）的夹具 → 断言 `svg > g` 子元素顺序满足契约（`data-layer` 序列），且**标签层的 EdgeLabel 数量 = 树线标注数 + 自由边标签数**（数量不因搬层而变）。
2. 反例钉：命中区（宽透明描边）仍在节点层之下（顺序断言），保证"标签上提不带走命中区"。
3. 空文本守卫回归：`label` 为空 + `rel` 为空 → 标签层不产出胶囊。

**commit**：`fix(react): 边标签层上提到节点之上（修遮挡）+ 层序契约与判别测试`

### R5-3 · Canvas 降级提示（+ 后端可见性）

**目标**：自动降级发生时用户**立刻可感知**，且知道怎么回到完整渲染。

**实现**
1. `MapStats` 增 `backend: 'svg' | 'canvas'`（`MapView.tsx:278-285`），并**并入材料字段**（`:1136-1141` 的 `differs`）→ 后端变化必然触发一次上报（节流窗口内会补报）。
2. `MindmapStage` 一条 effect：`stats?.backend === 'canvas'` 且**本次文档尚未提示过**（`useRef` 记忆，切换文档时重置）→ `setCommandNotice(文案)`。
3. `PerfPanel` 加一行显示后端（零成本诊断可见）。
4. **文案必须写准**（只列实测确认的损失项）：
   > 已进入大图模式（Canvas）：为保住帧率，**边标签与注释角标**暂不渲染（可见节点 > 5 万自动切换）。**折叠部分分支**可回到完整渲染。

**判别测试（先红）**
1. `MapStats` 契约：`forceBackend='canvas'` 渲染 → `onStats` 载荷含 `backend:'canvas'`；`forceBackend='svg'` → `'svg'`。（注意既有 stats 断言若用全等匹配需逐条列明。）
2. 宿主 effect：mock stats 序列 `svg → canvas → canvas（同文档重复上报）` → `setCommandNotice` **恰好 1 次**；切文档后再进入 canvas → 再提示 1 次。
3. **损失清单实测核对（DoD 项）**：同一夹具分别以 `forceBackend='svg'` / `'canvas'` 渲染，diff 两侧 DOM/场景 primitive，把 `data-tree-edge-label` / `data-note-badge` 的实际数量变化贴进报告（**不许只写"我认为"**）。若发现清单与 §1.3 不符 → 报告里改正，并以实测为准写文案。
4. （可选强化，超时即弃并在报告写明）真浏览器：mock 句柄打开 >50000 节点纯树文档 → 截图告警条出现。（生成大文档字符串即可；若布局/渲染超时则放弃本条。）

**commit**：`feat(react,canvas): Canvas 降级提示（MapStats.backend + 命令告警条 + PerfPanel 后端行）`

### R5-4 · 收口

- `CHANGELOG.md` 追加 `[1.8.11]` 段（三段：跳线折线化 / 标签层与层序契约 / Canvas 降级提示；含断言口径变更清单与截图路径）。
- 截图/证据留档（`verify-shots/`）+ 报告（逐任务 commit / 分包测试数 / 门禁预算 / 偏差）。
- **最后停下**，等放行 R6（`attrs` / `cid:` 锚对齐）。

---

## §3 决策点（按推荐执行，不必等确认）

| # | 决策点 | 推荐 |
|---|---|---|
| **R5-A1** | 折线跳的形状 | **梯形 hop**：沿路径 `enter` → 法向抬起 `radius` → 沿路径走完 `2r` → 落回 `exit`（+2 个顶点，抬升高度 = `radius`，语义与旧弧一致） |
| **R5-A2** | 是否让树线也参与跳线（生弧/收弧） | **不做**（树线几何非折线、且要扩 `routedPolylines` 输入集，性能与语义另议）——本批只统一跳线**形态** |
| **R5-A3** | 标签层位置 | 节点层之上、HTML 浮层之下；命中区留在原层（§1.5 第 5 条） |
| **R5-A4** | 降级提示去重 | `useRef` 记「本会话/本文档已提示」；**同一文档只提示一次**（避免每帧刷屏） |
| **R5-A5** | PerfPanel 加后端行 | **加**（零成本，诊断可见） |
| **R5-A6** | 是否把"含边标签的文档"纳入 forceBackend='svg' 门禁 | **不做**（>5 万节点全走 SVG 会牺牲大图性能路径——这正是 Canvas 的存在理由）；用**提示 + 可操作建议**（折叠回到阈值下）替代 |
| **R5-A7** | 真浏览器验证范围 | 跳线（R5-1）与层序（R5-2）走真浏览器截图；Canvas 提示（R5-3）主验收走 jsdom + 损失清单实测，真浏览器 50K 作可选强化 |

---

## §4 风险

1. **折线 hop 形似断点** → 截图对照 + 参数调优；**不得**改 `radius=5` 的默认语义（测试钉）。
2. **断言口径变更被读成放宽** → commit message 逐条列明（先例：R3 的契约反转写法），报告里单列一节。
3. **标签上提引入新遮挡**（标签压节点文字）→ 截图对照；`EdgeLabel` 自带胶囊底色，若仍不可读则加描边（**不改层级**再退回）。
4. **`MapStats` 加字段**可能撞既有全等断言（`perf.test`/`mapview-*.test`）→ 若是加法不影响，若被迫修改逐条列明。
5. **自由边标签搬层**是本批唯一的结构性改动（跨组件收集）→ 失败兜底：只搬树线标签（R5-2 可拆两次提交），并在报告写明未完成的半边。

---

## §5 交付与报告格式

- 逐任务：commit hash + 改动文件 + 分包测试数（实测）+ 新增用例数；**红证据原文**。
- R5-1：三处断言口径变更的**逐条对照**（旧判据 → 新判据 + 为什么不是放宽）+ 截图路径。
- R5-2：层序契约测试的 `data-layer` 序列原文 + 标签数量前后一致证明。
- R5-3：损失清单**实测原文**（两侧渲染的 label/badge 数量）+ 去重行为测试结果 + 文案终稿。
- 门禁与预算实测（工具原样输出）；与计划的偏差及原因；然后停。
