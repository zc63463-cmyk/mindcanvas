# P2b 派遣计划：背面 markdown 表格（CardBackMarkdown 渲染层扩展）

> 状态：**待执行**。执行方开工第一件事：单独提交本文档（`docs: 追加 P2b 表格渲染派遣计划`），然后再动代码。
> 来源：设计稿 `docs/specs/2026-09-14-node-card-flip-markdown-design.md` D2 范围表（P1 明确不支持表格 → P2 支持）。本批**不 push**。
> **执行顺序**：本批与 H1 卫生批（`2026-09-15-h1-hygiene-plan.md`）**串行**，本批先行；两批**严禁并行同一工作树**。

## §0 基线（开工先核对，不符先报告）

- 起点 HEAD = `b17f92b`（P2 + O10 已推送，远端同步）。
- 三包：kernel **523** / react **1281** / canvas **211** = 2015 全绿；depcruise **443/1262** 零违规；lint **1468+46**；budget 持平（bigFiles **3/4**）。
- 未跟踪保留物：`_tmp_93540_*`（内核级锁死，不动）、`tools/graph-engine/`（禁区）、**H1 的计划文件（别批的，勿动勿提交）**。
- 本批改 `packages/react`（chrome）→ **需重建 react dist**。
- 号位：本批 = **[1.8.22]**（若与 H1 顺序对调则对调，开工以 CHANGELOG 顶号 +1 为准）。

## §1 背景（复核已核实的锚点）

- **范围**：GFM pipe 表格子集——`|` 分列（首尾管道可选）、header 行 + delimiter 行（`---` / `:--` / `:--:` / `--:`）判定、`\|` 转义不拆列、列数以 header 为准（多丢少补）；**不含** HTML 表格、colspan/rowspan。
- **现状**：`packages/react/src/chrome/CardBackMarkdown.tsx` = **535 行**（budget 口径），行扫描 parser（heading/paragraph/code/hr/quote/list）+ `renderInline`（tokenizeInline 同口径：strong/code/link）。P1 注释与测试把表格列为**范围外（按段落文本行呈现）**——本批把它转为支持项。
- **行数账**：+表格（估 ~70 行）→ ~605 **必破 600 线** → 按 P2 守线先例**提取 parser**：新纯函数模块 `packages/react/src/chrome/cardBackMd.ts`（块类型 + `parseCardBackMd` + 各 parse 辅助），`CardBackMarkdown.tsx` 只留渲染。`parseCardBackMd` 的**全仓唯一测试消费方** = `packages/react/tests/card-back-markdown.test.tsx`（改 import 路径一行，白名单②）。
- **同源受益**：`NoteBackEditor` 预览复用 `CardBackMarkdown` → 编辑器预览自动获得表格，零额外改动。

## §2 任务

### P2b-1 · parser 扩展 + 模块提取

- 新模块 `cardBackMd.ts`：迁移既有块类型（`CardBackBlock`/`CardBackItem`）与解析函数（**逐字搬迁，零语义改动**），新增 `{ t: 'table'; align: ('left'|'center'|'right'|null)[]; head: string[]; rows: string[][] }`：
  - 判定：当前行含 `|`（或将来视为候选）**且下一行**为合法 delimiter 行（列数 ≥ 1、每列 `:?-{1,}:?`）→ 表格块；
  - 拆列：按未转义 `|`；首尾管道可选（剥离）；`\|` 保持字面；
  - 列数：以 header 为准——行多丢、行少补空串；
  - `startsBlock()` **增表格起点判定**（表格终止前文段落；与既有块判定同序）；
  - 引用块内表格：沿递归解析**自然获得**（quote 剥 `>` 后走同一 parser）；列表项内表格**不支持**（沿 P1 简化口径，报告注明）。
- `CardBackMarkdown.tsx`：删除已迁移代码，import 自 `cardBackMd.js`；**不做 re-export 兼容层**（测试直接改 import，见白名单②）。

### P2b-2 · 渲染

- `<table data-note-md-table>` + `thead/tr/th` + `tbody/tr/td`；单元格内容走 `renderInline`（strong/code/link 同口径——**含内部锚链接**，与段落行为一致）；
- 对齐 → `textAlign`（th/td 同列同款）；
- 样式：CHROME token（边框 `panelBorder`、内边距、字号与既有块一致，**不引第二套主题**）；表格容器窄面板内**允许横向滚动**（`overflowX: 'auto'`，同代码块先例）；
- 无 delimiter 行 → **维持段落语义**（范围外不升级）。

### P2b-3 · 判别钉（先红）

新增 ≥ 8 例（`card-back-markdown.test.tsx` 或提取后新文件，报告注明落点）：
- 解析：基本 2×2 / 对齐三态 + 无对齐 / 首尾管道可选 / `\|` 转义不拆列 / 列数不齐（多丢少补）/ **无 delimiter 行 = 段落**（范围外不升级钉）/ 表格终止前文段落 / 引用内表格；
- 渲染：thead+th 文本 / 单元格行内（`**粗**`、`[锚](node:…)` → `data-note-md-anchor`）/ 对齐 style / `data-note-md-table` 存在。

**既有断言白名单（仅此两类，报告逐条给理由）**：
1. `card-back-markdown.test.tsx` 中既有「表格按段落文本呈现」的范围外钉 → **翻转为表格渲染断言**（行为升级即本批功能；图片/裸 HTML 等其余范围外钉**逐字保持**）；
2. 该测试文件的 `parseCardBackMd` import 路径行（模块提取所致）。
其余一切断言零改动。

### P2b-4 · 收口

- **阴性对照**：临时拆掉 delimiter 判定（表格永远不成立）→ 表格解析钉红（贴原文 → 回退 + `git diff` 自证）。
- CHANGELOG 新段 **[1.8.22]**；报告 `outputs/2026-09-15-p2b-md-table-report.md`（红/绿原文、提取前后两文件行数、白名单逐条理由）。
- 门禁：tsc×3 = 0；三包（kernel 523 不动 / react 1281+Δ / canvas 211 不动——纯 react 层）全绿；depcruise 零违规（模块 +1 = `cardBackMd.ts`，归因）；lint **≤1468+46**；budget 持平（bigFiles ≤4，目标 3/4 保持——两文件均应 <600）；**react dist 重建**。
- 定向清理：本批自产 `tmp-*`；保留 `_tmp_93540_*`、`tools/graph-engine/`、H1 计划文件。

### 提交计划（每条一提交，禁 `git add -A`/`git add .`）

1. `docs: 追加 P2b 表格渲染派遣计划`
2. `feat(react): 背面 markdown 表格（GFM 子集；parser 提取 cardBackMd.ts）`
3. `docs: P2b 收口（CHANGELOG [1.8.22] + 报告）`

## §3 决策点（按推荐执行，不要停下问）

- **D1 语法范围** = GFM pipe 表格子集（上列清单）；转义仅 `\|`；不做 HTML/colspan/嵌套表格（列表项内）。
- **D2 结构** = **提取 parser 到 `cardBackMd.ts`**（推荐；535+70 破线是算术事实）。若实现出奇紧凑（≤600）可内联——报告给行数证据。
- **D3 引用内表格** = 支持（递归解析白捡）；列表项内表格 = 不支持（报告注明）。
- **D4 版本** = `[1.8.22]`（顺序对调则与 H1 对调）。

## §4 停止条款

- `card-back-markdown.test.tsx` 中需翻转的"表格"既有断言**不止一处** → 停下报告（不许顺手多翻）。
- 提取后任一文件仍超 600（budget 口径）→ 停下报告。
- 图片/裸 HTML 等其余范围外钉需任何改动 → 停。
- lint 上升 / budget 超限 / depcruise 违规 → 停。

## §5 报告格式

- 逐任务：commit hash + 改动文件 + 红/绿断言原文 + 新增用例数。
- P2b-1：提取 diff 概览（搬迁量 vs 新增量）+ 两文件行数前后。
- P2b-3：白名单逐条理由 + 新钉清单。
- P2b-4：负控原文 + 门禁原样 + `git status --short` 原文 + 清理结果。
- 偏差与原因；然后停，等复核（**不 push**）。

## §6 冻结纪律

阈值/契约测试不得放宽（白名单两类除外）；禁 `git add -A`；**不 push**；不动 `.codebuddy/`、`.workbuddy/`、`tools/graph-engine/`、`_tmp_93540_*`、**H1 计划文件**；`CULL_MARGIN` 不动；不改 git config；既有块语义（heading/list/quote/code/hr/paragraph）与行内口径**逐字不动**；报告必须含红/绿原文。
