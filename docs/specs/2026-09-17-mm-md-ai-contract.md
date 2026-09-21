# `.mm.md` AI 读/写契约

> 日期：2026-09-17  
> 状态：**生效（D2）**  
> 读者：外置 Agent（Cursor / Codex / Claude Code 等）与编写 Skill 的人  
> 句法权威：[`2026-09-02-mm-md-protocol.md`](./2026-09-02-mm-md-protocol.md)  
> 设计来源：[`2026-09-17-agent-diagram-genre-skill-design.md`](./2026-09-17-agent-diagram-genre-skill-design.md)（路线 A）

**本页管语义纪律；协议页管解析/序列化硬规则。冲突时以协议为准。**

---

## 0. 定位

mindcanvas **不提供**画布内 Agent、操作 MCP、或 30 个 function calling 工具。  
Agent 与图的交互只有：

| 方向 | 做什么 | 交付 |
|---|---|---|
| **读** | 打开/粘贴用户的 `.mm.md`（或选中子树 Markdown） | 复述岛、主路径、跨岛关系 |
| **画** | 按自然语言写出合法 `.mm.md` | 用户用 mindcanvas 打开即可读 |

禁止：声称调用了「画布 API」；只交 PNG/SVG 当事实源；发明协议未定义的顶层字段。

---

## 1. 读图守则

### 1.1 必读顺序（勿跳读）

1. **H1 根 + 标题/列表树** — 父子 = 结构从属，**不是**因果/依赖/调用。  
2. **根节点笔记块**里的 `centers` / `cid` / `next_cid` / `sections` — 多岛与分区（协议 §5–§6.3–§6.4）。  
3. **文档级 `edges` 块**（文件头、不隶属节点）— 跨岛 / 非父子语义边（协议 §6.2；ADR-0008：自由边活跃面）。  
4. **实体与资源**：`@kind:id`、`@img:`、`@draw:`。  
5. **理解语义时可忽略**：`pos` / `lens` / `beamAt` / `len` / `hub` / `frame` 等纯视觉与布局微调。

节点级 `links`（协议 §6.1）是源节点上的关系声明；画布级自由连线以文档级 `edges` 为准。读「图在讲什么」时两者都要看，但不要把 `links` 当成布局坐标。

### 1.2 理解规则

- 跨主题关系 **必须** 在 `edges`（或明确写出的 `links`）里找；禁止脑补未写出的边。  
- 多 `centers` = 多岛；岛内树是局部大纲。  
- Section 锚定子树框（通常伴随 center）；dangling section 数据保留，勿擅自删除。

### 1.3 读完复述模板（必填）

```text
主路径一句话：…
岛清单：（cid / 标题 / 生长方向 dir）…
跨岛关系：（edges 摘要；无则写「无文档级自由边」）…
实体/资源：（若有）…
```

填不出「主路径」→ 重新读树与 centers，不要用空话搪塞。

### 1.4 上下文优先

若用户粘贴了**选中子树** Markdown：先理解子树；需要岛/边全局语义时再读全文根 note 与文件头 `edges`。

---

## 2. 写图守则

### 2.1 流程

```
自然语言
  → 澄清范围（边界/深度/受众）——最多 1 轮；缺省「可读优先、节点宁少」
  → 选体裁（§3）
  → 起草大纲（落在 §4 预算）
  → 写成 canonical 合法 .mm.md（协议 §九；缩进相对层级一致，建议 2 空格）
  → 自检（§4）
  → 不写 pos / lens / beamAt（交给产品默认布局）
```

### 2.2 内容

- 标题短、可扫描；细节进 `one_liner` / `note` / `desc`，不堆长段进标题。  
- 命名具体；禁止「节点1 / 临时 / asdf」。  
- 受众默认：同事一页可读，不是数据库 dump。

### 2.3 结构

- 一岛一主题。  
- 跨主题不造假父子 → 升格 center + 文档级 `edges`。  
- `centers[].cid` 与对应节点 `note.cid` 一致；需要 section 时 `sections[].root` **写入一律 `cid:`**（协议 §6.4）。  
- 分配新 cid 时维护 `next_cid`（单调、不复用）。

### 2.4 最小合法骨架

文档级 `centers` / `edges` / `sections` 写在 **H1 之前**的笔记块（归属根）；子节点 `cid` 写在该节点之前的笔记块。形态对齐协议实测（见 `section-roundtrip` 夹具）。

```markdown
<!--
next_cid: 3
centers:
  - at: "node:系统/API"
    cid: c1
    dir: right
  - at: "node:系统/DB"
    cid: c2
    dir: right
edges:
  - from: "cid:c1"
    to: "cid:c2"
    rel: depends
    source: manual
-->
# 系统

<!--
cid: c1
one_liner: 接入层
-->
## API

<!--
cid: c2
one_liner: 持久化
-->
## DB
```

> 笔记块归属其后的节点（协议 §2.1）；根 note 在 H1 前，子节点 note 在对应标题前。  
> **锚必须带前缀**：`cid:…`（升格节点优先）或 `node:根/…` 路径。裸路径如 `系统/API` **不能**被 `parseLinkAnchor` 识别 → 自由边记为「陈旧」。  
> （`cid:` 边锚由 `collectFreeEdges` 走内核 cid 索引；勿把 `cid:` 误当成实体。）  
> 写出后须可 parse 往返；不确定时模仿产品「保存」后的 canonical。

---

## 3. 体裁 → mindcanvas 模式

**口诀**：体裁 → 几座岛 → 岛内树还是岛间边 → 文案。

| 意图 | 载体 | 模式 | 慎用 |
|---|---|---|---|
| 架构 / 系统组成 | `.mm.md` | 每服务/层一个 **center**；依赖走 **edges**；边界可用 section | 一棵深巨树 |
| 流程 / 步骤 | `.mm.md` | 单主干深树；分支=兄弟；异常进 note | 无必要多中心 |
| 因果 / 依赖网 | `.mm.md` | 源点作中心；树骨架 + 跨支 edges | 环写成父子 |
| 对比 / 方案 | `.mm.md` | 2–4 并列中心，同构子树 | 硬做成时间线 |
| 组织 / 汇报 | `.mm.md` | 单根分层；H2≈一级 | edges 过多 |
| 空间拼贴 | `.mc.canvas.json` | 自由画布 | 硬用导图 |
| 已有示意图 | `.mm.md` | `@img:` **+** 文字结构摘要 | 仅图无字 |

因果图若已有 `graph.json`，可参考 `graphJsonToMindmap` 策略手写等价 `.mm.md`；**不要**假设画布有「打开 graph.json」按钮。graph-engine MCP 是只读探针，不是画图 API。

---

## 4. 质量闸（写完必跑）

| 闸 | 默认 |
|---|---|
| 节点数 | 架构 8–20；流程 6–15；对比每侧 ≤8 |
| 深度 | ≤4（流程可 5）；协议硬上限 16 |
| 中心数 | 架构 3–8；流程通常 1；对比 2–4 |
| edges | 仅跨岛/非树语义；禁止装饰边；锚用 `cid:`/`node:` |
| 多岛落位 | 要四向构图须写 `centers[].x/y`；缺省会横向串排 |
| 协议 | 可 parse；无非法 note YAML；未知字段可保留但勿发明新「文档级」面 |
| 读回 | 用 §1.3 模板自检；填不出主路径则改结构 |

用户 NL 明确要求「更深 / 更多节点」时可放宽预算，并在回复里说明。

---

## 5. 与产品能力的边界

| 能力 | Agent |
|---|---|
| `.mm.md` 文件 | **主通道** |
| Centers / edges / sections | 按本契约读写 |
| `@img` / 目录工作区 / AssetHost | 可引用已有资源；不伪造仓库外 URL 当本地资产 |
| graph-engine MCP | 只读理解材料；画图仍写 `.mm.md` |
| 画布操作 MCP / 内嵌 Agent | **不存在；勿调用** |

---

## 6. 修订

| 日期 | 说明 |
|---|---|
| 2026-09-17 | D2 初版：读序、写流程、体裁表、质量闸、最小骨架 |
| 2026-09-17 | D3：外置 Skill `.cursor/skills/mindcanvas-diagram/` |
