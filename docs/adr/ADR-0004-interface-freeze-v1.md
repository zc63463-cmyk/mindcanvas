# ADR-0004 · 接口冻结 v1.0（Interface Freeze）

| 项 | 值 |
|---|---|
| 日期 | 2026-08-28 |
| 决策人 | 蒋指导、WorkBuddy（工程执笔） |
| 状态 | 已接受（K5 收官：三面镜子验收 + 内核定型） |
| 上游 | roadmap K5 段（`docs/roadmap/2026-08-27-kernel-refactor-roadmap.md`）；联动 spec R12（微内核 + 六注册表 + 「两个消费者」规则）；ADR-0001（库优先） |

## 决策

**1.0.0 起冻结 `@mindcanvas/kernel` 与 `@mindcanvas/react` 的公开导出面**：任何已冻结签名的变更按 semver 管理——**minor 可加不可改**（只允许新增导出/可选项），**major 破坏性变更须走 ADR**（先记录再实施）。`apps/canvas` 为私有应用，随内核/渲染器版本对齐。

## 冻结范围（K5 验收后的公开面，与 CHANGELOG.md 一致）

| 面 | 内容 |
|---|---|
| 实体三件套 | `EntityRef` / `Entity` / `Resolver`（`resolve`）+ `resolveAll`（K5 新增） |
| 协议层 | `parseMm` / `serializeMm` / `astToEditable` / `editableToAst` / `validateId` / `stripOrgPrefix` / `refKey` / `unresolvedEntity` / `isUnresolved` / `REGISTERED_KINDS` / `KIND_META` / `KIND_FALLBACK_COLOR` |
| 六注册表 | `Registry` 底座（register/get/has/list + `UnregisterHandle`）+ 六个 `*Registry` 类 + `createKernelRegistries` + `registerBuiltinKinds` + `NoteKeyHandler` / `SemRoleMapping` / `Channel` / `KindMeta` / `LayoutAlgorithm` 契约 |
| 锚定契约 | `parseLinkAnchor` / `resolveLinkAnchor` / `resolveLinks` / `resolveGroups`（K5 新增，spec §5.5） |
| 插件 | `Plugin` / `PluginHost`（生命周期自注销） |
| 编辑树 | `TreeOp` 判别联合 / `applyOp` / `invertOp` / `OpHistory` / `pathOf` / `nodeByPath` / `searchNodes` 等 treeOps 助手 |
| 布局 | 布局算法 / `MeasureFn` / `CharMeasure` / `isBoxInView` / `filterVisibleLinks` |
| React 渲染 | `MapView`（props + api）/ `ThemeProvider` / `useTheme` / `TokenSet` / chrome 组件 / `EditorController` / `matchEditorKey` / `searchMind` |

## 变更流程

1. **minor（可加不可改）**：新增导出 / 新增可选项 / 新增枚举值（语义层 `semantics` 词汇按 spec §5.5 独立版本化）。不得改既有签名、不得破坏 round-trip。
2. **major（破坏性变更）**：改动既有公开签名的行为或形状。**必须先写 ADR**（现象 / 方案 / 受影响消费者 / 迁移路径），评审通过后实施，CHANGELOG 记 major 条目。
3. **边界澄清**：六注册表的「条目值」（如新增 kind 的 KindMeta、新增 SemRole 映射）不是内核签名变更——注册表本就为插件扩展而设；变更的是注册表自身的接口形状才算 major。
4. **透传铁律不可因任何版本变更破坏**：未知 kind / 未知 note 键 round-trip 永不丢弃。

## 三面镜子验收结论摘要（本 ADR 的验收依据）

| 镜子 | 结论 | 缺口处置 |
|---|---|---|
| 一 · forgejo-bridge（联动 spec） | 读管道（EntityRef→Resolver→Entity）、SemRole/action 映射、写路径（promote/幂等/提议）与 reconcile 数据需求**接口够用** | ① 批量解析 → **v1.0 内补 `resolveAll`**（已合入）② 提议集/节点锚定 → 插件侧类型 + **v1.0 内补 note-anchor**（已合入） |
| 二 · MindFlow 标注 | annotation kind / meta 颜色动机通道 / 透传键 / decisions 写路径**接口够用** | 渲染器槽位已存在（RendererRegistry）；语义调色板、hover 合并视图 → v1.0 后插件侧组合 |
| 三 · PomodoroXI | 未知 kind（session/task）透传 + unresolved 降级 / action 通道 / 状态同步写路径**接口够用** | 渲染器元信息、原子组合 op → v1.0 后插件侧；未知 kind 透传已兜底 |

## 附录 A · K5 冻结前接口修订记录（最后窗口）

| 修订 | 来源镜子 | 理由 | 落点 |
|---|---|---|---|
| 新增 `resolveAll(resolve, refs)` | 镜子一 | 对账场景需一次拉全部实体（N 次单查不可接受）；部分失败语义（成败都入 Map、违约抛异常兜底 unreachable） | `packages/kernel/src/entity/entity.ts` |
| 新增 note-anchor 模块（parseLinkAnchor / resolveLinkAnchor / resolveLinks / resolveGroups） | 镜子一（node_anchor）+ 镜子二（links/groups） | spec §5.5 锚定与失联规则：well-formed / dangling / stale 三态需内核纯函数判定（不涉及渲染） | `packages/kernel/src/registry/note-anchor.ts` |

> 两处修订均不破坏既有签名（纯新增），全量测试保持绿（kernel 225→266）。

## 附录 B · 1.1.0 边一等公民 schema 修订（E1，2026-08-31）

| 修订 | 来源 | 理由 | 落点 |
|---|---|---|---|
| `ResolvedLink` 增可选字段 `dir? / label? / note? / attrs? / warnings?` + 新类型 `LinkDir` | E 批规划（`docs/roadmap/2026-08-31-edge-first-relations.md`） | 「关系在连线上」：边需属性/笔记/方向；全可选字段，既有签名零变更 | `packages/kernel/src/registry/note-anchor.ts` |
| 协议层扁平对象列表（parser/serializer） | 同上 + 缺口实证 | spec §5.5 `links` 对象数组在文本协议无法表达（对象列表此前 E-INVALID-NOTE-YAML 丢弃整块笔记）——契约与文件格式脱节，minor 内补齐 | `packages/kernel/src/protocol/{parser,serializer}.ts` |

> 方向语义裁定：links 永远声明在源节点（单一事实源），`back/both` 仅为渲染端箭头语义，不产生第二条数据。kernel 282→290 全绿。

## 后果

- 六注册表语义、Entity 三件套、TreeOp、MeasureFn、协议语法自此稳定；后续插件（forgejo-bridge 首个）在冻结面上开发
- 新增消费者/词汇 → minor 或语义层版本化，不触发 major
- 架构层面问题（如内核重组）如需破坏冻结面 → 先 ADR 再动（v1.0 之后）
