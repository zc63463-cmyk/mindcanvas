# 包 3 DELIVERY-CLOSE 启动 Prompt

前置：包 1 已复核通过；包 2 于 2026-09-19 第四轮复核通过。当前仅准备启动材料，尚未执行包 3。

```text
请执行 MindCanvas 包 3 DELIVERY-CLOSE，完成当前版本质量与交付收口，不扩展新功能。包 1、2 已由主控复核放行，常规范围内直接实施与验证。

工作目录：<workspace>。

先读：
1. docs/dispatch/2026-09-18-reliability-123-dispatch.md
2. docs/superpowers/plans/2026-09-18-delivery-close.md
3. docs/dispatch/2026-09-18-save-lifecycle-review.md 文末放行结论
4. docs/dispatch/2026-09-19-mode-guard-review.md 文末“第四轮复核与放行”
5. 包 1/2 回执的最新追加章节（save-lifecycle §8.7、mode-guard 附三 §T0–T8）及源码
6. docs/specs/2026-09-18-depth-visual-hierarchy-design.md（末尾修订优先）、CONTRIBUTING.md、ADR-0004

按原实施计划完成 Task 1–5：
- 重新记录 HEAD、工作树归属、实际导出、完整检查基线；目前 HEAD=a2ce72b，工作区有视觉/度量与包 1/2 未提交成果，不得只从 HEAD 或远端重新开始。
- 将 canvas 测试类型检查纳入标准 typecheck/gate/CI，修复实际诊断；核对 pre-push 回退覆盖四子项目。9 条只是上一轮基线，重新实测。
- 按职责拆分并消除预算超限，优先沿原计划处理 mindmap/frameLayout 与 asCast 来源；保持布局输出及公开接口兼容，不放宽预算、不压缩代码凑行数、不扩大排除范围、不删冻结导出。
- 验证现有视觉/度量/LOD、三主题、框与多中心、SVG/PNG 导出，以及包 1/2 保存/离开完整产品旅程。构建后核对实际页面 bundle，使用专用测试夹具。
- 复测布局性能，更新准确的 README/CHANGELOG/open-items/CI 说明，完成最终 pnpm gate 与 pnpm build，要求退出码均为 0。

保护已复核契约：
- 慢保存不误清新编辑，另存为后的排队写入目的地正确；下载结果不能当作确认落盘。
- 未 blur 与预览态草稿、中文组合输入、端口失效、异步互斥、提交失败/重试/显式放弃均不得回退。
- FlushResult 包含字符串状态与旧式布尔，不能用简单真值判断把 'failed' 当成功。
- 当前工作区的新增具名导出（含草稿会话/组合保护）也属于接入基线；不因它们不在 HEAD 中就删除。新增导出与旧导出分别记录，保持兼容。

最新参考而非硬编码目标：执行者全仓 2485 测试（canvas 353）；主控独立 9 个探针、106 条相关测试及 typecheck 通过。预算尚有 asCast 32/31、bigFiles 6/4；canvas tests 类型诊断报告为 9 条。包 3 必须处理这些存量，不继续以“既有失败”放行。lint 开工重测，新增代码零新增告警、总水位不增加。

浏览器证据必须区分合成 CompositionEvent、内存句柄与真实 OS 输入法/系统选择器/磁盘。无法验证的系统能力如实列出，不能用 mock 冒充或宣称全覆盖；自动化可完成部分继续执行，不因单个限制停止所有收口。

使用 pnpm 10.33.2。只接管原计划范围；保留既有视觉/度量及禁区文件，不重写保存协调器/离开决策器、不新增产品功能。默认不提交、不 push、不 pull/rebase/reset/stash、不整树暂存、不发布或升版本。版本数字重新核实，不能机械同步 CHANGELOG 与包版本冒充发布。

最终交付 docs/dispatch/2026-09-18-delivery-close-report.md：列全门禁实际退出码与日志、测试数量变化、测试类型检查归零、预算实数、lint 水位、浏览器/导出/性能证据及限制、导出兼容性和建议提交分组。混合承载既有视觉与本系列改动的文件说明按块划分方式。

完成后停下交回执，等待主控复核；不自动提交、推送、发布或启动第 4 项 Agent 验证。
```
