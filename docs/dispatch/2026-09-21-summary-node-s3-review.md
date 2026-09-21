# 摘要节点 S3（布局卫星）独立复核报告

- **日期**：2026-09-21
- **性质**：S3 **独立复核**（只验证、只报告；**不修复、不合并、不 push、不启动 S4**）
- **复核人**：独立复核会话（本报告作者）——未参与 S3 施工
- **固定基线**：`e187fa9064c3c7554626005c2e43fcd735c76ecf`（tree `3874987ec7f2205e182b8337aee30db8bab0c89e`）
- **S3 代码候选（固定 SHA）**：`9a523d31b33eb9083642d69e2449a2342fac8e8b`
  （tree `cc49754a0cbf0cf473dff881c270eb6e2c222082`，本次复核亲自 `git rev-parse HEAD HEAD^{tree}` 复算一致）
- **含回执链尾**：`e14df2d53711ada6575bb7fa785450a22fb36ff9`
- **隔离复核工作树**：`<local-path>`（detached `9a523d3`，主树之外）
- **证据目录**：`outputs/summary-node/S3/S3R-20260921-082207-review/`（位于隔离工作树内；另见 `outputs/summary-node/S3/S3R-chain-verify/`）
- **结论**：**ACCEPT**（无阻断项；S3 新增差异 **3 条**、基线既有缺陷 **1 条**、流程偏差 **2 条**，另有**覆盖缺口 1 条**，均非阻断，逐条详见第八节与 9.4）

> 本报告路径 `docs/dispatch/2026-09-21-summary-node-s3-review.md` 在撰写前**不存在**（`ls` 报 `No such file or directory`），
> 故**未覆盖任何旧报告**。本次复核**未修改任何被评审源码**（见第十节）。

---

## 一、复核对象与固定锚点

| 项 | 值 | 本次如何取得 |
|---|---|---|
| 固定基线 | `e187fa9064c3c7554626005c2e43fcd735c76ecf` | 施工回执 §一；基线对照树 `<local-path>`（detached `e187fa9`） |
| 代码候选 | `9a523d31b33eb9083642d69e2449a2342fac8e8b` | 隔离工作树内 `git rev-parse HEAD` 实测 |
| 候选 tree | `cc49754a0cbf0cf473dff881c270eb6e2c222082` | `git rev-parse HEAD^{tree}` 实测 |
| 隔离工作树 | `<local-path>` | `git worktree list` 实测为该 SHA 的 detached 工作树 |
| 证据目录 | `outputs/summary-node/S3/S3R-20260921-082207-review/` | 隔离工作树内已存在，含 7 个 `0x-*.txt`、`gates-S3R2/`、`probe/` 及各专项 `.md` |
| 链纪律证据 | `outputs/summary-node/S3/S3R-chain-verify/manifest.txt` | 隔离工作树内已存在（未覆盖并发会话的 `S3R-20260921-082207-review/`） |

**证据目录来源说明**：`outputs/summary-node/S3/S3R-20260921-082207-review/` 由**另一并发复核会话**（同 run-id 前缀）写入，
本报告作者**只读引用**、未覆盖、未追加。本报告独立重跑的实测数字记于下文并在正文标注命令原文；
凡本报告未亲自重跑的项，一律显式标注「引用证据，未由本人重跑」。

**术语界定：「独立确认员」**（本节首次出现处定义，全文同义）——
指**另一个并发复核会话**中的复核者，与本报告作者**非同一会话**；其结论经本报告作者**转述/采纳**，
本报告作者**未重跑其命令、未复核其探针源码出处**。因此，「独立确认员实测/纠正」是**第二手引用证据**，
与「本人实测」不属同一证据强度：其在正文处**逐条标注来源性质**，未标注者一律视为引用证据。
其中一名确认员的 `zz-*` 系列探针文件已在树内消失（见 8.3 PROC-2、8.1 对 `S3R-CACHE-01` 的处理），
故其**探针类**实测（凡依赖已消失探针者）按「证据不可复现」处理；其**只读复算类**实测仍按引用证据采信。

---

## 二、提交链与纪律核验

### 2.1 ancestor 关系（本人实测）

- `git merge-base --is-ancestor e187fa9 <c>` 对 `0b082d3` / `b75fa53` / `a9cab9a` / `9a523d3` **逐一 exit 0**
  （证据：`S3R-20260921-082207-review/01-chain.txt` C1 段；本次复核未重跑该命令，标注为**引用证据**）。
- 代码提交**恰 4 条**（`git rev-list --count e187fa9..9a523d3` → `4`）：
  `0b082d3` 核心 → `b75fa53` layoutLogic+森林 → `a9cab9a` 等价测试 → `9a523d3` 生产接线。

### 2.2 文件集合（本人实测）

`git diff --name-status e187fa9 9a523d3`：**恰 10 个文件**，全部为摘要卫星相关 ——
5 源码/接线（`kernel/src/index.ts`、`kernel/src/layout/{forest,layouts,mindmap}.ts` 改 + `satellite.ts` 新、
`react/src/demo/pipeline.ts` 改）+ 4 测试文件 + 1 react 测试；`git diff --shortstat` = `10 files changed, 2077 insertions(+), 38 deletions(-)`。
（证据：`01-chain.txt` C2 段，本次复核未重跑，标注为**引用证据**。）

### 2.3 回执链与「代码候选之后零源码改写」（本人实测）

- 回执链 9 条（`9a523d3..e14df2d`），逐条 `git show --stat` 均**只改**
  `docs/dispatch/2026-09-21-summary-node-s3-report.md`（证据：`02-receipts-stat.txt`，含每条 `A:`/`C:` 时间戳）。
- `git diff --name-only 9a523d3 e14df2d` → 仅该 md；`-- packages/ apps/ tools/` → **空**。
- 四个代码提交 tree 未变：`705b1ea7` / `cfe5c80e` / `f485d3e4` / `cc49754a`，reflog 事件类型全为 `commit`。

### 2.4 回执 amend 例外（流程偏差，正面证据）

**结论：属实，且影响仅限回执文档，源码零字节。**

本人实测（隔离工作树内直接执行）：

```
$ git reflog --all | grep -iE "amend|b3f247|4eb272"
4eb272e worktrees/mindcanvas-s3/HEAD@{8}: commit (amend): docs(dispatch): 摘要节点 S3 布局卫星施工回执
b3f247c worktrees/mindcanvas-s3/HEAD@{9}: commit: docs(dispatch): 摘要节点 S3 布局卫星施工回执
```

`reflog` 的动作标记 `commit (amend)` 即**正面证据**（非提交信息自述）。进一步实测：

```
$ git diff --stat b3f247c 4eb272e
 docs/dispatch/2026-09-21-summary-node-s3-report.md | 6 ++++--
 1 file changed, 4 insertions(+), 2 deletions(-)
$ git rev-parse b3f247c^ 4eb272e^
9a523d31b33eb9083642d69e2449a2342fac8e8b
9a523d31b33eb9083642d69e2449a2342fac8e8b
$ git rev-parse b3f247c:packages 4eb272e:packages
e66bb4d673f7d8344fa19aa941fa825dddfc1974
e66bb4d673f7d8344fa19aa941fa825dddfc1974
```

即：amend 前后**同父**（均为 `9a523d3`）、**packages tree 逐位相同**，差异仅回执 md。
（证据：`03-amend.txt` C4b2 段，与本次实测一致。`b3f247c` 已不可达，`git log --all` 无该锚。）

**两处须纠正/补充（复核独立确认员提出，本报告采纳）**：

1. **「违反任务书 §一.7『不 amend』」这一具体条款无法在树内验证。** 隔离工作树内**无 S3 任务书**，
   且全树 `git grep "不 amend"` 为空；系列任务书 `docs/dispatch/2026-09-20-summary-node-plan.md:30` 仅
   禁 `git add -A`、不 push、要求「每任务一条 commit」，**未出现「不 amend」字样**（本次复核实测 `grep` 无命中）。
   施工方在回执 §十八 引用的「§一.7」条文，**在候选树内不可复现**。故本报告只认定「发生了一次 amend」这一**事实**，
   不认定「违反了某条可核验的成文条款」。
2. **自陈非同步披露。** 在 amend 提交 `4eb272e` 当时，回执 §三 仍写「提交链（4 条，无 amend、无 push）」；
   §十八 自陈是稍后由 `6b4ad97`（提交信息「补记提交纪律偏差」）追加的。故属**事后自陈**，非同步披露。

**判定**：流程偏差，severity **low**，**不构成阻断**（源码候选 `9a523d3` 未被污染，来源独立可证）。

---

## 三、核心布局语义逐条结论（14 条）

**整体判据**：无摘要时逐位等价（`Object.is`）；有摘要时卫星几何、链接、降级路径均成立。
**本次亲自重跑的门禁**（见第七节）全部通过。下表**新增「来源」列**，逐行显式区分
**本人实测**（本次亲跑/亲读）与**引用证据**（转抄，未由本人重跑）—— 此前二者混排在「证据」单元格内，易被漏看。

| # | 主张 | 结论 | 证据 | 来源 |
|---|---|---|---|---|
| 1 | 加法性：不注入钩子 = 旧行为 | **成立** | `mindmap.ts:213-216` 缺省 `NO_SATELLITE_HOOK`；`satellite.ts:287-289` `skipIds` 返回共享空集；kernel 全包 **73 文件 / 691 通过** | 源码实读 + kernel 全包 **本人实测** |
| 2 | 缓存开 == 关逐位等价 | **成立** | 已提交 `summary-satellite-cache.test.ts` 11 步编辑序列；该文件 **8/8 通过**（定向套件 35/35） | **本人实测** |
| 3 | 只从布局树摘除，不破坏编辑树 | **成立** | `buildSatellitePlan` 仅收 `state==='well-formed'`（`satellite.ts:112-115`）；探针 `probe4.test.ts` F 实测 raw 树逐字段不变、父对象身份 `===` 成立 | 源码实读**本人**；探针 **引用证据，未由本人重跑** |
| 4 | 编辑树/搜索/路径/迁移未变 | **成立** | `git diff --name-only e187fa9..9a523d3` 未触碰 `summary-anchor.ts`/`cutAttach.ts`/`treeOps.ts`/search 相关文件 | **引用证据** |
| 5 | dangling / stale 摘要留流内 | **成立** | 坏 cid 锚与坏形态锚（`from:''`,`to:42`）均 `plan.skip=0`/`specs=0`，节点可见、卫星=0（`probe4.test.ts` G） | **引用证据** |
| 6 | 降级域（org / 显式 dir / down 岛）节点不消失 | **成立** | `degrade.test.ts` 5 passed：ORG 可见=true 且 `satellites=undefined`；BRANCHED 可见=true 且 `satellites=undefined`；FOREST-down S 可见=true；对照 LOGIC `satellites=1`。`summary-satellite-forest.test.ts` 含 `down 岛` 用例**通过**（见第 12 条命令） | `degrade.test.ts` **引用证据**；定向套件 **本人实测** |
| 7 | 无 P→S 链接 | **成立** | `summary-satellite.test.ts:458`、`forest.test.ts:168-171` 断言；P→成员链接保留（`pipeline.test.ts:100-109`）；定向套件 35/35 通过 | **本人实测** |
| 8 | 保留 S→子链接 | **成立** | `probe2.test.ts` C 实测 S→S-child 存在且端点 `x=sat.box.x+sat.box.w`（同源几何） | **引用证据** |
| 9 | 左右镜像一致 | **成立** | `probe5.test.ts` I 实测右向 `gap=22`、左向 `gap=22` 相等；`satR.side=1`/`satL.side=-1`。回执 §10.1 记录初版左向多加了整个卫星宽、已修 | **引用证据** |
| 10 | 垂直居中于成员带 | **成立** | `probe2.test.ts` B 实测 band centerY=0、sat centerY=0 | **引用证据** |
| 11 | 成员带用**真实子树包围盒** | **语义成立，但「一致性测试」判据薄弱** | 源码 `bandOfMembers` 对每成员调递归 `subtreeBBox`（`satellite.ts:222-242`）；`probe2` B 用带子节点的成员验证 `sat.x = 子树bandMaxX(368)+22 = 390` 精确成立。**但**已提交测试 `summary-satellite.test.ts:396-404` 的 `band` 由**逐成员节点盒** `n.box.x` / `n.box.x+n.box.w` reduce 而成，成员在该夹具无子节点 → 子树包围盒 ≡ 节点盒，**两份实现即便分叉也不可检出**。详见第八节 S3-NEW-1 | 源码实读**本人**；`probe2` **引用证据**；已提交测试实读**本人** |
| 12 | react 复用 kernel 常量 | **kernel 侧唯一来源成立；react 侧当前零消费（S4 未落地）** | 实测 `grep -rn "SUMMARY_BRACKET_GAP\|SUMMARY_STEM_GAP" packages/*/src apps/*/src` → 仅 `kernel/src/index.ts:291-292` 与 `satellite.ts:65,67`；`packages/react/src/render` 无 `SummaryLayer.tsx`/`summaryFrames.ts`。**但**（见第八节 S3-NEW-2 纠正）react 侧**确有** kernel 钩子的消费方：`packages/react/src/demo/pipeline.ts:18,262-263,279` 注入 `satelliteHook`，`summary-satellite-pipeline.test.ts` **3/3 通过**，故「react 复用 kernel 导出」**可验证**；仅**渲染层**（`render/`、`chrome/`）尚无 `satellites` 读取方 | grep + react 管线 3/3 **本人实测** |
| 13 | 卫星宽度无双重计算 | **成立** | `placeOne` 的 `xEdge` 只做反解，宽度由 `placeSubtreeIncremental` 施加一次；数值自洽 `sat.x−bandMaxX=22=12+10` | **引用证据** |
| 14 | 同一坐标系（卫星与 `nodes` 同引用） | **成立** | `probe2` C 实测 `res.nodes.includes(sat)===true`；森林侧 `forest.test.ts:197-200` 断言同引用；`forest.ts:292-301` 卫星进 `placed` 与 `nodes` | 森林源码实读**本人**；`probe2`/`forest.test.ts` 断言 **引用证据** |

**item 6（降级）补充实测**（本人亲自执行）：

```
cd packages/kernel && npx vitest run tests/summary-satellite.test.ts tests/summary-satellite-cache.test.ts tests/summary-satellite-forest.test.ts
→ Test Files  3 passed (3)    Tests  35 passed (35)
```

---

## 四、缓存与森林逐条结论（含闭包注入方案）

### 4.1 缓存

| 项 | 结论 | 证据 |
|---|---|---|
| 缓存开/关逐位等价（无摘要 + 有摘要） | **成立** | 探针 S3R-1（14 passed）；本人实测 `summary-satellite-cache.test.ts` 8/8 通过 |
| 连续 11 步编辑序列逐步等价 | **成立** | 已提交测试；S3R-2 探针「创建摘要→改成员→改摘要文本→缩进→反缩进→范围内移动→折叠→展开→删摘要」全 `eq=true` |
| 同一输入重复布局三次稳定 | **成立** | S3R-3 探针 `warmRuns[1]==[0]`、`[2]==[0]`、`coldRuns[0]==warmRuns[0]` |
| 缓存命中不引用旧局部坐标（S3R-CACHE-01） | **未复现陈旧几何** | 卫星 `top/xEdge` 每轮由成员实际盒重算；`stamps` 不匹配即强制重放。以生产真实形态（稳定 `collapsedIds` 引用）实测 `afterWarm===afterCold`。**注意**：独立确认员指出其引用的 `tests/zz-s3r-probe12.test.ts` 全树不存在、数值 `286→358`/`56→136` 在其同形夹具上不成立，故该发现**标注为 `status=downgraded-to-unconfirmed`**（原 `status=verified` 已撤回；证据不可原样复现，见 9.4） |
| measureKey / 主题切换不造成错位 | **成立** | S3R-5 探针 A→B→A 均 `warm==cold` |
| 跨族共享 cache 无混读 | **成立（但机制表述被证伪）** | S3R4-A2/A3 交替 `layoutMindmap` 与 `layoutLogic(±1)` 各 5 轮 → 各自 `warm==cold`。独立确认员实测：隔离**并非**由对象域提供（两族同写 `cache.nodes`，`side∈{±1}`），而是**三元组门控** `(side, depth, parentId)`，且跨族确实命中。详见第八节 S3-NEW-3 |
| **layoutLogic 不校验 collapsedKey/measureKey** | **基线既有缺陷（非 S3 引入）** | 见第八节 BASE-1 |

### 4.2 森林

| 项 | 结论 | 证据 |
|---|---|---|
| 右/左岛平移正确 | **成立** | 本人实测 `npx vitest run tests/summary-satellite-forest.test.ts`（含 `down 岛` 用例）通过；定向三件套 35/35 |
| `shiftIsland`/`shiftTree` 对卫星独立产平移副本 | **成立** | 本次亲自读 `forest.ts:292-301`：`for (const sat of local.satellites ?? [])` 逐一 `shiftTree`，卫星根 `parentId=spec.parentId` 非 null，故岛根查找不会误选卫星 |
| 卫星进 `placed` 缓存、落点不变则引用复用 | **成立** | `forest.ts:239-250` 守卫；`summary-satellite-forest.test.ts:234-257` 断言 `sat2===sat1`、落点变则 `≠` |
| `islandLinks` 之外单独重建卫星内部链接 | **成立** | 本次亲自读 `forest.ts:307-321` `collectSatelliteLinks`，仅重建 `S→子`，不含 `P→S` |
| 连续三次平移：同落点幂等 / 异落点累加 / 回原点复原 | **成立** | `summary-satellite-forest.test.ts:203-232` + 多岛探针 |
| 卫星内部深链坐标随平移 +1000 | **成立** | `rv-deeplink-probe.test.ts` 2 passed。**引用证据** |
| 无摘要文档零差异（注入钩子 vs 不注入） | **成立** | `rv-closure-probe` D 判据；`summary-satellite-forest.test.ts:289-296` |
| **闭包注入覆盖全部真实调用点** | **成立（关键）** | 本次亲自读 `packages/react/src/demo/pipeline.ts:259-288`：`layoutOpts` 带 `satellite: satelliteHook`；`fallbackWithSatellite` 闭包将钩子绑进 `layoutMindmap`；`layoutMindmapBranched` 只透传 `{cache,measureKey}`（`branching.ts` 本批禁改），故由调用侧闭包补偿。`forest.ts:86-104` `layoutByDir` 同样闭包绑定。实测 `summary-satellite-pipeline.test.ts` **3/3 通过** |

**闭包注入方案评价**：该方案（钩子不进 `BranchLayoutOptions`，而在 `fallback` 闭包里绑定）
是**绕开禁改文件 `branching.ts` 的正确工程解法**，且 `NO_SATELLITE_HOOK` 缺省保证旧调用方零改动。
代价是「钩子可达性分散在多个调用点」，由 `rv-reach-probe`/`rv-closure-probe` 与 react 真管线测试共同守护 —— **可接受**。

---

## 五、nested summary 与降级、L2 范围一致性判定

### 5.1 nested summary 处置

- **无节点消失**（最严重形态未出现）：`nested-probe.test.ts`（7 passed）断言全树节点均出现在布局 `nodes`（`missing=[]`），注入卫星后 `lost=[]`。
- **裁决方向**：范围含另一摘要的那条（外层）→ `nestedSkip`，**不摘除、留流内**；被包含的那条（内层）→ 摘除为卫星。
  判据在 `satellite.ts:126-130`（本次亲自读）：`if (r.memberIds.some((id) => allSummaryIds.has(id))) { nestedSkip.add(...); continue; }`。
- **测试覆盖缺口**：`nestedSkip` 分支**无任何已提交测试覆盖** —— 本人 `grep` 确认候选树内 `nestedSkip` 仅出现在 `satellite.ts` 自身，三个已提交卫星测试文件（35 用例）全用单摘要夹具。可达性由一次性探针证明（父下 `[成员A,S2,成员C]`，S1 覆盖 A..C → `skip=[S2]`）。
- **语义不自洽点（low）**：外层留在流内后，其拓扑区间**仍含一个已被移出带内的内层摘要节点**。属本批「不承诺嵌套」范围内的语义债务，非节点消失、非数据损坏。
  独立确认员进一步纠正了机制表述：真实机制是**内层卫星盒（x=400..500）仍被计入外层的带心计算**（`band.maxX` 由 378 抬到 500），故内层落在 `x=512` 的外层括线之内；并非「留流内摘要括住带外摘要」。结论（low、非缺陷）不变。
  **来源标注：本报告作者未亲自重跑该结论，亦未获得其探针文件路径 → 引用证据，未由本人重跑。**

### 5.2 降级域汇总

| 域 | 是否承诺卫星 | 实测 | 节点是否消失 |
|---|---|---|---|
| 单树无 `note.dir`（`layoutMindmap`） | **承诺** | 产出卫星，`sat=1` | 否 |
| 森林 right/left 岛（`layoutLogic`） | **承诺** | 产出卫星，left `side=-1` | 否 |
| 森林 down/up 岛（`layoutOrg`） | **不承诺**（`forest.ts:100` `return base`） | `satellites=undefined` | 否 |
| 显式 `note.dir` 分支路径 | **不承诺**（`branching.ts` 本批禁改） | `satellites=0`，摘要+成员全在扁表 | 否 |
| 框内（FO）路径 | **不承诺** | 计划承诺边界之一 | 否 |
| 嵌套摘要 | **不承诺** | 外层留流内、内层成卫星 | 否 |

### 5.3 L2 范围一致性判定

- 计划书 `docs/dispatch/2026-09-20-summary-node-plan.md:133` 明标「8. (L2 带高整合,可选)」，
  `:188` 预留停止条款出口，`:198` §6「明确不做」含嵌套摘要。→ **L2 为显式可选项**。
- 回执 `L397`：`L2 带高整合 …… 未触发 | 本批未实现 L2（任务书标注为「可选」），未评估其工期`；
  `L405-407`：`…… 但不是「已实现」`。→ 施工方**未把可选项当硬阻断，也未过度声明**。
- 回执 `L414`：`嵌套摘要 UI：明确不实现 …… 当前处置为「不摘除、留流内可见」`；
  `L440`：`S3 不声称 S4 括线、SVG 导出或浏览器完整验收已完成`。全文扫描无「已完整支持」类夸大表述。

**判定：L2 未实现不属于硬 DoD，范围无矛盾，不构成 REJECT 理由。**

---

## 六、负控五项结果

> **术语界定（本节首次出现处定义，全文同义）**：本报告区分三种「红」——
> **① 行为红**：变异后测试以**目标断言失败**（`AssertionError` 等）退出 1，即期望的红，属**负控成立**；
> **② 假红**：以**编译/模块解析/夹具构造错误**冒充行为红，`exit 1` 但断言未被执行，属**负控无效**；
> **③ 漏红（该红不红）**：变异本应触发目标断言却**仍全绿**，即该测试对变异**恒盲**，属**测试有效性缺陷**。
> 「无摘要逐位等价被破坏」等属 ①；S3-NEW-1 的「对被评审的分叉恒盲」属 ③，**不属假红**，两者不可混用。

> 说明：本节五项为**本轮复核指定的负控清单**。回执 §9 另载有施工方自做的四处阴性对照（A/B/C/D，见 6.2），
> 两者**不是同一组**，分别列出、不混写。

### 6.1 复核指定负控（五项）

| # | 做法 | 是否按目标断言转红 | 日志所载退出码（转抄，非本人实测） | 目标断言描述（**非**失败输出原文） |
|---|---|---|---|---|
| 1 | 放宽 mindmap 过滤/skip 集（无摘要基线逐位等价） | **是** | **1** | 目标断言：无摘要逐位等价被破坏 |
| 2 | 移除 forest 的 satellite 平移 | **是** | **1** | 目标断言：森林平移专测（卫星随岛移动） |
| 3 | 移除 `islandLinks` 的 satellite 分支 | **是** | **1** | 目标断言：摘要子树链接专测（`S→子` 必须重建） |
| 4 | 破坏左向镜像公式 | **是** | **1** | 目标断言：左卫星几何测试 |
| 5 | 去除调用侧闭包绑定 | **是** | **1** | 目标断言：卫星可达性测试 |

**五项均报按目标断言转红，日志所载 `exitCode=1`。**
**本报告作者未亲自重跑这五项变异**（变异需修改源码，与只读边界冲突），标注为**引用证据**。

> **⚠ 本表证据强度声明（如实标注，不补写未取得的证据）**：
> - 上表两列为**转抄自证据目录 `gates-S3R2/` 的结论性描述**，**本表未附任何逐行日志文件名/路径**
>   （对比 6.2 给出了完整路径）→ **第三方无法按行回溯核验：未覆盖**。
> - 上表「目标断言描述」列是**测试设计意图**，**不是**测试运行时的失败输出原文
>   （**不含** `AssertionError`、文件:行号）；因此**它不能区分「行为红 ①」与「假红 ②」**。
> - 故原先「无假红」这一断言，**在本表字段内无证据支撑，本报告撤回其在本节的成立性**：
>   对 6.1 五项，本报告只能确认「转抄记录称按目标断言转红」，**不能确认为行为红而非假红 —— 未覆盖**。
> - 6.2 的四处 A/B/C/D 为**日志实读**，其红因栏含真实 `AssertionError:` 片段，**支持**其属 ①；
>   但那是施工方自做的**另一组**对照，**不能代替**对 6.1 五项的判定。

### 6.2 施工方自做阴性对照（A/B/C/D，供对照）

证据路径：`<local-path>`，
本报告作者**亲自读取原文**：

| 编号 | 操作 | 退出码（日志实读） | 红因原文（截录） |
|---|---|---|---|
| **A** | 移除 `build` 的 `skip` 过滤 | 1（`Test Files 1 failed`，`Tests 2 failed \| 17 passed`） | `AssertionError: P→S 不得存在: expected true to be false // Object.is equality`（`summary-satellite.test.ts:458`） |
| **B** | 移除子树高度的 `skip` 过滤 | 1（`1 failed \| 18 passed`） | `AssertionError: 摘除后流内 vs 无摘要：nodes[1]….box.y 漂移（-37 vs -15）: expected false to be true`（`summary-satellite.test.ts:56`） |
| **C** | 移除 `shiftIsland` 的卫星平移 | 1（`5 failed \| 3 passed`） | `AssertionError: expected { Object (node, box, ...) } not to be { Object (node, box, ...) } // Object.is equality`（`summary-satellite-forest.test.ts:255`）；另 4 处含「卫星不随岛平移 / 扁表缺卫星 / 链接未重建」 |
| **D** | 移除 `collectSatelliteLinks` | 1（`1 failed \| 7 passed`） | `AssertionError: S→子 必须重建: expected undefined to be defined`（`summary-satellite-forest.test.ts:173`） |

**四处均为 `exit 1` 且按目标断言转红。** 回执 §9 如实记录了「阴性对照 B 在首版测试下不判别，
本轮据此补写判别用例后 B 才转红」，并声明是**发现盲区后加严**而非事后放宽断言 —— 与 A/B/C/D 日志一致。

---

## 七、门禁与预算实测数字（含与参考值比对）

### 7.1 本人亲自重跑的门禁

| 门禁 | 命令（原文） | 退出码 | 实测 |
|---|---|---|---|
| kernel 定向 | `npx vitest run tests/summary-satellite.test.ts tests/summary-satellite-cache.test.ts tests/summary-satellite-forest.test.ts`（`packages/kernel`） | 0 | **3 文件 / 35 passed** |
| kernel 全包 | `npx vitest run`（`packages/kernel`） | 0 | **73 文件 / 691 passed** |
| react 定向 | `npx vitest run tests/summary-satellite-pipeline.test.ts`（`packages/react`） | 0 | **1 文件 / 3 passed** |
| 工作树内容 = 候选 | `git hash-object` ×4 vs `git rev-parse HEAD:<path>` | 0 | 四文件 `ccc2d339` / `0ade2fe8` / `6c182641` / `11d51480` **逐位相同** |
| 候选锚点 | `git rev-parse HEAD HEAD^{tree}` | 0 | `9a523d31…` / `cc49754a…` **与固定值一致** |

### 7.2 引用证据（证据目录 `gates-S3R2/`，本人读日志原文）

> **⚠ 本节证据强度**：本表所有数字均为**本报告作者读日志原文转抄**，**不是本人重跑命令的输出**；
> **本表在修订前未给任何一行的可复现命令行原文**（对比 7.1 有「命令（原文）」列）→
> **逐行命令原文与执行环境（同工作树/同 SHA/执行时间）：未覆盖**，第三方无法据此重跑核验。

| 门禁 | 退出码 | 实测 | 与参考值比对 |
|---|---|---|---|
| react 全包 | 0 | **158 文件 / 1602 passed** | 与任务书参考值 1602 **相符** |
| canvas 定向 | 0 | **2 文件 / 38 passed** | — |
| canvas 全包 | 0 | **45 文件 / 391 passed** | 与参考值 391 **相符** |
| `pnpm typecheck` | 0 | 4 包全 `Done`（kernel/free-canvas/react/canvas） | — |
| `pnpm -r build` | 0 | 4 包全 `Done`；canvas vite `built in 201ms` | — |
| `pnpm depcruise` | 0 | `no dependency violations found (556 modules, 1668 deps)` | 基线 551/1644/0 → **+5 模块/+24 deps，0 违规** |
| `pnpm lint` | 0 | `Found 1541 warnings. Found 48 infos.`（563 文件） | — |
| `npx biome lint packages apps --max-diagnostics=none` | 0 | `Checked 563 files … Found 1541 warnings / 48 infos` | 基线同命令 1541w+48i ⇒ **净增 0**（前提：两命令同一工作树/同一 SHA 的一次运行 —— 见下注） |
| `pnpm budget` | 0 | `any 0/0、tsIgnore 0/0、bang 89/90、asCast 31/31、console 4/4、todo 1/1、defaultExport 2/2、bigFiles 4/4` | 与基线 `e187fa9` **逐项相同，债务未增长** |

**「lint 净增 0」结论的前提声明（如实标注）**：`pnpm lint`（:259）与 `npx biome lint`（:260）是**两条不同命令**、
两组相同数字 `1541w / 48i`。本报告**未记录**这两条命令的执行时间、工作树与 SHA 是否同一 →
**「两数字来自同一次运行/同一工作树」这一前提：未覆盖**。因此「净增 0」在**本表证据范围内**属**未完全支撑**的结论；
可确证的仅是「两组转抄数字相等」。若需坐实「净增 0」，须补两命令于同一 SHA 的运行记录。

**基线口径对照表（三个不同时代的数字，避免误读为「实测与参考值不符」）**：

| 口径 | kernel | react | canvas | 出处 |
|---|---|---|---|---|
| 开工前参考值（计划书 §0） | 622 | 1502 | 353 | `docs/dispatch/2026-09-20-summary-node-plan.md` §0 |
| **S2 后基线**（S3 的真实对照基） | **656** | **1599** | **391** | 本报告 §7.2 基线对照 |
| S3 候选总数（实/任务书参考） | 691 | 1602 | 391 | §7.2 实读 / 任务书 |

**基线对照（S3 真实增量）**：kernel `656 → 691`（**+35**，恰等于定向 35 例）；react `1599 → 1602`（**+3**）；
canvas `391 → 391`（**+0**）。三包合计 **2684 passed**。

**与参考值差异说明**：计划书 §0 写「kernel 622 / react 1502 / canvas 353」是**开工前**参考值；
S2 批次已使基线升至 656/1599/391。任务书给的 691/1602/391 是**候选总数**，逐条相符。
即：`622/1502/353`（开工前参考）、`656/1599/391`（S2 后基线）、`691/1602/391`（S3 候选）是**三个时代的数**，
**非**「实测 656 对不上参考 622」。

### 7.3 文件边界与预算（逐条）

| 项 | 要求 | 实测 | 判定 |
|---|---|---|---|
| `packages/kernel/src/layout/mindmap.ts` | < 600 行 | **575** | ✅（余量 25） |
| `cutAttach.ts`（任务书写 `kernel/edit/`，实为 `packages/react/src/edit/`） | < 600 行 | **591** | ✅ |
| `branching.ts` 字节不变 | 不变 | blob `94944bfdea8e11b7931ce679c9ce888b3c62e52a` = 基线 `e187fa9` **逐字节相同** | ✅ |
| 无新增 any / asCast / 非空断言 | 0 / ≤31 / ≤89 | 0 / 31 / 89 | ✅ 持平 |
| `bigFiles` 数量不增 | 4 | 4（同 4 文件） | ✅ |
| depcruise 无循环依赖 | 0 | 0 违规 | ✅ |

> `branching.ts` 磁盘 `wc -c`=26775 系 `core.autocrlf=true` 且无 `.gitattributes` 的 CRLF 检出差异；
> **git blob 字节才是口径**，磁盘与 blob 同字节（本次复核用 `git hash-object` 逐文件确认四文件同 blob）。

### 7.4 缓存与森林专项实测

- **无摘要零几何漂移**：flat/logic/deep/noref × {`layoutMindmap`,`layoutLogic`} × cache{off,on}，
  归一化进程内 node id 后两树 `md5` 相同（`5451db9d022a35b3e663c8705c150de1`），diff 行数 **0**。
  → **S3 新增差异（无摘要路径）= 0**。
- **基线旧缺陷影响面未扩大**：同款探针在基线 `e187fa9` 与候选 `9a523d3` 输出逐值相同
  （`展开=5 折叠后=5 STALE-CHILD-SURVIVES (w=40)`；measure-swap 轴 `w@k1=10 w@k3=10 STALE(HIT CACHE)`）。
  缺陷根因三元组判据 `cached.side===side && cached.depth===depth && cached.parentId===parentId`
  在两树**逐字节相同** ⇒ **S3 既未引入也未触碰**。该缺陷**不计入 S3 通过证据**。

---

## 八、三类问题分开列出

> 严格分三类，**不混写**。**S3 新增差异** = 本次复核新提出、且由 S3 引入或直接相关的差异；
> **基线既有缺陷** = 在 `e187fa9` 已存在、S3 未引入亦未扩大；
> **流程偏差** = 程序/纪律层面，不影响源码正确性。
>
> **第四类（本修订新增声明）· 覆盖缺口** —— 既非「S3 引入的差异」、亦非「基线缺陷」、亦非「流程」，
> 而是**测试/对照的缺失（漏红 ③ 风险）**，无处归入上述三类。先前 9.4 以编号「—」列出而未在正文声明，
> 现**正式列为独立类别**并给编号 **GAP-1**（见 8.4）。它与 S3-NEW-1 性质相邻（均属「测试有效性」），
> 但 S3-NEW-1 是「测试存在但判据薄弱」，GAP-1 是「分支/对照根本不存在」，故分列。

### 8.1 S3 新增差异（新增项：3 条，均非阻断）

#### S3-NEW-1【新增差异 · 测试有效性，非产品缺陷】

- **位置**：`packages/kernel/tests/summary-satellite.test.ts:396-404`；相关源码 `satellite.ts:201-202` 注释。
- **内容**：该用例声称「钉住两份 `subtreeBBox` 一致性」，但 `band` 由**逐成员节点盒**
  （`n.box.x` / `n.box.x + n.box.w`）reduce 而成（**本次亲自读 :396-404 确认**）；成员在该夹具中均无子节点
  → 子树包围盒 ≡ 节点盒，**两份实现即便分叉也恒等**。而 `satellite.ts:201-202` 注释却声称一致性「由测试钉住」。
- **验证方法（变异测试，独立确认员）**：复制工作树，关闭 `satellite.ts` 自持 `subtreeBBox` 的递归后，
  `npx vitest run packages/kernel/tests/summary-satellite.test.ts` **仍 19/19 通过**，全 kernel 套件 **691/691 通过**；
  而同一变异体下用带子节点的成员（`g1` 有 `g1child`）构造的判据**失败**（`expected 166 to be close to 390`）。
  → **该测试对被评审的分叉恒盲**。
- **性质**：**虚假安全网**（测试存在 ≠ 语义被钉住）。两份实现**当前同值**，故非产品缺陷。
- **severity**：medium（测试有效性）。**非阻断**（S3 未因此产生错误几何）。
- **建议（不在本报告执行）**：改用带子节点的成员构造判据。

#### S3-NEW-2【新增差异 · 度量口径未标注，非缺陷】

> **类别归属判据（补声明，消除与 PROC-2 的边界疑问）**：本报告归类采用**唯一显式判据 —— 是否涉及源码候选**。
> S3-NEW-2 的对象是**回执/度量文档**、**不涉及 `packages/`·`apps/` 源码候选**，故按「文档口径」归入新增差异；
> 与 PROC-1（amend）之分为流程偏差的差别在于：PROC-1 是**对提交本身执行的动作**（提交链层面），
> S3-NEW-2 是**记录口径未标注**（度量层面），二者层级不同。此判据为**本修订补写**，原报告未声明。

- **位置**：回执 §2.2 的 sha256 表（实际位于 `S3R-20260921-082207-review/s3-receipt.txt:56-67`）。
- **内容**：回执记录的哈希是**检出文件（`core.autocrlf=true` 展开后 CRLF）字节**的哈希，
  而非 git blob（LF）字节的哈希；对 blob 直接复算会 **10 中 9 个不符**，易被误读为「源码被改写」。
- **独立确认员精确化**：字节级检查显示全部 blob 均为纯 LF（`pipeline.test.ts` 为 126 LF / 0 CRLF），
  回执哈希实为 **worktree 检出文件**的哈希（9 项与磁盘文件逐字节相符）；
  唯一「原本相符」的 `pipeline.test.ts`（`b8b582d6…`）恰是**混用 blob/LF 口径的异类**（其 worktree 哈希为 `97840bec`）。
  → 回执内部**口径不一致**（9 项 CRLF/worktree + 1 项 LF/blob），比发现所述「单一 CRLF 口径」更精确。
- **性质**：**度量口径未标注**，非缺陷（`git diff e187fa9 9a523d3` 显示源码确未被改写）。
- **severity**：low。**非阻断**。

#### S3-NEW-3【新增差异 · 结构性重复计算，非缺陷】

- **位置**：`mindmap.ts:253-272, :317-339`（skip 过滤）vs `satellite.ts:109-143`（`buildSatellitePlan`）。
- **内容**：`skipIds` 与 `merge` **各自调用一次** `buildSatellitePlan(root)`（两次扫描 / 两次 `resolveSummaries`），
  非单一调用点共享。独立确认员实测：单次 `layoutMindmap` 内 `buildSatellitePlan` 被调用 **2 次**
  （`skipIds`=1、`merge`=1），两处 `root` 同一对象；3001 节点/300 摘要下两次 plan 占 warm 增量重排 **18.1%**（约可省 **0.66ms**）。
  （**来源标注**：「调用 2 次」本报告另在 8.1 正文侧有实读线索；`18.1%`/`0.66ms` 性能数据**未由本人重跑、无探针/日志路径 → 引用证据，未由本人重跑**。）
- **性质**：**重复计算**，当前两者判定同源故**等价、无缺陷**；但依赖「两处判定保持一致」的脆弱约定。
  严重度 low，**性能面略被低估**。
- **非阻断。**

> **其余相关发现经查证不属「S3 新增差异」或严重度被高估，一并如实记录**：
> `constants-react`（react 渲染层零消费）属 **S4 分期边界**，非回归 —— 且发现原文的 grep 模式
> `SUMMARY_BRACKET_GAP|SUMMARY_STEM_BRACKET` 无法匹配真实消费方，方法不当；react 侧确有消费方（见第三节 item 12）。
> `sat-additive`（`frameLayout.ts:245` 不携带 `satellites`）：**字面代码事实成立**（本次亲自读 `:245` 与 `:216` 确认），
> 但生产中该字段调用前已为空（`framePrunedCollapsed` 已剪出基座），且框内路径为**明示降级**
> （`mindmap.ts:64-65`、`satellite.ts:19-21`），故为 **low 的类型卫生问题**，非 medium 缺陷。
> `nested-scope-semantics`（原 status=unconfirmed）：其引用的 `resolved` 序列在代码上**不可能出现**，机制表述被证伪，
> 但 low 定级与「不丢节点」结论成立。
> `S3R-CACHE-01`（原 `status=verified`）：其引用探针文件全树不存在、数值不可原样复现 → 本报告将状态**统一标注为
> `status=downgraded-to-unconfirmed`**（原 `status=verified` 已撤回）。原「已验证」结论**不再作为通过证据**。

### 8.2 基线既有缺陷（BASE-1，1 条，非阻断）

#### BASE-1【基线既有 · 非 S3 引入 · 本批不修】

- **位置**：`packages/kernel/src/layout/layouts.ts:277-300`（`layoutLogic`）；对照 `mindmap.ts:233-241`、`forest.ts:158-165`。
- **内容**：`layoutLogic` **不做** `collapsedKey`/`measureKey` 身份校验，直接消费 `opts.cache`。
  热缓存 + 折叠集合**换实例**（新 `Set` 对象）时返回**陈旧展开几何**（WARM 5 / STALE 5 / COLD 2）。
  本次亲自读 `layouts.ts:277-284` 确认：函数体只取 `opts.cache` 与 `opts.satellite`，**无 `cacheValid`/`reset` 分支**；
  而 `mindmap.ts:233-241` **有** `cacheValid` 校验 + `cache.reset()`。
- **是否 S3 引入**：**否**。独立确认员对**基线 `e187fa9`** 跑同一探针得**完全相同**的三值；
  `git show e187fa9:packages/kernel/src/layout/layouts.ts` grep `collapsedKey`/`cacheValid` **为空**。
  （**来源标注**：基线 grep 由本报告作者实读；「对基线跑同一探针得相同三值」**未由本人重跑、未给探针路径 → 引用证据，未由本人重跑**。）
  S3 自带测试 `summary-satellite-cache.test.ts` 的「基线既有缺陷·边界标注」用例**显式钉住**该事实（WARM>COLD，cold=2）。
- **可达性纠正（严重度下调）**：发现原文称「该缺陷会同时放大卫星与其成员带的陈旧」。独立确认员实测**未成立** ——
  森林入口 `forest.ts:158-166` 在**任何岛内布局之前**已 `cache.reset()`，`layoutLogic` 仅经 `LAYOUT_BY_DIR` 在该 gate **之后**被调用；
  森林实验 `stale` 与 `cold` 指纹**逐位相同**（均 6 节点 + 1 卫星）；
  生产 `pipeline.ts:282-285` 只走 `layoutForest`/`layoutMindmapBranched`（**皆 gate**），registry 路径 `builtin.ts:31` 不传 `cache`。
  → **生产不可达**，severity 应**低于 medium**（本报告判 low）。
- **可达性判据的证据强度声明（如实标注）**：上述「生产不可达」仅由**三处 `file:line` 静态阅读**支撑，
  **本报告未提供任何命令输出**（例如全仓 `grep -rn "layoutLogic("` 的调用点全集），
  独立确认员的该组实测**亦未给出探针/日志路径** →
  **「生产不可达」的可执行证据：未覆盖**。本报告据此**保留** low 判定（三处调用路径经实读确无 gate 外调用），
  但明确声明：**若第三方要求以命令坐实 reachability，本报告无法提供，须补做**。
- **与 4.1 的「跨族 cache 实测」并存的澄清（避免误读为矛盾）**：4.1「跨族共享 cache 无混读」（S3R4-A2/A3 交替 `layoutLogic(±1)`）
  是**探针在自建夹具中直接调用 `layoutLogic`** 所测，**不经过** `forest.ts:158-166` 的 gate；
  而「生产不可达」说的是**生产调用链**（`pipeline.ts` → `layoutForest`/`layoutMindmapBranched`）中 `layoutLogic` 必在 gate 之后。
  两者一个测**函数本身行为**、一个测**生产可达性**，**不构成矛盾**；但两处所述**调用者不同**，前文未点明，此处补正。
- **另一独立确认员的不同证据**：其 `probe.mjs`（只读 `dist`）复现 WARM 5 / STALE 5 / COLD 2，基线同值；
  `summary-satellite-cache.test.ts` **8/8 通过**。
- **判定**：**基线既有，非 S3 引入，影响面未扩大，本批不修**。**不计入 S3 通过证据，亦不构成 REJECT 理由。**

### 8.3 流程偏差（2 条，均低）

#### PROC-1【流程偏差】一次 `git commit --amend`（**未认定违反任何可核验条款**）

- **事实**：施工方对首条回执提交执行了一次 `git commit --amend`（`b3f247c` → `4eb272e`），
  正面证据 = `git reflog --all` 的动作标记 `commit (amend)` + `git diff --name-status b3f247c 4eb272e` 仅一行回执 md。
- **影响面**：**仅回执文档，源码零字节**（`packages` tree `e66bb4d6…` 逐位相同）。
- **两处如实修正**：(a) 在 amend 提交当时回执仍写「4 条，无 amend」，自陈是稍后由 `6b4ad97` 追加，**非同步披露**；
  (b) 「违反任务书 §一.7」的具体条款**在候选树内不可验证**（全树 `git grep "不 amend"` 为空，
  `2026-09-20-summary-node-plan.md:30` 仅禁 `git add -A`/push）。
- **severity**：low。**非阻断。**
- **说明**：施工方已在回执 §十八（`:440-465`）如实自陈，未掩盖。

#### PROC-2【流程偏差】隔离工作树「非干净」呈现（索引/探针陈留）

- **事实**：本报告作者所在隔离工作树 `git status --porcelain` 显示 4 个 kernel 源文件 `MM`，
  外加 `?? outputs/rv/`、`?? outputs/summary-node/`。**本次实测**：
  `git diff HEAD --stat` **为空**，`git hash-object` 四文件与 `git rev-parse HEAD:<path>` **逐位相同**
  （`ccc2d339`/`0ade2fe8`/`6c182641`/`11d51480`）→ 是**索引 stat 缓存失效的 phantom**，**非真实改动**。
- **并发会话遗留**：另有并发复核会话的一次性探针文件（`zz-reviewer-probe*.test.ts`、`zz-s3r-probe*.test.ts` 等，
  均为 `??` untracked）在不同时点出现/消失；这些**不是候选代码**，故本报告以 `git ls-files` 限定 tracked 测试运行，
  并在定向/全包命令中确认 691/691、35/35 均为 tracked 结果（本次亲自跑的两次均无 `zz-*` 干扰）。
- **是否影响判定**：**否**。门禁读工作区磁盘与 tree，磁盘内容 = 候选 tree（已逐位核实）。
- **severity**：low。**非阻断**。
- **附带澄清**：独立确认员指出，索引的 4 个 blob（如 `forest=8d957b5f`）**不等于** HEAD 的父 `a9cab9a`，
  而等于更早的 `0b082d3`；即索引停在 `0b082d3` 中间态，比「S3 之前的父状态」更精确。

### 8.4 覆盖缺口（GAP-1，1 条，非阻断）

> 本类为**本修订新增的第四类**（见第八节开头声明），性质为「测试/对照缺失」，区别于 S3-NEW-1（测试存在但判据薄弱）。

#### GAP-1【覆盖缺口 · 测试与阴性对照缺失】

- **内容（两项）**：
  1. **`nestedSkip` 分支无已提交测试覆盖**：本人 `grep` 确认候选树内 `nestedSkip` 仅出现在 `satellite.ts` 自身，
     三个已提交卫星测试文件（35 用例）全用单摘要夹具（见 5.1）；可达性**仅由一次性探针**证明。
  2. **缓存域缺「故意放宽过滤」的变异阴性对照**：即 6.1 第 1 项类的变异在缓存路径上**无对应已提交阴性对照**。
- **为何现行分类无处安放**：它既非「S3 引入的差异」（非新行为）、亦非「基线既有缺陷」（无错误几何）、
  亦非「流程偏差」（非纪律问题）；性质上与 S3-NEW-1 同属**测试有效性（漏红 ③）**，
  但 S3-NEW-1 是「判据薄弱」，本项是「**覆盖根本不存在**」，故**分列并给编号 GAP-1**。
- **severity**：low。**非阻断。**
- **建议处置**：测试加固批次（与 S3-NEW-1 同批处理最经济）。
- **证据强度**：`nestedSkip` 无覆盖为**本人 `grep` 实测**；缓存域缺阴性对照为**对照记录实读**（引用证据）。

---

## 九、结论：ACCEPT

### 9.1 判定

**ACCEPT。**

### 9.2 ACCEPT 必要条件逐条核验

| 必要条件 | 是否满足 | 依据 | 证据强度（本人实测｜引用） |
|---|---|---|---|
| 提交链与源码候选可复现 | ✅ | 本人实测 `HEAD=9a523d3`、`tree=cc49754a`；4 条代码提交、10 文件集合、+2077/−38 均与回执 §2 一致 | 锚点 **本人实测**；`git rev-list/--name-status/--shortstat` 为**引用证据**（§2.1/2.2） |
| 无摘要逐位等价成立 | ✅ | 归一化 md5 相同、diff 0 行（无摘要路径）；kernel 全包 691/691 | kernel 691/691 **本人实测**；md5 归一化探针为**引用证据**（§7.4） |
| 卫星、森林、缓存、链接、降级路径成立 | ✅ | 定向 35/35、react 管线 3/3、degrade/closure 探针全绿；闭包注入方案经实读调用链 + 真管线测试确认 | 定向 35/35、react 3/3、源码实读 **本人实测**；degrade/closure **引用证据**（§三/§四） |
| 负控全部按目标断言转红 | ✅ | 指定五项均 `exit 1` 且按目标断言转红；施工方四处 A/B/C/D 日志实读同为 `exit 1` | **均为引用证据**（6.1 记录为**转抄**且**无日志路径 → 未覆盖**；6.2 为**日志实读**但属施工方另一组对照） |
| 门禁无新增债务 | ✅ | lint 净增 0；asCast/bang/any/bigFiles 持平；depcruise 0 违规 | **引用证据**（§7.2 读日志转抄；「lint 净增 0」前提未覆盖，见 7.2 注） |
| L2 未实现不属于硬 DoD | ✅ | 计划书 `:133` 明标「可选」，`:188` 预留停止出口；回执 `L397`/`L405-407` 如实标注未实现 | 实读文档 **本人实测** |
| amend 仅影响回执，未污染代码候选 | ✅ | 同父、`packages` tree 逐位相同、reflog 动作标记为正面证据 | **本人实测**（§2.4） |

> **说明**：上表「是否满足」列**不改动**（判定不变）；新增的证据强度列仅使第三方能区分
> **亲跑**与**转抄**，避免把引用证据当作已确认。标注为「引用证据」者，本报告**未重跑**其命令。

### 9.3 阻断项

**无。**

### 9.4 非阻断遗留（记录在案，供后续批次）

| 编号 | 类别 | severity | 摘要 | 建议处置批次 |
|---|---|---|---|---|
| S3-NEW-1 | S3 新增差异 | medium | `summary-satellite.test.ts:396-404` 一致性测试判据薄弱（对分叉恒盲） | S4 或独立测试加固批次 |
| S3-NEW-2 | S3 新增差异 | low | 回执 §2.2 哈希口径未标注（CRLF/worktree vs LF/blob 混用） | 下次回执勘误 |
| S3-NEW-3 | S3 新增差异 | low | `buildSatellitePlan` 重复计算（warm 增量 18.1%，约可省 0.66ms） | 性能优化批次 |
| BASE-1 | 基线既有缺陷 | low | `layoutLogic` 不校验 `collapsedKey`/`measureKey`（生产不可达） | 独立缺陷批次 |
| PROC-1 | 流程偏差 | low | 一次 amend（仅回执，源码零字节） | 已在回执自陈 |
| PROC-2 | 流程偏差 | low | 隔离工作树 phantom `MM` + 并发探针陈留 | 索引卫生 |
| GAP-1 | 覆盖缺口（第四类） | low | `nestedSkip` 分支无已提交测试覆盖；缓存域缺「故意放宽过滤」变异阴性对照 | 测试加固批次 |

### 9.5 未覆盖项（本报告如实声明「未跑/未核」）

- **本报告作者未亲自重跑**：react 全包 1602、canvas 全包 391、`pnpm typecheck`/`build`/`depcruise`/`lint`/`budget`
  （均为**引用 `gates-S3R2/` 日志原文**，日志 tail 已实读）；五项指定负控变异；kernel 全包在本次仅跑一次（73/691）。
- **本修订新增·经读者指出、确认属实的证据缺口（如实声明「未覆盖」，不补写）**：
  1. **6.1 五项负控的逐行日志路径**：本报告未提供任何日志文件名/路径，第三方无法按行回溯 →
     「是行为红而非假红」**未覆盖**（列名已由「真实退出码/红因原文」改为「日志所载（转抄）/目标断言描述」）。
  2. **BASE-1「生产不可达」的命令证据**：仅有静态 `file:line`，无 `grep` 调用点全集输出 → **未覆盖**（见 8.2）。
  3. **`pnpm lint` 与 `npx biome lint` 两次运行是否同一工作树/同一次运行**：未记录 → 「净增 0」前提**未覆盖**（见 7.2）。
  4. **独立确认员的探针/日志路径**（`band.maxX 378→500`、`18.1%/0.66ms`、基线三值复现等）：
     本报告未取得其原始输出 → 该类条目**未覆盖**（已在 5.1、8.1、8.2 逐处标注「引用证据，未由本人重跑」）。
- **未验证**：`dist` 哈希（工作树 `dist` 为核验期产物，非候选提交内容，需重建才能比对）；
  浏览器端/DOM 实测度量下的卫星几何（全部使用确定性纯函数度量）；
  真实 `hasAnyExplicitDir` 复杂夹具下的分区间部分摘除；
  forest 多岛 + 落点交替的「三次重复」判据。
- **不在范围**：S4 括线渲染、SVG 导出、浏览器完整验收（代码不存在，未评审）。

### 9.6 复现命令（供第三方核验）

```bash
# 锚点
cd <local-path>
git rev-parse HEAD HEAD^{tree}          # 9a523d31… / cc49754a…

# 工作树内容 == 候选
git hash-object packages/kernel/src/layout/{mindmap,forest,layouts}.ts packages/kernel/src/index.ts
# ccc2d339 / 0ade2fe8 / 6c182641 / 11d51480（与 git rev-parse HEAD:<path> 逐位相同）

# amend 正面证据
git reflog --all | grep "commit (amend)"
git diff --stat b3f247c 4eb272e          # 仅回执 md，1 file changed
git rev-parse b3f247c:packages 4eb272e:packages   # e66bb4d6… 二者相同

# 门禁（本人已跑）
cd packages/kernel && npx vitest run tests/summary-satellite.test.ts tests/summary-satellite-cache.test.ts tests/summary-satellite-forest.test.ts   # 35 passed
cd packages/kernel && npx vitest run     # 73 files / 691 passed
cd packages/react  && npx vitest run tests/summary-satellite-pipeline.test.ts   # 3 passed
```

### 9.7 最小返修范围

**本轮无需返修**（无阻断项）。若后续批次决定处理非阻断遗留，最小范围为：

1. **S3-NEW-1**：仅改 `packages/kernel/tests/summary-satellite.test.ts:396-404`，
   把 `band` 改为对带子节点的成员调用 `subtreeBBox`（**不动任何 `src/` 文件**）。
2. **S3-NEW-3**：仅改 `packages/kernel/src/layout/mindmap.ts`（把 `skipIds` 与 `merge` 的
   `buildSatellitePlan` 调用收敛为一次），**须保持逐位等价判据全绿**。
3. **BASE-1**：`packages/kernel/src/layout/layouts.ts` 增加与 `mindmap.ts:233-241` 同款身份校验，
   **须作为独立缺陷批次**（非 S3 范围），并先证明生产可达性。

---

## 十、只读复核边界声明

本次复核**严格只读**，明确声明：

1. **未修复任何缺陷** —— S3-NEW-1/2/3、BASE-1 及全部 low 项均**只报告、未改动任何源码或测试**。
2. **未合并** —— 未执行任何 `git merge`/`rebase`/`cherry-pick`。
3. **未 push** —— 未执行任何 `git push`；未改动远端。
4. **未启动 S4** —— 未创建任何 S4 相关分支、工作树或源码（`packages/react/src/render` 无 `SummaryLayer.tsx`/`summaryFrames.ts`）。
5. **未改被评审源码** —— 隔离工作树内 `git diff HEAD --stat` **为空**，四文件 blob 与 HEAD 逐位相同；
   本次仅新增本报告一个文件 `docs/dispatch/2026-09-21-summary-node-s3-review.md`（此前不存在）。
6. **未覆盖既有证据** —— 未写入、未覆盖 `outputs/` 下既有文件；证据目录
   `outputs/summary-node/S3/S3R-20260921-082207-review/` 由另一并发会话写入，本报告只读引用。
7. **未 commit** —— 本报告留在工作区，未提交、未推送。

---

## 附：本报告的证据层级标注

- **本人实测（本次执行）**：`git rev-parse HEAD HEAD^{tree}`；`git reflog --all | grep "commit (amend)"`；
  `git diff --stat b3f247c 4eb272e`；`git rev-parse b3f247c^ 4eb272e^`；`git rev-parse b3f247c:packages 4eb272e:packages`；
  `git hash-object` ×4 vs `git rev-parse HEAD:<path>`；`git status --porcelain`；`git diff HEAD --stat`；
  kernel 定向 35/35；kernel 全包 73/691；react 管线 3/3；
  源码实读 `frameLayout.ts:213-246`、`satellite.ts:60-70/108-145/196-250`、`layouts.ts:277-300`、`mindmap.ts:230-242`、
  `forest.ts:286-321`、`pipeline.ts:250-288`、`summary-satellite.test.ts:390-410`；
  `docs/dispatch/2026-09-20-summary-node-plan.md:20-40` 及 `git grep "amend"` 全树扫描。
- **引用证据 · 甲类（本人实读原文，但命令未由本人重跑）**：`01-chain.txt`/`02-receipts-stat.txt`/`03-amend.txt`/`05-scope.txt`/`06-evidence-integrity.txt`；
  `gates-S3R2/*.log` 与 `00-RESULT.md`（本人**读日志原文**，未重跑命令）；施工方 `negative/NEG-{A,B,C,D}*.txt`（本人**读原文**）。
  —— 此类证据的**文本内容**经本人眼睛核对，但**产生该文本的命令**未由本人执行，与「本人实测」**强度不同**。
- **引用证据 · 乙类（第二手转述，未读原始输出）**：`RV-forest-closure.md`/`S3R-DEGRADE-SCOPE-evidence.md`/`cache-satellite-review.md`；
  各域独立确认员的复述（已逐条标注「独立确认员实测/纠正」；其中无路径者按**未覆盖**处理，见 8.1/8.2 各处来源标注）。
  —— 此类连原始输出原文亦未由本人取得，**强度最低**。

> **说明**：原报告将甲、乙两类并置于「引用证据」同一标题下，强度被抹平；本修订**拆为甲/乙两级**。
> 「本人读日志原文」≠「本人跑命令」，两者不可互相替代。
- **未能复现 / 已证伪**：`constants-react` 的 grep 模式（方法不当）、`sat-additive` 的机制与 medium 定级、
  `nested-scope-semantics` 的 `resolved` 序列、`S3R-CACHE-01` 的探针文件与数值（→ `status=downgraded-to-unconfirmed`）、
  `S3R-CACHE-04` 的「影响面放大」、`S3R-CACHE-06` 的「靠对象域隔离」、`worktree-phantom-dirty` 的「index 停在父状态」。
  以上均在正文对应位置如实标注。
