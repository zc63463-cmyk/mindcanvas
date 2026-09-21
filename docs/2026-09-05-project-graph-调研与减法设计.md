# Project Graph 深度调研与 mindcanvas 减法设计

> 调研日期：2026-09-05 | 调研对象：https://github.com/graphif/project-graph
> 本地源码：`<local-path>`（全量 clone，4387 commits）

---

## 一、一句话结论

**不要羡慕 PG 的 115,024 行。它的复杂度里，约一半是它的问题域强加的，四分之一是自己长出来的赘肉，只有约四分之一是真金。**

而 mindcanvas 因为选了「树 + 纯文本」，天然免疫了前一半。真正该做的不是加法，是**确认边界 + 补三个真缺口**。

---

## 二、全景对照

| 维度 | Project Graph | mindcanvas | 倍数 |
|---|---|---|---|
| 代码行数（TS/TSX） | **115,024** | **20,382** | 5.6× |
| 文件数 | 647 | 128 | 5.1× |
| 提交数 | 4,387 | 59 | 74× |
| 开发时长 | 2 年（2024-08-21 起） | ~30 天 | — |
| 主力贡献者 | littlefean 2707 / zty012 1196，共约 30 人 | 1（+AI） | — |
| 测试文件 | 50（`.test.ts` 47 + `.test.tsx` 3） | 133（794 条测试） | **2.7×** |
| **测试密度** | 50 文件 / 115k 行 | 133 文件 / 20k 行 | **15×** |
| 最大文件 | `extprg-types/index.d.ts` 9,945 行 | `MindmapStage.tsx` 1,573 行 | 6.3× |
| 快捷键 | **347 条**（注册文件 4,538 行） | `keys.ts` 100 行 | ~35× |
| 服务数 | **~90 个**（手写 Map 容器 + `@service` 装饰器） | 无服务层 | — |
| 交互控制器 | 19 个插件 Class（`import.meta.glob` 自动发现） | `edit/controller.ts` 单文件 | — |

**关键读数**：代码量差 5.6 倍，测试密度差 15 倍——方向相反。PG 靠人堆功能，mindcanvas 靠测试锁契约。

---

## 三、Project Graph 能力全景（13 层）

| # | 层 | 实现要点 | 证据 |
|---|---|---|---|
| 1 | 数据模型 | `StageObject`→`Entity`→`ConnectableEntity`→`TextNode`/`Section`；边 `Association`→`Edge`。**既有任意图，又有 Section 树嵌套** | `StageObject.tsx:18,21`、`Section.tsx:70-71` |
| 2 | 持久化 | `.prg` = **zip + msgpack**。自研 `@serializable`/`@id` 装饰器，带引用去重 `{$:"路径"}` | `Project.tsx:382-386`、`serializer/src/index.ts:19-104` |
| 3 | 撤销重做 | **双实现可切换**：快照式（整图 serialize）+ 增量式（jsondiffpatch）。上限条数截断 | `StageHistoryManager.tsx:44-57, 247-255` |
| 4 | 渲染 | 纯 **Canvas 2D**，**rAF 常驻全量重绘**（每帧 clearRect），无脏矩形 | `renderer.tsx:763, 86-95` |
| 5 | 相机 | **物理模型**：速度 + 摩擦（`frictionExponent=1.5`）+ lerp 缩放 | `Camera.tsx:28, 299-321` |
| 6 | 视口裁剪 | ✅ `getCoverWorldRectangle()` + 逐实体 `isOverView()` 跳过 | `renderer.tsx:937-940`、`EntityRenderer.tsx:56/83/…` |
| 7 | LOD | **仅按缩放**：文字 < 5px 不画、Section 大标题 scale>0.45 跳过。**无节点数维度** | `TextNodeRenderer.tsx:88`、`EntityRenderer.tsx:74` |
| 8 | 交互 | 19 个控制器插件，统一绑定 pointer/key/wheel，`toViewEvent` Proxy 转世界坐标 | `Controller.tsx:124-132`、`ControllerClass.tsx:86-96` |
| 9 | 快捷键 | 单一数组 `allKeyBinds`，**347 条**，靠 `when` 谓词做上下文门控 | `shortcutKeysRegister.tsx:277-290, 384-4484` |
| 10 | 右键菜单 | **配置驱动**，直接复用快捷键的 `onPress`/`icon`/`when`，一处定义三处消费 | `context-menu-content.tsx:113-147` |
| 11 | 算法 | DAG 分层（Kahn 拓扑排序）+ 快速树布局（子树外接矩形）+ 凸包 + 对齐吸附。**无连线避障** | `mainTick.tsx:165-240`、`autoLayoutFastTreeMode.tsx:34,242` |
| 12 | 扩展 | `extprg` = Worker + Comlink，可 `shell_execute`、自定义实体与渲染。**非安全沙箱** | `ExtensionRuntime.tsx:10-33`、`api/host.tsx:109,213-248` |
| 13 | AI / CLI | Vercel AI SDK，~30 个 function calling 工具；CLI 暴露 `tool list/describe/invoke` 给 Agent | `BuiltInToolExecutors.tsx:113-809`、`ProjectGraphCli.ts:16-26` |

### 它对纯文本的态度（关键判断）

**文本是「输入/输出/AI/剪贴板」的一等公民，但不是「人类可编辑的事实源」。**

- ✅ Markdown / Mermaid / 纯文本 / SVG / PNG 双向导入导出，且是真能用
- ✅ 粘贴纯文本**自动建节点**并智能识别（SVG 串 / URL / `[text](url)` / 绝对路径 / 超 3000 字→details）
- ❌ 节点标题在画布上是**纯文本**不解析 Markdown；`details` 字段是 PlateJS 富文本，但画布上只当多行纯文本画
- ❌ **没有人类可读的事实源文件**——存储是二进制 `.prg`，无法 git diff、无法用外部编辑器打开
- ⚠️ 有个 `vditor-panel.tsx` Markdown 编辑器，**全仓库零引用**（死代码残留）

---

## 四、减法决策矩阵

### 🟢 学（4 件，抄设计不抄代码）

| # | 该学什么 | 代价 | 依据 |
|---|---|---|---|
| **L1** | ~~视口裁剪~~ | — | ⚠️ **更正：已实现**。见 9.9e，当初 grep 关键词不全导致误判 |
| **L2** | **粘贴即建节点** | 低（半天） | PG `copyEngineText.tsx:23-179`。**真缺口**，且正中纯文本哲学 |
| **L3** | **快捷键单一数据源**（数据 + `when` 谓词 → 菜单/设置/提示三处消费） | 中 | PG 最漂亮的架构决策。mindcanvas 现 `keys.ts`(100行) 与 `ContextMenu` 分离 |
| **L4** | 文字测量双层 LRU | 低 | PG `MaxSizeCache(10000)` + `LruCache(1000)`。优先级最低（已有 LayoutCache 兜底） |

### 🔵 守（5 件，已领先，别自贬）

| # | 护城河 | 对比 |
|---|---|---|
| **K1** | **避障边路由** | PG **完全没有**（端点取几何交点，无 obstacle 查询）。这是唯一真正的独家技术项 |
| **K2** | **纯文本 `.mm.md`** | PG 是二进制 `.prg`（zip+msgpack）。**正因如此 PG 才要造 CLI + 30 个 AI 工具来"曲线救国"** |
| **K3** | **LOD 双因子** | `MapView.tsx:454` `lodFor(scale, nodeCount)` —— 同时看缩放和节点数。PG 只有缩放 |
| **K4** | **测试密度 15×** | 794 测试 / 20k 行 vs PG 50 文件 / 115k 行 |
| **K5** | **往返无损契约** | PG 无等价物（`verifyRoundTrip` + `stableStringify` + 真实内容诊断） |

### 🔴 拒（8 件）

**A 类 — 问题域强加（不是它错，是我不需要）**

| 拒什么 | 为什么不需要 |
|---|---|
| Canvas 2D + rAF 常驻全量重绘 | SVG 声明式渲染天然增量，无需主循环 |
| 相机物理模型（速度/摩擦/lerp） | 过度设计，`transform` 即可 |
| `CollisionBox`/`Vector`/`Section` 几何进持久化 | `.mm.md` 无几何，树结构即布局。<br>⚠️ **修正见第九节**：若引入自由坐标，几何可作为「文档级可选覆盖层」而非节点属性——两者不矛盾 |
| 5 种边型 + 5 种箭头 | 自由图才需要样式表，树只要一种 |
| 自研 `@serializable` 装饰器 + 引用去重 | 纯文本不需要对象图序列化 |

**B 类 — 自长赘肉（警惕自己别长成这样）**

| 拒什么 | 为什么 |
|---|---|
| ~90 个服务 + `@service` DI + before/afterInit 顺序管理 | 20k 行项目用不上；初始化顺序靠"分两批"手工管理是脆弱信号 |
| 347 条快捷键（4,538 行注册文件） | 心智负担；单文件 4.5k 行本身就是坏味道 |
| Worker + Comlink 扩展系统 + `shell_execute` | 安全面巨大，仅拦截 2 个 key |
| ~30 个 AI function calling 工具 | 见下节——mindcanvas 不需要 |

---

## 五、全场最值钱的一个洞察

> **PG 花大力气造 CLI 和 30 个 AI 工具，是为了让 Agent 能操作它的二进制 `.prg`。
> mindcanvas 的 `.mm.md` 本身就是 Agent 可直接读写的接口——这个能力是免费的，不需要造任何 CLI。**

| | Project Graph | mindcanvas |
|---|---|---|
| Agent 想读图 | 必须走 CLI `tool invoke` 或 MCP | **直接 `cat` 文件** |
| Agent 想改图 | 调 30 个 function calling 工具 | **直接编辑文本** |
| 冲突合并 | 二进制无法 merge | **`git merge` 原生可用** |
| 版本历史 | 自研备份策略（按 mtime 删旧） | **`git log`** |
| 成本 | CLI 包 + 工具注册表 + 进程契约（数千行） | **0 行** |

**该做的不是造 CLI，是写一份「`.mm.md` 契约说明」**（1 页文档，0 代码），让 Agent 知道怎么写才不破坏往返无损。
参照已有资产：`docs/specs/2026-09-02-mm-md-protocol.md` 已覆盖 v1.3.1，补一节「AI 编写守则」即可。

---

## 六、真缺口落地方案

### L1 · 视口裁剪（P1）

**现状**：`MapView.tsx` 渲染全部 `layout.nodes`，无裁剪。
**做法**：
1. `viewport.ts` 已有 `ViewportController` 与 `transform`，补 `coverWorldRect(frame, transform)` 算可见世界矩形
2. 渲染循环前过滤：`nodes.filter(n => intersects(n.box, cover))`
3. **保留 1 屏缓冲**（PG 无缓冲，快速平移会露白）

⚠️ 两条约束：
- 裁剪只影响渲染，**不能影响布局**（布局必须全量，否则树会散）
- 边需单独判断：两端点都在视口外、但边穿过视口的情况要保留（用边的包围盒判，不能用两端点）
- 与现 LOD 的关系：`lodFor(scale, nodeCount)` 的 `nodeCount` 应改用**可见节点数**而非总数

### L2 · 粘贴即建节点（P1）

**现状**：`MapView.tsx:780` 的 `onPaste` 只处理 `clipboardData.files`（图片），**文本分支缺失**。

**设计决策（需你拍板）**——多行文本粘进来建什么？

| 方案 | 语义 | 适合 |
|---|---|---|
| **A 缩进感知** | 按缩进/Tab 层级建子树 | 从大纲粘贴 |
| **B 平铺兄弟** | 每行一个兄弟节点 | 从列表粘贴 |
| **C 单行即节点** | 多行才走 A，单行直接建一个 | **推荐**：行为可预测 |

PG 的做法是「整段进一个节点的 details」——那是自由图的语义。**树工具应该让多行展开成结构**，这才是纯文本思维导图的本分。

⚠️ 必须走 `controller` 的 `pushHistory`（现有 `History<T>` 55 行，`limit=100`），保持不可变树语义。

### L3 · 快捷键单一数据源（P2）

把 `edit/keys.ts` 升级为 `KeyBind[]`，每项 `{ id, keys, when, run, icon? }`，
`ShortcutHelpPanel` / `ContextMenu` / 右键菜单共用同一份。`contextMenuItems.ts`（4,971 字节）改为引用 `id`。

⚠️ 这是**重构不是新增**，需在 F 自用周的摩擦记录之后再动，避免为重构而重构。

### L4 · Mermaid 导出（P2）

PG 双向都能用（`MermaidExporter.tsx:150-226`）。mindcanvas 目前无。
**只做导出，不做导入** —— 导入需手写 Mermaid 解析器（PG 花了 372 行），而 mindcanvas 的 `.mm.md` 才是事实源，导入 Mermaid 属于低频需求。

---

## 七、落地路线（G 批）

| 序 | 事项 | 优先级 | 预估 | 前置 |
|---|---|---|---|---|
| G1 | **`.mm.md` AI 编写守则**（1 页文档，0 代码） | **P0** | 1h | 无 |
| ~~G2~~ | ~~视口裁剪~~ | ✅ **已完成** | — |
| G3 | 粘贴即建节点（先按方案 C） | P1 | 0.5d | 需你确认语义 |
| G4 | 快捷键单一数据源 | P2 | 1d | **F 自用周之后** |
| G5 | Mermaid 导出（仅导出） | P2 | 0.5d | 无 |

**明确不做**：CLI、AI function calling 工具、扩展插件系统、Canvas 渲染重写、服务层 DI、多标签、协作。

---

## 八、给自己的三条提醒（从 PG 身上学到的反面教材）

1. **单文件 4,538 行是危险信号**：`shortcutKeysRegister.tsx` 一个文件 347 条快捷键。
   mindcanvas 的 `MindmapStage.tsx` 1,573 行正在同一条路上——拆分已有进展（−9.7%），别停。
2. **"分两批初始化服务"是脆弱信号**：`loadAllServicesBeforeInit` / `AfterInit` 的存在，
   说明依赖关系已经复杂到需要人工排序。mindcanvas 别引入服务层。
3. **死代码会留在仓库里**：`vditor-panel.tsx` 零引用仍在；`TODO.md` 是 0 字节空文件。
   文档与代码都会腐化，所以才需要「别信文档，先 grep」这条铁律。

---

## 九、补遗：无限画布、多中心与图操作（2026-09-05 追加）

> 用户判断「无限画布式、多个中心、支持丰富的图操作是很好的借鉴点」。经 grep 核实：**这个方向成立，且 mindcanvas 已完成一半。**

### 9.1 先修正一处误判

前文暗示自由边是视图层小功能，**实际不是**。`packages/react/src/render/freeEdges.ts` 头注释：

> 边是**文档级标注对象**（root note 透传键 `edges`），不是节点属性——同一对节点在不同画布可有不同关系与连线；**节点数据保持纯净**；锚存路径/实体锚（跨会话稳定）；数据面边界 **ADR-0008 定型**

### 9.2 图操作能力现状（grep 实证）

| 能力 | 现状 | 位置 |
|---|---|---|
| 跨分支自由边 | ✅ 进事实源，文档级对象 | `root.note.edges` |
| 关系语义层 | ✅ 自 markvault-js 移植 | `relationSchema.ts`（causes/blocks/relates-to；反向、对称、虚线语义、分组） |
| 跨会话稳定锚 | ✅ 路径锚 | `pathOfNode` / `nodeAtPath` |
| 避障路由 | ✅ 任意 Box 集合 | `edgeRouting.ts` 1,151 行 |
| 视口 pan/zoom | ✅ 含惯性估算 | `viewport.ts` |
| 节点拖拽重排 | ✅ 但**只改结构** | `nodeDrag.ts` → `before/after/child` → `move-node` |
| **自由坐标** | ❌ | 拖到空白无意义（无坐标概念） |
| **多中心（森林）** | ❌ 单根 | `layoutMindmap` 无 forest 支持 |
| **框选 / 批量 / 对齐** | ❌ | — |

### 9.3 三种骨架模型

| | PG | mindcanvas 现状 | **建议的第三态** |
|---|---|---|---|
| 骨架 | 图 | 树 | **树（结构即事实源）** |
| 坐标 | 节点属性，必需 | 布局算出，不存在 | **文档级可选覆盖** |
| 没坐标时 | 画不出来 | 只能树形 | **自动布局，优雅降级** |
| 存储 | 二进制 `.prg` | 纯文本 `.mm.md` | 纯文本 + 可选 pos |

**根本分歧是「文档是什么」**：PG 认为文档 = 白板（布局即内容）；mindcanvas 认为文档 = 文章（结构即内容）。
mindcanvas 的价值主张是「像写 Markdown 一样画导图」，**结构优先不能丢**——但可以在其上叠加坐标自由度。

### 9.4 关键设计：坐标作为「文档级可选覆盖层」

**不挂节点上，像 `edges` 一样存 `root.note.pos`**（路径 → `{x,y}`）。理由即 `freeEdges.ts` 自己的原则：节点数据保持纯净。

- 手写 / AI 生成的 `.mm.md` 不带 pos → 自动树布局，零负担
- 用户拖动过某节点 → 只写这一个的坐标，其余保持自动
- Agent 读写时忽略 pos 即可；git diff 只在你拖过之后才有坐标行

⚠️ **冲突处理要做得比 PG 好**：PG 只有「全局开关 + 根锚定」，没有节点级锁定。mindcanvas 应做到**按节点粒度**——拖动过的锁定，其余自动布局。

### 9.5 自由坐标会改变性能画像

| 项 | 树布局 | 自由坐标 | 动作 |
|---|---|---|---|
| 视口裁剪 | 收益一般（节点紧凑） | **收益翻倍**（节点分散） | 优先级**上调** |
| 空间索引 | 可选（可走结构） | **必需**（命中测试遍历全量） | 新增 |
| 边路由 | 价值一般（边规则） | **价值翻倍**（边大量交叉） | 天然适配，无需改 |
| 增量重排 | 整树缓存够用 | 需「脏子树」标记 | 改造 `LayoutCache` |
| SVG 上限 | 够用 | 上千节点 DOM 重 | 视口裁剪 + 虚拟化 |

**可反超 PG 的一点**：PG 的 `StageManager.get` 是 `stage.find()`，注释自陈「2.0 从 O(1) 变成 O(N)」，**它没有空间索引**。自由坐标下这块 mindcanvas 可以做在它前面。

### 9.6 建议的推进顺序（用最小成本验证最大假设）

| 步 | 事项 | 预估 | 独立价值 |
|---|---|---|---|
| 1 | 视口裁剪 + 空间索引 | 1–2d | 性能地基，不论走不走自由坐标都用得上 |
| 2 | **多中心 forest** | 2–3d | **不需要坐标就能实现「多个中心」** |
| 3 | 自由坐标（可选覆盖） | 3–5d | 等前两步验证后再动 |

**第 2 步是关键**：它能验证「用户到底需不需要自由摆放」这个最大假设。若用了多中心发现自动布局够用，第 3 步的 3–5 天直接省掉。

### 9.7 风险

1. **坐标进 `.mm.md` 的心理负担** → 解法：文档级标注区，手写时完全不用管
2. **「不敢手写」的反噬** → 解法：坐标只在用户拖动过时写入，不是默认
3. **最大的坑**：一旦引入自由坐标，「自动布局」就从默认变成可选项，**整个布局引擎的语义要重写** —— 这正是先做第 1、2 步的理由

### 9.8 决策：SVG 走引用，不做内嵌编辑器（2026-09-05 定）

用户明确「暂时不需要内嵌可编辑，引用够了」。这条边界砍掉的复杂度：

| 砍掉 | 省下的代价 |
|---|---|
| SVG 编辑器（Excalidraw 类手绘节点） | 单独的编辑器 + 序列化格式 |
| SVG 源码的序列化与转义 | `.mm.md` 体积与 diff 噪音 |
| 内嵌大小上限与裁剪策略 | 协议层新增约束 |
| **内嵌 SVG 的 XSS 沙箱** | `<script>` / 外部引用注入面 |
| 内嵌内容的 git diff 噪音 | 纯文本可读性 |

### 9.9 引用模式的现状与唯一遗留问题

**架构已经是对的**：`AssetHost` 是宿主契约（接口），`DemoAssetHost` 是当前实现。
`assetHost.ts` 头注释：宿主可换（真实 FS/HTTP 属宿主职责），资产 id 为「导图相对路径」。
已有 `W-ASSET-MISSING` 诊断（`assetDiagnostics.ts`），缺失渲染为失效占位。

**当前实现的限制**（`DemoAssetHost` 注释自陈）：用 `URL.createObjectURL`，**会话有效、刷新即失效、不落盘**。

**唯一遗留问题：缺真实持久化宿主。** 阻塞点经 grep 确认——全仓**只有文件句柄**（`FileSystemFileHandle` + `createWritable`），**无任何目录句柄**（`showDirectoryPicker` / `DirectoryHandle` 零匹配）。所以目前无法把资产写到 `.mm.md` 同级的 `assets/` 目录。

| 方案 | 文档可移植 | 资产持久化 | 需目录授权 |
|---|---|---|---|
| A. 目录句柄 `showDirectoryPicker` | ✅ 完全 | ✅ | ✅ 需改打开方式 |
| B. 文件句柄 + IndexedDB 存 blob | ⚠️ 文档可复制，资产不跟随 | ✅ | ❌ |
| C. 会话级 objectURL（现状） | ❌ | ❌ 刷新失效 | ❌ |
| ~~D. base64 内嵌~~ | ✅ | ✅ | ❌ | **已决策排除** |

**为什么现在不必解决**：`AssetHost` 是接口，换实现不影响任何其他代码。真要持久化时写个 `FsAssetHost` 实现接口即可，**零架构改动**。契约已立，实现可无限期推迟——这正是「引用够了」这个决策的最大价值。

### 9.9b AI 联动形态：抄「通道」，不抄「小窗」

**PG 的小窗实景**（`app/src/sub/AIWindow.tsx`，1,186 行）：右侧停靠抽屉（380px，可改浮动），
快捷键或右键「智能工具」唤起。内含对话气泡 + 工具调用折叠块（准备参数/执行中/完成/失败）+ Token 用量 + 上下文窗口进度条。

**它做对的四件事（值得抄的是交互，不是实现）**：

| 设计 | 证据 | mindcanvas 可抄 |
|---|---|---|
| **选中即上下文** | 发消息时注入 `[selected: n1 n2]` 前缀，非整图序列化（`AIWindow.tsx:633-639`） | ✅ 选中 heading 子树 → 导出 Markdown |
| AI 主动查图 | 30 个工具中一半是查询类（`get_all_nodes`/`get_nodes_in_viewport`/`search_text_nodes_by_regex`） | ❌ 纯文本不需要 |
| **改动走统一 undo** | 每个工具后 `recordStep()`，与手动操作同栈（`BuiltInToolExecutors.tsx:136/184/347`） | ✅ 已有 `History<T>` 55 行 |
| 稳定引用可点击定位 | `AIObjectReferenceRegistry` 分配 `n1/e1`（`BuiltInToolRegistry.ts:108-119`） | ✅ 路径锚已解决 |

**★ 关键判断：那 30 个工具是「补丁」，不是「特性」**

`.prg` 是二进制，AI 读不懂，**必须造翻译层**。`.mm.md` 是纯文本，AI 原生就能读——**整整少一层**。

所以 mindcanvas 该做的是**「AI 通道」而非「AI 面板」**：

| 步骤 | 事项 | 成本 |
|---|---|---|
| G1 | `.mm.md` AI 编写守则（让 AI **写对**） | 1h，0 代码 |
| **G9** | **复制选中子树为 Markdown**（让上下文**传出去**） | 0.5d |
| G3 | 粘贴即建节点（让 AI 输出**回得来**） | 0.5d |

三条合计约 **1.5 天**，对比 PG 的 1,186 行 AIWindow + 30 个工具 + AI SDK 依赖。
且**不绑定任何模型与密钥**——用户可以用任意 AI。

**🔴 绝不能照抄的一条**：PG 的破坏性工具（`delete_node`/`edit_text_node`）**无二次确认直接执行**，
仅靠全局 undo 兜底（`BuiltInToolAgentAdapter.tsx:13-46` 未设 `requireApproval`）。
mindcanvas 用 File System Access API **直接写用户磁盘**，风险量级不同——
**AI 改动必须先进内存、用户确认后再落盘**。

**顺带记一个 PG 的交互疏忽**：AI 面板**无密钥门禁**——`aiApiKey` 默认为空，但打开时不拦截，
要等请求失败才弹 toast「AI 请求失败」（`AIWindow.tsx:533-535`）。默认 baseURL 硬编码指向 Gemini。

### 9.9c 节点自由移动 / 自主连线 / 连线微调（grep 实证）

| 能力 | 现状 | 证据 |
|---|---|---|
| **自主连线** | ✅ 完整 | `MapView.tsx:398` `connectDrag` + `onEdgeConnectRef`；边存 `root.note.edges`，带 `RelationSchema` 语义 |
| **连线微调** | ✅ 完整，三层设计 | `FreeEdgeLayer.tsx:133/198/350-354` |
| **节点自由移动** | ❌ **唯一短板** | `nodeDrag.ts` 只出 `before/after/child` → `move-node`，无坐标概念 |

**连线微调是完整实现，不是数据占位**（`FreeEdgeLayer.tsx`）：
- `:133` 拖拽状态 `{key, handle: 'from'|'to'|'bend'}`
- `:350-354` `EdgeHandles` = 两个端点圆点 + 一个 bend 方点，**选中边才显示**（注释写明「与 XMind 一致」）
- `:198-199` bend 用「相对弦的垂距 / 弦长」算曲率
- 恢复自动：`Shift+点击 bend` 或「恢复自动」→ `manual = null`
- `:159-160` 人工锁定的边**跳过自动路由**

**三层覆盖设计**（比 PG 精细——PG 边端点只取几何交点，既无避障也无微调）：

| 层 | 字段 | 行为 |
|---|---|---|
| 全自动 | 无 `manual` | 算法择优曲率与锚点，避障评分绕行 |
| 半自动 | `routingSide: 'left'\|'right'` | **只定方向，曲率仍由算法在该侧内择优** |
| 全手动 | `manual: {from,to,curvature}` | 精确几何，停用自动路由 |

**★ 关键推论：G7（节点自由坐标）的设计已被「边的 manual 机制」完整验证过一次**

同一个模式，四项对齐：

| 维度 | 边（已实现） | 节点（G7 待做） |
|---|---|---|
| 持久化位置 | `root.note.edges[i].manual`（文档级，不污染节点） | `root.note.pos[path]`（文档级） |
| 覆盖语义 | `manual` 存在 → 停用自动路由 | `pos` 存在 → 停用自动布局 |
| 恢复机制 | 清空 `manual` → 恢复自动 | 清空 `pos` → 恢复树布局 |
| 锚定方式 | 路径锚（跨会话稳定） | **必须也用路径锚**（`astToEditable` 每次重新生成 id） |

→ **G7 从「设计风险高」降级为「照抄已有模式」**，预估从 3–5 天降到 **2–3 天**。

**半自动层（只锁 X 或只锁 Y）需求未验证，建议先跳过**——`routingSide` 的成功说明这个模式成立，但节点是否需要单轴锁定要等 friction-log 说话。

### 9.9d 节点树生长机制：PG 的「自由」在结构，不在键盘

**PG 的树生长核心**（`keyboardOnlyTreeEngine.tsx`）：
`Tab` 深度生长建子节点（`:293`）、`\` 广度生长建兄弟（`:546`）、
`W/S/A/D` 改预方向（缓存于 `preDirectionCacheMap`）、`Alt+Shift+F` 整树格式化。
**编辑框内 Tab 也能生长**（`inputElement.tsx:368`）——输入不被打断。

**但「树」在 PG 里只是「有向边推断出的无环结构」**，不是强制约束：
`validateTreeStructure`（`GraphMethods.tsx:68`）检测 selfLoop / cycle / diamond（多父），
从某节点分两条边仍合法（只提示 diamond）。Section 是独立视觉容器，与树无关。

**★ 键盘映射逐项对比（mindcanvas 整体占优）**

| 动作 | mindcanvas | PG | 评价 |
|---|---|---|---|
| 建子节点 | `Tab` | `Tab` | 相同 |
| 建兄弟节点 | **`Enter`** | `\` | **我们更好**（符合大纲软件惯例） |
| 编辑 | `F2` | `Enter`/空格/`F2` | 各有取舍 |
| 缩进 | **`Shift+Tab`** | 无独立键（靠整树格式化） | **我们更好** |
| 反缩进 | **`Ctrl+Shift+Tab`** | 无 | **我们更好** |
| 折叠/展开 | **`Space` / `Ctrl+[` / `Ctrl+]`** | `t 4/6/8/2` | **我们更好**（PG 的 t 序列难记） |
| 生长方向 | 布局自动分侧 | `W/S/A/D` 手动 | PG 因自由图才需要 |
| **编辑态连续生长** | ❌ **Tab 被拦截** | ✅ **Tab 即生长** | **PG 更好，唯一落后项** |
| 批量文本建树 | ❌ | ✅ 菜单入口（**默认无快捷键**） | 都可改进 |

**关键差距（G10）**：`OverlayEditor.tsx:99` 的 `e.stopPropagation()` 拦掉了 Tab，
但它是**单行 `<input>`**（`:94`），Tab 没有任何输入用途——拦截只换来浏览器默认焦点跳转。
键盘处理也只接了 `Enter` / `Shift+Enter` / `Escape`，Tab 完全没被利用。

→ **编辑态 Tab = 提交当前 + 建子节点**，录入两层树从 5 步降到 3 步。零风险（单行 input 不需要 Tab 缩进）。

**PG 的坑（别犯）**：
- `enableTreeGenerateConnectByProbe` 开启时，Tab 生长会改去「连接探测线碰到的已有节点」而非新建（`keyboardOnlyTreeEngine.tsx:305`），初学者困惑
- 自动布局默认开且**覆盖手摆位置**（根固定、其余重排，`autoLayoutFastTreeMode.tsx:725-733`）——mindcanvas 纯文本树不受此困
- 批量导入入口在菜单且默认无快捷键，发现性差；窗口内还写着「需手动 alt+shift+f 格式化」
- 死代码：`onDeleteCurrentNode()` 是空 TODO（`:730`）
- **被砍掉的功能**（git log）：引力布局（`adc72994`）、循环空间（`ae3d300f`）、`Ctrl+T` 翻转连线（`c7d18c43`，与分组框折叠冲突）——花哨模式都没活下来

### 9.9e ⚠️ 更正：G2 视口裁剪早已实现（我的误判与教训）

第四节曾写「mindcanvas 真缺口——grep 全仓无 cull/viewport 裁剪」，**这是错的**。

**实际现状**（`packages/kernel/src/layout/cull.ts`，独立模块）：

| 能力 | 实现 | 证据 |
|---|---|---|
| 世界可见矩形 | `worldViewportRect(t, viewW, viewH)` | `cull.ts:15` |
| 节点裁剪 | `isBoxInView(box, view, margin)` AABB + margin 外扩 | `cull.ts:21` |
| **边裁剪** | `filterVisibleLinks` —— **任一端点入视口则保留** | `cull.ts:47` |
| 接入渲染 | `visibleNodes` / `visibleLinks`，`CULL_MARGIN = 128` | `MapView.tsx:490/498/196` |
| 固定笔记面板 | `fixedNotePanelsOf(..., view, ...)` 也纳入裁剪 | `MapView.tsx:340` |
| 测试 | `viewport-cull.test.ts`（3）+ `links-visibility.test.ts`（4）**全过** | kernel |

**边的裁剪规则比我在报告里建议的更合理**：我原本建议"用边包围盒判"，实际实现是
「任一端点在视口内则保留」，注释说明了理由——
> 连接到屏幕外节点的线仍画到屏幕边缘，避免半条线突然消失。

**🔑 教训（补进项目铁律）**：误判源于 **grep 关键词不全**——
我搜的是 `viewport|visibleRect|coverWorld|isOverView|cull`（全小写），
而代码实际用 `worldRect` / `visibleNodes` / **`CULL_MARGIN`**（大写）。
小写 `cull` 匹配不到大写 `CULL_MARGIN`，且漏掉了另外两个关键词。
→ **grep 确认「有没有某功能」时，必须覆盖大小写变体与命名习惯**（camelCase / snake_case / SCREAMING_CASE）。

**另：我提的「LOD 的 nodeCount 应改用可见数」也是错的**。
`MapView.tsx:462` 用 `layout.nodes.length`（总数）是**刻意且正确**的：
LOD 若依赖可见数，平移画布时可见数变化会导致 LOD 频繁跳变 → 视觉抖动；
用总数则只在缩放时变，平移时稳定。

### 9.10 G 批更新

| 序 | 事项 | 优先级 | 预估 |
|---|---|---|---|
| ~~G2~~ | ~~视口裁剪~~ | ✅ **已完成** | — | 见 9.9e |
| **G6** | **多中心 forest** | **P1** | **2–3d** |
| **G7** | **自由坐标（可选覆盖）** | **P2** | **3–5d（待 G6 验证）** |

其余 G1 / G3 / G4 / G5 不变。
