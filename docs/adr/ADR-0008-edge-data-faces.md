# ADR-0008 · 边数据三面职责划分（edges / links / tree-edge）

| 项   | 值                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------- |
| 日期  | 2026-09-04                                                                                                        |
| 决策人 | 蒋指导、WorkBuddy（工程执笔）                                                                                               |
| 状态  | **已接受**（P1 收敛决策；无破坏性变更）                                                                                           |
| 上游  | ADR-0004（接口冻结 v1.0）· spec §5.5（锚定契约）· `docs/roadmap/2026-08-31-edge-first-relations.md` · ADR-0007（StageInner 拆分） |

## 背景

深度审查发现**三种边数据形态在协议中长期并存**，边界长期停留在口头约定，出现过相互矛盾的注释（freeEdges.ts 头注称「画布 UI 不读写 note.links」，却未提及 tree-edge 形态）：

| 面                        | 位置                 | 当前消费者                                                                                 | 冻结面                                                                                              |
| ------------------------ | ------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `root.note.edges`        | 根节点 note.edges 数组  | 画布自由边（collectFreeEdges / FreeEdgeLayer / EdgeEditor / useEdgeActions）——**唯一活跃写入+渲染面** | 否（react 数据契约）                                                                                    |
| `note.links`             | 任意节点 note.links 数组 | 无 UI 消费者；内核 `resolveLinks` 持续维护解析契约                                                   | **是**（ADR-0004「锚定契约」：`parseLinkAnchor` / `resolveLinkAnchor` / `resolveLinks` / `resolveGroups`） |
| `note.edge` + `note.via` | 子节点 note 对象        | 树自然线标注（TreeEdgeEditor 写 edge；MapView chip 读 label/rel/via）                            | 否                                                                                                |

`note.links` 虽无消费者，但构成 ADR-0004 冻结面与 spec §5.5 的实现主体，**下线属 major 破坏性变更**——无消费者 ≠ 可删除。

## 决策

**三个数据面职责划分就此定型，新增功能不得开辟第四个面。**

### 1. `root.note.edges` —— 画布级自由边的唯一数据面

- 文档级标注对象（同对节点在不同画布可有不同边）；锚存稳定路径/实体锚；会话内解析为 nodeId

- 写路径**唯一收敛到** **`connectEdge`**（防重双线 + `updateNote` undo）；渲染面 `FreeEdgeLayer`

- 未来 B 线 AI 提议边（`source: 'inferred'`）**优先落本面**，以 source 标记区分，不新建数据面

### 2. `note.links` —— B 线语义层与插件契约（保留，不 扩展）

- 冻结契约 + spec §5.5 三态解析**保持不变**；作为「跟着节点走的知识」的语义层与插件扩展基础

- 画布 UI **不读写**；本 ADR 后禁止新功能向 links 追加写路径（写入需求一律走 `root.note.edges`）

- 删除本面 = major 破坏性变更，须先修订本 ADR

### 3. `note.edge` / `note.via` —— 树自然线标注的唯一数据面

- 父子结构线的非几何标注（rel/label/note/style），跟随子节点走（与画布自由边语义不同）

- `note.via`（历史字符串形态）**只读兼容**（MapView chip 兜底显示）；新写入只落 `note.edge` 结构化对象

## 边界与禁止项

- 禁止三面互相迁移/合并（links → edges 的批量迁移不在此版本范围；如需则修订本 ADR + 迁移脚本）

- 禁止在渲染管线中同时消费多个数据面（当前仅 edges + tree-edge 各自渲染，links 不渲染）

## 后果

- 新增连线/关系功能时取舍顺序：树上的结构关系 → `note.edge`；画布级的自由语义关系 → `root.note.edges`；跨画布的「知识边」需求 → 先评审是否需要激活 links 消费面

- 轻代码清理（随本 ADR）：freeEdges.ts 头注、EntityGraphPanel edges 注释纠正为与三面定义一致

- 测试与预算面：无破坏性变更，全量 gate 门禁可过

