# P1 收尾小修派遣计划（翻卡态宿主保持 + FlipCard 非交互模式 + 最小记录）

> 状态：**待执行**。执行方开工第一件事：单独提交本文档（`docs: 追加 P1 收尾小修派遣计划`），然后再动代码。
> 依据：复核裁定（2026-09-14）四项 = `①确认 ②A（做） ③做 ④现在推`。④ 已完成：远端 `main` 已推至 `da1c67d`（P1 [1.8.17]）。本批在其上，**不 push**。

## §0 基线（开工先核对，不符先报告）

- 提交：`da1c67d`（本地 = 远端 = origin/main）。
- 三包：kernel **516** / react **1206** / canvas **195** = 1917 全绿。
- 门禁：tsc ×3 = 0；depcruise **432 模块 / 1224 deps** 零违规；lint **1468 + 46**；budget 持平（bigFiles 3/4）。
- 工作树（未跟踪）：`tmp-push.ps1`、`tmp-push-1.out/.err`、`tmp-push.log`（复核者推送残留，本批可清）、`tmp-r6-s3-commit-msg.txt`（R6 已收口，可清）、`tmp-v7-s1.diff`、`_tmp_93540_*`（**来源未识别，不动，报告列出**）、`tools/graph-engine/`（**照旧不动**）。

**DoD（复核四条）**：① 断言改动仅白名单 3 处、`chrome.test.tsx:34-46` 逐字未动；② 三包全绿 + 门禁持平（lint 不得上升）；③ "卸载重挂保持"可证或如实报告残余；④ 提交后 `git diff` 空 + 清理执行 + 报告含红/绿原文。

## §1 背景（三项裁定的证据原文）

- **② 翻卡态离屏保持 = 设计稿明文承诺，P1 未兑现**：
  - 设计稿 `docs/specs/2026-09-14-node-card-flip-markdown-design.md:121`："翻卡态随节点离屏保持（会话态、按节点 id 记）"；
  - 实现 `NotePopover.tsx:204`：`useState(false)` + 注释"以 `key={panel.id}` 挂载/卸载" → **面板卸载即丢态**。
  - 裁定：**A 做**（提升宿主态），不是"接受现状"。
- **③ 幽灵按钮 = 真实 a11y 语义缺陷**：`NotePopover.tsx:253-255` 注释明写"受控 FlipCard 不注入 onFlip——整卡点击 no-op"✓；但 `FlipCard.tsx:54-74` 仍恒渲染 `role="button"` + `aria-pressed` + `tabIndex=0` + `cursor:pointer` → 屏幕阅读器播报"按了没反应的按钮"、Tab 停在死控件。裁定：**做**，且与 ② 同批。
- **① 宿主勘误 = 事实确认 + 最小记录**：P1 宿主 = `NotePopover(embedded)`（MapView `fixedNotePanels` 渲染位）✓；`NoteGrowthPanel` 为孤儿组件（零生产渲染点，仅 `estimateNoteAreaHeight`/`FIXED_NOTE_GAP` 被消费）。裁定：**确认**，并把勘误与孤儿状态落成记录。

## §2 任务

### P1-T1 · 翻卡态提升宿主（②）

改动面（三处，其余零改动）：

1. `apps/canvas/src/MindmapStage.tsx`
   - 新增会话态集合 `flippedNoteIds`（推荐 `useState<Set<string>>` + 幂等 toggle；同 `pinnedNotePaths`/`editingNotePaths` 先例，:619-635 附近）；**不落盘**；节点删除**不顺手清**（承 :1518 既有裁决口径，报告注明）。
   - `<MapView`（:1452）紧邻 `pinnedNoteIds`/`editingNoteIds`（:1533-1534）传 `flippedNoteIds` + `onToggleNoteFlip`。
2. `packages/react/src/render/MapView.tsx`
   - props 区（:153 邻 `pinnedNoteIds?: readonly string[]`）加 `flippedNoteIds?: readonly string[]` + `onToggleNoteFlip?: (id: string, next: boolean) => void`；解构（:361 区）。
   - 固定卡渲染位（:2120/:2145 两处 `NotePopover` 中 **embedded 那处**；floating 预览处零改动）传 `flipped={...has(panel.id)}` + `onFlipChange`。
3. `packages/react/src/chrome/NotePopover.tsx`
   - `:204` 内部态改为**受控/非受控双模**：新增 `flipped?: boolean` + `onFlipChange?: (next: boolean) => void`；`flipped === undefined` 时保持内部 state（= 今日行为，同 FlipCard `contrl` 先例）；`:539` 区按钮点击走统一 `set(next)` 通道。
   - `flipActive` 门（:255）**逐字不动**（floating/编辑态不翻）。

验收测试（`packages/react/tests`，新文件或并入既有）：
- ① 传 `flippedNoteIds: ['n1']` → n1 面板出示背面、其它面板不受影响；
- ② 点击翻面按钮 → `onToggleNoteFlip('n1', true)` 恰一次；
- ③ **卸载重挂保持**：面板因 props 变化卸载（如 `pinnedNoteIds` 短暂移除再恢复）→ 重挂后仍背面；
- ④ 负向：`flippedNoteIds` 含不存在 id → 零影响、不崩。

端到端（`apps/canvas/tests`，尽力项）：真 `MindmapStage`（设施见 `delete-key.test.tsx:67`、`edge-health-bar.test.tsx:146`）——若能以 ≤30 分钟成本让固定 note 卡可见：翻面 → 触发面板卸载重挂 → 仍背面；**若成本过高 → 报告明文写"未覆盖的残余"**，不得静默跳过。

红证据：目标测试先行 → 贴红原文（类型红可接受，须注明红在哪一层；行为红优先）。

### P1-T2 · FlipCard 非交互模式（③）

- `FlipCard.tsx`：新增 `interactive?: boolean`（缺省 `true`）。`false` 时：不渲染 `role`/`aria-pressed`/`aria-label`/`tabIndex`/`onKeyDown`/`onClick`，`cursor` 缺省（去 pointer）；**始终**输出 `data-flip-card` 与 `data-flip-state={isFlipped ? 'back' : 'front'}`（测试锚点）。
- `NotePopover.tsx`：内部渲染 FlipCard 处传 `interactive={false}`（整卡 no-op 设计保留，只去误导语义）。
- 验收测试：① 非交互：无 role/tabIndex、无 `cursor:pointer`、点击整卡无翻转无回调；② 交互缺省：`chrome.test.tsx:34-46` 两例**逐字不动**通过 + 补 `data-flip-card` 存在断言。

**既有断言改动白名单（仅此 3 处，报告逐条给理由）**：
1. `note-panel-flip.test.tsx:48` `div[role="button"]` → `[data-flip-card]`（锚点替换，语义不变）；
2. `note-panel-flip.test.tsx:77` role 锚点 → `[data-flip-card]`；
3. `note-panel-flip.test.tsx:80-85` 卡级 `aria-pressed` 断言 → `data-flip-state` 断言（保护强度不变：仍钉"按钮按了、卡真翻了"）。
其余断言（含双击不翻、stopPropagation、footprint 三钉）**逐字不动**。

红证据：非交互测试在旧实现上必红（旧代码恒渲染 `role="button"`）→ 贴原文。

### P1-T3 · 最小记录 + 收口（①）

1. 设计稿实现注记（`docs/specs/2026-09-14-node-card-flip-markdown-design.md`，紧邻 §6 或 §1 后，≤15 行）：

   > **实现注记（2026-09-14 · P1 收尾小修）**：P1 实际宿主 = `NotePopover`（`mode="embedded"` + `pinned`；MapView `fixedNotePanels` 渲染位）——`NoteGrowthPanel` 为孤儿组件（全仓零生产渲染点；仅 `estimateNoteAreaHeight` / `FIXED_NOTE_GAP` 两常量被消费）。翻卡态自本批起为**宿主（MindmapStage）会话态**：面板卸载/重挂不丢、按节点 id 记、不落盘。纪律：派遣稿写宿主前先 grep 生产渲染点。

2. CHANGELOG 新段 **[1.8.18]**（P1 [1.8.17] 已推送，F5"并入"先例不适用；不跳号）：
   - 翻卡态提升至宿主（MindmapStage 会话态集合；面板卸载/重挂不再丢翻面；不落盘）；
   - `FlipCard` 新增 `interactive?: boolean`（缺省 true 向后兼容；`false` 去 role/aria-pressed/tabIndex/键盘与整卡点击、cursor 缺省）——受控 no-op 场景去"幽灵按钮"语义；新增 `data-flip-card`/`data-flip-state` 锚点；
   - 记录：P1 宿主勘误（NotePopover embedded）与 `NoteGrowthPanel` 孤儿观察项（设计稿实现注记）。
3. 报告 `outputs/2026-09-14-node-card-p1-tail-fix-report.md`：红/绿原文、三处 diff、三包数字、门禁原样、白名单改动逐条理由、端到端尽力项结论。
4. 门禁：tsc ×3 = 0；kernel **516 不动** / react 1206+Δ / canvas 195+Δ 全绿；depcruise 零违规；lint **≤1468+46**；budget 持平。
5. 定向清理：`tmp-push.ps1`、`tmp-push-1.out`、`tmp-push-1.err`、`tmp-push.log`、`tmp-r6-s3-commit-msg.txt`（R6 已收口）；**保留** `tmp-v7-s1.diff`、`_tmp_93540_*`（来源未识别，报告列出）；`tools/graph-engine/` 不动。

### 提交计划（每任务一条，禁 `git add -A`/`git add .`）

1. `docs: 追加 P1 收尾小修派遣计划》
2. `feat(canvas,react): 翻卡态提升宿主保持（离屏不丢；NotePopover 受控双模）`
3. `fix(react): FlipCard 增加 interactive（受控 no-op 去幽灵按钮语义；锚点 data-flip-card）`
4. `docs: P1 收尾小修收口（CHANGELOG [1.8.18] + 报告 + 设计稿实现注记）`

## §3 决策点（已给推荐，按推荐执行，不要停下问）

- **D1 宿主落点** → 推荐 **MindmapStage**（同 pinned/editing 先例；"会话态、不落盘"归应用层；P2 背面编辑要与 `editingNotePaths` 交叉约束）。若执行中发现 MapView 有更强就近先例 → 可改，报告给理由。
- **D2 NotePopover 受控形态** → `flipped` + `onFlipChange` 双模（缺省回退内部 state = 现行为），不新增 store/context。
- **D3 测试锚点** → `data-flip-card` / `data-flip-state`；role 锚点仅白名单 3 处可改。
- **D4 版本** → **[1.8.18] 新段**。
- **D5 红证据形态** → 类型红可接受但须注明层级；行为红优先。
- **D6 端到端残余** → 允许降级，但必须报告明文列出未覆盖残余（不许静默）。

## §4 风险与停止条款

- **STOP 并报告**（不许自行扩散）：
  - 需要改 `fixedNotePanelsOf` 契约并波及 MapView 之外的调用方；
  - 需要放宽白名单以外的任何既有断言；
  - lint 计数上升 / budget 超限；
  - MapView 或 MindmapStage 已有同名 props/状态导致语义冲突。
- 风险（必须守住）：
  - `flipActive` 门与 floating/编辑态不翻逐字不动；footprint 三钉（estimateNoteAreaHeight=132 / 尺寸不变）不动；
  - 纯 React 状态改动：**不得**引入 layout/collect/渲染热路径新增；`estimateNoteAreaHeight` 链零改动；
  - `Set` 状态与既有"不顺手清"口径一致（报告注明）；不落盘、不新增持久化。

## §5 报告格式

- 逐任务：commit hash + 改动文件 + 红/绿断言原文 + 新增用例数。
- T1：宿主态接线点 diff（三段）+ 卸载重挂测试原文 + 端到端结论（或残余说明）。
- T2：FlipCard diff + 白名单 3 处逐条理由 + `chrome.test.tsx` 未动证据。
- T3：门禁原样输出 + `git status --short` 原文 + 清理结果。
- 偏差与原因；然后停，等复核（**不 push**）。

## §6 冻结纪律

阈值/契约测试不得放宽（白名单 3 处除外）；禁 `git add -A`；**不 push**；不动 `.codebuddy/`、`.workbuddy/`、`tools/graph-engine/`；`CULL_MARGIN` 不动；不改 git config；报告必须含红/绿原文，不许"已修复"式无证据陈述。
