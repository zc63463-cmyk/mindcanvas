<!--
one_liner: 纯文本思维导图内核与应用
next_cid: 14
centers:
  - at: "node:mindcanvas/事实源与契约"
    cid: c1
    dir: right
    x: -1069.9761580094028
    y: -464.1283997391356
  - at: "node:mindcanvas/kernel"
    cid: c2
    dir: right
    x: -1065.0728528504003
    y: 449.3710995457972
  - at: "node:mindcanvas/free-canvas"
    cid: c3
    dir: right
    x: -1135.3514652753897
    y: 1586.781168367546
  - at: "node:mindcanvas/react"
    cid: c4
    dir: right
    x: 168.94648215514368
    y: 787.6888308791699
  - at: "node:mindcanvas/apps-canvas"
    cid: c5
    dir: right
    x: 1532.082595169388
    y: -160.25462080196033
  - at: "node:mindcanvas/graph-engine"
    cid: c6
    dir: down
    x: 657.6277493916366
    y: -784.4679440192267
  - at: "node:mindcanvas/工程门禁"
    cid: c7
    dir: left
    x: 1953.7389695087381
    y: 1025.1870925528017
  - at: "node:mindcanvas/kernel/protocol"
    cid: c8
    dir: right
    x: -1055.3033323968996
    y: 755.4734786180247
  - at: "node:mindcanvas/kernel/layout"
    cid: c9
    dir: right
    x: -988.2937397103436
    y: 1067.7736047248688
  - at: "node:mindcanvas/react/render"
    cid: c10
    dir: right
    x: 599.0204312078453
    y: 1116.0759990159356
  - at: "node:mindcanvas/react/chrome"
    cid: c11
    dir: right
    x: 608.6179365837352
    y: 1471.7320646888356
  - at: "node:mindcanvas/react/edit"
    cid: c12
    dir: right
    x: 620.0089690758608
    y: 1789.614826966203
  - at: "node:mindcanvas/事实源与契约/`.mm.md` 协议"
    dir: right
    cid: c13
    x: -805.8836324245445
    y: -994.1657715850369
edges:
  - from: "cid:c2"
    to: "cid:c1"
    rel: applies
    source: manual
  - from: "cid:c4"
    to: "cid:c2"
    rel: applies
    source: manual
  - from: "cid:c4"
    to: "cid:c3"
    rel: applies
    source: manual
  - from: "cid:c5"
    to: "cid:c4"
    rel: applies
    source: manual
  - from: "cid:c6"
    to: "cid:c1"
    rel: references
    source: manual
  - from: "cid:c7"
    to: "cid:c5"
    rel: relates-to
    source: manual
sections:
  - id: sec_data
    title: 数据与契约
    color: slate
    root: "cid:c1"
  - id: sec_kernel
    title: 无头内核
    color: green
    root: "cid:c2"
  - id: sec_protocol
    title: 协议面
    color: green
    root: "cid:c8"
  - id: sec_layout
    title: 布局引擎
    color: green
    root: "cid:c9"
  - id: sec_fc
    title: 自由画布包
    color: amber
    root: "cid:c3"
  - id: sec_react
    title: React 渲染层
    color: blue
    root: "cid:c4"
  - id: sec_render
    title: 场景渲染
    color: blue
    root: "cid:c10"
  - id: sec_chrome
    title: Chrome 面板
    color: blue
    root: "cid:c11"
  - id: sec_edit
    title: 编辑控制
    color: blue
    root: "cid:c12"
  - id: sec_app
    title: 应用壳
    color: violet
    root: "cid:c5"
  - id: sec_agent
    title: Agent 计算（旁路）
    color: rose
    root: "cid:c6"
  - id: sec_gate
    title: 工程门禁
    color: slate
    root: "cid:c7"
  - id: sec_mu6xvfzi85fie
    root: "cid:c13"
    title: "`.mm.md` 协议"
    color: slate
desc: 微内核 + 插件 + 渐进增强；库优先，Web/PWA local-first
-->
# mindcanvas

<!--
one_liner: 规格权威与事实源（非代码包）
cid: c1
desc: 外置 Agent 只经文件通道；禁止发明未定义文档级字段
-->
## 事实源与契约

<!--
cid: c13
-->
### `.mm.md` 协议

#### 规格 docs/specs/2026-09-02-mm-md-protocol.md

#### 树 + 笔记块（归属其后节点）

#### centers / cid / next_cid

#### 文档级 edges（自由边活跃面）

#### sections（root 一律 `cid:`）

#### 实体 `@kind:id` / `@img` / `@draw`

### 边数据三面（ADR-0008）

#### `edges`：跨岛自由边

#### `links`：源节点关系声明

#### 树边：父子从属（非因果）

### AI 读/写契约

#### 规格 docs/specs/2026-09-17-mm-md-ai-contract.md

#### 读序：树 → centers → edges → 实体

#### 体裁路由：架构多岛 / 流程单干

#### Skill：`.cursor/skills/mindcanvas-diagram`

### 自由画布规格

#### 载体：`.mc.canvas.json`

#### 便签 / 翻面 / 卡间连线

#### 与导图并列子模式（非替代）

### 关键 ADR

#### 0004 接口冻结（semver）

#### 0005 依赖方向守护

#### 0006 SVG 主 / Canvas 实验降级

#### 0009 节点自由生长两步走

<!--
one_liner: "@mindcanvas/kernel · 零 React / 零 DOM"
cid: c2
desc: 依赖链终点；三项目共享协议层扩展点勿按本仓消费删
-->
## kernel

### tree / 编辑

#### TreeOp / history

#### 结构变更与撤销

### registry / plugin

#### Kind / Layout / NoteKey / Renderer

#### Channel / Semantics

#### 六注册表扩展点（ADR-0004）

### entity / adapters

#### 实体解析与 URI

#### 适配器边界（对外消费者）

<!--
one_liner: 解析 / 序列化 / 类型面
cid: c8
desc: 往返可 parse；未知 note 字段透传
-->
### protocol

#### parser / serializer

#### types / note / uri

#### section / frame

#### goldenCases（协议夹具）

<!--
one_liner: 无头几何与岛布局
cid: c9
desc: measure → mindmap/forest → islands；供 react 消费坐标
-->
### layout

#### measure / wrap / fit

#### mindmap / branching / forest

#### islands / separate / spatialIndex

#### frameLayout / framePartition

#### relations / linkClear / cull

<!--
one_liner: "@mindcanvas/free-canvas · 文档模型包"
cid: c3
desc: 无重 UI；apps + react 共同依赖
-->
## free-canvas

### 文档面

#### document / types

#### ops（便签·连线·翻面）

#### factory

### 视口与守卫

#### viewport

#### guards

#### 与导图坐标空间隔离

<!--
one_liner: "@mindcanvas/react · 渲染与交互"
cid: c4
desc: 可依赖 kernel + free-canvas；跨包只引包根
-->
## react

### theme / 视觉档

#### tokens（classic / glass / sticker）

#### DEPTH-VIS：root / branch / leaf 卡与字阶

#### CHROME.textMuted ≠ 叶标题

### search / runtime / demo

#### 搜索面板数据面

#### runtime 调度辅助

#### demo pipeline（夹具场景）

<!--
one_liner: SVG 场景构建与手势
cid: c10
desc: ADR-0006：SVG 为主；MapView 为组合中枢
-->
### render

#### MapView / sceneBuilder

#### NodeG / LinkG / geometry

#### edgeRouting / FreeEdgeLayer

#### sectionFrames / islandOverview

#### freeEdgeFrameAnchor（FE-FRAME）

#### viewport / gestures / LOD

<!--
one_liner: 面板、浮层、导出、资产
cid: c11
desc: Stage 条件挂载的 chrome 集群
-->
### chrome

#### Outline / Search / ShortcutHelp

#### EdgeEditor / ContextMenu

#### AssetPanel / EntityGraph

#### ThemeSwitcher / exportSvg·Png

#### DescBlock / FrameOutline / Note 浮层

<!--
one_liner: 编辑控制器与文档宿主
cid: c12
desc: TreeOp 入口；目录/保存/径向菜单
-->
### edit

#### controller / useEditor

#### OverlayEditor（就地改标）

#### document / save / directoryHost

#### radialActions / sharedCommands

#### frameCommands / textLinks

<!--
one_liner: apps/canvas · 只做组合
cid: c5
desc: 不含业务逻辑；拼 kernel + react + free-canvas
-->
## apps-canvas

### 导图舞台

#### MindmapStage（壳与接线）

#### SidePanels / StartupScreen

#### RecentDoc / UnsavedPrompt

### 自由画布舞台

#### FreeCanvasStage

#### canvasDocHost

#### EdgeDraftLayer

### 文件与工作区

#### FileManager（树 / 模态 / 菜单）

#### fileTreeModel

#### 本地目录宿主

### 交互增强（应用层）

#### 径向预览 / LenBubble / FrameDepthBubble

#### NodeContextMenu 袋装动作

#### beam / len 编辑辅助

<!--
one_liner: tools/graph-engine · Agent 计算旁路
cid: c6
desc: FastMCP 只读探针；不是画图 API
-->
## graph-engine

### 计算核心

#### NetworkX DAG（环 / 拓扑 / 闭包 / 可达）

#### 编译缓存 `.engine/cache/*.graph.json`

### 提取与服务

#### Forgejo 领域提取器

#### BaseDomainExtractor 插件槽

#### FastMCP：`inspect_node_chain` 等

### 与产品边界

#### 只读理解材料

#### 画图仍写 `.mm.md` 文件通道

#### 规格：`docs/specs/2026-09-08-graph-engine-spec.md`

<!--
one_liner: 质量与依赖自动化
cid: c7
desc: pre-commit / pnpm gate 固化 CONTRIBUTING
-->
## 工程门禁

### 分层守护

#### depcruise：canvas → react → kernel

#### 禁止子路径深引用

#### kernel 零 DOM

### 质量闸

#### `pnpm gate`：tsc + 全量测试 + lint + budget

#### biome 风格门禁

#### 导出面显式具名（禁 `export *`）

### 验证工具

#### `tools/verify-*.mjs` 交互探针

#### `scripts/analyze-codebase.mjs`

#### Playwright / dogfood 输出
