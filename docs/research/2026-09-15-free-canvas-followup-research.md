# Free Canvas 跟进调研（C+1 后）：互操作 / 空间索引 / 双模式 / 近邻竞品

- 调研日期：2026-09-15（C+1 收口当日）
- 上游：`docs/2026-09-11-free-canvas-深度调研.md`（生态全景与 SDK 选型，结论仍有效）、`docs/research/2026-09-01-markvault-mindflow-analysis.md`（连线源码分析）、`docs/specs/2026-09-15-free-canvas-spec.md`（v1 规格）
- 目的：**不重复** 09-11 的「要不要引 SDK」结论，只做 C+1 已落地后的**决策增量**：① 导出互换的格式与逐字段映射；② 空间索引的可执行选型；③ 「画布 ↔ 文档」双模式的竞品对照；④ 与我们卡位重叠的新近邻。
- 数据纪律：同 09-11——所有事实标注来源与核实日期；未核实项明确写「未核实」，不做推算填充。

---

## 0. TL;DR

1. **导出互换建议锁定 JSON Canvas 1.0，且今天就能做**：官方规格只有 `nodes`/`edges` 两个数组，`.mc.canvas.json` 的字段超集可直接映射（§1.2 有逐字段表）；**两个语义坑**：z-index 由数组顺序决定（我们有显式 `zIndex` 字段，导出需排序）、`fromEnd/toEnd` 默认值不对称（默认 `none`→`arrow`，即默认带箭头）。
2. **空间索引确认走 RBush（R-tree）**：tldraw（50k★）的实现是 `SpatialIndexManager` + `RBushIndex` + 增量更新 + `_boundsEpoch` 短路（DeepWiki 2026-07 索引）；rbush 为 mourner 的 MIT 库、支持 50k 级批量加载。Excalidraw 至今 O(N) 视口遍历、修复 PR（#10514 / #11463）**均未合并**——这是「晚做要痛很久」的反面证据。
3. **双模式取向对照 AFFiNE：它是「同一棵 block 树双视图」，我们是「独立文档 + 分 Stage 挂载」**。AFFiNE 方案在「同内容双视图」上天然更强，但需要块级布局元数据与统一数据模型；我们 C+1 的取向（用户裁定 1 / D6）避免了状态互串风险，代价明确。**结论：维持现取向**，把「同内容双视图」列为未决观察项（触发条件见 §3.3）。
4. **发现两个与我们卡位重叠的近邻**：① **Frank Anaya Freeform Canvas**（Obsidian 插件，闭源未标价）：纯 Markdown 事实源 + 无限画布 + sticky ↔ mind map ↔ note 互转——**其布局元数据存哪里未公开**（「纯 Markdown 承诺」的关键缺口）；② **Noteriv**（MIT，Rust+Tauri）：Markdown 事实源 + 画布 + SM-2 闪卡（翻卡语义）——**其 Canvas 落盘格式未公开**。两者都未解决「布局信息的纯文本表达」，这是我们的真实空白位。
5. **互通标准进入「双标准」阶段**：JSON Canvas 1.0（Obsidian，2024-03，简单固定）与 **OCIF v0.7.0（OCWG，2026-03 候选推荐，节点/资源分离 + 扩展体系 + JSON Schema）** 并存，OCIF 是能力更宽的超集式设计但尚无采纳数据。**建议：先 JSON Canvas，OCIF 列入观察**（不为候选推荐标准投入实现成本）。

---

## 1. 互操作格式：JSON Canvas 1.0 规格与映射

### 1.1 JSON Canvas 1.0 官方规格（逐字段）

来源：<https://jsoncanvas.org/spec/1.0/>，发布 2024-03-11，核实 2026-09-15。

**顶层**：`nodes?: node[]`、`edges?: edge[]`（两数组均可选）。

**节点通用字段**（四种类型共用）：

| 字段 | 必填 | 语义 |
|---|---|---|
| `id` | ✅ | 唯一 ID |
| `type` | ✅ | `text` / `file` / `link` / `group` |
| `x` `y` `width` `height` | ✅ | **整数像素** |
| `color` | — | `canvasColor`：hex（`"#FF0000"`）或预设编号 `"1"`–`"6"`（红橙黄绿青紫，**具体色值规格有意不定义**，留给应用自定） |

> **z-index 规则**：节点按数组顺序**升序**（数组第一个在最底层）。这是规格里唯一的层级表达。

**四类节点专属字段**：`text` → `text`（Markdown）；`file` → `file` + `subpath?`（**始终以 `#` 开头**）；`link` → `url`；`group` → `label?` + `background?` + `backgroundStyle?`（`cover` / `ratio` / `repeat`）。

**边字段**：

| 字段 | 必填 | 语义 |
|---|---|---|
| `id` | ✅ | 唯一 ID |
| `fromNode` / `toNode` | ✅ | 端点节点 id |
| `fromSide` / `toSide` | — | `top` / `right` / `bottom` / `left`（**无 center**） |
| `fromEnd` / `toEnd` | — | `none` / `arrow`；**默认不对称：fromEnd=none，toEnd=arrow** |
| `color` | — | 同上 canvasColor |
| `label` | — | 文本标签 |

**规格未定义**（实测缺口）：坐标原点、y 轴方向、负坐标是否允许；未知字段处理规则；版本/迁移字段。→ 我们的导入侧必须**容错归一**（与 `.mm.md` 同纪律）。

### 1.2 与 `.mc.canvas.json` v1 的映射（导出/导入差异清单）

| 维度 | JSON Canvas 1.0 | mindcanvas `McCanvasDocument` v1 | 导出（我们→他们） | 导入（他们→我们） |
|---|---|---|---|---|
| 顶层 | `nodes[]` / `edges[]` | `placements[]` / `edges[]` / `viewport` / `schemaVersion` / `canvasId` / `title` | nodes ← placements；**viewport 无处安放**（建议丢弃或写自定义键，规格未定义未知字段语义，见下） | 生成新 `canvasId`；`viewport` 回默认 |
| 层级 | **数组顺序即 z-index** | 显式 `zIndex` 字段 | **导出前按 `zIndex` 升序排序 placements**（否则层级丢失/错乱） | 按数组下标反推 `zIndex = index`（或保留我们用 `zIndex` 扩展键） |
| id | `id` | `placementUuid` | 直接复用（前缀 `pl_` 不冲突） | 直接复用 |
| 文本卡 | `type:'text'` + `text`（Markdown） | `kind:'native'` + `shell:'sticky-classic'/'card-panel'` + `front: {contentKind:'plain'\|'markdown'}` + `back?` | sticky→text；**`back` 无对应字段** → 方案 A：拼进 `text`（加分隔）；方案 B：写扩展键 `back`（规格未定义未知字段，风险：他端重写丢键） | 四类节点：text→sticky 或 panel（需映射规则）、file/link/group→读取时`normalizePlacement` 丢弃（D2 既有口径） |
| 位置尺寸 | `x/y/width/height` 整数像素 | `transform.{x,y,w,h}` 数字 | 直接映射；**注意整数化**（我们允许小数，导出建议 `Math.round`） | 直接映射 |
| 边 | `fromNode`/`toNode`/`fromSide`/`toSide`/`fromEnd`/`toEnd`/`label`/`color` | `fromPlacementUuid`/`toPlacementUuid`/`fromAnchor`/`toAnchor`/`label` | 字段名直译；**我们的锚含 `center`，他们只有四边** → `center` 或缺失 → 省略（他端按默认渲染）；`toEnd` 需显式写 `'arrow'` 或接受默认 | `fromSide` → `fromAnchor`（`center` 缺省即我们默认）；`fromEnd/toEnd` 我们**无端点样式字段** → 丢弃（记账） |
| 颜色 | `color`（可选，hex 或 1–6） | **无颜色字段**（壳决定视觉） | 省略（他端用默认色），或按壳写预设（sticky→`"3"` 黄、panel→缺省） | 读取后丢弃（D2 归一） |
| 未知字段 | 规格未定义 | **逐层透传**（铁律） | 透传我们文档里的未知顶层键 → 顶部（我们的嵌套键不进 nodes） | JSON Canvas 的额外键（如 `subpath`）在节点归一后被丢弃——**建议：导入时把我们不认识的节点键挂进 `placements[i]` 的透传槽**（保住往返保真） |

**关键结论**：
- **导出**（我们 → `.canvas`）：可做，损失面 = `back`（翻面槽）、`viewport`、边锚的 `center` 语义；**必须做 placements 排序**（z-index 表达差异）。
- **导入**（`.canvas` → 我们）：可做，`file/link/group` 按 D2 丢弃（带诊断计数），text 依内容/尺寸启发式映射到两壳之一；未知键挂透传槽可保往返。
- **往返纪律**：我们的未知键透传是「同格式内」保真；跨格式往返**不可能逐字**（规格缺口 + back 无对应）——导出文件名建议 `.canvas`，并在产品文案写「导出为交换副本，事实源仍是 `.mc.canvas.json`」。

### 1.3 OCIF v0.7.0（观察项，不做实现）

来源：<https://canvasprotocol.org/>、DeepWiki `ocwg/ocif-spec`（索引 2026-03-28）。OCIF（Open Canvas Interchange Format）由 **OCWG（Open Canvas Working Group）** 维护，v0.7.0 为 **Candidate Recommendation（2026-03）**，v0.7.1-draft 开发中。

- 四概念：**Nodes**（视觉放置）/ **Resources**（内容资产，ID 引用）/ **Extensions**（形状、布局、关系等扩展）/ **Schemas**（JSON Schema 显式校验）。
- 核心结构决策：**视觉位置与内容分离**（nodes ↔ resources 以 ID 引用）——为「应用可嵌入原生数据、外部编辑后仍能还原」（round-tripping）服务。
- 关系表达比 JSON Canvas 强：edge / group / **parent-child** / **hyperedge** 均在扩展层，允许自定义。
- 与 JSON Canvas 的取舍：JSON Canvas「简单最小可用、内容内联」；OCIF「核心简单 + 扩展强大」，代价是直接可读性与实现复杂度。
- **采纳数据：未核实（页面未提供实现者名单）**。

**建议**：我们 v1 的 `placements/edges` 结构与 JSON Canvas 同构（近乎直译），而与 OCIF 的「resources 分离」模型差异大——**先做 JSON Canvas 导出**即可覆盖 Obsidian 生态；OCIF 仅列为「候选推荐阶段观察项」，等出现真实需求（某工具只收 OCIF）再评估。

---

## 2. 空间索引：tldraw 实现拆解与我们的选型

### 2.1 tldraw 的 `SpatialIndexManager`（RBush + 增量 + epoch）

来源：DeepWiki `tldraw/tldraw`「Shape Rendering and Culling」（索引 2026-07-02，提交 `c8a2902d`）；官方 docs `/sdk-features/culling`、`/sdk-features/performance`（核实 2026-09-15）。

| 机制 | 事实 | 对我们的意义 |
|---|---|---|
| 数据结构 | `RBushIndex`（**R-tree**），提供 **O(log n)** 批量空间查询 | 与我们「先补四叉树」（09-11 建议）同族；**RBush 比自造四叉树更值得**（见 2.3） |
| 增量更新 | 跟踪 `shapeHistory` / `bindingHistory` 提交记录，只对被变更的形状更新索引 | 对应我们：ops（move/add/remove）已是不可变更新，天然可增量 |
| `_boundsEpoch` 短路 | 仅 `props` 变化、**不影响几何边界**时 epoch 不变 → 下游跳过重算 | 对应我们：`patchFront/patchBack/toggleFace/zIndex` 等**不影响 transform 的 op 不应触发命中索引重建** |
| 视口查询 | `getNotVisibleShapes()`：page bounds 与视口**相交**判据；**全可见时走 Fast Path 返回空集**（不逐形状迭代） | 直接可抄：`queryVisible(viewport)` + 「全可见短路」 |
| 剔除动作 | `display:none`（**DOM 保留**，仍可命中/导出/被选中） | 对应我们 SVG：`visibility/display` 式裁剪已存在（CULL_MARGIN），语义一致 |
| `canCull` 快慢路径 | 默认 `canCull=true` 的形状**不被单独订阅**（省内存/CPU）；重写者单独订阅，代价是派生更频繁重跑 | 对应我们：不要为每张卡订阅「是否需要剔除」的逐节点条件 |
| 命令式样式 | `useQuickReactor` 把 transform/clip/size/opacity/z-index 同步到 DOM，**绕过 React 重渲染** | 与 09-11「transform-only 更新」完全同向；我们当前 `movePlacement` 每次走 React state，N 大时是热点 |
| 层叠上下文 | `.tl-canvas` 用 `contain: strict`；z-index 走 CSS 变量分层（100/150/300/500） | 可借鉴：我们的 world 层加 `contain: layout paint`（视情况） |

**禁用剔除的场景（原文档明列，值得抄进我们的规则）**：视觉效果超出形状边界（glow/阴影溢出）、需要测量自身 DOM 才能定尺寸、需要在屏外继续运行动画。→ 我们的卡片有 `boxShadow`/`outline` 溢出风险，剔除判定应使用**外扩 margin**（我们已有 `CULL_MARGIN=128` 口径的对偶）。

### 2.2 反面教材：Excalidraw 至今是 O(N) 视口遍历

来源：GitHub `excalidraw/excalidraw` PR **#10514**「Avoid full scene traversal in renderer on viewport updates」（作者 jas011，2025-12-14，**状态 Open，无 review，未合并**，核实 2026-09-15）+ 关联 PR **#11463**「uniform-grid viewport culling」（2026-06，Open）。

- 问题（PR 原文）：`Renderer.getRenderableElements` 每次渲染 `getNonDeletedElements()` 全量拉取 + 逐元素 `isElementInViewport`，**每次渲染 O(N)**，大场景 pan/zoom 卡顿。
- 修复：Scene 维护轻量空间索引，视口边界查询候选 ID → 再走原过滤（O(N) → O(K)，K=视口重叠数）。
- **两个修复 PR 均未合并**（约 8 个月窗口）——说明「社区大项目在大场景性能修复上也会长期悬置」。对我们的启示：**空间索引要在 N 还小的时候做**（成本低、无迁移包袱），而不是等卡顿出现（那时既要改数据流又要改渲染管线）。

### 2.3 选型结论与实施形状（写进下一批的触发条件）

| 项 | 建议 | 依据 |
|---|---|---|
| 数据结构 | **RBush**（`mourner/rbush`，MIT，R-tree，支持 50k 级 bulk load / 增量 insert·remove） | tldraw 同款；成熟度高于自造四叉树；体积小（无传递依赖） |
| 索引对象 | `<T extends BBox>` 存 `{minX,minY,maxX,maxY, placementUuid}`；**仅索引 transform 边界** | `_boundsEpoch` 语义（非几何 op 不重建） |
| 接口形状 | `CanvasSpatialIndex`（free-canvas 包内，headless）：`rebuild(placements)` / `upsert(placement)` / `remove(uuid)` / `search(rect)` / `hitTest(x,y)`；React 侧只消费 `search(viewportWorldRect)` | 与 headless 纪律一致（模型包，零 React） |
| 启用阈值 | 维持 09-11 建议：**总节点 > 1000 或可见 > 300** 时启用；此前保持 O(N)（简单优先） | 小 N 下索引收益 < 复杂度成本 |
| 与裁剪关系 | 索引输出喂给现有视口裁剪（或替换其遍历）；**Fast Path**（全可见短路）一起做 | tldraw 同款；避免小画布退化 |
| 无关 op 短路 | `patchFront/patchBack/toggleFace/zIndex/addBack` 不触碰索引；`movePlacement/resizePlacement/upsert/remove` 才更新 | `boundsEpoch` 直译 |
| 不做 | 不为逐卡订阅「可剔除条件」；不做 WebWorker/离屏索引（到 10k+ 再说） | tldraw `canCull` 快慢路径教训 |

---

## 3. 双模式（画布 ↔ 文档）：AFFiNE 对照与我们的取向

### 3.1 AFFiNE：同一棵 block 树，双视图

来源：<https://affine.pro/pagedoc>（「Every doc can switch to the edgeless whiteboard in one click — **the same blocks work in both modes**」）、社区架构笔记（2026-06，`estelledc.github.io`：「2023 年架构大改，编辑器引擎抽出 BlockSuite，**doc 和 whiteboard 开始共享同一棵 block 树**」）、docs.affine.pro（Page Mode / Edgeless Mode 概念页，核实 2026-09-15）。

- 模式切换 = **同一文档的两种视图**：块在 page 模式里顺序排布、在 edgeless 模式里有坐标；切换不改变数据身份。
- 代价（从架构反推）：需要块级「布局元数据」（坐标进块属性或独立 layer）、统一块模型、以及更强的撤销/协作一致性要求（BlockSuite + Yjs 全量 CRDT）。

### 3.2 我们的取向（C+1 已落地）

- **独立事实源**：`.mm.md`（树形）与 `.mc.canvas.json`（自由画布）**互不引用**；模式切换 = `App` 模式态 + **分 Stage 挂载/卸载**（D6，用户裁定 1）。
- 收益（C+1 实测验证）：切换零状态互串（e2e 断言 Stage 互斥挂载）；导图链路（NotePopover / MapView / note.md）零触碰；两份规格各自可独立演进（`.mm.md` 铁律不受画布影响）。
- 代价：**没有「同内容双视图」**（导图不能一键变成自由画布排布，反之亦然）；跨模式引用需人工复制。

### 3.3 结论：维持现取向，观察项写明触发条件

| 问题 | 结论 |
|---|---|
| 是否改向 AFFiNE 式共享树 | **否**。共享树需要块级布局元数据 + 统一数据模型 + 全量 CRDT，属于会触及 kernel 协议层的重架构；当前无真实需求驱动（用户裁定 1 明确「独立文件 + 模式切换」） |
| 「同内容双视图」何时再议 | 出现 ≥2 次真实摩擦（用户需要「把这棵导图原样拖到画布上继续自由排布」）时，评估**单向导出**（导图 → 一次性生成 `.mc.canvas.json` 布局）而非共享树——成本低一个数量级 |
| 可立即借鉴的点 | AFFiNE 的「模式切换不丢焦点/视口」体验细节：切走再切回保留视口（我们的 `viewport` 已落盘 ✅）；切换按钮位置与快捷键（留产品切片） |

---

## 4. 近邻竞品（「纯文本事实源 × 自由画布」赛道）

### 4.1 Frank Anaya · Freeform Canvas（Obsidian 插件，闭源未标价）

来源：<https://frankanaya.com/freeform-canvas/>（落地页，无日期，核实 2026-09-15；价格/许可均未在页面公开）。

- 主张：「每张卡片都是你 vault 里的**真实 Markdown 笔记**」；「**以 Freeform canvas 或纯 Markdown 文件打开任何一个板子**——随你选」；「画布是视图，绝不是牢笼」。
- 能力：Sticky 便签（可着色/缩放/链接）↔ **Live mind maps（与 Markdown 大纲同步）** ↔ note ↔ file **任意互转**；Groups & kanban；小地图 / 大纲面板 / Bases 视图；**虚拟化渲染**（只渲染屏内内容，与 tldraw 同向）。
- 与我们卡位重叠度：**高**（纯文本 + 画布 + 导图 + 无锁定）。
- **关键信息缺口（决定其「纯 Markdown 承诺」是否成立）**：**布局元数据（坐标/颜色/连线）存哪里未公开** —— frontmatter？旁路文件？还是另有 `.json`？页面只批评 Obsidian Canvas 存 `.canvas` JSON，却没交代自己。→ 这正是我们 **`.mc.canvas.json` 显式分离**（布局在画布文件、内容在画布文件内、导图在 `.mm.md`）之外的另一条路线；如果它是「frontmatter 存坐标」，那我们可对比同步冲突成本。
- 是否开源：**未提及（不能推断）**；价格：未公开（页面唯一价格是无关的 $47/mo 工作坊）。

### 4.2 Noteriv（MIT，Rust + Tauri，跨平台桌面 + Android）

来源：<https://www.noteriv.com/>（无日期；下载指向 GitHub Releases v2.4.3；仓库 `thejacedev/Noteriv`，MIT，核实 2026-09-15）。

- 事实源：**纯 Markdown 文件在本机**（frontmatter/tags/folders；Dataview 查询；Git / WebDAV / 本地文件夹同步——无专有云）。
- Canvas：无限画布（**便签 / 手绘 / 图片 / 箭头**），定位头脑风暴与思维导图。
- **Flashcards：SM-2 间隔重复内置在笔记里**（Q&A + cloze），即「**卡片即笔记的一种结构化写法**」——与我们「导图卡背面 = `note.md`」同族思路，但它是**复习语义**（翻卡 = 展示答案），不是**空间语义**（翻面 = 双面记录）。
- **信息缺口**：Canvas 落盘格式未说明（是否 JSON、能否与 Markdown 双向引用、卡片能否嵌 `[[wiki-link]]`）。
- 对我们的意义：证明「Markdown + 画布 + 卡片」组合在桌面端有活跃实现且选 MIT；其**手绘**与**复习队列**是我们的明确非目标（不跟）。

### 4.3 markvault（对标对象）的公开信息缺口

本轮检索未获得有效公开资料（搜索结果被通用 Obsidian 内容淹没）——**如实记录：markvault 的可靠信息仍只有本仓库的源码级分析**（`docs/research/2026-09-01-markvault-mindflow-analysis.md`：两套连线并存、绕障算法参数、`ConnectionEditModal` 字段）。C+1 的翻面对标依据（FlipCard 契约、face 驱动）来自该分析与 C 批设计稿。

### 4.4 三个近邻的对照表

| 维度 | 我们（C+1） | Freeform Canvas | Noteriv | markvault |
|---|---|---|---|---|
| 事实源 | `.mm.md`（导图）+ `.mc.canvas.json`（画布）**双独立** | vault 内纯 Markdown（**布局存哪未公开**） | 纯 Markdown 文件（**画布落盘未公开**） | Obsidian 插件（源码分析） |
| 画布 | 自研 SVG + world transform | 虚拟化渲染 + 小地图 | 无限画布（手绘/图片/箭头） | native 翻卡 + annotation |
| 导图 | 严格树形（kernel）+ 自由连线（画布） | Live mind maps（与大纲同步） | 基础 | MindFlow 连线 |
| 卡片翻面 | ✅ 整卡 3D，face 落盘（D3/D4） | ✗（无翻面语义） | ✗（翻卡=复习展示） | ✅ 翻卡（我们 C+1 的对标源） |
| 布局信息表达 | **显式画布 JSON**（可 diff、未知键透传） | 未公开（frontmatter 存疑） | 未公开 | markdown 内协议块（`note.md`） |
| 许可 | 自有仓库 | 未公开 | **MIT** | 未公开（插件） |
| 差异化位 | **布局与内容同一份纯 JSON 可 diff + 双模式互不污染 + 翻面双面记录** | 纯 MD 单源（若成立则更激进） | 复习闭环 + 桌面原生 | 观察源 |

**判断**：**「布局信息的纯文本/可 diff 表达」仍是空白位**——Freeform Canvas 与 Noteriv 都在「纯 Markdown 事实源」上最强，但布局元数据去向不透明；我们把它显式放在 `.mc.canvas.json`（JSON 可 diff、未知键透传、与 `.mm.md` 同纪律），**这条路线值得在 README/规格里写成明确卖点**（一句话：内容可读、布局可 diff、双模式各归各）。

---

## 5. 许可与依赖复核（drift 检查，2026-09-15）

| 候选 | 09-11 记录 | 本轮复核 | 结论 |
|---|---|---|---|
| tldraw SDK | 非 OSI（tldraw License），生产付费 + 强制水印，v5.4.2 | 未发现许可变化（本轮未复抓 LICENSE） | **维持不引** |
| quickdraw（MIT，tldraw 替代） | v0.2.0，451★ | 未复核 | 观察，不引 |
| Excalidraw SDK | MIT，344 kB gzip，breaking 史 | 未复核（本批只要它的性能教训） | 不引 |
| xyflow | MIT，分组/布局/撤销在 Pro | 未复核 | 不引 |
| **rbush** | （新增候选） | mourner/rbush，**MIT**，无传递依赖（待引入时再核验版本） | **若做空间索引：引它，不自造** |
| OCIF | — | CC BY-SA 4.0（09-11 记录）；候选推荐阶段 | 观察 |

> 复核深度说明：本表为「是否引依赖」的决策复核，tldraw/Excalidraw 的完整许可条款未逐字重读（09-11 已读，4 天内无足够动机重读）；**引入任何依赖前必须重读 LICENSE**（沿用 09-11 纪律）。

---

## 6. 对后续切片的修订建议（衔接计划 §7）

| 切片 | 之前状态 | 本轮建议 | 依据 | 优先级 |
|---|---|---|---|---|
| **JSON Canvas 导出/导入** | §7 列「导出互换」 | **升为下一批首选**：先导出（含 placements 按 zIndex 排序、`toEnd` 默认坑、回写产品文案）；导入次之（file/link/group 丢弃 + 未知键挂透传槽） | §1.2 映射表已备齐，实现量小 | **P0** |
| 边样式与 label 编辑 | §7 列 | 保持；**label 已有协议位**（`label?`）可顺手在编辑弹层加 | `McCanvasEdge.label` 已存在 | P2 |
| 空间索引 | §7「N 大再立」 | **保持阈值制**（>1000/>300），但先把「无关 op 不触碰索引」与 `search(rect)` 接口形状**写进 free-canvas 规格**（未来实现不改协议） | tldraw `_boundsEpoch` + Excalidraw 反例 | P1（规格先行） |
| 虚拟化渲染 | 未列 | 不新增切片；tldraw 的 `display:none` 剔除语义与我们的视口裁剪同构，**在 N 大时直接复用** | §2.1 | 观察 |
| 同内容双视图（导图↔画布） | 未列 | **不做共享树**；触发条件（≥2 次真实摩擦）下做**单向导出** | §3.3 | 观察 |
| README/规格定位文案 | 无 | 加「布局可 diff / 双模式互不污染 / 翻面双面记录」三条差异化表述（对照 §4.4 三个近邻的信息缺口） | §4.4 | P1 |
| OCIF | 未列 | 观察项（候选推荐阶段，无采纳数据） | §1.3 | 观察 |

---

## 7. 未核实清单（诚实记录）

1. Freeform Canvas 的**布局元数据存储位置**（frontmatter / 旁路文件 / 其他）——落地页未公开，需实测或找文档。
2. Freeform Canvas 的**是否开源与价格**——页面未公开。
3. Noteriv 的 **Canvas 落盘格式**与卡片语法（`::`？tag？frontmatter？）——落地页未公开。
4. OCIF 的**实际采纳者名单**——规范页未提供。
5. tldraw / Excalidraw / quickdraw 的**本轮许可与版本漂移**——未逐字重读（见 §5 说明）。
6. markvault 的**公开动态**——检索无有效信息（结论仅基于本地源码分析）。
7. rbush 的**当前版本号与最近发布**——未抓取（引入前核验）。
