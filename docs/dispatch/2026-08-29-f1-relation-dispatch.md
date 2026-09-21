# F1 导图↔关系图联动 执行计划

> 日期：2026-08-29 · 战略方向（MarkVault-JS 六合一定位：MindFlow ↔ RelationGraph）
> 现状：mindcanvas 无关系图实现；kernel 已有 EntityRef 协议 + parse refs 收集；react 有六注册表/搜索
> 定位：**自证闭环 + 数据接口共享**——mindcanvas 内做「实体关系图谱」（径向布局，确定性可测），
> 同时把 `collectEntityRelations` 导出为公共 API，主仓 RelationGraph 可消费同一数据源（主仓侧后续接）。

## 决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | 关系图首期用**确定性径向布局**（星型），不做力导向 | 力导向需迭代求解：测试难、性能风险（每帧求解）、无大图场景；径向布局纯函数可测、SVG 直渲；升级路径：实体量超阈值再切力导向（T8 同款降级思维） |
| D2 | 关系图数据源 = **文档内实体引用聚合**（collectEntityRelations） | 复用 parse refs + buildEntities 标题；不引入新存储；主仓 RelationGraph 可 import 同一函数 |
| D3 | 双向导航：面板实体 → focusNode+选中；导图选中实体节点 → 面板高亮 | 依赖 MapView apiRef（既有 focusNode）与 controller.select；零新协议 |

## 任务

- [ ] **T1 数据层 + 径向布局**（kernel? react chrome）：`collectEntityRelations(editable, entities)`（实体引用聚合：ref/标题/引用节点列表）+ `radialLayout(count, radius)` 纯函数；导出公共 API；测试
- [ ] **T2 EntityGraphPanel**：实体列表（kind 分组 + 标题/状态 + 引用数，虚拟滚动复用 P3 思路）+ 径向 SVG 图（中心实体/周围引用节点/连线）+ 点引用节点 → onFocusNode；测试
- [ ] **T3 双向导航 + 入口 + 报告**：Stage 接线 Ctrl+Shift+R；面板 ↔ 画布联动；与搜索/大纲/图库共存；回归 + docs/dispatch/ 报告

## 验收（:5174）

1. Ctrl+Shift+R 打开关系面板：gateway 文档的 @doc/@issue/@img 实体按 kind 分组列出（标题/状态/引用数）
2. 点实体 → 径向图显示引用它的节点；点引用节点 → 画布 focusNode + 选中高亮
3. 画布选中实体节点 → 面板高亮对应实体
4. 保存/打开文档后关系数据自动刷新

## 冻结纪律

全 minor：新文件（chrome/entityGraph.ts、EntityGraphPanel.tsx）+ 新快捷键 action + Stage 新增 UI；kernel 零改动（EntityRef 已存在）。
