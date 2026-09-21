# F5 派遣计划：shiftTree memo 陈旧几何修复（F 批复核阻塞项收口）

- **日期**：2026-09-14
- **起点 HEAD**：`0f722ef`（F4 收口后；本修复是 F 批的复核阻塞项，不是新功能批）
- **出处**：F 批复核（对话复核记录 §"阻塞项"）——**四步证据链已闭合**，本稿把它转成任务
- **批次代号**：F5-1 … F5-3
- **一句话**：F4 随"投影壳稳定化"一起引入了 `shiftTree` delta memo（只校验 `dx/dy`），在"放置重放原地改写复用节点 box"的路径上复用陈旧副本 → **静默陈旧几何**。本批移除它（代价已实测 ~2ms，远低于 16ms 预算），并把复核探针转正为回归钉。

## §0 基线（开工实测并报告；数字不符先报告再动手）

| 项 | 实测（复核时点） |
|---|---|
| 三包 | kernel **508 绿 + 探针 4 红**（`packages/kernel/tests/tmp-probe-shiftmemo.test.ts`，512 collected）；react **1206**；canvas **195** |
| 门禁 | tsc ×3 = 0；depcruise **431 模块 / 1220 deps** 零违规；lint **1468 + 46**；budget 持平 |
| bench（memo 开，现状） | k=1 编辑大岛深层叶子 **6.24ms** / k=3 **8.00ms** / 无改动复跑 **0.06ms** |
| bench（memo 关，修复后预期） | k=1 **8.37ms** / k=3 **7.86ms** / 无改动 **0.05ms**（复核实测；F-A7 硬目标 <16ms 仍达成） |

**冻结纪律**：阈值/契约测试不得放宽；禁 `git add -A`；**不 push**；不动 `.codebuddy/`、`.workbuddy/`、`tools/graph-engine/`；`CULL_MARGIN` 不动。

## §1 缺陷（复核证据链，四条，报告需原样引用）

1. **探针红**（4/8）：`dir=right/left × h恒定/h随文本` 四场景红，原文：
   `AssertionError: dir=right/h恒定：nodes[84](n5).box.x 陈旧/漂移（1022 vs 1058）`（差 36px = 被编辑节点宽度增量）；`down/up` 四场景绿。
2. **因果闭合**：临时禁用 memo 命中 → 探针 **8/8 全绿**；恢复 → 4 红。根因唯一。
3. **插桩定位**：编辑后再调用，memo 命中 n5/n6/n7/n8/n12/n16/n29；n5 命中时**当前 box.x=358，陈旧副本用 322** → 机制 = 放置重放原地改写复用节点 box，而 memo 只校验 `(dx,dy)`。
4. **代价**：memo 关闭 bench = 8.37ms（k=1）→ 代价 ~2.1ms，**远低于 16ms 预算**。

**为什么 F 批自己的测试够不到**：夹具 `measure` 的 `h=30` 恒定、编辑目标恒为 `deepLeaf`（无子节点）；触发条件是**编辑"有子节点的节点"**（其 w 变化会推移后代/复用节点的 box）。
**用户可达性**：真实 App 里"单行内敲字"（w 变、h 不变）→ 岛 `dx/dy` 不变 → memo 命中 → 错位**持久**（陈旧条目被反复复用，不会自愈）。即计划风险 §4.1 的"静默陈旧几何"。

## §2 任务

### F5-1 · 移除 delta memo + 探针转正（先红 → 绿）

**测试转正**：`packages/kernel/tests/tmp-probe-shiftmemo.test.ts` →
`packages/kernel/tests/layout-forest-shift-invariance.test.ts`：
- 去掉"探针/临时/复核"措辞，文件头注释改写为**回归钉**说明（缺陷机制一句话 + 为什么是"四方向 × 两种 measure"这组矩阵 + 为什么必须"编辑有子节点的节点"）；
- **8 场景与断言口径原样保留**（不得减场景、不得放宽为"近似相等"）；测试名去掉 `[探针]` 前缀。

**修复**（`packages/kernel/src/layout/forest.ts`）：
- 删除 `const shiftedMemo = new WeakMap<...>()` 与 `shiftTree` 内的 memo 分支（`hit` 查询 + `shiftedMemo.set`）；
- `shiftTree` 保持返回 `{ shifted, preorder }` 的形态（`shiftIsland` 依赖 `entry.preorder`），**每次实算**——最小 diff，不改调用面；
- 在 `shiftTree` 上方注释写明**为什么不能 memo**：条目有效性要求"整棵源子树的 box 均未变"，而 memo 只持有 `(dx,dy)`；放置重放会**原地改写复用 LayoutNode 的 box**（F3 机制），身份相等 ≠ 几何未变 → 必须放弃 memo（"给 memo 补 node 自身 box 校验"不充分：深层 w-编辑可只改后代 box 而祖先 box 不变）。

**顺序**：先跑转正后的测试确认仍红（贴原文）→ 实施删除 → 绿（8/8）→ 内核套件 **516/516** 全绿。

commit：`fix(kernel): 移除 shiftTree delta memo（陈旧几何；探针矩阵转正为回归钉）`

### F5-2 · 同族风险盘点（只出结论，**不夹带改动**）

产出一张表，逐项回答"它键了哪些输入、为什么充分、有没有'身份 + 部分输入'的缺口"：
`cache.nodes` / `cache.heights` / `cache.stamps` / `cache.collects` / `cache.bounds`、`entry.placed`（placedAt 守卫）、`lastProjected`（投影壳稳定化）、`lastRootShell`、模块级弱映射（若有其它）。
- 判据示范：`cache.stamps` 比较的是**放置参数**（side/top/xEdge）——输入齐全 ✓；`placedAt` 比较 origin 全等 ✓；`lastProjected` 走 `sameShell` 字段完备比较 ✓。
- **若发现第二个真缺口 → 停下报告（贴最小复现），不要自行扩大修复面**（是否修由复核裁定）。

### F5-3 · 收口

- `CHANGELOG.md`：在 `[1.8.15]` 段内**追加一句**（同批收尾缺陷修复，避免跳号；写明"复核发现 + 已移除 memo + 回归钉转正"）。
- 报告：`outputs/2026-09-14-f5-shift-memo-fix-report.md`（或追加 F 批报告 §4.4，若追加则须在 F5 报告里给锚点）：红证据原文、修复 diff 摘要、三包实测、bench 原样输出、同族盘点表、偏差与原因。
- bench：`node scripts/bench-layout-cache.mjs` 原样输出；核对 k=1/k=3 编辑场景 **<16ms**（参考：8.37 / 7.86ms）与"单树/无改动复跑"未回退。
- 门禁复跑：tsc ×3、depcruise、lint（**1468 + 46 不得上升**）、budget（全持平）、三包（kernel 516 / react 1206 / canvas 195）。
- **清理**（定向，勿整批 `tmp-*.log`）：`tmp-f-src.diff`、`tmp-f-src2.diff`、`tmp-f-suite-{k,k2,r,c}.log`、`tmp-f-probe{,.2,.3}.log`、`tmp-f-bench-{on,off}.log`、`tmp-l-wire.diff`、`tmp-l2.diff`、`tmp-l4.stat`。**唯一例外**：转正后的 `layout-forest-shift-invariance.test.ts` 保留并提交。
- **然后停**：不 push（复核通过后另行授权）；工作树除 `tools/graph-engine/` 外干净。

## §3 决策点（按推荐执行，不停下来问）

| # | 决策点 | 推荐 |
|---|---|---|
| **F5-A1** | 修法 | **删除 memo**（代价 ~2ms 已实测）。**不做**"补 box 校验"（不充分）；**不做** touched-set 版（另立批：须先过本回归钉矩阵） |
| **F5-A2** | 测试命名/位置 | `packages/kernel/tests/layout-forest-shift-invariance.test.ts` |
| **F5-A3** | 是否保留 `h恒定` 组 | **保留**（与 F 批夹具形态对照，证明两类夹具都在覆盖内） |
| **F5-A4** | CHANGELOG 号位 | 并入 `[1.8.15]`（不跳号） |
| **F5-A5** | push | **不 push**，修完等复核 |

## §4 风险

1. **bench 波动**：删 memo 后 k=1 预期 ~8ms；若某次中位 >16ms（不应发生）→ 停下报告，先别改判据。
2. **散落依赖**：删除确实只涉及 `forest.ts` 的 memo 三处（声明/查询/写入）+ 测试文件；`shiftIsland`/`placedAt` 不动——若发现其它引用 → 报告。
3. **同族盘点扩容**：只写结论，不顺手改代码（避免把"深度"做成"扩散"）。
4. **并行批次**：若有其它批在飞，先对齐其文件面（本批只碰 `forest.ts` + 新测试 + CHANGELOG + 报告）。

## §5 报告格式

- 逐任务：commit hash + 改动文件 + **红/绿断言原文** + 新增用例数。
- F5-1：修复前后 `shiftTree` 代码对照（贴 diff）+ 内核套件 516 实测。
- F5-2：同族盘点表（每行：键 / 输入 / 充分性依据 / 缺口结论）。
- F5-3：bench 原样输出 + 门禁原样输出 + 清理清单执行结果（`git status --short` 原文）。
- 偏差与原因；然后停，等复核与 push 授权。
