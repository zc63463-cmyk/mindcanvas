# P2 派遣计划：节点卡背面编辑（textarea + 预览双态；写回 `note.md`）

> 状态：**待执行**。执行方开工第一件事：单独提交本文档（`docs: 追加 P2 背面编辑派遣计划`），然后再动代码。
> 来源：`docs/specs/2026-09-14-node-card-flip-markdown-design.md` §7（编辑形态）+ §8-P2（用户裁定：按 Phase 2 出稿）。本批**不 push**。

## §0 基线（开工先核对，不符先报告）

- 起点 HEAD = `9f0da8e`（P1 尾 + S2F + S2G 已推送，远端同步）。
- 三包：kernel **523** / react **1266** / canvas **209** = 1998 全绿；depcruise **440/1254** 零违规；lint **1468+46**；budget 持平（bigFiles **3/4**）。
- 未跟踪保留物：`tools/graph-engine/`（**禁区**）。
- 本批改 `packages/react`（chrome）+ `apps/canvas`（接线）→ **react 改源需重建 dist**（报告注明）。

## §1 背景（设计稿口径 + 已就位锚点，逐条核过）

- **§7 编辑口径**：编辑态 = **textarea（源文）+ 预览双态切换**；**不引 contenteditable/WYSIWYG**；写路径 = `controller.updateNote({ md })`（TreeOp → undo/自动保存零成本继承）；保存时机 = **失焦 / Ctrl+Enter 提交**（比照 `DescBlock` 纪律）；**空文本 = 删除 `md` 键**。
- **P1 已就位**：`note.md` 读侧透传（`panel.md` → `NotePopover` `md` prop）；背面渲染区 `NotePopover.tsx:574-588`（FlipCard back = `data-note-back-scroll` + `CardBackMarkdown`，含 `data-note-back-md` 锚点）；翻面按钮（header ⟳，受控 `interactive={false}`）；翻卡态宿主会话态（离屏保持）；`updateNote(id, patch)` 已支持 `md: undefined` 删键（`packages/react/src/edit/controller.ts:288`，undefined → delete）。
- **两条硬约束**：① 「编辑态一律屏幕浮窗」（`NotePopover.tsx:250` 注释——嵌入卡 120 基线装不下编辑器）→ md 编辑同走浮窗；② `flipActive = !floating && md 非空`（P1"编辑态不翻"）→ md 编辑态下 FlipCard 不渲染，编辑面即背面的替代视图。

## §2 任务

### P2-1 · `NoteBackEditor` 组件（新文件，chrome/ 内）

- 位置：`packages/react/src/chrome/NoteBackEditor.tsx`；**NotePopover 600 行守线**（现 600/600：新 UI 不得内联；若接线后仍超线 → 优先把背面渲染块一并提取，超线则报告——budget bigFiles 允许 4/4）。
- 结构：源文 `textarea`（等宽、多行、非受控 `defaultValue` 防 IME/焦点抖动——同 NotePopover 正文区做法）+ **「源文 / 预览」单窗双态切换**（预览**复用 `CardBackMarkdown`** 同源渲染，零新解析）；锚点 `data-note-md-editor` / `data-note-md-mode`。
- 提交纪律：**先读 `DescBlock.tsx` 实测口径并抄进报告**（失焦提交 / Ctrl+Enter 提交 / 是否 Esc 取消以实际为准）——本组件与 DescBlock 对齐，不得自创。
- 空文本（`md.trim() === ''`）提交 → 上抛"删除"语义（**组件不删键**，由上层映射）。

### P2-2 · NotePopover 接线

- 新增 prop：`onChangeMd?: (md: string) => void`（提交回调）。
- 背面态 header 新增「编辑背面」按钮（`data-note-md-edit`）：**仅 `isFlipped && md 非空 && !floating` 渲染**（默认态/正面态零新增 DOM——既有"零感知"断言不动）；`pointerdown` stopPropagation 纪律同 ⟳。
- 本地态 `mdEditing`：进入 → `floating` 判定扩展为 `mode !== 'embedded' || editing || mdEditing` → 浮窗内渲染 `NoteBackEditor`（**替代** seq/text 区；进入时 autofocus）；提交/取消 → 退出（保持 `isFlipped` 不变，回固定卡背面看新内容）。
- 互斥核对：`flipActive` 门**逐字不动**（mdEditing → floating → 自然不翻）；正面编辑（seq/text）路径零改动。

### P2-3 · 写回链 + e2e

- `MapView.tsx`：新增 `onNoteChangeMd?: (id: string, md: string) => void`（同 `onNoteChangeSeq` 先例，固定卡渲染位透传）。
- `MindmapStage.tsx`：`onNoteChangeMd={(id, md) => controller.updateNote(id, md.trim() === '' ? { md: undefined } : { md })}`（空 → 删键，§7 口径；**不 trim 存储值**，只 trim 判空）。
- e2e（`apps/canvas/tests`，真 MindmapStage；模板 = `note-flip-host.test.tsx`）：含 `note.md` 文档 → 固定 → 翻面 → 「编辑背面」→ 改源文 → Ctrl+Enter → 重开背面显示新内容；**清空提交 → `md` 键删除 → 翻面按钮消失**；round-trip：编辑后 `serialize()` 含新 md（逐字）。
- 守卫交互：md 编辑 → dirty → 自动保存（S2G 守卫正常放行——e2e/单测注明；**不需**改任何 S2G 判据）。

### P2-4 · 收口

- **阴性对照**：① 预览切换不生效（恒源文态）→ 双态钉红；② 空文本不删键 → e2e 钉红（贴原文 → 回退）。
- CHANGELOG 新段 **[1.8.21]**；报告 `outputs/2026-09-15-p2-back-edit-report.md`（红/绿原文、组件 diff、DescBlock 口径抄录、e2e、NotePopover 行数）。
- 门禁：tsc×3 = 0；三包（kernel 523 不动 / react 1266+Δ / canvas 209+Δ）全绿；depcruise 零违规；lint **≤1468+46**；budget 持平（bigFiles ≤4）；**重建 react dist**。
- 定向清理：本批自产 `tmp-*`；`tools/graph-engine/` 不动。

### 提交计划（每条一提交，禁 `git add -A`/`git add .`）

1. `docs: 追加 P2 背面编辑派遣计划`
2. `feat(react): 背面 markdown 编辑（NoteBackEditor + 双态切换 + 编辑背面入口）`
3. `feat(canvas): note.md 写回链（空文本删键）+ e2e`
4. `docs: P2 收口（CHANGELOG [1.8.21] + 报告）`

## §3 决策点（已给推荐，按推荐执行，不要停下问）

- **D1 编辑器宿主** = **浮窗**（沿"嵌入卡装不下编辑器"口径）；新组件承载，守 NotePopover 600 线。
- **D2 触发** = 背面态 header「编辑背面」（默认态零新增 DOM）。
- **D3 提交纪律** = 照 `DescBlock` 实测口径（失焦 / Ctrl+Enter / Esc 以实际为准），抄录进报告。
- **D4 空文本** = 删 `md` 键（`{ md: undefined }`）；删后翻面入口消失（P1 零感知语义保留）；`flippedNoteIds` 里的 id **不顺手清**（承既有裁决口径，报告注明）。
- **D5 不做创建入口**（没有 md 的节点如何写第一条）——属"背面源文生产"问题，记为后续切片（§7 O7），本批只编辑已有 md。
- **D6 双态切换** = 单窗内「源文 / 预览」切换；预览 = `CardBackMarkdown` 同源（零新解析）。
- **D7 版本** = `[1.8.21]`；P2 剩余切片（表格 / 图片 / 导出背面）**不在本批**。

## §4 停止条款

- 若 `DescBlock` 纪律与设计稿 §7 冲突 → 以 DescBlock 为准 + **停下报告**。
- 若需把编辑器内联进 NotePopover 才能成立（>600 行且无法提取）→ 停。
- 若既有 P1 钉（零感知 :47-48 / 翻面按钮 / footprint 三钉 / 双击不翻）需放宽 → 停。
- lint 上升 / budget 超限 / depcruise 违规 → 停。

## §5 报告格式

- 逐任务：commit hash + 改动文件 + 红/绿断言原文 + 新增用例数。
- P2-1：组件 diff + DescBlock 口径抄录（逐条）。
- P2-2：NotePopover diff + 行数前后 + 既有钉未动证据。
- P2-3：写回链 diff + e2e 原文（含清空删键、round-trip）。
- P2-4：负控原文 + 门禁原样 + `git status --short` 原文 + 清理结果。
- 偏差与原因；然后停，等复核（**不 push**）。

## §6 冻结纪律

阈值/契约测试不得放宽；禁 `git add -A`；**不 push**；不动 `.codebuddy/`、`.workbuddy/`、`tools/graph-engine/`；`CULL_MARGIN` 不动；不改 git config；S2F 判据 / S2G 守卫 / L 批行内链接 / note 三区域渲染语义**逐字不动**；报告必须含红/绿原文，不许"已修复"式无证据陈述。

## §7 后续切片（不在本批）

- P2b 表格（`CardBackMarkdown` 渲染层扩展）；P2c 图片（前置：§1.2-1 须论证"纯文本引用 + 资产目录"不构成同类破坏）；P2d 导出背面（export PNG/SVG 选面）；P2e 创建入口（"第一条 md"的零感知方案）。见 `docs/roadmap/2026-09-15-open-items.md` O7。
