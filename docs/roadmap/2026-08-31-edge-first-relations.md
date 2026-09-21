# E 批规划：边一等公民（Edge as First-Class Citizen）

> 日期：2026-08-31 · 决策人：蒋指导 · 来源：关系功能设计审查（同日）+ 用户定调「关系在连线上」
> 定位：把连线从「树形的从属物」升级为「有类型、有方向、有属性、有笔记的一等公民」
> 前置审查：`entityGraph.ts` / `EntityGraphPanel.tsx` 缺口分析（P0 星型冗余 / P1 契约未接线）

## 一、需求定调与现状对照

| # | 需求（蒋指导） | 现状 | 判定 |
|---|---|---|---|
| 1 | 关系在连线上（边是关系载体） | spec §5.5 已预埋 `note.links`（源节点笔记内，`{rel, to}`）；K5 冻结解析契约 note-anchor.ts；**但 react/canvas 零消费，UI 完全没画** | 数据在、契约在、呈现为零 |
| 2 | 连线具有属性和 note | link item 仅 `{rel, to}`；`resolveLinks` 丢弃其余字段 | schema 加法扩展 |
| 3 | 支持指定连线方向 | 方向隐式（links 挂源节点 = 源→目标），无显式字段 | 加 `dir` 字段 |
| 4 | 自主连线（树形之外） | **数据层已支持**：任意节点可 link 任意节点锚/实体锚；仅缺渲染与编辑 | 纯 UI 批次 |

## 二、设计

### E1 · schema 扩展（kernel · minor 1.1.0，符合 ADR-0004「可加不可改」）

```markdown
## 任务A
<!--
links:
  - rel: blocks                   # 关系类型（开放字符串；已知类型走 REL_META 视觉映射）
    to: "node:里程碑/M2"          # 节点锚 / 实体锚（不变）
    dir: fwd                      # 新增：fwd（默认，源→目标）| back（目标→源）| both（双向箭头）
    label: 硬依赖                  # 新增：边上的短标签
    note: 必须先合入网关协议        # 新增：边的备注（hover 浮窗呈现）
    attrs: {}                     # 新增：任意属性透传（协议容忍未知字段既有纪律）
-->
```

- `ResolvedLink` 增加可选字段 `dir? / label? / note? / attrs?`（全部 optional，既有签名零变更）
- `resolveLinks` 透传上述字段；非法 `dir` 值按默认 `fwd` 处理并产 W 级 diagnostic
- 方向语义裁定：**links 永远声明在源节点**（单一事实源，无镜像写入）；`back/both` 只是渲染端的箭头语义，不产生第二条数据
- round-trip golden 测试：parse → serialize 保留 dir/label/note/attrs（Note 透传已容忍，加测试锁定）
- CHANGELOG 1.1.0 + ADR-0004 附录记录

### E2 · 渲染层（react · MapView 边叠加层）

- **自由边是树边之上的叠加层**：不参与树形布局，贝塞尔曲线连接两节点卡片边缘
- 视觉映射 `REL_META`（react 侧常量，rel 开放、未知 → 中性灰）：`blocks` 红实线 / `causes` 紫实线 / `relates-to` 灰虚线 / `duplicates` 琥珀虚线
- 箭头按 `dir`；`label` 渲染为边中点 chip；`note` hover 浮窗（复用 GlassCard 令牌）；点击边 → 选中（供 E3 编辑）
- 三态视觉：dangling → 虚线 + 空心箭头指向幽灵锚点；stale → 红色警示短线；锚点被折叠 → 经 `collapsedAncestors` 路由到可视祖先（复用实体连线既有机制）
- 性能：边数 = links 总量（非节点数平方），10K 基准下无压力；hit-testing 用宽透明描边路径（8px）兜住点击区

### E3 · 编辑层（react + canvas）

- **创建**：节点右键 → 「连线到…」→ 目标 picker（节点路径搜索 + 实体候选，复用 EntityPicker）→ rel 快捷模板（blocks/causes/relates-to/duplicates/自定义）→ 落 `note.links`
- **编辑**：点击边 → 编辑浮窗（rel/label/note/dir 四字段 + 删除）
- **写入**：全部经 `TreeOp update-node`（note 整体替换）→ undo/redo、OpHistory、自动保存零成本继承
- 移动端：拖拽连线手势**本批不做**（记录 friction，等 F 周输入）；右键菜单长按等价

### E4 · 关系面板消费（react + canvas）

- 面板新增「语义边」区：按 rel 分组列出全部边（源 → 目标 + label），点边 → focusNode 源节点
- 现有星型图**降级为单实体下钻视图**（点实体条目才展开）——修复「图 ≡ 列表冗余」的 P0
- 跨文档聚合（实体全局汇聚）**明确不进本批**——数据源在 DocumentHost 层，属 B 线 EntityHost 范畴，等 F 周 + B1 复用远端接缝

### E5 · 关系图网络视图（挂 F 周后，与 B 线合并评估）

全局网络（实体互连 + 节点多挂 + 跨画布汇聚）先不做独立实现；E4 已让关系面板「可用」，网络视图等 F 周摩擦清单定义真实需求后再立项，避免重蹈「臆测功能」覆辙。

## 三、批次表

| 批 | 内容 | 验收 | 测试门禁 | 预估 |
|---|---|---|---|---|
| E1 | schema + resolveLinks 透传 + golden | 手写 .mm.md 带 dir/label/note → 解析正确 → serialize 回写无损 | kernel 282 + 4 golden | 0.5 天 |
| E2 | MapView 边叠加层 | demo 画布手写两条 links → 曲线+箭头+标签可见；折叠父节点边路由正确；dangling 有警示 | react 291 + 6 新 | 1 天 |
| E3 | 连线创建/编辑/删除 | 右键连一条 blocks 边 → 画布出现 → 双击改 rel → 删除 → undo 全程可回退 | react + 8 新 | 1-1.5 天 |
| E4 | 面板语义边区 + 星型降级 | 边清单随树刷新；点实体条目才出星型图 | react + 4 新 | 0.5 天 |

- 串行依赖：E1 → E2 → E3 → E4；总预算 **3-3.5 天**，可压缩为 E1+E2 一天、E3+E4 一天半
- 每批独立提交 + 交付报告（沿用既有纪律）；573 测试基线全程绿 + typecheck/build 0 错误

## 四、决策点（默认值已裁定，可推翻）

| # | 决策 | 默认 | 理由 |
|---|---|---|---|
| D-E1 | dir 默认值 | `fwd` | links 挂源节点，正读自然 |
| D-E2 | 未知 rel 处理 | 中性灰 + 正常渲染 | rel 开放字符串，不设白名单门槛 |
| D-E3 | 边身份 | 不加 id（按 source+index 寻址） | 锚定每次重解析，dangling 可解释；加 id 是 v0.3 议题 |
| D-E4 | E5 网络视图 | 挂起 | 等 F 周真实需求 |

## 五、红线

1. `ResolvedLink` 既有字段（rel/to/anchor/state/nodeId/reason）签名不变——minor 加法
2. 不引入力导向/迭代布局（T8 降级纪律：星型够用前不上求解器）
3. 不做跨文档边渲染（B 线范畴）；不做边拖拽手势移动端（F 周输入）
4. Kernel 依赖图保持零 react 零 DOM

## 六、Issue 落位

I1 远端未建（git remote 仍为空），本批五个 issue 先落 `docs/dispatch/2026-08-31-e-batch-issues.md` 本地跟踪，I1 完成后补录 Forgejo。E1 是 F 自用周的前置——自由连线（PomodoroXI 缺陷依赖、技能互引）是 F 周真实工作的高频动作。
