# 包 2 MODE-GUARD 启动 Prompt

主控已于 2026-09-19 复核包 1：R1–R4 / R4-B 阻断项关闭，原 4 探针、R4-B 探针、78 条相关正式测试和类型检查独立通过。包 2 可以启动；当前仅交付启动材料，尚未执行。

```text
请执行 MindCanvas 包 2 MODE-GUARD，实际实现并验证，完成后交回执，不自动执行包 3。

工作目录：<workspace>。
前置：包 1 已于 2026-09-19 经主控第三轮复核放行，不需重复申请开工确认。

先读：
1. docs/dispatch/2026-09-18-reliability-123-dispatch.md
2. docs/superpowers/plans/2026-09-18-mode-guard.md
3. docs/dispatch/2026-09-18-save-lifecycle-review.md 文末“第三轮复核与放行”
4. docs/dispatch/2026-09-18-save-lifecycle-report.md §8.7 及实际源码
5. outputs/2026-09-18-progress-audit-and-actions.md 的 P0-B

目标：导图/自由画布双向切模式，以及新建、打开、最近、演示/替换文档入口，统一经过“保存并继续 / 放弃修改 / 取消”保护。完成原计划 Task 1–4，覆盖未 blur 草稿、中文 composition、保存进行中、失败/取消/下载、重复点击和卸载后的迟到回调。自定义确认框不可被工具栏遮挡或点击穿透，键盘焦点与取消恢复正确。

必须复用包 1 保存结果和协调器。App 只协调离开，不持有两种文档内容，不通过同时隐藏挂载两个 Stage 绕过问题，不另建保存队列、自动草稿或历史栈。

接线约束：
- 导图使用 isSaving: () => saveSession.isSaving()、waitForIdle: () => saveSession.waitForIdle()，避免类方法丢 this；自由画布已有包装函数。
- 等待保存必须发生在会话失效/Stage 卸载之前。离开前先 flush 编辑，实际执行目标前重新核验会话、dirty、saving；不能缓存一次 saved/current=true 作为永久通行证。
- “保存并继续”只认 saved/current=true 且重新确认无未保存改动和进行中任务。failed/blocked/cancelled/stale/current=false 不自动离开。
- downloaded 仅代表已触发下载，不证明文件落盘；即使 dirty 已清也不能自动离开。提供准确提示和取消/显式放弃入口。

随包 2 接入完成一项小校正：原回执 §8.7.2 的“saved/downloaded 均已落盘”表述不准确，SAVE_METADATA_WARNING 的“已写入文件”也不适用于下载分支。按 fs/download 区分附属警告，或使用不声称已落盘的措辞；同步文档，并补 downloaded + remember 失败仍不自动离开的回归。failed 保持原 dirty，不等于必然 dirty=true。

按原计划先复现并锁定正确行为，完成入口矩阵、关键守卫阴性对照和真实浏览器旅程。系统选择器若仍无法验证，明确保留限制，不用 mock 结果冒充系统验证。保持包 1 回归通过。

使用项目 pnpm 10.33.2；运行类型、全测试、依赖、lint、budget 和构建，区分既有预算失败与新增债务。保留工作区已有视觉/度量成果，只按块修改计划范围；不提交、不 push、不 pull/rebase/reset/stash、不批量暂存、不触碰禁区。

最终更新 docs/dispatch/2026-09-18-mode-guard-report.md，包含入口清单、分支矩阵、App 层不丢内容的证据、浏览器验证及限制、实际接口、门禁结果和未提交 diff。完成包 2 后停下，等待主控复核，不启动包 3。
```
