# L 批派遣计划：文本区域内的链接（命名 + 跳转 + 正确存储）Phase 1

- **日期**：2026-09-13
- **起点 HEAD**：`0f46da6`（1.8.12 收口；若与 C 批并行执行，见 §7 冲突面）
- **出处**：用户提问「注释 / 内容区 / 笔记区是否支持链接的正确存储、命名 + 跳转？如何设计实现？有没有成熟项目？」→ 本稿先取证（§1）再定设计（§2）与任务（§3）。
- **批次代号**：L1 … L4（L3 为可选，见 §3）

---

## §0 基线 + 并行纪律

| 项 | 值（2026-09-13 实测） |
|---|---|
| 三包测试 | kernel **480** / react **1127** / canvas **186** = **1793** 全绿 |
| 门禁 | tsc ×3 = 0；react dist 重建 = 0；depcruise = 0（416 模块 / 1170 deps）；lint **1468 + 46**（不得上升） |
| 预算 | bang 89/90 ↓1 · asCast 31/31 · bigFiles 3/4（`MindmapStage 2254 / edgeRouting 1235 / MapView 2193`） |

**DoD**：① TDD 红→绿、**红证据贴原文**；② 每任务一条 commit；③ **不得放宽任何既有阈值/契约测试**（本批对 `collectReferenceAnchors` 的清单是**加法**）；④ 报告数字贴工具原样输出；⑤ 做完停下。

## §1 取证（写稿时逐条核过）

### 1.1 三个区域**当前都是纯文本**——没有任何链接语义

| 区域 | 存储字段（协议 §5.2/§5.4） | 展示渲染点（file:line） | 编辑态 |
|---|---|---|---|
| 内容区（幕布描述） | `note.desc`：string（多行 `\n` 转义） | `DescBlock.tsx`（常驻节点盒内，逐行 + 引用竖线） | 内联编辑（textarea 形态） |
| 笔记区（节点注释） | `note.note`：string[]（序列区）+ `note.note_text`：string（正文区） | `NotePopover.tsx:394-…`（序列）/ `:448-459`（正文 `pre-wrap`）；`NoteGrowthPanel.tsx:99`（序列）/ `:114`（正文） | `QaEditor.tsx`（textarea，`trim` 后写回） |
| 注释（快速注释） | `note.qa`：string[]（**v1.4.0 起为读兼容回退**，`note.ts:41-42`）；写入走 `note.note` | 同「笔记区」渲染路径 | 同上 |

**结论**：三处都只是字符串；`[名](…)` 今天显示为原样文字，无解析、无样式、无跳转。

### 1.2 内核侧的锚基础设施**已完整**（本任务不需要造轮子）

- `parseLinkAnchor`（`packages/kernel/src/registry/note-anchor.ts:81-94`）：`node:` 路径锚 / `cid:` 稳定身份 / `@kind:id[#N]` 实体锚。
- `resolveLinkAnchor`（`:167-191`）：三态 **well-formed / dangling / stale**（含"同名歧义宁可不猜"）。
- `buildCidIndex`（`:101-107`）：`cid → nodeId` 全树索引（可注入复用）。
- 改名/移动跟随：`anchor-migrate.ts` 的 **cid 双轨** + `packages/react/src/edit/cutAttach.ts` 的 `collectReferenceAnchors` / `applyAnchorUpdateToNote`。
- 跳转能力：`collapsedAncestors`（`packages/react/src/edit/reveal.ts`）+ `revealTargetInViewport`（`render/navigateDirection.ts`，方向键导航已在用）。

### 1.3 迁移收集**不扫自由文本**（"正确存储"的缺口所在）

`collectReferenceAnchors` 只扫 `ANCHOR_NOTE_KEYS = ['centers','center_pos','edges','links','groups','sections']`（`cutAttach.ts:81-136`），逐条读**结构化字段**（`.at/.from/.to/.root/.members[]`）——`desc`/`note`/`note_text`/`qa` **均不在其中**。
`applyAnchorUpdateToNote` 的 `field` 只认 `key[i].prop` 形态（`:139-146`）→ **不支持"字段值内的某一段文本"**。

### 1.4 关键协议事实：`[…]` 开头的文本**往返安全**（已逐行核过，L1 用测试钉住）

1. 序列化：`yamlScalar` 对 `[` 起始值**自动加双引号**并转义 `\` / `"` / `\n` / `\t`（`packages/kernel/src/protocol/serializer.ts:20-45`）；数组项同样走 `yamlScalar`（`:70`）。
2. 解析：`stripQuotes` 先还原引号与转义（`parser.ts:107-121`）；随后 `scalarValue` 见 `[` 起始会尝试 `JSON.parse`——`[名](node:根/A)` **不是合法 JSON → catch 返回原字符串**（`:123-133`）✓。
3. 列表项判别：`isObjItem` 对引号开头的项**直接判为字符串项**（`parser.ts:216-217`）→ 不会被误判为对象项 ✓。
→ 结论：语法落地**不需要动协议**（透传键 + 既有引号规则已覆盖）；但必须有 round-trip 测试当证据（§3 L1-4）。

### 1.5 成熟项目对照（回答"有没有成熟项目"）

| 项目 | 语法 | 命名（别名） | 存储 | 改名跟随 |
|---|---|---|---|---|
| **Obsidian** | `[[路径]]` / `[[路径\|别名]]` / `[[#标题]]` | ✓ | 纯 markdown 文本内 | **改名自动改写链接** + 未解析链接标记 |
| Logseq | `[[页面]]` / `((block-uuid))` / `#tag` | ✓ | 文本内 + UUID 块引用 | UUID 稳定 |
| Roam Research | `[[page]]` / `((uid))` | ✓ | 文本内 | block uid 稳定 |
| **Notion** | `@页面` / 文本内链接 | ✓ | **富文本模型 + page-id** | ID 稳定（非文本重写） |
| TiddlyWiki | `[[标题]]` | ✓ | 标题即身份 | 改名 = 新条目 |
| **CommonMark** | `[文本](url)` + **引用式** `[文本][id]` + `[id]: url` | ✓ | 纯文本 | —（规范层不管） |
| VS Code / LSP | `documentLink`（工具解析） | ✓ | 纯文本 | 工具层 |

**两类成熟路线**：① 富文本/模型层 ID（Notion）；② **纯文本语法 + 工具层解析与改名重写**（Obsidian / Logseq / Roam）。
**本项目天然属于 ②**（`.mm.md` 纯文本 + git 可 merge + 透传铁律 + ADR-0004 冻结），而且**已经有 ② 里最难的两块**：稳定身份（`cid`）与迁移管线。
→ 设计方向：**CommonMark 行内链接语法 + 既有锚体系 + 迁移收集扩展**（不引入 Wikilink 新语法、不做富文本编辑器）。

## §2 设计（Phase 1 范围）

**语法**（行内链接，锚语法与 `note.rel`/`sections.root` **逐字一致**）：

```
[显示名](node:根/任务/A)      ← 路径锚（可读，改名后靠迁移跟随）
[显示名](cid:c7)              ← 稳定身份锚（改名/移动天然跟随）
[显示名](@issue:88)           ← 实体锚（复用实体解析）
```

- **命名** = `[显示名]`（用户可写任意名；插入 UI 缺省取目标节点文本）。
- **存储** = 原文即所写（透传键，零新字段）；**不存 nodeId**（会话内 id 每次解析都变——与 `freeEdges.ts:5` 同款纪律）。
- **解析** = 新纯函数 `parseTextLinks(text) → TextSpan[]`（`{ kind:'text'|'link', … , anchor?, state? }`），锚判定复用 kernel `parseLinkAnchor` + `resolveLinkAnchor`。
- **渲染** = 只读态把纯文本拆成 spans 渲染：链接 = 可点击（`data-text-link` + `data-link-state`）+ 三态样式（well-formed 正常 / dangling·stale **幽灵态**：虚线 + `title` 说明 + 不可跳）；**编辑态保持纯文本**（不做 contenteditable 富文本——避免深渊）。
- **跳转** = 宿主回调 `onJumpToAnchor(anchor)`：解析 → 展开折叠祖先（`collapsedAncestors`）→ `revealTargetInViewport` → 选中节点。缺省不注入 = 链接只渲染不可点（向 `EdgeEditor.choices` 的缺省纪律看齐）。
- **改名跟随** = 把三类字段的文本内链接纳入 `collectReferenceAnchors`（**span 级** `field`，如 `desc#0` / `note[2]#1` / `note_text#0`）+ 扩展 `applyAnchorUpdateToNote` 支持 span 原位替换；`cid:` 锚沿用既有"原样保留即正确"。

## §3 任务

### L1 · 解析纯函数 + 三区域只读渲染 + 跳转接线

1. 新模块 `packages/react/src/edit/textLinks.ts`（纯函数、零 DOM）：`parseTextLinks` + `applySpanReplace`（span 替换工具，供 L2 用）。
2. 判别测试（`packages/react/tests/text-links.test.ts`，先红）：
   - 基本：无链接 / 1 个 / 多个 / 首尾位置；括号与转义边界（`[a](node:x)` 中含 `]`、嵌套 `[]`）；
   - 三态：`node:` 命中 → well-formed；不存在 → dangling；同名歧义 → stale；`cid:` 命中；非法（空目标）→ 视为纯文本；
   - **非链接形态不误伤**：`[已归档]`（无目标）、`(node:…)` 裸串、`[a](http://…)`（Phase 1 视为纯文本，见 T-A6）。
3. 三区域渲染接入（只读态）：`NotePopover.tsx:394/448`、`NoteGrowthPanel.tsx:99/114`、`DescBlock` 展示态 → 渲染 `<span data-text-link={anchor} data-link-state={state}>`；`QaEditor` 编辑态**不动**。
4. **round-trip 保真钉**（§1.4 的证据）：`desc`/`note[2]`/`note_text` 各含一条链接 → `serializeMm → parseMm` **逐字相同**（挂在 `packages/kernel/tests/` 或 `packages/react/tests/`，按既有 golden 风格）。
5. 跳转接线：新可选 prop `onJumpToAnchor?: (anchor: string) => void`（`MapView` → 面板；宿主 `MindmapStage` 实现：展开祖先 + reveal + 选中）；缺省不注入 = 只渲染不可点（回归钉）。

**commit**：`feat(react,canvas): 文本区域链接 Phase 1——解析 + 只读渲染 + 跳转（含 round-trip 保真钉）`

### L2 · 迁移收集扩展（"正确存储"的实质）

1. `collectReferenceAnchors` 增扫**文本字段内的链接**：`desc` / `note_text` / `note[i]` / `qa[i]`，`field` 新形态 `desc#0` / `note_text#0` / `note[2]#1`（span 序号，按出现顺序）。
2. `applyAnchorUpdateToNote` 支持上述 span 形态：**同一字段多处替换必须从右往左**（防位移——写进实现注释）。
3. 判别测试：① 盘点清单追加字段（`cut-attach.test.ts:259-294` 既有 toContain 断言**保持**，新增断言）；② 改名/切搬后链接锚被迁移（路径锚 → 新路径；`cid:` 锚原样）；③ 同一字段两条链接同时迁移（右→左替换正确性）。
4. 阴性对照（自跑并恢复）：去掉文本字段扫描 → 迁移用例红。

**commit**：`feat(react): 文本链接纳入锚迁移收集（span 级 field + 右→左替换）`

### L3（可选，L1+L2 全绿后才做）· 插入入口

在 `NotePopover` / `NoteGrowthPanel` 编辑态加「插入链接」按钮 → 复用 **`EdgeAnchorPicker`**（R2-1 已实现：候选集 + 过滤 + Esc）选目标 → 在 textarea 光标处插入 `[节点文本](node:路径)`（目标有 cid 则写 `cid:`）。
**停止条款**：若 picker 复用需要改动其公开契约，则**停做并在报告写明**（不许为省事放宽既有用例）。

**commit**：`feat(react): 插入链接入口（复用 EdgeAnchorPicker；光标处插入）`

### L4 · 收口

`CHANGELOG.md` `[1.8.14]`（若与 C 批并行见 §7）+ 报告 `outputs/2026-09-13-text-links-report.md` + 真浏览器截图（浮窗内可点击链接 + 幽灵态）→ 停下。

## §4 决策点（按推荐执行）

| # | 决策点 | 推荐 |
|---|---|---|
| **T-A1** | 语法 | **CommonMark 行内链接** `[名](锚)`（不引入 Wikilink；锚前缀 `node:`/`cid:`/`@` 保持与 `note.rel` 一致） |
| **T-A2** | 模块归属 | **react 新模块**（`edit/textLinks.ts`）；锚解析复用 kernel，**不动 kernel 冻结面** |
| **T-A3** | Phase 1 边界 | **只读渲染 + 跳转**；编辑态保持纯文本（不做富文本编辑器） |
| **T-A4** | 跳转行为 | 展开折叠祖先 → reveal → 选中；**不自动打开浮窗**（少动作） |
| **T-A5** | 幽灵态 | 与 `W-SECTION-DANGLING` 同哲学：**元数据不删**、虚线 + `title` 原因、不可跳 |
| **T-A6** | 外部链接 | Phase 1 **不渲染为可点击**（安全：需白名单 + `rel` 策略，另立） |
| **T-A7** | cid 策略 | 插入时目标有 cid 写 `cid:`；无 cid 写路径锚 + 靠 L2 迁移跟随；**不做**全库补发 |
| **T-A8** | L3 插入 UI | 可选末位；触到 `EdgeAnchorPicker` 契约即停 |

## §5 风险

1. **渲染面散布**（`NotePopover`/`NoteGrowthPanel`/`DescBlock` 三处、编辑态与展示态两套）：**只改展示态**，编辑态一行不动——否则会撞上现有 inline 编辑与 measure 估算（`estimateDescHeight` 按字符计数，富文本会破坏它）。
2. **span 替换的位移错**：同字段多处替换必须右→左（L2-3③ 专钉）。
3. **误伤既有文本**：用户已写的 `[已归档]`、数学式 `[0,1]`、代码片段等 → 只在前缀可解析为锚时才认链接（T-A1 + L1-2 的"非链接形态"用例）。
4. **`note` 数组项与 `QaEditor.trim`**：编辑保存会 trim 首尾空白——含链接的条目不受影响（`[` 不是空白），但 round-trip 钉要覆盖"条目首尾带空格"的既有行为不变。
5. **迁移收集扩张的副作用**：`collectReferenceAnchors` 的新增字段会进入 `planCutTreeEdge`/`planAttachIsland` 的迁移批次 → 必须核对"切断/接回"既有用例全绿（不许改期望）。

## §6 交付与报告格式

- 逐任务：commit hash + 改动文件 + 分包测试数（实测）+ 新增用例数 + **红证据原文**。
- L1：round-trip 用例的输入/输出**原文**（证明 §1.4 的结论）+ 三区域截图。
- L2：迁移前后锚值对照 + 同字段两处替换的顺序证据 + 阴性对照原文。
- 门禁与预算实测；偏差与原因；然后停。

## §7 明确不做 / 与 C 批的并行纪律

**明确不做**：富文本编辑器（contenteditable/WYSIWYG）；外部 URL 白名单；跨文档链接（B 线范畴）；`members`/`collapsed` 协议字段；链接的"反链/双链面板"（Obsidian 式 backlinks，另立）。

**并行纪律（与 C 批同时跑时）**：
- 文件面基本不相交：C 批 = `nodeMenuBags.ts` / `centers.ts` / `NodeG|MapView`（角标）/ `specs`；L 批 = `DescBlock` / `NotePopover` / `NoteGrowthPanel` / `QaEditor` / `cutAttach.ts` / 新 `textLinks.ts`。
- **唯二注意**：① `cutAttach.ts` 只 L 批动（C 批不碰）；② `CHANGELOG.md` 与 `MapView.tsx` 两边都会追加——**先提交者为 [1.8.13]，后提交者顺延号位**，`MapView` 的改动行互不重叠（C 在节点层角标、L 不做 MapView 改动除非 L1-5 透传 prop → 若撞车由后提交者 rebase 式手工合并并复跑三包）。
