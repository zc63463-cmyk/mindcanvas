# 1+2+3 外派总纲与启动 Prompt

状态：任务书已准备，尚未执行。工作目录：`<workspace>`。

目标：按 **SAVE-LIFECYCLE → MODE-GUARD → DELIVERY-CLOSE** 完成保存可靠性、离开保护、当前版本收口。单一写入执行者串行推进；每包交回执，复核后再进入下一包。下述 prompt 发给执行者后即为对应包的开工范围，不需要重复询问是否可以进行常规实现与验证。

## 1. 计划与依赖

| 包 | 计划 | 必需输入 | 输出 |
|---|---|---|---|
| 1 · SAVE-LIFECYCLE | `docs/superpowers/plans/2026-09-18-save-lifecycle.md` | 审计复现及当前源码 | 安全保存协调、明确保存结果、延迟写回回归 |
| 2 · MODE-GUARD | `docs/superpowers/plans/2026-09-18-mode-guard.md` | 包 1 的保存结果和进行中状态 | 两种模式统一离开保护；保存/放弃/取消 |
| 3 · DELIVERY-CLOSE | `docs/superpowers/plans/2026-09-18-delivery-close.md` | 包 1、2 复核结果及现有视觉改动 | 全门禁、测试类型覆盖、浏览器证据、准确交付台账 |

参考时间盒：1–2 天 / 1–2 天 / 1–2 天。包 2 包含三选项确认、编辑草稿提交和下载兜底，较审计初估略增。以验收为准，不以时间盒强行宣称完成。

不启动第 4 项 Agent 验证，不做 Sidecar/MCP、自由画布撤销/自动草稿、架构重写、新的视觉功能。

## 2. 基线与工作树纪律（覆盖旧派遣模板的默认操作）

- 2026-09-18 审计 HEAD=`a2ce72b`；当前有已存在的视觉/度量改动：21 个跟踪文件，+523/-152；另有新增测试、设计和本地技能。开工重新记录 HEAD、status、diff，不能硬认该数字永久不变。
- 本地比远端 main 领先 66 commits；远端已核实为 `b17f92b`。**本系列不自动 pull/rebase/reset/stash，不 push，不发布。** 旧协作文档“开工先 pull”的模板不适合当前带未提交成果的交接，改为只读取并核对基线。
- 默认交付为**未提交的精确 diff + 回执**。本次请求仅准备计划；启动执行后也不得擅自提交开工前已有视觉成果。需要提交时由主控明确选择文件/改动并组织提交，不通过整文件暂存混入他人改动。
- 禁止 `git add -A` / `git add .`；禁止清理 `tools/graph-engine/`、`.cursor/mcp.json`、`.codebase-memory/`、`_tmp_93540_*`、他人临时文件。
- 包 1/2 会碰已有修改的 `MindmapStage.tsx`：先保存阅读基线，按块改接线；不覆盖视觉改动。包 3 可接管本次视觉范围的验证和最小修正，但这不等于授权批量提交所有未跟踪文件。
- 如果使用隔离工作树，必须完整移交当前已审查的工作区改动及未跟踪测试/规格，不能只从 HEAD 或 origin/main 起步。当前默认同一工作树串行执行，不自动创建丢失在制品的隔离副本。
- 发现其他写入者修改同一文件时，只暂停冲突文件的写入，报告实际差异；可继续不重叠的阅读和测试。
- 第 1、2 包记录既有预算红灯，禁止新增债务或隐瞒失败；第 3 包必须把完整 gate 变绿。不能以“既有问题”为由放行新增类型错误、失败测试、循环依赖。

环境：先检查 `pnpm --version` 是否为项目要求的 **10.33.2**。本机可用 `<local-path>`；默认 Codex shim 曾解析为 11.19.0 并触发依赖重装。只修正当前进程 PATH，不为了跑检查重装依赖或改全局工具。日志用 `*.log`，截图用已忽略的 `verify-shots/`。

## 3. 通用交付回执

每包写 `docs/dispatch/2026-09-18-<包名>-report.md`（包名为 save-lifecycle / mode-guard / delivery-close）：

1. 起始/结束 HEAD、工作区基线、实际新增/修改文件、是否有外部改动。
2. 完成的任务编号与未完成项；不要用“全部完成”掩盖跳过的浏览器验证。
3. 红→绿证据；守卫阴性对照；结果如何区分修复前后的行为。
4. 测试/类型/依赖/lint/budget/build 的命令、退出码、数量；区分基线与新增。
5. 保存/离开接口的真实签名、包 2/3 如何接入；与计划偏差的理由。
6. 截图/复现文件/日志路径；人工浏览器与 jsdom 证据分开写。
7. 精确 diff 摘要；未提交说明；明确“未 push”。

审计目录 `outputs/progress-audit-2026-09-18/probes.test.tsx` 是**错误行为特征测试**，通过表示问题存在。不要把它当修复后必须继续绿的契约。将正确行为断言迁入正式测试；审计原件保留为历史证据。

## 4. 启动 Prompt 1（现在可外派）

```text
请执行 MindCanvas 的第 1 包 SAVE-LIFECYCLE，实际实现并验证，完成后交回执，不自动执行第 2 包。

工作目录：<workspace>
先读：
1. docs/dispatch/2026-09-18-reliability-123-dispatch.md
2. docs/superpowers/plans/2026-09-18-save-lifecycle.md
3. outputs/2026-09-18-progress-audit-and-actions.md 的 P0-A
4. CONTRIBUTING.md 与 ADR-0004

目标：修复自动/手动/另存为/自由画布保存期间继续编辑被错误清 dirty、旧会话回调污染新文档、同一会话写入竞争等问题；建立第 2 包可用的准确保存结果。
必须从审计复现写正确行为的失败测试，再实现。写入协调要同时管 UI 回填和实际写入顺序；只丢弃旧回调不够。不能只靠文件名、doc.source、dirty 布尔或渲染 epoch 作为会话/内容版本。
保留 source/savedSource 分工、S2G 开始写前守卫及另存为逃生路径；不改冻结公开接口既有语义。下载兜底与文件写回结果分开。

当前工作区已有未提交视觉/度量改动，必须保留；只按计划修改保存相关代码。使用项目 pnpm 10.33.2。常规范围内直接执行，不反复申请开工确认。默认不提交，不 push、不 pull/rebase/reset/stash、不添加全部文件、不触碰禁区。
最终交付 docs/dispatch/2026-09-18-save-lifecycle-report.md，包含失败复现、修复与阴性对照、检查结果、实际接口和未提交 diff。完成本包即停下交接。
```

## 5. 启动 Prompt 2（包 1 复核后发）

```text
请执行 MindCanvas 的第 2 包 MODE-GUARD，实际实现并验证，完成后交回执，不自动执行第 3 包。

工作目录：<workspace>
先读：
1. docs/dispatch/2026-09-18-reliability-123-dispatch.md
2. docs/superpowers/plans/2026-09-18-mode-guard.md
3. docs/dispatch/2026-09-18-save-lifecycle-report.md 及其实际接口
4. outputs/2026-09-18-progress-audit-and-actions.md 的 P0-B

前置：第 1 包已完成并通过复核；若回执缺失或保存契约未落地，先核对并报告依赖缺口，不自行复制第二套保存实现。
目标：导图/自由画布双向切模式，以及新建、打开、最近、演示/替换文档入口，统一经过保存/放弃/取消保护。覆盖尚未 blur 的编辑草稿、保存进行中、失败/取消和重复点击；下载兜底不得被当作文件落盘成功自动离开。
两模式文档保持独立，App 只协调“能否离开”；不得通过隐藏两套 Stage 或共享文档模型掩盖生命周期问题。沿用包 1 保存结果，不以点击保存按钮作为完成判据。实现自定义确认框，不使用 window.confirm/alert/prompt。

保留工作区已有视觉改动；只改计划范围。常规范围内直接执行。默认不提交，不 push、不 pull/rebase/reset/stash、不添加全部文件、不触碰禁区。
最终交付 docs/dispatch/2026-09-18-mode-guard-report.md，附入口清单、分支验收矩阵、App 层内容不丢的回归与真实浏览器证据、未提交 diff。完成本包即停下交接。
```

## 6. 启动 Prompt 3（包 1、2 复核后发）

```text
请执行 MindCanvas 的第 3 包 DELIVERY-CLOSE，完成当前版本质量与文档收口，不扩展新功能。

工作目录：<workspace>
先读：
1. docs/dispatch/2026-09-18-reliability-123-dispatch.md
2. docs/superpowers/plans/2026-09-18-delivery-close.md
3. 第 1、2 包回执及源码
4. docs/specs/2026-09-18-depth-visual-hierarchy-design.md（含末尾修订）
5. CONTRIBUTING.md、ADR-0004、审计报告

目标：让 pnpm gate 和 pnpm build 真正通过；把 canvas tests 类型检查纳入统一门禁并修复真实诊断；在不放宽预算、不压缩代码凑行数、不删减冻结导出的前提下收口债务；验证现有视觉/度量/LOD 改动与保存/切模式修复；更新准确的 README、CHANGELOG、开放项和交付状态。
保持内核/React 显式具名导出与旧接口兼容。对大文件按职责拆分，禁止整体重写 MapView/Stage、改变布局算法或新增视觉效果。布局缓存基准和浏览器视觉验收分开报告。
必须跑真实浏览器旅程并核对加载的新构建；浏览器能力受限时明确记录阻塞，不能用 jsdom 冒充。版本默认将 1.12.0 视为待交付批次、package 1.7.0 视为尚未升级的包版本，准确说明，禁止机械升版本冒充发布。

只接管计划列出的工作区视觉成果与本系列修改，保留其他未跟踪内容。常规范围内直接执行。默认不提交，不 push、不 pull/rebase/reset/stash、不添加全部文件、不触碰禁区；不做第 4 项 Agent 验证/Skill 归档。
最终交付 docs/dispatch/2026-09-18-delivery-close-report.md，含最终全门禁原文摘要、测试数量及变化原因、类型诊断清零、预算与lint基线、浏览器/导出/性能证据，以及可供主控逐项提交的文件分组。完成后停下交接。
```
