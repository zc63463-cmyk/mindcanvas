# 自由画布深度学习简报（mindcanvas free-canvas）

- **读者**：产品/技术负责人 · mindcanvas 自由画布子模式
- **调研日**：2026-09-15
- **前提**：已读 `docs/2026-09-11-free-canvas-深度调研.md`、`docs/specs/2026-09-15-free-canvas-spec.md`；**不重复「要不要引 SDK」** 结论，只加深可抄设计。
- **当前基线（FC-B..E 已落地）**：两壳 native 卡、`face` 落盘 CSS 3D 翻面、直线边、`.mc.canvas.json`、React+DOM、独立 Stage；**不依赖**白板 SDK。

---

## 0. 一页结论

| 判断 | 含义 |
|---|---|
| **卡位仍空** | 「可 diff 的布局事实源 + 双面记录卡 + 与导图互不污染」仍少见；竞品要么布局藏进 MD/专有库，要么无翻面语义。 |
| **抄什么** | Document↔ViewState 铁律；边/binding 一等公民；视口剔除 + RBush + 拖移时绕过整树 React；Frames/Sections 当「空间章节」而非形状堆。 |
| **别抄什么** | tldraw/xyflow Pro 付费墙；Excalidraw 全场景 Canvas 化（丢中文可选中/搜索）；Figma WASM/WebGPU；Heptabase「卡库多板复用」的全量 CRDT。 |
| **差异化别丢** | 翻面是**双面记录**（非 Anki 复习）；Markdown/纯文本可读；未知键透传；与 `.mm.md` 分文件。 |

---

## 1. Tier-1 深挖（7 系统）

### 1.1 tldraw —— 交互与性能教科书（许可雷区）

| 维 | 要点 |
|---|---|
| **定位** | 通用无限白板 SDK；形状（geo/text/sticky/arrow）+ frames；工具状态机。 |
| **隐喻** | Shape 一等；Frame=容器；Arrow 靠 **Binding** 贴边，不是装饰线。 |
| **数据** | Store 记录：shapes / pages / bindings / assets / instance state；JSON 可序列化；Shape 与 ShapeUtil（行为）分离。 |
| **交互** | StateNode 层级工具机（select/draw/hand…）；多选、吸附、相机 x/y/z。 |
| **渲染** | **HTML/SVG DOM + CSS transform**；瞬态 overlay 用 Canvas；屏外 `display:none`（DOM 保留）。 |
| **持久化** | Store 快照；协作靠 `@tldraw/sync`（自托管）。非 Markdown。 |
| **扩展** | `ShapeUtil` + `BindingUtil` + tools；props 校验/迁移。 |
| **性能** | 空间索引剔除；signals 细粒度；`debouncedZoom`；LOD（阴影/图案降级）；`maxShapesPerPage≈4000`。 |

**偷**

- ShapeUtil 三分离：`props` / `getGeometry` / `component` → 对应 `NativePlacement` + hit bounds + `NativeCard`。
- Binding 生命周期（目标移动→边更新；删形→解绑）→ 边不要只存坐标。
- `_boundsEpoch` 思路：翻面/`patchFront` **不**重建空间索引。
- 拖移用命令式 DOM/transform，避免每帧整树 React。

**避**

- 生产许可 + 水印；整包体积；为「像 tldraw」引入全套工具机（只需 select/pan/connect）。

来源：[tldraw Shapes](https://tldraw.dev/sdk-features/shapes)、[Performance](https://tldraw.dev/sdk-features/performance)、[Bindings](https://tldraw.dev/sdk-features/bindings)（核实 2026-09-15）。

---

### 1.2 Excalidraw —— 数据模型教科书（渲染路线不同）

| 维 | 要点 |
|---|---|
| **定位** | MIT 手绘白板；形状/笔迹为主，非「知识卡」产品。 |
| **数据** | `elements[]`（文档）vs `appState`（视口/工具/选中）；元素带 `version`/`versionNonce`/`index`/`frameId`/`boundElements`。 |
| **合并** | `reconcileElements`：本地编辑中优先；否则比 version，再比 nonce —— **不是完整 CRDT**。 |
| **渲染** | 双 Canvas（Static + Interactive）；文字进像素 → SEO/读屏弱。 |
| **扩展** | 元素 `customData`；SDK 嵌入。 |

**偷**

- **Elements ↔ ViewState 严格分离**（已有 `placements/edges` vs `viewport`，继续把选中/工具/悬停**永不写进** `.mc.canvas.json`）。
- `schemaVersion` + migration；冲突时 version 字段可预留（单机可先 noop）。
- ShapeCache / 可渲染子集记忆化 → SVG 侧布局测量缓存。

**避**

- 为性能全面 Canvas 化（与 Markdown/可选中/翻面 DOM 冲突）。
- 依赖社区空间索引 PR——自己早做 RBush。

来源：[JSON Schema](https://docs.excalidraw.com/docs/codebase/json-schema)、[Scene schema](https://plus.excalidraw.com/docs/api/scene-content-schema)（核实 2026-09-15）。

---

### 1.3 Obsidian Canvas / JSON Canvas —— 互换格式基准

| 维 | 要点 |
|---|---|
| **定位** | 本地笔记空间板；节点=笔记块/文件/链接/组。 |
| **数据** | 仅 `nodes` + `edges`；z 序=数组顺序；边 `fromSide/toSide`（无 center）；`fromEnd` 默认 none、`toEnd` 默认 arrow。 |
| **隐喻** | text/file/link + **group 容器**；边是显式关系。 |
| **持久化** | `.canvas` MIT 规格（2024-03-11）；**无 viewport 字段**；无双面。 |

**偷**

- 导出/导入字段表 → **下一批直接做**。
- Group = 视觉章节（先不做父子树，做「框选成组」即可）。

**避**

- 把事实源压成纯 `.canvas`（丢 `back`/`viewport`/`schemaVersion`）。
- 用数组顺序代替显式 `zIndex`（内部保留字段，导出时排序）。

来源：[jsoncanvas.org/spec/1.0](https://jsoncanvas.org/spec/1.0/)、[Obsidian 公告 2024-03-11](https://obsidian.md/blog/json-canvas/)。

---

### 1.4 Heptabase —— 最值得抄的「知识白板」产品隐喻

| 维 | 要点 |
|---|---|
| **定位** | 学习/研究白板；**Card Library 拥有卡，白板只放置**。 |
| **隐喻** | Note card / Text / Section / Mindmap / **Sub-whiteboard**；同卡可多板出现；箭头连接。 |
| **交互** | 左栏工具模式；框选批量；白板内搜索；Info 看「出现在哪些板」。 |
| **翻面** | **无**产品级双面；spaced repetition 在路线图（2026-08 仍 Priority 1，未上线）。 |
| **架构公开度** | 产品模型清晰；底层渲染/存储 **未公开**（勿臆测）。 |

**偷（产品层）**

- **内容身份 ≠ 放置实例**（远期）：`cardId` + `placement`；今日可先不做跨板，但 schema 预留 `contentRef?`。
- Section / 子画布 = 复杂主题的「空间大纲」。
- 「白板内搜索」比全局搜索更贴合大板。

**避**

- 一上来做全局卡库 + 多板复用 + 全量同步。
- 把 AI Chat/Actions 绑死画布核心路径。

来源：[Heptabase Fundamental Elements](https://wiki.heptabase.com/fundamental-elements)、[Nextup 2026-08-14](https://wiki.heptabase.com/roadmap/nextup)。

---

### 1.5 Kinopio —— Local-first 卡+线的工程范式

| 维 | 要点 |
|---|---|
| **定位** | 轻量空间思维；卡 / box / connection；偏灵感板。 |
| **数据** | Space JSON：cards + connections（`startItemId`/`endItemId`、path、控制点、方位）。 |
| **持久化** | IndexedDB 本地缓存优先；上线后 ops queue 批同步；**支持 JSON Canvas 进出**。 |
| **渲染** | Vue + DOM 卡；连接为 SVG path（可弯曲）。 |
| **工程** | 所有更新走中心管线：本地缓存 + UI state + 广播 + undo + API 队列（拖移可数百次/秒合并）。 |

**偷**

- **Ops queue / 批写盘**：拖移中只改内存，mouseup/`requestIdle` 落盘。
- Connection 存**拓扑**（端点 id + 锚），path 可派生或缓存。
- Offline-first 加载：本地瞬间开，远程可选。

**避**

- 把协作广播做成 v1 范围。
- 连接 path 手绘编辑（复杂度高，P2 再议）。

来源：[Building Offline](https://pketh.org/building-offline.html)、[kinopio-client](https://github.com/kinopio-club/kinopio-client/)、[API docs](https://kinopio.club/api)（核实 2026-09-15）。

---

### 1.6 Figma（+FigJam 产品课）—— 只学原则，不学栈

| 维 | 要点 |
|---|---|
| **架构** | UI=React；文档+渲染=C++→WASM；WebGL→WebGPU；**tile 脏区**重绘。 |
| **协作** | 中心权威 + 属性级 delta；树序用 fractional indexing（非纯 P2P CRDT）。 |
| **FigJam UX** | Sticky / Section / Connector 一等；连接线吸附对象，移动跟着走；Frame/Section 管结构。 |

**偷**

- 「文档引擎与 chrome UI 分离」→ 已有 `@mindcanvas/free-canvas` headless。
- FigJam：**边绑定对象**；Section 包一层顶层白底当「一张板」。
- 脏区/tile 思想 → 大图时只重算可见卡与相关边。

**避**

- WASM/自研 GPU 渲染（量级与团队不匹配；DOM 卡+翻面是优势）。

来源：[Figma multiplayer](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)、[Building on the web](https://www.figma.com/blog/building-a-professional-design-tool-on-the-web/)、[WebGPU](https://www.figma.com/blog/figma-rendering-powered-by-webgpu/)、[FigJam connectors](https://help.figma.com/hc/en-us/articles/1500004414542-Create-diagrams-and-flows-with-connectors-in-FigJam)。

---

### 1.7 xyflow / React Flow —— 与栈最近的开源图编辑

| 维 | 要点 |
|---|---|
| **定位** | 节点图编辑（工作流/DAG）；**不是**手绘白板。 |
| **渲染** | HTML 自定义节点 + SVG 边；`onlyRenderVisibleElements`；NodeRenderer **只订可见 id**，单节点 wrapper 隔离拖移重渲染。 |
| **数据** | 宿主管 nodes/edges；库管 viewport/selection。 |
| **许可** | 核心 MIT；对齐/分组/撤销等在 Pro。 |

**偷**

- 「列表订 id、单项订自身」渲染分裂 —— 可落到 `FreeCanvasView`。
- 固定 `w/h` + 显式锚点，避免为测 handle 强渲染屏外节点。
- 边与节点分层（`EdgeLayer` 已同向）。

**避**

- 当白板 SDK 依赖；Pro 功能用自研替代。

来源：[React Flow Performance](https://reactflow.dev/learn/advanced-use/performance)（核实 2026-09-15）。

---

## 2. 长尾（轻量）

| 系统 | 一句学习点 | 对 FC |
|---|---|---|
| **Miro** | Frame 导航/分享深链；对象类型可互转（sticky↔shape） | P2：壳转换 sticky↔panel |
| **Scrintal** | 卡可跨 board 复用且**外观可不同**；折叠成 post-it | 远期 contentRef；短/长形态切换 |
| **Apple Freeform** | 素材堆叠白板；无知识卡/深链 | 交互直觉参考，非数据模型 |
| **markvault** | 关系边 vs 自主连线分轨；翻卡契约；绕障路由 | 边语义分型；绕障 P2 |
| **quickdraw** | MIT、diff 友好；0.x | 只观察 |
| **leafer-ui** | 国产 Canvas 引擎，自称百万层 | 仅当 DOM 真瓶颈再评 |
| **xiaoiver tutorial** | WebGL/WebGPU + ECS 教程 | 预习材料，非产品依赖 |
| **OpenCove / ThoughtDAG** | Agent×画布；xyflow；「线即上下文」 | 产品叙事可借，非 FC 内核 |
| **ThinkEx / Ciphertides / Noteriv** | 画布上的 **front/back** 多是复习闪卡 | **对照**：你们是双面记录，勿混成 SRS |
| **OCIF v0.7** | nodes↔resources 分离 | 观察；先 JSON Canvas |

---

## 3. 横切设计模式

### 3.1 Document vs ViewState

| Document（应落盘） | ViewState（不应落盘 / 或仅会话） |
|---|---|
| placements、edges、title、schemaVersion | 选中集、工具模式、hover、连线预览 |
| face、front/back 内容 | 翻面动画播放中 |
| viewport（已选落盘 ✅） | 临时对齐参考线 |

### 3.2 空间索引 / 剔除 / LOD

1. RBush 索引 `transform` AABB；阈值建议总节点 >1000 或可见 >300。
2. 剔除：`display:none`/`visibility` 类，**保留命中与导出语义**。
3. LOD：远距关掉阴影、3D 透视、Markdown 预览 → 纯色块+标题。
4. 翻面动画中的卡：`canCull=false`（或动画期钉住）。

### 3.3 Binding / Edges：一等 vs 装饰

| 层级 | 含义 | mindcanvas |
|---|---|---|
| L0 装饰线 | 只存像素端点 | ❌ 勿停这里 |
| L1 拓扑边 | from/to uuid + 锚 | ✅ 已有 |
| L2 Binding | 端点随形变；删级联；拷贝策略 | **下一阶段** |
| L3 语义边 | 类型/颜色/可失效 | 可选 |

### 3.4 双面 / 背面笔记（稀缺）

| 产品 | 形态 | 与你们 |
|---|---|---|
| mindcanvas / markvault | 整卡 3D，`face` 持久 | **主航道** |
| Noteriv / ThinkEx / Ciphertides | 复习翻卡 / SM-2 | 勿产品混用 |
| Heptabase | 闪卡路线图，未上 | — |
| JSON Canvas / Excalidraw / Miro | 无双面 | 导出必损 `back` |

### 3.5 Frames / 容器 vs 自由卡

建议顺序：自由卡 → 多选对齐 → Section 背景框 →（很后）嵌套子画布。

### 3.6 工具模式 vs 无模式

已有 connect 工具：**保留**，但补键盘（V 选择 / C 连线 / Space 抓手 / Esc 退出）。

### 3.7 Keyboard-first

P0 最小集：Delete 删卡级联边、⌘/Ctrl+A 多选（先同屏）、方向键轻移、`[` `]` 层级。

---

## 4. 可抄清单（映射 FC-B..E → 下一相位）

### P0（立刻，产品可感 / 风险低）

| # | 借用项 | 来源 | 映射 |
|---|---|---|---|
| 1 | **JSON Canvas 导出**（zIndex 排序、`toEnd` 坑、`back` 丢失文案） | JSON Canvas | E 宿主 I/O |
| 2 | **ViewState 纪律清单**（选中/工具永不进 JSON） | Excalidraw | 规格铁律 |
| 3 | **边随卡动**（拖移重算几何，仍存拓扑） | tldraw Binding / FigJam | 强化 D |
| 4 | **拖移批落盘**（move 中内存，up 写 doc） | Kinopio ops queue | B/E 性能 |
| 5 | **键盘最小集** + Esc 退工具 | 白板通识 | B/D UX |

### P1（下一批核心）

| # | 借用项 | 来源 | 映射 |
|---|---|---|---|
| 6 | **RBush + boundsEpoch**（规格先写接口） | tldraw | B 性能 |
| 7 | **渲染分裂**：可见 id 列表 vs 单卡订阅 | xyflow | React 层 |
| 8 | **LOD**：远距关 shadow / 简化 Markdown | tldraw LOD | C 视觉成本 |
| 9 | **多选 + 框选 + 对齐** | Miro / Heptabase | B 升级 |
| 10 | **Section/Group 框**（无父子树先做视觉组） | JSON Canvas group | 新 placement kind |
| 11 | **边 label 就地编辑**（协议已有） | Kinopio / JSON Canvas | D |
| 12 | **锚点四边优先**（center 仅内部默认） | JSON Canvas 互通 | D/导出 |

### P2（差异化 / 可延后）

| # | 借用项 | 来源 | 备注 |
|---|---|---|---|
| 13 | 边绕障折线 | markvault edge-router | 非导图级 |
| 14 | sticky↔panel 壳转换保内容 | Miro Switch type | |
| 15 | `contentRef` / 卡库雏形 | Heptabase / Scrintal | 勿急上多板 |
| 16 | 导图→画布**单向导出** | AFFiNE 对照 | |
| 17 | 关系边 vs 自由边分型 | markvault | 语义层 |
| 18 | 小地图 / 板内搜索 | Heptabase | |
| 19 | OCIF resources 分离 | OCWG | 有采纳再动 |
| 20 | transform-only / `contain` 层 | tldraw | 与 6/7 一起 |

### 明确不做（现阶段）

- 引入 tldraw / Excalidraw / xyflow 作为运行时依赖
- AFFiNE 式共享 block 树
- Figma 级 WASM/WebGPU
- 把翻面做成 Anki/SRS 主路径
- 为 trending 的 agent-canvas 改产品定位

---

## 5. 对照总表

| | 隐喻 | 事实源 | 边 | 渲染 | 翻面 | 对 FC 价值 |
|---|---|---|---|---|---|---|
| tldraw | shapes+frames | store JSON | Binding 一等 | DOM+剔除 | 弱 | 性能/扩展架构 ★★★★★ |
| Excalidraw | 手绘元素 | elements∥appState | boundElements | 双 Canvas | 无 | 数据纪律 ★★★★★ |
| JSON Canvas | 笔记节点 | `.canvas` | 显式 edges | 宿主 | 无 | 互通 ★★★★★ |
| Heptabase | 卡库×白板 | 专有 | 箭头 | 未公开 | 计划中 | 产品隐喻 ★★★★★ |
| Kinopio | 卡+连 | 本地 JSON | path+拓扑 | DOM+SVG | 无 | local-first 工程 ★★★★ |
| Figma | 设计树 | 专有 | 约束/原型 | WASM/GPU | 无 | 原则 ★★★ |
| xyflow | 节点图 | 宿主 | edges | HTML+SVG | 无 | React 渲染拆分 ★★★★ |
| **mindcanvas FC** | sticky/panel | `.mc.canvas.json` | 拓扑边 | React+DOM | **双面记录** | — |

---

## 6. 来源与未核实

**主来源（均 2026-09-15 前后核对）**  
tldraw docs · Excalidraw JSON/scene schema · jsoncanvas 1.0 · Heptabase wiki · Kinopio offline 文 + API · Figma 工程博客 · React Flow performance · Miro/FigJam help · Scrintal features · 仓库内 09-11 调研 / FC spec / markvault。

**未核实（勿当事实）**

- Frank Anaya 布局元数据存哪 / 是否开源
- Noteriv 画布落盘格式
- OCIF 真实采纳名单
- tldraw 商业报价第三方数字
- Heptabase / Miro 内部渲染栈
- leafer「百万图层」基准条件

---

## 7. 执行建议（三句）

1. **下一相位默认顺序**：JSON Canvas 导出 → 边随动+批落盘 → 多选/键盘 → RBush 规格与实现。
2. **对外一句话卖点**：布局可 diff、双模式互不污染、翻面是双面记录（不是闪卡）。
3. **架构红线不变**：无付费 SDK；Document/ViewState 分离；DOM 卡面优先于 Canvas/WebGL。
