# 摘要节点 S4 回执 · 括线渲染与导出

- **日期**：2026-09-21
- **批次**：S4（SummaryLayer / 括线几何 / SVG 导出 / 浏览器验收）
- **分支**：`codex/summary-node-s4-20260921`
- **worktree**：`<local-path>`
- **证据目录**：`outputs/summary-node/S4/S4-20260921-160000/`
- **固定基线**：`0fa0f9dfb6eecec6d47019b4efd2f7615fe9350b`（S3-R1 落地终态）
- **结论**：**实现与验证完成**，门禁逐项达标，四项交付物齐备。**已停止，未启动 S5。**

> 说明：本报告自身是分支上的一条提交，故「报告里写死自己的 HEAD」原理上无法闭合。
> 下表的 **HEAD/Tree 是报告撰写前**的实测值；**权威终态以 `manifest.txt`（最后生成）为准**。

---

## 一、完整对象标识

| 项 | 值 | 取证方式 |
|---|---|---|
| 固定基线 SHA | `0fa0f9dfb6eecec6d47019b4efd2f7615fe9350b` | 任务书指定；`git rev-parse` 实测一致 |
| 基线 Tree | `6eb177324a678bb40492932f276cc0dddec918c1` | `git rev-parse HEAD^{tree}` @ 开工 |
| **S4 HEAD** | `c2badf85f61d8a1306da11e15cc4bf8cc5d4f717` | 报告撰写前实测 |
| **S4 Tree** | `21b1f8c8a34d874d52ef76e422784da26d901d89` | 同上 |
| S4 HEAD 父提交 | `1d76501858f88c083135b02e46eb13e5211b07d5` | 同上 |
| 分支 | `codex/summary-node-s4-20260921` | `git branch --show-current` |
| RunId | `S4-20260921-160000` | — |

**提交序列**（`git log 0fa0f9d..HEAD`，严格单父线性链，**无 amend / 无 rebase / 无历史改写**）：

| # | SHA | subject |
|---|---|---|
| 1 | `4fa1d8d` | `docs(dispatch): S4 开工记录（基线 SHA/Tree/工具链/门禁逐项实测）` |
| 2 | `8bf6305` | `feat(react): 摘要括线几何与渲染层（summaryFrames/SummaryLayer + MapView 挂载）` |
| 3 | `f9dde80` | `style(react): S4 自有 lint 归零（去死常量与赋值表达式）` |
| 4 | `327a754` | `feat(react+canvas): 摘要括线进 SVG/PNG 导出（exportSvg 插线 + 宿主 root 透传）` |
| 5 | `bdd9b45` | `style(react): 去 exportSvg 未使用类型导入（S4 自有 lint 归零）` |
| 6 | `0635598` | `docs(dispatch): S4 阴性对照四组证据（真实退出码 + 目标断言原文）` |
| 7 | `04867e9` | `test(tools): verify-summary 真浏览器验收（创建/成员变化/左右向/导出/三主题三缩放）` |
| 8 | `ca68d7e` | `test(canvas)+docs: 生产构建隔离门禁与 S4 门禁结果（逐项实测）` |
| 9 | `1d76501` | `docs(dispatch): 记录 mode-guard 既有抖动（基线复现证明非 S4 引入）` |
| 10 | `c2badf8` | `docs: 摘要节点协议/契约/CHANGELOG 补记（§6.5 summary_of + W-SUMMARY-DANGLING）` |

**未触碰**：主工作树（`codex/file-assets-foundation-20260920`）、S3 worktree、旧提交、旧证据；
**未 push、未发布、未合并主分支、未 amend**。

---

## 二、新增 / 修改文件清单

```
 CHANGELOG.md                                     |  50 ++
 apps/canvas/src/MindmapStage.tsx                 |   2 +
 apps/canvas/src/hooks/useExportActions.ts        |  15 +-
 apps/canvas/tests/prod-build-isolation.test.ts   |  64 +++   [新]
 apps/canvas/tests/summary-export-root.test.tsx   |  82 +++   [新]
 docs/specs/2026-09-02-mm-md-protocol.md          |  51 ++
 docs/specs/2026-09-17-mm-md-ai-contract.md       |   6 +-
 packages/react/src/chrome/exportPng.ts           |  10 +-
 packages/react/src/chrome/exportSvg.ts           |  37 ++
 packages/react/src/index.ts                      |   7 +
 packages/react/src/render/MapView.tsx            |  30 ++
 packages/react/src/render/SummaryLayer.tsx       | 106 ++++   [新]
 packages/react/src/render/summaryFrames.ts       | 203 ++++++ [新]
 packages/react/tests/summary-export-svg.test.ts  | 239 ++++   [新]
 packages/react/tests/summary-frames.test.ts      | 654 ++++++ [新]
 packages/react/tests/summary-layer-host.test.tsx | 181 ++++   [新]
 tools/verify-summary.mjs                         | 565 ++++   [新]
 17 files changed, 2294 insertions(+), 8 deletions(-)
```

**未修改（任务书禁改项，逐条核验）**：
`packages/kernel/src/layout/branching.ts`（0 行改动）；S3 卫星算法（`satellite.ts` 未动）；
文件管理 / 图库 / P0-A/B/C / P0-D（未动）；`summary_of` 协议语义（未改）；
测试观测口生产隔离策略（沿用 `IS_TEST_BUILD`，未改）。

- **kernel 零改动**：`git diff 0fa0f9d..HEAD -- packages/kernel` 为空。
  （任务书 §一.8「不修改 kernel 布局逻辑」达成；唯一的契约缺口处置见 §三。）

---

## 三、关键契约发现（重要，先读）

`buildSummaryViews` 需要**成员区间**才能算成员带，但 **`LayoutResult.satellites` 不携带 `memberIds`**：

```
sat LayoutNode keys: node,box,side,depth,parentId,children     ← 实测探针（无 memberIds）
```

**处置（不改 kernel、不重解析 raw `summary_of`）**：
用 kernel **已导出**的 `buildSatellitePlan(root).specs` 取 `memberIds`，
按 `summaryNodeId` 与 `layout.satellites` 对齐。这不是"重解析"——
`buildSatellitePlan` 内部调用的就是布局用的同一个 `resolveSummaries`（S-A3 单一事实源），
react 层不解析 `summary_of` 字面量、不自行推断区间。

**对齐性已实测**（`layoutMindmap` 与 `layoutLogic` 两路径各 1:1 对齐）：

```
--- layoutMindmap ---        satellites ids: ["s1"]  plan.spec ids: ["s1"]  1:1 aligned: true
--- layoutLogic(左岛, -1) --- satellites ids: ["s1"]  plan.spec ids: ["s1"]  1:1 aligned: true
```

完整探针记录：`outputs/summary-node/S4/S4-20260921-160000/contract-finding.md`

> **探针期一处自身错误（记录以免误读）**：首版探针把 `layoutLogic(root, m, collapsed, opts)`
> 当四参调用，而真实签名是 `(root, measure, collapsedIds, **direction**, opts)` ——
> `opts` 落进 `direction` 槽致钩子被静默忽略，报出"plan.specs=1 而 satellites=[]"的**假矛盾**。
> 若只读码不实测，会误判为 kernel 契约缺口并触发停止条款。**未触发停止条款。**

---

## 四、红→绿日志（逐组，红证据贴原文）

完整版：`outputs/summary-node/S4/S4-20260921-160000/red-green/frames.md`

| 组 | 红（原文摘要） | 绿 |
|---|---|---|
| 几何契约 | `Error: Cannot find module '../src/render/summaryFrames.js'` → `Tests no tests` | 18 passed |
| 渲染宿主 | `Error: 测试前置缺失：括线` → `Tests 5 failed \| 1 passed (6)` | 6 passed |
| SVG 导出 | `AssertionError: 不累积: expected +0 to be 1` → `Tests 6 failed \| 4 passed (10)` | 10 passed |
| 宿主 root 透传 | `AssertionError: root 必须透传给 exportSvg: expected undefined to be {...}` → `Tests 2 failed` | 2 passed |

**三处红因归因（均为测试侧缺陷，非实现缺陷；已用一次性探针实测确认）**：

1. **`memberBand` 形状**：断言用 `memberBand.maxX/minY`，实际契约是 `Box {x,y,w,h}` → 改 `x+w` / `y+h`。
2. **多摘要「竖段 x 不重合」**：六个成员同列（x/w 相同），两条括线竖段**必然共线**，
   实测两带 `-125..-7` 与 `7..125` 纵向分离 → 改判「纵向带不重叠 + stem 不串线」。
3. **夹具摘要 id 冲突**（最隐蔽）：`addSummaryTo` 硬编码 `${parent.id}::summary`，
   第二次调用与第一次同 id → `buildSatellitePlan` 按 id 索引时相互覆盖，
   **多摘要用例静默退化为单摘要**（探针实测：两 spec id 完全相同、两 view 皆指向「乙」的成员）→ 夹具按 tag 派生唯一 id。

---

## 五、阴性对照（四组，实测退出码）

详细：`outputs/summary-node/S4/S4-20260921-160000/negctl/summary.md` + 四份 `negN-*.log`

| # | 中性化 | 目标测试 | 正常副本 | 中性化后 | 红因（目标断言原文） |
|---|---|---|---|---|---|
| 1 | 删除 `<SummaryLayer>` 挂载 | `summary-layer-host.test.tsx` | exit 0（6 passed） | **exit 1** | `测试前置缺失：括线 d` |
| 2 | 摘要层挪到节点层之后 | `summary-layer-host.test.tsx` | exit 0（6 passed） | **exit 1** | `AssertionError: summaries 必须在 tree-links 之前: expected 2 to be less than 0` |
| 3 | 成员带用**自身盒**代子树并集 | `summary-frames.test.ts` | exit 0（18 passed） | **exit 1** | `AssertionError: 带右沿必须覆盖成员的子树（否则是「根盒代子树带」的阴性对照目标）: expected 378 to be greater than or equal to 541.999999` |
| 4 | 删 `satellites` 空早退（改消费 `plan.specs`） | `summary-frames.test.ts` | exit 0（18 passed） | **exit 1** | 见下方「neg4 的红测构成」——**两条红中只有一条**是上表口径的目标断言 |

### neg4 的红测构成（**S4-R2 更正**）

neg4 的中性化是「删除 `args.satellites.length === 0` 早退 + 改为消费 `plan.specs`」。
该改动使**所有以 `satellites: []` 为前提的用例**都会转红 —— 实测确有 **2 条**红：

| 红测 | 断言原文 | 是否目标断言 |
|---|---|---|
| `buildSummaryViews 不读取 raw summary_of（卫星为空时一律零 view）` | `AssertionError: 摘除判定只能来自 satellites（单一事实源）: expected [ { …(10) } ] to have a length of +0 but got 1` | ✅ **是** —— 正是「消费面纪律」的目标断言 |
| `satellite 盒缺失 → 跳过该 view` | `无 satellites → 不产出 view（括线以卫星为锚）` | ❌ **否** —— 同一 `satellites:[]` 前提下的**邻居**用例，被中性化连带打红；其断言语义是「卫星盒缺失」，与「不重解析」无关 |

> **原版回执只引用了第 1 条**，未说明还有第 2 条 —— 属选择性呈现。S4-R2 在此补全：
> 第 2 条红是**连带**结果，不构成对「消费面纪律」的额外证明。
> 按任务书的 5 条纪律（正常副本先绿 / 真实非零退出 / 红因是目标断言 / 无假绿机制 /
> 补丁确实落地）判定，**该阴性对照依然成立** —— 因为目标断言确已转红。
> 另注：`satellite 盒缺失` 的**真正**用例（剥离卫星盒的那条，`summary-frames.test.ts:442-448`）
> 在 neg4 下**保持绿**（它不依赖 `satellites: []`）。

**合规核验**：正常副本先绿 ✓；中性化后**重建 dist**（log §3 见 `Done`）✓；真实非零退出 ✓
（子 shell 重定向取 `$?`，不经管道）；红因**含**目标断言原文 ✓（neg4 另有一条连带红，已如上表列明）；
四组 log 中**无** `Cannot find module` / `Invalid hook call` / `ReferenceError` ✓；无 `it.fails`、
无反转断言、无 catch 报通过、无宽泛 skip ✓。

> **证据落盘更正**：S4 原提交**未把 `negN-*.log` 纳入版本控制**（仅提交了 `run-negctl.sh`
> 与 `summary.md`），故上表引用的 log 原文在仓库内不可核。S4-R2 已重跑四组负控，
> 并把逐组 log 提交到 `outputs/summary-node/S4-R2/S4-R2-20260921-160000/negctl/`。

> **二次更正（S4-R2 复核 finding high）**：上面这句「已…提交」在 S4-R2 **首版提交时也不成立** ——
> 仓库根 `.gitignore` 的 `*.log` 让 `git add` 静默跳过它们，实际一个都没入库。
> 该缺口已在 S4-R2 的修复提交中**真正补齐**（`.gitignore` 加 `!outputs/**/negctl/*.log`），
> 并已用 `git ls-tree` 核实 5 个 `.log` 确实在树内。

> **一处方法说明**：首轮 `REAL_EXIT_CODE` 错读为 `0` —— `cmd | sed | tail` 管道里 `$?`
> 取到的是 **`tail` 的退出码**。已改为「子 shell 重定向到文件 → 先取 `$?` → 再 sed 展示」。

---

## 六、SummaryLayer 真实挂载证据

`packages/react/tests/summary-layer-host.test.tsx`（**挂载生产 `MapView`**，非复制体）：

```
✓ 摘要文档：括线与 stem 真的渲染出来
✓ 层序契约：summaries 在树线之前、节点之前（各层同 g）
✓ 括线挂在变换 g 内（缩放/平移与节点同步，不用屏幕绝对坐标）
✓ 括线几何与布局同源：x 落在成员带右侧
✓ 无摘要文档：不渲染 summaries 层（零回归）
✓ 括线不参与命中：pointer-events 为 none（选择逻辑零改动）
Tests  6 passed (6)
```

**层序**（实测 `[data-layer]` 序列）：`sections → summaries → tree-links → free-edges → nodes → edge-labels → ghosts → drag`，
与既有 R5-2 层序契约一致（`mapview-layer-order.test.tsx` 4 项仍绿）。

---

## 七、DOM 几何与 SVG 几何证据

**DOM 几何**（浏览器实测，成员带含子树）：

```
A8 括线竖段在成员带右侧 — {"bracketMaxX":366,"bandMaxX":354}
A9 括线纵向贴合成员带上下沿 — {"bracket":[-89,41],"band":[-89,41]}
C3 左向括线在成员带左侧 — {"bracketMinX":-274,"bandMinX":-262}
```

**SVG 几何**（导出件实文，`outputs/summary-node/S4/S4-20260921-160000/browser/export-summary.svg`）：

```xml
<g data-summary-id="ndmuauqp0g1f" data-summary-side="right">
  <path data-summary-bracket="ndmuauqp0g1f" d="M 144 -17 L 156 -17 L 156 17 L 144 17"
        fill="none" stroke="#646b7d" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
  <path data-summary-stem="ndmuauqp0g1f" d="M 156 0 L 166 0"
        fill="none" stroke="#646b7d" stroke-width="1.9" stroke-linecap="round"/>
</g>
```

- 方括号形状：上指线 → 竖段 → 下指线，`bracketX = band.maxX + 12` ✓
- stem 水平、长度 10（= `SUMMARY_STEM_GAP`）✓；线色 `#646b7d` = glass 主题 `linkStroke` ✓
- 导出**保留** `data-summary-bracket` / `data-summary-stem` 可定位属性 ✓

**普通文档逐字等价**（零回归硬判据）：

```ts
expect(exportSvg(layout, token, { root: plain }))  // 传 root
  .toBe(exportSvg(layout, token));                 // 不传 root —— 逐字相同
expect(withRoot.includes('data-summary'), '普通文档导出不含任何摘要痕迹').toBe(false);
```
**结果：通过**（`Test Files 1 passed`；`summary-export-svg.test.ts` 10/10）。

---

## 八、浏览器截图、导出件与 bundle 指纹

`outputs/summary-node/S4/S4-20260921-160000/browser/`：

| 项 | 值 |
|---|---|
| 页面实际加载 bundle | `main-xueCbZ36.js`（`assertLoadedBundle` 与 index.html 引用一致） |
| dist 入口 sha256 | `2165d7ac7332c5c2ad0f52bfd8ca884dab3bf420ef1200238515ba607392958f` |
| 产物构建时刻 | `2026-09-21 14:11:29` |
| 验收输出 | `verify-output.txt`（exit 0） |

截图：`a1-menu` / `a2-draft` / `a3-created` / `a4-selected` / `b1-shrunk` / `b2-degraded` /
`c1-left-island` / `c2-layout-decl-not-consumed` / `theme-{经典,贴纸,玻璃}` / `z-{out,mid,in}` /
`plain` / `d0-exported`；导出件 `export-summary.svg`。

**三档缩放实测不同**（`k` 互异，截图 md5 互异，非重复）：

```
z-out k=0.5621  z-mid k=1  z-in k=2.1555
```

**关键浏览器断言**（共 43 项，全绿）：

- A 创建：右键菜单含「创建摘要…」→ 引导文案 → 摘要节点出现 → **括线出现（1 条）** →
  带 stem → 右向 → `pointer-events:none` → 贴带右侧/上下沿 →
  自动选中高亮 → 点空白取消 → 从未选中态点选可选中 → **选中成员反向高亮** → **选择不改变括线几何**；
- B 成员变化：删中间成员 → 括线收缩（130 → 82）→ 删端点 → **括线消失 + 摘要仍可见 + 净减恰 2 节点**；
- C 方向：森林左岛 → `side=left` + 括线在带左侧；
- D 导出：SVG 落盘 → 含括线/stem → 数量与画布一致（不重复）→ 线色取 token。

**一处实测边界（如实标注，不伪称覆盖）**：`note.layout: org` 这类布局声明**画布侧不消费**
（`pipeline.ts` 不读 `note.layout`，UI 无布局切换入口），故 **org / timeline / fishbone 降级域
无法经真实 UI 触发**；脚本已把该事实写成断言（C4）而非伪装成降级验证。
org 降级域由 kernel 用例覆盖（`summary-satellite.test.ts`）。

---

## 九、门禁逐项结果

详见 `outputs/summary-node/S4/S4-20260921-160000/gates/final.md`

| 项 | 基线 | S4 实测 | 判定 |
|---|---|---|---|
| kernel tests | 708 | **708 passed (75 files)** | 持平 |
| react tests | 1602 | **1636 passed (161 files)** | +34（新增用例，逐一吻合） |
| canvas tests | 391 | **395 passed (47 files)** | +4（新增用例） |
| typecheck | 0 | **0**（四包 + canvas `tsconfig.test`） | 持平 |
| build | Done | **全包 Done** | 持平 |
| depcruise | 558 模块 / 1678 deps / 0 违规 | **565 模块 / 1694 deps / 0 违规** | 0 违规 |
| lint | 1541 warn + 48 info | **1544 warn + 48 info**（S4-R2 复核后更正；原文写 1543 为笔误/旧读） | 自有 **0**（见下归因） |
| budget | any0 / bang89-90 / asCast31-31 / bigFiles4-4 | **逐项持平** | 达标 |
| prod build 观测口 | 0 | **0**（三模式各 0 命中） | 持平 |
| verify-summary.mjs | — | **exit 0（43 项全绿）** | 通过 |

**未提高阈值、未删除既有断言、未用截图替代结构化断言。**

### lint 差值归因（1544 vs 1541）

> **数字更正（S4-R2 复核 finding）**：本文件原写 1543，经 S4-R2 复核在 S1/S4 两棵树上
> 独立复算，S4 候选的实测值为 **1544**（S1 = 1541）。R2 的 `lint-delta.md` / `final.md`
> 已按 1544/1541 更正，本文件此前未同步，现补正。

1. 逐条集合差分（`path|line|category`）：`NEW` 与 `REMOVED` **一一对应且仅行号位移**
   （如 `MindmapStage.tsx|1300` → `|1302`）。
2. `summary-*` 与 `prod-build-isolation.test.ts` 的警告数 **= 0**（实测过滤）。
3. 唯一疑似新增项 `useExportActions.ts|60` 经单独复核：改动前后**同文件同行同 category**。

**结论：本批未引入可归因的 lint 债务。** 总数不可逐位对齐的部分来自 biome 多 worker
诊断归属抖动（同一警告换行即计一次差异）。过程中自查并消除了自有 4 条
（2 未使用符号 + 2 赋值表达式），详见 `gates/lint-delta.md`。

### react/canvas 用例增长构成

| 文件 | 用例 |
|---|---|
| `summary-frames.test.ts` | 18 |
| `summary-layer-host.test.tsx` | 6 |
| `summary-export-svg.test.ts` | 10 |
| **react 小计** | **34** = 1636 − 1602 ✓ |
| `summary-export-root.test.tsx` | 2 |
| `prod-build-isolation.test.ts` | 2 |
| **canvas 小计** | **4** = 395 − 391 ✓ |

---

## 十、任务书 §六 覆盖对位

| 要求 | 落点 |
|---|---|
| 1 右向单摘要几何 | `summary-frames.test.ts`「右向单摘要」3 例 |
| 2 左向严格镜像 | 「左向严格镜像」2 例（`layoutLogic` 真左向） |
| 3 多摘要 | 「多摘要」1 例（含纵向分离 + 不串线） |
| 4 成员带包含子树 | 「成员带包含成员的子树」 |
| 5 摘要子树高度变化 | 「摘要子树高度变化」 |
| 6 成员盒缺失 | 「成员盒缺失 → 跳过该 view」 |
| 7 satellite 盒缺失 | 「satellite 盒缺失」+「卫星节点不在扁表盒内」 |
| 8 dangling / stale 不绘制 | 2 例（并断言节点仍可见） |
| 9 nestedSkip 不绘制 | 1 例（并断言两摘要可见） |
| 10 降级不绘制但可见 | 同上；另「无摘要文档 → 零 view」 |
| 11 主题 token 三档 | `summary-export-svg.test.ts` 三主题 + 浏览器 `theme-*` 截图 |
| 12 缩放和平移 | 浏览器三档实测 `k` 互异 + `transform g` 内挂载断言 |
| 13 摘要选择与成员高亮 | 浏览器 A10–A14（含反向高亮 + 几何不变） |
| 14 SVG 含括线 | `summary-export-svg.test.ts` + 浏览器 D3 |
| 15 SVG 普通文档逐字等价 | 「普通文档逐字等价」 |
| 16 多次渲染无重复 path | 「重复导出不累积」+ 浏览器 D5 |
| 17 生产构建观测口 = 0 | `prod-build-isolation.test.ts`（产物级）+ 实测 |

---

## 十一、未覆盖项与既有问题（如实列出）

1. **Canvas 后端括线未支持**：与 SectionLayer 同边界（不经 SVG 分支即不渲染）。
   **本包不宣称 Canvas 括线已支持**；任务书要求「不宣称」已遵守。
2. **org / timeline / fishbone 降级域未经浏览器验证**：`note.layout` 在画布侧不被消费
   （无 UI 入口），无法经真实 UI 触发。该域由 kernel 用例覆盖，浏览器脚本已把
   「声明未被消费」写成显式断言（C4），不伪装成降级验证。
3. **框内（FO）降级、显式 `note.dir` 分叉路径**：同上，未做浏览器验证（kernel 层有用例）。
4. **拖拽调整摘要范围、嵌套摘要 UI、跨父摘要、多选系统、线型样式配置、
   「解除摘要但保留节点」动作、非连续成员集合**：任务书 §六「明确不做」，本批未实现。
5. **文件选择器为桩**：浏览器验收用 `showOpenFilePicker` 桩（自动化无法驱动真实 OS 选择器）；
   **真实 OS 输入法**、**跨浏览器**（仅 Chromium）不在本脚本范围 —— 与仓内既有
   `verify-*` 脚本同边界，不伪称覆盖。
6. **既有测试抖动（先于 S4 存在，已证明）**：`apps/canvas/tests/mode-guard.test.tsx`
   偶发失败（`expected '✓ 已保存' to contain '未保存'`，自动保存 debounce 与断言的时序竞争）。
   **在无任何 S4 代码的基线 worktree（detach `0fa0f9d`）上复现**：18 次采样中 1 次失败。
   与 S4 分支观测频率同量级 → **非 S4 引入**；本批**不修复**（超出范围，属另一批）。
   取证：`gates/flake-note.md`。canvas 全包验收以复跑的确定性结果 **395 passed** 为准。
7. **`summary_of` 版本号未定**：按仓内惯例留作 **v1.12 候选**（协议 §6.5 / §十二 同措辞），
   发布批次统一编号 —— 未经授权不自行定号。
8. **bundle 指纹为本次构建产物**：`main-xueCbZ36.js`；若后续源码变动需重建后重跑
   `verify-summary.mjs`（脚本的 `checkSnapshotFresh` 会在产物过期时 `exit 1` 拒绝运行）。

---

## 十二、结论与停止声明

- 四项交付物齐备：`summaryFrames.ts` / `SummaryLayer.tsx` / 对应 react+canvas 测试 /
  `tools/verify-summary.mjs`；`exportSvg.ts` 与 `MapView.tsx` 按范围修改；文档已补记。
- **kernel 零改动**；未触碰禁改项（`branching.ts` / S3 卫星算法 / 文件管理 / 图库 /
  P0-A/B/C / P0-D / `summary_of` 协议语义 / 观测口隔离策略）。
- **未重新引入 `window.__mindcanvasSummaryHost` 生产暴露**（产物级用例守，实测 0 命中）。
- 门禁逐项达标；四项阴性对照真实退出码 1 且红因为目标断言；浏览器验收全绿。
- 一处契约缺口（`satellites` 无 `memberIds`）以「消费 kernel 既有导出」处置，
  **未修改 kernel、未重解析 raw `summary_of`**；**未触发任何停止条款**。

**未启动 S5。** 完成后停止，等待独立复核。

### 停止条款逐条自查

| 条款 | 是否触发 | 依据 |
|---|---|---|
| `layout.satellites` 数据不足以计算稳定括线 | **否** | 成员区间经 `buildSatellitePlan` 取得，两路径 1:1 对齐实测（§三） |
| frame 降级路径出现节点消失 | **否** | B4「摘要节点仍在」+ B5「净减恰 2」实测通过 |
| SVG 与 DOM 几何口径无法统一 | **否** | 二者同源同一 `buildSummaryViews`，仅取盒来源不同（导出=布局盒，画布=动画帧盒） |
| 需修改 S3 卫星算法才能修复 | **否** | kernel 零改动 |
| 需放宽普通文档逐字等价 | **否** | 逐字等价用例通过（§七） |
| production build 再次包含测试观测口 | **否** | 三模式各 0 命中 + 产物级用例守 |
| SummaryLayer 改动导致节点命中/选择/边渲染回归 | **否** | `pointer-events:none`；层序契约与既有层序用例 4/4 绿；react 全包 1636 绿 |

---

## 附录 · 门禁终态复跑（本报告提交后，于 `7e5dfa4` 实测）

| 项 | 实测 | 判定 |
|---|---|---|
| build | `pnpm -r build` → 4 包全 Done | 持平 |
| typecheck | 四包全 Done，0 error | 持平 |
| depcruise | 565 modules / 1694 deps / **0 违规** | 达标 |
| kernel | **708 passed (75 files)** | 持平 |
| react | **1636 passed (161 files)** | +34 |
| canvas | **395 passed (47 files)** | +4 |
| budget | bang 89/90 优于、其余逐项持平 | 达标 |
| prod build 观测口 | `__mindcanvasSummaryHost`=0、`__MINDCANVAS_TEST_BUILD__`=0 | 持平 |
| `tools/verify-summary.mjs` | **全绿**（exit 0） | 通过 |

**权威终态 SHA/Tree 见 `outputs/summary-node/S4/S4-20260921-160000/manifest.txt`**（本报告自身是分支上的提交，
故报告内写死自身 HEAD 原理上无法闭合）。
