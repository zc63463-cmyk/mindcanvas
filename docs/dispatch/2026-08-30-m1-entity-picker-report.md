# M1 实体 picker 交付报告

> 日期：2026-08-30 · 定位：post-v1-roadmap 的 **M 线（产品深化）P1 项**，与 B 线呼应最紧
> 提交：`feat(entity): M1-T1/T2/T3`（42388eb、0361286、a2ffd53）+ 修复（9e0213b）
> 基线：kernel 281 → **282**、react 236 → **247**（+11 测试）；typecheck / build 0 错误

## 一、交付内容

| 任务 | 内容 | 关键点 |
|---|---|---|
| **T1 节点转实体** | kernel `NodePatch`/`updateNode` 加 `type` + `invertOp` 补 type 逆操作；`controller.setEntityRef(id, ref｜null)` | 文本节点 ↔ 实体节点互转，经 TreeOp（可 undo/redo） |
| **T2 EntityPicker** | kind 徽章行 + 搜索 + 候选列表 + 新建（输入即 id）+ 清除引用 | 候选宿主注入；Enter 选首个/新建，Esc 关闭 |
| **T3 画布接线** | 编辑提交以 `@` 开头 → 开 picker；双击实体节点 → 直接改引用 | 新引用登记进 entities（关系面板/导出同源） |

## 二、实体链路闭合

```
插入(M1) → 展示(NodeG kind 徽章) → 聚合(F1 关系面板) → 定位(GH-T2 自动展开)
  ✅新增        ✅既有                 ✅既有              ✅既有
```

此前实体只能「引用已有的」（来自 .mm 文本），现在可以在画布里创造与修改引用——编辑器闭环 95% → 100%。

## 三、验收（:5174）

1. 双击节点 → 输入 `@门户` → 回车 → picker 弹出（kind 行：@issue/@doc/@note…）
2. 选候选或「＋ 新建 issue：门户」→ 节点变实体（出现 kind 徽章），文本保留
3. 双击实体节点 → picker（当前引用高亮）→ 可换选，或点「清除引用」转回纯文本节点
4. `Ctrl+Z` 可回退转实体操作
5. `Ctrl+Shift+R` 关系面板立即出现该实体（引用数 1）

## 四、决策与限制（诚实披露）

| # | 决策/限制 | 说明 |
|---|---|---|
| D1 | 触发 = **提交时 `@` 前缀**（不做输入中实时弹窗） | OverlayEditor 无输入 hook，提交分流侵入最小；实时弹窗留作后续 |
| D2 | **新建 = 输入即 id** | demo 无远端实体源；B 线（forgejo-bridge）通后候选来自 Forgejo——**这正是 M1 与 B 线的接缝** |
| D3 | kernel `NodePatch` 加 `type`（加宽）+ `invertOp` 补 type | 后者是配套必要：否则 setEntityRef 的 undo 不恢复 type（已补测试守护） |
| D4 | **`@` 前缀文本无法直接写成纯文本** | 输入 `@xxx` 会被 picker 拦截（取消则不落文本）。后续可加 `\@` 转义 |
| D5 | 资产类（img/draw）不进 picker | 资产走图库（P0-P3），职责不重叠 |

## 五、后续候选（M 线）

1. **候选宿主化**：`EntityHost` 契约（同 AssetHost 形态）→ 远端实体源（Forgejo issue 列表）注入候选
2. **`@` 实时弹窗**（输入即过滤，不等提交）
3. **`\@` 转义**（D4 边界）
4. 实体节点右键菜单：「改引用 / 转纯文本 / 打开关系图」
