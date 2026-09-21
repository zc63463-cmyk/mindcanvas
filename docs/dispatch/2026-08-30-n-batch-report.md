# 批次 N（实体深化 + 分享闭环）交付报告

> 日期：2026-08-30 · M 线第二轮 · 计划：`2026-08-30-n-batch-dispatch.md`
> 提交：N4（38301d7）→ N1（d91d314）→ N2（01a29b3）→ N3（1df8e8f）
> 基线：react 247 → **268**（+21 测试）；kernel 282 不变；typecheck / build 0 错误

## 一、交付内容

| 任务 | 内容 | 关键点 |
|---|---|---|
| **N4 `\@` 转义** | `@@文本` / `\@文本` → 落为纯文本 `@文本`（不进 picker）；picker 空态提示出口 | M1 已知边界清债；纯函数（isEscaped/unescape） |
| **N1 候选宿主化** | `LocalEntityStore`（EntityHost 契约，localStorage 上限 200 LRU）；打开/切换文档登记 refs、选中即登记；picker 候选 = 当前文档（优先）∪ store | **实体引用跨文档复用**——同一 issue 在多张导图反复选到 |
| **N2 实体右键菜单** | 菜单函数下沉 react（纯函数可测）+ 实体节点三项：改引用… / 在关系图中显示 / 转为纯文本 | `entityActions` 可选注入（缺省不追加 → 向后兼容） |
| **N3 PNG 导出** | `exportPng`：SVG → Image → Canvas 2x → toBlob；文档栏「导出 PNG」 | 降级：tainted（外链资产污染）/ unsupported（无 2d）→ 回落 SVG + 提示 |

## 二、关键实现决策

| # | 决策 | 说明 |
|---|---|---|
| D1 | LRU 用**严格递增时钟**（max(now, maxUsed+1)） | Date.now() 同毫秒多次登记排序不稳定（实测暴露）——连续快速登记也能正确裁剪 |
| D2 | 标题策略：真标题优先，无标题（=id）保留既有 | 避免无信息输入覆盖有意义的标题 |
| D3 | 候选双源：当前文档优先，store 补充 | 文档内最新为准，避免跨文档旧标题覆盖 |
| D4 | 菜单函数**下沉到 react 库层**（app 层无测试基建） | 既有 4 项语义不变 + entityActions 可选注入（既有测试原样通过） |
| D5 | PNG 降级含提示（alert） | 用户需要知道为什么没有 PNG（外链资产 / 环境不支持） |

## 三、验收清单（:5174）

1. **跨文档复用**：gateway 引用 issue → 打开另一文档 → picker 候选可见（本文档项在前）
2. **右键实体节点**：三项菜单 → 改引用弹 picker（预填）/ 关系面板打开 / 转纯文本生效
3. **导出 PNG**：下载 2x 图；含外链资产 → alert + SVG 回落
4. **转义**：输入 `@@备注` → 落纯文本「@备注」；`@门户` 仍弹 picker；picker 空态显示转义提示

## 四、自动化回归

- react **268/268**（43 files，+21：entity-input 4 / entity-store 8 / context-menu-items 5 / export-png 4）
- kernel **282/282**；typecheck / build 0 错误（build 曾因沙箱 safe-delete 清 dist 偶发中断，清目录后通过——非代码问题）

## 五、至此的项目状态

- 实体线：插入(M1) → 复用(N1 跨文档) → 展示/编辑(M1) → 右键操作(N2) → 聚合(F1) → 定位(GH-T2) —— **全链路可写**
- 分享线：SVG（GH-T4）+ PNG（N3）双格式
- 边界：`\@` 转义（N4）、折叠定位（GH-T2）均已清债
- 下一轮候选：M2 富内容（@draw SVG 节点）、移动端触控、EntityHost 远端实现（B 线接缝）、Canvas 后端
