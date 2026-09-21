# E 批 · 本地 Issue 跟踪（待 I1 远端建立后补录 Forgejo）

> 日期：2026-08-31 · 依据：`docs/roadmap/2026-08-31-edge-first-relations.md`

## E1 边 schema 扩展（kernel minor 1.1.0）

- [x] `ResolvedLink` 增加 `dir? / label? / note? / attrs?` 可选字段
- [x] `resolveLinks` 透传；非法 dir → 默认 fwd + W 级 diagnostic
- [x] round-trip golden：dir/label/note/attrs parse→serialize 无损
- [x] CHANGELOG 1.1.0 + ADR-0004 附录记录
- 验收：手写 .mm.md 四新字段解析正确、回写无损；kernel 282+4 全绿

## E2 MapView 边叠加层

- [x] 自由边渲染：贝塞尔曲线 + dir 箭头 + label chip + note hover 浮窗
- [x] REL_META 视觉映射（blocks 红/causes 紫/relates-to 灰虚/duplicates 琥珀/未知中性灰）
- [x] 三态视觉：dangling 虚线幽灵锚 / stale 红色警示 / 折叠路由 collapsedAncestors
- [x] hit-testing：8px 宽透明描边；点击边 → 选中态
- 验收：demo 画布手写两条 links 可见可点；折叠父节点路由正确；react 291+6 全绿

## E3 连线创建/编辑/删除

- [x] 右键「连线到…」→ 目标 picker（节点路径 + 实体候选）→ rel 模板
- [x] 边编辑浮窗：rel/label/note/dir 四字段 + 删除
- [x] 写入走 TreeOp update-node（undo/自动保存继承）
- 验收：创建→编辑→删除→undo 全程可回退；react 291+8 全绿

## E4 关系面板消费

- [x] 面板新增语义边区（按 rel 分组，点边 focusNode 源）
- [x] 星型图降级为单实体下钻视图
- 验收：边清单随树刷新；react 291+4 全绿

- [ ] E5 网络视图（挂起）

- 挂 F 自用周后，与 B 线 EntityHost 合并评估；触发条件：F 周 friction-log 出现 ≥2 条跨文档关系类摩擦
