# E 批交付报告：边一等公民（E1-E4 全部完成）

> 日期：2026-08-31 · 规划：`docs/roadmap/2026-08-31-edge-first-relations.md`
> 提交：E1（dc203e1）→ E2（f05c126）→ E3+E4（25ca7b8）
> 基线：kernel 282→**290**、react 291→**313**（合计 603 全绿）/ typecheck / build 0 错误

## 一、交付内容

| 批 | 内容 | 关键决策/发现 |
|---|---|---|
| **E1** | `ResolvedLink` 加 `dir/label/note/attrs/warnings` 可选字段 + `LinkDir` 类型；resolveLinks 透传；非法 dir 回落 fwd + W 级告警 | **重要缺口实证**：spec §5.5 的 links 对象数组在文本协议层无法表达（parser 只支持字符串列表项，遇对象列表整块笔记 E-INVALID-NOTE-YAML 丢弃）——契约与文件格式脱节。已补齐 parser/serializer 扁平对象列表（判别保守：未引号+key:value+有续行；qa/decisions 等冒号字符串列表行为不变）。CHANGELOG 1.1.0 + ADR-0004 附录 B |
| **E2** | MapView 自由边叠加层：collectFreeEdges（节点锚/实体锚解析）+ 贝塞尔曲线 + dir 箭头 + label chip + `<title>` hover + ghost 锚点 + 折叠路由 collapsedAncestors + rel 语义色（TokenSet） | rel 开放字符串：blocks 红/causes 紫/duplicates·relates-to 虚线/未知中性灰。Canvas 模式（>50K）不渲染自由边（L3 场景树未含边类型，已知边界） |
| **E3** | 连线创建/编辑/删除：右键「连线到…」→ LinkCreator（路径/实体候选+rel 模板+dir+label/note）；点边 → EdgeEditor 浮窗（四字段即时落盘+删除） | 写入全走 TreeOp update-node——undo/redo、OpHistory、自动保存零成本继承（集成测试验证：创建→编辑→删除→undo 恢复） |
| **E4** | 关系面板语义边区（rel 列行，点行定位源节点）+ 星型图降级为实体下钻视图 | 修复审查 P0「图≡列表冗余」；edgeActions/edges 均可选参数，向后兼容 |

## 二、验收清单

1. 手写 `.mm.md` 带 `links: [{rel, to, dir, label, note, attrs}]` → 解析正确 → serialize 回写无损 ✅
2. demo 画布带 links 节点 → 曲线+箭头+标签可见；折叠父节点边路由到祖先；dangling 幽灵锚点 ✅
3. 右键节点 →「连线到…」→ 选目标/rel/dir → 创建；点边 → 浮窗改 rel/label/note/dir → 删除；全程 undo 可回退 ✅
4. Ctrl+Shift+R 面板：连线区随树刷新；点边行定位源节点；星图仅点实体条目展开 ✅

## 三、已知边界（诚实披露）

1. **Canvas 模式无自由边**：>50K 自动降级后边层不渲染——L3 场景树补边类型属场景 diff 批次范畴
2. **移动端拖拽连线手势未做**：按规划留给 F 周摩擦输入（右键/长按菜单已可创建）
3. **跨文档边**：不属本批（B 线 EntityHost 范畴，规划 D-A 明确）
4. **边无独立 id**：按 source+index 寻址（决策 D-E3）；锚定每次重解析，dangling 可解释
5. **E5 网络视图挂起**：触发条件 = F 周 friction-log 出现 ≥2 条跨文档关系类摩擦

## 四、与总规划的关系

E 批（P0 修复 + 边一等公民）完成，F 自用验证周的前置已就绪——自由连线（PomodoroXI 缺陷依赖、技能互引）是 F 周高频动作。下一步：**F 周开跑**（零开发纪律）；I1 备份仍未做（无 git remote，本地 145+ commits 单点风险）。

---

## 增补（同日下半场）：E5-E7 + 深度审查 + E6.1 采纳 + 性能审查

| 批 | commit | 内容 | 验证 |
|---|---|---|---|
| **E5 存储重构** | b851fb9 | 边=画布级标注对象（root note.edges 透传键），非节点属性；锚存路径跨会话稳定；自定义连线样式（色板/虚线/粗细）；与 note.links 两层独立 | react 316 |
| **E6 交互批** | ad1d49f | P0 折叠收缩修复（先路由后判空）+ 树自然线右键编辑 + 连接手柄拖拽 | react 319 |
| **E7 交互重构** | 704500d | 树边实体化（note.edge 对象 + 协议对象标量）+ 编辑器 264px 紧凑化 + Shift+点击连线 + 拖拽悬停高亮 | kernel 292 / react 319 |
| **深度审查修复** | 802df47 | mergeStyleAt 清除语义 P0 / 右键冒泡冲突 / 建边去重 / 树边查找 O(1) / mapview 测试轮询化 | react 321 |
| **属性可见性修复** | 0c59008 | 树边 chip label→rel→via 兜底 + hover title 全属性 | react 322 |
| **显示异常两修** | 3756767 | SVG 文字误选高亮（userSelect:none）+ ghost 边 chip 锚定幽灵点 | — |
| **E6.1 采纳批** | 964e097 | RelationSchema 词汇表（14×5+12 反向+构造三查）/ 软失效 invalidAt 生命周期 / 来源溯源 source | react 331 |
| **性能审查** | f94b2ab | 树边正则热路径消除 / 自由边视口裁剪 / 低 LOD 门控 | react 331 |

**最终基线**：kernel 292 + react 331 = **623 全绿**；CHANGELOG 1.2.0；I1 部分缓解（`<workspace>-backup-20260831.bundle` 全量冷备 1.1MB，verify 通过；异地远端仍待建）。
