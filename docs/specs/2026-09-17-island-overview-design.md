# ISLAND-OVERVIEW · 岛级远观总览（语义缩放）设计

> 状态：主控拍板口径，供外派。日期：2026-09-17。  
> 动机：远观 `k` 过低时节点字 / Section 世界字号均不可读，全局探索失效；用户要 **project-graph 式鸟瞰**，且**用好升格岛**。  
> 关联：既有 `lodFor` / note LOD / Section Phase1 §4.4；NEST-CONTAIN（框并集）；**非** free-canvas LOD、**非**① free-edge zoom 重路由。

---

## 1. 问题与目标

| 现状 | 目标 |
|---|---|
| `lodFor` → `skeleton` 省略节点文本；Section 标题 `fontSize=13` 世界缩放 → `k≈0.15` 糊掉 | 远观仍能读出「有哪些岛、叫什么、大致多大、岛间如何连」 |
| 岛数据已齐（members / Section title / boundaryLinks / nest）但未升格为鸟瞰卡 | **岛 = 远观地标**：一岛一卡 + 岛间梁；点卡可聚焦进岛 |

**非目标（本设计不承诺）**

- 另起 Canvas2D / 独立 project-graph 渲染器  
- 改 `.mm.md` 协议或持久化新字段  
- 缩放时自动写入 `collapsedIds`  
- free-canvas 包的 LOD（另轨）  
- ① freeEdges 缩放审美重路由  
- 无中心单树的「假岛」聚类

---

## 2. 既有资产（复用，不重造）

| 资产 | 用途 |
|---|---|
| `buildIslandView` → `membersByRoot` / `boundaryLinks` / `nestedCenterIdsByRoot` | 岛枚举、梁、嵌套徽章 |
| `sectionFrames` / `SectionLayer` | 标题 / 色 / `memberCount` / AABB（含 nest-contain 并集） |
| `lodFor` + B-P3 手势冻结 | 档位与跨阈不抖 |
| `noteLodFor`（`NOTE_LOD_BADGE_K=0.35`） | 远观阈值对齐参考 |
| Section ghost chip 的 `1/k` 屏稳尺寸 | 标题可读的既有技巧 |
| `centerIds` + `onCenterMove` / nest-contain 跟移 | 总览卡拖动仍走中心管线 |

PG 调研结论可借：远观以 **Section/岛大标题** 承载信息密度，而不是硬撑节点字（`docs/2026-09-05-project-graph-调研与减法设计.md`）。

---

## 3. 口径（禁止再议）

| # | 裁决 |
|---|---|
| **D1 触发** | `k < K_OVERVIEW`（定值 **0.35**）进入岛总览；与 note「badge 以下」同带。手势缩放期间 **冻结**（沿用 B-P3），松手再切一次。 |
| **D2 无中心文档** | 无 `centerIds` / 空岛表 → **不进入**岛总览（保持既有 skeleton）。 |
| **D3 卡内容** | 每岛一张卡：标题 = Section.title（若该中心有 Section）否则中心节点文本；角标 = 本岛 `memberCount`；可选第二角标 = 嵌套中心数（`nestedCenterIdsByRoot`）。色条 = Section.color，无则中性。 |
| **D4 几何** | 卡的世界外包 = 该中心 Section AABB（有 Section）或 `containedMemberIds` 成员盒并集（无 Section 时同公式外扩）。标题字号 / 最小卡高 **屏稳**：关键尺寸 × `1/k`（与 ghost chip 同思路），保证 `k∈[ZOOM_MIN, K_OVERVIEW)` 可读。 |
| **D5 隐藏什么** | 总览开启时：**不画**岛内成员 NodeG（含中心本体卡）与**岛内**树边；**仍画** `boundaryLinks`（岛间父链）与自由边（若端点落在岛上，端盒改用卡 bounds——PROBE 可先：端点仍用原盒，允许略偏）。 |
| **D6 嵌套岛（PROBE）** | 子孙岛 **不单独出卡**，只在祖先卡上显示嵌套数角标；AABB 已含子孙（nest-contain）。产品后续可加「嵌套迷你卡」——本批不做。 |
| **D7 切断岛** | `detached` 岛有独立卡（不并进上级角标链以外的包容——与 nest-contain 一致：不进上级 nested 表）。 |
| **D8 交互（PROBE）** | 卡命中 = 选中该中心（或所属 Section）；标题带拖拽 = 既有 center 拖（跟移子孙）。**双击或显式「聚焦」** → `fitBounds(岛 AABB)` 放大（PROBE 至少实现其一）。总览档 **禁止** 新建连线 / 升格菜单依赖「点到叶子」——点空白仍 pan。 |
| **D9 折叠** | 总览 **绝不** 写入 `collapsedIds`。与 Section 折叠钮无关。 |
| **D10 与 Section 壳** | 总览开启时：既有 Section 标题栏可 **并入总览卡**（避免双层字）；无 Section 的中心只画总览卡。 |
| **D11 协议** | **零协议改动**。可选在协议 §6.3/§6.4 旁注一句「渲染层远观岛卡」——非必须，PROBE 可省略。 |

---

## 4. 架构

```
viewport.k  ──► overviewActive = (k < 0.35) && hasIslands
                    │  （zoom 手势冻结沿用 lodFreeze）
                    ▼
         buildIslandOverviewCards(islandView, sectionViews, boxes)
                    │
                    ├─ cards[]: { rootId, title, color?, memberCount, nestedCount, bounds }
                    ▼
         MapView 渲染分支
                    ├─ overviewActive: IslandOverviewLayer + boundaryLinks
                    │                 skip member NodeG / intra-island tree links
                    └─ !overviewActive: 既有路径（LOD / SectionLayer 照旧）
```

### 4.1 纯函数模块（建议）

新建 `packages/react/src/render/islandOverview.ts`：

- `K_OVERVIEW = 0.35`  
- `overviewActive(k, hasIslands, frozenK?)`  
- `buildIslandOverviewCards(...)` → 只读 VM  
- `screenStableFontSize(basePx, k, minPx, maxPx)` 或等价钳制

从 `@mindcanvas/react` 导出纯函数（若仓库惯例要求）；UI 层可放 `IslandOverviewLayer.tsx`。

### 4.2 MapView 接线

- 计算 `overviewActive`（与 `lodLive` 并列；总览时可仍处 skeleton，但以 overview 分支为准）。  
- `overviewActive` 时：成员 id ∈ 任一岛 `membersByRoot`（及 nest 并集）→ 跳过 NodeG；岛内 link 跳过；挂载 `IslandOverviewLayer`。  
- `boundaryLinks` 保留。  
- Stage **尽量零改**（数据已注入）；聚焦 API 若需 `viewport.fitBounds`，在 MapView 内闭环或新增可选 `onIslandFocus?(rootId)`。

### 4.3 视觉（PROBE 最低）

- 圆角矩形 + 左边色条 + 标题（单行省略）+ 右上角数字徽章。  
- 选中描边与 Section 选中同级。  
- **不要** 做成仪表盘多卡堆叠或紫渐变装饰；跟现有 Section 色板。

---

## 5. 分期

| 阶段 | 代号 | 交付 | 估计 |
|---|---|---|---|
| **PROBE** | **IO-1** | 纯渲染总览卡 + 藏成员 + 保梁；屏稳标题；选中/拖中心；一种聚焦；单元测 | ✅ 已验收 |
| **嵌套地标** | **IO-2** | 父卡内**一级迷你子卡**；点选/双击聚焦/拖=拖子；钳制在父内；见 §9 | ✅ 已验收 |
| **视觉** | **IO-UX** | 总览卡实底/实线/标题带/胶囊角标（`IslandOverviewLayer`） | ✅ 已落地（工作树，待随 IO 批入库） |
| **产品打磨** | **IO-2b / FE-FRAME-1** | 自由边贴 Section 框 + 远观贴卡（见 `2026-09-17-free-edge-frame-anchor-design.md`） | **下一批外派**（开工令已备） |
| **体验增强** | **IO-3** | 远观小地图、岛目录侧栏、进出淡入淡出、迷你排布（R4） | 另开 |

**IO-1 / IO-2 / IO-UX 已验收。下一外派 = FE-FRAME-1（含原 IO-2b）。**  
**P0 先于任何新开发：按批 commit（禁止 `git add -A`）。**

---

## 6. 测试计划（IO-1）

| 测 | 断言 |
|---|---|
| `island-overview.test.ts` | `k≥0.35` → inactive；`k<0.35` + 有岛 → active；无岛 → inactive |
| 同上 | 卡标题优先 Section.title；否则中心文本；`memberCount` / `nestedCount` |
| 同上 | bounds 覆盖 nested 成员（nest-contain 并集） |
| MapView 集成（可选易接） | overview 下成员 `data-node-id` 不出现；overview 卡 `data-island-overview` 存在；boundary link path 仍在 |

不要求全包 vitest；不要求 Stage E2E。

---

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 阈附近抖动 | B-P3 冻结；进出可加 1 帧迟滞（PROBE 可不做迟滞） |
| 嵌套叠板 | PROBE 子孙不出卡（D6） |
| 命中过小 | 屏稳最小高度（D4） |
| 与 Section 双壳 | D10 合并 |
| 误写 collapse | D9 禁令 + code review |
| 性能 | 总览应 **减少** DOM；禁止在 overview 分支仍挂全量 NodeG |

---

## 8. 成功标准（IO-1）

1. 多岛文档缩到 `k<0.35`：可读岛名 + 计数，岛内细节消失。  
2. 岛间 `parent_link` 梁仍可见。  
3. 拖总览卡 = 拖该中心（子孙跟移若 nest-contain 已在）。  
4. 一种聚焦进岛路径可用。  
5. 放大回 `k≥0.35`：恢复既有节点/Section 渲染，无残留总览层。  
6. 相关 vitest 绿；零协议强制改动。

---

## 9. IO-2 · 嵌套迷你卡（子岛地标）

> 用户摩擦：IO-1 远观只见父卡 + `⊞ N`，**子岛空间关系不可见**（截图像「田」块那种父内子框缺失）。  
> IO-1 D6「子孙不出独立顶层卡」**仍然有效**；本批是在**父卡内部**画一级迷你卡，不是恢复顶层双子卡。

### 9.1 口径（禁止再议）

| # | 裁决 |
|---|---|
| **N1 层级** | 仅 **一级**迷你卡：顶层总览卡内，对 `nestedCenterIdsByRoot.get(parentId)` 的每个**直接**子孙画一张迷你卡。迷你卡自身若还有更深嵌套 → **只显示 `⊞` 角标**，不再递归画迷你（防叠板/爆炸）。 |
| **N2 仍不出顶层卡** | 子孙中心 **继续**从顶层 `buildIslandOverviewCards` 根集合剔除（IO-1 D6 保留）。迷你卡是父卡的子元素，不是第二张顶层卡。 |
| **N3 迷你几何** | bounds = 该子孙自身 `islandOverviewMemberIdsOf(child)` 的 `overviewBoundsOf`（**不含**再并父岛成员）。世界坐标落在父 AABB 内（nest-contain 已保证成员盒在父框内；若屏稳最小尺寸撑破父卡，**钳在父卡内边距内**，可略缩小字号，禁止画到父卡外）。 |
| **N4 外观** | 迷你卡：更小屏稳下限（建议约 `72×28` px）、细色条、单行标题、成员小数角标；可选左侧色 = 子 Section 色否则中性。`data-island-overview-nested={childId}` + `data-parent-island={parentId}`。 |
| **N5 交互** | 单击迷你 = 选中该**子**中心；双击 = `fitBounds` 聚焦该子岛；标题带拖 = `onTitlePointerDown(childId)`（拖子、父不动——与 nest-contain「拖子不反向」一致）。点父卡空白区仍选父。事件 `stopPropagation` 防冒泡到父卡。 |
| **N6 角标** | 父卡保留 `⊞ nestedCount`（总览计数仍有用）；与迷你卡并存不冲突。 |
| **N7 切断** | `detached` 不在上级 nested 表 → 仍是顶层卡，无「嵌进父卡」的迷你。 |
| **N8 不做** | 自由边端点改卡盒（IO-2b）；改协议；写 collapsed；改 `K_OVERVIEW`；改 `layoutForest` / ① zoom 边。 |

### 9.2 实现落点

- `islandOverview.ts`：扩展卡 VM，例如  
  `IslandOverviewCard.nestedCards?: readonly IslandOverviewCard[]`  
  （迷你复用同结构，但 `nestedCards` 恒空 / 不填，只带 `nestedCount`）。  
  或并行 `buildNestedMiniCards(parentId, …)` 由图层拼装——二选一，**单一出口**建 VM。
- `IslandOverviewLayer`：在父 `CardView` 内映射 `nestedCards`；命中/拖/聚焦接 N5。
- MapView：隐藏集**不变**（子孙成员本就在父 contained 集内）；选中态支持子 rootId；拖/聚焦已有入口，确认传 childId。
- 测试：纯函数「父有 C → 顶层无 C 卡、父.nestedCards 含 C」；bounds 在父内；集成测 `data-island-overview-nested` 出现、拖子 `onCenterMove` 目标为子 id。

### 9.3 成功标准（IO-2）

1. 远观下父岛内可见直接子岛迷你卡（标题可读）。  
2. 顶层仍无子孙独立大卡（D6）。  
3. 双击迷你 → 聚焦子岛并越阈退出总览（或至少 k 上升）。  
4. 拖迷你标题 → 只动子中心坐标（父不动）。  
5. 相关 vitest 绿；零协议改动。
