# F1 导图↔关系图联动 交付报告

> 日期：2026-08-29 · 战略方向（MarkVault-JS 六合一定位：MindFlow ↔ RelationGraph）
> 提交：`feat(relation): F1-T1/T2/T3`（a9215e9 → 411aee4）+ 计划文档（416f234）
> 基线：react 218 → **228**（+10 测试）；kernel 281 不变；build / typecheck 0 错误

## 一、交付内容

| 任务 | 内容 | 关键点 |
|---|---|---|
| **T1 数据层** | `collectEntityRelations(editable, entities)`：文档内实体引用聚合（ref/标题/引用节点，按引用数降序）+ `radialLayout` 确定性径向布局 | **公共 API 导出**——主仓 RelationGraph 可消费同一数据源（六合一定位的接口共享） |
| **T2 关系图面板** | `EntityGraphPanel`：左实体列表（kind 徽章/标题/引用数）+ 右径向图（中心实体/周围引用节点/连线） | 点引用节点 → onFocusNode；activeRefKey → 高亮联动 |
| **T3 双向导航+入口** | Ctrl+Shift+R + 工具栏「关系」按钮；relations 随树/实体表自动刷新 | 面板→画布 focusNode+选中；画布选中实体 → 面板高亮；与搜索/大纲/图库共存 |

## 二、验收（:5174）

1. **Ctrl+Shift+R** 打开关系面板：gateway 文档的 @doc/@issue/@img 实体按 kind 分组（标题/状态/引用数）
2. 点实体 → 径向图显示引用节点；点引用节点 → 画布定位 + 选中高亮
3. 画布选中实体节点 → 面板对应实体高亮（双向）
4. 编辑/保存/切换文档 → 关系数据即时刷新

## 三、工程决策（诚实披露）

| # | 决策 | 说明 |
|---|---|---|
| D1 | 首期**确定性径向布局**（星型），不做力导向 | 力导向需迭代求解（测试难/性能风险）；径向纯函数可测、SVG 直渲；实体量超阈值再升级（T8 降级思维） |
| D2 | 数据源 = **文档内引用聚合**，不引入新存储 | 复用 parse refs + buildEntities 标题；`collectEntityRelations` 导出为公共 API，主仓 RelationGraph 同源消费 |
| D3 | 双向导航复用既有能力 | MapView apiRef.focusNode + controller.select——零新协议 |
| D4 | 画布定位折叠子树内的节点会 no-op（focusNode 找不到布局） | 已知边界；选中仍生效（大纲可见）——后续可加「自动展开祖先」 |

## 四、主仓接入点（MarkVault-JS RelationGraph）

- 数据：`import { collectEntityRelations } from '@mindcanvas/react'`（editable + entities 即得关系图数据）
- 视图：可直接复用 `EntityGraphPanel`，或自绘（径向布局 `radialLayout` 已导出）
- 导航回调：`onFocusNode(nodeId)` 由主仓接自己的画布定位

## 五、后续候选

1. **关系图升级力导向**（实体 > 阈值时）
2. **跨文档实体图**（多文档 refs 合并——配合 B1 最近列表）
3. **折叠子树定位自动展开**（D4 边界修复）
4. **实体引用反向插入**（关系图里点「+」→ 在选中节点下插入 @引用）
