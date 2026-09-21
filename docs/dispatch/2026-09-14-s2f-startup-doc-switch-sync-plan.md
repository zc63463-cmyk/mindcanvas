# S2F 派遣计划：启动页文档切换同步（方案 A · 状态判据修复）

> 状态：**待执行**。执行方开工第一件事：单独提交本文档（`docs: 追加 S2F 启动页文档切换同步派遣计划`），然后再动代码。
> 来源：P1 收尾小修复核的「范围外发现①」（`outputs/2026-09-14-node-card-p1-tail-fix-report.md` §范围外发现①），用户裁定：**采用方案 A 深度修复**。本批**不 push**。

## §0 基线（开工先核对，不符先报告）

- 起点 HEAD = `aca0af8`（P1 收尾小修；若已推送则远端同步，若未推送**按现状继续、不代执行 push**）。
- 三包：kernel **523** / react **1266** / canvas **197** = 1986 全绿；depcruise **438/1249** 零违规；lint **1468+46**；budget 持平（bigFiles 3/4）。
- 未跟踪保留物：`_tmp_93540_*`、`tmp-v7-s1/s2.diff`（来源未识别，**不动**、报告列出）；`tmp-rev-t1.diff` / `tmp-rev-t2.diff`（复核者残留，**本批可清**）；`tools/graph-engine/`（**禁区**）。
- 本批只改 `apps/canvas` → **packages/react 与 kernel 未改源，无需重建 dist**（报告注明）。

## §1 背景与证据链（复核已逐行核实的机制）

1. **症状**：冷启动（有最近文档）→ 启动页 →「继续上次/最近/新建」任一出口 → 文档名已切、画布仍是 gateway 示例树，且**整个会话不自愈**（要再切一次文档才恢复）。「看内置示例」正常。
2. **三拼图**：
   - ① doc 初值硬编码 gateway（`apps/canvas/src/MindmapStage.tsx:187-190`）；controller 随初始树**只创建一次**（`:208-226`）；
   - ② 启动页分支**早退**（`:245-267`），`StageContent`（内含 `useDocumentSwitch`）在启动页期间**未挂载**；
   - ③ 三条出口 `setDoc` **直通**（`:256` / `:261` / `:264`）——当年注释（`:250-255`）只论证了"未保存守卫不需要"，**漏了切换的 reset 语义**。
3. **时序**：controller 按 gateway 树创建 → 启动页（StageContent 未挂载）→ 点出口 setDoc(目标) → StageContent **首次挂载** → hook 首次运行 → `isFirst` → **跳过四动作**（`useDocumentSwitch.ts:49-66`；四动作 = `reset` / `setEntities` / `setExpandedQaId(null)` / `fit`）→ 唯一一次同步机会被吃掉 → 错位持久。
4. **看示例幸免**：`:264` 只 `setShowStartup(false)`、**不改 doc** → controller 与目标同源 → 跳不跳都一样。
5. **回归归属**：拆分 `a245f8a`（2026-09-02 09:16）埋雷（hook 随拆分后移进 StageContent）；启动页 `0a07d8b`（2026-09-02 16:01）**踩雷**。8 小时内组合出缺陷，不是拆分本身。
6. **StrictMode 掩蔽（决定性事实）**：`apps/canvas/src/main.tsx:9` 启用 `StrictMode` → **dev 下 effect 双调用**：第二次运行 `isFirst=false` → 四动作照做 → **dev 掩盖此 bug**；生产构建无双重调用 → **bug 只在构建产物发作**。⇒ 一切真浏览器复现/验证**必须用构建产物**（`vite preview`，与 `tools/verify-l-text-links.mjs` 同设施）。**用 dev server 复现会得到假阴性。**
7. **数据风险链**：`apps/canvas/src/hooks/useAutoSave.ts:43-50` —— 错位窗口内一旦 `dirty && saved && handle`，`controller.serialize()`（= gateway 树）会经 `docHost.save({ ...doc, source })` **以目标文档身份落盘**。本批修根因，不加保存侧守卫（另立批再说）。
8. **判据前提已实证**：`Controller.root` = `history.current`（`packages/react/src/edit/controller.ts:119-121`）；`OpHistory` 构造**原样存入** `initial`（`packages/kernel/src/tree/tree-op.ts:187-197`）；`reset(initial)` = `history.reset(initial)`（`controller.ts:467`）⇒ `ctrl.root === editable` 引用判据可用（S2F-1 仍要加实证钉）。

## §2 任务

### S2F-1 · 复现（红证据，先行）

a. **hook 单测扩展**（`apps/canvas/tests/useDocumentSwitch.test.tsx`）：
   - **mock 升级**：controller mock 增 `root` 字段（= 与 `editable` **同引用**）——这是新判据所需的字段补齐，**t1/t2 的断言意图逐字保持**（t2"首挂四动作未执行"通过"mock 与 editable 同源"满足，不是放宽）。
   - 新增 **t0 判据实证钉**：真实 `new EditorController(editable)` → `expect(ctrl.root).toBe(editable)`；`ctrl.reset(other)` → `expect(ctrl.root).toBe(other)`（落点本文件或 `packages/react/tests/editor-controller.test.ts`，报告注明）。
   - 新增 **t3**：首挂即不同源（mock `root` ≠ `editable`）→ 四动作各恰一次 + `remember` 照做。**当前代码应为红**（贴原文）。
   - 新增 **t4**：`controllerRef.current = null` → 不崩（按推荐实现：落入四动作、`reset` 为 null 安全调用；断言零异常 + 动作调用口径）。
b. **三出口 e2e**（新文件 `apps/canvas/tests/startup-doc-switch.test.tsx`；模板 = `apps/canvas/tests/note-flip-host.test.tsx` 的 MindmapStage 全链设施）：
   - 「继续上次」/「最近列表」/「新建」各一条：种子 localStorage `mindcanvas.library.v1`（≥2 个与 gateway 不同的文档；note 序列**块形态**）→ 断言**目标文档独有节点存在 且 gateway 独有节点不存在**（单边断言不算）。
   - **当前代码应为红**（贴三红原文，含失败 dump）。
c. **真浏览器脚本**（`tools/verify-startup-doc-switch.mjs`；模板 = `tools/verify-l-text-links.mjs` + `tools/lib/snapshotCheck.mjs`）：
   - 跑法：构建 + `vite preview`（**构建产物，不许 dev server**，见 §1.6）+ `node tools/verify-startup-doc-switch.mjs`。
   - `page.addInitScript` 种 library → 加载 → 启动页出现 → 走三出口（继续上次 / 新建 / 最近）→ 逐一断言"画布出现目标独有节点、无 gateway 独有节点"→ 截图。
   - **STOP 阀：若构建产物下不复现 → 立刻停下报告**（说明机制理解有误，禁止盲修）。

### S2F-2 · 修复（方案 A：时间点判据 → 状态判据）

- **唯一改点**：`apps/canvas/src/hooks/useDocumentSwitch.ts:66`（`if (isFirst) return;`）。推荐实现：

  ```ts
  if (isFirst && controllerRef.current?.root === editable) return; // 首挂且同源：跳过（现值行为）
  ```

  其余（`reset` / `setEntities` / `setExpandedQaId(null)` / `fit`）**逐字保持**；非首挂路径**不加任何新判断**。
- **禁止**：改 effect deps（保持 `[doc.source]`，E 批纪律）；改四动作内容/顺序；动 `remember` 语义。
- **注释同步**：hook 头（`:5-13` 语义段）+ 条件处 —— 改为"首挂**同源**跳过；不同源（启动页出口这类'挂载前改 doc'的路径）补做切换动作"。
- 绿：t0/t3/t4 + 三出口 e2e + 真浏览器脚本全绿（各贴原文）。

### S2F-3 · 回归面 + 收口

- `MindmapStage.tsx:250-255` 过时注释订正（controller 现在就在外层持有；"不需要守卫"≠"不需要同步"；reset 语义已由 hook 状态判据兜住）。
- **同类路径扫描结论表**：全仓 `setDoc(` 调用点逐一判定"是否可能发生在 StageContent 挂载前"（预期：启动页三出口=已修；in-app `applyDoc` 路径=已挂载=安全；其余列明）。
- CHANGELOG 新段 **[1.8.19]**（触发/修复/判别钉/StrictMode 掩蔽事实一句话）。
- 报告 `outputs/2026-09-14-s2f-doc-switch-sync-report.md`：红/绿原文（含浏览器脚本输出与截图路径）、扫描表、偏差。
- 门禁：tsc×3 = 0；三包（kernel 523 不动 / react 1266+Δ / canvas 197+Δ）全绿；depcruise 零违规；lint **≤1468+46**；budget 持平。
- 定向清理：本批自产 `tmp-*` + `tmp-rev-t1.diff` / `tmp-rev-t2.diff`；保留 `_tmp_93540_*`、`tmp-v7-s1/s2.diff`、`tools/graph-engine/`。

### 提交计划（每任务一条，禁 `git add -A`/`git add .`）

1. `docs: 追加 S2F 启动页文档切换同步派遣计划`
2. `fix(canvas): 文档切换改状态判据（首挂不同源补做切换；修启动页出口树不同步）`（含 t0/t3/t4 + 三出口 e2e + 浏览器脚本；报告记录先红后绿）
3. `docs: S2F 收口（CHANGELOG [1.8.19] + 报告 + 注释订正）`

## §3 决策点（已给推荐，按推荐执行，不要停下问）

- **D1 判据** = `ctrl.root === editable`（引用）。若 t0 实证不成立 → **停下报告**，改用二档方案（外层创建 controller 时记 source，作为可选 prop 传入 hook），**不许自创第三判据**。
- **D2** 首挂不同源时**四动作全做**（含 `fit`）。若 `fit` 因 ref 时序落空 → 允许落空但**必须报告**，不许"跳过整组"掩盖。
- **D3 StrictMode**：dev 掩盖属**预期现象**，不算复现失败；一切复现/验证以构建产物为准；报告附结论一句。
- **D4 版本** = `[1.8.19]`（[1.8.18] 已被 P1 收尾小修占用，不并入、不跳号）。
- **D5 e2e 断言口径** = 双边（目标独有节点存在 **且** gateway 独有节点不存在）。

## §4 停止条款

- S2F-1 构建产物下**不复现** → 停。
- t0 判据实证不成立 → 停（二档方案需复核同意）。
- 需改 hook deps / 四动作语义 / t1/t2 断言意图 → 停。
- lint 上升 / budget 超限 / depcruise 违规 → 停。

## §5 报告格式

- 逐任务：commit hash + 改动文件 + 红/绿断言原文 + 新增用例数。
- S2F-1：三红原文（hook t3/t4 + e2e 三出口）+ 浏览器脚本复现输出（含 baseUrl 与构建命令）。
- S2F-2：hook diff 原文 + 全绿原文。
- S2F-3：扫描表 + 门禁原样 + `git status --short` 原文 + 清理结果。
- 偏差与原因；然后停，等复核（**不 push**）。

## §6 冻结纪律

阈值/契约测试不得放宽（t1/t2 断言意图、mock 只许补字段）；禁 `git add -A`；**不 push**；不动 `.codebuddy/`、`.workbuddy/`、`tools/graph-engine/`；`CULL_MARGIN` 不动；不改 git config；报告必须含红/绿原文与浏览器输出，不许"已修复"式无证据陈述。
