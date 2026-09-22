# `.mm.md` 协议规格 v1.3.1

> 日期：2026-09-02 · 状态：**生效**
> 适用：`@mindcanvas/kernel` ≥ 1.0.0（接口冻结自 ADR-0004）
> 共享方：Forge 知识画布 / markvault-js MindFlow / markvault-reborn（见 `packages/kernel/src/protocol/types.ts` 头注）
>
> 本文每条规则均**经行为实测**，探测脚本 `apps/canvas/scripts/diag-protocol-probe.mts` 可复现：
> ```bash
> cd apps/canvas && npx vite-node scripts/diag-protocol-probe.mts
> ```

---

## 一、定位与设计原则

`.mm.md` 是**纯文本思维导图事实源**：既是人可读、可 diff、可用任意编辑器修改的 Markdown，
又是结构化的思维导图数据。

三条不可动摇的原则：

| 原则 | 含义 |
|---|---|
| **数据无损** | `parse → serialize → parse` 结构等价；序列化幂等 |
| **前向兼容** | 未知 kind、未知字段一律保留，绝不丢弃 |
| **宽松读入、规范写出** | 解析容忍各种手写形态；序列化输出 canonical 格式 |

**外置 Agent 读/写纪律**（体裁路由、质量闸、复述模板）见独立契约：  
[`2026-09-17-mm-md-ai-contract.md`](./2026-09-17-mm-md-ai-contract.md)。句法冲突时以本文为准。

---

## 二、文件结构

### 2.1 整体形态

```
<!--                      ← 文档级 edges（可选，见 §5.2）
edges:
  - from: node:路径/到/源
    to: "@issue:8"
    rel: blocks
-->
# 根                      ← H1，有且仅应有一个

## 分支 A                 ← H2–H6
- 列表项
  - 子项

## 分支 B
- @issue:1                ← 实体引用
<!--                      ← 笔记块（归属其**后**的节点）
one_liner: 一句话
-->
- 另一个节点
```

### 2.2 行词法

解析器逐行分类（**首个匹配即止**）：

| 形态 | 正则 | 归类 |
|---|---|---|
| `[ \t]*<!--[ \t]*` | 独占一行 | 笔记块开始 |
| `[ \t]*-->[ \t]*` | 独占一行 | 笔记块结束 |
| `[ \t]*<!--.*-->[ \t]*` | 单行内闭合 | 行内注释（忽略） |
| `[ \t]*` | 空行 | 忽略 |
| `#{1,6}[ \t]+标题` | H1–H6 | 标题 |
| `#{7,}` | 7 个以上井号 | 非法标题 → `W-STRAY-LINE` |
| `[ \t]*-[ \t]+内容` | 列表项（内容非空） | 列表项 |
| 其他 | — | 杂散行 → `W-STRAY-LINE` |

> 行尾统一归一化为 `\n`（`\r\n` 与 `\r` 均接受）。

### 2.3 缩进规则（**重要：相对而非绝对**）

列表层级由**缩进的相对大小**决定，**不是**固定的 2 空格：

```
- a          - a
  - b    ≡       - b      ≡   - a
    - c             - c           - b
                                      - c
```

实测：`0/2/4`、`4/8`、`tab` 三种写法产生**完全相同**的结构。
tab 在度量时折算为 4 个空格。

> 含义：手写时缩进风格自由，但**同一文档内应保持一致的相对层级**。
> 序列化输出统一为 2 空格缩进。

---

## 三、节点类型

列表项内容按 **R1 → R2 → R3** 优先级分类：

| 优先级 | 形态 | 结果 |
|---|---|---|
| R1 | `@kind:id`（kind 合法：小写字母开头 + `[a-z0-9_]`） | 实体节点（见 §4） |
| R1′ | `@XXX:` 有引用意图但 kind 非法（如 `@ISSUE:42`） | 文本节点 + `W-INVALID-REF` |
| R2 | `![alt](url)` | 图片节点 |
| R3 | 其他 | 文本节点 |

> R1′ 存在的意义：把"想写引用但写错了"和"就是一段普通文字"区分开，前者给出诊断。

---

## 四、实体引用

### 4.1 语法

```
@<kind>:<id>
```

- `kind`：`[a-z][a-z0-9_]*`（小写字母开头）
- `id`：按 kind 校验（见下表）

### 4.2 已注册 kind 与 id 校验

| kind | id 规则 | 示例 |
|---|---|---|
| `issue` / `pr` | 纯数字（不以 0 开头） | `@issue:1` `@pr:12` |
| `doc` / `img` / `draw` | 相对路径，禁绝对路径、禁 `\`、禁 `..` 与 `.` 段、每段不含 `@ :` 与控制字符、总长 ≤512 | `@doc:docs/a.md` |
| `milestone` / `note` | 非空、不含 `@ :` 与控制字符 | `@milestone:M1` |
| `idea` | 可选项目前缀 + 数字：`[a-z][a-zA-Z0-9_-]*:?<数字>` | `@idea:proj:3` |
| `annotation` | `[A-Za-z0-9][A-Za-z0-9._-]*` | `@annotation:anno-1` |
| **未注册 kind** | **不校验**，原样保留 | `@unknownkind:xyz` |

**前向兼容（关键）**：未注册 kind **仍解析为实体节点**并保留到 `refs`，仅附 `W-UNKNOWN-KIND` 诊断。
这样 v0.3 引入新 kind 时，存量文件不会退化成文本。

### 4.3 跨库前缀（v0.2.2）

`id` 可带 `org:` 或 `org/repo:` 前缀，校验时先剥离前缀再按上表校验本体：

```markdown
- @issue:myorg/repo:42      ← 合法，本体为 42
```

> 例外：`idea` 的前缀是**项目名**语义，不适用跨库语法。

---

## 五、笔记块

### 5.1 语法与归属

```markdown
- 节点 A
<!--
one_liner: 摘要
-->
- 节点 B
```

- 笔记块由独占一行的 `<!--` 与 `-->` 包裹
- **归属其后的第一个结构节点**（上例中归 `节点 B`，不是 `节点 A`）
- 公共缩进会被剥离，因此列表下缩进书写是合法的
- 无后继节点 → `W-ORPHAN-NOTE`，笔记丢弃
- 未闭合 → `E-UNCLOSED-NOTE`，整体丢弃
- 内容非 YAML mapping → `E-INVALID-NOTE-YAML`，整体丢弃
- 前一个未绑定笔记被新的覆盖 → `W-NOTE-SHADOWED`

### 5.2 字段

已知字段的固定顺序（序列化时按此输出）：

```
one_liner → decisions → status → next → reminder
```

**其余字段**（`desc` / `qa` / `links` / `edges` 等）不在固定序列内，
按对象插入顺序（即解析时的书写顺序）排在上述 5 个之后，随后是未知字段。

> 实测：`KNOWN_NOTE_ORDER` 仅含 5 个字段（`packages/kernel/src/protocol/serializer.ts`）。
> 不要假设 `desc` / `qa` / `links` 有固定位置。

| 字段 | 类型 | 说明 |
|---|---|---|
| `edges` | 对象列表 | **文档级**标注边（写于文件头，§6.2） |
| `centers` | 对象列表 | **文档级**中心标注（升格节点，§6.3） |
| `center_pos` | 对象列表 | **文档级**降格中心的历史坐标暂存（§6.3） |
| `sections` | 对象列表 | **文档级**空间分区清单（v1.5.0，§6.4） |
| `one_liner` | string | 一句话摘要 |
| `status` | string | 状态 |
| `next` | string 或 string[] | 下一步 |
| `reminder` | string | 提醒 |
| `desc` | string | 幕布风格描述（v1.3.0），多行以 `\n` 转义 |
| `note` | string[] | 节点注释 · 序列区域（v1.4.0，§5.4） |
| `note_text` | string | 节点注释 · 纯文本区域（v1.4.0，§5.4） |
| `qa` | string[] | 快速注释，多条目按需展开 |
| `cid` | string | 子树持久身份 id（09-05 批次；文档根另有 `next_cid` 单调计数器） |
| `dir` | string | 生长方向：`right/left/down/up`（09-06 批次，ADR-0009 第一步） |
| `len` | number | 出线长度：本节点与父节点连线的直线段长度（v1.6.0） |
| `lens` | `{up?/down?/left?/right?}` | 父节点四个方向组的缺省出线层距（v1.7.0） |
| `beamAt` | `{up?/down?/left?/right?}` | 共享梁**比例位**（v1.11.0）：梁在「父出边 ↔ 最近子入边」空隙中的位置，0..1，缺省/非法 = 0.5（中点）；读侧钳到两侧各留 ≥ LINK_CLEAR_MARGIN；≈0.5 的方向键不落盘 |
| `hub` | boolean | 出线枢纽：left/right 组走共享竖梁 bus（v1.7.0） |
| `frame` | `{version:1, depth:number}` | 子树框编辑（持久框）：`depth` 为有限整数 ≥ 1，从框根起算前 `depth` 层进框内大纲（访问器 `protocol/frame.ts`） |
| `links` | 对象列表 | 节点级关系（§6.1） |
| `decisions` | string[] | 决策记录 |

**未知字段一律透传**（`Note` 有 `[key: string]: unknown`），序列化时排在已知字段之后。
这是前向兼容的核心机制。

### 5.3 值形态

**标量**
```yaml
one_liner: 摘要
edge: {"rel":"blocks","dir":"back"}     # {...} 形态尝试 JSON 解析，失败回落字符串
```
实测：`{"rel":"blocks"}` 解析为对象 → 序列化为带引号的 JSON 字符串 `"{...}"` → 再解析回对象，**往返无损**。

**字符串列表**
```yaml
qa:
  - 问题一
  - 问题二
```

**对象列表（1.1.0 起，用于 `links` / `edges`）**
```yaml
links:
  - rel: blocks
    to: "@issue:1"
    dir: back
```

对象项判别是**保守的三条件判定**（避免误伤冒号字符串）：

1. 不以引号开头
2. 形如 `- key: value`
3. **紧随续行字段**（下一非空行有缩进且为 `key: value`）

> 因此 `qa` / `decisions` 这类冒号字符串列表行为不变。

**转义规则**：多行文本（如 `desc`）以 `\n` 转义写入，解析时还原为真实换行。

序列化器在以下任一情形**强制加双引号**并转义（防止被重解析为别的结构）：

| 条件 | 例 |
|---|---|
| 空串 | `key: ` |
| 首尾有空白 | `key: " x "` |
| 以特殊字符开头 | `" ' [ ] { } > \| & * ! # % @ \` ,` |
| 以 `- ` 开头（防误判为列表项） | `- foo` |
| 值为 `---` 或 `-->` | 防 YAML 文档分隔符 / 笔记块结束符 |
| 形如 `key:value`（防误判为对象项） | `rel:blocks` |
| 含换行或 tab | 多行描述 |

转义内容：`\` → `\\`，`"` → `\"`，换行 → `\n`，tab → `\t`。

> 最后一条是 v1.3.0 的关键修复：裸换行会截断 YAML 行结构，
> 重解析时第二行不是 `key: value` → `E-INVALID-NOTE-YAML` → **整块笔记丢弃**。

### 5.4 节点注释双区域（v1.4.0）

`note`（序列）与 `note_text`（纯文本）是**同一浮窗内的两个区域**，不是二选一的类型 ——
两者可同时存在，也可只填其一。

```yaml
note:
- 第一条补充
- 第二条补充
note_text: |
  一整段多行文本，浮窗内以段落渲染。
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `note` | string[] | 序列区域（条目列表） |
| `note_text` | string | 纯文本区域（一整段多行文本） |

与 `desc` 的分工：`desc` 是简短说明、**常驻节点盒内**；`note` / `note_text` 是
更丰富的补充内容、**浮窗展示、不占节点空间**。

**读取兼容**：旧文件的 `qa` 在**读取时**视为 `note` 的回退值（见 `noteOf()`），
写入一律写 `note`。

---

## 六、关系

### 6.1 节点级 `links`

写在源节点的笔记块内。`links` **永远声明在源节点**（单一事实源，无镜像写入）。

| 字段 | 说明 |
|---|---|
| `rel` | 关系类型（开放字符串；已知类型走 `REL_META` 视觉映射） |
| `to` | 目标锚（节点路径或实体锚） |
| `dir` | `fwd`（默认）/ `back` / `both`，**仅渲染端箭头语义**，不产生第二条数据 |
| `label` | 边上的短标签 |
| `note` | 边的备注 |
| `attrs` | 任意属性（内联 JSON） |

非法 `dir` 回落 `fwd` + `W` 级诊断。

### 6.2 文档级 `edges`

写在**文件头**的独立笔记块中（不归属任何节点），用于树形之外的自主连线。

| 字段 | 说明 |
|---|---|
| `from` / `to` | 两端锚（节点路径或实体锚） |
| `rel` / `dir` / `label` / `note` / `style` / `attrs` | 同 §6.1 |
| `invalidAt` | 软失效时间戳（失效/恢复二段） |
| `source` | `manual` / `inferred` / `imported` |

### 6.3 文档级 `centers` / `center_pos`（G6′ 中心升格）

写在**文档根节点的笔记块**内，把某棵子树从父岛提出来成为独立中心（自由落位、独立生长方向）。

```yaml
centers:
- at: "总览/工作"      # 路径锚（位置提示；cid 存在时仅作提示）
  cid: c7              # 稳定身份（优先解析依据；改名/移动不失效）
  dir: right           # 生长方向 right/left/down/up
  x: 250               # 世界坐标（成对才生效；缺失则由布局自动排开）
  y: -40
  parent_link: show    # G3 跨岛父子连线显示（缺省 hide）
  detached: true       # G2 切断独立标记（缺省删除）
center_pos:            # 降格后的坐标历史暂存（再升格可吸附回原位）
- at: "总览/工作"
  x: 250
  y: -40
```

| 字段 | 说明 |
|---|---|
| `at` | 路径锚（`node:根/…`）或实体锚（`@kind:id[#N]`）；位置上提示 |
| `cid` | 稳定子树身份（节点 `note.cid` 一对一关联）；**解析优先级高于 `at`** |
| `dir` | 生长方向；缺省 `right` |
| `x` / `y` | 世界坐标；**必须成对**，缺一个则整体交自动排列 |
| `parent_link` | `show` / `hide`（缺省）；控制跨岛父子边是否绘制 |
| `detached` | 切断独立标记（缺省删除字段） |

**嵌套岛移动语义**（包容跟移）：子岛仍有独立坐标身份（`x`/`y` 与历史 `center_pos`），
投影层仍把升格子树从父岛剔除。但 **非切断** 的内容树子孙岛：
① 计入祖先 Section 的 AABB 成员并集（框罩住子孙岛）；
② 拖动祖先中心 / Section 标题时，子孙岛坐标同步平移。
`detached: true` 的切断岛不参与上述包容链（相对上级完全独立）。
上述包容跟移语义自 2026-09-17 起生效。
产品壳**新升格**中心时，写入升格前节点布局盒世界中心为 `x`/`y`（与切断落点同口径），
避免无坐标落入森林自动槽导致视觉跳变。

**cid 分配**：`root.note.next_cid` 为单调计数器，分配后 +1 且**永不复用**。
重复 cid 由读侧 first-wins 拦截并产出 `dup-cid` 诊断。

### 6.4 文档级 `sections`（v1.5.0 Phase 1 子树锚定空间分区）

写在**文档根节点的笔记块**内。每个 Section 锚定一棵子树，渲染层据子树 AABB
自动算框 —— 树内容增删改后框自动跟随，**零引用同步成本**。

```yaml
sections:
- id: sec_9f3a         # 分区身份（必填，非空字符串）
  title: 摩擦分析       # 标题（缺省回退 root 节点标题）
  color: blue          # 配色 token：blue/amber/green/violet/rose/slate（缺省 slate）
  root: cid:c7         # 子树根锚：写入一律 cid:，读取兼容 node: 路径
  members: "cid:c2|cid:c3"   # Phase 2 预留（当前不参与语义）
  collapsed: true            # Phase 2 预留（当前折叠走会话态，不读该键）
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 分区身份（必填）；缺失的条目读侧跳过但原值透传 |
| `title` | string | 标题；缺省回退 root 节点标题 |
| `color` | string | 配色 token；未知 token 原值透传、渲染回退 `slate` |
| `root` | string | 子树根锚。**写入一律 `cid:`**；读取兼容 `node:` 路径锚 |
| `members` | string | **Phase 2 预留**（C-a 管道串形态）；当前不参与语义 |
| `collapsed` | boolean | **Phase 2 预留**；当前折叠为会话态，不落盘 |

**锚解析三态**（`resolveSections`）：

| 状态 | 含义 | 渲染行为 |
|---|---|---|
| `well-formed` | 唯一命中 | 画正常框（AABB + 标题栏 + 折叠钮） |
| `dangling` | 锚失效（如子树被删/cid 不存在） | 灰虚幽灵 chip + `W-SECTION-DANGLING`；**数据保留** |
| `stale` | 锚歧义或语法非法 | 同上（措辞区分） |

**数据无损纪律（D3 裁决）**：dangling/stale 的 Section 元数据**绝不静默删除**，
保留在文档中并产出诊断，由用户显式清理（与 `W-ORPHAN-NOTE` 同一哲学）。

**D1 不变量**：Phase 1 的 Section **必然是** center（升格节点）。
「标记为 Section」只写 `sections` 元数据；「设为 Section（升为中心）」
在同一条事务内完成升格 + 标记（单条 undo）。

**锚迁移**：`sections[].root` 已登记进 `ANCHOR_NOTE_KEYS`，改名/移动时走
`planReferenceMigration` 的 cid 双轨 —— `cid:` 锚原样保留即正确迁移；
`node:` 路径锚按 nodeId 重建。

**折叠**：复用节点级会话态 `collapsedIds`（不落盘；D2 裁决）。
折叠后隐藏成员无盒 → AABB 收缩只余 root，徽标转 `+N`。

### 6.5 节点级 `summary_of`（XMind 式概要 · v1.12 候选 / 待版本号）

写在**摘要节点自身**的笔记块内。摘要 S 覆盖「同一父 P 下的**连续兄弟区间**
[成员A … 成员C]」，区间**含两端**（单成员摘要 = `from == to`，合法）。

```yaml
summary_of:
  from: cid:c2        # 区间起点（含）
  to: cid:c5          # 区间终点（含）
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `from` | string | 起点成员锚。**写入一律 `cid:`**；读取兼容 `node:` 路径锚 |
| `to` | string | 终点成员锚，同上 |

**锚语义**：`cid:` 是稳定身份（成员改名/移动不失效）；`node:` 是路径锚（位置提示）。
两字段**必须成对且非空字符串**，否则视为坏形态（原值透传不丢，读侧判 `stale`）。

**锚解析三态**（`resolveSummaries`）：

| 状态 | 含义 | 布局/渲染行为 |
|---|---|---|
| `well-formed` | 两锚唯一命中、同父、顺序正确、且 S 不在区间内 | 摘要节点**从布局树摘除**为成员带外侧**卫星**，画方括号括线 |
| `dangling` | 锚失效（成员被删 / 移出同父 / 倒序 / S 与成员不同父 / S 落在自己的区间内） | **留普通流内可见**，无括线；产出 `W-SUMMARY-DANGLING` |
| `stale` | 锚语法非法 / 不可解析 | 同上 |

**数据无损纪律**：dangling/stale 的 `summary_of` 元数据**绝不静默删除**，
保留在文档中并产出诊断，由用户显式清理（与 `W-ORPHAN-NOTE` / `W-SECTION-DANGLING`
同一哲学）。

**嵌套摘要不实现**（v1.12 候选）：成员区间含**另一个摘要节点**时不摘除该摘要
（`nestedSkip`），留普通流内可见、不画括线 —— 宁可无括线，也不让节点消失。

**支持边界（重要）**：卫星摘除只在两条布局路径承诺 —— `layoutMindmap`
（单树主干，含无 `note.dir` 的逐像素回退）与 `layoutLogic`（森林左/右岛）。
`layoutOrg`（down/up 岛）、显式 `note.dir` 分叉路径、框内路径**不承诺**：
这些路径下摘要**留在普通流内可见**（无括线）。这是设计承诺边界，**不是 bug**。

**括线渲染（S4）**：卫星侧绘制方括号 + stem。几何唯一口径 = 成员**子树**并集 + 对
kernel 常量（`SUMMARY_BRACKET_GAP` / `SUMMARY_STEM_GAP`）；左右严格镜像。
渲染层**只消费** `LayoutResult.satellites`（摘除判定）与 `buildSatellitePlan().specs`
（成员区间）—— 不重解析 `summary_of` 字面量。

**两条层序契约不同（S4-R2 更正，勿混用）**：

| 面 | 顺序 | 依据 |
|---|---|---|
| 画布 DOM（SVG 层 z-order，自下而上） | `sections` → `island-overview`（IO-1 条件层：`k < K_OVERVIEW` 且有中心岛才挂） → **`summaries`** → `tree-links` → `free-edges` → `nodes` → `edge-labels` → `ghosts` → `drag` | `MapView.tsx` 的 `<SummaryLayer>` 挂在 `tree-links` 层**之前**；`island-overview` 钉在 `sections` 之后、`tree-links` 之前（`MapView.tsx` SectionLayer/IslandOverviewLayer/SummaryLayer/tree-links 挂载序，层序契约 `packages/react/tests/mapview-layer-order.test.tsx` 的 CONTRACT 数组同序；S5-R2 补记——首版表遗漏该条件层） |
| SVG 导出（字符串发射序） | 背景 `rect` → 树线 `path` → 跨岛补线 `boundaryLinks`（虚线）→ **摘要括线** → 节点卡 | `chrome/exportSvg.ts` 的 `parts.push` 次序 |

两点须注意：

1. **导出不画框边界** —— Section 框属画布侧 chrome，不进 SVG 导出；
   旧文本写的「框边界」导出层**并不存在**（误把跨岛补线当成了框）。
2. **括线相对树线的位置在两面上相反**：画布上括线在树线**之下**（z-order 更低），
   导出上括线在树线**之后**（后写 = 后覆盖）。两者不是同一契约，各自被测试钉死
   （`mapview-layer-order.test.tsx` 与 `summary-export-svg.test.ts`）。

**锚迁移**：`summary_of.from` / `summary_of.to` 已登记进 `cutAttach` 的锚字段解析
（形态 `summary_of.from` / `summary_of.to`）—— 改名/移动时 `cid:` 锚原样保留即
正确迁移；`node:` 路径锚按 nodeId 重建。

---

## 七、结构装配

| 规则 | 行为 |
|---|---|
| 标题栈 | H1 为根；H2–H6 按层级入栈挂载 |
| 列表栈 | 按缩进相对层级挂载（§2.3） |
| **最大深度 16** | 超限节点**不挂载且不压栈**，子树自然上提 → `E-DEPTH-EXCEEDED` |
| 无 H1 | 合成空标题根 → `E-NO-ROOT`；**合成根不接收笔记** |
| 重复 H1 | 后者降级为根下分支 → `E-MULTI-ROOT`（保持 H1 栈语义） |
| 全文本子节点 | 序列化时继续标题链（≤H6）；含实体的混合子节点 → 全部保持列表形态 |

---

## 八、诊断码

| 码 | 级别 | 含义 | 数据影响 |
|---|---|---|---|
| `E-NO-ROOT` | E | 无 H1，合成空标题根 | 合成根 |
| `E-MULTI-ROOT` | E | 多个 H1 | 后者降级 |
| `E-DEPTH-EXCEEDED` | E | 深度 > 16 | 节点不挂载 |
| `E-UNCLOSED-NOTE` | E | 笔记块未闭合 | 笔记丢弃 |
| `E-INVALID-NOTE-YAML` | E | 笔记体非 mapping | 笔记丢弃 |
| `W-UNKNOWN-KIND` | W | kind 未注册 | **保留为实体节点** |
| `W-INVALID-REF` | W | 引用形态非法或 id 校验失败 | 降级为文本节点 |
| `W-ORPHAN-NOTE` | W | 笔记后无节点 | 笔记丢弃 |
| `W-NOTE-SHADOWED` | W | 前一未绑定笔记被遮蔽 | 前一笔记丢弃 |
| `W-STRAY-LINE` | W | 杂散行 | 忽略该行 |
| `W-SECTION-DANGLING` | W | Section 子树根锚失效/歧义（v1.5.0） | **元数据保留**，渲染幽灵态 |
| `W-SUMMARY-DANGLING` | W | 摘要 `summary_of` 锚失效/歧义（v1.12 候选） | **元数据保留**，摘要留普通流内可见、无括线 |

> ⚠️ **级别 ≠ 数据保留**。`E` 与 `W` 都只表示「解析时发生了容错调整」，
> 上表「后果」列写明「丢弃 / 忽略」的**都会丢失原内容**。
>
> | 类别 | 诊断 | 说明 |
> |---|---|---|
> | 保留 | `W-UNKNOWN-KIND` | 保留为实体节点——**前向兼容的关键** |
> | 保留 | `W-INVALID-REF` | 降级为文本节点（内容仍在，语义降级） |
> | 丢失 | `W-ORPHAN-NOTE` / `W-NOTE-SHADOWED` | 笔记被丢弃 |
> | 丢失 | `W-STRAY-LINE` | 该行被忽略 |
>
> **实践提示（实测踩过）**：在标题下直接写描述文字属于 `W-STRAY-LINE`，
> **保存后该段内容会消失**，且只在诊断里留一条 W 级记录，容易不被察觉。
> 要保留说明性文字，请用 `- ` 列表项，或节点笔记块（`<!-- desc: ... -->`）。
>
> 注意：`verifyRoundTrip` 只验证 `parse → serialize → parse` 的 AST 等价，
> **不覆盖「原始文本 → parse」这一步**——杂散行在第一次解析时就已丢弃，
> 因此往返检查会显示「无损」，不能用来证明杂散行安全。

---

## 九、canonical 输出格式

`serializeMm()` 的规范输出：

1. 分支（heading）之间**保留一个空行**（1.3.1 起；保住手写分段，避免首次保存产生全量 diff）
2. 空行插在**笔记块之前**——笔记归属其后的节点，插在之后会拆开两者
3. 列表缩进 2 空格
4. 笔记块三行式（`<!--` / 字段 / `-->`）
5. 末尾单个 LF
6. 字段顺序：先 `one_liner → decisions → status → next → reminder`，
   再其余字段（按插入顺序），最后未知字段（§5.2）

示例：

```markdown
# 根

## 分支
<!--
one_liner: 摘要
-->
### 甲
```

**幂等**：`serialize(parse(serialize(parse(x)))) === serialize(parse(x))`。

---

## 十、往返契约（硬要求）

```
parse(text) → MindNode → serializeMm → text' → parse → MindNode'
```

必须满足：

- `MindNode' ≡ MindNode`（深度相等）
- `refs` 一致
- 诊断不因往返而新增 `E` 级

验证脚本：

```bash
cd apps/canvas && npx vite-node scripts/diag-mm-roundtrip.mts       # 合成压力用例
cd apps/canvas && npx vite-node scripts/diag-roundtrip-real.mts     # 真实文件（gateway / 10K）
```

---

## 十一、前向兼容承诺

对**读取方**（解析器）：

1. 新增 kind 不会使存量文件解析失败（保留 + `W-UNKNOWN-KIND`）
2. 新增笔记字段不会丢失（未知字段透传）
3. 放宽 id 校验不会使原合法文件变非法

对**写入方**（序列化器）：

1. 不产出当前版本解析器无法读回的内容
2. canonical 格式变更视为行为变更，须同步 `CHANGELOG` 与本文

---

## 十二、版本历史

| 版本 | 变更 |
|---|---|
| v1.12 候选（**待版本号**） | 节点级 `Note.summary_of`（XMind 式概要：同父连续兄弟区间 + `cid:` 锚 + `W-SUMMARY-DANGLING` 数据无损；卫星摘除 + 方括号括线渲染）。**尚未定号**——S1–S5 已实现并验证（S5 首版 REJECT、S5-R2 返修收口），发版批次统一编号 |
| v1.11.0 | `Note.beamAt` 共享梁比例位（逐方向 0..1；缺省 = 0.5/中点，与旧几何逐位兼容；≈0.5 不落盘——写侧删键。零 parser/serializer 改动） |
| v1.10.0 | `Note.frame` 子树框编辑的持久框标记（`version: 1` + `depth` 有限整数 ≥ 1；成框/拆框 = 写/删该键，零 parser/serializer 改动） |
| v1.7.0 | `Note.lens`（逐方向组缺省层距）/ `Note.hub`（出线枢纽共享竖梁）；布局侧四向分叉碰撞消解与连线避障（不改协议语义） |
| v1.6.0 | `Note.len` 出线长度（层次节奏软约束；up/down 组缺省归父） |
| v1.5.0 | 文档级 `sections` 空间分区（子树锚定 + `cid:` 锚 + `W-SECTION-DANGLING` 数据无损幽灵态） |
| v1.4.0 | `Note.note`（序列）/ `Note.note_text`（纯文本）节点注释双区域；读取兼容旧 `qa` |
| v1.3.1 | canonical 输出保留分支分段空行（格式改进，数据语义等价） |
| v1.3.0 | 新增 `Note.desc` 幕布描述（多行 `\n` 转义） |
| v1.2.0 | 文档级 `edges`：`invalidAt` 软失效、`source` 来源溯源 |
| v1.1.0 | `links` 支持对象列表；`dir` / `label` / `note` / `attrs` 透传 |
| v1.0.0 | 接口冻结（ADR-0004）：协议层公开签名变更视为 major |
| v0.2.2 | 跨库前缀 `org:` / `org/repo:` |
| v0.2.1 | 新增 `idea` kind 与项目前缀 |
