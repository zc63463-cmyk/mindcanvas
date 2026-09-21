# 关系系统认知升级提案：焦点+上下文模式 与 边命题化渲染

| 项    | 值                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------- |
| 日期   | 2026-09-04                                                                                          |
| 状态   | **提案，待评审**（不进入实现，直到评审通过）                                                                            |
| 优先级  | P1-认知层（并缓解 P2-1；与 P2-2 协同）                                                                          |
| 认知依据 | 渐进披露（认知负荷理论）· Novak 概念图命题学（Ausubel 有意义学习）· Xu 2012 曲线研究 · Misue 心理地图保持 · Zhao 2021 背景故事影响图感知（来源见文末） |
| 上游   | ADR-0008（边数据三面职责）· ADR-0004（接口冻结）· 2026-09-02-deep-review（审查基线）                                     |

## 背景

当前"关系模式"是一个**全局布尔开关**（`MindmapStage.relationMode` → `MapView interactive`），打开后**全部**自由边可点选编辑。认知层面存在两个问题：

1. **无渐进披露**：选中一个节点时，其余不相关边仍满屏高亮 → 工作记忆负荷爆表。Obsidian local graph 的深度滑块、Kumu/Heptabase 的聚焦-邻接模式，都是认知负荷理论的工程化。
2. **边不说话**：Novak 概念图的认知红利（元分析效应量 0.82）来自"每条边命名成可判真假的命题"。mindcanvas 已具备受控连接词表（`relationSchema`，26 类型 + `reverseId` 反向成对 + label 中文语义），但 `reverseId` 至今**零消费点**，边在画布上只是"带色的曲线"，不是"命题"。

本提案不做新数据面（遵守 ADR-0008）；只升级**现有** **`root.note.edges`** **的使用逻辑与渲染语义**。

***

## 特性 A · 焦点+上下文模式（渐进披露）

### A1 交互规格

- 关系模式下，**点击（选中）任意节点** → 该节点成为焦点：

  - **hop-1 邻接自由边**（直接连到该节点的边）保持高亮、可点选；

  - **其余自由边淡隐**（透明度 0.12，不点选、不遮挡），仍可见以保留空间上下文（Obsidian local graph 的"存在但弱化"）；

  - 焦点节点的**反向邻居**（以 `reverseId` 推断，如 `causes` ↔ `isCausedBy`）同等高亮并提示方向（箭头已有，语义靠色/悬停态）。

- 点击画布空白 / 再次点击焦点节点 → 退出焦点，回到全量视图（当前行为）。

- 连接手柄（E6）行为不变：焦点下仍可从选中节点拖出新边。

### A2 渲染规格

- `FreeEdgeLayer` 新增可选 prop `focusId?: string | null`。

  - `focusId` 存在且非邻接 → `opacity 0.12`、`strokeWidth` 不变、`markerEnd/markerStart` 保留（避免几何跳动）、命中区不挂载；

  - 邻接/非焦点时保持现状。

- **淡隐而非隐藏**（A2 硬性约束）：避免边进出切换的闪烁与"连接丢失"观感（对应用户反馈②的历史教训）。

- 淡隐随节点选中**瞬时**生效（不依赖动画重算——见 A4 性能副收益）。

### A3 可行性评估（改动面）

| 层                     | 改动                                                                                                                                                                                                  | 复杂度    | <br />            | <br /> |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------- | ------ |
| `MapView.tsx`         | 已有 `selectedId`（`controller.selectedId` 单一来源，L395/L1028）。新增 `freeEdgeEndpointIdsOf(focusId)` 派生：`focusId → 邻接边key集合`（纯函数，\`freeEdges.filter(e => e.sourceId === focusId \|\| e.targetId === focusId | <br /> | reverseRel 邻接)\`） | 低      |
| `FreeEdgeLayer.tsx`   | 新增 `focusId` prop + 每边 `dimmed = focusId && !adjacent` 分支（复用既有 `opacity` 渲染路径）                                                                                                                      | 低      | <br />            | <br /> |
| `visibleFreeEdges` 过滤 | **不改**：淡隐在渲染层做，不走过滤（保住视口裁剪语义）                                                                                                                                                                       | 无      | <br />            | <br /> |
| `MindmapStage.tsx`    | 经 `MapView` 透传 `controller.selectedId` 到 `FreeEdgeLayer.focusId`（一条 prop）                                                                                                                           | 低      | <br />            | <br /> |

- **推论 1**：淡隐不参与路由 → 不影响 `routes useMemo` 依赖 → 切换焦点零重算。

- **推论 2（关键副收益）**：为后续"焦点模式下只路由/渲染邻接边"铺路——当前 P2-1（动画期全量重算）的根治方案之一就是"焦点内边数骤降"；本特性先做视觉降载，P2-1 可随后复用同一 `focusId` 做计算降载。

### A4 风险与对策

| 风险                              | 对策                                                          |
| ------------------------------- | ----------------------------------------------------------- |
| 与节点拖拽/注释浮窗的交互冲突                 | 淡隐只在 `interactive && focusId` 生效；点击路由不变                     |
| "边突然变淡"被误读为丢失                   | 淡隐阈值 0.12 + 邻接高亮 1.0 的分明对比；hover 焦点节点也可临时全显（可选增强）           |
| 反向邻居推理错误（schema reverseId 缺/错配） | 仅当 `relationSchema.reverseOf(rel)` 有注册才启用反向高亮；未注册 rel 走普通淡隐 |

***

## 特性 B · 边命题化渲染

### B1 交互规格

- **Hover / 选中一条边** → 在现有 `<title>` 提示与 EdgeEditor 头行之上，呈现**完整命题句**：

  - 格式：`「源 关系动词 目标」`（中文动词来自 `relationSchema.getLabel(rel)`，如 `A ⭢ 阻断（blocks）⭢ B · 硬依赖`）。

- **画布 chip 保持短标签不变**（`label ?? rel`）：命题句只出现在 tooltip / 编辑浮窗 / 面板——避免画布 label 爆炸（读性优先，呼应"注释体系"的紧凑纪律）。

- **`rel`** **空缺的边**（`doc.note.edge` 未命名 / `root.note.edges` rel=''）：工具提示提示"为此关系命名"，引向 EdgeEditor rel 输入。

- **反向链消费（核心增量）**：选中一条 `blocks` 边时，`reverseOf('blocks') = 'isBlockedBy'` 已可查——在 EdgeEditor 与 EntityGraphPanel 中：

  - 显示"反向命题"行 `B 被阻断（isBlockedBy）A`（只读提示，**不新建反向边数据**——遵守单向声明 + 渲染端语义，呼应 ADR-0004 附录 B 裁定）；

  - 关系面板"相邻检查器"列本 rel 在图中全部实例 + 反向实例。

### B2 渲染规格

- 新增纯函数 `edgeProposition(from, rel, to, schema)` → 命题句（可测；schema 未注册 rel 回退英文原词）。

- `EdgeLabel` 与 `<title>` 组装复用该函数（`tip` 现有 join 结构改造）。

- `EntityGraphPanel` 边列表行尾追加"反向"徽标（`isBlockedBy` 样式，复用 passive 组语义色）。

### B3 可行性评估（改动面）

| 层                                       | 改动                                        | 复杂度 |
| --------------------------------------- | ----------------------------------------- | --- |
| `EdgeEditor.tsx` / `EdgeDraftLayer.tsx` | 命题句工具函数 + 浮窗头行 + 反向提示行                    | 低   |
| `freeEdges.ts` / `EdgeLabel.tsx`        | `<title>` 组装用 `edgeProposition`；chip 逻辑不动 | 低   |
| `EntityGraphPanel.tsx`                  | 边行反向徽标 + 邻接计数                             | 中   |
| `relationSchema.ts`                     | 无改动（`reverseOf`/`getLabel` 已存在）——**纯消费**  | 无   |

### B4 风险与对策

| 风险                   | 对策                                            |
| -------------------- | --------------------------------------------- |
| 命题句文字过长              | 画布不放；仅 tooltip/面板 ≤ 2 行                       |
| reverseId 误配引发错误反向显示 | 只读呈现 + 未注册回退；schema 构造校验已拦互指不一致（console.warn） |
| 与"边=装饰"的心理预期冲突       | 渐进：hover 才显出命题句，默认观感不变                        |

***

## 版本与编排

| 版本      | 内容           | 备注                                          |
| ------- | ------------ | ------------------------------------------- |
| P1-认知-A | 特性 A（焦点+上下文） | 依赖：无；顺带铺路 P2-1                              |
| P1-认知-B | 特性 B（命题化）    | 依赖：特性 A 无；与 P2-2（虚线 schema 化）共用 schema 增强窗口 |
| P2-1 跟进 | 焦点内计算降载      | 复用 A 的 `focusId`                            |

两者均为 **minor 级**（`MapView`/`FreeEdgeLayer` props 增量、纯函数新增），不触 ADR-0004 冻结面；不新增数据面（ADR-0008 合规）。

## 验收清单（TDD 前置）

- [ ] 纯函数 `adjacentEdgeKeys(focusId, freeEdges, schema)`：hop-1 + 反向邻接；未注册 rel 不误判

- [ ] 纯函数 `edgeProposition(from, rel, to, schema)`：中文动词 + rel 词 + 标签组合；空 rel 提示

- [ ] 渲染断言：`focusId` 存在时非邻接边 `opacity≈0.12` 且命中区不挂载；邻接边不变

- [ ] 渲染断言：hover 选中边 `<title>` 含命题句

- [ ] 回归：非焦点（`focusId=null`）行为与现状逐位一致；`pnpm gate` 全绿

## 来源

- Davies（2011）Concept Mapping, Mind Mapping and Argument Mapping（三种图形语言认知差异）

- Novak & Cañas：The Theory Underlying Concept Maps（命题化边 / 有意义学习）

- Xu et al.（2012 InfoVis）：A User Study on Curved Edges（语义弯曲 > 均匀弯曲）

- Misue et al.：Mental Map Preservation（空间记忆保持 → 布局/锚点稳定）

- Zhao et al.（2021 TVCG）：Background Stories on Graph Perception（上下文对图感知）

- Obsidian Local Graph / Kumu / Heptabase / CmapTools 交互实证（渐进披露 + 命题化）

