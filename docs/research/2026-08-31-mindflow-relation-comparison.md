# 深度对比：markvault-js 关系连线实现 vs mindcanvas E 批

> 日期：2026-08-31 · 方法：逆向 markvault-js-main.js（30552 行 bundle，源码路径注释完整保留）
> 对象：MindFlow 导图连线（svg-connector.ts）+ RelationGraph 关系图谱（force-graph）
> 目的：功能差异挖掘 + 采纳决策（哪些进 mindcanvas）

## 一、markvault-js 的两套关系体系（实证）

### 1.1 MindFlow 导图连线（`src/mindflow/render/svg-connector.ts`）

| 维度 | 实现 |
|---|---|
| 连线类型 | **仅树形**（parent→child；`getVisibleEdges` 前序遍历折叠子树）——**没有树形之外的连线** |
| 几何 | 三次贝塞尔：parent 右缘中点 → child 左缘中点，`dx = max(0.5×距离, 20)` |
| 语义样式 | annotation 子节点 → 虚线+灰（`COLLAPSED_STROKE #9CA3AF`）；其余统一 `#7C8DA0` 2px |
| 渲染 | 每帧全量重绘（`while(svg.firstChild) removeChild`）+ DOM 节点 left/top 定位 |
| 数据模型 | **双层**：markdown 正文 = 种子树（不可删）；用户建的节点 = free 节点（badge "F"），存 **frontmatter YAML `nodes: [{id, parentId, text, note?, collapsed?}]`**，加载时 mergeFreeNodes 合回；parentId 失效 → orphan 计数 + warn（不静默丢） |
| 删除规则 | **只有 free 节点可删**（"Only free nodes can be deleted"）——种子属 markdown 事实源 |
| undo | 全量快照（freeRecords JSON 深拷贝，50 层栈） |

**结论：MindFlow 连线维度上，mindcanvas E 批已全面超越**——树形之外的语义边（rel/方向/标签/笔记）、锚定三态、编辑闭环都是 MindFlow 没有的。MindFlow 的连线是「画得好看的树边」，不是关系系统。

### 1.2 RelationGraph 关系图谱（`src/ui/graph/RelationGraphView.ts` + force-graph）——差距主体

这是 markvault-js 的 annotation 关系网络（标注↔标注），工程成熟度高得多：

| # | 能力 | 实证 |
|---|---|---|
| R1 | **关系类型 schema**：17 主动类型 × 6 语义分组（Taxonomic/Argumentative/Expositive/Dynamic/Referential/Structural）+ 11 被动反向类型；每类型 `{id, label, reverseId, isSymmetric, color, isActive}`；构造时**重复 id 告警 + reverse 互指一致性校验** | `DEFAULT_RELATION_TYPE_CONFIGS` + `RelationSchema` |
| R2 | **反向关系自动维护**：causes↔isCausedBy 等成对注册；Passive 组 `isActive:false`（系统维护，用户不直接选）；invalidate/restore「双向级联」 | RelationSchema._reverseMap；restoreBtn title 原文 |
| R3 | **软失效而非删除**：relation 带 `invalidAt` 时间戳；列表中灰色显示「(已失效 日期)」+ 恢复按钮；图过滤默认 `showInvalidated:false` | `invalidateRelation` / `restoreRelation` |
| R4 | **关系来源溯源**：`source: manual✋ / template📋 / inferred🤖 / imported📦` 四类标签显示在关系行 | `RELATION_SOURCE_LABELS` |
| R5 | **方向粒子流**：force-graph `linkDirectionalParticles`（沿边流动的光点）+ `linkDirectionalArrowLength/Color/RelPos` | force-graph 集成 |
| R6 | **hover 邻居高亮**：邻接表 O(1) 查邻居（refresh 时重建 adjacencyMap），highlightedLinks/Nodes 集合 | P2-2 注释 |
| R7 | **ego 网络过滤**：focalNodeId + neighborDepth → `bfsReachable` BFS N 度邻居裁剪 | buildGraphData |
| R8 | **filter 芯片组**：relationTypes（按语义分组渲染 + active/passive 视觉区分）/ annotationKinds / filePaths / showIsolated / showInvalidated | renderToolbar |
| R9 | **度数→节点大小**：computeDegreeMap → val 映射 | buildGraphData |
| R10 | 搜索高亮：300ms debounce + label/alias 匹配 | renderToolbar |

## 二、逐维度对比与采纳评分

评分：影响（对 mindcanvas 价值）× 成本，★ = 高。

| # | 能力 | mindcanvas 现状 | 差距判定 | 采纳 | 理由 |
|---|---|---|---|---|---|
| R1 | 关系类型 schema | 4 个硬编码模板 + 开放字符串 | **大** | ✅ **E6.1** | rel 开放字符串是底线，但无 schema = 无 label/无分组/无一致校验；REL_META 升级为可注册 RelationSchema（复用六注册表模式）；构造校验（重复 id / reverse 互指）成本极低 |
| R2 | 反向关系 | 无 | **大** | ✅ **E6.1** | 反向语义是「关系可查询」的基础：从 B 查"谁 causes 我"不用扫全图；Passive 组自动维护的设计直接可用 |
| R3 | 软失效 + 恢复 | 直接删除 | **大** | ✅ **E6.2** | dangling=「目标没了」、invalidAt=「关系被否定」——语义互补；知识网络演化中删了反悔是高频痛点；落透传键 `invalidAt` 一行，恢复按钮 + 图上虚线灰样式 |
| R4 | 来源溯源 | 无 | 中 | ✅ **E6.3（对接 B 线）** | **B0 提议集落库后 AI 建的边与人建的边必须可区分**——inferred 标记是 B3 对账的前置；`source` 透传键零成本 |
| R5 | 方向粒子流 | 无 | 小 | ⏸ F 周后 | 纯视觉增益；SVG 实现需动画帧预算，与「空闲零活动」调度纪律冲突，需评估 |
| R6 | hover 邻居高亮 | 无 | 中 | ⏸ F 周后 | 需 adjacencyMap + hover 状态管理；边数量小的时候收益有限 |
| R7 | ego 网络过滤 | 无 | 中 | ⏸ B 线 | 大图可用性功能；mindcanvas 当前边量级小，等真实数据 |
| R8 | filter 芯片 | 无 | 小 | ⏸ F 周后 | 面板加过滤成本不高，但等摩擦清单定义需求 |
| R9 | 度数→大小 | 无 | 小 | ❌ | mindcanvas 节点是卡片非圆点，不适用 |
| R10 | 搜索高亮 | 边无搜索 | 小 | ❌ | 等边数量成为问题再说 |

**明确不采纳**（架构冲突）：force 力导向布局（红线：T8 降级纪律，树形布局是产品定位）；frontmatter 双层存储 + 不可删种子节点（mindcanvas 全树住 `.mm.md` + 透传键是更优的单层事实源）；全量快照 undo（OpHistory 逆操作更优）；每帧全量重绘（dirty-flag 单帧调度更优）。

## 三、建议落地：E6 采纳批（F 周前置，约 1-1.5 天）

| 批 | 内容 | 关键点 |
|---|---|---|
| E6.1 | **RelationSchema 注册表化**：`{id, label, reverseId?, isSymmetric, color, isActive}` + 语义分组 + 构造校验；REL_TEMPLATES/datalist/REL_META/面板 rel chip 全部从 schema 取 | 反向关系提供 `reverseOf(rel)` 查询；内核或 react 侧注册表均可（视觉+词汇属 react，参照 SemanticsRegistry 先例放 react 侧） |
| E6.2 | **软失效**：link 项加 `invalidAt?: string`（ISO 日期透传）；EdgeEditor 删除改为「失效/彻底删」二段；失效边 = 灰虚线 + 面板灰色 + 恢复按钮 | 与内核 dangling 三态正交：invalidAt 是状态不是锚定结果，不进 resolveLinks 契约（纯渲染层过滤/降级），零内核改动 |
| E6.3 | **来源标记**：link 项加 `source?: 'manual'\|'inferred'`（透传）；LinkCreator 默认 manual；面板行 + EdgeEditor 显示来源 | B 线落库时 LLM 提议边标 inferred——B3 对账的识别基础；本批只留字段 + 显示 |

验收：schema 注册 + 分组渲染 / 失效-恢复级联测试 / source 字段 round-trip；预计 kernel 0 改动、react +12 测试。

## 四、一句话结论

**MindFlow 的连线不用抄——它只有树边；真正的差距在 RelationGraph：schema 化的关系词汇（R1/R2）、软失效生命周期（R3）、来源溯源（R4）三项建议 F 周前以 E6 批采纳，其余等摩擦清单。**
