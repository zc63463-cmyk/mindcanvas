# 节点卡片（翻卡 · 背面 markdown）方向探索设计稿

- **日期**：2026-09-14
- **状态**：**草案 · 待裁定**（§11 四个开放问题需用户圈定后转 P1 派遣稿）
- **定位**：M2 富内容实验第二项（第一项是资产画廊）；上游 = R15「快速注释 + 翻转卡双面呈现」（已落地）＋ `docs/2026-09-11-free-canvas-深度调研.md`
- **一句话**：把节点卡做成**双面卡**——正面 = 现有节点内容 + 幕布式注释（不动），背面 = **一段 markdown 源文**的**只读渲染**（完备语法 + 预览），翻卡复用既有 `FlipCard`；**数据零协议变更**（`note` 透传键），**不进 `type` 联合类型**。

## 0. 设计原则

1. **数据永不丢失，渲染尽力而为**（R11 底座原则）：背面源文是纯文本；不认识它的旧版本/旧工具**忽略而非破坏**。
2. **富文本不是数据格式，只是渲染效果**（`docs/2026-09-02-next-steps.md:176-179` 的既定定性）——背面存 markdown **源文**，渲染器只读消费，不回写结构。
3. **扩展缝优先于新类型**：仓里为新内容类型设计的路径是「新 kind/字段 + 渲染器 + 未知内容降级」（`specs/2026-08-27-mindmap-forgejo-sync-design.md:141,145`），本稿沿用（**暂不动 `EditableNode.type`**，见 §3-D1）。
4. **三个不动**：既有 note 三区域渲染语义（desc / note_text / qa，L 批刚接完行内链接）一行不改；现有节点交互（选中/拖拽/双击编辑/连接手柄）一处不抢；自动布局一行不改（卡**不参与**布局）。

## 1. 现状取证（file:line，逐条核过）

### 1.1 已就位的地基（本方案的"起跑线"）

| 地基 | 证据 | 含义 |
|---|---|---|
| 翻卡容器 | `packages/react/src/chrome/FlipCard.tsx`（通用：`front`/`back` ReactNode、受控/非受控、`rotateY` 3D、`role=button` + Enter/Space、玻璃视觉；已导出 `index.ts:121-122`） | **翻卡两面不用做**；今天唯一调用点是 `MindmapStage.tsx:1972` 演示位 |
| 背面内容层 | `chrome/note.ts` 头注释："笔记格式化（**chrome 翻卡背面内容**；纯函数可测）"；`formatNote(note) → NoteSection[]` | 「背面换 markdown 渲染」= 改造这一层 |
| 翻转卡面板先例 | `chrome/QaEditor.tsx` 头注释："归属**翻转卡面板**"（R15：`note.qa` 查看/新增/编辑/删除 + 翻转卡双面呈现） | 翻卡的交互与归属已有先例可循 |
| 行内富文本 tokenizer | `kernel/src/layout/inline.ts`：`tokenizeInline`（`text|strong|code|link`）/`inlineWidth`/`stripInline`；**测量已接**：`nodeLayout.ts:99` 取 `max(measure(line), inlineWidth(tokens))`；**react 渲染层零消费**（ripgrep 全仓 `tokenizeInline` 在 packages/react 无命中） | 正面卡"行内富一点"几乎白捡；背面 markdown 的行内部分可与之对齐 |
| note 袋（透传键） | `packages/kernel/src/protocol/types.ts:40+`：`one_liner / decisions / status / next / reminder / desc / note / note_text / qa / edges / centers / sections / cid / dir / rel / via / edge …`（**未知字段容忍透传**） | 背面源文有天然落点（新增透传键，零协议改动） |
| 已知短语义先例 | `sections[].collapsed`："Phase 2+ 预留（折叠持久化；**Phase 1 折叠为会话态不落盘**）" | **翻卡态默认会话态**，持久化留后续（同款裁定逻辑） |

### 1.2 必须尊重的既有裁定（含两条否决先例）

1. **"富文本化内嵌图片"已被否决**（`docs/specs/2026-08-28-asset-gallery-design.md:61`，理由：破坏纯文本事实源）→ 本稿把「背面渲染 `![]()` 图片」**推出 P1**，P2 单独议（须先说明"源文仍是纯文本引用、图片走既有资产目录约定"为何不构成同类破坏）。
2. **Project Graph 的反面教材**（`docs/2026-09-05-project-graph-调研与减法设计.md:60-62`）：节点富文本在画布上只当纯文本画、其 markdown 编辑器全仓零引用（死代码）→ 本方案 P1 必须**渲染先通、编辑押后**，且每条能力都要有消费方与测试。
3. **L 批/S 批纪律**：不做 contenteditable/WYSIWYG（L §7）；编辑态 textarea 保持纯文本（L T-A3）。
4. **手势面**：节点/边的双击入口已存在（`MapView.tsx:1509`、`FreeEdgeLayer.tsx:563`、`GrowthCommentPanel.tsx:254` 一带）→ 翻卡触发**不得**复用裸双击（§6-D4）。

### 1.3 free-canvas 调研的结论（决定"隔离"问题的答案）

- **"纯文本/Markdown 为事实源 + 可自由摆放"目前基本是空白赛道**，是 mindcanvas 的真实卡位（Obsidian Canvas 事实源是 JSON；Excalidraw/tldraw 是自家格式）——`docs/2026-09-11-free-canvas-深度调研.md:13`。
- **不建议依赖任何白板 SDK**，借鉴架构（tldraw 许可 / Excalidraw 体积 / xyflow 付费层）——同上 `:14`。
- **SVG 还能撑很久**：临界点 ≈ 可见 DOM 数千；先补 **空间索引 / transform-only / LOD 按 zoom / JSON Canvas 导出**（`docs/2026-09-02-next-steps.md:59`，📋 待排、按摩擦驱动）。
- → **本卡片属 mindcanvas 自身的"自由画布演进方向"，不是另一个项目**；隔离形态 = **同仓扩展缝 + 实验开关**（§9），不是另立仓库。

## 2. 目标形态（规格）

**正面**（不动）：节点内容（文本/图片/实体 + 行内链接跳转）＋ 幕布式注释（现 `note` 机制：`desc` / `note_text` / `qa` / `edges` 等按既有渲染）。
**背面**（新）：`note.md` 源文（纯文本）→ **markdown 只读渲染**（完备语法子集，§5）。

```
┌──────────── 正面（现状） ───────────┐   ┌──────────── 背面（新） ────────────┐
│  节点内容（含行内链接）              │   │  markdown 渲染（源文 = note.md）    │
│  desc / note_text / qa（幕布注释）   │ ⇄ │  标题/列表/引用/代码块/行内/链接    │
│  [⟳ 翻面]                            │   │  [⟳ 翻面]（固定尺寸 · 内部滚动）     │
└──────────────────────────────────────┘   └────────────────────────────────────┘
```

## 3. 四个决策点（各给推荐 + 理由 + 判据）

### D1 · 数据形态：`note` 透传键 vs 新 `type:'card'` → **推荐前者**

| 路径 | 做法 | 代价 | 风险 |
|---|---|---|---|
| **(b) 透传键（推荐）** | 新增 `note.md`（背面源文）+ 可选 `note.card`（卡配置，如 `{size:'m'}`） | **零协议改动**（未知键透传纪律既有）；`.mm.md` 不变；旧版忽略即降级 | 卡尺寸由渲染层定 → 与"不参与布局"（§6）自洽 ✓ |
| (a) 新 `type:'card'` | 动 `EditableNode.type` 联合类型 + `.mm.md` 表达（heading 行如何标 card？）+ 布局语义 | 协议面 + ADR-0004 + parser/serializer + 导出 | **前置缺口**：仓里的"未知内容降级"先例只覆盖**未知 kind（实体）**，**未知 type 的降级纪律尚未定义**——先立 ADR 才能谈 (a) |

**推荐 (b) 先行**；把 (a) 记入 §11 待议（触发条件：确认"卡必须参与自动布局/有独立布局语义"）。
判据：`.mm.md` diff 为零；旧版本打开含 `note.md` 的文件 → 不报错、不丢字段（round-trip 逐字）。

### D2 · markdown 范围与引擎

**范围清单（P1 内 / 外）**：

| P1 支持 | P1 不支持（明确） |
|---|---|
| 标题 h1–h6、粗体/斜体/删除线、行内 `` `code` ``、有序/无序/嵌套列表、任务列表、引用块、围栏代码块、水平线、链接（**含内部锚 `[名](node:…/cid:…/@kind:id)` → 复用 L 批跳转**） | **图片**（P2，见 §1.2-1）、**裸 HTML**（永久不支持）、表格（P2）、数学公式/脚注/嵌入（P3+） |

**引擎选型**：**推荐引成熟库（markdown-it 类，MIT）+ 自带白名单约束**，不自研完备语法（无底洞）。硬约束：
- `html: false`（**禁裸 HTML**，杜绝注入面）；链接协议白名单（`http(s)` + 内部锚语法），外链 `target=_blank rel="noopener noreferrer"`；
- 渲染路径**禁止 `dangerouslySetInnerHTML` 直插未净化 HTML**（若库输出 HTML 串，须过白名单，仿 `render/svgTint.ts` 的 ALLOWED_ATTRS 先例）；更稳的做法：**走 token → React 元素**（不用 HTML 串）。
- **依赖可行性前置**（P1 第一件事）：`pnpm add` 网络/许可/体积三项实测；**若受阻 → 回退自研受限子集**（范围收敛到"标题/列表/引用/代码块/行内样式/链接"，行内部分与 `inline.ts` 对齐）——回退路径必须在 P1 报告里留证。

### D3 · 卡尺寸与布局哲学 → **固定尺寸 + 内部滚动 + 不参与自动布局**

- 翻卡要求两面同尺寸（`rotateY` 视觉契约）；背面长文 → **内部滚动**（先例：`NotePopover` 的 `FLOATING_NOTE_MAX_H=320` + 区域内部滚动；`NOTE_REGION_H=78` 的固定槽同理）。
- 尺寸档位建议 **S/M/L 三档固定值**（世界 px），由 `note.card.size` 可选指定，缺省 M；**不做内容自适应测量**（避免卡尺寸抖动 + 布局联动）。
- 判据：内核布局测试全绿且 `layout.nodes` 无变化（卡不进布局）；缩放 k<0.5 时走既有 LOD（只画正面标题）。

### D4 · 翻卡触发与 a11y → **卡角「翻面」按钮（含键盘）**，不用裸双击/单击

- 单击 = 选中、双击 = 编辑（既有）→ 翻面用**卡右上角专用按钮**（世界空间小按钮 `[⟳]`，命中区独立）+ 键盘 `F`（选中态）；
- `FlipCard` 自带 `role=button`/Enter/Space（`:55-66`）→ 若整卡可翻会抢选中，故**受控模式**使用（`flipped` + `onFlip` 由宿主持有，卡只翻按钮那一下）；
- 翻卡态**会话态**（不落盘；同 `sections.collapsed` 先例）；无 `note.md` 的节点**不渲染翻面按钮**（零感知）。

## 4. 数据形态详规（推荐路径）

```yaml
<!-- .mm.md 节点笔记块（示例） -->
note:
  md: |            # 新增：背面 markdown 源文（纯文本，多行用 YAML 块标量）
    ## 设计取舍
    - 卡不参与布局
    - 链接支持 [跳转](node:根/任务/A)
  card:            # 新增（可选）：卡配置
    size: m        # s | m | l（缺省 m）
```

- 字段命名：`note.md`（清晰标识"这是 markdown 源文"，**不与 `note_text` 混用**——后者是幕布正文，已接 L 批行内链接渲染，语义不同）；
- **协议工作量为零**：parser/serializer 已容忍未知键（E1 先例）；`|` 块标量（多行）需实测确认 walker 支持 → 若不支持，用 `\n` 转义单行写法（P1 第一件事验证，两案取一，**改协议必须停下报告**）；
- 读侧（react）：`note.md` → 卡片背面；`note.card.size` → 尺寸档；两者缺失 → 与今天完全一致（零行为变化）。

## 5. 渲染与安全

- 渲染只读：`note.md` 源文 → markdown-it（或回退子集）→ **React 元素树**（非 HTML 串）；代码块不高亮（P1）。
- 内部锚链接复用 L 批链路：`onJumpToAnchor` 已通（`MapView → 面板`），点击 → 展开 + 定位 + 选中（不自动开浮窗）。
- 安全：禁裸 HTML；链接白名单；无 `eval`/内联事件；外链 `noopener`。
- 性能：背面渲染 = 每张可见卡一次（卡数量受视口裁剪约束 ✓）；长文档 O(源文长度)，无跨帧成本；实测入 P1 报告（bench 或 DOM 断言）。

## 6. 交互与视觉

- 翻面按钮：世界空间右上角 `[⟳]`，命中区随 k 缩放（沿用既有手柄纪律）；`title` 提示；
- 翻转动效：复用 `FlipCard` 的 0.45s `cubic-bezier`（`:10,52`）；
- 背面样式：沿用 `CHROME` 令牌（翻卡背面已是 `CHROME.neon` 边色，`:90`）；markdown 排版用 `token`（字体/字色），**不引第二套主题**；
- 缩放下：k < 0.5 → 只渲染正面（LOD）；翻卡态随节点离屏保持（会话态、按节点 id 记）。

> **实现注记（2026-09-14 · P1 收尾小修）**：P1 实际宿主 = `NotePopover`（`mode="embedded"` + `pinned`；MapView `fixedNotePanels` 渲染位）——`NoteGrowthPanel` 为孤儿组件（全仓零生产渲染点；仅 `estimateNoteAreaHeight` / `FIXED_NOTE_GAP` 两常量被消费）。翻卡态自本批起为**宿主（MindmapStage）会话态**：面板卸载/重挂不丢、按节点 id 记、不落盘。纪律：派遣稿写宿主前先 grep 生产渲染点。

## 7. 编辑（P2，先定形态不实现）

- 编辑态 = **textarea（源文）+ 预览双态切换**（**不引 contenteditable/WYSIWYG**）；
- 写路径 = `controller.updateNote({ md })`（TreeOp，undo/自动保存零成本继承 ✓）；
- 保存时机：失焦/`Ctrl+Enter` 提交（比照既有 `DescBlock` 纪律）；空文本 = 删除 `md` 键。

## 8. 分阶段切片与验收门禁

### P1 · 最小闭环（只读卡，可外派）
- 交付：`note.md` 读侧透传 + 背面 markdown 只读渲染 + 翻面按钮（受控 FlipCard）+ 固定尺寸/内部滚动 + LOD 降级；**零协议改动、零布局改动、零既有交互改动**。
- 验收门禁：
  1. round-trip：含 `note.md` 的文件 parse→serialize→parse **逐字相同**（含多行块标量或转义形态）；
  2. 降级：旧版/未知键路径不报错不丢字段（golden）；
  3. 渲染单测：范围清单内每种语法的 DOM 断言（标题/列表/引用/代码块/任务列表/链接跳转回调） + **范围外语法按纯文本呈现**（图片/HTML 不被执行）；
  4. 交互：翻面按钮 → `aria-pressed` 翻转 + 背面出现；无 `note.md` → 无按钮；单击选中/双击编辑**不受影响**（反例钉）；
  5. 三包全绿 + 门禁（tsc×3 / depcruise / lint 水位 / budget）+ **bundle 增量实测记录**（若引库）。
- commit 建议：`feat(react): 节点卡背面 markdown 只读渲染（note.md 透传 + 翻面按钮；零协议改动）`

### P2 · 编辑与范围扩展
- 背面编辑（textarea+预览，§7）；表格；图片（单议 §1.2-1）；导出背面（export PNG/SVG 选面）。

### P3 ·（若确认需要）`type:'card'` + ADR
- 触发条件：卡需要独立布局语义/参与布局；前置：先立"未知 type 降级纪律"ADR。

## 9. 隔离形态（回答"要不要另立项目"）

- **不另立项目**：卡建立在"节点 + `note`"上，吃的是 `.mm.md` 事实源 + 既有布局/undo/导出/多中心地基；另立仓库 = 重造唯一差异化（纯文本事实源）。free-canvas 是 mindcanvas 的**演进方向**（§1.3），不是另一个产品。
- **同仓隔离**：独立组件（`chrome/` 内）+ 透传键（不动内核）+ 实验开关（渲染层 feature flag，缺省关或按 `note.md` 存在自适应）+ 降级纪律（不认识就不破坏）。
- 新增依赖（若引 markdown 库）走统一审查：许可（MIT 类）、体积、depcruise 规则、budget 记录。

## 10. 明确不做（本方向全程）

contenteditable/WYSIWYG；裸 HTML；背面源文进 `type` 联合类型（P3 前）；翻卡态持久化（会话态）；卡模板/主题系统；多卡批量操作；**任何对既有 note 三区域渲染语义的改动**。

## 11. 开放问题（需裁定后才转 P1 派遣稿）

1. **D1 数据形态**：确认走 `note` 透传键（推荐）还是坚持先做 `type:'card'`（需先立 ADR）？
2. **D2 引擎**：接受"引 markdown-it 类库（白名单约束）"，还是坚持零依赖自研受限子集？
3. **D3 尺寸**：S/M/L 固定档位（推荐）还是正反面自适应（会引入测量抖动）？
4. **D4 触发**：卡角 `[⟳]` 按钮 + 键盘 `F`（推荐）还是双击背面区域？

> 裁定后本稿转 P1 派遣稿（§2 任务 + TDD 红绿 + 阴性对照 + 报告格式），执行完停、等复核。
