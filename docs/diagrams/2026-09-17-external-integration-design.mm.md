<!--
next_cid: 11
centers:
  - at: "node:外接开发设计思路/交互边界"
    cid: c1
    dir: right
    x: 1070.8151518767227
    y: 652.7262303309222
  - at: "node:外接开发设计思路/事实源"
    cid: c2
    dir: right
    x: 451.47790870706876
    y: -95.42106370934573
  - at: "node:外接开发设计思路/产品接缝"
    cid: c3
    dir: right
    x: 2612.4153396139045
    y: 655.634423502281
  - at: "node:外接开发设计思路/Agent契约"
    cid: c4
    dir: down
    x: 2375.4669907591906
    y: -942.6506575007118
  - at: "node:外接开发设计思路/明确不做"
    cid: c5
    dir: left
    x: 2578.2023215943254
    y: -213.36815395649296
  - at: "node:外接开发设计思路/可选演进"
    cid: c6
    dir: up
    x: 4491.291199598102
    y: -223.74464760806043
  - at: "node:外接开发设计思路/Agent契约/读序（强制）"
    dir: right
    cid: c7
    x: 1340.2778277688908
    y: -671.2119399116528
  - at: "node:外接开发设计思路/Agent契约/画图路由"
    dir: right
    cid: c8
    x: 1753.204521184104
    y: -649.086374065902
  - at: "node:外接开发设计思路/Agent契约/质量闸"
    dir: right
    cid: c9
    x: 2201.3494445300094
    y: -634.4187001495477
  - at: "node:外接开发设计思路/Agent契约/已交付"
    dir: right
    cid: c10
    x: 2599.266453288515
    y: -641.0428570632728
sections:
  - id: sec_core
    title: 已落地主路径
    color: green
    root: "cid:c2"
  - id: sec_plan
    title: 规划中
    color: amber
    root: "cid:c6"
  - id: sec_mu54vdoj8r4v4
    root: "cid:c4"
    title: Agent契约
    color: slate
  - id: sec_mu5c47x941nl3
    root: "cid:c7"
    title: 读序（强制）
    color: slate
  - id: sec_mu5kjjtx1hm6g
    root: "cid:c8"
    title: 画图路由
    color: slate
  - id: sec_mu5kjp6s53w3r
    root: "cid:c9"
    title: 质量闸
    color: slate
  - id: sec_mu5kjtj7kv19
    root: "cid:c10"
    title: 已交付
    color: slate
edges:
  - from: "cid:c1"
    to: "cid:c2"
    rel: uses
    label: 读写仅此
    source: manual
  - from: "cid:c2"
    to: "cid:c4"
    rel: governed-by
    label: 读序+体裁
    source: manual
  - from: "cid:c4"
    to: "cid:c5"
    rel: excludes
    label: 减法
    source: manual
  - from: "cid:c3"
    to: "cid:c2"
    rel: hosts
    label: 打开保存
    source: manual
  - from: "cid:c6"
    to: "cid:c3"
    rel: extends
    label: Host/Sidecar
    source: manual
  - from: "cid:c6"
    to: "cid:c4"
    rel: feeds
    label: G9上下文
    source: manual
-->
# 外接开发设计思路

<!--
one_liner: 外置Agent两向；产品不内嵌模型
cid: c1
-->
## 交互边界

### 读图

#### 打开或粘贴 `.mm.md`

#### 复述主路径 / 岛 / 跨岛边

##### 禁止把父子当因果

### 画图

#### 自然语言需求

#### 产出可打开的导图

##### 体裁先于文案

### 通道纪律

#### 仅工作区文件

#### 无画布内会话状态

<!--
one_liner: .mm.md 即 Agent 接口
cid: c2
-->
## 事实源

### 主载体 `.mm.md`

#### 人可读 / git merge

#### parse → serialize 往返

##### 协议权威句法

### 辅载体

#### `.mc.canvas.json`

##### 仅空间拼贴体裁

#### SVG / PNG 导出

##### 展示用，非 Agent 事实源

### 文档级语义面

#### `centers` / `cid`（岛）

#### `edges`（跨岛关系）

#### `sections`（分区框）

<!--
one_liner: 换 Host 接入，不改 MapView
cid: c3
-->
## 产品接缝

### 宿主族

<!--
desc: 资源读写口：Demo 内存 / IndexedDB / 工作区文件三套实现，换实现不改画布
-->
#### AssetHost（Demo / Idb / Workspace）

<!--
desc: 目录型工作区：把文件夹当文档库根，管打开/枚举路径
-->
#### DirectoryWorkspace

<!--
desc: 文档生命周期：打开·保存·切换；Canvas 壳用 CanvasDocHost 特化
-->
#### DocumentHost / CanvasDocHost

#### EntityHost

<!--
desc: 本地实体库：画布 @实体 的进程内存储，无网络
-->
##### LocalEntityStore

<!--
desc: 远程实体：经 Sidecar/HTTP 拉实体；真服务未齐时的接入位
-->
##### HttpEntityHost（等 Sidecar）

<!--
desc: 插件挂载点：demoPlugin 示范如何往壳上挂扩展
-->
#### PluginHost + demoPlugin

### 旁路能力

#### graph-engine MCP

<!--
desc: 只查图/诊断，不改 .mm.md、不驱动画布操作
-->
##### 只读探针

<!--
desc: 图分析类 API，不是「在画布上画节点」那条链路
-->
##### 非画图 API

#### ChannelRegistry

<!--
desc: 对外通道登记表：rest/mcp/skill 槽位已留，实现仍空
-->
##### rest/mcp/skill 槽位空壳

### 适配器

#### `graphJsonToMindmap`

<!--
desc: 把因果/依赖 JSON 收成多中心导图 + 文档级自由边
-->
##### 因果图 → 多中心+自由边

<!--
desc: 转换器有了，产品菜单里还没有「一键打开 graph.json」
-->
##### 画布壳暂无一键入口

<!--
one_liner: 路线A：契约 + 外置 Skill
cid: c4
-->
## Agent契约

<!--
cid: c7
-->
### 读序（强制）

<!--
desc: 测试成框编辑
-->
#### 树结构

#### 根 note：centers / sections

#### 文档级 edges

#### `@` 实体与资源

#### 忽略 pos / lens / beamAt

<!--
cid: c8
-->
### 画图路由

#### 架构：多中心 + edges

#### 流程：单主干深树

#### 对比：并列同构中心

#### 口诀：体裁 → 岛数 → 树或边 → 文案

<!--
cid: c9
-->
### 质量闸

#### 节点 / 深度 / 中心数预算

#### 禁止装饰边

#### 写出后读回自检

<!--
cid: c10
-->
### 已交付

#### D2 `mm-md-ai-contract`

#### D3 `mindcanvas-diagram` Skill

##### examples + checklist

<!--
one_liner: 对齐 PG 减法
cid: c5
-->
## 明确不做

### 运行时

#### 画布内嵌 Agent

#### 操作类 MCP

#### PG 式 30 tools / CLI

### 交付形态

#### 生图 PNG 当唯一事实源

#### 独立 Archify IR 渲染器

### 写回纪律

#### 未验证提议质量就 apply

#### B 线五端点全家桶先行

<!--
one_liner: 顺着接缝长
cid: c6
-->
## 可选演进

### Agent 体验

#### G9 复制选中子树 Markdown

##### 缩小上下文

#### 样例库扩充（对比等）

### 产品接缝加强

#### 真实 FS AssetHost

#### 画布打开 graph.json

#### 首个 Channel 适配器登记

### B 线（贵）

#### B0 方法论补强

#### B1 只读提议纵切

##### 读图 → 提议面板 → 人工接受

#### B2+ Sidecar / 对账延后
