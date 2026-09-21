# H1 派遣计划：卫生四合一（O1 tsc 探底 + O2 闪帧 + O3 关闭 + O4 jumpToAnchor 钉）

> 状态：**待执行**。执行方开工第一件事：单独提交本文档（`docs: 追加 H1 卫生批派遣计划`），然后再动代码。
> 来源：`docs/roadmap/2026-09-15-open-items.md` 的 O1 / O2 / O3 / O4（各有来源锚点）。本批**不 push**。
> **执行顺序**：与 P2b（`2026-09-15-p2b-md-table-plan.md`）**串行**，本批在其后；两批**严禁并行同一工作树**。

## §0 基线（开工先核对，不符先报告）

- 起点 HEAD = **以开工实测为准**（P2b 收口后应为 `b17f92b` + 3 提交；若 P2b 未跑则 = `b17f92b`，先报告再继续）。
- 三包参考值（P2b 后应 = 实测）：kernel **523 不动** / react **1281 + P2b 增量** / canvas **211 不动**；depcruise / lint / budget 以开工实测对账（lint 必须 = **1468+46**，若 P2b 已升水位则以其收口值为基线，报告注明）。
- 未跟踪保留物：`_tmp_93540_*`（内核级锁死，**不动**）、`tools/graph-engine/`（**禁区**）、**P2b 的计划文件（别批的，勿动勿提交）**。
- 本批改 `apps/canvas`（O2/O4 + 新增 test config）→ 未改 `packages/react` 源 → **无需重建 dist**（若 O2 意外触及 react 层则重建并报告）。
- 号位：**[1.8.23]**（若顺序对调则与 P2b 对调，开工以 CHANGELOG 顶号 +1 为准）。

## §1 背景（四项来源锚点，逐条）

- **O1**（tsc 盲区）：`apps/canvas/tsconfig.json:11` include 只含 `["src","vite.config.ts"]` → 测试文件类型错误仅靠运行期暴露（S2G 实录）。
- **O2**（闪帧）：S2G 报告 §偏差 #3——`handleSave` 的守卫检查在 `runSave` 任务**内**，而「保存中」指示在任务**外**先置位 → 被拦时指示闪现一帧（`apps/canvas/src/hooks/useDocumentActions.ts` 现结构）。
- **O3**（孤儿）：`NoteGrowthPanel` 零生产渲染点（设计稿实现注记 :123）；ADR-0004 冻结导出面。
- **O4**（宿主跳转无钉）：L 批遗留——第二道闸（非 well-formed 不动作）+ 实体桥只由真浏览器脚本覆盖；处理器锚点 `apps/canvas/src/MindmapStage.tsx:423`（`resolveLinkAnchor`）/ `:1731`（`onJumpToAnchor={jumpToAnchor}`）。

## §2 任务

### H1-1 · O1 探底（只探不改）

1. 三包 `tsconfig` 的 include 现状表（kernel / react / canvas：tests 是否在类型覆盖内）。
2. **新增** `apps/canvas/tsconfig.test.json`（extends 主配置 + `include: ["src","tests","vite.config.ts"]`）——**不动既有 `tsconfig.json`**；如 react/kernel 也缺覆盖，可各加同款（报告注明必要性）。
3. 跑 `tsc -p apps/canvas/tsconfig.test.json --noEmit`：**计数 + 前 20 条样例**（原文）。
4. 处置（D2）：**零错误** → 顺手把 gate 纳入（最小面：`.githooks/pre-push` 的 `run_gate` 补一行，或记入 open-items 待用户定——二选一按 D2）；**错误非零 → 只报告**（计数 + 样例），**不许顺手修类型**（另立批），并把 open-items O1 更新为实测数字。
5. O1 完成的 open-items 标注（已探底/已入 gate，实测数字）。

### H1-2 · O2 闪帧（位置调整）

- `useDocumentActions.handleSave`：守卫检查从 `runSave(async () => {...})` **任务内**移到 `runSave` **之前**（守卫不通过 → 通知 + `return`，**不进入** runSave）。
- 判定 / 通知文案 / 通知次数语义**零变**（仅指示器不再闪）。
- 新钉（先红）：被拦时 **`onSavingChange` 不被调用**（现行实现会先 true 后 false → 红原文）；S2G 既有三钉（拒写/通知/放行）全绿不动。

### H1-3 · O4 jumpToAnchor 宿主钉

- 新增 1–2 例（`apps/canvas/tests`，模板 = P2 e2e 的 MindmapStage 设施；可并入 `note-back-edit.test.tsx` 或新文件，报告注明落点）：
  1. **well-formed 锚点击 → 跳转生效**：夹具文档含 `[跳](node:根/甲)`（**选实际已通 `onJumpToAnchor` 的渲染区**——背面 md 已通；先读 `MindmapStage.tsx:415-430` 处理器实现，把断言锚在**可观测副作用**上（目标节点选中/展开/视图定位中择其可断言者），处理器原文抄录进报告）；
  2. **非 well-formed 锚 → 不动作**（第二道闸钉；若无现成入口可注入坏锚，说明并降为 1 例，报告注明）。
- 范围：**只加测试，不动产品代码**（若发现真缺陷 → 停，报告）。

### H1-4 · O3 关闭（docs）

- `docs/roadmap/2026-09-15-open-items.md` O3 行标注「**裁定：保留**（ADR-0004 冻结导出面 + 零生产渲染点，不清理）」——不改组件、不动导出。

### 收口

- CHANGELOG 新段 **[1.8.23]**；报告 `outputs/2026-09-15-h1-hygiene-report.md`（O1 实测数字与样例、O2 红→绿原文、O4 断言口径与处理器抄录、O3 标注 diff）。
- 门禁：tsc×3 = 0；三包（kernel 523 不动 / react 不动 / canvas 211+Δ）全绿；depcruise 零违规；lint **≤ 基线值（1468+46 或 P2b 后水位）**；budget 持平。
- 定向清理：本批自产 `tmp-*`；保留 `_tmp_93540_*`、`tools/graph-engine/`、P2b 计划文件。

### 提交计划（每条一提交，禁 `git add -A`/`git add .`）

1. `docs: 追加 H1 卫生批派遣计划`
2. `test(canvas)+chore: O1 tsc 探底配置 / O2 闪帧位置调整 / O4 jumpToAnchor 宿主钉`（若 O1 进 gate 则 gate 变更并入此提交或独立——报告注明）
3. `docs: H1 收口（CHANGELOG [1.8.23] + 报告 + open-items O1/O3 标注）`

## §3 决策点（按推荐执行，不要停下问）

- **D1** test config = **只新增文件**，不动既有 tsconfig。
- **D2** 探底结果：**零错误 → 推荐进 gate**（最小一行）；非零 → 只报告 + 更新 O1 数字（修复另立批）。
- **D3** O2 只挪位置，不动判定/通知语义/文案。
- **D4** 版本 `[1.8.23]`（顺序对调则与 P2b 对调）。

## §4 停止条款

- O1 探底错误量大且"看起来很好修" → **停**（本批只探底，不许修）。
- O2 位置调整导致任一 S2G 既有钉需改 → 停。
- O4 断言无法落在可观测副作用上 → 报告换口径（不许硬造断言）；发现产品缺陷 → 停。
- lint 上升 / budget 超限 / depcruise 违规 → 停。

## §5 报告格式

- 逐任务：commit hash + 改动文件 + 红/绿断言原文 + 新增用例数。
- H1-1：include 现状表 + 错误计数/样例（或零错误 + gate 变更 diff）+ open-items O1 更新。
- H1-2：位置调整 diff + 闪帧钉红→绿原文 + S2G 既有钉未动证据。
- H1-3：处理器抄录 + 断言口径 + 用例原文。
- H1-4：O3 标注 diff。
- 偏差与原因；然后停，等复核（**不 push**）。

## §6 冻结纪律

阈值/契约测试不得放宽；禁 `git add -A`；**不 push**；不动 `.codebuddy/`、`.workbuddy/`、`tools/graph-engine/`、`_tmp_93540_*`、**P2b 计划文件**；`CULL_MARGIN` 不动；不改 git config；S2G 守卫语义 / S2F 判据 / P2 编辑链**逐字不动**；报告必须含红/绿原文。
