# P1 派遣计划：节点卡翻面 · 背面 markdown 只读渲染（零协议 / 零布局 / 零既有交互改动）

- **日期**：2026-09-14
- **起点 HEAD**：`cb33079`（R6-S1 已提交；**R6-S2 在飞**，见 §并行纪律）
- **出处**：设计稿 `docs/specs/2026-09-14-node-card-flip-markdown-design.md`（用户已裁定 D1–D4 全按推荐）
- **批次代号**：P1-N1 … P1-N4（逐个提交，做完停下报告）
- **一句话**：给固定 note 面板加**翻面**——正面 = 现有区块（幕布注释，一行不改），背面 = `note.md` 源文的 **markdown 只读渲染**；复用既有 `FlipCard`；**`estimateNoteAreaHeight()` 一字不改**（背面在同一 footprint 内滚动）= 布局零影响。

## §0 基线（开工实测并报告；数字不符先报告再动手）

| 项 | 参考值（我复核时点；**R6 在飞，以你开工自测为准**） |
|---|---|
| 三包 | kernel **516** / react **1206** / canvas **195** = **1917**（R6-S1 后可能已增） |
| 门禁 | tsc ×3 = 0；depcruise **432 模块 / 1224 deps**；lint **1468 + 46**（不得上升）；budget bang **89/90**、asCast **31/31（零余量）**、bigFiles **3/4** |
| 超 600 行 | `MindmapStage 2293` / `edgeRouting 1235` / `MapView 2230`；**新文件必须 <600 行** |
| 依赖面 | `packages/react` 改源 → **重建 dist**；若新增 npm 依赖 → 记 lockfile 与 bundle 增量 |

**冻结纪律**：阈值/契约测试不得放宽；**禁新增 `as`**（asCast 零余量）；禁 `git add -A`；不 push；不动 `.codebuddy/`/`.workbuddy/`/`tools/graph-engine/`；**既有 note 三区域渲染语义（desc / note_text / qa）与节点交互（选中/拖拽/双击编辑/连接手柄）一行不改**。

## §1 取证（file:line 逐条核过）

### 1.1 起跑线（已就位，直接复用）

- **翻卡容器**：`packages/react/src/chrome/FlipCard.tsx` —— `front`/`back` ReactNode、**受控/非受控**（`flipped` + `onFlip`）、`rotateY` 0.45s（`:10,52`）、`role=button` + Enter/Space（`:55-66`）、背面 `CHROME.neon` 边色（`:90`）。**P1 必须用受控模式**（整卡可点会抢选中，见 §3-A1）。
- **面板（翻面的宿主）**：`chrome/NoteGrowthPanel.tsx`——
  - props：`seq / text / editing / token / x / y / width / height / scale? / onChangeSeq / onChangeText / onClose / root? / onJumpToAnchor?`（`:27-43`）；
  - 尺寸：`NOTE_HEADER_H = 24`、`NOTE_REGION_H = 78`（`:13-14`）；`estimateNoteAreaHeight(): number`（`:23`，**无参常量**）→ **面板 footprint 是写死的**——背面必须装进同一 footprint（内部滚动），**该函数与调用方一行不改** = 布局零影响的硬判据；
  - 头部已有 header 行（`:133`）→ 翻面按钮的落点（与 `onClose` 同排）。
- **背面内容的既有入口**：`chrome/note.ts`（头注释："笔记格式化（**chrome 翻卡背面内容**；纯函数可测）"）`formatNote(note) → NoteSection[]`（`{key,label,value}`：一句话/状态/下一步/提醒/决策）——正面摘要可用它；**本批不改它**。
- **透传键落点**：`packages/kernel/src/protocol/types.ts:40+` `Note` 允许未知键（`note.md` / `note.card` 无需动协议）。
- **行内富文本先例**：`kernel/src/layout/inline.ts`（`tokenizeInline`：`text|strong|code|link`）+ 测量已接（`nodeLayout.ts:99`）→ 背面渲染器的行内层与之**口径对齐**（同样三类 + 链接）。
- **内部锚跳转链路已通**：L 批 `onJumpToAnchor`（`MapView → 面板`；`MindmapStage` 实现展开+定位+选中）→ 背面 md 里的 `[名](node:/cid:/@kind:id)` 直接复用。
- **既有手势面（避让对象）**：节点/边双击入口已存在（`MapView.tsx:1509`、`FreeEdgeLayer.tsx:563`、`GrowthCommentPanel.tsx:254` 一带）→ 翻面**不得**用裸双击/单击（§3-A1）。

### 1.2 明确不做（本批）

`type:'card'`、`note.card.size` 字段（见 §3-A2）、背面编辑（textarea+预览，P2）、图片/表格（P2）、裸 HTML（永久）、contenteditable、翻卡态持久化、导出背面、hover 预览浮窗（`NotePopover`）的翻面。

## §2 任务

### P1-N1 · 前置验证（不改代码；两案取一，**改协议必须停下报告**）

1. **`note.md` 的 `.mm.md` 表达实测**：自研 note YAML 是否支持**块标量**（`md: |` 多行）？
   - 支持 → 用块标量（可读性最好）；
   - 不支持 → 用转义单行（`\n` 字面量）形态并**在报告里写明**（往返保真钉覆盖所选形态）；
   - 若要为此改 parser/serializer → **停下报告**（本批前提是零协议改动）。
2. **引擎可行性实测**：`pnpm add markdown-it`（或同类 MIT 库）——
   - 实测三件：网络可否安装（沙箱出口不稳是已知风险）、许可、bundle 增量（记入报告）；
   - **受阻回退**（一等选项，不是降级凑数）：自研受限子集渲染器，范围 = 标题 h1–h6 / 无序有序嵌套列表 / 任务列表 / 引用块 / 围栏代码块 / 水平线 / 行内样式（复用 `inline.ts` 口径）/ 链接（含内部锚）——**表格、图片、裸 HTML 一律不支持**（按纯文本呈现）。
3. 产物：报告 §N1 贴两案实测原文 + 所选形态；两案都受阻 → 停下报告。

### P1-N2 · `note.md` 读侧 + 背面 markdown 渲染器

- 新组件 `chrome/CardBackMarkdown.tsx`（**<600 行**；纯展示，无副作用）：
  - 输入：`md: string`、`token: TokenSet`、`onJumpToAnchor?`；
  - 渲染：范围清单内语法 → React 元素树；**范围外语法按纯文本呈现**（图片 `![]()` 不加载、HTML 不执行、表格按文本）；
  - 安全：**无 `dangerouslySetInnerHTML`**（若引库输出 HTML 串 → 必须过白名单，仿 `render/svgTint.ts` 的 ALLOWED_ATTRS 先例；更稳 = 走 token→元素）；链接协议白名单（`http(s)` + 内部锚语法），外链 `target=_blank rel="noopener noreferrer"`；
  - 内部锚：`[名](node:…)` 等 → 点 `onJumpToAnchor`（与 L 批 `TextLinkSpans` 同款行为：非 well-formed 不动作）；
  - 空/缺省 `md` → 返回 null（调用方不渲染背面）。
- **测试（先红后绿）**：范围清单每种语法 DOM 断言 + 范围外纯文本降级（图片不加载/HTML 不执行）+ 链接跳转回调 + 外链属性。

### P1-N3 · 翻面接线（NoteGrowthPanel）

- 受控 `FlipCard` 包住面板内容：`front` = 现有区块（序列/正文，**一行不改**）；`back` = `CardBackMarkdown`（+ 现有 header 保留）；
- 面板头加翻面按钮（`data-note-flip` + `aria-pressed` + `title`），**只有 `note.md` 非空时才渲染**（缺省零感知）；
- 翻卡态：**会话态**，按节点 id 记（宿主 or 面板内 state；同 `sections.collapsed` 先例，**不落盘**）；
- **footprint 不变**：`estimateNoteAreaHeight()` 与调用方**一行不改**；背面内容**内部滚动**（沿用 `NotePopover` 的 `FLOATING_NOTE_MAX_H=320` 同款纪律：区域滚动、外层不滚）；
- LOD：面板在缩放 k 下的既有降级行为不变（背面不新增层级）；
- **反例钉（必须）**：① 无 `note.md` → 无按钮、面板与今天逐位一致（DOM 断言）；② 单击选中/双击编辑**不受影响**（翻面按钮命中区独立、`stopPropagation` 纪律比照 `EdgeEditor:147`）；③ 翻面不改变 `estimateNoteAreaHeight` 的返回值与布局输出。
- commit 建议：`feat(react): note 面板翻面（背面 markdown 只读渲染；note.md 透传，零布局改动）`

### P1-N4 · 收口

- `CHANGELOG.md` **顶部**追加 `[1.8.17]` 段（触发 / N1 两案结论 / N2-N3 / 验收 / bundle 增量 / 偏差；**位序最新在上**）。
- 报告 `outputs/2026-09-14-node-card-p1-report.md`：逐任务 commit + 红/绿原文 + 渲染范围清单逐项证据 + 降级/反例钉原文 + 三包/门禁/budget 原样 + bundle 增量（若引库）。
- 门禁复跑 + 定向清理 tmp + `git status --short`（除并行批在飞文件外应干净）。
- **然后停**：不 push（复核通过后另行授权）。

## §3 决策点（按推荐执行，不停下来问）

| # | 决策点 | 推荐 |
|---|---|---|
| **A1** | 翻面触发 | 面板头**专用按钮**（`data-note-flip`）+ 受控 FlipCard；**禁止**整卡 onClick 翻面（抢选中）、禁止裸双击（与编辑冲突） |
| **A2** | 「固定尺寸」落义澄清 | 背面渲染在**既有面板 footprint** 内 + 内部滚动；**`note.card.size`（S/M/L）本批不实现**（推迟 P2，与"卡尺寸是否影响布局"一并裁定）——D3 的意图（无自适应、无抖动、不参与布局）由 footprint 不变 + 内部滚动完整兑现 |
| **A3** | 渲染器落点 | 新文件 `chrome/CardBackMarkdown.tsx`；**不塞进 `NoteGrowthPanel`**（后者只加接线） |
| **A4** | 行内口径 | 与 `kernel/layout/inline.ts` 对齐（strong/code/link 三类），**不引第二套行内语法** |
| **A5** | 引擎 | markdown-it 类库（白名单）；安装/体积受阻 → 受限子集（§N1.2），两者都是"完成"，但必须如实标注走了哪条 |
| **A6** | CHANGELOG 号位 | `[1.8.17]`，插在最上（`[1.8.16]` 之上；R6 批占 16） |
| **A7** | push | 不 push |

## §4 风险

1. **并行批次文件面**（见 §并行纪律）：`index.ts` 是共享文件（R6-S1 已动 4 行）→ **只允许加法**，冲突由后提交者处理；**不得 `git add -A`**。
2. **依赖网络**：`pnpm add` 若失败 → 走 A5 回退（子集），**不许**把"装不上"写成"做不了"。
3. **YAML 块标量不支持** → 用转义单行形态（往返钉覆盖），并在报告写明；**不许**擅自改 parser。
4. **背面长文**：内部滚动 + 渲染只发生在可见面板（视口裁剪已存在）；不做虚拟化（P1 不需要），但长文渲染耗时若 >16ms 级 → 报告实测。
5. **footprint 漂移**：任何"为了让背面好看"而改 `estimateNoteAreaHeight`/面板尺寸的行为 = 违反本批第一前提，**禁止**（反例钉②③会红）。

## §5 报告格式

- 逐任务：commit hash + 改动文件 + **红/绿断言原文** + 新增用例数。
- N1：两种形态实测原文（YAML 块标量 / 引擎安装）+ 所选路线 + 理由。
- N2：范围清单逐语法 DOM 断言 + 范围外降级证据 + 安全（无 HTML 串直插）证据。
- N3：反例三钉原文 + footprint 不变证据（`estimateNoteAreaHeight` diff 为空 + 布局测试全绿）。
- N4：三包/门禁/budget 原样 + bundle 增量 + `git status --short`。
- 偏差与原因；然后停，等复核与 push 授权。

---

## 并行纪律（R6 小批在飞）

- R6 已提交/在飞文件面（**本批一行不碰**）：`render/edgeHealth.ts`、`render/freeEdges.ts`、`chrome/EdgeHealthBar.tsx`、`chrome/EntityGraphPanel.tsx`、`chrome/EdgeEditor.tsx`、`chrome/edgeEditorShared.tsx`、`apps/canvas/src/MindmapStage.tsx`、`apps/canvas/src/SidePanels.tsx`、`apps/canvas/src/EdgeDraftLayer.tsx`、`apps/canvas/src/hooks/useEdgeActions.ts` 及其测试。
- 共享文件（**加法-only**，冲突后提交者解）：`packages/react/src/index.ts`；`packages/react/src/render/MapView.tsx`（若需传 `md` prop，**≤3 行**）。
- CHANGELOG：R6 占 `[1.8.16]`，本批 `[1.8.17]`（顶部）。
